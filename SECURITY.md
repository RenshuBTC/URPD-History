# Security

Bitcoin URPD is a static page. It has no accounts, takes no payments and needs nothing installed. It will
never ask for a seed phrase, a private key, a wallet connection or a signature, and it offers no file to download: the
one thing you can save is a PNG picture of the chart, which the chart's camera icon makes in your own browser. Anything
that asks for more, or offers you any other file, is not this site.

## The videos

The four full-history videos, one for each weighting (% USD, each bar as its share of the realized cap, and % BTC, as
its share of all the coins) and colouring (by age band, AGE, or as short- and long-term holders, LTH/STH), are on
YouTube, not on the site. VIDEO (% USD-AGE), VIDEO (% USD-LTH/STH),
VIDEO (% BTC-AGE) and VIDEO (% BTC-LTH/STH) in the toolbar open the latest of each, posted
unlisted once a month by the [Monthly videos](.github/workflows/video.yml) workflow to the
[renshuBTC](https://www.youtube.com/@renshuBTC) channel (the channel itself until there is a video of that look
others can watch). They only ever go to the channel or to `https://www.youtube.com/watch?v=` and a video's id, which the
page checks before using. The site has no video download, so that someone who broke into it could not use it to hand
visitors a file posing as a video.

The workflow keeps its latest renders on this repository's
[`video` release](https://github.com/renshuBTC/URPD-History/releases/tag/video)
(`BitcoinURPD.com-USD-AGE.mp4`, `BitcoinURPD.com-BTC-AGE.mp4`, `BitcoinURPD.com-USD-LTH-STH.mp4` and
`BitcoinURPD.com-BTC-LTH-STH.mp4`), where the next run reads which day they reach; nothing
links to them (a video drawn on its own by hand is posted but joins the release only with the next monthly run). The
videos drawn before them (`BitcoinSupplyChart.com-*.mp4`) stay on the same release as they were and are no longer
updated. GitHub keeps a signed record of the run that built each of them (a build provenance attestation, logged by
Sigstore). To check a copy of any of them:

- **SHA-256:** compare it with the one in the release notes: `shasum -a 256 FILE` on macOS, `sha256sum FILE` on
  Linux, `Get-FileHash FILE` in Windows PowerShell.
- **Attestation**, with the [GitHub CLI](https://cli.github.com):

  ```sh
  gh attestation verify BitcoinURPD.com-USD-AGE.mp4 --repo renshuBTC/URPD-History \
    --signer-workflow renshuBTC/URPD-History/.github/workflows/video.yml --source-ref refs/heads/main
  ```

  This passes only for a file built by that workflow in this repository from its `main` branch.

## How the site and the video are protected

- **The page** allows only its own inline scripts (by SHA-256) and Plotly from its CDN (by integrity hash) to run,
  and connects only to this site and bitview.space: a Content-Security-Policy refuses every other script, frame,
  plugin, form and connection. It writes text, never markup, and everything from the data API is checked before use,
  so the API can at worst put wrong numbers on the chart. It links to no file to download, and the tests fail if a
  download link, redirect or outside address appears (`tests/security.test.cjs`).
- **The build** is split by trust. Only this repository's own code runs with a token that can write, and that code
  never parses a video. The renderer, which runs third-party code (Playwright, Chromium, ffmpeg), and the job that
  vets its files get a read-only token and no credentials. Each file is published only if it is exactly the expected
  video (`tools/video/check-video.sh`: an MP4 with a single 3840×2160, 60 fps H.264 stream of 18,000 frames, every
  frame decoded), after its container is rewritten to hold nothing but the picture, and with an attestation. The
  axis history refuses values from the data API far outside anything in the real history rather than commit them.
  Actions are pinned to full commit hashes and npm packages to exact versions and hashes, with install scripts off.
  The channel's YouTube credentials are repository secrets seen only by the steps that use them (two in each of the
  two youtube jobs, the check for them and the post; and the one step of the hand-run YouTube credentials check),
  which run this repository's own code (`tools/video/youtube.mjs`, with Node's own http) and nothing installed. The
  jobs after the vetting take the vetted videos by their exact names, never another file the renderer could have left.
- **A watch:** the [Site check](.github/workflows/site-check.yml) workflow checks four times a day that
  www.bitcoinurpd.com serves this repository's `index.html` byte for byte, and its privacy and terms pages and the
  data it loads from the site (`data/youtube.json`, where the videos menu's links go, and `data/scales.json`), so a page
  changed anywhere on the way (a download slipped in, say, or a video link sent elsewhere) turns it red, and that
  plain http is sent to https. If anything differs it fails, and
  GitHub emails the owner.

## Reporting a problem

Please don't open a public issue for a security problem. Report it privately with **Report a vulnerability** on
this repository's [Security tab](https://github.com/renshuBTC/URPD-History/security), or message
[@RenshuBTC](https://x.com/RenshuBTC) on X.
