#!/usr/bin/env node
import dotenv from "dotenv";
import { trySyncIatse927FromStore } from "../get-schedule/ingest-iatse927.js";

dotenv.config();

async function main() {
  const result = await trySyncIatse927FromStore();
  if (!result) {
    throw new Error("IATSE sync skipped (check GEMINI_API_KEY and Firestore messages)");
  }

  const { synced, warnings } = result;
  if (warnings.length > 0) {
    console.log(`ℹ️  [iatse927] Sync complete: ${synced} event(s), ${warnings.length} warning(s)`);
  }
}

main().catch((err) => {
  console.error("❌ IATSE sync failed:", err.message || err);
  process.exit(1);
});
