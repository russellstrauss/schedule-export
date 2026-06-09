/**
 * Normalized schedule row from any staffing portal.
 * @typedef {Object} ScheduleEntry
 * @property {string} source - Source id (e.g. "rhino", "crewOne")
 * @property {string} date - MM/DD/YYYY
 * @property {string} callTime - HH:mm
 * @property {string} show
 * @property {string} venue
 * @property {string} location
 * @property {string} position
 * @property {string} type
 * @property {string} status
 * @property {string} [client]
 * @property {string} [details]
 * @property {string} [notes]
 * @property {string} [sourceText] - Verbatim dispatch/reminder SMS matched to this shift
 * @property {boolean} [isCallCancelled]
 * @property {string} [venueLink]
 * @property {number[]} [evidenceIndices]
 * @property {string} [confidence]
 */

export const DEFAULT_TIMEZONE = "America/New_York";
