import { formatDateTimeForTimezone, isEventInFuture, scheduleRowId } from "../utils.js";
import { gotoPortalPage, configurePortalPage } from "../puppeteer.js";

export const sourceId = "crewOne";

const DEFAULT_LOGIN_URL = "https://portal.crew1.com/";

/** @returns {string[]} */
export function missingCredentialEnvVars() {
  const missing = [];
  if (!process.env.CREWONE_EMAIL) missing.push("CREWONE_EMAIL");
  if (!process.env.CREWONE_PASSWORD) missing.push("CREWONE_PASSWORD");
  return missing;
}

export function getCredentials() {
  const missing = missingCredentialEnvVars();
  if (missing.length > 0) return null;
  const loginUrl = process.env.CREWONE_LOGIN_URL || DEFAULT_LOGIN_URL;
  return {
    email: process.env.CREWONE_EMAIL,
    password: process.env.CREWONE_PASSWORD,
    loginUrl
  };
}

/** Crew One dashboard: "Fri Jun 12 8:00 AM" (after normalizeCrew1DateTimeText) */
const CREW1_DATETIME_PATTERN =
  /^\w{3}\s+\w{3}\s+\d{1,2}\s+\d{1,2}:\d{2}\s*(AM|PM)$/i;
const CREW1_OFFER_DEADLINE_PATTERN =
  /this offer closes\s+([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i;
const CREW1_MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12
};

/** Insert space when day and time are glued (e.g. "Jun 128:00 AM"), not "Jun 12 10:30 PM". */
export function normalizeCrew1DateTimeText(dateTimeText) {
  if (!dateTimeText) return "";
  return dateTimeText
    .trim()
    .replace(/\s+/g, " ")
    .replace(/,\s*\d{4}\b/, "")
    .replace(/(\w{3}\s+\d{1,2})(\d{1,2}:\d{2}\s*(?:AM|PM))/i, "$1 $2");
}

export function parseCrew1DateTime(dateTimeText, referenceYear = new Date().getFullYear()) {
  const text = normalizeCrew1DateTimeText(dateTimeText);
  if (!text || !CREW1_DATETIME_PATTERN.test(text)) return null;

  const parsed = Date.parse(`${text} ${referenceYear}`);
  if (Number.isNaN(parsed)) return null;

  const d = new Date(parsed);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const year = d.getFullYear();
  const hours = d.getHours();
  const minutes = d.getMinutes();

  return {
    date: `${month}/${day}/${year}`,
    callTime: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
  };
}

export function parseCrewOneOfferDeadline(text) {
  if (!text) return null;
  const match = text.match(CREW1_OFFER_DEADLINE_PATTERN);
  if (!match) return null;

  const [, monthName, dayText, yearText, hoursText, minutesText, ampm] = match;
  const month = CREW1_MONTHS[monthName.toLowerCase()];
  if (month == null) return null;

  let hours = Number(hoursText);
  const minutes = Number(minutesText);
  const normalizedAmpm = ampm?.toUpperCase();
  if (normalizedAmpm === "PM" && hours < 12) hours += 12;
  if (normalizedAmpm === "AM" && hours === 12) hours = 0;

  return {
    month,
    day: Number(dayText),
    year: Number(yearText),
    hours,
    minutes,
    text: text.trim()
  };
}

export function parseCrewOneOfferState(text) {
  const normalized = (text || "").toLowerCase();

  if (/\baccepted?\b/.test(normalized) && !/accept or decline|accept\/decline|please accept|to accept/i.test(normalized)) {
    return "accepted";
  }

  if (
    (/\bdenied?\b|\bdeclined?\b/.test(normalized)) &&
    !/accept or decline|accept\/decline|please decline|to decline/i.test(normalized)
  ) {
    return "declined";
  }

  return "pending";
}

export function buildCrewOneDeadlineReminderEvent(entry, deadline = parseCrewOneOfferDeadline(entry?.offerDeadlineText)) {
  if (!entry || !deadline) return null;
  const offerState = String(entry.offerState || "pending").toLowerCase();
  if (offerState === "accepted" || offerState === "declined" || offerState === "denied") {
    return null;
  }

  const { year, month, day, hours, minutes } = deadline;
  if (!isEventInFuture(year, month, day, hours, minutes, "America/New_York")) {
    return null;
  }

  const rowId = entry.rowId || scheduleRowId(entry);
  const location = [entry.venue, entry.location].filter(Boolean).join(" - ");
  const start = formatDateTimeForTimezone(year, month, day, hours, minutes);
  const end = formatDateTimeForTimezone(year, month, day, hours, minutes + 30);

  return {
    source: sourceId,
    kind: "deadlineReminder",
    rowId: `${rowId}|deadlineReminder`,
    summary: `Offer deadline: ${entry.show}`,
    location,
    description: [`Deadline reminder for ${entry.show}`, "", deadline.text].join("\n"),
    start,
    end,
    status: "confirmed",
    reminders: {
      useDefault: false,
      overrides: [{ method: "popup", minutes: 0 }]
    }
  };
}

/**
 * @param {import("./types.js").ScheduleEntry["date"]} date
 * @param {import("./types.js").ScheduleEntry["callTime"]} callTime
 * @param {{ job?: string, startDateTime?: string, contractorNotes?: string }} call
 */
export function matchDetailCall(date, callTime, call) {
  if (!call?.startDateTime) return false;
  const when = parseCrew1DateTime(call.startDateTime);
  return Boolean(when && when.date === date && when.callTime === callTime);
}

/**
 * @param {{
 *   eventTypeLine?: string;
 *   generalNotes?: string;
 *   venueNotes?: string;
 * } | null | undefined} detail
 * @param {{ job?: string; contractorNotes?: string }} call
 */
export function formatCrewOneEventDescription(detail, call) {
  const parts = [];
  if (detail?.eventTypeLine) parts.push(detail.eventTypeLine);
  if (call?.job) parts.push(`Position: ${call.job}`);
  if (call?.contractorNotes) parts.push(`Call notes: ${call.contractorNotes}`);
  if (detail?.generalNotes) parts.push(detail.generalNotes);
  if (detail?.venueNotes) parts.push(detail.venueNotes);
  return parts.filter(Boolean).join("\n\n");
}

/**
 * @param {import("puppeteer").Page} page
 */
async function loginAndOpenDashboard(page, creds) {
  // Allow a longer navigation timeout for slower devices/networks.
  await page.goto(creds.loginUrl, { waitUntil: "networkidle2", timeout: 120000 });

  // Try a set of selectors for the email and password fields to be resilient
  // to portal markup/placeholder changes. Use the first selector that exists.
  const emailSelectors = [
    'input[placeholder="Email Address..."]',
    'input[placeholder*="Email"]',
    'input[type="email"]',
    'input[name="email"]',
    'input[id*="email"]'
  ];
  const passwordSelectors = [
    'input[placeholder="Password..."]',
    'input[placeholder*="Password"]',
    'input[type="password"]',
    'input[name="password"]',
    'input[id*="password"]'
  ];

  async function findAndType(selectors, value) {
    for (const sel of selectors) {
      const el = await page.$(sel);
      if (el) {
        try {
          await page.focus(sel);
        } catch (e) {}
        await page.evaluate((s) => (document.querySelector(s).value = ""), sel).catch(() => {});
        await page.type(sel, value, { delay: 15 });
        return true;
      }
    }
    return false;
  }

  const emailFilled = await findAndType(emailSelectors, creds.email);
  const passwordFilled = await findAndType(passwordSelectors, creds.password);

  if (!emailFilled || !passwordFilled) {
    throw new Error(
      "Crew One login fields not found or changed. Check the portal markup or update selectors."
    );
  }

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /login/i.test(b.textContent || ""));
    btn?.click();
  });

  // Wait for the post-login redirect to settle on any authenticated route
  // (not the login page). The portal may redirect to an interstitial instead
  // of the dashboard, so don't wait specifically for "dashboard" here.
  await page
    .waitForFunction(
      () => {
        const p = window.location.pathname;
        return p !== "/" && !/login/i.test(p);
      },
      { timeout: 30000 }
    )
    .catch(() => {});
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 30000 }).catch(() => {});

  const pathname = new URL(page.url()).pathname;
  if (/bgcheck/i.test(pathname)) {
    throw new Error(
      `Crew One is blocking the dashboard behind a Background Check Consent. ` +
        `Log in at ${creds.loginUrl}, complete the consent flow, then re-run the sync. ` +
        `(stuck on ${pathname})`
    );
  }

  // Some accounts or portal versions land on a different authenticated path
  // (not necessarily containing "dashboard"). Don't fail immediately on
  // pathname mismatch — rely on the dashboardReady heuristic below which
  // checks the page content for known dashboard sections.
  if (!pathname.includes("dashboard")) {
    console.warn(
      `Crew One landed on "${pathname}" after login — continuing to check page content.`
    );
  }

  // Confirm the dashboard widgets actually rendered. The "Upcoming Calls" section is
  // omitted entirely when there are no upcoming calls, so we can't rely on it to
  // detect a successful load. Other dashboard sections always render once logged in;
  // requiring one of them lets an empty "Upcoming Calls" be trusted as authoritative
  // (genuinely no calls) rather than a half-loaded page.
  const dashboardReady = await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].some((h) =>
          /Upcoming Calls|Events Worked|Most Recent Payments|Offers Needing Your Response/i.test(
            h.textContent || ""
          )
        ),
      { timeout: 15000 }
    )
    .then(() => true)
    .catch(() => false);

  if (!dashboardReady) {
    throw new Error(
      "Crew One dashboard did not finish loading (no recognizable dashboard sections found)."
    );
  }

  // (No automatic expansion clicks here — clicking globally can change the
  // dashboard state in ways that break scraping. If the portal requires an
  // explicit interaction to show more events, we should add a targeted
  // click for the specific control once identified.)
}

