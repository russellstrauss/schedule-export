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

const mockEntry = {
  source: "iatse927",
  date: "6/3/2026",
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
  purgeSourceEvents: vi.fn(async () => {}),
  addEvent: vi.fn(async () => {})
}));

vi.mock("./auth-handler.js", () => ({
  withAuthRetry: vi.fn(async (_auth, fn) => fn({}))
}));

import { ingestIatse927, trySyncIatse927FromStore } from "./ingest-iatse927.js";
import { purgeSourceEvents, addEvent } from "./google-calendar/add-event.js";
import { appendMessage, loadAllMessages } from "./iatse927-message-store.js";
import { resolveScheduleEntriesWithValidation } from "./iatse927-gemini.js";

describe("ingestIatse927", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects empty text", async () => {
    await expect(ingestIatse927({ text: "" })).rejects.toThrow(/non-empty text/);
  });

  it("stores, resolves entries, purges all source events, syncs, and returns warnings", async () => {
    const result = await ingestIatse927({
      text: SAMPLE_REMINDER_SMS
    });

    expect(appendMessage).toHaveBeenCalled();
    expect(resolveScheduleEntriesWithValidation).toHaveBeenCalled();
    expect(purgeSourceEvents).toHaveBeenCalledWith(expect.anything(), "iatse927", {
      futureOnly: false
    });
    expect(addEvent).toHaveBeenCalled();

    const eventArg = vi.mocked(addEvent).mock.calls[0]?.[1];
    expect(eventArg?.location).toContain("4469 Stella Dr");
    expect(eventArg?.summary).toMatch(/Charlie Puth/i);

    expect(result.parsed).toBe(1);
    expect(result.warnings).toEqual([]);
    expect(result.synced).toBe(1);
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
    expect(purgeSourceEvents).toHaveBeenCalledWith(expect.anything(), "iatse927", {
      futureOnly: false
    });
  });

  it("returns null when Gemini is unavailable", async () => {
    vi.mocked(resolveScheduleEntriesWithValidation).mockRejectedValueOnce(
      Object.assign(new Error("quota depleted"), { status: 429 })
    );
    const result = await trySyncIatse927FromStore();
    expect(result).toBeNull();
  });
});
