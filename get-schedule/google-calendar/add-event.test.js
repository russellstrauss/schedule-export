import { describe, it, expect } from "vitest";
import {
  deterministicIdFor,
  legacyRhinoDeterministicIdFor,
  eventMatchesSource,
  rowIdFromEvent
} from "./add-event.js";

describe("deterministicIdFor", () => {
  it("should produce different ids for different sources with the same rowId", () => {
    const rowId = "11/23/2025 | 08:00 | Show";
    expect(deterministicIdFor("rhino", rowId)).not.toBe(deterministicIdFor("crewOne", rowId));
  });

  it("should be stable for the same source and rowId", () => {
    const rowId = "11/23/2025 | 08:00 | Show";
    expect(deterministicIdFor("rhino", rowId)).toBe(deterministicIdFor("rhino", rowId));
  });

  it("legacy rhino id differs from new source-prefixed id", () => {
    const rowId = "11/23/2025 | 08:00 | Show";
    expect(legacyRhinoDeterministicIdFor(rowId)).not.toBe(deterministicIdFor("rhino", rowId));
  });
});

describe("eventMatchesSource", () => {
  it("should match scheduleSource tag", () => {
    const ev = {
      extendedProperties: { private: { scheduleSource: "crewOne", scheduleRowId: "x" } }
    };
    expect(eventMatchesSource(ev, "crewOne")).toBe(true);
    expect(eventMatchesSource(ev, "rhino")).toBe(false);
  });

  it("should match legacy rhinoRowId for rhino source", () => {
    const ev = {
      extendedProperties: { private: { rhinoRowId: "legacy-row" } }
    };
    expect(eventMatchesSource(ev, "rhino")).toBe(true);
    expect(eventMatchesSource(ev, "crewOne")).toBe(false);
  });
});

describe("rowIdFromEvent", () => {
  it("should prefer scheduleRowId", () => {
    const ev = {
      extendedProperties: {
        private: { scheduleRowId: "new", rhinoRowId: "old" }
      }
    };
    expect(rowIdFromEvent(ev, "rhino")).toBe("new");
  });

  it("should fall back to rhinoRowId for rhino", () => {
    const ev = {
      extendedProperties: { private: { rhinoRowId: "legacy" } }
    };
    expect(rowIdFromEvent(ev, "rhino")).toBe("legacy");
  });
});
