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

  // Regression test for the long-standing "next day events keep getting deleted" bug:
  // an event missing from the latest scrape (gap/reschedule/id drift) must NEVER be deleted.
  it("never deletes an event that is merely absent from the scrape (rhino)", async () => {
    const kept = {
      id: "evt-keep",
      extendedProperties: {
        private: { scheduleSource: "rhino", scheduleRowId: "still-on-portal" }
      }
    };
    const absent = {
      id: "evt-absent",
      extendedProperties: {
        private: { scheduleSource: "rhino", scheduleRowId: "gone-from-portal" }
      }
    };
    mockList.mockResolvedValueOnce({ data: { items: [kept, absent] } });

    await purgeOrphanedSourceEvents({}, "rhino", ["still-on-portal"]);

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("never deletes an event that is merely absent from the scrape (iatse927)", async () => {
    const absent = {
      id: "evt-absent",
      extendedProperties: {
        private: { scheduleSource: "iatse927", scheduleRowId: "gone-from-firestore" }
      }
    };
    mockList.mockResolvedValueOnce({ data: { items: [absent] } });

    await purgeOrphanedSourceEvents({}, "iatse927", ["something-else-active"]);

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("deletes an event only when its row is explicitly cancelled in the latest fetch", async () => {
    const cancelled = {
      id: "evt-cancelled",
      extendedProperties: {
        private: { scheduleSource: "rhino", scheduleRowId: "cancelled-row" }
      }
    };
    const absent = {
      id: "evt-absent",
      extendedProperties: {
        private: { scheduleSource: "rhino", scheduleRowId: "gone-from-portal" }
      }
    };
    mockList.mockResolvedValueOnce({ data: { items: [cancelled, absent] } });

    await purgeOrphanedSourceEvents({}, "rhino", ["still-on-portal"], {
      cancelledRowIds: ["cancelled-row"]
    });

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith({
      calendarId: "primary",
      eventId: expect.any(String)
    });
  });

  // Rhino prepends "CANCELLED " to the show name of a cancelled call; the stored
  // event has the clean name, so matching must ignore the marker.
  it("deletes a rhino event whose cancelled row gained a CANCELLED show prefix", async () => {
    const stored = {
      id: "evt-rhino-dei-in",
      summary: "9:30am (TB) DEI V",
      extendedProperties: {
        private: {
          scheduleSource: "rhino",
          scheduleRowId: "6/20/2026 | 10:00 | (TB) DEI V | The Tabernacle | SH | IN"
        }
      }
    };
    mockList.mockResolvedValueOnce({ data: { items: [stored] } });

    await purgeOrphanedSourceEvents({}, "rhino", ["6/21/2026 | 08:00 | OTHER | Venue | SH | IN"], {
      cancelledRowIds: ["6/20/2026 | 10:00 | CANCELLED (TB) DEI V | The Tabernacle | SH | IN"]
    });

    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  // Rhino sometimes drifts the call time by a minute on cancellation; the relaxed
  // rhino key (date/show/venue/position/type, no time) still matches.
  it("deletes a rhino event whose cancelled row has call-time drift", async () => {
    const stored = {
      id: "evt-rhino-dei-out",
      summary: "9:30pm (TB) DEI V",
      extendedProperties: {
        private: {
          scheduleSource: "rhino",
          scheduleRowId: "6/20/2026 | 22:00 | (TB) DEI V | The Tabernacle | SH | OUT"
        }
      }
    };
    mockList.mockResolvedValueOnce({ data: { items: [stored] } });

    await purgeOrphanedSourceEvents({}, "rhino", ["6/21/2026 | 08:00 | OTHER | Venue | SH | IN"], {
      cancelledRowIds: ["6/20/2026 | 22:01 | CANCELLED (TB) DEI V | The Tabernacle | SH | OUT"]
    });

    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  // The relaxed cancelled key must not delete a still-active call that shares the
  // same date/show/venue/position/type (active rows are matched exactly first).
  it("keeps an active rhino call even when a same-key sibling is cancelled", async () => {
    const activeRowId = "6/20/2026 | 10:00 | (TB) DEI V | The Tabernacle | SH | IN";
    const active = {
      id: "evt-rhino-active",
      summary: "9:30am (TB) DEI V",
      extendedProperties: {
        private: { scheduleSource: "rhino", scheduleRowId: activeRowId }
      }
    };
    mockList.mockResolvedValueOnce({ data: { items: [active] } });

    await purgeOrphanedSourceEvents({}, "rhino", [activeRowId], {
      cancelledRowIds: ["6/20/2026 | 11:30 | CANCELLED (TB) DEI V | The Tabernacle | SH | IN"]
    });

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("skips the purge entirely when the schedule snapshot is empty (failed/partial fetch)", async () => {
    const future = {
      id: "evt-future",
      extendedProperties: {
        private: { scheduleSource: "rhino", scheduleRowId: "tomorrows-shift" }
      }
    };
    mockList.mockResolvedValueOnce({ data: { items: [future] } });

    await purgeOrphanedSourceEvents({}, "rhino", [], { cancelledRowIds: [] });

    // No fetch should even be attempted, and certainly nothing deleted.
    expect(mockDelete).not.toHaveBeenCalled();
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

  it("deletes a cancelled crewOne event matched by dashboard key, ignoring detail drift", async () => {
    const storedRowId =
      "6/12/2026 | 08:00 | CONCERT | State Farm Arena | STAGEHAND | CONCERT";
    const cancelled = {
      id: "evt-crewone-cancelled",
      summary: "8am CONCERT",
      extendedProperties: {
        private: { scheduleSource: "crewOne", scheduleRowId: storedRowId }
      }
    };
    mockList.mockResolvedValueOnce({ data: { items: [cancelled] } });

    await purgeOrphanedSourceEvents({}, "crewOne", ["6/13/2026 | 08:00 | OTHER | Other Venue"], {
      cancelledRowIds: ["6/12/2026 | 08:00 | CONCERT | State Farm Arena"]
    });

    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  // CrewOne's dashboard is a complete snapshot: a call removed from it is gone.
  it("removeAbsent deletes a crewOne event no longer on the dashboard", async () => {
    const absent = {
      id: "evt-crewone-removed",
      summary: "8am CONCERT",
      extendedProperties: {
        private: {
          scheduleSource: "crewOne",
          scheduleRowId: "6/12/2026 | 08:00 | CONCERT | State Farm Arena | STAGEHAND | CONCERT"
        }
      }
    };
    mockList.mockResolvedValueOnce({ data: { items: [absent] } });

    await purgeOrphanedSourceEvents({}, "crewOne", ["6/13/2026 | 08:00 | OTHER | Other Venue"], {
      removeAbsent: true
    });

    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it("removeAbsent still keeps a crewOne event that is on the dashboard", async () => {
    const kept = {
      id: "evt-crewone-kept",
      summary: "8am CONCERT",
      extendedProperties: {
        private: {
          scheduleSource: "crewOne",
          scheduleRowId: "6/12/2026 | 08:00 | CONCERT | State Farm Arena | STAGEHAND | CONCERT"
        }
      }
    };
    mockList.mockResolvedValueOnce({ data: { items: [kept] } });

    await purgeOrphanedSourceEvents({}, "crewOne", ["6/12/2026 | 08:00 | CONCERT | State Farm Arena"], {
      removeAbsent: true
    });

    expect(mockDelete).not.toHaveBeenCalled();
  });

  // When the whole CrewOne dashboard is empty (every call taken off the schedule),
  // removeAbsent must still purge the stale calendar events instead of bailing on
  // the empty-snapshot guard.
  it("removeAbsent purges stale events even when the snapshot is empty", async () => {
    const stale = {
      id: "evt-crewone-stale",
      summary: "8am CONCERT",
      extendedProperties: {
        private: {
          scheduleSource: "crewOne",
          scheduleRowId: "6/12/2026 | 08:00 | CONCERT | State Farm Arena | STAGEHAND | CONCERT"
        }
      }
    };
    mockList.mockResolvedValueOnce({ data: { items: [stale] } });

    await purgeOrphanedSourceEvents({}, "crewOne", [], { removeAbsent: true });

    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it("without removeAbsent, an absent event is kept (default safety contract)", async () => {
    const absent = {
      id: "evt-absent",
      extendedProperties: {
        private: { scheduleSource: "crewOne", scheduleRowId: "6/12/2026 | 08:00 | CONCERT | State Farm Arena" }
      }
    };
    mockList.mockResolvedValueOnce({ data: { items: [absent] } });

    await purgeOrphanedSourceEvents({}, "crewOne", ["6/13/2026 | 08:00 | OTHER | Other Venue"]);

    expect(mockDelete).not.toHaveBeenCalled();
  });
});
