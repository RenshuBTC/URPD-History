// The evaluators: one binary check per failure mode found by error analysis (see README.md), each pure code over a
// trace's recorded facts, the independent reference series (BRK's own day series) and the site's data files. Each
// says which traces it applies to and, for those, pass or fail with the reason. No check scores or weighs: a trace
// passes when it passes every check that applies to it.

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Sept: 8, Oct: 9, Nov: 10, Dec: 11 };
// The day a chart title names: "... as of 04 Nov 2026" (en) or "... 2026年11月4日" (zh, ja), as YYYY-MM-DD.
export function titleDay(title) {
  let m = /(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec) (\d{4})\s*$/.exec(title || "");
  if (m) return new Date(Date.UTC(+m[3], MONTHS[m[2]], +m[1])).toISOString().slice(0, 10);
  m = /(\d{4})年(\d{1,2})月(\d{1,2})日\s*$/.exec(title || "");
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString().slice(0, 10) : null;
}
const flat = (s) => String(s || "").replace(/ \| /g, "").replace(/\s+/g, "");
const close = (a, b, rel, abs = 0) => Math.abs(a - b) <= Math.max(abs, rel * Math.abs(b));

// The marked-range box's words in each language, as the site prints them (index.html, T).
const MARK = {
  en: { none: ["NoBTCLastMovedHere", "NoBTC"], lth: ["AllLTHWithin:", "AlreadyAllLong-TermHolders", "Days"] },
  zh: { none: ["没有最后在此移动的BTC", "无BTC"], lth: ["全部成为长期持有者:", "已全部为长期持有者", "天内"] },
  ja: { none: ["ここで最後に動いたBTCはありません", "BTCなし"], lth: ["すべて長期保有者になるまで:", "すでにすべて長期保有者", "日以内"] },
};

const markBox = (f) => f.annotations.find((a) => a.xref === "x" && a.width);
const emptyNote = (f) => f.annotations.find((a) => a.xref === "paper" && a.yref === "paper" && a.x === 0.5 && a.y === 0.62);
const overlap = (a, b) => a && b && a[0] < b[2] - 0.5 && b[0] < a[2] - 0.5 && a[1] < b[3] - 0.5 && b[1] < a[3] - 0.5;
// The data checks leave out the day in progress: its reference moves with every block while the run is reading it.
const settledDay = (t, ctx) => !t.error && t.facts && t.facts.date !== ctx.inProgress;

