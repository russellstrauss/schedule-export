import { gotoPortalPage } from "../puppeteer.js";
import { rememberOfferDeadline, recallOfferDeadline } from "./offer-deadline-cache.js";
import {
  formatCrewOneEventDescription,
  getCredentials,
  isCrewOneActionCell,
  matchDetailCall,
  parseCrew1DateTime,
  sourceId
} from "./crewOne-parse.js";

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
async function scrapePortalRows(page, headingPattern, allowGlobalFallback = false) {
  return page.evaluate((headingPattern, allowGlobalFallback) => {
    const trim = (s) => (s || '').trim();
    const monthNames = /january|february|march|april|may|june|july|august|september|october|november|december/i;
    const monthAbbr = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i;
    const timePattern = /\d{1,2}:\d{2}\s*(AM|PM)/i;
    const headingRe = new RegExp(headingPattern, "i");
    const isAction = (t) => /^(respond|info|view details)$/i.test(trim(t));
    const looksLikeDateTime = (t) => {
      const norm = trim(t).replace(/\s+/g, " ");
      return (monthAbbr.test(norm) || monthNames.test(norm)) && timePattern.test(norm);
    };

    const mapRow = (cellTexts, headerTexts, detailUrl) => {
      const cells = cellTexts.map(trim);
      const headers = headerTexts.map((h) => trim(h).toLowerCase());
      const col = (re) => headers.findIndex((h) => re.test(h));
      const eventIdx = col(/^event$/) >= 0 ? col(/^event$/) : 0;
      const whereIdx = col(/^where$/);
      const jobIdx = col(/task\/?job|^job$|^position$/);
      const dateIdx = col(/date\/?time|^date$/);

      let dateTime = dateIdx >= 0 ? cells[dateIdx] || "" : "";
      if (!dateTime) dateTime = cells.find((t) => looksLikeDateTime(t)) || "";
      if (isAction(dateTime)) dateTime = "";

      let where = whereIdx >= 0 ? cells[whereIdx] || "" : "";
      let position = jobIdx >= 0 ? cells[jobIdx] || "" : "";
      if (!position && !dateTime && cells.length >= 3 && isAction(cells[cells.length - 1])) {
        position = cells[1] || "";
      }

      return {
        event: cells[eventIdx] || cells[0] || "",
        where,
        position,
        dateTime,
        detailUrl: detailUrl || null
      };
    };

    const extractFromTable = (table) => {
      let headerTexts = [...table.querySelectorAll("thead th, thead td")].map((c) =>
        trim(c.innerText || c.textContent)
      );
      if (headerTexts.length === 0) {
        const headerRow = [...table.querySelectorAll("tr")].find((tr) =>
          tr.querySelector("th")
        );
        if (headerRow) {
          headerTexts = [...headerRow.querySelectorAll("th,td")].map((c) =>
            trim(c.innerText || c.textContent)
          );
        }
      }
      return [...table.querySelectorAll("tbody tr, tr")]
        .filter((tr) => !tr.querySelector("th") && tr.querySelectorAll("td").length >= 2)
        .map((tr) => {
          const cells = [...tr.querySelectorAll("td")];
          const cellTexts = cells.map((c) => trim(c.innerText || c.textContent));
          const detailLink =
            tr.querySelector('a[title="View Details"]') ||
            tr.querySelector('a[href*="/response/"]') ||
            tr.querySelector('a[href*="/view_upcoming/"]') ||
            [...tr.querySelectorAll("a")].find((a) =>
              /respond|view details|^info$/i.test(trim(a.textContent || ""))
            ) ||
            tr.querySelector("td:last-child a");
          return mapRow(cellTexts, headerTexts, detailLink?.href || null);
        })
        .filter((row) => row.event && !isAction(row.event));
    };

    // Locate the "Upcoming Calls" heading (case-insensitive) and search its
    // ancestor for multiple candidate row containers (tables, lists, cards).
    const heading = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].find((h) =>
      headingRe.test((h.textContent || '').trim())
    );

    const results = [];

    if (heading) {
      const headingLevel = Number(heading.tagName.slice(1));
      const nextSectionHeading = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(
        (candidate) =>
          candidate !== heading &&
          Number(candidate.tagName.slice(1)) <= headingLevel &&
          Boolean(heading.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING)
      );
      const belongsToSection = (element) => {
        const followsHeading = Boolean(
          heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING
        );
        const precedesNextHeading =
          !nextSectionHeading ||
          Boolean(element.compareDocumentPosition(nextSectionHeading) & Node.DOCUMENT_POSITION_FOLLOWING);
        return followsHeading && precedesNextHeading;
      };

      let container = heading.parentElement;
      for (let i = 0; i < 10 && container; i++) {
        // Try tables first
        const tables = [...container.querySelectorAll('table')].filter(belongsToSection);
        for (const t of tables) {
          const rows = extractFromTable(t);
          for (const r of rows) results.push(r);
        }

        // Try list items and card-like elements
        const candidateSelectors = ['li', '.upcoming-row', '.upcoming-item', '.event', '.card', '.list-item', '.row'];
        for (const sel of candidateSelectors) {
          const elems = [...container.querySelectorAll(sel)].filter(belongsToSection);
          for (const el of elems) {
            const text = (el.innerText || el.textContent || '').trim();
            if (!text) continue;
            // Heuristic extraction: lines, find event/where/date/time
            const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
            if (lines.length < 2) continue;
            const detailLink =
              el.querySelector('a[href*="/view_upcoming/"]') ||
              el.querySelector('a[href*="/response/"]') ||
              el.querySelector('a[title="View Details"]') ||
              el.querySelector('a');
            const eventLine =
              lines.find(
                (l) =>
                  !/info|view|details|respond/i.test(l) &&
                  !timePattern.test(l) &&
                  !monthNames.test(l) &&
                  !monthAbbr.test(l)
              ) || lines[0];
            const dateLine =
              lines.find(
                (l) => monthNames.test(l) || monthAbbr.test(l) || /\bMon|Tue|Wed|Thu|Fri|Sat|Sun\b/i.test(l)
              ) || "";
            const timeLine = lines.find((l) => timePattern.test(l)) || "";
            results.push({
              event: eventLine,
              where: "",
              position: "",
              dateTime: [dateLine, timeLine].filter(Boolean).join(" "),
              detailUrl: detailLink?.href || null
            });
          }
        }

        if (results.length > 0) break;
        container = container.parentElement;
      }
    }

    if (results.length > 0) return results;
    // A present heading defines an authoritative section boundary. If that
    // section is empty, do not fall back to unrelated tables elsewhere on the
    // dashboard and relabel their rows as upcoming calls.
    if (heading) return results;
    if (!allowGlobalFallback) return results;

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
      let eventLine = lines.find(
        (l) =>
          !/info|view|details|respond/i.test(l) &&
          !timePattern.test(l) &&
          !monthNames.test(l) &&
          !monthAbbr.test(l)
      );
      if (!eventLine) eventLine = lines[0];
      const dateLine =
        lines.find(
          (l) => monthNames.test(l) || monthAbbr.test(l) || /\bMon|Tue|Wed|Thu|Fri|Sat|Sun\b/i.test(l)
        ) || "";
      const timeLine = lines.find((l) => timePattern.test(l)) || "";
      results.push({
        event: eventLine,
        where: "",
        position: "",
        dateTime: [dateLine, timeLine].filter(Boolean).join(" "),
        detailUrl: href
      });
    }

    return results;
  }, headingPattern, allowGlobalFallback);
}

