import { DEFAULT_TIMEZONE } from "./sources/types.js";
import { sourceId } from "./sources/iatse927.js";
import { parseIatseTimeToken } from "./iatse927-call-expander.js";
import { extractScheduleDateSpans } from "./iatse927-thread-parser.js";

/** @typedef {"steward" | "member" | "unknown"} MessageSpeaker */

/** @typedef {"availability_ask" | "acceptance" | "negotiation" | "confirmation" | "reminder" | "decline" | "quick_call_ask" | "correction" | "ack" | "other"} MessageKind */

export const DOMAIN_GUIDE = {
  eventModel:
    "Each calendar event is ONE crew call time (when you must be on site). A text that confirms both load-in and load-out on the same day is TWO events, not one.",
  dualCallSameDay: {
    availability:
      "Are you available 6/3 for Charlie Puth at Chastain for a 10:30AM and 10PM Load Pit → if confirmed, TWO events (Load In + Load Out).",
    confirmation:
      "Confirmed 6/3 Chastain 10:30AM and 10PM → TWO events on 6/3: Load In 10:30, Load Out 22:00.",
    reminder:
      "Reminder for 6/3 ... 10:30AM load-In and 10PM load out → supports TWO events once confirmed; merge address/steward onto both."
  },
  singleCallOnly: {
    negotiation:
      "Load in filled already. Load out available ... Confirmed 5/15 Ameris 9PM → ONE event only (Load Out at 21:00). Prior load-in offer was not confirmed.",
    loadInOnly:
      "10AM load in only filled already → do not create a load-in event if only load-out was confirmed."
  },
  splitCallAcrossDates: {
    example:
      "split call on 5/8 ... Load In at 10:30AM and 5/9 ... Load Out at 10:30PM → TWO events on DIFFERENT dates if both confirmed."
  },
  quickCall: {
    example:
      "quick call tonight at Chastain at 9:30 ... Confirmed → ONE Call event at 9:30PM (not load-in/out pair)."
  },
  correction: {
    example:
      "Already on 10am load in and load out ... Confirmed. My mistake → keep existing 10AM+10PM pair; ignore mistaken 12PM availability offer."
  },
  doNotSync: [
    "Availability asks without later confirmation",
    "Declines: already staffed, filled already, already working",
    "Superseded offers after a correction",
    "Standalone 'Confirmed' replying to a reminder (no new shift)"
  ]
};

const TIME_TOKEN_RE = /(\d{1,2}(?::\d{2})?\s*(?:AM|PM)\b)/gi;

/**
 * @param {string} text
 * @returns {MessageSpeaker}
 */
export function inferSpeaker(text) {
  const trimmed = text.trim();
  if (
    /^(Are you available|Confirmed|This is your reminder|This is Shawn|Load in|Load out|There's early load|Hey just had|10AM load in only|Filled already)/i.test(
      trimmed
    )
  ) {
    return "steward";
  }
  if (
    /^(I am available|I'm available|Yes!|Ok |Okay |Already working|Ill actually|I'll take|Alright I can|Will I get|Absolutely)/i.test(
      trimmed
    )
  ) {
    return "member";
  }
  return "unknown";
}

/**
 * @param {string} text
 * @returns {MessageKind}
 */
export function classifyMessageKind(text) {
  const trimmed = text.trim();
  if (/^Confirmed\.?\s*My mistake/i.test(trimmed)) return "correction";
  if (/^Confirmed/i.test(trimmed)) return "confirmation";
  if (/^This is your reminder/i.test(trimmed)) return "reminder";
  if (/reminder/i.test(trimmed) && /\b(please be there|confirm|you will be there|you are scheduled|your shift|your call|your reminder)\b/i.test(trimmed)) {
    return "reminder";
  }
  if (/quick call/i.test(trimmed)) return "quick_call_ask";
  if (/^Are you available/i.test(trimmed)) return "availability_ask";
  if (/load in filled|load out available|load in only|load out by itself|early load available/i.test(trimmed)) {
    return "negotiation";
  }
  if (/filled already|already staffed|already working|turned down/i.test(trimmed)) return "decline";
  if (/^(I am available|I'm available|Yes!|I'll take it|Ill actually|Alright I can come out)/i.test(trimmed)) {
    return "acceptance";
  }
  if (/^(Copy\.|Thank you|Ok no problem|Okay great|Excellent|Will do|Will I get)/i.test(trimmed)) return "ack";
  return "other";
}

