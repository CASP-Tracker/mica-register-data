// Builds the public log of defects CASP Tracker found in ESMA's MiCA register
// files: src/data/corrections.json (the dataset the site and the data repo
// publish) and, with --md <path>, the readable CORRECTIONS.md for the data repo.
//
// The curated entries live in src/data/source-corrections.json (hand-edited:
// what ESMA printed, what we publish, the evidence, and the dates). This script
// adds what must never be typed by hand:
//   - `status`: every entry carries a `check` that is run against the CURRENT
//     ESMA files on each build, so "ESMA still has it" or "ESMA fixed it" is
//     computed, not remembered. An entry whose defect disappeared without an
//     `esmaFixed` date is reported loudly, so a go1 run that finds ESMA fixed
//     something tells you to record when.
//   - `leadDays`: how many days our fix was public (first commit of the data
//     repository that carries it) before ESMA's own file stopped carrying the
//     defect, as a range, because ESMA's fix is only known to fall between two
//     of our downloads.
//   - the lists of entities for entries that cover a changing set of rows
//     (`listFromCheck`, e.g. every LEI that fails its check digits today).
// It also cross-checks the overrides in scripts/clean-data.mjs and
// scripts/clean-token-issuers.mjs: every LEI an override touches must belong to
// a log entry or be explained in `notCorrections`, otherwise the build stops,
// so a correction can never ship without being logged.
//
//   node scripts/build-corrections.mjs                    (npm run corrections)
//   node scripts/build-corrections.mjs --md <path>        also write CORRECTIONS.md
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DATASET_ATTRIBUTION, DATA_REPO_URL } from "../src/lib/provenance.js";
import { DATA_LAST_SYNCED } from "../src/lib/site.js";
import { resolveLastChanged } from "./last-changed.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CURATED = join(ROOT, "src", "data", "source-corrections.json");
const OUT_JSON = join(ROOT, "src", "data", "corrections.json");
const FILES = {
  CASPS: { path: "CASPS list.csv", url: "https://www.esma.europa.eu/sites/default/files/2024-12/CASPS.csv" },
  NCASP: { path: "NCASP list.csv", url: "https://www.esma.europa.eu/sites/default/files/2024-12/NCASP.csv" },
  EMTWP: { path: "EMT list.csv", url: "https://www.esma.europa.eu/sites/default/files/2024-12/EMTWP.csv" },
};
const COMMIT_URL = (h) => `${DATA_REPO_URL.replace(/\/$/, "")}/commit/${h}`;

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
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      // handled by \n
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

const one = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const source = {};
for (const [key, f] of Object.entries(FILES)) {
  const text = readFileSync(join(ROOT, f.path), "utf8").replace(/^﻿/, "");
  source[key] = { text, rows: parseCSV(text).slice(1).filter((r) => r.length > 3 && r.some((c) => one(c))) };
}

// ISO 17442: 18 alphanumerics + 2 check digits, ISO 7064 MOD 97-10 over the
// whole code (letters A=10 .. Z=35) must leave 1.
function leiValid(lei) {
  if (!/^[A-Z0-9]{18}[0-9]{2}$/.test(lei)) return false;
  let m = 0;
  for (const ch of lei) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) m = (m * 10 + Number(d)) % 97;
  }
  return m === 1;
}

const rowName = (r) => one(r[5]) || one(r[2]);
function runCheck(check) {
  const src = source[check.file];
  if (!src) throw new Error(`Unknown file in check: ${check.file}`);
  if (check.contains !== undefined) return { present: src.text.includes(check.contains), matches: [] };
  if (check.special === "invalidLei") {
    const matches = src.rows
      .filter((r) => one(r[3]) && !leiValid(one(r[3])))
      .map((r) => ({ name: one(r[2]), lei: one(r[3]) }));
    return { present: matches.length > 0, matches };
  }
  let rows = src.rows;
  if (check.where) {
    const re = new RegExp(check.where.re);
    rows = rows.filter((r) => re.test(r[check.where.col] ?? ""));
  }
  if (check.minRows) return { present: rows.length >= check.minRows, matches: [] };
  const t = check.test;
  const cols = t.cols || [t.col];
  const re = t.re ? new RegExp(t.re) : null;
  const notRe = t.notRe ? new RegExp(t.notRe, "i") : null;
  const passes = (v) => {
    const parts = t.split ? v.split(new RegExp(t.split)) : [v];
    return parts.some((p) => (re ? re.test(p) : true) && (notRe ? !notRe.test(p) : true));
  };
  const hit = rows.filter((r) =>
    t.any ? cols.some((c) => passes(r[c] ?? "")) : passes(cols.map((c) => r[c] ?? "").join(" ")),
  );
  return { present: hit.length > 0, matches: hit.map((r) => ({ name: rowName(r), lei: one(r[3]) })) };
}

