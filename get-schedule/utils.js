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
 * Check if an event entry should be filtered out (cancelled)
 */
export const isEventCancelled = (entry) => {
  // Check if "Call Cancelled" is in the designated cell
  if (entry.isCallCancelled) return true;
  // Also check if show name contains "CANCELLED" (case-insensitive)
  const showName = entry.show?.toLowerCase() || "";
  if (showName.includes("cancelled")) return true;
  // Check if status contains "Called Out" (case-insensitive)
  const status = entry.status?.toLowerCase() || "";
  if (status.includes("called out")) return true;
  return false;
};

/**
 * Transform a schedule entry to a Google Calendar event
 */
export const toGoogleEvent = (entry) => {
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

