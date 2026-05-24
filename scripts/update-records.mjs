import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const SOURCE_URL = "https://www.war.gov/UFO/";
const FALLBACK_CSV_URL = "https://www.war.gov/Portals/1/Interactive/2026/UFO/uap-data.csv";
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
    highlight: "Infrared footage from a U.S. military platform; official video page.",
    release: "Release 01"
  },
  {
    title: "DOW-UAP-PR49, Unresolved UAP Report, Department of the Army, 2026",
    url: "https://www.dvidshub.net/video/1006111/dow-uap-pr49-unresolved-uap-report-department-army-2026",
    agency: "Department of the Army / AARO",
    year: "2026",
    type: "Video",
    location: "Undisclosed",
    rating: 4,
    highlight: "Infrared sensor video from a U.S. military platform; official video page.",
    release: "Release 01"
  }
];

async function readExistingRecords() {
  try {
    const raw = await fs.readFile(OUT_FILE, "utf8");
    const existing = JSON.parse(raw);
    return Array.isArray(existing.records) ? existing.records : [];
  } catch {
    return [];
  }
}

function parseCSV(csvText) {
  const rows = [];
  let row = [];
  let cell = "";
  let insideQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"' && insideQuotes && nextChar === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === "," && !insideQuotes) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (cell || row.length) {
        row.push(cell.trim());
        rows.push(row);
        row = [];
        cell = "";
      }

      if (char === "\r" && nextChar === "\n") {
        i++;
      }
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }

  return rows;
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function csvRowsToObjects(csvText) {
  const rows = parseCSV(csvText);

  if (!rows.length) {
    return [];
  }

  const headers = rows[0].map(header => String(header || "").trim());

  return rows.slice(1)
    .filter(row => row.some(cell => String(cell || "").trim()))
    .map(row => {
      const obj = {};

      headers.forEach((header, index) => {
        obj[header] = row[index] || "";
      });

      return obj;
    });
}

function pick(row, names) {
  const normalizedLookup = new Map();

  for (const [key, value] of Object.entries(row)) {
    normalizedLookup.set(normalizeKey(key), value);
  }

  for (const name of names) {
    const value = normalizedLookup.get(normalizeKey(name));

    if (value !== undefined && String(value).trim() !== "") {
      return String(value).trim();
    }
  }

  return "";
}

function absolutizeUrl(value, baseUrl = SOURCE_URL) {
  const raw = String(value || "").trim();

  if (!raw) {
    return "";
  }

  const first = raw.split("|").map(v => v.trim()).filter(Boolean)[0];

  if (!first) {
    return "";
  }

  try {
    return new URL(first, baseUrl).href;
  } catch {
    return first;
  }
}

function splitUrls(value, baseUrl = SOURCE_URL) {
  return String(value || "")
    .split("|")
    .map(v => v.trim())
    .filter(Boolean)
    .map(v => {
      try {
        return new URL(v, baseUrl).href;
      } catch {
        return v;
      }
    });
}

function inferRelease(url) {
  const match = String(url || "").match(/release_(\d+)/i);

  if (match) {
    return `Release ${match[1].padStart(2, "0")}`;
  }

  return "Release 01";
}

function inferReleaseFromDate(value, fallbackUrl = "") {
  const text = String(value || "").toLowerCase();

  if (text.includes("05") && text.includes("22") && text.includes("26")) {
    return "Release 02";
  }

  if (text.includes("may 22") || text.includes("2026-05-22") || text.includes("5/22/2026")) {
    return "Release 02";
  }

  if (text.includes("05") && text.includes("08") && text.includes("26")) {
    return "Release 01";
  }

  if (text.includes("may 8") || text.includes("2026-05-08") || text.includes("5/8/2026")) {
    return "Release 01";
  }

  return inferRelease(fallbackUrl);
}

