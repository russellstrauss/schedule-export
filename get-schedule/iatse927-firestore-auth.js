import { execSync, execFileSync } from "child_process";
import { isCloudRuntime } from "./runtime-env.js";

/**
 * @param {unknown} err
 * @returns {string}
 */
function firestoreErrorText(err) {
  if (!err) return "";
  /** @type {unknown[]} */
  const queue = [err];
  /** @type {string[]} */
  const parts = [];
  const seen = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (current == null || seen.has(current)) continue;
    if (typeof current === "object") seen.add(current);

    if (typeof current === "string") {
      parts.push(current);
      continue;
    }

    if (current instanceof Error) {
      if (current.message) parts.push(current.message);
      if (current.cause) queue.push(current.cause);
      continue;
    }

    if (typeof current === "object") {
      const row = /** @type {Record<string, unknown>} */ (current);
      for (const key of ["message", "details", "reason", "statusDetails"]) {
        if (typeof row[key] === "string") parts.push(row[key]);
      }
      if (row.cause) queue.push(row.cause);
      if (row.error) queue.push(row.error);
    }
  }

  return parts.join(" ");
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isFirestoreCredentialsError(err) {
  const message = firestoreErrorText(err);
  return (
    message.includes("Could not load the default credentials") ||
    message.includes("NO_ADC_FOUND") ||
    message.includes("default credentials") ||
    message.includes("Unable to detect a Project Id") ||
    message.includes("Firestore auth failed") ||
    message.includes("application-default login")
  );
}
/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isFirestoreProjectIdError(err) {
  const message = String(err?.message || err || "");
  return message.includes("Firestore project ID not found");
}

/**
 * Local dev uses gcloud user credentials (REST). Cloud Functions use the Firestore SDK (ADC).
 * @returns {boolean}
 */
export function shouldPreferFirestoreRest() {
  return !isCloudRuntime();
}

/** Cached after first successful resolution in cloud. */
let cachedCloudProjectId = null;

/**
 * @returns {string}
 */
export function getFirestoreProjectId() {
  const fromEnv =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT;
  if (fromEnv?.trim()) return fromEnv.trim();

  if (cachedCloudProjectId) return cachedCloudProjectId;

  if (isCloudRuntime()) {
    try {
      const script =
        "require('http').get({hostname:'metadata.google.internal',path:'/computeMetadata/v1/project/project-id',headers:{'Metadata-Flavor':'Google'}},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>process.stdout.write(b));}).on('error',()=>process.exit(1));";
      const project = execFileSync(process.execPath, ["-e", script], {
        encoding: "utf8",
        timeout: 3000,
        stdio: ["pipe", "pipe", "pipe"]
      }).trim();
      if (project) {
        cachedCloudProjectId = project;
        return project;
      }
    } catch {
      // fall through
    }
  }

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
