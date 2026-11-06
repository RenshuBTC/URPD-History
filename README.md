# Bitcoin URPD: UTXO realized price distribution, every day since 2009

**Website: [BitcoinURPD.com](https://www.bitcoinurpd.com)**

The Bitcoin URPD (UTXO Realized Price Distribution) sorts every bitcoin by the price at which it last moved on-chain
and adds up the supply at each price. BitcoinURPD.com draws it for every day since 2009-01-03, each bar split into
short- and long-term holders (LTH/STH, at 150 days) or into 23 age bands, with the left axis fitted to each day's own
bars. It is a cost-basis distribution of the whole bitcoin supply: a tall bar is a price where a lot of supply last
moved, a gap is a price where almost none did, and the price box gives the share of the day's value (or coins) in
profit and in loss at the day's price. Data from Bitcoin Research Kit.

- **Scrub through history:** drag the orange dot along the price line, or use **← / →** (step size **1B / 1D / 1W /
  1M / 1Y**, keys **1** to **5**; **1B** steps one block at a time); see [Controls](#controls).
- **Full-history videos:** four 5-minute 4K videos on YouTube, one for each weighting and colouring (% USD or % BTC,
  LTH/STH or AGE), in the toolbar's **FULL HISTORY VIDEOS** menu; see [How it works](#how-it-works).
- **Explainer** in English, Chinese and Japanese: **?** in the toolbar.

## Reading it

- **Bottom axis** is the price each coin last moved at, not today’s price.
- **Left axis** is each bucket’s share of the day, in percent: of the realized cap (every coin’s value when it last moved, added up) in **% USD** mode, *Percent of USD Value Last Moved [%]*, and of all the coins in **% BTC** mode, *Percent of BTC Supply Last Moved [%]*. A day’s bars add up to 100%, so the same height is the same share on any day; the hover gives the amount behind each share. Both axes are marked at twenty equal steps from zero to their very end, labels rounded to two significant figures.
- **The price axis only grows.** It ends exactly at the highest price any coin had last moved at by the day you are viewing, moves only when the data goes past it, and never shrinks, so scrubbing back shows every day exactly as it looked at the time. BINS cuts it into 625 bars by default (50 to 1000), each exactly 1/625 of it (201.04 dollars on the 125,650 dollar axis of late 2025), whatever the smoothing, so a bar's height depends on the data and the bin count alone.
- **The left axis ends at the day’s own bars**, where the **Y-MAX** field says, as a percentile of the day’s bar heights, and nothing else moves it but **PIN Y-AXIS**. At 100, % USD mode’s default, the day’s tallest bar reaches the top, so every day’s shape fills the same frame. % BTC mode starts at 99.8: its first bar, the coins last moved for less than one bar’s width, is around ten times any other and runs off the top. Every bar the axis cuts is counted in the **▲** figure at the top left, the tallest one’s height and how many more, so no bar is cut without it showing.
- **Hover a bar** for its price, its age band (or holder group), the whole bar’s total (Total Value When Last Moved, or Total Supply) and Percent of Total, the running share of the day at or below that price.
- **White line** is bitcoin’s own price on its own hidden axes: a year of time around the selected day, and linear from $0 to the highest close shown so far, so the line fills the chart and only rescales on a new high.
- **Dashed vertical** is the spot price. Supply to its left last moved below it, supply to its right above it. It and the price box turn yellow when the **bottom signal** is on: at least the threshold set in the toolbar of the day in loss (80% of the value in % USD mode, 50% of the coins in % BTC mode by default).
- **Colour** is age: yellow is fresh, deep blue is ancient, logarithmic in between. The 23 colours lie on one path through OKLCH, evenly spaced to the eye, with lightness falling from young to old so the order survives greyscale, and every band at least 3:1 against the background.
- **LTH/STH**, the default, adds the same bands up into two at 150 days: short-term holders (STH, amber), the coins that moved within the last 150 days, under long-term holders (LTH, blue), the coins unmoved for 150 days or more. 150 days is Bitcoin Research Kit’s line between the two (Glassnode draws it at 155). The bars and axes are the same as in AGE; only the colours change.

Press **?** (How to read this chart) in the toolbar for the full explainer, in English, Chinese or Japanese.

## Controls

Mouse: drag the orange dot along the white price line to any day.

Keyboard:

- **A / D** or **← / →** — previous / next step
- **1 / 2 / 3 / 4 / 5** — step interval: 1B / 1D / 1W / 1M / 1Y, in the toolbar's order (1D to start with)
- **W / S** or **↑ / ↓** — step interval up / down, one size at a time (1B → 1D → 1W → 1M → 1Y, and round again)
- **Home / End** — first / last date

% USD / % BTC and LTH/STH / AGE are switched with their toolbar buttons.

A day is drawn as it stood at its last block. **1B** steps one block at a time instead, about ten minutes: from a day,
to the block before its last or to the first block of the next day. The box between the arrows then gives the block's
height, the title its height and time (UTC), the dashed line is bitcoin's price at that block, and the orange dot sits
as far into its day as the block is. The price axis is the one the day before ended on, grown by the block's own data,
and never past its own day's end, so a day's last block is drawn exactly as the day. From a block, 1D steps forward to
the end of its day and back to the end of the day before. Past the newest block, the page says there is none yet.

Toolbar, left to right:

- Interval, date navigation, and a **CYCLE TOP/BTM** dropdown for cycle tops and bottoms
- **% USD / % BTC** — weight by dollar value at last move, or by coins, each bar drawn as its share of the day
- **LTH/STH / AGE** — split each bar into short- and long-term holders at 150 days (the default), or colour it by its 23 age bands
- **PIN Y-AXIS** — freeze the left axis where it is on the day you are viewing so other days can be compared against it; the Y-max field is off while it holds
- **Bottom signal** — the share of the day in loss (value in % USD mode, 80% by default; coins in % BTC mode, 50%) at which the dashed line and the price box turn yellow and the box adds a line naming the threshold
- **Bins**, **Smoothing** and **Y-max** — bins, how many equal-width bars the price axis is cut into up to the highest price so far (625 by default, 50 to 1000), with one more past it that takes in what the smoothing spreads beyond it, and each bar's width in dollars on the day shown after the count (BINS 625 $201); smoothing, which spreads each price stamp back over the dollar (ten dollars above $100K) it was rounded from and blurs it with a Gaussian of 0.24% of price by default; and Y-max, the percentile of the day’s bar heights where the left axis ends (100 in % USD mode, 99.8 in % BTC mode, each kept as you type it)
- **Click and drag** across the chart — mark a range of prices (whole columns); the mark stays as you move through the days and switch modes until a double-click or Escape clears it, and gives the range, the share of the day that last moved inside it (of the value in % USD, of the coins in % BTC) broken down by age band in AGE and between long- and short-term holders in LTH/STH, and the most days until every coin there is a long-term holder
- **FULL HISTORY VIDEOS** — a menu of the latest 5-minute full-history videos on YouTube, one for each weighting and colouring: **VIDEO (% USD-LTH/STH)**, **VIDEO (% USD-AGE)**, **VIDEO (% BTC-LTH/STH)** and **VIDEO (% BTC-AGE)** (each opens the channel until there is a video of it others can watch)
- together at the right-hand end: **?** for the explainer and the GitHub mark for the source, as icons, and the language toggle

The chart's camera icon saves a PNG of it; there is no video download.

The toolbar is always one row and never scrolls. Where the controls do not fit the window, its spacing tightens, then
its type goes a size down, and past that the whole bar is drawn smaller, every word kept.

On a phone the toolbar is hidden to give the chart the whole screen. Tap the left or
right quarter of the screen to step back or forward a day, or drag the orange dot along
the price line; the chart itself does not pan or zoom.

## How it works

One HTML file, no build step, no dependencies to install. Charts render with
[Plotly.js](https://plotly.com/javascript/) from a CDN with an SRI hash. Data is
fetched per day from the Bitcoin Research Kit API mirrored at
[bitview.space](https://bitview.space), one URPD request per age cohort
(`/api/urpd/<cohort>/<date>`, the cohorts `age_under_1h` to `age_over_15y`), or per block with **1B**
(`/api/urpd/<cohort>/<height>`, with the block's time from `/api/series/timestamp/height`). The days it has (every UTC
day with a block) and the first block of each come from its day1 series, `/api/series/date/day1` and
`/api/series/first_height/day1`. A day's 23 bands must all be of one block: if the day in progress gains a block while
they load, the ones from the block before are asked for again at the new one. Loaded days and blocks are cached in
memory, so scrubbing backwards is instant.

**FULL HISTORY VIDEOS** in the toolbar opens a menu of four, **VIDEO (% USD-LTH/STH)**, **VIDEO (% USD-AGE)**,
**VIDEO (% BTC-LTH/STH)** and **VIDEO (% BTC-AGE)**, each of which opens the whole history as one video on YouTube,
drawn as the page draws that choice by default: USD with the left axis at
each day’s tallest bar (each frame’s, as the days blend into each other), from 2011-01-31, and BTC with Y-max at 99.8, its first bar running off the top with its height printed, from 2010-05-18,
when the first price comes onto the chart; the bars as short- and long-term holders (LTH/STH) or in their 23 age bands
(AGE); the bottom signal at its default threshold (80% in loss in USD, 50% in BTC); all four to the latest day,
5:00 at 60 fps in 4K (3840×2160).
The **Monthly videos** workflow draws all four again once a month on GitHub’s runners, one runner each, taking in the month
since the last ones, and posts them to YouTube (see [Posting to YouTube](#posting-to-youtube)). Run by hand (**Actions → Monthly
videos → Run workflow**), it draws all four at once, or with **only** (`usd-age`, `btc-age`, `usd-lthsth` or
`btc-lthsth`) just one of them: run with `all`, it publishes and posts all four and starts a new month; with one, that
one is posted and its link in the menu updated, while the release and its month stay as they are until the next monthly run draws
all four together.
The site offers no file to download, so that a break-in could not use it to hand anyone a file. The workflow keeps its
latest renders on the `video` release, whose notes tell the next run which day they reach; nothing links to them. A
render goes out only after it is checked to be exactly the expected video and attested (see [SECURITY.md](SECURITY.md)).
It renders with `tools/video` (Playwright, Plotly and ffmpeg, installed only there; `tools/video/looks.mjs` holds the
four looks), from a store of every day’s bars in their age bands, in dollars and in coins, kept on the `video-store-2` release: past days never change, so each day’s run adds the new day, and once a month the 18,000 frames
of each video are drawn again. Free for a public
repository.

The price axis needs the whole history to be a function of the date alone, which no single
day’s download contains, so `data/scales.json` (about 5 KB) carries it: for every day
since 2009-01-03, the right end of the price axis, as steps. `tools/build-scales.cjs` builds it with the page’s own binning code;
run again, it extends the file by each finished day (23 requests to bitview.space per
day). The Monthly videos workflow does that every day (it runs daily for this, and draws
the videos once a month) and commits the result. Days after the file’s last day still
draw, carrying on from its last values with their own data.

To deploy: push to GitHub and enable Pages on `main` at the repository root. That is
the whole deployment.

## Posting to YouTube

After publishing the videos, the **Monthly videos** workflow posts all four to the [renshuBTC](https://www.youtube.com/@renshuBTC)
channel with `tools/video/youtube.mjs`, through the YouTube Data API, each from a job of its own: one video's trouble
does not hold back the others, and a failed post can be run again (**Re-run failed jobs**, within a week) without
posting the others twice. Each month's videos go up **unlisted** (anyone with the link can watch them; they are shown neither on the
channel nor in search), titled with the chart's own title on their last day, such as *Bitcoin URPD (% USD, AGE) as of 24 Sept 2026* and *Bitcoin URPD (% BTC, LTH/STH) as of 24 Sept 2026*. Once
YouTube lets others watch one, the
workflow names it in `data/youtube.json` and its button on the site links to it; until then that button opens the
channel.

It needs the channel's OAuth credentials as three repository secrets. Without them the step does nothing. To set it up
once:

1. In the [Google Cloud console](https://console.cloud.google.com/projectcreate), create a project and enable the
   **YouTube Data API v3** (APIs & Services → Library).
2. In **Google Auth Platform** (the OAuth consent screen), choose the **External** audience, then **Publish app** so
   its status is **In production**. An app left in *Testing* gets refresh tokens that stop working after 7 days.
3. Under **Clients**, create an OAuth client of type **Web application** with the authorised redirect URI
   `https://developers.google.com/oauthplayground`.
4. In the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground), open the settings (⚙), tick **Use your
   own OAuth credentials** and enter the client's ID and secret. Authorise the scope
   `https://www.googleapis.com/auth/youtube.upload` with the channel's Google account (past the *Google hasn't verified
   this app* notice: **Advanced**, then continue), then **Exchange authorization code for tokens**.
5. In this repository's **Settings → Secrets and variables → Actions**, add `YOUTUBE_CLIENT_ID`,
   `YOUTUBE_CLIENT_SECRET` and `YOUTUBE_REFRESH_TOKEN`. Then run **Actions → YouTube credentials check → Run
   workflow**: it asks Google for an access token with them and says whether that worked, uploading nothing.
6. Until the project passes YouTube's API compliance audit, YouTube keeps every upload **private**, whatever the
   request asks for. Ask for the audit with the
   [YouTube API Services audit form](https://support.google.com/youtube/contact/yt_api_form); once it passes, the
   uploads come out unlisted and the button links to the latest one.

To stop posting, delete the three secrets (and remove the app's access at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions)).

## Security

The site never asks you to install anything, connect a wallet or enter a seed phrase, and it offers no file to
download: the video is on YouTube, and the chart's camera icon only saves a PNG of the chart, made in your browser. [SECURITY.md](SECURITY.md) explains how the page and the build are protected, and how to report a
problem.

## Development checks

The site still deploys directly from the single HTML file with no build step.
Run the regression tests with Node.js 24 or newer:

```sh
node --test tests/*.test.cjs
```

The tests execute the application source with controlled network and rendering
interfaces. They cover navigation races, date and value calculations, binning and the
axes, render completion, the axis-history builder, the video’s store and the security
rules (`tests/security.test.cjs`). GitHub Actions runs the same checks on pushes and
pull requests. After editing an inline script in `index.html`, run
`node tools/update-csp.cjs` so the Content-Security-Policy allows the new version.

The evals ([evals/README.md](evals/README.md)) check the live chart the way a visitor sees it. Every day the Evals
workflow draws a sample of days in headless Chromium, in every view and in other windows and languages, and checks
each one: it draws, it is the day asked for, its supply, realized cap, LTH/STH split and coins in profit match
Bitcoin Research Kit's own series, its words are clear of each other and true, and the video menu and axis history
are current. Run them with `node evals/run.mjs` after `npm ci --ignore-scripts` and `npx playwright install
chromium` in `evals/`.

## Credits

- **URPD** — introduced by [Renato Shirakashi](https://x.com/renato_shira) in April 2020, popularised and extended by [James Check](https://x.com/_checkmatey_)
- **Data** — [Bitcoin Research Kit](https://github.com/bitcoinresearchkit/mono) by [@_nym21_](https://x.com/_nym21_), served via [bitview.space](https://bitview.space), built on [Bitcoin Core](https://bitcoin.org)
- **Charting** — [Plotly.js](https://plotly.com/javascript/) (MIT)

## Licence

MIT. See [LICENSE](LICENSE).
