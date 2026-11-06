const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, firstHeights, urpd, flush } = require('./helpers.cjs');
const plain = v => JSON.parse(JSON.stringify(v));   // out of the page's realm, for deepEqual

const DAY = 864e5;
const iso = t => new Date(t).toISOString().slice(0, 10);

// A small market: `n` days from `start`, closes from `close(i)`, and each day's cohorts from `cohorts(i)`.
function market(c, { start = '2020-01-01', n = 12, close = i => 1000 + 10 * i, cohorts }) {
  const t0 = Date.parse(start + 'T00:00:00Z');
  const dates = Array.from({ length: n }, (_, i) => iso(t0 + i * DAY));
  c.allDates = dates;
  c.priceDates = dates.slice();
  c.priceIndexByDate = Object.fromEntries(dates.map((d, i) => [d, i]));
  c.priceArray = dates.map((_, i) => close(i));
  const raws = dates.map((d, i) => {
    const age = cohorts(i), all = {};
    for (const r of age) for (const k in r) all[k] = (all[k] || 0) + r[k];
    return { all, age };
  });
  return { dates, raws };
}
// A day's bars as the left axis draws them: each its share of the day in percent.
const shares = v => { const tot = v.reduce((a, b) => a + b, 0), k = tot > 0 ? 100 / tot : 0; return v.map(x => x * k); };   // as drawChart works it out
const sigFigs = label => label.replace(/^\$/, '').replace(/[KMBT]$/, '').replace('.', '').replace(/^0+/, '').replace(/0+$/, '').length;

test('smoothing spreads each stamp over the price range it was rounded from, keeps $0 at $0, and preserves totals and means', () => {
  const { c } = app();
  c.NUM_BINS = 625; c.KERNEL_PCT = 0.24;
  const w = 10, agg = c.aggregate({ 0: 5, 1000: 2 }, w);
  assert.equal(agg.length, 626);
  assert.equal(agg[0].supply, 5, 'the $0 stamp stays whole in the first bar');
  let s = 0, m = 0, below = 0, above = 0;
  for (const b of agg.slice(1)) { s += b.supply; m += b.supply * b.price; if (b.price < 1000) below += b.supply; else above += b.supply; }
  assert.ok(Math.abs(s - 2) < 1e-12);
  assert.ok(Math.abs(m / s - 1000) < 0.05, 'mean price preserved');
  assert.ok(Math.abs(below - above) < 1e-9, 'symmetric about the stamp');
  assert.ok(agg.filter(b => b.supply > 1e-6).length >= 3, 'spread over several bars');
  // $10 steps from $100,000: still centred, and wider
  const hi = c.aggregate({ 100000: 1 }, 170);
  const mh = hi.reduce((a, b) => a + b.supply * b.price, 0);
  assert.ok(Math.abs(mh - 100000) < 1);
  // Smoothing 0 is the raw bars
  c.KERNEL_PCT = 0;
  const raw = c.aggregate({ 0: 5, 1000: 2, 1009.9: 1 }, w);
  assert.equal(raw[100].supply, 3); assert.equal(raw[0].supply, 5);
  assert.equal(raw.filter(b => b.supply > 0).length, 2);
});

test('the price axis comes from the history on days it covers, and only grows after it', () => {
  const { c } = app();
  const { dates, raws } = market(c, { cohorts: () => [{ 900: 1 }] });
  c.setScales({ start: '2020-01-01', end: '2020-01-05', bins: 625, smoothing: 0.24, x: [[0, 1000], [3, 1500]], usd: [[0, 10]], btc: [[0, 1]] });
  assert.equal(c.xAxisEnd('2020-01-02', 5000, 900), 1000, 'a covered day ignores its own data');
  assert.equal(c.xAxisEnd('2020-01-04', 5000, 900), 1500);
  assert.equal(c.xAxisEnd('2020-01-07', 1400, 1060), 1500, 'after the file it carries on from the last value');
  assert.equal(c.xAxisEnd('2020-01-08', 1600, 1070), 1600, 'and grows to exactly a new highest stamp, nothing added');
  assert.equal(c.xAxisEnd('2020-01-09', 1400, 1700), 1700 * 1.001, 'or 0.1% past a price above every stamp');
  const data = c.buildData(dates[3], raws[3]);
  assert.equal(data.binWidth * c.NUM_BINS, 1500, 'bins divide the axis so far, not the day');
  c.setScales(null);
  assert.ok(c.xAxisEnd('2020-01-02', 50, 1010) >= 1010 * 1.001, 'without the history it still clears the price');
  c.setScales({ start: 'bad' });
  assert.equal(c.SCALES, null, 'a malformed file is ignored');
});

test('the left axis ends at the day\'s own bars, where the Y-max field says, and a day looks the same however it is reached', async () => {
  const { c, element } = app();
  const peaks = [3, 5, 4, 9, 2, 2, 7, 12, 1, 6];
  const { dates, raws } = market(c, { n: 10, cohorts: i => [{ 950: peaks[i], 1005: 1 }, { 990: 1 }] });
  const seen = {};
  for (const i of [5, 1, 8, 3, 9, 0, 6, 2, 7, 4, 5, 8, 0, 9]) {
    const data = c.buildData(dates[i], raws[i]);
    await c.renderChart(data);
    const top = element('chart').layout.yaxis.range[1];
    assert.ok(Math.abs(top - Math.max(...shares(c.barValues(data, false)))) < 1e-9, `${dates[i]}: USD starts at Y-max 100, the day's tallest bar, as its share of the day`);
    if (seen[i] !== undefined) assert.equal(top, seen[i], `${dates[i]} looks the same on every visit`);
    seen[i] = top;
  }
  assert.ok(seen[4] < seen[3], 'a short day is drawn at its own height, not the tallest so far');
  assert.equal(c.yMaxPct, 100);
  for (const gone of ['setYMaxMode', 'yAxisSoFar', 'yFit', 'yMaxExplicit']) assert.equal(typeof c[gone], 'undefined', gone + ' is gone: nothing but the Y-max field and a pin sets the axis');
});

