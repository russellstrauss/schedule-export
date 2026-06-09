import { execSync } from "child_process";

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isFirestoreCredentialsError(err) {
  const message = String(err?.message || err || "");
  return (
    message.includes("Could not load the default credentials") ||
    message.includes("default credentials") ||
    message.includes("Unable to detect a Project Id")
  );
}

/**
 * @returns {string}
 */
export function getFirestoreProjectId() {
  const fromEnv = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (fromEnv?.trim()) return fromEnv.trim();

  try {
    const project = execSync("gcloud config get-value project", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    if (project && project !== "(unset)") return project;
  } catch {
    // gcloud not available
  }

  throw new Error(
    "Firestore project ID not found. Set GOOGLE_CLOUD_PROJECT in .env or run: gcloud config set project YOUR_PROJECT_ID"
  );
}

/**
 * @returns {string}
 */
export function getGcloudAccessToken() {
  try {
    return execSync("gcloud auth print-access-token", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
  } catch {
    throw new Error(
      "Firestore auth failed. Run: gcloud auth login && gcloud auth application-default login"
    );
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function firestoreStringValue(value) {
  if (!value || typeof value !== "object") return "";
  const row = /** @type {Record<string, unknown>} */ (value);
  if (typeof row.stringValue === "string") return row.stringValue;
  return "";
}

/**
 * @param {unknown} value
 * @returns {Date | null}
 */
export function firestoreTimestampValue(value) {
  if (!value || typeof value !== "object") return null;
  const row = /** @type {Record<string, unknown>} */ (value);
  if (typeof row.timestampValue === "string") {
    const d = new Date(row.timestampValue);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
