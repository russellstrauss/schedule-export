import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { rememberOfferDeadline } from "./offer-deadline-cache.js";
import {
  getCredentials,
  parseCrew1DateTime,
  normalizeCrew1DateTimeText,
  matchDetailCall,
  formatCrewOneEventDescription,
  parseCrewOneOfferDeadline,
  parseCrewOneOfferState,
  buildCrewOneDeadlineReminderEvent,
  isCrewOneOfferUnconfirmed,
  isCrewOneOfferDeclined,
  mapCrewOneDashboardRow,
  isCrewOneActionCell
} from "./crewOne.js";

describe("crewOne", () => {
  const keys = ["CREWONE_EMAIL", "CREWONE_PASSWORD", "CREWONE_LOGIN_URL"];
  const saved = {};

  beforeEach(() => {
    for (const key of keys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("getCredentials returns null when email/password missing", () => {
    expect(getCredentials()).toBeNull();
  });

  it("getCredentials returns config when email and password set", () => {
    process.env.CREWONE_EMAIL = "a@b.com";
    process.env.CREWONE_PASSWORD = "secret";
    const creds = getCredentials();
    expect(creds.email).toBe("a@b.com");
    expect(creds.loginUrl).toBe("https://portal.crew1.com/");
  });

  it("parseCrew1DateTime parses dashboard format", () => {
    const result = parseCrew1DateTime("Fri Jun 12 8:00 AM", 2026);
    expect(result).toEqual({ date: "6/12/2026", callTime: "08:00" });
  });

  it("parseCrew1DateTime handles PM times", () => {
    const result = parseCrew1DateTime("Fri Jun 12 10:30 PM", 2026);
    expect(result).toEqual({ date: "6/12/2026", callTime: "22:30" });
  });

  it("normalizeCrew1DateTimeText fixes missing space between day and hour", () => {
    expect(normalizeCrew1DateTimeText("Fri Jun 128:00 AM")).toBe("Fri Jun 12 8:00 AM");
    expect(parseCrew1DateTime("Fri Jun 128:00 AM", 2026)).toEqual({
      date: "6/12/2026",
      callTime: "08:00"
    });
  });

  it("normalizeCrew1DateTimeText does not split spaced PM times", () => {
    expect(normalizeCrew1DateTimeText("Fri Jun 12 10:30 PM")).toBe("Fri Jun 12 10:30 PM");
  });

  it("parseCrew1DateTime returns null for invalid input", () => {
    expect(parseCrew1DateTime("")).toBeNull();
    expect(parseCrew1DateTime("not a date")).toBeNull();
    expect(parseCrew1DateTime("Respond")).toBeNull();
  });

  it("mapCrewOneDashboardRow maps upcoming and offer column layouts", () => {
    expect(
      mapCrewOneDashboardRow(
        ["GUNS N ROSES 2026", "TRUIST PARK", "Fri Sep 18\n9:00 AM", "info"],
        ["Event", "Where", "Date/Time"],
        "https://portal.crew1.com/view_upcoming/abc"
      )
    ).toEqual({
      event: "GUNS N ROSES 2026",
      where: "TRUIST PARK",
      position: "",
      dateTime: "Fri Sep 18\n9:00 AM",
      detailUrl: "https://portal.crew1.com/view_upcoming/abc"
    });

    expect(
      mapCrewOneDashboardRow(
        ["CHAYANNE 2026", "STAGEHAND", "Respond"],
        ["Event", "Task/Job"],
        "https://portal.crew1.com/response/xyz"
      )
    ).toEqual({
      event: "CHAYANNE 2026",
      where: "",
      position: "STAGEHAND",
      dateTime: "",
      detailUrl: "https://portal.crew1.com/response/xyz"
    });

    expect(
      mapCrewOneDashboardRow(
        ["CHAYANNE 2026", "STAGEHAND", "Respond"],
        [],
        "https://portal.crew1.com/response/xyz"
      )
    ).toMatchObject({
      event: "CHAYANNE 2026",
      position: "STAGEHAND",
      dateTime: ""
    });

    expect(isCrewOneActionCell("Respond")).toBe(true);
  });

  it("parseCrewOneOfferState ignores 'will accept your response' copy", () => {
    expect(
      parseCrewOneOfferState(
        "This offer has already closed. However, we will accept your response and if there is still availability, the scheduler will confirm your selections."
      )
    ).toBe("pending");
    expect(parseCrewOneOfferState("You have accepted this offer.")).toBe("accepted");
  });

  it("parseCrew1DateTime parses detail page call format", () => {
    const result = parseCrew1DateTime("Fri Jun 12, 2026 10:30 PM", 2026);
    expect(result).toEqual({ date: "6/12/2026", callTime: "22:30" });
  });

  it("matchDetailCall matches dashboard row to detail table row", () => {
    const call = { startDateTime: "Fri Jun 12, 2026 8:00 AM", job: "STAGEHAND" };
    expect(matchDetailCall("6/12/2026", "08:00", call)).toBe(true);
    expect(matchDetailCall("6/12/2026", "22:30", call)).toBe(false);
  });

  it("formatCrewOneEventDescription combines detail sections", () => {
    const text = formatCrewOneEventDescription(
      {
        eventTypeLine: "This is a CONCERT Event.",
        generalNotes: "Bring hard hat.",
        venueNotes: "Parking in Ruby lot."
      },
      { job: "STAGEHAND", contractorNotes: "Arrive early" }
    );
    expect(text).toContain("CONCERT Event");
    expect(text).toContain("Position: STAGEHAND");
    expect(text).toContain("Call notes: Arrive early");
    expect(text).toContain("Bring hard hat.");
    expect(text).toContain("Parking in Ruby lot.");
  });

  it("fetchSchedule preserves detail-page offer deadline text for reminder creation", async () => {
    process.env.CREWONE_EMAIL = "a@b.com";
    process.env.CREWONE_PASSWORD = "secret";

    const page = {
      async goto() {},
      async waitForFunction() { return true; },
      async waitForNetworkIdle() {},
      async $(selector) { return { selector }; },
      async focus() { return true; },
      async type() { return true; },
      url() { return "https://portal.crew1.com/dashboard"; },
      evaluate(fn, ...args) {
        const src = String(fn);
        if (src.includes("scrollBy")) return Promise.resolve(true);
        if (src.includes("window.location.pathname")) return Promise.resolve(true);
        if (src.includes("document.querySelector(s).value = \"\"")) return Promise.resolve(null);
        if (src.includes("querySelectorAll(\"button\")") || src.includes("querySelectorAll('button')")) {
          return Promise.resolve(undefined);
        }
        if (src.includes("querySelectorAll('table')") && src.includes("detailLink")) {
          if (/Offers Needing Your Response/i.test(String(args[0] || ""))) {
            return Promise.resolve([]);
          }
          return Promise.resolve([{
            event: "A TEST SHOW",
            where: "The Venue",
            position: "",
            dateTime: "Fri Sep 25 8:00 AM",
            detailUrl: "https://portal.crew1.com/view_upcoming/123"
          }]);
        }
        if (src.includes("querySelectorAll(\"h1,h2,h3,h4,h5,h6\")") || src.includes("querySelectorAll('h1,h2,h3,h4,h5,h6')")) {
          return Promise.resolve([{ textContent: "Upcoming Calls" }]);
        }
        if (src.includes("VENUE NOTE") || src.includes("offerDeadlineText")) {
          return Promise.resolve({
            eventTypeLine: "This is a CONCERT Event.",
            venue: "",
            calls: [],
            generalNotes: "",
            venueNotes: "",
            offerDeadlineText: "This offer closes September 25, 2026 at 9:11 AM",
            offerState: "pending"
          });
        }
        return Promise.resolve(undefined);
      }
    };

    const { fetchSchedule } = await import("./crewOne.js");
    const entries = await fetchSchedule(page);

    expect(entries[0].offerDeadlineText).toBe("This offer closes September 25, 2026 at 9:11 AM");
    expect(entries[0].offerState).toBe("pending");
    expect(buildCrewOneDeadlineReminderEvent(entries[0])).not.toBeNull();
  });

  it("parses crew one offer deadlines and builds a reminder event", () => {
    const deadlineText = "This offer closes September 25, 2026 at 9:11 AM";
    const deadline = parseCrewOneOfferDeadline(deadlineText);
    expect(deadline).toEqual({
      month: 9,
      day: 25,
      year: 2026,
      hours: 9,
      minutes: 11,
      text: deadlineText
    });

    const reminder = buildCrewOneDeadlineReminderEvent(
      {
        source: "crewOne",
        date: "9/25/2026",
        callTime: "08:00",
        show: "A TEST SHOW",
        venue: "The Venue",
        offerDeadlineText: deadlineText
      },
      deadline
    );

    expect(reminder).toMatchObject({
      source: "crewOne",
      kind: "deadlineReminder",
      summary: "Offer deadline: A TEST SHOW",
      start: "2026-09-25T09:11:00",
      end: "2026-09-25T09:41:00",
      rowId: "9/25/2026 | 09:11 | A TEST SHOW | The Venue|deadlineReminder",
      description: expect.stringContaining(deadlineText)
    });
  });

  it("keeps deadline reminders pending when the page only says to accept or decline", () => {
    const state = parseCrewOneOfferState("Please accept or decline this offer by the deadline.");
    expect(state).toBe("pending");

    const reminder = buildCrewOneDeadlineReminderEvent({
      source: "crewOne",
      date: "9/25/2026",
      callTime: "08:00",
      show: "A TEST SHOW",
      venue: "The Venue",
      offerDeadlineText: "This offer closes September 25, 2026 at 9:11 AM",
      offerState: state
    });

    expect(reminder).not.toBeNull();
  });

  it("treats missing offerState as unconfirmed for deadline reminders", () => {
    expect(isCrewOneOfferUnconfirmed({ offerState: "pending" })).toBe(true);
    expect(isCrewOneOfferUnconfirmed({ offerState: "accepted" })).toBe(false);
    expect(isCrewOneOfferDeclined({ offerState: "declined" })).toBe(true);
  });

  it("does not build a deadline reminder after the offer is accepted", () => {
    const reminder = buildCrewOneDeadlineReminderEvent({
      source: "crewOne",
      date: "9/11/2026",
      callTime: "08:00",
      show: "A TEST SHOW",
      venue: "The Venue",
      offerDeadlineText: "This offer closes September 11, 2026 at 9:11 AM",
      offerState: "accepted"
    });
    expect(reminder).toBeNull();
  });

  it("fetchSchedule includes pending offers from Offers Needing Your Response", async () => {
    process.env.CREWONE_EMAIL = "a@b.com";
    process.env.CREWONE_PASSWORD = "secret";

    const detailUrl = "https://portal.crew1.com/response/456";
    const cachePath = path.join(
      os.tmpdir(),
      `crewone-offer-deadlines-test-${Date.now()}.json`
    );
    process.env.CREWONE_OFFER_DEADLINE_CACHE = cachePath;
    rememberOfferDeadline(detailUrl, "This offer closes September 25, 2026 at 9:00 AM");

    const page = {
      async goto() {},
      async waitForFunction() { return true; },
      async waitForNetworkIdle() {},
      async $(selector) { return { selector }; },
      async focus() { return true; },
      async type() { return true; },
      url() { return "https://portal.crew1.com/dashboard"; },
      evaluate(fn, ...args) {
        const src = String(fn);
        if (src.includes("scrollBy")) return Promise.resolve(true);
        if (src.includes("window.location.pathname")) return Promise.resolve(true);
        if (src.includes("document.querySelector(s).value = \"\"")) return Promise.resolve(null);
        if (src.includes("querySelectorAll(\"button\")") || src.includes("querySelectorAll('button')")) {
          return Promise.resolve(undefined);
        }
        if (src.includes("querySelectorAll('table')") && src.includes("detailLink")) {
          if (/Offers Needing Your Response/i.test(String(args[0] || ""))) {
            return Promise.resolve([{
              event: "CHAYANNE 2026",
              where: "",
              position: "STAGEHAND",
              dateTime: "",
              detailUrl
            }]);
          }
          return Promise.resolve([]);
        }
        if (src.includes("VENUE NOTE") || src.includes("offerDeadlineText") || src.includes("your offer response")) {
          return Promise.resolve({
            eventTypeLine: "",
            venue: "STATE FARM ARENA",
            calls: [
              { job: "", startDateTime: "Sun Sep 28, 2026 8:00 AM", contractorNotes: "" },
              { job: "", startDateTime: "Sun Sep 28, 2026 8:30 PM", contractorNotes: "" }
            ],
            generalNotes: "",
            venueNotes: "",
            offerDeadlineText: "",
            offerState: "pending"
          });
        }
        return Promise.resolve(undefined);
      }
    };

    try {
      const { fetchSchedule } = await import("./crewOne.js");
      const entries = await fetchSchedule(page);

      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({
        show: "CHAYANNE 2026",
        venue: "STATE FARM ARENA",
        position: "STAGEHAND",
        date: "9/28/2026",
        callTime: "08:00",
        offerState: "pending",
        offerDeadlineText: "This offer closes September 25, 2026 at 9:00 AM"
      });
      expect(entries[1]).toMatchObject({
        show: "CHAYANNE 2026",
        callTime: "20:30",
        offerState: "pending"
      });
      const reminder = buildCrewOneDeadlineReminderEvent(entries[0]);
      expect(reminder).toMatchObject({
        summary: "Offer deadline: CHAYANNE 2026",
        start: "2026-09-25T09:00:00",
        rowId: "9/25/2026 | 09:00 | CHAYANNE 2026 | STATE FARM ARENA|deadlineReminder"
      });
    } finally {
      delete process.env.CREWONE_OFFER_DEADLINE_CACHE;
      try {
        fs.unlinkSync(cachePath);
      } catch {
        // ignore
      }
    }
  });
});
