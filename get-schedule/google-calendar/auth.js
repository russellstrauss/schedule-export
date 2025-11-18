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

async function listenForCode(oAuth2Client, authUrl) {
	return new Promise((resolve, reject) => {
		const server = http.createServer(async (req, res) => {
			const url = new URL(req.url, "http://localhost:3000");
			const code = url.searchParams.get("code");
			res.end("Authentication successful! You can close this tab.");
			server.destroy();
			resolve(code);
		}).listen(3000, () => {
			open(authUrl);
		});
		destroyer(server);
	});
}

export async function authorize() {
	const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
	const { client_secret, client_id, redirect_uris } = credentials.installed;
	const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

	if (fs.existsSync(TOKEN_PATH)) {
		oAuth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH)));
		return oAuth2Client;
	}

	const isLocal = !process.env.GOOGLE_CLOUD_PROJECT;

	if (isLocal) {
		const authUrl = oAuth2Client.generateAuthUrl({
			access_type: "offline",
			scope: ["https://www.googleapis.com/auth/calendar"],
		});
		console.log("Authorize this app by visiting this URL:", authUrl);
		const code = await listenForCode(oAuth2Client, authUrl);
		const { tokens } = await oAuth2Client.getToken(code);
		oAuth2Client.setCredentials(tokens);
		fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
		return oAuth2Client;
	} else {
		throw new Error("Missing token.json. Run locally to authorize first.");
	}
}