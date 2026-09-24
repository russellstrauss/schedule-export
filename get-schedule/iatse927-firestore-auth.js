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
  const code = err?.code;
  const reason = err?.reason || err?.statusDetails?.[0]?.reason;
  
  return (
    code === 7 ||
    code === "PERMISSION_DENIED" ||
    reason === "CONSUMER_INVALID" ||
    message.includes("CONSUMER_INVALID") ||
    message.includes("PERMISSION_DENIED") ||
    message.includes("Permission denied on resource project") ||
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
 * Prefer REST API in all environments to avoid SDK authentication issues.
 * REST API uses metadata server tokens in Cloud Functions and gcloud CLI locally.
 * @returns {boolean}
 */
export function shouldPreferFirestoreRest() {
  return true;
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
 * Get access token from service account key file if GOOGLE_APPLICATION_CREDENTIALS is set.
 * @returns {Promise<string | null>}
 */
async function getServiceAccountToken() {
  const rawPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim().replace(/^['"]|['"]$/g, "");
  if (!rawPath) return null;

  const fs = await import("fs");
  const os = await import("os");
  const crypto = await import("crypto");
  const keyPath = rawPath.replace(/^~(?=$|\/)/, os.homedir());

  // Once a key file is configured, report its failure instead of silently falling
  // through to gcloud (which is usually absent where a key file is used, e.g. Termux).
  const fail = (reason) => new Error(`Firestore auth failed via GOOGLE_APPLICATION_CREDENTIALS (${keyPath}): ${reason}`);

  if (!fs.existsSync(keyPath)) {
    throw fail("file not found");
  }

  let keyData;
  try {
    keyData = JSON.parse(fs.readFileSync(keyPath, "utf8"));
  } catch (err) {
    throw fail(`could not parse JSON (${err.message})`);
  }

  if (keyData.type !== "service_account" || !keyData.private_key || !keyData.client_email) {
    throw fail("not a service account key (expected type, client_email and private_key fields)");
  }

  const base64url = (value) => Buffer.from(value).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: keyData.client_email,
      scope: "https://www.googleapis.com/auth/datastore",
      aud: keyData.token_uri || "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now
    })
  );
  const unsigned = `${header}.${claim}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(keyData.private_key, "base64url");

  let res;
  try {
    res = await fetch(keyData.token_uri || "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${signature}`
      })
    });
  } catch (err) {
    throw fail(`token request failed (${err.message})`);
  }

  if (!res.ok) {
    throw fail(`token exchange returned ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw fail("token exchange response had no access_token");
  }
  return data.access_token;
}

/**
 * @returns {Promise<string>}
 */
export async function getGcloudAccessToken() {
  // 1. Try metadata server (Cloud Functions/Cloud Run)
  if (isCloudRuntime()) {
    try {
      const res = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
        headers: { "Metadata-Flavor": "Google" }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.access_token) {
          console.log("✅ Retrieved access token from metadata server");
          return data.access_token;
        }
      } else {
        const errorText = await res.text();
        console.warn(`Metadata server token request failed (${res.status}):`, errorText);
      }
    } catch (err) {
      console.warn("Failed to get access token from metadata server:", err);
    }
  }

  // 2. Try service account key file (Android/Termux, local dev)
  const serviceAccountToken = await getServiceAccountToken();
  if (serviceAccountToken) {
    return serviceAccountToken;
  }

  // 3. Try gcloud CLI (local dev with gcloud installed)
  try {
    return execSync("gcloud auth print-access-token", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
  } catch {
    throw new Error(
      "Firestore auth failed. Options:\n" +
      "1. Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json\n" +
      "2. Run: gcloud auth login && gcloud auth application-default login"
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