export const TRACE_CHECKS = [
  {
    id: "draws",
    failure: "The day does not draw: an error notice, a script error, a failed data request or the loading sign left up.",
    seen: "#191: bitview.space changed its API and the site could not load any day; found by the owner, not by a check",
    applies: () => true,
    judge(t) {
      if (t.error) return [false, t.error];
      const f = t.facts;
      if (f.notice) return [false, "notice: " + f.notice.slice(0, 120)];
      if (f.loading) return [false, "the loading sign is still up"];
      // A request the page called off itself after 15 s without an answer (fetchJSON) is net::ERR_ABORTED here. For the
      // day on screen the notice above then says so; for a nearby day it was fetching ahead, the day shown still drew.
      // (6 Nov 2026: a prefetch called off that way turned a good trace red.)
      const bad = (t.events || []).find((e) => !/youtube|google|fonts\./.test(e) && !/^request failed: .* net::ERR_ABORTED$/.test(e));
      if (bad) return [false, bad.slice(0, 160)];
      return [true];
    },
  },
  {
    id: "right-day",
    failure: "The chart shows another day than the one asked for: title, counter, data or price from a different day.",
    seen: "#6: the price was two days behind; #4: a one-day timezone shift in the price overlay",
    applies: (t) => !t.error && !!t.facts,
    judge(t, ctx) {
      const f = t.facts;
      if (f.date !== t.shown) return [false, "data for " + f.date + ", asked for " + t.shown];
      const td = titleDay(f.title);
      if (td !== t.shown) return [false, "the title names " + td + ": " + f.title];
      if (!String(f.counter).startsWith(f.dayNumber + "/" + f.days)) return [false, "the counter reads " + f.counter + ", day " + f.dayNumber + " of " + f.days];
      if (f.date === ctx.inProgress) return [true];
      const ref = ctx.ref("price_close", f.date);
      if (ref > 0 ? f.spot !== ref : f.spot > 0) return [false, "price " + f.spot + ", BRK's close " + ref];
      return [true];
    },
  },
  {
    id: "supply",
    failure: "The day's coins do not add up to the circulating supply: an age band or a bucket was lost on the way in.",
    seen: "#99: partial cohort loads were retried; #191: a changed response shape",
    applies: settledDay,
    judge(t, ctx) {
      const ref = ctx.ref("circulating_supply", t.facts.date);
      if (ref == null) return [false, "no reference for " + t.facts.date];
      return close(t.facts.raw.supply, ref, 1e-7, 1e-6) ? [true] : [false, "supply " + t.facts.raw.supply + ", BRK " + ref];
    },
  },
  {
    id: "realized-cap",
    failure: "The day's value (each coin at its price when last moved) does not add up to the realized cap.",
    seen: "#191: prices now come rounded to four significant figures; a wrong rounding would show here",
    applies: settledDay,
    judge(t, ctx) {
      const ref = ctx.ref("realized_cap", t.facts.date);
      if (ref == null) return [false, "no reference for " + t.facts.date];
      return close(t.facts.raw.value, ref, 1e-3, 1e-6) ? [true] : [false, "value " + t.facts.raw.value.toFixed(0) + ", BRK realized cap " + ref];
    },
  },
  {
    id: "holders",
    failure: "Short-term holders (the bands under 150 days) or long-term holders do not match BRK's own STH and LTH supply.",
    seen: "the LTH/STH split is the default view; it was cross-checked by hand before (see README)",
    applies: (t, ctx) => settledDay(t, ctx) && t.facts.raw.bands === 23,
    judge(t, ctx) {
      const f = t.facts, sth = ctx.ref("sth_supply", f.date), lth = ctx.ref("lth_supply", f.date);
      if (sth == null || lth == null) return [false, "no reference for " + f.date];
      if (!close(f.raw.sth, sth, 1e-7, 1e-6)) return [false, "STH " + f.raw.sth + ", BRK " + sth];
      if (!close(f.raw.lth, lth, 1e-7, 1e-6)) return [false, "LTH " + f.raw.lth + ", BRK " + lth];
      return [true];
    },
  },
  {
    id: "in-profit",
    failure: "The price box's share of coins in profit disagrees with BRK's supply in profit by more than the buckets explain.",
    seen: "#144: the box and Percent of Total disagreed at the dashed line by up to 2.2 points",
    applies: (t, ctx) => settledDay(t, ctx) && t.facts.spot > 0 && t.facts.profitPctCoin != null,
    judge(t, ctx) {
      // The box counts BRK's buckets (prices to four significant figures) at or below the close, as Percent of Total
      // does (#144); BRK counts each coin's own price. Coins in the close's bucket can fall either way: up to 0.31
      // points on the 98 reviewed days (crash and top days), so half a point.
      const ref = ctx.ref("supply_in_profit_share", t.facts.date);
      if (ref == null) return [false, "no reference for " + t.facts.date];
      return Math.abs(t.facts.profitPctCoin - ref) <= 0.5 ? [true] : [false, "in profit " + t.facts.profitPctCoin.toFixed(3) + "%, BRK " + ref + "%"];
    },
  },
  {
    id: "bars-total",
    failure: "The bars drawn do not add up to the whole day (100 %): some fell off the axis or out of the bins.",
    seen: "#109, #110: axes that only grow; a zero bin width once dropped a whole day (buildData)",
    applies: (t) => !t.error && !!t.facts && t.facts.raw.supply > 0 && (t.facts.coin || t.facts.raw.value > 0),
    judge(t) {
      const s = t.facts.bars.filter((b) => b.visible).reduce((a, b) => a + b.sum, 0);
      return Math.abs(s - 100) <= 0.01 ? [true] : [false, "the bars add up to " + s.toFixed(4) + "%"];
    },
  },
  {
    id: "labels-clear",
    failure: "Words on the chart collide or leave the window: the price box, marked-range box, pin and ▲ labels, credits.",
    seen: "#24: the price box ran off the plot; #39, #76: legend and title clearance; #118, #174: boxes over labels",
    applies: (t) => !t.error && !!t.facts,
    judge(t) {
      const f = t.facts, boxes = f.annotations.filter((a) => a.box), W = f.page.innerWidth, H = f.page.innerHeight;
      for (const a of boxes) {
        const b = a.box;
        if (b[0] < -0.5 || b[1] < -0.5 || b[2] > W + 0.5 || b[3] > H + 0.5) return [false, "outside the window: " + a.text.slice(0, 50)];
        if (overlap(b, f.legend)) return [false, "on the legend: " + a.text.slice(0, 50)];
        if (overlap(b, f.titleBox)) return [false, "on the title: " + a.text.slice(0, 50)];
      }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++)
        if (overlap(boxes[i].box, boxes[j].box)) return [false, boxes[i].text.slice(0, 30) + " overlaps " + boxes[j].text.slice(0, 30)];
      return [true];
    },
  },
  {
    id: "fits-window",
    failure: "The page is wider than the window, or the toolbar wraps or scrolls.",
    seen: "#15, #101: the toolbar must stay one row; #94, #88: the whole figure on a phone",
    applies: (t) => !t.error && !!t.facts,
    judge(t) {
      const f = t.facts;
      if (f.page.scrollWidth > f.page.innerWidth + 1) return [false, "page " + f.page.scrollWidth + " px wide in a " + f.page.innerWidth + " px window"];
      if (!f.toolbar.hidden && f.toolbar.scrollWidth > f.toolbar.clientWidth + 1) return [false, "the toolbar scrolls: " + f.toolbar.scrollWidth + " > " + f.toolbar.clientWidth];
      if (!f.toolbar.hidden && f.toolbar.belowFirstRow > 0) return [false, f.toolbar.belowFirstRow + " toolbar items wrapped to a second row"];
      return [true];
    },
  },
  {
    id: "mark-box",
    failure: "A marked range's box says something untrue: long-term holders (or 0 days) where no coin last moved, or no coins where some did.",
    // (Its share lines, removed in #192 and checked for here until the owner asked for them back on 6 Nov 2026, are
    // shown again.)
    seen: "error analysis: t111 said Already All Long-Term Holders and t116 said 0 Days over ranges holding no coin",
    applies: (t) => !t.error && !!t.facts && !!t.facts.mark,
    judge(t) {
      const f = t.facts, box = markBox(f), words = MARK[f.lang] || MARK.en;
      if (!box) return [true];   // too narrow for any words: no box, which says nothing untrue
      const text = flat(box.text), saysNone = words.none.some((w) => text.endsWith(w)), saysLth = words.lth.some((w) => text.includes(w));
      if (f.coinsInMark === false && !saysNone) return [false, "no coin last moved in the range, the box says: " + box.text.slice(0, 80)];
      if (f.coinsInMark === true && saysNone) return [false, "coins last moved in the range, the box says none: " + box.text.slice(0, 80)];
      if (f.coinsInMark === true && !saysLth && !/…$/.test(box.text)) return [false, "no days line: " + box.text.slice(0, 80)];
      return [true];
    },
  },
  {
    id: "mark-edges",
    failure: "A marked range's white line is drawn over a bar instead of in the gap beside it, so the mark seems to cut a bar and a drag slides instead of moving a bar at a time.",
    seen: "6 Nov 2026: the owner asked for the drag to go a bar at a time; in Chromium a line covered part of a bar at 36 of 36 drag steps (up to 1.8 px), fixed in #196",
    // Where the chart leaves a gap between bars (2 px apart or more); narrower bars are solid and the line takes the
    // separator's pixel, by design.
    applies: (t) => !t.error && !!t.facts && !!t.facts.markEdges && t.facts.markEdges.pitch >= 2,
    judge(t) {
      const e = t.facts.markEdges;
      if (e.lines.length !== 2) return [false, e.lines.length + " white lines, not 2"];
      const over = e.lines.find((l) => l.onBar > 0.05);
      return over ? [false, "a white line over a bar: " + over.onBar + " px of it covered, at " + over.c + " px"] : [true];
    },
  },
  {
    id: "empty-note",
    failure: "A day with nothing to draw in its weighting shows an empty plot with no word why (or a day with bars shows the note).",
    seen: "error analysis: 14 of 117 traces (genesis day, every coin at $0 before the first close) were blank and unexplained",
    applies: (t) => !t.error && !!t.facts,
    judge(t) {
      const f = t.facts, nothing = !(f.raw.supply > 0) || (f.coin ? !(f.raw.maxPrice > 0) : !(f.raw.value > 0)), note = emptyNote(f);
      if (nothing && !note) return [false, "nothing to draw and no note saying why"];
      if (!nothing && note) return [false, "a note on a day with bars: " + note.text.slice(0, 60)];
      return [true];
    },
  },
];

