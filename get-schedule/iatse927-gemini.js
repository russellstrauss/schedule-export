import { GoogleGenAI } from "@google/genai";
import { DEFAULT_TIMEZONE } from "./sources/types.js";
import { isCloudRuntime } from "./runtime-env.js";
import { sourceId } from "./sources/iatse927.js";
import {
  validateAllEntries,
  validateEvidence,
  formatValidationReport,
  omitPastEventWarnings
} from "./iatse927-validation.js";
import { expandDualTimeCallEntries } from "./iatse927-call-expander.js";
import { buildGeminiContextPayload } from "./iatse927-message-context.js";
import {
  normalizeScheduleCallTime,
  normalizeScheduleDate,
  sortScheduleEntriesChronologically
} from "./utils.js";
import { enrichIatse927Entries } from "./iatse927-entry-enrichment.js";

const DEFAULT_MODEL = "models/gemini-3.8-flash";

const ENTRY_SCHEMA = {
  type: "object",
  properties: {
    date: { type: "string", description: "MM/DD/YYYY" },
    callTime: { type: "string", description: "HH:mm 24-hour crew call time for this entry" },
    show: { type: "string" },
    venue: { type: "string" },
    location: { type: "string" },
    position: { type: "string" },
    type: {
      type: "string",
      enum: ["Load In", "Load Out", "Call"],
      description: "Load In, Load Out, or Call for single-time shifts"
    },
    status: { type: "string" },
    details: {
      type: "string",
      description:
        "Supplemental reminder facts only: Parking, Steward, Notes (one labeled line each). Do not repeat Show, Call, Venue, or Address here — those come from other fields. Leave empty if none."
    },
    notes: {
      type: "string",
      description: "Deprecated — leave empty; put Parking, Steward, Notes in details only"
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    evidenceIndices: {
      type: "array",
      items: { type: "integer" }
    }
  },
  required: ["date", "callTime", "show", "type", "evidenceIndices"]
};

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    entries: { type: "array", items: ENTRY_SCHEMA },
    warnings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          date: { type: "string" },
          callTime: { type: "string" },
          show: { type: "string" }
        },
        required: ["code", "message"]
      }
    }
  },
  required: ["entries", "warnings"]
};

const SYSTEM_INSTRUCTION = `You extract confirmed IATSE 927 work shifts from SMS message threads.

The payload includes domainGuide (real examples), and per-message context:
- messageKind: availability_ask, negotiation, acceptance, confirmation, reminder, decline, quick_call_ask, correction, ack, other
- speaker: steward, member, or unknown
- schedulingHints: parsed dates, times24h, load-in/out flags
- expectedCalendarEvents: inferred count/types when applicable (use as a guide, not gospel)
- precedingContext: up to 4 prior messages with kind + snippet — READ THIS to decide load-in-only vs load-out-only vs dual-call

How to decide 1 vs 2 calendar events:
- ONE text can mean TWO events when it confirms or describes both load-in AND load-out on the same date (e.g. "10:30AM and 10PM").
- ONE event when only one time is confirmed — use precedingContext (e.g. load-in filled, user took load-out only → one Load Out).
- Split calls across dates (5/8 load in, 5/9 load out) → two events on different dates if both confirmed.
- Quick calls → one Call event at the stated time.
- Corrections ("Confirmed. My mistake") → drop superseded offers; keep the corrected shift set.

Extraction rules:
- Output one object per distinct confirmed crew call time (past and future).
- type must be "Load In", "Load Out", or "Call".
- Merge reminder details onto every entry for that date/show (both Load In and Load Out).
- Populate details with ONLY supplemental lines from the reminder: Parking, Steward, Notes (one fact per line, e.g. \"Parking: first come first serve\"). Do not put Show, Call, Venue, or Address in details — those are separate fields. Leave notes empty.
- venue is the venue name (same for load-in and load-out on the same show/date). location is the street address for THIS entry only — use the load-in address on Load In entries and the load-out address on Load Out entries when the reminder gives different addresses; otherwise use the shared address. Leave location empty when no street address is given.
- Cross-thread: Shawn scheduling + Tyler reminders may interleave; use receivedAt order.
- Ignore availability-only, declines, filled-already, superseded offers, standalone reminder acks.
- Use timezone ${DEFAULT_TIMEZONE}. Infer year from message dates + thread timing.
- Each entry needs evidenceIndices (0-based message indices) citing confirmation and/or supporting reminder.
- confidence: high for explicit Confirmed; medium for steward assignment + acceptance; low if uncertain.
- status "confirmed" only.
- Sort entries ascending by date, then callTime (earlier dates and load-in before load-out on same day).

Before returning, double-check every entry against the full thread:
- Trace evidenceIndices: availability → negotiation → acceptance → confirmation → reminder.
- Dual-time confirms must yield Load In + Load Out unless precedingContext shows only one was confirmed.
- Single-time confirms after "load in filled" / "load out only" → one entry of the correct type.
- Remove shifts contradicted by corrections or declines; remove duplicates.
- Put issues you notice in warnings (codes: WEAK_EVIDENCE, CONTRADICTION, DUPLICATE, MISSED_DECLINE) but still return corrected entries.
- Do not warn about a shift before today in ${DEFAULT_TIMEZONE}. That includes a reminder that mentions an unconfirmed call on a past date. When you do warn, include the full MM/DD/YYYY show date.

Return { entries, warnings }.`;

