import { GoogleGenerativeAI } from "@google/generative-ai";
import { DEFAULT_TIMEZONE } from "./sources/types.js";
import { sourceId } from "./sources/iatse927.js";
import {
  validateAllEntries,
  validateEvidence,
  formatValidationReport
} from "./iatse927-validation.js";
import { expandDualTimeCallEntries } from "./iatse927-call-expander.js";
import { buildGeminiContextPayload } from "./iatse927-message-context.js";
import { sortScheduleEntriesChronologically } from "./utils.js";

const DEFAULT_MODEL = "gemini-2.5-flash";

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
    details: { type: "string" },
    notes: { type: "string" },
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

    const date = typeof row.date === "string" ? row.date.trim() : "";
    const callTime = typeof row.callTime === "string" ? row.callTime.trim() : "";
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

function getModel(systemInstruction, responseSchema) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
    systemInstruction,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema
    }
  });
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

function isGeminiRetryableError(err) {
  const status = /** @type {{ status?: number }} */ (err)?.status;
  return status === 429 || status === 503;
}

/**
 * @param {{ generateContent: (prompt: string) => Promise<unknown> }} model
 * @param {string} prompt
 */
async function generateContentWithRetry(model, prompt) {
  const retryDelaysMs = [0, 3000, 8000];
  /** @type {unknown} */
  let lastError;

  for (let attempt = 0; attempt < retryDelaysMs.length; attempt++) {
    if (retryDelaysMs[attempt] > 0) {
      console.warn(
        `⚠️  [${sourceId}] Gemini retry ${attempt}/${retryDelaysMs.length - 1} after ${retryDelaysMs[attempt] / 1000}s`
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
    }

    try {
      return await model.generateContent(prompt);
    } catch (err) {
      lastError = err;
      if (!isGeminiRetryableError(err) || attempt === retryDelaysMs.length - 1) {
        throw err;
      }
    }
  }

  throw lastError;
}

/**
 * @param {{ text: string; receivedAt?: Date | null; messageId?: string }[]} messages
 * @returns {Promise<{ entries: import("./sources/types.js").ScheduleEntry[]; geminiWarnings: import("./iatse927-validation.js").ValidationWarning[] }>}
 */
async function extractAndVerifyWithGemini(messages) {
  const model = getModel(SYSTEM_INSTRUCTION, RESPONSE_SCHEMA);
  const payload = buildPayload(messages);

  const result = await generateContentWithRetry(
    model,
    `Extract all confirmed shifts, double-check each against the thread, and return corrected entries plus any warnings:\n${JSON.stringify(payload)}`
  );

  const parsed = JSON.parse(result.response.text());
  let entries = normalizeGeminiEntries(parsed.entries ?? parsed);
  entries = expandDualTimeCallEntries(entries, messages);
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
  const warnings = [...geminiWarnings, ...shapeWarnings, ...evidenceWarnings];

  for (const w of warnings) {
    console.warn(`⚠️  [${sourceId}] ${w.code}: ${w.message}`);
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
