// Cleans the raw ESMA CASP register CSV into a tidy src/data/casps.json.
// Run: npm run data   (or: node scripts/clean-data.mjs)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { detectServices } from "../src/lib/services.js";
import { normalizeCountry } from "../src/lib/countries.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC_CSV = join(ROOT, "CASPS list.csv");
const OUT_JSON = join(ROOT, "src", "data", "casps.json");

// --- Minimal RFC 4180 CSV parser (handles quotes, escaped quotes, newlines) ---
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      // ignore, handled by \n
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// --- Fix the handful of corrupted (mojibake) characters in the source ---
const R = "�"; // replacement character
function fixEncoding(s) {
  if (!s) return s;
  return s
    .split(`Stra${R}e`).join("Straße")
    .split(`L${R}w`).join("Löw")
    .split(`${R}Kraken${R}`).join("“Kraken”")
    .split(R).join(""); // drop any remaining stray replacement chars
}

function clean(s) {
  if (s == null) return "";
  return fixEncoding(String(s))
    .replace(/\s+/g, " ")
    .trim();
}

// dd/mm/yyyy -> { raw, iso }
function parseDate(s) {
  const raw = clean(s);
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return { raw, iso: null };
  const [, d, mo, y] = m;
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return { raw, iso };
}

function parseCountries(s) {
  if (!s) return [];
  const tokens = s.split(/\||\sI\s|\/|,/g);
  const out = new Set();
  for (const t of tokens) {
    const cc = normalizeCountry(t);
    if (cc) out.add(cc);
  }
  return [...out].sort();
}

