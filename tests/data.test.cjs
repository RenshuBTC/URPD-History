const test = require('node:test');
const assert = require('node:assert/strict');
const { app, deferred, flush, scripts } = require('./helpers.cjs');
const vm = require('node:vm');

test('every inline script parses', () => {
  for (const source of scripts) new vm.Script(source);
});

test('kernel preserves supply and USD at zero and upper boundaries', () => {
  const { c } = app();
  const raw = { 0: 50, 0.01: 1.23, 200: 4.56, 99999: 12.34, 100000: 56.78, 126198: 90.12 };
  const sums = { supply: Object.values(raw).reduce((a, b) => a + b, 0), invested: Object.entries(raw).reduce((s, [p, q]) => s + p * q, 0) };
  for (const bins of [50, 625, 1000]) for (const smooth of [0, 0.1, 0.3, 1]) {
    c.NUM_BINS = bins; c.KERNEL_PCT = smooth;
    const result = c.aggregate(raw, 126198 / bins);
    for (const [field, expected] of Object.entries(sums)) {
      const actual = result.reduce((s, b) => s + b[field], 0);
      assert.ok(Math.abs(actual - expected) <= expected * 1e-12, `${bins}/${smooth}/${field}`);
    }
  }
});

test('zero USD denominator is unavailable while BTC ratio remains valid', async () => {
  const { c, element } = app();
  c.allDates = ['2011-01-30']; c.priceArray = [0.46]; c.priceIndexByDate = { '2011-01-30': 0 };
  const data = c.buildData('2011-01-30', { all: { 0: 100 }, age: [{ 0: 100 }] });
  assert.equal(data.redPct, null); assert.equal(data.redPctCoin, 0);
  await c.renderChart(data);
  let text = element('chart').layout.annotations.map(a => a.text).join(' ');
  assert.match(text, /USD Value Last Moved In Profit: N\/A/);
  assert.doesNotMatch(text, /BOTTOM SIGNAL|NaN/);
  c.coinMode = true;
  await c.renderChart(data);
  text = element('chart').layout.annotations.map(a => a.text).join(' ');
  assert.match(text, /BTC Supply Last Moved In Profit: 100\.0%/);
  // No price for the day: no split at all. The shares come from one ladder of the recorded prices (priceLadder).
  const unpriced = c.buildData('2009-01-12', { all: { 10: 1 }, age: [{ 10: 1 }] });
  assert.deepEqual([unpriced.spot, unpriced.profitPct, unpriced.profitPctCoin, unpriced.redPct, unpriced.redPctCoin], [null, null, null, null, null]);
  const ladder = c.priceLadder({ 10: 1 });
  assert.deepEqual([c.shareAtOrBelow(ladder, 9.99, true), c.shareAtOrBelow(ladder, 10, true)], [0, 100], 'at or below the price');
  assert.equal(c.shareAtOrBelow(c.priceLadder({}), 10, false), null, 'nothing recorded: no share');
});

test('startup publishes dates only after price initialization settles', async () => {
  const { c } = app(); const price = deferred();
  c.fetchJSON = url => {
    if (url.endsWith('/first_height/day1')) return Promise.resolve([0, 0, 0]);   // 2009-01-03, genesis, the latest day
    if (url.endsWith('/price_close/day1')) return price.promise;
    if (url.endsWith('/date/day1')) return Promise.resolve(['2009-01-01', '2009-01-02', '2009-01-03']);
    return Promise.resolve({ 5: 2, 20: 1 });
  };
  const ready = c.init(); await flush();
  await c.loadAndRender();
  assert.equal(c.allDates.length, 0); assert.equal(Object.keys(c.cache).length, 0);
  price.resolve([1, 1, 10]); await ready;
  assert.equal(c.lastRenderedData.spot, 10);
  assert.ok(Math.abs(c.lastRenderedData.redPct - 200 / 3) < 1e-10);
});