// Checks on the site's own data files, once a run (today: YYYY-MM-DD, UTC).
export const SITE_CHECKS = [
  {
    id: "video-links",
    failure: "The video menu does not open the latest four videos: a link falls back to the channel, or the videos are over 45 days old.",
    seen: "#182, #188: the four videos in one menu, now drawn monthly; the video workflow failed twice on 31 Oct 2026",
    judge({ youtube, links, today }) {
      const keys = ["usd-lthsth", "usd-age", "btc-lthsth", "btc-age"];
      if (!youtube) return [false, "data/youtube.json did not load"];
      if (!links) return [false, "no trace drew, so the menu's links could not be read"];
      for (const k of keys) {
        const v = youtube[k];
        if (!v || !/^[A-Za-z0-9_-]{11}$/.test(v.id || "")) return [false, k + " has no video"];
        if (!(links || []).includes("https://www.youtube.com/watch?v=" + v.id)) return [false, "the menu does not link " + k + " (" + v.id + ")"];
        const age = (Date.parse(today) - Date.parse(v.end)) / 864e5;
        if (!(age <= 45)) return [false, k + " runs to " + v.end + ", " + Math.round(age) + " days ago"];
      }
      return [true];
    },
  },
  {
    id: "axis-history",
    failure: "The axis history (data/scales.json) has stopped growing: the daily job is not running.",
    seen: "the daily job commits it; the video workflow failed twice on 31 Oct 2026",
    judge({ scales, today }) {
      if (!scales || typeof scales.end !== "string") return [false, "data/scales.json did not load"];
      const age = (Date.parse(today) - Date.parse(scales.end)) / 864e5;
      return age <= 2 ? [true] : [false, "it ends " + scales.end + ", " + age + " days ago"];
    },
  },
];

