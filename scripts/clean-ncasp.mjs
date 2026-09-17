// Cleans the ESMA NCASP register CSV (entities flagged by national competent
// authorities as providing crypto-asset services WITHOUT MiCA authorisation)
// into a tidy src/data/ncasps.json. This is the "other half" of the Interim
// MiCA Register, opposite of CASPS.csv which scripts/clean-data.mjs ingests.
// Run: npm run ncasp   (or: node scripts/clean-ncasp.mjs)
//
// Source of truth: "NCASP list.csv" (downloaded manually from
// https://www.esma.europa.eu/sites/default/files/2024-12/NCASP.csv), mirroring
// the local-file pattern of the CASP pipeline so the build stays offline.
//
// IMPORTANT: only a handful of NCAs contribute, so this is NOT a complete EU
// blacklist. Absence from it must never be presented as "compliant". WHICH
// regulators contribute is never written down by hand: it is derived from the
// rows into the `regulators` field below, and both the dataset `note` and the
// site copy read it from there. It was hardcoded as "CONSOB/IT, AFM/NL, NBS/SK
// only" until 2026-09-17, when Belgium's FSMA and the Czech National Bank filed
// their first entries and that sentence silently became false in the dataset
// itself and on two pages. We expose `domains` per row so provider pages can
// match a brand to a warning by EXACT domain (avoids false positives from scam
// clones such as "htxcoin-az.com" vs the real "htx.com").
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DATASET_ATTRIBUTION } from "../src/lib/provenance.js";
import { regulatorShort } from "../src/lib/regulator.js";
import { resolveLastChanged } from "./last-changed.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC_CSV = join(ROOT, "NCASP list.csv");
const OUT_JSON = join(ROOT, "src", "data", "ncasps.json");

// --- Minimal RFC 4180 CSV parser (same as clean-data.mjs) ---
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

function clean(s) {
  if (s == null) return "";
  return String(s).replace(/\s+/g, " ").trim();
}

// dd/mm/yyyy -> ISO (yyyy-mm-dd), or null
function parseDateIso(s) {
  const m = clean(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// Extract clean lowercased hostnames from the website field, which may pack
// several addresses separated by "|", spaces or newlines. Strips protocol,
// "www.", path and trailing slash. Used for exact-domain brand matching.
function extractDomains(s) {
  const out = new Set();
  for (const tok of clean(s).split(/[\s|]+/).filter(Boolean)) {
    const host = tok
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0]
      .toLowerCase()
      .trim();
    if (host && host.includes(".")) out.add(host);
  }
  return [...out];
}

// --- Main ---
const raw = readFileSync(SRC_CSV, "utf8").replace(/^﻿/, "");
const rows = parseCSV(raw);
const header = rows[0];
console.log(`Parsed ${rows.length - 1} raw rows, ${header.length} columns.`);

const items = [];
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  if (!r || r.every((c) => !clean(c))) continue;

  const commercialName = clean(r[5]) || clean(r[2]);
  if (!commercialName) continue;

  const reason = clean(r[8]);
  items.push({
    authority: clean(r[0]),
    homeState: clean(r[1]).toUpperCase(),
    leiName: clean(r[2]),
    commercialName,
    website: clean(r[6]),
    domains: extractDomains(r[6]),
    // "None" is the source's placeholder for "no reason text"; treat as empty.
    reason: reason && reason.toLowerCase() !== "none" ? reason : "",
    decisionDate: parseDateIso(r[9]),
    comments: clean(r[10]),
    lastUpdate: parseDateIso(r[11]),
  });
}

// Which regulators actually report to the register, derived from the rows and
// sorted by how many entries each one filed (name breaks ties, so the order is
// stable between runs). Single source of truth for the dataset note below and
// for every sentence on the site that names the contributors.
const byAuthority = new Map();
for (const it of items) {
  const cur = byAuthority.get(it.authority) || {
    authority: it.authority,
    short: regulatorShort(it.authority),
    homeState: it.homeState,
    count: 0,
  };
  cur.count++;
  byAuthority.set(it.authority, cur);
}
const regulators = [...byAuthority.values()].sort(
  (a, b) => b.count - a.count || a.short.localeCompare(b.short),
);

const body = {
  source: "https://www.esma.europa.eu/sites/default/files/2024-12/NCASP.csv",
  note: `Entities flagged by national competent authorities as providing crypto-asset services without MiCA authorisation. Only ${regulators.length} authorities have reported entries so far (${regulators.map((r) => `${r.short}/${r.homeState} ${r.count}`).join(", ")}), so this is NOT a complete EU blacklist: absence does not imply authorisation.`,
  attribution: DATASET_ATTRIBUTION,
  count: items.length,
  regulators,
  items,
};

// Seed = the last refresh that actually changed this register (164 -> 167 CONSOB
// entries). See scripts/last-changed.mjs.
const out = {
  generatedAt: new Date().toISOString(),
  lastChanged: resolveLastChanged(OUT_JSON, body, "2026-08-03"),
  ...body,
};

writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
console.log(`Wrote ${items.length} non-compliant entities -> ${OUT_JSON}`);
const withDomains = items.filter((i) => i.domains.length).length;
console.log(`Rows with at least one parseable domain: ${withDomains}`);
