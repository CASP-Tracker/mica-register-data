// Resolves `lastChanged` for a generated dataset: the date its CONTENT last
// actually changed, which is what schema.org's dateModified means.
//
// Why this exists (see the CLAUDE.md session note for 2026-08-22): neither of
// the two dates the project already had says "modified".
//   - casps.json `lastDataUpdate` is the newest record stamp INSIDE ESMA's
//     register, so it UNDER-reports: ESMA can stamp a batch on the 20th that we
//     only publish on the 5th of the next month.
//   - DATA_LAST_SYNCED is when we last LOOKED at the source, so it OVER-reports:
//     it would bump on every go1 run even when nothing changed. The ART register
//     has been empty since launch and would still have claimed daily modification.
//
// So we diff the freshly derived payload against the file already on disk,
// ignoring the two fields that move on their own (`generatedAt`, and
// `lastChanged` itself, which would otherwise be self-referential). Identical
// content carries the previous date forward; a real change stamps today.
//
// `seed` is the known real last-change date, used when the file on disk predates
// this mechanism and therefore carries no `lastChanged` yet. Without it the first
// run after adding this would falsely stamp every dataset with today's date.
import { existsSync, readFileSync } from "node:fs";

const IGNORED = new Set(["generatedAt", "lastChanged"]);

// Top-level keys are sorted so a reordered literal in the calling script cannot
// register as a content change. Nested structures are generated deterministically
// by the same code path, so their order is already stable.
const stable = (obj) =>
  JSON.stringify(
    Object.keys(obj)
      .filter((k) => !IGNORED.has(k))
      .sort()
      .map((k) => [k, obj[k]]),
  );

export function resolveLastChanged(outPath, body, seed) {
  const today = new Date().toISOString().slice(0, 10);
  if (!existsSync(outPath)) return seed || today;
  let prev;
  try {
    prev = JSON.parse(readFileSync(outPath, "utf8"));
  } catch {
    return seed || today;
  }
  if (stable(prev) !== stable(body)) return today;
  return prev.lastChanged || seed || today;
}
