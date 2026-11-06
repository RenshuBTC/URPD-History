// 1B: stepping one block at a time (see "One block" in index.html).
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { app, flush, html, scripts } = require('./helpers.cjs');

// Three listed days, the last the day in progress, and the first block of each.
const DAYS = ['2026-11-04', '2026-11-05', '2026-11-06'];
const FIRST = [974600, 974650, 974733];
const DAY_T = d => Date.parse(d + 'T00:00:00Z') / 1000;
const dayOf = h => FIRST.filter(f => f <= h).length - 1;
// A price and a header time for every block: each day's blocks ten minutes apart from a minute past midnight.
const price = h => 75000 + (h - 974600);
const blockTime = h => DAY_T(DAYS[dayOf(h)]) + 60 + (h - FIRST[dayOf(h)]) * 600;
const iso = s => new Date(s * 1000).toISOString().slice(0, 19).replace('T', ' ');
// A block's time as the title gives it: the viewer's date and time, and their time zone as the browser names it.
function localTime(s, locale) {
  const d = new Date(s * 1000), zone = new Intl.DateTimeFormat(locale, { timeZoneName: 'short' }).formatToParts(d).find(p => p.type === 'timeZoneName').value;
  return d.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
    String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + zone;
}

// One age band's URPD as the API sends it, at one block.
function answer(cohort, height, amounts) {
  const prices = Object.keys(amounts).map(Number).sort((a, b) => a - b);
  return { height, hash: '', date: DAYS[dayOf(height)], cohort, weight: 'none', aggregation: 'raw', close: price(height),
    supply: prices.reduce((s, p) => s + amounts[p], 0),
    buckets: { price: prices, supply: prices.map(p => amounts[p]), realized_cap: prices.map(p => p * amounts[p]), unrealized_pnl: prices.map(() => 0) } };
}
// The page on 2026-11-05, with an API that has every block up to `tip` (the newest, on the day in progress): a date is
// served as its last block, a height as that block, a block past the newest as a 404. `answerFor` can answer first.
function chain(options = {}) {
  const h = app(), { c } = h, urls = [];
  const state = { tip: options.tip || 974783 };
  const lastOf = date => { const i = DAYS.indexOf(date); return i + 1 < DAYS.length ? FIRST[i + 1] - 1 : state.tip; };
  c.allDates = DAYS.slice(); c.dayFirstHeight = FIRST.slice();
  c.priceDates = DAYS.slice(); c.priceIndexByDate = Object.fromEntries(DAYS.map((d, i) => [d, i]));
  c.priceArray = DAYS.map(d => price(lastOf(d)));
  c.currentIdx = 1;
  c.fetchJSON = url => {
    urls.push(url);
    if (options.answerFor) { const r = options.answerFor(url, state); if (r !== undefined) return r; }
    if (url === 'https://bitview.space/api/blocks/tip/height') return Promise.resolve(state.tip);
    let m = url.match(/\/api\/series\/timestamp\/height\?start=(\d+)&end=(\d+)$/);
    if (m) return Promise.resolve({ data: [blockTime(+m[1])] });
    m = url.match(/\/api\/urpd\/(\w+)\/([\w-]+)$/);
    if (!m) return Promise.reject(new Error('unexpected ' + url));
    const height = /^\d+$/.test(m[2]) ? +m[2] : lastOf(m[2]);
    if (height > state.tip) return Promise.reject(new Error('HTTP 404'));
    return Promise.resolve(answer(m[1], height, m[1] === 'age_under_1h' ? { [price(height)]: 1 } : { 30000: 2, 60000: 3 }));
  };
  // Every navigation loads at once, as after a pause (the coalescer is navigation.test.cjs's).
  const settle = async () => { for (let i = 0; i < 6; i++) await flush(); };
  const stepTo = async (dir) => { c.navLast = 0; c.step(dir); await settle(); };
  return Object.assign(h, { urls, state, settle, stepTo });
}

