/**
 * Map schedule entries to Google Calendar events.
 */

import {
  buildIatse927EventDescription,
  resolveIatse927EventLocation
} from "./iatse927-event-description.js";
import { normalizeStatus, scheduleRowId, isEventCancelled } from "./schedule-identity.js";
import {
  sourceDisplayName as technicalElementsDisplayName,
  sourceId as technicalElementsSourceId
} from "./sources/technicalElements-parse.js";
import {
  formatShowWithVenueAbbreviation,
  resolveVenueAbbreviation
} from "./venue-abbreviations.js";
import {
  addMinutesToZonedLocalTime,
  formatDateTimeForTimezone,
  formatTimeForTitle,
  isEventInFuture,
  pad,
  parseScheduleDateParts
} from "./schedule-time.js";

/**
 * If a computed end falls on a later calendar day than the call, pin it to
 * 11:59pm on the call's date so the event stays off the next day's list.
 * @param {{ year: number, month: number, day: number, hours: number, minutes: number }} endParts
 * @param {number} year
 * @param {number} month
 * @param {number} day
 */
function capEndOnScheduleDay(endParts, year, month, day) {
  const endKey = endParts.year * 10000 + endParts.month * 100 + endParts.day;
  const scheduleKey = year * 10000 + month * 100 + day;
  if (endKey <= scheduleKey) return endParts;
  return { year, month, day, hours: 23, minutes: 59 };
}

/**
 * Get the display name for a source
 * @param {string} source
 * @returns {string}
 */
function getSourceDisplayName(source) {
  if (source === "crewOne") return "Crew 1";
  if (source === "rhino") return "Rhino";
  if (source === "iatse927") return "IATSE";
  if (source === technicalElementsSourceId) return technicalElementsDisplayName;
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
  // Calls run five hours. Google Calendar lists an event on every day it
  // overlaps, so an end after midnight also appears on the next day. Stop
  // those at 11:59pm on the schedule date.
  const endParts = capEndOnScheduleDay(
    addMinutesToZonedLocalTime(year, month, day, hours, minutes, 5 * 60, timezone),
    year,
    month,
    day
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

  const isOfferUnconfirmed =
    (source === "crewOne" || source === technicalElementsSourceId) &&
    String(entry.offerState || "").toLowerCase() === "pending";

  let summary;
  const sourceDisplayName = getSourceDisplayName(source);
  const position = String(entry.position || "").trim();
  const addTitleSuffixes = (title) => {
    const titleWithPosition = position ? `${title} - ${position}` : title;
    return sourceDisplayName ? `${titleWithPosition} [${sourceDisplayName}]` : titleWithPosition;
  };
  const venueAbbreviation = resolveVenueAbbreviation(entry, source);
  const titledShow = (show) => formatShowWithVenueAbbreviation(show, venueAbbreviation);

  if (source === "rhino") {
    const isUnconfirmed = ["called", "unconfirmed", "tentative"].includes(
      String(entry.status || "").trim().toLowerCase()
    );
    const showTitle = isUnconfirmed ? `UNCONFIRMED => ${titledShow(entry.show)}` : titledShow(entry.show);
    summary = isUnconfirmed
      ? addTitleSuffixes(showTitle)
      : addTitleSuffixes(`${formattedTime} ${showTitle}`);
  } else if (isOfferUnconfirmed) {
    summary = addTitleSuffixes(`UNCONFIRMED => ${formattedTime} ${titledShow(entry.show)}`);
  } else {
    const showName = source === "iatse927" ? iatse927EventTitle(entry) : entry.show;
    summary = addTitleSuffixes(`${formattedTime} ${titledShow(showName)}`);
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
    status: isOfferUnconfirmed ? "tentative" : normalizeStatus(entry.status),
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
