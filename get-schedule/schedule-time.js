/**
 * Date, time, and timezone helpers for schedule processing.
 */

/**
 * Pad a number with leading zeros
 */
export const pad = (num) => (num ?? 0).toString().padStart(2, "0");

/**
 * @param {import("./sources/types.js").ScheduleEntry} entry
 */
export function scheduleEntrySortKey(entry) {
  const [month, day, year] = entry.date.split("/").map(Number);
  const [hours, minutes] = entry.callTime.split(":").map(Number);
  return year * 1e8 + month * 1e6 + day * 1e4 + hours * 100 + minutes;
}

/**
 * @param {import("./sources/types.js").ScheduleEntry[]} entries
 */
export function sortScheduleEntriesChronologically(entries) {
  return [...entries].sort((a, b) => scheduleEntrySortKey(a) - scheduleEntrySortKey(b));
}

/**
 * Format time for event title: "08:00" -> "8am", "19:00" -> "7pm", "12:00" -> "12pm"
 */
export const formatTimeForTitle = (timeStr) => {
	const [hours, minutes = 0] = (timeStr || "0:00").split(":").map(Number);
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

/**
 * Format date/time for Google Calendar API
 */
export const formatDateTimeForTimezone = (year, month, day, hours, minutes, timezone = "America/New_York") => {
	// Format as YYYY-MM-DDTHH:mm:ss (without timezone, since we specify it separately)
	// This represents the local time in the specified timezone
	const dateStr = `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00`;
	return dateStr;
};

/**
 * Parse MM/DD/YYYY date and HH:mm call time from a schedule entry.
 * @param {string} dateStr
 * @param {string} callTimeStr
 */
export function parseScheduleDateParts(dateStr, callTimeStr) {
  const parts = (dateStr || "").split("/").map((part) => part.trim());
  const [monthPart, dayPart, yearPart] = parts;
  const month = Number(monthPart);
  const day = Number(dayPart);
  let year = Number(yearPart);
  if (yearPart && yearPart.length === 2) {
    year = 2000 + year;
  } else if (!yearPart) {
    year = new Date().getFullYear();
  }

  const normalizedCallTime = (callTimeStr || "").trim();
  const timeMatch = normalizedCallTime.match(/^\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*$/i);
  let hours = 0;
  let minutes = 0;
  if (timeMatch) {
    hours = Number(timeMatch[1]);
    minutes = timeMatch[2] ? Number(timeMatch[2]) : 0;
    const ampm = timeMatch[3]?.toUpperCase();
    if (ampm === "PM" && hours < 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;
  } else {
    const tokens = normalizedCallTime.split(/\s+/);
    const timeToken = tokens[0] || "0:00";
    const timeParts = timeToken.split(":").map((part) => parseInt(part, 10) || 0);
    hours = timeParts[0] ?? 0;
    minutes = timeParts[1] ?? 0;
    const ampm = tokens[1]?.toUpperCase();
    if (ampm === "PM" && hours < 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;
  }

  return { year, month, day, hours, minutes };
}

/** @param {string} dateStr */
export function normalizeScheduleDate(dateStr) {
  const { year, month, day } = parseScheduleDateParts(dateStr, "0:00");
  return `${month}/${day}/${year}`;
}

/** @param {string} callTimeStr */
export function normalizeScheduleCallTime(callTimeStr) {
  const { hours, minutes } = parseScheduleDateParts("1/1/2000", callTimeStr);
  return `${pad(hours)}:${pad(minutes)}`;
}

/**
 * Check if an event date/time is in the future, accounting for timezone
 * This properly handles America/New_York timezone to avoid timezone bugs
 * @param {number} year - Year (e.g., 2025)
 * @param {number} month - Month (1-12)
 * @param {number} day - Day (1-31)
 * @param {number} hours - Hours (0-23)
 * @param {number} minutes - Minutes (0-59)
 * @param {string} timezone - Timezone (default: "America/New_York")
 * @param {Date} [referenceDate] - Optional date to compare against instead of now
 * @returns {boolean} True if the event is in the future
 */
export const isEventInFuture = (
  year,
  month,
  day,
  hours,
  minutes,
  timezone = "America/New_York",
  referenceDate = undefined
) => {
  const now = referenceDate instanceof Date ? referenceDate : new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  
  const nowParts = formatter.formatToParts(now);
  const nowObj = {};
  nowParts.forEach(part => {
    if (part.type !== "literal") {
      nowObj[part.type] = part.value;
    }
  });
  
  // Compare year, month, day, hour, minute
  const eventTime = {
    year: year,
    month: month,
    day: day,
    hour: hours,
    minute: minutes
  };
  
  let nowHour = parseInt(nowObj.hour, 10);
  if (nowHour === 24) nowHour = 0;

  const nowTime = {
    year: parseInt(nowObj.year, 10),
    month: parseInt(nowObj.month, 10),
    day: parseInt(nowObj.day, 10),
    hour: nowHour,
    minute: parseInt(nowObj.minute, 10)
  };
  
  // Compare chronologically
  if (eventTime.year > nowTime.year) return true;
  if (eventTime.year < nowTime.year) return false;
  if (eventTime.month > nowTime.month) return true;
  if (eventTime.month < nowTime.month) return false;
  if (eventTime.day > nowTime.day) return true;
  if (eventTime.day < nowTime.day) return false;
  if (eventTime.hour > nowTime.hour) return true;
  if (eventTime.hour < nowTime.hour) return false;
  if (eventTime.minute > nowTime.minute) return true;
  return false; // Same or past
};

/** @param {number} utcMs @param {string} timezone */
function zonedLocalPartsFromUtcMs(utcMs, timezone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const parts = {};
  formatter.formatToParts(new Date(utcMs)).forEach((part) => {
    if (part.type !== "literal") parts[part.type] = part.value;
  });

  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0;

  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    hours: hour,
    minutes: parseInt(parts.minute, 10)
  };
}

function compareZonedLocalParts(a, b) {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  if (a.day !== b.day) return a.day - b.day;
  if (a.hours !== b.hours) return a.hours - b.hours;
  return a.minutes - b.minutes;
}

/** @param {number} year @param {number} month @param {number} day @param {number} hours @param {number} minutes @param {string} timezone */
function zonedLocalTimeToUtcMs(year, month, day, hours, minutes, timezone) {
  const target = { year, month, day, hours, minutes };
  let lo = Date.UTC(year, month - 1, day, hours - 14, minutes);
  let hi = Date.UTC(year, month - 1, day, hours + 14, minutes);

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const cmp = compareZonedLocalParts(zonedLocalPartsFromUtcMs(mid, timezone), target);
    if (cmp === 0) return mid;
    if (cmp < 0) lo = mid + 1;
    else hi = mid - 1;
  }

  return lo;
}

/**
 * Add minutes to a wall-clock time in a timezone (handles DST and day rollover).
 */
export function addMinutesToZonedLocalTime(
  year,
  month,
  day,
  hours,
  minutes,
  deltaMinutes,
  timezone = "America/New_York"
) {
  const utcMs = zonedLocalTimeToUtcMs(year, month, day, hours, minutes, timezone);
  return zonedLocalPartsFromUtcMs(utcMs + deltaMinutes * 60_000, timezone);
}
