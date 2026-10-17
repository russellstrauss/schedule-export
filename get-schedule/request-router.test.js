import { describe, it, expect } from "vitest";
import {
  parseRequestBody,
  isIngestRequest,
  isSyncRequest
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

describe("isSyncRequest", () => {
  it("does not run a sync for an ordinary browser GET", () => {
    expect(isSyncRequest({ method: "GET", query: {}, headers: {} }, null)).toBe(false);
  });

  it("accepts an explicit sync mode", () => {
    expect(isSyncRequest({ method: "GET", query: { mode: "sync" } }, null)).toBe(true);
  });

  it("recognizes Cloud Scheduler requests", () => {
    expect(
      isSyncRequest(
        { method: "GET", query: {}, headers: { "user-agent": "Google-Cloud-Scheduler" } },
        null
      )
    ).toBe(true);
  });

  it("preserves POST as a sync trigger", () => {
    expect(isSyncRequest({ method: "POST", query: {} }, {})).toBe(true);
  });
});