async function scrapeUpcomingRows(page) {
  return scrapePortalRows(page, "Upcoming Calls", true);
}

async function scrapeOfferRows(page) {
  return scrapePortalRows(page, "Offers Needing Your Response", false);
}

/**
 * @param {import("puppeteer").Page} page
 */
async function scrapeEventDetail(page) {
  return page.evaluate(() => {
    const trim = (s) => (s || "").trim();
    const bodyText = document.body.innerText || "";

    const eventTypeMatch = bodyText.match(/This is an? [A-Z]+ Event\.?/i);
    const eventTypeLine = eventTypeMatch ? eventTypeMatch[0].trim() : "";

    const venueMatch = bodyText.match(/\nat\s+([^\n\r]+)/);
    const venue = venueMatch ? trim(venueMatch[1]) : "";

    const callTable = [...document.querySelectorAll("table")].find((t) =>
      /job\/task|start date\/time/i.test(t.textContent || "")
    );

    let calls = [];
    if (callTable) {
      const allRows = [...callTable.querySelectorAll("tr")];
      const headerRow = allRows.find((tr) =>
        /job\/task|start date\/time|accept\?/i.test(tr.textContent || "")
      );
      const resolvedHeaders = headerRow
        ? [...headerRow.querySelectorAll("th,td")].map((c) =>
            trim(c.innerText || c.textContent).toLowerCase()
          )
        : [];

      const col = (re) => resolvedHeaders.findIndex((h) => re.test(h));
      const jobIdx = col(/job\/task|^job$|^task$/);
      const startIdx = col(/start date\/time|date\/time|^date$/);
      const notesIdx = col(/contractor notes|notes/);

      calls = allRows
        .filter((tr) => tr.querySelectorAll("td").length >= 2)
        .filter((tr) => tr !== headerRow)
        .map((tr) => {
          const cells = [...tr.querySelectorAll("td")].map((c) =>
            trim(c.innerText || c.textContent)
          );
          const startDateTime =
            startIdx >= 0
              ? cells[startIdx] || ""
              : cells.find(
                  (t) =>
                    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(t) &&
                    /\d{1,2}:\d{2}\s*(AM|PM)/i.test(t)
                ) ||
                cells[1] ||
                "";
          const job =
            jobIdx >= 0 ? cells[jobIdx] || "" : startIdx === 1 ? "" : cells[0] || "";
          const contractorNotes =
            notesIdx >= 0 ? cells[notesIdx] || "" : cells[2] || "";
          return { job, startDateTime, contractorNotes };
        })
        .filter((c) => c.startDateTime && !/^accept\??$/i.test(c.startDateTime));
    }

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
    const isResponsePage =
      /your offer response/i.test(bodyText) ||
      /\/response\//i.test(location.pathname || "");
    const hasResponseUi =
      /accept\?/i.test(bodyText) ||
      /submit your response/i.test(bodyText) ||
      /accepting\/declining/i.test(bodyText);
    const clearlyAccepted =
      /\baccepted\b/.test(normalizedBodyText) &&
      !/accept or decline|accept\/decline|please accept|to accept|will accept/i.test(
        normalizedBodyText
      );
    const clearlyDeclined =
      (/\bdenied\b|\bdeclined\b/.test(normalizedBodyText)) &&
      !/accept or decline|accept\/decline|please decline|to decline|accepting\/declining/i.test(
        normalizedBodyText
      );
    const looksLikeOpenOffer =
      Boolean(offerDeadlineText) ||
      isResponsePage ||
      hasResponseUi ||
      /accept or decline|accept\/decline|please accept|please decline/i.test(bodyText);
    const offerState = clearlyAccepted
      ? "accepted"
      : clearlyDeclined
        ? "declined"
        : looksLikeOpenOffer
          ? "pending"
          : "unknown";

    return {
      eventTypeLine: eventTypeLine || "",
      venue,
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

  const upcomingRows = (await scrapeUpcomingRows(page)).map((r) => ({ ...r, section: "upcoming" }));
  const offerRows = (await scrapeOfferRows(page)).map((r) => ({ ...r, section: "offers" }));
  const rawRows = [];
  const seenRowKeys = new Set();
  for (const row of [...upcomingRows, ...offerRows]) {
    const key = `${(row.event || "").trim().toLowerCase()}|${(row.dateTime || "").trim().toLowerCase()}|${row.detailUrl || ""}`;
    if (seenRowKeys.has(key)) continue;
    seenRowKeys.add(key);
    rawRows.push(row);
  }
  // Prefer the dashboard rows; fall back to the dedicated list page below.

  // If the dashboard produced too few upcoming rows, try the portal's dedicated
  // upcoming list page which sometimes contains the full event list.
  const upcomingCount = rawRows.filter((r) => r.section === "upcoming").length;
  if (upcomingCount <= 1) {
    try {
      const base = creds.loginUrl.replace(/\/$/, "");
      const listUrl = new URL('/view_upcoming', base).toString();
      await gotoPortalPage(page, listUrl);
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => {});
      const altRows = await scrapeUpcomingRows(page);
      if (altRows && altRows.length > upcomingCount) {
        for (const row of altRows) {
          const tagged = { ...row, section: "upcoming" };
          const key = `${(tagged.event || "").trim().toLowerCase()}|${(tagged.dateTime || "").trim().toLowerCase()}|${tagged.detailUrl || ""}`;
          if (seenRowKeys.has(key)) continue;
          seenRowKeys.add(key);
          rawRows.push(tagged);
        }
      }
    } catch (e) {
      // ignore; keep original rawRows
    }
  }

  const referenceYear = new Date().getFullYear();
  const parsedRows = rawRows.map((r) => ({ ...r, when: parseCrew1DateTime(r.dateTime, referenceYear) }));
  const detailCache = new Map();

  const entries = [];
  for (const rowObj of parsedRows) {
    const showLower = (rowObj.event || "").toLowerCase();
    if (showLower.includes("cancelled") || showLower.includes("canceled")) {
      continue;
    }

    const detail = rowObj.detailUrl ? await fetchEventDetail(page, rowObj.detailUrl, detailCache) : null;
    const offerState =
      rowObj.section === "offers"
        ? detail?.offerState === "declined"
          ? "declined"
          : "pending"
        : "accepted";

    let offerDeadlineText = detail?.offerDeadlineText || "";
    if (offerDeadlineText && rowObj.detailUrl) {
      rememberOfferDeadline(rowObj.detailUrl, offerDeadlineText);
    } else if (!offerDeadlineText && rowObj.detailUrl) {
      offerDeadlineText = recallOfferDeadline(rowObj.detailUrl);
    }
    if (rowObj.section === "offers" && offerState === "pending" && !offerDeadlineText) {
      console.warn(
        `[crewOne] No offer deadline text for ${rowObj.event}` +
          (rowObj.detailUrl ? ` (${rowObj.detailUrl})` : "") +
          " — deadline reminder will not be created"
      );
    }

    /** @param {{ date: string, callTime: string, venue?: string, position?: string, call?: { job?: string, contractorNotes?: string } }} whenParts */
    const pushEntry = (whenParts) => {
      const eventDetails = formatCrewOneEventDescription(detail, whenParts.call);
      entries.push({
        source: sourceId,
        date: whenParts.date,
        callTime: whenParts.callTime,
        show: rowObj.event,
        venue: whenParts.venue || rowObj.where || detail?.venue || "",
        location: "",
        client: "",
        type: "",
        position: whenParts.position || rowObj.position || "",
        details: eventDetails,
        status: "confirmed",
        notes: "",
        isCallCancelled: false,
        offerDeadlineText,
        offerState
      });
    };

    if (rowObj.when) {
      const matchingCall = detail?.calls?.find((call) =>
        matchDetailCall(rowObj.when.date, rowObj.when.callTime, call)
      );
      pushEntry({
        date: rowObj.when.date,
        callTime: rowObj.when.callTime,
        venue: rowObj.where || detail?.venue || "",
        position: rowObj.position || "",
        call: matchingCall
      });
      continue;
    }

    // Offers table has no Date/Time column; expand calls from the response page.
    const detailCalls = detail?.calls || [];
    if (detailCalls.length > 0) {
      let expanded = 0;
      for (const call of detailCalls) {
        const when = parseCrew1DateTime(call.startDateTime, referenceYear);
        if (!when) continue;
        pushEntry({
          date: when.date,
          callTime: when.callTime,
          venue: detail?.venue || rowObj.where || "",
          position: call.job || rowObj.position || "",
          call
        });
        expanded += 1;
      }
      if (expanded > 0) continue;
    }

    if (
      rowObj.dateTime &&
      String(rowObj.dateTime).trim() !== "" &&
      !isCrewOneActionCell(rowObj.dateTime)
    ) {
      console.warn(`[crewOne] Could not parse date/time: "${rowObj.dateTime}" for ${rowObj.event}`);
    }
  }

  return entries;
}
