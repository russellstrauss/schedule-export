import { describe, expect, it } from "vitest";
import { enabledSourceIds, getEnabledSourceIds, loadUserSettings, SYNC_COMPANIES } from "./user-settings.js";

describe("user settings", () => {
  it("reads a true or false flag for each company", () => {
    const settings = loadUserSettings();
    for (const company of SYNC_COMPANIES) {
      expect(typeof settings[company.id]).toBe("boolean");
    }
    expect(getEnabledSourceIds()).toEqual(enabledSourceIds(settings));
  });

  it("returns only the companies set to true", () => {
    expect(
      enabledSourceIds({
        rhino: true,
        crewOne: false,
        technicalElements: true,
        iatse927: false
      })
    ).toEqual(["rhino", "technicalElements"]);
  });

  it("returns no companies when every flag is false", () => {
    expect(
      enabledSourceIds({
        rhino: false,
        crewOne: false,
        technicalElements: false,
        iatse927: false
      })
    ).toEqual([]);
  });

  it("returns IATSE when the portal companies are off", () => {
    expect(
      enabledSourceIds({
        rhino: false,
        crewOne: false,
        technicalElements: false,
        iatse927: true
      })
    ).toEqual(["iatse927"]);
  });

  it("rejects a company flag that is not true or false", () => {
    expect(() =>
      enabledSourceIds({
        rhino: true,
        crewOne: true,
        technicalElements: "yes",
        iatse927: true
      })
    ).toThrow(/technicalElements/);
  });
});
