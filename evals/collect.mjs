// Draws each trace of a plan on the site in headless Chromium and records what a visitor gets: the facts behind the
// picture (the day's or block's data and its totals, the chart's bars, axes, words and where they sit on screen, the
// toolbar, errors in the console) and, with shots, a screenshot. It drives the page through its own functions (goTo,
// goToBlock, setViewMode, ...), as the toolbar does, presses the real step buttons where a trace asks for steps, and
// computes what the checks compare against independently of the page's code where it can (the totals, the share of
// coins at or below the price, whether a marked range holds any coin).

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const VIEW = { "usd-lthsth": [0, "split"], "usd-age": [0, "age"], "btc-lthsth": [1, "split"], "btc-age": [1, "age"] };
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const BRK = "https://bitview.space";
const STEP_BUTTON = { "1B": 0, "1D": 1, "1W": 2, "1M": 3, "1Y": 4 };

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
  const raw = rawCache[d.key || d.dateStr] || {};
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
  // Whether any coin last moved at a price inside the marked range, from the raw data.
  let coinsInMark = null;
  if (window.rangeMark) {
    coinsInMark = false;
    for (const c of raw.age || []) for (const k in c || {}) if (c[k] > 0 && Number(k) >= rangeMark.lo && Number(k) < rangeMark.hi) coinsInMark = true;
  }
  // A marked range's white lines against the bars as drawn: each line's pixel column, in px from the plot's left edge,
  // and how much of its width bars cover (none for a line in the gap between two bars). Read off the SVG Plotly drew,
  // not worked out the page's way. The bars' spans are merged first: a stacked bar is one path per age band over the
  // same pixels, and adding each band's overlap counted the same hundredth of a pixel once per band (a good trace
  // read 0.07 px on 14 Nov 2026 and failed).
  let markEdges = null;
  if (window.rangeMark && gd._fullLayout && gd._fullLayout.xaxis) {
    const xa = gd._fullLayout.xaxis, spans = [];
    for (const p of gd.querySelectorAll(".barlayer .point path")) {
      const m = /^M([\d.]+),([\d.]+)V([\d.]+)H([\d.]+)V/.exec(p.getAttribute("d") || "");
      if (m && +m[2] !== +m[3]) spans.push([Math.min(+m[1], +m[4]), Math.max(+m[1], +m[4])]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const s of spans) { const last = merged[merged.length - 1]; if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]); else merged.push([s[0], s[1]]); }
    const r2 = (v) => Math.round(v * 100) / 100;
    markEdges = { pitch: r2(xa._length * d.binWidth / (xa.range[1] - xa.range[0])),
      lines: (L.shapes || []).filter((s) => s.type === "line" && s.xref === "x" && s.line && s.line.color === MARK_EDGE).map((s) => {
        const c = xa.l2p(s.x0), w = s.line.width || 1;
        return { c: r2(c), w, onBar: r2(merged.reduce((t, [x0, x1]) => t + Math.max(0, Math.min(x1, c + w / 2) - Math.max(x0, c - w / 2)), 0)) };
      }) };
  }
  // The share of the coins in profit, counted here from the raw buckets. BRK records each coin's price to four
  // significant figures of the price in cents, so a recorded price p stands for [p - step/2, p + step/2): `rule` is the
  // site's own count (recorded prices at or below the price), `lo` the coins surely in profit (their whole interval at
  // or below the price) and `hi` all but those surely in loss. The true share lies from lo to hi.
  let inProfit = null;
  if (d.spot > 0 && raw.all) {
    const step = (p) => (p < 100 ? 0.01 : p < 1e3 ? 0.1 : p < 1e4 ? 1 : p < 1e5 ? 10 : p < 1e6 ? 100 : p < 1e7 ? 1000 : 10000);
    let tot = 0, rule = 0, sure = 0, lost = 0;
    for (const k in raw.all) {
      const p = Number(k), s = raw.all[k];
      if (!(s > 0)) continue;
      tot += s;
      if (p <= d.spot) rule += s;
      const h = step(p) / 2;
      if (p + h <= d.spot + 1e-9) sure += s;
      else if (p - h > d.spot + 1e-9) lost += s;
    }
    if (tot > 0) inProfit = { rule: 100 * rule / tot, lo: 100 * sure / tot, hi: 100 * (tot - lost) / tot };
  }
  const ctl = document.getElementById("controls"), status = document.getElementById("status");
  // The toolbar's items, and how many sit below the first row (none when it is one row).
  const items = [...ctl.children].map((e) => box(e)).filter(Boolean), firstRowBottom = Math.min(...items.map((b) => b[3]));
  const pressed = document.querySelector("#intervalBar .iv.active");
  return {
    date: d.dateStr, key: d.key || d.dateStr, spot: d.spot, profitPctCoin: d.profitPctCoin, profitPct: d.profitPct, coin: coinMode, split: splitMode, lang,
    block: d.isBlock ? { height: d.height, time: d.time } : null, dayHeight: d.isBlock ? null : d.height,
    stepSize: pressed ? pressed.textContent.trim() : null, tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    settings: { bins: NUM_BINS, smoothing: KERNEL_PCT, ymax: yMaxPct }, mark: window.rangeMark ? { lo: rangeMark.lo, hi: rangeMark.hi } : null, coinsInMark, markEdges, inProfit,
    raw: { ...sum(raw.all), bands: ages.length, sth: ages.slice(0, STH_BANDS).reduce((a, b) => a + b.supply, 0), lth: ages.slice(STH_BANDS).reduce((a, b) => a + b.supply, 0) },
    title: strip(L.title && L.title.text), counter: document.getElementById("dateDisplay").textContent, dayNumber: allDates.indexOf(d.dateStr) + 1, days: allDates.length,
    notice: status && status.offsetParent && status.textContent.trim() ? status.textContent.trim() : "",
    loading: document.getElementById("loading").style.display !== "none",
    xRange: L.xaxis && L.xaxis.range, yRange: L.yaxis && L.yaxis.range, bars, annotations: anns,
    legend: box(gd.querySelector("g.legend")), titleBox: box(gd.querySelector(".g-gtitle text") || gd.querySelector(".gtitle")),
    // The dot on the selected day: a page element over the chart, so it hides whatever it sits on.
    tracer: (() => { const el = document.getElementById("tracer"); return el && getComputedStyle(el).display !== "none" ? box(el) : null; })(),
    plot: gd._fullLayout && gd._fullLayout.xaxis ? [gd.getBoundingClientRect().left + gd._fullLayout.xaxis._offset, gd.getBoundingClientRect().top + gd._fullLayout.yaxis._offset,
      gd.getBoundingClientRect().left + gd._fullLayout.xaxis._offset + gd._fullLayout.xaxis._length, gd.getBoundingClientRect().top + gd._fullLayout.yaxis._offset + gd._fullLayout.yaxis._length].map((v) => Math.round(v * 10) / 10) : null,
    toolbar: { hidden: getComputedStyle(ctl).display === "none", scrollWidth: ctl.scrollWidth, clientWidth: ctl.clientWidth,
      belowFirstRow: items.filter((b) => b[1] >= firstRowBottom - 1).length },
    page: { innerWidth, innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight },
    youtube: [...document.querySelectorAll("#ytMenu a.yt-item")].map((a) => a.href),
  };
}

