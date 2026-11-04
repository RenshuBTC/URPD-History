// A page to review a run's traces by eye, as error analysis starts: every trace's screenshot (when the run took
// them), what it is, and each check's verdict with its reason, failures first. Plain HTML next to the screenshots,
// opened from the out folder; it loads nothing from anywhere else.

import fs from "node:fs";
import { TRACE_CHECKS, SITE_CHECKS } from "./checks.mjs";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function writeReport(result, traces, file) {
  const byId = new Map(traces.map((t) => [t.id, t]));
  const rows = [...result.traces].sort((a, b) => (a.pass === b.pass ? a.id.localeCompare(b.id) : a.pass ? 1 : -1));
  const checks = TRACE_CHECKS.map((c) => {
    const k = result.perCheck[c.id];
    return `<tr><td>${esc(c.id)}</td><td>${k.passed} / ${k.applied}</td><td>${esc(c.failure)}</td><td>${esc(c.seen)}</td></tr>`;
  }).join("") + SITE_CHECKS.map((c) => {
    const v = result.site[c.id] || {};
    return `<tr><td>${esc(c.id)}</td><td>${v.pass ? "pass" : "FAIL " + esc(v.why)}</td><td>${esc(c.failure)}</td><td>${esc(c.seen)}</td></tr>`;
  }).join("");
  const cards = rows.map((r) => {
    const t = byId.get(r.id) || {}, f = t.facts || {};
    const verdicts = Object.entries(r.verdicts).map(([id, v]) => `<li class="${v.pass ? "ok" : "bad"}">${esc(id)}${v.pass ? "" : ": " + esc(v.why)}</li>`).join("");
    const what = [r.date, r.view, r.window, r.lang, Object.keys(r.settings || {}).length ? JSON.stringify(r.settings) : "", r.mark ? "mark " + JSON.stringify(r.mark) : "", t.why || ""].filter(Boolean).join(" · ");
    return `<section class="${r.pass ? "" : "fail"}"><h3>${esc(r.id)} ${r.pass ? "" : "FAIL"}</h3><p>${esc(what)}</p>
      ${t.shot ? `<a href="${esc(t.shot)}"><img src="${esc(t.shot)}" alt="${esc(r.id)}" loading="lazy"></a>` : ""}
      <ul>${verdicts}</ul><p class="small">${esc(f.title || t.error || "")}</p></section>`;
  }).join("\n");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bitcoin URPD evals</title><style>
body{font:14px/1.45 system-ui,sans-serif;margin:16px;background:#fff;color:#111}table{border-collapse:collapse;margin:8px 0 20px}
td,th{border:1px solid #ccc;padding:4px 8px;vertical-align:top;text-align:left}section{border:1px solid #ddd;margin:10px 0;padding:8px}
section.fail{border-color:#c00}img{max-width:100%;border:1px solid #eee}li.ok{color:#555}li.bad{color:#c00;font-weight:600}.small{color:#666;font-size:12px}
</style></head><body><h1>Bitcoin URPD evals</h1>
<p>${esc(result.run.plan)} plan on ${esc(result.run.site)}, ${esc(result.run.at)}. Pass all: <b>${result.passAll} of ${result.total}</b> traces.</p>
<table><tr><th>Check</th><th>Passed</th><th>Failure it catches</th><th>Where it was seen</th></tr>${checks}</table>
${cards}</body></html>`;
  fs.writeFileSync(file, html);
}
