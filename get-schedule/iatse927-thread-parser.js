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