test('the step sizes are 1B, 1D, 1W, 1M and 1Y in that order, 1D to start with, and 1 to 5 pick them in the same order', () => {
  const bar = html.match(/<div id="intervalBar">([\s\S]*?)<\/div>/)[1];
  const buttons = [...bar.matchAll(/<button class="iv( active)?" data-idx="(\d)" aria-pressed="(true|false)" title="([^"]+)">([^<]+)<\/button>/g)];
  assert.deepEqual(buttons.map(b => b[5]), ['1B', '1D', '1W', '1M', '1Y']);
  assert.deepEqual(buttons.map(b => +b[2]), [0, 1, 2, 3, 4]);
  assert.deepEqual(buttons.map(b => [!!b[1], b[3]]), [[false, 'false'], [true, 'true'], [false, 'false'], [false, 'false'], [false, 'false']]);
  assert.match(buttons[0][4], /^1B: one block at a time/);
  const { c, docListeners } = app();
  assert.equal(c.stepIdx, 1, '1D');
  assert.equal(c.STEP_SIZES, 5);
  const press = key => docListeners.keydown[0]({ key, target: { tagName: 'BODY' }, preventDefault() {} });
  ['1', '2', '3', '4', '5'].forEach((k, i) => { press(k); assert.equal(c.stepIdx, i, k); });
  for (const l of ['en', 'zh', 'ja']) for (const k of ['stepB', 'stepD', 'stepW', 'stepM', 'stepY', 'blockWord']) assert.ok(c.T[l][k], l + '.' + k);
});

test('1B steps one block from the day shown, asking each age band for that block by height, and draws it as that block', async () => {
  const h = chain(), { c, element, urls } = h;
  await c.loadAndRender(); await h.settle();
  assert.deepEqual([c.lastRenderedData.key, c.lastRenderedData.height, c.lastRenderedData.isBlock], ['2026-11-05', 974732, false], 'a day is its last block');
  assert.equal(element('dateDisplay').textContent, '2/3');
  c.setInterval1(0);
  urls.length = 0;
  await h.stepTo(-1);
  const asked = urls.filter(u => u.includes('/api/urpd/'));
  assert.equal(asked.length, 23, 'the 23 age bands');
  assert.ok(asked.every(u => /\/api\/urpd\/age_\w+\/974731$/.test(u)), 'by height');
  assert.ok(urls.includes('https://bitview.space/api/series/timestamp/height?start=974731&end=974732'), 'and its time');
  const d = c.lastRenderedData;
  assert.deepEqual([d.key, d.isBlock, d.height, d.dateStr, d.spot, d.time], ['h974731', true, 974731, '2026-11-05', price(974731), blockTime(974731)]);
  assert.deepEqual([c.viewHeight, c.currentIdx], [974731, 1], 'on its day');
  assert.equal(element('dateDisplay').textContent, '#974,731');
  assert.ok(element('chart').layout.title.text.includes('as of Block 974,731 (' + localTime(blockTime(974731), 'en-GB') + ')'), 'its time where the viewer is');
  // The dashed line is the block's own price, and the dot sits as far into the day as the block is: between the day
  // before's point on the line and its own day's.
  const dot = element('chart').data.find(tr => tr.marker && tr.marker.color === '#ff8c00');
  assert.deepEqual([dot.x[0], dot.y[0]], [iso(blockTime(974731) - 86400), price(974731)]);
  assert.ok(dot.x[0] > '2026-11-04' && dot.x[0] < '2026-11-05');
  // Forward: the day's last block, then the next day's first.
  await h.stepTo(1);
  assert.deepEqual([c.lastRenderedData.key, c.currentIdx], ['h974732', 1]);
  await h.stepTo(1);
  assert.deepEqual([c.lastRenderedData.key, c.lastRenderedData.dateStr, c.currentIdx], ['h974733', '2026-11-06', 2], 'onto the next day');
  // Bins and smoothing re-bin the block in view, from what was fetched for it.
  urls.length = 0;
  c.applyBins(400); await h.settle();
  assert.deepEqual([c.lastRenderedData.key, c.lastRenderedData.numBins, urls.length], ['h974733', 400, 0]);
});

