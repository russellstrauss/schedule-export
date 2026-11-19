import crypto from "crypto";
import { authorize } from "./google-calendar/auth.js";
import { addEvent, consolidateDuplicateSourceEvents, purgeOrphanedSourceEvents } from "./google-calendar/add-event.js";
import { withAuthRetry } from "./auth-handler.js";
import {
  appendMessage,
  loadAllMessages,
  isFirestoreNotFoundError,
  isFirestoreCredentialsError
} from "./iatse927-message-store.js";
import { isFirestoreProjectIdError } from "./iatse927-firestore-auth.js";
import { resolveScheduleEntriesWithValidation, isGeminiUnavailableError } from "./iatse927-gemini.js";
import { sourceId } from "./sources/iatse927.js";
import { isSourceEnabled } from "./user-settings.js";
import { DEFAULT_TIMEZONE } from "./sources/types.js";
import { isEventCancelled, logAndMapEvents, scheduleRowId } from "./utils.js";

let iatseSyncInFlight = null;
let lastSuccessfulIatseSchedule = null;

function messageSnapshotKey(messages) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(
        messages.map((message) => ({
          messageId: message.messageId || "",
          text: message.text || "",
          receivedAt: message.receivedAt?.toISOString?.() || message.receivedAt || null
        }))
      )
    )
    .digest("hex");
}

/**
 * @param {{ text: string; receivedAt?: Date | null; messageId?: string }[]} messages
 * @returns {Promise<{ parsed: number; synced: number; warnings: import("./iatse927-validation.js").ValidationWarning[] }>}
 */
async function syncIatse927FromMessagesInternal(messages) {
  console.log(`🌐 Fetching schedule from ${sourceId}...`);
  const { entries, warnings } = await resolveScheduleEntriesWithValidation(messages);
  const cancelledEntries = entries.filter((entry) => isEventCancelled(entry));
  // Map entries to Google events filtering strictly by current time to avoid
  // re-syncing past events that were referenced in old messages.
  const googleEvents = logAndMapEvents(entries, sourceId, {
    futureOnly: true,
    timezone: DEFAULT_TIMEZONE
  });
  const snapshotKey = messageSnapshotKey(messages);
  const cachedSchedule =
    lastSuccessfulIatseSchedule?.snapshotKey === snapshotKey
      ? lastSuccessfulIatseSchedule.googleEvents
      : null;
  const eventsToSync = googleEvents.length > 0 ? googleEvents : cachedSchedule || [];
  if (googleEvents.length === 0 && cachedSchedule) {
    console.warn("No events parsed; reusing the last successful IATSE schedule for this message snapshot.");
  }

  // Active row ids must reflect the events we're actually syncing (future events).
  const activeRowIds = eventsToSync.map((e) => e.rowId);
  const cancelledRowIds = cancelledEntries.map((entry) => scheduleRowId({ ...entry, source: sourceId }));

  // Nothing upcoming to sync (no messages, or all parsed events are in the past).
  // Skip auth/purge to avoid touching the calendar when there's nothing to sync.
  if (eventsToSync.length === 0) {
    console.warn("No currently scheduled events.");
    const auth = await authorize();
    await withAuthRetry(auth, async (a) => {
      await consolidateDuplicateSourceEvents(a, sourceId);
      return a;
    });
    return { parsed: entries.length, synced: 0, warnings };
  }

  let auth = await authorize();

  auth = await withAuthRetry(auth, async (a) => {
    await purgeOrphanedSourceEvents(a, sourceId, activeRowIds, { cancelledRowIds });
    return a;
  });

  for (const event of eventsToSync) {
    auth = await withAuthRetry(auth, async (a) => {
      const result = await addEvent(a, event);
      if (result?.action === "error") {
        throw result.error || new Error(`Failed to sync IATSE event ${event.rowId}`);
      }
      return a;
    });
  }

	lastSuccessfulIatseSchedule = { snapshotKey, googleEvents: eventsToSync };

  return {
    parsed: entries.length,
    synced: eventsToSync.length,
    warnings
  };
}

export function syncIatse927FromMessages(messages) {
  if (iatseSyncInFlight) return iatseSyncInFlight;

  iatseSyncInFlight = syncIatse927FromMessagesInternal(messages).finally(() => {
    iatseSyncInFlight = null;
  });
  return iatseSyncInFlight;
}

/**
 * @returns {Promise<{ parsed: number; synced: number; warnings: import("./iatse927-validation.js").ValidationWarning[] }>}
 */
