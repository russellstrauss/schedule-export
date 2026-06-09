import { describe, it, expect, afterEach } from "vitest";
import { isCloudRuntime } from "./runtime-env.js";

describe("isCloudRuntime", () => {
  const keys = ["FUNCTION_TARGET", "K_SERVICE", "FUNCTION_NAME", "K_REVISION"];

  afterEach(() => {
    for (const key of keys) delete process.env[key];
    delete process.env.GOOGLE_CLOUD_PROJECT;
  });

  it("is false locally even when GOOGLE_CLOUD_PROJECT is set", () => {
    process.env.GOOGLE_CLOUD_PROJECT = "rhino-schedule-sync";
    expect(isCloudRuntime()).toBe(false);
  });

  it("is true when Cloud Functions env is set", () => {
    process.env.K_SERVICE = "sync-schedule";
    expect(isCloudRuntime()).toBe(true);
  });
});