test('the list of days left unanswered at first is asked once more before the page gives up; a 4xx is an answer', async () => {
  // 17 Nov 2026: the first request of a visit hung past the 15 s limit and the page was dead until reloaded.
  const run = async (failures) => {   // how the request for each day's first block fails, try by try
    const { c, element } = app(); let asked = 0;
    c.fetchJSON = url => {
      if (url.endsWith('/first_height/day1')) { const why = failures[asked++]; return why ? Promise.reject(new Error(why)) : Promise.resolve([0, 0, 0]); }
      if (url.endsWith('/price_close/day1')) return Promise.resolve([1, 1, 10]);
      if (url.endsWith('/date/day1')) return Promise.resolve(['2009-01-01', '2009-01-02', '2009-01-03']);
      return Promise.resolve(/\.json$/.test(url) ? null : { 5: 2, 20: 1 });
    };
    await c.init();
    return { asked, days: c.allDates.length, notice: element('status').style.display === 'block' ? element('status').textContent : '', T: c.T.en };
  };
  let r = await run(['Request timed out after 15 seconds']);
  assert.deepEqual([r.asked, r.days, r.notice], [2, 1, ''], 'timed out once: asked again, and the page starts');
  r = await run(['HTTP 503']);
  assert.deepEqual([r.asked, r.days, r.notice], [2, 1, ''], 'a server error once');
  r = await run(['Request timed out after 15 seconds', 'Failed to fetch']);
  assert.deepEqual([r.asked, r.days, r.notice], [2, 0, r.T.errBRK], 'twice: the page says it could not reach the API, and asks no third time');
  r = await run(['HTTP 404', 'never asked']);
  assert.deepEqual([r.asked, r.days, r.notice], [1, 0, r.T.errBRK], 'a 4xx is an answer');
});

test('UTC price fallback agrees with date indices across DST boundaries', () => {
  const oldTZ = process.env.TZ;
  try {
    for (const tz of ['Australia/Sydney', 'America/New_York', 'Asia/Singapore']) {
      process.env.TZ = tz;
      const { c } = app();
      for (const day of ['2009-01-03', '2026-03-08', '2026-07-01', '2026-11-01']) assert.equal(c.priceDateAt(c.dayIndex(day)), day, tz);
    }
  } finally { if (oldTZ === undefined) delete process.env.TZ; else process.env.TZ = oldTZ; }
});

test('request timeout covers a stalled body, aborts, and ignores late results', async () => {
  let signal; const body = deferred();
  const { c, timers, runTimer } = app({ fetch: async (url, options) => { signal = options.signal; return { ok: true, json: () => body.promise }; } });
  const pending = c.fetchJSON('/test');
  const rejection = assert.rejects(pending, /timed out/);
  await flush();
  runTimer([...timers.keys()][0]); await rejection;
  assert.equal(signal.aborted, true);
  body.resolve({ late: true }); await flush();
  assert.equal(timers.size, 0);
});

test('a failed cohort preserves successful and in-flight siblings for retry', async () => {
  const { c } = app(); const calls = []; const first = deferred(), slow = deferred();
  c.AGE_BANDS = [{ cohort: 'a', label: 'a' }, { cohort: 'b', label: 'b' }, { cohort: 'c', label: 'c' }];
  c.AGE_BAND_COLORS = ['a', 'b', 'c'];
  let attempts = 0;
  c.fetchJSON = url => {
    calls.push(url);
    if (url.includes('/a/')) return Promise.resolve({ 0: 50, 100: 2 });
    if (url.includes('/c/')) return slow.promise;
    return ++attempts === 1 ? first.promise : Promise.resolve({ 100: 4 });
  };
  const initial = c.fetchRaw('2026-09-19');
  const rejected = assert.rejects(initial, /HTTP 404/);
  first.reject(new Error('HTTP 404')); await rejected; await flush();
  const retry = c.fetchRaw('2026-09-19'); slow.resolve({ 200: 3 });
  const raw = await retry;
  assert.equal(calls.filter(u => u.includes('/a/')).length, 1);
  assert.equal(calls.filter(u => u.includes('/b/')).length, 2);
  assert.equal(calls.filter(u => u.includes('/c/')).length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(raw.all)), { 0: 50, 100: 6, 200: 3 });
  const data = c.buildData('2026-09-19', raw);
  for (const field of ['supply', 'invested']) for (let i = 0; i < data.aggAll.length; i++) {
    const sum = data.aggAge.reduce((s, b) => s + b.agg[i][field], 0);
    assert.ok(Math.abs(sum - data.aggAll[i][field]) < 1e-9);
  }
});

