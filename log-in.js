const dotenv = require("dotenv").config();
const puppeteer = require("puppeteer");

async function login() {
	const browser = await puppeteer.launch({ headless: false }); // set to false to see the browser
	const page = await browser.newPage();
	
	const url = "https://thinkrhino.com/employee/georgia/Index.aspx?cookieCheck=true";
	await page.goto(url, { waitUntil: "networkidle2" });

	await page.type("#emailaddress", process.env.RHINO_EMAIL);
	await page.type("#mypassword", process.env.RHINO_PASSWORD);
	await page.click("#btnNewLogin");
	console.log("Login successful!");
	const html = await page.content();
	
	await page.waitForFunction(() => document.readyState === "complete", { timeout: 10000 }); // Wait for document ready
	await page.waitForSelector("#btnSchedule", { visible: true, timeout: 10000 }); // Wait for #btnSchedule to appear	
	await page.click("#btnSchedule");
	await page.waitForSelector("table#dgResults");
	console.log("Schedule loaded.");
	
	function cleanCellText(cell) {
		return cell.textContent
			.replace(/\\t/g, "")     // remove literal tab escape sequences
			.replace(/\\n/g, "\n")   // convert literal newline escape sequences to actual line breaks
			.replace(/\s+/g, " ")    // collapse multiple spaces and newlines
			.trim();                 // final trim
	}
	
	const data = await page.evaluate(() => {
		const table = document.querySelector("table#dgResults");
		if (!table) return [];

		const rows = Array.from(table.querySelectorAll("tbody tr")).slice(1, -1);
		
		function cleanCellText(cell) {
			return cell.textContent
				.replace(/\t/g, "")
				.replace(/\n/g, "\n")
				.replace(/\s+/g, " ")
				.trim();
		}

		function combineDateAndTime(dateStr, timeStr) {
			const [month, day, year] = dateStr.split("/").map(Number);
			const [hours, minutes] = timeStr.split(":").map(Number);
			return new Date(year, month - 1, day, hours, minutes, 0, 0);
		}

		return rows.map(row => {
			const cells = Array.from(row.querySelectorAll("td"));
			if (cells.length < 12) return null; // skip malformed rows

			const callTime = combineDateAndTime(cells[0].textContent.trim(), cells[1].textContent.trim());

			return {
				date: cells[0].textContent.trim(),
				callTime: callTime,
				show: cells[3].textContent.trim(),
				venue: cleanCellText(cells[4]),
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
	console.log(data);
	
	// const data = Array.from(rows).slice(1, -1).map(row => {
	// 	const cells = row.querySelectorAll("td");
	// 	// console.log(row);
		
	// 	const callTime = combineDateAndTime(cells[0].textContent.trim(), cells[1].textContent.trim());
		
	// 	return {
	// 		date: cells[0].textContent.trim(),
	// 		callTime: callTime,
	// 		show: cells[3].textContent.trim(),
	// 		venue: cleanCellText(cells[4]),
	// 		location: cells[5].textContent.trim(),
	// 		client: cells[6].textContent.trim(),
	// 		type: cells[7].textContent.trim(),
	// 		position: cells[8].textContent.trim(),
	// 		details: cells[9].textContent.trim(),
	// 		status: cells[10].textContent.trim(),
	// 		notes: cells[11].textContent.trim(),
	// 	};
	// });
	
	// ICS operations
	function pad(num) {
		return num.toString().padStart(2, "0");
	}
	
	function formatICSDate(dateObj) {
		const year = dateObj.getFullYear();
		const month = String(dateObj.getMonth() + 1).padStart(2, "0");
		const day = String(dateObj.getDate()).padStart(2, "0");
		const hours = String(dateObj.getHours()).padStart(2, "0");
		const minutes = String(dateObj.getMinutes()).padStart(2, "0");
	
		return `${year}${month}${day}T${hours}${minutes}00`;
	}
	
	function createVEVENT(entry, index) {
		const start = formatICSDate(entry.callTime);
		const end = formatICSDate(new Date(entry.callTime.getTime() + 60 * 60 * 1000)); // 1-hour duration
		const uid = `${start}-${index}@yourapp.com`;
		const dtstamp = formatICSDate(new Date());
	
		const summary = entry.show || "Untitled Event";
		const location = [entry.venue, entry.location].filter(Boolean).join(" - ");
		const description = [entry.details, entry.notes].filter(Boolean).join(" | ") || "No details provided";
		const status = entry.status?.toUpperCase() || "CONFIRMED";
	
		return [
			"BEGIN:VEVENT",
			`UID:${uid}`,
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
	
	// Download ICS
	// const vevents = data.map((entry, i) => createVEVENT(entry, i)).join("\r\n");
	// const icsContent = [
	// 	"BEGIN:VCALENDAR",
	// 	"VERSION:2.0",
	// 	"PRODID:-//YourApp//EN",
	// 	vevents,
	// 	"END:VCALENDAR"
	// ].join("\r\n");
	// const blob = new Blob([icsContent], { type: "text/calendar" });
	// const link = document.createElement("a");
	// link.href = URL.createObjectURL(blob);
	// link.download = "events-export.ics";
	// link.click();
	// console.log("Schedule exported");
	
	await browser.close();
}
login();

module.exports = login;