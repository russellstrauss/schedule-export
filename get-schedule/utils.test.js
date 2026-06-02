import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  formatTimeForTitle,
  normalizeStatus,
  isCallCancelledLabel,
  normalizeTextForMatch,
  isEventCancelled,
  toGoogleEvent,
  formatDateTimeForTimezone,
  pad,
  isEventInFuture
} from './utils.js';

describe('formatTimeForTitle', () => {
  it('should format morning times correctly', () => {
    expect(formatTimeForTitle('08:00')).toBe('8am');
    expect(formatTimeForTitle('09:00')).toBe('9am');
    expect(formatTimeForTitle('11:00')).toBe('11am');
  });

  it('should format noon correctly', () => {
    expect(formatTimeForTitle('12:00')).toBe('12pm');
  });

  it('should format afternoon/evening times correctly', () => {
    expect(formatTimeForTitle('13:00')).toBe('1pm');
    expect(formatTimeForTitle('19:00')).toBe('7pm');
    expect(formatTimeForTitle('23:00')).toBe('11pm');
  });

  it('should format midnight correctly', () => {
    expect(formatTimeForTitle('00:00')).toBe('12am');
  });

  it('should include minutes when not :00', () => {
    expect(formatTimeForTitle('08:30')).toBe('8:30am');
    expect(formatTimeForTitle('14:15')).toBe('2:15pm');
    expect(formatTimeForTitle('23:45')).toBe('11:45pm');
  });

  it('should handle single digit hours correctly', () => {
    expect(formatTimeForTitle('01:00')).toBe('1am');
    expect(formatTimeForTitle('09:00')).toBe('9am');
  });
});

describe('normalizeStatus', () => {
  it('should map "called" to "tentative"', () => {
    expect(normalizeStatus('called')).toBe('tentative');
    expect(normalizeStatus('Called')).toBe('tentative');
    expect(normalizeStatus('CALLED')).toBe('tentative');
  });

  it('should map cancelled/canceled to "cancelled"', () => {
    expect(normalizeStatus('cancelled')).toBe('cancelled');
    expect(normalizeStatus('canceled')).toBe('cancelled');
    expect(normalizeStatus('Cancelled')).toBe('cancelled');
  });

  it('should keep "tentative" as "tentative"', () => {
    expect(normalizeStatus('tentative')).toBe('tentative');
  });

  it('should default to "confirmed" for other statuses', () => {
    expect(normalizeStatus('confirmed')).toBe('confirmed');
    expect(normalizeStatus('Confirmed')).toBe('confirmed');
    expect(normalizeStatus('unknown')).toBe('confirmed');
  });

  it('should default to "confirmed" for null/undefined', () => {
    expect(normalizeStatus(null)).toBe('confirmed');
    expect(normalizeStatus(undefined)).toBe('confirmed');
    expect(normalizeStatus('')).toBe('confirmed');
  });
});

describe('isCallCancelledLabel', () => {
  it('should match Rhino\'s exact "Call Cancelled" label', () => {
    expect(isCallCancelledLabel('Call Cancelled')).toBe(true);
    expect(isCallCancelledLabel('  Call Cancelled  ')).toBe(true);
  });

  it('should not match other spellings or unrelated text', () => {
    expect(isCallCancelledLabel('Call Canceled')).toBe(false);
    expect(isCallCancelledLabel('Confirmed')).toBe(false);
    expect(isCallCancelledLabel('')).toBe(false);
    expect(isCallCancelledLabel(null)).toBe(false);
  });
});

