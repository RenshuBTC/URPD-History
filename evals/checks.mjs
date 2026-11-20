// The evaluators: one binary check per failure mode found by error analysis (see README.md), each pure code over a
// trace's recorded facts, the independent reference series (BRK's own series, by day and by block) and the site's
// data files. Each says which traces it applies to and, for those, pass or fail with the reason. No check scores or
// weighs: a trace passes when it passes every check that applies to it.

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Sept: 8, Oct: 9, Nov: 10, Dec: 11 };
// The day a chart title names: "... as of 04 Nov 2026" (en) or "... 2026年11月4日" (zh, ja), as YYYY-MM-DD.
export function titleDay(title) {
  let m = /(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec) (\d{4})\s*$/.exec(title || "");
  if (m) return new Date(Date.UTC(+m[3], MONTHS[m[2]], +m[1])).toISOString().slice(0, 10);
  m = /(\d{4})年(\d{1,2})月(\d{1,2})日\s*$/.exec(title || "");
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString().slice(0, 10) : null;
}
// What a block's title names: its height, and its time as the visitor's clock has it. "... as of Block 840,000 (20 Apr
// 2024 08:09 GMT+8)" (en), "... 区块 840,000（2024年4月20日 08:09 GMT+8）" (zh), "... ブロック 840,000（...）" (ja).
export function titleBlock(title) {
  let m = /(?:Block|区块|ブロック) ([\d,]+) ?[(（](.*)[)）]\s*$/.exec(title || "");
  if (!m) return null;
  const height = Number(m[1].replace(/,/g, "")), when = m[2];
  let d = /^(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec) (\d{4})(?: (\d{2}):(\d{2})(?: (.+))?)?$/.exec(when);
  if (d) return { height, year: +d[3], month: MONTHS[d[2]] + 1, day: +d[1], hour: d[4] === undefined ? null : +d[4], minute: d[5] === undefined ? null : +d[5], zone: d[6] || "" };
  d = /^(\d{4})年(\d{1,2})月(\d{1,2})日(?: (\d{2}):(\d{2})(?: (.+))?)?$/.exec(when);
  return d ? { height, year: +d[1], month: +d[2], day: +d[3], hour: d[4] === undefined ? null : +d[4], minute: d[5] === undefined ? null : +d[5], zone: d[6] || "" } : { height };
}
// A moment (seconds since 1970) on the clock of a time zone: its date, hour and minute there, and the zone's offset
// from UTC in minutes then.
export function clockIn(seconds, timeZone) {
  const parts = {};
  for (const p of new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(seconds * 1000))) parts[p.type] = Number(p.value);
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, offset: Math.round((asUTC - Math.floor(seconds / 60) * 60000) / 60000) };
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
// The data checks leave out the day in progress: its reference moves with every block while the run is reading it. A
// block is settled once it is mined, the newest one included.
// The day in progress: the run's newest day, and whatever day a page shows as it opens (a trace of a browser that kept
// something is the page as it came up, on the newest day there was then).
const inProgress = (t, ctx) => t.facts.date === ctx.inProgress || !!t.kept;
const settledDay = (t, ctx) => !t.error && !!t.facts && (t.facts.block ? true : !inProgress(t, ctx));
// BRK's own figure for what a trace shows: at the block's height, or on the day.
const refFor = (t, ctx, name) => (t.facts.block ? ctx.refAt(name === "price_close" ? "price" : name, t.facts.block.height) : ctx.ref(name, t.facts.date));
const what = (t) => (t.facts.block ? "block " + t.facts.block.height : t.facts.date);
const STEP_SIZES = ["1B", "1D", "1W", "1M", "1Y"];

