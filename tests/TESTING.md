# Testing Guide

This project uses [Vitest](https://vitest.dev/) for unit testing. Tests sit next to the code they cover (`*.test.js`).

## Running Tests

```bash
# Watch mode (re-runs on file changes)
npm test

# Run once and exit
npm run test:run

# Live smoke test against the deployed Cloud Function (optional email on failure)
npm run test:integration
```

`npm test` / `npm run test:run` exclude `tests/integration.test.js` so a local unit run does not trigger a production scrape.

## What's covered

Unit tests cover:

- Date/time formatting, row ids, cancellation, and Google event mapping (`get-schedule/utils.test.js`)
- Calendar sync/purge (`get-schedule/google-calendar/add-event.test.js`)
- Rhino table detection and Crew One parsing/reminders
- IATSE ingest, Gemini extraction, validation, thread parsing, and enrichment
- HTTP routing (`request-router.test.js`) and runtime detection

Integration tests (`tests/integration.test.js`) POST once to the deployed function and check CORS preflight. They are not part of the default unit suite.

## Adding New Tests

1. Create `filename.test.js` next to the module.
2. Import the functions you want to test.
3. Use Vitest `describe` / `it` / `expect`.
4. Run `npm test`.

```javascript
import { describe, it, expect } from "vitest";
import { myFunction } from "./my-module.js";

describe("myFunction", () => {
  it("should do something", () => {
    expect(myFunction(input)).toBe(expectedOutput);
  });
});
```
