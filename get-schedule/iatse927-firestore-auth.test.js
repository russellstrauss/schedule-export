import { describe, it, expect } from "vitest";
import {
  isFirestoreCredentialsError,
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

describe("firestore field parsers", () => {
  it("parses string and timestamp values", () => {
    expect(firestoreStringValue({ stringValue: "hello" })).toBe("hello");
    expect(firestoreTimestampValue({ timestampValue: "2026-05-09T17:14:00Z" })).toEqual(
      new Date("2026-05-09T17:14:00Z")
    );
  });
});
