// Which traces an eval run draws. A trace is one day, or one block, of the chart drawn one way a visitor can see it:
// the day or block, the view (% USD or % BTC, AGE or LTH/STH), the window, the language, the visitor's time zone, the
// toolbar settings and, sometimes, a marked range or a few presses of the step buttons. The dimensions come from error
// analysis (see README.md): where problems were found, and where they were found before (the regression history).
// Days are either fixed (landmarks, the edges of the history, the latest days) or random from a seeded generator, so a
// plan is the same every time it is made from the same seed.
//
//   plan("review")       the error-analysis set: 161 traces, every dimension (about 9 minutes)
//   plan("daily", seed)  the monitoring sample: the latest days in every view and the newest block, plus random days,
//                        blocks, windows, languages, time zones, settings, marked ranges and steps that change with
//                        the seed (one a day), so the history is covered over time (about a minute)
//
// A block is given as a height, or by where it falls: "tip" (the newest block), or the trace's day's "first", "mid",
// "before-last" or "last" block. Steps are the toolbar's own buttons, pressed in turn: "1B", "1D", "1W", "1M", "1Y" (the
// step size), "prev" and "next" (the arrows).

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
    window: "desktop", lang: "en", settings: {}, mark: null, block: null, tz: null, steps: null, ...extra });
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
  return { kind, seed, windows: WINDOWS, traces };
}