test('one request left unanswered while the day\'s others were answered is asked once more; not when none was, nor after a 4xx', async () => {
  // 14 Nov 2026: one of a day's 23 requests hung past the 15 s limit and the whole day was an error to retry by hand.
  const three = () => { const { c } = app(); c.AGE_BANDS = [{ cohort: 'a', label: 'a' }, { cohort: 'b', label: 'b' }, { cohort: 'c', label: 'c' }]; c.AGE_BAND_COLORS = ['a', 'b', 'c']; return c; };
  const asked = (calls, band) => calls.filter(u => u.includes('/' + band + '/')).length;
  // b hangs while a and c answer: b is asked again, and the day loads.
  let c = three(), calls = [], stall = deferred();
  c.fetchJSON = url => { calls.push(url); if (!url.includes('/b/')) return Promise.resolve(url.includes('/a/') ? { 100: 2 } : { 200: 3 }); return asked(calls, 'b') === 1 ? stall.promise : Promise.resolve({ 100: 4 }); };
  let loading = c.fetchRaw('2026-09-19'); await flush();
  stall.reject(new Error('The request timed out after 15 s'));
  assert.deepEqual(JSON.parse(JSON.stringify((await loading).all)), { 100: 6, 200: 3 });
  assert.deepEqual([asked(calls, 'a'), asked(calls, 'b'), asked(calls, 'c')], [1, 2, 1], 'b alone, once more');
  // b fails the second time too: the day is an error, after two tries and no third.
  c = three(); calls = []; stall = deferred();
  c.fetchJSON = url => { calls.push(url); if (!url.includes('/b/')) return Promise.resolve({ 100: 1 }); return asked(calls, 'b') === 1 ? stall.promise : Promise.reject(new Error('HTTP 502')); };
  loading = c.fetchRaw('2026-09-19'); await flush();
  let rejected = assert.rejects(loading, /HTTP 502/);
  stall.reject(new Error('Failed to fetch')); await rejected; await flush();
  assert.equal(asked(calls, 'b'), 2);
  // No request answered (the API is down): none is asked again, so the notice is not kept waiting twice as long.
  c = three(); calls = []; const down = [deferred(), deferred(), deferred()];
  c.fetchJSON = url => { calls.push(url); return down[calls.length - 1].promise; };
  loading = c.fetchRaw('2026-09-19'); await flush();
  rejected = assert.rejects(loading, /timed out/);
  down.forEach(d => d.reject(new Error('The request timed out after 15 s'))); await rejected; await flush();
  assert.equal(calls.length, 3, 'each asked once');
  // A 4xx is an answer (a block not published yet is a 404): not asked again, whatever the others did.
  c = three(); calls = []; stall = deferred();
  c.fetchJSON = url => { calls.push(url); return url.includes('/b/') ? stall.promise : Promise.resolve({ 100: 1 }); };
  loading = c.fetchRaw('2026-09-19'); await flush();
  rejected = assert.rejects(loading, /HTTP 404/);
  stall.reject(new Error('HTTP 404')); await rejected; await flush();
  assert.equal(asked(calls, 'b'), 1);
});

test('cached loads await drawing and propagate draw errors to the caller', async () => {
  const { c } = app(); const render = deferred();
  c.allDates = ['2026-09-19']; c.currentIdx = 0;
  c.cache[c.dataKey(c.allDates[0])] = { dateStr: c.allDates[0] };
  c.renderChart = () => render.promise;
  let settled = false;
  const load = c.loadAndRender(true).finally(() => { settled = true; });
  const rejected = assert.rejects(load, /draw failed/);
  await flush(); assert.equal(settled, false);
  render.reject(new Error('draw failed')); await rejected;
  assert.equal(c.lastRenderedData, null);
});

test('render queue skips obsolete draws and only publishes completed data', async () => {
  const { c } = app(); const first = deferred(), calls = [];
  c.drawChart = (data) => { calls.push(data.dateStr); return first.promise; };
  const a = c.renderChart({ dateStr: 'A' }), b = c.renderChart({ dateStr: 'B' });
  await flush(); assert.deepEqual(calls, ['B']);
  first.resolve(); await Promise.all([a, b]);
  assert.equal(c.lastRenderedData, null);
});

