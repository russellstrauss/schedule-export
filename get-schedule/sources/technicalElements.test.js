import { afterEach, describe, expect, it } from "vitest";
import { isEventCancelled, toGoogleEvent } from "../utils.js";
import { getSourcePurgePolicy } from "../google-calendar/purge-policy.js";
import {
  classifyTechnicalElementsOffer,
  collectUpcomingRoles,
  DEFAULT_API_BASE,
  DEFAULT_LOGIN_URL,
  DEFAULT_TIMEZONE,
  getCredentials,
  mapTechnicalElementsRole,
  sourceDisplayName,
  sourceId,
  zonedPartsFromIso
} from "./technicalElements.js";

const originalEnv = {
  TECHNICAL_ELEMENTS_EMAIL: process.env.TECHNICAL_ELEMENTS_EMAIL,
  TECHNICAL_ELEMENTS_PASSWORD: process.env.TECHNICAL_ELEMENTS_PASSWORD
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function role(overrides = {}) {
  return {
    id: 55,
    crewJobId: 900,
    crewJobStatus: "approved",
    name: "A2",
    area: "Audio",
    startDate: "2026-06-15T14:30:00.000Z",
    endDate: "2026-06-15T22:00:00.000Z",
    job: {
      id: 12,
      headline: "Summerfest",
      locationShortName: "State Farm Arena",
      address: "1 State Farm Dr, Atlanta, GA",
      timezone: "America/New_York",
      ...overrides.job
    },
    primaryContact: {
      fullName: "Alex Kim",
      phone: "404-555-0100",
      email: "alex@example.com"
    },
    ...overrides,
    job: {
      id: 12,
      headline: "Summerfest",
      locationShortName: "State Farm Arena",
      address: "1 State Farm Dr, Atlanta, GA",
      timezone: "America/New_York",
      ...overrides.job
    }
  };
}

describe("technical elements credentials", () => {
  it("stays disabled until both portal credentials are set", () => {
    delete process.env.TECHNICAL_ELEMENTS_EMAIL;
    delete process.env.TECHNICAL_ELEMENTS_PASSWORD;
    expect(getCredentials()).toBeNull();
  });

  it("uses the fixed login page, api, and timezone", () => {
    process.env.TECHNICAL_ELEMENTS_EMAIL = "crew@example.com";
    process.env.TECHNICAL_ELEMENTS_PASSWORD = "secret";
    expect(getCredentials()).toMatchObject({
      email: "crew@example.com",
      password: "secret",
      loginUrl: DEFAULT_LOGIN_URL,
      timezone: DEFAULT_TIMEZONE,
      apiBase: DEFAULT_API_BASE
    });
  });
});

describe("technical elements shifts", () => {
  it("uses the staffing company name and not the portal name", () => {
    expect(sourceId).toBe("technicalElements");
    expect(sourceDisplayName).toBe("Technical Elements");
    expect(sourceDisplayName.toLowerCase()).not.toContain("liveforce");
    expect(sourceId.toLowerCase()).not.toContain("liveforce");
  });

  it("converts a UTC start into the venue timezone", () => {
    expect(zonedPartsFromIso("2026-06-15T14:30:00.000Z", "America/New_York")).toMatchObject({
      date: "6/15/2026",
      callTime: "10:30"
    });
    expect(zonedPartsFromIso("2026-11-15T15:30:00.000Z", "America/New_York")).toMatchObject({
      date: "11/15/2026",
      callTime: "10:30"
    });
    expect(zonedPartsFromIso("2026-06-15T14:30:00.000Z", "America/Chicago").callTime).toBe("09:30");
  });

  it("maps a booked shift onto a confirmed calendar event labeled Technical Elements", () => {
    const entry = mapTechnicalElementsRole(role());
    expect(entry).toMatchObject({
      source: "technicalElements",
      date: "6/15/2026",
      callTime: "10:30",
      show: "Summerfest",
      venue: "State Farm Arena",
      location: "1 State Farm Dr, Atlanta, GA",
      position: "A2",
      type: "Audio",
      status: "confirmed",
      offerState: "accepted",
      isCallCancelled: false
    });
    expect(entry.details).toContain("Until 6:00 PM");
    expect(entry.details).toContain("Contact: Alex Kim · 404-555-0100 · alex@example.com");
    expect(entry.details).toContain("https://app.liveforce.co/confirmed-role/55");
    expect(isEventCancelled(entry)).toBe(false);

    const event = toGoogleEvent(entry, { source: sourceId });
    expect(event.summary).toBe("10am (SFA) Summerfest - A2 [Technical Elements]");
    expect(event.summary).not.toMatch(/liveforce/i);
    expect(event.status).toBe("confirmed");
    expect(event.location).toBe("State Farm Arena - 1 State Farm Dr, Atlanta, GA");
  });

  it("marks invitations and applications as unconfirmed", () => {
    expect(classifyTechnicalElementsOffer({ crewJobStatus: "invited" })).toBe("pending");
    expect(classifyTechnicalElementsOffer({ crewJobStatus: "pending", reserved: true })).toBe("pending");
    const entry = mapTechnicalElementsRole(role({ crewJobStatus: "invited", reserved: true }));
    expect(entry.offerState).toBe("pending");
    expect(entry.details).toContain("Reserve list");
    expect(entry.details).toContain("/job-board/12/role/55");

    const event = toGoogleEvent(entry, { source: sourceId });
    expect(event.summary).toBe("UNCONFIRMED => 10am (SFA) Summerfest - A2 [Technical Elements]");
    expect(event.status).toBe("tentative");
  });

  it("treats cancelled and declined shifts as removed calls", () => {
    for (const crewJobStatus of ["cancelledByAdmin", "cancelledInvitationByFreelancer", "declined"]) {
      const entry = mapTechnicalElementsRole(role({ crewJobStatus }));
      expect(entry.offerState).toBe("declined");
      expect(isEventCancelled(entry)).toBe(true);
    }
  });

  it("uses the role name as the show when the event headline is the same", () => {
    const entry = mapTechnicalElementsRole(
      role({
        name: "Load In",
        area: "Stage",
        job: { headline: "Load In", locationShortName: "", address: "The Tabernacle" }
      })
    );
    expect(entry.show).toBe("Load In");
    expect(entry.position).toBe("Stage");
    expect(entry.venue).toBe("The Tabernacle");
    expect(entry.location).toBe("");
    expect(toGoogleEvent(entry, { source: sourceId }).summary).toBe(
      "10am (TB) Load In - Stage [Technical Elements]"
    );
  });

  it("returns null when a shift has no start time", () => {
    expect(mapTechnicalElementsRole(role({ startDate: "" }))).toBeNull();
  });
});

describe("technical elements upcoming pages", () => {
  it("follows the day cursor and ignores roles already seen", async () => {
    const queries = [];
    const roles = await collectUpcomingRoles(
      async (query) => {
        queries.push(query);
        if (!query.offset) {
          return {
            ok: true,
            status: 200,
            body: {
              data: {
                dates: [
                  {
                    date: "2026-06-15",
                    roles: [role({ crewJobId: 1 })]
                  },
                  {
                    date: "2026-06-16",
                    roles: [role({ crewJobId: 2, id: 56 })]
                  }
                ]
              }
            }
          };
        }
        return {
          ok: true,
          status: 200,
          body: {
            data: {
              dates: [
                {
                  date: "2026-06-17",
                  roles: [
                    role({ crewJobId: 2, id: 56 }),
                    role({ crewJobId: 3, id: 57 })
                  ]
                }
              ]
            }
          }
        };
      },
      { perPage: 2, maxPages: 5 }
    );

    expect(queries.map((query) => query.offset)).toEqual([null, "2026-06-16"]);
    expect(roles.map((item) => item.crewJobId)).toEqual([1, 2, 3]);
  });

  it("stops when a page is shorter than the requested day count", async () => {
    let calls = 0;
    const roles = await collectUpcomingRoles(async () => {
      calls += 1;
      return {
        ok: true,
        body: { data: { dates: [{ date: "2026-06-15", roles: [role()] }] } }
      };
    }, { perPage: 2 });
    expect(calls).toBe(1);
    expect(roles).toHaveLength(1);
  });

  it("refuses a partial snapshot when paging cannot finish", async () => {
    await expect(
      collectUpcomingRoles(
        async (query) => ({
          ok: true,
          body: {
            data: {
              dates: [
                {
                  date: query.offset ? "2026-06-17" : "2026-06-16",
                  roles: [role({ crewJobId: query.offset ? 2 : 1 })]
                }
              ]
            }
          }
        }),
        { perPage: 1, maxPages: 1 }
      )
    ).rejects.toThrow(/stopped before the last page/);
  });

  it("raises the portal error when the calendar request fails", async () => {
    await expect(
      collectUpcomingRoles(async () => ({
        ok: false,
        status: 401,
        body: { message: "Unauthorized" }
      }))
    ).rejects.toThrow(/calendar request failed \(401\): Unauthorized/);
  });
});

describe("technical elements purge policy", () => {
  it("keeps past Technical Elements calls and leaves the other portals alone", () => {
    expect(getSourcePurgePolicy("technicalElements")).toMatchObject({
      keepPastEvents: true,
      deleteRecentPastIfAbsent: false,
      deletePastIfAbsent: false
    });
    expect(getSourcePurgePolicy("crewOne").keepPastEvents).toBe(true);
    expect(getSourcePurgePolicy("rhino").keepPastEvents).toBe(false);
    expect(getSourcePurgePolicy("rhino").deleteRecentPastIfAbsent).toBe(true);
    expect(getSourcePurgePolicy("iatse927").deletePastIfAbsent).toBe(true);
  });
});

describe("technical elements fetch", () => {
  it("logs in and maps the upcoming calendar", async () => {
    process.env.TECHNICAL_ELEMENTS_EMAIL = "crew@example.com";
    process.env.TECHNICAL_ELEMENTS_PASSWORD = "secret";

    const typed = [];
    const queries = [];
    const page = {
      async setUserAgent() {},
      async goto(url) {
        this.currentUrl = url;
      },
      async waitForSelector() {},
      async click() {},
      keyboard: { async press() {} },
      async type(selector, value) {
        typed.push([selector, value]);
      },
      async $(selector) {
        expect(selector).toBe(".login-form__login-btn");
        return { async click() {} };
      },
      url() {
        return "https://app.liveforce.co/my-calendar/upcoming";
      },
      async waitForFunction() {},
      async evaluate(_fn, arg) {
        queries.push(arg);
        return {
          ok: true,
          status: 200,
          body: {
            data: {
              dates: [
                {
                  date: "2026-06-15",
                  roles: [role({ crewJobStatus: "approved" })]
                }
              ]
            }
          }
        };
      }
    };

    const { fetchSchedule } = await import("./technicalElements.js");
    const entries = await fetchSchedule(page);
    expect(typed).toEqual([
      ["#email", "crew@example.com"],
      ["#password", "secret"]
    ]);
    expect(page.currentUrl).toBe("https://app.liveforce.co/login");
    expect(queries[0]).toMatchObject({
      apiBase: "https://admin.liveforce.co/proxy/api",
      timezone: "America/New_York",
      offset: null
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].show).toBe("Summerfest");
    expect(entries[0].offerState).toBe("accepted");
  });

  it("stops when the login button is missing", async () => {
    process.env.TECHNICAL_ELEMENTS_EMAIL = "crew@example.com";
    process.env.TECHNICAL_ELEMENTS_PASSWORD = "secret";
    const page = {
      async setUserAgent() {},
      async goto() {},
      async waitForSelector() {},
      async click() {},
      keyboard: { async press() {} },
      async type() {},
      async $() {
        return null;
      },
      url() {
        return "https://app.liveforce.co/login";
      }
    };
    const { fetchSchedule } = await import("./technicalElements.js");
    await expect(fetchSchedule(page)).rejects.toThrow(/login button was not found/);
  });
});
