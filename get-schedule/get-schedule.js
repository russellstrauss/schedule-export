import dotenv from "dotenv";

import { authorize } from "./google-calendar/auth.js";
import { addEvent, purgeRhinoEvents } from "./google-calendar/add-event.js";
import { toGoogleEvent, isEventCancelled } from "./utils.js";

async function getPuppeteer() {
	const isCloudFunction = !!(
		process.env.GOOGLE_CLOUD_PROJECT ||
		process.env.FUNCTION_TARGET ||
		process.env.K_SERVICE ||
		process.env.FUNCTION_NAME ||
		process.env.K_REVISION ||
		// Check if we're in a typical serverless environment (www-data-home is the home dir in Cloud Functions)
		(process.env.HOME && process.env.HOME.includes('www-data-home')) ||
		(process.env.PWD && process.env.PWD.includes('www-data-home'))
	);

	if (isCloudFunction) {
		try {
			const chromiumModule = await import("@sparticuz/chromium");
			const puppeteerCore = await import("puppeteer-core");

			// Handle both default export and named export
			const chromium = chromiumModule.default || chromiumModule;

			// Set graphics mode for Cloud Functions (reduces memory usage)
			if (chromium.setGraphicsMode) {
				chromium.setGraphicsMode(false);
			}

			// Get executable path (it's a function that returns a Promise)
			const executablePath = chromium.executablePath
				? await chromium.executablePath()
				: null;

			if (!executablePath) {
				throw new Error('Could not get executable path from @sparticuz/chromium');
			}

			return {
				launch: async (options = {}) => {
					const launchOptions = {
						args: chromium.args || [
							'--no-sandbox',
							'--disable-setuid-sandbox',
							'--disable-dev-shm-usage',
							'--disable-accelerated-2d-canvas',
							'--no-first-run',
							'--no-zygote',
							'--single-process',
							'--disable-gpu'
						],
						defaultViewport: chromium.defaultViewport || { width: 1280, height: 720 },
						executablePath: executablePath,
						headless: true,
						...options
					};

					return puppeteerCore.default.launch(launchOptions);
				}
			};
		} catch (error) {
			console.error('Error setting up @sparticuz/chromium:', error);
			throw new Error(`Failed to initialize Puppeteer with @sparticuz/chromium: ${error.message}`);
		}
	} else {
		// Local development - use regular puppeteer
		const puppeteer = await import("puppeteer");
		return puppeteer.default;
	}
}

dotenv.config();

