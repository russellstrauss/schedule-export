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

    const bodyRows = Array.from(table.querySelectorAll("tbody tr")).slice(1, -1);
    return bodyRows.map((row) => {
      const cells = Array.from(row.querySelectorAll("td"));
      if (cells.length < 12) return null;

      const removeEscapes = (cell) =>
        cell.textContent.replace(/\\t/g, "").replace(/\\n/g, "\n").replace(/\s+/g, " ").trim();

      const isCallCancelled = cells.some(
        (cell) => normalizeCellText(cell.textContent) === callCancelledLabel
      );

      return {
        date: cells[0].textContent.trim(),
        callTime: cells[1].textContent.trim(),
        show: cells[3].textContent.trim(),
        venue: removeEscapes(cells[4]),
        location: cells[5].textContent.trim(),
        client: cells[6].textContent.trim(),
        type: cells[7].textContent.trim(),
        position: cells[8].textContent.trim(),
        details: cells[9].textContent.trim(),
        status: cells[10].textContent.trim(),
        notes: cells[11].textContent.trim(),
        isCallCancelled
      };
    }).filter(Boolean);
  }, CALL_CANCELLED_LABEL.toLowerCase());

  return rows.map((row) => ({ ...row, source: sourceId }));
}
