import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const SOURCE_URL = "https://www.war.gov/UFO/";
const OUT_FILE = path.join("data", "release-01-records.json");

const EXTRA_VIDEO_RECORDS = [
  {
    title: "DOW-UAP-PR46, Unresolved UAP Report, INDOPACOM, 2024",
    url: "https://www.dvidshub.net/video/1006106/dow-uap-pr46-unresolved-uap-report-indopacom-2024",
    agency: "INDOPACOM / AARO",
    year: "2024",
    type: "Video",
    location: "Near Japan / East China Sea",
    rating: 4,
    highlight: "Infrared footage from a U.S. military platform; official video page."
  },
  {
    title: "DOW-UAP-PR49, Unresolved UAP Report, Department of the Army, 2026",
    url: "https://www.dvidshub.net/video/1006111/dow-uap-pr49-unresolved-uap-report-department-army-2026",
    agency: "Department of the Army / AARO",
    year: "2026",
    type: "Video",
    location: "Undisclosed",
    rating: 4,
    highlight: "Infrared sensor video from a U.S. military platform; official video page."
  }
];

function cleanTitleFromUrl(url) {
  const file = decodeURIComponent(url.split("/").pop() || "");
  const base = file.replace(/\.(pdf|png|jpg|jpeg|mp4|mov)$/i, "");
  return base
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b(dow|uap|fbi|nasa|dos|aaro|indopacom|centcom|afb|usper|pdf|na)\b/gi, m => m.toUpperCase())
    .replace(/\b\w/g, c => c.toUpperCase());
}

function inferRecord(url) {
  const filename = decodeURIComponent(url.split("/").pop() || "").toLowerCase();
  const ext = (filename.split(".").pop() || "").toUpperCase();

  let title = cleanTitleFromUrl(url);
  let agency = "Unknown / Archive";
  let type = ext || "File";
  let location = "N/A";
  let rating = 2;
  let highlight = "Official WAR.gov Release 01 media file.";

  const years = Array.from(new Set(filename.match(/(19\d{2}|20\d{2})/g) || []));
  let year = years.length ? years.sort().join("–") : "N/A";

  if (filename.startsWith("dow-uap")) {
    agency = "Department of War / Military";
    type = filename.includes("range-fouler") ? "Range Fouler Report" : "Mission / Military Report";
    rating = 3;
    highlight = "Military-origin UAP report, range-fouler debrief, launch summary, or correspondence.";
    if (filename.includes("indopacom") || filename.includes("air-force") || filename.includes("vandenberg")) rating = 4;
  }

  if (filename.startsWith("nasa")) {
    agency = "NASA";
    type = filename.match(/\.(jpg|jpeg|png)$/i) ? "NASA Image" : "NASA Transcript / Debrief";
    location = "Space / Lunar Mission";
    rating = 3;
    highlight = "NASA mission transcript, debrief, or Apollo imagery.";
  }

  if (filename.startsWith("fbi-photo")) {
    agency = "FBI";
    type = filename.match(/\.(png|jpg|jpeg)$/i) ? "FBI Image" : "FBI Photo PDF";
    location = "Western United States / Redacted";
    rating = 2;
    highlight = "FBI photo/image item; useful as supporting media but often light on surrounding context.";
  }

  if (filename.startsWith("dos-uap")) {
    agency = "Department of State";
    type = "Diplomatic Cable";
    rating = 3;
    highlight = "Official State Department diplomatic cable.";
    if (filename.includes("papua")) location = "Papua New Guinea";
    if (filename.includes("kazakhstan")) location = "Kazakhstan";
  }

  if (filename.startsWith("059uap")) {
    agency = "Department of Energy / Oak Ridge";
    type = "DOE / Oak Ridge";
    location = "Oak Ridge / Tennessee";
    rating = 4;
    highlight = "DOE/Oak Ridge-related UAP file.";
  }

  if (filename.includes("usper-statement")) {
    title = "USPER Statement Redacted";
    agency = "Federal / State Partners / Intelligence Reference";
    year = year === "N/A" ? "2025" : year;
    type = "Witness Statement";
    location = "Western United States / Redacted";
    rating = 5;
    highlight = "Redacted witness statement referencing senior intelligence context, pilots, operations center, and FLIR/NVG observation.";
  }

  if (filename.includes("western_us_event")) {
    title = "Western U.S. Event Slides";
    agency = "AARO / Federal Law Enforcement";
    year = year === "N/A" ? "2023" : year;
    type = "AARO Slide Deck";
    location = "Western United States";
    rating = 5;
    highlight = "AARO slide deck involving multiple federal law-enforcement witness teams.";
  }

  if (/^(65_hs|18_|38_|59_|331_|341_|342_|255_)/.test(filename)) {
    agency = agency === "Unknown / Archive" ? "Historical Federal / Military Archive" : agency;
    type = type === ext ? "Historical Archive File" : type;
    rating = Math.min(rating, 2);
    highlight = "Historical federal/military archive record, case-file section, or study.";
  }

  return { title, url, agency, year, type, location, rating, highlight };
}

