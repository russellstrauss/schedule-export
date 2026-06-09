import { describe, it, expect, afterEach } from "vitest";
import {
  isFirestoreCredentialsError,
  isFirestoreProjectIdError,
  getFirestoreProjectId,
  firestoreStringValue,
  firestoreTimestampValue
} from "./iatse927-firestore-auth.js";

describe("isFirestoreCredentialsError", () => {
  it("detects default credentials errors", () => {
    expect(
      isFirestoreCredentialsError(new Error("Could not load the default credentials"))
    ).toBe(true);
  });
});

describe("isFirestoreProjectIdError", () => {
  it("detects missing project id errors", () => {
    expect(
      isFirestoreProjectIdError(new Error("Firestore project ID not found. Set GOOGLE_CLOUD_PROJECT"))
    ).toBe(true);
  });
});

describe("getFirestoreProjectId", () => {
  const keys = ["GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT", "GCP_PROJECT"];

  afterEach(() => {
    for (const key of keys) delete process.env[key];
  });

  it("prefers GOOGLE_CLOUD_PROJECT", () => {
    process.env.GOOGLE_CLOUD_PROJECT = "rhino-schedule-sync";
    expect(getFirestoreProjectId()).toBe("rhino-schedule-sync");
  });

  it("falls back to GCP_PROJECT", () => {
    process.env.GCP_PROJECT = "backup-project";
    expect(getFirestoreProjectId()).toBe("backup-project");
  });
});

describe("firestore field parsers", () => {
  it("parses string and timestamp values", () => {
    expect(firestoreStringValue({ stringValue: "hello" })).toBe("hello");
    expect(firestoreTimestampValue({ timestampValue: "2026-05-09T17:14:00Z" })).toEqual(
      new Date("2026-05-09T17:14:00Z")
    );
  });
});
