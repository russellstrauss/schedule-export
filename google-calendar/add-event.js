const { google } = require("googleapis");

/**
 * Adds a single event to the user's primary Google Calendar.
 * @param {object} auth - The authorized OAuth2 client.
 * @param {object} event - The event object with summary, location, description, start, end, status.
 */
async function addEvent(auth, event) {
	const calendar = google.calendar({ version: "v3", auth });

	const response = await calendar.events.insert({
		calendarId: "primary",
		resource: {
			summary: event.summary,
			location: event.location,
			description: event.description,
			start: {
				dateTime: event.start,
				timeZone: "America/New_York", // adjust if needed
			},
			end: {
				dateTime: event.end,
				timeZone: "America/New_York",
			},
			status: event.status,
		},
	});

	console.log(`✅ Event created: ${response.data.summary} (${response.data.id})`);
}

module.exports = { addEvent };