/**
 * @param {string} text
 * @param {Date} referenceDate
 */
/**
 * @param {string} text
 * @param {Date} referenceDate
 * @returns {string[]}
 */
function extractScheduleDatesFromText(text, referenceDate) {
  return extractScheduleDateSpans(text, referenceDate).map((span) => span.date);
}

export function extractSchedulingHints(text, referenceDate = new Date()) {
  /** @type {string[]} */
  const dates = extractScheduleDatesFromText(text, referenceDate);
  /** @type {string[]} */
  const times24 = [];

  for (const match of text.matchAll(TIME_TOKEN_RE)) {
    const parsed = parseIatseTimeToken(match[1]);
    if (parsed) times24.push(parsed);
  }

  const uniqueDates = [...new Set(dates)];
  const uniqueTimes = [...new Set(times24)].sort();

  return {
    dates: uniqueDates,
    times24h: uniqueTimes,
    mentionsLoadIn: /load\s*[- ]?in/i.test(text),
    mentionsLoadOut: /load\s*[- ]?out/i.test(text),
    mentionsQuickCall: /quick call/i.test(text),
    mentionsSplitCall: /split call/i.test(text),
    mentionsLoadInOnly: /load\s*[- ]?in\s+only/i.test(text),
    mentionsLoadOutOnly: /load\s*out\s+by\s+itself/i.test(text),
    mentionsCapacityLimit: /filled already|already staffed|already working/i.test(text),
    isConfirmation: /^Confirmed/i.test(text.trim()),
    isCorrection: /^Confirmed\.?\s*My mistake/i.test(text.trim())
  };
}

/**
 * @param {string} text
 * @param {ReturnType<typeof extractSchedulingHints>} hints
 * @param {string[]} [precedingContext]
 */
export function inferExpectedCalendarEvents(text, hints, precedingContext = []) {
  if (hints.isCorrection) {
    return {
      count: null,
      note: "Correction message — reconcile against earlier confirmations; drop superseded offers."
    };
  }

  if (hints.mentionsQuickCall && hints.times24h.length === 1) {
    return {
      count: 1,
      types: ["Call"],
      note: "Single quick-call time."
    };
  }

  if (classifyMessageKind(text) === "reminder" && hints.dates.length > 1) {
    return {
      count: hints.dates.length,
      note: "Reminder names more than one date (for example Dec 6 and 28)."
    };
  }

  if (classifyMessageKind(text) === "reminder") {
    const reminderTimeMatches = [...text.matchAll(TIME_TOKEN_RE)].map((m) => m[1]);
    const parsed = reminderTimeMatches.map(parseIatseTimeToken).filter(Boolean);

    if (parsed.length >= 2 && hints.mentionsLoadIn && hints.mentionsLoadOut) {
      const sorted = [...parsed].sort();
      return {
        count: 2,
        types: ["Load In", "Load Out"],
        callTimes24h: [sorted[0], sorted[sorted.length - 1]],
        note: "Reminder mentions both load in and load out with two times → two crew calls."
      };
    }
    if (parsed.length === 1 && hints.mentionsLoadInOnly) {
      return {
        count: 1,
        types: ["Load In"],
        callTimes24h: parsed,
        note: "Reminder text for load in only → one Load In event."
      };
    }
    if (parsed.length >= 1) {
      return {
        count: 1,
        types: ["Call"],
        callTimes24h: parsed,
        note: "Reminder text provides confirmation evidence for a shift."
      };
    }
  }

  if (hints.isConfirmation && hints.dates.length > 1) {
    return {
      count: hints.dates.length,
      types: hints.dates.map(() => "Call"),
      note: "Confirmation names more than one date (for example Dec 6 and 28)."
    };
  }

  const confirmMatch = text.match(/^Confirmed\s+(\d{1,2}\/\d{1,2})\s+\S+\s+(.+?)(?:\.|Thank|$)/i);
  if (confirmMatch) {
    const timesPart = confirmMatch[2];
    const tokens = [...timesPart.matchAll(TIME_TOKEN_RE)].map((m) => m[1]);
    const parsed = tokens.map(parseIatseTimeToken).filter(Boolean);
    if (parsed.length >= 2) {
      const sorted = [...parsed].sort();
      return {
        count: 2,
        types: ["Load In", "Load Out"],
        callTimes24h: [sorted[0], sorted[sorted.length - 1]],
        note: "Confirmation lists two times on one date → two crew calls."
      };
    }
    if (parsed.length === 1) {
      const contextText = precedingContext.join(" ");
      let type = "Call";
      if (/load out by itself|take the load out|load out available/i.test(contextText) && /load in filled/i.test(contextText)) {
        type = "Load Out";
      } else if (hints.mentionsLoadOut && !hints.mentionsLoadIn) {
        type = "Load Out";
      } else if (hints.mentionsLoadIn && !hints.mentionsLoadOut) {
        type = "Load In";
      } else if (/load in only/i.test(contextText)) {
        type = "Load In";
      }
      return {
        count: 1,
        types: [type],
        callTimes24h: parsed,
        note: `Confirmation lists one time → one ${type} crew call (use precedingContext for load-in vs load-out).`
      };
    }
  }

  if (
    (hints.mentionsLoadIn && hints.mentionsLoadOut && hints.times24h.length >= 2) ||
    (text.includes("load-In") && text.includes("load out"))
  ) {
    const sorted = [...hints.times24h].sort();
    return {
      count: 2,
      types: ["Load In", "Load Out"],
      callTimes24h: [sorted[0], sorted[sorted.length - 1]],
      note: "Message describes both load-in and load-out — expect two events once confirmed."
    };
  }

  if (hints.mentionsSplitCall && hints.dates.length >= 2 && hints.times24h.length >= 2) {
    return {
      count: 2,
      types: ["Load In", "Load Out"],
      note: "Split call across two dates — two events on different days if confirmed."
    };
  }

  if (hints.mentionsCapacityLimit || classifyMessageKind(text) === "decline") {
    return {
      count: 0,
      note: "Decline or capacity message — not a confirmed shift."
    };
  }

  if (classifyMessageKind(text) === "availability_ask" && !hints.isConfirmation) {
    return {
      count: null,
      note: "Availability ask only — wait for confirmation in later messages."
    };
  }

  return null;
}

