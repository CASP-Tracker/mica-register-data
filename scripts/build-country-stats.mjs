// Per-country statistics derived from the three cleaned ESMA datasets
// (casps.json, ncasps.json, emts.json) -> src/data/countries.json. Chained into
// `npm run dev` / `npm run build` right after `tokens`, so it always sees fresh
// inputs, and mirrored in the public data repo (mica-register-data) as the
// fifth dataset. `npm run countries` runs it on its own.
//
// It feeds the country hub /crypto-license-in-europe-by-country/ (through
// src/lib/country-stats.js), the coming /crypto-license-in-<country>/ pages and
// their JSON-LD. Nothing here exists in ESMA's own files: every figure is a
// CASP Tracker derivation, which is why the dataset carries the attribution
// block and its own lastChanged date.
//
// Definitions (keep the README of the data repo and the hub copy in sync):
// - licences: entries whose home state (ESMA `ae_homeMemberState`) is the
//   country. Authorisations and Article 60 notifications are counted together,
//   exactly as ESMA lists them in `ac_authorisationNotificationDate`.
// - passportedIn: entries licensed in ANOTHER state that list the country in
//   their passporting column (`ac_serviceCode_cou`).
// - serving: licences + passportedIn, every provider allowed to serve the
//   country's residents. Same rule as the homepage "I'm in" filter.
// - exchanges / exchangesServing: licences covering a trading platform or
//   exchange services (MiCA services b, c or d), the pool rule the TOP 100
//   page also uses, counted among home licences / among `serving`.
// - banks: a NAME heuristic (bank, Volksbank, Raiffeisen, Sparkasse, eG...),
//   not a register field. Labelled as such wherever it is shown.
// - onlyExecution: home licences whose only service is e (execution of orders).
// - capitalClasses: [class 1, class 2, class 3] per MiCA Annex IV (EUR 50k /
//   125k / 150k), the highest class implied by the service set.
// - medianMarkets: median number of EEA markets a home licence is notified to
//   (an entry with no passporting counts as 1, its home market).
// - homeOnly: home licences notified to no other market.
// - first / latest: earliest and most recent authorisation date among home
//   licences; `latest` ignores rows dated after DATA_LAST_SYNCED.
// - future: home licences whose authorisation date is after DATA_LAST_SYNCED
//   (ESMA publishes some rows before they take effect). Counted in `licences`.
// - last12mo: home licences dated within 12 months before the newest record.
// - regulators: distinct authorities among home licences (full name + short).
// - ncaNumberStatus: whether the home regulator assigns a MiCA reference
//   number (see NCA_NUMBER_POLICY in clean-data.mjs), null with no licences.
// - warnings: NCASP entries filed by this country's regulator (only five
//   regulators report to that list, so 0 means "none reported", not "none").
// - emtIssuers: authorised e-money token issuers based in the country.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { COUNTRY_NAMES } from "../src/lib/countries.js";
import { regulatorShort } from "../src/lib/regulator.js";
import { DATA_LAST_SYNCED } from "../src/lib/site.js";
import { DATASET_ATTRIBUTION } from "../src/lib/provenance.js";
import { resolveLastChanged } from "./last-changed.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "src", "data");
const OUT_JSON = join(DATA_DIR, "countries.json");
const read = (file) => JSON.parse(readFileSync(join(DATA_DIR, file), "utf8"));

const casps = read("casps.json");
const ncasps = read("ncasps.json");
const emts = read("emts.json");
const items = casps.items;

// The 30 EEA states MiCA applies in (EU-27 + Iceland, Liechtenstein, Norway).
// Switzerland sits in COUNTRY_NAMES for the map only and is outside MiCA.
const EEA_STATES = Object.keys(COUNTRY_NAMES).filter((cc) => cc !== "CH");

// URL segment of a country page: /crypto-license-in-<slug>/.
const slugOf = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z]+/g, "-")
    .replace(/(^-|-$)/g, "");

const BANK_RE =
  /\b(bank|banque|banca|banco|sparkasse|volksbank|raiffeisenbank|raiffeisen|girozentrale|kreditbank|landesbank|caja|eG)\b/i;
const isBank = (c) => BANK_RE.test(c.legalName || "") || BANK_RE.test(c.name || "");
const isExchange = (c) => c.services.some((s) => s === "b" || s === "c" || s === "d");
const capitalClass = (s) => (s.includes("b") ? 3 : s.includes("a") || s.includes("c") || s.includes("d") ? 2 : 1);
const median = (arr) => {
  if (!arr.length) return 0;
  const m = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(m.length / 2);
  return m.length % 2 ? m[mid] : (m[mid - 1] + m[mid]) / 2;
};
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

