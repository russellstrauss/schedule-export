import { CALL_CANCELLED_LABEL } from "../utils.js";

export const sourceId = "rhino";

const LOGIN_URL = "https://thinkrhino.com/employee/georgia/Index.aspx?cookieCheck=true";

/** @returns {string[]} */
export function missingCredentialEnvVars() {
  const missing = [];
  if (!process.env.RHINO_EMAIL) missing.push("RHINO_EMAIL");
  if (!process.env.RHINO_PASSWORD) missing.push("RHINO_PASSWORD");
  return missing;
}

export function getCredentials() {
  if (missingCredentialEnvVars().length > 0) return null;
  return { email: process.env.RHINO_EMAIL, password: process.env.RHINO_PASSWORD };
}

/**
 * @param {import("puppeteer").Page} page
 * @returns {Promise<import("./types.js").ScheduleEntry[]>}
 */
export async function fetchSchedule(page) {
  const { email, password } = getCredentials();
  if (!email || !password) {
    throw new Error("Missing RHINO_EMAIL or RHINO_PASSWORD in environment.");
  }

  await page.goto(LOGIN_URL, { waitUntil: "networkidle2" });

  await page.type("#emailaddress", email);
  await page.type("#mypassword", password);
  await page.click("#btnNewLogin");

  await page.waitForFunction(() => document.readyState === "complete", { timeout: 5000 });
  await page.waitForSelector("#btnSchedule", { visible: true, timeout: 5000 });
  await page.click("#btnSchedule");
  await page.waitForSelector("table#dgResults");

  const rows = await page.evaluate((callCancelledLabel) => {
    const table = document.querySelector("table#dgResults");
    if (!table) return [];

    const normalizeCellText = (text) =>
      text.replace(/\\t/g, "").replace(/\\n/g, "\n").replace(/\s+/g, " ").trim().toLowerCase();

    const normalizeHeaderText = (text) =>
      text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

    /** @param {Element[]} headerCells @param {string} label */
    const headerIndex = (headerCells, label) => {
      for (let i = 0; i < headerCells.length; i++) {
        const headerText = normalizeHeaderText(headerCells[i].textContent);
        if (headerText === label || headerText.startsWith(`${label} `)) {
          return i;
        }
      }
      return -1;
    };

    const allRows = Array.from(table.querySelectorAll("tbody tr"));
    const headerRow = allRows[0];
    const bodyRows = allRows.slice(1, -1);

    const headerCells = headerRow ? Array.from(headerRow.querySelectorAll("td, th")) : [];
    const hasActionsColumn = headerIndex(headerCells, "actions") >= 0;
    const offset = hasActionsColumn ? 1 : 0;

    /** @param {string} label @param {number} legacyIndex */
    const col = (label, legacyIndex) => {
      const idx = headerIndex(headerCells, label);
      return idx >= 0 ? idx : legacyIndex + offset;
    };

    const columns = {
      date: col("date", 0),
      callTime: col("time", 1),
      show: col("show", 3),
      venue: col("venue", 4),
      location: col("location", 5),
      client: col("client", 6),
      type: col("type", 7),
      position: col("position", 8),
      details: col("details", 9),
      status: col("status", 10),
      notes: col("notes", 11)
    };

    let venueLinkColumnIndex = -1;
    for (let i = 0; i < headerCells.length; i++) {
      const cell = headerCells[i];
      const hasLeftcell = cell.classList && cell.classList.contains("leftcell");
      if (hasLeftcell && cell.textContent.trim() === "+") {
        venueLinkColumnIndex = i;
        break;
      }
    }

    return bodyRows.map((row) => {
      const cells = Array.from(row.querySelectorAll("td"));
      if (cells.length < 12) return null;

      const removeEscapes = (cell) =>
        cell.textContent.replace(/\\t/g, "").replace(/\\n/g, "\n").replace(/\s+/g, " ").trim();

      const cellText = (index) =>
        index >= 0 && cells[index] ? cells[index].textContent.trim() : "";

      const isCallCancelled = cells.some(
        (cell) => normalizeCellText(cell.textContent) === callCancelledLabel
      );

      let venueLink;
      if (venueLinkColumnIndex >= 0 && cells[venueLinkColumnIndex]) {
        const anchor = cells[venueLinkColumnIndex].querySelector("a");
        const href = anchor ? anchor.href : null;
        venueLink = href && href.trim() ? href.trim() : undefined;
      }

      const entry = {
        date: cellText(columns.date),
        callTime: cellText(columns.callTime),
        show: cellText(columns.show),
        venue: removeEscapes(cells[columns.venue] || { textContent: "" }),
        location: cellText(columns.location),
        client: cellText(columns.client),
        type: cellText(columns.type),
        position: cellText(columns.position),
        details: cellText(columns.details),
        status: cellText(columns.status),
        notes: cellText(columns.notes),
        isCallCancelled
      };
      if (venueLink) entry.venueLink = venueLink;
      return entry;
    }).filter(Boolean);
  }, CALL_CANCELLED_LABEL.toLowerCase());

  return rows.map((row) => ({ ...row, source: sourceId }));
}
