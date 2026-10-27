import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Companies the user can turn on or off. IATSE 927 SMS ingest is separate. */
export const SYNC_COMPANIES = [
  { id: "rhino", label: "Rhino" },
  { id: "crewOne", label: "Crew One" },
  { id: "technicalElements", label: "Technical Elements" }
];

const SETTINGS_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "user-settings.json");

/**
 * @param {Record<string, unknown>} settings
 * @returns {string[]}
 */
export function enabledSourceIds(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("User settings must be an object of company ids set to true or false.");
  }

  /** @type {string[]} */
  const ids = [];
  for (const company of SYNC_COMPANIES) {
    const value = settings[company.id];
    if (typeof value !== "boolean") {
      throw new Error(`User setting "${company.id}" must be true or false.`);
    }
    if (value) ids.push(company.id);
  }
  return ids;
}

/**
 * @param {string} [path]
 */
export function loadUserSettings(path = SETTINGS_PATH) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read user settings from ${path}: ${message}`);
  }
  enabledSourceIds(parsed);
  return parsed;
}

/** @returns {string[]} */
export function getEnabledSourceIds() {
  return enabledSourceIds(loadUserSettings());
}
