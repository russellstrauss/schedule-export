export {
  sourceId,
  sourceDisplayName,
  DEFAULT_API_BASE,
  DEFAULT_LOGIN_URL,
  DEFAULT_TIMEZONE,
  missingCredentialEnvVars,
  getCredentials,
  classifyTechnicalElementsOffer,
  mapTechnicalElementsRole,
  collectUpcomingRoles,
  UPCOMING_MAX_PAGES,
  zonedPartsFromIso
} from "./technicalElements-parse.js";
export { fetchSchedule } from "./technicalElements-scrape.js";

/**
 * The upcoming calendar is a complete snapshot of current Technical Elements
 * calls. Shifts that disappear from it are removed from the future calendar.
 * Past events are kept by the source purge policy.
 */
export const removeAbsent = true;
