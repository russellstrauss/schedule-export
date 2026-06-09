import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseRcsThread, mergeAndSortMessages } from "../iatse927-thread-parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "../fixtures");

/** Reference date: June 2026 (matches production test fixtures). */
export const THREAD_REFERENCE_DATE = new Date("2026-06-06T12:00:00-04:00");

export const SHAWN_SCHEDULING_THREAD_EXPORT = fs.readFileSync(
  path.join(fixturesDir, "shawn-scheduling.txt"),
  "utf8"
);

export const TYLER_REMINDERS_THREAD_EXPORT = fs.readFileSync(
  path.join(fixturesDir, "tyler-reminders.txt"),
  "utf8"
);

export const COMBINED_THREAD_MESSAGES = mergeAndSortMessages([
  ...parseRcsThread(SHAWN_SCHEDULING_THREAD_EXPORT, {
    referenceDate: THREAD_REFERENCE_DATE,
    sourceThread: "shawn"
  }),
  ...parseRcsThread(TYLER_REMINDERS_THREAD_EXPORT, {
    referenceDate: THREAD_REFERENCE_DATE,
    sourceThread: "tyler"
  })
]);

/** Golden confirmed crew calls. Years inferred as 2026. Dual-time confirms have Load In + Load Out. */
export const EXPECTED_CONFIRMED_SHIFTS = [
  { date: "5/15/2026", callTime: "21:00", show: "Dave Matthews", venue: "Ameris", type: "Load Out" },
  { date: "5/29/2026", callTime: "10:00", show: "MGK", venue: "Lakewood", type: "Load In" },
  { date: "5/29/2026", callTime: "22:30", show: "MGK", venue: "Lakewood", type: "Load Out" },
  { date: "5/31/2026", callTime: "09:00", show: "Weird Al Yankovic", venue: "Ameris", type: "Load In" },
  { date: "5/31/2026", callTime: "22:00", show: "Weird Al Yankovic", venue: "Ameris", type: "Load Out" },
  { date: "6/3/2026", callTime: "10:30", show: "Charlie Puth", venue: "Chastain", type: "Load In" },
  { date: "6/3/2026", callTime: "22:00", show: "Charlie Puth", venue: "Chastain", type: "Load Out" },
  { date: "6/6/2026", callTime: "09:30", show: "Young the Giant", venue: "Chastain", type: "Load In" },
  { date: "6/6/2026", callTime: "22:00", show: "Young the Giant", venue: "Chastain", type: "Load Out" },
  { date: "6/10/2026", callTime: "10:00", show: "Kali Uchis", venue: "Lakewood", type: "Load In" },
  { date: "6/10/2026", callTime: "22:00", show: "Kali Uchis", venue: "Lakewood", type: "Load Out" }
];

/** Must-not-sync: 5/8 Riley Green, 5/23 Black Crowes, 6/10 12PM Kali Uchis correction. */

export const EXPECTED_MERGED_FIELDS = {
  "5/15/2026|21:00": { locationContains: "11412", stewardContains: "Rob Stafford" },
  "5/29/2026|10:00": { locationContains: "Lakewood", stewardContains: "Shawn Grable" },
  "5/29/2026|22:30": { locationContains: "Lakewood", stewardContains: "Shawn Grable" },
  "6/3/2026|10:30": { locationContains: "4469 Stella", stewardContains: "Shawn Grable" },
  "6/3/2026|22:00": { locationContains: "4469 Stella", stewardContains: "Shawn Grable" }
};
