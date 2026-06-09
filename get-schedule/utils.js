// Utility functions for schedule processing - extracted for testability

/**
 * Pad a number with leading zeros
 */
export const pad = (num) => num.toString().padStart(2, "0");

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
 * Normalize status to valid Google Calendar values
 * "called" is a Rhino-specific status meaning the office called about the shift
 * Map it to Google's "tentative" status
 */
export const normalizeStatus = (status) => {
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

/**
 * Normalize status (and similar) text for substring checks: Unicode dashes,
 * NBSP, and collapsed whitespace so UI variants still match.
 */
export const normalizeTextForMatch = (value) => {
	if (!value) return "";
	return value
		.toLowerCase()
		.replace(/\u00a0/g, " ")
		.replace(/[\u2013\u2014\u2212]/g, "-")
		.replace(/\s+/g, " ")
		.trim();
};

/** Exact text Rhino puts in the blank-header column (between TK/TL/SAF and "+"). */
export const CALL_CANCELLED_LABEL = "Call Cancelled";

/**
 * Parse MM/DD/YYYY date and HH:mm call time from a schedule entry.
 * @param {string} dateStr
 * @param {string} callTimeStr
 */
export function parseScheduleDateParts(dateStr, callTimeStr) {
  const [month, day, year] = dateStr.split("/").map(Number);
  const timeToken = (callTimeStr || "").trim().split(/\s+/)[0] || "0:00";
  const [hours, minutes] = timeToken.split(":").map((part) => parseInt(part, 10) || 0);
  return { year, month, day, hours, minutes };
}

/**
 * Stable row id for calendar sync (must match toGoogleEvent).
 * @param {import("./sources/types.js").ScheduleEntry} entry
 */
export function scheduleRowId(entry) {
  return [
    entry.date,
    entry.callTime,
    entry.show,
    entry.venue,
    entry.position,
    entry.type
  ].join(" | ");
}

/**
 * True when cell text is Rhino's call-cancelled marker (blank header column).
 */
export const isCallCancelledLabel = (text) => {
  if (!text) return false;
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  return normalized === CALL_CANCELLED_LABEL.toLowerCase();
};

/**
 * Check if an event entry should be filtered out (cancelled)
 */
export const isEventCancelled = (entry) => {
  if (entry.isCallCancelled) return true;
  const showName = entry.show?.toLowerCase() || "";
  if (showName.includes("cancelled") || showName.includes("canceled")) return true;
  const status = normalizeTextForMatch(entry.status);
  if (status.includes("called out")) return true;
  if (status.includes("turned down") && status.includes("unavailable")) return true;
  const lettersOnly = status.replace(/[^a-z]/g, "");
  if (lettersOnly.includes("turneddown") && lettersOnly.includes("unavailable")) return true;
  return false;
};

/**
 * Check if an event date/time is in the future, accounting for timezone
 * This properly handles America/New_York timezone to avoid timezone bugs
 * @param {number} year - Year (e.g., 2025)
 * @param {number} month - Month (1-12)
 * @param {number} day - Day (1-31)
 * @param {number} hours - Hours (0-23)
 * @param {number} minutes - Minutes (0-59)
 * @param {string} timezone - Timezone (default: "America/New_York")
 * @returns {boolean} True if the event is in the future
 */
export const isEventInFuture = (year, month, day, hours, minutes, timezone = "America/New_York") => {
  // Get current time components in the target timezone
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
  
  const nowParts = formatter.formatToParts(new Date());
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

/**
 * Transform a schedule entry to a Google Calendar event
 * @param {Object} entry
 * @param {{ source?: string; timezone?: string }} [options]
 */
export const toGoogleEvent = (entry, options = {}) => {
  const source = options.source || entry.source || "rhino";
  const timezone = options.timezone || "America/New_York";
  const { year, month, day, hours, minutes } = parseScheduleDateParts(
    entry.date,
    entry.callTime
  );

  const startParts = addMinutesToZonedLocalTime(
    year,
    month,
    day,
    hours,
    minutes,
    -30,
    timezone
  );
  const endParts = addMinutesToZonedLocalTime(
    year,
    month,
    day,
    hours,
    minutes,
    5 * 60,
    timezone
  );

  const startStr = formatDateTimeForTimezone(
    startParts.year,
    startParts.month,
    startParts.day,
    startParts.hours,
    startParts.minutes
  );
  const endStr = formatDateTimeForTimezone(
    endParts.year,
    endParts.month,
    endParts.day,
    endParts.hours,
    endParts.minutes
  );

  const rowId = scheduleRowId(entry);

  const startTimeStr = `${pad(startParts.hours)}:${pad(startParts.minutes)}`;
  const formattedTime = formatTimeForTitle(startTimeStr);

  let summary;
  if (source === "rhino") {
    const isCalled = entry.status?.toLowerCase() === "called";
    const showTitle = isCalled ? `UNCONFIRMED => ${entry.show}` : entry.show;
    summary = isCalled ? showTitle : `${formattedTime} ${showTitle}`;
  } else if (source === "iatse927" && entry.type) {
    summary = `${formattedTime} (${entry.type}) ${entry.show}`;
  } else {
    summary = `${formattedTime} ${entry.show}`;
  }

  let description = [entry.details, entry.notes].filter(Boolean).join(" | ");
  if (entry.venueLink && entry.venueLink.trim()) {
    description = description
      ? `${description}\n\nVenue: ${entry.venueLink}`
      : `Venue: ${entry.venueLink}`;
  }

  return {
    summary,
    location: [entry.venue, entry.location].filter(Boolean).join(" - "),
    description,
    start: startStr,
    end: endStr,
    status: normalizeStatus(entry.status),
    rowId,
    source
  };
};

/**
 * Log parsed schedule entries (portal-style) and return Google Calendar events.
 * @param {import("./sources/types.js").ScheduleEntry[]} entries
 * @param {string} sourceId
 * @param {{ futureOnly?: boolean; timezone?: string }} [options]
 * @returns {ReturnType<typeof toGoogleEvent>[]}
 */
export function logAndMapEvents(entries, sourceId, options = {}) {
  const { futureOnly = true, timezone = "America/New_York" } = options;

  const validEntries = entries.filter((entry) => !isEventCancelled(entry));
  console.log(`📋 [${sourceId}] Found ${validEntries.length} valid (non-cancelled) events`);

  let syncEntries = validEntries;
  if (futureOnly) {
    syncEntries = validEntries.filter((entry) => {
      const { year, month, day, hours, minutes } = parseScheduleDateParts(
        entry.date,
        entry.callTime
      );
      const isFuture = isEventInFuture(year, month, day, hours, minutes, timezone);

      if (!isFuture) {
        console.log(
          `⏰ [${sourceId}] Filtered out past event: ${entry.date} ${entry.callTime} - ${entry.show}`
        );
      }
      return isFuture;
    });

    console.log(`🔮 [${sourceId}] Found ${syncEntries.length} future events`);
  }

  const googleEvents = syncEntries.map((entry) =>
    toGoogleEvent(entry, { source: sourceId, timezone })
  );
  syncEntries.forEach((entry, index) => {
    const logSummary =
      sourceId === "iatse927"
        ? `${formatTimeForTitle(entry.callTime)} ${entry.show}`
        : googleEvents[index].summary;
    console.log(`  ✅ [${sourceId}] ${entry.date} ${logSummary}`);
  });

  return googleEvents;
}

