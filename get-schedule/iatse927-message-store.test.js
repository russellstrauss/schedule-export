import { describe, it, expect } from "vitest";
import { combineMessageTexts } from "./iatse927-message-store.js";

describe("combineMessageTexts", () => {
  it("joins messages with separator", () => {
    const combined = combineMessageTexts([
      { text: "first", receivedAt: null },
      { text: "second", receivedAt: null }
    ]);
    expect(combined).toBe("first\n\n---\n\nsecond");
  });

  it("skips empty segments", () => {
    expect(combineMessageTexts([{ text: "  ", receivedAt: null }, { text: "ok", receivedAt: null }])).toBe(
      "ok"
    );
  });
});
