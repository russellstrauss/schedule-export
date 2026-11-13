#!/usr/bin/env node
/**
 * Trigger IATSE calendar sync on the deployed Cloud Function (Firestore + Gemini on the server).
 * Local machine only needs SCHEDULE_SYNC_URL / FUNCTION_URL — no Firestore or GEMINI keys on device.
 *
 * Usage:
 *   SCHEDULE_SYNC_URL=https://your-prod.run.app node scripts/trigger-iatse-cloud.js
 */
import dotenv from "dotenv";

dotenv.config();

const baseUrl = (
  process.env.SCHEDULE_SYNC_URL ||
  process.env.FUNCTION_URL ||
  ""
).trim().replace(/\/$/, "");

if (!baseUrl) {
  console.error(
    "Set SCHEDULE_SYNC_URL (or FUNCTION_URL) in .env to your production sync-schedule HTTPS URL."
  );
  process.exit(1);
}

const timeoutMs = Number(process.env.SCHEDULE_SYNC_TIMEOUT_MS || 600_000);
const url = `${baseUrl}?mode=iatse`;

console.log(`🌐 Requesting remote IATSE sync: ${url}`);

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);

try {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "iatse" }),
    signal: controller.signal
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    console.error(`❌ HTTP ${response.status}:`, data);
    process.exit(1);
  }

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
  if (err.name === "AbortError") {
    console.error(`❌ Timed out after ${timeoutMs / 1000}s`);
  } else {
    console.error("❌ Request failed:", err instanceof Error ? err.message : err);
  }
  process.exit(1);
} finally {
  clearTimeout(timer);
}
