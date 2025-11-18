// get-schedule/google-calendar/add-event.js
import crypto from "crypto";
import { google } from "googleapis";

/** Configuration */
const DEFAULT_TIMEZONE = "America/New_York";
const ID_LENGTH = 40; // truncate hex to this length (safe, < 1024 chars)

/** Build a stable, URL-safe id for a source row */
function deterministicIdFor(rowId) {
	if (rowId == null) rowId = "";
	const hash = crypto.createHash("sha256").update(String(rowId)).digest("hex").slice(0, ID_LENGTH);
	return hash;
}

/** Normalize a source event into the shape Google expects */
function normalizeEventBody(event) {
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
			private: {
				rhinoRowId: String(event.rowId || "")
			}
		}
	};
}

/**
 * Sync a single event: update if exists by deterministic id, otherwise insert with that id.
 * Returns { action: "created"|"updated"|"skipped"|"error", event }
 * @param {OAuth2Client} auth
 * @param {Object} event - { summary, location, description, start, end, status, rowId }
 */
export async function syncEvent(auth, event) {
	const calendar = google.calendar({ version: "v3", auth });
	const eventId = deterministicIdFor(event.rowId);
	const requestBody = normalizeEventBody(event);

	try {
		// Try GET by deterministic id
		await calendar.events.get({ calendarId: "primary", eventId });
		// If found, update
		const res = await calendar.events.update({
			calendarId: "primary",
			eventId,
			requestBody
		});

		return { action: "updated", event: res.data };
	} catch (err) {
		const notFound = err?.code === 404 || (err?.response?.status === 404);
		if (!notFound) {
			// Unexpected error — surface it but avoid creating a duplicate when uncertain
			console.error("syncEvent: error during get:", err);
			return { action: "error", error: err };
		}
		// Not found: insert with deterministic id (do NOT include id in body)
		try {
			const res = await calendar.events.insert({
				calendarId: "primary",
				eventId,
				requestBody
			});
			return { action: "created", event: res.data };
		} catch (insertErr) {
			// If insert fails due to id collision or invalid id, surface error
			console.error("syncEvent: insert error:", insertErr);
			return { action: "error", error: insertErr };
		}
	}
}

/**
 * Backwards-compat wrapper: preserve addEvent name for callers that still import it.
 * Delegates to syncEvent.
 */
export async function addEvent(auth, event) {
	return syncEvent(auth, event);
}

/**
 * Delete future Rhino-tagged events (preserves past events)
 * @param {OAuth2Client} auth
 */
export async function purgeRhinoEvents(auth) {
	const calendar = google.calendar({ version: "v3", auth });
	const now = new Date().toISOString();
	const res = await calendar.events.list({
		calendarId: "primary",
		timeMin: now,
		singleEvents: true,
		orderBy: "startTime",
		maxResults: 2500
	});

	const items = res.data.items || [];
	const rhinoEvents = items.filter(e => e.extendedProperties?.private?.rhinoRowId);

	for (const ev of rhinoEvents) {
		const rowId = ev.extendedProperties.private.rhinoRowId;
		const expectedId = deterministicIdFor(rowId);
		try {
			await calendar.events.delete({ calendarId: "primary", eventId: expectedId });

		} catch (err) {
			// fallback to deleting the existing event id if deterministic id not present
			const notFound = err?.code === 404 || (err?.response?.status === 404);
			if (notFound) {
				try {
					await calendar.events.delete({ calendarId: "primary", eventId: ev.id });
				} catch (err2) {
					throw err2;
				}
			} else {
				console.error(`purgeRhinoEvents: delete failed for ${expectedId}`, err);
				throw err;
			}
		}
	}
}

/**
 * Deduplicate existing future events that share the same extendedProperties.private.rhinoRowId.
 * Keeps a single canonical event per key (prefer deterministic id match then latest updated).
 * @param {OAuth2Client} auth
 * @param {Object} options - { dryRun: boolean } - dryRun=true will only log actions
 */
export async function dedupeRhino(auth, options = { dryRun: true }) {
	const calendar = google.calendar({ version: "v3", auth });
	const now = new Date().toISOString();
	const res = await calendar.events.list({
		calendarId: "primary",
		timeMin: now,
		singleEvents: true,
		orderBy: "startTime",
		maxResults: 2500
	});

	const items = res.data.items || [];
	const groups = new Map();

	for (const it of items) {
		const key = it.extendedProperties?.private?.rhinoRowId;
		if (!key) continue;
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(it);
	}

	for (const [key, list] of groups) {
		if (list.length <= 1) continue;
		const desiredId = deterministicIdFor(key);
		// prefer event whose id matches deterministic id
		let keeper = list.find(i => i.id === desiredId);
		if (!keeper) {
			// otherwise choose latest-updated event as keeper
			keeper = list.slice().sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0))[0];
		}
		console.log(`dedupeRhino: key=${key} count=${list.length} keeper=${keeper.id}`);
		for (const ev of list) {
			if (ev.id === keeper.id) continue;
			if (options.dryRun) {
				console.log(`dedupeRhino (dry): would delete ${ev.id} for key ${key}`);
				continue;
			}
			try {
				await calendar.events.delete({ calendarId: "primary", eventId: ev.id });
				console.log(`dedupeRhino: deleted ${ev.id} for key ${key}`);
			} catch (err) {
				console.error(`dedupeRhino: failed to delete ${ev.id}`, err);
			}
		}
	}
}