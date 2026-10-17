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
 * Preserve the endpoint's original behavior: requests run synchronization
 * unless they explicitly ask for the lightweight health response.
 *
 * @param {import("@google-cloud/functions-framework").Request} req
 * @param {Record<string, unknown> | null} body
 */
export function isSyncRequest(req, body) {
  const mode = req.query?.mode ?? body?.mode;
  return !["health", "status"].includes(String(mode || "").toLowerCase());
}

export { INGEST_SOURCE };