/**
 * @param {unknown} value
 * @returns {"Load In" | "Load Out" | "Call" | ""}
 */
function normalizeShiftType(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase().replace(/[-_]/g, " ");
  if (normalized === "load in" || normalized === "loadin") return "Load In";
  if (normalized === "load out" || normalized === "loadout") return "Load Out";
  if (normalized === "call") return "Call";
  return "";
}

/**
 * @param {unknown} raw
 * @returns {import("./sources/types.js").ScheduleEntry[]}
 */
function normalizeGeminiEntries(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {import("./sources/types.js").ScheduleEntry[]} */
  const entries = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = /** @type {Record<string, unknown>} */ (item);
    const status = typeof row.status === "string" ? row.status.trim().toLowerCase() : "confirmed";
    if (status === "declined" || status === "superseded") continue;

    const date = typeof row.date === "string" ? normalizeScheduleDate(row.date.trim()) : "";
    const callTime = typeof row.callTime === "string"
      ? normalizeScheduleCallTime(row.callTime.trim())
      : "";
    const show = typeof row.show === "string" ? row.show.trim() : "";
    if (!date || !callTime || !show) continue;

    const [h, m] = callTime.split(":").map((x) => parseInt(x, 10));
    if (Number.isNaN(h) || Number.isNaN(m)) continue;

    const evidenceIndices = Array.isArray(row.evidenceIndices)
      ? row.evidenceIndices.filter((i) => Number.isInteger(i))
      : [];

    const shiftType =
      normalizeShiftType(row.type) ||
      normalizeShiftType(row.shiftType) ||
      "Call";

    entries.push({
      source: sourceId,
      date,
      callTime: `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`,
      show,
      venue: typeof row.venue === "string" ? row.venue : "",
      location: typeof row.location === "string" ? row.location : "",
      position: typeof row.position === "string" ? row.position : "",
      type: shiftType,
      status: "confirmed",
      details: typeof row.details === "string" ? row.details : undefined,
      notes: typeof row.notes === "string" ? row.notes : undefined,
      evidenceIndices,
      confidence: typeof row.confidence === "string" ? row.confidence : undefined
    });
  }

  return entries;
}

/**
 * @param {unknown} parsed
 * @returns {import("./iatse927-validation.js").ValidationWarning[]}
 */
function normalizeGeminiWarnings(parsed) {
  if (!parsed || typeof parsed !== "object") return [];
  const warnings = /** @type {{ warnings?: unknown }} */ (parsed).warnings;
  if (!Array.isArray(warnings)) return [];
  return warnings.map((w) => /** @type {{ code: string; message: string }} */ (w));
}

