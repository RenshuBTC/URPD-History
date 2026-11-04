// Draws each trace of a plan on the site in headless Chromium and records what a visitor gets: the facts behind the
// picture (the day's data and its totals, the chart's bars, axes, words and where they sit on screen, the toolbar,
// errors in the console) and, with shots, a screenshot. It drives the page through its own functions (goTo,
// setViewMode, ...), as the toolbar does, and computes what the checks compare against independently of the page's
// code where it can (the totals, whether a marked range holds any coin).

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const VIEW = { "usd-lthsth": [0, "split"], "usd-age": [0, "age"], "btc-lthsth": [1, "split"], "btc-age": [1, "age"] };
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

// Runs in the page once a trace is drawn.
function pageFacts() {
  const strip = (s) => String(s == null ? "" : s).replace(/<br\s*\/?>/gi, " | ").replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width || r.height ? [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v * 10) / 10) : null;
  };
  const gd = document.getElementById("chart"), L = gd.layout || {}, d = window.lastRenderedData;
  const raw = rawCache[d.dateStr] || {};
  const sum = (o) => { let s = 0, v = 0, max = 0; for (const k in o || {}) { const p = Number(k); s += o[k]; v += p * o[k]; if (o[k] > 0 && p > max) max = p; } return { supply: s, value: v, maxPrice: max }; };
  const ages = (raw.age || []).map(sum);
  const annEls = [...gd.querySelectorAll("g.annotation")];
  const anns = (L.annotations || []).map((a, i) => {
    const el = annEls.find((e) => e.getAttribute("data-index") === String(i));
    return { text: strip(a.text), xref: a.xref, yref: a.yref, x: a.x, y: a.y, width: a.width || null, color: /color:/.test(String(a.text)),
      box: box(el && (el.querySelector("rect.bg") || el)) };
  });
  const bars = (gd.data || []).filter((t) => t.type === "bar").map((t) => {
    let s = 0, pos = 0; for (const v of t.y || []) if (v > 0) { s += v; pos++; }
    return { name: t.name, sum: s, positive: pos, visible: t.visible !== "legendonly" && t.visible !== false };
  });
  // Whether any coin last moved at a price inside the marked range, from the day's raw data.
  let coinsInMark = null;
  if (window.rangeMark) {
    coinsInMark = false;
    for (const c of raw.age || []) for (const k in c || {}) if (c[k] > 0 && Number(k) >= rangeMark.lo && Number(k) < rangeMark.hi) coinsInMark = true;
  }
  const ctl = document.getElementById("controls"), status = document.getElementById("status");
  // The toolbar's items, and how many sit below the first row (none when it is one row).
  const items = [...ctl.children].map((e) => box(e)).filter(Boolean), firstRowBottom = Math.min(...items.map((b) => b[3]));
  return {
    date: d.dateStr, spot: d.spot, profitPctCoin: d.profitPctCoin, profitPct: d.profitPct, coin: coinMode, split: splitMode, lang,
    settings: { bins: NUM_BINS, smoothing: KERNEL_PCT, ymax: yMaxPct }, mark: window.rangeMark ? { lo: rangeMark.lo, hi: rangeMark.hi } : null, coinsInMark,
    raw: { ...sum(raw.all), bands: ages.length, sth: ages.slice(0, STH_BANDS).reduce((a, b) => a + b.supply, 0), lth: ages.slice(STH_BANDS).reduce((a, b) => a + b.supply, 0) },
    title: strip(L.title && L.title.text), counter: document.getElementById("dateDisplay").textContent, dayNumber: allDates.indexOf(d.dateStr) + 1, days: allDates.length,
    notice: status && status.offsetParent && status.textContent.trim() ? status.textContent.trim() : "",
    loading: document.getElementById("loading").style.display !== "none",
    xRange: L.xaxis && L.xaxis.range, yRange: L.yaxis && L.yaxis.range, bars, annotations: anns,
    legend: box(gd.querySelector("g.legend")), titleBox: box(gd.querySelector(".g-gtitle text") || gd.querySelector(".gtitle")),
    toolbar: { hidden: getComputedStyle(ctl).display === "none", scrollWidth: ctl.scrollWidth, clientWidth: ctl.clientWidth,
      belowFirstRow: items.filter((b) => b[1] >= firstRowBottom - 1).length },
    page: { innerWidth, innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight },
    youtube: [...document.querySelectorAll("#ytMenu a.yt-item")].map((a) => a.href),
  };
}

async function settled(page, date) {
  await page.waitForFunction((d) => window.lastRenderedData && lastRenderedData.dateStr === d &&
    document.getElementById("loading").style.display === "none", date, { timeout: 240000 });
  for (let i = 0; i < 3; i++) { await page.evaluate(() => chartRenderPromise); await page.waitForTimeout(350); }
}

