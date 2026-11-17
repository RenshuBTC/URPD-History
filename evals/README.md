# Evals

How this site checks that the chart a visitor sees is right. The method follows Hamel Husain and Shreya Shankar's
[evals FAQ](https://hamel.dev/blog/posts/evals-faq/): look at real outputs before writing any check (error analysis),
name the failures you actually find, then write one binary, pass-or-fail check for each failure that matters,
prefer plain code to judgement, prove each check catches its failure and lets good output through, and keep
looking at new outputs, because the checks only know the failures already found.

## What a trace is

One day, or one block, of the chart drawn one way a visitor can see it: the day or the block (1B), the view (% USD or
% BTC, AGE or LTH/STH), the window (desktop, laptop, wide, phone upright or turned), the language (English, Chinese,
Japanese), the visitor's time zone (a block's time is printed on the visitor's own clock), the toolbar settings (bins,
smoothing, Y-max, a pinned axis) and, sometimes, a marked price range, presses of the step buttons, a zoomed price
axis, or the mouse itself at work on the chart. `collect.mjs` draws it in headless Chromium from the live data and
records what came out: the totals, the bars, the axes, every word on the chart with where it sits on screen, the
price labels a visitor can actually see, the dot on the price line, the toolbar, where each press of a step button
landed, what each turn of the wheel and each drag left behind, any error in the console, and a screenshot. A zoomed
view is then held to the whole axis, drawn in its place.

`plan.mjs` chooses the traces. `review` is the error-analysis set, 205 traces over 57 days and 27 blocks: the edges of
the history (the genesis day, the days when every coin was still at $0), the cycle tops, bottoms and halvings, 12
random days, the latest complete day and the day in progress, each in two or four views, plus other windows,
languages and settings, 20 marked ranges, 37 traces of blocks in six time zones (the newest block, a day's first and
last, the halving block, blocks before any coin had a price, random ones), 8 runs of the step buttons, 32 zoomed
views (the price in view and to either side of it, both ends of the axis, ten bars, bars under a dollar wide, every
setting, marked ranges the view cuts) and 12 runs of the real mouse, 49 acts in all (the wheel in and out at one
spot, sideways and with Shift, a drag with either button, double clicks, Escape, a view carried to the next day).
`daily` is a smaller sample, 18 traces: the latest days in every view, the newest block, a zoomed view of the latest
day, the mouse on a random day, and random days, blocks, windows, languages, time zones, settings, marked ranges and
button presses that change with the date, so that over time the whole history is covered.

## Error analysis, November 2026

All 117 traces of the first `review` plan were drawn from the live site and every screenshot was looked at, with notes
on anything that made the chart less useful (open coding). The notes were then grouped into failure modes and counted
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

## Second error analysis, 17 November 2026

Two weeks on, the evals were rebuilt the same way, for two reasons. The chart had gained things no check covered:
one block at a time (1B) and a block's time on the visitor's own clock (#199, #200). And the daily run had turned red
on four of its first thirteen days (7, 8, 12 and 14 Nov), which is the checks doing their job, or failing at it, and
each run had to be read to tell which.

The four red runs' traces were read first. Then 161 traces were drawn from the live site (the 117, six made from the
red runs, and 38 on blocks, time zones and the step buttons), every screenshot was looked at, and the notes were
grouped and counted as before.

| Failure | In the 161 traces | In the daily runs | Check | Now |
|---|---|---|---|---|
| A marked range's box is written over a cycle top's label | 2 of 15 marked ranges (t118, t119) | red on 7 and 12 Nov | `labels-clear` | fixed: the box starts below a label at the top of the plot and stops above one further down |
| The dot on the price line, which is drawn over everything, hides letters of a marked range's box | 1 (t123) | — | `labels-clear`, which now knows where the dot is | fixed: the box keeps clear of the dot |
| On a phone held upright the dot covers the last line of the price box: the dot keeps its size on the screen while the figure is drawn at a fifth of its size, and the box allowed for a desktop's dot | 1 of 5 (t093) | — | `labels-clear` | fixed: the box and the cycle labels allow for the dot as large as it is there |
| A marked range's box was laid out against where the price box stood before it moved clear of the dot, and covered its last 13 px | found reading the code for the rows above | — | `labels-clear` | fixed |
| The chart does not draw: one of a day's 23 requests goes unanswered, the page calls it off after 15 s and shows an error in place of the chart | 1 (t088, with BRK busy answering a second collection; it drew at a second try) | red on 14 Nov | `draws` | fixed: a request that fails while the day's others were answered is asked once more |
| With 1B the chart shows another block, or its time on another clock, day or price | 0 of 34 blocks | — | `right-block` (new) | checked daily |
| A step button does not move as it says: 1B a block at a time, 1D from a block to the end of its day, nothing past the newest block | 0 of 8 runs | — | `block-steps` (new) | checked daily |

