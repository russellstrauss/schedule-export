import { inferYearForMonthDay } from "./iatse927-thread-parser.js";
import { isEventInFuture, parseScheduleDateParts } from "./schedule-time.js";
import { DEFAULT_TIMEZONE } from "./sources/types.js";

/**
 * @typedef {{ code: string; message: string; entry?: import("./sources/types.js").ScheduleEntry }} ValidationWarning
 */

const MONTH_NUMBERS = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12
};

const DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

/**
 * @param {import("./sources/types.js").ScheduleEntry} entry
 * @returns {ValidationWarning[]}
 */
export function validateEntryShape(entry) {
  /** @type {ValidationWarning[]} */
  const warnings = [];

  if (!entry.date || !DATE_RE.test(entry.date.trim())) {
    warnings.push({
      code: "INVALID_DATE",
      message: `Invalid date format (expected MM/DD/YYYY): ${entry.date}`,
      entry
    });
  }

  if (!entry.callTime || !TIME_RE.test(entry.callTime.trim())) {
    warnings.push({
      code: "INVALID_CALL_TIME",
      message: `Invalid callTime (expected HH:mm 24h): ${entry.callTime}`,
      entry
    });
  }

  if (!entry.show?.trim()) {
    warnings.push({
      code: "MISSING_SHOW",
      message: "Shift missing show name",
      entry
    });
  }

  return warnings;
}

/**
 * @param {import("./sources/types.js").ScheduleEntry[]} entries
 * @param {{ text: string }[]} messages
 * @returns {ValidationWarning[]}
 */
export function validateEvidence(entries, messages) {
  /** @type {ValidationWarning[]} */
  const warnings = [];

  for (const entry of entries) {
    const raw = entry.details || entry.notes || "";
    const indicesMatch = raw.match(/evidence:\s*\[([\d,\s]+)\]/i);
    const indices =
      entry.evidenceIndices ??
      (indicesMatch
        ? indicesMatch[1].split(",").map((x) => parseInt(x.trim(), 10))
        : null);

    if (!indices || !Array.isArray(indices) || indices.length === 0) {
      warnings.push({
        code: "MISSING_EVIDENCE",
        message: `Shift ${entry.date} ${entry.callTime} ${entry.show} has no evidence message indices`,
        entry
      });
      continue;
    }

    for (const index of indices) {
      if (!Number.isInteger(index) || index < 0 || index >= messages.length) {
        warnings.push({
          code: "EVIDENCE_OUT_OF_RANGE",
          message: `Evidence index ${index} out of range (0-${messages.length - 1}) for ${entry.show}`,
          entry
        });
      }
    }
  }

  return warnings;
}

/**
 * Calendar day in the schedule timezone, for year inference on bare month/day dates.
 * @param {Date} referenceDate
 * @param {string} timezone
 */
function zonedCalendarDate(referenceDate, timezone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  /** @type {Record<string, string>} */
  const parts = {};
  formatter.formatToParts(referenceDate).forEach((part) => {
    if (part.type !== "literal") parts[part.type] = part.value;
  });
  return new Date(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
}

/**
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @param {string} timezone
 * @param {Date} referenceDate
 */
function dayHasNotEnded(year, month, day, timezone, referenceDate) {
  return isEventInFuture(year, month, day, 23, 59, timezone, referenceDate);
}

/**
 * Dates named in a Gemini warning. Full dates keep their year. A bare month/day
 * uses the schedule timezone's current year, matching the rest of IATSE parsing.
 * @param {string} message
 * @param {Date} referenceDate
 * @param {string} timezone
 * @returns {{ year: number; month: number; day: number }[]}
 */
export function datesMentionedInWarning(message, referenceDate = new Date(), timezone = DEFAULT_TIMEZONE) {
  const yearRef = zonedCalendarDate(referenceDate, timezone);
  /** @type {{ year: number; month: number; day: number }[]} */
  const dates = [];
  const consumed = [];

  const remember = (matchIndex, matchLength, month, day, year) => {
    if (month < 1 || month > 12 || day < 1 || day > 31) return;
    consumed.push([matchIndex, matchIndex + matchLength]);
    dates.push({ year, month, day });
  };

  const overlaps = (index, length) =>
    consumed.some(([start, end]) => index < end && index + length > start);

  const fullDate = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g;
  for (const match of message.matchAll(fullDate)) {
    let year = Number(match[3]);
    if (match[3].length === 2) year += 2000;
    remember(match.index ?? 0, match[0].length, Number(match[1]), Number(match[2]), year);
  }

  const monthName =
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?|september|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?\b/gi;
  for (const match of message.matchAll(monthName)) {
    const index = match.index ?? 0;
    if (overlaps(index, match[0].length)) continue;
    const month = MONTH_NUMBERS[match[1].toLowerCase()];
    const day = Number(match[2]);
    const year = match[3] ? Number(match[3]) : inferYearForMonthDay(month, day, yearRef);
    remember(index, match[0].length, month, day, year);
  }

  const monthDay = /\b(\d{1,2})\/(\d{1,2})\b/g;
  for (const match of message.matchAll(monthDay)) {
    const index = match.index ?? 0;
    if (overlaps(index, match[0].length)) continue;
    const month = Number(match[1]);
    const day = Number(match[2]);
    remember(index, match[0].length, month, day, inferYearForMonthDay(month, day, yearRef));
  }

  return dates;
}

/**
 * True when the warning is only about a shift that has already ended.
 * Warnings with no date stay, and a warning that also names a current or
 * upcoming date stays.
 * @param {ValidationWarning} warning
 * @param {Date} [referenceDate]
 * @param {string} [timezone]
 */
export function warningIsAboutPastEvent(
  warning,
  referenceDate = new Date(),
  timezone = DEFAULT_TIMEZONE
) {
  const entryDate = warning.entry?.date?.trim();
  if (entryDate && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(entryDate)) {
    const { year, month, day, hours, minutes } = parseScheduleDateParts(
      entryDate,
      warning.entry?.callTime || "23:59"
    );
    return !isEventInFuture(year, month, day, hours, minutes, timezone, referenceDate);
  }

  const dates = datesMentionedInWarning(warning.message || "", referenceDate, timezone);
  if (dates.length === 0) return false;
  return dates.every((date) => !dayHasNotEnded(date.year, date.month, date.day, timezone, referenceDate));
}

/**
 * @param {ValidationWarning[]} warnings
 * @param {Date} [referenceDate]
 * @param {string} [timezone]
 */
export function omitPastEventWarnings(warnings, referenceDate = new Date(), timezone = DEFAULT_TIMEZONE) {
  return warnings.filter((warning) => !warningIsAboutPastEvent(warning, referenceDate, timezone));
}

/**
 * @param {ValidationWarning[]} warnings
 */
export function formatValidationReport(warnings) {
  if (warnings.length === 0) return;
  console.warn(
    `⚠️  Validation report (${warnings.length} warning(s)):\n` +
      warnings.map((w) => `  - [${w.code}] ${w.message}`).join("\n")
  );
}

/**
 * @param {import("./sources/types.js").ScheduleEntry[]} entries
 * @returns {ValidationWarning[]}
 */
export function validateAllEntries(entries) {
  return entries.flatMap((entry) => validateEntryShape(entry));
}
