// What the page shows around the chart and how it takes input: messages, the toolbar and its panels, narrow
// plots, input methods, phone taps and saved pins. Each test here pins down a bug the second 2026-09-24 audit found.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { html, scripts, app, deferred, flush, dayAnswer } = require('./helpers.cjs');

const plain = v => JSON.parse(JSON.stringify(v));   // out of the page's realm, for deepEqual
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
const rules = css.split('}').map(r => r.split('{')).filter(r => r.length === 2)
  .map(([sel, body]) => ({ sels: sel.split(',').map(s => s.trim().replace(/\s+/g, ' ')), body: body.trim() }));
function decls(selector) {
  const found = rules.filter(r => r.sels.includes(selector));
  assert.ok(found.length, 'no rule for ' + selector);
  return found.map(r => r.body).join('; ');
}
// The panel script (explainer, orange dot, phone taps) run in the same page as the main one.
const panelScript = scripts.find(s => s.includes('var EXPLAINER'));
function withPanels(h) { vm.runInContext(panelScript, h.c, { filename: 'index.html/panels' }); return h; }
const iso = t => new Date(t).toISOString().slice(0, 10);
function days(from, to) {
  const out = [];
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 864e5) out.push(iso(t));
  return out;
}
// Five days of a small market; every day's cost basis is the same two stamps.
function market(c) {
  const dates = days('2026-09-01', '2026-09-05');
  c.allDates = dates; c.priceDates = dates.slice();
  c.priceIndexByDate = Object.fromEntries(dates.map((d, i) => [d, i]));
  c.priceArray = dates.map((_, i) => 60000 + 100 * i);
  c.currentIdx = dates.length - 1;
  return { dates, raw: { all: { 50000: 2, 70000: 1 }, age: [{ 50000: 2 }, { 70000: 1 }] } };
}
// Monospace estimate the page itself uses: 0.6 em a character, a full em for CJK.
const textPx = (s, size) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e7f ? size : 0.6 * size), 0);

