const dotenv = require("dotenv").config();
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const pad = (num) => { // ICS operations
	return num.toString().padStart(2, "0");
}

const formatICSDate = (dateObj) => {
	const year = dateObj.getFullYear();
	const month = String(dateObj.getMonth() + 1).padStart(2, "0");
	const day = String(dateObj.getDate()).padStart(2, "0");
	const hours = String(dateObj.getHours()).padStart(2, "0");
	const minutes = String(dateObj.getMinutes()).padStart(2, "0");

	return `${year}${month}${day}T${hours}${minutes}00`;
}

const generateTimestamp = () => { // 11-06-2025_0504PM
	const now = new Date();
	const hours = now.getHours();
	const minutes = pad(now.getMinutes());
	const ampm = hours >= 12 ? "PM" : "AM";
	const hour12 = hours % 12 === 0 ? 12 : hours % 12;

	return `${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${now.getFullYear()}_${pad(hour12)}${minutes}${ampm}`;
}

const createVEVENT = (entry, index) => {
	const [month, day, year] = entry.date.split("/").map(Number);
	const [hours, minutes] = entry.callTime.split(":").map(Number);
	const startDate = new Date(year, month - 1, day, hours, minutes);

	const start = formatICSDate(startDate);
	const end = formatICSDate(new Date(startDate.getTime() + 60 * 60 * 1000)); // 1-hour duration
	const dtstamp = formatICSDate(new Date());

	const summary = entry.show;
	const location = [entry.venue, entry.location].filter(Boolean).join(" - ");
	const description = [entry.details, entry.notes].filter(Boolean).join(" | ");
	const status = entry.status?.toUpperCase();

	return [
		"BEGIN:VEVENT",
		`DTSTAMP:${dtstamp}`,
		`DTSTART:${start}`,
		`DTEND:${end}`,
		`SUMMARY:${summary}`,
		`LOCATION:${location}`,
		`DESCRIPTION:${description}`,
		`STATUS:${status}`,
		"END:VEVENT"
	].join("\r\n");
}

const toGoogleEvent = (entry) => {
	const [month, day, year] = entry.date.split("/").map(Number);
	const [hours, minutes] = entry.callTime.split(":").map(Number);
	const start = new Date(year, month - 1, day, hours, minutes);
	const end = new Date(start.getTime() + 60 * 60 * 1000);

	return {
		summary: entry.show,
		location: `${entry.venue} - ${entry.location}`,
		description: `${entry.details} | ${entry.notes}`,
		start: start.toISOString(),
		end: end.toISOString(),
		status: entry.status?.toLowerCase() || "confirmed"
	}
}

async function getSchedule() {
	const browser = await puppeteer.launch({ headless: true }); // set to false to see the browser
	const page = await browser.newPage();
	
	const url = "https://thinkrhino.com/employee/georgia/Index.aspx?cookieCheck=true";
	await page.goto(url, { waitUntil: "networkidle2" });

	await page.type("#emailaddress", process.env.RHINO_EMAIL);
	await page.type("#mypassword", process.env.RHINO_PASSWORD);
	await page.click("#btnNewLogin");
	
	await page.waitForFunction(() => document.readyState === "complete", { timeout: 5000 }); // Wait for document ready
	await page.waitForSelector("#btnSchedule", { visible: true, timeout: 5000 }); // Wait for #btnSchedule to appear	
	await page.click("#btnSchedule"); // load schedule table
	await page.waitForSelector("table#dgResults");
	
	const events = await page.evaluate(() => {
		const table = document.querySelector("table#dgResults");
		if (!table) return [];
		
		const rows = Array.from(table.querySelectorAll("tbody tr")).slice(1, -1);
		return rows.map(row => {
			const cells = Array.from(row.querySelectorAll("td"));
			if (cells.length < 12) return null; // skip malformed rows
			
			const removeEscapes = (cell) => {
				return cell.textContent.replace(/\\t/g, "").replace(/\\n/g, "\n").replace(/\s+/g, " ").trim();
			}

			return {
				date: cells[0].textContent.trim(),
				callTime: cells[1].textContent.trim(),
				show: cells[3].textContent.trim(),
				venue: removeEscapes(cells[4]),
				location: cells[5].textContent.trim(),
				client: cells[6].textContent.trim(),
				type: cells[7].textContent.trim(),
				position: cells[8].textContent.trim(),
				details: cells[9].textContent.trim(),
				status: cells[10].textContent.trim(),
				notes: cells[11].textContent.trim(),
			};
		}).filter(Boolean); // remove nulls
	});
	
	const googleEvents = events.map(toGoogleEvent);
	await importEvents(googleEvents);
	
	// Download ICS file
	const vevents = events.map((entry, i) => createVEVENT(entry, i)).join("\r\n");
	const icsContent = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//YourApp//EN",
		vevents,
		"END:VCALENDAR"
	].join("\r\n");
	
	const timeId = generateTimestamp();
	const filename = `rhino-schedule-export-${timeId}.ics`;
	const filepath = path.join(__dirname, filename);

	fs.writeFileSync(filepath, icsContent, "utf8");
	console.log(`Schedule exported to ${filename}`);
	
	await browser.close();
}
getSchedule();

module.exports = getSchedule;