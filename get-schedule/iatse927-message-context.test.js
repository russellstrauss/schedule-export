import { describe, it, expect } from "vitest";
import {
  classifyMessageKind,
  extractSchedulingHints,
  inferExpectedCalendarEvents,
  enrichMessagesForGemini,
  buildGeminiContextPayload,
  expandEntriesForUnparsedDates,
  shiftsFromScheduleText
} from "./iatse927-message-context.js";
import {
  SAMPLE_CONFIRMATION_SMS,
  SAMPLE_REMINDER_SMS
} from "./sources/iatse927-fixtures.js";

describe("classifyMessageKind", () => {
  it("classifies steward and member messages", () => {
    expect(classifyMessageKind("Are you available 6/3 for Charlie Puth")).toBe("availability_ask");
    expect(classifyMessageKind("Confirmed 6/3 Chastain 10:30AM and 10PM. Thank you")).toBe(
      "confirmation"
    );
    expect(classifyMessageKind("I'm available")).toBe("acceptance");
    expect(classifyMessageKind("Load in filled already. Load out available")).toBe("negotiation");
    expect(classifyMessageKind(SAMPLE_REMINDER_SMS)).toBe("reminder");
  });
});

describe("inferExpectedCalendarEvents", () => {
  it("expects two events for dual-time confirmation", () => {
    const hints = extractSchedulingHints(SAMPLE_CONFIRMATION_SMS, new Date("2026-06-01"));
    const expected = inferExpectedCalendarEvents(SAMPLE_CONFIRMATION_SMS, hints, []);
    expect(expected?.count).toBe(2);
    expect(expected?.types).toEqual(["Load In", "Load Out"]);
  });

  it("expects one load-out after negotiation context", () => {
    const text = "Confirmed 5/15 Ameris 9PM. Thank you";
    const hints = extractSchedulingHints(text, new Date("2026-05-15"));
    const preceding = [
      "[12] (negotiation) Load in filled already. Load out available",
      "[15] (acceptance) Ill actually take the load out by itself if you still have it"
    ];
    const expected = inferExpectedCalendarEvents(text, hints, preceding);
    expect(expected?.count).toBe(1);
    expect(expected?.types).toEqual(["Load Out"]);
  });

  it("treats reminder text as confirmation evidence for a reminder-only shift", () => {
    const text = "This is your reminder for 7/16 FIFA at 9:00 AM. Please be there.";
    const hints = extractSchedulingHints(text, new Date("2026-07-16"));
    const expected = inferExpectedCalendarEvents(text, hints, []);
    expect(expected?.count).toBe(1);
    expect(expected?.types).toEqual(["Call"]);
  });

  it("expects two events for reminder with both load in and load out", () => {
    const text = "This is your reminder for 5/29-MGK at Lakewood Amphitheatre for a 10AM load in and 10:30PM load out. Please be on time.";
    const hints = extractSchedulingHints(text, new Date("2026-05-29"));
    const expected = inferExpectedCalendarEvents(text, hints, []);
    expect(expected?.count).toBe(2);
    expect(expected?.types).toEqual(["Load In", "Load Out"]);
    expect(expected?.callTimes24h).toEqual(["10:00", "22:30"]);
  });

  it("expects one load in event for 'load in only' reminder", () => {
    const text = "This is your reminder for 6/5 Concert at Venue for Load In only at 10AM. Please confirm.";
    const hints = extractSchedulingHints(text, new Date("2026-06-05"));
    const expected = inferExpectedCalendarEvents(text, hints, []);
    expect(expected?.count).toBe(1);
    expect(expected?.types).toEqual(["Load In"]);
    expect(expected?.callTimes24h).toEqual(["10:00"]);
  });

  it("expects null count for availability-only asks", () => {
    const text = "Are you available 6/3 for Charlie Puth at Chastain for a 10:30AM and 10PM Load Pit";
    const hints = extractSchedulingHints(text, new Date("2026-06-01"));
    const expected = inferExpectedCalendarEvents(text, hints, []);
    expect(expected?.count).toBeNull();
  });
});

