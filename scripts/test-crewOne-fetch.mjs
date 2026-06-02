import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { getPuppeteer } from "../get-schedule/puppeteer.js";
import { fetchSchedule } from "../get-schedule/sources/crewOne.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const puppeteer = await getPuppeteer();
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();

try {
  const entries = await fetchSchedule(page);
  console.log(JSON.stringify(entries, null, 2));
  console.log(`\nFetched ${entries.length} upcoming call(s).`);
} finally {
  await browser.close();
}
