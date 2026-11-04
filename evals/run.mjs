// Runs the evals: draws a plan's traces on the site, judges each with every check (checks.mjs) against BRK's own
// series (refs.mjs), checks the site's data files, prints the result and writes it, with a review page, to the out
// folder. Exits 1 when anything fails, so a scheduled run turns red.
//
//   node evals/run.mjs                      the daily sample, on https://www.bitcoinurpd.com/
//   node evals/run.mjs --local              the same on this checkout, served on 127.0.0.1 (before a merge)
//   node evals/run.mjs --plan review --shots   the error-analysis set, with screenshots to review
//   node evals/run.mjs --traces out/X/traces.json   judge saved traces again (after changing a check)
// Other options: --site URL, --seed N, --only t001,t002, --out DIR.

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { plan } from "./plan.mjs";
import { judge, TRACE_CHECKS, SITE_CHECKS } from "./checks.mjs";
import { loadRefs } from "./refs.mjs";
import { writeReport } from "./report.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.dirname(HERE);
const args = process.argv.slice(2), opt = { site: "https://www.bitcoinurpd.com/", plan: "daily", shots: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--local") opt.local = true;
  else if (a === "--shots") opt.shots = true;
  else if (["--site", "--plan", "--seed", "--only", "--out", "--traces"].includes(a)) opt[a.slice(2)] = args[++i];
  else throw new Error("unknown option " + a);
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.resolve(opt.out || path.join(HERE, "out", stamp));
fs.mkdirSync(outDir, { recursive: true });

// This checkout's files on 127.0.0.1, read-only, for --local.
function serve() {
  const types = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}
async function siteFile(site, name) {
  try { const r = await fetch(new URL(name + "?evals=" + Date.now(), site), { signal: AbortSignal.timeout(60000) }); return r.ok ? await r.json() : null; }
  catch (e) { return null; }
}

let server = null, traces;
const p = plan(opt.plan, opt.seed ? Number(opt.seed) : undefined);
if (opt.only) p.traces = p.traces.filter((t) => opt.only.split(",").includes(t.id));
if (opt.local) { server = await serve(); opt.site = `http://127.0.0.1:${server.address().port}/`; }
console.log(`${p.kind} plan, ${p.traces.length} traces, on ${opt.local ? "this checkout (" + opt.site + ")" : opt.site}`);
if (opt.traces) traces = JSON.parse(fs.readFileSync(opt.traces, "utf8"));
else {
  const { collect } = await import("./collect.mjs");
  traces = await collect(p, { site: opt.site, outDir, shots: opt.shots });
}
const refs = await loadRefs();
const today = new Date().toISOString().slice(0, 10);
const drawn = traces.find((t) => t.facts && t.facts.youtube && t.facts.youtube.length), links = drawn ? drawn.facts.youtube : null;
const site = { youtube: await siteFile(opt.site, "data/youtube.json"), scales: await siteFile(opt.site, "data/scales.json"), links, today };
if (server) server.close();
const result = judge(traces, { ref: refs.ref, inProgress: refs.lastDay }, site);
result.run = { at: new Date().toISOString(), site: opt.local ? "local checkout" : opt.site, plan: p.kind, seed: p.seed };
fs.writeFileSync(path.join(outDir, "traces.json"), JSON.stringify(traces));
fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(result, null, 1));
writeReport(result, traces, path.join(outDir, "report.html"));

// The result, as a pass-all rate and each check's own count, then every failure with its reason.
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + "%" : "-");
console.log(`\nPass all: ${result.passAll} of ${result.total} traces (${pct(result.passAll, result.total)})`);
for (const c of TRACE_CHECKS) { const k = result.perCheck[c.id]; console.log(`  ${c.id.padEnd(13)} ${String(k.passed).padStart(4)} of ${String(k.applied).padEnd(4)} ${k.applied ? pct(k.passed, k.applied) : "(none applied)"}`); }
for (const c of SITE_CHECKS) { const v = result.site[c.id]; console.log(`  ${c.id.padEnd(13)} ${v.pass ? "pass" : "FAIL: " + v.why}`); }
const failed = result.traces.filter((r) => !r.pass);
if (failed.length) console.log("\nFailures:");
for (const r of failed) for (const [id, v] of Object.entries(r.verdicts)) if (!v.pass) console.log(`  ${r.id} ${r.date} ${r.view} ${r.window} ${r.lang}: ${id}: ${v.why}`);
console.log(`\nWritten to ${outDir} (report.html to review the traces)`);
process.exitCode = failed.length || !result.sitePass ? 1 : 0;
