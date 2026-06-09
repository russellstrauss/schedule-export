import dotenv from "dotenv";

import { authorize } from "./google-calendar/auth.js";
import { addEvent, purgeSourceEvents } from "./google-calendar/add-event.js";
import { withAuthRetry } from "./auth-handler.js";
import { trySyncIatse927FromStore } from "./ingest-iatse927.js";
import { getPuppeteer } from "./puppeteer.js";
import { getEnabledSourceIds, getSource } from "./sources/index.js";
import { DEFAULT_TIMEZONE } from "./sources/types.js";
import { logAndMapEvents } from "./utils.js";

dotenv.config();

/**
 * @param {import("./sources/types.js").ScheduleEntry[]} entries
 * @param {string} sourceId
 */
function filterAndMapEvents(entries, sourceId) {
  return logAndMapEvents(entries, sourceId, { futureOnly: true, timezone: DEFAULT_TIMEZONE });
}

/**
 * @param {string[]} enabledIds
 */
function getRunnablePortalSourceIds(enabledIds) {
  /** @type {string[]} */
  const runnable = [];
  for (const sourceId of enabledIds) {
    const source = getSource(sourceId);
    if (typeof source.fetchSchedule !== "function") continue;
    if (!source.getCredentials?.()) continue;
    runnable.push(sourceId);
  }
  return runnable;
}

/**
 * @param {import("puppeteer").Browser} browser
 * @param {string[]} portalSourceIds
 */
async function syncPortalSources(browser, portalSourceIds) {
  const eventsBySource = new Map();

  for (const sourceId of portalSourceIds) {
    const source = getSource(sourceId);
    console.log(`🌐 Fetching schedule from ${sourceId}...`);
    const page = await browser.newPage();
    try {
      const entries = await source.fetchSchedule(page);
      eventsBySource.set(sourceId, filterAndMapEvents(entries, sourceId));
    } finally {
      await page.close();
    }
  }

  if (eventsBySource.size === 0) {
    if (portalSourceIds.length > 0) {
      console.warn("⚠️  Portal sources ran but produced no events to sync.");
    }
    return;
  }

  let auth = await authorize();

  for (const [sourceId, googleEvents] of eventsBySource) {
    console.log(`🗓️ [${sourceId}] Syncing ${googleEvents.length} events to Google Calendar`);

    auth = await withAuthRetry(auth, async (a) => {
      await purgeSourceEvents(a, sourceId);
      return a;
    });

    for (const event of googleEvents) {
      auth = await withAuthRetry(auth, async (a) => {
        await addEvent(a, event);
        return a;
      });
    }
  }
}

export default async function getSchedule() {
  const enabledIds = getEnabledSourceIds();
  const portalSourceIds = getRunnablePortalSourceIds(enabledIds);
  let portalSourcesRan = 0;

  if (portalSourceIds.length > 0) {
    try {
      const puppeteer = await getPuppeteer();
      const browser = await puppeteer.launch({ headless: "new" });
      try {
        portalSourcesRan = portalSourceIds.length;
        await syncPortalSources(browser, portalSourceIds);
      } finally {
        await browser.close();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️  Portal sync skipped: ${message}`);
    }
  } else {
    console.log("ℹ️  No portal sources configured with credentials; skipping browser sync.");
  }

  const iatseResult = await trySyncIatse927FromStore();

  if (portalSourcesRan === 0 && !iatseResult) {
    throw new Error(
      "No schedule sources ran. Configure SCHEDULE_SOURCES credentials and/or IATSE (GEMINI_API_KEY + Firestore messages)."
    );
  }
}
