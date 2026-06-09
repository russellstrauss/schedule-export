import { describe, it, expect } from "vitest";
import {
  SAMPLE_REMINDER_SMS,
  SAMPLE_CONFIRMATION_SMS
} from "./sources/iatse927-fixtures.js";
import {
  resolveReminderSourceText,
  enrichIatse927Entries
} from "./iatse927-entry-enrichment.js";

describe("resolveReminderSourceText", () => {
  const messages = [
    { text: SAMPLE_CONFIRMATION_SMS },
    { text: SAMPLE_REMINDER_SMS }
  ];

  const entry = {
    source: "iatse927",
    date: "6/3/2026",
    callTime: "10:30",
    show: "Charlie Puth",
    venue: "Chastain Amphitheater",
    location: "",
    position: "",
    type: "Load In",
    status: "confirmed",
    evidenceIndices: [0, 1]
  };

  it("pulls reminder text from evidenceIndices", () => {
    expect(resolveReminderSourceText(entry, messages)).toBe(SAMPLE_REMINDER_SMS);
  });

  it("falls back to matching reminder in thread when evidence lacks reminder", () => {
    expect(
      resolveReminderSourceText({ ...entry, evidenceIndices: [0] }, messages)
    ).toBe(SAMPLE_REMINDER_SMS);
  });

  it("returns undefined when no matching reminder exists", () => {
    expect(
      resolveReminderSourceText(
        { ...entry, date: "1/1/2099", show: "No Show", evidenceIndices: [0] },
        messages
      )
    ).toBeUndefined();
  });
});

describe("enrichIatse927Entries", () => {
  it("attaches sourceText on each entry", () => {
    const messages = [
      { text: SAMPLE_CONFIRMATION_SMS },
      { text: SAMPLE_REMINDER_SMS }
    ];
    const entries = enrichIatse927Entries(
      [
        {
          source: "iatse927",
          date: "6/3/2026",
          callTime: "22:00",
          show: "Charlie Puth",
          venue: "Chastain Amphitheater",
          location: "",
          position: "",
          type: "Load Out",
          status: "confirmed",
          evidenceIndices: [0, 1]
        }
      ],
      messages
    );

    expect(entries[0].sourceText).toBe(SAMPLE_REMINDER_SMS);
  });
});