test('both axes are labelled at twenty equal steps from 0 to their very end, to two significant figures', async () => {
  const { c, element } = app();
  let threes = 0, n = 0;
  for (let e = -2; e < 13; e += 0.0137) {
    const end = Math.pow(10, e), ticks = c.axisTicks(end), labels = c.axisLabels(ticks, false);
    assert.equal(ticks.length, 21); assert.equal(ticks[0], 0); assert.ok(Math.abs(ticks[20] - end) <= end * 1e-12, 'the end itself is a tick');
    assert.equal(labels[0], '$0');
    labels.forEach((l, k) => { if (k) assert.notEqual(l, labels[k - 1], `${end}: neighbouring labels differ`); });
    const top = Math.pow(10, Math.floor(Math.log10(end)));
    labels.slice(1).forEach((l, k) => {
      const v = ticks[k + 1], sf = sigFigs(l);
      if (sf > 2) { assert.ok(sf === 3 && end / top < 2 && v >= top * (1 - 1e-9), `${l}: a third figure only in the top power of ten of an end between 1 and 2 of it (${labels.join(' ')})`); threes++; }
      n++;
    });
    labels.forEach((l, k) => { const v = ticks[k]; if (v) { const shown = Number(l.replace('$', '').replace(/K$/, 'e3').replace(/M$/, 'e6').replace(/B$/, 'e9').replace(/T$/, 'e12')); assert.ok(Math.abs(shown - v) <= v * 0.05 + 1e-12, `${l} is within rounding of ${v}`); } });
  }
  assert.ok(threes / n < 0.1, 'nearly every label has two figures');
  const { dates, raws } = market(c, { cohorts: () => [{ 950: 3, 1005: 1 }] });
  await c.renderChart(c.buildData(dates[2], raws[2]));
  const L = element('chart').layout, y = L.yaxis, x = L.xaxis;
  assert.equal(y.tickvals.length, 21); assert.equal(y.tickvals[20], y.range[1], 'the top of the left axis is labelled');
  assert.equal(x.tickvals.length, 21); assert.equal(x.tickvals[20], x.range[1], 'the right end of the price axis is labelled');
  assert.deepEqual(Array.from(y.ticktext), Array.from(c.axisLabels(y.tickvals, '%')), 'the left axis in percent');
  assert.deepEqual(plain(c.axisLabels(c.axisTicks(1.46), '%')).slice(0, 3), ['0%', '0.073%', '0.15%']);
  assert.equal(c.axisLabels(c.axisTicks(100), '%')[20], '100%');
  assert.deepEqual([c.pctCompact(13.93), c.pctCompact(1.4712), c.pctCompact(0.07254)], ['13.9%', '1.47%', '0.0725%']);
  assert.equal(x.ticktext[0].trim(), '$0'); assert.ok(x.ticktext[0].length > 2, 'the price axis $0 is nudged off the corner');
  assert.equal(y.showgrid, true, 'each label has its own gridline');
  assert.equal(L.yaxis2, undefined, 'no % of Total axis');
});

test('hovering a bar gives the whole bar\'s total and its running share of the day, with no separate line', async () => {
  const { c, element } = app();
  c.splitMode = false;                                          // in AGE: each bar is its band
  const { dates, raws } = market(c, { cohorts: () => [{ 900: 1, 1000: 2 }, { 1000: 1 }] });
  for (const coin of [false, true]) {
    c.coinMode = coin;
    await c.renderChart(c.buildData(dates[3], raws[3]));
    const graph = element('chart'), bars = graph.data.filter(t => t.type === 'bar');
    assert.equal(bars.length, 2);
    for (const b of bars) {
      assert.match(b.hovertemplate, coin ? /Total Supply: %\{customdata\[0\]:\.3r\}% \(%\{customdata\[2\]:,\.2f\} BTC\)/ : /Total Value When Last Moved: %\{customdata\[0\]:\.3r\}% \(%\{customdata\[2\]:\$,\.0f\}\)/);
      assert.match(b.hovertemplate, /<br>(<1h|1h-1d): %\{y:\.3r\}%<br>/, 'its band as a share of the day');
      assert.match(b.hovertemplate, /<br>Percent of Total: %\{customdata\[1\]:\.1f\}%/);
      assert.equal(b.customdata, bars[0].customdata, 'one shared array');
    }
    const cd = bars[0].customdata, totals = c.barValues(c.buildData(dates[3], raws[3]), coin), pct = shares(totals);
    cd.forEach((p, i) => { assert.ok(Math.abs(p[0] - pct[i]) < 1e-12); assert.equal(p[2], totals[i], 'the amount behind it'); if (i) assert.ok(p[1] >= cd[i - 1][1]); });
    const drawn = bars.reduce((sum, b) => sum + b.y.reduce((a, v) => a + v, 0), 0);
    assert.ok(Math.abs(drawn - 100) < 1e-9, 'the day\'s bars add up to 100%');
    assert.ok(Math.abs(cd.at(-1)[1] - 100) < 1e-9);
    assert.equal(graph.data.some(t => t.meta === 'pct' || t.yaxis === 'y2'), false);
    assert.match(graph.layout.title.text, coin ? /^<b>Bitcoin URPD \(% BTC, AGE\) as of / : /^<b>Bitcoin URPD \(% USD, AGE\) as of /);
    assert.equal(graph.layout.xaxis.title.text, 'Price When Last Moved [USD]', 'the title names the axis and nothing else');
    assert.equal(graph.layout.yaxis.title.text, coin ? 'Percent of BTC Supply Last Moved [%]' : 'Percent of USD Value Last Moved [%]');
  }
  // the video's chart says the same (USD view; its title is checked in video-looks.test.cjs)
  const video = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'tools', 'video', 'page.html'), 'utf8');
  const looks = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'tools', 'video', 'looks.mjs'), 'utf8');
  for (const s of ['"<b>" + esc(sp.title) + ', 'title: { text: "Price When Last Moved [USD]", font', 'text: esc(sp.yTitle)',
  ]) assert.ok(video.includes(s), 'video: ' + s);
  for (const s of ['yTitle: "Percent of USD Value Last Moved [%]"', 'yTitle: "Percent of BTC Supply Last Moved [%]"', 'profit: "USD Value Last Moved In Profit: "', 'loss: "USD Value Last Moved In Loss: "',
    'profit: "BTC Supply Last Moved In Profit: "', 'loss: "BTC Supply Last Moved In Loss: "']) assert.ok(looks.includes(s), 'video: ' + s);
  assert.doesNotMatch(video, /This Price|Supply Distribution|per bar|perBar|BOTTOM SIGNAL|GLOW|isBottom/);
});

test('LTH/STH draws the same bars as AGE, split at 150 days: short-term holders (the first eight bands) under long-term holders', async () => {
  const { c, element } = app();
  // All 23 bands, each at a price of its own, so every band shows where it went.
  const { dates, raws } = market(c, { cohorts: () => Array.from({ length: 23 }, (_, k) => ({ [900 + 10 * k]: k + 1 })) });
  for (const coin of [false, true]) {
    c.coinMode = coin;
    const data = c.buildData(dates[3], raws[3]);
    c.splitMode = false;
    await c.renderChart(data);
    const ageGraph = element('chart'), age = ageGraph.data.filter(t => t.type === 'bar'), ageTop = ageGraph.layout.yaxis.range[1];
    assert.equal(age.length, 23);
    c.splitMode = true;
    await c.renderChart(data);
    const g = element('chart'), split = g.data.filter(t => t.type === 'bar');
    assert.deepEqual(plain(split.map(t => t.meta)), ['sth', 'lth']);
    assert.deepEqual(plain(split.map(t => t.name)), ['Short-Term Holders (STH)', 'Long-Term Holders (LTH)']);
    assert.deepEqual(plain(split.map(t => t.marker.color)), ['#e6a817', '#5599ff'], 'amber under blue');
    for (let i = 0; i < age[0].y.length; i++) {
      const young = age.slice(0, 8).reduce((s, t) => s + t.y[i], 0), all = age.reduce((s, t) => s + t.y[i], 0), tol = 1e-9 * Math.max(1, all);
      assert.ok(Math.abs(split[0].y[i] - young) <= tol, 'STH: bands <1h to 4m-5m');
      assert.ok(Math.abs(split[0].y[i] + split[1].y[i] - all) <= tol, 'together the whole bar');
    }
    for (const t of split) {
      assert.match(t.hovertemplate, new RegExp('<br>' + t.name.replace(/[()]/g, '\\$&') + ': '));
      assert.match(t.hovertemplate, /<br>Percent of Total: %\{customdata\[1\]:\.1f\}%/);
    }
    assert.equal(g.layout.yaxis.range[1], ageTop, 'the same left axis');
    assert.equal(g.layout.legend.font.size, 12, 'two legend entries, in the larger type');
    assert.match(g.layout.title.text, coin ? /^<b>Bitcoin URPD \(% BTC, LTH\/STH\) as of / : /^<b>Bitcoin URPD \(% USD, LTH\/STH\) as of /);
  }
  c.splitMode = false;
});