The same reading found six mistakes in the evals themselves, the kind the FAQ warns of: a check nobody has checked
is only an opinion.

- `in-profit` allowed half a point between the price box and BRK's own figure, a guess made from the largest
  difference seen (0.31). On 16 Jun 2022 they are 0.62 apart and the chart is right (red on 8 Nov): 0.62% of the coins
  last moved in the day's last block, at the close itself, which BRK records as $20,330, above the $20,325.71 close.
  The check is now exact, in two parts: the box has to be the recorded prices at or below the price, to the last
  digit, and BRK's own figure has to lie between the coins surely in profit and all but those surely in loss.
- `mark-edges` added up a white line's overlap over every age band stacked on the same bar, and failed a good trace
  by 0.07 px (14 Nov). It now measures against the bars' outline.
- `draws` failed a trace whose chart drew, because a request for a day the page was fetching ahead had failed (2 of
  the 161). The collector now records which address an error is for, and a failed request for a day's data is left
  to the page's own notice and to the data checks.
- The collector read a marked range's box while its days line still read "…", loading. It now waits for it, and
  `mark-box` fails a box still loading after 20 s.
- The collector waited 240 s on a page that had already said it could not load. It now stops once the notice has
  stood, tries once more after 20 s, and a trace that drew only at its second try is named in the run's output.
- The collector never saw the page's notice at all. It asked whether the notice had an `offsetParent`, which an
  element fixed to the window never has, shown or not. So the `draws` check's notice clause passed its made failures
  and could not fire on a real trace, and the fix above did nothing: in the first review of the live site after it,
  two blocks whose data BRK did not send in 30 s were still waited out for 240 s each (both drew at the second try).
  Found by reading that green run's "drew at the second try" lines. It now asks whether the notice is displayed.

## Third error analysis, 17 November 2026: the price axis zoomed

