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
        technicalElements: true
      })
    ).toEqual(["rhino", "technicalElements"]);
  });

  it("returns no portal companies when every flag is false", () => {
    expect(
      enabledSourceIds({
        rhino: false,
        crewOne: false,
        technicalElements: false
      })
    ).toEqual([]);
  });

  it("rejects a company flag that is not true or false", () => {
    expect(() =>
      enabledSourceIds({
        rhino: true,
        crewOne: true,
        technicalElements: "yes"
      })
    ).toThrow(/technicalElements/);
  });
});
