// Which traces an eval run draws. A trace is one day, or one block, of the chart drawn one way a visitor can see it:
// the day or block, the view (% USD or % BTC, AGE or LTH/STH), the window, the language, the visitor's time zone, the
// toolbar settings and, sometimes, a marked range or a few presses of the step buttons. The dimensions come from error
// analysis (see README.md): where problems were found, and where they were found before (the regression history).
// Days are either fixed (landmarks, the edges of the history, the latest days) or random from a seeded generator, so a
// plan is the same every time it is made from the same seed.
//
//   plan("review")       the error-analysis set: 205 traces, every dimension (about 14 minutes)
//   plan("daily", seed)  the monitoring sample: the latest days in every view and the newest block, plus random days,
//                        blocks, windows, languages, time zones, settings, marked ranges, steps, a zoomed view and
//                        the mouse itself, which change with the seed (one a day), so the history is covered over
//                        time (about two minutes)
//
// A block is given as a height, or by where it falls: "tip" (the newest block), or the trace's day's "first", "mid",
// "before-last" or "last" block. Steps are the toolbar's own buttons, pressed in turn: "1B", "1D", "1W", "1M", "1Y" (the
// step size), "prev" and "next" (the arrows).
//
// A zoomed price axis (the wheel, #204) comes two ways. `zoom` is the part of the day's price axis to show, as two
// fractions of the whole axis, set as the wheel leaves it (like `mark`, the fractions a marked range covers). `mouse` is
// the pointer itself at work on the chart, one act after another, each done with the real mouse where x is how far
// across the plot it is (0 its left edge, 1 its right):
//   ["wheel", x, notches]        the wheel turned at x: notches < 0 away from the visitor (in), > 0 towards (out)
//   ["sideways", x, px]          the wheel turned sideways by px      ["shift-wheel", x, notches]  the same, with Shift
//   ["drag", x0, x1]             the left button held down from x0 to x1
//   ["mark", x0, x1]             the right button held down from x0 to x1     ["ctrl-mark", x0, x1]  Ctrl and the left
//   ["click2", x]                two quick clicks                     ["right-click2", x]  two quick right-clicks
//   ["key", "Escape"]            a key                                ["press", "next"]    a toolbar arrow, "prev" or "next"

export const WINDOWS = { desktop: [1600, 1000], laptop: [1280, 720], wide: [1920, 1080], phone: [390, 844], landscape: [844, 390] };
export const VIEWS = ["usd-lthsth", "usd-age", "btc-lthsth", "btc-age"];
// Time zones a block's time is read in: ahead of and behind UTC, with and without daylight saving, one on a half
// hour, and one a day ahead of UTC for part of the day.
export const ZONES = ["Asia/Singapore", "America/New_York", "Asia/Kolkata", "Pacific/Auckland", "UTC", "Europe/Berlin"];

// Days worth drawing every time: the edges of the history (no coins yet, every coin at $0, the first close, the first
// value) and the cycle tops, bottoms and halvings.
export const LANDMARKS = [
  ["2009-01-03", "genesis day"], ["2009-01-09", "first spendable coins"], ["2010-05-18", "first day the BTC video shows"],
  ["2010-07-18", "every coin still at $0"], ["2011-01-31", "first day the USD video shows"],
  ["2011-06-08", "cycle 1 top"], ["2011-11-18", "cycle 1 bottom"], ["2012-11-28", "halving 1"],
  ["2013-11-29", "cycle 2 top"], ["2015-01-14", "cycle 2 bottom"], ["2016-07-09", "halving 2"],
  ["2017-12-17", "cycle 3 top"], ["2018-12-15", "cycle 3 bottom"], ["2020-03-12", "covid crash"],
  ["2020-05-11", "halving 3"], ["2021-04-14", "spring 2021 top"], ["2021-11-10", "cycle 4 top"],
  ["2022-06-18", "June 2022 low"], ["2022-11-21", "cycle 4 bottom"], ["2024-03-14", "pre-halving top"],
  ["2024-04-20", "halving 4"], ["2025-10-06", "cycle 5 top"],
];

