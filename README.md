# ESMA MiCA register data

Cleaned, machine-readable datasets from the European Securities and Markets Authority (ESMA) interim registers under the EU's **MiCA** regulation (Markets in Crypto-Assets, Regulation (EU) 2023/1114). Maintained by [CASP Tracker](https://casptracker.eu), a searchable directory of MiCA-licensed crypto-asset service providers.

- Last verified against the live ESMA source: **2026-08-18**
- Newest record date inside the CASP register: **2026-08-17**

## Datasets

| File | Register | Entries | Description |
|---|---|---|---|
| [`data/casps.json`](data/casps.json) | Authorised CASPs | **326** | Crypto-asset service providers holding a MiCA (CASP) authorisation |
| [`data/ncasps.json`](data/ncasps.json) | NCASP warning list | **167** | Non-compliant entities flagged by national regulators |
| [`data/emts.json`](data/emts.json) | EMT issuers | **23** issuers (43 white papers) | E-money token (stablecoin) issuers under MiCA Title IV |
| [`data/arts.json`](data/arts.json) | ART issuers | **0** | Asset-referenced token issuers under MiCA Title III (the register has been empty since launch) |

`source/` holds the raw ESMA CSV snapshots the datasets are built from (`CASPS.csv`, `NCASP.csv`, `EMTWP.csv`, `ARTZZ.csv`). Filenames are stable, so **the git history of this repository doubles as a changelog of the ESMA registers**: every refresh commit shows exactly which entries were added or changed. ESMA itself does not publish register history.

## Why not use the raw ESMA CSVs directly?

The official interim CSVs are hard to consume programmatically. The cleaning scripts fix, among other things:

- mojibake and stray U+FFFD characters in names and addresses;
- invalid country codes (`EL` used for Greece, `SL` as a source typo for Slovenia);
- inconsistent separators in the passporting column (`|`, ` I `, `/`, `,`);
- junk in the website columns (a postal code parsed as a URL, page titles, `https.//` typos);
- duplicate rows for the same entity (the register re-lists an entity under the same LEI and legal name when its authorisation is extended, e.g. DekaBank, EUWAX): these are merged into one entry with a union of services and markets and the earliest authorisation date;
- the 10 MiCA services are detected by distinctive phrases in the text, because the letter prefixes in the source are unreliable and often missing;
- dates converted from `dd/mm/yyyy` to ISO 8601.

We normalise, we never edit facts. Genuine source errors (for example two different French firms sharing one LEI in the register) are preserved and documented in the scripts.

Full methodology: the **CASP Tracker Verification Protocol**, described at <https://casptracker.eu/about/#methodology>. Each refresh starts by downloading the live CSVs from esma.europa.eu and comparing SHA-256 hashes byte for byte; the datasets are regenerated whenever the source changes.

## Schema

All JSON files share the same top level: `generatedAt` (build timestamp), `source` (ESMA CSV URL), `count`, and `items[]`. `casps.json` additionally carries `lastDataUpdate` (the newest record date inside the register).

### `data/casps.json` (authorised CASPs)

| Field | Meaning |
|---|---|
| `slug` | Stable URL-safe identifier assigned by CASP Tracker |
| `name` | Display name (commercial name preferred over legal name) |
| `legalName` | Registered legal name |
| `authority` | Full name of the authorising national regulator |
| `homeState` | Home member state, ISO 3166-1 alpha-2 |
| `lei` | Legal Entity Identifier (ISO 17442) |
| `leiCountry` | Country of the LEI registration |
| `address` | Registered address as listed by ESMA |
| `website`, `websiteHref` | Display URL and normalised `https://` link (empty when the source has no usable URL) |
| `services` | Authorised MiCA services as letters `a`-`j` (see below) |
| `countries` | EEA markets the authorisation is passported into (ISO codes) |
| `authDate`, `authDateRaw` | Authorisation date, ISO and as printed in the source |
| `endDate` | End of authorisation, `null` while active |
| `comments` | Free-text comments from the register |
| `lastUpdate`, `lastUpdateRaw` | Last update date of the record |
| `companyRegisterNumber`, `companyRegisterName`, `companyRegisterCountry` | The entity's national commercial-register identifier (e.g. a German Handelsregister number, a Dutch KvK number), resolved from [GLEIF](https://www.gleif.org)'s public API by LEI. This is **not** the LEI and **not** a MiCA-specific number: every company has one, licensed or not. Present for most, but not all, entries. |
| `ncaNumberStatus` | Whether the home regulator assigns a MiCA-specific reference number at all: `register` (a public, browsable register exists), `informal` (only per-decision references exist, no browsable register), or `none` (confirmed not to assign a separate number). |
| `ncaNumber`, `ncaNumberLabel` | The regulator-assigned MiCA reference number and its label (e.g. `"41000007"` / `"AFM authorisation number"`), where known. An entity in a `register`-status country without a value here simply means we have not sourced that specific number yet, not that one doesn't exist. |

ESMA's own register carries only the LEI (MiCA Art. 109(5)(a)); the two extra identifier fields above are purely national artifacts, researched and joined by CASP Tracker per-country. See `scripts/fetch-register-numbers.mjs` and `scripts/fetch-nca-numbers.mjs` below.

