import { describe, expect, it } from "vitest";
import { toGoogleEvent } from "./google-event.js";
import {
  abbreviationFromShowTitle,
  formatShowWithVenueAbbreviation,
  generateVenueAbbreviation,
  resolveVenueAbbreviation
} from "./venue-abbreviations.js";

describe("venue abbreviations", () => {
  it("reads Rhino's show-title code", () => {
    expect(abbreviationFromShowTitle("(SFA) JOURNEY")).toBe("SFA");
    expect(abbreviationFromShowTitle("CANCELLED (TB) DEI V")).toBe("TB");
    expect(abbreviationFromShowTitle("(C) TECHXCHANGE 2026")).toBe("");
    expect(abbreviationFromShowTitle("CANCELLED (C) GHSA CHAMPIONSHIP")).toBe("");
    expect(abbreviationFromShowTitle("ZACH BRYAN - AUBURN, AL - PRODUCTION")).toBe("");
  });

  it("prefers the Rhino portal code over the shared list", () => {
    expect(
      resolveVenueAbbreviation(
        {
          show: "(TB) DEI V",
          venue: "STATE FARM ARENA 1 STATE FARM DR ATLANTA GA 30303 Venue Info"
        },
        "rhino"
      )
    ).toBe("TB");
  });

  it("uses the same configured code for a venue Rhino has already labeled", () => {
    expect(
      resolveVenueAbbreviation(
        { show: "JOURNEY", venue: "State Farm Arena" },
        "crewOne"
      )
    ).toBe("SFA");
    expect(
      resolveVenueAbbreviation(
        {
          show: "(C) TECHXCHANGE 2026",
          venue: "GEORGIA INTL CONVENTION CENTER 2000 CONVENTION CENTER CONCOURSE ATLANTA GA 30337"
        },
        "rhino"
      )
    ).toBe("GICC");
    expect(
      resolveVenueAbbreviation(
        {
          show: "TECHXCHANGE 2026",
          venue: "GEORGIA INTL CONVENTION CENTER 2000 CONVENTION CENTER CONCOURSE ATLANTA GA 30337"
        },
        "crewOne"
      )
    ).toBe("GICC");
    expect(
      resolveVenueAbbreviation({ show: "DEI V", venue: "The Tabernacle" }, "iatse927")
    ).toBe("TB");
  });

  it("generates a code when the venue is not configured", () => {
    expect(generateVenueAbbreviation("JORDAN-HARE STADIUM 251 DONAHUE DR AUBURN AL 36849")).toBe(
      "JHS"
    );
    expect(generateVenueAbbreviation("COBB ENERGY PERFORMING ARTS CENTRE")).toBe("CEPAC");
    expect(generateVenueAbbreviation("")).toBe("");
  });

  it("does not repeat a code that is already in the show title", () => {
    expect(formatShowWithVenueAbbreviation("(SFA) JOURNEY", "SFA")).toBe("(SFA) JOURNEY");
    expect(formatShowWithVenueAbbreviation("JOURNEY", "SFA")).toBe("(SFA) JOURNEY");
  });

  it("puts the shared abbreviation on calendar titles for every portal", () => {
    const base = {
      date: "10/19/2026",
      callTime: "08:00",
      location: "",
      position: "SH",
      type: "IN",
      status: "Confirmed",
      details: "",
      notes: ""
    };

    expect(
      toGoogleEvent(
        {
          ...base,
          show: "(SFA) JOURNEY",
          venue: "STATE FARM ARENA 1 STATE FARM DR ATLANTA GA 30303"
        },
        { source: "rhino" }
      ).summary
    ).toBe("7:30am (SFA) JOURNEY - SH [Rhino]");

    expect(
      toGoogleEvent(
        { ...base, show: "JOURNEY", venue: "State Farm Arena" },
        { source: "crewOne" }
      ).summary
    ).toBe("7:30am (SFA) JOURNEY - SH [Crew 1]");

    expect(
      toGoogleEvent(
        { ...base, show: "Journey", venue: "State Farm Arena" },
        { source: "iatse927" }
      ).summary
    ).toBe("7:30am (SFA) Journey - SH [IATSE]");

    expect(
      toGoogleEvent(
        {
          ...base,
          show: "(C) TECHXCHANGE 2026",
          venue: "GEORGIA INTL CONVENTION CENTER 2000 CONVENTION CENTER CONCOURSE ATLANTA GA 30337"
        },
        { source: "rhino" }
      ).summary
    ).toBe("7:30am (GICC) (C) TECHXCHANGE 2026 - SH [Rhino]");
  });
});
