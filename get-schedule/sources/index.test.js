import { describe, it, expect, afterEach } from "vitest";
import { getEnabledSourceIds, getSource } from "./index.js";

describe("getEnabledSourceIds", () => {
  const original = process.env.SCHEDULE_SOURCES;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.SCHEDULE_SOURCES;
    } else {
      process.env.SCHEDULE_SOURCES = original;
    }
  });

  it('should default to rhino when unset', () => {
    delete process.env.SCHEDULE_SOURCES;
    expect(getEnabledSourceIds()).toEqual(["rhino"]);
  });

  it("should parse comma-separated sources", () => {
    process.env.SCHEDULE_SOURCES = "rhino, crewOne";
    expect(getEnabledSourceIds()).toEqual(["rhino", "crewOne"]);
  });

  it("does not enable Technical Elements unless it is listed", () => {
    delete process.env.SCHEDULE_SOURCES;
    expect(getEnabledSourceIds()).not.toContain("technicalElements");
    process.env.SCHEDULE_SOURCES = "rhino, technicalElements";
    expect(getEnabledSourceIds()).toEqual(["rhino", "technicalElements"]);
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