function cleanTitleFromUrl(url) {
  const file = decodeURIComponent(String(url || "").split("/").pop() || "");
  const base = file.replace(/\.(pdf|png|jpg|jpeg|mp4|mov|webm)$/i, "");

  return base
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(
      /\b(dow|uap|fbi|nasa|dos|aaro|indopacom|centcom|afb|usper|pdf|na|cia)\b/gi,
      m => m.toUpperCase()
    )
    .replace(/\b\w/g, c => c.toUpperCase());
}

function inferLocationFromFilename(filename) {
  const missionMatch = filename.match(/mission-report-([^.]*)/i);

  if (missionMatch) {
    return missionMatch[1]
      .replace(/-(january|february|march|april|may|june|july|august|september|october|november|december|\d{4}|na|\d{1,2})\b.*$/i, "")
      .replace(/-/g, " ")
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim() || "N/A";
  }

  const rangeMatch = filename.match(/range-fouler-(?:debrief|reporting-form)-([^.]*)/i);

  if (rangeMatch) {
    return rangeMatch[1]
      .replace(/-(january|february|march|april|may|june|july|august|september|october|november|december|\d{4}|na|\d{1,2})\b.*$/i, "")
      .replace(/-/g, " ")
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim() || "N/A";
  }

  return "N/A";
}

