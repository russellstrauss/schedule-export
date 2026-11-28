/**
 * HTTP routing helpers for syncSchedule (batch vs IATSE ingest).
 */

const INGEST_SOURCE = "iatse927";
const TEXT_FIELDS = ["text", "message", "sms", "content", "body", "msg"];
const NON_INGEST_MODES = new Set(["health", "status", "iatse", "iatse927", "sync"]);

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
 * @param {unknown} payload
 * @returns {string}
 */
function textFromPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const record = /** @type {Record<string, unknown>} */ (payload);
  for (const key of TEXT_FIELDS) {
    const text = asText(record[key]);
    if (text) return text;
  }
  if (typeof record.data === "string" && record.data.trim()) return record.data.trim();
  const nested = record.data;
  if (nested && typeof nested === "object") return textFromPayload(nested);
  return "";
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
 * SMS text carried by a phone POST.
 * An empty body, a health check, and an IATSE-only sync are not messages.
 * @param {import("@google-cloud/functions-framework").Request} req
 * @param {Record<string, unknown> | null} body
 * @returns {string}
 */
export function extractIngestText(req, body) {
  const mode = String(req.query?.mode ?? body?.mode ?? "").toLowerCase();
  if (NON_INGEST_MODES.has(mode)) return "";

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

  if (/^(?:text|message|sms|content|body|msg)=/i.test(raw)) {
    const params = new URLSearchParams(raw);
    for (const key of TEXT_FIELDS) {
      const text = asText(params.get(key));
      if (text) return text;
    }
    return "";
  }

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
