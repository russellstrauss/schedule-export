export {
  sourceId,
  missingCredentialEnvVars,
  getCredentials,
  normalizeCrew1DateTimeText,
  parseCrew1DateTime,
  parseCrewOneOfferDeadline,
  parseCrewOneOfferState,
  isCrewOneActionCell,
  mapCrewOneDashboardRow,
  isCrewOneOfferUnconfirmed,
  isCrewOneOfferDeclined,
  buildCrewOneDeadlineReminderEvent,
  matchDetailCall,
  formatCrewOneEventDescription
} from "./crewOne-parse.js";
export { fetchSchedule } from "./crewOne-scrape.js";

import {
  buildCrewOneDeadlineReminderEvent,
  isCrewOneOfferUnconfirmed
} from "./crewOne-parse.js";

/** Crew One dashboard is a complete snapshot of upcoming calls. */
export const removeAbsent = true;

/**
 * @param {import("./types.js").ScheduleEntry[]} entries
 */
export function buildReminderEvents(entries) {
  return [
    ...new Map(
      entries
        .map((entry) => buildCrewOneDeadlineReminderEvent(entry))
        .filter(Boolean)
        .map((event) => [event.rowId, event])
    ).values()
  ];
}

/**
 * @param {import("./types.js").ScheduleEntry[]} entries
 */
export function pendingOfferShows(entries) {
  return entries
    .filter((entry) => isCrewOneOfferUnconfirmed(entry))
    .map((entry) => entry.show);
}