The same day the chart gained a zoomed price axis: the wheel zooms, the left button drags, and marking moved to the
right button (#204). Two faults were found on its first screenshots, by eye, and fixed before any check existed
(#205, #206). So the wheel was measured in a real browser and 44 traces of the new behaviour were drawn (32 zoomed
views and 12 runs of the mouse), every screenshot looked at, and the notes counted.

| Failure | Found in | Check | Now |
|---|---|---|---|
| The wheel lets the price under the pointer slide: up to 2.9 bars after sixteen notches at one spot, 5.7 once turned back. Every turn read the price off the bars just drawn, so each drawing's rounding to whole bars was added to the last one's | 12 of 12 runs measured on the live page | `mouse` (new) | fixed in #207: one price is held for a whole run of turns, to half a bar |
| A marked range cut short by a zoomed view has a white line at the view's edge, as if it ended there; at the right edge the line is drawn over the last bar in view | 3 of 3 marks cut by a view (t190 to t192) | `mark-edges`, which now counts the mark's ends in view | fixed in #208 |
| A marked range's box gives its prices in whole dollars where a bar is cents wide: $10.69 to $11.17 reads "$11 – $11" (8 Jun 2011) | 1 of 1 mark on such a day (t202); on the whole axis too, since marks were added | `mark-box`, which now reads the range | fixed in #208: prices to the bar |
| A zoomed view writes prices as thousands to three decimals: $9.891K, $1.029K | 3 of 32 zoomed views (t172, t174, t180) | `price-labels` (new) | fixed in #208 |
| A zoomed view writes a price with one decimal: in dimes, $8.1 for a gridline at $8.05 beside a marked range's box given to the cent, or in cents with the last zero dropped, $11.3 between $11.22 and $11.38 | 3 of 32 zoomed views (t175; t176, t178) | `price-labels` (new) | fixed in #208 (the zero kept) and #210 (cents, not dimes) |
| A zoomed view's label most of a step from its gridline's price ($102,571 as "$100K"), and its last label missing, hidden by Plotly | the first screenshots (#205, #206) | `price-labels` (new) | fixed |
| A zoomed view that is not the day's own bars: part-bars, other heights or shares, another left axis, a price box off its line | 0 of 44 | `zoom-view` (new) | checked daily |

The three checks were written against the 44 traces as the page first drew them, and the two older ones were widened
the same way. On those traces they fail 10 (the 4 marked ranges and 6 views with a label fault) and pass the other
34; on the page as fixed they pass all 205.

Again the reading found mistakes in the evals themselves:

- The unit test of the wheel, and the first draft of the `mouse` check, allowed the price under the pointer a bar of
  slack at each notch and started again from each drawing. A fault that adds up over a gesture passes any check that
  looks at one step of it. The check now holds the price before a whole run of turns to the price after it.
- The first measurements put the pointer at fractions of a pixel. A browser tells a page whole pixels, so up to a
  third of a bar of what was measured was the measuring. The collector moves the pointer to whole pixels and records
  them.
- Looking at the screenshots four to a sheet found three of the six views with a label fault. The dimes were only
  noticed later, on a screenshot of the live page taken to check the first fixes. The checks, written for the cases
  that were seen, found the other three ($1.046K on t180, the dropped zeros on t176 and t178). Eyes find the kind of
  fault; code finds every case.
- `mark-edges` first flagged the cut marks only because a line happened to sit on a bar, and passed the one whose
  line sat beside the first bar (t190). What was wrong was the line being there at all, so that is what it counts.

Noted, with no check, because each is a choice for the owner rather than a fault:

- On a phone held upright the chart is a small letterboxed strip. That is by design (index.html: the figure keeps
  its desktop proportions and asks to be turned), and turned it fills the screen.
- The latest day is the day in progress: its price is the latest, not a close, and its totals grow until midnight
  UTC. The data checks leave it out, since its reference moves with every block. A block is settled once mined.
- The price box counts the coins recorded at or below the price, so that it agrees with Percent of Total at the
  dashed line (#144). BRK records each coin's price to four significant figures, so the coins recorded at the price's
  own figure can sit either side of it, and BRK's own series, from each coin's exact price, can differ by up to those
  coins: 0.62 points on 16 Jun 2022, 0.04 on an average day (129 days sampled). On that day the box prints 50.0% in
  loss and lights the bottom signal, where BRK has 49.33% in loss. Showing BRK's own figure instead would undo #144.
- The videos and the axis history were built while BRK's old API rounded prices more coarsely. The site now reads
  the finer buckets, so the days from 16 Aug 2010 to 30 Jan 2011 have small bars in % USD on the site that the USD
  videos, which start on 31 Jan 2011, do not show.
- A marked range's box is as wide as the part of the mark in view. A mark wider than a zoomed view therefore has a
  box right across the plot, over the tops of the tallest bars (t192), as a wide mark has on the whole axis.
- A marked range outside a zoomed view shows nothing until the view comes back to it (t193).
- The price box gives the day's price in whole dollars from $10 up, as the videos do, also on the days of 2011 to
  2013 when a bar is cents wide and a zoomed axis is labelled to the cent.
- With Y-max under 100 a zoomed view can cut most of the bars it shows: the axis ends where it does on the whole
  axis, and a dense stretch of prices holds the day's tallest bars (t182: 57 bars cut at Y-max 90).

## The checks

`checks.mjs` holds them. Each is a few lines of code with a yes or no answer and the reason; none scores, weighs or
asks a model. A trace passes when it passes every check that applies to it, and a run reports that pass-all count
and each check's own count.

| Check | Fails when |
|---|---|
| `draws` | an error notice, a script error, a failed request for anything but a day's data, or the loading sign left up |
| `right-day` | the title, the day counter or the data name another day than the one asked for, or the price is not BRK's close for the day |
| `right-block` | with 1B, the title or the counter names another block than the one asked for, the block's time is not BRK's on the visitor's own clock (date, hour, minute and the zone named), it is put on another day, or the price is not BRK's price at that block |
| `supply` | the coins differ from BRK's circulating supply on the day or at the block (to a part in ten million) |
| `realized-cap` | each coin at its price when last moved does not add up to BRK's realized cap (to 0.1 %) |
| `holders` | the age bands under 150 days, or the rest, differ from BRK's short- or long-term holder supply |
| `in-profit` | the price box's coins in profit are not the recorded prices at or below the price, or BRK's supply in profit is outside what those prices allow |
| `bars-total` | the bars drawn add up to anything but 100 % of the day (for a zoomed view, on the whole axis drawn in its place) |
| `labels-clear` | two boxes of words overlap, one sits on the legend or title or leaves the window, or the dot on the price line is over a box of figures |
| `fits-window` | the page is wider than the window, or the toolbar wraps or scrolls |
| `mark-box` | a marked range's box claims long-term holders where no coin last moved, or no coins where some did, its days never finish loading, or its two prices are not the mark's own to within half a bar |
| `mark-edges` | a marked range's white line covers part of a bar, where bars are 2 px or more apart and the chart leaves a gap between them, or a white line stands anywhere but at an end of the mark that is in view |
| `block-steps` | a press of a step button lands anywhere but where the page says it goes, the step size picked is not taken, or a notice comes up |
| `price-labels` | a price label the page asked for is not on screen, two in a row read the same, one is written in thousands to three decimals or (zoomed) with a single decimal, or one names another price than its gridline's (zoomed: over a tenth of a step away; the whole axis: beyond its two figures) |
| `zoom-view` | a zoomed price axis is not whole bars of the day, ten at the least, where they were asked for; a bar differs from the whole axis's in price, height, running share or amount; the left axis ends anywhere but the lower of the whole axis's top and the tallest bar in view (pinned: the pin); the gridlines are not twenty steps over the view; or the price box is neither on its line nor against the edge the line left by, with its arrow |
| `mouse` | the wheel zooms the wrong way, past ten bars or the whole axis, or lets the price under the pointer slide over a bar in a run of turns; a left drag does not take a zoomed axis with it, or marks; a right drag (or Ctrl and the left) does not mark the bars it passed over, moves the view or lets the browser's menu open; two clicks or Escape do not give the whole axis back; two right-clicks or Escape do not clear the mark; or a step to another day loses the view |
| `empty-note` | a day with nothing to draw has no note saying why, or a day with bars has one |
| `video-links` | a video menu link is not one of the four latest videos, or they end over 45 days ago |
| `axis-history` | `data/scales.json` ends over 2 days ago |

The data checks compare against Bitcoin Research Kit's own series (`refs.mjs`), by day and, for a block, at its
height, which BRK computes separately from the URPD buckets the site draws. They leave out the day in progress.

## Checking the checks

`tests/evals.test.cjs` runs every check over labelled examples (`fixtures/labelled.json`): 66 real traces of the
site that review found good (days and blocks, every window and language, five time zones, marked ranges, button
presses, zoomed views and every act of the mouse), and 114 failures made from them that reproduce each one seen
before, from a price two days behind to a block's time on the wrong clock to the wheel letting the price under the
pointer slide. Each check must pass every good example it applies to and fail every failure made for it, and a made
failure must fail no check but its own, so a check that misses its failure, flags a good chart or counts another
check's fault fails in the regression tests. `fixtures/build.mjs` makes the file from a reviewed run.

Running the checks on the reviewed traces also checks them against the review. The first time, that found two
mistakes in the evals before they were trusted: the collector read the day's totals from a cache the page empties
after ten days, so 15 traces of days drawn earlier read zero coins (fixed: it fetches them), and `in-profit`'s first
tolerance, 0.1 points, flagged 16 good traces. The second time it found the six above. One of them no labelled
example could have found: the checks only see what the collector records, so a run's own output is read too, green
or not. The third time the traces came first: the new checks were run on the 44 traces of the page before it was
fixed, where each had to fail the faults found by eye and nothing else, before the fixed page's traces were labelled.

## Running them

Once, in `evals/`: `npm ci --ignore-scripts` and `npx playwright install chromium`. Then, from the repository:

```sh
node evals/run.mjs                          # the daily sample, on https://www.bitcoinurpd.com/
node evals/run.mjs --local                  # the same on this checkout, served on 127.0.0.1, before a merge
node evals/run.mjs --plan review --shots    # all 205 traces, with screenshots, to review by eye
node evals/run.mjs --traces evals/out/RUN/traces.json   # judge a run's traces again, after changing a check
node evals/fixtures/build.mjs evals/out/RUN/traces.json t001,t124   # label reviewed traces as good examples
```

Each run writes `traces.json`, `results.json` and `report.html` (every trace's screenshot and verdicts, failures
first) to `evals/out/` and exits with 1 if anything failed. The Evals workflow (`.github/workflows/evals.yml`) runs
the daily sample every day (set for 03:17 UTC; GitHub starts it some hours later); a red run emails the owner, and
its traces and review page are kept for 30 days as the run's `evals` artifact. Run it by hand with plan `review` for
the full set.

## Keeping them useful

- Look at the traces again, with `--plan review --shots` and `report.html`, after any large change and every few
  months. Write down anything that makes the chart less useful, whoever's fault it is.
- Read every red run before fixing anything: the site may be wrong, or the check. The four red runs of the first
  thirteen days were two faults in the site and two in the evals.
- Read the green runs' output as well. "Drew at the second try" on two traces of a passing run was the collector
  missing every notice the page had ever shown.
- Add a check only for a failure actually found, and a labelled example for it in `fixtures/labelled.json` with
  a failure made for it in `tests/evals.test.cjs`, and fix the site with a regression test of its own.
- When the chart gains something a visitor can do, add traces of it to the plan in the same pull request. 1B went
  two weeks with none; the zoomed axis went live with none, and four faults were found in it the same day.
- Hold a gesture to what the page promises over the whole of it. A rule checked one step at a time lets through
  whatever adds up.
- These checks are exact, so a daily run is expected to pass in full; a failure is a fault to fix. A check that has
  not failed in months on new days is a candidate to run less often or retire.