export async function collect(plan, { site, outDir, shots = false, log = console.log }) {
  if (shots) fs.mkdirSync(path.join(outDir, "shots"), { recursive: true });
  const browser = await chromium.launch();
  const pages = {}, traces = [];
  async function pageFor(win) {
    if (pages[win]) return pages[win];
    const [w, h] = plan.windows[win], phone = win === "phone" || win === "landscape";
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone, userAgent: phone ? PHONE_UA : undefined });
    const page = await ctx.newPage(), events = [];
    page.on("console", (m) => { if (m.type() === "error") events.push("console error: " + m.text().slice(0, 300)); });
    page.on("pageerror", (e) => events.push("page error: " + String(e).slice(0, 300)));
    page.on("requestfailed", (r) => { if (!/youtube|google/.test(r.url())) events.push("request failed: " + r.url().slice(0, 140) + " " + ((r.failure() || {}).errorText || "")); });
    page.on("response", (r) => { if (r.status() >= 400) events.push("HTTP " + r.status() + ": " + r.url().slice(0, 140)); });
    const t0 = Date.now();
    await page.goto(site, { waitUntil: "load", timeout: 120000 });
    await page.waitForFunction(() => window.allDates && allDates.length && window.lastRenderedData, null, { timeout: 240000 });
    await page.waitForTimeout(800);
    const defaults = await page.evaluate(() => JSON.stringify(captureChartSettings()));
    pages[win] = { page, events, defaults, firstLoadMs: Date.now() - t0 };
    return pages[win];
  }
  for (const tr of plan.traces) {
    const started = Date.now();
    let P;
    try { P = await pageFor(tr.window); }
    catch (e) { traces.push({ ...tr, error: "the page did not load: " + String(e.message || e).slice(0, 300) }); log(tr.id, "the page did not load"); continue; }
    const { page, events } = P;
    events.length = 0;
    try {
      const date = await page.evaluate((d) => d === "latest" ? allDates[allDates.length - 1] : d === "latest-complete" ? allDates[allDates.length - 2] : d, tr.date);
      if (!(await page.evaluate((d) => allDates.indexOf(d) >= 0, date))) throw new Error("the site does not list " + date);
      // Back to the defaults, then this trace's view, language and settings, as the toolbar sets them.
      await page.evaluate(([def, view, bars, lng, s]) => {
        rangeMark = null; if (window.peakStore) for (const k in peakStore) delete peakStore[k];
        restoreChartSettings(JSON.parse(def)); viewIdx = view; coinMode = view === 1; splitMode = bars === "split"; yMaxPct = yMaxByMode[viewIdx];
        if (s.bins) NUM_BINS = s.bins; if (s.smoothing !== undefined) KERNEL_PCT = s.smoothing; if (s.ymax) { yMaxPct = s.ymax; yMaxByMode[viewIdx] = s.ymax; }
        syncControls();
        if (lang !== lng) { lang = lng; applyLang(); }
      }, [P.defaults, VIEW[tr.view][0], VIEW[tr.view][1], tr.lang, tr.settings || {}]);
      await page.evaluate((d) => { goTo(allDates.indexOf(d), true); loadAndRender(); }, date);
      await settled(page, date);
      let shown = date;
      if (tr.settings && tr.settings.pin) {   // pin this day's scale, then step a week on, drawn against it
        await page.evaluate(() => { peakPin(); rerenderCurrent(); });
        await page.waitForTimeout(500);
        shown = await page.evaluate(() => allDates[Math.min(allDates.length - 1, currentIdx + 7)]);
        await page.evaluate((d) => goTo(allDates.indexOf(d), true), shown);
        await settled(page, shown);
      }
      if (tr.mark) {   // a marked range over whole bins, as a click and drag leaves it
        await page.evaluate((m) => {
          const d = lastRenderedData, w = d.binWidth, span = d.aggAll.length * w, i0 = Math.floor(m[0] * span / w);
          rangeMark = { lo: i0 * w, hi: Math.max(i0 + 1, Math.ceil(m[1] * span / w)) * w };
          rerenderCurrent();
        }, tr.mark);
        await page.waitForTimeout(400); await page.evaluate(() => chartRenderPromise); await page.waitForTimeout(300);
      }
      // The page keeps the raw buckets of its ten latest days only and draws a day it has seen before from its binned
      // copy, so a day drawn again may have none: fetch them, or every total would read zero (found when the checks
      // were first run, on the language traces, which come back to days drawn earlier).
      await page.evaluate(async (d) => { if (!rawComplete(rawCache[d])) await fetchRaw(d); }, shown);
      const facts = await page.evaluate(pageFacts);
      const shot = shots ? path.join("shots", tr.id + ".png") : null;
      if (shot) await page.screenshot({ path: path.join(outDir, shot) });
      traces.push({ ...tr, shown, ms: Date.now() - started, firstLoadMs: P.firstLoadMs, facts, events: events.slice(), shot });
      log(tr.id, shown, tr.view, tr.window, tr.lang, Date.now() - started + " ms", events.length ? events.length + " console/network events" : "");
    } catch (e) {
      const shot = shots ? path.join("shots", tr.id + ".png") : null;
      if (shot) await page.screenshot({ path: path.join(outDir, shot) }).catch(() => {});
      traces.push({ ...tr, error: String(e.message || e).slice(0, 400), events: events.slice(), shot });
      log(tr.id, "ERROR", String(e.message || e).slice(0, 200));
    }
  }
  await browser.close();
  return traces;
}