describe('isEventCancelled', () => {
  it('should return true for events with isCallCancelled flag', () => {
    const entry = {
      show: 'Some Show',
      isCallCancelled: true
    };
    expect(isEventCancelled(entry)).toBe(true);
  });

  it('should return true for events with "CANCELLED" in show name', () => {
    const entry = {
      show: 'CANCELLED (C) GHSA CHAMPIONSHIP',
      isCallCancelled: false
    };
    expect(isEventCancelled(entry)).toBe(true);
  });

  it('should return true for events with "cancelled" (lowercase) in show name', () => {
    const entry = {
      show: 'cancelled event',
      isCallCancelled: false
    };
    expect(isEventCancelled(entry)).toBe(true);
  });

  it('should return true for events with "canceled" (American spelling) in show name', () => {
    const entry = {
      show: 'CANCELED (C) GHSA CHAMPIONSHIP',
      isCallCancelled: false
    };
    expect(isEventCancelled(entry)).toBe(true);
  });

  it('should return false for valid events', () => {
    const entry = {
      show: 'ERYKAH BADU',
      isCallCancelled: false
    };
    expect(isEventCancelled(entry)).toBe(false);
  });

  it('should handle missing show name', () => {
    const entry = {
      isCallCancelled: false
    };
    expect(isEventCancelled(entry)).toBe(false);
  });

  it('should return true for events with "Called Out" in status', () => {
    const entry = {
      show: 'Some Show',
      status: 'Called Out',
      isCallCancelled: false
    };
    expect(isEventCancelled(entry)).toBe(true);
  });

  it('should return true for events with "Turned Down - UNAVAILABLE" in status', () => {
    const entry = {
      show: 'Some Show',
      status: 'Turned Down - UNAVAILABLE',
      isCallCancelled: false
    };
    expect(isEventCancelled(entry)).toBe(true);
  });

  it('should return true for events with "turned down - unavailable" (lowercase) in status', () => {
    const entry = {
      show: 'Some Show',
      status: 'turned down - unavailable',
      isCallCancelled: false
    };
    expect(isEventCancelled(entry)).toBe(true);
  });

  it('should treat en-dash and odd spacing as Turned Down UNAVAILABLE', () => {
    expect(
      isEventCancelled({
        show: 'X',
        status: 'Turned Down \u2013 UNAVAILABLE',
        isCallCancelled: false
      })
    ).toBe(true);
    expect(
      isEventCancelled({
        show: 'X',
        status: 'Turned  Down  -  UNAVAILABLE',
        isCallCancelled: false
      })
    ).toBe(true);
  });

  it('should match concatenated TurnedDown–UNAVAILABLE (no spaces)', () => {
    expect(
      isEventCancelled({
        show: 'X',
        status: 'TurnedDown\u2013UNAVAILABLE',
        isCallCancelled: false
      })
    ).toBe(true);
  });
});

describe('normalizeTextForMatch', () => {
  it('normalizes NBSP, en dash, and whitespace', () => {
    expect(normalizeTextForMatch('Turned Down \u00a0\u2013 UNAVAILABLE')).toBe(
      'turned down - unavailable'
    );
  });
});

