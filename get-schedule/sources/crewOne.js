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
  await page.goto(creds.loginUrl, { waitUntil: "networkidle2", timeout: 60000 });

  await page.waitForSelector('input[placeholder="Email Address..."]', {
    visible: true,
    timeout: 15000
  });
  await page.type('input[placeholder="Email Address..."]', creds.email, { delay: 15 });
  await page.type('input[placeholder="Password..."]', creds.password, { delay: 15 });

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /login/i.test(b.textContent || "")
    );
    btn?.click();
  });

  await page.waitForFunction(
    () => window.location.pathname.includes("dashboard"),
    { timeout: 60000 }
  );
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 30000 }).catch(() => {});
}

/**
 * @param {import("puppeteer").Page} page
 */
async function scrapeUpcomingRows(page) {
  return page.evaluate(() => {
    const heading = [...document.querySelectorAll("h6")].find(
      (h) => h.textContent.trim() === "Upcoming Calls"
    );
    if (!heading) return [];

    let container = heading.parentElement;
    for (let i = 0; i < 8 && container; i++) {
      const table = container.querySelector("table");
      if (!table) {
        container = container.parentElement;
        continue;
      }

      return [...table.querySelectorAll("tbody tr")]
        .filter((tr) => !tr.querySelector("th") && tr.querySelectorAll("td").length >= 3)
        .map((tr) => {
          const cells = [...tr.querySelectorAll("td")];
          const detailLink =
            tr.querySelector('a[title="View Details"]') || tr.querySelector("td:last-child a");
          return {
            event: (cells[0].innerText || cells[0].textContent).trim(),
            where: (cells[1].innerText || cells[1].textContent).trim(),
            dateTime: (cells[2].innerText || cells[2].textContent).trim(),
            detailUrl: detailLink?.href || null
          };
        })
        .filter((row) => row.event);
    }
    return [];
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

    return {
      eventTypeLine: eventTypeLine || "",
      calls,
      generalNotes,
      venueNotes
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
  const rawRows = await scrapeUpcomingRows(page);

  const detailCache = new Map();
  const uniqueDetailUrls = [...new Set(rawRows.map((r) => r.detailUrl).filter(Boolean))];
  for (const detailUrl of uniqueDetailUrls) {
    console.log(`[crewOne] Loading event details: ${detailUrl}`);
    await fetchEventDetail(page, detailUrl, detailCache);
  }

  const referenceYear = new Date().getFullYear();
  const entries = [];

  for (const row of rawRows) {
    const when = parseCrew1DateTime(row.dateTime, referenceYear);
    if (!when) {
      console.warn(`[crewOne] Could not parse date/time: "${row.dateTime}" for ${row.event}`);
      continue;
    }

    const showLower = row.event.toLowerCase();
    if (showLower.includes("cancelled") || showLower.includes("canceled")) {
      continue;
    }

    const detail = row.detailUrl ? detailCache.get(row.detailUrl) : null;
    const matchedCall =
      detail?.calls?.find((call) => matchDetailCall(when.date, when.callTime, call)) || null;

    const description = formatCrewOneEventDescription(detail, matchedCall);

    entries.push({
      source: sourceId,
      date: when.date,
      callTime: when.callTime,
      show: row.event,
      venue: row.where,
      location: "",
      client: "",
      type:
        detail?.eventTypeLine?.match(/this is an? (.+?) event\.?/i)?.[1]?.toUpperCase() || "",
      position: matchedCall?.job || "",
      details: description,
      status: "confirmed",
      notes: "",
      isCallCancelled: false
    });
  }

  return entries;
}