test('Percent of Total meets the price box at the dashed line: at most In Profit left of it, at least right of it', async () => {
  const { c, element } = app();
  // A pile of supply just above the day's price (1020), which the smoothing spreads onto both sides of the line.
  const { dates, raws } = market(c, { cohorts: () => [{ 900: 5, 1015: 2, 1025: 50, 1100: 3 }] });
  c.KERNEL_PCT = 0.24;
  for (const coin of [false, true]) {
    c.coinMode = coin;
    const data = c.buildData(dates[2], raws[2]);
    await c.renderChart(data);
    const graph = element('chart'), bar = graph.data.find(t => t.type === 'bar'), spot = data.spot;
    const profit = coin ? data.profitPctCoin : data.profitPct;
    const box = graph.layout.annotations.find(a => /In Profit/.test(a.text)).text;
    assert.ok(box.includes('In Profit: ' + profit.toFixed(1) + '%'), box);
    let left = 0, right = 0;
    bar.x.forEach((price, i) => {
      const share = bar.customdata[i][1];
      if (price < spot) { left++; assert.ok(share <= profit && +share.toFixed(1) <= +profit.toFixed(1), `${price}: ${share} > ${profit}`); }
      else { right++; assert.ok(share >= profit && +share.toFixed(1) >= +profit.toFixed(1), `${price}: ${share} < ${profit}`); }
    });
    assert.ok(left > 0 && right > 0);
    // The smoothed bars' own running sum, which the hover used to show, crossed the line here.
    const vals = c.barValues(data, coin), tot = vals.reduce((a, b) => a + b, 0);
    let run = 0;
    const smoothed = vals.map(v => (run += v, 100 * run / tot));
    assert.ok(bar.x.some((price, i) => price < spot && smoothed[i] > profit + 0.05), 'the case this guards against');
  }
});

test('BTC starts at Y-max 99.8: the first bar, the tallest, runs off the top with its height printed; at 100 it counts like any other', async () => {
  const { c, element } = app();
  // a $0 pile, and a little in every dollar up to the price, so that every one of the 626 bars holds something
  const day = { 0: 5000 }; for (let p = 1; p <= 1099; p++) day[p] = 1 + (p % 7);
  const { dates, raws } = market(c, { close: () => 1000, cohorts: () => [day] });
  c.setScales({ start: dates[0], end: dates.at(-1), x: [[0, 1100]] });
  assert.deepEqual(plain(c.yMaxByMode), [100, 99.8], 'USD starts at 100, BTC at 99.8');
  c.setViewMode(1);
  assert.equal(c.yMaxPct, 99.8);
  assert.equal(element('ymaxInput').value, '99.8', 'and the field says so');
  const data = c.buildData(dates[4], raws[4]);
  await c.renderChart(data);
  const graph = element('chart'), bars = shares(c.barValues(data, true)), top = graph.layout.yaxis.range[1];
  assert.equal(bars.length, 626);
  assert.equal(top, bars.slice().sort((a, b) => a - b)[624], 'the axis ends at the second tallest bar');
  assert.deepEqual(plain(bars.map((v, i) => (v > top ? i : -1)).filter(i => i >= 0)), [0], 'the $0 pile runs off the top, and nothing else');
  assert.ok(graph.layout.annotations.some(a => a.text === '▲ ' + c.pctCompact(bars[0])), 'its share of the day is printed at the top');
  c.applyYMax(100);
  assert.deepEqual(plain(c.yMaxByMode), [100, 100], 'a typed value is kept for the weighting in view');
  await c.renderChart(data);
  assert.equal(element('chart').layout.yaxis.range[1], bars[0], 'at 100 the first bar counts like any other');
  assert.ok(!element('chart').layout.annotations.some(a => /^▲/.test(a.text)), 'and nothing is cut');
  c.setViewMode(0);
  assert.equal(c.yMaxPct, 100, 'USD keeps its own');
});

test('a typed Y-max zooms into the day in view, and every bar it cuts is counted; a pin freezes the axis and turns the field off', async () => {
  const { c, element } = app();
  const day = { 1000: 400 }; for (let p = 1; p <= 1099; p++) day[p] = (day[p] || 0) + 1;
  const { dates, raws } = market(c, { cohorts: () => [day] });
  c.setScales({ start: dates[0], end: dates.at(-1), x: [[0, 1100]] });
  const data = c.buildData(dates[5], raws[5]), bars = shares(c.barValues(data, false)), tallest = Math.max(...bars);
  await c.renderChart(data);
  assert.equal(element('chart').layout.yaxis.range[1], tallest, 'at 100 the day\'s tallest bar reaches the top');
  assert.equal(element('ymaxInput').disabled, false);
  c.applyYMax(99);
  await c.renderChart(data);
  const zoomed = element('chart').layout.yaxis.range[1], cut = bars.filter(v => v > zoomed);
  assert.equal(zoomed, bars.slice().sort((a, b) => a - b)[Math.floor(626 * 0.99)], 'the 99th percentile of the day\'s bars');
  assert.ok(cut.length > 1, 'the spike and the bars its smoothing reaches');
  const note = element('chart').layout.annotations.find(a => /^▲/.test(a.text));
  assert.equal(note.text, '▲ ' + c.pctCompact(tallest) + ' (+' + (cut.length - 1) + ')', 'the tallest of them, and how many more');
  assert.equal(c.peakKey(data), 'usd%|b625|s0.24', 'pins are shares now, kept apart from the amounts pinned before');
  c.peakStore[c.peakKey(data)] = [dates[1], 2.5];
  await c.renderChart(data);
  assert.equal(element('chart').layout.yaxis.range[1], 2.5, 'a pin holds the axis, whatever the Y-max says');
  assert.equal(element('ymaxInput').disabled, true, 'so the Y-max field is off while it holds');
  assert.ok(element('chart').layout.annotations.some(a => /^Pinned 2\.50% · /.test(a.text)), 'the pin is labelled with its share and day');
  delete c.peakStore[c.peakKey(data)];
  await c.renderChart(data);
  assert.equal(element('ymaxInput').disabled, false, 'released, the field is on again');
  assert.equal(element('chart').layout.yaxis.range[1], zoomed);
  assert.doesNotMatch(require('./helpers.cjs').html, /yMaxExplicit/, 'a typed Y-max no longer outranks a pin: the field is simply off');
});