async function collectLinks(page) {
  return await page.evaluate(() => {
    const values = [];
    const attrs = ["href", "src"];

    for (const el of document.querySelectorAll("a, source, video, img")) {
      for (const attr of attrs) {
        const value = el.getAttribute(attr);
        if (value) values.push(new URL(value, location.href).href);
      }
    }

    const html = document.documentElement.innerHTML;
    const urlMatches = html.match(/https?:\/\/[^"'<> ]+/g) || [];
    values.push(...urlMatches);

    return Array.from(new Set(values))
      .filter(u =>
        /\/medialink\/ufo\/release_1\//i.test(u) ||
        /dvidshub\.net\/video\/\d+\/dow-uap/i.test(u)
      )
      .map(u => u.replace(/&amp;/g, "&"));
  });
}

async function clickThroughPagination(page) {
  const allLinks = new Set();

  for (let i = 0; i < 30; i++) {
    const links = await collectLinks(page);
    links.forEach(link => allLinks.add(link));

    const clicked = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll("a, button"))
        .filter(el => {
          const text = (el.textContent || "").trim().toLowerCase();
          const label = (el.getAttribute("aria-label") || "").toLowerCase();
          return text === "next" || text === ">" || text === "»" || label.includes("next");
        });

      const target = candidates.find(el => !el.disabled && el.getAttribute("aria-disabled") !== "true");
      if (!target) return false;
      target.click();
      return true;
    });

    if (!clicked) break;
    await page.waitForTimeout(1500);
  }

  return Array.from(allLinks);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1800 } });

  await page.goto(SOURCE_URL, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1500);

  const pagedLinks = await clickThroughPagination(page);
  const finalLinks = await collectLinks(page);
  await browser.close();

  const links = Array.from(new Set([...pagedLinks, ...finalLinks]));
  const recordsMap = new Map();

  for (const url of links) {
    if (/\.(pdf|png|jpg|jpeg|mp4|mov)(\?|$)/i.test(url) || /dvidshub\.net\/video\//i.test(url)) {
      const record = /dvidshub\.net\/video\//i.test(url)
        ? {
            title: cleanTitleFromUrl(url),
            url,
            agency: "Department of War / AARO",
            year: "N/A",
            type: "Video",
            location: "N/A",
            rating: 3,
            highlight: "Official DVIDS/WAR.gov-linked video record."
          }
        : inferRecord(url);

      recordsMap.set(record.url, record);
    }
  }

  for (const r of EXTRA_VIDEO_RECORDS) {
    recordsMap.set(r.url, r);
  }

  const records = Array.from(recordsMap.values())
    .sort((a, b) => b.rating - a.rating || a.agency.localeCompare(b.agency) || a.title.localeCompare(b.title));

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceUrl: SOURCE_URL,
    count: records.length,
    note: "Generated by GitHub Actions from the rendered WAR.gov UAP page. Dynamic site behavior may require script tweaks if WAR.gov changes markup.",
    records
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2) + "\\n", "utf8");

  console.log(`Wrote ${records.length} records to ${OUT_FILE}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
