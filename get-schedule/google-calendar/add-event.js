// get-schedule/google-calendar/add-event.js
import crypto from "crypto";
import { google } from "googleapis";

/** Configuration */
const DEFAULT_TIMEZONE = "America/New_York";
const ID_LENGTH = 40;
const PURGE_LOOKBACK_YEARS = 2;

/** Build a stable, URL-safe id for a source row */
export function deterministicIdFor(source, rowId) {
	if (rowId == null) rowId = "";
	const key = `${source}|${rowId}`;
	return crypto.createHash("sha256").update(String(key)).digest("hex").slice(0, ID_LENGTH);
}

/** Pre-multi-source id (hash of rowId only); used for legacy Rhino calendar events */
export function legacyRhinoDeterministicIdFor(rowId) {
	if (rowId == null) rowId = "";
	return crypto.createHash("sha256").update(String(rowId)).digest("hex").slice(0, ID_LENGTH);
}

function eventIdsForDelete(source, rowId) {
	const ids = [deterministicIdFor(source, rowId)];
	if (source === "rhino") {
		ids.push(legacyRhinoDeterministicIdFor(rowId));
	}
	return [...new Set(ids)];
}

/** @param {import("googleapis").calendar_v3.Schema$Event} ev */
export function eventMatchesSource(ev, source) {
	const priv = ev.extendedProperties?.private;
	if (!priv) return false;
	if (priv.scheduleSource === source) return true;
	if (source === "rhino" && priv.rhinoRowId) return true;
	return false;
}

/** Row id stored on the event for purge/delete */
export function rowIdFromEvent(ev, source) {
	const priv = ev.extendedProperties?.private;
	if (!priv) return null;
	if (priv.scheduleRowId) return priv.scheduleRowId;
	if (source === "rhino" && priv.rhinoRowId) return priv.rhinoRowId;
	return null;
}

/** Normalize a source event into the shape Google expects */
function normalizeEventBody(event) {
	const source = event.source || "rhino";
	const rowId = String(event.rowId || "");
	const privateProps = {
		scheduleSource: source,
		scheduleRowId: rowId
	};
	if (source === "rhino") {
		privateProps.rhinoRowId = rowId;
	}

	return {
		summary: event.summary || "",
		location: event.location || "",
		description: event.description || "",
		start: {
			dateTime: event.start,
			timeZone: DEFAULT_TIMEZONE
		},
		end: {
			dateTime: event.end,
			timeZone: DEFAULT_TIMEZONE
		},
		status: event.status || "confirmed",
		extendedProperties: {
			private: privateProps
		}
	};
}

/**
 * Sync a single event: update if exists by deterministic id, otherwise insert with that id.
 * @param {OAuth2Client} auth
 * @param {Object} event - { summary, location, description, start, end, status, rowId, source }
 */
export async function syncEvent(auth, event) {
	const calendar = google.calendar({ version: "v3", auth });
	const source = event.source || "rhino";
	const newEventId = deterministicIdFor(source, event.rowId);
	const requestBody = normalizeEventBody(event);

	const candidateIds = [newEventId];
	if (source === "rhino") {
		candidateIds.push(legacyRhinoDeterministicIdFor(event.rowId));
	}

	for (const eventId of candidateIds) {
		try {
			await calendar.events.get({ calendarId: "primary", eventId });
			const res = await calendar.events.update({
				calendarId: "primary",
				eventId,
				requestBody
			});
			return { action: "updated", event: res.data };
		} catch (err) {
			const notFound = err?.code === 404 || err?.response?.status === 404;
			if (!notFound) {
				console.error("syncEvent: error during get:", err);
				return { action: "error", error: err };
			}
		}
	}

	try {
		const insertBody = { ...requestBody, id: newEventId };
		const res = await calendar.events.insert({
			calendarId: "primary",
			requestBody: insertBody
		});
		return { action: "created", event: res.data };
	} catch (insertErr) {
		console.error("syncEvent: insert error:", insertErr);
		if (insertErr.response?.data?.error) {
			console.error("Error details:", JSON.stringify(insertErr.response.data.error, null, 2));
		}
		return { action: "error", error: insertErr };
	}
}

export async function addEvent(auth, event) {
	return syncEvent(auth, event);
}

/**
 * @param {import("googleapis").calendar_v3.Calendar} calendar
 * @param {string} source
 * @param {string} timeMin
 * @returns {Promise<import("googleapis").calendar_v3.Schema$Event[]>}
 */
async function listSourceEvents(calendar, source, timeMin) {
	/** @type {import("googleapis").calendar_v3.Schema$Event[]} */
	const sourceEvents = [];
	let pageToken;

	do {
		const res = await calendar.events.list({
			calendarId: "primary",
			timeMin,
			singleEvents: true,
			orderBy: "startTime",
			maxResults: 2500,
			pageToken
		});
		const items = res.data.items || [];
		sourceEvents.push(...items.filter((e) => eventMatchesSource(e, source)));
		pageToken = res.data.nextPageToken;
	} while (pageToken);

	return sourceEvents;
}

/**
 * Delete events tagged for a schedule source.
 * @param {OAuth2Client} auth
 * @param {string} source
 * @param {{ futureOnly?: boolean }} [options] - futureOnly true (default) preserves past events
 */
export async function purgeSourceEvents(auth, source, options = {}) {
	const futureOnly = options.futureOnly !== false;
	const calendar = google.calendar({ version: "v3", auth });
	const timeMin = futureOnly
		? new Date().toISOString()
		: new Date(
				Date.now() - PURGE_LOOKBACK_YEARS * 365.25 * 24 * 60 * 60 * 1000
			).toISOString();

	const sourceEvents = await listSourceEvents(calendar, source, timeMin);

	for (const ev of sourceEvents) {
		const rowId = rowIdFromEvent(ev, source);
		if (!rowId) continue;

		const idsToTry = [...eventIdsForDelete(source, rowId), ev.id];
		let deleted = false;
		for (const eventId of idsToTry) {
			try {
				await calendar.events.delete({ calendarId: "primary", eventId });
				deleted = true;
				break;
			} catch (err) {
				const notFound = err?.code === 404 || err?.response?.status === 404;
				if (!notFound) {
					console.error(`purgeSourceEvents(${source}): delete failed for ${eventId}`, err);
					throw err;
				}
			}
		}
		if (!deleted) {
			console.warn(`purgeSourceEvents(${source}): could not delete event for row ${rowId}`);
		}
	}
}

/** @deprecated Use purgeSourceEvents(auth, "rhino") */
export async function purgeRhinoEvents(auth) {
	return purgeSourceEvents(auth, "rhino");
}
