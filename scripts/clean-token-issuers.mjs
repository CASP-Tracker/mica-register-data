// Cleans the ESMA interim MiCA registers of stablecoin issuers into tidy JSON:
//   "EMT list.csv" (EMTWP.csv, Title IV e-money token white papers)  -> src/data/emts.json
//   "ART list.csv" (ARTZZ.csv, Title III asset-referenced token issuers) -> src/data/arts.json
// Run: npm run tokens   (or: node scripts/clean-token-issuers.mjs)
//
// Sources of truth (downloaded manually, mirroring the CASPS/NCASP pattern so
// the build stays offline):
//   https://www.esma.europa.eu/sites/default/files/2024-12/EMTWP.csv
//   https://www.esma.europa.eu/sites/default/files/2024-12/ARTZZ.csv
//
// EMTWP is a register of WHITE PAPERS, not issuers: one row per notified white
// paper, so an issuer with several tokens (Quantoz, AllUnity, Circle...) appears
// several times. We merge rows by LEI + legal name (same key as the CASP merge
// in clean-data.mjs) into ONE issuer entry carrying all its white papers.
//
// The register has NO token-ticker column: tickers hide inconsistently in
// wp_comments ("EURAU") or in white-paper URLs. TOKENS_BY_LEI below is a
// hand-verified map of the tokens each issuer actually notified; issuers absent
// from the map render without ticker chips (never guess a ticker).
//
// ARTZZ has been EMPTY since launch (zero ART issuers authorised in the EU);
// the parser still handles rows so the page auto-populates if that changes.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DATASET_ATTRIBUTION, ctId } from "../src/lib/provenance.js";
import { resolveLastChanged } from "./last-changed.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const EMT_CSV = join(ROOT, "EMT list.csv");
const ART_CSV = join(ROOT, "ART list.csv");
const CASPS_JSON = join(ROOT, "src", "data", "casps.json");
const OUT_EMT = join(ROOT, "src", "data", "emts.json");
const OUT_ART = join(ROOT, "src", "data", "arts.json");

// Hand-verified token tickers per issuer LEI (see header note). Update when a
// new issuer/token lands in the register; leave an issuer out if unsure.
const TOKENS_BY_LEI = {
  "969500OYUDADGZKCR583": ["USDC", "EURC"], // Circle Internet Financial Europe SAS
  "969500FX8K40ZDW4F377": ["EURCV", "USDCV"], // Société Générale - Forge
  "743700KYSSTKZYGEUF50": ["USDG", "EUROe", "eUSD"], // Paxos Issuance Europe Oy (ex Membrane Finance)
  "2549003QDNZWASSSCY31": ["EURe"], // Monerium ehf
  "7245008P1HPUPVM7XL94": ["EURQ", "USDQ", "EURD", "PLNQ", "GBPQ", "RONQ"], // Quantoz Payments B.V.
  "984500AA0OCA9CE0D796": ["EURR", "USDR"], // StablR Ltd
  "213800W1NGBLERUS6M39": ["EURI"], // Banking Circle S.A. (Eurite)
  "3912007G8L8CD3HFIV26": ["EURAU", "CHFAU", "SEKAU"], // AllUnity GmbH
  "724500GVWT7QULV8CR59": ["ENEUR", "ENGBP", "ENUSD"], // Fiat Republic Netherlands
  "9695002I9DJHZ3449O66": ["EUROD"], // Oddo BHF SCA
  "969500SGAEBRXYUAJ739": ["EURØP"], // SALVUS (Schuman Financial)
  "875500AX7AO0XVYSQD64": ["EURW"], // Newrails, UAB
};

// Nicer display names where the source's commercial_name is empty or awkward.
const DISPLAY_BY_LEI = {
  "969500OYUDADGZKCR583": "Circle",
  "969500FX8K40ZDW4F377": "Société Générale Forge",
  "969500SGAEBRXYUAJ739": "Schuman Financial (SALVUS)",
};

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

// Normalise the website field into a clickable href + a short display label.
function pickUrl(raw) {
  let s = clean(raw).split(/[\s|]+/)[0] || "";
  if (!s) return { href: "", label: "" };
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!u.hostname.includes(".")) return { href: "", label: "" };
    const label = u.hostname.replace(/^www\./i, "");
    return { href: u.href, label };
  } catch {
    return { href: "", label: "" };
  }
}

const minDate = (a, b) => (!a ? b : !b ? a : a < b ? a : b);
const maxDate = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