// ---- The price axis zoomed, and the mouse (17 Nov 2026) ---------------------------------------------------------
// A price label back as dollars: "$95.2K", "$1.26M", "$0.385", "$0".
export function labelDollars(label) {
  const m = /^\$((?:\d[\d,]*)?(?:\.\d+)?)([KMBT]?)$/.exec(String(label == null ? "" : label).trim());
  return m && m[1] !== "" ? Number(m[1].replace(/,/g, "")) * { "": 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2]] : null;
}
const TINY = 1e-6;
const money = (v) => "$" + (Math.abs(v) >= 100 ? Math.round(v).toLocaleString("en-US") : String(+v.toPrecision(4)));
// What is wrong, if anything, with the prices drawn (range) as a day's way of showing the view asked for (null: the
// whole axis). The day's bars are w dollars wide and its axis ends at `end`. The page's own words: a view always holds
// whole bars, ten at the least; it starts at the bar edge nearest the price asked for and is as many bars wide as
// asked, slid back inside the axis where it would pass an end; one as wide as the axis is the whole axis.
export function viewFault(range, view, w, end) {
  const [a, b] = range;
  if (!(w > 0) || !(end > 0)) return a === 0 && (!(end > 0) || Math.abs(b - end) <= TINY * Math.max(1, end)) ? null : "a view of a day with no axis";
  const slots = Math.ceil(end / w - 1e-9), wide = view ? (view.hi - view.lo) / w : slots, least = Math.min(10, slots);
  if (a === 0 && Math.abs(b - end) <= TINY * w) {
    return !view || Math.max(least, wide) >= slots - 0.5 - TINY ? null : "the whole axis is drawn, the view asked for was " + wide.toFixed(1) + " of its " + slots + " bars";
  }
  if (!view) return "a part of the axis (" + money(a) + " to " + money(b) + ") where the whole axis was asked for";
  const k = a / w, n = (b - a) / w, K = Math.round(k), N = Math.round(n);
  if (Math.abs(k - K) > TINY || Math.abs(n - N) > TINY) return "part of a bar at an edge of the view: bars " + k.toFixed(3) + " to " + (k + n).toFixed(3);
  if (N < least) return N + " bars in view, fewer than " + least;
  if (K < 0 || K + N > slots) return "the view (bars " + K + " to " + (K + N) + ") reaches past the axis's " + slots + " bars";
  if (wide < least ? N !== least : Math.abs(N - wide) > 0.5 + TINY) return N + " bars in view, " + wide.toFixed(2) + " were asked for";
  const from = Math.max(0, Math.min(slots - N, view.lo / w));
  if (Math.abs(K - from) > 0.5 + TINY) return "the view starts at bar " + K + " (" + money(a) + "), the price asked for (" + money(view.lo) + ") is bar " + (view.lo / w).toFixed(2);
  return null;
}
// The pointer's acts (plan.mjs), in words.
const actWords = (a) => ({ wheel: () => "the wheel turned " + Math.abs(a[2]) + (a[2] < 0 ? " notches away" : " notches towards") + " at " + a[1].toFixed(2),
  "shift-wheel": () => "Shift and the wheel, " + a[2] + " notches at " + a[1].toFixed(2), sideways: () => "the wheel turned sideways by " + a[2] + " px",
  drag: () => "a left drag from " + a[1].toFixed(2) + " to " + a[2].toFixed(2), mark: () => "a right drag from " + a[1].toFixed(2) + " to " + a[2].toFixed(2),
  "ctrl-mark": () => "Ctrl and a left drag from " + a[1].toFixed(2) + " to " + a[2].toFixed(2), click2: () => "two clicks", "right-click2": () => "two right-clicks",
  key: () => "the " + a[1] + " key", press: () => "the " + a[1] + " arrow" }[a[0]] || (() => JSON.stringify(a)))();