/**
 * @param {{ text: string; receivedAt?: Date | null; sourceThread?: string }[]} messages
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
 * @param {{ text: string; receivedAt?: Date | null; sourceThread?: string }[]} messages
 * @param {number} index
 */
function buildThreadContext(messages, index) {
  const start = Math.max(0, index - 4);
  return messages.slice(start, index).map((msg, offset) => {
    const idx = start + offset;
    const kind = classifyMessageKind(msg.text);
    const snippet = msg.text.replace(/\s+/g, " ").trim().slice(0, 140);
    return `[${idx}] (${kind}) ${snippet}`;
  });
}

/**
 * @param {{ text: string; receivedAt?: Date | null; sourceThread?: string }[]} messages
 */
export function enrichMessagesForGemini(messages) {
  const referenceDate = referenceDateFromMessages(messages);

  return messages.map((message, index) => {
    const kind = classifyMessageKind(message.text);
    const speaker = inferSpeaker(message.text);
    const schedulingHints = extractSchedulingHints(message.text, referenceDate);
    const precedingContext = buildThreadContext(messages, index);
    const expectedCalendarEvents = inferExpectedCalendarEvents(
      message.text,
      schedulingHints,
      precedingContext
    );

    return {
      index,
      receivedAt: message.receivedAt?.toISOString?.() ?? null,
      sourceThread: message.sourceThread ?? null,
      text: message.text,
      speaker,
      messageKind: kind,
      schedulingHints,
      expectedCalendarEvents,
      precedingContext
    };
  });
}

/**
 * @param {{ text: string; receivedAt?: Date | null; sourceThread?: string }[]} messages
 */
/**
 * @param {Date} [referenceDate]
 * @returns {string}
 */
function todayLabel(referenceDate = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = {};
  formatter.formatToParts(referenceDate).forEach((part) => {
    if (part.type !== "literal") parts[part.type] = part.value;
  });
  return `${Number(parts.month)}/${Number(parts.day)}/${parts.year}`;
}