/**
 * @param {import("puppeteer").Page} page
 */
async function scrapeUpcomingRows(page) {
  return page.evaluate(() => {
    const trim = (s) => (s || '').trim();
    const monthNames = /january|february|march|april|may|june|july|august|september|october|november|december/i;
    const timePattern = /\d{1,2}:\d{2}\s*(AM|PM)/i;

    const extractFromTable = (table) =>
      [...table.querySelectorAll('tbody tr')]
        .filter((tr) => !tr.querySelector('th') && tr.querySelectorAll('td').length >= 3)
        .map((tr) => {
          const cells = [...tr.querySelectorAll('td')];
          const detailLink = tr.querySelector('a[title="View Details"]') || tr.querySelector('td:last-child a');
          return {
            event: trim(cells[0].innerText || cells[0].textContent),
            where: trim(cells[1].innerText || cells[1].textContent),
            dateTime: trim(cells[2].innerText || cells[2].textContent),
            detailUrl: detailLink?.href || null
          };
        })
        .filter((row) => row.event);

    // Locate the "Upcoming Calls" heading (case-insensitive) and search its
    // ancestor for multiple candidate row containers (tables, lists, cards).
    const heading = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].find((h) =>
      /Upcoming Calls/i.test((h.textContent || '').trim())
    );

    const results = [];

    if (heading) {
      let container = heading.parentElement;
      for (let i = 0; i < 10 && container; i++) {
        // Try tables first
        const tables = [...container.querySelectorAll('table')];
        for (const t of tables) {
          const rows = extractFromTable(t);
          for (const r of rows) results.push(r);
        }

        // Try list items and card-like elements
        const candidateSelectors = ['li', '.upcoming-row', '.upcoming-item', '.event', '.card', '.list-item', '.row'];
        for (const sel of candidateSelectors) {
          const elems = [...container.querySelectorAll(sel)];
          for (const el of elems) {
            const text = (el.innerText || el.textContent || '').trim();
            if (!text) continue;
            // Heuristic extraction: lines, find event/where/date/time
            const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
            if (lines.length < 2) continue;
            const detailLink = el.querySelector('a[href*="/view_upcoming/"]') || el.querySelector('a[title="View Details"]') || el.querySelector('a');
            const eventLine = lines.find((l) => !/info|view|details/i.test(l) && !timePattern.test(l) && !monthNames.test(l)) || lines[0];
            const dateLine = lines.find((l) => monthNames.test(l) || /\bMon|Tue|Wed|Thu|Fri|Sat|Sun\b/i.test(l)) || '';
            const timeLine = lines.find((l) => timePattern.test(l)) || '';
            results.push({ event: eventLine, where: '', dateTime: [dateLine, timeLine].filter(Boolean).join(' '), detailUrl: detailLink?.href || null });
          }
        }

        if (results.length > 0) break;
        container = container.parentElement;
      }
    }

    if (results.length > 0) return results;

    // Fallback to scanning all tables in the document
    const allTables = [...document.querySelectorAll('table')];
    for (const t of allTables) {
      const rows = extractFromTable(t);
      for (const r of rows) results.push(r);
    }
    if (results.length > 0) return results;

    // Final fallback: find any view_upcoming anchors and heuristic-extract
    const anchors = [...document.querySelectorAll('a[href*="/view_upcoming/"]')];
    const seen = new Set();
    for (const a of anchors) {
      const href = a.href || a.getAttribute('href');
      if (!href || seen.has(href)) continue;
      seen.add(href);
      const block = a.closest('tr, li, .card, .event, div') || a.parentElement;
      const text = (block && (block.innerText || block.textContent)) || (a.innerText || a.textContent) || '';
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) continue;
      let eventLine = lines.find((l) => !/info|view|details/i.test(l) && !timePattern.test(l) && !monthNames.test(l));
      if (!eventLine) eventLine = lines[0];
      const dateLine = lines.find((l) => monthNames.test(l) || /\bMon|Tue|Wed|Thu|Fri|Sat|Sun\b/i.test(l)) || '';
      const timeLine = lines.find((l) => timePattern.test(l)) || '';
      results.push({ event: eventLine, where: '', dateTime: [dateLine, timeLine].filter(Boolean).join(' '), detailUrl: href });
    }

    return results;
  });
}

