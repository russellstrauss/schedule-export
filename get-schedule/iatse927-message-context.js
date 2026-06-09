import { DEFAULT_TIMEZONE } from "./sources/types.js";
import { parseIatseTimeToken } from "./iatse927-call-expander.js";
import { inferYearForMonthDay } from "./iatse927-thread-parser.js";

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

const DATE_MD_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/g;
const TIME_TOKEN_RE = /(\d{1,2}(?::\d{2})?\s*(?:AM|PM))/gi;

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
export function extractSchedulingHints(text, referenceDate = new Date()) {
  /** @type {string[]} */
  const dates = [];
  /** @type {string[]} */
  const times24 = [];

  for (const match of text.matchAll(DATE_MD_RE)) {
    const month = parseInt(match[1], 10);
    const day = parseInt(match[2], 10);
    const year = match[3] ? parseInt(match[3], 10) : inferYearForMonthDay(month, day, referenceDate);
    dates.push(`${month}/${day}/${year}`);
  }

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
export function buildGeminiContextPayload(messages) {
  return {
    timezone: DEFAULT_TIMEZONE,
    domainGuide: DOMAIN_GUIDE,
    messages: enrichMessagesForGemini(messages)
  };
}
