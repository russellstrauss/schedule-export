import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {

  SAMPLE_REMINDER_SMS,

  SAMPLE_CONFIRMATION_SMS

} from "./sources/iatse927-fixtures.js";



const geminiEntries = [

  {

    date: "6/3/2026",

    callTime: "22:00",

    show: "Charlie Puth",

    venue: "Chastain Amphitheater",

    location: "4469 Stella Dr Atlanta Georgia 30342",

    type: "Load Out",

    status: "confirmed",

    confidence: "high",

    evidenceIndices: [0, 1]

  },

  {

    date: "6/3/2026",

    callTime: "10:30",

    show: "Charlie Puth",

    venue: "Chastain Amphitheater",

    location: "4469 Stella Dr Atlanta Georgia 30342",

    type: "Load In",

    status: "confirmed",

    confidence: "high",

    evidenceIndices: [0, 1]

  }

];



const geminiResponse = JSON.stringify({

  entries: geminiEntries,

  warnings: []

});



vi.mock("@google/generative-ai", () => ({

  GoogleGenerativeAI: class MockGoogleGenerativeAI {

    constructor() {}

    getGenerativeModel() {

      return {

        generateContent: async () => ({

          response: { text: () => geminiResponse }

        })

      };

    }

  }

}));



import {

  extractScheduleEntriesWithGemini,

  resolveScheduleEntries,

  resolveScheduleEntriesWithValidation,

  isGeminiUnavailableError

} from "./iatse927-gemini.js";



describe("extractScheduleEntriesWithGemini", () => {

  const originalKey = process.env.GEMINI_API_KEY;



  beforeEach(() => {

    process.env.GEMINI_API_KEY = "test-key";

  });



  afterEach(() => {

    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;

    else process.env.GEMINI_API_KEY = originalKey;

  });



  it("throws without API key", async () => {

    delete process.env.GEMINI_API_KEY;

    await expect(

      extractScheduleEntriesWithGemini([{ text: "hi" }])

    ).rejects.toThrow(/GEMINI_API_KEY/);

  });



  it("parses entries from single Gemini response and sorts by date/time", async () => {

    const entries = await extractScheduleEntriesWithGemini([

      { text: SAMPLE_CONFIRMATION_SMS },

      { text: SAMPLE_REMINDER_SMS }

    ]);

    expect(entries).toHaveLength(2);

    expect(entries[0].callTime).toBe("10:30");

    expect(entries[0].type).toBe("Load In");

    expect(entries[1].callTime).toBe("22:00");

    expect(entries[1].type).toBe("Load Out");

    expect(entries[0].show).toBe("Charlie Puth");

    expect(entries[0].source).toBe("iatse927");

    expect(entries[0].evidenceIndices).toEqual([0, 1]);

  });

});



describe("resolveScheduleEntriesWithValidation", () => {

  const originalKey = process.env.GEMINI_API_KEY;



  beforeEach(() => {

    process.env.GEMINI_API_KEY = "test-key";

  });



  afterEach(() => {

    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;

    else process.env.GEMINI_API_KEY = originalKey;

  });



  it("returns entries and warnings from one Gemini call", async () => {

    const messages = [

      { text: SAMPLE_CONFIRMATION_SMS },

      { text: SAMPLE_REMINDER_SMS }

    ];

    const { entries, warnings } = await resolveScheduleEntriesWithValidation(messages);

    expect(entries).toHaveLength(2);

    expect(entries[0].callTime).toBe("10:30");

    expect(Array.isArray(warnings)).toBe(true);

  });



  it("resolveScheduleEntries returns entries only", async () => {

    const entries = await resolveScheduleEntries([

      { text: SAMPLE_CONFIRMATION_SMS },

      { text: SAMPLE_REMINDER_SMS }

    ]);

    expect(entries).toHaveLength(2);

  });

});



describe("isGeminiUnavailableError", () => {

  it("detects rate limit and quota errors", () => {

    expect(isGeminiUnavailableError(Object.assign(new Error("Too Many Requests"), { status: 429 }))).toBe(

      true

    );

    expect(isGeminiUnavailableError(new Error("quota depleted for billing"))).toBe(true);

    expect(isGeminiUnavailableError(new Error("network timeout"))).toBe(false);

  });

});


