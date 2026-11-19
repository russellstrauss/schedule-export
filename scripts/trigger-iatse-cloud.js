#!/usr/bin/env node
/**
 * Trigger IATSE calendar sync on the deployed Cloud Function (Firestore + Gemini on the server).
 * Local machine only needs SCHEDULE_SYNC_URL / FUNCTION_URL — no Firestore or GEMINI keys on device.
 *
 * Usage:
 *   SCHEDULE_SYNC_URL=https://your-prod.run.app node scripts/trigger-iatse-cloud.js
 */
import { triggerProductionSync } from "./remote-sync.js";

try {
  const data = await triggerProductionSync({ mode: "iatse" });
  console.log(JSON.stringify(data, null, 2));

  if (data.iatse) {
    const { parsed, synced, warnings } = data.iatse;
    console.log(`✅ Remote IATSE: ${synced} calendar event(s) from ${parsed} parsed shift(s)`);
    if (warnings?.length) {
      console.log(`ℹ️  ${warnings.length} validation warning(s) (see JSON)`);
    }
  } else if (data.message) {
    console.log(`ℹ️  ${data.message}`);
  }
} catch (err) {
  console.error("❌ Request failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
