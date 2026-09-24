/**
 * True when running in GCP Cloud Functions / Cloud Run, not local dev with GOOGLE_CLOUD_PROJECT set.
 * @returns {boolean}
 */
export function isCloudRuntime() {
  // Exclude Termux (Android) from cloud runtime detection
  if (process.env.HOME && process.env.HOME.includes("com.termux")) {
    return false;
  }
  
  return !!(
    process.env.FUNCTION_TARGET ||
    process.env.K_SERVICE ||
    process.env.FUNCTION_NAME ||
    process.env.K_REVISION ||
    (process.env.HOME && process.env.HOME.includes("www-data-home")) ||
    (process.env.PWD && process.env.PWD.includes("www-data-home"))
  );
}
