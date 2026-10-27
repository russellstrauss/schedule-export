import { gotoPortalPage } from "../puppeteer.js";
import {
  appOriginFromLoginUrl,
  collectUpcomingRoles,
  getCredentials,
  mapTechnicalElementsRole,
  sourceId
} from "./technicalElements-parse.js";

const LOGIN_EMAIL_SELECTOR = "#email";
const LOGIN_PASSWORD_SELECTOR = "#password";
const LOGIN_BUTTON_SELECTOR = ".login-form__login-btn";

/**
 * @param {import("puppeteer").Page} page
 * @param {string} selector
 * @param {string} value
 */
async function replaceField(page, selector, value) {
  await page.click(selector, { clickCount: 3 });
  if (page.keyboard) {
    await page.keyboard.press("Backspace");
  }
  await page.type(selector, value, { delay: 15 });
}

/**
 * @param {import("puppeteer").Page} page
 * @param {ReturnType<typeof getCredentials>} creds
 */
async function login(page, creds) {
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  );
  if (typeof page.evaluateOnNewDocument === "function") {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
  }
  await gotoPortalPage(page, creds.loginUrl);
  await page.waitForSelector(LOGIN_EMAIL_SELECTOR, { visible: true, timeout: 90000 });
  await page.waitForSelector(LOGIN_PASSWORD_SELECTOR, { visible: true, timeout: 90000 });

  await replaceField(page, LOGIN_EMAIL_SELECTOR, creds.email);
  await replaceField(page, LOGIN_PASSWORD_SELECTOR, creds.password);

  const button = await page.$(LOGIN_BUTTON_SELECTOR);
  if (!button) {
    throw new Error("Technical Elements login button was not found.");
  }
  await button.click();

  try {
    await page.waitForFunction(
      () => {
        if (localStorage.getItem("authKey")) return true;
        return /mfa/i.test(window.location.pathname);
      },
      { timeout: 90000 }
    );
  } catch {
    const snippet = await page
      .evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 300))
      .catch(() => "");
    throw new Error(
      `Technical Elements portal login did not finish.${snippet ? ` Page said: ${snippet}` : ""}`
    );
  }

  const pathname = new URL(page.url()).pathname;
  if (/mfa/i.test(pathname)) {
    throw new Error(
      "Technical Elements portal is waiting for an email verification code. Finish that login in a browser, then re-run the sync."
    );
  }
}

/**
 * @param {import("puppeteer").Page} page
 * @param {{ apiBase: string; timezone: string; offset: string | null; perPage: number }} query
 */
async function requestUpcomingPage(page, query) {
  return page.evaluate(async (requested) => {
    const authKey = localStorage.getItem("authKey") || "";
    if (!authKey) {
      return { ok: false, status: 401, body: { message: "Sign-in did not finish." } };
    }
    const url = new URL(`${requested.apiBase}/crew-jobs/upcoming`);
    url.searchParams.set("timezone", requested.timezone);
    url.searchParams.set("perPage", String(requested.perPage));
    if (requested.offset) url.searchParams.set("offset", requested.offset);

    let response;
    try {
      response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${authKey}`,
          Accept: "application/json"
        }
      });
    } catch (err) {
      return {
        ok: false,
        status: 0,
        body: { message: err instanceof Error ? err.message : String(err) }
      };
    }

    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { message: text.slice(0, 240) };
    }
    return { ok: response.ok, status: response.status, body };
  }, query);
}

/**
 * @param {import("puppeteer").Page} page
 * @returns {Promise<import("./types.js").ScheduleEntry[]>}
 */
export async function fetchSchedule(page) {
  const creds = getCredentials();
  if (!creds?.email || !creds.password) {
    throw new Error(
      "Missing TECHNICAL_ELEMENTS_EMAIL or TECHNICAL_ELEMENTS_PASSWORD. Set both to enable the technicalElements source."
    );
  }

  try {
    await login(page, creds);
    const appOrigin = appOriginFromLoginUrl(creds.loginUrl);
    const roles = await collectUpcomingRoles((query) =>
      requestUpcomingPage(page, {
        apiBase: creds.apiBase,
        timezone: creds.timezone,
        offset: query.offset,
        perPage: query.perPage
      })
    );

    return roles.map((role) => {
      const entry = mapTechnicalElementsRole(role, { appOrigin });
      if (!entry) {
        const label = role?.name || role?.job?.headline || role?.id || "shift";
        throw new Error(`Technical Elements shift was missing a start time (${label}).`);
      }
      return entry;
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    let url = "";
    try {
      url = page.url();
    } catch {
      // ignore
    }
    const prefixed = detail.startsWith("Technical Elements")
      ? detail
      : `Technical Elements sync failed: ${detail}`;
    throw new Error(url ? `${prefixed} (at ${url})` : prefixed);
  }
}

export { sourceId };
