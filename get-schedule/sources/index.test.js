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
});

describe("getSource", () => {
  it("should return known sources", () => {
    expect(getSource("rhino").sourceId).toBe("rhino");
    expect(getSource("crewOne").sourceId).toBe("crewOne");
  });

  it("should throw for unknown sources", () => {
    expect(() => getSource("unknown")).toThrow(/Unknown schedule source/);
  });
});
