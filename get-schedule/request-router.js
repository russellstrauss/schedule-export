/**
 * HTTP routing helpers for syncSchedule (batch vs IATSE ingest).
 */

const INGEST_SOURCE = "iatse927";
const TEXT_FIELDS = [
  "text",
  "message",
  "sms",
  "content",
  "body",
  "msg",
  "smsbody",
  "sms_body",
  "smstext",
  "sms_text",
  "messagebody",
  "message_body",
  "messagetext",
  "message_text",
  "notification",
  "alert",
  "data"
];
// Health probes stay empty. A sync request that also carries an SMS is a message.
const PROBE_MODES = new Set(["health", "status"]);
const SKIP_KEYS = new Set([
  "mode",
  "source",
  "messageid",
  "id",
  "type",
  "action",
  "timestamp",
  "receivedat",
  "success",
  "status"
]);
const SKIP_VALUES = new Set(["ingest", "iatse", "iatse927", "sync", "health", "status"]);

/**
 * @param {import("@google-cloud/functions-framework").Request} req
 * @returns {Record<string, unknown> | null}
 */
export function parseRequestBody(req) {
  if (req.body == null) return null;
  if (typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} key
 * @returns {unknown}
 */
function valueForKey(record, key) {
  const wanted = key.toLowerCase();
  for (const [name, value] of Object.entries(record)) {
    if (name.toLowerCase() === wanted) return value;
  }
  return undefined;
}

/**
 * @param {unknown} value
 * @param {string} key
 * @param {number} depth
 * @param {string[]} out
 */
function collectMessageStrings(value, key, depth, out) {
  if (depth > 4 || value == null) return;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || SKIP_KEYS.has(key.toLowerCase()) || SKIP_VALUES.has(text.toLowerCase())) return;
    out.push(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMessageStrings(item, key, depth + 1, out);
    return;
  }
  if (typeof value === "object" && !Buffer.isBuffer(value)) {
    for (const [childKey, child] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
      collectMessageStrings(child, childKey, depth + 1, out);
    }
  }
}

/**
 * @param {unknown} payload
 * @returns {string}
 */
function textFromPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Buffer.isBuffer(payload)) {
    return "";
  }
  const record = /** @type {Record<string, unknown>} */ (payload);
  for (const key of TEXT_FIELDS) {
    const value = valueForKey(record, key);
    const text = asText(value);
    if (text && !SKIP_VALUES.has(text.toLowerCase())) return text;
    if (value && typeof value === "object") {
      const nested = textFromPayload(value);
      if (nested) return nested;
    }
  }

  /** @type {string[]} */
  const found = [];
  collectMessageStrings(payload, "", 0, found);
  found.sort((a, b) => b.length - a.length);
  return found[0] || "";
}

/**
 * @param {import("@google-cloud/functions-framework").Request} req
 * @returns {string}
 */
function rawBodyText(req) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  const raw = /** @type {{ rawBody?: unknown }} */ (req).rawBody;
  if (typeof raw === "string") return raw;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  return "";
}

/**
 * @param {string} raw
 * @returns {string}
 */
function textFromForm(raw) {
  const entries = [...new URLSearchParams(raw).entries()];
  for (const key of TEXT_FIELDS) {
    const match = entries.find(([name]) => name.toLowerCase() === key);
    const text = asText(match?.[1]);
    if (text && !SKIP_VALUES.has(text.toLowerCase())) return text;
  }
  let best = "";
  for (const [key, value] of entries) {
    const text = value.trim();
    if (!text || SKIP_KEYS.has(key.toLowerCase()) || SKIP_VALUES.has(text.toLowerCase())) continue;
    if (text.length > best.length) best = text;
  }
  return best;
}

/**
 * SMS text carried by a phone POST.
 * An empty body and a health check are not messages. A sync request that
 * also carries the SMS is a message: the phone posts ?mode=iatse with the text.
 * @param {import("@google-cloud/functions-framework").Request} req
 * @param {Record<string, unknown> | null} body
 * @returns {string}
 */
export function extractIngestText(req, body) {
  const mode = String(req.query?.mode ?? body?.mode ?? "").toLowerCase();
  if (PROBE_MODES.has(mode)) return "";

  const fromBody = textFromPayload(body);
  if (fromBody) return fromBody;

  const queryText = TEXT_FIELDS.map((key) => asText(req.query?.[key])).find(Boolean);
  if (queryText) return queryText;

  const raw = rawBodyText(req).replace(/^\uFEFF/, "").trim();
  if (!raw) return "";

  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      return textFromPayload(JSON.parse(raw));
    } catch {
      return "";
    }
  }

  if (raw.includes("=")) return textFromForm(raw);
  if (SKIP_VALUES.has(raw.toLowerCase())) return "";
  return raw;
}

/**
 * @param {import("@google-cloud/functions-framework").Request} req
 * @param {Record<string, unknown> | null} body
 */
export function isIngestRequest(req, body) {
  const path = (req.path || req.url || "").split("?")[0];
  if (/\/ingest\/iatse927\/?$/i.test(path)) {
    return true;
  }
  const mode = String(req.query?.mode ?? body?.mode ?? "").toLowerCase();
  const source = String(req.query?.source ?? body?.source ?? "").toLowerCase();
  if (mode === "ingest" && (source === INGEST_SOURCE || source === "iatse")) {
    return true;
  }
  return Boolean(extractIngestText(req, body));
}

/**
 * Preserve the endpoint's original behavior: requests run synchronization
 * unless they explicitly ask for the lightweight health response.
 *
 * @param {import("@google-cloud/functions-framework").Request} req
 * @param {Record<string, unknown> | null} body
 */
/**
 * Prod/mobile: Firestore + Gemini + calendar for IATSE only (no portal scrape).
 * @param {import("@google-cloud/functions-framework").Request} req
 * @param {Record<string, unknown> | null} body
 */
export function isIatseOnlySyncRequest(req, body) {
  const mode = String(req.query?.mode ?? body?.mode ?? "").toLowerCase();
  return mode === "iatse" || mode === "iatse927";
}

export function isSyncRequest(req, body) {
  const mode = String(req.query?.mode ?? body?.mode ?? "").toLowerCase();
  return !["health", "status", "iatse", "iatse927"].includes(mode);
}

export { INGEST_SOURCE };
