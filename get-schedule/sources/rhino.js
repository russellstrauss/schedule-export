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

    const allRows = Array.from(table.querySelectorAll("tbody tr"));
    const headerRow = allRows[0];
    const bodyRows = allRows.slice(1, -1);

    let venueLinkColumnIndex = -1;
    let statusColumnIndex = 10;
    if (headerRow) {
      const headerCells = Array.from(headerRow.querySelectorAll("td"));
      for (let i = 0; i < headerCells.length; i++) {
        const cell = headerCells[i];
        const hasLeftcell = cell.classList && cell.classList.contains("leftcell");
        if (hasLeftcell && cell.textContent.trim() === "+") {
          venueLinkColumnIndex = i;
        }
        const headerText = cell.textContent
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        if (headerText === "status" || headerText.startsWith("status ")) {
          statusColumnIndex = i;
        }
      }
    }

    return bodyRows.map((row) => {
      const cells = Array.from(row.querySelectorAll("td"));
      if (cells.length < 12) return null;

      const removeEscapes = (cell) =>
        cell.textContent.replace(/\\t/g, "").replace(/\\n/g, "\n").replace(/\s+/g, " ").trim();

      const isCallCancelled = cells.some(
        (cell) => normalizeCellText(cell.textContent) === callCancelledLabel
      );

      let venueLink;
      if (venueLinkColumnIndex >= 0 && cells[venueLinkColumnIndex]) {
        const anchor = cells[venueLinkColumnIndex].querySelector("a");
        const href = anchor ? anchor.href : null;
        venueLink = href && href.trim() ? href.trim() : undefined;
      }

      const statusCell = cells[statusColumnIndex];
      const entry = {
        date: cells[0].textContent.trim(),
        callTime: cells[1].textContent.trim(),
        show: cells[3].textContent.trim(),
        venue: removeEscapes(cells[4]),
        location: cells[5].textContent.trim(),
        client: cells[6].textContent.trim(),
        type: cells[7].textContent.trim(),
        position: cells[8].textContent.trim(),
        details: cells[9].textContent.trim(),
        status: statusCell ? statusCell.textContent.trim() : "",
        notes: cells[11].textContent.trim(),
        isCallCancelled
      };
      if (venueLink) entry.venueLink = venueLink;
      return entry;
    }).filter(Boolean);
  }, CALL_CANCELLED_LABEL.toLowerCase());

  return rows.map((row) => ({ ...row, source: sourceId }));
}