/**
 * @param {import("puppeteer").Page} page
 */
async function scrapeEventDetail(page) {
  return page.evaluate(() => {
    const bodyText = document.body.innerText || "";

    const eventTypeMatch = bodyText.match(/This is an? [A-Z]+ Event\.?/i);
    const eventTypeLine = eventTypeMatch ? eventTypeMatch[0].trim() : "";

    const callTable = [...document.querySelectorAll("table")].find((t) =>
      /job\/task/i.test(t.textContent || "")
    );
    const calls = callTable
      ? [...callTable.querySelectorAll("tbody tr")]
          .filter((tr) => tr.querySelectorAll("td").length >= 2)
          .map((tr) => {
            const cells = [...tr.querySelectorAll("td")];
            return {
              job: (cells[0].innerText || cells[0].textContent).trim(),
              startDateTime: (cells[1].innerText || cells[1].textContent).trim(),
              contractorNotes: (cells[2]?.innerText || cells[2]?.textContent || "").trim()
            };
          })
          .filter((c) => c.job && c.startDateTime)
      : [];

    const sliceSection = (startLabel, endLabel) => {
      const start = bodyText.indexOf(startLabel);
      if (start < 0) return "";
      const contentStart = start + startLabel.length;
      const end =
        endLabel != null ? bodyText.indexOf(endLabel, contentStart) : bodyText.length;
      const slice = bodyText.slice(contentStart, end < 0 ? bodyText.length : end);
      return slice.replace(/^\s*[\n\r]+/, "").trim();
    };

    const generalNotes = sliceSection("NOTE:", "VENUE NOTE:");
    const venueNotes = sliceSection("VENUE NOTE:", "©");
    const offerDeadlineText = bodyText.match(/this offer closes[^.\n\r]*/i)?.[0].trim() || "";
    const normalizedBodyText = (bodyText || "").toLowerCase();
    const offerState = /\baccepted?\b/.test(normalizedBodyText)
      ? "accepted"
      : /\bdenied?\b|\bdeclined?\b/.test(normalizedBodyText)
        ? "declined"
        : "pending";

    return {
      eventTypeLine: eventTypeLine || "",
      calls,
      generalNotes,
      venueNotes,
      offerDeadlineText,
      offerState
    };
  });
}

