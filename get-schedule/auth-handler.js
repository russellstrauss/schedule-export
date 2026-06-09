import { authorize } from "./google-calendar/auth.js";
import { isCloudRuntime } from "./runtime-env.js";

function isExpiredTokenError(error) {
  const errorCode = error?.code;
  const errorMessage = error?.message || "";
  const responseError = error?.response?.data?.error;
  const responseErrorDescription = error?.response?.data?.error_description || "";
  const responseStatus = error?.response?.status;

  if (responseError === "invalid_grant" || errorMessage.includes("invalid_grant")) {
    return true;
  }

  if (responseStatus === 400) {
    const description = responseErrorDescription.toLowerCase();
    if (
      description.includes("expired") ||
      description.includes("invalid") ||
      description.includes("revoked") ||
      description.includes("token")
    ) {
      return true;
    }
  }

  if (errorCode === 401 || errorCode === 403) {
    if (
      errorMessage.includes("token") &&
      (errorMessage.includes("expired") ||
        errorMessage.includes("invalid") ||
        errorMessage.includes("revoked"))
    ) {
      return true;
    }
  }

  if (
    errorMessage.includes("Refresh token") &&
    (errorMessage.includes("expired") ||
      errorMessage.includes("revoked") ||
      errorMessage.includes("invalid"))
  ) {
    return true;
  }

  return false;
}

/**
 * Run a Google Calendar API call with refresh-token recovery in local dev.
 * @param {import("google-auth-library").OAuth2Client} auth
 * @param {(auth: import("google-auth-library").OAuth2Client) => Promise<*>} fn
 */
export async function withAuthRetry(auth, fn) {
  try {
    return await fn(auth);
  } catch (error) {
    if (!isExpiredTokenError(error)) {
      throw error;
    }

    if (isCloudRuntime()) {
      throw new Error(
        "Google OAuth refresh token has expired or been revoked. " +
          "The refresh token stored in GOOGLE_TOKEN environment variable is no longer valid. " +
          "To fix this:\n" +
          "1. Run 'node sync.js' locally to re-authenticate\n" +
          "2. Copy the new token from get-schedule/google-calendar/token.json\n" +
          "3. Update the GOOGLE_TOKEN environment variable in Cloud Functions using:\n" +
          "   .\\deployment\\update-env-vars.ps1\n" +
          "   Or manually: gcloud functions deploy sync-schedule --gen2 --region=us-central1 --update-env-vars GOOGLE_TOKEN='<new-token-json>'"
      );
    }

    const fs = await import("fs");
    const path = await import("path");
    const { fileURLToPath } = await import("url");

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const TOKEN_PATH = path.join(__dirname, "google-calendar", "token.json");

    console.log("⚠️  Refresh token expired or revoked. Removing old token and re-authenticating...");
    if (fs.existsSync(TOKEN_PATH)) {
      fs.unlinkSync(TOKEN_PATH);
    }

    console.log("🔄 Starting OAuth flow to get new refresh token...");
    const newAuth = await authorize();
    console.log("✅ New token obtained. Retrying operation...");
    return await fn(newAuth);
  }
}