describe('toGoogleEvent', () => {
  it('should transform a basic event correctly', () => {
    const entry = {
      date: '11/23/2025',
      callTime: '08:00',
      show: 'ERYKAH BADU',
      venue: 'COBB ENERGY PERFORMING ARTS CENTRE',
      location: 'ATLANTA GA',
      position: 'SH',
      type: 'IN',
      status: 'Confirmed',
      details: '',
      notes: ''
    };

    const result = toGoogleEvent(entry);

    expect(result.summary).toBe('7:30am ERYKAH BADU'); // 30 min before 8am
    expect(result.location).toBe('COBB ENERGY PERFORMING ARTS CENTRE - ATLANTA GA');
    expect(result.status).toBe('confirmed');
    expect(result.start).toMatch(/^2025-11-23T07:30:00$/); // 30 min before call time
    expect(result.end).toMatch(/^2025-11-23T13:00:00$/); // 5 hours after call time
    expect(result.rowId).toContain('11/23/2025');
    expect(result.rowId).toContain('08:00');
    expect(result.rowId).toContain('ERYKAH BADU');
  });

  it('should not use Rhino UNCONFIRMED title rules for non-rhino sources', () => {
    const entry = {
      date: '12/04/2025',
      callTime: '08:00',
      show: 'SECOND PORTAL GIG',
      venue: 'Arena',
      location: '',
      position: 'SH',
      type: 'IN',
      status: 'Called',
      details: '',
      notes: ''
    };

    const result = toGoogleEvent(entry, { source: 'crewOne' });

    expect(result.summary).toBe('7:30am SECOND PORTAL GIG');
    expect(result.source).toBe('crewOne');
  });

  it('should handle "called" status with UNCONFIRMED prefix', () => {
    const entry = {
      date: '12/04/2025',
      callTime: '08:00',
      show: '2025 T-MOBILE SEC CHAMPIONSHIP',
      venue: 'GEORGIA WORLD CONGRESS CENTER',
      location: '',
      position: 'SH',
      type: 'IN',
      status: 'Called',
      details: '',
      notes: ''
    };

    const result = toGoogleEvent(entry);

    expect(result.summary).toBe('UNCONFIRMED => 2025 T-MOBILE SEC CHAMPIONSHIP');
    expect(result.status).toBe('tentative');
  });

  it('should calculate start time 30 minutes before call time', () => {
    const entry = {
      date: '11/23/2025',
      callTime: '08:00',
      show: 'Test Show',
      venue: 'Test Venue',
      location: '',
      position: 'SH',
      type: 'IN',
      status: 'Confirmed',
      details: '',
      notes: ''
    };

    const result = toGoogleEvent(entry);
    expect(result.start).toMatch(/^2025-11-23T07:30:00$/);
  });

  it('should calculate end time 5 hours after call time', () => {
    const entry = {
      date: '11/23/2025',
      callTime: '08:00',
      show: 'Test Show',
      venue: 'Test Venue',
      location: '',
      position: 'SH',
      type: 'IN',
      status: 'Confirmed',
      details: '',
      notes: ''
    };

    const result = toGoogleEvent(entry);
    expect(result.end).toMatch(/^2025-11-23T13:00:00$/); // 8am + 5 hours = 1pm
  });

  it('should handle date rollover for early morning times', () => {
    const entry = {
      date: '11/23/2025',
      callTime: '00:30', // 12:30am
      show: 'Test Show',
      venue: 'Test Venue',
      location: '',
      position: 'SH',
      type: 'IN',
      status: 'Confirmed',
      details: '',
      notes: ''
    };

    const result = toGoogleEvent(entry);
    // Start should be 30 min before 00:30 = 00:00 (midnight, same day)
    expect(result.start).toMatch(/^2025-11-23T00:00:00$/);
    // End should be 5 hours after 00:30 = 05:30 (same day)
    expect(result.end).toMatch(/^2025-11-23T05:30:00$/);
  });

  it('should combine venue and location correctly', () => {
    const entry = {
      date: '11/23/2025',
      callTime: '08:00',
      show: 'Test Show',
      venue: 'Venue Name',
      location: 'City, State',
      position: 'SH',
      type: 'IN',
      status: 'Confirmed',
      details: '',
      notes: ''
    };

    const result = toGoogleEvent(entry);
    expect(result.location).toBe('Venue Name - City, State');
  });

  it('should handle missing location', () => {
    const entry = {
      date: '11/23/2025',
      callTime: '08:00',
      show: 'Test Show',
      venue: 'Venue Name',
      location: '',
      position: 'SH',
      type: 'IN',
      status: 'Confirmed',
      details: '',
      notes: ''
    };

    const result = toGoogleEvent(entry);
    expect(result.location).toBe('Venue Name');
  });

  it('should combine details and notes in description', () => {
    const entry = {
      date: '11/23/2025',
      callTime: '08:00',
      show: 'Test Show',
      venue: 'Test Venue',
      location: '',
      position: 'SH',
      type: 'IN',
      status: 'Confirmed',
      details: 'Some details',
      notes: 'Some notes'
    };

    const result = toGoogleEvent(entry);
    expect(result.description).toBe('Some details | Some notes');
  });

  it('should include venue link in description when entry.venueLink is set', () => {
    const entry = {
      date: '11/23/2025',
      callTime: '08:00',
      show: 'Test Show',
      venue: 'Test Venue',
      location: '',
      position: 'SH',
      type: 'IN',
      status: 'Confirmed',
      details: 'Some details',
      notes: 'Some notes',
      venueLink: 'https://example.com/venue-doc.pdf'
    };

    const result = toGoogleEvent(entry);
    expect(result.description).toBe('Some details | Some notes\n\nVenue: https://example.com/venue-doc.pdf');
  });

  it('should have description unchanged when venueLink is missing or empty', () => {
    const entryWithDetails = {
      date: '11/23/2025',
      callTime: '08:00',
      show: 'Test Show',
      venue: 'Test Venue',
      location: '',
      position: 'SH',
      type: 'IN',
      status: 'Confirmed',
      details: 'Some details',
      notes: 'Some notes'
    };
    expect(toGoogleEvent(entryWithDetails).description).toBe('Some details | Some notes');

    const entryWithEmptyVenueLink = { ...entryWithDetails, venueLink: '' };
    expect(toGoogleEvent(entryWithEmptyVenueLink).description).toBe('Some details | Some notes');

    const entryWithWhitespaceVenueLink = { ...entryWithDetails, venueLink: '   ' };
    expect(toGoogleEvent(entryWithWhitespaceVenueLink).description).toBe('Some details | Some notes');
  });
});

