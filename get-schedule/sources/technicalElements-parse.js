/**
 * Pure parsing for the Technical Elements crew calendar.
 * The crew app is hosted at app.liveforce.co; calendar labels use the
 * staffing company name, Technical Elements.
 */

export const sourceId = "technicalElements";
export const sourceDisplayName = "Technical Elements";

export const DEFAULT_LOGIN_URL = "https://app.liveforce.co/login";
export const DEFAULT_API_BASE = "https://admin.liveforce.co/proxy/api";
export const DEFAULT_APP_ORIGIN = "https://app.liveforce.co";
export const DEFAULT_TIMEZONE = "America/New_York";

export const UPCOMING_PAGE_SIZE = 40;
// Day rows, not shifts. The next request starts on the newest day already
// loaded, so each full page adds about one page of new days. 120 pages is
// about twelve years. A shorter cap aborted real upcoming lists.
export const UPCOMING_MAX_PAGES = 120;

/** @returns {string[]} */
export function missingCredentialEnvVars() {
  const missing = [];
  if (!process.env.TECHNICAL_ELEMENTS_EMAIL) missing.push("TECHNICAL_ELEMENTS_EMAIL");
  if (!process.env.TECHNICAL_ELEMENTS_PASSWORD) missing.push("TECHNICAL_ELEMENTS_PASSWORD");
  return missing;
}

export function getCredentials() {
  if (missingCredentialEnvVars().length > 0) return null;
  return {
    email: process.env.TECHNICAL_ELEMENTS_EMAIL,
    password: process.env.TECHNICAL_ELEMENTS_PASSWORD,
    loginUrl: DEFAULT_LOGIN_URL,
    apiBase: DEFAULT_API_BASE,
    timezone: DEFAULT_TIMEZONE
  };
}

/** @param {string} loginUrl */
export function appOriginFromLoginUrl(loginUrl) {
  try {
    return new URL(loginUrl).origin;
  } catch {
    return DEFAULT_APP_ORIGIN;
  }
}

/** @param {string} value */
function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/**
 * @param {string | number | null | undefined} iso
 * @param {string} [timeZone]
 * @returns {{ date: string; callTime: string; hours: number; minutes: number } | null}
 */
export function zonedPartsFromIso(iso, timeZone = DEFAULT_TIMEZONE) {
  if (iso == null || iso === "") return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const format = (zone) => {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });
    /** @type {Record<string, string>} */
    const parts = {};
    formatter.formatToParts(date).forEach((part) => {
      if (part.type !== "literal") parts[part.type] = part.value;
    });
    let hours = Number(parts.hour);
    if (hours === 24) hours = 0;
    const minutes = Number(parts.minute);
    return {
      date: `${Number(parts.month)}/${Number(parts.day)}/${parts.year}`,
      callTime: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
      hours,
      minutes
    };
  };

  try {
    return format(timeZone || DEFAULT_TIMEZONE);
  } catch {
    return format(DEFAULT_TIMEZONE);
  }
}