/**
 * @param {import("puppeteer").Page} page
 * @param {string} detailUrl
 * @param {Map<string, Awaited<ReturnType<typeof scrapeEventDetail>>>} cache
 */
async function fetchEventDetail(page, detailUrl, cache) {
  if (cache.has(detailUrl)) return cache.get(detailUrl);
  await page.goto(detailUrl, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 30000 }).catch(() => {});
  const detail = await scrapeEventDetail(page);
  cache.set(detailUrl, detail);
  return detail;
}

/**
 * Try to find an export (.ics) link on the page and fetch/parse it.
 * Returns an array of parsed VEVENT objects or null if none found.
 */
async function fetchAndParseIcsFromPage(page) {
  try {
    // Find candidate export links or buttons in the page context
    const href = await page.evaluate(() => {
      // Look for explicit .ics links first
      const a1 = [...document.querySelectorAll('a')].find(a => (a.href || '').toLowerCase().includes('.ics'));
      if (a1) return a1.href;

      // Look for anchors/buttons with export text
      const textMatch = [...document.querySelectorAll('a,button')].find(el => /export to your calendar|export|ics|download calendar/i.test((el.textContent||'').trim()));
      if (textMatch) return textMatch.getAttribute('href') || null;

      // Look for data attributes that may contain an export URL
      const dataEl = [...document.querySelectorAll('[data-export]')].find(el => el.getAttribute('data-export'));
      if (dataEl) return dataEl.getAttribute('data-export');

      return null;
    });

    if (!href) return null;
    const url = new URL(href, page.url()).toString();

    // Fetch ICS text via the page context to include session cookies
    const ics = await page.evaluate(async (u) => {
      try {
        const res = await fetch(u, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
      } catch (e) {
        return null;
      }
    }, url);

    if (!ics) return null;

    return parseIcs(ics);
  } catch (e) {
    return null;
  }
}

function unfoldIcs(icsText) {
  // Unfold folded lines per RFC 5545 (lines starting with space or tab)
  return icsText.replace(/\r?\n[ \t]/g, "");
}

function parseIcsDate(val) {
  // Handle formats like: 20260818T120000Z or 20260818T080000 or 2026-08-18T08:00:00Z
  if (!val) return null;
  // If ISO-like with dashes
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:?\d{0,2}Z?$/.test(val)) {
    const d = new Date(val);
    if (!Number.isNaN(d.getTime())) return d;
  }
  // Compact form
  const m = val.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (m) {
    const year = Number(m[1]), month = Number(m[2]) - 1, day = Number(m[3]);
    const hour = Number(m[4]), minute = Number(m[5]), second = Number(m[6]);
    if (m[7] === 'Z') {
      return new Date(Date.UTC(year, month, day, hour, minute, second));
    }
    return new Date(year, month, day, hour, minute, second);
  }
  // Fallback: try Date constructor
  const d2 = new Date(val);
  if (!Number.isNaN(d2.getTime())) return d2;
  return null;
}

