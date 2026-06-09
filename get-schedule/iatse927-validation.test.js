import { describe, it, expect } from "vitest";
import { validateEntryShape, validateEvidence } from "./iatse927-validation.js";

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