export default async function getSchedule() {
	const email = process.env.RHINO_EMAIL;
	const password = process.env.RHINO_PASSWORD;

	if (!email || !password) {
		throw new Error("Missing RHINO_EMAIL or RHINO_PASSWORD in environment.");
	}

	const puppeteer = await getPuppeteer();
	const browser = await puppeteer.launch({ headless: "new" });
	const page = await browser.newPage();

	const url = "https://thinkrhino.com/employee/georgia/Index.aspx?cookieCheck=true";
	await page.goto(url, { waitUntil: "networkidle2" });

	await page.type("#emailaddress", email);
	await page.type("#mypassword", password);
	await page.click("#btnNewLogin");

	await page.waitForFunction(() => document.readyState === "complete", { timeout: 5000 });
	await page.waitForSelector("#btnSchedule", { visible: true, timeout: 5000 });
	await page.click("#btnSchedule");
	await page.waitForSelector("table#dgResults");

	const events = await page.evaluate(() => {
		const table = document.querySelector("table#dgResults");
		if (!table) return [];

		const allRows = Array.from(table.querySelectorAll("tbody tr"));
		const headerRow = allRows[0];
		const dataRows = allRows.slice(1, -1);

		// Find Venue Link column: header is <td class="leftcell">+</td>
		let venueLinkColumnIndex = -1;
		let statusColumnIndex = 10;
		if (headerRow) {
			const headerCells = Array.from(headerRow.querySelectorAll("td"));
			for (let i = 0; i < headerCells.length; i++) {
				const cell = headerCells[i];
				const hasLeftcell = cell.classList && cell.classList.contains("leftcell");
				if (hasLeftcell && cell.textContent.trim() === "+") {
					venueLinkColumnIndex = i;
				}
				const headerText = cell.textContent.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
				if (headerText === "status" || headerText.startsWith("status ")) {
					statusColumnIndex = i;
				}
			}
		}

		const removeEscapes = (cell) => {
			return cell.textContent.replace(/\\t/g, "").replace(/\\n/g, "\n").replace(/\s+/g, " ").trim();
		};

		return dataRows.map(row => {
			const cells = Array.from(row.querySelectorAll("td"));
			if (cells.length < 12) return null;

			// Check if "Call Cancelled" is in the specific cell (index 14, the second-to-last cell before Venue Info)
			const callCancelledCell = cells[14] ? cells[14].textContent.trim() : "";
			const isCallCancelled = callCancelledCell.toLowerCase() === "call cancelled";

			let venueLink;
			if (venueLinkColumnIndex >= 0 && cells[venueLinkColumnIndex]) {
				const anchor = cells[venueLinkColumnIndex].querySelector("a");
				const href = anchor ? anchor.href : null;
				venueLink = (href && href.trim()) ? href.trim() : undefined;
			}

			const statusCell = cells[statusColumnIndex];
			const entry = {
				date: cells[0].textContent.trim(),
				callTime: cells[1].textContent.trim(),
				show: cells[3].textContent.trim(),
				venue: removeEscapes(cells[4]),
				location: cells[5].textContent.trim(),
				client: cells[6].textContent.trim(),
				type: cells[7].textContent.trim(),
				position: cells[8].textContent.trim(),
				details: cells[9].textContent.trim(),
				status: statusCell ? statusCell.textContent.trim() : "",
				notes: cells[11].textContent.trim(),
				isCallCancelled: isCallCancelled
			};
			if (venueLink) entry.venueLink = venueLink;
			return entry;
		}).filter(Boolean);
	});

	// Filter out cancelled events using utility function
	const validEntries = events.filter(entry => !isEventCancelled(entry));

	const futureEntries = validEntries.filter(entry => {
		const [month, day, year] = entry.date.split("/").map(Number);
		const [hours, minutes] = entry.callTime.split(":").map(Number);
		const start = new Date(year, month - 1, day, hours, minutes);
		return start > new Date();
	});

	const googleEvents = futureEntries.map(toGoogleEvent);

	console.log(`🗓️ Upcoming ${googleEvents.length} events:`);
	googleEvents.forEach(event => {
		console.log(`  ✅ ${event.summary}`);
	});

	let auth = await authorize();

	// Helper function to check if an error is due to expired/revoked refresh token
	function isExpiredTokenError(error) {
		// Check various error formats from Google OAuth API
		const errorCode = error?.code;
		const errorMessage = error?.message || '';
		const responseError = error?.response?.data?.error;
		const responseErrorDescription = error?.response?.data?.error_description || '';
		const responseStatus = error?.response?.status;

		// Check for invalid_grant error (expired/revoked refresh token)
		if (responseError === 'invalid_grant' || errorMessage.includes('invalid_grant')) {
			return true;
		}

		// Check for 400 status with expired/invalid descriptions
		if (responseStatus === 400) {
			const description = responseErrorDescription.toLowerCase();
			if (description.includes('expired') ||
				description.includes('invalid') ||
				description.includes('revoked') ||
				description.includes('token')) {
				return true;
			}
		}

		// Check for specific error codes
		if (errorCode === 401 || errorCode === 403) {
			if (errorMessage.includes('token') &&
				(errorMessage.includes('expired') || errorMessage.includes('invalid') || errorMessage.includes('revoked'))) {
				return true;
			}
		}

		// Check for authentication errors that might indicate token issues
		if (errorMessage.includes('Refresh token') &&
			(errorMessage.includes('expired') || errorMessage.includes('revoked') || errorMessage.includes('invalid'))) {
			return true;
		}

		return false;
	}

	// Helper function to handle token expiration
	async function handleAuthError(error, retryFn) {
		if (isExpiredTokenError(error)) {
			const isCloudFunction = !!(
				process.env.GOOGLE_CLOUD_PROJECT ||
				process.env.FUNCTION_TARGET ||
				process.env.K_SERVICE ||
				process.env.FUNCTION_NAME ||
				process.env.K_REVISION
			);

			if (isCloudFunction) {
				// In Cloud Functions, we can't re-authenticate automatically
				// Provide clear error message
				const errorMsg = `Google OAuth refresh token has expired or been revoked. ` +
					`The refresh token stored in GOOGLE_TOKEN environment variable is no longer valid. ` +
					`To fix this:\n` +
					`1. Run 'node sync.js' locally to re-authenticate\n` +
					`2. Copy the new token from get-schedule/google-calendar/token.json\n` +
					`3. Update the GOOGLE_TOKEN environment variable in Cloud Functions using:\n` +
					`   .\\deployment\\update-env-vars.ps1\n` +
					`   Or manually: gcloud functions deploy sync-schedule --gen2 --region=us-central1 --update-env-vars GOOGLE_TOKEN='<new-token-json>'`;
				throw new Error(errorMsg);
			} else {
				// Local development: re-authenticate automatically
				const fs = await import('fs');
				const path = await import('path');
				const { fileURLToPath } = await import('url');

				const __filename = fileURLToPath(import.meta.url);
				const __dirname = path.dirname(__filename);
				const TOKEN_PATH = path.join(__dirname, "google-calendar", "token.json");

				console.log("⚠️  Refresh token expired or revoked. Removing old token and re-authenticating...");
				if (fs.existsSync(TOKEN_PATH)) {
					fs.unlinkSync(TOKEN_PATH);
				}

				// Re-authorize to get a new token
				console.log("🔄 Starting OAuth flow to get new refresh token...");
				auth = await authorize();
				console.log("✅ New token obtained. Retrying operation...");

				// Retry the operation
				return await retryFn();
			}
		}

		// If not an expired token error, throw the error
		throw error;
	}

	try {
		await purgeRhinoEvents(auth);
	} catch (error) {
		await handleAuthError(error, () => purgeRhinoEvents(auth));
	}

	for (const event of googleEvents) {
		try {
			await addEvent(auth, event);
		} catch (error) {
			await handleAuthError(error, () => addEvent(auth, event));
		}
	}

	await browser.close();
}