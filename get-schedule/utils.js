// Utility functions for schedule processing - extracted for testability

/**
 * Pad a number with leading zeros
 */
export const pad = (num) => num.toString().padStart(2, "0");

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
  
  const nowTime = {
    year: parseInt(nowObj.year),
    month: parseInt(nowObj.month),
    day: parseInt(nowObj.day),
    hour: parseInt(nowObj.hour),
    minute: parseInt(nowObj.minute)
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

/**
 * Transform a schedule entry to a Google Calendar event
 * @param {Object} entry
 * @param {{ source?: string }} [options]
 */
export const toGoogleEvent = (entry, options = {}) => {
  const source = options.source || entry.source || "rhino";
  const [month, day, year] = entry.date.split("/").map(Number);
  const [hours, minutes] = entry.callTime.split(":").map(Number);

  const callTimeDate = new Date(year, month - 1, day, hours, minutes);

  const startDate = new Date(callTimeDate);
  startDate.setMinutes(startDate.getMinutes() - 30);

  const endDate = new Date(callTimeDate);
  endDate.setHours(endDate.getHours() + 5);

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

  const startTimeStr = `${pad(startDate.getHours())}:${pad(startDate.getMinutes())}`;
  const formattedTime = formatTimeForTitle(startTimeStr);

  let summary;
  if (source === "rhino") {
    const isCalled = entry.status?.toLowerCase() === "called";
    const showTitle = isCalled ? `UNCONFIRMED => ${entry.show}` : entry.show;
    summary = isCalled ? showTitle : `${formattedTime} ${showTitle}`;
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