test('landmark markers sit on the line\'s own extreme within a week, labelled inside the plot', async () => {
  const { c, element } = app();
  // The close peaks on 2021-11-09, a day before the landmark's (intraday) date.
  const { dates, raws } = market(c, { start: '2021-09-01', n: 120, close: i => (iso(Date.UTC(2021, 8, 1) + i * DAY) === '2021-11-09' ? 67000 : 60000 + (i % 7) * 100), cohorts: () => [{ 60000: 1 }] });
  await c.renderChart(c.buildData('2021-11-20', raws[dates.indexOf('2021-11-20')]));
  const graph = element('chart');
  const markers = graph.data.find(t => t.mode === 'markers' && Array.isArray(t.marker.symbol));
  const k = markers.marker.symbol.indexOf('triangle-down');
  assert.equal(markers.x[k], '2021-11-09'); assert.equal(markers.y[k], 67000);
  const label = graph.layout.annotations.find(a => a.text === 'Cycle 4 Top');
  assert.ok(label, 'labelled with an annotation');
  assert.equal(label.xref, 'x2'); assert.equal(label.yref, 'y3'); assert.equal(label.y, 67000);
  assert.equal(label.yanchor, 'top', 'hangs down from the peak, so a new high stays inside the plot');
  assert.ok(label.bgcolor && label.font.size >= 11, 'on a dark backing, readable');
  assert.equal(graph.layout.yaxis3.range[1], 67000, 'the line still fills the height');
});

test('a click and drag marks a range of prices instead of zooming; it stays, with its share of the day and the days until every coin there is long-term', async () => {
  const { c, element } = app();
  c.splitMode = false;                                          // in AGE: the box lists the age bands
  const { dates, raws } = market(c, { start: '2021-09-01', n: 60, close: () => 60000, cohorts: () => [{ 100: 1, 60000: 1, 70000: 2 }] });
  const data = c.buildData(dates[50], raws[50]);
  c.priceHighLow = { high: null, low: null };                   // no highs and lows: the age bands alone
  const markBox = layout => layout.annotations.find(a => a.xref === 'x' && a.width);
  const flat = a => a.text.replace(/<br>/g, ' ').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  await c.renderChart(data);
  let gd = element('chart'), L = gd.layout;
  assert.equal(L.dragmode, false, 'Plotly neither zooms nor pans');
  assert.equal(gd.config.doubleClick, false);
  for (const b of ['zoom2d', 'pan2d', 'select2d', 'zoomIn2d', 'zoomOut2d', 'autoScale2d', 'resetScale2d']) assert.ok(gd.config.modeBarButtonsToRemove.includes(b), b);
  for (const ax of ['xaxis', 'yaxis', 'xaxis2', 'yaxis3']) assert.equal(L[ax].fixedrange, true, ax);
  assert.ok(!markBox(L), 'nothing marked yet');
  // A mark over the prices 50,000 to 65,000: the value there is the 60,000 stamp's, 60000 / (100 + 60000 + 140000). Every
  // coin there is in the first age band, under an hour old, so all of the share is <1h, and with no highs and lows to go
  // by, each is a long-term holder within 150 days: by 20 Mar 2022, from 21 Oct 2021.
  c.rangeMark = { lo: 50000, hi: 65000 };
  await c.renderChart(data);
  L = element('chart').layout;
  const box = markBox(L);
  assert.ok(box, 'a box with the figures');
  const share = c.pctCompact(100 * 60000 / 200100), days = ' All LTH Within: 150 Days (by 20 Mar 2022)';
  assert.equal(share, '30.0%');
  const want = 'Price: $50,000 \u2013 $65,000 USD Value Last Moved Here: ' + share + ' <1h USD Value Last Moved Here: ' + share + days;
  assert.equal(flat(box), want, 'the range, its share, its age band and the days, wrapped');
  // Inside the mark, as wide as it is, at the top: from 3 px inside its left line to 3 px inside its right one.
  const span = L.xaxis.range[1], px = x => x / span * 1040, pitch = 1040 * data.binWidth / span;
  const bandPx = (65000 - 50000) / span * 1040;
  assert.equal(box.xref, 'x'); assert.equal(box.xanchor, 'left'); assert.equal(box.xshift, 3);
  assert.equal(box.yref, 'paper'); assert.equal(box.y, 1); assert.equal(box.yanchor, 'top');
  assert.ok(Math.abs(box.width + 2 * (box.borderpad + box.borderwidth) - (bandPx - 6)) < 1e-6, 'the box spans the mark');
  for (const row of box.text.split('<br>').map(r => r.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))) assert.ok(row.length * 0.6 * box.font.size * 1.07 <= box.width + 1e-9, row + ' fits');
  // As it looked while dragged (#markBand): a light tint between two thin white lines the full height of the plot, each
  // in the pixel column at the edge of the bar that holds its price (see the next test).
  const edges = L.shapes.filter(s => s.type === 'line' && s.line.color === c.MARK_EDGE);
  assert.deepEqual(plain(edges.map(e => [e.x0 === e.x1, e.yref, e.y0, e.y1, e.line.width])), [[true, 'paper', 0, 1, 1], [true, 'paper', 0, 1, 1]], 'a white line at each edge');
  assert.ok(px(edges[0].x0) < px(50000) + 1 && px(edges[0].x0) > px(50000) - pitch - 1, 'the low line where the bar holding $50,000 starts');
  assert.ok(px(edges[1].x0) > px(65000) - 1 && px(edges[1].x0) < px(65000) + pitch + 1, 'the high line where the bar holding the last price before $65,000 ends');
  assert.ok(Math.abs(px(box.x) - (px(edges[0].x0) - 0.5)) < 1e-6, 'the box from its left line');
  const tint = L.shapes.filter(s => s.type === 'rect' && s.xref === 'x' && s.fillcolor === c.MARK_TINT);
  assert.deepEqual(plain(tint.map(v => [v.x0, v.x1, v.y0, v.y1])), [[edges[0].x0, edges[1].x0, 0, 1]], 'tinted from one line to the other');
  assert.ok(!L.shapes.some(s => s.xsizemode === 'pixel' || s.ysizemode === 'pixel'), 'no corner brackets');
  assert.match(require('./helpers.cjs').html, /#markBand \{[^}]*background: rgba\(255,255,255,0\.06\);[^}]*border-left: 1px solid rgba\(255,255,255,0\.75\);[^}]*border-right: 1px solid rgba\(255,255,255,0\.75\);/, 'the drag looks the same');
  assert.equal(c.MARK_TINT, 'rgba(255,255,255,0.06)'); assert.equal(c.MARK_EDGE, 'rgba(255,255,255,0.75)');
  // In % BTC the share is of the coins: 1 of 4.
  c.coinMode = true;
  await c.renderChart(data);
  assert.equal(flat(markBox(element('chart').layout)), 'Price: $50,000 \u2013 $65,000 BTC Supply Last Moved Here: 25.0% <1h BTC Supply Last Moved Here: 25.0%' + days, '% BTC');
  c.coinMode = false;
  // Escape clears it.
  c.rangeMark = { lo: 50000, hi: 65000 };
  c.rangeMark = null;
  await c.renderChart(data);
  assert.ok(!markBox(element('chart').layout), 'cleared');
});