// Polls a condition in the page until it holds. Not page.waitForFunction: Playwright 1.47 runs that through eval, which
// the site's Content-Security-Policy refuses (no 'unsafe-eval'), and the evals load the page with its policy on, as a
// visitor does, so a broken policy fails them. A draw the page gave up on is not waited out: once it puts up a notice
// (its own word for what went wrong) with nothing left loading, that notice is the error.
async function until(page, fn, arg, timeout = 240000) {
  const end = Date.now() + timeout;
  let noticeSince = 0;
  for (;;) {
    if (await page.evaluate(fn, arg).catch(() => false)) return;
    const notice = await page.evaluate(() => {
      const s = document.getElementById("status"), l = document.getElementById("loading");
      return s && s.offsetParent && s.textContent.trim() && l && l.style.display === "none" && !window.navTimer ? s.textContent.trim() : "";
    }).catch(() => "");
    if (notice) { noticeSince = noticeSince || Date.now(); if (Date.now() - noticeSince > 2500) throw new Error("the page gave up: " + notice.slice(0, 200)); }
    else noticeSince = 0;
    if (Date.now() > end) throw new Error("timed out after " + timeout / 1000 + " s waiting for the chart");
    await page.waitForTimeout(250);
  }
}

// The chart has drawn `key` (a day's date, or "h" and a block's height) and is at rest.
async function settled(page, key) {
  await until(page, (k) => !!(window.lastRenderedData && (lastRenderedData.key || lastRenderedData.dateStr) === k &&
    document.getElementById("loading").style.display === "none"), key);
  for (let i = 0; i < 3; i++) { await page.evaluate(() => chartRenderPromise); await page.waitForTimeout(350); }
}
// After a press of a toolbar button: whatever it started (a debounced step, a draw, a look for a newer block) is done.
async function atRest(page) {
  await page.waitForTimeout(200);
  await until(page, () => !window.navTimer && !window.tipCheck && !Object.keys(window.rawInflight || {}).some((k) => k === currentKey() + modeKey()) &&
    document.getElementById("loading").style.display === "none", null, 120000);
  for (let i = 0; i < 3; i++) { await page.evaluate(() => chartRenderPromise); await page.waitForTimeout(300); }
}

