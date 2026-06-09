/**
 * @typedef {{ code: string; message: string; entry?: import("./sources/types.js").ScheduleEntry }} ValidationWarning
 */

const DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

/**
 * @param {import("./sources/types.js").ScheduleEntry} entry
 * @returns {ValidationWarning[]}
 */
export function validateEntryShape(entry) {
  /** @type {ValidationWarning[]} */
  const warnings = [];

  if (!entry.date || !DATE_RE.test(entry.date.trim())) {
    warnings.push({
      code: "INVALID_DATE",
      message: `Invalid date format (expected MM/DD/YYYY): ${entry.date}`,
      entry
    });
  }

  if (!entry.callTime || !TIME_RE.test(entry.callTime.trim())) {
    warnings.push({
      code: "INVALID_CALL_TIME",
      message: `Invalid callTime (expected HH:mm 24h): ${entry.callTime}`,
      entry
    });
  }

  if (!entry.show?.trim()) {
    warnings.push({
      code: "MISSING_SHOW",
      message: "Shift missing show name",
      entry
    });
  }

  return warnings;
}

/**
 * @param {import("./sources/types.js").ScheduleEntry[]} entries
 * @param {{ text: string }[]} messages
 * @returns {ValidationWarning[]}
 */
export function validateEvidence(entries, messages) {
  /** @type {ValidationWarning[]} */
  const warnings = [];

  for (const entry of entries) {
    const raw = entry.details || entry.notes || "";
    const indicesMatch = raw.match(/evidence:\s*\[([\d,\s]+)\]/i);
    const indices =
      entry.evidenceIndices ??
      (indicesMatch
        ? indicesMatch[1].split(",").map((x) => parseInt(x.trim(), 10))
        : null);

    if (!indices || !Array.isArray(indices) || indices.length === 0) {
      warnings.push({
        code: "MISSING_EVIDENCE",
        message: `Shift ${entry.date} ${entry.callTime} ${entry.show} has no evidence message indices`,
        entry
      });
      continue;
    }

    for (const index of indices) {
      if (!Number.isInteger(index) || index < 0 || index >= messages.length) {
        warnings.push({
          code: "EVIDENCE_OUT_OF_RANGE",
          message: `Evidence index ${index} out of range (0-${messages.length - 1}) for ${entry.show}`,
          entry
        });
      }
    }
  }

  return warnings;
}

/**
 * @param {ValidationWarning[]} warnings
 */
export function formatValidationReport(warnings) {
  if (warnings.length === 0) return;
  console.warn(
    `⚠️  [iatse927] Validation report (${warnings.length} warning(s)):\n` +
      warnings.map((w) => `  - [${w.code}] ${w.message}`).join("\n")
  );
}

/**
 * @param {import("./sources/types.js").ScheduleEntry[]} entries
 * @returns {ValidationWarning[]}
 */
export function validateAllEntries(entries) {
  return entries.flatMap((entry) => validateEntryShape(entry));
}
