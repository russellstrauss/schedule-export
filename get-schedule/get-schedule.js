import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

import { authorize } from "./google-calendar/auth.js";
import { addEvent, purgeRhinoEvents } from "./google-calendar/add-event.js";

// Helper function to get Puppeteer instance (works in both local and Cloud Functions)
async function getPuppeteer() {
  // Check multiple indicators of Cloud Functions/serverless environment
  // The error message shows /www-data-home/.cache/puppeteer, so check for that path
  const isCloudFunction = !!(
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.FUNCTION_TARGET ||
    process.env.K_SERVICE ||
    process.env.FUNCTION_NAME ||
    process.env.K_REVISION ||
    // Check if we're in a typical serverless environment (www-data-home is the home dir in Cloud Functions)
    (process.env.HOME && process.env.HOME.includes('www-data-home')) ||
    (process.env.PWD && process.env.PWD.includes('www-data-home'))
  );
  
  console.log(`Environment detection: isCloudFunction=${isCloudFunction}`);
  console.log(`  GOOGLE_CLOUD_PROJECT: ${process.env.GOOGLE_CLOUD_PROJECT}`);
  console.log(`  HOME: ${process.env.HOME}`);
  console.log(`  PWD: ${process.env.PWD}`);
  
  // Always try @sparticuz/chromium first if we detect serverless, or if regular puppeteer fails
  if (isCloudFunction) {
    try {
      console.log('Attempting to use @sparticuz/chromium for Cloud Functions...');
      // In Cloud Functions, use puppeteer-core with @sparticuz/chromium
      const chromiumModule = await import("@sparticuz/chromium");
      const puppeteerCore = await import("puppeteer-core");
      
      // Handle both default export and named export
      const chromium = chromiumModule.default || chromiumModule;
      
      // Set graphics mode for Cloud Functions (reduces memory usage)
      if (chromium.setGraphicsMode) {
        chromium.setGraphicsMode(false);
      }
      
      // Get executable path (it's a function that returns a Promise)
      const executablePath = chromium.executablePath 
        ? await chromium.executablePath()
        : null;
      
      if (!executablePath) {
        throw new Error('Could not get executable path from @sparticuz/chromium');
      }
      
      console.log(`Using @sparticuz/chromium with executable: ${executablePath}`);
      
      return {
        launch: async (options = {}) => {
          const launchOptions = {
            args: chromium.args || [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-accelerated-2d-canvas',
              '--no-first-run',
              '--no-zygote',
              '--single-process',
              '--disable-gpu'
            ],
            defaultViewport: chromium.defaultViewport || { width: 1280, height: 720 },
            executablePath: executablePath,
            headless: true,
            ...options
          };
          
          console.log('Launching browser with options:', JSON.stringify(launchOptions, null, 2));
          return puppeteerCore.default.launch(launchOptions);
        }
      };
    } catch (error) {
      console.error('Error setting up @sparticuz/chromium:', error);
      throw new Error(`Failed to initialize Puppeteer with @sparticuz/chromium: ${error.message}`);
    }
  } else {
    // Local development - use regular puppeteer
    console.log('Using regular puppeteer for local development');
    const puppeteer = await import("puppeteer");
    return puppeteer.default;
  }
}

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

// Helper function to format date in America/New_York timezone
// Since we specify timeZone in the event, we just need to format the date string
// Google Calendar will interpret it correctly with the timezone
const formatDateTimeForTimezone = (year, month, day, hours, minutes, timezone = "America/New_York") => {
  // Format as YYYY-MM-DDTHH:mm:ss (without timezone, since we specify it separately)
  // This represents the local time in the specified timezone
  const dateStr = `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00`;
  return dateStr;
};

const toGoogleEvent = (entry) => {
  const [month, day, year] = entry.date.split("/").map(Number);
  const [hours, minutes] = entry.callTime.split(":").map(Number);
  
  // Format dates as strings in the correct timezone format
  // Google Calendar API will interpret these with the timeZone we specify
  const startStr = formatDateTimeForTimezone(year, month, day, hours, minutes);
  const endStr = formatDateTimeForTimezone(year, month, day, hours + 1, minutes);

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
    start: startStr,
    end: endStr,
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

  const puppeteer = await getPuppeteer();
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