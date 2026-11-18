# Corrections to ESMA's MiCA register files

ESMA publishes the MiCA interim registers as raw CSV exports. CASP Tracker reads every file on each run of the [CASP Tracker Verification Protocol](https://casptracker.eu/about/#methodology) and logs here every defect it has found in them, with the evidence, the date our fix became public in this repository, and whether ESMA has since corrected its own file. The same log is published as data in [`data/corrections.json`](data/corrections.json).

How to read it:

- **Corrected**: A value we publish differs from ESMA's file, backed by a second, named source.
- **Repaired**: A format defect we read correctly without changing any fact.
- **Flagged**: A defect we report but do not change.
- An ESMA file is dated by the day we downloaded it. "Fixed by ESMA between A and B" means our download of A still had the defect and our download of B no longer did. Our own fixes link to the commit of this repository in which they first appeared.
- The status column is recomputed against ESMA's current files on every build, last on 2026-11-18. A fix that ESMA has made redundant switches itself off in the cleaning code, so we never overwrite a later, correct value.

## Summary

21 defects logged: 7 corrected, 7 repaired, 7 flagged. ESMA has since corrected 8 of them in its own file. In 5 cases our fix was public before ESMA fixed its file, between 4 and 102 days earlier.

## Fixed in our data before ESMA fixed its file

| Defect | Provider | Our fix public since | ESMA fixed its file | Days ahead |
|---|---|---|---|---|
| Passporting countries: SL for Slovenia (SL is the ISO code of Sierra Leone) | AMINA (Austria) AG, FIOR Digital GmbH | 2026-07-20 ([e91762b](https://github.com/CASP-Tracker/mica-register-data/commit/e91762b)) | between 2026-10-22 and 2026-10-30 ([9fff69c](https://github.com/CASP-Tracker/mica-register-data/commit/9fff69c)) | 94 to 102 |
| LEI: 724500YJVIN0Q94ZZG5 (19 characters, fails the ISO 17442 check digits) | WEB3 Technology B.V. (Ari10) | 2026-08-12 ([5937641](https://github.com/CASP-Tracker/mica-register-data/commit/5937641)) | between 2026-10-09 and 2026-10-16 ([b0caa16](https://github.com/CASP-Tracker/mica-register-data/commit/b0caa16)) | 58 to 65 |
| Duplicate row: The same entity listed twice with identical rows | NAGA X | 2026-07-20 ([e91762b](https://github.com/CASP-Tracker/mica-register-data/commit/e91762b)) | between 2026-07-24 and 2026-08-05 ([442d9ce](https://github.com/CASP-Tracker/mica-register-data/commit/442d9ce)) | 4 to 16 |
| Authorisation date and record date: 11/09/2028 in both fields (a date two years in the future) | REGULAR FINANCE SAS | 2026-10-01 ([558a8c1](https://github.com/CASP-Tracker/mica-register-data/commit/558a8c1)) | between 2026-10-09 and 2026-10-16 ([b0caa16](https://github.com/CASP-Tracker/mica-register-data/commit/b0caa16)) | 8 to 15 |
| Authorisation date: Day and month only, e.g. 27-Apr (the year was dropped) | Banca Sella, CheckSig, CoinFlip (Olliv Italia), Conio, Cryptosmart, Hercle and 4 more | 2026-10-16 ([b0caa16](https://github.com/CASP-Tracker/mica-register-data/commit/b0caa16)) | between 2026-10-20 and 2026-10-22 ([63ff21f](https://github.com/CASP-Tracker/mica-register-data/commit/63ff21f)) | 4 to 6 |

## Corrected

A value we publish differs from ESMA's file, backed by a second, named source.

| Provider | Field | ESMA's file | Our data | Evidence | Found | Our fix public since | ESMA status |
|---|---|---|---|---|---|---|---|
| WEB3 Technology B.V. (Ari10) | LEI | 724500YJVIN0Q94ZZG5 (19 characters, fails the ISO 17442 check digits) | 724500YJVIN0Q94ZZG58 | [GLEIF record of WEB3 Technology B.V.](https://search.gleif.org/#/record/724500YJVIN0Q94ZZG58) | 2026-08-12 | 2026-08-12 ([5937641](https://github.com/CASP-Tracker/mica-register-data/commit/5937641)) | Fixed by ESMA between 2026-10-09 and 2026-10-16 ([b0caa16](https://github.com/CASP-Tracker/mica-register-data/commit/b0caa16)) |
| REGULAR FINANCE SAS | Authorisation date and record date | 11/09/2028 in both fields (a date two years in the future) | 11/09/2026 | [AMF register of authorised CASPs on data.gouv.fr, agrément MiCA A2026-030](https://www.data.gouv.fr/api/1/datasets/r/e03f8899-2499-4826-aaae-6842f520bdac) | 2026-09-24 | 2026-10-01 ([558a8c1](https://github.com/CASP-Tracker/mica-register-data/commit/558a8c1)) | Fixed by ESMA between 2026-10-09 and 2026-10-16 ([b0caa16](https://github.com/CASP-Tracker/mica-register-data/commit/b0caa16)) |
| Banca Sella, CheckSig, CoinFlip (Olliv Italia), Conio, Cryptosmart, Hercle and 4 more | Authorisation date | Day and month only, e.g. 27-Apr (the year was dropped) | The full date, e.g. 27/04/2026 | The same dates, with the year, in every earlier ESMA file (nine providers)<br>CONSOB resolution no. 24156 of 8 October 2026 (YouHodler Italy, new in that file) | 2026-10-16 | 2026-10-16 ([b0caa16](https://github.com/CASP-Tracker/mica-register-data/commit/b0caa16)) | Fixed by ESMA between 2026-10-20 and 2026-10-22 ([63ff21f](https://github.com/CASP-Tracker/mica-register-data/commit/63ff21f)) |
| Webull Securities (Europe) B.V. | Commercial name | Webull \| Webull Europe \| Cashify \| RGLTD | Webull<br>In ESMA's file since 1 October 2026. We caught it on 12 November. | [AFM register of crypto-asset service providers: "Webull, Webull Europe" for this LEI, Cashify and RGLTD listed under WEB3 Technology B.V. (Ari10)](https://www.afm.nl/~/profmedia/files/registers/register-cryptopartijen.xlsx) | 2026-11-12 | 2026-11-12 ([d0b63d0](https://github.com/CASP-Tracker/mica-register-data/commit/d0b63d0)) | Still in ESMA's file |
| Volksbank Raiffeisenbank Oberbayern Südost eG | Website | www-vrbank-obb-so.de (dashes instead of dots, does not resolve) | https://www.vrbank-obb-so.de | [The bank's own website, checked 3 August 2026](https://www.vrbank-obb-so.de) | 2026-08-03 | 2026-08-05 ([442d9ce](https://github.com/CASP-Tracker/mica-register-data/commit/442d9ce)) | Still in ESMA's file |
| Volksbank Raiffeisenbank Dachau eG | Website | www.voba-raiba-dachau.de (refuses HTTPS, over plain HTTP it only redirects to vr-dachau.de) | https://www.vr-dachau.de | [Redirect target, whose page title names the bank, checked 11 September 2026](https://www.vr-dachau.de) | 2026-09-11 | 2026-09-11 ([7308035](https://github.com/CASP-Tracker/mica-register-data/commit/7308035)) | Still in ESMA's file |
| N26 Bank SE, Commerzbank AG | Website | No usable web address in either website column | https://n26.com and https://www.commerzbank.com | The banks' official websites | before 2026-07-20 | 2026-07-20 ([e91762b](https://github.com/CASP-Tracker/mica-register-data/commit/e91762b)) | Still in ESMA's file |

## Repaired

A format defect we read correctly without changing any fact.

| Provider | Field | ESMA's file | Our data | Evidence | Found | Our fix public since | ESMA status |
|---|---|---|---|---|---|---|---|
| Coinbase Luxembourg S.A. | Website | https.//coinbase.com | https://coinbase.com | A full stop typed instead of a colon | before 2026-07-20 | 2026-07-20 ([e91762b](https://github.com/CASP-Tracker/mica-register-data/commit/e91762b)) | Still in ESMA's file |
| AMINA (Austria) AG, FIOR Digital GmbH | Passporting countries | SL for Slovenia (SL is the ISO code of Sierra Leone) | SI | [ISO 3166-1 country codes](https://www.iso.org/obp/ui/#iso:code:3166:SI) | before 2026-07-20 | 2026-07-20 ([e91762b](https://github.com/CASP-Tracker/mica-register-data/commit/e91762b)) | Fixed by ESMA between 2026-10-22 and 2026-10-30 ([9fff69c](https://github.com/CASP-Tracker/mica-register-data/commit/9fff69c)) |
| Payward Europe Solutions Limited (Kraken) | Commercial name | Kraken Digital Asset Exchange (�Kraken�), the quotation marks lost to a broken character encoding | Kraken Digital Asset Exchange (“Kraken”) | U+FFFD replacement characters in the export | before 2026-07-20 | 2026-07-20 ([e91762b](https://github.com/CASP-Tracker/mica-register-data/commit/e91762b)) | Still in ESMA's file |
| FF Digital, GOIN, BITSTACK, FINCTEK, BANQUE DELUBAC, FIPTO and 10 more | Authorised services (service d) | The label of service d cut short: "d. exchange of crypto-assets for other" (AMF rows) or "d. exchange of crypto-assets" (Bulgarian FSC row) | Service d (exchange of crypto-assets for other crypto-assets) shown for these providers<br>Our own miss: from at least 20 July to 17 September 2026 our published data showed 10 to 15 of these providers without service d. Found by comparing a new entry with the regulator's own decision. | [AMF register of authorised CASPs: crypto-to-crypto exchange listed for all 15 French firms](https://www.data.gouv.fr/api/1/datasets/r/e03f8899-2499-4826-aaae-6842f520bdac)<br>Bulgarian FSC licensing decision for FF Digital | 2026-09-17 | 2026-09-17 ([164e1b7](https://github.com/CASP-Tracker/mica-register-data/commit/164e1b7)) | Still in ESMA's file |
| NAGA X | Duplicate row | The same entity listed twice with identical rows | One entry | Byte-identical rows in the export | 2026-07-08 | 2026-07-20 ([e91762b](https://github.com/CASP-Tracker/mica-register-data/commit/e91762b)) | Fixed by ESMA between 2026-07-24 and 2026-08-05 ([442d9ce](https://github.com/CASP-Tracker/mica-register-data/commit/442d9ce)) |
| MEXC (AFM warning), LWEX (NBS warning) | Decision date and record date | Spreadsheet serial numbers, e.g. 45916 | Calendar dates, e.g. 16/09/2025, the same dates as in earlier ESMA files | Earlier ESMA files print the same rows as dd/mm/yyyy | 2026-11-12 | 2026-11-12 ([f13ed47](https://github.com/CASP-Tracker/mica-register-data/commit/f13ed47)) | Still in ESMA's file |
| Qivalis B.V. | Legal name | "Qivalis B.V." written three times in one cell | Qivalis B.V. | The repeated lines are identical | 2026-11-12 | 2026-11-12 ([f13ed47](https://github.com/CASP-Tracker/mica-register-data/commit/f13ed47)) | Still in ESMA's file |

## Flagged

A defect we report but do not change.

| Provider | Field | ESMA's file | Our data | Evidence | Found | Our fix public since | ESMA status |
|---|---|---|---|---|---|---|---|
| OSL EU GmbH, Noemon Finance Ltd, Raiffeisenbank Falkenstein-Wörth, Volksbank Sauerland eG, PROSEGUR CUSTODIA DE ACTIVOS DIGITALES S.L.U., FINTECH PAYMENTS PSC S.L. and 4 more | LEI | LEIs that fail the ISO 17442 check digits (wrong length, a trailing full stop or wrong check digits) | Shown as ESMA prints them. A LEI is corrected only when GLEIF confirms the right value, which so far happened once (Ari10). | ISO 17442 check digits (ISO 7064 MOD 97-10), which anyone can recompute | 2026-08-12 | - | Still in ESMA's file |
| Bitpanda GmbH | LEI | 5493007WZ7IFULIL8G21, which GLEIF shows as RETIRED (entity inactive) | ESMA's LEI is kept. The company register number comes from the successor LEI 98450086582EV2FFC109. | [GLEIF record, checked 12 November 2026](https://search.gleif.org/#/record/5493007WZ7IFULIL8G21) | 2026-08-12 | - | Still in ESMA's file |
| APLO SAS, FLOWDESK EUROPE SAS | LEI | APLO SAS listed under FLOWDESK EUROPE SAS's LEI | Kept as two separate entries, with APLO's own AMF number (A2026-023) and company register number attached by hand<br>Our data kept ESMA's LEI until ESMA corrected the row, so this is not counted as a fix ahead of ESMA. APLO's own numbers were public from 12 August 2026 (commit 5937641). | [GLEIF and the AMF register list APLO SAS under its own LEI 969500YKHZ31GZ7AAU02](https://search.gleif.org/#/record/969500YKHZ31GZ7AAU02) | 2026-08-12 | - | Fixed by ESMA between 2026-09-11 and 2026-09-17 ([e3ae2c6](https://github.com/CASP-Tracker/mica-register-data/commit/e3ae2c6)) |
| 360 Treasury Systems AG | Commercial name | flatexDEGIRO Bank AG, another company's name, so the register showed two flatexDEGIRO entries | Shown as ESMA printed it and flagged, no name override | [GLEIF record of this LEI: 360 Treasury Systems AG](https://search.gleif.org/#/record/529900P0204W9HA8JP36) | 2026-07-08 | - | Fixed by ESMA between 2026-08-18 and 2026-08-22 ([3b625b1](https://github.com/CASP-Tracker/mica-register-data/commit/3b625b1)) |
| BCASH, CAPITAL WALLET GREECE, XENIOS BLOCKCHAIN GROUP (XBG) | LEI | No LEI at all, the first rows in the register without one | Shown without LEI or company register number until ESMA added them | MiCA Art. 109(5)(a) requires the LEI in the register | 2026-09-24 | - | Fixed by ESMA between 2026-10-09 and 2026-10-16 ([b0caa16](https://github.com/CASP-Tracker/mica-register-data/commit/b0caa16)) |
| Rows of Dutch EMT issuers | Regulator name | De Nederlansche Bank (DNB) | Shown as ESMA prints it, the short name DNB is correct | [The bank's name is De Nederlandsche Bank](https://www.dnb.nl/en/) | 2026-11-12 | - | Still in ESMA's file |
| Webull Securities (Europe) B.V. | Legal basis | Article 63, CASP authorisation | Not shown on the site. AFM's register lists a notification under Article 60 by a MiFID II firm. | [AFM register of crypto-asset service providers](https://www.afm.nl/~/profmedia/files/registers/register-cryptopartijen.xlsx) | 2026-11-12 | - | Still in ESMA's file |

Spotted a defect we have not logged? Write to contact@casptracker.eu. Reuse of this log is welcome under CC BY 4.0 with attribution to CASP Tracker (casptracker.eu).
