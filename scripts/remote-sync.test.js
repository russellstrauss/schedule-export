import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveScheduleSyncUrl, triggerProductionSync } from "./remote-sync.js";

describe("triggerProductionSync", () => {
  const originalUrl = process.env.SCHEDULE_SYNC_URL;
  const originalFunctionUrl = process.env.FUNCTION_URL;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalUrl === undefined) delete process.env.SCHEDULE_SYNC_URL;
    else process.env.SCHEDULE_SYNC_URL = originalUrl;
    if (originalFunctionUrl === undefined) delete process.env.FUNCTION_URL;
    else process.env.FUNCTION_URL = originalFunctionUrl;
  });

  it("reads the production URL from SCHEDULE_SYNC_URL", () => {
    process.env.SCHEDULE_SYNC_URL = "https://sync.example.run.app/";
    delete process.env.FUNCTION_URL;
    expect(resolveScheduleSyncUrl()).toBe("https://sync.example.run.app");
  });

  it("POSTs a full production sync when local sync needs a fallback", async () => {
    process.env.SCHEDULE_SYNC_URL = "https://sync.example.run.app";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, message: "Schedule sync completed successfully" })
    }));
    vi.stubGlobal("fetch", fetchMock);

    const data = await triggerProductionSync();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://sync.example.run.app",
      expect.objectContaining({
        method: "POST",
        body: "{}"
      })
    );
    expect(data.success).toBe(true);
  });

  it("fails when production reports an error", async () => {
    process.env.SCHEDULE_SYNC_URL = "https://sync.example.run.app";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        statusText: "Server Error",
        text: async () => JSON.stringify({ success: false, error: "calendar auth failed" })
      }))
    );

    await expect(triggerProductionSync()).rejects.toThrow(/calendar auth failed/);
  });

  it("fails when no production URL is configured", async () => {
    delete process.env.SCHEDULE_SYNC_URL;
    delete process.env.FUNCTION_URL;
    await expect(triggerProductionSync()).rejects.toThrow(/SCHEDULE_SYNC_URL/);
  });
});
