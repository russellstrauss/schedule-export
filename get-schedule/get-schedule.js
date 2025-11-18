import dotenv from "dotenv";

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
  
  // Always try @sparticuz/chromium first if we detect serverless, or if regular puppeteer fails
  if (isCloudFunction) {
    try {
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
          
          return puppeteerCore.default.launch(launchOptions);
        }
      };
    } catch (error) {
      console.error('Error setting up @sparticuz/chromium:', error);
      throw new Error(`Failed to initialize Puppeteer with @sparticuz/chromium: ${error.message}`);
    }
  } else {
    // Local development - use regular puppeteer
    const puppeteer = await import("puppeteer");
    return puppeteer.default;
  }
}

dotenv.config();

// Helper function to format date in America/New_York timezone
// Since we specify timeZone in the event, we just need to format the date string
// Google Calendar will interpret it correctly with the timezone
const pad = (num) => num.toString().padStart(2, "0");

const formatDateTimeForTimezone = (year, month, day, hours, minutes, timezone = "America/New_York") => {
  // Format as YYYY-MM-DDTHH:mm:ss (without timezone, since we specify it separately)
  // This represents the local time in the specified timezone
  const dateStr = `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00`;
  return dateStr;
};

// Format time for event title: "08:00" -> "8am", "19:00" -> "7pm", "12:00" -> "12pm"
const formatTimeForTitle = (timeStr) => {
  const [hours, minutes] = timeStr.split(":").map(Number);
  let hour12 = hours % 12;
  if (hour12 === 0) hour12 = 12; // 0 and 12 both become 12
  const ampm = hours < 12 ? "am" : "pm";
  // Only include minutes if they're not :00
  if (minutes === 0) {
    return `${hour12}${ampm}`;
  } else {
    return `${hour12}:${pad(minutes)}${ampm}`;
  }
};

const toGoogleEvent = (entry) => {
  const [month, day, year] = entry.date.split("/").map(Number);
  const [hours, minutes] = entry.callTime.split(":").map(Number);
  
  // Create a Date object for the call time (in America/New_York timezone)
  // Note: JavaScript Date uses local timezone, but we'll format it correctly for Google Calendar
  const callTimeDate = new Date(year, month - 1, day, hours, minutes);
  
  // Calculate start time: 30 minutes before call time
  const startDate = new Date(callTimeDate);
  startDate.setMinutes(startDate.getMinutes() - 30);
  
  // Calculate end time: 5 hours after the call time (not including the 30-minute buffer)
  const endDate = new Date(callTimeDate);
  endDate.setHours(endDate.getHours() + 5);
  
  // Format dates as strings in the correct timezone format
  // Google Calendar API will interpret these with the timeZone we specify
  const startStr = formatDateTimeForTimezone(
    startDate.getFullYear(),
    startDate.getMonth() + 1,
    startDate.getDate(),
    startDate.getHours(),
    startDate.getMinutes()
  );
  const endStr = formatDateTimeForTimezone(
    endDate.getFullYear(),
    endDate.getMonth() + 1,
    endDate.getDate(),
    endDate.getHours(),
    endDate.getMinutes()
  );

  const rowId = [
    entry.date,
    entry.callTime,
    entry.show,
    entry.venue,
    entry.position,
    entry.type
  ].join(" | ");

  // Normalize status to valid Google Calendar values
  // "called" is a Rhino-specific status meaning the office called about the shift
  // Map it to Google's "tentative" status
  const normalizeStatus = (status) => {
    if (!status) return "confirmed";
    const lower = status.toLowerCase();
    // Map Rhino "called" status to Google "tentative"
    if (lower === "called") return "tentative";
    // Map other common status values to valid Google Calendar statuses
    if (lower === "cancelled" || lower === "canceled") return "cancelled";
    if (lower === "tentative") return "tentative";
    // Default to "confirmed" for any other status
    return "confirmed";
  };

  // Check if status is "called" to prepend "UNCONFIRMED" to the title
  const isCalled = entry.status?.toLowerCase() === "called";
  const showTitle = isCalled ? `UNCONFIRMED => ${entry.show}` : entry.show;
  // Prepend start time to the event title (but not for unconfirmed events)
  const startTimeStr = `${pad(startDate.getHours())}:${pad(startDate.getMinutes())}`;
  const formattedTime = formatTimeForTitle(startTimeStr);
  const summary = isCalled ? showTitle : `${formattedTime} ${showTitle}`;

  return {
    summary: summary,
    location: [entry.venue, entry.location].filter(Boolean).join(" - "),
    description: [entry.details, entry.notes].filter(Boolean).join(" | "),
    start: startStr,
    end: endStr,
    status: normalizeStatus(entry.status),
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

      // Check if "Call Cancelled" is in the specific cell (index 14, the second-to-last cell before Venue Info)
      const callCancelledCell = cells[14] ? cells[14].textContent.trim() : "";
      const isCallCancelled = callCancelledCell.toLowerCase() === "call cancelled";

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
        isCallCancelled: isCallCancelled
      };
    }).filter(Boolean);
  });

  // Filter out cancelled events:
  // 1. Events with "Call Cancelled" in the designated cell (index 14)
  // 2. Events with "CANCELLED" in the show name
  const validEntries = events.filter(entry => {
    if (entry.isCallCancelled) return false;
    // Also check if show name contains "CANCELLED" (case-insensitive)
    const showName = entry.show?.toLowerCase() || "";
    if (showName.includes("cancelled")) return false;
    return true;
  });

  const futureEntries = validEntries.filter(entry => {
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

  await browser.close();
}