function inferRecord(url) {
  const filename = decodeURIComponent(String(url || "").split("/").pop() || "").toLowerCase();
  const ext = (filename.split(".").pop() || "").toUpperCase();

  let title = cleanTitleFromUrl(url);
  let agency = "Unknown / Archive";
  let type = ext || "File";
  let location = "N/A";
  let rating = 2;
  let highlight = "Official WAR.gov UAP archive media file.";
  let release = inferRelease(url);

  const years = Array.from(new Set(filename.match(/(19\d{2}|20\d{2})/g) || []));
  let year = years.length ? years.sort().join("–") : "N/A";

  if (filename.startsWith("dow-uap")) {
    agency = "Department of War / Military";
    type = filename.includes("range-fouler")
      ? "Range Fouler Report"
      : "Mission / Military Report";
    location = inferLocationFromFilename(filename);
    rating = 3;
    highlight = "Military-origin UAP report, range-fouler debrief, launch summary, or correspondence.";

    if (
      filename.includes("indopacom") ||
      filename.includes("air-force") ||
      filename.includes("vandenberg")
    ) {
      rating = 4;
    }
  }

  if (filename.startsWith("nasa")) {
    agency = "NASA";
    type = filename.match(/\.(jpg|jpeg|png)$/i)
      ? "NASA Image"
      : "NASA Transcript / Debrief";
    location = "Space / Lunar Mission";
    rating = 3;
    highlight = "NASA mission transcript, debrief, or Apollo imagery.";
  }

  if (filename.startsWith("fbi-photo")) {
    agency = "FBI";
    type = filename.match(/\.(png|jpg|jpeg)$/i)
      ? "FBI Image"
      : "FBI Photo PDF";
    location = "Western United States / Redacted";
    rating = 2;
    highlight = "FBI photo/image item; useful as supporting media but often light on surrounding context.";
  }

  if (filename.startsWith("dos-uap")) {
    agency = "Department of State";
    type = "Diplomatic Cable";
    rating = 3;
    highlight = "Official State Department diplomatic cable.";

    if (filename.includes("papua")) {
      location = "Papua New Guinea";
    }

    if (filename.includes("kazakhstan")) {
      location = "Kazakhstan";
    }
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
    highlight =
      "Redacted witness statement referencing senior intelligence context, pilots, operations center, and FLIR/NVG observation.";
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

  if (filename.includes("composite-sketch")) {
    agency = "FBI / Witness Material";
    type = "Composite Sketch";
    rating = 3;
    highlight = "Composite sketch connected to witness/reporting material.";
  }

  if (filename.includes("serial-3") || filename.includes("serial-4")) {
    agency = "FBI / Redacted Serial";
    type = "FBI Redacted Serial";
    rating = 3;
    highlight = "Redacted FBI serial record tied to the UAP archive.";
  }

  if (/^(65_hs|18_|38_|59_|331_|341_|342_|255_)/.test(filename)) {
    agency =
      agency === "Unknown / Archive"
        ? "Historical Federal / Military Archive"
        : agency;
    type = type === ext ? "Historical Archive File" : type;
    rating = Math.min(rating, 2);
    highlight = "Historical federal/military archive record, case-file section, or study.";
  }

  return {
    title,
    url,
    agency,
    year,
    type,
    location,
    rating,
    highlight,
    release
  };
}

function getDocumentTypeLabel(row, url) {
  const documentType = pick(row, ["documentType", "Document Type", "Type"]);
  const fileType = pick(row, ["fileType", "File Type"]);

  const source = documentType || fileType || url;

  if (/video|mp4|mov|webm/i.test(source)) return "Video";
  if (/image|jpg|jpeg|png|gif|webp/i.test(source)) return "Image";
  if (/pdf/i.test(source)) return "PDF / Report";

  return source || "Record";
}

function recordFromCsvRow(row) {
  const title =
    pick(row, ["title", "Asset File Name", "assetFileName", "Record Title", "name"]) ||
    "Untitled UAP Record";

  const agency = pick(row, ["agency", "Agency"]) || "Unknown / Archive";
  const releaseDate = pick(row, ["releaseDate", "Release Date", "release"]);
  const incidentDate = pick(row, ["incidentDate", "Incident Date", "date", "Year"]);
  const incidentLocation = pick(row, ["incidentLocation", "Incident Location", "location"]);
  const documentType = pick(row, ["documentType", "Document Type"]);
  const fileType = pick(row, ["fileType", "File Type"]);
  const description = pick(row, ["description", "Description", "summary", "Highlight"]);
  const imageUrlRaw = pick(row, ["imageUrl", "Image URL", "image", "thumbnail"]);
  const videoUrlRaw = pick(row, ["videoUrl", "Video URL", "video"]);
  const downloadUrlRaw = pick(row, [
    "downloadUrl",
    "Download URL",
    "download",
    "Download",
    "url",
    "URL",
    "fileUrl",
    "File URL",
    "documentUrl",
    "Document URL",
    "mediaUrl",
    "Media URL"
  ]);

  const imageUrls = splitUrls(imageUrlRaw);
  const videoUrls = splitUrls(videoUrlRaw);
  const downloadUrl = absolutizeUrl(downloadUrlRaw);
  const imageUrl = imageUrls[0] || "";
  const videoUrl = videoUrls[0] || "";

  const url = downloadUrl || videoUrl || imageUrl;

  if (!url) {
    return null;
  }

  const inferred = inferRecord(url);
  const release = inferReleaseFromDate(releaseDate, url);
  const type = getDocumentTypeLabel(row, url);

  let rating = inferred.rating;

  if (/aaro/i.test(agency)) rating = Math.max(rating, 4);
  if (/department of war|dow|military|air force|army|navy|indopacom|centcom/i.test(agency)) rating = Math.max(rating, 3);
  if (/witness|statement|slide/i.test(title)) rating = Math.max(rating, 4);
  if (/western|usper/i.test(title)) rating = Math.max(rating, 5);

  return {
    title: title || inferred.title,
    url,
    agency,
    year: incidentDate || inferred.year,
    type,
    location: incidentLocation || inferred.location,
    rating,
    highlight: description || inferred.highlight,
    release,
    source: "WAR.gov CSV",
    imageUrl: imageUrl || undefined,
    videoUrl: videoUrl || undefined,
    fileType: fileType || undefined,
    documentType: documentType || undefined
  };
}

function normalizeExistingRecord(record) {
  const normalized = { ...record };

  if (!normalized.release) {
    normalized.release = inferRelease(normalized.url || "");
  }

  if (
    normalized.localPath &&
    normalized.localPath.toLowerCase().startsWith("media/pdf/")
  ) {
    delete normalized.localPath;
  }

  return normalized;
}

async function downloadImage(url, outputPath) {
  try {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const existing = await fs.stat(outputPath).catch(() => null);
    if (existing && existing.size > 0) {
      return outputPath;
    }

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Referer": SOURCE_URL
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(outputPath, buffer);

    const written = await fs.stat(outputPath);

    if (written.size > 10 * 1024 * 1024) {
      console.warn(`Skipping local image over 10MB: ${outputPath}`);
      await fs.rm(outputPath, { force: true });
      return null;
    }

    return outputPath;
  } catch (err) {
    console.warn(`Skipping image download: ${url}`);
    console.warn(err.message);
    return null;
  }
}

function getImagePath(url) {
  const fileName = decodeURIComponent(String(url).split("/").pop().split("?")[0]);
  return path.join("media", "images", fileName);
}

async function collectLinks(page) {
  return await page.evaluate(() => {
    const values = [];
    const attrs = ["href", "src"];

    for (const el of document.querySelectorAll("a, source, video, img")) {
      for (const attr of attrs) {
        const value = el.getAttribute(attr);
        if (value) {
          values.push(new URL(value, location.href).href);
        }
      }
    }

    const html = document.documentElement.innerHTML;
    const urlMatches = html.match(/https?:\/\/[^"'<> ]+/g) || [];
    values.push(...urlMatches);

    return Array.from(new Set(values))
      .filter(
        u =>
          /\/medialink\/ufo\/release_\d+\//i.test(u) ||
          /dvidshub\.net\/video\/\d+\/dow-uap/i.test(u) ||
          /cloudfront\.net/i.test(u)
      )
      .map(u => u.replace(/&amp;/g, "&"));
  });
}

async function getCsvUrl(page) {
  return await page.evaluate(fallbackCsvUrl => {
    const html = document.documentElement.innerHTML;

    const patterns = [
      /csvUrl\s*=\s*["']([^"']+)["']/i,
      /csvUrl&quot;\s*:\s*&quot;([^&]+)&quot;/i,
      /uap-data\.csv/i
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);

      if (match && match[1]) {
        return new URL(match[1], location.href).href;
      }
    }

    const directMatch = html.match(/\/Portals\/1\/Interactive\/2026\/UFO\/uap-data\.csv/i);

    if (directMatch) {
      return new URL(directMatch[0], location.href).href;
    }

    const csvLink = Array.from(document.querySelectorAll("a, link, script"))
      .map(el => el.getAttribute("href") || el.getAttribute("src") || "")
      .find(value => value && value.toLowerCase().includes("uap-data.csv"));

    if (csvLink) {
      return new URL(csvLink, location.href).href;
    }

    return fallbackCsvUrl;
  }, FALLBACK_CSV_URL);
}


async function fetchCsvRecords(page) {
  const csvUrl = await getCsvUrl(page);

  if (!csvUrl) {
    console.warn("No WAR.gov CSV URL found.");
    return [];
  }

  console.log(`CSV URL: ${csvUrl}`);

  const csvText = await page.evaluate(async url => {
    const response = await fetch(url, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`CSV fetch failed: HTTP ${response.status}`);
    }

    return await response.text();
  }, csvUrl);

  const rows = csvRowsToObjects(csvText);
  console.log(`CSV rows: ${rows.length}`);

  return rows
    .map(recordFromCsvRow)
    .filter(Boolean);
}

async function clickThroughPagination(page) {
  const allLinks = new Set();

  for (let i = 0; i < 40; i++) {
    const links = await collectLinks(page);
    links.forEach(link => allLinks.add(link));

    const clicked = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll("a, button")).filter(
        el => {
          const text = (el.textContent || "").trim().toLowerCase();
          const label = (el.getAttribute("aria-label") || "").toLowerCase();

          return (
            text === "next" ||
            text === ">" ||
            text === "»" ||
            label.includes("next")
          );
        }
      );

      const target = candidates.find(
        el => !el.disabled && el.getAttribute("aria-disabled") !== "true"
      );

      if (!target) {
        return false;
      }

      target.click();
      return true;
    });

    if (!clicked) {
      break;
    }

    await page.waitForTimeout(1500);
  }

  return Array.from(allLinks);
}