function parseIcs(icsText) {
  const text = unfoldIcs(icsText);
  const events = [];
  const parts = text.split(/BEGIN:VEVENT/i).slice(1);
  for (const part of parts) {
    const block = part.split(/END:VEVENT/i)[0];
    const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const ev = {};
    for (const line of lines) {
      const [k, ...rest] = line.split(":");
      if (!k) continue;
      const key = k.toUpperCase();
      const value = rest.join(":");
      if (key.startsWith('SUMMARY')) ev.summary = value;
      else if (key.startsWith('DTSTART')) ev.dtstart = parseIcsDate(value);
      else if (key.startsWith('DTEND')) ev.dtend = parseIcsDate(value);
      else if (key.startsWith('LOCATION')) ev.location = value;
      else if (key.startsWith('DESCRIPTION')) ev.description = value;
      else if (key.startsWith('UID')) ev.uid = value;
    }
    events.push(ev);
  }
  return events;
}

/**
 * @param {import("puppeteer").Page} page
 * @returns {Promise<import("./types.js").ScheduleEntry[]>}
 */
export async function fetchSchedule(page) {
  const creds = getCredentials();
  if (!creds) {
    throw new Error(
      "Missing CREWONE_EMAIL or CREWONE_PASSWORD. Set both to enable the crewOne source."
    );
  }

  await loginAndOpenDashboard(page, creds);
  // Give the page a chance to lazy-load more content by scrolling a few times.
  await page.evaluate(() =>
    new Promise((resolve) => {
      let total = 0;
      const step = 800;
      const max = 8;
      const id = setInterval(() => {
        window.scrollBy(0, step);
        total += 1;
        if (total >= max) {
          clearInterval(id);
          resolve(true);
        }
      }, 250);
      setTimeout(() => {
        clearInterval(id);
        resolve(true);
      }, 4000);
    })
  ).catch(() => {});

  const rawRows = await scrapeUpcomingRows(page);
  // Prefer the dashboard rows; fall back to the dedicated list page below.

  // If the dashboard produced too few rows, try the portal's dedicated
  // upcoming list page which sometimes contains the full event list.
  if (!rawRows || rawRows.length <= 1) {
    try {
      const base = creds.loginUrl.replace(/\/$/, "");
      const listUrl = new URL('/view_upcoming', base).toString();
      await gotoPortalPage(page, listUrl);
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => {});
      const altRows = await scrapeUpcomingRows(page);
      if (altRows && altRows.length > (rawRows ? rawRows.length : 0)) {
        // use altRows instead of rawRows (mutate rawRows variable)
        rawRows.length = 0;
        Array.prototype.push.apply(rawRows, altRows);
      }
    } catch (e) {
      // ignore; keep original rawRows
    }
  }

  const referenceYear = new Date().getFullYear();
  const parsedRows = rawRows.map((r) => ({ ...r, when: parseCrew1DateTime(r.dateTime, referenceYear) }));

  const entries = [];
  for (const rowObj of parsedRows) {
    const when = rowObj.when;
    if (!when) {
      if (rowObj.dateTime && String(rowObj.dateTime).trim() !== "") {
        console.warn(`[crewOne] Could not parse date/time: "${rowObj.dateTime}" for ${rowObj.event}`);
      }
      continue;
    }

    const showLower = rowObj.event.toLowerCase();
    if (showLower.includes("cancelled") || showLower.includes("canceled")) {
      continue;
    }

    entries.push({
      source: sourceId,
      date: when.date,
      callTime: when.callTime,
      show: rowObj.event,
      venue: rowObj.where,
      location: "",
      client: "",
      type: "",
      position: "",
      details: "",
      status: "confirmed",
      notes: "",
      isCallCancelled: false,
      offerDeadlineText: "",
      offerState: "pending"
    });
  }

  return entries;
}