test('from a block, 1D goes forward to the end of its day and back to the end of the day before; Home, End and the dot go to days', async () => {
  const h = chain(), { c } = h;
  await c.loadAndRender(); await h.settle();
  c.navLast = 0; c.goToBlock(974700); await h.settle();
  assert.equal(c.lastRenderedData.key, 'h974700');
  c.setInterval1(1);
  await h.stepTo(1);
  assert.deepEqual([c.lastRenderedData.key, c.viewHeight], ['2026-11-05', null], 'the end of its own day comes first');
  c.navLast = 0; c.goToBlock(974700); await h.settle();
  await h.stepTo(-1);
  assert.equal(c.lastRenderedData.key, '2026-11-04');
  c.navLast = 0; c.goToBlock(974700); await h.settle();
  await h.stepTo(1); await h.stepTo(1);
  assert.equal(c.lastRenderedData.key, '2026-11-06', 'then on by days');
  c.navLast = 0; c.goToBlock(974650); await h.settle();
  c.navLast = 0; c.goTo(c.allDates.length - 1); await h.settle();
  assert.deepEqual([c.lastRenderedData.key, c.viewHeight], ['2026-11-06', null]);
});

test('a block answer that names another block is refused, and the chart stays where it was', async () => {
  const h = chain({ answerFor: url => /\/974731$/.test(url) ? Promise.resolve(answer('age_under_1h', 974730, { 1: 1 })) : undefined });
  const { c, element } = h;
  await c.loadAndRender(); await h.settle();
  c.setInterval1(0);
  await h.stepTo(-1);
  assert.deepEqual([c.lastRenderedData.key, c.viewHeight, c.currentIdx], ['2026-11-05', null, 1]);
  assert.equal(element('status').textContent, 'Error: Unexpected cost-basis data from the API');
});

test('a block answer must name its block and a day', () => {
  const { c } = app();
  const ok = { height: 974731, date: '2026-11-05', buckets: { price: [1, 2], supply: [3, 4] } };
  assert.deepEqual(JSON.parse(JSON.stringify(c.cleanUrpdAt(ok, 'h974731'))), { 1: 3, 2: 4 });
  for (const bad of [{ ...ok, height: 974730 }, { ...ok, height: '974731' }, { ...ok, date: '2026-11-5' }, { ...ok, date: undefined }, null, 'x'])
    assert.throws(() => c.cleanUrpdAt(bad, 'h974731'), /Unexpected cost-basis data/);
  assert.deepEqual([c.keyHeight('h974731'), c.keyHeight('2026-11-05'), c.keyHeight('h-1'), c.keyHeight('h1e3'), c.keyHeight('h')], [974731, null, null, null, null]);
  assert.equal(c.urpdUrl('age_under_1h', 'h974731'), 'https://bitview.space/api/urpd/age_under_1h/974731');
  assert.equal(c.urpdUrl('age_under_1h', '2026-11-05'), 'https://bitview.space/api/urpd/age_under_1h/2026-11-05');
  assert.deepEqual(JSON.parse(JSON.stringify(c.urpdMeta({ height: 5, date: '2026-11-05', close: -1 }))), { height: 5, date: '2026-11-05', close: null });
  assert.equal(c.isBlockTime(1793936160), true);
  for (const bad of [1793936160.5, '1793936160', 0, -1, 5e9, NaN]) assert.equal(c.isBlockTime(bad), false, String(bad));
});

