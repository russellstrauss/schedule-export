import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { rememberOfferDeadline, recallOfferDeadline } from "./offer-deadline-cache.js";

describe("offer-deadline-cache", () => {
  /** @type {string} */
  let cachePath;

  beforeEach(() => {
    cachePath = path.join(
      os.tmpdir(),
      `crewone-offer-deadlines-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
    );
  });

  afterEach(() => {
    try {
      fs.unlinkSync(cachePath);
    } catch {
      // ignore
    }
  });

  it("stores and recalls deadlines by normalized detail URL", () => {
    const text = "This offer closes September 11, 2026 at 9:11 AM";
    rememberOfferDeadline(
      "https://portal.crew1.com/response/NGNKC5SIZRLOYBPLPFSVJ6MAB3OY7OC4BBJQPQI/",
      text,
      cachePath
    );

    expect(
      recallOfferDeadline(
        "/response/NGNKC5SIZRLOYBPLPFSVJ6MAB3OY7OC4BBJQPQI",
        cachePath
      )
    ).toBe(text);
  });

  it("returns empty string for unknown urls", () => {
    expect(recallOfferDeadline("https://portal.crew1.com/response/missing", cachePath)).toBe("");
  });
});
