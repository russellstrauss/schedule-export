# schedule-export

Syncs upcoming work calls from Rhino, Crew One, Technical Elements, and IATSE 927 SMS into one Google Calendar.

The HTTP Cloud Function (`syncSchedule` in `main.js`) does two jobs:

- **Batch sync** (Cloud Scheduler or `node sync.js`): scrape enabled portal sources then update calendar events.

## Local setup

1. Copy `.env.example` to `.env` and fill in portal credentials and Google OAuth. Turn companies on or off in `user-settings.json`.
2. Google Calendar OAuth — **either**:
   - **Set environment variables:** set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `GOOGLE_TOKEN`.

```bash
node scripts/authorize-calendar.js
```

4. Run a full local sync:

```bash
node sync.js
```

Or start the Functions Framework (OAuth redirect URI `http://localhost:8080`):

```bash
npm start
```

## Tests

```bash
npm test          # unit tests (watch)
npm run test:run  # unit tests once
npm run test:integration  # live smoke test against the deployed function
```

See [tests/TESTING.md](tests/TESTING.md) and [tests/README.md](tests/README.md).

## Deploy

Node 24 Cloud Function + Cloud Scheduler. Scripts live in `deployment/`. See [deployment/DEPLOYMENT.md](deployment/DEPLOYMENT.md).

Pushes to `main` update the production function `sync-schedule`. Pushes to `develop` are built by Cloud Build trigger `push-develop-schedule-sync` and update `sync-schedule-develop`, a separate URL for testing. That URL is not on the midnight schedule.
