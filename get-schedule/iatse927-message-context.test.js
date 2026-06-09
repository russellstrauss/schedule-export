import { describe, it, expect } from "vitest";
import {
  classifyMessageKind,
  extractSchedulingHints,
  inferExpectedCalendarEvents,
  enrichMessagesForGemini,
  buildGeminiContextPayload
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

  it("expects null count for availability-only asks", () => {
    const text = "Are you available 6/3 for Charlie Puth at Chastain for a 10:30AM and 10PM Load Pit";
    const hints = extractSchedulingHints(text, new Date("2026-06-01"));
    const expected = inferExpectedCalendarEvents(text, hints, []);
    expect(expected?.count).toBeNull();
  });
});

describe("buildGeminiContextPayload", () => {
  it("includes domain guide and enriched messages", () => {
    const payload = buildGeminiContextPayload([
      { text: SAMPLE_CONFIRMATION_SMS, receivedAt: new Date("2026-06-01") },
      { text: SAMPLE_REMINDER_SMS, receivedAt: new Date("2026-06-02") }
    ]);

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
