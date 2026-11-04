// Which traces an eval run draws. A trace is one day of the chart drawn one way a visitor can see it: the day, the
// view (% USD or % BTC, AGE or LTH/STH), the window, the language, the toolbar settings and, sometimes, a marked
// range. The dimensions come from error analysis (see README.md): where problems were found, and where they were
// found before (the regression history). Days are either fixed (landmarks, the edges of the history, the latest days)
// or random from a seeded generator, so a plan is the same every time it is made from the same seed.
//
//   plan("review")       the error-analysis set: 117 traces over 36 days, every dimension (about 6 minutes)
//   plan("daily", seed)  the monitoring sample: the latest days in every view, plus random days, windows, languages,
//                        settings and marked ranges that change with the seed (one a day), so the history is
//                        covered over time (about a minute)

export const WINDOWS = { desktop: [1600, 1000], laptop: [1280, 720], wide: [1920, 1080], phone: [390, 844], landscape: [844, 390] };
export const VIEWS = ["usd-lthsth", "usd-age", "btc-lthsth", "btc-age"];

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
    window: "desktop", lang: "en", settings: {}, mark: null, ...extra });
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
  return { kind, seed, windows: WINDOWS, traces };
}
