import { describe, it, expect } from "vitest";
import { enabledSourceIds, loadUserSettings } from "../user-settings.js";
import { getEnabledSourceIds, getSource } from "./index.js";

describe("getEnabledSourceIds", () => {
  it("follows the company flags in user settings", () => {
    const settings = loadUserSettings();
    expect(getEnabledSourceIds()).toEqual(enabledSourceIds(settings));
  });
});

describe("getSource", () => {
  it("should return known sources", () => {
    expect(getSource("rhino").sourceId).toBe("rhino");
    expect(getSource("crewOne").sourceId).toBe("crewOne");
    expect(getSource("technicalElements").sourceId).toBe("technicalElements");
    expect(getSource("technicalElements").sourceDisplayName).toBe("Technical Elements");
    expect(getSource("technicalElements").removeAbsent).toBe(true);
  });

  it("should throw for unknown sources", () => {
    expect(() => getSource("unknown")).toThrow(/Unknown schedule source/);
  });
});
