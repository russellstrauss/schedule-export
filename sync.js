import getSchedule from "./get-schedule/get-schedule.js";
import { triggerProductionSync } from "./scripts/remote-sync.js";

let result = null;
let localError = null;

try {
  result = await getSchedule();
} catch (err) {
  localError = err;
  console.error("❌ Local sync failed:", err instanceof Error ? err.message : err);
}

const iatseFailed = Boolean(result?.iatseFailed || localError?.iatseFailed);
if (!localError && !iatseFailed) {
  console.log("✅ Schedule sync completed locally.");
} else {
  if (iatseFailed && !localError) {
    console.warn("⚠️  Local IATSE sync did not complete.");
  }
  console.warn("⚠️  Triggering remote production sync...");
  try {
    const data = await triggerProductionSync();
    console.log("✅ Remote production sync completed.");
    if (data?.message) console.log(data.message);
  } catch (err) {
    console.error("❌ Remote production sync failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
