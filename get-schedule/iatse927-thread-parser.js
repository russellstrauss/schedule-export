import crypto from "crypto";
import { DEFAULT_TIMEZONE } from "./sources/types.js";

const WEEKDAY =
  "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday";
const MONTH =
  "January|February|March|April|May|June|July|August|September|October|November|December";

const TIMESTAMP_RE = new RegExp(
  `^\\s*(?:(${WEEKDAY}),?\\s*)?(?:(${MONTH})\\s+(\\d{1,2}))?\\s*·\\s*(\\d{1,2}):(\\d{2})\\s*(AM|PM)\\s*$`,
  "i"
);

const METADATA_LINE_RE =
  /^(?:Chat with 927|Texting with 927|Details|This RCS chat is now end-to-end encrypted\.?)\s*$/i;

const MONTH_INDEX = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11
};

/**
 * @param {number} month 1-12
 * @param {number} day
 * @param {Date} referenceDate
 */
export function inferYearForMonthDay(month, day, referenceDate) {
  const year = referenceDate.getFullYear();
  const candidate = new Date(year, month - 1, day);
  const ref = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  );

  if (candidate >= ref) {
    return year;
  }

  // Same calendar year (historical thread messages earlier in the year)
  return year;
}

const MONTH_NAME_PATTERN =
  "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec";