The 10 MiCA crypto-asset services (Art. 3(1)(16) MiCA):

| Letter | Service |
|---|---|
| a | Custody and administration of crypto-assets |
| b | Operation of a trading platform |
| c | Exchange of crypto-assets for funds |
| d | Exchange of crypto-assets for other crypto-assets |
| e | Execution of orders on behalf of clients |
| f | Placing of crypto-assets |
| g | Reception and transmission of orders |
| h | Advice on crypto-assets |
| i | Portfolio management of crypto-assets |
| j | Transfer services for crypto-assets |

### `data/ncasps.json` (warning list)

| Field | Meaning |
|---|---|
| `authority` | National regulator that flagged the entity |
| `homeState` | Regulator's country |
| `leiName`, `commercialName` | Names as listed |
| `website` | Raw website value from the source (may hold several URLs separated by `\|`) |
| `domains` | Parsed domain list; **use these for exact matching**, the list contains look-alike scam domains that imitate real exchanges |
| `reason`, `comments` | Free text from the register |
| `decisionDate`, `lastUpdate` | ISO dates |

Note: the warning list is fed by a small number of national authorities (currently 165 of 167 entries come from Italy's CONSOB, plus one each from the Dutch AFM and Slovakia's NBS). It is **not** a complete EU-wide blacklist, and absence from it is not a clean bill of health.

### `data/emts.json` (e-money token issuers)

One item per issuer, merged by LEI and legal name from ESMA's register of EMT white papers (one source row per white paper).

| Field | Meaning |
|---|---|
| `lei`, `leiName`, `name` | Identifier, legal name, display name |
| `homeState`, `authority`, `address` | Home state, regulator, registered address |
| `website`, `websiteHref` | Issuer website |
| `type` | `emi` (e-money institution) or `credit` (credit institution, i.e. a bank) |
| `ex484`, `ex485`, `exempt` | Art. 48(4)/48(5) MiCA exemption flags |
| `tokens` | Token tickers from a hand-verified map (the source has **no** ticker column; see `scripts/clean-token-issuers.mjs`, issuers we could not verify get an empty list) |
| `entityAuthDate` | Date of the underlying e-money or banking licence (can far predate MiCA) |
| `firstWpDate`, `lastUpdate` | First white paper notification and last record update |
| `whitepapers` | Every notified white paper: `{url, date, note}` |
| `dti`, `dtiFfg` | ISO 24165 Digital Token Identifiers and functionally fungible group codes |
| `caspSlug`, `caspWebsite` | Join keys to `casps.json` when the issuer also holds a CASP authorisation |

### `data/arts.json` (asset-referenced token issuers)

Same top-level shape; `items` is empty because no ART issuer has been authorised in the EU yet.

## Scripts

`scripts/` contains the cleaning scripts exactly as used in the casptracker.eu build pipeline, published for transparency of the methodology:

- `clean-data.mjs`: `CASPS.csv` to `casps.json` (also joins in the company-register and NCA-reference numbers below)
- `clean-ncasp.mjs`: `NCASP.csv` to `ncasps.json`
- `clean-token-issuers.mjs`: `EMTWP.csv` + `ARTZZ.csv` to `emts.json` + `arts.json`
- `fetch-register-numbers.mjs`: resolves every CASP's national company-register number from the free public GLEIF API by LEI
- `fetch-nca-numbers.mjs`: fetches MiCA-specific regulator reference numbers in bulk from the five national sources confirmed machine-readable so far (Netherlands/AFM, France/AMF, Luxembourg/CSSF, Croatia/HANFA, Denmark/Finanstilsynet); prints a diff against the hand-curated overrides in `clean-data.mjs` rather than writing data directly, so each new number gets a sanity check before it ships

They expect the website project's directory layout (input CSVs in the project root under their local names, output to `src/data/`), so they are reference material here rather than a ready-to-run toolchain.

## Licensing and attribution

- **Scripts** (`scripts/`): [MIT License](LICENSE).
- **Cleaned datasets** (`data/`): [Creative Commons Attribution 4.0](LICENSE-DATA.md). Please attribute **"CASP Tracker (casptracker.eu)"** and acknowledge ESMA as the underlying source.
- **Raw CSV snapshots** (`source/`): (c) European Securities and Markets Authority (ESMA), reproduced with source acknowledgment in line with ESMA's legal notice. Official register page: <https://www.esma.europa.eu/esmas-activities/digital-finance-and-innovation/markets-crypto-assets-regulation-mica>

This repository is informational only and is not legal or financial advice. Always verify against the official ESMA register before making decisions.

Note on source stability: ESMA has announced that the interim CSV registers will move into its IT systems during 2026, so the source URLs may change.

## Links

- Searchable MiCA license list: <https://casptracker.eu>
- ESMA crypto warning list: <https://casptracker.eu/esma-crypto-warning-list/>
- MiCA stablecoin (EMT) list: <https://casptracker.eu/e-money-token-list-under-mica/>
- Asset-referenced tokens (ART): <https://casptracker.eu/asset-referenced-tokens-art/>
- Contact: <contact@casptracker.eu>