// What one act of the mouse got wrong, if anything: its state before (b) and after (a), where the pointer was (xs, whole
// px) and whether the browser's menu was kept shut each time it was asked for. Each rule is the page's own (the
// explainer's "Zooming the price axis" and "Marking a price range").
export function actFault(m) {
  const kind = m.act[0], b = m.before, a = m.after, w = b.binWidth, end = b.axisEnd;
  const span = (s) => s.range[1] - s.range[0], bars = (s) => span(s) / w, under = (s, x) => s.range[0] + (x - s.plot[0]) / s.plot[2] * span(s);
  const whole = (s) => s.range[0] === 0 && Math.abs(s.range[1] - s.axisEnd) <= TINY * Math.max(w, 1e-9);
  const sameRange = a.key === b.key && Math.abs(a.range[0] - b.range[0]) <= TINY * w && Math.abs(a.range[1] - b.range[1]) <= TINY * w;
  const sameView = JSON.stringify(a.view) === JSON.stringify(b.view), sameMark = JSON.stringify(a.mark) === JSON.stringify(b.mark);
  const slots = Math.ceil(end / w - 1e-9), least = Math.min(10, slots);
  const markWords = (k) => (k ? money(k.lo) + " to " + money(k.hi) : "nothing");
  if (kind !== "press" && a.key !== b.key) return "the chart went from " + b.key + " to " + a.key;
  if (a.panning) return "the closed hand was left on";
  if (kind === "wheel" || kind === "shift-wheel" || kind === "sideways") {
    if (!sameMark) return "the marked range went from " + markWords(b.mark) + " to " + markWords(a.mark);
    if (!(w > 0) || !(end > 0)) return a.view === null && sameRange ? null : "a day with no axis took a view";
    if (kind === "wheel") {
      const x = m.xs[0], nb = bars(b), na = bars(a), slid = (under(a, x) - under(b, x)) / w;
      if (m.act[2] < 0) {
        if (na > nb + TINY) return "turned away, the view went from " + nb.toFixed(1) + " to " + na.toFixed(1) + " bars";
        if (nb > least + TINY && !(na < nb - TINY)) return "turned away, the view stayed " + nb.toFixed(1) + " bars wide";
        if (na < least - TINY) return na.toFixed(1) + " bars in view, fewer than " + least;
        if (Math.abs(slid) > 1 + TINY) return "the price under the pointer went from " + money(under(b, x)) + " to " + money(under(a, x)) + ", " + slid.toFixed(2) + " bars";
      } else {
        if (na < nb - TINY) return "turned towards, the view went from " + nb.toFixed(1) + " to " + na.toFixed(1) + " bars";
        if (whole(b)) return whole(a) && a.view === null ? null : "turned towards on the whole axis, the view changed";
        if (!whole(a) && !(na > nb + TINY)) return "turned towards, the view stayed " + nb.toFixed(1) + " bars wide";
        // Out, a view that meets an end of the axis stops there, and the price under the pointer has to give.
        const atEnd = a.range[0] === 0 || a.range[1] >= (slots - TINY) * w;
        if (!whole(a) && !atEnd && Math.abs(slid) > 1 + TINY) return "the price under the pointer went from " + money(under(b, x)) + " to " + money(under(a, x)) + ", " + slid.toFixed(2) + " bars";
      }
      return null;
    }
    // Sideways: the view goes along the axis by the turn's distance, as wide as it was, no further than an end.
    if (whole(b)) return whole(a) && a.view === null ? null : "turned sideways on the whole axis, the view changed";
    const px = kind === "sideways" ? m.act[2] : m.act[2] * 100, nb = Math.round(bars(b));
    if (Math.abs(bars(a) - bars(b)) > TINY) return "turned sideways, the view went from " + bars(b).toFixed(1) + " to " + bars(a).toFixed(1) + " bars";
    const want = Math.max(0, Math.min((slots - nb) * w, b.range[0] + px / b.plot[2] * span(b)));
    if (Math.abs(a.range[0] - want) > (1 + TINY) * w) return "the view moved " + ((a.range[0] - b.range[0]) / w).toFixed(2) + " bars, the turn was worth " + ((want - b.range[0]) / w).toFixed(2);
    return null;
  }
  if (kind === "drag") {
    if (!sameMark) return "the left button changed the marked range, from " + markWords(b.mark) + " to " + markWords(a.mark);
    if (whole(b)) return sameRange && sameView ? null : "a left drag on the whole axis changed the view";
    if (Math.abs(bars(a) - bars(b)) > TINY) return "the view went from " + bars(b).toFixed(1) + " to " + bars(a).toFixed(1) + " bars";
    // The price the button went down on is under the pointer where it came up, unless the axis ended first.
    const n = Math.round(bars(a)), want = Math.max(0, Math.min((slots - n) * w, under(b, m.xs[0]) - (m.xs[1] - a.plot[0]) / a.plot[2] * span(a)));
    if (Math.abs(a.range[0] - want) > (1 + TINY) * w) return "the view starts " + ((a.range[0] - want) / w).toFixed(2) + " bars from where the pointer took it (" + money(a.range[0]) + ", not " + money(want) + ")";
    return null;
  }
  if (kind === "mark" || kind === "ctrl-mark") {
    if (!sameRange || !sameView) return "marking moved the view";
    if (kind === "mark" && !m.menu.length) return "the browser's menu was never asked for, so whether the page keeps it shut is unknown";
    if (m.menu.some((kept) => !kept)) return "the browser's menu was let open over the chart";
    const px = span(b) / b.plot[2], lo = under(b, Math.min(m.xs[0], m.xs[1])), hi = Math.min(under(b, Math.max(m.xs[0], m.xs[1])), b.barsEnd);
    // Past the day's last bar (the price above every bar, a zoomed view of the room beyond them) there is nothing to mark.
    if (lo >= b.barsEnd - px) return a.mark === null ? null : "marked " + markWords(a.mark) + " past the day's last bar (" + money(b.barsEnd) + ")";
    if (!a.mark) return "nothing was marked";
    if (Math.abs(a.mark.lo / w - Math.round(a.mark.lo / w)) > TINY || Math.abs(a.mark.hi / w - Math.round(a.mark.hi / w)) > TINY) return "the mark (" + markWords(a.mark) + ") does not end on bars";
    // The bars the pointer passed over, to the pixel: the one under each end of the drag is in.
    if (a.mark.lo > lo + px || a.mark.lo + w < lo - px || a.mark.hi < hi - px || a.mark.hi - w > hi + px) return "marked " + markWords(a.mark) + ", the pointer went from " + money(lo) + " to " + money(hi);
    return null;
  }
  if (kind === "click2") {
    if (!sameMark) return "two clicks changed the marked range";
    return a.view === null && whole(a) && !a.zoomed ? null : "two clicks left the view at " + money(a.range[0]) + " to " + money(a.range[1]);
  }
  if (kind === "right-click2") {
    if (!sameRange || !sameView) return "two right-clicks moved the view";
    if (!m.menu.length) return "the browser's menu was never asked for, so whether the page keeps it shut is unknown";
    if (m.menu.some((kept) => !kept)) return "the browser's menu was let open over the chart";
    return a.mark === null ? null : "the marked range is still there: " + markWords(a.mark);
  }
  if (kind === "key" && m.act[1] === "Escape") {
    // A marked range goes first, the view staying; with none, a zoomed axis comes back whole.
    if (b.mark) return a.mark === null && sameRange && sameView ? null : a.mark ? "the marked range is still there" : "Escape cleared the mark and moved the view too";
    if (b.view) return a.view === null && whole(a) ? null : "Escape left the view at " + money(a.range[0]) + " to " + money(a.range[1]);
    return sameRange && sameView ? null : "Escape changed the view with nothing to undo";
  }
  if (kind === "press") {
    if (a.key === b.key) return "the chart stayed on " + b.key;
    if (!sameView) return "the view asked for changed with the day";
    if (!sameMark) return "the marked range changed with the day";
    const fault = viewFault(a.range, a.view, a.binWidth, a.axisEnd);
    return fault ? "on " + a.key + ": " + fault : null;
  }
  return "an act the check does not know";
}

