# schedule-export

Syncs upcoming work calls from Rhino, Crew One, and IATSE 927 SMS into one Google Calendar.

The HTTP Cloud Function (`syncSchedule` in `main.js`) does two jobs:

- **Batch sync** (Cloud Scheduler or `node sync.js`): scrape enabled portal sources, then re-parse stored IATSE messages with Gemini and upsert calendar events.
- **IATSE ingest** (`POST` with `mode: ingest` / `source: iatse927`): store one SMS in Firestore and sync the IATSE calendar in the background.

## Local setup

1. Copy `.env.example` to `.env` and fill in portal credentials, Google OAuth, and (for IATSE) `GEMINI_API_KEY` plus Firestore project.
2. Place Google OAuth `credentials.json` in `get-schedule/google-calendar/` and authorize once:

```bash
node scripts/authorize-calendar.js
```

3. Run a full local sync:

```bash
node sync.js
```

Or start the Functions Framework (OAuth redirect URI `http://localhost:8080`):

```bash
npm start
```

IATSE helpers: `npm run bootstrap:iatse927`, `npm run list:iatse927`, `npm run sync:iatse927`.

## Tests

```bash
npm test          # unit tests (watch)
npm run test:run  # unit tests once
npm run test:integration  # live smoke test against the deployed function
```

See [tests/TESTING.md](tests/TESTING.md) and [tests/README.md](tests/README.md).

## Deploy

Node 24 Cloud Function + Cloud Scheduler. Scripts live in `deployment/`. See [deployment/DEPLOYMENT.md](deployment/DEPLOYMENT.md).
