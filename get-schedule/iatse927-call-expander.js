import { inferYearForMonthDay } from "./iatse927-thread-parser.js";

const CONFIRMED_LINE_RE =
  /Confirmed\s+(\d{1,2}\/\d{1,2})\s+(\S+)\s+(.+?)(?:\.|Thank|$)/i;
const TIME_TOKEN_RE = /(\d{1,2}(?::\d{2})?\s*(?:AM|PM))/gi;

/**
 * @param {string} token
 * @returns {string | null} HH:mm 24-hour
 */
export function parseIatseTimeToken(token) {
  const match = token.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const ampm = match[3].toUpperCase();

  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;

  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

/**
 * @param {string} a HH:mm
 * @param {string} b HH:mm
 */
function compareCallTime(a, b) {
  return a.localeCompare(b);
}

/**
 * @param {string} venue
 * @param {string} keyword
 */
function venueMatches(venue, keyword) {
  const v = venue.toLowerCase();
  const k = keyword.toLowerCase();
  return v.includes(k) || k.includes(v);
}

/**
 * @param {{ text: string; receivedAt?: Date | null }[]} messages
 */
function referenceDateFromMessages(messages) {
  let latest = 0;
  for (const msg of messages) {
    const t = msg.receivedAt?.getTime?.() ?? 0;
    if (t > latest) latest = t;
  }
  return latest > 0 ? new Date(latest) : new Date();
}

/**
 * @param {{ text: string; receivedAt?: Date | null }[]} messages
 * @returns {{ date: string; venueKeyword: string; loadIn: string; loadOut: string }[]}
 */
export function extractDualTimeConfirmations(messages) {
  /** @type {{ date: string; venueKeyword: string; loadIn: string; loadOut: string }[]} */
  const confirms = [];
  const referenceDate = referenceDateFromMessages(messages);

  for (const msg of messages) {
    const match = msg.text.match(CONFIRMED_LINE_RE);
    if (!match) continue;

    const [, md, venueKeyword, timesPart] = match;
    const tokens = [...timesPart.matchAll(TIME_TOKEN_RE)].map((m) => m[1]);
    if (tokens.length < 2) continue;

    const parsedTimes = tokens.map(parseIatseTimeToken).filter(Boolean);
    if (parsedTimes.length < 2) continue;

    const [month, day] = md.split("/").map(Number);
    const year = inferYearForMonthDay(month, day, referenceDate);
    const date = `${month}/${day}/${year}`;
    const sorted = [...parsedTimes].sort(compareCallTime);

    confirms.push({
      date,
      venueKeyword,
      loadIn: sorted[0],
      loadOut: sorted[sorted.length - 1]
    });
  }

  return confirms;
}

/**
 * Ensure load-in and load-out entries exist for dual-time confirmations.
 * @param {import("./sources/types.js").ScheduleEntry[]} entries
 * @param {{ text: string; receivedAt?: Date | null }[]} messages
 */
export function expandDualTimeCallEntries(entries, messages) {
  const dualConfirms = extractDualTimeConfirmations(messages);
  if (dualConfirms.length === 0) return entries;

  const expanded = entries.map((entry) => ({ ...entry }));

  for (const confirm of dualConfirms) {
    const { date, venueKeyword, loadIn, loadOut } = confirm;
    const matches = expanded.filter(
      (entry) => entry.date === date && venueMatches(entry.venue, venueKeyword)
    );
    if (matches.length === 0) continue;

    const template = matches[0];
    ensureCallEntry(expanded, template, loadIn, "Load In");
    ensureCallEntry(expanded, template, loadOut, "Load Out");
  }

  return expanded;
}

/**
 * @param {import("./sources/types.js").ScheduleEntry[]} entries
 * @param {import("./sources/types.js").ScheduleEntry} template
 * @param {string} callTime
 * @param {"Load In" | "Load Out"} type
 */
function ensureCallEntry(entries, template, callTime, type) {
  const existing = entries.find(
    (entry) =>
      entry.date === template.date &&
      entry.callTime === callTime &&
      entry.show === template.show
  );

  if (existing) {
    if (!existing.type || existing.type === "Call") {
      existing.type = type;
    }
    return;
  }

  entries.push({
    ...template,
    callTime,
    type,
    evidenceIndices: [...(template.evidenceIndices ?? [])]
  });
}