test('past the newest block a step asks only for the newest block and says nothing, and reaches the next one once it is published', async () => {
  const h = chain(), { c, element, urls } = h;
  c.currentIdx = 2;
  await c.loadAndRender(); await h.settle();
  assert.deepEqual([c.lastRenderedData.key, c.lastRenderedData.height, c.newestHeight], ['2026-11-06', 974783, 974783], 'the newest block seen');
  c.setInterval1(0);
  urls.length = 0;
  await h.stepTo(1);
  assert.deepEqual(urls, ['https://bitview.space/api/blocks/tip/height'], 'one small request, not 23 for a block that is not there');
  assert.equal(element('status').textContent, '', 'no message');
  assert.deepEqual([c.lastRenderedData.key, c.viewHeight, c.currentIdx], ['2026-11-06', null, 2], 'and the chart stays where it was');
  // Once the block is published, the same step reaches it.
  h.state.tip = 974784;
  await h.stepTo(1);
  assert.deepEqual([c.lastRenderedData.key, c.lastRenderedData.dateStr, c.newestHeight], ['h974784', '2026-11-06', 974784]);
  // Without a newest block known, the block is asked for, and its 404 is met with silence too.
  c.newestHeight = null; urls.length = 0;
  await h.stepTo(1);
  assert.equal(urls.filter(u => /\/api\/urpd\/age_\w+\/974785$/.test(u)).length, 23);
  assert.deepEqual([element('status').textContent, c.lastRenderedData.key, c.viewHeight], ['', 'h974784', 974784]);
});

test('the day in progress is drawn from one block, even when a block comes in while its age bands are fetched', async () => {
  let served = 0;
  const h = chain({ answerFor: (url, state) => {
    if (!url.endsWith('/2026-11-06')) return undefined;
    // The tenth age band asked for is the first to see the new block.
    if (++served === 10) state.tip = 974784;
    return undefined;
  } });
  const { c, urls } = h;
  c.currentIdx = 2;
  await c.loadAndRender(); await h.settle();
  const again = urls.filter(u => /\/api\/urpd\/age_\w+\/974784$/.test(u));
  assert.equal(again.length, 9, 'the nine bands that came back from the block before are asked for at the new one');
  assert.equal(c.lastRenderedData.height, 974784);
  const raw = c.rawCache['2026-11-06'];
  assert.ok(raw.metas.every(m => m.height === 974784), 'every band of one block');
  assert.deepEqual(JSON.parse(JSON.stringify(raw.meta)), { height: 974784, date: '2026-11-06', close: price(974784), time: null });
});

test("a block's price axis is the day before's, grown by the block's own data, and at a day's last block it is the day's own", () => {
  const { c } = chain();
  // With the axis history.
  c.setScales({ start: '2026-11-03', end: '2026-11-05', x: [[0, 100000], [2, 126000]] });
  assert.equal(c.blockAxisEnd('2026-11-05', 1000, 75000), 100000, 'the day before, while the block reaches less far');
  assert.equal(c.blockAxisEnd('2026-11-05', 126000, 75000), c.xAxisEnd('2026-11-05', 126000, 75000), 'its own day at the day\'s last block');
  assert.equal(c.blockAxisEnd('2026-11-05', 1000, 110000), 110000 * 1.001, 'or the block\'s own price, a little past it');
  // Never past the day's own end (the history's stamps were rounded as the API rounded them then), and at the day's
  // last block exactly that, so a day and its last block are drawn on one axis.
  assert.equal(c.blockAxisEnd('2026-11-05', 130000, 75000, 974700), 126000);
  assert.equal(c.blockAxisEnd('2026-11-05', 120000, 75000, 974732), 126000);
  assert.equal(c.blockAxisEnd('2026-11-05', 1000, 75000, 974700), 100000);
  // Without it, the day before's closes so far.
  c.setScales(null);
  const before = Math.max(...c.priceArray.slice(0, 1)) * 1.001;
  assert.equal(c.blockAxisEnd('2026-11-05', 1000, 75000), before);
  assert.equal(c.blockAxisEnd('2026-11-05', 130000, c.priceArray[1]), c.xAxisEnd('2026-11-05', 130000, c.priceArray[1]));
  assert.equal(c.blockAxisEnd('2026-11-04', 0, null), 1, 'never below $1, the first day included');
});

