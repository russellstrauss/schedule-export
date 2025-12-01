import getSchedule from "./get-schedule/get-schedule.js";

/**
 * Cloud Function entry point for schedule synchronization
 * Can be triggered by HTTP request or Cloud Scheduler
 */
export async function syncSchedule(req, res) {
  // Set CORS headers for browser requests (optional)
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
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
