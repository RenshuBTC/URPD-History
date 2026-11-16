// Builds labelled.json, the examples the checks are checked against (tests/evals.test.cjs): traces of a reviewed run
// that review found good, with BRK's own figures for just their days and blocks, so the tests need no network.
//
//   node evals/fixtures/build.mjs evals/out/RUN/traces.json t001,t011,t124,... [YYYY-MM-DD]
//
// More than one traces file may be given, separated by commas; a trace in a later file replaces one with the same id.
// The date is the day that was in progress (UTC) when the traces were drawn, whose totals the data checks leave out:
// today's, unless named. Run it only on traces that were looked at: a wrong chart labelled good teaches the checks to
// pass it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRefs, SERIES, BLOCK_SERIES } from "../refs.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.dirname(path.dirname(HERE));
const [files, ids, drawnOn] = process.argv.slice(2);
if (!files || !ids || (drawnOn && !/^\d{4}-\d\d-\d\d$/.test(drawnOn))) throw new Error("usage: node evals/fixtures/build.mjs TRACES.json[,MORE.json] t001,t002,... [YYYY-MM-DD]");

const byId = new Map();
for (const f of files.split(",")) for (const t of JSON.parse(fs.readFileSync(f, "utf8"))) byId.set(t.id, t);
const good = ids.split(",").map((id) => {
  const t = byId.get(id);
  if (!t || !t.facts) throw new Error(id + " is not a drawn trace of " + files);
  const { shot, ms, firstLoadMs, tries, firstError, ...kept } = t;
  return kept;
});

// Every day and block the checks ask BRK about for these traces: what each shows, and where each step started and landed.
const heights = new Set(), days = new Set();
for (const t of good) {
  days.add(t.facts.date);
  if (t.facts.block) heights.add(t.facts.block.height);
  for (const s of t.stepped || []) days.add(s.date);
}
const r = await loadRefs([...heights]);
const refs = {}, blocks = {}, blockDays = {}, lastHeights = {};
for (const d of days) {
  refs[d] = Object.fromEntries(SERIES.filter((n) => n !== "date" && n !== "first_height").map((n) => [n, r.ref(n, d)]));
  lastHeights[d] = r.lastHeight(d);
}
for (const h of heights) {
  blocks[h] = Object.fromEntries(BLOCK_SERIES.map((n) => [n, r.refAt(n, h)]));
  blockDays[h] = r.dayOf(h);
}

const file = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, name), "utf8"));
const scales = file("data/scales.json"), drawn = good.find((t) => t.facts.youtube && t.facts.youtube.length);
const links = drawn ? drawn.facts.youtube : null;
for (const t of good) delete t.facts.youtube;   // the menu's links, the same in every trace: kept once, below
const out = {
  about: "Labelled examples for tests/evals.test.cjs: traces of the site that review found good (" + new Date().toISOString().slice(0, 10) +
    "), with BRK's own figures for their days and blocks. Made by evals/fixtures/build.mjs.",
  inProgress: drawnOn || r.lastDay,
  refs, blocks, blockDays, lastHeights, good,
  site: { youtube: Object.fromEntries(Object.entries(file("data/youtube.json")).filter(([k]) => k !== "about")), scales: { start: scales.start, end: scales.end }, links, today: drawnOn || r.lastDay },
};
// One line for each trace, so a change to the examples reads as which traces changed.
const head = ["about", "inProgress", "refs", "blocks", "blockDays", "lastHeights"].map((k) => JSON.stringify(k) + ": " + JSON.stringify(out[k]) + ",");
fs.writeFileSync(path.join(HERE, "labelled.json"), ["{", ...head, '"good": [', good.map((t) => JSON.stringify(t)).join(",\n"), "],", '"site": ' + JSON.stringify(out.site), "}"].join("\n") + "\n");
console.log(`${good.length} good traces, ${days.size} days, ${heights.size} blocks: ${fs.statSync(path.join(HERE, "labelled.json")).size} bytes`);
