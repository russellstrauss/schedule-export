import { describe, it, expect, afterEach } from "vitest";
import { isCloudRuntime } from "./runtime-env.js";

describe("isCloudRuntime", () => {
  const keys = ["FUNCTION_TARGET", "K_SERVICE", "FUNCTION_NAME", "K_REVISION"];
  const originalPwd = process.env.PWD;
  const originalHome = process.env.HOME;

  afterEach(() => {
    for (const key of keys) delete process.env[key];
    delete process.env.GOOGLE_CLOUD_PROJECT;
    if (originalPwd === undefined) delete process.env.PWD;
    else process.env.PWD = originalPwd;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  });

  it("is false locally even when GOOGLE_CLOUD_PROJECT is set", () => {
    process.env.PWD = "/home/user/schedule-export";
    process.env.HOME = "/home/user";
    process.env.GOOGLE_CLOUD_PROJECT = "rhino-schedule-sync";
    expect(isCloudRuntime()).toBe(false);
  });

  it("is true when Cloud Functions env is set", () => {
    process.env.K_SERVICE = "sync-schedule";
    expect(isCloudRuntime()).toBe(true);
  });
});