test('a marked range\'s white lines sit between bars, never on one, and a drag moves them a whole bar at a time', async () => {
  // What the drag looks like on screen, against the bars as Plotly draws them: each bar edge at its position in px,
  // rounded to 0.01, then to a whole pixel, less 0.01 for the bars' hairline outline. (The user asked for the drag to go
  // step by step, a bar at a time; the lines used to sit at the exact prices, often on a bar's pixels.)
  const r2 = v => Math.round(v * 100) / 100;
  const drawnBars = (gd, m) => {
    const out = [];
    for (const tr of gd.data.filter(t => t.type === 'bar')) tr.x.forEach((x, i) => {
      if (!(tr.y[i] > 0)) return;
      const p0 = x - tr.width[i] / 2, p1 = p0 + tr.width[i];
      out.push([Math.round(r2(p0 * m)) - 0.01, Math.round(r2(p1 * m)) - 0.01]);
    });
    return out;
  };
  // The pixels a bar covers inside [a, b): none, for a line in a gap.
  const covered = (bars, a, b) => bars.reduce((s, [x0, x1]) => s + Math.max(0, Math.min(x1, b) - Math.max(x0, a)), 0);
  let W = 1498, ctx = null;
  const win = {}, made = [], raf = [];
  const { c, element } = app({
    Plotly: { react(id, traces, layout, config) {
      const gd = ctx.document.getElementById(id), span = layout.xaxis.range[1];
      Object.assign(gd, { data: traces, layout, config });
      gd._fullLayout = { width: W + 160, legend: { _height: 29 }, yaxis: { _length: 700, _offset: 0 },
        xaxis: { _length: W, _offset: 0, p2d: p => p / W * span, l2p: v => v / span * W } };
      return Promise.resolve();
    } },
    addEventListener(type, fn) { (win[type] = win[type] || []).push(fn); },
    requestAnimationFrame(fn) { raf.push(fn); return raf.length; }, cancelAnimationFrame() {}
  });
  ctx = c;
  c.document.createElement = () => { const el = { style: {}, appendChild() {} }; made.push(el); return el; };
  c.document.body.appendChild = () => {};
  c.splitMode = false;
  // A coin every $250 from $1,000 to $70,750: bars all along the axis, so a line on one would show.
  const { dates, raws } = market(c, { start: '2021-09-01', n: 60, close: () => 60000,
    cohorts: () => [Object.fromEntries(Array.from({ length: 280 }, (_, i) => [1000 + 250 * i, 1]))] });
  c.priceHighLow = { high: null, low: null };
  const gd = element('chart');
  for (const [w, bins, dpr] of [[1498, 625, 1], [1252, 625, 1], [1760, 625, 1], [1600, 300, 1], [1500, 50, 1], [1120, 625, 1], [1120, 625, 2], [1300, 1000, 2]]) {
    W = w; c.NUM_BINS = bins; c.devicePixelRatio = dpr; gd.clientWidth = W + 160;
    c.rangeMark = null;
    const data = c.buildData(dates[50], raws[50]);
    await c.renderChart(data);
    const span = gd.layout.xaxis.range[1], m = W / span, pitch = W * data.binWidth / span, gaps = pitch >= 2;
    const bars = drawnBars(gd, m), seps = [];
    const sepTrace = gd.data.find(t => t.meta === 'separators');
    if (sepTrace) sepTrace.x.forEach(x => { if (x !== null) seps.push(r2(x * m)); });
    const what = `${W} px, ${bins} bins, ${dpr}x (a ${pitch.toFixed(2)} px pitch)`;
    // Where a line goes: in the gap between two bars (2 px pitch and up), or on the separator over the last pixel of the
    // bar left of the edge (narrower, solid bars), one device pixel wide.
    const checkLine = (centre, width, label) => {
      if (gaps) { assert.equal(width, 1, label); assert.ok(covered(bars, centre - 0.5, centre + 0.5) < 0.02, `${label}: in a gap, on no bar (${what})`); return; }
      assert.equal(width, 1 / dpr, `${label}: a device pixel wide (${what})`);
      const near = seps.reduce((b, s) => Math.abs(s - centre) < Math.abs(b - centre) ? s : b, Infinity);
      if (Math.abs(near - centre) < pitch / 2) assert.ok(Math.abs(near - centre) < 0.011, `${label}: on the separator (${what})`);
    };
    // A drag from 30% of the way along, a pixel at a time.
    const x0 = Math.round(0.3 * W) + 0.4;
    gd.emit('mousedown', { button: 0, clientX: x0, clientY: 300 });
    let inside = null;
    for (let dx = 5; dx <= 45; dx++) {
      win.mousemove.forEach(f => f({ clientX: x0 + dx, clientY: 300, preventDefault() {} }));
      while (raf.length) raf.shift()();
      const band = made[made.length - 2].style;   // made: the layer, the band, the box
      const l = parseFloat(band.left), wd = parseFloat(band.width), bl = parseFloat(band.borderLeftWidth), br = parseFloat(band.borderRightWidth);
      checkLine(l + bl / 2, bl, `the dragged band's left line at +${dx} px`);
      checkLine(l + wd - br / 2, br, `the dragged band's right line at +${dx} px`);
      // The bars inside it: one more or the same at each pixel, never part of one.
      const n = bars.filter(([a, b]) => a >= l + bl - 0.02 && b <= l + wd - br + 0.02).length;
      if (gaps && inside !== null) assert.ok(n === inside || n === inside + 1, `a bar at a time (${what})`);
      inside = n;
    }
    const last = made[made.length - 2].style, lastL = parseFloat(last.left), lastR = lastL + parseFloat(last.width);
    win.mouseup.forEach(f => f({}));
    await flush();
    // Let go: drawn where it was dragged, on the same pixels.
    const lines = gd.layout.shapes.filter(s => s.type === 'line' && s.line.color === c.MARK_EDGE);
    assert.equal(lines.length, 2, what);
    assert.ok(Math.abs(r2(lines[0].x0 * m) - (lastL + lines[0].line.width / 2)) < 0.011, `the drawn left line where the dragged one was (${what})`);
    assert.ok(Math.abs(r2(lines[1].x0 * m) - (lastR - lines[1].line.width / 2)) < 0.011, `the drawn right line where the dragged one was (${what})`);
    lines.forEach((ln, i) => checkLine(r2(ln.x0 * m), ln.line.width, `the drawn ${i ? 'right' : 'left'} line`));
    // A mark kept from a day with other bars (here, other prices than this day's bar edges) is drawn out to whole bars.
    c.rangeMark = { lo: c.rangeMark.lo + 0.3 * data.binWidth, hi: c.rangeMark.hi + 0.6 * data.binWidth };
    await c.renderChart(data);
    gd.layout.shapes.filter(s => s.type === 'line' && s.line.color === c.MARK_EDGE).forEach((ln, i) => checkLine(r2(ln.x0 * m), ln.line.width, `a kept mark's ${i ? 'right' : 'left'} line`));
  }
  c.devicePixelRatio = undefined;
});