export async function resyncIatse927FromStore() {
  const messages = await loadAllMessages();
  if (messages.length === 0) {
    throw new Error("No messages in Firestore");
  }
  return syncIatse927FromMessages(messages);
}

/**
 * Reasons that mean the local device could not finish IATSE. An empty thread
 * or a source that is turned off is a completed local result, not a failure.
 */
const IATSE_REMOTE_FALLBACK_REASONS = new Set([
  "missing-api-key",
  "firestore-not-found",
  "firestore-credentials",
  "firestore-project",
  "gemini-unavailable"
]);

/**
 * @param {string} reason
 * @param {{ parsed: number; synced: number; warnings: import("./iatse927-validation.js").ValidationWarning[] } | null} [result]
 */
function iatseAttempt(reason, result = null) {
  return { reason, result };
}

/**
 * @param {{ reason: string }} attempt
 * @returns {boolean}
 */
export function iatseAttemptNeedsRemoteFallback(attempt) {
  return IATSE_REMOTE_FALLBACK_REASONS.has(attempt?.reason);
}

/**
 * Sync IATSE from Firestore when configured, and report why it did not sync.
 * @param {{ ignoreUserSettings?: boolean }} [options] — remote `?mode=iatse` sets this so prod can sync while local user-settings has IATSE off.
 * @returns {Promise<{ reason: string; result: { parsed: number; synced: number; warnings: import("./iatse927-validation.js").ValidationWarning[] } | null }>}
 */
export async function attemptSyncIatse927FromStore(options = {}) {
  if (!options.ignoreUserSettings && !isSourceEnabled(sourceId)) {
    console.log(`ℹ️  ${sourceId} is turned off in user-settings.json; skipping calendar sync.`);
    return iatseAttempt("disabled");
  }

  if (!process.env.GEMINI_API_KEY?.trim()) {
    console.warn(`⚠️  Skipping ${sourceId}: GEMINI_API_KEY not configured`);
    return iatseAttempt("missing-api-key");
  }

  let messages;
  try {
    messages = await loadAllMessages();
  } catch (err) {
    if (isFirestoreNotFoundError(err)) {
      console.warn(`⚠️  Skipping ${sourceId}: Firestore database not found`);
      return iatseAttempt("firestore-not-found");
    }
    if (isFirestoreCredentialsError(err)) {
      console.warn(
        `⚠️  Skipping ${sourceId}: Firestore credentials not available (${err instanceof Error ? err.message : err})`
      );
      return iatseAttempt("firestore-credentials");
    }
    if (isFirestoreProjectIdError(err)) {
      console.warn(
        `⚠️  Skipping ${sourceId}: Firestore project ID not configured (${err instanceof Error ? err.message : err})`
      );
      return iatseAttempt("firestore-project");
    }
    throw err;
  }

  if (messages.length === 0) {
    console.warn(`⚠️  Skipping ${sourceId}: no messages in Firestore`);
    return iatseAttempt("no-messages");
  }

  try {
    return iatseAttempt("synced", await syncIatse927FromMessages(messages));
  } catch (err) {
    if (isGeminiUnavailableError(err)) {
      const detail = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️  Skipping ${sourceId}: Gemini unavailable (${detail})`);
      return iatseAttempt("gemini-unavailable");
    }
    throw err;
  }
}

/**
 * Sync IATSE from Firestore when configured; skip gracefully otherwise.
 * @param {{ ignoreUserSettings?: boolean }} [options] — remote `?mode=iatse` sets this so prod can sync while local user-settings has IATSE off.
 * @returns {Promise<{ parsed: number; synced: number; warnings: import("./iatse927-validation.js").ValidationWarning[] } | null>}
 */
export async function trySyncIatse927FromStore(options = {}) {
  const attempt = await attemptSyncIatse927FromStore(options);
  return attempt.result;
}

/**
 * Store one SMS in Firestore (fast path — no Gemini/calendar).
 * @param {{ text?: string; messageId?: string }} body
 * @returns {Promise<{ stored: boolean; id: string }>}
 */
export async function storeIatse927Message(body) {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    throw new Error("Ingest requires non-empty text");
  }

  const messageId =
    typeof body.messageId === "string" ? body.messageId.trim() : undefined;

  try {
    const { appended, id } = await appendMessage(text, { messageId });
    console.log(`ℹ️  Message stored: appended=${appended}, id=${id}`);
    return { stored: appended, id };
  } catch (err) {
    if (isFirestoreNotFoundError(err)) {
      throw new Error(
        "Firestore database not found. Create a Firestore Native database in this GCP project (e.g. us-central1), then retry."
      );
    }
    throw err;
  }
}
