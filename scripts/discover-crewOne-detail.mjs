/**
 * Discover Crew One event detail page structure.
 * Usage: node scripts/discover-crewOne-detail.mjs
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { getPuppeteer } from "../get-schedule/puppeteer.js";
import { getCredentials } from "../get-schedule/sources/crewOne.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const creds = getCredentials();
if (!creds) {
  console.error("Set CREWONE_EMAIL and CREWONE_PASSWORD in .env");
  process.exit(1);
}

const puppeteer = await getPuppeteer();
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto(creds.loginUrl, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector('input[placeholder="Email Address..."]', { visible: true });
  await page.type('input[placeholder="Email Address..."]', creds.email, { delay: 15 });
  await page.type('input[placeholder="Password..."]', creds.password, { delay: 15 });
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /login/i.test(b.textContent || "")
    );
    btn?.click();
  });
  await page.waitForFunction(() => window.location.pathname.includes("dashboard"), {
    timeout: 60000
  });
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 30000 }).catch(() => {});

  const rowMeta = await page.evaluate(() => {
    const heading = [...document.querySelectorAll("h6")].find(
      (h) => h.textContent.trim() === "Upcoming Calls"
    );
    if (!heading) return { rows: [], error: "no heading" };

    let container = heading.parentElement;
    for (let i = 0; i < 8 && container; i++) {
      const table = container.querySelector("table");
      if (!table) {
        container = container.parentElement;
        continue;
      }
      const rows = [...table.querySelectorAll("tbody tr")].map((tr, index) => {
        const cells = [...tr.querySelectorAll("td")];
        const links = [...tr.querySelectorAll("a")].map((a) => ({
          href: a.getAttribute("href"),
          text: (a.textContent || "").trim(),
          aria: a.getAttribute("aria-label"),
          title: a.getAttribute("title")
        }));
        const buttons = [...tr.querySelectorAll("button, [role=button]")].map((b) => ({
          text: (b.textContent || "").trim(),
          aria: b.getAttribute("aria-label"),
          title: b.getAttribute("title"),
          className: b.className
        }));
        const icons = [...tr.querySelectorAll("svg, i, .material-icons, [class*=icon]")].map(
          (el) => ({
            tag: el.tagName,
            className: el.className?.toString?.() || el.className,
            text: (el.textContent || "").trim(),
            parentTag: el.parentElement?.tagName,
            parentHref: el.closest("a")?.getAttribute("href")
          })
        );
        return {
          index,
          cellCount: cells.length,
          cells: cells.map((c) => (c.innerText || c.textContent || "").trim()),
          links,
          buttons,
          icons: icons.slice(0, 8),
          html: tr.innerHTML.slice(0, 500)
        };
      });
      return { rows };
    }
    return { rows: [], error: "no table" };
  });

  console.log("=== Row metadata ===");
  console.log(JSON.stringify(rowMeta, null, 2));

  const firstDetailUrl = rowMeta.rows?.find((r) => r.links?.[0]?.href)?.links[0].href;
  if (firstDetailUrl) {
    await page.goto(firstDetailUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 }).catch(() => {});
    const detailDirect = await page.evaluate(() => ({
      url: location.href,
      bodyText: document.body.innerText,
      tables: [...document.querySelectorAll("table")].map((t) =>
        [...t.querySelectorAll("tr")].map((tr) =>
          [...tr.querySelectorAll("th,td,label,div")].map((c) =>
            (c.innerText || c.textContent || "").trim()
          ).filter(Boolean)
        )
      ),
      labels: [...document.querySelectorAll("label, strong, b, .fw-bold, .col-form-label")].map(
        (el) => ({
          tag: el.tagName,
          text: (el.textContent || "").trim().slice(0, 80),
          next: (el.nextElementSibling?.textContent || "").trim().slice(0, 120)
        })
      ).slice(0, 40)
    }));
    console.log("\n=== Detail page (direct nav) ===");
    console.log(JSON.stringify(detailDirect, null, 2));
    await page.goto(creds.loginUrl.replace(/\/?$/, "/") + "dashboard", {
      waitUntil: "networkidle2"
    }).catch(() => {});
  }

  const clicked = await page.evaluate(() => {
    const heading = [...document.querySelectorAll("h6")].find(
      (h) => h.textContent.trim() === "Upcoming Calls"
    );
    if (!heading) return { ok: false, reason: "no heading" };

    let container = heading.parentElement;
    for (let i = 0; i < 8 && container; i++) {
      const table = container.querySelector("table");
      if (!table) {
        container = container.parentElement;
        continue;
      }
      const tr = table.querySelector("tbody tr");
      if (!tr) return { ok: false, reason: "no row" };

      const link =
        tr.querySelector('a[href*="event"], a[href*="call"], a[href*="detail"]') ||
        tr.querySelector("a[title*='info' i], a[aria-label*='info' i]") ||
        tr.querySelector("a .material-icons, a svg")?.closest("a") ||
        [...tr.querySelectorAll("a")].find((a) => {
          const t = (a.textContent || "").toLowerCase();
          return t.includes("info") || t === "i" || a.querySelector("svg");
        }) ||
        tr.querySelector("td:last-child a") ||
        tr.querySelector("a");

      if (!link) return { ok: false, reason: "no link", rowHtml: tr.innerHTML.slice(0, 400) };
      link.click();
      return { ok: true, href: link.getAttribute("href") };
    }
    return { ok: false, reason: "no table" };
  });

  console.log("\n=== Click result ===", clicked);

  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 }).catch(() => {});

  const detail = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    headings: [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) =>
      h.textContent.trim()
    ),
    bodyText: document.body.innerText.slice(0, 3000),
    tables: [...document.querySelectorAll("table")].map((t) =>
      [...t.querySelectorAll("tr")].slice(0, 15).map((tr) =>
        [...tr.querySelectorAll("th,td")].map((c) => (c.innerText || c.textContent).trim())
      )
    ),
    dl: [...document.querySelectorAll("dl")].map((dl) =>
      [...dl.querySelectorAll("dt,dd")].map((n) => (n.innerText || n.textContent).trim())
    )
  }));

  console.log("\n=== Detail page ===");
  console.log(JSON.stringify(detail, null, 2));
} finally {
  await browser.close();
}
