// get-schedule/google-calendar/add-event.js
import crypto from "crypto";
import { google } from "googleapis";
import { normalizeScheduleRowId, crewOneRowMatchKey, rhinoRowMatchKey } from "../utils.js";

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

	if (source === "crewOne") {
		const matchKey = crewOneRowMatchKey(event.rowId);
		const existing = await findCrewOneEventByMatchKey(calendar, source, matchKey);
		if (existing?.id) {
			const res = await calendar.events.update({
				calendarId: "primary",
				eventId: existing.id,
				requestBody
			});
			return { action: "updated", event: res.data };
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
 * @param {import("googleapis").calendar_v3.Calendar} calendar
 * @param {string} source
 * @param {string} matchKey
 */
async function findCrewOneEventByMatchKey(calendar, source, matchKey) {
	const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
	const sourceEvents = await listSourceEvents(calendar, source, timeMin);
	return (
		sourceEvents.find((ev) => {
			const rowId = rowIdFromEvent(ev, source);
			return rowId && crewOneRowMatchKey(rowId) === matchKey;
		}) || null
	);
}

/**
 * True when a calendar event's stored rowId matches a row in the given set.
 * Mirrors how rows are matched for both the "still active" and "cancelled" checks,
 * including the relaxed source-specific fallbacks: CrewOne ignores detail-page
 * position/type drift, Rhino ignores call-time drift.
 * @param {string} source
 * @param {string} rowId
 * @param {Set<string>} normalizedSet
 * @param {Set<string> | null} relaxedKeys
 */
function rowIdInSet(source, rowId, normalizedSet, relaxedKeys) {
	const normalized = normalizeScheduleRowId(rowId);
	if (normalizedSet.has(normalized)) return true;
	if (relaxedKeys) {
		if (source === "crewOne" && relaxedKeys.has(crewOneRowMatchKey(rowId))) return true;
		if (source === "rhino" && relaxedKeys.has(rhinoRowMatchKey(rowId))) return true;
	}
	return false;
}

/**
 * @param {import("googleapis").calendar_v3.Calendar} calendar
 * @param {string} source
 * @param {string} rowId
 * @param {string} [listedEventId]
 */
async function deleteSourceEventByRowId(calendar, source, rowId, listedEventId) {
	const idsToTry = [...eventIdsForDelete(source, rowId)];
	if (listedEventId) idsToTry.push(listedEventId);

	let deleted = false;
	for (const eventId of [...new Set(idsToTry)]) {
		try {
			await calendar.events.delete({ calendarId: "primary", eventId });
			deleted = true;
			break;
		} catch (err) {
			const notFound = err?.code === 404 || err?.response?.status === 404;
			if (!notFound) {
				console.error(`deleteSourceEventByRowId(${source}): delete failed for ${eventId}`, err);
				throw err;
			}
		}
	}
	if (!deleted) {
		console.warn(`deleteSourceEventByRowId(${source}): could not delete event for row ${rowId}`);
	}
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
		await deleteSourceEventByRowId(calendar, source, rowId, ev.id);
	}
}

/**
 * Reconcile tagged calendar events against the latest schedule fetch.
 *
 * Safety contract (the whole point of this function): an event is removed ONLY when
 * the latest fetch positively says its row was cancelled. An event that is merely
 * *absent* from the fetch — because of a partial/failed scrape, a portal hiccup, a
 * reschedule, or row-id drift — is always KEPT. This guarantees that real future
 * shifts are never silently deleted off the calendar.
 *
 * As an extra guard, if the schedule snapshot is empty (no active and no cancelled
 * rows), we skip the purge entirely, since that almost always means the fetch failed.
 *
 * removeAbsent opts a source out of the "absent -> keep" contract: when the latest
 * fetch is a complete snapshot of all upcoming events (e.g. the CrewOne dashboard),
 * an event that is no longer in the active set has genuinely been taken off the
 * schedule and should be removed. The empty-snapshot hard guard still applies.
 *
 * @param {OAuth2Client} auth
 * @param {string} source
 * @param {string[]} activeRowIds - row ids present (and not cancelled) in the latest fetch
 * @param {{ futureOnly?: boolean; cancelledRowIds?: string[]; removeAbsent?: boolean }} [options]
 *   cancelledRowIds: row ids that appeared in the latest fetch but were explicitly
 *   cancelled. These are eligible for deletion.
 *   removeAbsent: when true, also delete events missing from the active set (the
 *   fetch is treated as an authoritative complete snapshot).
 */
export async function purgeOrphanedSourceEvents(auth, source, activeRowIds, options = {}) {
	const futureOnly = options.futureOnly !== false;
	const cancelledRowIds = options.cancelledRowIds || [];
	const removeAbsent = options.removeAbsent === true;

	const activeSet = new Set(activeRowIds.map(normalizeScheduleRowId));
	const cancelledSet = new Set(cancelledRowIds.map(normalizeScheduleRowId));
	// Relaxed match keys used to keep events still on the schedule and to match
	// cancelled rows whose identity drifted (CrewOne detail position/type, Rhino call
	// time). Active matching uses the relaxed key only for CrewOne; Rhino relaxes the
	// cancelled match only, which is safe because active rows are matched exactly first.
	const activeRelaxedKeys =
		source === "crewOne" ? new Set(activeRowIds.map(crewOneRowMatchKey)) : null;
	const cancelledRelaxedKeys =
		source === "crewOne"
			? new Set(cancelledRowIds.map(crewOneRowMatchKey))
			: source === "rhino"
				? new Set(cancelledRowIds.map(rhinoRowMatchKey))
				: null;

	// Hard guard: an empty schedule snapshot almost always means a failed or partial
	// fetch (login issue, portal outage, empty table). Never delete anything in that
	// case — this is the primary protection against wiping future events.
	//
	// Exception: removeAbsent sources only reach this point after a verified-complete
	// fetch (see crewOne loginAndOpenDashboard), so an empty snapshot genuinely means
	// every call was taken off the schedule and the stale events should be removed.
	if (activeSet.size === 0 && cancelledSet.size === 0) {
		console.warn("No currently scheduled events.");
		if (!removeAbsent) return;
	}

	const calendar = google.calendar({ version: "v3", auth });
	const timeMin = futureOnly
		? new Date().toISOString()
		: new Date(
				Date.now() - PURGE_LOOKBACK_YEARS * 365.25 * 24 * 60 * 60 * 1000
			).toISOString();

	const sourceEvents = await listSourceEvents(calendar, source, timeMin);

	let deletedCount = 0;
	for (const ev of sourceEvents) {
		const rowId = rowIdFromEvent(ev, source);
		if (!rowId) continue;

		// Still on the schedule -> always keep.
		if (rowIdInSet(source, rowId, activeSet, activeRelaxedKeys)) continue;

		// An event no longer in the active set is deleted when EITHER the latest fetch
		// positively cancelled it, OR the source is an authoritative snapshot
		// (removeAbsent) where absence means it was taken off the schedule. Otherwise
		// absent events are kept so real shifts survive scrape gaps / reschedules / drift.
		const cancelled = rowIdInSet(source, rowId, cancelledSet, cancelledRelaxedKeys);
		if (!cancelled && !removeAbsent) continue;

		const reason = cancelled ? "cancelled" : "removed from schedule";
		console.log(
			`purgeOrphanedSourceEvents(${source}): removing ${reason} event ${ev.id} (row "${rowId}")`
		);
		await deleteSourceEventByRowId(calendar, source, rowId, ev.id);
		deletedCount += 1;
	}

	if (deletedCount > 0) {
		console.log(
			`purgeOrphanedSourceEvents(${source}): removed ${deletedCount} event(s) no longer on the schedule.`
		);
	}
}

/** @deprecated Use purgeSourceEvents(auth, "rhino") */
export async function purgeRhinoEvents(auth) {
	return purgeSourceEvents(auth, "rhino");
}
