import dotenv from "dotenv";

import { authorize } from "./google-calendar/auth.js";
import { addEvent, purgeSourceEvents } from "./google-calendar/add-event.js";
import { withAuthRetry } from "./auth-handler.js";
import { getPuppeteer } from "./puppeteer.js";
import { getEnabledSourceIds, getSource } from "./sources/index.js";
import { DEFAULT_TIMEZONE } from "./sources/types.js";
import { toGoogleEvent, isEventCancelled, isEventInFuture } from "./utils.js";

dotenv.config();

/**
 * @param {import("./sources/types.js").ScheduleEntry[]} entries
 * @param {string} sourceId
 */
function filterAndMapEvents(entries, sourceId) {
  const validEntries = entries.filter((entry) => !isEventCancelled(entry));
  console.log(`📋 [${sourceId}] Found ${validEntries.length} valid (non-cancelled) events`);

  const futureEntries = validEntries.filter((entry) => {
    const [month, day, year] = entry.date.split("/").map(Number);
    const [hours, minutes] = entry.callTime.split(":").map(Number);
    const isFuture = isEventInFuture(year, month, day, hours, minutes, DEFAULT_TIMEZONE);

    if (!isFuture) {
      console.log(`⏰ [${sourceId}] Filtered out past event: ${entry.date} ${entry.callTime} - ${entry.show}`);
    }
    return isFuture;
  });

  console.log(`🔮 [${sourceId}] Found ${futureEntries.length} future events`);

  const googleEvents = futureEntries.map((entry) => toGoogleEvent(entry, { source: sourceId }));
  googleEvents.forEach((event) => {
    console.log(`  ✅ [${sourceId}] ${event.summary}`);
  });

  return googleEvents;
}

export default async function getSchedule() {
  const enabledIds = getEnabledSourceIds();
  const puppeteer = await getPuppeteer();
  const browser = await puppeteer.launch({ headless: "new" });

  const eventsBySource = new Map();

  try {
    for (const sourceId of enabledIds) {
      const source = getSource(sourceId);
      const creds = source.getCredentials();

      if (!creds) {
        const missing =
          typeof source.missingCredentialEnvVars === "function"
            ? source.missingCredentialEnvVars()
            : [];
        const detail =
          missing.length > 0 ? ` (set ${missing.join(" and ")})` : "";
        console.warn(`⚠️  Skipping source "${sourceId}": credentials not configured${detail}.`);
        continue;
      }

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
      throw new Error(
        "No schedule sources ran. Configure credentials for at least one source in SCHEDULE_SOURCES."
      );
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
  } finally {
    await browser.close();
  }
}
