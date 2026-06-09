/**
 * @param {string} timeStr HH:mm
 * @returns {string}
 */
function formatCallTimeForDescription(timeStr) {
  const [hours, minutes] = timeStr.split(":").map(Number);
  let hour12 = hours % 12;
  if (hour12 === 0) hour12 = 12;
  const ampm = hours < 12 ? "AM" : "PM";
  if (minutes === 0) return `${hour12} ${ampm}`;
  return `${hour12}:${minutes.toString().padStart(2, "0")} ${ampm}`;
}

/**
 * @param {string | undefined} type
 * @returns {string}
 */
function addressLabel(type) {
  if (type === "Load In") return "Load In Address";
  if (type === "Load Out") return "Load Out Address";
  return "Address";
}

/**
 * @param {string} label
 * @param {string} text
 * @returns {string | undefined}
 */
function extractLabeledValue(text, label) {
  if (!text?.trim()) return undefined;
  const re = new RegExp(`^${label}:\\s*(.+)$`, "im");
  const match = text.trim().match(re);
  return match?.[1]?.trim() || undefined;
}

/**
 * Pull Parking, Steward, Notes from Gemini text without duplicating content.
 * @param {string | undefined} details
 * @param {string | undefined} notes
 */
export function parseSupplementalFields(details, notes) {
  const detailsTrim = details?.trim() || "";
  const notesTrim = notes?.trim() || "";

  const parking =
    extractLabeledValue(detailsTrim, "Parking") ||
    extractLabeledValue(notesTrim, "Parking");

  const steward =
    extractLabeledValue(detailsTrim, "Steward") ||
    extractLabeledValue(notesTrim, "Steward");

  let notesText =
    extractLabeledValue(detailsTrim, "Notes") ||
    extractLabeledValue(notesTrim, "Notes");

  if (notesTrim && detailsTrim) {
    if (notesTrim === detailsTrim) {
      notesText = extractLabeledValue(detailsTrim, "Notes");
    } else if (detailsTrim.includes(notesTrim)) {
      notesText = extractLabeledValue(detailsTrim, "Notes");
    } else if (notesTrim.includes(detailsTrim)) {
      notesText = extractLabeledValue(notesTrim, "Notes") || notesText;
    } else if (notesText && detailsTrim.includes(notesText) && notesTrim.includes(notesText)) {
      // same Notes line repeated in both fields
    } else if (!notesText && !extractLabeledValue(notesTrim, "Show")) {
      const looksLikeDuplicate =
        (parking && notesTrim.includes(parking)) ||
        (steward && notesTrim.includes(steward)) ||
        notesTrim.length > 40;
      if (looksLikeDuplicate) {
        notesText = undefined;
      }
    }
  }

  return { parking, steward, notes: notesText };
}

/**
 * Calendar location: street address when provided, otherwise venue name.
 * @param {import("./sources/types.js").ScheduleEntry} entry
 * @returns {string}
 */
export function resolveIatse927EventLocation(entry) {
  const address = entry.location?.trim();
  if (address) return address;
  return entry.venue?.trim() || "";
}

/**
 * @param {import("./sources/types.js").ScheduleEntry} entry
 * @returns {string}
 */
export function buildIatse927EventDescription(entry) {
  const extras = parseSupplementalFields(entry.details, entry.notes);
  /** @type {string[]} */
  const lines = [];

  if (entry.show?.trim()) {
    lines.push(`Show: ${entry.show.trim()}`);
  }

  if (entry.type && entry.callTime) {
    lines.push(`Call: ${entry.type} at ${formatCallTimeForDescription(entry.callTime)}`);
  }

  if (entry.venue?.trim()) {
    lines.push(`Venue: ${entry.venue.trim()}`);
  }

  if (entry.location?.trim()) {
    lines.push(`${addressLabel(entry.type)}: ${entry.location.trim()}`);
  }

  if (extras.parking) lines.push(`Parking: ${extras.parking}`);
  if (extras.steward) lines.push(`Steward: ${extras.steward}`);
  if (extras.notes) lines.push(`Notes: ${extras.notes}`);

  let description = lines.join("\n");

  if (entry.sourceText?.trim()) {
    description += `\n\nOriginal message:\n${entry.sourceText.trim()}`;
  }

  return description;
}
