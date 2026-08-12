// One-off / re-runnable: pulls each country's OWN regulator-assigned MiCA
// reference number (the third identifier alongside LEI and the GLEIF company
// register number, see NCA_NUMBER_POLICY in clean-data.mjs) from every
// national source confirmed BULK-FETCHABLE during the 2026-08-12 research
// (casp-license-numbers-research memory): NL (AFM XLSX), FR (AMF CSV via
// data.gouv.fr), LU (CSSF JSON API), HR (HANFA XML export), DK (Finanstilsynet
// two-step search+detail API). Every match is joined to our own casps.json by
// LEI, so it is unambiguous and never depends on fuzzy name matching.
//
// This does NOT write to casps.json or any data file directly - regulatory
// reference numbers are the kind of fact worth a human/agent look before they
// go live (the 2026-08-12 session already found one real gotcha this way: a
// column that LOOKED like a withdrawal-date flag in the AFM sheet turned out
// to be unrelated small reference numbers, not dates). Instead it prints,
// grouped by source, only the NEW additions and any VALUE MISMATCHES against
// what's already hardcoded in NCA_NUMBER_BY_LEI/NCA_NUMBER_BY_SLUG - ready to
// copy-paste into clean-data.mjs after a quick sanity check.
//
// Run after an ESMA data refresh (`npm run data` first, so casps.json is
// current), whenever it adds a NEW entity in NL/FR/LU/HR/DK specifically:
//   node scripts/fetch-nca-numbers.mjs   (or: npm run nca-numbers)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import zlib from "node:zlib";
import {
  NCA_NUMBER_BY_LEI,
  NCA_NUMBER_BY_SLUG,
  COMPANY_REGISTER_BY_SLUG,
} from "./clean-data.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const casps = JSON.parse(
  readFileSync(join(ROOT, "src", "data", "casps.json"), "utf8"),
).items;
const byLei = new Map(casps.map((c) => [c.lei, c]));
const currentNumber = (c) => NCA_NUMBER_BY_SLUG[c.slug] || NCA_NUMBER_BY_LEI[c.lei] || null;

async function getBuf(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
async function getText(url) {
  return (await getBuf(url)).toString("utf8");
}

// --- report helper: compares a {lei, number, name}[] list against what's
// already on file and prints only what changed. ---
const report = { new: [], changed: [] };
function record(source, lei, number, label) {
  const c = byLei.get(lei);
  if (!c) return; // no matching CASP in our data (e.g. very recent listing, or a passported-in entity)
  const have = currentNumber(c);
  if (have === number) return; // already correct, nothing to do
  const line = `  "${lei}": "${number}", // ${c.legalName}`;
  if (have == null) report.new.push({ source, line, slug: c.slug });
  else
    report.changed.push({
      source,
      slug: c.slug,
      legalName: c.legalName,
      lei,
      have,
      fetched: number,
    });
}

// ---------- Minimal dependency-free XLSX reader (ZIP + zlib), for NL's AFM
// register only. Kept inline: single caller, not worth a shared module yet. ----------
function readXlsxFirstSheet(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a valid XLSX (EOCD not found)");
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const cdCount = buf.readUInt16LE(eocd + 10);
  const entries = {};
  let p = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries[name] = { method, compSize, localOffset };
    p += 46 + nameLen + extraLen + commentLen;
  }
  function extract(name) {
    const e = entries[name];
    if (!e) return null;
    const lp = e.localOffset;
    const lNameLen = buf.readUInt16LE(lp + 26);
    const lExtraLen = buf.readUInt16LE(lp + 28);
    const dataStart = lp + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + e.compSize);
    return e.method === 0 ? raw : zlib.inflateRawSync(raw);
  }
  const decodeEnt = (s) =>
    s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
      .replace(/&amp;/g, "&");
  const sharedStrings = [];
  const ssXml = extract("xl/sharedStrings.xml")?.toString("utf8");
  if (ssXml) {
    for (const m of ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const texts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]);
      sharedStrings.push(decodeEnt(texts.join("")));
    }
  }
  const sheetName =
    Object.keys(entries).find((n) => /^xl\/worksheets\/sheet1\.xml$/.test(n)) ||
    Object.keys(entries).find((n) => /^xl\/worksheets\/.*\.xml$/.test(n));
  const sheetXml = extract(sheetName).toString("utf8");
  const rows = [];
  for (const rowM of sheetXml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cellM of rowM[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
      const [, colLetters, attrs, body] = cellM;
      const col = colLetters.split("").reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
      const type = (attrs.match(/t="([^"]+)"/) || [])[1];
      const v = body.match(/<v>([\s\S]*?)<\/v>/);
      let value = "";
      if (type === "s" && v) value = sharedStrings[+v[1]] ?? "";
      else if (v) value = decodeEnt(v[1]);
      cells[col - 1] = value;
    }
    rows.push(cells);
  }
  return rows;
}

// ---------- NL: AFM register-cryptopartijen.xlsx ----------
async function fetchNL() {
  const buf = await getBuf(
    "https://www.afm.nl/~/profmedia/files/registers/register-cryptopartijen.xlsx",
  );
  const rows = readXlsxFirstSheet(buf);
  // header is row index 5 (0-based); data starts at 6. Columns (0-based):
  // 0 name, 1 AFM number, 9 LEI. (A "date of withdrawal"-labelled column at
  // index 5 turned out NOT to hold real dates - small unrelated reference
  // numbers instead - so it is deliberately NOT used as an active/withdrawn
  // filter; the LEI-join against our own already-active casps.json does that
  // filtering implicitly.)
  for (const r of rows.slice(6)) {
    if (!r || !r[0]) continue;
    const no = r[1],
      lei = r[9];
    if (!lei || !no || no === "N/A") continue;
    const c = byLei.get(lei);
    if (c && c.homeState === "NL") record("NL/AFM", lei, no);
  }
}