async function downloadImagesForRecords(records) {
  for (const record of records) {
    const imageCandidates = [
      record.imageUrl,
      record.url
    ].filter(Boolean);

    const imageUrl = imageCandidates.find(url => /\.(png|jpg|jpeg)(\?|$)/i.test(url));

    if (!imageUrl) {
      continue;
    }

    const localPath = getImagePath(imageUrl);
    const downloaded = await downloadImage(imageUrl, localPath);

    if (downloaded) {
      record.localPath = downloaded.replaceAll("\\", "/");
      console.log(`Downloaded image: ${record.localPath}`);
    }
  }
}

async function main() {
  const existingRecords = (await readExistingRecords()).map(normalizeExistingRecord);

  console.log(`Existing records: ${existingRecords.length}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: {
      width: 1440,
      height: 1800
    }
  });

  await page.goto(SOURCE_URL, {
    waitUntil: "networkidle",
    timeout: 120000
  });

  await page.waitForTimeout(3000);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1500);

  const csvRecords = await fetchCsvRecords(page);
  const pagedLinks = await clickThroughPagination(page);
  const finalLinks = await collectLinks(page);

  await browser.close();

  const links = Array.from(new Set([...pagedLinks, ...finalLinks]));

  console.log(`Scraped direct links: ${links.length}`);
  console.log(`CSV records: ${csvRecords.length}`);

  const recordsMap = new Map();

  for (const record of existingRecords) {
    if (record.url) {
      recordsMap.set(record.url, record);
    }
  }

  for (const record of csvRecords) {
    if (record.url) {
      recordsMap.set(record.url, {
        ...recordsMap.get(record.url),
        ...record
      });
    }
  }

  for (const url of links) {
    if (
      /\.(pdf|png|jpg|jpeg|mp4|mov|webm)(\?|$)/i.test(url) ||
      /dvidshub\.net\/video\//i.test(url) ||
      /cloudfront\.net/i.test(url)
    ) {
      const record = /dvidshub\.net\/video\//i.test(url)
        ? {
            title: cleanTitleFromUrl(url),
            url,
            agency: "Department of War / AARO",
            year: "N/A",
            type: "Video",
            location: "N/A",
            rating: 3,
            highlight: "Official DVIDS/WAR.gov-linked video record.",
            release: "Release 01"
          }
        : inferRecord(url);

      recordsMap.set(record.url, {
        ...recordsMap.get(record.url),
        ...record
      });
    }
  }

  for (const record of EXTRA_VIDEO_RECORDS) {
    recordsMap.set(record.url, {
      ...recordsMap.get(record.url),
      ...record
    });
  }

  let records = Array.from(recordsMap.values())
    .map(normalizeExistingRecord)
    .sort(
      (a, b) =>
        String(a.release).localeCompare(String(b.release)) ||
        Number(b.rating || 0) - Number(a.rating || 0) ||
        String(a.agency).localeCompare(String(b.agency)) ||
        String(a.title).localeCompare(String(b.title))
    );

  if (existingRecords.length > 0 && records.length < existingRecords.length) {
    console.warn(
      `Scrape built ${records.length} records, which is less than existing ${existingRecords.length}. Keeping existing data.`
    );

    records = existingRecords;
  }

  await downloadImagesForRecords(records);

  const imageBackedRecords = records.filter(record => record.localPath).length;
  const releases = Array.from(new Set(records.map(record => record.release || "Release 01"))).sort();

  console.log(`Built records: ${records.length}`);
  console.log(`Image-backed records: ${imageBackedRecords}`);
  console.log(`Releases: ${releases.join(", ")}`);

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceUrl: SOURCE_URL,
    count: records.length,
    releases,
    note:
      "Generated by GitHub Actions from the rendered WAR.gov UAP page and WAR.gov CSV data. Existing records are preserved if a scrape returns fewer records. Local copies are images only; PDFs and videos remain source links.",
    records
  };

  await fs.mkdir(path.dirname(OUT_FILE), {
    recursive: true
  });

  await fs.writeFile(
    OUT_FILE,
    JSON.stringify(payload, null, 2) + "\n",
    "utf8"
  );

  console.log(`Wrote ${records.length} records to ${OUT_FILE}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
