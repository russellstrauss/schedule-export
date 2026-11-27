import dotenv from "dotenv";

dotenv.config({ quiet: true });

/**
 * Production sync URL. SCHEDULE_SYNC_URL is the explicit setting; FUNCTION_URL is accepted
 * because that is the name Cloud Functions injects for the deployed endpoint.
 * @returns {string}
 */
export function resolveScheduleSyncUrl() {
  return (process.env.SCHEDULE_SYNC_URL || process.env.FUNCTION_URL || "").trim().replace(/\/$/, "");
}

/**
 * Ask the deployed production function to run the same sync the device just failed to finish.
 * No mode runs the full sync (portals and IATSE). `mode: "iatse"` is the manual IATSE-only command.
 * @param {{ mode?: string }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function triggerProductionSync(options = {}) {
  const baseUrl = resolveScheduleSyncUrl();
  if (!baseUrl) {
    throw new Error(
      "Set SCHEDULE_SYNC_URL (or FUNCTION_URL) in .env to your production sync-schedule HTTPS URL."
    );
  }

  const mode = String(options.mode || "").trim().toLowerCase();
  const url = mode ? `${baseUrl}?mode=${encodeURIComponent(mode)}` : baseUrl;
  const timeoutMs = Number(process.env.SCHEDULE_SYNC_TIMEOUT_MS || 600_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  console.log(`🌐 Requesting remote production sync: ${url}`);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mode ? { mode } : {}),
      signal: controller.signal
    });

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (!response.ok || data?.success === false) {
      const detail = data?.error || data?.message || data?.raw || response.statusText;
      throw new Error(`Remote production sync returned HTTP ${response.status}: ${detail}`);
    }

    return data;
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`Remote production sync timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
