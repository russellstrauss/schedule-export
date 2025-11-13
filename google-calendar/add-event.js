const { google } = require("googleapis");

async function purgeRhinoEvents(auth) {
	const calendar = google.calendar({ version: "v3", auth });
	const now = new Date().toISOString();

	const events = await calendar.events.list({
		calendarId: "primary",
		timeMin: now,
		singleEvents: true,
		orderBy: "startTime"
	});

	for (const event of events.data.items) {
		if (event.extendedProperties?.private?.source === "rhino-schedule") {
			await calendar.events.delete({
				calendarId: "primary",
				eventId: event.id
			});
			console.log(`🗑️ Deleted: ${event.summary}`);
		}
	}
}

async function addEvent(auth, event) {
	const calendar = google.calendar({ version: "v3", auth });

	await calendar.events.insert({
		calendarId: "primary",
		resource: {
			summary: event.summary,
			location: event.location,
			description: event.description,
			start: {
				dateTime: event.start,
				timeZone: "America/New_York",
			},
			end: {
				dateTime: event.end,
				timeZone: "America/New_York",
			},
			status: event.status,
			extendedProperties: {
				private: {
					source: "rhino-schedule"
				}
			}
		},
	});
	console.log(`✅ Created: ${event.summary}`);
}

module.exports = { addEvent, purgeRhinoEvents };