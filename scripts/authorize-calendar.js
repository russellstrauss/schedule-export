/**
 * Run Google Calendar OAuth only (writes get-schedule/google-calendar/token.json).
 * Use this for renew-auth — do not use sync.js, which also runs Firestore/portal sync.
 */
import { authorize } from "../get-schedule/google-calendar/auth.js";

try {
  await authorize();
  console.log("Google Calendar authorization complete.");
} catch (err) {
  console.error("Authorization failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
