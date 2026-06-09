import { describe, it, expect } from "vitest";
import {
  parseIatseTimeToken,
  extractDualTimeConfirmations,
  expandDualTimeCallEntries
} from "./iatse927-call-expander.js";
import {
  SAMPLE_CONFIRMATION_SMS,
  SAMPLE_REMINDER_SMS
} from "./sources/iatse927-fixtures.js";

describe("parseIatseTimeToken", () => {
  it("parses AM/PM times", () => {
    expect(parseIatseTimeToken("10:30AM")).toBe("10:30");
    expect(parseIatseTimeToken("10PM")).toBe("22:00");
    expect(parseIatseTimeToken("9AM")).toBe("09:00");
  });
});

describe("extractDualTimeConfirmations", () => {
  it("finds dual-time confirmations", () => {
    const confirms = extractDualTimeConfirmations([
      { text: SAMPLE_CONFIRMATION_SMS, receivedAt: new Date("2026-06-01") }
    ]);
    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toMatchObject({
      date: "6/3/2026",
      venueKeyword: "Chastain",
      loadIn: "10:30",
      loadOut: "22:00"
    });
  });

  it("ignores single-time confirmations", () => {
    const confirms = extractDualTimeConfirmations([
      { text: "Confirmed 5/15 Ameris 9PM. Thank you", receivedAt: new Date("2026-05-15") }
    ]);
    expect(confirms).toHaveLength(0);
  });
});

describe("expandDualTimeCallEntries", () => {
  it("adds load-out when only load-in was extracted", () => {
    const entries = expandDualTimeCallEntries(
      [
        {
          source: "iatse927",
          date: "6/3/2026",
          callTime: "10:30",
          show: "Charlie Puth",
          venue: "Chastain Amphitheater",
          location: "",
          position: "",
          type: "Call",
          status: "confirmed",
          evidenceIndices: [0]
        }
      ],
      [
        { text: SAMPLE_CONFIRMATION_SMS, receivedAt: new Date("2026-06-01") },
        { text: SAMPLE_REMINDER_SMS, receivedAt: new Date("2026-06-02") }
      ]
    );

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => `${e.type}@${e.callTime}`).sort()).toEqual([
      "Load In@10:30",
      "Load Out@22:00"
    ]);
  });
});
