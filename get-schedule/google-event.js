/**
 * Map schedule entries to Google Calendar events.
 */

import {
  buildIatse927EventDescription,
  resolveIatse927EventLocation
} from "./iatse927-event-description.js";
import { normalizeStatus, scheduleRowId, isEventCancelled } from "./schedule-identity.js";
import {
  addMinutesToZonedLocalTime,
  formatDateTimeForTimezone,
  formatTimeForTitle,
  isEventInFuture,
  pad,
  parseScheduleDateParts
} from "./schedule-time.js";

/**
 * Get the display name for a source
 * @param {string} source
 * @returns {string}
 */
function getSourceDisplayName(source) {
  if (source === "crewOne") return "Crew 1";
  if (source === "rhino") return "Rhino";
  if (source === "iatse927") return "IATSE";
  return "";
}

/** @param {import("./sources/types.js").ScheduleEntry} entry */
function iatse927EventTitle(entry) {
  const show = entry.show?.trim();
  if (show && !/^unknown show$/i.test(show)) return show;
  return entry.venue?.trim() || "Unknown Show";
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

  const isCrewOneUnconfirmed =
    source === "crewOne" && String(entry.offerState || "").toLowerCase() === "pending";

  let summary;
  const sourceDisplayName = getSourceDisplayName(source);
  const position = String(entry.position || "").trim();
  const addTitleSuffixes = (title) => {
    const titleWithPosition = position ? `${title} - ${position}` : title;
    return sourceDisplayName ? `${titleWithPosition} [${sourceDisplayName}]` : titleWithPosition;
  };

  if (source === "rhino") {
    const isCalled = entry.status?.toLowerCase() === "called";
    const showTitle = isCalled ? `UNCONFIRMED => ${entry.show}` : entry.show;
    summary = isCalled ? addTitleSuffixes(showTitle) : addTitleSuffixes(`${formattedTime} ${showTitle}`);
  } else if (isCrewOneUnconfirmed) {
    summary = addTitleSuffixes(`UNCONFIRMED => ${formattedTime} ${entry.show}`);
  } else {
    summary = addTitleSuffixes(`${formattedTime} ${source === "iatse927" ? iatse927EventTitle(entry) : entry.show}`);
  }

  let description;
  if (source === "iatse927") {
    description = buildIatse927EventDescription(entry);
  } else {
    description = [entry.details, entry.notes].filter(Boolean).join(" | ");
  }
  if (entry.venueLink && entry.venueLink.trim()) {
    description = description
      ? `${description}\n\nVenue: ${entry.venueLink}`
      : `Venue: ${entry.venueLink}`;
  }

  return {
    summary,
    location:
      source === "iatse927"
        ? resolveIatse927EventLocation(entry)
        : [entry.venue, entry.location].filter(Boolean).join(" - "),
    description,
    start: startStr,
    end: endStr,
    status: isCrewOneUnconfirmed ? "tentative" : normalizeStatus(entry.status),
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
  const { futureOnly = true, timezone = "America/New_York", referenceDate = undefined } = options;

  const validEntries = entries.filter((entry) => !isEventCancelled(entry));

  let syncEntries = validEntries;
  if (futureOnly) {
    syncEntries = validEntries.filter((entry) => {
      const { year, month, day, hours, minutes } = parseScheduleDateParts(
        entry.date,
        entry.callTime
      );
      return isEventInFuture(year, month, day, hours, minutes, timezone, referenceDate);
    });
  }

  const googleEvents = syncEntries.map((entry) =>
    toGoogleEvent(entry, { source: sourceId, timezone })
  );
  syncEntries.forEach((entry, index) => {
    const logSummary =
      sourceId === "iatse927"
        ? `${formatTimeForTitle(entry.callTime)} ${iatse927EventTitle(entry)}`
        : googleEvents[index].summary;
    console.log(`  ✅ [${sourceId}] ${entry.date} ${logSummary}`);
  });

  return googleEvents;
}
