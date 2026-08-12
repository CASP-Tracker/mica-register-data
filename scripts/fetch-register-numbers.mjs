// One-off: enriches every CASP with its NATIONAL COMPANY REGISTER number (e.g.
// Austrian Firmenbuch "FN 636180i", Dutch KvK "95206604") pulled from GLEIF's
// public LEI reference data. This is a DIFFERENT number from both the LEI
// (global entity ID) and any national-REGULATOR reference number (see
// NCA_NUMBER_BY_LEI in clean-data.mjs): it identifies the company in its home
// country's commercial register, not the MiCA authorisation itself.
//
// GLEIF stores this in every LEI record as entity.registeredAs, plus a
// registration-authority (RA) code naming the register itself (e.g. RA000017 =
// Austria's Firmenbuch). Free, no API key, https://api.gleif.org.
//
// Run: node scripts/fetch-register-numbers.mjs  (or: npm run register-numbers)
// Re-run after a data refresh so newly added CASPs get resolved too (the full
// run is cheap: ~60 GLEIF requests total, well under its 60/min limit).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CASPS = JSON.parse(
  readFileSync(join(ROOT, "src", "data", "casps.json"), "utf8"),
);
const OUT = join(ROOT, "src", "data", "register-numbers.json");

const API = "https://api.gleif.org/api/v1";
const LEI_RE = /^[A-Z0-9]{20}$/;

async function getJson(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.api+json" },
  });
  if (!res.ok) return null;
  return res.json();
}

// GLEIF caps filter[lei] batches; chunk conservatively.
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function extractRegisteredAs(record) {
  const entity = record?.attributes?.entity;
  if (!entity) return null;
  const number = entity.registeredAs;
  const raCode = entity.registeredAt?.id;
  if (!number || !raCode) return null;
  return { number, raCode, status: entity.status };
}

// A RETIRED/inactive LEI record may point at the entity's live successor
// (e.g. Bitpanda GmbH's original LEI was retired and replaced); follow ONE
// hop so we resolve the CURRENT register number, not a stale one.
function successorLei(record) {
  return (
    record?.attributes?.entity?.successorEntity?.lei ||
    record?.relationships?.["successor-entity"]?.data?.id ||
    null
  );
}

// No incremental cache: the whole run is ~60 requests (2 LEI batches + one
// registration-authority lookup per unique register, well under GLEIF's
// 60/min limit), so it's cheap enough to always refetch clean rather than
// juggle a persisted intermediate shape.
const leis = [
  ...new Set(
    CASPS.items.map((c) => (c.lei || "").toUpperCase()).filter((lei) => LEI_RE.test(lei)),
  ),
];
console.log(`${leis.length} well-formed LEIs in casps.json to fetch`);

const byLei = {};
let resolved = 0,
  retired = 0,
  missing = 0;

for (const batch of chunk(leis, 190)) {
  const url = `${API}/lei-records?filter[lei]=${batch.join(",")}&page[size]=200`;
  const json = await getJson(url);
  const records = json?.data || [];
  const byLeiInBatch = new Map(records.map((r) => [r.attributes.lei, r]));

  for (const lei of batch) {
    let record = byLeiInBatch.get(lei);
    if (!record) {
      missing++;
      continue;
    }
    let info = extractRegisteredAs(record);
    if (info && info.status !== "ACTIVE") {
      const succLei = successorLei(record);
      if (succLei) {
        const succJson = await getJson(`${API}/lei-records/${succLei}`);
        const succRecord = succJson?.data;
        const succInfo = succRecord && extractRegisteredAs(succRecord);
        if (succInfo) {
          info = succInfo;
          retired++;
        }
      }
    }
    if (info) {
      byLei[lei] = { number: info.number, raCode: info.raCode };
      resolved++;
    } else {
      missing++;
    }
  }
}

// Resolve each unique RA (registration authority) code to a human register name.
// GLEIF's localName for Belgium's tri-lingual register is a run-on compound
// ("in Dutch: ...; in French: ...; in German: ...") that reads badly as a UI
// label; use its own English name for the local slot instead.
const LOCAL_NAME_OVERRIDE = { RA000025: "Crossroad Bank of Enterprises" };
const raCodes = [...new Set(Object.values(byLei).map((v) => v.raCode))];
const raNames = {};
for (const ra of raCodes) {
  const json = await getJson(`${API}/registration-authorities/${ra}`);
  const attrs = json?.data?.attributes;
  raNames[ra] = attrs
    ? {
        international: attrs.internationalName || null,
        local: LOCAL_NAME_OVERRIDE[ra] || attrs.localName || null,
        jurisdiction: attrs.jurisdictions?.[0]?.countryCode || null,
      }
    : null;
  console.log(`  ${ra} -> ${attrs?.localName || "?"} (${attrs?.internationalName || "?"})`);
}

const out = {};
for (const [lei, { number, raCode }] of Object.entries(byLei)) {
  const ra = raNames[raCode];
  const local = ra?.local;
  const intl = ra?.international;
  // Some of GLEIF's own internationalName values already embed the local
  // name in parens (e.g. France's "Register of Companies (Sirene)"); appending
  // "(Sirene)" again would double it up, so detect that case first.
  const registerName =
    !local || !intl
      ? local || intl || raCode
      : intl.includes(local) || local === intl
        ? intl
        : `${intl} (${local})`;
  out[lei] = { number, registerName, jurisdiction: ra?.jurisdiction || null };
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n", "utf8");
console.log(
  `Resolved ${resolved} (incl. ${retired} via a retired->successor LEI hop), ${missing} not found in GLEIF.`,
);
console.log(`Manifest: ${Object.keys(out).length} LEIs -> src/data/register-numbers.json`);
