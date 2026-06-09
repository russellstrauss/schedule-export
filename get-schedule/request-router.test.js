import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseRequestBody,
  isIngestRequest,
  verifyIngestPhone,
  normalizePhone
} from "./request-router.js";

describe("parseRequestBody", () => {
  it("returns object body as-is", () => {
    const body = { mode: "ingest", source: "iatse927" };
    expect(parseRequestBody({ body })).toEqual(body);
  });

  it("parses JSON string body", () => {
    expect(parseRequestBody({ body: '{"mode":"ingest"}' })).toEqual({ mode: "ingest" });
  });

  it("returns null when body is missing", () => {
    expect(parseRequestBody({})).toBeNull();
  });
});

describe("isIngestRequest", () => {
  it("detects JSON ingest mode", () => {
    const req = { path: "/" };
    expect(
      isIngestRequest(req, { mode: "ingest", source: "iatse927", text: "hi" })
    ).toBe(true);
  });

  it("rejects POST without ingest marker", () => {
    expect(isIngestRequest({ path: "/" }, {})).toBe(false);
    expect(isIngestRequest({ path: "/" }, null)).toBe(false);
  });

  it("detects /ingest/iatse927 path", () => {
    expect(
      isIngestRequest(
        { path: "/ingest/iatse927", url: "/ingest/iatse927" },
        null
      )
    ).toBe(true);
  });
});

describe("normalizePhone", () => {
  it("strips non-digits and normalizes US leading 1", () => {
    expect(normalizePhone("+1 (555) 123-4567")).toBe("5551234567");
    expect(normalizePhone("5551234567")).toBe("5551234567");
  });
});

describe("verifyIngestPhone", () => {
  const original = process.env.IATSE_ALLOWED_PHONE;

  beforeEach(() => {
    process.env.IATSE_ALLOWED_PHONE = "+15551234567";
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.IATSE_ALLOWED_PHONE;
    } else {
      process.env.IATSE_ALLOWED_PHONE = original;
    }
  });

  it("accepts matching phone in body", () => {
    expect(
      verifyIngestPhone({
        mode: "ingest",
        source: "iatse927",
        phone: "5551234567",
        text: "hi"
      })
    ).toBe(true);
  });

  it("accepts phoneNumber field", () => {
    expect(
      verifyIngestPhone({ phoneNumber: "+1 555-123-4567", text: "hi" })
    ).toBe(true);
  });

  it("rejects missing or wrong phone", () => {
    expect(verifyIngestPhone({ text: "hi" })).toBe(false);
    expect(verifyIngestPhone({ phone: "5559999999", text: "hi" })).toBe(false);
  });

  it("throws when allowed phone not configured", () => {
    delete process.env.IATSE_ALLOWED_PHONE;
    expect(() => verifyIngestPhone({ phone: "5551234567" })).toThrow(
      /IATSE_ALLOWED_PHONE/
    );
  });
});
