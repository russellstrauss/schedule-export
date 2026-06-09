import { describe, it, expect } from "vitest";
import {
  buildIatse927EventDescription,
  parseSupplementalFields,
  resolveIatse927EventLocation
} from "./iatse927-event-description.js";
import { toGoogleEvent } from "./utils.js";

describe("resolveIatse927EventLocation", () => {
  it("uses street address when location is provided", () => {
    expect(
      resolveIatse927EventLocation({
        venue: "Chastain Amphitheater",
        location: "4469 Stella Dr Atlanta Georgia 30342"
      })
    ).toBe("4469 Stella Dr Atlanta Georgia 30342");
  });

  it("falls back to venue when no address is provided", () => {
    expect(
      resolveIatse927EventLocation({
        venue: "Chastain Amphitheater",
        location: ""
      })
    ).toBe("Chastain Amphitheater");
  });
});

describe("buildIatse927EventDescription", () => {
  it("formats load-in with line breaks and Load In Address label", () => {
    const description = buildIatse927EventDescription({
      show: "Charlie Puth",
      type: "Load In",
      callTime: "10:30",
      venue: "Chastain Amphitheater",
      location: "4469 Stella Dr Atlanta Georgia 30342",
      details: "Parking: first come first serve\nSteward: Shawn Grable (470-457-859)",
      notes: ""
    });

    expect(description).toBe(
      [
        "Show: Charlie Puth",
        "Call: Load In at 10:30 AM",
        "Venue: Chastain Amphitheater",
        "Load In Address: 4469 Stella Dr Atlanta Georgia 30342",
        "Parking: first come first serve",
        "Steward: Shawn Grable (470-457-859)"
      ].join("\n")
    );
  });

  it("uses Load Out Address and shared Venue for load-out entry", () => {
    const description = buildIatse927EventDescription({
      show: "Charlie Puth",
      type: "Load Out",
      callTime: "22:00",
      venue: "Chastain Amphitheater",
      location: "4469 Stella Dr Atlanta Georgia 30342",
      details: "Parking: first come first serve"
    });

    expect(description).toContain("Call: Load Out at 10 PM");
    expect(description).toContain("Venue: Chastain Amphitheater");
    expect(description).toContain("Load Out Address: 4469 Stella Dr");
    expect(description).not.toContain("Load In Address");
  });

  it("does not duplicate notes when details and notes repeat the same content", () => {
    const shared =
      "Parking: first come first serve\nSteward: Shawn Grable\nNotes: Please be on time";
    const description = buildIatse927EventDescription({
      show: "Charlie Puth",
      type: "Load In",
      callTime: "10:30",
      venue: "Chastain Amphitheater",
      location: "4469 Stella Dr",
      details: shared,
      notes: shared
    });

    const notesCount = (description.match(/^Notes:/gm) || []).length;
    expect(notesCount).toBe(1);
    expect(description).toContain("Notes: Please be on time");
  });
});

describe("parseSupplementalFields", () => {
  it("ignores notes field when it duplicates details body", () => {
    const details = "Parking: lot A\nNotes: Be on time";
    const notes = "Parking: lot A\nNotes: Be on time";
    expect(parseSupplementalFields(details, notes)).toEqual({
      parking: "lot A",
      steward: undefined,
      notes: "Be on time"
    });
  });
});

describe("toGoogleEvent iatse927", () => {
  it("uses address as calendar location when provided", () => {
    const result = toGoogleEvent(
      {
        date: "6/3/2026",
        callTime: "10:30",
        show: "Charlie Puth",
        venue: "Chastain Amphitheater",
        location: "4469 Stella Dr",
        type: "Load In",
        status: "confirmed"
      },
      { source: "iatse927" }
    );

    expect(result.location).toBe("4469 Stella Dr");
    expect(result.location).not.toContain("Chastain");
  });

  it("uses venue as calendar location when address is missing", () => {
    const result = toGoogleEvent(
      {
        date: "6/3/2026",
        callTime: "10:30",
        show: "Charlie Puth",
        venue: "Chastain Amphitheater",
        location: "",
        type: "Load In",
        status: "confirmed"
      },
      { source: "iatse927" }
    );

    expect(result.location).toBe("Chastain Amphitheater");
  });

  it("includes original message after structured body", () => {
    const result = toGoogleEvent(
      {
        date: "6/3/2026",
        callTime: "10:30",
        show: "Charlie Puth",
        venue: "Chastain Amphitheater",
        location: "4469 Stella Dr",
        type: "Load In",
        status: "confirmed",
        sourceText: "This is your reminder..."
      },
      { source: "iatse927" }
    );

    expect(result.description).toMatch(/Show: Charlie Puth\nCall: Load In/);
    expect(result.description).toContain("\n\nOriginal message:\nThis is your reminder...");
  });
});
