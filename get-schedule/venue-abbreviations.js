/**
 * Shared venue abbreviations for calendar titles.
 *
 * Rhino prefixes the show with a venue code taken from the portal, for example
 * "(SFA) JOURNEY" at State Farm Arena. Those pairs seed the list below so
 * Crew One and IATSE use the same codes. Add a venue here when you want a
 * stable abbreviation; anything not listed gets a generated code.
 *
 * "(C)" on a Rhino show is corporate, not a venue, and is left in the title.
 *
 * @type {{ names: string[]; abbreviation: string }[]}
 */
export const VENUE_ABBREVIATIONS = [
  { names: ["State Farm Arena"], abbreviation: "SFA" },
  { names: ["The Tabernacle", "Tabernacle"], abbreviation: "TB" }
];

/** Show-title prefixes that are not venue codes. */
const NON_VENUE_SHOW_CODES = new Set(["C"]);

const SKIP_WORDS = new Set(["the", "a", "an", "of", "at", "and", "for"]);
const GENERATED_INITIALS_MAX = 5;

/** @type {Map<string, string>} */
const abbreviationByVenueKey = new Map();
for (const entry of VENUE_ABBREVIATIONS) {
  const abbreviation = String(entry.abbreviation || "").trim().toUpperCase();
  if (!abbreviation) continue;
  for (const name of entry.names) {
    const key = normalizeVenueKey(name);
    if (key) abbreviationByVenueKey.set(key, abbreviation);
  }
}

/**
 * Rhino venue cells append the street address after the building name.
 * @param {string} venue
 */
export function venueNameForAbbreviation(venue) {
  const text = String(venue || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const addressAt = text.search(/\s+\d/);
  const name = addressAt === -1 ? text : text.slice(0, addressAt);
  return name.replace(/\bvenue info\b/gi, "").replace(/\s+/g, " ").trim();
}

/** @param {string} venue */
export function normalizeVenueKey(venue) {
  return venueNameForAbbreviation(venue)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Leading "(SFA)" / "CANCELLED (TB)" venue code from a Rhino show name.
 * Corporate "(C)" is not a venue code.
 * @param {string} show
 * @returns {string}
 */
export function abbreviationFromShowTitle(show) {
  const match = String(show || "")
    .trim()
    .match(/^(?:(?:cancelled|canceled)\s+)?\(([A-Za-z0-9]{1,8})\)/i);
  if (!match) return "";
  const code = match[1].toUpperCase();
  return NON_VENUE_SHOW_CODES.has(code) ? "" : code;
}

/**
 * @param {string} venue
 * @returns {string}
 */
export function lookupConfiguredAbbreviation(venue) {
  const key = normalizeVenueKey(venue);
  if (!key) return "";
  if (abbreviationByVenueKey.has(key)) return abbreviationByVenueKey.get(key);

  let best = "";
  let bestLength = 0;
  for (const [name, abbreviation] of abbreviationByVenueKey) {
    if (name.length <= bestLength) continue;
    if (key === name || key.startsWith(`${name} `)) {
      best = abbreviation;
      bestLength = name.length;
    }
  }
  return best;
}

/**
 * Initials of the venue name, used when no portal code or configured code exists.
 * @param {string} venue
 * @returns {string}
 */
export function generateVenueAbbreviation(venue) {
  const words = normalizeVenueKey(venue)
    .split(" ")
    .filter((word) => word && !SKIP_WORDS.has(word));
  if (words.length === 0) return "";
  if (words.length === 1) {
    const word = words[0].toUpperCase();
    return word.length <= 5 ? word : word.slice(0, 4);
  }
  return words
    .map((word) => word[0])
    .join("")
    .slice(0, GENERATED_INITIALS_MAX)
    .toUpperCase();
}

/**
 * Venue code for a calendar title.
 * Rhino codes come from the show title. Other portals use the shared list,
 * then a generated code.
 * @param {{ show?: string; venue?: string; venueAbbreviation?: string; source?: string }} entry
 * @param {string} [source]
 * @returns {string}
 */
export function resolveVenueAbbreviation(entry, source) {
  const resolvedSource = source || entry?.source || "rhino";
  if (resolvedSource === "rhino") {
    const fromShow = abbreviationFromShowTitle(entry?.show);
    if (fromShow) return fromShow;
  }

  const explicit = String(entry?.venueAbbreviation || "").trim();
  if (explicit) return explicit.toUpperCase();

  const configured = lookupConfiguredAbbreviation(entry?.venue);
  if (configured) return configured;

  return generateVenueAbbreviation(entry?.venue);
}

/**
 * Prefix a show title with "(SFA)" unless that code is already present.
 * @param {string} show
 * @param {string} abbreviation
 */
export function formatShowWithVenueAbbreviation(show, abbreviation) {
  const title = String(show || "").trim();
  const code = String(abbreviation || "").trim();
  if (!code) return title;
  if (new RegExp(`\\(${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`, "i").test(title)) {
    return title;
  }
  return title ? `(${code}) ${title}` : `(${code})`;
}