test('messages float over the chart near the bottom of the window and take no room from it', () => {
  const d = decls('#status');
  for (const want of [/position:\s*fixed/, /bottom:/, /left:\s*50%/, /pointer-events:\s*none/, /background:\s*#111/, /(^|[;\s])color:\s*#d4d4d4/, /z-index:\s*\d+/]) assert.match(d, want);
  assert.doesNotMatch(d, /(^|;)\s*top:/, 'never over the title');
  assert.match(decls('html.phone #status'), /font-size/);
});

test('the retry hint names the >> button, and a phone, which has neither, is told to tap the right edge', async () => {
  const { c } = app();
  for (const l of ['en', 'zh', 'ja']) {
    assert.match(c.T[l].retryHint, />>/, l); assert.doesNotMatch(c.T[l].retryHint, /»/, l);
    assert.ok(c.T[l].retryHintPhone.length, l);
  }
  for (const phone of [false, true]) {
    const { c, element } = app(phone ? { __PHONE: { w: 2000, h: 900 } } : {});
    market(c);
    c.fetchRaw = () => Promise.reject(new Error('HTTP 503'));
    await c.loadAndRender();
    assert.equal(element('status').textContent, 'Error: HTTP 503. ' + c.T.en[phone ? 'retryHintPhone' : 'retryHint']);
    assert.equal(element('status').style.display, 'block');
  }
});

test('a failed first load keeps its message until a chart draws, and the message follows the language', async () => {
  const { c, element } = app();
  const { raw } = market(c), status = element('status');
  c.fetchRaw = () => Promise.reject(c.pageError(() => c.t('errTimeout') + 15 + c.t('errTimeoutUnit')));
  await c.loadAndRender();
  assert.equal(status.textContent, 'Error: Request timed out after 15 seconds. Press >> or End to try again.');
  // Switching language retries the load; while that runs, the message is already in the new language.
  let retry = null;
  c.fetchRaw = () => (retry = deferred()).promise;
  c.lang = 'zh'; c.applyLang();
  assert.equal(status.textContent, '错误：请求超时（15 秒）。' + c.T.zh.retryHint);
  assert.equal(status.style.display, 'block');
  await flush();
  retry.resolve(raw); await flush(); await c.chartRenderPromise; await flush();
  assert.ok(c.lastRenderedData, 'the retry drew');
  assert.equal(status.style.display, 'none', 'and the message went with it');
  // A message that cannot be re-worded is dropped on a language change rather than left in the old language.
  c.showNotice('Exact date not found, showing nearest: 2026-09-03');
  c.lang = 'ja'; c.applyLang();
  assert.equal(status.style.display, 'none');
});

test('a start-up that could not reach the API says so in whatever language the page is switched to', async () => {
  const { c, element } = app();
  c.fetchJSON = url => (url.endsWith('/first_height/day1') ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(null));
  await c.init();
  assert.equal(element('status').textContent, c.T.en.errBRK);
  c.lang = 'ja'; c.applyLang();
  assert.equal(element('status').textContent, c.T.ja.errBRK);
  assert.equal(element('status').style.display, 'block', 'still up: nothing can draw without dates');
  // The date box, which says why as well, follows too (it kept the English words).
  assert.equal(element('dateDisplay').textContent, c.T.ja.errPrefix + 'Failed to fetch');
});

test('while the dates load, the date box says so in the language chosen meanwhile', async () => {
  const { c, element } = app();
  const dates = deferred();
  c.fetchJSON = url => (url.endsWith('/first_height/day1') ? dates.promise : Promise.resolve(null));
  const ready = c.init(); await flush();
  assert.equal(element('dateDisplay').textContent, c.T.en.loadingDates);
  c.lang = 'zh'; c.applyLang();
  assert.equal(element('dateDisplay').textContent, c.T.zh.loadingDates);
  dates.reject(new TypeError('Failed to fetch')); await ready;
  assert.equal(element('dateDisplay').textContent, c.T.zh.errPrefix + 'Failed to fetch');
});

test('an open How to read panel follows the toolbar when it re-fits, under the bar and its button as they are now', () => {
  const { c, element } = app();
  const panel = element('explainPanel'), bar = element('controls'), btn = element('explainBtn');
  panel.style.display = 'block'; panel.offsetWidth = 300; c.innerWidth = 1600; c.innerHeight = 900;
  bar.getBoundingClientRect = () => ({ bottom: 31 }); btn.getBoundingClientRect = () => ({ right: 1500 });
  c.fitToolbarWords();
  assert.deepEqual([panel.style.top, panel.style.left], ['37px', '1200px']);
  // A re-fit that moves the bar's end and the button: the panel goes with them, not where they were.
  bar.getBoundingClientRect = () => ({ bottom: 59 }); btn.getBoundingClientRect = () => ({ right: 1452 });
  c.fitToolbarWords();
  assert.deepEqual([panel.style.top, panel.style.left], ['65px', '1152px']);
  // A closed panel is left alone.
  panel.style.display = 'none'; bar.getBoundingClientRect = () => ({ bottom: 31 });
  c.fitToolbarWords();
  assert.equal(panel.style.top, '65px');
});

test('the toolbar is one row that never scrolls; the videos menu in words, then How to read and GitHub as icons and the language button, together at the right', () => {
  assert.match(decls('#controls'), /flex-wrap:\s*nowrap/);
  assert.match(decls('#controls'), /overflow:\s*hidden/);
  assert.doesNotMatch(decls('#controls'), /overflow-x|scrollbar|flex-wrap:\s*wrap/);
  assert.match(decls('#toolbarEnd'), /margin-left:\s*auto/);
  assert.doesNotMatch(decls('#githubLink'), /margin-left/);
  const end = html.slice(html.indexOf('<div id="toolbarEnd">'), html.indexOf('<div id="status"'));
  assert.deepEqual([...end.matchAll(/\sid="(explainWrap|githubLink|langBtn)"/g)].map(m => m[1]), ['explainWrap', 'githubLink', 'langBtn'], 'How to read, GitHub and the language together at the right-hand end');
  assert.match(decls('#controls.dense #toolbarEnd'), /gap:\s*4px/, 'spaced as the rest of the bar');
  const bar = html.slice(html.indexOf('<div id="controls">'), html.indexOf('<div id="toolbarEnd">'));
  assert.deepEqual([...bar.matchAll(/\sid="(btnUSD|btnBTC|btnAge|btnSplit|btnRaw|btnFit|btnAth|btnPeak|binsWrap|smoothWrap|ymaxWrap|signalWrap|ytMenuBtn|ytUsdAgeBtn|ytBtcAgeBtn|ytUsdSplitBtn|ytBtcSplitBtn|ytUsdBtn|ytBtcBtn|ytBtn|ytFitBtn|explainWrap|githubLink)"/g)].map(m => m[1]),
    ['btnUSD', 'btnBTC', 'btnSplit', 'btnAge', 'btnPeak', 'signalWrap', 'binsWrap', 'smoothWrap', 'ymaxWrap', 'ytMenuBtn', 'ytUsdSplitBtn', 'ytUsdAgeBtn', 'ytBtcSplitBtn', 'ytBtcAgeBtn'],
    'USD | BTC, LTH/STH | AGE, then PIN Y-AXIS, BOTTOM SIGNAL, BINS left of SMOOTHING and Y-MAX, then FULL HISTORY VIDEOS and its four videos');
  assert.match(bar, /<button id="btnAge"[^>]*>[^<]*<\/button>\s*<\/div>\s*<div class="ctrl-sep"><\/div>\s*<div class="mode-toggle">\s*<button id="btnPeak"[^>]*>Pin Y-axis<\/button>\s*<\/div>\s*<div class="ctrl-sep"><\/div>\s*<label class="field" id="signalWrap"/,
    'PIN Y-AXIS right after LTH/STH | AGE, a separator either side');
  // The videos in the menu show their icon and words: VIDEO and which video, in brackets.
  for (const [key, tag] of [['UsdAge', '% USD-AGE'], ['BtcAge', '% BTC-AGE'], ['UsdSplit', '% USD-LTH/STH'], ['BtcSplit', '% BTC-LTH/STH']])
    assert.match(bar, new RegExp(`id="yt${key}Btn"[^>]*>\\s*<svg[\\s\\S]*?</svg><span id="yt${key}Word" class="yt-word">Video</span><span id="yt${key}Tag" class="yt-tag">${tag}</span></a>`), 'the videos say what they give you: ' + tag);
  // How to read and GitHub: their icons only, named by their tooltips and for screen readers.
  assert.match(end, /<a id="githubLink"[^>]*aria-label="View code on GitHub \(opens in a new tab\)" title="View code on GitHub \(opens in a new tab\)">\s*<svg[\s\S]*?<\/svg>\s*<\/a>/);
  assert.match(end, /<button id="explainBtn" aria-label="How to read this chart" title="How to read this chart" aria-expanded="false"><svg[^>]*aria-hidden="true"[\s\S]*?<\/svg><\/button>/);
  assert.doesNotMatch(html, /btn-word|explainLabel/);
  // Nothing gives way to fit: no word is shortened or dropped.
  assert.doesNotMatch(html, /yt-tag-short|yt-tag-full|yt-video|controls\.short/);
  // Transitions would be measured half-way, so the buttons animate their colours only.
  for (const sel of ['#controls button', '#intervalBar .iv']) assert.match(decls(sel), /transition:\s*background-color 0\.15s, color 0\.15s, border-color 0\.15s;/, sel);
  // To fit: the spacing tightens (dense), the type goes a size down (tight), and last the whole bar is drawn smaller;
  // the How to read panel and the videos menu undo that.
  assert.match(decls('#controls.dense'), /column-gap:\s*4px/);
  assert.match(decls('#controls.dense .ctrl-sep'), /margin:\s*0/);
  assert.match(decls('#controls.tight button'), /font-size:\s*11px;\s*letter-spacing:\s*0/);
  assert.ok(!rules.some(r => r.body.includes('display') && r.sels.some(x => /\.yt-word($|::)/.test(x))), 'VIDEO never goes');
  assert.ok(!rules.some(r => r.body.includes('display') && r.sels.some(x => /\.yt-tag($|::)/.test(x))), 'which video it is never goes');
  assert.match(decls('#explainPanel'), /zoom:\s*calc\(1 \/ var\(--bar-zoom, 1\)\)/);
  assert.match(decls('#ytMenu'), /zoom:\s*calc\(1 \/ var\(--bar-zoom, 1\)\)/);
  // The bar keeps its buttons on one line (nowrap), and the panel inside it wraps its text again: it scrolls down only.
  assert.match(decls('#controls'), /white-space:\s*nowrap/);
  assert.match(decls('#explainPanel'), /white-space:\s*normal/);
  assert.match(decls('#explainPanel'), /overflow-x:\s*hidden/);
  assert.match(decls('#explainPanel'), /overflow-wrap:\s*anywhere/);
  assert.match(decls('#explainPanel .formula'), /white-space:\s*pre-wrap/);
  assert.match(html, /var TOOLBAR_FITS = \["dense", "tight"\];/);
  for (const sel of ['#explainBtn', '.yt-btn', '#githubLink']) assert.doesNotMatch(decls(sel), /font-weight/, sel);
  const { c, element } = app();
  for (const lang of ['zh', 'ja', 'en']) {
    c.lang = lang; c.applyLang();
    assert.equal(element('explainBtn').title, c.t('ariaExplain'), lang);
    assert.equal(element('explainBtn').getAttribute('aria-label'), c.t('ariaExplain'), lang);
  }
});

test('the bar fits its one row: each step only if the row does not fit without it, and then drawn just small enough', () => {
  const { c, element } = app();
  const bar = element('controls'), classes = new Set();
  bar.classList = { add: (k) => classes.add(k), remove: (k) => classes.delete(k), contains: (k) => classes.has(k), toggle() {} };
  // The row's width at each step, as measured in English on the latest day, BINS 625 $201 (tools: a browser 1000 px
  // wide, where the row runs past the window at every step), and a window of W px: the bar's own width, in its own
  // (zoomed) pixels, is W / zoom. extra: what BINS adds on the first days, $0.0016 against $201.
  let W = 0, extra = 0;
  const need = () => extra + (classes.has('tight') ? 1571 : classes.has('dense') ? 1704 : 2000);
  Object.defineProperty(bar, 'scrollWidth', { get: () => need() });
  Object.defineProperty(bar, 'clientWidth', { get: () => W / (parseFloat(bar.style.zoom) || 1) });
  const fit = (w) => { W = w; c.fitToolbarWords(); return [[...classes].join(' '), bar.style.zoom || '', bar.style['--bar-zoom'] || '']; };
  assert.deepEqual(fit(2560), ['', '', ''], 'room for everything');
  assert.deepEqual(fit(1920), ['dense', '', ''], '1920 px: every word at full size, only the spacing tightened');
  extra = 21;
  assert.deepEqual(fit(1920), ['dense', '', ''], 'on the first days too');
  extra = 0;
  assert.deepEqual(fit(1650), ['dense tight', '', '']);
  assert.deepEqual(fit(1366), ['dense tight', '0.869', '0.869'], 'narrower still: the whole bar drawn just small enough, every word kept');
  const [cls, zoom, varZoom] = fit(1000);
  assert.equal(cls, 'dense tight');
  assert.ok(+zoom > 0.6 && +zoom <= 1000 / 1571, zoom);
  assert.equal(varZoom, zoom, 'the panel and the menu are told how far to undo it');
  assert.ok(need() <= W / +zoom + 1, 'and then it fits');
  assert.deepEqual(fit(2560), ['', '', ''], 'a wider window takes every step back');
});

test('the chart follows its own box, which the toolbar can change without the window resizing', async () => {
  const observers = [];
  class FakeResizeObserver { constructor(cb) { this.cb = cb; observers.push(this); } observe(el) { this.target = el; } }
  const { c, element, timers } = app({ ResizeObserver: FakeResizeObserver });
  assert.equal(observers.length, 1);
  assert.equal(observers[0].target, element('chart'));
  const resized = [], fire = (w, h) => observers[0].cb([{ contentRect: { width: w, height: h } }]);
  c.Plotly.Plots = { resize: gd => { resized.push(gd); return Promise.resolve(gd); } };
  const redraws = () => [...timers.values()].filter(t => t.ms === 150).length;
  fire(1200, 800);
  assert.equal(resized.length, 0, 'nothing drawn yet: the first draw measures the box itself');
  const { raw } = market(c);
  c.fetchRaw = () => Promise.resolve(raw);
  await c.loadAndRender();
  const gd = element('chart');
  gd._fullLayout.height = 800;   // the size Plotly drew at
  fire(1200, 800); fire(1200.6, 799.4);
  assert.equal(resized.length, 0, 'a size Plotly already has is left alone');
  assert.equal(redraws(), 0);
  fire(1200, 772);   // the toolbar took a second row
  assert.equal(resized.length, 1);
  assert.equal(resized[0], gd);
  assert.equal(redraws(), 1, 'and the bars are redrawn for the new width, on the window resize timer');
  fire(1200, 744);
  assert.equal(redraws(), 1, 'one pending redraw, however many changes');
  const phone = [];
  app({ __PHONE: { w: 2000, h: 900 }, ResizeObserver: class { constructor() { phone.push(this); } observe() {} } });
  assert.equal(phone.length, 0, 'a phone draws a fixed 2000 px figure and needs no observer');
});

// The chart drawn over a plot `plotW` px wide.
async function drawAt(plotW, lang = 'en', split = false) {
  const { c, element } = app();
  c.lang = lang; c.splitMode = split;
  const { dates, raw } = market(c), react = c.Plotly.react;
  element('chart').clientWidth = plotW + 160;
  c.Plotly.react = (id, traces, layout) => react(id, traces, layout).then(() => {
    element('chart')._fullLayout = { width: plotW + 160, xaxis: { _length: plotW }, legend: { _height: 29 } };
  });
  await c.renderChart(c.buildData(dates.at(-1), raw));
  return element('chart').layout;
}

test('a narrow plot labels every other price step, shrinks the title to fit and wraps the credit line', async () => {
  for (const lang of ['en', 'zh', 'ja']) {
    const L = await drawAt(600, lang), x = L.xaxis;
    assert.equal(x.tickvals.length, 21, 'all twenty-one gridlines stay');
    assert.deepEqual(x.ticktext.map(s => s !== ''), x.ticktext.map((s, k) => k % 2 === 0), `${lang}: every other label`);
    const size = L.title.font.size, title = L.title.text.replace(/<[^>]+>/g, '');
    assert.ok(size >= 10 && size <= 20, `${lang}: ${size}`);
    assert.ok(textPx(title, size) <= 600, `${lang}: the title fits over the plot at ${size} px`);
    const credit = L.annotations.find(a => /Bitview/.test(a.text));
    for (const line of credit.text.split('<br>')) assert.ok(textPx(line.replace(/<[^>]*>/g, ''), credit.font.size) * 1.07 <= 620, `${lang}: ${line}`);
    if (lang === 'en') { assert.equal(credit.text.split('<br>').length, 2); assert.equal(L.margin.b, 78); assert.equal(credit.align, 'left'); }
  }
  const wide = await drawAt(1040);
  assert.ok(wide.xaxis.ticktext.every(s => s !== ''), 'a plot with room keeps all twenty-one labels');
  assert.equal(wide.title.font.size, 20, 'a plot with room shows the title at its full 20 px');
  const credit = wide.annotations.find(a => /Bitview/.test(a.text));
  assert.doesNotMatch(credit.text, /<br>/); assert.equal(credit.font.size, 11); assert.equal(wide.margin.b, 64);
  assert.equal(wide.margin.t, 13 + 26 + 29, 'the title\'s line at its size, then the legend');
  const tablet = await drawAt(420);
  assert.ok(tablet.title.font.size >= 10, 'never below 10 px');
  assert.ok(tablet.title.font.size < 20, 'and a plot too narrow for it at 20 px shrinks it to fit');
});

test('the title names both choices, the weighting and the colouring, in every language, as large as fits over the plot', async () => {
  const { c } = app();
  for (const lang of ['en', 'zh', 'ja']) for (const plotW of [1040, 900, 800, 600]) for (const split of [false, true]) {
    const L = await drawAt(plotW, lang, split), words = L.title.text.replace(/<[^>]+>/g, '');
    assert.ok(words.startsWith(c.T[lang][split ? 'titleUSDSplit' : 'titleUSDAge']), `${lang}: ${words}`);
    const want = Math.max(10, Math.min(20, Math.floor(20 * (plotW - 8) / (textPx(words, 20) * 1.03))));
    assert.equal(L.title.font.size, want, `${lang} at ${plotW} px`);
    assert.ok(textPx(words, want) * 1.03 <= plotW - 8, `${lang}: it fits at ${want} px over ${plotW} px`);
  }
  assert.equal(c.T.en.titleUSDAge, 'Bitcoin URPD (% USD, AGE) as of ');
  assert.equal(c.T.en.titleBTCAge, 'Bitcoin URPD (% BTC, AGE) as of ');
  assert.equal(c.T.en.titleUSDSplit, 'Bitcoin URPD (% USD, LTH/STH) as of ');
  assert.equal(c.T.en.titleBTCSplit, 'Bitcoin URPD (% BTC, LTH/STH) as of ');
  assert.equal(c.T.zh.titleBTCSplit, '比特币 URPD（% BTC，长/短期）截至 ');
  assert.equal(c.T.ja.titleUSDAge, 'ビットコイン URPD（% USD、年齢） 基準日 ');
  // The mode buttons say it too, and the left axis names what 100% is.
  assert.match(html, /<button id="btnUSD" class="active" aria-pressed="true" title="[^"]+">% USD<\/button>/);
  assert.match(html, /<button id="btnBTC" aria-pressed="false" title="[^"]+">% BTC<\/button>/);
  assert.deepEqual([c.T.en.usdInvested, c.T.en.btcSupply], ['Percent of USD Value Last Moved [%]', 'Percent of BTC Supply Last Moved [%]']);
  assert.doesNotMatch(JSON.stringify(c.T), /Y-Max (Always|Expands)|titleUSDFit|titleUSDAth|随历史新高扩展|過去最高で拡大|150D/, 'the titles name no Y-MAX mode, and LTH/STH by name');
});

test('the explainer\'s section headings are capitals, underlined, not bold', () => {
  assert.match(decls('#explainPanel h3'), /text-transform:\s*uppercase/);
  assert.match(decls('#explainPanel h3'), /font-weight:\s*400/);
  assert.match(decls('#explainPanel h3'), /text-decoration:\s*underline/);
  assert.match(decls('#explainPanel h3'), /text-underline-offset:\s*3px/);
});

test('Bins, Smoothing, Y-max and Bottom signal are framed like the cycle list: label, white value, unit; the frame doubles while editing', () => {
  const bins = /<label class="field" id="binsWrap"[^>]*>\s*<span class="field-label">Bins<\/span><input type="text" id="binsInput" value="625" inputmode="numeric"[^>]*><span class="field-unit" id="binsUnit"><\/span>\s*<\/label>/.exec(html);
  assert.ok(bins, 'binsWrap: a label, the number, and a unit drawChart fills in (a bar\'s width in dollars)');
  assert.doesNotMatch(bins[0], /style=/, 'no inline styles');
  for (const [wrap, input, unit] of [['smoothWrap', 'smoothInput', '%'], ['ymaxWrap', 'ymaxInput', 'PCTL'], ['signalWrap', 'signalInput', '% IN LOSS']]) {
    const m = new RegExp(`<label class="field" id="${wrap}"[^>]*>\\s*<span class="field-label">[^<]+</span><input type="text" id="${input}"[^>]*><span class="field-unit">([^<]+)</span>\\s*</label>`).exec(html);
    assert.ok(m, wrap); assert.equal(m[1], unit);
    assert.doesNotMatch(m[0], /style=/, 'no inline styles');
  }
  const frame = decls('#controls .field');
  for (const want of [/border:\s*1px solid #595959/, /background:\s*#1a1a1a/, /height:\s*24px/, /border-radius:\s*0/]) assert.match(frame, want);
  assert.match(decls('#controls .field:focus-within'), /border-color:\s*#fff;\s*box-shadow:\s*inset 0 0 0 1px #fff/);
  assert.match(decls('#controls .field .field-label'), /text-transform:\s*uppercase/);
  assert.match(decls('#controls .field input'), /color:\s*#fff/);
  assert.match(decls('#controls .field input'), /border:\s*0/);
});

test('BINS ends in a bar\'s width in dollars on the day shown, as Y-MAX ends in PCTL', async () => {
  const { c, element } = app();
  assert.deepEqual([201.04, 1234.4, 99.5, 46.2, 9.96, 1.62, 0.5, 0.000624, 4.8e-7, 0, -1, NaN, Infinity].map(w => c.binWidthText(w)),
    ['$201', '$1,234', '$100', '$46', '$10', '$1.6', '$0.5', '$0.00062', '$0.00000048', '', '', '', '']);
  const { dates } = market(c);
  const data = c.buildData(dates[4], { all: { 10: 1, 90000: 3 }, age: [{ 10: 1, 90000: 3 }] });
  let fits = 0;
  c.fitToolbarWords = () => { fits++; };
  await c.renderChart(data);
  assert.ok(data.binWidth > 0);
  assert.equal(element('binsUnit').textContent, c.binWidthText(data.binWidth), 'written after the draw');
  assert.equal(fits, 1, 'a figure of a new length: the bar is fitted again');
  await c.renderChart(data);
  assert.equal(fits, 1, 'the same figure: nothing to fit');
  // A language change leaves it: its unit is a figure, not a word.
  assert.match(html, /\["binsWrap", "binsLabel", null, "binsTitle"\]/);
  assert.match(html, /if \(unit && f\[2\]\) unit\.textContent = t\(f\[2\]\);/);
  for (const lang of ['en', 'zh', 'ja']) assert.match(c.T[lang].binsTitle, /in dollars|美元|ドル/, lang);
});

test('the price box says In Profit and In Loss, in every language and for both weightings', async () => {
  const { c, element } = app();
  const { dates } = market(c);
  const data = c.buildData(dates[4], { all: { 10: 1, 90000: 3 }, age: [{ 10: 1, 90000: 3 }] });
  const want = {
    en: [['USD Value Last Moved In Profit: ', 'USD Value Last Moved In Loss: '], ['BTC Supply Last Moved In Profit: ', 'BTC Supply Last Moved In Loss: ']],
    zh: [['最后移动的美元价值处于盈利: ', '最后移动的美元价值处于亏损: '], ['最后移动的 BTC 供应处于盈利: ', '最后移动的 BTC 供应处于亏损: ']],
    ja: [['含み益の最終移動 USD 評価額: ', '含み損の最終移動 USD 評価額: '], ['含み益の最終移動 BTC 供給量: ', '含み損の最終移動 BTC 供給量: ']],
  };
  for (const lang of ['en', 'zh', 'ja']) for (const coin of [false, true]) {
    c.lang = lang; c.coinMode = coin; await c.renderChart(data);
    const [profit, loss] = want[lang][+coin];
    const box = element('chart').layout.annotations.find(a => a.text.includes(profit));
    assert.ok(box, `${lang} ${coin ? 'BTC' : 'USD'}: ${profit}`);
    assert.ok(box.text.includes(loss), `${lang} ${coin ? 'BTC' : 'USD'}: ${loss}`);
  }
  assert.doesNotMatch(html, /Below This Price|Above This Price|Below %/);
  assert.match(html, /Profit % = /);
});

test('the bottom signal: at the mode\'s share in loss (80 in USD, 50 in BTC, each kept as typed) the dashed line and the box turn yellow and the box says so', async () => {
  const { c, element } = app();
  assert.deepEqual(plain(c.bottomByMode), [80, 50], 'USD 80, BTC 50 by default');
  assert.match(html, /<input type="text" id="signalInput" value="80" inputmode="decimal"/, 'the field starts at USD\'s 80');
  const { dates } = market(c);
  // A day with its price among the stamps: one coin at $10 in profit, three at $90,000 in loss.
  const data = c.buildData(dates[4], { all: { 10: 1, 90000: 3 }, age: [{ 10: 1, 90000: 3 }] });
  const draw = async () => { await c.renderChart(data); const L = element('chart').layout;
    return { line: L.shapes.find(s => s.type === 'line' && s.xref === 'x').line.color, box: L.annotations.find(a => /In Profit/.test(a.text)) }; };
  const lossUsd = +(100 - data.profitPct).toFixed(1), lossBtc = +(100 - data.profitPctCoin).toFixed(1);
  assert.ok(lossUsd > 99 && lossBtc === 75, `${lossUsd} ${lossBtc}`);
  // USD: 99.9% of the value in loss, at or above 80: yellow line, yellow border and a fourth line.
  let d = await draw();
  assert.equal(d.line, '#FFE600');
  assert.equal(d.box.bordercolor, '#FFE600');
  const rows = d.box.text.split('<br>');
  assert.equal(rows.length, 4, 'price, the two shares and the signal');
  assert.equal(rows[3], "<span style='color:#FFE600'>BOTTOM SIGNAL \u2014 In Loss \u2265 80%</span>");
  // BTC: 75% of the coins in loss, above 50; then raised past it, nothing.
  c.coinMode = true; c.viewIdx = 1;
  d = await draw();
  assert.equal(d.box.text.split('<br>')[3], "<span style='color:#FFE600'>BOTTOM SIGNAL \u2014 In Loss \u2265 50%</span>");
  c.bottomByMode[1] = 75; d = await draw();
  assert.equal(d.line, '#FFE600', 'at the threshold exactly, as the box prints it');
  c.bottomByMode[1] = 75.1; d = await draw();
  assert.equal(d.line, '#ffffff', 'below it: the white line');
  assert.equal(d.box.bordercolor, 'rgba(255,255,255,0.45)');
  assert.equal(d.box.text.split('<br>').length, 3, 'price and the two shares, nothing more');
  // In every language, the fourth line names the threshold.
  c.bottomByMode[1] = 50;
  for (const [lang, want] of [['zh', '底部信号 \u2014 亏损 \u2265 50%'], ['ja', 'ボトムシグナル \u2014 含み損 \u2265 50%']]) {
    c.lang = lang; await c.renderChart(data);
    const box = element('chart').layout.annotations.find(a => a.bordercolor === '#FFE600');
    assert.ok(box && box.text.includes(want), lang);
  }
  c.lang = 'en';
  // No price or no share for the day: no signal.
  const unpriced = c.buildData('2009-01-12', { all: { 10: 1 }, age: [{ 10: 1 }] });
  await c.renderChart(unpriced);
  assert.ok(!JSON.stringify(element('chart').layout).includes('#FFE600'));
});

test('the bottom signal field: 0 to 100 for the mode on screen, drawn again at once; each mode keeps its own', () => {
  const { c, element } = app();
  let redraws = 0;
  c.rerenderCurrent = () => { redraws++; };
  c.loadAndRender = () => Promise.resolve();
  const input = element('signalInput');
  input.emit('input', { target: Object.assign(input, { value: '70' }) });
  assert.deepEqual([plain(c.bottomByMode), redraws], [[70, 50], 1]);
  input.emit('change', { target: Object.assign(input, { value: '150' }) });
  assert.deepEqual([input.value, plain(c.bottomByMode)], ['100', [100, 50]], 'held to 0-100 when committed');
  input.emit('change', { target: Object.assign(input, { value: 'abc' }) });
  assert.deepEqual([input.value, plain(c.bottomByMode)], ['100', [100, 50]], 'not a number: the field shows the threshold in force');
  // BTC shows its own, and USD's comes back with USD.
  c.setViewMode(1);
  assert.equal(input.value, '50');
  input.emit('change', { target: Object.assign(input, { value: '40' }) });
  assert.deepEqual(plain(c.bottomByMode), [100, 40]);
  c.setViewMode(0);
  assert.equal(input.value, '100');
  // A change that could not be drawn is rolled back with the rest.
  const saved = c.captureChartSettings();
  c.bottomByMode[0] = 5;
  c.restoreChartSettings(saved); c.syncControls();
  assert.deepEqual([plain(c.bottomByMode), input.value], [[100, 40], '100']);
  // Its words in every language.
  for (const [lang, label, unit] of [['en', 'Bottom signal', '% IN LOSS'], ['zh', '底部信号', '% 亏损'], ['ja', 'ボトムシグナル', '% 含み損']]) {
    assert.deepEqual([c.T[lang].signalLabel, c.T[lang].signalUnit], [label, unit], lang);
    assert.match(c.T[lang].signalTitle, /80/, lang); assert.match(c.T[lang].signalTitle, /50/, lang);
  }
});

test('625 bars by default, and the price axis title names the axis only', async () => {
  // (A bar's width is back beside BINS, #binsUnit, not in the price axis title.)
  for (const gone of ['thresholdInput', 'thresholdWrap', 'GLOW_COLOR', 'bottomThreshold']) assert.ok(!html.includes(gone), gone);
  const { c, element } = app();
  assert.equal(c.NUM_BINS, 625);
  const { dates } = market(c);
  const data = c.buildData(dates[4], { all: { 90000: 3 }, age: [{ 90000: 3 }] });
  await c.renderChart(data);
  const layout = element('chart').layout;
  assert.equal(layout.xaxis.title.text, 'Price When Last Moved [USD]');
  for (const [lang, want] of [['zh', c.T.zh.priceUSD], ['ja', c.T.ja.priceUSD]]) {
    c.lang = lang; await c.renderChart(data);
    assert.equal(element('chart').layout.xaxis.title.text, want, lang);
  }
  assert.doesNotMatch(html, /per bar|perBar|每根柱 \{w\}|1 本あたり \{w\}/);
  // What the explainer says of the bars and of the white line's window is what is drawn: 625 bars up to the axis
  // end and one past it, so the drawn axis is 626 bars long; a year up to 90 days ahead, but at most a week past the
  // latest day.
  assert.ok(Math.abs(layout.xaxis.range[1] / data.binWidth - 626) < 1e-9, String(layout.xaxis.range[1] / data.binWidth));
  assert.equal((html.match(/ΔP = highest cost basis so far \/ bins"/g) || []).length, 3, 'en, zh, ja');
  assert.doesNotMatch(html, /sliver for the smoothing|平滑所需的一小段|スムージングの分をわずかに足した/, 'nothing is added to the axis for the smoothing');
  assert.doesNotMatch(html, /625 (equal-width bars|根等宽|本の等幅)/);
  assert.match(html, /OV_WINDOW=365\*OV_DAY, OV_FUTURE=90\*OV_DAY, OV_PAD=7\*OV_DAY/);
  for (const words of ['from 275 days before the selected day to 90 days after it (near the latest day it ends a week past that day',
    '之前 275 天到之后 90 天（接近最新一天时，窗口止于最新一天之后一周', '275 日前から 90 日後までの 1 年間を表します（最新日に近いときは、最新日の 1 週間後で終わり'])
    assert.ok(html.includes(words), words);
});

test('input methods: their 。 is the decimal point, and the Enter or Escape that ends a composition is theirs', () => {
  const { c, element } = app();
  assert.equal(c.fieldNumber('０。２４'), 0.24);
  assert.equal(c.fieldNumber('0。5'), 0.5);
  assert.ok(Number.isNaN(c.fieldNumber('1、000')), 'a comma is still not a number');
  let prevented = 0;
  const key = (extra = {}) => Object.assign({ key: 'Enter', preventDefault() { prevented++; } }, extra);
  for (const id of ['smoothInput', 'ymaxInput']) {
    const field = element(id);
    let blurred = 0;
    field.blur = () => blurred++;
    field.emit('keydown', key({ isComposing: true }));
    field.emit('keydown', key({ key: 'Escape', keyCode: 229 }));
    assert.equal(blurred, 0, id);
    field.emit('keydown', key());
    assert.equal(blurred, 1, id);
  }
});

test('on a phone a tap on the orange dot, the legend, the mode bar or a credit link is not an edge tap', () => {
  const h = withPanels(app({ __PHONE: { w: 2000, h: 900 }, innerWidth: 400 })), { c, docListeners } = h;
  const steps = [];
  c.goTo = i => steps.push(i);
  c.currentIdx = 5;
  const tap = (x, target) => { docListeners.touchstart[0]({ touches: [{ clientX: x, clientY: 100 }], target }); docListeners.touchend[0](); };
  const inside = selector => ({ closest: s => (s.split(',').map(p => p.trim()).includes(selector) ? {} : null) });
  tap(390, inside('#tracer')); tap(10, inside('.legend')); tap(390, inside('.modebar')); tap(10, inside('a'));
  assert.deepEqual(steps, []);
  tap(390, { closest: () => null }); tap(10, undefined);
  assert.deepEqual(steps, [6, 4], 'anywhere else the edges still step');
});

test('the explainer takes the keyboard when it opens, and hands it back to ? on Escape if it was opened from the keyboard', () => {
  assert.match(html, /<div id="explainPanel" tabindex="-1">/);
  const h = withPanels(app()), { c, element, docListeners } = h;
  const btn = element('explainBtn'), panel = element('explainPanel'), keydown = docListeners.keydown[0];
  btn.onclick.call(btn, { stopPropagation() {} });
  assert.equal(panel.style.display, 'block');
  assert.equal(c.document.activeElement, panel);
  assert.equal(panel.focusOptions.preventScroll, true, 'without scrolling the page');
  let prevented = false;
  keydown({ key: 'ArrowDown', target: panel, preventDefault() { prevented = true; } });
  assert.equal(prevented, false, 'the arrows are left to scroll the panel');
  keydown({ key: 'Escape', target: panel, preventDefault() {} });
  assert.equal(panel.style.display, 'none');
  assert.equal(btn.attributes['aria-expanded'], 'false');
  assert.equal(c.document.activeElement, btn);
  assert.equal(btn.focusOptions.preventScroll, true);
  // Opened with the mouse, Escape just drops focus: handing it to ? would draw the keyboard focus ring around it.
  let blurred = 0;
  panel.blur = () => blurred++;
  c.document.activeElement = null;
  btn.onclick.call(btn, { stopPropagation() {}, detail: 1 });
  assert.equal(c.document.activeElement, panel, 'still takes the keys while open');
  keydown({ key: 'Escape', target: panel, preventDefault() {} });
  assert.equal(panel.style.display, 'none');
  assert.equal(c.document.activeElement, panel, 'not moved to ?');
  assert.equal(blurred, 1);
});

test('each name in the credit line links to its X account, and a click opens it with no handle on this page', async () => {
  const want = [['Bitview.space', '_bitview_'], ['Bitcoin Core', 'bitcoincoreorg'], ['Antoine Le Calvez', 'khannib'],
    ['Renato Shirakashi', 'renato_shira'], ['James Check', '_Checkmatey_'], ['@_nym21_', '_nym21_']].map(([n, x]) => [n, 'https://x.com/' + x]);
  const plainText = {
    en: 'Powered by Bitview.space & Bitcoin Core. Credits: Antoine Le Calvez, Renato Shirakashi, James Check, @_nym21_',
    zh: '由 Bitview.space 和 Bitcoin Core 提供支持。鸣谢：Antoine Le Calvez、Renato Shirakashi、James Check、@_nym21_',
    ja: 'Bitview.space と Bitcoin Core を利用。クレジット：Antoine Le Calvez、Renato Shirakashi、James Check、@_nym21_'
  };
  for (const lang of ['en', 'zh', 'ja']) {
    const { c, element } = app();
    c.lang = lang;
    const { dates, raw } = market(c);
    await c.renderChart(c.buildData(dates.at(-1), raw));
    const credit = element('chart').layout.annotations.find(a => /Bitview/.test(a.text));
    assert.deepEqual([...credit.text.matchAll(/<a href="([^"]+)" style="color:#ffffff">([^<]+)<\/a>/g)].map(m => [m[2], m[1]]), want, lang + ': every name a link');
    // White under the line's 55% opacity (Plotly draws a link's colour inside the text, which keeps the opacity) is
    // exactly the grey of the words around the names.
    assert.equal(credit.font.color, 'rgba(255,255,255,0.55)', lang);
    assert.equal(credit.text.replace(/<[^>]*>/g, ''), plainText[lang], lang + ': the words are as before');
  }
  const { c, element } = app(), opened = [];
  c.open = (...args) => { opened.push(args); return null; };
  const click = element('chart').listeners('click')[0];
  let prevented = 0;
  const on = (href, extra) => ({ button: 0, target: { closest: s => (s === 'a' && href ? { href: { baseVal: href } } : null) }, preventDefault() { prevented++; }, ...extra });
  click(on('https://x.com/_Checkmatey_'));
  assert.deepEqual(opened, [['https://x.com/_Checkmatey_', '_blank', 'noopener']]);
  assert.equal(prevented, 1);
  click(on('https://x.com/khannib', { ctrlKey: true }));   // left to the browser: a tab of its own
  click(on('https://x.com/khannib', { button: 1 }));
  click(on('https://example.com/'));
  click(on('https://x.com/khannib/status/1'));
  click(on(null));
  assert.equal(opened.length, 1);
  assert.equal(prevented, 1);
  // Plotly's own link colour (#447adb) all but vanished on the chart: the names take the line's, underlined when
  // pointed at so they still read as links.
  assert.match(decls('#chart .annotation-text a:hover'), /text-decoration:\s*underline/);
  assert.doesNotMatch(decls('#chart .annotation-text a:hover'), /fill/);
});

test('the language button is named by the label it shows', () => {
  assert.match(html, /<button id="langBtn" aria-label="中文 — Change language">中文<\/button>/);
  const { c, element } = app(), btn = element('langBtn');
  for (const l of ['zh', 'ja', 'en']) {
    c.lang = l; c.applyLang();
    assert.equal(btn.attributes['aria-label'], btn.textContent + ' — ' + c.T[l].ariaLang, l);
  }
});

test('a toolbar button clicked with the mouse lets go of focus, so no focus ring appears when the arrow keys are used', () => {
  const { c, element } = app(), btn = element('btnCoin'), click = element('controls').listeners('click')[0];
  let blurred = 0;
  btn.blur = () => blurred++;
  const on = el => ({ closest: sel => (sel === 'button, a' ? el : null) });
  c.document.activeElement = btn;
  click({ detail: 0, target: on(btn) });
  assert.equal(blurred, 0, 'pressed with Enter or Space: focus stays for the keyboard');
  click({ detail: 1, target: on(btn) });
  assert.equal(blurred, 1, 'clicked: focus goes');
  c.document.activeElement = element('dateInput');
  click({ detail: 1, target: on(btn) });
  assert.equal(blurred, 1, 'nothing to let go of when something else has focus');
  click({ detail: 1, target: on(null) });
  assert.equal(blurred, 1);
});

test('the page\'s own error messages are in the page\'s language, and follow it', async () => {
  const h = app({ fetch: () => new Promise(() => {}) }), { c, timers, runTimer } = h;
  c.lang = 'zh';
  const failed = c.fetchJSON('/x').catch(e => e);
  runTimer([...timers.keys()][0]);
  const e = await failed;
  assert.equal(e.message, '请求超时（15 秒）');
  c.lang = 'ja';
  assert.equal(c.errorText(e), 'リクエストがタイムアウトしました（15 秒）');
  assert.throws(() => c.cleanDates('x'), { message: c.T.ja.errDates });
  assert.throws(() => c.cleanCohort(null), { message: c.T.ja.errCostBasis });
  await assert.rejects(c.fetchRaw('../x'), { message: c.T.ja.errNotDate + '../x' });
  c.fetchJSON = url => Promise.resolve(dayAnswer(url, []) || null);
  await c.init();
  assert.equal(h.element('dateDisplay').textContent, c.T.ja.errPrefix + c.T.ja.errNoDates);
  assert.equal(c.errorText(new Error('HTTP 404')), 'HTTP 404', 'technical messages stay as they are');
});

test('what the browser kept is taken only as the pins this page writes: anything else is left out', () => {
  // Error analysis, 20 Nov 2026, with the store as a returning visitor's browser can hand it back. A height kept as
  // text stopped every chart from drawing ("v.toFixed is not a function"); an entry that was no pin left PIN Y-AXIS
  // pressed over a scale that was not pinned; a store that was a word could not take a pin, and one that was a list
  // lost it at the next visit.
  const open = (kept) => {
    const stored = kept === undefined ? {} : { bsd_peaks_v3: typeof kept === 'string' ? kept : JSON.stringify(kept) };
    const localStorage = { getItem: k => (k in stored ? stored[k] : null), setItem: (k, v) => { stored[k] = String(v); } };
    return { c: app({ localStorage }).c, stored };
  };
  const held = (kept) => JSON.parse(JSON.stringify(open(kept).c.peakStore));
  const pin = { 'usd%|b625|s0.24': ['2026-11-19', 1.2], 'btc%|b300|s1': ['2015-01-14', 0.4] };
  assert.deepEqual(held(pin), pin, 'pins as the page writes them are kept as they are');
  assert.deepEqual(held({ 'usd%|b625|s0.24': ['2026-11-19', '1.2'] }), {}, 'a height written as text');
  assert.deepEqual(held({ 'usd%|b625|s0.24': 'abc', 'btc%|b625|s0': 5, 'usd%|b400|s0': null, 'usd%|b500|s0': { 0: 'a', 1: 2 } }), {}, 'entries that are no pins');
  assert.deepEqual(held({ a: ['2026-11-19', 0], b: ['2026-11-19', -3], c: ['2026-11-19', NaN], d: ['2026-11-19', 1e999], e: [20261119, 2], f: ['2026-11-19'], g: [] }), {}, 'no height above zero, or no day');
  assert.deepEqual(held({ 'usd%|b625|s0.24': ['2026-11-19', 1.2, 'more'], bad: 'x' }), { 'usd%|b625|s0.24': ['2026-11-19', 1.2] }, 'the pins among them are kept, as a day and a height');
  for (const kept of ['"oops"', '[1,2]', '5', 'true', 'null', '{not json', '']) assert.deepEqual(held(kept), {}, kept + ' is no store of pins');
  assert.deepEqual(held(undefined), {}, 'a first visit');
  // And a pin made after any of them is kept for the next visit.
  const { c, stored } = open('"oops"');
  c.peakStore['usd%|b625|s0.24'] = ['2026-11-20', 1.8]; c.peakSave();
  assert.deepEqual(JSON.parse(stored.bsd_peaks_v3), { 'usd%|b625|s0.24': ['2026-11-20', 1.8] });
  const list = open('[1,2]');
  list.c.peakStore['usd%|b625|s0.24'] = ['2026-11-20', 1.8]; list.c.peakSave();
  assert.deepEqual(JSON.parse(list.stored.bsd_peaks_v3), { 'usd%|b625|s0.24': ['2026-11-20', 1.8] }, 'a list could be pinned on and wrote itself back without the pin');
});

test('pins measured on the price axis before it ended exactly at the highest stamp are never looked up; new ones are kept', () => {
  // v2 heights came from bars about 0.5% wider (the axis ran past the highest stamp), so a v2 pin would freeze the
  // axis at a height no bar on the page has; v1 and RAW's pins are older still.
  const stored = { bsd_peaks_v2: JSON.stringify({ 'usd|b625|s0': ['2026-08-14', 30.56e9], 'usd|b625|s0.24': ['2026-08-14', 2e10] }),
    bsd_peaks_v1: JSON.stringify({ 'usd|b625|s0.24': ['2025-01-01', 9e9] }) };
  const localStorage = { getItem: k => (k in stored ? stored[k] : null), setItem: (k, v) => { stored[k] = String(v); } };
  const { c } = app({ localStorage });
  assert.equal(c.PEAK_STORE_KEY, 'bsd_peaks_v3');
  assert.deepEqual(Object.keys(c.peakStore), [], 'none of them');
  c.peakStore['usd|b625|s0'] = ['2026-08-14', 31.87e9]; c.peakSave();
  assert.deepEqual(JSON.parse(stored.bsd_peaks_v3), { 'usd|b625|s0': ['2026-08-14', 31.87e9] });
  assert.deepEqual(JSON.parse(JSON.stringify(app({ localStorage }).c.peakStore)), { 'usd|b625|s0': ['2026-08-14', 31.87e9] }, 'and kept for the next visit');
  assert.ok(stored.bsd_peaks_v2, 'the old ones are left alone, not rewritten');
});
