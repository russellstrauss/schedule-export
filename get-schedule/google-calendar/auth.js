import fs from "fs";
import path from "path";
import http from "http";
import destroyer from "server-destroy";
import { google } from "googleapis";
import open from "open";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TOKEN_PATH = path.join(__dirname, "token.json");
const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");

async function listenForCode(oAuth2Client, authUrl, redirectUri) {
	return new Promise((resolve, reject) => {
		// Parse the redirect URI to get port and host
		const urlObj = new URL(redirectUri);
		const port = urlObj.port || (urlObj.protocol === "https:" ? 443 : 80);
		const host = urlObj.hostname || "localhost";
		
		const server = http.createServer(async (req, res) => {
			const url = new URL(req.url, redirectUri);
			const code = url.searchParams.get("code");
			res.end("Authentication successful! You can close this tab.");
			server.destroy();
			resolve(code);
		}).listen(port, host, () => {
			console.log(`Listening for OAuth callback on ${redirectUri}`);
			open(authUrl);
		});
		destroyer(server);
	});
}

export async function authorize() {
	// Check multiple indicators of Cloud Functions/serverless environment
	const isCloudFunction = !!(
		process.env.GOOGLE_CLOUD_PROJECT ||
		process.env.FUNCTION_TARGET ||
		process.env.K_SERVICE ||
		process.env.FUNCTION_NAME ||
		process.env.K_REVISION ||
		// Check if we're in a typical serverless environment
		(process.env.HOME && process.env.HOME.includes('www-data-home')) ||
		(process.env.PWD && process.env.PWD.includes('www-data-home')) ||
		(process.env.PWD && process.env.PWD.includes('/workspace'))
	);
	
	const isLocal = !isCloudFunction;
	
	let client_id, client_secret, redirect_uri, tokens;

	if (isLocal) {
		// Local development: read from files
		if (!fs.existsSync(CREDENTIALS_PATH)) {
			throw new Error(`Credentials file not found at ${CREDENTIALS_PATH}`);
		}
		const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
		({ client_secret, client_id } = credentials.installed);
		redirect_uri = credentials.installed.redirect_uris[0];

		if (fs.existsSync(TOKEN_PATH)) {
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
		
		// Configure for automatic token refresh with longest possible lifetime
		// The googleapis library automatically refreshes access tokens when they expire (~1 hour)
		// Refresh tokens are long-lived and don't expire if used regularly
		oAuth2Client.on('tokens', (newTokens) => {
			// If we got a new refresh token (rare, but can happen), update the stored token
			if (newTokens.refresh_token) {
				tokens.refresh_token = newTokens.refresh_token;
				console.log('🔄 New refresh token received');
			}
			// Update access token and expiry (happens automatically every ~1 hour)
			tokens.access_token = newTokens.access_token;
			tokens.expiry_date = newTokens.expiry_date;
			
			// In Cloud Functions, we can't update the environment variable,
			// but we can log that a refresh happened
			if (isCloudFunction) {
				console.log('🔄 Access token refreshed automatically (expires in ~1 hour)');
			} else {
				// In local development, save to file to persist the updated token
				fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
			}
		});
		
		return oAuth2Client;
	}

	// No token found - need to authorize
	if (isLocal) {
		const authUrl = oAuth2Client.generateAuthUrl({
			access_type: "offline", // Required for refresh tokens (long-lived)
			prompt: "consent", // Force consent screen to ensure refresh token is issued
			scope: ["https://www.googleapis.com/auth/calendar"],
			include_granted_scopes: true, // Include previously granted scopes
		});
		console.log("Authorize this app by visiting this URL:", authUrl);
		const code = await listenForCode(oAuth2Client, authUrl, redirect_uri);
		const { tokens: newTokens } = await oAuth2Client.getToken(code);
		oAuth2Client.setCredentials(newTokens);
		fs.writeFileSync(TOKEN_PATH, JSON.stringify(newTokens));
		return oAuth2Client;
	} else {
		throw new Error("Missing GOOGLE_TOKEN environment variable. Run locally to authorize first and then set GOOGLE_TOKEN to the token JSON string.");
	}
}