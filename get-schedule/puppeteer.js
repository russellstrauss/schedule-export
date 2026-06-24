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

/** @param {import("puppeteer").Page} page */
export async function configurePortalPage(page) {
  page.setDefaultNavigationTimeout(90000);
  page.setDefaultTimeout(90000);
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const type = req.resourceType();
    if (type === "image" || type === "stylesheet" || type === "font" || type === "media") {
      req.abort();
    } else {
      req.continue();
    }
  });
}

/**
 * @param {import("puppeteer").Page} page
 * @param {string} url
 */
export async function gotoPortalPage(page, url) {
  const opts = { waitUntil: "commit", timeout: 90000 };
  try {
    await page.goto(url, opts);
  } catch {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  }
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
