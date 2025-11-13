const { google } = require('googleapis');
const authorize = require('./auth');

async function addEvent() {
  const auth = await authorize();
  const calendar = google.calendar({ version: 'v3', auth });

  const event = {
    summary: 'Team Sync',
    location: 'Zoom',
    description: 'Weekly team sync-up',
    start: {
      dateTime: '2025-11-14T10:00:00-05:00',
      timeZone: 'America/New_York',
    },
    end: {
      dateTime: '2025-11-14T11:00:00-05:00',
      timeZone: 'America/New_York',
    },
    attendees: [{ email: 'teammate@example.com' }],
  };

  const res = await calendar.events.insert({
    calendarId: 'primary',
    resource: event,
  });

  console.log('Event created: %s', res.data.htmlLink);
}

addEvent();