async function getJSON(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { "user-agent": "bitcoinurpd-evals" } });
  if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
  return r.json();
}

export async function collect(plan, { site, outDir, shots = false, log = console.log }) {
  if (shots) fs.mkdirSync(path.join(outDir, "shots"), { recursive: true });
  const browser = await chromium.launch();
  const pages = {}, traces = [];
  let tip = null;   // the newest block BRK has worked out, asked once a run
  async function pageFor(win, tz) {
    const id = win + "|" + (tz || "");
    if (pages[id]) return pages[id];
    const [w, h] = plan.windows[win], phone = win === "phone" || win === "landscape";
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone,
      userAgent: phone ? PHONE_UA : undefined, timezoneId: tz || undefined });
    const page = await ctx.newPage(), events = [];
    // A console error names what it is about only in its location (a failed request's address), so that is kept too.
    page.on("console", (m) => { if (m.type() === "error") events.push("console error: " + m.text().slice(0, 300) + ((m.location() || {}).url ? " [" + m.location().url.slice(0, 140) + "]" : "")); });
    page.on("pageerror", (e) => events.push("page error: " + String(e).slice(0, 300)));
    page.on("requestfailed", (r) => { if (!/youtube|google/.test(r.url())) events.push("request failed: " + r.url().slice(0, 140) + " " + ((r.failure() || {}).errorText || "")); });
    page.on("response", (r) => { if (r.status() >= 400) events.push("HTTP " + r.status() + ": " + r.url().slice(0, 140)); });
    const t0 = Date.now();
    await page.goto(site, { waitUntil: "load", timeout: 120000 });
    await until(page, () => !!(window.allDates && allDates.length && window.lastRenderedData));
    await page.waitForTimeout(800);
    const defaults = await page.evaluate(() => JSON.stringify(captureChartSettings()));
    pages[id] = { page, events, defaults, firstLoadMs: Date.now() - t0 };
    return pages[id];
  }
  // One try at a trace: its facts, or an error thrown.
  async function draw(tr, P, shotFile) {
    const { page, events } = P;
    events.length = 0;
    const date = await page.evaluate((d) => d === "latest" ? allDates[allDates.length - 1] : d === "latest-complete" ? allDates[allDates.length - 2] : d, tr.date);
    if (!(await page.evaluate((d) => allDates.indexOf(d) >= 0, date))) throw new Error("the site does not list " + date);
    // Back to the defaults (a day, stepping 1D, nothing marked), then this trace's view, language and settings, as the
    // toolbar sets them.
    await page.evaluate(([def, view, bars, lng, s]) => {
      rangeMark = null; if (window.peakStore) for (const k in peakStore) delete peakStore[k];
      restoreChartSettings(JSON.parse(def)); viewIdx = view; coinMode = view === 1; splitMode = bars === "split"; yMaxPct = yMaxByMode[viewIdx];
      if (s.bins) NUM_BINS = s.bins; if (s.smoothing !== undefined) KERNEL_PCT = s.smoothing; if (s.ymax) { yMaxPct = s.ymax; yMaxByMode[viewIdx] = s.ymax; }
      if (stepIdx !== 1) setInterval1(1);
      syncControls();
      if (lang !== lng) { lang = lng; applyLang(); }
    }, [P.defaults, VIEW[tr.view][0], VIEW[tr.view][1], tr.lang, tr.settings || {}]);
    // The block asked for, as a height: given, the newest BRK has worked out, or by where it falls in the trace's day.
    let height = null;
    if (typeof tr.block === "number") height = tr.block;
    else if (tr.block === "tip") { if (tip === null) tip = (await getJSON(BRK + "/api/server/sync")).computed_height; height = tip; }
    else if (tr.block) {
      height = await page.evaluate(([d, where]) => {
        const i = allDates.indexOf(d), first = dayFirstHeight[i], last = dayLastHeight(i);
        if (!isHeight(first) || last === null) return null;
        return where === "first" ? first : where === "last" ? last : where === "before-last" ? Math.max(first, last - 1) : first + Math.floor((last - first) / 2);
      }, [date, tr.block]);
      if (height === null) throw new Error("the site does not know the blocks of " + date);
    }
    // What the trace asks to see: a day or a block (after presses of the step buttons, wherever those lead: the
    // block-steps check follows them).
    const asked = tr.steps ? { date: null, height: null } : { date: height === null ? date : null, height };
    let key = date;
    if (height !== null) {
      key = "h" + height;
      await page.evaluate((h) => { goToBlock(h, true); }, height);
    } else await page.evaluate((d) => { goTo(allDates.indexOf(d), true); loadAndRender(); }, date);
    await settled(page, key);
    if (tr.settings && tr.settings.pin) {   // pin this day's scale, then step a week on, drawn against it
      await page.evaluate(() => { peakPin(); rerenderCurrent(); });
      await page.waitForTimeout(500);
      key = await page.evaluate(() => allDates[Math.min(allDates.length - 1, currentIdx + 7)]);
      await page.evaluate((d) => goTo(allDates.indexOf(d), true), key);
      await settled(page, key);
      asked.date = key;
    }
    // The step buttons, pressed as a visitor presses them, and where each press left the chart.
    let stepped = null;
    if (tr.steps) {
      stepped = [{ press: "start", ...(await page.evaluate(() => ({ key: lastRenderedData.key || lastRenderedData.dateStr, date: lastRenderedData.dateStr,
        height: lastRenderedData.height, isBlock: !!lastRenderedData.isBlock, last: dayLastHeight(allDates.indexOf(lastRenderedData.dateStr)),
        first: dayFirstHeight[allDates.indexOf(lastRenderedData.dateStr)], nextFirst: dayFirstHeight[allDates.indexOf(lastRenderedData.dateStr) + 1] }))) }];
      for (const press of tr.steps) {
        if (press in STEP_BUTTON) await page.click(`#intervalBar .iv[data-idx="${STEP_BUTTON[press]}"]`);
        else if (press === "prev" || press === "next") await page.click(press === "prev" ? "#btnPrev" : "#btnNext");
        else if (/^key:/.test(press)) await page.keyboard.press(press.slice(4));
        else throw new Error("unknown step " + press);
        await atRest(page);
        stepped.push({ press, ...(await page.evaluate(() => ({ key: lastRenderedData.key || lastRenderedData.dateStr, date: lastRenderedData.dateStr,
          height: lastRenderedData.height, isBlock: !!lastRenderedData.isBlock, last: dayLastHeight(allDates.indexOf(lastRenderedData.dateStr)),
          first: dayFirstHeight[allDates.indexOf(lastRenderedData.dateStr)], nextFirst: dayFirstHeight[allDates.indexOf(lastRenderedData.dateStr) + 1],
          stepSize: (document.querySelector("#intervalBar .iv.active") || {}).textContent, newest: newestHeight,
          notice: (() => { const s = document.getElementById("status"); return s && s.offsetParent ? s.textContent.trim() : ""; })() }))) });
      }
      key = stepped[stepped.length - 1].key;
    }
    if (tr.mark) {   // a marked range over whole bins, as a click and drag leaves it
      await page.evaluate((m) => {
        const d = lastRenderedData, w = d.binWidth, span = d.aggAll.length * w, i0 = Math.floor(m[0] * span / w);
        rangeMark = { lo: i0 * w, hi: Math.max(i0 + 1, Math.ceil(m[1] * span / w)) * w };
        rerenderCurrent();
      }, tr.mark);
      await page.waitForTimeout(400); await page.evaluate(() => chartRenderPromise);
      // The box's days line needs the daily highs and lows, fetched the first time a range is marked: until they are
      // in it reads "…" (20 s at most; a box still reading "…" after that is a failure the mark-box check names).
      await until(page, () => !window.priceHighLowLoading, null, 20000).catch(() => {});
      await page.waitForTimeout(400); await page.evaluate(() => chartRenderPromise); await page.waitForTimeout(300);
    }
    // The page keeps the raw buckets of its ten latest days only and draws a day it has seen before from its binned
    // copy, so a day drawn again may have none: fetch them, or every total would read zero (found when the checks
    // were first run, on the language traces, which come back to days drawn earlier).
    await page.evaluate(async (k) => { if (!rawComplete(rawCache[k])) await fetchRaw(k); }, key);
    const facts = await page.evaluate(pageFacts);
    if (shotFile) await page.screenshot({ path: path.join(outDir, shotFile) });
    return { shown: facts.block ? "block " + facts.block.height : facts.date, asked, facts, stepped, events: events.slice() };
  }
  for (const tr of plan.traces) {
    const started = Date.now(), shot = shots ? path.join("shots", tr.id + ".png") : null;
    let P;
    try { P = await pageFor(tr.window, tr.tz); }
    catch (e) { traces.push({ ...tr, error: "the page did not load: " + String(e.message || e).slice(0, 300) }); log(tr.id, "the page did not load"); continue; }
    // A draw that fails is tried once more after 20 s: a single request to BRK that hangs (14 Nov 2026: one of a
    // day's 23 took over 15 s, once in two weeks of runs) should not read as the site being down. The first try's
    // error is kept on the trace either way, and a trace that needed its second try is reported.
    let firstError = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const got = await draw(tr, P, shot);
        traces.push({ ...tr, ...got, ms: Date.now() - started, firstLoadMs: P.firstLoadMs, shot, tries: attempt, firstError });
        log(tr.id, got.shown, tr.view, tr.window, tr.lang, tr.tz || "", Date.now() - started + " ms", got.events.length ? got.events.length + " console/network events" : "", firstError ? "(second try; first: " + firstError.slice(0, 80) + ")" : "");
        break;
      } catch (e) {
        const why = String(e.message || e).slice(0, 400);
        if (attempt === 1) { firstError = why; log(tr.id, "first try failed:", why.slice(0, 160)); await P.page.waitForTimeout(20000); continue; }
        if (shot) await P.page.screenshot({ path: path.join(outDir, shot) }).catch(() => {});
        traces.push({ ...tr, error: why, firstError, tries: 2, events: P.events.slice(), shot });
        log(tr.id, "ERROR", why.slice(0, 200));
      }
    }
  }
  await browser.close();
  return traces;
}