// Every check on every trace it applies to, and the site checks; a trace passes when it passes all of them.
export function judge(traces, ctx, site) {
  const rows = traces.map((t) => {
    const verdicts = {};
    for (const c of TRACE_CHECKS) {
      let applies = false;
      try { applies = c.applies(t, ctx); } catch (e) { applies = false; }
      if (!applies) continue;
      try { const [pass, why] = c.judge(t, ctx); verdicts[c.id] = { pass: !!pass, why: why || "" }; }
      catch (e) { verdicts[c.id] = { pass: false, why: "check failed to run: " + String(e.message || e).slice(0, 120) }; }
    }
    return { id: t.id, date: t.shown || t.date, view: t.view, window: t.window, lang: t.lang, settings: t.settings, mark: t.mark, shot: t.shot,
      pass: Object.values(verdicts).every((v) => v.pass), verdicts };
  });
  const siteVerdicts = {};
  if (site) for (const c of SITE_CHECKS) {
    try { const [pass, why] = c.judge(site); siteVerdicts[c.id] = { pass: !!pass, why: why || "" }; }
    catch (e) { siteVerdicts[c.id] = { pass: false, why: "check failed to run: " + String(e.message || e).slice(0, 120) }; }
  }
  const perCheck = {};
  for (const c of TRACE_CHECKS) {
    const vs = rows.map((r) => r.verdicts[c.id]).filter(Boolean);
    perCheck[c.id] = { applied: vs.length, passed: vs.filter((v) => v.pass).length };
  }
  return { traces: rows, site: siteVerdicts, perCheck, passAll: rows.filter((r) => r.pass).length, total: rows.length,
    sitePass: Object.values(siteVerdicts).every((v) => v.pass) };
}
