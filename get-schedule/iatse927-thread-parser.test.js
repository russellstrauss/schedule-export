import { describe, it, expect } from "vitest";
import { parseRcsThread, mergeAndSortMessages, inferYearForMonthDay } from "./iatse927-thread-parser.js";
import {
  SHAWN_SCHEDULING_THREAD_EXPORT,
  TYLER_REMINDERS_THREAD_EXPORT,
  THREAD_REFERENCE_DATE,
  COMBINED_THREAD_MESSAGES
} from "./sources/iatse927-thread-fixture.js";

describe("inferYearForMonthDay", () => {
  it("uses reference year for month/day in the same season", () => {
    const ref = new Date("2026-06-06T12:00:00");
    expect(inferYearForMonthDay(5, 15, ref)).toBe(2026);
    expect(inferYearForMonthDay(7, 1, ref)).toBe(2026);
  });
});

describe("parseRcsThread", () => {
  it("parses Shawn scheduling export into ordered messages", () => {
    const messages = parseRcsThread(SHAWN_SCHEDULING_THREAD_EXPORT, {
      referenceDate: THREAD_REFERENCE_DATE
    });
    expect(messages.length).toBeGreaterThan(10);
    expect(messages[0].receivedAt).toBeInstanceOf(Date);
    expect(messages.some((m) => /Confirmed 5\/15 Ameris 9PM/i.test(m.text))).toBe(true);
    expect(messages.some((m) => /already staffed tonight/i.test(m.text))).toBe(true);
  });

  it("parses Tyler reminders including REMINDER: variant", () => {
    const messages = parseRcsThread(TYLER_REMINDERS_THREAD_EXPORT, {
      referenceDate: THREAD_REFERENCE_DATE
    });
    expect(messages.some((m) => /REMINDER: 5\/15 Dave Matthews/i.test(m.text))).toBe(true);
    expect(messages.some((m) => /Charlie Puth/i.test(m.text))).toBe(true);
  });

  it("merges Shawn and Tyler chronologically", () => {
    expect(COMBINED_THREAD_MESSAGES.length).toBeGreaterThan(20);
    for (let i = 1; i < COMBINED_THREAD_MESSAGES.length; i++) {
      expect(COMBINED_THREAD_MESSAGES[i].receivedAt.getTime()).toBeGreaterThanOrEqual(
        COMBINED_THREAD_MESSAGES[i - 1].receivedAt.getTime()
      );
    }
  });

  it("mergeAndSortMessages interleaves two threads", () => {
    const shawn = parseRcsThread(SHAWN_SCHEDULING_THREAD_EXPORT, {
      referenceDate: THREAD_REFERENCE_DATE
    });
    const tyler = parseRcsThread(TYLER_REMINDERS_THREAD_EXPORT, {
      referenceDate: THREAD_REFERENCE_DATE
    });
    const merged = mergeAndSortMessages([...shawn, ...tyler]);
    expect(merged.length).toBe(shawn.length + tyler.length);
  });
});