test('smoothing and mode toggles coalesce rapid changes', async () => {
  const { c, element, timers, runTimer } = app(); let draws = 0;
  c.loadAndRender = () => { draws++; return Promise.resolve(); };
  for (const value of ['0.1', '0.12', '0.5']) element('smoothInput').emit('input', { target: { value } });
  assert.equal(c.KERNEL_PCT, 0.24); assert.equal(timers.size, 1);
  runTimer([...timers.keys()][0]); assert.equal(c.KERNEL_PCT, 0.5); assert.equal(draws, 1);
  c.setViewMode(1); c.setViewMode(0); c.setViewMode(1);
  assert.equal(draws, 1); assert.equal(timers.size, 1);
  runTimer([...timers.keys()][0]); assert.equal(draws, 2); assert.equal(c.coinMode, true);
});

test('BTC/USD overlay is linear from $0 to the highest close shown so far, and only grows moving forward', async () => {
  const { c, element } = app();
  const dates = [], prices = [];
  for (let i = 0; i < 800; i++) {
    dates.push(new Date(Date.UTC(2020, 0, 1) + i * 864e5).toISOString().slice(0, 10));
    prices.push(i < 400 ? 1000 * (1 + i / 100) : 5000 - (i - 400) * 5);   // rally to 5000, then a long decline
  }
  c.allDates = dates; c.priceArray = prices; c.priceIndexByDate = Object.fromEntries(dates.map((d, i) => [d, i]));
  const tops = [];
  for (const i of [100, 300, 500, 700]) {
    await c.renderChart(c.buildData(dates[i], { all: { 1000: 1 }, age: [{ 1000: 1 }] }));
    const y3 = element('chart').layout.yaxis3;
    assert.equal(y3.type, 'linear'); assert.equal(y3.autorange, false); assert.equal(y3.range[0], 0);
    const right = Math.min(dates.length - 1, i + 91);                          // window edge (+90 days) plus one day
    assert.equal(y3.range[1], Math.max(...prices.slice(0, right + 1)), 'top = highest close shown so far');
    tops.push(y3.range[1]);
  }
  for (let k = 1; k < tops.length; k++) assert.ok(tops[k] >= tops[k - 1], 'the axis never shrinks when moving forward');
});

test("the days with a URPD and the width of a price stamp follow Bitcoin Research Kit's API", () => {
  const { c } = app();
  const list = (v) => JSON.parse(JSON.stringify(v));
  // BRK's own day1 series from 2009-01-01 (first block heights 0, 0, 0, 1, ..., 1, 15, 76): blocks on the genesis day
  // and from 2009-01-09, and none on the days between, which the API answers 404.
  const dates = ['2009-01-01', '2009-01-02', '2009-01-03', '2009-01-04', '2009-01-05', '2009-01-06', '2009-01-07',
    '2009-01-08', '2009-01-09', '2009-01-10', '2009-01-11'];
  const heights = [0, 0, 0, 1, 1, 1, 1, 1, 1, 15, 76];
  assert.deepEqual(list(c.blockDays(dates, heights)), ['2009-01-03', '2009-01-09', '2009-01-10', '2009-01-11'], 'the latest day with its blocks so far');
  // One series a day ahead of the other (a request either side of midnight UTC): read as far as both go.
  assert.deepEqual(list(c.blockDays(dates.slice(0, 10), heights)), ['2009-01-03', '2009-01-09', '2009-01-10']);
  assert.deepEqual(list(c.blockDays(dates, heights.slice(0, 10))), ['2009-01-03', '2009-01-09', '2009-01-10']);
  assert.throws(() => c.blockDays(null, heights), { message: c.T.en.errDates });
  // Each stamp is its block's price to four significant figures in cents: the half step either side is what
  // smoothing spreads it over.
  for (const [price, step] of [[0.05, 0.01], [99.99, 0.01], [100, 0.1], [999.9, 0.1], [1000, 1], [9999, 1], [34250, 10],
    [99990, 10], [125700, 100], [999900, 100], [2e6, 1000]]) assert.equal(c.stampStep(price), step, String(price));
});
