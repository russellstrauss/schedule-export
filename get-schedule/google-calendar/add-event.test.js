import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  deterministicIdFor,
  legacyRhinoDeterministicIdFor,
  eventMatchesSource,
  rowIdFromEvent,
  purgeSourceEvents,
  purgeOrphanedSourceEvents
} from "./add-event.js";

const mockList = vi.fn();
const mockDelete = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    calendar: () => ({
      events: {
        list: mockList,
        delete: mockDelete
      }
    })
  }
}));

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

describe("purgeSourceEvents", () => {
  beforeEach(() => {
    mockList.mockReset();
    mockDelete.mockReset();
    mockDelete.mockResolvedValue({});
  });

  it("uses timeMin now when futureOnly is true (default)", async () => {
    mockList.mockResolvedValueOnce({ data: { items: [] } });

    await purgeSourceEvents({}, "iatse927");

    expect(mockList).toHaveBeenCalledTimes(1);
    const args = mockList.mock.calls[0][0];
    expect(args.timeMin).toBeDefined();
    expect(new Date(args.timeMin).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("uses lookback timeMin and paginates when futureOnly is false", async () => {
    const tagged = {
      id: "evt1",
      extendedProperties: {
        private: { scheduleSource: "iatse927", scheduleRowId: "row1" }
      }
    };
    mockList
      .mockResolvedValueOnce({ data: { items: [tagged], nextPageToken: "page2" } })
      .mockResolvedValueOnce({ data: { items: [] } });

    await purgeSourceEvents({}, "iatse927", { futureOnly: false });

    expect(mockList).toHaveBeenCalledTimes(2);
    const firstArgs = mockList.mock.calls[0][0];
    const secondArgs = mockList.mock.calls[1][0];
    expect(new Date(firstArgs.timeMin).getTime()).toBeLessThan(Date.now() - 365 * 24 * 60 * 60 * 1000);
    expect(secondArgs.pageToken).toBe("page2");
    expect(mockDelete).toHaveBeenCalled();
  });
});

describe("purgeOrphanedSourceEvents", () => {
  beforeEach(() => {
    mockList.mockReset();
    mockDelete.mockReset();
    mockDelete.mockResolvedValue({});
  });

  it("deletes only future tagged events whose rowId is not on the portal schedule", async () => {
    const kept = {
      id: "evt-keep",
      extendedProperties: {
        private: { scheduleSource: "rhino", scheduleRowId: "still-on-portal" }
      }
    };
    const removed = {
      id: "evt-drop",
      extendedProperties: {
        private: { scheduleSource: "rhino", scheduleRowId: "gone-from-portal" }
      }
    };
    mockList.mockResolvedValueOnce({ data: { items: [kept, removed] } });

    await purgeOrphanedSourceEvents({}, "rhino", ["still-on-portal"]);

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith({
      calendarId: "primary",
      eventId: expect.any(String)
    });
  });

  it("does not delete when every listed row is still active", async () => {
    const kept = {
      id: "evt-keep",
      extendedProperties: {
        private: { scheduleSource: "rhino", scheduleRowId: "still-on-portal" }
      }
    };
    mockList.mockResolvedValueOnce({ data: { items: [kept] } });

    await purgeOrphanedSourceEvents({}, "rhino", ["still-on-portal"]);

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("keeps events when portal callTime format differs from stored rowId", async () => {
    const storedRowId = "6/12/2026 | 05:00 | TEST SHOW | Arena | SH | IN";
    const kept = {
      id: "evt-keep",
      extendedProperties: {
        private: { scheduleSource: "rhino", scheduleRowId: storedRowId }
      }
    };
    mockList.mockResolvedValueOnce({ data: { items: [kept] } });

    await purgeOrphanedSourceEvents({}, "rhino", [
      "6/12/2026 | 5:00 AM | TEST SHOW | Arena | SH | IN"
    ]);

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("keeps crewOne events when stored rowId includes detail-only position/type", async () => {
    const storedRowId =
      "6/12/2026 | 08:00 | CONCERT | State Farm Arena | STAGEHAND | CONCERT";
    const kept = {
      id: "evt-crewone",
      summary: "8am CONCERT",
      extendedProperties: {
        private: { scheduleSource: "crewOne", scheduleRowId: storedRowId }
      }
    };
    mockList.mockResolvedValueOnce({ data: { items: [kept] } });

    await purgeOrphanedSourceEvents({}, "crewOne", [
      "6/12/2026 | 08:00 | CONCERT | State Farm Arena"
    ]);

    expect(mockDelete).not.toHaveBeenCalled();
  });
});