function slugify(s) {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Known-good websites for records whose ESMA row carries no usable URL in any
// column (the source put a page title there instead). Keyed by LEI for stability
// across data refreshes. Only add unambiguous, easily verified official sites.
const WEBSITE_BY_LEI = {
  "529900JB9XYZ8E87N345": "https://n26.com", // N26 Bank SE
  "851WYGNLUQLFZBSYGB56": "https://www.commerzbank.com", // Commerzbank AG
};

// Override the display name when the source commercial-name field is a junk list
// of brands/domains rather than a single brand. Keyed by LEI.
const NAME_BY_LEI = {
  // commercial name is "Change, Change Invest, getchange.com, ChangePro, ..."
  "7245009PUAT6U71IXZ51": "Change", // Change Securities B.V.
};

// Brand / "also known as" info for entities that hold the ESMA-registered CASP
// licence under one (legal) name but trade publicly under a parent-group brand.
// The licence belongs to the legal entity (`name`/`legalName`); `aka` is the brand
// it also operates under, surfaced so both names appear and are searchable. Keyed
// by LEI for stability across data refreshes. Only add when independently verified.
const BRAND_BY_LEI = {
  // PAYTOP SAS is the French CASP entity of the Triple-A group ("Triple-A EU").
  // Verified via Triple-A's own legal disclosure (triple-a.io) + AMF white list.
  "969500VA4A8CRCS2N988": {
    aka: "Triple-A",
    brandSite: "triple-a.io",
    // Rendered as raw HTML in the drawer (author-controlled, not user input), so the
    // two addresses are clickable. Keep links target=_blank rel="noopener nofollow".
    noteHtml:
      '<a href="https://www.triple-a.io/" target="_blank" rel="noopener nofollow">Triple-A (triple-a.io)</a> is the owner of <a href="https://www.paytop.com" target="_blank" rel="noopener nofollow">Paytop SAS (www.paytop.com)</a>, the legal entity that holds this CASP authorisation.',
  },
};

// Looks like a real web address (has a dot-separated host with a TLD).
const looksLikeDomain = (s) =>
  /^([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i.test(s) && !/^\d+(\.\d+)*$/.test(s);

function pickUrl(...candidates) {
  for (const raw of candidates) {
    // The source may pack several addresses on one line (newlines / "|" / spaces).
    const tokens = clean(raw)
      .replace(/https?\.\/\//gi, "https://") // fix "https.//" typo
      .split(/[\s|]+/)
      .filter(Boolean);
    for (const tok of tokens) {
      const stripped = tok.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
      if (looksLikeDomain(stripped)) {
        return /^https?:\/\//i.test(tok) ? `https://${stripped}` : `https://${stripped}`;
      }
    }
  }
  return "";
}

function normalizeWebsite(primary, secondary, lei) {
  // Prefer a real URL from the primary website column, then the platform column.
  let href = pickUrl(primary, secondary) || WEBSITE_BY_LEI[lei] || "";
  if (!href) return { display: "", href: "" };
  const display = href.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return { display, href };
}

// --- Main ---
const raw = readFileSync(SRC_CSV, "utf8").replace(/^﻿/, "");
const rows = parseCSV(raw);
const header = rows[0];
console.log(`Parsed ${rows.length - 1} raw rows, ${header.length} columns.`);

const usedSlugs = new Map();
function uniqueSlug(base, homeState) {
  let slug = base || "casp";
  if (usedSlugs.has(slug)) {
    const alt = `${base}-${(homeState || "").toLowerCase()}`;
    slug = usedSlugs.has(alt) ? `${alt}-${usedSlugs.get(slug) + 1}` : alt;
  }
  usedSlugs.set(base, (usedSlugs.get(base) || 0) + 1);
  if (usedSlugs.has(slug) && slug !== base) {
    usedSlugs.set(slug, (usedSlugs.get(slug) || 0) + 1);
  }
  return slug;
}

const parsed = [];
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  if (!r || r.every((c) => !clean(c))) continue;

  const lei = clean(r[3]);
  const legalName = clean(r[2]);
  const commercial = clean(r[5]);
  const name = NAME_BY_LEI[lei] || commercial || legalName;
  if (!name) continue;

  const homeState = normalizeCountry(r[1]) || clean(r[1]).toUpperCase();
  const website = normalizeWebsite(r[7], r[8], lei);
  const auth = parseDate(r[9]);
  const end = parseDate(r[10]);
  const update = parseDate(r[14]);
  const brand = BRAND_BY_LEI[lei];

  parsed.push({
    slug: null, // assigned after duplicate rows are merged
    name,
    legalName,
    ...(brand?.aka ? { aka: brand.aka } : {}),
    ...(brand?.brandSite ? { brandSite: brand.brandSite } : {}),
    ...(brand?.noteHtml ? { brandNoteHtml: brand.noteHtml } : {}),
    authority: clean(r[0]),
    homeState,
    lei,
    leiCountry: clean(r[4]).toUpperCase(),
    address: clean(r[6]),
    website: website.display,
    websiteHref: website.href,
    services: detectServices(r[11] || ""),
    countries: parseCountries(r[12] || ""),
    authDate: auth.iso,
    authDateRaw: auth.raw,
    endDate: end.iso,
    comments: clean(r[13]),
    lastUpdate: update.iso,
    lastUpdateRaw: update.raw,
  });
}

// --- Merge duplicate register rows for the SAME entity (same LEI + same legal
// name). ESMA lists a second row when an authorisation is extended with new
// services (DekaBank, EUWAX) or plain-duplicates a row (NAGA X). Keyed on LEI
// AND legal name: different companies that share an LEI by source error
// (APLO SAS / FLOWDESK EUROPE SAS) must stay separate entries.
const byEntity = new Map();
const items = [];
for (const it of parsed) {
  const key = it.lei ? `${it.lei}|${it.legalName.toLowerCase()}` : null;
  const prev = key ? byEntity.get(key) : null;
  if (!prev) {
    if (key) byEntity.set(key, it);
    items.push(it);
    continue;
  }
  prev.services = [...new Set([...prev.services, ...it.services])].sort();
  prev.countries = [...new Set([...prev.countries, ...it.countries])].sort();
  // First authorisation date, latest register update.
  if (it.authDate && (!prev.authDate || it.authDate < prev.authDate)) {
    prev.authDate = it.authDate;
    prev.authDateRaw = it.authDateRaw;
  }
  if (it.lastUpdate && (!prev.lastUpdate || it.lastUpdate > prev.lastUpdate)) {
    prev.lastUpdate = it.lastUpdate;
    prev.lastUpdateRaw = it.lastUpdateRaw;
  }
  // The entity stays active if ANY of its rows is still active (no end date).
  prev.endDate =
    prev.endDate && it.endDate
      ? (it.endDate > prev.endDate ? it.endDate : prev.endDate)
      : null;
  if (it.comments && !prev.comments.includes(it.comments)) {
    prev.comments = prev.comments ? `${prev.comments}; ${it.comments}` : it.comments;
  }
  for (const k of ["address", "website", "websiteHref", "leiCountry"]) {
    if (!prev[k] && it[k]) prev[k] = it[k];
  }
  console.log(`Merged duplicate register row: ${prev.legalName} (LEI ${prev.lei}).`);
}

// Slugs are assigned in source-row order (post-merge), so existing slugs of
// non-merged entries are unaffected.
for (const it of items) it.slug = uniqueSlug(slugify(it.name), it.homeState);

items.sort((a, b) => a.name.localeCompare(b.name, "en"));

const lastDataUpdate = items
  .map((i) => i.lastUpdate)
  .filter(Boolean)
  .sort()
  .at(-1);

const out = {
  generatedAt: new Date().toISOString(),
  source:
    "https://www.esma.europa.eu/esmas-activities/digital-finance-and-innovation/markets-crypto-assets-regulation-mica",
  lastDataUpdate,
  count: items.length,
  items,
};

writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
console.log(`Wrote ${items.length} CASPs -> ${OUT_JSON}`);
console.log(`Latest data update in source: ${lastDataUpdate}`);
const noServices = items.filter((i) => i.services.length === 0).length;
const noCountries = items.filter((i) => i.countries.length === 0).length;
console.log(`Records with no detected services: ${noServices}`);
console.log(`Records with no passporting countries: ${noCountries}`);
