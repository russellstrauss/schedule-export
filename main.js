import getSchedule from "./get-schedule/get-schedule.js";

export async function syncSchedule(event, context) {
  try {
    await getSchedule();
    console.log("✅ Schedule sync completed.");
  } catch (err) {
    console.error("❌ Sync failed:", err);
    throw err;
  }
}