function resolveModelName() {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * Gemini 3/4 Flash defaults to medium thinking. This extraction is a structured
 * transform, and a multi-minute silent POST is what Node reports as "fetch failed"
 * when the connection drops before headers arrive. `low` is the lowest level
 * gemini-3.8-flash accepts.
 * @param {string} modelName
 * @param {object} responseSchema
 */
function buildGenerationConfig(modelName, responseSchema) {
  /** @type {Record<string, unknown>} */
  const generationConfig = {
    responseMimeType: "application/json",
    responseSchema
  };
  if (/gemini-[34](?:[.\d-]|$)/i.test(modelName)) {
    generationConfig.thinkingConfig = { thinkingLevel: "low" };
  }
  return generationConfig;
}

function stripModelsPrefix(modelName) {
  const name = modelName.trim();
  return name.startsWith("models/") ? name.slice("models/".length) : name;
}

function resolveVertexLocation() {
  return process.env.GEMINI_VERTEX_LOCATION?.trim() || "us-central1";
}

function resolveCloudProjectId() {
  return process.env.GOOGLE_CLOUD_PROJECT?.trim() || process.env.GCLOUD_PROJECT?.trim() || "";
}

/**
 * @param {unknown} raw
 */
export function normalizeGeminiApiKey(raw) {
  if (typeof raw !== "string") return "";
  let key = raw.trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  return key;
}

/**
 * @param {string} apiKey
 * @returns {string | null}
 */
export function describeGeminiCredentialIssue(apiKey) {
  if (!apiKey) return null;
  if (apiKey.startsWith("ya29.") || apiKey.startsWith("1//")) {
    return "GEMINI_API_KEY looks like a Google OAuth token, not an AI Studio API key";
  }
  if (apiKey.startsWith("{") && apiKey.includes("access_token")) {
    return "GEMINI_API_KEY looks like GOOGLE_TOKEN JSON; use a Gemini API key from AI Studio instead";
  }
  return null;
}

function canUseVertexGemini() {
  return isCloudRuntime() && !!resolveCloudProjectId();
}

/**
 * @param {string} apiKey
 */
function preferVertexGemini(apiKey) {
  const flag = process.env.GEMINI_USE_VERTEX?.trim().toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes") return true;
  if (!canUseVertexGemini()) return false;
  if (!apiKey) return true;
  return !!describeGeminiCredentialIssue(apiKey);
}

/**
 * @param {"apiKey" | "enterprise"} mode
 * @param {string} apiKey
 */
function buildGeminiClient(mode, apiKey) {
  if (mode === "enterprise") {
    return new GoogleGenAI({
      enterprise: true,
      project: resolveCloudProjectId(),
      location: resolveVertexLocation()
    });
  }
  return new GoogleGenAI({ apiKey });
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isGeminiAuthError(err) {
  const status = /** @type {{ status?: number }} */ (err)?.status;
  if (status === 401 || status === 403) return true;
  const msg = String(err instanceof Error ? err.message : err);
  return /api key not valid|access_token_type_unsupported|unauthenticated|invalid authentication credentials/i.test(
    msg
  );
}

function formatGeminiAuthFailureMessage(lastError) {
  const detail = geminiErrorDetail(lastError);
  const base =
    "Gemini authentication failed. Create or rotate a restricted key at https://aistudio.google.com/apikey " +
    "and update the GEMINI_API_KEY secret, or enable Vertex AI on this GCP project so the Cloud Function can use its service account.";
  return detail ? `${base} (${detail})` : base;
}

/**
 * @param {import("@google/genai").GoogleGenAI} client
 * @param {string} modelName
 * @param {string} prompt
 * @param {Record<string, unknown>} generationConfig
 * @param {string} systemInstruction
 */
async function invokeGenerateContent(client, modelName, prompt, generationConfig, systemInstruction) {
  const response = await client.models.generateContent({
    model: stripModelsPrefix(modelName),
    contents: prompt,
    config: {
      systemInstruction,
      ...generationConfig
    }
  });
  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned empty response");
  }
  return text;
}

function buildPayload(messages) {
  return buildGeminiContextPayload(messages);
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isGeminiUnavailableError(err) {
  const status = /** @type {{ status?: number }} */ (err)?.status;
  if (status === 429 || status === 503 || status === 500) return true;
  const msg = String(err instanceof Error ? err.message : err).toLowerCase();
  return (
    msg.includes("too many requests") ||
    msg.includes("quota") ||
    msg.includes("billing") ||
    msg.includes("resource exhausted")
  );
}

const GEMINI_NETWORK_ERROR_RE =
  /fetch failed|und_err_|econnreset|etimedout|enotfound|econnrefused|eai_again|socket hang up|other side closed|headers timeout|headerstimeouterror|connect timeouterror/i;

function scrubSecrets(value) {
  return String(value ?? "")
    .replace(/AIza[0-9A-Za-z_-]+/g, "[key]")
    .replace(/AQ\.[A-Za-z0-9._-]+/g, "[key]");
}

/**
 * Walk `error.cause` (undici hides the real code there) without repeating the API key.
 * @param {unknown} err
 */
export function geminiErrorDetail(err) {
  /** @type {string[]} */
  const parts = [];
  const seen = new Set();
  let current = err;
  while (current && typeof current === "object" && !seen.has(current) && parts.length < 6) {
    seen.add(current);
    const code = /** @type {{ code?: string }} */ (current).code;
    const message = scrubSecrets(/** @type {{ message?: string }} */ (current).message || "");
    const bit = [code, message].filter(Boolean).join(" ");
    if (bit && !parts.some((part) => part.includes(bit) || bit.includes(part))) parts.push(bit);
    current = /** @type {{ cause?: unknown }} */ (current).cause;
  }
  return parts.join(" | ");
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isGeminiNetworkError(err) {
  return GEMINI_NETWORK_ERROR_RE.test(geminiErrorDetail(err));
}

function isGeminiRetryableError(err) {
  const status = /** @type {{ status?: number }} */ (err)?.status;
  if (status === 429 || status === 503) return true;
  return isGeminiNetworkError(err);
}

/**
 * The SDK replaces the undici error and drops `cause`. Capture it first.
 * @param {() => Promise<unknown>} fn
 */
async function withFetchCause(fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    try {
      return await originalFetch(url, options);
    } catch (err) {
      const detail = geminiErrorDetail(err);
      const wrapped = new TypeError(detail || "fetch failed");
      wrapped.cause = err;
      const code =
        /** @type {{ code?: string }} */ (err)?.code ||
        /** @type {{ cause?: { code?: string } }} */ (err)?.cause?.code;
      if (code) wrapped.code = code;
      throw wrapped;
    }
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

/**
 * @param {string} prompt
 * @param {string} systemInstruction
 * @param {object} responseSchema
 */
async function generateContentWithRetry(prompt, systemInstruction, responseSchema) {
  const model = resolveModelName();
  const generationConfig = buildGenerationConfig(model, responseSchema);
  const apiKey = normalizeGeminiApiKey(process.env.GEMINI_API_KEY);
  const credentialIssue = describeGeminiCredentialIssue(apiKey);

  /** @type {Array<"apiKey" | "enterprise">} */
  const modes = [];
  if (preferVertexGemini(apiKey)) {
    if (!canUseVertexGemini()) {
      throw new Error(credentialIssue || "GEMINI_API_KEY is not configured");
    }
    modes.push("enterprise");
  } else {
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured");
    }
    if (credentialIssue) {
      throw new Error(credentialIssue);
    }
    modes.push("apiKey");
    if (canUseVertexGemini()) {
      modes.push("enterprise");
    }
  }

  const retryDelaysMs = [0, 3000, 8000];
  /** @type {unknown} */
  let lastError;

  for (let modeIndex = 0; modeIndex < modes.length; modeIndex++) {
    const mode = modes[modeIndex];
    const client = buildGeminiClient(mode, apiKey);
    if (mode === "enterprise" && modeIndex > 0) {
      console.warn("⚠️  Gemini API key auth failed; retrying with Cloud service account (Vertex)...");
    }

    for (let attempt = 0; attempt < retryDelaysMs.length; attempt++) {
      if (retryDelaysMs[attempt] > 0) {
        console.warn(
          `⚠️  Gemini retry ${attempt}/${retryDelaysMs.length - 1} after ${retryDelaysMs[attempt] / 1000}s`
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
      }

      try {
        return await withFetchCause(() =>
          invokeGenerateContent(client, model, prompt, generationConfig, systemInstruction)
        );
      } catch (err) {
        lastError = err;
        const detail = geminiErrorDetail(err);
        if (isGeminiAuthError(err) && modeIndex < modes.length - 1) {
          break;
        }
        if (!isGeminiRetryableError(err) || attempt === retryDelaysMs.length - 1) {
          if (detail) console.error(`❌ Gemini request failed: ${detail}`);
          if (isGeminiAuthError(err) && modeIndex === modes.length - 1) {
            throw new Error(formatGeminiAuthFailureMessage(err));
          }
          throw err;
        }
        console.warn(`⚠️  Gemini request failed (${detail || "unknown error"})`);
      }
    }
  }

  if (isGeminiAuthError(lastError)) {
    throw new Error(formatGeminiAuthFailureMessage(lastError));
  }
  throw lastError;
}

/**
 * @param {{ text: string; receivedAt?: Date | null; messageId?: string }[]} messages
 * @returns {Promise<{ entries: import("./sources/types.js").ScheduleEntry[]; geminiWarnings: import("./iatse927-validation.js").ValidationWarning[] }>}
 */
async function extractAndVerifyWithGemini(messages) {
  const payload = buildPayload(messages);

  const responseText = await generateContentWithRetry(
    `Extract all confirmed shifts, double-check each against the thread, and return corrected entries plus any warnings:\n${JSON.stringify(payload)}`,
    SYSTEM_INSTRUCTION,
    RESPONSE_SCHEMA
  );

  const parsed = JSON.parse(responseText);
  let entries = normalizeGeminiEntries(parsed.entries ?? parsed);
  entries = expandDualTimeCallEntries(entries, messages);
  entries = enrichIatse927Entries(entries, messages);
  entries = sortScheduleEntriesChronologically(entries);

  if (entries.length === 0 && messages.length > 0) {
    throw new Error("Gemini returned no valid schedule entries");
  }

  return {
    entries,
    geminiWarnings: normalizeGeminiWarnings(parsed)
  };
}

/**
 * @param {{ text: string; receivedAt?: Date | null; messageId?: string }[]} messages
 * @returns {Promise<import("./sources/types.js").ScheduleEntry[]>}
 */
export async function extractScheduleEntriesWithGemini(messages) {
  const { entries } = await extractAndVerifyWithGemini(messages);
  return entries;
}

/**
 * @param {{ text: string; receivedAt?: Date | null; messageId?: string }[]} messages
 * @returns {Promise<{ entries: import("./sources/types.js").ScheduleEntry[]; warnings: import("./iatse927-validation.js").ValidationWarning[] }>}
 */
export async function resolveScheduleEntriesWithValidation(messages) {
  const { entries, geminiWarnings } = await extractAndVerifyWithGemini(messages);

  const shapeWarnings = validateAllEntries(entries);
  const evidenceWarnings = validateEvidence(entries, messages);
  const warnings = omitPastEventWarnings(
    [...geminiWarnings, ...shapeWarnings, ...evidenceWarnings],
    new Date(),
    DEFAULT_TIMEZONE,
    messages
  );

  for (const w of warnings) {
    console.warn(`⚠️  ${w.code}: ${w.message}`);
  }
  formatValidationReport(warnings);

  return { entries, warnings };
}

/**
 * @param {{ text: string; receivedAt?: Date | null; messageId?: string }[]} messages
 * @returns {Promise<import("./sources/types.js").ScheduleEntry[]>}
 */
export async function resolveScheduleEntries(messages) {
  const { entries } = await resolveScheduleEntriesWithValidation(messages);
  return entries;
}
