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
 * @property {boolean} [isCallCancelled]
 */

export const DEFAULT_TIMEZONE = "America/New_York";