const MONTH_NAME_NUMBERS = {
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

const MONTH_NAME_DATE_RE = new RegExp(
  `\\b(${MONTH_NAME_PATTERN})\\.?\\s+(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?` +
    `((?:\\s*(?:,|&|and)\\s*\\d{1,2}(?!\\d)(?:st|nd|rd|th)?)*)` +
    `(?:\\s*,?\\s*(\\d{4}))?`,
  "gi"
);

const NUMERIC_DATE_RE = /\b(\d{1,2})\/(\d{1,2})(?!\d)(?:\/(\d{2,4}))?\b/g;
const TRAILING_DAY_RE =
  /\s*(?:,|&|and)\s*(\d{1,2})(?!\d)(?:st|nd|rd|th)?(?!\s*(?:am|pm)\b|\s*[:/]|[:/])/gi;

/**
 * Calendar day in the schedule timezone, so year inference does not follow UTC.
 * @param {Date} referenceDate
 * @param {string} [timezone]
 */
export function zonedReferenceDate(referenceDate = new Date(), timezone = DEFAULT_TIMEZONE) {
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
 * @param {number} statedYear
 * @param {number} month
 * @param {number} day
 * @param {Date} referenceDate
 */
function yearForScheduleDate(statedYear, month, day, referenceDate) {
  const ref = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  );
  const inferredYear = inferYearForMonthDay(month, day, ref);
  const inferred = new Date(inferredYear, month - 1, day);
  if (statedYear < inferredYear && inferred >= ref) return inferredYear;
  return statedYear;
}

/**
 * @param {string} dateStr
 * @param {Date} referenceDate Calendar day, already zoned.
 * @returns {string}
 */
function alignUpcomingScheduleDateFromCalendarDate(dateStr, referenceDate) {
  const match = String(dateStr || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return String(dateStr || "").trim();
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = yearForScheduleDate(Number(match[3]), month, day, referenceDate);
  return `${month}/${day}/${year}`;
}

/**
 * Move a past-year month/day onto this year when that day is still ahead.
 * "12/6/2025" on November 27, 2026 becomes "12/6/2026".
 * @param {string} dateStr
 * @param {Date} [referenceDate]
 * @returns {string}
 */
export function alignUpcomingScheduleDate(dateStr, referenceDate = new Date()) {
  return alignUpcomingScheduleDateFromCalendarDate(dateStr, zonedReferenceDate(referenceDate));
}

/**
 * One schedule date, or the first date in a short Gemini date field.
 * Accepts MM/DD/YYYY and month-name dates such as "Dec 6".
 * @param {string} dateStr
 * @param {Date} [referenceDate]
 * @returns {string}
 */
export function canonicalizeScheduleDate(dateStr, referenceDate = new Date()) {
  const ref = zonedReferenceDate(referenceDate);
  const trimmed = String(dateStr || "").trim();
  const numeric = trimmed.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (numeric) {
    const month = Number(numeric[1]);
    const day = Number(numeric[2]);
    let year = numeric[3] ? Number(numeric[3]) : inferYearForMonthDay(month, day, ref);
    if (numeric[3]?.length === 2) year += 2000;
    return alignUpcomingScheduleDateFromCalendarDate(`${month}/${day}/${year}`, ref);
  }
  const dates = extractScheduleDateSpansFromCalendarDate(trimmed, ref);
  return dates[0]?.date || "";
}

/**
 * Dates named in an SMS, including "Dec 6 and 28" and "12/6 and 28".
 * @param {string} text
 * @param {Date} referenceDate Calendar day, already zoned.
 * @returns {{ date: string; index: number }[]}
 */
function extractScheduleDateSpansFromCalendarDate(text, referenceDate) {
  const ref = referenceDate;
  /** @type {{ date: string; index: number }[]} */
  const spans = [];
  MONTH_NAME_DATE_RE.lastIndex = 0;
  NUMERIC_DATE_RE.lastIndex = 0;

  for (const match of text.matchAll(MONTH_NAME_DATE_RE)) {
    const month = MONTH_NAME_NUMBERS[match[1].toLowerCase()];
    if (!month) continue;
    const statedYear = match[4]
      ? Number(match[4])
      : inferYearForMonthDay(month, Number(match[2]), ref);
    const year = yearForScheduleDate(statedYear, month, Number(match[2]), ref);
    const days = [Number(match[2])];
    if (match[3]) {
      for (const dayMatch of match[3].matchAll(/(\d{1,2})(?!\d)/g)) {
        days.push(Number(dayMatch[1]));
      }
    }
    days.forEach((day, offset) => {
      if (day < 1 || day > 31) return;
      spans.push({
        date: `${month}/${day}/${year}`,
        index: (match.index ?? 0) + offset
      });
    });
  }

  for (const match of text.matchAll(NUMERIC_DATE_RE)) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    let year = match[3] ? Number(match[3]) : inferYearForMonthDay(month, day, ref);
    if (match[3]?.length === 2) year += 2000;
    const stated = yearForScheduleDate(year, month, day, ref);
    spans.push({
      date: `${month}/${day}/${stated}`,
      index: match.index ?? 0
    });

    const after = text.slice((match.index ?? 0) + match[0].length);
    TRAILING_DAY_RE.lastIndex = 0;
    let cursor = 0;
    let trailing = TRAILING_DAY_RE.exec(after);
    while (trailing && trailing.index === cursor) {
      const extraDay = Number(trailing[1]);
      if (extraDay >= 1 && extraDay <= 31) {
        const extraYear = yearForScheduleDate(stated, month, extraDay, ref);
        spans.push({
          date: `${month}/${extraDay}/${extraYear}`,
          index: (match.index ?? 0) + match[0].length + trailing.index
        });
      }
      cursor = trailing.index + trailing[0].length;
      trailing = TRAILING_DAY_RE.exec(after);
    }
  }

  spans.sort((a, b) => a.index - b.index || a.date.localeCompare(b.date));
  const seen = new Set();
  return spans.filter((span) => {
    if (seen.has(span.date)) return false;
    seen.add(span.date);
    return true;
  });
}

/**
 * @param {string} text
 * @param {Date} [referenceDate]
 * @returns {{ date: string; index: number }[]}
 */
export function extractScheduleDateSpans(text, referenceDate = new Date()) {
  return extractScheduleDateSpansFromCalendarDate(text, zonedReferenceDate(referenceDate));
}

/**
 * @param {string} text
 * @param {Date} [referenceDate]
 * @returns {string[]}
 */
export function extractScheduleDates(text, referenceDate = new Date()) {
  return extractScheduleDateSpans(text, referenceDate).map((span) => span.date);
}

const TIME_ONLY_RE = /^\s*(\d{1,2}):(\d{2})\s*(AM|PM)\s*$/i;

/**
 * @param {string} line
 * @param {{ month: number; day: number; year: number }} context
 * @param {Date} referenceDate
 */
function parseTimestampLine(line, context, referenceDate) {
  let match = line.match(TIMESTAMP_RE);
  let hours;
  let minutes;
  let ampm;

  if (match) {
    const monthName = match[2]?.toLowerCase();
    const dayPart = match[3] ? parseInt(match[3], 10) : null;
    let month = context.month;
    let day = context.day;

    if (monthName && dayPart) {
      month = (MONTH_INDEX[monthName] ?? context.month - 1) + 1;
      day = dayPart;
    }

    if (!month || !day) {
      return null;
    }

    const year = inferYearForMonthDay(month, day, referenceDate);
    context.month = month;
    context.day = day;
    context.year = year;

    hours = parseInt(match[4], 10);
    minutes = parseInt(match[5], 10);
    ampm = match[6].toUpperCase();
  } else {
    const timeOnly = line.match(TIME_ONLY_RE);
    if (!timeOnly || !context.month || !context.day) return null;
    hours = parseInt(timeOnly[1], 10);
    minutes = parseInt(timeOnly[2], 10);
    ampm = timeOnly[3].toUpperCase();
  }

  if (ampm === "PM" && hours < 12) hours += 12;
  if (ampm === "AM" && hours === 12) hours = 0;

  const year = context.year ?? inferYearForMonthDay(context.month, context.day, referenceDate);
  return new Date(year, context.month - 1, context.day, hours, minutes, 0, 0);
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function splitBlockIntoTurns(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const paragraphs = trimmed.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length <= 1) {
    return [trimmed];
  }

  /** @type {string[]} */
  const turns = [];
  for (const paragraph of paragraphs) {
    const lines = paragraph.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length <= 3 && lines.every((l) => l.length < 120)) {
      turns.push(...lines);
    } else {
      turns.push(paragraph);
    }
  }
  return turns.filter(Boolean);
}

