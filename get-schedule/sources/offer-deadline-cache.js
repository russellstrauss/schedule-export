import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CACHE_PATH = path.join(__dirname, ".crewone-offer-deadlines.json");

function resolveCachePath(cachePath) {
  if (cachePath) return cachePath;
  if (process.env.CREWONE_OFFER_DEADLINE_CACHE) return process.env.CREWONE_OFFER_DEADLINE_CACHE;
  return DEFAULT_CACHE_PATH;
}

function normalizeDetailUrl(detailUrl) {
  if (!detailUrl) return "";
  try {
    const url = new URL(detailUrl, "https://portal.crew1.com");
    return `${url.origin}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return String(detailUrl).trim();
  }
}

function readCache(cachePath) {
  try {
    const raw = fs.readFileSync(resolveCachePath(cachePath), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeCache(cache, cachePath) {
  fs.writeFileSync(resolveCachePath(cachePath), `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

/**
 * Remember an offer deadline scraped from a response/detail page.
 * Crew One removes the "This offer closes..." text after expiry; caching keeps
 * deadline reminders available while the offer still appears on the dashboard.
 * @param {string} detailUrl
 * @param {string} offerDeadlineText
 * @param {string} [cachePath]
 */
export function rememberOfferDeadline(detailUrl, offerDeadlineText, cachePath) {
  const key = normalizeDetailUrl(detailUrl);
  const text = String(offerDeadlineText || "").trim();
  if (!key || !text) return;
  const resolved = resolveCachePath(cachePath);
  const cache = readCache(resolved);
  if (cache[key] === text) return;
  cache[key] = text;
  writeCache(cache, resolved);
}

/**
 * @param {string} detailUrl
 * @param {string} [cachePath]
 * @returns {string}
 */
export function recallOfferDeadline(detailUrl, cachePath) {
  const key = normalizeDetailUrl(detailUrl);
  if (!key) return "";
  const cache = readCache(resolveCachePath(cachePath));
  return String(cache[key] || "").trim();
}

export function offerDeadlineCachePath() {
  return resolveCachePath();
}