const cutoff12 = new Date(casps.lastDataUpdate);
cutoff12.setFullYear(cutoff12.getFullYear() - 1);

const countries = EEA_STATES.map((cc) => {
  const home = items.filter((c) => c.homeState === cc);
  const passportedIn = items.filter((c) => c.homeState !== cc && c.countries.includes(cc));
  const all = [...home, ...passportedIn];
  const dates = home
    .map((c) => c.authDate)
    .filter(Boolean)
    .sort();
  const past = dates.filter((d) => d <= DATA_LAST_SYNCED);
  const regulators = [...new Set(home.map((c) => c.authority))].map((full) => ({
    full,
    short: regulatorShort(full),
  }));
  return {
    cc,
    name: COUNTRY_NAMES[cc],
    slug: slugOf(COUNTRY_NAMES[cc]),
    licences: home.length,
    share: casps.count ? round((100 * home.length) / casps.count, 1) : 0,
    passportedIn: passportedIn.length,
    serving: all.length,
    exchanges: home.filter(isExchange).length,
    exchangesServing: all.filter(isExchange).length,
    tradingPlatforms: home.filter((c) => c.services.includes("b")).length,
    custody: home.filter((c) => c.services.includes("a")).length,
    banks: home.filter(isBank).length,
    onlyExecution: home.filter((c) => c.services.length === 1 && c.services[0] === "e").length,
    capitalClasses: [1, 2, 3].map((k) => home.filter((c) => capitalClass(c.services) === k).length),
    avgServices: home.length ? round(home.reduce((s, c) => s + c.services.length, 0) / home.length, 2) : 0,
    medianMarkets: median(home.map((c) => Math.max(c.countries.length, 1))),
    homeOnly: home.filter((c) => c.countries.length <= 1).length,
    first: dates[0] || null,
    latest: past[past.length - 1] || null,
    future: dates.filter((d) => d > DATA_LAST_SYNCED).length,
    last12mo: home.filter(
      (c) => c.authDate && c.authDate <= DATA_LAST_SYNCED && new Date(c.authDate) >= cutoff12,
    ).length,
    regulators,
    ncaNumberStatus: home[0]?.ncaNumberStatus || null,
    warnings: ncasps.items.filter((w) => w.homeState === cc).length,
    emtIssuers: emts.items.filter((e) => e.homeState === cc).length,
  };
}).sort((a, b) => b.licences - a.licences || a.name.localeCompare(b.name));

const totals = {
  count: casps.count,
  sourceRows: casps.sourceRows,
  lastDataUpdate: casps.lastDataUpdate,
  states: EEA_STATES.length,
  countriesWith: countries.filter((c) => c.licences > 0).length,
  zeroStates: countries.filter((c) => !c.licences).map((c) => c.cc),
  regulators: new Set(items.map((c) => c.authority)).size,
  futureDated: items.filter((c) => c.authDate && c.authDate > DATA_LAST_SYNCED).length,
  exchanges: items.filter(isExchange).length,
  banks: items.filter(isBank).length,
};

// No dates in the note and no verification date in the body on purpose: they
// would change on every go1 and make resolveLastChanged() stamp a false change.
const body = {
  source: {
    casps: "https://www.esma.europa.eu/sites/default/files/2024-12/CASPS.csv",
    ncasps: "https://www.esma.europa.eu/sites/default/files/2024-12/NCASP.csv",
    emts: "https://www.esma.europa.eu/sites/default/files/2024-12/EMTWP.csv",
  },
  note:
    "Per-country statistics DERIVED by CASP Tracker from the cleaned ESMA registers (casps.json, ncasps.json, emts.json); none of these figures exists in ESMA's own files. One record per EEA state (EU-27 plus Iceland, Liechtenstein and Norway), sorted by licences issued. `licences` counts entries by home state, authorisations and Article 60 notifications together, exactly as ESMA lists them. `serving` = home licences + providers passported in from other states. `exchanges` = licences covering MiCA services b, c or d. `banks` is a legal-name heuristic, not a register field. `future` entries carry an authorisation date after the last verification and are included in `licences`. `warnings` counts NCASP entries filed by the country's regulator; only five regulators report to that list, so 0 means none reported, not none issued.",
  attribution: DATASET_ATTRIBUTION,
  count: countries.length,
  totals,
  items: countries,
};

const out = {
  generatedAt: new Date().toISOString(),
  // Seed = the last change of the CASP register the numbers derive from, so
  // the first run does not stamp a false "changed today".
  lastChanged: resolveLastChanged(OUT_JSON, body, casps.lastChanged),
  ...body,
};

writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
console.log(
  `Wrote ${countries.length} countries (${totals.countriesWith} with licences, top ${countries[0].name} ${countries[0].licences}) -> ${OUT_JSON}`,
);