const day = (s) => Date.parse(`${s}T00:00:00Z`) / 864e5;
const curated = JSON.parse(readFileSync(CURATED, "utf8"));
const warnings = [];
const errors = [];
const items = curated.items.map((e) => {
  const { present, matches } = runCheck(e.check);
  const status = present ? "open" : "fixed-by-esma";
  if (status === "fixed-by-esma" && !e.esmaFixed)
    warnings.push(`${e.id}: ESMA no longer carries this defect. Record esmaFixed (after = previous check, by = ${DATA_LAST_SYNCED}).`);
  if (status === "open" && e.esmaFixed) warnings.push(`${e.id}: esmaFixed is recorded, but the defect is back in ESMA's file.`);
  let leadDays = null;
  let aheadOfEsma = false;
  if (e.publicSince && e.esmaFixed) {
    const min = day(e.esmaFixed.after) - day(e.publicSince.date);
    const max = day(e.esmaFixed.by) - day(e.publicSince.date);
    if (min >= 0) {
      aheadOfEsma = true;
      leadDays = { min, max };
    }
  }
  const out = { ...e };
  delete out.listFromCheck;
  if (e.listFromCheck) {
    out.entities = matches.map((m) => m.name);
    out.leis = matches.map((m) => m.lei).filter(Boolean);
  }
  out.count = Math.max(out.entities.length, 1);
  out.status = status;
  out.aheadOfEsma = aheadOfEsma;
  out.leadDays = leadDays;
  if (out.publicSince) out.publicSince = { ...out.publicSince, url: COMMIT_URL(out.publicSince.commit) };
  if (out.esmaFixed) out.esmaFixed = { ...out.esmaFixed, url: COMMIT_URL(out.esmaFixed.commit) };
  return out;
});

// Every LEI touched by a value override must be logged (or explained).
function leisIn(file, constName) {
  const text = readFileSync(join(ROOT, "scripts", file), "utf8");
  const start = text.indexOf(`const ${constName} = {`);
  if (start < 0) throw new Error(`${constName} not found in ${file}`);
  const block = text.slice(start, text.indexOf("\n};", start));
  return [...block.matchAll(/^\s*"([A-Z0-9.]{18,22})"\s*:/gm)].map((m) => m[1]);
}
const logged = new Set(items.flatMap((i) => i.leis));
const explained = new Set(Object.keys(curated.notCorrections || {}));
const overrides = [
  ["clean-data.mjs", "NAME_BY_LEI"],
  ["clean-data.mjs", "WEBSITE_BY_LEI"],
  ["clean-data.mjs", "DATE_FIX_BY_LEI"],
  ["clean-token-issuers.mjs", "DISPLAY_BY_LEI"],
];
for (const [file, name] of overrides)
  for (const lei of leisIn(file, name))
    if (!logged.has(lei) && !explained.has(lei)) errors.push(`${name} (${file}) overrides ${lei}, which has no entry in source-corrections.json`);
{
  // LEI_FIX is keyed by the WRONG value, the logged entry carries the right one.
  const text = readFileSync(join(ROOT, "scripts", "clean-data.mjs"), "utf8");
  const start = text.indexOf("const LEI_FIX = {");
  const block = text.slice(start, text.indexOf("\n};", start));
  for (const m of block.matchAll(/"([A-Z0-9]{18,22})"\s*:\s*"([A-Z0-9]{20})"/g))
    if (!logged.has(m[2])) errors.push(`LEI_FIX corrects ${m[1]} -> ${m[2]}, which has no entry in source-corrections.json`);
}
if (errors.length) {
  for (const e of errors) console.error(`ERROR ${e}`);
  process.exit(1);
}

const ahead = items.filter((i) => i.aheadOfEsma);
const summary = {
  total: items.length,
  corrected: items.filter((i) => i.kind === "corrected").length,
  repaired: items.filter((i) => i.kind === "repaired").length,
  flagged: items.filter((i) => i.kind === "flagged").length,
  open: items.filter((i) => i.status === "open").length,
  fixedByEsma: items.filter((i) => i.status === "fixed-by-esma").length,
  fixedByUsFirst: ahead.length,
  leadDaysMin: ahead.length ? Math.min(...ahead.map((i) => i.leadDays.min)) : null,
  leadDaysMax: ahead.length ? Math.max(...ahead.map((i) => i.leadDays.max)) : null,
};
const body = {
  about:
    "Defects CASP Tracker found in ESMA's MiCA register files, with the evidence, the date our fix became public in the data repository, and whether ESMA has since corrected its own file. `status` is recomputed against the current ESMA files on every build. `leadDays` is how long our fix was public before ESMA's file stopped carrying the defect, as a range between two of our downloads.",
  kinds: {
    corrected: "A value we publish differs from ESMA's file, backed by a second, named source.",
    repaired: "A format defect we read correctly without changing any fact.",
    flagged: "A defect we report but do not change.",
  },
  sources: Object.values(FILES).map((f) => f.url),
  attribution: DATASET_ATTRIBUTION,
  summary,
  count: items.length,
  items,
};
const lastChanged = resolveLastChanged(OUT_JSON, body, null);
writeFileSync(OUT_JSON, JSON.stringify({ generatedAt: new Date().toISOString(), lastChanged, ...body }, null, 2) + "\n");