describe('formatDateTimeForTimezone', () => {
  it('should format date/time correctly', () => {
    expect(formatDateTimeForTimezone(2025, 11, 23, 8, 0)).toBe('2025-11-23T08:00:00');
    expect(formatDateTimeForTimezone(2025, 1, 5, 14, 30)).toBe('2025-01-05T14:30:00');
  });

  it('should pad single digit values', () => {
    expect(formatDateTimeForTimezone(2025, 1, 5, 8, 5)).toBe('2025-01-05T08:05:00');
  });
});

describe('pad', () => {
  it('should pad single digits with leading zero', () => {
    expect(pad(1)).toBe('01');
    expect(pad(5)).toBe('05');
    expect(pad(9)).toBe('09');
  });

  it('should not pad double digits', () => {
    expect(pad(10)).toBe('10');
    expect(pad(23)).toBe('23');
    expect(pad(59)).toBe('59');
  });

  it('should handle zero', () => {
    expect(pad(0)).toBe('00');
  });
});

describe('isEventInFuture', () => {
  // Mock the current date to ensure consistent tests
  const originalDate = Date;
  
  beforeEach(() => {
    // Reset any mocks
    global.Date = originalDate;
  });

  it('should return true for events in the future', () => {
    // Set a fixed "now" date: December 27, 2025 at 8:00 PM Eastern
    const mockNow = new Date('2025-12-27T20:00:00-05:00'); // 8 PM EST on Dec 27
    global.Date = class extends originalDate {
      constructor(...args) {
        if (args.length === 0) {
          super(mockNow);
        } else {
          super(...args);
        }
      }
      static now() {
        return mockNow.getTime();
      }
    };
    
    // Event on Dec 28 at 5 AM should be in the future
    expect(isEventInFuture(2025, 12, 28, 5, 0, 'America/New_York')).toBe(true);
  });

  it('should return false for events in the past', () => {
    // Set a fixed "now" date: December 28, 2025 at 6:00 AM Eastern
    const mockNow = new Date('2025-12-28T06:00:00-05:00'); // 6 AM EST on Dec 28
    global.Date = class extends originalDate {
      constructor(...args) {
        if (args.length === 0) {
          super(mockNow);
        } else {
          super(...args);
        }
      }
      static now() {
        return mockNow.getTime();
      }
    };
    
    // Event on Dec 28 at 5 AM should be in the past (1 hour ago)
    expect(isEventInFuture(2025, 12, 28, 5, 0, 'America/New_York')).toBe(false);
  });

  it('should return false for events happening right now (same minute)', () => {
    // Set a fixed "now" date: December 28, 2025 at 5:00 AM Eastern
    const mockNow = new Date('2025-12-28T05:00:00-05:00'); // 5 AM EST on Dec 28
    global.Date = class extends originalDate {
      constructor(...args) {
        if (args.length === 0) {
          super(mockNow);
        } else {
          super(...args);
        }
      }
      static now() {
        return mockNow.getTime();
      }
    };
    
    // Event at the exact same time should be considered past/current
    expect(isEventInFuture(2025, 12, 28, 5, 0, 'America/New_York')).toBe(false);
  });

  it('should handle events later the same day', () => {
    // Set a fixed "now" date: December 28, 2025 at 3:00 AM Eastern
    const mockNow = new Date('2025-12-28T03:00:00-05:00'); // 3 AM EST on Dec 28
    global.Date = class extends originalDate {
      constructor(...args) {
        if (args.length === 0) {
          super(mockNow);
        } else {
          super(...args);
        }
      }
      static now() {
        return mockNow.getTime();
      }
    };
    
    // Event at 5 AM same day should be in the future
    expect(isEventInFuture(2025, 12, 28, 5, 0, 'America/New_York')).toBe(true);
  });

  it('should handle events on different days correctly', () => {
    // Set a fixed "now" date: December 27, 2025 at 11:00 PM Eastern
    const mockNow = new Date('2025-12-27T23:00:00-05:00'); // 11 PM EST on Dec 27
    global.Date = class extends originalDate {
      constructor(...args) {
        if (args.length === 0) {
          super(mockNow);
        } else {
          super(...args);
        }
      }
      static now() {
        return mockNow.getTime();
      }
    };
    
    // Event on Dec 28 at 5 AM should be in the future (next day)
    expect(isEventInFuture(2025, 12, 28, 5, 0, 'America/New_York')).toBe(true);
    
    // Event on Dec 27 at 10 PM should be in the past (1 hour ago)
    expect(isEventInFuture(2025, 12, 27, 22, 0, 'America/New_York')).toBe(false);
  });

  it('should handle events near midnight correctly', () => {
    // Set a fixed "now" date: December 27, 2025 at 11:30 PM Eastern
    const mockNow = new Date('2025-12-27T23:30:00-05:00'); // 11:30 PM EST on Dec 27
    global.Date = class extends originalDate {
      constructor(...args) {
        if (args.length === 0) {
          super(mockNow);
        } else {
          super(...args);
        }
      }
      static now() {
        return mockNow.getTime();
      }
    };
    
    // Event at 11:45 PM same day should be in the future
    expect(isEventInFuture(2025, 12, 27, 23, 45, 'America/New_York')).toBe(true);
    
    // Event at 12:00 AM next day should be in the future
    expect(isEventInFuture(2025, 12, 28, 0, 0, 'America/New_York')).toBe(true);
    
    // Event at 11:00 PM same day should be in the past
    expect(isEventInFuture(2025, 12, 27, 23, 0, 'America/New_York')).toBe(false);
  });

  it('should handle the specific bug case: 5am shift on 12/28 when run in evening on 12/27', () => {
    // This is the exact bug scenario: function runs in evening on Dec 27
    // Event is at 5am on Dec 28 - should be in the future
    const mockNow = new Date('2025-12-27T20:00:00-05:00'); // 8 PM EST on Dec 27
    global.Date = class extends originalDate {
      constructor(...args) {
        if (args.length === 0) {
          super(mockNow);
        } else {
          super(...args);
        }
      }
      static now() {
        return mockNow.getTime();
      }
    };
    
    // The 5am shift on 12/28 should be correctly identified as future
    expect(isEventInFuture(2025, 12, 28, 5, 0, 'America/New_York')).toBe(true);
  });
});

