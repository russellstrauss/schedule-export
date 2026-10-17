/**
 * HTTP routing helpers for syncSchedule (batch vs IATSE ingest).
 */

const INGEST_SOURCE = "iatse927";

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
 * @param {import("@google-cloud/functions-framework").Request} req
 * @param {Record<string, unknown> | null} body
 */
export function isIngestRequest(req, body) {
  const path = (req.path || req.url || "").split("?")[0];
  if (/\/ingest\/iatse927\/?$/i.test(path)) {
    return true;
  }
  return body?.mode === "ingest" && body?.source === INGEST_SOURCE;
}

/**
 * Keep browser GETs cheap while preserving Cloud Scheduler and explicit sync
 * requests. Cloud Scheduler sends this User-Agent by default.
 *
 * @param {import("@google-cloud/functions-framework").Request} req
 * @param {Record<string, unknown> | null} body
 */
export function isSyncRequest(req, body) {
  const mode = req.query?.mode ?? body?.mode;
  if (String(mode || "").toLowerCase() === "sync") return true;
  if (String(req.method || "").toUpperCase() === "POST") return true;

  const userAgent = req.get?.("user-agent") ?? req.headers?.["user-agent"] ?? "";
  return String(userAgent).toLowerCase().includes("google-cloud-scheduler");
}

export { INGEST_SOURCE };
