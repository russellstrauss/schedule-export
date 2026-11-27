import getSchedule from "./get-schedule/get-schedule.js";
import { resolveRemoteFallbackMode, triggerProductionSync } from "./scripts/remote-sync.js";

let result = null;
let localError = null;

try {
  result = await getSchedule();
} catch (err) {
  localError = err;
  console.error("❌ Local sync failed:", err instanceof Error ? err.message : err);
}

const iatseFailed = Boolean(result?.iatseFailed || localError?.iatseFailed);
const fallbackMode = resolveRemoteFallbackMode({ iatseFailed, localError });
if (!localError && !iatseFailed) {
  console.log("✅ Schedule sync completed locally.");
} else {
  const iatseOnly = fallbackMode === "iatse";
  if (iatseOnly) {
    console.warn("⚠️  Local IATSE sync did not complete.");
  }
  console.warn(
    iatseOnly ? "⚠️  Triggering remote IATSE sync..." : "⚠️  Triggering remote production sync..."
  );
  try {
    const data = await triggerProductionSync(iatseOnly ? { mode: fallbackMode } : {});
    console.log(iatseOnly ? "✅ Remote IATSE sync completed." : "✅ Remote production sync completed.");
    if (data?.message) console.log(data.message);
  } catch (err) {
    console.error(
      iatseOnly ? "❌ Remote IATSE sync failed:" : "❌ Remote production sync failed:",
      err instanceof Error ? err.message : err
    );
    process.exit(1);
  }
}
