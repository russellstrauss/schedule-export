# Testing Guide

This project uses [Vitest](https://vitest.dev/) for unit testing.

## Running Tests

```bash
# Run tests in watch mode (re-runs on file changes)
npm test

# Run tests once and exit
npm run test:run
```

## Test Structure

Tests are located alongside the code they test:
- `get-schedule/utils.test.js` - Tests for utility functions

## What's Tested

### Time Formatting (`formatTimeForTitle`)
- ✅ Morning times (8am, 9am, etc.)
- ✅ Afternoon/evening times (1pm, 7pm, etc.)
- ✅ Noon (12pm) and midnight (12am)
- ✅ Times with minutes (8:30am, 2:15pm, etc.)

### Status Normalization (`normalizeStatus`)
- ✅ "called" → "tentative"
- ✅ "cancelled"/"canceled" → "cancelled"
- ✅ "tentative" → "tentative"
- ✅ Other statuses → "confirmed"
- ✅ Null/undefined → "confirmed"

### Event Cancellation Detection (`isEventCancelled`)
- ✅ Events with `isCallCancelled` flag
- ✅ Events with "CANCELLED" in show name (case-insensitive)
- ✅ Valid events (not cancelled)

### Event Transformation (`toGoogleEvent`)
- ✅ Basic event transformation
- ✅ Start time calculation (30 minutes before call time)
- ✅ End time calculation (5 hours after call time)
- ✅ "Called" status handling (UNCONFIRMED prefix, no time in title)
- ✅ Date rollover for early morning times
- ✅ Location and description formatting

### Date/Time Utilities
- ✅ Date formatting for Google Calendar API
- ✅ Number padding utilities

## Adding New Tests

1. Create a test file next to the code: `filename.test.js`
2. Import the functions you want to test
3. Use Vitest's `describe` and `it` blocks
4. Run `npm test` to verify

Example:
```javascript
import { describe, it, expect } from 'vitest';
import { myFunction } from './my-module.js';

describe('myFunction', () => {
  it('should do something', () => {
    expect(myFunction(input)).toBe(expectedOutput);
  });
});
```

## Continuous Integration

These tests can be run in CI/CD pipelines:
```bash
npm run test:run
```

