import getSchedule from './get-schedule/get-schedule.js';

try {
  await getSchedule();
  console.log("✅ Schedule sync completed locally.");
} catch (err) {
  console.error("❌ Local sync failed:", err);
}