console.log(
  `Wrote ${items.length} logged source defects -> ${OUT_JSON} (corrected ${summary.corrected}, repaired ${summary.repaired}, flagged ${summary.flagged}; ESMA still carries ${summary.open}, ESMA fixed ${summary.fixedByEsma}; our fix public first in ${summary.fixedByUsFirst}, ${summary.leadDaysMin} to ${summary.leadDaysMax} days ahead).`,
);
for (const w of warnings) console.log(`WARN ${w}`);

// ---------- CORRECTIONS.md for the data repository ----------
const mdIdx = process.argv.indexOf("--md");
if (mdIdx > 0) {
  const path = process.argv[mdIdx + 1];
  const cell = (s) => String(s ?? "-").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const date = (s) => (s ? s : "-");
  const commit = (o) => (o ? `${o.date ?? o.by} ([${o.commit}](${o.url}))` : "-");
  const evid = (e) => e.evidence.map((v) => (v.url ? `[${cell(v.label)}](${v.url})` : cell(v.label))).join("<br>");
  const who = (e) => cell(e.entities.length > 6 ? `${e.entities.slice(0, 6).join(", ")} and ${e.entities.length - 6} more` : e.entities.join(", "));
  const esmaStatus = (e) =>
    e.status === "open"
      ? "Still in ESMA's file"
      : e.esmaFixed
        ? `Fixed by ESMA between ${e.esmaFixed.after} and ${e.esmaFixed.by} ([${e.esmaFixed.commit}](${e.esmaFixed.url}))`
        : "No longer in ESMA's file";
  const L = [];
  L.push("# Corrections to ESMA's MiCA register files", "");
  L.push(
    "ESMA publishes the MiCA interim registers as raw CSV exports. CASP Tracker reads every file on each run of the [CASP Tracker Verification Protocol](https://casptracker.eu/about/#methodology) and logs here every defect it has found in them, with the evidence, the date our fix became public in this repository, and whether ESMA has since corrected its own file. The same log is published as data in [`data/corrections.json`](data/corrections.json).",
    "",
  );
  L.push("How to read it:", "");
  L.push(`- **Corrected**: ${body.kinds.corrected}`);
  L.push(`- **Repaired**: ${body.kinds.repaired}`);
  L.push(`- **Flagged**: ${body.kinds.flagged}`);
  L.push(
    "- An ESMA file is dated by the day we downloaded it. \"Fixed by ESMA between A and B\" means our download of A still had the defect and our download of B no longer did. Our own fixes link to the commit of this repository in which they first appeared.",
  );
  L.push(
    `- The status column is recomputed against ESMA's current files on every build, last on ${DATA_LAST_SYNCED}. A fix that ESMA has made redundant switches itself off in the cleaning code, so we never overwrite a later, correct value.`,
    "",
  );
  L.push("## Summary", "");
  L.push(
    `${summary.total} defects logged: ${summary.corrected} corrected, ${summary.repaired} repaired, ${summary.flagged} flagged. ESMA has since corrected ${summary.fixedByEsma} of them in its own file. In ${summary.fixedByUsFirst} cases our fix was public before ESMA fixed its file, between ${summary.leadDaysMin} and ${summary.leadDaysMax} days earlier.`,
    "",
  );
  L.push("## Fixed in our data before ESMA fixed its file", "");
  L.push("| Defect | Provider | Our fix public since | ESMA fixed its file | Days ahead |", "|---|---|---|---|---|");
  for (const e of ahead.sort((a, b) => b.leadDays.max - a.leadDays.max))
    L.push(
      `| ${cell(e.field)}: ${cell(e.esmaValue)} | ${who(e)} | ${commit(e.publicSince)} | between ${e.esmaFixed.after} and ${e.esmaFixed.by} ([${e.esmaFixed.commit}](${e.esmaFixed.url})) | ${e.leadDays.min} to ${e.leadDays.max} |`,
    );
  L.push("");
  const titles = { corrected: "Corrected", repaired: "Repaired", flagged: "Flagged" };
  for (const kind of ["corrected", "repaired", "flagged"]) {
    L.push(`## ${titles[kind]}`, "", body.kinds[kind], "");
    L.push(
      "| Provider | Field | ESMA's file | Our data | Evidence | Found | Our fix public since | ESMA status |",
      "|---|---|---|---|---|---|---|---|",
    );
    for (const e of items.filter((i) => i.kind === kind)) {
      const found = e.foundOn ? e.foundOn : "before 2026-07-20";
      const extra = e.note ? `<br>${cell(e.note)}` : "";
      L.push(
        `| ${who(e)} | ${cell(e.field)} | ${cell(e.esmaValue)} | ${cell(e.ourValue)}${extra} | ${evid(e)} | ${found} | ${commit(e.publicSince)} | ${esmaStatus(e)} |`,
      );
    }
    L.push("");
  }
  L.push(
    "Spotted a defect we have not logged? Write to contact@casptracker.eu. Reuse of this log is welcome under CC BY 4.0 with attribution to CASP Tracker (casptracker.eu).",
    "",
  );
  writeFileSync(path, L.join("\n"));
  console.log(`Wrote ${path}`);
}
