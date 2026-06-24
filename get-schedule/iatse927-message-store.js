import crypto from "crypto";
import { Firestore } from "@google-cloud/firestore";
import {
  getFirestoreProjectId,
  getGcloudAccessToken,
  isFirestoreCredentialsError,
  shouldPreferFirestoreRest,
  firestoreStringValue,
  firestoreTimestampValue
} from "./iatse927-firestore-auth.js";

const COLLECTION = "iatse927_messages";

/** @type {import("@google-cloud/firestore").Firestore | null} */
let db = null;
/** @type {boolean | null} */
let useRestClient = null;

function getDb() {
  if (useRestClient) {
    throw new Error("Firestore SDK unavailable; use REST helpers");
  }
  if (!db) {
    const projectId = getFirestoreProjectId();
    db = new Firestore({ projectId, databaseId: "(default)" });
  }
  return db;
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isFirestoreNotFoundError(err) {
  const code = err?.code;
  const message = String(err?.message || "");
  return code === 5 || code === "NOT_FOUND" || message.includes("NOT_FOUND");
}

function contentHash(text) {
  return crypto.createHash("sha256").update(text.trim()).digest("hex").slice(0, 32);
}

/**
 * @returns {Promise<{ text: string; receivedAt: Date | null; messageId: string }[]>}
 */
async function loadAllMessagesViaRest() {
  const projectId = getFirestoreProjectId();
  const token = getGcloudAccessToken();
  /** @type {{ text: string; receivedAt: Date | null; messageId: string }[]} */
  const messages = [];
  let pageToken;

  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${COLLECTION}`
    );
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Firestore REST list failed (${res.status}): ${body}`);
    }

    const data = await res.json();
    for (const doc of data.documents || []) {
      const fields = doc.fields || {};
      messages.push({
        text: firestoreStringValue(fields.text),
        receivedAt: firestoreTimestampValue(fields.receivedAt),
        messageId: firestoreStringValue(fields.messageId) || doc.name?.split("/").pop() || ""
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  messages.sort((a, b) => {
    const ta = a.receivedAt?.getTime() ?? 0;
    const tb = b.receivedAt?.getTime() ?? 0;
    return ta - tb;
  });

  return messages;
}

/**
 * @param {string} text
 * @param {{ messageId?: string; receivedAt?: Date }} [options]
 * @returns {Promise<{ appended: boolean; id: string }>}
 */
export async function appendMessage(text, options = {}) {
  const messageId = options.messageId?.trim() || contentHash(text);
  const coll = getDb().collection(COLLECTION);

  if (options.messageId) {
    const existing = await coll.where("messageId", "==", messageId).limit(1).get();
    if (!existing.empty) {
      return { appended: false, id: existing.docs[0].id };
    }
  } else {
    const byHash = await coll.where("contentHash", "==", contentHash(text)).limit(1).get();
    if (!byHash.empty) {
      return { appended: false, id: byHash.docs[0].id };
    }
  }

  /** @type {Record<string, unknown>} */
  const doc = {
    text,
    messageId,
    contentHash: contentHash(text),
    receivedAt: options.receivedAt
      ? Firestore.Timestamp.fromDate(options.receivedAt)
      : Firestore.FieldValue.serverTimestamp()
  };

  const docRef = await coll.add(doc);
  return { appended: true, id: docRef.id };
}

/**
 * @param {{ text: string; messageId?: string; receivedAt?: Date }[]} messages
 * @returns {Promise<{ inserted: number; skipped: number }>}
 */
export async function bulkAppendMessages(messages) {
  const coll = getDb().collection(COLLECTION);
  let inserted = 0;
  let skipped = 0;

  for (const msg of messages) {
    const text = msg.text?.trim() || "";
    if (!text) {
      skipped += 1;
      continue;
    }

    const messageId = msg.messageId?.trim() || contentHash(text);
    const hash = contentHash(text);

    const byId = await coll.where("messageId", "==", messageId).limit(1).get();
    if (!byId.empty) {
      skipped += 1;
      continue;
    }

    const byHash = await coll.where("contentHash", "==", hash).limit(1).get();
    if (!byHash.empty) {
      skipped += 1;
      continue;
    }

    await coll.add({
      text,
      messageId,
      contentHash: hash,
      receivedAt: msg.receivedAt
        ? Firestore.Timestamp.fromDate(msg.receivedAt)
        : Firestore.FieldValue.serverTimestamp()
    });
    inserted += 1;
  }

  return { inserted, skipped };
}

/**
 * @returns {Promise<{ text: string; receivedAt: Date | null; messageId: string }[]>}
 */
export async function loadAllMessages() {
  if (useRestClient === true) {
    return loadAllMessagesViaRest();
  }

  // Locally, prefer gcloud REST (user login) over Firestore SDK (ADC file).
  if (shouldPreferFirestoreRest()) {
    try {
      const messages = await loadAllMessagesViaRest();
      useRestClient = true;
      db = null;
      return messages;
    } catch (err) {
      if (isFirestoreCredentialsError(err) || isFirestoreNotFoundError(err)) {
        throw err;
      }
      console.warn("⚠️  [iatse927] Firestore REST failed locally; trying Firestore SDK");
    }
  }

  try {
    const snap = await getDb().collection(COLLECTION).orderBy("receivedAt", "asc").get();
    return snap.docs.map((doc) => {
      const data = doc.data();
      const receivedAt = data.receivedAt?.toDate?.() ?? null;
      return {
        text: data.text || "",
        receivedAt,
        messageId: data.messageId || doc.id
      };
    });
  } catch (err) {
    if (!isFirestoreCredentialsError(err)) {
      throw err;
    }
    useRestClient = true;
    db = null;
    console.warn("⚠️  [iatse927] Firestore SDK auth unavailable; using gcloud REST fallback");
    return loadAllMessagesViaRest();
  }
}

/**
 * @param {{ text: string; receivedAt: Date | null }[]} messages
 * @returns {string}
 */
export function combineMessageTexts(messages) {
  return messages
    .map((m) => m.text.trim())
    .filter(Boolean)
    .join("\n\n---\n\n");
}

/** Reset client (for tests). */
export function resetStoreForTests() {
  db = null;
  useRestClient = null;
}

export { isFirestoreCredentialsError };
