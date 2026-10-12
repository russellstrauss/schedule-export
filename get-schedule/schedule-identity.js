/**
 * Row identity, status, and cancellation helpers for schedule processing.
 */

import {
  isEventInFuture,
  normalizeScheduleCallTime,
  normalizeScheduleDate,
  parseScheduleDateParts
} from "./schedule-time.js";

/**
 * Normalize status to valid Google Calendar values
 * "called" is a Rhino-specific status meaning the office called about the shift
 * Map it to Google's "tentative" status
 */
export const normalizeStatus = (status) => {
	if (!status) return "confirmed";
	const lower = status.toLowerCase();
	// Map Rhino "called" status to Google "tentative"
	if (lower === "called" || lower === "unconfirmed") return "tentative";
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
 * Strip a leading "CANCELLED"/"CANCELED" marker that Rhino prepends to the show
 * name of a cancelled call. The marker is not part of the call's identity, so it
 * must be removed before building/matching row ids (otherwise a cancelled row can
 * never match the originally-synced calendar event).
 * @param {string} show
 */
export function stripCancelledShowPrefix(show) {
  if (!show) return show;
  return show.replace(/^\s*cancell?ed\b[\s:.,\u2013-]*/i, "").trim();
}

/**
 * Canonical row id for matching portal rows to calendar events.
 * Handles legacy ids that included location (7 parts).
 * @param {string} rowId
 */
export function normalizeScheduleRowId(rowId) {
  if (!rowId) return rowId;
  const parts = rowId.split(" | ");
  let date;
  let callTime;
  let show;
  let venue;
  let position;
  let type;
  const normShow = (s) => stripCancelledShowPrefix((s ?? "").replace(/\s+/g, " ").trim());
  if (parts.length >= 7) {
    [date, callTime, show, venue, , position, type] = parts;
  } else if (parts.length >= 6) {
    [date, callTime, show, venue, position, type] = parts;
  } else if (parts.length >= 4) {
    [date, callTime, show, venue] = parts;
    return [
      normalizeScheduleDate(date),
      normalizeScheduleCallTime(callTime),
      normShow(show),
      (venue ?? "").replace(/\s+/g, " ").trim()
    ].join(" | ");
  } else {
    return rowId;
  }
  return [
    normalizeScheduleDate(date),
    normalizeScheduleCallTime(callTime),
    normShow(show),
    (venue ?? "").replace(/\s+/g, " ").trim(),
    (position ?? "").trim(),
    (type ?? "").trim()
  ].join(" | ");
}

/**
 * Crew One dashboard-stable match key (date, call time, show, venue).
 * Detail-page position/type can change between syncs and must not affect identity.
 * @param {string} rowId
 */
export function crewOneRowMatchKey(rowId) {
  const normalized = normalizeScheduleRowId(rowId);
  const parts = normalized.split(" | ");
  if (parts.length < 4) return normalized;
  return parts.slice(0, 4).join(" | ");
}

/**
 * Rhino cancellation match key: identity without the call time, which Rhino
 * sometimes drifts by a minute when a call is cancelled/edited. Used only for
 * matching cancelled rows during purge — active events are matched exactly first,
 * so relaxing the cancelled match can never delete a still-active call.
 * @param {string} rowId
 */
export function rhinoRowMatchKey(rowId) {
  const normalized = normalizeScheduleRowId(rowId);
  const parts = normalized.split(" | ");
  if (parts.length < 6) return normalized;
  // date | show | venue | position | type (drop call time at index 1)
  return [parts[0], parts[2], parts[3], parts[4], parts[5]].join(" | ");
}

/** @param {string} rowId @param {string} [timezone] */
export function isFutureCallFromRowId(rowId, timezone = "America/New_York") {
  const parts = rowId.split(" | ");
  if (parts.length < 2) return false;
  const { year, month, day, hours, minutes } = parseScheduleDateParts(parts[0], parts[1]);
  return isEventInFuture(year, month, day, hours, minutes, timezone);
}

/**
 * Stable row id for calendar sync (must match toGoogleEvent).
 * @param {import("./sources/types.js").ScheduleEntry} entry
 */
export function scheduleRowId(entry) {
  if (entry.source === "crewOne") {
    return crewOneRowMatchKey(
      [entry.date, entry.callTime, entry.show, entry.venue].join(" | ")
    );
  }
  return normalizeScheduleRowId(
    [
      entry.date,
      entry.callTime,
      entry.show,
      entry.venue,
      entry.position,
      entry.type
    ].join(" | ")
  );
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
  const offerState = String(entry.offerState || "").toLowerCase();
  if (offerState === "declined" || offerState === "denied") return true;

  const rowText = normalizeTextForMatch(
    [entry.show, entry.status, entry.details, entry.notes]
      .filter(Boolean)
      .join(" ")
  );

  if (rowText.includes("cancelled") || rowText.includes("canceled")) return true;
  if (rowText.includes("call filled") || rowText.includes("filled already")) return true;
  if (rowText.includes("called out")) return true;
  if (rowText.includes("turned down") && rowText.includes("unavailable")) return true;

  const lettersOnly = rowText.replace(/[^a-z]/g, "");
  if (lettersOnly.includes("callfilled") || lettersOnly.includes("filledalready")) return true;
  if (lettersOnly.includes("turneddown") && lettersOnly.includes("unavailable")) return true;
  return false;
};
