import fs from "fs";
import path from "path";
import http from "http";
import destroyer from "server-destroy";
import { google } from "googleapis";
import open from "open";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { isCloudRuntime } from "../runtime-env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TOKEN_PATH = path.join(__dirname, "token.json");
const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");

/**
 * True when OAuth client id/secret/redirect are set in the environment (no credentials.json needed).
 * @returns {boolean}
 */
function isOAuthClientFromEnv() {
	const id = process.env.GOOGLE_CLIENT_ID?.trim();
	const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
	const redirect = process.env.GOOGLE_REDIRECT_URI?.trim();
	return Boolean(id && secret && redirect);
}

/**
 * Load OAuth client config: prefer GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI,
 * else fall back to credentials.json (installed app).
 * @returns {{ client_id: string, client_secret: string, redirect_uri: string }}
 */
function loadLocalOAuthConfig() {
	if (isOAuthClientFromEnv()) {
		return {
			client_id: process.env.GOOGLE_CLIENT_ID.trim(),
			client_secret: process.env.GOOGLE_CLIENT_SECRET.trim(),
			redirect_uri: process.env.GOOGLE_REDIRECT_URI.trim()
		};
	}
	if (!fs.existsSync(CREDENTIALS_PATH)) {
		throw new Error(
			`OAuth client not configured: set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in .env, ` +
				`or place Desktop OAuth credentials at ${CREDENTIALS_PATH}`
		);
	}
	const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
	const { client_secret, client_id } = credentials.installed;
	const redirect_uri = credentials.installed.redirect_uris[0];
	return { client_id, client_secret, redirect_uri };
}

/**
 * Local runs: token from GOOGLE_TOKEN env (JSON string) if set, else token.json.
 * When using env-only tokens, refreshed credentials are not written to disk.
 * @returns {boolean}
 */
function shouldPersistLocalTokenToFile() {
	return !process.env.GOOGLE_TOKEN?.trim();
}

function createOAuthClient(client_id, client_secret, redirect_uri) {
	return new google.auth.OAuth2(client_id, client_secret, redirect_uri);
}

/**
 * Exchange an OAuth authorization code for tokens and save token.json locally.
 * @param {string} code
 */
export async function exchangeOAuthCode(code) {
	const { client_id, client_secret, redirect_uri } = loadLocalOAuthConfig();
	const oAuth2Client = createOAuthClient(client_id, client_secret, redirect_uri);
	const { tokens } = await oAuth2Client.getToken(code);
	oAuth2Client.setCredentials(tokens);
	if (shouldPersistLocalTokenToFile()) {
		fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
		console.log("Authentication successful! Token saved to token.json");
	} else {
		console.log(
			"Authentication successful! Using GOOGLE_TOKEN from env — copy the refreshed value if you change clients."
		);
	}
	return oAuth2Client;
}

async function listenForCode(oAuth2Client, authUrl, redirectUri) {
	return new Promise((resolve, reject) => {
		const urlObj = new URL(redirectUri);
		const port = Number(urlObj.port) || (urlObj.protocol === "https:" ? 443 : 80);
		// Bind IPv4 explicitly — "localhost" on Windows often uses ::1 only, which
		// misses browser redirects that land on 127.0.0.1 (or vice versa).
		const host = urlObj.hostname === "localhost" ? "127.0.0.1" : (urlObj.hostname || "127.0.0.1");

		const server = http.createServer(async (req, res) => {
			const url = new URL(req.url, redirectUri);
			const code = url.searchParams.get("code");
			res.end("Authentication successful! You can close this tab.");
			server.destroy();
			resolve(code);
		});

		server.on("error", (err) => {
			if (err.code === "EADDRINUSE") {
				reject(new Error(
					`Port ${port} is already in use. Stop "npm start" (functions-framework) ` +
					`or any other process on port ${port}, then run "node sync.js" again.`
				));
				return;
			}
			reject(err);
		});

		server.listen(port, host, () => {
			console.log(`Listening for OAuth callback on http://${host}:${port}/`);
			open(authUrl);
		});
		destroyer(server);
	});
}

export async function authorize() {
	const isLocal = !isCloudRuntime();
	
	let client_id, client_secret, redirect_uri, tokens;

	if (isLocal) {
		const localCfg = loadLocalOAuthConfig();
		client_id = localCfg.client_id;
		client_secret = localCfg.client_secret;
		redirect_uri = localCfg.redirect_uri;

		if (process.env.GOOGLE_TOKEN?.trim()) {
			try {
				tokens = JSON.parse(process.env.GOOGLE_TOKEN);
			} catch {
				throw new Error("Invalid GOOGLE_TOKEN environment variable. Expected JSON string.");
			}
		} else if (fs.existsSync(TOKEN_PATH)) {
			tokens = JSON.parse(fs.readFileSync(TOKEN_PATH));
		}
	} else {
		// Cloud Functions: read from environment variables
		client_id = process.env.GOOGLE_CLIENT_ID;
		client_secret = process.env.GOOGLE_CLIENT_SECRET;
		redirect_uri = process.env.GOOGLE_REDIRECT_URI;

		if (!client_id || !client_secret || !redirect_uri) {
			throw new Error("Missing Google OAuth credentials in environment variables. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.");
		}

		// Read token from environment variable (JSON string)
		if (process.env.GOOGLE_TOKEN) {
			try {
				tokens = JSON.parse(process.env.GOOGLE_TOKEN);
			} catch (err) {
				throw new Error("Invalid GOOGLE_TOKEN environment variable. Expected JSON string.");
			}
		}
	}

	const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);

	if (tokens) {
		oAuth2Client.setCredentials(tokens);

		oAuth2Client.on("tokens", (newTokens) => {
			if (newTokens.refresh_token) {
				tokens.refresh_token = newTokens.refresh_token;
				console.log("🔄 New refresh token received");
			}
			tokens.access_token = newTokens.access_token;
			tokens.expiry_date = newTokens.expiry_date;

			if (!isLocal) {
				console.log("🔄 Access token refreshed automatically (expires in ~1 hour)");
			} else if (shouldPersistLocalTokenToFile()) {
				try {
					fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
					console.log("💾 Token saved to file");
				} catch (err) {
					console.error("⚠️  Failed to save updated token:", err.message);
				}
			} else {
				console.log(
					"🔄 Access token refreshed in memory (GOOGLE_TOKEN in use — update .env if you need to persist a new refresh token)"
				);
			}
		});

		oAuth2Client.on("error", (error) => {
			console.error("❌ OAuth token error:", error.message);
		});

		return oAuth2Client;
	}

	if (isLocal) {
		const authUrl = oAuth2Client.generateAuthUrl({
			access_type: "offline", // Required for refresh tokens (long-lived)
			prompt: "consent", // Force consent screen to ensure refresh token is issued
			scope: ["https://www.googleapis.com/auth/calendar"],
			include_granted_scopes: true, // Include previously granted scopes
		});
		console.log("Authorize this app by visiting this URL:", authUrl);
		const code = await listenForCode(oAuth2Client, authUrl, redirect_uri);
		return exchangeOAuthCode(code);
	} else {
		throw new Error("Missing GOOGLE_TOKEN environment variable. Run locally to authorize first and then set GOOGLE_TOKEN to the token JSON string.");
	}
}