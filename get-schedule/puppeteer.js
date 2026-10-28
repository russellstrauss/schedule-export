/** Puppeteer for local dev vs Cloud Functions (@sparticuz/chromium). */
import { isCloudRuntime } from "./runtime-env.js";

/** @param {import("puppeteer").LaunchOptions} [options] */
export function getPortalBrowserLaunchOptions(options = {}) {
  return {
    headless: true,
    args: [
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--no-first-run",
      ...(options.args || [])
    ],
    ...options
  };
}

const PORTAL_NAV_TIMEOUT_MS = 90000;

/**
 * Stylesheets stay enabled. Aborting them can leave a parser-blocking request
 * open, so DOMContentLoaded never fires and navigation waits until timeout.
 * @param {string} resourceType
 * @returns {"abort" | "continue"}
 */
export function portalRequestAction(resourceType) {
  if (resourceType === "image" || resourceType === "font" || resourceType === "media") {
    return "abort";
  }
  return "continue";
}

/** @param {import("puppeteer").Page} page */
export async function configurePortalPage(page) {
  page.setDefaultNavigationTimeout(PORTAL_NAV_TIMEOUT_MS);
  page.setDefaultTimeout(PORTAL_NAV_TIMEOUT_MS);
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (typeof req.isInterceptResolutionHandled === "function" && req.isInterceptResolutionHandled()) {
      return;
    }
    const action =
      portalRequestAction(req.resourceType()) === "abort" ? req.abort() : req.continue();
    Promise.resolve(action).catch(() => {});
  });
}

/**
 * This Puppeteer build rejects waitUntil "commit". Wait until the document is
 * parsed, and keep going when that document is already usable after a timeout.
 * @param {import("puppeteer").Page} page
 * @param {string} url
 */
export async function gotoPortalPage(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: PORTAL_NAV_TIMEOUT_MS });
  } catch (err) {
    if (await documentReadyAt(page, url)) return;
    throw err;
  }
}

/**
 * @param {import("puppeteer").Page} page
 * @param {string} url
 */
async function documentReadyAt(page, url) {
  return page
    .evaluate((expected) => {
      if (document.readyState === "loading" || !document.body || document.body.childNodes.length === 0) {
        return false;
      }
      try {
        return location.pathname === new URL(expected, location.href).pathname;
      } catch {
        return false;
      }
    }, url)
    .catch(() => false);
}

export async function getPuppeteer() {
  if (isCloudRuntime()) {
    try {
      const chromiumModule = await import("@sparticuz/chromium");
      const puppeteerCore = await import("puppeteer-core");
      const chromium = chromiumModule.default || chromiumModule;

      if (chromium.setGraphicsMode) {
        chromium.setGraphicsMode(false);
      }

      const executablePath = chromium.executablePath
        ? await chromium.executablePath()
        : null;

      if (!executablePath) {
        throw new Error("Could not get executable path from @sparticuz/chromium");
      }

      return {
        launch: async (options = {}) =>
          puppeteerCore.default.launch({
            args: chromium.args || [
              "--no-sandbox",
              "--disable-setuid-sandbox",
              "--disable-dev-shm-usage",
              "--disable-accelerated-2d-canvas",
              "--no-first-run",
              "--no-zygote",
              "--single-process",
              "--disable-gpu"
            ],
            defaultViewport: chromium.defaultViewport || { width: 1280, height: 720 },
            executablePath,
            headless: true,
            ...options
          })
      };
    } catch (error) {
      console.error("Error setting up @sparticuz/chromium:", error);
      throw new Error(`Failed to initialize Puppeteer with @sparticuz/chromium: ${error.message}`);
    }
  }

  const puppeteer = await import("puppeteer");
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();

  if (executablePath) {
    const fs = await import("fs");
    if (!fs.existsSync(executablePath)) {
      throw new Error(`PUPPETEER_EXECUTABLE_PATH not found: ${executablePath}`);
    }
    const base = puppeteer.default;
    return {
      launch: (options = {}) =>
        base.launch({ ...getPortalBrowserLaunchOptions(options), executablePath })
    };
  }

  return puppeteer.default;
}
