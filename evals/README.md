# Evals

How this site checks that the chart a visitor sees is right. The method follows Hamel Husain and Shreya Shankar's
[evals FAQ](https://hamel.dev/blog/posts/evals-faq/): look at real outputs before writing any check (error analysis),
name the failures you actually find, then write one binary, pass-or-fail check for each failure that matters,
prefer plain code to judgement, prove each check catches its failure and lets good output through, and keep
looking at new outputs, because the checks only know the failures already found.

## What a trace is

One day of the chart drawn one way a visitor can see it: the day, the view (% USD or % BTC, AGE or LTH/STH), the
window (desktop, laptop, wide, phone upright or turned), the language (English, Chinese, Japanese), the toolbar
settings (bins, smoothing, Y-max, a pinned axis) and, sometimes, a marked price range. `collect.mjs` draws it in
headless Chromium from the live data and records what came out: the day's totals, the bars, the axes, every
word on the chart with where it sits on screen, the toolbar, any error in the console, and a screenshot.

`plan.mjs` chooses the traces. `review` is the error-analysis set, 117 traces over 36 days: the edges of the history
(the genesis day, the days when every coin was still at $0), the cycle tops, bottoms and halvings, 12 random days,
the latest complete day and the day in progress, each in two or four views, plus other windows, languages,
settings and eight marked ranges. `daily` is a smaller sample, about 12 traces: the latest days in every view and
random days, windows, languages, settings and marked ranges that change with the date, so that over time the
whole history is covered.

## Error analysis, November 2026

All 117 traces of the `review` plan were drawn from the live site and every screenshot was looked at, with notes on
anything that made the chart less useful (open coding). The notes were then grouped into failure modes and counted
(axial coding), together with what the 188 merged pull requests had fixed before, which is where the earlier
failures are recorded.

| Failure | In the 117 traces | Seen before | Check | Now |
|---|---|---|---|---|
| A marked range's box says something untrue: "Already All Long-Term Holders" (t111) or "0 Days" (t116) over a range where no coin last moved | 2 of 8 marked ranges | #173–#177 | `mark-box` | fixed: it says "No BTC Last Moved Here" |
| A marked range's white line is drawn over a bar, not in the gap beside it, so the mark seems to cut bars and a drag slides instead of moving a bar at a time | found after: the owner asked for the drag to go a bar at a time, and in Chromium a line covered part of a bar at 36 of 36 drag steps | — | `mark-edges` | fixed in #196 |
| A day with nothing to draw is a blank plot with no word why: the genesis day, and every day before the first BTC/USD close (16 Aug 2010), when every coin is at $0 | 14 | — | `empty-note` | fixed: a note in the plot says why |
| The day does not draw at all | 0 | #191: BRK changed its API and no day loaded; the owner found it, no check did | `draws` | checked daily |
| Another day's title, counter or price | 0 | #4, #6: the price two days behind | `right-day` | checked daily |
| Totals off BRK's own series: supply, realized cap, LTH/STH, coins in profit | 0 | #99, #144; checked by hand before | `supply`, `realized-cap`, `holders`, `in-profit` | checked daily |
| Bars lost off the axis or out of the bins | 0 | a zero bin width once dropped a whole day | `bars-total` | checked daily |
| Words colliding or leaving the window | 0 | #24, #39, #76, #118, #174 | `labels-clear` | checked daily |
| A page wider than the window, or the toolbar wrapping or scrolling | 0 | #15, #94, #101 | `fits-window` | checked daily |
| Stale videos or axis history | — | #166, #169; the video workflow failed twice on 31 Oct 2026 | `video-links`, `axis-history` | checked daily |

Noted, with no check, because each is a choice for the owner rather than a fault:

- On a phone held upright the chart is a small letterboxed strip. That is by design (index.html: the figure keeps
  its desktop proportions and asks to be turned), and turned it fills the screen.
- The latest day is the day in progress: its price is the latest, not a close, and its totals grow until midnight
  UTC. The data checks leave it out, since its reference moves with every block.
- The box's coins in profit can differ from BRK's own figure by up to 0.31 points (crash and top days), because the
  site counts BRK's buckets, whose prices are rounded to four significant figures, so that the box agrees with
  Percent of Total at the dashed line (#144), while BRK counts each coin's own price.
- At a cycle top the price line's orange dot can touch the price box (4 traces). Cosmetic.
- The videos and the axis history were built while BRK's old API rounded prices more coarsely. The site now reads
  the finer buckets, so the days from 16 Aug 2010 to 30 Jan 2011 have small bars in % USD on the site that the USD
  videos, which start on 31 Jan 2011, do not show.

## The checks

`checks.mjs` holds them. Each is a few lines of code with a yes or no answer and the reason; none scores, weighs or
asks a model. A trace passes when it passes every check that applies to it, and a run reports that pass-all count
and each check's own count.

| Check | Fails when |
|---|---|
| `draws` | an error notice, a script error, a failed data request (not a fetch ahead the page called off after 15 s), or the loading sign left up |
| `right-day` | the title, the day counter or the data name another day, or the price is not BRK's close for the day |
| `supply` | the day's coins differ from BRK's circulating supply (to a part in ten million) |
| `realized-cap` | each coin at its price when last moved does not add up to BRK's realized cap (to 0.1 %) |
| `holders` | the age bands under 150 days, or the rest, differ from BRK's short- or long-term holder supply |
| `in-profit` | the price box's coins in profit is more than half a point from BRK's supply in profit |
| `bars-total` | the bars drawn add up to anything but 100 % of the day |
| `labels-clear` | two boxes of words overlap, or one sits on the legend or title or leaves the window |
| `fits-window` | the page is wider than the window, or the toolbar wraps or scrolls |
| `mark-box` | a marked range's box claims long-term holders where no coin last moved, or no coins where some did |
| `mark-edges` | a marked range's white line covers part of a bar, where bars are 2 px or more apart and the chart leaves a gap between them |
| `empty-note` | a day with nothing to draw has no note saying why, or a day with bars has one |
| `video-links` | a video menu link is not one of the four latest videos, or they end over 45 days ago |
| `axis-history` | `data/scales.json` ends over 2 days ago |

The data checks compare against Bitcoin Research Kit's own day series (`refs.mjs`), which BRK computes separately
from the URPD buckets the site draws. They leave out the day in progress.

## Checking the checks

`tests/evals.test.cjs` runs every check over labelled examples (`fixtures/labelled.json`): 14 real traces of the
live site that review found good, and failures made from them that reproduce each one seen before, from a price two
days behind to a box over the price box. Each check must pass every good example it applies to and fail every
failure made for it, so a check that misses its failure, or flags a good chart, fails in the regression tests.

Running the checks on the 117 reviewed traces also checked them against the review. That run found two mistakes
in the evals themselves, both fixed before they were trusted: the collector read the day's totals from a cache
the page empties after ten days, so 15 traces of days drawn earlier read zero coins (fixed: it fetches them), and the
in-profit check's first tolerance, 0.1 points, flagged 16 good traces (5 days) where BRK's buckets explain the difference
(now half a point, above the largest seen, 0.31, and well below the 2.2-point error of #144).

## Running them

Once, in `evals/`: `npm ci --ignore-scripts` and `npx playwright install chromium`. Then, from the repository:

```sh
node evals/run.mjs                          # the daily sample, on https://www.bitcoinurpd.com/
node evals/run.mjs --local                  # the same on this checkout, served on 127.0.0.1, before a merge
node evals/run.mjs --plan review --shots    # all 117 traces, with screenshots, to review by eye
node evals/run.mjs --traces evals/out/RUN/traces.json   # judge a run's traces again, after changing a check
```

Each run writes `traces.json`, `results.json` and `report.html` (every trace's screenshot and verdicts, failures
first) to `evals/out/` and exits with 1 if anything failed. The Evals workflow (`.github/workflows/evals.yml`) runs
the daily sample at 03:17 UTC; a red run emails the owner, and its traces and review page are kept for 30 days as the
run's `evals` artifact. Run it by hand with plan `review` for the full set.

## Keeping them useful

- Look at the traces again, with `--plan review --shots` and `report.html`, after any large change and every few
  months. Write down anything that makes the chart less useful, whoever's fault it is.
- Add a check only for a failure actually found, and a labelled example for it in `fixtures/labelled.json` with
  a failure made for it in `tests/evals.test.cjs`, and fix the site with a regression test of its own.
- These checks are exact, so a daily run is expected to pass in full; a failure is a fault to fix. A check that has
  not failed in months on new days is a candidate to run less often or retire.
