import { describe, it, expect } from "vitest";

const FUNCTION_URL = process.env.FUNCTION_URL || "https://sync-schedule-v2ndhgjy3q-uc.a.run.app";
const TEST_TIMEOUT = 600000; // 10 minutes

describe("Deployed Cloud Function Integration Tests", () => {
  it("should complete a successful sync with a valid JSON body", async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TEST_TIMEOUT);

    try {
      const startTime = Date.now();
      const response = await fetch(FUNCTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal
      });
      const duration = (Date.now() - startTime) / 1000;
      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        console.error("Response status:", response.status);
        console.error("Response text:", text);
      }

      expect(response.ok).toBe(true);
      expect(duration).toBeLessThan(300);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message).toContain("Schedule sync completed");
      expect(data).toHaveProperty("timestamp");
      expect(typeof data.timestamp).toBe("string");
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }, TEST_TIMEOUT);

  it("should handle OPTIONS (CORS preflight) requests", async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(FUNCTION_URL, {
        method: "OPTIONS",
        headers: {
          Origin: "https://example.com",
          "Access-Control-Request-Method": "POST"
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }, 30000);
});