export const TRACE_CHECKS = [
  {
    id: "draws",
    failure: "The day or block does not draw: an error notice, a script error, a failed request for anything but a day's data, or the loading sign left up.",
    seen: "#191: bitview.space changed its API and the site could not load any day; found by the owner, not by a check",
    applies: () => true,
    judge(t) {
      if (t.error) return [false, t.error];
      const f = t.facts;
      if (f.notice) return [false, "notice: " + f.notice.slice(0, 120)];
      if (f.loading) return [false, "the loading sign is still up"];
      // A request for a day's or block's buckets (/api/urpd/...) that fails is not judged here. For what is on screen the
      // page asks once more and then says so (the notice above), and the data checks hold the chart to BRK's own
      // totals; for a day it was fetching ahead, the chart shown still drew. (A request the page calls off itself after
      // 15 s is net::ERR_ABORTED; BRK answering an error without its CORS header is a console error. Both turned good
      // traces red: a prefetch on 6 Nov 2026, two more in the review of 17 Nov 2026.)
      const bad = (t.events || []).find((e) => !/youtube|google|fonts\./.test(e) && !/\/api\/urpd\//.test(e) && !/^request failed: .* net::ERR_ABORTED$/.test(e));
      if (bad) return [false, bad.slice(0, 160)];
      return [true];
    },
  },
  {
    id: "right-day",
    failure: "The chart shows another day than the one asked for: title, counter, data or price from a different day.",
    seen: "#6: the price was two days behind; #4: a one-day timezone shift in the price overlay",
    applies: (t) => !t.error && !!t.facts && !t.facts.block,
    judge(t, ctx) {
      const f = t.facts, asked = t.asked && t.asked.date;
      if (asked && f.date !== asked) return [false, "data for " + f.date + ", asked for " + asked];
      if (t.asked && t.asked.height != null) return [false, "a day (" + f.date + "), asked for block " + t.asked.height];
      const td = titleDay(f.title);
      if (td !== f.date) return [false, "the title names " + td + ": " + f.title];
      if (!String(f.counter).startsWith(f.dayNumber + "/" + f.days)) return [false, "the counter reads " + f.counter + ", day " + f.dayNumber + " of " + f.days];
      if (inProgress(t, ctx)) return [true];
      const ref = ctx.ref("price_close", f.date);
      if (ref > 0 ? f.spot !== ref : f.spot > 0) return [false, "price " + f.spot + ", BRK's close " + ref];
      return [true];
    },
  },
  {
    id: "right-block",
    failure: "With 1B the chart shows another block than the one asked for, or says it wrongly: the height in the title or the counter, the block's time on the visitor's own clock, its day, or its price.",
    seen: "#199, #200 (6 Nov 2026): one block at a time, its time in the visitor's zone; the owner asked for both, no check covered them",
    applies: (t) => !t.error && !!t.facts && !!t.facts.block,
    judge(t, ctx) {
      const f = t.facts, h = f.block.height, asked = t.asked && t.asked.height;
      if (asked != null && h !== asked) return [false, "block " + h + ", asked for " + asked];
      if (t.asked && t.asked.date && asked == null) return [false, "block " + h + ", asked for the day " + t.asked.date];
      const tb = titleBlock(f.title);
      if (!tb || tb.height !== h) return [false, "the title does not name block " + h + ": " + f.title];
      if (String(f.counter).replace(/[^0-9]/g, "") !== String(h)) return [false, "the counter reads " + f.counter + ", not block " + h];
      const stamp = ctx.refAt("timestamp", h);
      if (stamp == null) return [false, "no reference for block " + h];
      if (f.block.time !== stamp) return [false, "the block's time is " + f.block.time + ", BRK's " + stamp];
      // Its time as the visitor's clock has it: the date, hour and minute in the trace's zone, and a zone named by its
      // offset (GMT+8, UTC+5:30) has to be that zone's offset then.
      const want = clockIn(stamp, f.tz || "UTC");
      for (const k of ["year", "month", "day", "hour", "minute"]) if (tb[k] !== want[k]) return [false, "the title's time (" + f.title.replace(/^.*[(（]/, "").replace(/[)）]\s*$/, "") + ") is not " + JSON.stringify(want) + " in " + (f.tz || "UTC")];
      if (!tb.zone) return [false, "the title's time names no zone: " + f.title];
      const off = /^(?:GMT|UTC)(?:([+-])(\d{1,2})(?::?(\d{2}))?)?$/.exec(tb.zone);
      if (off && (off[1] === "-" ? -1 : 1) * ((+off[2] || 0) * 60 + (+off[3] || 0)) !== want.offset) return [false, "the title says " + tb.zone + ", " + (f.tz || "UTC") + " was " + want.offset + " minutes from UTC then"];
      const day = ctx.dayOf(h);
      if (f.date !== day) return [false, "the block is put on " + f.date + ", BRK has it on " + day];
      const ref = ctx.refAt("price", h);
      if (ref > 0 ? f.spot !== ref : f.spot > 0) return [false, "price " + f.spot + ", BRK's price at the block " + ref];
      return [true];
    },
  },
  {
    id: "supply",
    failure: "The day's coins do not add up to the circulating supply: an age band or a bucket was lost on the way in.",
    seen: "#99: partial cohort loads were retried; #191: a changed response shape",
    applies: settledDay,
    judge(t, ctx) {
      const ref = refFor(t, ctx, "circulating_supply");
      if (ref == null) return [false, "no reference for " + what(t)];
      return close(t.facts.raw.supply, ref, 1e-7, 1e-6) ? [true] : [false, "supply " + t.facts.raw.supply + ", BRK " + ref];
    },
  },
  {
    id: "realized-cap",
    failure: "The day's value (each coin at its price when last moved) does not add up to the realized cap.",
    seen: "#191: prices now come rounded to four significant figures; a wrong rounding would show here",
    applies: settledDay,
    judge(t, ctx) {
      const ref = refFor(t, ctx, "realized_cap");
      if (ref == null) return [false, "no reference for " + what(t)];
      return close(t.facts.raw.value, ref, 1e-3, 1e-6) ? [true] : [false, "value " + t.facts.raw.value.toFixed(0) + ", BRK realized cap " + ref];
    },
  },
  {
    id: "holders",
    failure: "Short-term holders (the bands under 150 days) or long-term holders do not match BRK's own STH and LTH supply.",
    seen: "the LTH/STH split is the default view; it was cross-checked by hand before (see README)",
    applies: (t, ctx) => settledDay(t, ctx) && t.facts.raw.bands === 23,
    judge(t, ctx) {
      const f = t.facts, sth = refFor(t, ctx, "sth_supply"), lth = refFor(t, ctx, "lth_supply");
      if (sth == null || lth == null) return [false, "no reference for " + what(t)];
      if (!close(f.raw.sth, sth, 1e-7, 1e-6)) return [false, "STH " + f.raw.sth + ", BRK " + sth];
      if (!close(f.raw.lth, lth, 1e-7, 1e-6)) return [false, "LTH " + f.raw.lth + ", BRK " + lth];
      return [true];
    },
  },
  {
    id: "in-profit",
    failure: "The price box's share of coins in profit is not the recorded prices at or below the price, or BRK's own supply in profit is outside what those prices allow.",
    seen: "#144: the box and Percent of Total disagreed at the dashed line by up to 2.2 points",
    applies: (t, ctx) => settledDay(t, ctx) && t.facts.spot > 0 && t.facts.profitPctCoin != null && !!t.facts.inProfit,
    judge(t, ctx) {
      // The box counts the recorded prices at or below the price, as Percent of Total does (#144): that count is made
      // again from the raw buckets (collect.mjs) and has to match to the last digit. BRK records each coin's price to
      // four significant figures, so the coins recorded at the price's own figure may sit either side of it: BRK's
      // own share, from each coin's exact price, has to lie between the coins surely in profit and all but those
      // surely in loss. (Until November 2026 this allowed half a point either way, a guess: on 16 Jun 2022, 0.62% of
      // the coins last moved in the day's last block, at the close itself, and a good trace failed.)
      const ip = t.facts.inProfit;
      if (Math.abs(t.facts.profitPctCoin - ip.rule) > 1e-6) return [false, "the box counts " + t.facts.profitPctCoin.toFixed(4) + "%, the recorded prices at or below the price hold " + ip.rule.toFixed(4) + "%"];
      const ref = refFor(t, ctx, "supply_in_profit_share");
      if (ref == null) return [false, "no reference for " + what(t)];
      if (ref < ip.lo - 2e-4 || ref > ip.hi + 2e-4) return [false, "BRK's supply in profit " + ref + "% is outside what the recorded prices allow, " + ip.lo.toFixed(4) + "% to " + ip.hi.toFixed(4) + "%"];
      return [true];
    },
  },
  {
    id: "bars-total",
    failure: "The bars drawn do not add up to the whole day (100 %): some fell off the axis or out of the bins.",
    seen: "#109, #110: axes that only grow; a zero bin width once dropped a whole day (buildData)",
    applies: (t) => !t.error && !!t.facts && t.facts.raw.supply > 0 && (t.facts.coin || t.facts.raw.value > 0),
    judge(t) {
      // A zoomed view shows part of the day, so its bars are counted on the whole axis, drawn in its place straight after
      // (collect.mjs); that they are the same bars is the zoom-view check's.
      const s = t.facts.zoom ? t.facts.zoom.whole.total : t.facts.bars.filter((b) => b.visible).reduce((a, b) => a + b.sum, 0);
      return Math.abs(s - 100) <= 0.01 ? [true] : [false, "the bars add up to " + s.toFixed(4) + "%"];
    },
  },
  {
    id: "labels-clear",
    failure: "Words on the chart collide, are covered or leave the window: the price box, a marked range's box, the cycle, pin and ▲ labels, the credits, and the dot on the price line over any box of figures.",
    seen: "#24: the price box ran off the plot; #39, #76: legend and title clearance; #118, #174: boxes over labels; 7 and 12 Nov 2026: a marked range's box over a cycle top's label",
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
      // The dot on the selected day is drawn over everything: on a box of figures it hides letters.
      for (const a of boxes) if (a.xref === "x" && a.yref === "paper" && overlap(a.box, f.tracer)) return [false, "the dot on the price line is over " + a.text.slice(0, 40)];
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
    failure: "A marked range's box says something untrue, or never finishes: long-term holders (or 0 days) where no coin last moved, no coins where some did, its days still reading … after 20 s, or its two prices not the mark's own to within half a bar.",
    // (Its share lines, removed in #192 and checked for here until the owner asked for them back on 6 Nov 2026, are
    // shown again.)
    seen: "error analysis: t111 said Already All Long-Term Holders and t116 said 0 Days over ranges holding no coin. 17 Nov 2026: a mark from $10.69 to $11.18 on 8 Jun 2011, bars 4.4 cents wide, read \"$11 – $11\" (t202)",
    applies: (t) => !t.error && !!t.facts && !!t.facts.mark,
    judge(t) {
      const f = t.facts, box = markBox(f), words = MARK[f.lang] || MARK.en;
      if (!box) return [true];   // too narrow for any words: no box, which says nothing untrue
      const text = flat(box.text), saysNone = words.none.some((w) => text.endsWith(w)), saysLth = words.lth.some((w) => text.includes(w));
      if (f.coinsInMark === false && !saysNone) return [false, "no coin last moved in the range, the box says: " + box.text.slice(0, 80)];
      if (f.coinsInMark === true && saysNone) return [false, "coins last moved in the range, the box says none: " + box.text.slice(0, 80)];
      // "…" stands in for the days while the daily highs and lows load; the trace waits 20 s for them.
      if (/…/.test(box.text)) return [false, "the days were still loading after 20 s: " + box.text.slice(-60)];
      if (f.coinsInMark === true && !saysLth) return [false, "no days line: " + box.text.slice(0, 80)];
      // Its two prices are the mark's own ends, each close enough to tell its bar's edge from the next one's (half a bar),
      // as far as the day's axis goes. (A narrow box breaks the line at the dash: " | " stands for a line break.)
      const said = /\$(\d[\d,]*(?:\.\d+)?)(?: \|)? –(?: \|)? \$(\d[\d,]*(?:\.\d+)?)/.exec(box.text);
      if (said && f.binWidth > 0) {
        const end = f.zoom ? f.zoom.whole.range[1] : f.xRange[1], want = [Math.max(0, f.mark.lo), Math.min(end, f.mark.hi)];
        const got = [said[1], said[2]].map((x) => Number(x.replace(/,/g, "")));
        if (Math.abs(got[0] - want[0]) > f.binWidth / 2 || Math.abs(got[1] - want[1]) > f.binWidth / 2) return [false, "the box gives the range as $" + said[1] + " – $" + said[2] + ", the mark is " + money(want[0]) + " to " + money(want[1]) + " and a bar " + money(f.binWidth) + " wide"];
      }
      return [true];
    },
  },
  {
    id: "mark-edges",
    failure: "A marked range's white line is drawn over a bar instead of in the gap beside it, so the mark seems to cut a bar and a drag slides instead of moving a bar at a time; or a white line stands where the mark does not end, at the edge of a zoomed view that cuts it short.",
    seen: "6 Nov 2026: the owner asked for the drag to go a bar at a time; in Chromium a line covered part of a bar at 36 of 36 drag steps (up to 1.8 px), fixed in #196. 17 Nov 2026: 3 of 3 marks cut by a zoomed view had a line at the view's edge, two of them over the last bar in view (t190 to t192)",
    // Where the chart leaves a gap between bars (2 px apart or more); narrower bars are solid and the line takes the
    // separator's pixel, by design. A mark wholly outside a zoomed view has nothing to draw.
    applies: (t) => !t.error && !!t.facts && !!t.facts.markEdges && t.facts.markEdges.pitch >= 2 && t.facts.mark.lo < t.facts.xRange[1] && t.facts.mark.hi > t.facts.xRange[0],
    judge(t) {
      const f = t.facts, e = f.markEdges, w = f.binWidth || 0;
      // A white line is an end of the mark: one for each end the view shows (both, on the whole axis).
      const ends = (f.mark.lo >= f.xRange[0] - TINY * w ? 1 : 0) + (f.mark.hi <= f.xRange[1] + TINY * w ? 1 : 0);
      if (e.lines.length !== ends) return [false, e.lines.length + " white lines, and " + ends + (ends === 1 ? " end" : " ends") + " of the mark in view"];
      const over = e.lines.find((l) => l.onBar > 0.05);
      return over ? [false, "a white line over a bar: " + over.onBar + " px of it covered, at " + over.c + " px"] : [true];
    },
  },
  {
    id: "block-steps",
    failure: "A press of a step button does not move as the page says it does: 1B one block back or forward (from a day, from its last block), 1D from a block to the end of its own day or of the day before, a step size not taken, or a notice where none belongs.",
    seen: "#199, #200 (6 Nov 2026): 1B steps one block; past the newest block nothing happens and no message shows",
    applies: (t) => !t.error && Array.isArray(t.stepped) && t.stepped.length > 1,
    judge(t, ctx) {
      // Followed press by press from where the trace started: the size picked, and where each arrow should land, worked
      // out here from BRK's own list of each day's first block.
      let size = "1D", at = t.stepped[0];
      const dayAfter = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
      for (const s of t.stepped.slice(1)) {
        let want;
        if (STEP_SIZES.includes(s.press) || /^key:[1-5]$/.test(s.press)) {
          size = STEP_SIZES.includes(s.press) ? s.press : STEP_SIZES[+s.press.slice(4) - 1];
          if ((s.stepSize || "").trim() !== size) return [false, "after " + s.press + " the step size reads " + s.stepSize];
          want = { key: at.key };
        } else {
          const dir = s.press === "next" ? 1 : -1, last = ctx.lastHeight(at.date);
          if (size === "1B") {
            const from = at.isBlock ? at.height : last;
            if (from == null) return [false, "no reference for the last block of " + at.date];
            // Past the newest block the page has seen, nothing happens.
            const target = from + dir;
            want = { key: dir > 0 && s.newest != null && target > s.newest ? at.key : "h" + target };
          } else if (size === "1D" && at.isBlock && dir > 0 && (last === null || at.height < last)) want = { key: at.date };
          else if (size === "1D") want = { key: dayAfter(at.date, dir) };
          else if (size === "1W") want = { key: dayAfter(at.date, 7 * dir) };
          else return [true];   // 1M and 1Y: the day list's own rules (tests/navigation.test.cjs)
        }
        if (s.key !== want.key) return [false, s.press + " (" + size + ") from " + at.key + " went to " + s.key + ", not " + want.key];
        if (s.notice) return [false, "a notice after " + s.press + ": " + s.notice.slice(0, 100)];
        at = s;
      }
      return [true];
    },
  },
  {
    id: "price-labels",
    failure: "A price label is missing from the axis, repeats its neighbour, is written in thousands to three decimals or (zoomed) with a single decimal, or names another price than its gridline's: on a zoomed view more than a tenth of a step from it, on the whole axis more than its two figures allow.",
    seen: "17 Nov 2026, the day the wheel zoom went live: a zoomed view labelled $102,571 \"$100K\" (#205), and its last label was missing, hidden by Plotly for the spaces that end-align it (#206); both found on a screenshot, no check read the labels. The same day's review: $9,891 written $9.891K (t172, t174, t180), and $8.05 labelled $8.1 beside a marked range given to the cent (t175, #210)",
    applies: (t) => !t.error && !!t.facts && !!t.facts.priceLabels,
    judge(t) {
      const f = t.facts, p = f.priceLabels, asked = p.asked.filter(Boolean);
      // What a visitor can see is what the page asked for (Plotly hides a label that reaches past the figure's edge).
      if (JSON.stringify(p.seen) !== JSON.stringify(asked)) {
        const gone = asked.filter((x) => !p.seen.includes(x));
        return [false, gone.length ? "not on screen: " + gone.join(" ") : "on screen: " + p.seen.join(" ") + "; asked for: " + asked.join(" ")];
      }
      for (let i = 1; i < asked.length; i++) if (asked[i] === asked[i - 1]) return [false, "two gridlines in a row read " + asked[i]];
      // A price is not written in thousands or millions to three decimals ($9.891K for $9,891).
      const odd = asked.find((x) => /\.\d{3,}[KMBT]$/.test(x));
      if (odd) return [false, "a price written as " + odd];
      // A zoomed view is read closely: every label within a tenth of a step of its gridline's price. The whole axis
      // rounds to two figures (three where two would repeat), by design: within half of its second figure.
      const whole = f.zoom ? f.zoom.whole.range : f.xRange, zoomed = f.xRange[0] > whole[0] || f.xRange[1] < whole[1] - TINY * Math.abs(whole[1]);
      // And is labelled in whole dollars or in cents, never with a single decimal: not in dimes ($8.1 for $8.05), nor in
      // cents with the last zero dropped ($11.3). The whole axis's two figures may be.
      const dime = zoomed && asked.find((x) => /^\$[\d,]+\.\d$/.test(x));
      if (dime) return [false, "a price written with one decimal: " + dime];
      const step = p.vals.length > 1 ? Math.abs(p.vals[1] - p.vals[0]) : 0;
      for (let k = 0; k < p.vals.length; k++) {
        if (!p.asked[k]) continue;
        const v = p.vals[k], said = labelDollars(p.asked[k]);
        if (said === null) return [false, "a label that is not a price: " + p.asked[k]];
        const room = zoomed ? step / 10 : v > 0 ? 0.5 * Math.pow(10, Math.floor(Math.log10(v)) - 1) : 0;
        if (Math.abs(said - v) > room * (1 + TINY) + 1e-12) return [false, p.asked[k] + " on the gridline at " + money(v) + (zoomed ? " (a step is " + money(step) + ")" : "")];
      }
      return [true];
    },
  },
  {
    id: "zoom-view",
    failure: "A zoomed price axis is not the day's own bars at the prices asked for: part of a bar at an edge, fewer than ten, somewhere else, a bar another height or with another share than on the whole axis, a left axis ending anywhere but the lower of the whole axis's top and the tallest bar in view (pinned, at the pin), other than twenty steps, or a price box neither on the price's line nor against the edge the line left by with its arrow.",
    seen: "#204 (17 Nov 2026): the owner asked for the wheel to zoom the price axis; 20 zoomed views swept that day held to the whole axis, and the faults found were in the labels (price-labels) and the wheel (mouse)",
    applies: (t) => !t.error && !!t.facts && !!t.facts.zoom,
    judge(t) {
      const f = t.facts, z = f.zoom, w = f.binWidth, [a, b] = f.xRange, end = z.whole.range[1];
      const fault = viewFault(f.xRange, z.asked, w, end);
      if (fault) return [false, fault];
      // The bars in view are the day's own: as many as the view holds, each at its price, as tall, with the same running
      // share and amount behind it.
      for (const c of z.counts) {
        if (c.want === null) return [false, "bars the whole axis does not have: " + c.name];
        if (c.got !== c.want) return [false, c.got + " bars of " + c.name + " in a view that holds " + c.want];
      }
      if (z.off.price > 1e-9 * Math.max(w, 1e-9)) return [false, "a bar " + z.off.price + " dollars from its place on the whole axis"];
      if (z.off.height > 1e-9) return [false, "a bar " + z.off.height + " points taller or shorter than on the whole axis"];
      if (z.off.share > 1e-9 || z.off.amount > 1e-9) return [false, "a bar's hover differs from the whole axis's (share by " + z.off.share + ", amount by " + z.off.amount + ")"];
      const whole = a === 0 && Math.abs(b - end) <= TINY * Math.max(w, 1e-9);
      // The left axis: where the whole axis has it, or at the tallest bar in view when that is lower; a pin stays.
      const top = f.pinned || whole || !(z.tallest > 0) || z.tallest >= z.whole.yTop ? z.whole.yTop : z.tallest;
      if (Math.abs(f.yRange[1] - top) > 1e-9 * Math.max(1, top)) return [false, "the left axis ends at " + f.yRange[1] + "%, not " + top + "% (the whole axis's " + z.whole.yTop + "%, the tallest bar in view " + z.tallest + "%" + (f.pinned ? ", pinned" : "") + ")"];
      // Twenty steps from the first price in view to the last.
      const v = f.priceLabels.vals;
      if (v.length !== 21 || Math.abs(v[0] - a) > TINY * w || Math.abs(v[20] - b) > TINY * w) return [false, "the gridlines run from " + money(v[0]) + " to " + money(v[v.length - 1]) + ", the view from " + money(a) + " to " + money(b)];
      for (let k = 1; k < 21; k++) if (Math.abs(v[k] - v[k - 1] - (b - a) / 20) > TINY * w) return [false, "the gridlines are not twenty equal steps"];
      // The price box: on the price's dashed line while that is in view; with the line out of view, against the edge it
      // left by, pointing its way.
      if (f.spot > 0) {
        const box = f.annotations.find((x) => x.color && !x.width && x.yref === "paper" && x.y === 1);
        if (!box) return [false, "no price box"];
        const first = box.text.split(" | ")[0];
        if (f.spot < a) { if (!(box.xref === "paper" && box.x === 0 && /^◀ /.test(first) && f.priceLine === null)) return [false, "the price (" + money(f.spot) + ") is left of the view: " + first + (f.priceLine === null ? "" : ", its line drawn at " + money(f.priceLine))]; }
        else if (f.spot > b) { if (!(box.xref === "paper" && box.x === 1 && / ▶$/.test(first) && f.priceLine === null)) return [false, "the price (" + money(f.spot) + ") is right of the view: " + first + (f.priceLine === null ? "" : ", its line drawn at " + money(f.priceLine))]; }
        else if (!(box.xref === "x" && box.x === f.spot && f.priceLine === f.spot && !/[◀▶]/.test(first))) return [false, "the price (" + money(f.spot) + ") is in view, but its box or line is not on it: " + first];
      }
      return [true];
    },
  },
  {
    id: "mouse",
    failure: "The mouse on the chart does not do what the page says: the wheel zooms the wrong way or lets the price under the pointer slide (over a bar), a left drag does not take a zoomed axis with it or marks something, a right drag does not mark the bars it passed over or lets the browser's menu open, two clicks or Escape do not give the whole axis back, two right-clicks or Escape do not clear the mark, or a step to another day loses the view.",
    seen: "17 Nov 2026: sixteen notches of the wheel at one spot left the price under the pointer up to 2.9 bars from where it began, and 5.7 once turned back (#207); a left drag lost what the pointer moved before it counted as a drag (found before #204 merged)",
    applies: (t) => !t.error && Array.isArray(t.moused) && t.moused.length > 0,
    judge(t) {
      for (const m of t.moused) { const fault = actFault(m); if (fault) return [false, actWords(m.act) + ": " + fault]; }
      return [true];
    },
  },
  {
    id: "pin-true",
    failure: "PIN Y-AXIS does not tell the truth or does not work: it is pressed while the left axis is the day's own, or not pressed while a kept pin holds the axis; a press does not pin the scale on screen, or unpin it; or the pin is not kept for the next visit as the page reads one.",
    seen: "fourth error analysis, 20 Nov 2026, the first traces of a browser that kept something from an earlier visit: with an entry that was no pin the button was pressed over a scale that was not pinned (3 of 9 kept stores), and with a store that was a word or a list a press did not pin, or the pin was written back without itself (2 of 9)",
    applies: (t) => !t.error && !!t.facts && !!t.facts.pin,
    judge(t) {
      const close = (a, b) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
      const isPin = (p) => Array.isArray(p) && typeof p[0] === "string" && typeof p[1] === "number" && isFinite(p[1]) && p[1] > 0;
      const o = t.facts.pin.opened, p = t.facts.pin.pressed;
      // As it opens: pressed exactly when the browser holds a pin for the settings on screen, and drawn against it.
      for (const [when, f] of [["as the page opens", o], ["after PIN Y-AXIS is pressed", p]]) {
        if (f.pressed !== isPin(f.held)) return [false, when + " the button is " + (f.pressed ? "" : "not ") + "pressed and the page holds " + JSON.stringify(f.held) + " for " + f.key];
        if (f.pressed ? !close(f.top, f.held[1]) : !close(f.top, f.dayTop)) return [false, when + " the left axis ends at " + f.top + ", " + (f.pressed ? "the pin is " + f.held[1] : "the day's own top is " + f.dayTop)];
      }
      // The press: it pins the scale on screen where none was pinned, and takes the pin off where one was.
      if (p.pressed === o.pressed) return [false, "a press of PIN Y-AXIS left it " + (p.pressed ? "pressed" : "not pressed")];
      if (p.pressed && !(p.held[0] === p.date && close(p.held[1], p.dayTop))) return [false, "the press pinned " + JSON.stringify(p.held) + ", the chart on screen is " + p.date + " with a top of " + p.dayTop];
      // What the browser keeps is what the page will read at the next visit.
      let kept = null;
      try { kept = JSON.parse(p.kept); } catch (e) {}
      const entry = kept && typeof kept === "object" && !Array.isArray(kept) ? kept[p.key] : undefined;
      if (p.pressed ? !(isPin(entry) && entry[0] === p.held[0] && close(entry[1], p.held[1])) : entry !== undefined) return [false, "after the press the browser keeps " + String(p.kept).slice(0, 80) + ", the page holds " + JSON.stringify(p.held)];
      return [true];
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
    return { id: t.id, date: t.shown || t.date, view: t.view, window: t.window, lang: t.lang, settings: t.settings, mark: t.mark, zoom: t.zoom || null, mouse: t.mouse || null, shot: t.shot,
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