export function buildGeminiContextPayload(messages) {
  return {
    timezone: DEFAULT_TIMEZONE,
    today: todayLabel(),
    domainGuide: DOMAIN_GUIDE,
    messages: enrichMessagesForGemini(messages)
  };
}

/**
 * @param {string} value
 */
function cleanLabel(value) {
  return String(value || "")
    .replace(/^(?:\d{1,2}\/\d{1,2}\s+|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?|september|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}\s+)/i, "")
    .replace(/[-.,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} value
 */
function cutAtFor(value) {
  return cleanLabel(String(value || "").split(/\bfor\b/i)[0]);
}

/**
 * @param {string} text
 * @returns {{ show: string; venue: string }}
 */
export function parseShowVenue(text) {
  const dashed = text.match(/\d{1,2}\/\d{1,2}\s*-\s*([^-]+?)\s*-\s*(?:at\s+)?([^.]+)/i);
  if (dashed) {
    return { show: cleanLabel(dashed[1]), venue: cutAtFor(dashed[2]) };
  }

  const atFor = text.match(/\bat\s+(.+?)\s+for\s+(.+?)(?:\s+load\b|[.]|$)/i);
  if (atFor && !/^\d/.test(atFor[2].trim())) {
    return { venue: cutAtFor(atFor[1]), show: cleanLabel(atFor[2]) };
  }

  const forAt = text.match(/\bfor\s+(.+?)\s+at\s+(.+?)(?:\s+for\b|[.]|$)/i);
  if (forAt) {
    const show = cleanLabel(forAt[1]);
    if (show && !/^\d/.test(show)) return { show, venue: cutAtFor(forAt[2]) };
  }

  const confirmedVenueFirst = text.match(
    /^Confirmed\s+([A-Za-z][\w'&.-]*(?:\s+[A-Za-z][\w'&.-]*)*)\s+(?:\d{1,2}\/|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/i
  );
  if (confirmedVenueFirst) {
    const venue = cleanLabel(confirmedVenueFirst[1]);
    return { show: venue, venue };
  }

  const confirmedDateFirst = text.match(
    /^Confirmed\s+(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?|september|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*(?:,|&|and)\s*\d{1,2}(?:st|nd|rd|th)?)*|\d{1,2}\/\d{1,2})\s+(.+?)\s+\d{1,2}(?::\d{2})?\s*(?:AM|PM)/i
  );
  if (confirmedDateFirst) {
    const venue = cleanLabel(confirmedDateFirst[1]);
    if (venue) return { show: venue, venue };
  }

  return { show: "IATSE", venue: "" };
}

/**
 * @param {string} text
 * @returns {"Load In" | "Load Out" | "Call"}
 */
function typeForSingleCall(text) {
  const loadIn = /load\s*[- ]?in/i.test(text);
  const loadOut = /load\s*[- ]?out/i.test(text);
  if (loadOut && !loadIn) return "Load Out";
  if (loadIn && !loadOut) return "Load In";
  return "Call";
}

/**
 * Call times attached to each date in one SMS.
 * "Dec 6 and 28 ... 8AM" is one call on each day. "8/22 8AM and 8/23 6PM" pairs each date with the time that follows it.
 * @param {string} text
 * @param {Date} referenceDate
 * @returns {{ date: string; callTime: string; type: "Load In" | "Load Out" | "Call" }[]}
 */
