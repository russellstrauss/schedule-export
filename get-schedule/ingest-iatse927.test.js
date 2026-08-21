import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SAMPLE_REMINDER_SMS,
  SAMPLE_CONFIRMATION_SMS
} from "./sources/iatse927-fixtures.js";

vi.mock("./iatse927-message-store.js", () => ({
  appendMessage: vi.fn(async () => ({ appended: true, id: "doc1" })),
  loadAllMessages: vi.fn(async () => [
    { text: SAMPLE_CONFIRMATION_SMS, receivedAt: new Date("2026-06-01"), messageId: "m1" },
    { text: SAMPLE_REMINDER_SMS, receivedAt: new Date("2026-06-02"), messageId: "m2" }
  ])
}));

const futureDate = new Date();
futureDate.setDate(futureDate.getDate() + 30);
const mockEntryDate = `${futureDate.getMonth() + 1}/${futureDate.getDate()}/${futureDate.getFullYear()}`;

const mockEntry = {
  source: "iatse927",
  date: mockEntryDate,
  callTime: "10:30",
  show: "Charlie Puth",
  venue: "Chastain Amphitheater",
  location: "4469 Stella Dr Atlanta Georgia 30342",
  position: "",
  type: "Load In",
  status: "confirmed",
  evidenceIndices: [0, 1]
};

vi.mock("./iatse927-gemini.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveScheduleEntriesWithValidation: vi.fn(async () => ({
      entries: [mockEntry],
      warnings: []
    }))
  };
});

vi.mock("./google-calendar/auth.js", () => ({
  authorize: vi.fn(async () => ({}))
}));

vi.mock("./google-calendar/add-event.js", () => ({
  purgeOrphanedSourceEvents: vi.fn(async () => {}),
  consolidateDuplicateSourceEvents: vi.fn(async () => 0),
  addEvent: vi.fn(async () => {})
}));

vi.mock("./auth-handler.js", () => ({
  withAuthRetry: vi.fn(async (_auth, fn) => fn({}))
}));

import { ingestIatse927, trySyncIatse927FromStore, syncIatse927FromMessages } from "./ingest-iatse927.js";
import {
  purgeOrphanedSourceEvents,
  consolidateDuplicateSourceEvents,
  addEvent
} from "./google-calendar/add-event.js";
import { appendMessage, loadAllMessages } from "./iatse927-message-store.js";
import { resolveScheduleEntriesWithValidation } from "./iatse927-gemini.js";

describe("ingestIatse927", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects empty text", async () => {
    await expect(ingestIatse927({ text: "" })).rejects.toThrow(/non-empty text/);
  });

  it("stores message in Firestore without running Gemini or calendar sync", async () => {
    const result = await ingestIatse927({
      text: SAMPLE_REMINDER_SMS
    });

    expect(appendMessage).toHaveBeenCalledWith(SAMPLE_REMINDER_SMS, {});
    expect(resolveScheduleEntriesWithValidation).not.toHaveBeenCalled();
    expect(purgeOrphanedSourceEvents).not.toHaveBeenCalled();
    expect(addEvent).not.toHaveBeenCalled();
    expect(result.stored).toBe(true);
    expect(result.id).toBe("doc1");
  });
});

describe("trySyncIatse927FromStore", () => {
  const originalKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });

  it("returns null when GEMINI_API_KEY is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    const result = await trySyncIatse927FromStore();
    expect(result).toBeNull();
  });

  it("returns null when Firestore has no messages", async () => {
    vi.mocked(loadAllMessages).mockResolvedValueOnce([]);
    const result = await trySyncIatse927FromStore();
    expect(result).toBeNull();
  });

  it("syncs when configured and messages exist", async () => {
    const result = await trySyncIatse927FromStore();
    expect(result?.synced).toBe(1);
    expect(purgeOrphanedSourceEvents).toHaveBeenCalledWith(
      expect.anything(),
      "iatse927",
      expect.any(Array),
      expect.objectContaining({ cancelledRowIds: expect.any(Array) })
    );
  });

  it("returns null when Gemini is unavailable", async () => {
    vi.mocked(resolveScheduleEntriesWithValidation).mockRejectedValueOnce(
      Object.assign(new Error("quota depleted"), { status: 429 })
    );
    const result = await trySyncIatse927FromStore();
    expect(result).toBeNull();
  });
});

describe("syncIatse927FromMessages", () => {
  beforeEach(() => {
    resolveScheduleEntriesWithValidation.mockClear();
    addEvent.mockClear();
    purgeOrphanedSourceEvents.mockClear();
    consolidateDuplicateSourceEvents.mockClear();
  });

  it("shares an in-flight sync when called concurrently", async () => {
    const resultOne = syncIatse927FromMessages([{ text: "same message" }]);
    const resultTwo = syncIatse927FromMessages([{ text: "same message" }]);

    expect(resultOne).toBe(resultTwo);
    await Promise.all([resultOne, resultTwo]);
    expect(resolveScheduleEntriesWithValidation).toHaveBeenCalledTimes(1);
  });

  it("consolidates existing calendar duplicates when no future rows are parsed", async () => {
    resolveScheduleEntriesWithValidation.mockResolvedValueOnce({ entries: [], warnings: [] });

    const result = await syncIatse927FromMessages([{ text: "Confirmed Lakewood 8/22 8AM and 8/23 6PM" }]);

    expect(result.synced).toBe(0);
    expect(consolidateDuplicateSourceEvents).toHaveBeenCalledWith({}, "iatse927");
  });

  it("writes both events when two future rows are parsed", async () => {
    const firstEvent = { ...mockEntry, date: mockEntryDate, callTime: "08:00" };
    const secondEvent = { ...mockEntry, date: mockEntryDate, callTime: "18:00", type: "Load Out" };
    resolveScheduleEntriesWithValidation.mockResolvedValueOnce({
      entries: [firstEvent, secondEvent],
      warnings: []
    });
    addEvent.mockResolvedValue({ action: "created", event: { id: "created" } });

    const result = await syncIatse927FromMessages([{ text: "two confirmed events" }]);

    expect(result.synced).toBe(2);
    expect(addEvent).toHaveBeenCalledTimes(2);
  });

  it("fails the sync when a calendar write fails", async () => {
    addEvent.mockResolvedValueOnce({ action: "error", error: new Error("calendar unavailable") });

    await expect(syncIatse927FromMessages([{ text: "confirmed event" }])).rejects.toThrow(
      "calendar unavailable"
    );
  });

  it("reuses the prior successful schedule when the same snapshot parses empty", async () => {
    const messages = [{ text: "same snapshot", messageId: "same-snapshot" }];
    resolveScheduleEntriesWithValidation.mockResolvedValueOnce({
      entries: [mockEntry],
      warnings: []
    });
    addEvent.mockResolvedValue({ action: "created", event: { id: "created" } });
    await syncIatse927FromMessages(messages);

    resolveScheduleEntriesWithValidation.mockResolvedValueOnce({ entries: [], warnings: [] });
    addEvent.mockClear();
    const result = await syncIatse927FromMessages(messages);

    expect(result.synced).toBe(1);
    expect(addEvent).toHaveBeenCalledTimes(1);
  });
});
