import { formatDateTimeForTimezone, isEventInFuture } from "../schedule-time.js";

export const sourceId = "crewOne";

const DEFAULT_LOGIN_URL = "https://portal.crew1.com/";

/** @returns {string[]} */
export function missingCredentialEnvVars() {
  const missing = [];
  if (!process.env.CREWONE_EMAIL) missing.push("CREWONE_EMAIL");
  if (!process.env.CREWONE_PASSWORD) missing.push("CREWONE_PASSWORD");
  return missing;
}

export function getCredentials() {
  const missing = missingCredentialEnvVars();
  if (missing.length > 0) return null;
  const loginUrl = process.env.CREWONE_LOGIN_URL || DEFAULT_LOGIN_URL;
  return {
    email: process.env.CREWONE_EMAIL,
    password: process.env.CREWONE_PASSWORD,
    loginUrl
  };
}

/** Crew One dashboard: "Fri Jun 12 8:00 AM" (after normalizeCrew1DateTimeText) */
const CREW1_DATETIME_PATTERN =
  /^\w{3}\s+\w{3}\s+\d{1,2}\s+\d{1,2}:\d{2}\s*(AM|PM)$/i;
const CREW1_OFFER_DEADLINE_PATTERN =
  /this offer closes\s+([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i;
const CREW1_MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12
};

/** Insert space when day and time are glued (e.g. "Jun 128:00 AM"), not "Jun 12 10:30 PM". */
export function normalizeCrew1DateTimeText(dateTimeText) {
  if (!dateTimeText) return "";
  return dateTimeText
    .trim()
    .replace(/\s+/g, " ")
    .replace(/,\s*\d{4}\b/, "")
    .replace(/(\w{3}\s+\d{1,2})(\d{1,2}:\d{2}\s*(?:AM|PM))/i, "$1 $2");
}

export function parseCrew1DateTime(dateTimeText, referenceYear = new Date().getFullYear()) {
  const text = normalizeCrew1DateTimeText(dateTimeText);
  if (!text || !CREW1_DATETIME_PATTERN.test(text)) return null;

  const parsed = Date.parse(`${text} ${referenceYear}`);
  if (Number.isNaN(parsed)) return null;

  const d = new Date(parsed);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const year = d.getFullYear();
  const hours = d.getHours();
  const minutes = d.getMinutes();

  return {
    date: `${month}/${day}/${year}`,
    callTime: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
  };
}

export function parseCrewOneOfferDeadline(text) {
  if (!text) return null;
  const match = text.match(CREW1_OFFER_DEADLINE_PATTERN);
  if (!match) return null;

  const [, monthName, dayText, yearText, hoursText, minutesText, ampm] = match;
  const month = CREW1_MONTHS[monthName.toLowerCase()];
  if (month == null) return null;

  let hours = Number(hoursText);
  const minutes = Number(minutesText);
  const normalizedAmpm = ampm?.toUpperCase();
  if (normalizedAmpm === "PM" && hours < 12) hours += 12;
  if (normalizedAmpm === "AM" && hours === 12) hours = 0;

  return {
    month,
    day: Number(dayText),
    year: Number(yearText),
    hours,
    minutes,
    text: text.trim()
  };
}

export function parseCrewOneOfferState(text) {
  const normalized = (text || "").toLowerCase();

  // Require past-tense "accepted" so copy like "we will accept your response" stays pending.
  if (
    /\baccepted\b/.test(normalized) &&
    !/accept or decline|accept\/decline|please accept|to accept|will accept/i.test(normalized)
  ) {
    return "accepted";
  }

  if (
    (/\bdenied\b|\bdeclined\b/.test(normalized)) &&
    !/accept or decline|accept\/decline|please decline|to decline|accepting\/declining/i.test(normalized)
  ) {
    return "declined";
  }

  return "pending";
}

/** Dashboard action cells that must never be treated as a date/time. */
export function isCrewOneActionCell(text) {
  return /^(respond|info|view details)$/i.test(String(text || "").trim());
}

/**
 * Map Crew One dashboard table cells using headers when available.
 * Upcoming: Event | Where | Date/Time | info
 * Offers: Event | Task/Job | Respond
 * @param {string[]} cellTexts
 * @param {string[]} headerTexts
 * @param {string | null} detailUrl
 */
export function mapCrewOneDashboardRow(cellTexts, headerTexts = [], detailUrl = null) {
  const cells = cellTexts.map((c) => String(c || "").trim());
  const headers = headerTexts.map((h) => String(h || "").trim().toLowerCase());
  const col = (re) => headers.findIndex((h) => re.test(h));

  const eventIdx = col(/^event$/) >= 0 ? col(/^event$/) : 0;
  const whereIdx = col(/^where$/);
  const jobIdx = col(/task\/?job|^job$|^position$/);
  const dateIdx = col(/date\/?time|^date$/);

  const looksLikeDateTime = (t) => {
    const norm = String(t || "").replace(/\s+/g, " ");
    return (
      /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(norm) &&
      /\d{1,2}:\d{2}\s*(AM|PM)/i.test(norm)
    );
  };

  let dateTime = dateIdx >= 0 ? cells[dateIdx] || "" : "";
  if (!dateTime) {
    dateTime = cells.find((t) => looksLikeDateTime(t)) || "";
  }
  if (isCrewOneActionCell(dateTime)) dateTime = "";

  const event = cells[eventIdx] || cells[0] || "";
  let where = whereIdx >= 0 ? cells[whereIdx] || "" : "";
  let position = jobIdx >= 0 ? cells[jobIdx] || "" : "";

  // Offers layout fallback when headers are missing: Event | Task/Job | Respond
  if (!position && !dateTime && cells.length >= 3 && isCrewOneActionCell(cells[cells.length - 1])) {
    position = cells[1] || "";
    where = whereIdx >= 0 ? where : "";
  }

  return {
    event,
    where,
    position,
    dateTime,
    detailUrl: detailUrl || null
  };
}

export function isCrewOneOfferUnconfirmed(entry) {
  return String(entry?.offerState || "").toLowerCase() === "pending";
}

export function isCrewOneOfferDeclined(entry) {
  const state = String(entry?.offerState || "").toLowerCase();
  return state === "declined" || state === "denied";
}

export function buildCrewOneDeadlineReminderEvent(entry, deadline = parseCrewOneOfferDeadline(entry?.offerDeadlineText)) {
  if (!entry || !deadline) return null;
  const offerState = String(entry.offerState || "pending").toLowerCase();
  if (!isCrewOneOfferUnconfirmed({ offerState })) {
    return null;
  }

  const { year, month, day, hours, minutes } = deadline;
  if (!isEventInFuture(year, month, day, hours, minutes, "America/New_York")) {
    return null;
  }

  // Identity is the offer deadline itself (not a call row), so multi-call offers
  // produce one reminder and sync/purge never collide with call events.
  const deadlineDate = `${month}/${day}/${year}`;
  const deadlineTime = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  const rowId = [
    deadlineDate,
    deadlineTime,
    entry.show || "",
    entry.venue || ""
  ].join(" | ") + "|deadlineReminder";

  const location = [entry.venue, entry.location].filter(Boolean).join(" - ");
  const start = formatDateTimeForTimezone(year, month, day, hours, minutes);
  const end = formatDateTimeForTimezone(year, month, day, hours, minutes + 30);

  return {
    source: sourceId,
    kind: "deadlineReminder",
    rowId,
    summary: `Offer deadline: ${entry.show}`,
    location,
    description: [`Deadline reminder for ${entry.show}`, "", deadline.text].join("\n"),
    start,
    end,
    status: "confirmed",
    reminders: {
      useDefault: false,
      overrides: [{ method: "popup", minutes: 0 }]
    }
  };
}
