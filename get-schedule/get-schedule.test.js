import { describe, it, expect } from "vitest";
import { formatDeadlineReminderLogLine } from "./get-schedule.js";

describe("formatDeadlineReminderLogLine", () => {
  it("formats a crewOne deadline reminder log line", () => {
    const line = formatDeadlineReminderLogLine(
      {
        summary: "Offer deadline: A TEST SHOW",
        start: "2026-07-24T09:00:00"
      },
      "crewOne"
    );

    expect(line).toContain("deadline reminder");
    expect(line).toContain("Offer deadline: A TEST SHOW");
    expect(line).toContain("2026-07-24T09:00:00");
  });
});
