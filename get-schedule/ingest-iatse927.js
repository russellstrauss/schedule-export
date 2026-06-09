import { authorize } from "./google-calendar/auth.js";
import { addEvent, purgeOrphanedSourceEvents } from "./google-calendar/add-event.js";
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
import { DEFAULT_TIMEZONE } from "./sources/types.js";
import { isEventCancelled, logAndMapEvents, scheduleRowId } from "./utils.js";

/**
 * @param {{ text: string; receivedAt?: Date | null; messageId?: string }[]} messages
 * @returns {Promise<{ parsed: number; synced: number; warnings: import("./iatse927-validation.js").ValidationWarning[] }>}
 */
export async function syncIatse927FromMessages(messages) {
  console.log(`🌐 Fetching schedule from ${sourceId}...`);
  const { entries, warnings } = await resolveScheduleEntriesWithValidation(messages);
  const validEntries = entries.filter((entry) => !isEventCancelled(entry));
  const activeRowIds = validEntries.map((entry) =>
    scheduleRowId({ ...entry, source: sourceId })
  );
  const googleEvents = logAndMapEvents(entries, sourceId, {
    futureOnly: true,
    timezone: DEFAULT_TIMEZONE
  });

  let auth = await authorize();

  auth = await withAuthRetry(auth, async (a) => {
    await purgeOrphanedSourceEvents(a, sourceId, activeRowIds);
    return a;
  });

  for (const event of googleEvents) {
    auth = await withAuthRetry(auth, async (a) => {
      await addEvent(a, event);
      return a;
    });
  }

  return {
    parsed: entries.length,
    synced: googleEvents.length,
    warnings
  };
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
 * Sync IATSE from Firestore when configured; skip gracefully otherwise.
 * @returns {Promise<{ parsed: number; synced: number; warnings: import("./iatse927-validation.js").ValidationWarning[] } | null>}
 */
export async function trySyncIatse927FromStore() {
  if (!process.env.GEMINI_API_KEY?.trim()) {
    console.warn(`⚠️  Skipping ${sourceId}: GEMINI_API_KEY not configured`);
    return null;
  }

  let messages;
  try {
    messages = await loadAllMessages();
  } catch (err) {
    if (isFirestoreNotFoundError(err)) {
      console.warn(`⚠️  Skipping ${sourceId}: Firestore database not found`);
      return null;
    }
    if (isFirestoreCredentialsError(err)) {
      console.warn(
        `⚠️  Skipping ${sourceId}: Firestore credentials not available (${err instanceof Error ? err.message : err})`
      );
      return null;
    }
    if (isFirestoreProjectIdError(err)) {
      console.warn(
        `⚠️  Skipping ${sourceId}: Firestore project ID not configured (${err instanceof Error ? err.message : err})`
      );
      return null;
    }
    throw err;
  }

  if (messages.length === 0) {
    console.warn(`⚠️  Skipping ${sourceId}: no messages in Firestore`);
    return null;
  }

  try {
    return await syncIatse927FromMessages(messages);
  } catch (err) {
    if (isGeminiUnavailableError(err)) {
      const detail = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️  Skipping ${sourceId}: Gemini unavailable (${detail})`);
      return null;
    }
    throw err;
  }
}

/**
 * @param {{ text?: string; messageId?: string }} body
 * @returns {Promise<{ stored: boolean; parsed: number; synced: number; warnings: import("./iatse927-validation.js").ValidationWarning[] }>}
 */
export async function ingestIatse927(body) {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    throw new Error("Ingest requires non-empty text");
  }

  const messageId =
    typeof body.messageId === "string" ? body.messageId.trim() : undefined;

  let appended;
  try {
    ({ appended } = await appendMessage(text, { messageId }));
  } catch (err) {
    if (isFirestoreNotFoundError(err)) {
      throw new Error(
        "Firestore database not found. Create a Firestore Native database in this GCP project (e.g. us-central1), then retry."
      );
    }
    throw err;
  }

  const messages = await loadAllMessages();
  const { parsed, synced, warnings } = await syncIatse927FromMessages(messages);

  console.log(
    `ℹ️  [${sourceId}] Ingest complete: stored=${appended}, synced=${synced}`
  );

  return {
    stored: appended,
    parsed,
    synced,
    warnings
  };
}