describe("December 6 and 28", () => {
  const receivedAt = new Date("2026-11-27T15:00:00Z");

  it("treats Dec 6 and 28 as two confirmed calls", () => {
    const text = "Confirmed Dec 6 and 28 State Farm 8AM. Thank you";
    const hints = extractSchedulingHints(text, receivedAt);
    expect(hints.dates).toEqual(["12/6/2026", "12/28/2026"]);
    expect(hints.times24h).toEqual(["08:00"]);
    expect(inferExpectedCalendarEvents(text, hints, [])?.count).toBe(2);

    const shifts = shiftsFromScheduleText(text, receivedAt);
    expect(shifts.map((shift) => shift.date)).toEqual(["12/6/2026", "12/28/2026"]);
    expect(shifts.every((shift) => shift.callTime === "08:00")).toBe(true);
  });

  it("adds both days when Gemini omitted them", () => {
    const text = "Confirmed Dec 6 and 28 State Farm 8AM. Thank you";
    const entries = expandEntriesForUnparsedDates([], [{ text, receivedAt }]);
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.date)).toEqual(["12/6/2026", "12/28/2026"]);
    expect(entries[0]).toMatchObject({
      show: "State Farm",
      venue: "State Farm",
      callTime: "08:00",
      status: "confirmed"
    });
  });

  it("adds only the day Gemini missed", () => {
    const text = "Confirmed December 6 and 28 State Farm 8AM. Thank you";
    const entries = expandEntriesForUnparsedDates(
      [
        {
          source: "iatse927",
          date: "12/6/2026",
          callTime: "08:00",
          show: "State Farm",
          venue: "State Farm",
          location: "",
          position: "",
          type: "Call",
          status: "confirmed"
        }
      ],
      [{ text, receivedAt }]
    );
    expect(entries.map((entry) => entry.date)).toEqual(["12/6/2026", "12/28/2026"]);
  });

  it("reads a reminder whose time comes before a month-name date", () => {
    const text =
      "Reminder for tomorrow morning 8am Wednesday Sept 2 at Sandy Springs theater for Les Mis load in. Please confirm";
    const ref = new Date("2026-09-01T20:00:00Z");
    const shifts = shiftsFromScheduleText(text, ref);
    expect(shifts).toEqual([
      expect.objectContaining({ date: "9/2/2026", callTime: "08:00", type: "Load In" })
    ]);
    const entries = expandEntriesForUnparsedDates([], [{ text, receivedAt: ref }]);
    expect(entries[0]).toMatchObject({
      date: "9/2/2026",
      callTime: "08:00",
      show: "Les Mis",
      venue: "Sandy Springs theater",
      type: "Load In"
    });
  });

  it("does not add a reminder's extra call when the confirmation already names that date", () => {
    const confirmation = "Confirmed 9/19 Ameris 11AM. Thank you";
    const reminder =
      "This is your reminder for 9/19-Need To Breathe-at Ameris for a 11AM Load-In and 10PM Load-Out. Please confirm.";
    const receivedAt = new Date("2026-09-16T15:00:00Z");
    const entries = expandEntriesForUnparsedDates(
      [],
      [
        { text: confirmation, receivedAt },
        { text: reminder, receivedAt: new Date("2026-09-18T22:00:00Z") }
      ]
    );
    expect(entries).toEqual([
      expect.objectContaining({ date: "9/19/2026", callTime: "11:00", show: "Ameris" })
    ]);
  });

  it("pairs each date with the time that follows it", () => {
    const text = "Confirmed Lakewood 8/22 8AM and 8/23 6PM. Thank you";
    const shifts = shiftsFromScheduleText(text, new Date("2026-08-20T16:00:00Z"));
    expect(shifts).toEqual([
      expect.objectContaining({ date: "8/22/2026", callTime: "08:00" }),
      expect.objectContaining({ date: "8/23/2026", callTime: "18:00" })
    ]);
  });
});

describe("buildGeminiContextPayload", () => {
  it("includes domain guide and enriched messages", () => {
    const payload = buildGeminiContextPayload([
      { text: SAMPLE_CONFIRMATION_SMS, receivedAt: new Date("2026-06-01") },
      { text: SAMPLE_REMINDER_SMS, receivedAt: new Date("2026-06-02") }
    ]);

    expect(payload.today).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/);
    expect(payload.domainGuide).toBeDefined();
    expect(payload.messages).toHaveLength(2);
    expect(payload.messages[0].messageKind).toBe("confirmation");
    expect(payload.messages[0].expectedCalendarEvents?.count).toBe(2);
    expect(payload.messages[1].messageKind).toBe("reminder");
    expect(payload.messages[1].precedingContext).toHaveLength(1);
  });

  it("builds preceding context chain", () => {
    const enriched = enrichMessagesForGemini([
      { text: "Are you available 6/3?", receivedAt: new Date("2026-06-01") },
      { text: "I'm available", receivedAt: new Date("2026-06-01T01:00:00Z") },
      { text: SAMPLE_CONFIRMATION_SMS, receivedAt: new Date("2026-06-01T02:00:00Z") }
    ]);

    expect(enriched[2].precedingContext).toHaveLength(2);
    expect(enriched[2].precedingContext[0]).toContain("availability_ask");
  });
});
