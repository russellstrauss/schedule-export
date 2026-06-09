/** Puppeteer for local dev vs Cloud Functions (@sparticuz/chromium). */
import { isCloudRuntime } from "./runtime-env.js";

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
  const systemChrome =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    (process.platform === "win32"
      ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      : process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : "/usr/bin/google-chrome");

  const fs = await import("fs");
  if (fs.existsSync(systemChrome)) {
    const base = puppeteer.default;
    return {
      launch: (options = {}) =>
        base.launch({ ...options, executablePath: systemChrome })
    };
  }

  return puppeteer.default;
}
