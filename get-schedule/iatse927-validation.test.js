import { describe, it, expect } from "vitest";
import {
  omitPastEventWarnings,
  validateEntryShape,
  validateEvidence
} from "./iatse927-validation.js";

const NOW = new Date("2026-10-28T07:00:00Z");

describe("validateEntryShape", () => {
  it("accepts valid entry", () => {
    const warnings = validateEntryShape({
      source: "iatse927",
      date: "6/3/2026",
      callTime: "10:30",
      show: "Charlie Puth",
      venue: "Chastain",
      location: "",
      position: "",
      type: "",
      status: "confirmed"
    });
    expect(warnings).toHaveLength(0);
  });

  it("flags invalid date and time", () => {
    const warnings = validateEntryShape({
      source: "iatse927",
      date: "bad",
      callTime: "25:99",
      show: "",
      venue: "",
      location: "",
      position: "",
      type: "",
      status: "confirmed"
    });
    expect(warnings.some((w) => w.code === "INVALID_DATE")).toBe(true);
    expect(warnings.some((w) => w.code === "INVALID_CALL_TIME")).toBe(true);
    expect(warnings.some((w) => w.code === "MISSING_SHOW")).toBe(true);
  });
});

describe("validateEvidence", () => {
  it("flags missing evidence indices", () => {
    const warnings = validateEvidence(
      [
        {
          source: "iatse927",
          date: "6/3/2026",
          callTime: "10:30",
          show: "Charlie Puth",
          venue: "",
          location: "",
          position: "",
          type: "",
          status: "confirmed"
        }
      ],
      [{ text: "hello" }]
    );
    expect(warnings.some((w) => w.code === "MISSING_EVIDENCE")).toBe(true);
  });

  it("flags out-of-range evidence index", () => {
    const warnings = validateEvidence(
      [
        {
          source: "iatse927",
          date: "6/3/2026",
          callTime: "10:30",
          show: "Charlie Puth",
          venue: "",
          location: "",
          position: "",
          type: "",
          status: "confirmed",
          evidenceIndices: [5]
        }
      ],
      [{ text: "hello" }]
    );
    expect(warnings.some((w) => w.code === "EVIDENCE_OUT_OF_RANGE")).toBe(true);
  });
});

describe("omitPastEventWarnings", () => {
  it("drops a contradiction that only mentions a past show date", () => {
    const warnings = omitPastEventWarnings(
      [
        {
          code: "CONTRADICTION",
          message:
            "Reminder message mentions both 11AM Load In and 10PM Load Out for Need To Breathe on 9/19, but only 11AM Load In was confirmed."
        }
      ],
      NOW
    );
    expect(warnings).toHaveLength(0);
  });

  it("drops a past-show warning that also mentions today or cites those messages", () => {
    const warnings = omitPastEventWarnings(
      [
        {
          code: "WEAK_EVIDENCE",
          message:
            "Reminder message 40 mentions a 10PM Load-Out for Need To Breathe on 9/19, but only the 11AM Load-In was confirmed in message 39. Checked 10/28/2026."
        },
        {
          code: "WEAK_EVIDENCE",
          message: "Reminder message 40 mentions a load-out that was not confirmed in message 39."
        },
        {
          code: "WEAK_EVIDENCE",
          date: "10/28/2026",
          message: "Unconfirmed load-out was not scheduled."
        }
      ],
      NOW,
      "America/New_York",
      [
        ...Array.from({ length: 39 }, () => ({ text: "unrelated" })),
        { text: "Confirmed 9/19 11AM load in" },
        { text: "Reminder 9/19 11AM load in and 10PM load out Need To Breathe" }
      ]
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toBe("Unconfirmed load-out was not scheduled.");
  });

  it("keeps a warning about an upcoming date and a warning with no date", () => {
    const warnings = omitPastEventWarnings(
      [
        {
          code: "CONTRADICTION",
          message: "Reminder disagrees with the confirmation for Rod Wave on 11/14/2026."
        },
        { code: "WEAK_EVIDENCE", message: "One confirmation had no show name." }
      ],
      NOW
    );
    expect(warnings.map((warning) => warning.code)).toEqual(["CONTRADICTION", "WEAK_EVIDENCE"]);
  });

  it("keeps a warning that names both a past date and an upcoming date", () => {
    const warnings = omitPastEventWarnings(
      [
        {
          code: "DUPLICATE",
          message: "9/19 Need To Breathe was repeated on 11/14."
        }
      ],
      NOW
    );
    expect(warnings).toHaveLength(1);
  });

  it("drops shape and evidence warnings for a call that already ended", () => {
    const warnings = omitPastEventWarnings(
      [
        {
          code: "MISSING_EVIDENCE",
          message: "Shift 9/19/2026 11:00 Need To Breathe has no evidence message indices",
          entry: {
            source: "iatse927",
            date: "9/19/2026",
            callTime: "11:00",
            show: "Need To Breathe",
            venue: "",
            location: "",
            position: "",
            type: "Load In",
            status: "confirmed"
          }
        },
        {
          code: "MISSING_EVIDENCE",
          message: "Shift 11/14/2026 10:30 Rod Wave has no evidence message indices",
          entry: {
            source: "iatse927",
            date: "11/14/2026",
            callTime: "22:00",
            show: "Rod Wave",
            venue: "",
            location: "",
            position: "",
            type: "Load Out",
            status: "confirmed"
          }
        }
      ],
      NOW
    );
    expect(warnings.map((warning) => warning.entry?.show)).toEqual(["Rod Wave"]);
  });
});
