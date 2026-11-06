# schedule-export

Syncs upcoming work calls from Rhino, Crew One, Technical Elements, and IATSE 927 SMS into one Google Calendar.

The HTTP Cloud Function (`syncSchedule` in `main.js`) does two jobs:

- **Batch sync** (Cloud Scheduler or `node sync.js`): scrape enabled portal sources, then re-parse stored IATSE messages with Gemini and upsert calendar events.
- **IATSE ingest** (`POST` with `mode: ingest` / `source: iatse927`): store one SMS in Firestore and sync the IATSE calendar in the background.

## Local setup

1. Copy `.env.example` to `.env` and fill in portal credentials, Google OAuth, and (for IATSE) `GEMINI_API_KEY` plus Firestore project. Turn companies on or off in `user-settings.json`. Portal login pages are fixed in the source.
2. Google Calendar OAuth — **either**:
   - **Env only (recommended on Termux / no JSON files):** set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `GOOGLE_TOKEN` (JSON string from a prior authorize flow). You do not need `credentials.json` or `token.json`.
   - **Or file-based:** place `credentials.json` in `get-schedule/google-calendar/` and authorize once:

```bash
node scripts/authorize-calendar.js
```

   If `GOOGLE_TOKEN` is not set, successful authorize still writes `token.json` next to `auth.js`.

3. **IATSE only via cloud:** set `"iatse927": false` in `user-settings.json` so local `node sync.js` does not touch Firestore/Gemini. Trigger your deployed function (ingest or full sync) for IATSE. Leave portals enabled as you like.

4. Run a full local sync:

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

Pushes to `main` update the production function `sync-schedule`. Pushes to `develop` are built by Cloud Build trigger `push-develop-schedule-sync` and update `sync-schedule-develop`, a separate URL for testing. That URL is not on the midnight schedule. A request without `?mode=health` still runs a real calendar sync.