// Split a pipe/space-separated code list (DTI columns) into unique clean codes.
function splitCodes(raw) {
  return [
    ...new Set(
      clean(raw)
        .split(/[|\s]+/)
        .map((c) => c.trim())
        .filter((c) => /^[A-Z0-9]{6,12}$/i.test(c)),
    ),
  ];
}

// A white paper row comment is worth showing (it usually names the token, e.g.
// "EURAU", "EURQ white paper") unless it is empty, boilerplate ("No comment...")
// or a long free-text explanation.
function wpNote(raw) {
  const s = clean(raw);
  if (!s || /^no comment/i.test(s) || s.length > 64) return "";
  return s;
}

// --- casps.json join (LEI -> slug) so the page can cross-link the directory ---
const casps = JSON.parse(readFileSync(CASPS_JSON, "utf8"));
const caspByLei = new Map();
for (const c of casps.items) if (c.lei) caspByLei.set(c.lei, c);

// --- EMT register ---
const emtRows = parseCSV(readFileSync(EMT_CSV, "utf8").replace(/^﻿/, ""));
console.log(`EMT: parsed ${emtRows.length - 1} raw rows.`);

const emtByKey = new Map();
let wpCount = 0;
for (let i = 1; i < emtRows.length; i++) {
  const r = emtRows[i];
  if (!r || r.length < 19 || r.every((c) => !clean(c))) continue;
  const lei = clean(r[3]);
  const leiName = clean(r[2]);
  if (!leiName) continue;
  wpCount++;

  const key = `${lei}|${leiName}`;
  let e = emtByKey.get(key);
  if (!e) {
    const { href, label } = pickUrl(r[7]);
    e = {
      lei,
      leiName,
      name: DISPLAY_BY_LEI[lei] || clean(r[5]) || leiName,
      homeState: clean(r[1]).toUpperCase(),
      authority: clean(r[0]),
      address: clean(r[6]),
      website: label,
      websiteHref: href,
      // "Credit institution" (bank) vs e-money institution (source col 12).
      type: /credit/i.test(clean(r[12])) ? "credit" : "emi",
      // Art. 48(4)/48(5) exemptions (e.g. limited-network tokens not offered
      // to the general public). Kept separately for the drawer; `exempt` is
      // the merged flag the table's tag uses.
      ex484: /^yes$/i.test(clean(r[10])),
      ex485: /^yes$/i.test(clean(r[11])),
      exempt: /^yes$/i.test(clean(r[10])) || /^yes$/i.test(clean(r[11])),
      tokens: TOKENS_BY_LEI[lei] || [],
      // Date the ENTITY got its underlying EMI/banking authorisation (can far
      // predate MiCA, e.g. CACEIS 1979); label it as the licence date, never
      // as "issuing since".
      entityAuthDate: null,
      firstWpDate: null,
      lastUpdate: null,
      whitepapers: [],
      dti: [],
      dtiFfg: [],
      caspSlug: caspByLei.get(lei)?.slug || null,
      caspWebsite: caspByLei.get(lei)?.website || "",
    };
    emtByKey.set(key, e);
  }
  e.entityAuthDate = minDate(e.entityAuthDate, parseDateIso(r[8]));
  const wpDate = parseDateIso(r[16]);
  e.firstWpDate = minDate(e.firstWpDate, wpDate);
  e.lastUpdate = maxDate(e.lastUpdate, parseDateIso(r[18]));
  // ISO 24165 Digital Token Identifiers: per-chain token codes (col 14) and
  // functionally-fungible-group codes (col 13), pipe-separated in the source.
  e.dtiFfg = [...new Set([...e.dtiFfg, ...splitCodes(r[13])])];
  e.dti = [...new Set([...e.dti, ...splitCodes(r[14])])];
  const wpUrl = clean(r[15]);
  if (wpUrl && /^https?:\/\//i.test(wpUrl)) {
    let note = wpNote(r[17]);
    // No usable comment? If the URL itself names one of the issuer's verified
    // tickers (e.g. circle.com/.../mica-eurc-whitepaper), label the white
    // paper with that ticker. Only fires for TOKENS_BY_LEI tickers, so it
    // never invents a symbol.
    if (!note) {
      const hit = (TOKENS_BY_LEI[lei] || []).find((tok) =>
        wpUrl.toLowerCase().includes(tok.toLowerCase()),
      );
      if (hit) note = hit;
    }
    // Note is part of the dedupe key: issuers like Quantoz notify several
    // tokens under ONE url + date, distinguished only by the comment.
    if (
      !e.whitepapers.some(
        (w) => w.url === wpUrl && w.date === wpDate && w.note === note,
      )
    )
      e.whitepapers.push({ url: wpUrl, date: wpDate, note });
  }
}