test('with 1B the next blocks are fetched ahead, back from a day and then the way they are walked', async () => {
  const h = chain(), { c, timers } = h;
  const main = scripts.find(s => s.includes('var BASE ='));
  const a = main.indexOf('var PREFETCH_AHEAD = 2;'), b = main.indexOf('function loadAndRender(');
  vm.runInContext(main.slice(a, b), c);
  await c.loadAndRender(); await h.settle();
  const fetched = [];
  c.fetchRaw = k => { fetched.push(k); return Promise.resolve({}); };
  c.setInterval1(0);
  const prefetchTimer = () => [...timers].filter(([, t]) => t.ms === 250).map(([id]) => id).at(-1);
  c.schedulePrefetch(); h.runTimer(prefetchTimer()); await flush();
  assert.deepEqual(fetched, ['h974731', 'h974730'], 'back from the day\'s last block');
  c.newestHeight = 974783; c.viewHeight = 974740; fetched.length = 0;   // as if the newest day had been seen
  c.schedulePrefetch(); h.runTimer(prefetchTimer()); await flush();
  assert.deepEqual(fetched, ['h974741', 'h974742'], 'walked forward');
  // Never past the newest block an answer has been of.
  c.newestHeight = 974744; c.viewHeight = 974743; fetched.length = 0;
  c.schedulePrefetch(); h.runTimer(prefetchTimer()); await flush();
  assert.deepEqual(fetched, ['h974744']);
});

test('the day list knows the first block of each listed day, and which day a block is on', () => {
  const { c } = app();
  const dates = ['2009-01-01', '2009-01-02', '2009-01-03', '2009-01-04', '2009-01-09'], heights = [0, 0, 0, 1, 1];
  // 2009-01-03 has the genesis block; no block until 2009-01-09, the day in progress.
  c.allDates = c.blockDays(dates, heights);
  assert.deepEqual([...c.allDates], ['2009-01-03', '2009-01-09']);
  c.dayFirstHeight = c.listedFirstHeights(c.allDates, dates, heights);
  assert.deepEqual([...c.dayFirstHeight], [0, 1]);
  assert.deepEqual([c.heightDayIdx(0), c.heightDayIdx(1), c.heightDayIdx(99), c.heightDayIdx(-1)], [0, 1, 1, -1]);
  assert.deepEqual([c.dayLastHeight(0), c.dayLastHeight(1)], [0, null], 'the day in progress has no last block yet');
});

test("a block's time is given where the viewer is: their own date, time and time zone", () => {
  const { c } = app();
  const was = process.env.TZ, t = 1793955297;   // 2026-11-06 08:54:57 UTC
  const title = (tz, lang) => { process.env.TZ = tz; c.lang = lang; return c.blockTitle({ height: 974784, time: t }, ''); };
  try {
    assert.equal(title('Asia/Singapore', 'en'), 'Block 974,784 (06 Nov 2026 16:54 GMT+8)');
    assert.equal(title('America/New_York', 'en'), 'Block 974,784 (06 Nov 2026 03:54 GMT-5)');
    assert.equal(title('Europe/London', 'en'), 'Block 974,784 (06 Nov 2026 08:54 GMT)');
    assert.equal(title('Pacific/Auckland', 'en'), 'Block 974,784 (06 Nov 2026 21:54 GMT+13)');
    assert.equal(title('America/Los_Angeles', 'en'), 'Block 974,784 (06 Nov 2026 00:54 GMT-8)');
    assert.equal(title('Pacific/Honolulu', 'en'), 'Block 974,784 (05 Nov 2026 22:54 GMT-10)', 'the viewer\'s own date, too');
    assert.equal(title('Asia/Singapore', 'zh'), '\u533a\u5757 974,784\uff082026\u5e7411\u670806\u65e5 16:54 GMT+8\uff09');
    assert.equal(title('Asia/Tokyo', 'ja'), '\u30d6\u30ed\u30c3\u30af 974,784\uff082026\u5e7411\u670806\u65e5 17:54 JST\uff09');
    assert.equal(c.blockTitle({ height: 974784, time: null }, '06 Nov 2026'), '\u30d6\u30ed\u30c3\u30af 974,784\uff0806 Nov 2026\uff09', 'no time: the day alone');
  } finally {
    if (was === undefined) delete process.env.TZ; else process.env.TZ = was;
    c.lang = 'en';
  }
});