test('a marked range\'s box text wraps to the mark\'s width and shrinks only as far as its words need', () => {
  const { c } = app();
  const mono = (str, size) => { let w = 0; for (let i = 0; i < str.length; i++) w += str.charCodeAt(i) > 0x2e7f ? size : 0.6 * size; return w; };
  const wide = c.fitMarkText(['Price: $50,000 \u2013 $65,000', 'All LTH Within: 79 Days (by 18 Jan 2027)'], 2000, mono);
  assert.equal(wide.size, 13); assert.deepEqual(JSON.parse(JSON.stringify(wide.lines)), [['Price: $50,000 \u2013 $65,000'], ['All LTH Within: 79 Days (by 18 Jan 2027)']], 'room for every line');
  const narrow = c.fitMarkText(['All LTH Within: 79 Days (by 18 Jan 2027)'], 130, mono);
  assert.equal(narrow.size, 13, 'every word still fits at 13 px');
  for (const row of narrow.lines[0]) assert.ok(mono(row, 13) * 1.07 <= 130, row);
  assert.equal(narrow.lines[0].join(' '), 'All LTH Within: 79 Days (by 18 Jan 2027)', 'nothing lost or doubled');
  const tight = c.fitMarkText(['Price: $50,000'], 50, mono);
  assert.ok(tight.size < 13 && tight.size >= 9, 'a word wider than the box: a smaller size');
  const cjk = c.fitMarkText(['全部成为长期持有者: 79 天内（2027年1月18日前）'], 60, mono);
  for (const row of cjk.lines[0]) assert.ok(mono(row, cjk.size) * 1.07 <= 60, row + ': CJK breaks between characters');
  assert.equal(cjk.lines[0].join('').replace(/ /g, ''), '全部成为长期持有者:79天内（2027年1月18日前）', 'nothing lost or doubled');
});

test('a marked range\'s box gives its share of the day, broken down as the bars are coloured, and the most days until every coin there is long-term', async () => {
  const { c, element } = app();
  // At $60,000: 1 coin a week old (short-term) and 2 coins three years old (long-term); at $30,000 and $70,000 one more
  // long-term each.
  const bands = () => { const a = new Array(23).fill(null).map(() => ({})); a[3] = { 60000: 1 }; a[13] = { 30000: 1, 60000: 2, 70000: 1 }; return a; };
  const { dates, raws } = market(c, { start: '2021-09-01', n: 60, close: () => 60000, cohorts: bands });
  const data = c.buildData(dates[50], raws[50]);
  c.priceHighLow = { high: null, low: null };   // no highs and lows: the age bands alone
  c.splitMode = true;
  c.rangeMark = { lo: 50000, hi: 65000 };
  const markBox = () => element('chart').layout.annotations.find(a => a.xref === 'x' && a.width);
  const box = async () => { await c.renderChart(data); return markBox().text.replace(/<br>/g, ' ').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); };
  // Value: 60,000 short-term and 120,000 long-term in the mark, of 280,000 in the day; the two parts add up to the share
  // above them. The youngest coins there are at least a week old: 143 days after 21 Oct 2021.
  const range = 'Price: $50,000 \u2013 $65,000 ', days = ' All LTH Within: 143 Days (by 13 Mar 2022)';
  const want = range + 'USD Value Last Moved Here: 64.3% LTH USD Value Last Moved Here: 42.9% STH USD Value Last Moved Here: 21.4%' + days;
  assert.equal(await box(), want, 'the range, its share, LTH then STH, then the days');
  assert.ok(markBox().text.startsWith('Price: '), 'the range in the box\'s own colour');
  assert.match(markBox().text, new RegExp("<span style='color:" + c.LTH_COLOR + "'>LTH USD"), 'LTH in its legend colour');
  assert.match(markBox().text, new RegExp("<span style='color:" + c.STH_COLOR + "'>STH USD"), 'STH in its');
  assert.match(markBox().text, new RegExp("<span style='color:" + c.LTH_COLOR + "'>All LTH Within: "), 'the days in the LTH legend colour');
  // (CJK wraps between any two characters, so the rows are joined without the spaces here.)
  c.lang = 'zh'; assert.ok((await box()).replace(/ /g, '').endsWith('全部成为长期持有者:143天内（2022年3月13日前）'));
  c.lang = 'ja'; assert.ok((await box()).replace(/ /g, '').endsWith('すべて長期保有者になるまで:143日以内（2022年3月13日まで）'));
  c.lang = 'en';
  // Coins: 1 short-term and 2 long-term in the mark, of 5.
  c.coinMode = true; assert.equal(await box(), range + 'BTC Supply Last Moved Here: 60.0% LTH BTC Supply Last Moved Here: 40.0% STH BTC Supply Last Moved Here: 20.0%' + days, 'LTH/STH, % BTC');
  // AGE breaks it down by age band instead, youngest first, each in its colour: 1w-1m holds the short-term coin, 2y-3y
  // the long-term ones; the days as in LTH/STH.
  c.splitMode = false; assert.equal(await box(), range + 'BTC Supply Last Moved Here: 60.0% 1w-1m BTC Supply Last Moved Here: 20.0% 2y-3y BTC Supply Last Moved Here: 40.0%' + days, 'AGE, % BTC');
  c.coinMode = false; assert.equal(await box(), range + 'USD Value Last Moved Here: 64.3% 1w-1m USD Value Last Moved Here: 21.4% 2y-3y USD Value Last Moved Here: 42.9%' + days, 'AGE, % USD');
  assert.match(markBox().text, new RegExp("<span style='color:" + c.AGE_BAND_COLORS[13] + "'>2y-3y"), 'each band in its colour');
  // Where no short-term holder is: the coin at $30,000 is three years old. A mark too narrow for the words: 0 days.
  c.rangeMark = { lo: 25000, hi: 35000 };
  assert.equal(await box(), 'Price: $25,000 \u2013 $35,000 USD Value Last Moved Here: 10.7% 2y-3y USD Value Last Moved Here: 10.7% Already All Long-Term Holders');
  c.rangeMark = { lo: 28000, hi: 32000 };
  assert.equal(await box(), '0 Days');
  // Where no coin last moved at all ($40,000 to $50,000), the box says so: it does not call them long-term holders
  // (error analysis found "Already All Long-Term Holders" and "0 Days" over empty ranges).
  c.rangeMark = { lo: 40000, hi: 50000 };
  assert.equal(await box(), 'Price: $40,000 \u2013 $50,000 No BTC Last Moved Here');
  assert.ok(!markBox().text.includes(c.LTH_COLOR), 'not in the LTH colour: it is not about long-term holders');
  c.lang = 'zh'; assert.ok((await box()).replace(/ /g, '').endsWith('没有最后在此移动的BTC'));
  c.lang = 'ja'; assert.ok((await box()).replace(/ /g, '').endsWith('ここで最後に動いたBTCはありません'));
  c.lang = 'en';
  // Until the daily highs and lows are in, the days wait for them, and AGE asks for them as LTH/STH does.
  let asked = 0;
  c.priceHighLow = null; c.loadPriceHighLow = () => { asked++; };
  c.rangeMark = { lo: 50000, hi: 65000 };
  assert.equal(await box(), range + 'USD Value Last Moved Here: 64.3% 1w-1m USD Value Last Moved Here: 21.4% 2y-3y USD Value Last Moved Here: 42.9% All LTH Within: \u2026');
  assert.ok(asked > 0, 'asked for the highs and lows');
});

