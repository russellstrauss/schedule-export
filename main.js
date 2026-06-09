import getSchedule from "./get-schedule/get-schedule.js";
import {
  parseRequestBody,
  isIngestRequest,
  verifyIngestPhone
} from "./get-schedule/request-router.js";

/**
 * Cloud Function entry point for schedule synchronization
 * Can be triggered by HTTP request or Cloud Scheduler
 */
export async function syncSchedule(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  const body = parseRequestBody(req);

  if (isIngestRequest(req, body)) {
    try {
      if (!verifyIngestPhone(body)) {
        res.status(401).json({
          success: false,
          error: "Unauthorized: phone not allowed",
          timestamp: new Date().toISOString()
        });
        return;
      }

      const { storeIatse927Message, syncIatse927AfterIngest } = await import(
        "./get-schedule/ingest-iatse927.js"
      );
      const payload = body && typeof body === "object" ? body : {};
      console.log("📱 Starting IATSE 927 ingest (store)...");
      const result = await storeIatse927Message(payload);

      res.status(200).json({
        success: true,
        message: "IATSE 927 message stored; calendar sync running in background",
        stored: result.stored,
        id: result.id,
        syncing: true,
        timestamp: new Date().toISOString()
      });

      try {
        const syncResult = await syncIatse927AfterIngest();
        if (!syncResult) {
          console.warn("⚠️  IATSE 927 background sync skipped (check GEMINI_API_KEY / Firestore)");
        } else {
          console.log(
            `✅ IATSE 927 background sync complete: parsed=${syncResult.parsed}, synced=${syncResult.synced}`
          );
        }
      } catch (err) {
        console.error("❌ IATSE 927 background sync failed:", err);
      }
    } catch (err) {
      console.error("❌ IATSE ingest failed:", err);
      res.status(err.message?.includes("requires") ? 400 : 500).json({
        success: false,
        error: err.message,
        timestamp: new Date().toISOString()
      });
    }
    return;
  }

  try {
    console.log("🔄 Starting schedule sync...");
    await getSchedule();
    console.log("✅ Schedule sync completed.");

    res.status(200).json({
      success: true,
      message: "Schedule sync completed successfully",
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("❌ Sync failed:", err);
    res.status(500).json({
      success: false,
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
}
