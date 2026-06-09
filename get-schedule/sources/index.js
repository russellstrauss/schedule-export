import * as rhino from "./rhino.js";
import * as crewOne from "./crewOne.js";
import * as iatse927 from "./iatse927.js";

/** @type {Record<string, typeof rhino>} */
export const sources = {
  rhino,
  crewOne,
  iatse927
};

/**
 * @returns {string[]}
 */
export function getEnabledSourceIds() {
  const raw = process.env.SCHEDULE_SOURCES || "rhino";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {string} id
 */
export function getSource(id) {
  const source = sources[id];
  if (!source) {
    throw new Error(`Unknown schedule source: ${id}. Known: ${Object.keys(sources).join(", ")}`);
  }
  return source;
}
