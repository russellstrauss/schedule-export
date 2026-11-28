import { describe, it, expect } from "vitest";
import {
  parseRequestBody,
  isIngestRequest,
  isIatseOnlySyncRequest,
  isSyncRequest,
  extractIngestText
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
    expect(isIngestRequest({ path: "/", query: {} }, {})).toBe(false);
    expect(isIngestRequest({ path: "/", query: {} }, null)).toBe(false);
  });

  it("stores a phone POST that sends only the SMS text", () => {
    const sms = "Copy confirmed thank you. 10pm Dec 6 at City Springs";
    const form = { path: "/", query: {}, body: { text: sms } };
    expect(extractIngestText(form, form.body)).toBe(sms);
    expect(isIngestRequest(form, form.body)).toBe(true);

    const raw = { path: "/", query: {}, body: sms };
    expect(extractIngestText(raw, null)).toBe(sms);
    expect(isIngestRequest(raw, null)).toBe(true);

    const encoded = {
      path: "/",
      query: {},
      rawBody: Buffer.from(`message=${encodeURIComponent(sms)}`)
    };
    expect(extractIngestText(encoded, {})).toBe(sms);
  });

  it("does not treat a sync POST without an SMS as a message", () => {
    expect(extractIngestText({ path: "/", query: { mode: "iatse" } }, { mode: "iatse" })).toBe("");
    expect(isIngestRequest({ path: "/", query: {} }, {})).toBe(false);
    expect(isIngestRequest({ path: "/", query: { mode: "iatse" } }, null)).toBe(false);
    expect(extractIngestText({ path: "/", query: { mode: "health" } }, { mode: "health", text: "Copy confirmed" })).toBe("");
  });

  it("stores the SMS when the phone posts it with an IATSE sync", () => {
    const sms = "Copy confirmed thank you. 10pm Dec 6 at City Springs";
    const query = { path: "/", query: { mode: "iatse" }, body: { text: sms } };
    expect(extractIngestText(query, query.body)).toBe(sms);
    expect(isIngestRequest(query, query.body)).toBe(true);

    const custom = { path: "/", query: {}, body: { mode: "sync", SMSBody: sms } };
    expect(extractIngestText(custom, custom.body)).toBe(sms);
    expect(isIngestRequest(custom, custom.body)).toBe(true);

    const form = {
      path: "/",
      query: { mode: "iatse" },
      rawBody: Buffer.from(`mode=iatse&message=${encodeURIComponent(sms)}`)
    };
    expect(extractIngestText(form, { mode: "iatse" })).toBe(sms);
    expect(isIngestRequest(form, { mode: "iatse" })).toBe(true);
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

describe("isIatseOnlySyncRequest", () => {
  it("detects ?mode=iatse", () => {
    expect(isIatseOnlySyncRequest({ query: { mode: "iatse" } }, null)).toBe(true);
    expect(isIatseOnlySyncRequest({ query: {} }, { mode: "iatse927" })).toBe(true);
  });

  it("rejects unrelated modes", () => {
    expect(isIatseOnlySyncRequest({ query: { mode: "health" } }, null)).toBe(false);
  });
});

describe("isSyncRequest", () => {
  it("runs a sync for an ordinary browser GET", () => {
    expect(isSyncRequest({ method: "GET", query: {}, headers: {} }, null)).toBe(true);
  });

  it("does not sync in explicit health mode", () => {
    expect(isSyncRequest({ method: "GET", query: { mode: "health" } }, null)).toBe(false);
    expect(isSyncRequest({ method: "GET", query: { mode: "status" } }, null)).toBe(false);
  });

  it("does not run full sync for IATSE-only mode", () => {
    expect(isSyncRequest({ query: { mode: "iatse" } }, null)).toBe(false);
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
