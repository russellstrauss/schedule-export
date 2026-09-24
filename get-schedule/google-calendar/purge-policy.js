import {
  crewOneRowMatchKey,
  normalizeScheduleRowId,
  rhinoRowMatchKey
} from "../schedule-identity.js";

export const RECENT_PAST_EVENT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * Source-specific rules for reconciling calendar events against a schedule fetch.
 * Keep the policy table here so purgeOrphanedSourceEvents does not grow more
 * `if (source === ...)` branches.
 *
 * @param {string} source
 */
export function getSourcePurgePolicy(source) {
  return {
    skipDeadlineReminders: source === "crewOne",
    keepPastEvents: source === "crewOne",
    deletePastIfAbsent: source === "iatse927",
    deleteRecentPastIfAbsent: source === "rhino",
    activeMatchKey: source === "crewOne" ? crewOneRowMatchKey : null,
    cancelledMatchKey:
      source === "crewOne"
        ? crewOneRowMatchKey
        : source === "rhino"
          ? rhinoRowMatchKey
          : null
  };
}

/**
 * True when a calendar event's stored rowId matches a row in the given set.
 * Mirrors how rows are matched for both the "still active" and "cancelled" checks,
 * including the relaxed source-specific fallbacks: CrewOne ignores detail-page
 * position/type drift, Rhino ignores call-time drift.
 * @param {string} source
 * @param {string} rowId
 * @param {Set<string>} normalizedSet
 * @param {Set<string> | null} relaxedKeys
 */
export function rowIdInSet(source, rowId, normalizedSet, relaxedKeys) {
  const normalized = normalizeScheduleRowId(rowId);
  if (normalizedSet.has(normalized)) return true;
  if (relaxedKeys) {
    if (source === "crewOne" && relaxedKeys.has(crewOneRowMatchKey(rowId))) return true;
    if (source === "rhino" && relaxedKeys.has(rhinoRowMatchKey(rowId))) return true;
  }
  return false;
}

export function isDeadlineReminderRowId(rowId) {
  return String(rowId || "").includes("|deadlineReminder");
}