/**
 * @param {string} text
 * @param {{ referenceDate?: Date; sourceThread?: string }} [options]
 * @returns {{ text: string; receivedAt: Date; messageId: string; sourceThread?: string }[]}
 */
export function parseRcsThread(text, options = {}) {
  const referenceDate = options.referenceDate ?? new Date();
  const sourceThread = options.sourceThread;
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  /** @type {{ text: string; receivedAt: Date; messageId: string; sourceThread?: string }[]} */
  const messages = [];
  /** @type {string[]} */
  let currentBlock = [];
  /** @type {Date | null} */
  let currentTimestamp = null;
  const context = { month: referenceDate.getMonth() + 1, day: referenceDate.getDate(), year: referenceDate.getFullYear() };

  const flushBlock = () => {
    if (!currentTimestamp || currentBlock.length === 0) return;

    const body = currentBlock
      .filter((line) => !METADATA_LINE_RE.test(line.trim()))
      .join("\n")
      .trim();

    if (!body) {
      currentBlock = [];
      return;
    }

    const turns = splitBlockIntoTurns(body);
    turns.forEach((turn, offset) => {
      const receivedAt = new Date(currentTimestamp.getTime() + offset * 60_000);
      const messageId = crypto
        .createHash("sha256")
        .update(`${receivedAt.toISOString()}|${turn}`)
        .digest("hex")
        .slice(0, 32);
      messages.push({
        text: turn,
        receivedAt,
        messageId,
        ...(sourceThread ? { sourceThread } : {})
      });
    });

    currentBlock = [];
  };

  for (const line of lines) {
    const ts = parseTimestampLine(line, context, referenceDate);
    if (ts) {
      flushBlock();
      currentTimestamp = ts;
      continue;
    }
    if (currentTimestamp) {
      currentBlock.push(line);
    }
  }

  flushBlock();
  return messages;
}

/**
 * @param {{ text: string; receivedAt: Date; messageId: string; sourceThread?: string }[]} batches
 * @returns {{ text: string; receivedAt: Date; messageId: string; sourceThread?: string }[]}
 */
export function mergeAndSortMessages(batches) {
  return [...batches].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
}

export { DEFAULT_TIMEZONE };