export function shiftsFromScheduleText(text, referenceDate = new Date()) {
  /** @type {{ type: "date" | "time"; index: number; date?: string; time?: string }[]} */
  const tokens = [];
  for (const span of extractScheduleDateSpans(text, referenceDate)) {
    tokens.push({ type: "date", index: span.index, date: span.date });
  }
  for (const match of text.matchAll(TIME_TOKEN_RE)) {
    const parsed = parseIatseTimeToken(match[1]);
    if (!parsed) continue;
    tokens.push({ type: "time", index: match.index ?? 0, time: parsed });
  }
  tokens.sort((a, b) => a.index - b.index);

  /** @type {{ dates: string[]; times: string[]; pending: string[] }[]} */
  const groups = [];
  /** @type {{ dates: string[]; times: string[]; pending: string[] } | null} */
  let current = null;
  /** @type {string[]} */
  let pendingTimes = [];
  for (const token of tokens) {
    if (token.type === "time" && token.time && (!current || current.dates.length === 0)) {
      pendingTimes.push(token.time);
      continue;
    }
    if (token.type === "date" && token.date) {
      if (!current || current.times.length > 0) {
        current = { dates: [], times: [], pending: pendingTimes };
        pendingTimes = [];
        groups.push(current);
      }
      current.dates.push(token.date);
    } else if (token.type === "time" && token.time && current) {
      current.times.push(token.time);
      current.pending = [];
    }
  }

  const mentionsBoth = /load\s*[- ]?in/i.test(text) && /load\s*[- ]?out/i.test(text);
  /** @type {{ date: string; callTime: string; type: "Load In" | "Load Out" | "Call" }[]} */
  const shifts = [];

  for (const group of groups) {
    const dates = [...new Set(group.dates)];
    const times = [...new Set(group.times.length > 0 ? group.times : group.pending)];
    if (dates.length === 0 || times.length === 0) continue;

    if (dates.length > 1 && times.length > 1 && mentionsBoth) {
      const sorted = [...times].sort();
      for (const date of dates) {
        shifts.push({ date, callTime: sorted[0], type: "Load In" });
        shifts.push({ date, callTime: sorted[sorted.length - 1], type: "Load Out" });
      }
      continue;
    }

    if (dates.length === 1 && times.length >= 2) {
      const sorted = [...times].sort();
      const loadIn = sorted[0];
      const loadOut = sorted[sorted.length - 1];
      shifts.push({
        date: dates[0],
        callTime: loadIn,
        type: mentionsBoth || times.length >= 2 ? "Load In" : typeForSingleCall(text)
      });
      if (loadOut !== loadIn) {
        shifts.push({ date: dates[0], callTime: loadOut, type: "Load Out" });
      }
      continue;
    }

    if (times.length === 1 || dates.length !== times.length) {
      const callTime = [...times].sort()[0];
      for (const date of dates) {
        shifts.push({ date, callTime, type: typeForSingleCall(text) });
      }
      continue;
    }

    dates.forEach((date, index) => {
      shifts.push({ date, callTime: times[index], type: typeForSingleCall(text) });
    });
  }

  const seen = new Set();
  return shifts.filter((shift) => {
    const key = `${shift.date}|${shift.callTime}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Add confirmed or reminder-only shifts Gemini left out, including "Dec 6 and 28".
 * A reminder does not add a second call on a date a confirmation already named.
 * @param {import("./sources/types.js").ScheduleEntry[]} entries
 * @param {{ text: string; receivedAt?: Date | null }[]} messages
 * @returns {import("./sources/types.js").ScheduleEntry[]}
 */
export function expandEntriesForUnparsedDates(entries, messages) {
  const next = entries.map((entry) => ({ ...entry }));
  const representedDates = new Set(next.map((entry) => entry.date));
  const seen = new Set(next.map((entry) => `${entry.date}|${entry.callTime}`));
  /** @type {Set<string>} */
  const confirmedDates = new Set();

  messages.forEach((message) => {
    if (classifyMessageKind(message.text) !== "confirmation") return;
    const ref = message.receivedAt instanceof Date ? message.receivedAt : new Date();
    for (const span of extractScheduleDateSpans(message.text, ref)) confirmedDates.add(span.date);
  });

  messages.forEach((message, index) => {
    const kind = classifyMessageKind(message.text);
    if (kind !== "confirmation" && kind !== "reminder") return;
    const ref = message.receivedAt instanceof Date ? message.receivedAt : new Date();
    const { show, venue } = parseShowVenue(message.text);
    for (const shift of shiftsFromScheduleText(message.text, ref)) {
      if (representedDates.has(shift.date)) continue;
      if (kind === "reminder" && confirmedDates.has(shift.date)) continue;
      const key = `${shift.date}|${shift.callTime}`;
      if (seen.has(key)) continue;
      seen.add(key);
      next.push({
        source: sourceId,
        date: shift.date,
        callTime: shift.callTime,
        show: show || venue || "IATSE",
        venue: venue || "",
        location: "",
        position: "",
        type: shift.type,
        status: "confirmed",
        evidenceIndices: [index]
      });
    }
  });

  return next;
}
