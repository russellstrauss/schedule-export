import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import { fileURLToPath } from "url";
import { dirname } from "path";

import { authorize } from "./google-calendar/auth.js";
import { addEvent, purgeRhinoEvents } from "./google-calendar/add-event.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const settings = {
  generateICS: false
};

const pad = (num) => num.toString().padStart(2, "0");

const formatICSDate = (dateObj) => {
  const year = dateObj.getFullYear();
  const month = pad(dateObj.getMonth() + 1);
  const day = pad(dateObj.getDate());
  const hours = pad(dateObj.getHours());
  const minutes = pad(dateObj.getMinutes());
  return `${year}${month}${day}T${hours}${minutes}00`;
};

const generateTimestamp = () => {
  const now = new Date();
  const hours = now.getHours();
  const minutes = pad(now.getMinutes());
  const ampm = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${now.getFullYear()}_${pad(hour12)}${minutes}${ampm}`;
};

const createVEVENT = (entry, index) => {
  const [month, day, year] = entry.date.split("/").map(Number);
  const [hours, minutes] = entry.callTime.split(":").map(Number);
  const startDate = new Date(year, month - 1, day, hours, minutes);

  const start = formatICSDate(startDate);
  const end = formatICSDate(new Date(startDate.getTime() + 60 * 60 * 1000));
  const dtstamp = formatICSDate(new Date());

  const summary = entry.show;
  const location = [entry.venue, entry.location].filter(Boolean).join(" - ");
  const description = [entry.details, entry.notes].filter(Boolean).join(" | ");
  const status = entry.status?.toUpperCase();

  return [
    "BEGIN:VEVENT",
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${summary}`,
    `LOCATION:${location}`,
    `DESCRIPTION:${description}`,
    `STATUS:${status}`,
    "END:VEVENT"
  ].join("\r\n");
};

const toGoogleEvent = (entry) => {
  const [month, day, year] = entry.date.split("/").map(Number);
  const [hours, minutes] = entry.callTime.split(":").map(Number);
  const start = new Date(year, month - 1, day, hours, minutes);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  const rowId = [
    entry.date,
    entry.callTime,
    entry.show,
    entry.venue,
    entry.position,
    entry.type
  ].join(" | ");

  return {
    summary: entry.show,
    location: [entry.venue, entry.location].filter(Boolean).join(" - "),
    description: [entry.details, entry.notes].filter(Boolean).join(" | "),
    start: start.toISOString(),
    end: end.toISOString(),
    status: entry.status?.toLowerCase() || "confirmed",
    rowId
  };
};

export default async function getSchedule() {
  const email = process.env.RHINO_EMAIL;
  const password = process.env.RHINO_PASSWORD;

  if (!email || !password) {
    throw new Error("Missing RHINO_EMAIL or RHINO_PASSWORD in environment.");
  }

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();

  const url = "https://thinkrhino.com/employee/georgia/Index.aspx?cookieCheck=true";
  await page.goto(url, { waitUntil: "networkidle2" });

  await page.type("#emailaddress", email);
  await page.type("#mypassword", password);
  await page.click("#btnNewLogin");

  await page.waitForFunction(() => document.readyState === "complete", { timeout: 5000 });
  await page.waitForSelector("#btnSchedule", { visible: true, timeout: 5000 });
  await page.click("#btnSchedule");
  await page.waitForSelector("table#dgResults");

  const events = await page.evaluate(() => {
    const table = document.querySelector("table#dgResults");
    if (!table) return [];

    const rows = Array.from(table.querySelectorAll("tbody tr")).slice(1, -1);
    return rows.map(row => {
      const cells = Array.from(row.querySelectorAll("td"));
      if (cells.length < 12) return null;

      const removeEscapes = (cell) => {
        return cell.textContent.replace(/\\t/g, "").replace(/\\n/g, "\n").replace(/\s+/g, " ").trim();
      };

      return {
        date: cells[0].textContent.trim(),
        callTime: cells[1].textContent.trim(),
        show: cells[3].textContent.trim(),
        venue: removeEscapes(cells[4]),
        location: cells[5].textContent.trim(),
        client: cells[6].textContent.trim(),
        type: cells[7].textContent.trim(),
        position: cells[8].textContent.trim(),
        details: cells[9].textContent.trim(),
        status: cells[10].textContent.trim(),
        notes: cells[11].textContent.trim(),
      };
    }).filter(Boolean);
  });

  const futureEntries = events.filter(entry => {
    const [month, day, year] = entry.date.split("/").map(Number);
    const [hours, minutes] = entry.callTime.split(":").map(Number);
    const start = new Date(year, month - 1, day, hours, minutes);
    return start > new Date();
  });

  const googleEvents = futureEntries.map(toGoogleEvent);

  console.log(`🗓️ Upcoming ${googleEvents.length} events:`);
  googleEvents.forEach(event => {
    console.log(`  ✅ ${event.summary}`);
  });

  const auth = await authorize();
  await purgeRhinoEvents(auth);

  for (const event of googleEvents) {
    await addEvent(auth, event);
  }

  const vevents = futureEntries.map((entry, i) => createVEVENT(entry, i)).join("\r\n");
  const icsContent = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//YourApp//EN",
    vevents,
    "END:VCALENDAR"
  ].join("\r\n");

  const timeId = generateTimestamp();
  const filename = `rhino-schedule-export-${timeId}.ics`;
  const filepath = path.join(__dirname, filename);

  if (settings.generateICS) {
    fs.writeFileSync(filepath, icsContent, "utf8");
    console.log(`Schedule exported to ${filename}`);
  }

  await browser.close();
}