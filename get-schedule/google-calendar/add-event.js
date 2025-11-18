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
		// Not found: insert with deterministic id in the request body
		try {
			// Include the custom event ID in the request body
			const insertBody = { ...requestBody, id: eventId };
			const res = await calendar.events.insert({
				calendarId: "primary",
				requestBody: insertBody
			});
			return { action: "created", event: res.data };
		} catch (insertErr) {
			// If insert fails due to id collision or invalid id, surface error
			console.error("syncEvent: insert error:", insertErr);
			// Log more details about the error for debugging
			if (insertErr.response?.data?.error) {
				console.error("Error details:", JSON.stringify(insertErr.response.data.error, null, 2));
			}
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
