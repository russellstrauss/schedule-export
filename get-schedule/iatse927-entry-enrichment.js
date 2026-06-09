import {
  classifyMessageKind,
  extractSchedulingHints
} from "./iatse927-message-context.js";

/**
 * @param {import("./sources/types.js").ScheduleEntry} entry
 * @param {string} text
 */
function entryMatchesReminder(entry, text) {
  const hints = extractSchedulingHints(text);
  if (hints.dates.length === 0) return false;

  const entryDate = entry.date?.trim();
  const dateHit = hints.dates.some((d) => d === entryDate);
  if (!dateHit) return false;

  const lower = text.toLowerCase();
  const show = entry.show?.trim().toLowerCase();
  const venue = entry.venue?.trim().toLowerCase();

  if (show && lower.includes(show)) return true;
  if (venue && lower.includes(venue.slice(0, Math.min(8, venue.length)))) return true;

  const showFirstWord = show?.split(/\s+/)[0];
  return Boolean(showFirstWord && showFirstWord.length > 2 && lower.includes(showFirstWord));
}

/**
 * @param {import("./sources/types.js").ScheduleEntry} entry
 * @param {{ text: string }[]} messages
 * @returns {string | undefined}
 */
export function resolveReminderSourceText(entry, messages) {
  const indices = entry.evidenceIndices ?? [];
  /** @type {string[]} */
  const texts = [];

  for (const index of indices) {
    const text = messages[index]?.text?.trim();
    if (!text || classifyMessageKind(text) !== "reminder") continue;
    texts.push(text);
  }

  if (texts.length === 0) {
    for (const msg of messages) {
      const text = msg.text?.trim();
      if (!text || classifyMessageKind(text) !== "reminder") continue;
      if (entryMatchesReminder(entry, text)) texts.push(text);
    }
  }

  const unique = [...new Set(texts)];
  return unique.length > 0 ? unique.join("\n\n---\n\n") : undefined;
}

/**
 * Attach verbatim reminder SMS and ensure details from Gemini are preserved.
 * @param {import("./sources/types.js").ScheduleEntry[]} entries
 * @param {{ text: string }[]} messages
 * @returns {import("./sources/types.js").ScheduleEntry[]}
 */
export function enrichIatse927Entries(entries, messages) {
  return entries.map((entry) => ({
    ...entry,
    sourceText: resolveReminderSourceText(entry, messages)
  }));
}