const emtItems = [...emtByKey.values()].sort(
  (a, b) =>
    (a.firstWpDate || "9999").localeCompare(b.firstWpDate || "9999") ||
    a.name.localeCompare(b.name),
);

// Per-record provenance key, derived from the issuer's (stable) LEI so it
// survives refreshes and re-sorts. See ctId() in src/lib/provenance.js.
for (const it of emtItems) it.ctId = ctId(it.lei);

const emtBody = {
  source: "https://www.esma.europa.eu/sites/default/files/2024-12/EMTWP.csv",
  note: "Issuers of e-money tokens (EMT) under MiCA Title IV, merged from ESMA's interim register of EMT white papers (one source row per white paper). Tickers come from the hand-verified TOKENS_BY_LEI map in scripts/clean-token-issuers.mjs, not from the source file.",
  attribution: DATASET_ATTRIBUTION,
  count: emtItems.length,
  wpCount,
  countries: [...new Set(emtItems.map((e) => e.homeState))].length,
  items: emtItems,
};
// Seed = the last refresh that actually changed this register (22 -> 23 issuers,
// Bridge Building S.A.). See scripts/last-changed.mjs.
const emtOut = {
  generatedAt: new Date().toISOString(),
  lastChanged: resolveLastChanged(OUT_EMT, emtBody, "2026-08-12"),
  ...emtBody,
};
writeFileSync(OUT_EMT, JSON.stringify(emtOut, null, 2), "utf8");
console.log(
  `Wrote ${emtItems.length} EMT issuers (${wpCount} white papers, ${emtOut.countries} countries) -> ${OUT_EMT}`,
);
const alsoCasp = emtItems.filter((e) => e.caspSlug).length;
console.log(`EMT issuers that are also licensed CASPs: ${alsoCasp}`);

// --- ART register (empty so far; keep the shape ready for the first entry) ---
const artRows = parseCSV(readFileSync(ART_CSV, "utf8").replace(/^﻿/, ""));
const artByKey = new Map();
for (let i = 1; i < artRows.length; i++) {
  const r = artRows[i];
  if (!r || r.length < 16 || r.every((c) => !clean(c))) continue;
  const lei = clean(r[3]);
  const leiName = clean(r[2]);
  if (!leiName) continue;

  const key = `${lei}|${leiName}`;
  let e = artByKey.get(key);
  if (!e) {
    const { href, label } = pickUrl(r[7]);
    e = {
      lei,
      leiName,
      name: clean(r[5]) || leiName,
      homeState: clean(r[1]).toUpperCase(),
      authority: clean(r[0]),
      website: label,
      websiteHref: href,
      creditInstitution: /^yes$/i.test(clean(r[10])),
      authDate: null,
      whitepapers: [],
    };
    artByKey.set(key, e);
  }
  e.authDate = minDate(e.authDate, parseDateIso(r[8]));
  const wpUrl = clean(r[11]);
  const wpDate = parseDateIso(r[12]);
  if (wpUrl && /^https?:\/\//i.test(wpUrl)) {
    if (!e.whitepapers.some((w) => w.url === wpUrl && w.date === wpDate))
      e.whitepapers.push({ url: wpUrl, date: wpDate });
  }
}

const artItems = [...artByKey.values()].sort(
  (a, b) =>
    (a.authDate || "9999").localeCompare(b.authDate || "9999") ||
    a.name.localeCompare(b.name),
);
const artBody = {
  source: "https://www.esma.europa.eu/sites/default/files/2024-12/ARTZZ.csv",
  note: "Issuers of asset-referenced tokens (ART) under MiCA Title III from ESMA's interim register. The register has been empty since launch: no ART issuer has been authorised in the EU yet.",
  attribution: DATASET_ATTRIBUTION,
  count: artItems.length,
  items: artItems,
};
// Seed = when this dataset was first generated. The ART register has never held a
// single entry, so its content has genuinely never changed and its dateModified
// must NOT creep forward on every sync. See scripts/last-changed.mjs.
const artOut = {
  generatedAt: new Date().toISOString(),
  lastChanged: resolveLastChanged(OUT_ART, artBody, "2026-07-08"),
  ...artBody,
};
writeFileSync(OUT_ART, JSON.stringify(artOut, null, 2), "utf8");
console.log(`Wrote ${artItems.length} ART issuers -> ${OUT_ART}`);