function generator(seed) {
  let s = Math.abs(Math.floor(seed)) % 2147483647 || 1;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}
const DAY = 864e5;
const randomDays = (rand, n, from, to) => Array.from({ length: n }, () =>
  new Date(Date.parse(from) + Math.floor(rand() * ((Date.parse(to) - Date.parse(from)) / DAY)) * DAY).toISOString().slice(0, 10));

export function plan(kind = "daily", seed = Number(new Date().toISOString().slice(0, 10).replace(/-/g, ""))) {
  const traces = [];
  let n = 0;
  const add = (date, why, view, extra = {}) => traces.push({ id: "t" + String(++n).padStart(3, "0"), date, why, view,
    window: "desktop", lang: "en", settings: {}, mark: null, block: null, tz: null, steps: null, zoom: null, mouse: null, ...extra });
  if (kind === "review") {
    const rand = generator(20261104);
    const days = [...LANDMARKS.map(([d, why]) => ({ date: d, why })),
      ...randomDays(rand, 12, "2011-02-01", "2026-10-25").map((d) => ({ date: d, why: "random" })),
      { date: "latest-complete", why: "the latest complete day" }, { date: "latest", why: "the day in progress" }];
    days.forEach((day, i) => {
      // Every day in two views (one % USD, one % BTC, the colouring alternating); the latest days and four landmarks
      // in all four.
      const all = ["latest", "latest-complete", "2021-11-10", "2022-11-21", "2011-01-31", "2010-07-18"].includes(day.date);
      (all ? VIEWS : [VIEWS[i % 2 ? 1 : 0], VIEWS[i % 2 ? 2 : 3]]).forEach((v) => add(day.date, day.why, v));
    });
    const pick = (k) => days[(k * 7) % days.length];
    let k = 0;
    for (const w of ["laptop", "laptop", "laptop", "wide", "wide", "phone", "phone", "phone", "phone", "landscape", "landscape"]) { const d = pick(k++); add(d.date, d.why, VIEWS[k % 4], { window: w }); }
    for (const lang of ["zh", "zh", "zh", "ja", "ja", "ja"]) { const d = pick(k++); add(d.date, d.why, VIEWS[k % 4], { lang }); }
    for (const settings of [{ bins: 50 }, { bins: 1000 }, { bins: 1000 }, { smoothing: 0 }, { smoothing: 0 }, { smoothing: 1 }, { ymax: 90 }, { pin: true }]) { const d = pick(k++); add(d.date, d.why, VIEWS[k % 4], { settings }); }
    for (const mark of [[0.30, 0.45], [0.05, 0.12], [0.55, 0.75], [0.10, 0.11], [0.40, 0.95], [0.00, 0.02], [0.62, 0.66], [0.20, 0.50]]) { const d = pick(k++); add(d.date, d.why, VIEWS[k % 4], { mark }); }
    // Added November 2026, after the daily runs' failures: marked ranges under a cycle top's label and beside a cycle
    // bottom's, in the views whose box is tallest, and the day the price box and BRK disagreed most.
    add("2025-12-27", "a marked range under a cycle top's label", "usd-age", { mark: [0.2758, 0.4855] });
    add("2014-03-09", "a marked range under a cycle top's label", "btc-lthsth", { mark: [0.2119, 0.5170] });
    add("2023-08-13", "a marked range beside the price box", "usd-age", { mark: [0.4344, 0.6058] });
    add("2022-06-16", "0.62% of the coins last moved at the close itself", "btc-age", { window: "laptop", lang: "zh" });
    add("2019-04-02", "a narrow marked range in AGE near a cycle bottom's label", "usd-age", { mark: [0.02, 0.05] });
    add("2022-01-20", "a marked range over a cycle top's marker", "btc-age", { mark: [0.60, 0.99] });
    // One block (1B, added 6 Nov 2026): the newest block in every view, the edges of a day, a halving block, early
    // blocks, random ones; then time zones, languages, windows, marked ranges, and the step buttons themselves.
    for (const v of VIEWS) add("latest", "the newest block", v, { block: "tip", tz: ZONES[VIEWS.indexOf(v)] });
    add("latest-complete", "a day's last block: the day itself", "usd-lthsth", { block: "last" });
    add("latest-complete", "a day's last block: the day itself", "btc-age", { block: "last", tz: "Asia/Singapore" });
    add("2024-04-20", "halving 4's block", "usd-age", { block: 840000, tz: "America/New_York" });
    add("2024-04-20", "halving 4's block", "btc-lthsth", { block: 840000, tz: "Asia/Kolkata" });
    add("2021-11-10", "a day's first block", "usd-lthsth", { block: "first", tz: "Pacific/Auckland" });
    add("2017-12-17", "a block in the middle of a day", "btc-age", { block: "mid", tz: "Europe/Berlin" });
    add("2010-05-18", "a block before every coin had a price", "btc-lthsth", { block: "mid", tz: "Asia/Singapore" });
    add("2010-05-18", "a block before every coin had a price", "usd-age", { block: "mid" });
    add("2009-01-09", "the first block after genesis", "btc-age", { block: "first", tz: "America/New_York" });
    add("2010-08-16", "the first day with a close: its first block", "usd-lthsth", { block: "first", tz: "Asia/Kolkata" });
    randomDays(rand, 6, "2011-02-01", "2026-10-25").forEach((d, i) =>
      add(d, "a random block", VIEWS[i % 4], { block: ["mid", "first", "before-last"][i % 3], tz: ZONES[i % ZONES.length] }));
    add("2020-03-12", "a block of the covid crash", "usd-lthsth", { block: "mid", lang: "zh", tz: "Asia/Singapore" });
    add("2022-11-21", "a block at the cycle 4 bottom", "btc-age", { block: "mid", lang: "ja", tz: "Asia/Singapore" });
    add("2025-10-06", "a block at the cycle 5 top", "usd-age", { block: "mid", lang: "zh", tz: "America/New_York" });
    add("2013-11-29", "a block at the cycle 2 top", "btc-lthsth", { block: "before-last", lang: "ja", tz: "Europe/Berlin" });
    add("2021-04-14", "a block, on a laptop", "usd-age", { block: "mid", window: "laptop", tz: "Asia/Kolkata" });
    add("2018-12-15", "a block, on a wide screen", "btc-lthsth", { block: "mid", window: "wide", tz: "Pacific/Auckland" });
    add("2024-03-14", "a block, on a phone", "usd-lthsth", { block: "mid", window: "phone", tz: "America/New_York" });
    add("2016-07-09", "a block, on a phone turned", "btc-age", { block: "mid", window: "landscape", tz: "Asia/Singapore" });
    add("2023-06-01", "a marked range on a block", "usd-age", { block: "mid", mark: [0.30, 0.45], tz: "Asia/Singapore" });
    add("2015-08-20", "a marked range on a block", "btc-lthsth", { block: "mid", mark: [0.10, 0.40], tz: "UTC" });
    add("latest-complete", "1B back from a day: the block before its last", "usd-lthsth", { steps: ["1B", "prev"], tz: "Asia/Singapore" });
    add("2020-05-11", "1B forward from a day: the next day's first block", "btc-lthsth", { steps: ["1B", "next"], tz: "America/New_York" });
    add("2024-04-20", "1B back and forward around the halving block", "usd-age", { block: 840000, steps: ["1B", "prev", "next", "next"], tz: "UTC" });
    add("2020-05-11", "1D forward from a block: the end of its own day", "btc-age", { block: "mid", steps: ["1D", "next"], tz: "Asia/Kolkata" });
    add("2020-05-11", "1D back from a block: the end of the day before", "usd-lthsth", { block: "mid", steps: ["1D", "prev"], tz: "Asia/Singapore" });
    add("2019-06-26", "1W forward from a block: a week on from its day", "usd-age", { block: "first", steps: ["1W", "next"] });
    add("latest", "1B forward past the newest block: nothing happens", "btc-lthsth", { block: "tip", steps: ["1B", "next"], tz: "Asia/Singapore" });
    add("2012-11-28", "the number keys 1 to 5 pick the step size", "usd-lthsth", { steps: ["key:1", "prev", "key:2", "next"] });
    // The price axis zoomed (added 17 Nov 2026, with the wheel of #204): the latest day in every view; the price in
    // view, left of it and right of it; both ends of the axis; as close as it goes, as wide as the axis and reaching past
    // its end; bars under a dollar wide and a day with nothing to draw; every setting; other windows and languages;
    // blocks; and a marked range in view, cut by either edge of the view, wider than it and outside it.
    for (const v of VIEWS) add("latest-complete", "the latest complete day, zoomed", v, { zoom: [0.62, 0.90] });
    add("latest", "the day in progress, zoomed", "usd-lthsth", { zoom: [0.55, 0.95] });
    add("2022-11-21", "zoomed about the price at a cycle bottom", "usd-age", { zoom: [0.10, 0.40] });
    add("2022-11-21", "the price left of the view", "btc-lthsth", { zoom: [0.50, 0.80] });
    add("2022-11-21", "the price right of the view", "usd-lthsth", { zoom: [0.00, 0.12] });
    add("2021-11-10", "the first bars, in % BTC", "btc-age", { zoom: [0.00, 0.05] });
    add("2021-11-10", "the last bars, at a cycle top", "usd-age", { zoom: [0.93, 1.00] });
    add("2017-12-17", "as close as it goes: ten bars", "btc-lthsth", { zoom: [0.50, 0.50] });
    add("2024-04-20", "as wide as the axis: the whole axis", "usd-lthsth", { zoom: [0.00, 0.9996] });
    add("2013-11-29", "reaching past the end of the axis: slid back inside", "usd-age", { zoom: [0.97, 1.30] });
    add("2011-06-08", "bars under a dollar wide", "btc-lthsth", { zoom: [0.20, 0.60] });
    add("2011-06-08", "bars under a dollar wide, close up", "usd-age", { zoom: [0.41, 0.47] });
    add("2010-07-18", "zoomed on a day with nothing to draw", "usd-age", { zoom: [0.30, 0.60] });
    add("2012-11-28", "zoomed, 50 bins", "usd-lthsth", { zoom: [0.30, 0.55], settings: { bins: 50 } });
    add("2020-03-12", "zoomed, 1000 bins", "btc-age", { zoom: [0.05, 0.30], settings: { bins: 1000 } });
    add("2015-01-14", "zoomed, bars too narrow for a gap", "usd-age", { zoom: [0.10, 0.90], settings: { bins: 1000 }, window: "laptop" });
    add("2018-12-15", "zoomed, no smoothing", "btc-lthsth", { zoom: [0.02, 0.20], settings: { smoothing: 0 } });
    add("2016-07-09", "zoomed, Y-max 90", "usd-lthsth", { zoom: [0.20, 0.60], settings: { ymax: 90 } });
    add("2020-05-11", "zoomed, the Y-axis pinned", "btc-age", { zoom: [0.30, 0.70], settings: { pin: true } });
    add("2025-10-06", "zoomed, on a laptop, in Chinese", "usd-age", { zoom: [0.75, 1.00], window: "laptop", lang: "zh" });
    add("2024-03-14", "the price right of the view, on a wide screen, in Japanese", "btc-lthsth", { zoom: [0.00, 0.10], window: "wide", lang: "ja" });
    add("2019-06-26", "the price left of the view, in Chinese", "usd-lthsth", { zoom: [0.70, 0.95], lang: "zh" });
    add("2024-04-20", "halving 4's block, zoomed", "usd-age", { block: 840000, zoom: [0.40, 0.70], tz: "America/New_York" });
    add("latest", "the newest block, zoomed", "btc-lthsth", { block: "tip", zoom: [0.60, 0.90], tz: "Asia/Singapore" });
    add("2023-06-01", "a marked range inside the view", "usd-age", { mark: [0.30, 0.45], zoom: [0.25, 0.50] });
    add("2021-04-14", "a marked range cut by the view's left edge", "usd-lthsth", { mark: [0.30, 0.45], zoom: [0.40, 0.70] });
    add("2019-06-26", "a marked range cut by the view's right edge", "btc-age", { mark: [0.30, 0.45], zoom: [0.20, 0.40] });
    add("2022-06-18", "a marked range wider than the view", "btc-lthsth", { mark: [0.20, 0.80], zoom: [0.40, 0.60] });
    add("2024-03-14", "a marked range outside the view", "usd-age", { mark: [0.05, 0.12], zoom: [0.50, 0.80] });
    // The mouse itself (see the top of this file): the wheel in and out at one spot, the left drag, the wheel sideways,
    // the right drag and the two ways to clear what it marks, the two ways back to the whole axis, the ends of the axis,
    // a view carried across days, and what none of them does on the whole axis.
    add("latest-complete", "the wheel in and back out at one spot, then the left drag", "usd-lthsth",
      { mouse: [["wheel", 0.80, -16], ["wheel", 0.80, 13], ["drag", 0.50, 0.72], ["drag", 0.60, 0.21]] });
    add("2021-11-10", "the wheel in, sideways, with Shift, then two clicks", "btc-age",
      { mouse: [["wheel", 0.31, -12], ["sideways", 0.31, 300], ["shift-wheel", 0.31, -3], ["wheel", 0.55, 4], ["click2", 0.50]] });
    add("2022-11-21", "zoomed, the right drag marks and two right-clicks clear", "usd-age",
      { mouse: [["wheel", 0.25, -6], ["mark", 0.30, 0.52], ["drag", 0.40, 0.55], ["right-click2", 0.45]] });
    add("2017-12-17", "a mark on the whole axis, zoomed over, then Escape twice", "btc-lthsth",
      { mouse: [["mark", 0.20, 0.60], ["wheel", 0.40, -5], ["key", "Escape"], ["key", "Escape"]] });
    add("2024-04-20", "the whole axis: a left drag and the wheel out do nothing; in as far as it goes and all the way out", "usd-lthsth",
      { window: "laptop", mouse: [["drag", 0.30, 0.60], ["wheel", 0.50, 3], ["wheel", 0.50, -45], ["wheel", 0.50, 60]] });
    add("2020-05-11", "a view carried to the next day and back", "btc-age",
      { mouse: [["wheel", 0.40, -8], ["press", "next"], ["press", "prev"], ["wheel", 0.40, 3]] });
    add("2013-11-29", "against the ends of the axis", "usd-age",
      { window: "wide", mouse: [["wheel", 0.03, -7], ["drag", 0.20, 0.95], ["wheel", 0.97, -4], ["sideways", 0.50, 4000], ["drag", 0.80, 0.10]] });
    add("2024-04-20", "the mouse on a block", "usd-lthsth",
      { block: 840000, tz: "UTC", mouse: [["wheel", 0.50, -9], ["mark", 0.40, 0.43], ["drag", 0.50, 0.44], ["wheel", 0.62, 5]] });
    add("2011-06-08", "the mouse on a day with bars under a dollar wide", "usd-lthsth",
      { mouse: [["wheel", 0.45, -10], ["drag", 0.30, 0.70], ["mark", 0.50, 0.60]] });
    add("latest-complete", "a marked range kept while the axis moves under it", "btc-lthsth",
      { lang: "zh", mouse: [["wheel", 0.85, -7], ["mark", 0.10, 0.90], ["drag", 0.50, 0.30], ["wheel", 0.50, 2], ["key", "Escape"]] });
    add("2010-07-18", "the mouse on a day with nothing to draw", "usd-age",
      { mouse: [["wheel", 0.50, -4], ["mark", 0.30, 0.50], ["right-click2", 0.40], ["click2", 0.40]] });
    add("2022-06-18", "Ctrl and the left button mark, for a mouse with one button", "btc-age",
      { mouse: [["ctrl-mark", 0.30, 0.50], ["wheel", 0.40, -3], ["ctrl-mark", 0.60, 0.20]] });
    return { kind, seed: 20261104, windows: WINDOWS, traces };
  }
  if (kind !== "daily") throw new Error("unknown plan " + kind);
  const rand = generator(seed), pickOf = (list) => list[Math.floor(rand() * list.length)];
  for (const v of VIEWS) add("latest-complete", "the latest complete day", v);
  add("latest", "the day in progress", pickOf(VIEWS));
  for (const d of randomDays(rand, 4, "2010-08-16", "2026-10-01"))
    add(d, "random", pickOf(VIEWS), { window: pickOf(["desktop", "desktop", "laptop", "wide", "phone", "landscape"]), lang: pickOf(["en", "en", "zh", "ja"]) });
  add(randomDays(rand, 1, "2009-01-03", "2011-01-31")[0], "random early day", pickOf(VIEWS));
  const [lm, why] = pickOf(LANDMARKS.slice(5));
  add(lm, why, pickOf(VIEWS), { settings: pickOf([{ bins: 50 }, { bins: 1000 }, { smoothing: 0 }, { smoothing: 1 }, { ymax: 90 }, { pin: true }]) });
  const a = rand() * 0.8;
  add(randomDays(rand, 1, "2012-01-01", "2026-10-01")[0], "random marked range", pickOf(VIEWS), { mark: [a, a + 0.02 + rand() * 0.3] });
  add("2010-05-18", "a marked range where no coin last moved", "btc-age", { mark: [0.05, 0.12] });
  // One block: the newest, a random one in a random time zone and language, and the step buttons from a random day.
  add("latest", "the newest block", pickOf(VIEWS), { block: "tip", tz: pickOf(ZONES) });
  add(randomDays(rand, 1, "2010-08-16", "2026-10-01")[0], "a random block", pickOf(VIEWS),
    { block: pickOf(["first", "mid", "before-last"]), tz: pickOf(ZONES), lang: pickOf(["en", "en", "zh", "ja"]) });
  add(randomDays(rand, 1, "2011-02-01", "2026-10-01")[0], "1B back, then forward twice, from a random day", pickOf(VIEWS),
    { steps: ["1B", "prev", "next", "next"], tz: pickOf(ZONES) });
  // The price axis zoomed: the latest complete day on a random stretch of prices, and the mouse itself on a random
  // day (the wheel in and part of the way back at one spot, a drag either way, a marked range, and one of the ways out).
  const z = rand() * 0.85;
  add("latest-complete", "the latest complete day, zoomed on a random stretch of prices", pickOf(VIEWS), { zoom: [z, z + 0.03 + rand() * 0.4] });
  const at = 0.05 + rand() * 0.9, to = 0.1 + rand() * 0.8, m = 0.05 + rand() * 0.6;
  add(randomDays(rand, 1, "2011-02-01", "2026-10-01")[0], "the mouse on a random day", pickOf(VIEWS), { window: pickOf(["desktop", "desktop", "laptop", "wide"]),
    mouse: [["wheel", at, -(4 + Math.floor(rand() * 12))], ["wheel", at, 1 + Math.floor(rand() * 3)], ["drag", 0.5, to], ["mark", m, m + 0.05 + rand() * 0.3],
      pickOf([["right-click2", 0.5], ["key", "Escape"], ["click2", 0.5], ["press", "prev"]])] });
  return { kind, seed, windows: WINDOWS, traces };
}
