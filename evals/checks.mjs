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
const settledDay = (t, ctx) => !t.error && !!t.facts && (t.facts.block ? true : t.facts.date !== ctx.inProgress);
// BRK's own figure for what a trace shows: at the block's height, or on the day.
const refFor = (t, ctx, name) => (t.facts.block ? ctx.refAt(name === "price_close" ? "price" : name, t.facts.block.height) : ctx.ref(name, t.facts.date));
const what = (t) => (t.facts.block ? "block " + t.facts.block.height : t.facts.date);
const STEP_SIZES = ["1B", "1D", "1W", "1M", "1Y"];

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
      if (f.date === ctx.inProgress) return [true];
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
      const s = t.facts.bars.filter((b) => b.visible).reduce((a, b) => a + b.sum, 0);
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
    failure: "A marked range's box says something untrue, or never finishes: long-term holders (or 0 days) where no coin last moved, no coins where some did, or its days still reading … after 20 s.",
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
      // "…" stands in for the days while the daily highs and lows load; the trace waits 20 s for them.
      if (/…/.test(box.text)) return [false, "the days were still loading after 20 s: " + box.text.slice(-60)];
      if (f.coinsInMark === true && !saysLth) return [false, "no days line: " + box.text.slice(0, 80)];
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