test('a marked range\'s box fits the plot and the mark: the bands in short, then fewer lines, the range and the days last', async () => {
  const { c, element } = app();
  c.splitMode = false;
  // One coin at $60,000 in each of the 23 bands, the youngest under an hour old: all long-term within 150 days.
  const { dates, raws } = market(c, { start: '2021-09-01', n: 60, close: () => 60000, cohorts: () => new Array(23).fill(null).map(() => ({ 60000: 1 })) });
  const data = c.buildData(dates[50], raws[50]);
  c.priceHighLow = { high: null, low: null };   // no highs and lows: the age bands alone
  const box = async (lo, hi, h) => {
    c.rangeMark = { lo, hi };
    await c.renderChart(data);                                  // the box takes the plot's height from the last drawing
    element('chart')._fullLayout.yaxis = { _length: h };
    await c.renderChart(data);
    const a = element('chart').layout.annotations.find(a => a.xref === 'x' && a.width);
    return a ? { text: a.text.replace(/<br>/g, ' ').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'), rows: a.text.split('<br>').length, size: a.font.size, pad: a.borderpad, yshift: a.yshift } : null;
  };
  // (The axis ends at $60,156, and so does a mark past it. The price, $60,000, is inside the mark, so the box starts
  // below the price box.) Every coin is in the mark: its share is the whole day, a 23rd of it in each band.
  const range = 'Price: $50,000 \u2013 $60,156 ', share = 'USD Value Last Moved Here: 100.0% ', days = 'All LTH Within: 150 Days (by 20 Mar 2022)';
  // Its bottom (how far down it starts, -yshift, plus its rows, padding and border) stays 3 px inside the plot.
  const inside = (b, h) => b.rows * Math.round(b.size * 1.31) + 2 * (b.pad + 1) - b.yshift <= h - 3;
  let b = await box(50000, 65000, 2000);
  assert.ok(b.text.startsWith(range + share + '<1h USD Value Last Moved Here: 4.35% 1h-1d USD Value Last Moved Here: 4.35% '), 'room for every line in full: ' + b.text.slice(0, 160));
  assert.ok(b.text.endsWith('>15y USD Value Last Moved Here: 4.35% ' + days), b.text.slice(-120));
  assert.equal(b.size, 13);
  b = await box(50000, 65000, 560);
  assert.ok(b.text.startsWith(range + share + '<1h: 4.35% 1h-1d: 4.35% ') && b.text.endsWith('>15y: 4.35% ' + days), 'the bands in short: ' + b.text);
  assert.ok(inside(b, 560), 'inside the plot');
  b = await box(50000, 65000, 280);
  assert.equal(b.text, range + share + days, 'the range, its share and the days'); assert.ok(inside(b, 280), 'inside the plot');
  b = await box(50000, 65000, 135);
  assert.equal(b.text, range + days, 'the range and the days'); assert.ok(b.size < 13); assert.ok(inside(b, 135), 'inside the plot');
  b = await box(50000, 65000, 116);
  assert.equal(b.text, days, 'the days line alone');
  b = await box(50000, 65000, 100);
  assert.equal(b.text, '150 Days', 'the number of days alone'); assert.equal(b.pad, 1, 'on less padding');
  assert.equal(await box(50000, 65000, 80), null, 'too short even for that: no box');
  // A mark too narrow for the words keeps the number of days alone too; over a range where no coin last moved, No BTC.
  b = await box(58000, 65000, 2000);
  assert.equal(b.text, '150 Days'); assert.equal(b.pad, 1);
  b = await box(20000, 26000, 2000);
  assert.equal(b.text, 'Price: $20,000 \u2013 $26,000 No BTC Last Moved Here');
  b = await box(20000, 23000, 2000);
  assert.equal(b.text, 'No BTC Last Moved Here', 'too narrow for the range: its line alone');
  b = await box(20000, 22000, 2000);
  assert.equal(b.text, 'No BTC', 'too narrow for that: in short'); assert.equal(b.pad, 1);
  assert.equal(await box(20000, 21500, 2000), null, 'too narrow even for that: no box');
});

test('a marked range\'s share comes from the recorded prices, [a, b)', () => {
  const { c } = app();
  const ladder = c.priceLadder({ 10: 1, 20: 2, 30: 3 });
  assert.equal(c.shareInRange(ladder, 10, 20, true), 100 / 6, 'the 10 stamp, not the 20 one');
  assert.equal(c.shareInRange(ladder, 10, 21, true), 50);
  assert.equal(c.shareInRange(ladder, 0, 1000, false), 100);
  assert.equal(c.shareInRange(ladder, 31, 40, false), 0);
  assert.equal(c.shareInRange(c.priceLadder({}), 0, 10, false), null);
});

test('a day with nothing to draw says why instead of showing an empty plot', async () => {
  const { c, element } = app();
  // Three days: no coins at all (the genesis day), every coin at $0 before any close, and a day with a close.
  const { dates, raws } = market(c, { start: '2010-08-14', n: 3, close: (i) => (i === 2 ? 0.06 : 0),
    cohorts: (i) => [i === 0 ? {} : i === 1 ? { 0: 50 } : { 0: 50, 0.06: 10 }] });
  const note = async (i, coin) => {
    c.coinMode = coin;
    await c.renderChart(c.buildData(dates[i], raws[i]));
    const a = element('chart').layout.annotations.find(a => a.xref === 'paper' && a.yref === 'paper' && a.x === 0.5 && a.y === 0.62);
    return a ? a.text.replace(/<br>/g, ' | ').replace(/<[^>]+>/g, '') : null;
  };
  assert.equal(await note(0, false), "No coins yet | The genesis block's 50 BTC can never be spent.");
  assert.equal(await note(0, true), "No coins yet | The genesis block's 50 BTC can never be spent.");
  // The first close in this market is 16 Aug 2010, as in BRK's own series.
  assert.equal(await note(1, false), 'No USD value yet | Every coin last moved before the first BTC/USD close (16 Aug 2010).');
  assert.equal(await note(1, true), 'Every coin is at $0 | Every coin last moved before the first BTC/USD close (16 Aug 2010).');
  assert.equal(await note(2, false), null, 'a day with value: no note');
  assert.equal(await note(2, true), null);
  c.lang = 'zh'; assert.equal(await note(1, false), '尚无美元价值 | 每枚币最后一次移动都早于首个 BTC/USD 收盘价（2010年8月16日）。');
  c.lang = 'ja'; assert.equal(await note(1, true), 'すべてのコインが $0 です | どのコインも最初の BTC/USD 終値（2010年8月16日）より前に最後に動きました。');
});

test('a marked range gives the most days until every coin there is a long-term holder', () => {
  const { c } = app();
  // Day 1000 of BRK's index; the price was between 50 and 60 on day 990, ten days earlier, and nowhere near it since.
  const dateStr = new Date(Date.UTC(2009, 0, 1) + 1000 * 864e5).toISOString().slice(0, 10);
  const high = new Array(1001).fill(100), low = new Array(1001).fill(90);
  high[990] = 58; low[990] = 52;
  const age = new Array(23).fill(null).map(() => ({}));
  age[3][55] = 1;   // 1w-1m: at least 7 days old
  age[12][40] = 5;  // a long-term band, outside the range
  const data = { dateStr, rawAge: age };
  assert.equal(c.daysToAllLth(data, 50, 60), null, 'waits for the highs and lows');
  c.priceHighLow = { high, low };
  assert.equal(c.daysToAllLth(data, 50, 60), 140, 'the price was last there 10 days ago: 150 - 10');
  age[3] = {}; age[4][55] = 1; delete data.sthPrices;   // the youngest band there is 1m-2m: at least 30 days old (the day's lists built again)
  assert.equal(c.daysToAllLth(data, 50, 60), 120);
  assert.equal(c.daysToAllLth(data, 30, 50), 0, 'only long-term holders there');
  c.priceHighLow = { high: null, low: null };
  assert.equal(c.daysToAllLth(data, 50, 60), 120, 'without the highs and lows, the age bands alone');
  high[1000] = 70; low[1000] = 54; c.priceHighLow = { high, low }; age[4] = {}; age[0][55] = 1; delete data.sthPrices;
  assert.equal(c.daysToAllLth(data, 50, 60), 150, 'inside the range on the day itself, coins less than an hour old');
});

test('build-scales writes the history the page reads back, one day at a time', async () => {
  const { main } = require('../tools/build-scales.cjs');
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scales-')), 'scales.json');
  const priceDates = [], closes = [];
  for (let t = Date.UTC(2009, 0, 1); t <= Date.UTC(2009, 0, 13); t += DAY) { priceDates.push(iso(t)); closes.push(0); }
  const dates = ['2009-01-03', '2009-01-09', '2009-01-10', '2009-01-11', '2009-01-12'];
  const stamps = { '2009-01-03': { 0: 50 }, '2009-01-09': { 0: 50, 3: 2000 }, '2009-01-10': { 0: 50, 3: 2000, 7: 1500 }, '2009-01-11': { 0: 50, 3: 1000 }, '2009-01-12': { 0: 51, 12: 4000 } };
  closes[priceDates.indexOf('2009-01-10')] = 6;
  const realFetch = global.fetch;
  global.fetch = async url => {
    const u = String(url), body =
      u.endsWith('/first_height/day1') ? firstHeights(priceDates, dates.concat('2009-01-13')) :   // and the day in progress
      u.endsWith('/price_close/day1') ? { data: closes } :
      u.endsWith('/date/day1') ? { data: priceDates } :
      /\/api\/urpd\/age_under_1h\/(\d{4}-\d\d-\d\d)$/.test(u) ? urpd(u.slice(-10), stamps[u.slice(-10)]) : urpd(u.slice(-10));
    return { ok: true, json: async () => body };
  };
  try {
    let file = await main(['--rebuild', '--until', '2009-01-11', '--out', out]);
    assert.equal(file.end, '2009-01-11');
    file = await main(['--until', '2009-01-12', '--out', out]);   // carries on from where it stopped
    assert.equal(file.end, '2009-01-12');
  } finally { global.fetch = realFetch; }
  const saved = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepEqual(Object.keys(saved), ['about', 'start', 'end', 'x'], 'the price axis only: the left axis needs no history');
  for (const k of ['x']) for (let i = 1; i < saved[k].length; i++) {
    assert.ok(saved[k][i][0] > saved[k][i - 1][0] && saved[k][i][1] > saved[k][i - 1][1], `${k} only steps up`);
  }
  // The page, reading that file, draws each day on exactly the price axis the file recorded for it, and its left axis at
  // the day's own tallest bar.
  const { c, element } = app();
  c.allDates = dates; c.priceDates = priceDates; c.priceArray = closes;
  c.priceIndexByDate = Object.fromEntries(priceDates.map((d, i) => [d, i]));
  c.setScales(saved);
  for (const d of dates) {
    const age = [stamps[d]].concat(Array(22).fill({})), all = Object.assign({}, stamps[d]);
    const data = c.buildData(d, { all, age });
    const day = Math.round((Date.parse(d) - Date.parse('2009-01-03')) / DAY);
    assert.ok(Math.abs(data.binWidth * 625 - c.scaleAt(saved.x, day)) <= 1e-12 * c.scaleAt(saved.x, day), d + ': the axis the file recorded');
    await c.renderChart(data);
    assert.ok(Math.abs(element('chart').layout.yaxis.range[1] - (Math.max(...shares(c.barValues(data, false))) || 1)) < 1e-9, d);
  }
});

test('the spot price box keeps clear of the pin\'s label and the ▲ figure at the top left', async () => {
  // BTC on a $0-1,100 axis, with a $0 pile above the axis (so ▲ is printed), the price at $50 or $1,000.
  async function draw(price, pinned) {
    const { c, element } = app();
    const { dates, raws } = market(c, { close: () => price, cohorts: () => [{ 0: 5000, 40: 20, 50: 30 }] });
    c.setScales({ start: dates[0], end: dates.at(-1), x: [[0, 1100]] });
    c.setViewMode(1);   // Y-max 99.8: the $0 pile runs off the top
    const data = c.buildData(dates[5], raws[5]);
    if (pinned) c.peakStore[c.peakKey(data)] = [dates[1], 40];
    await c.renderChart(data);
    const notes = element('chart').layout.annotations;
    assert.ok(notes.some(a => /^▲/.test(a.text)));
    assert.equal(notes.some(a => /^Pinned/.test(a.text)), pinned);
    return notes.find(a => a.xref === 'x' && a.yref === 'paper' && /<br>/.test(a.text));
  }
  assert.equal((await draw(50, false)).yshift, -27, '▲ alone: just below it (its label ends 23 px down)');
  assert.equal((await draw(50, true)).yshift, -48, 'pinned: below the pin\'s label and the ▲ under it');
  const right = await draw(1000, true);
  assert.equal(right.xanchor, 'right');
  assert.ok(!right.yshift, 'with the price over at the right the box is nowhere near them, and stays at the top');
});
