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
 * @param {string} value
 * @returns {string}
 */
export function normalizePhone(value) {
  if (typeof value !== "string") return "";
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }
  return digits;
}

/**
 * @param {Record<string, unknown> | null} body
 * @returns {boolean}
 */
export function verifyIngestPhone(body) {
  const allowed = process.env.IATSE_ALLOWED_PHONE;
  if (!allowed?.trim()) {
    throw new Error("IATSE_ALLOWED_PHONE is not configured");
  }

  const allowedDigits = normalizePhone(allowed);
  const fromBody =
    typeof body?.phone === "string"
      ? body.phone
      : typeof body?.phoneNumber === "string"
        ? body.phoneNumber
        : "";

  if (!fromBody.trim()) return false;

  return normalizePhone(fromBody) === allowedDigits;
}

export { INGEST_SOURCE };