// ---------- FR: AMF white list CSV (data.gouv.fr) ----------
async function fetchFR() {
  let text = await getText(
    "https://www.data.gouv.fr/api/1/datasets/r/e03f8899-2499-4826-aaae-6842f520bdac",
  );
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter(Boolean);
  function parseLine(line) {
    const out = [];
    let cur = "",
      inQ = false;
    for (const c of line) {
      if (c === '"') inQ = !inQ;
      else if (c === ";" && !inQ) {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
    out.push(cur);
    return out;
  }
  const seen = new Map();
  for (const r of lines.slice(1).map(parseLine)) {
    const [no_amf, , , , , , , , lei, , , , , statut] = r;
    if (statut !== "Agréé" || !lei || no_amf.includes("Passeport")) continue;
    seen.set(lei, no_amf);
  }
  for (const [lei, no] of seen) {
    const c = byLei.get(lei);
    if (c && c.homeState === "FR") record("FR/AMF", lei, no);
  }
}

// ---------- LU: CSSF Search Entities API (full CASP list in one call) ----------
async function fetchLU() {
  const json = JSON.parse(
    await getText(
      "https://edesk.apps.cssf.lu/search-entities-api/api/v1/entite?page=0&size=200&entType=CASP",
    ),
  );
  const rows = json?.content || json?.data || (Array.isArray(json) ? json : []);
  for (const r of rows) {
    const lei = r.leiCode || r.lei;
    const no = r.entiteCode;
    if (!lei || !no) continue;
    const c = byLei.get(lei);
    if (c && c.homeState === "LU") record("LU/CSSF", lei, no);
  }
}

// ---------- HR: HANFA register XML export ----------
async function fetchHR() {
  const xml = await getText(
    "https://www.hanfa.hr/registri/trziste-kriptoimovine/registar-drustava-ovlastenih-pruzati-usluge-povezane-s-kriptoimovinom/?export=xml",
  );
  for (const rowM of xml.matchAll(/<Row>([\s\S]*?)<\/Row>/g)) {
    const body = rowM[1];
    const id = (body.match(/<ID>([\s\S]*?)<\/ID>/) || [])[1];
    const lei = (body.match(/<LEI>([\s\S]*?)<\/LEI>/) || [])[1];
    if (!id || !lei) continue;
    const c = byLei.get(lei);
    if (c && c.homeState === "HR") record("HR/HANFA", lei, `R${id}`);
  }
}

// ---------- DK: Finanstilsynet two-step search+detail API, per DK entity ----------
async function fetchDK() {
  const dkEntities = casps.filter((c) => c.homeState === "DK");
  for (const c of dkEntities) {
    if (currentNumber(c)) continue; // already have a number, skip the lookup
    const searchUrl =
      "https://virksomhedsregister.finanstilsynet.dk/VUTService/VirksomhederUnderTilsynService.svc/SearchVUT?v=" +
      encodeURIComponent(c.legalName);
    let hits;
    try {
      hits = JSON.parse(JSON.parse(await getText(searchUrl)).SearchVUTResult);
    } catch {
      continue;
    }
    for (const hit of hits) {
      const detailUrl =
        "https://virksomhedsregister.finanstilsynet.dk/VUTService/VirksomhederUnderTilsynService.svc/HentVirksomhedsinformation?v=" +
        hit.GUID;
      let info;
      try {
        info = JSON.parse(JSON.parse(await getText(detailUrl)).HentVirksomhedsinformationResult)[0]
          ?.Basisinformation?.[0];
      } catch {
        continue;
      }
      // A company can have multiple FT registrations (e.g. an older AML/
      // currency-exchange one); only trust the one tagged as the crypto area.
      if (info?.Område === "Kryptoområdet" && info?.FTID) {
        record("DK/Finanstilsynet", c.lei, info.FTID);
        break;
      }
    }
  }
}

console.log("Fetching NL/AFM, FR/AMF, LU/CSSF, HR/HANFA (bulk), DK/Finanstilsynet (per-entity)...\n");
const results = await Promise.allSettled([fetchNL(), fetchFR(), fetchLU(), fetchHR(), fetchDK()]);
const labels = ["NL/AFM", "FR/AMF", "LU/CSSF", "HR/HANFA", "DK/Finanstilsynet"];
results.forEach((r, i) => {
  if (r.status === "rejected") console.error(`${labels[i]} FAILED: ${r.reason?.message || r.reason}`);
});

if (report.new.length === 0 && report.changed.length === 0) {
  console.log("Nothing new - NCA_NUMBER_BY_LEI already covers every matched entity across all 5 sources.");
} else {
  if (report.new.length) {
    console.log(`--- ${report.new.length} NEW entries (paste into NCA_NUMBER_BY_LEI, in the right country block) ---`);
    for (const src of labels) {
      const rows = report.new.filter((r) => r.source === src);
      if (!rows.length) continue;
      console.log(`  // ${src}`);
      rows.forEach((r) => console.log(r.line));
    }
  }
  if (report.changed.length) {
    console.log(`\n--- ${report.changed.length} VALUE MISMATCH(es) - review before changing anything ---`);
    report.changed.forEach((r) =>
      console.log(`  ${r.slug} (${r.legalName}): have "${r.have}", source now says "${r.fetched}"`),
    );
  }
}
