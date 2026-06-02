import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getCredentials,
  parseCrew1DateTime,
  normalizeCrew1DateTimeText,
  matchDetailCall,
  formatCrewOneEventDescription
} from "./crewOne.js";

describe("crewOne", () => {
  const keys = ["CREWONE_EMAIL", "CREWONE_PASSWORD", "CREWONE_LOGIN_URL"];
  const saved = {};

  beforeEach(() => {
    for (const key of keys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("getCredentials returns null when email/password missing", () => {
    expect(getCredentials()).toBeNull();
  });

  it("getCredentials returns config when email and password set", () => {
    process.env.CREWONE_EMAIL = "a@b.com";
    process.env.CREWONE_PASSWORD = "secret";
    const creds = getCredentials();
    expect(creds.email).toBe("a@b.com");
    expect(creds.loginUrl).toBe("https://portal.crew1.com/");
  });

  it("parseCrew1DateTime parses dashboard format", () => {
    const result = parseCrew1DateTime("Fri Jun 12 8:00 AM", 2026);
    expect(result).toEqual({ date: "6/12/2026", callTime: "08:00" });
  });

  it("parseCrew1DateTime handles PM times", () => {
    const result = parseCrew1DateTime("Fri Jun 12 10:30 PM", 2026);
    expect(result).toEqual({ date: "6/12/2026", callTime: "22:30" });
  });

  it("normalizeCrew1DateTimeText fixes missing space between day and hour", () => {
    expect(normalizeCrew1DateTimeText("Fri Jun 128:00 AM")).toBe("Fri Jun 12 8:00 AM");
    expect(parseCrew1DateTime("Fri Jun 128:00 AM", 2026)).toEqual({
      date: "6/12/2026",
      callTime: "08:00"
    });
  });

  it("normalizeCrew1DateTimeText does not split spaced PM times", () => {
    expect(normalizeCrew1DateTimeText("Fri Jun 12 10:30 PM")).toBe("Fri Jun 12 10:30 PM");
  });

  it("parseCrew1DateTime returns null for invalid input", () => {
    expect(parseCrew1DateTime("")).toBeNull();
    expect(parseCrew1DateTime("not a date")).toBeNull();
  });

  it("parseCrew1DateTime parses detail page call format", () => {
    const result = parseCrew1DateTime("Fri Jun 12, 2026 10:30 PM", 2026);
    expect(result).toEqual({ date: "6/12/2026", callTime: "22:30" });
  });

  it("matchDetailCall matches dashboard row to detail table row", () => {
    const call = { startDateTime: "Fri Jun 12, 2026 8:00 AM", job: "STAGEHAND" };
    expect(matchDetailCall("6/12/2026", "08:00", call)).toBe(true);
    expect(matchDetailCall("6/12/2026", "22:30", call)).toBe(false);
  });

  it("formatCrewOneEventDescription combines detail sections", () => {
    const text = formatCrewOneEventDescription(
      {
        eventTypeLine: "This is a CONCERT Event.",
        generalNotes: "Bring hard hat.",
        venueNotes: "Parking in Ruby lot."
      },
      { job: "STAGEHAND", contractorNotes: "Arrive early" }
    );
    expect(text).toContain("CONCERT Event");
    expect(text).toContain("Position: STAGEHAND");
    expect(text).toContain("Call notes: Arrive early");
    expect(text).toContain("Bring hard hat.");
    expect(text).toContain("Parking in Ruby lot.");
  });
});