/** @param {number} hours @param {number} minutes */
export function formatClock(hours, minutes) {
  const suffix = hours < 12 ? "AM" : "PM";
  let hour12 = hours % 12;
  if (hour12 === 0) hour12 = 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

/**
 * Calendar-day cursor used by the upcoming endpoint (`yyyy-MM-dd`).
 * @param {string | number | null | undefined} value
 */
export function toYmd(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const asNumber = Number(text);
  const date = new Date(Number.isFinite(asNumber) && text.length >= 12 ? asNumber : text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/** @param {any} role */
export function roleIdentity(role) {
  if (role?.crewJobId != null && role.crewJobId !== "") return `crew:${role.crewJobId}`;
  const start = role?.startDate || "";
  if (role?.id != null && role.id !== "") return `role:${role.id}:${start}`;
  return `role:${start}:${clean(role?.name)}:${clean(role?.job?.headline)}`;
}

/**
 * accepted shifts are booked. pending shifts are still on the upcoming
 * calendar (invitations, applications, reserve list). declined shifts were
 * cancelled or turned down.
 * @param {any} role
 * @returns {"accepted" | "pending" | "declined"}
 */
export function classifyTechnicalElementsOffer(role) {
  const status = clean(role?.crewJobStatus).toLowerCase();
  if (!status) return "pending";
  if (status.includes("cancel") || status === "declined" || status === "deleted") return "declined";
  if (status === "approved") return "accepted";
  return "pending";
}

/** @param {any} body */
export function upcomingPayloadData(body) {
  if (!body || typeof body !== "object" || body.success === false) return null;
  if (Array.isArray(body.dates)) return body;
  const data = body.data;
  if (data && typeof data === "object" && (Array.isArray(data.dates) || "totalJobs" in data)) {
    return data;
  }
  return null;
}

/** @param {any} body */
function failureDetail(body) {
  if (!body || typeof body !== "object") return "";
  if (typeof body.message === "string" && body.message.trim()) return body.message.trim();
  if (typeof body.error === "string" && body.error.trim()) return body.error.trim();
  if (Array.isArray(body.errors)) {
    return body.errors
      .map((error) => (typeof error === "string" ? error : error?.message || error?.detail || ""))
      .filter(Boolean)
      .join("; ");
  }
  return "";
}

/**
 * The LiveForce client sorts day rows and sends the newest day as `offset`.
 * The raw `dates` array is not ordered, so the last element can be the oldest
 * day in the window. Following that day only advances the cursor by one day
 * while every page stays full.
 * @param {any[]} dates
 * @returns {string | null}
 */
function newestDayYmd(dates) {
  /** @type {string | null} */
  let newest = null;
  for (const day of dates) {
    const ymd = toYmd(day?.date);
    if (!ymd) continue;
    if (newest === null || ymd > newest) newest = ymd;
  }
  return newest;
}

/**
 * Walk upcoming pages until the last day page.
 * `fetchPage` returns `{ ok, status, body }`.
 * @param {(query: { offset: string | null; perPage: number }) => Promise<{ ok?: boolean; status?: number; body?: any }>} fetchPage
 * @param {{ perPage?: number; maxPages?: number }} [options]
 */
export async function collectUpcomingRoles(fetchPage, options = {}) {
  const perPage = options.perPage ?? UPCOMING_PAGE_SIZE;
  const maxPages = options.maxPages ?? UPCOMING_MAX_PAGES;
  const seen = new Set();
  /** @type {any[]} */
  const roles = [];
  /** @type {string | null} */
  let offset = null;
  /** @type {string | null} */
  let spanStart = null;
  /** @type {string | null} */
  let spanEnd = null;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    const result = await fetchPage({ offset, perPage });
    if (!result || result.ok === false) {
      const status = result?.status ? ` (${result.status})` : "";
      const detail = failureDetail(result?.body);
      throw new Error(
        `Technical Elements calendar request failed${status}${detail ? `: ${detail}` : "."}`
      );
    }

    const data = upcomingPayloadData(result.body);
    if (!data) {
      const detail = failureDetail(result.body);
      throw new Error(
        `Technical Elements calendar response was not recognized${detail ? `: ${detail}` : "."}`
      );
    }

    const dates = Array.isArray(data.dates) ? data.dates : [];
    if (dates.length === 0) return roles;

    for (const day of dates) {
      const ymd = toYmd(day?.date);
      if (!ymd) continue;
      if (!spanStart || ymd < spanStart) spanStart = ymd;
      if (!spanEnd || ymd > spanEnd) spanEnd = ymd;
    }

    let added = 0;
    for (const day of dates) {
      for (const role of day?.roles || []) {
        const id = roleIdentity(role);
        if (seen.has(id)) continue;
        seen.add(id);
        roles.push(role);
        added += 1;
      }
    }

    if (dates.length < perPage) return roles;

    const nextOffset = newestDayYmd(dates);
    if (!nextOffset || (offset !== null && nextOffset <= offset)) {
      if (added === 0) return roles;
      throw new Error("Technical Elements calendar page did not include a date to load the next page.");
    }
    offset = nextOffset;
  }

  const span =
    spanStart && spanEnd ? ` (${spanStart} through ${spanEnd}, ${roles.length} shifts)` : "";
  throw new Error(
    `Technical Elements calendar fetch stopped before the last page after ${maxPages} pages${span}.`
  );
}

/** @param {any} contact */
function contactLine(contact) {
  if (!contact || typeof contact !== "object") return "";
  const name = clean(contact.fullName) || clean([contact.firstName, contact.lastName].filter(Boolean).join(" "));
  const bits = [name, clean(contact.phone), clean(contact.email)].filter(Boolean);
  return bits.join(" · ");
}

/** @param {any} role @param {string} appOrigin */
export function shiftUrlForRole(role, appOrigin) {
  const origin = (appOrigin || DEFAULT_APP_ORIGIN).replace(/\/$/, "");
  const roleId = role?.id;
  const jobId = role?.job?.id;
  const offerState = classifyTechnicalElementsOffer(role);
  if (offerState === "accepted" && roleId != null && roleId !== "") {
    return `${origin}/confirmed-role/${roleId}`;
  }
  if (jobId != null && jobId !== "" && roleId != null && roleId !== "") {
    return `${origin}/job-board/${jobId}/role/${roleId}?returnTo=my-calendar`;
  }
  return `${origin}/my-calendar/upcoming`;
}

/**
 * @param {any} role
 * @param {{ appOrigin?: string }} [options]
 * @returns {import("./types.js").ScheduleEntry | null}
 */
export function mapTechnicalElementsRole(role, options = {}) {
  if (!role || typeof role !== "object") return null;
  const job = role.job && typeof role.job === "object" ? role.job : {};
  const timeZone = clean(job.timezone) || DEFAULT_TIMEZONE;
  const start = zonedPartsFromIso(role.startDate, timeZone);
  if (!start) return null;
  const end = role.endDate ? zonedPartsFromIso(role.endDate, timeZone) : null;

  const headline = clean(job.headline);
  const roleName = clean(role.name);
  const area = clean(role.area);
  let show = headline || roleName || "Untitled shift";
  let position = "";
  let type = "";
  if (headline && roleName && headline.toLowerCase() !== roleName.toLowerCase()) {
    show = headline;
    position = roleName;
    type = area;
  } else {
    position = area;
  }

  const shortName = clean(job.locationShortName || job.locationShortname);
  const address = clean(job.address);
  const venue = shortName || address;
  const location = shortName && address && shortName.toLowerCase() !== address.toLowerCase() ? address : "";

  const offerState = classifyTechnicalElementsOffer(role);
  const crewStatus = clean(role.crewJobStatus);
  const contact = contactLine(role.primaryContact);
  /** @type {string[]} */
  const detailLines = [];
  if (end) detailLines.push(`Until ${formatClock(end.hours, end.minutes)}`);
  if (area && area.toLowerCase() !== position.toLowerCase()) detailLines.push(`Area: ${area}`);
  if (role.reserved) detailLines.push("Reserve list");
  if (contact) detailLines.push(`Contact: ${contact}`);
  detailLines.push(shiftUrlForRole(role, options.appOrigin || DEFAULT_APP_ORIGIN));

  return {
    source: sourceId,
    date: start.date,
    callTime: start.callTime,
    show,
    venue,
    location,
    position,
    type,
    status: offerState === "declined" ? crewStatus || "cancelled" : "confirmed",
    offerState,
    isCallCancelled: offerState === "declined",
    details: detailLines.join("\n"),
    notes: ""
  };
}
