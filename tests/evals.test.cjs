// The evaluators in evals/checks.mjs, checked against labelled examples (evals/fixtures/labelled.json): real traces of
// the site that review found good, and the same traces altered to reproduce each failure seen before (the regression
// history and the two error analyses, see evals/README.md). Every check has to pass every good example it applies to
// (true negative rate 1) and fail every example made for it (true positive rate 1), so a check that misses its
// failure, or cries wolf on a good chart, fails here before it can mislead a run.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'evals', 'fixtures', 'labelled.json'), 'utf8'));
const load = () => import(path.join(__dirname, '..', 'evals', 'checks.mjs'));
// BRK's own figures as the run that drew the traces read them: by day, by block, each block's day and each day's last block.
const ctx = {
  ref: (name, day) => (fixture.refs[day] || {})[name] ?? null,
  refAt: (name, h) => (fixture.blocks[h] || {})[name] ?? null,
  dayOf: (h) => fixture.blockDays[h] ?? null,
  lastHeight: (day) => fixture.lastHeights[day] ?? null,
  inProgress: fixture.inProgress,
};
const copy = (v) => JSON.parse(JSON.stringify(v));
const good = (pred) => { const t = fixture.good.find(typeof pred === 'string' ? (x) => x.id === pred : pred); assert.ok(t, 'a labelled trace for this example'); return copy(t); };
const stepped = (t) => Array.isArray(t.steps) && t.steps.length > 0;
// A settled day, and a block, as a visitor on a desktop reading English sees them, with nothing marked and no button pressed.
const aDay = (t) => !t.facts.block && !stepped(t) && t.facts.spot > 0 && t.facts.date !== fixture.inProgress && !t.facts.mark && t.window === 'desktop' && t.lang === 'en';
const aBlock = (t) => !!t.facts.block && !stepped(t) && t.facts.spot > 0 && !t.facts.mark && t.window === 'desktop' && t.lang === 'en';
const NEW_YORK = 't130';   // block 840,000 as New York's clock has it: 19 Apr 2024 20:09 GMT-4
const priceBox = (t) => t.facts.annotations.find((x) => /Price:/.test(x.text) && !x.width);
const markBox = (t) => t.facts.annotations.find((x) => x.xref === 'x' && x.width);
const last = (t) => t.stepped[t.stepped.length - 1];
function markText(t, text) { markBox(t).text = text; }
function emptyNote(t) { return t.facts.annotations.some((a) => a.xref === 'paper' && a.yref === 'paper' && a.x === 0.5 && a.y === 0.62); }

// Each failure made from a good trace: which check must catch it, what it reproduces, how.
const FAILURES = [
  ['draws', '#191: the API changed and no day loaded', () => { const t = good(aDay); t.facts.notice = 'Could not reach bitview.space. Check your connection and try again.'; return t; }],
  ['draws', 'a script error while drawing', () => { const t = good(aDay); t.events = ['page error: TypeError: Cannot read properties of undefined']; return t; }],
  ['draws', 'the list of days did not load', () => { const t = good(aDay); t.events = ['request failed: https://bitview.space/api/series/first_height/day1 net::ERR_CONNECTION_RESET']; return t; }],
  ['draws', 'a day that never drew', () => { const t = good(aDay); delete t.facts; t.error = 'the page gave up: Could not reach bitview.space. Check your connection and try again.'; return t; }],
  ['draws', 'the loading sign left up over a block', () => { const t = good(aBlock); t.facts.loading = true; return t; }],

  ['right-day', '#6: the price two days behind', () => { const t = good(aDay); t.facts.spot = t.facts.spot * 1.03; return t; }],
  ['right-day', '#4: a one-day shift in the title', () => { const t = good(aDay); t.facts.title = t.facts.title.replace(/\d\d (\w+ \d{4})$/, (m, rest) => String(Number(m.slice(0, 2)) % 28 + 1).padStart(2, '0') + ' ' + rest); return t; }],
  ['right-day', 'the counter on another day', () => { const t = good(aDay); t.facts.counter = (t.facts.dayNumber - 1) + '/' + t.facts.days; return t; }],
  ['right-day', 'another day than the one asked for', () => { const t = good((x) => aDay(x) && x.asked && x.asked.date); t.asked.date = '2013-04-10'; return t; }],
  ['right-day', 'a whole day where a block was asked for', () => { const t = good(aDay); t.asked = { date: null, height: 840000 }; return t; }],

  ['right-block', '#199: another block than the one asked for', () => { const t = good(aBlock); t.asked.height = t.facts.block.height + 1; return t; }],
  ['right-block', 'a block where a day was asked for', () => { const t = good(aBlock); t.asked = { date: t.facts.date, height: null }; return t; }],
  ['right-block', 'the title names the block before', () => { const t = good(NEW_YORK); t.facts.title = t.facts.title.replace('840,000', '839,999'); return t; }],
  ['right-block', 'the counter on the block before', () => { const t = good(NEW_YORK); t.facts.counter = '#839,999'; return t; }],
  ['right-block', 'the title names no block at all', () => { const t = good(NEW_YORK); t.facts.title = 'Bitcoin URPD (% USD, AGE) as of 20 Apr 2024'; return t; }],
  ['right-block', 'the time of another block', () => { const t = good(NEW_YORK); t.facts.block.time += 600; return t; }],
  ['right-block', '#200: the block\'s time on the UTC clock for a visitor in New York', () => { const t = good(NEW_YORK); t.facts.title = t.facts.title.replace('19 Apr 2024 20:09 GMT-4', '20 Apr 2024 00:09 UTC'); return t; }],
  ['right-block', 'the right clock under another zone\'s name', () => { const t = good(NEW_YORK); t.facts.title = t.facts.title.replace('GMT-4', 'GMT+8'); return t; }],
  ['right-block', 'a time with no zone named', () => { const t = good(NEW_YORK); t.facts.title = t.facts.title.replace(' GMT-4', ''); return t; }],
  ['right-block', 'a minute out', () => { const t = good(NEW_YORK); t.facts.title = t.facts.title.replace('20:09', '20:10'); return t; }],
  ['right-block', 'the block put on the day before its own', () => { const t = good(NEW_YORK); t.facts.date = '2024-04-19'; return t; }],
  ['right-block', 'the day\'s close in place of the block\'s own price', () => { const t = good(NEW_YORK); t.facts.spot = fixture.refs['2024-04-20'].price_close; return t; }],

  ['supply', '#99: an age band lost on the way in', () => { const t = good(aDay); t.facts.raw.supply -= 1000; return t; }],
  ['supply', 'a block drawn with the whole day\'s coins', () => { const t = good(NEW_YORK); t.facts.raw.supply = fixture.refs['2024-04-20'].circulating_supply; return t; }],
  ['realized-cap', 'prices read with the wrong rounding', () => { const t = good(aDay); t.facts.raw.value *= 1.01; return t; }],
  ['realized-cap', 'prices read with the wrong rounding, on a block', () => { const t = good(aBlock); t.facts.raw.value *= 0.99; return t; }],
  ['holders', 'the 150-day line one band off', () => { const t = good(aDay); t.facts.raw.sth += 50000; t.facts.raw.lth -= 50000; return t; }],
  ['holders', 'the 150-day line one band off, on a block', () => { const t = good(aBlock); t.facts.raw.sth += 50000; t.facts.raw.lth -= 50000; return t; }],
  ['in-profit', '#144: the box 2.2 points off the recorded prices', () => { const t = good(aDay); t.facts.profitPctCoin += 2.2; return t; }],
  ['in-profit', 'the box a twentieth of a point off them', () => { const t = good(aBlock); t.facts.profitPctCoin -= 0.05; return t; }],
  ['in-profit', 'the recorded prices hold coins BRK does not count in profit', () => { const t = good(aDay); for (const k of ['rule', 'lo', 'hi']) t.facts.inProfit[k] -= 1.5; t.facts.profitPctCoin -= 1.5; return t; }],
  ['bars-total', 'bars past the axis dropped', () => { const t = good(aDay); t.facts.bars.forEach((b) => { b.sum *= 0.97; }); return t; }],

  ['labels-clear', '#24: the price box off the plot', () => { const t = good(aDay); const a = priceBox(t); a.box = [a.box[0] + t.facts.page.innerWidth, a.box[1], a.box[2] + t.facts.page.innerWidth, a.box[3]]; return t; }],
  ['labels-clear', '#174: a box over the price box', () => { const t = good(aDay); const a = priceBox(t); t.facts.annotations.push({ text: 'Price: $1 – $2 | All LTH Within: 3 Days', xref: 'x', yref: 'paper', width: 100, box: [a.box[0] + 5, a.box[1] + 5, a.box[2], a.box[3]] }); return t; }],
  ['labels-clear', '#39: a label on the legend', () => { const t = good(aDay); const a = priceBox(t); a.box = [t.facts.legend[0], t.facts.legend[1], t.facts.legend[0] + 50, t.facts.legend[1] + 20]; return t; }],
  // The second error analysis. Each is the good trace put back the way the live site drew it before the fix.
  ['labels-clear', '7 and 12 Nov 2026: a marked range\'s box over a cycle top\'s label', () => { const t = good('t118'); const label = t.facts.annotations.find((x) => x.text === 'Cycle 5 Top'), b = markBox(t).box; b[3] -= b[1] - 121.5; b[1] = 121.5; assert.ok(label.box[3] > 121.5); return t; }],
  ['labels-clear', '20 Jan 2022: the dot on the price line over a marked range\'s box', () => { const t = good('t123'); const b = markBox(t).box, d = t.facts.tracer; b[3] -= b[1] - (d[1] - 40); b[1] = d[1] - 40; return t; }],
  ['labels-clear', '20 Apr 2024 on a phone: the dot over the price box\'s last line', () => { const t = good('t093'); const b = priceBox(t).box, d = t.facts.tracer; const h = b[3] - b[1]; b[3] = d[1] + 0.7; b[1] = b[3] - h; return t; }],

  ['fits-window', '#15: the toolbar on two rows', () => { const t = good(aDay); t.facts.toolbar.belowFirstRow = 3; return t; }],
  ['fits-window', '#101: the toolbar scrolls', () => { const t = good(aDay); t.facts.toolbar.scrollWidth = t.facts.toolbar.clientWidth + 120; return t; }],
  ['fits-window', 'a page wider than the window', () => { const t = good(aDay); t.facts.page.scrollWidth = t.facts.page.innerWidth + 40; return t; }],

  ['mark-box', 't111: Already All Long-Term Holders where no coin last moved', () => { const t = good((x) => x.facts.mark && x.facts.coinsInMark === false && x.lang === 'en'); markText(t, 'Price: $0.05 – $0.12 | Already All Long-Term Holders'); return t; }],
  ['mark-box', 't116: 0 Days where no coin last moved', () => { const t = good((x) => x.facts.mark && x.facts.coinsInMark === false && x.lang === 'en'); markText(t, '0 Days'); return t; }],
  ['mark-box', 'No BTC where coins last moved', () => { const t = good((x) => x.facts.mark && x.facts.coinsInMark === true && x.lang === 'en'); markText(t, 'Price: $885 – $1,335 | No BTC Last Moved Here'); return t; }],
  ['mark-box', 'second error analysis: the days still reading … when the trace was taken', () => { const t = good('t123'); markText(t, markBox(t).text.replace(/All LTH Within: .*$/, 'All LTH Within: …')); return t; }],
  ['mark-box', 'coins in the range and no days line', () => { const t = good('t123'); markText(t, markBox(t).text.replace(/ \| All LTH Within: .*$/, '')); return t; }],

  ['mark-edges', 'the owner\'s drag: a white line over a bar', () => { const t = good((x) => x.facts.markEdges && x.facts.markEdges.pitch >= 2); t.facts.markEdges.lines[0].onBar = 1.79; return t; }],
  ['mark-edges', 'a line missing', () => { const t = good((x) => x.facts.markEdges && x.facts.markEdges.pitch >= 2); t.facts.markEdges.lines.pop(); return t; }],

  ['block-steps', '1B back from a day went to the day before, not the block before its last', () => { const t = good('t154'); Object.assign(last(t), { key: '2026-11-14', date: '2026-11-14', isBlock: false }); return t; }],
  ['block-steps', '1B forward from a day went to the next day, not its first block', () => { const t = good('t155'); Object.assign(last(t), { key: '2020-05-12', date: '2020-05-12', isBlock: false }); return t; }],
  ['block-steps', '1B forward went two blocks', () => { const t = good('t156'); Object.assign(last(t), { key: 'h840002', height: 840002 }); return t; }],
  ['block-steps', '1B back did nothing', () => { const t = good('t156'); Object.assign(t.stepped[2], { key: 'h840000', height: 840000 }); return t; }],
  ['block-steps', '1D forward from a block went to the next day, not the end of its own', () => { const t = good('t157'); Object.assign(last(t), { key: '2020-05-12', date: '2020-05-12' }); return t; }],
  ['block-steps', '1D back from a block went to its own day, not the day before', () => { const t = good('t158'); Object.assign(last(t), { key: '2020-05-11', date: '2020-05-11' }); return t; }],
  ['block-steps', '1W from a block went a day', () => { const t = good('t159'); Object.assign(last(t), { key: '2019-06-27', date: '2019-06-27' }); return t; }],
  ['block-steps', 'the 1B button not taken: the step size still reads 1D', () => { const t = good('t154'); t.stepped[1].stepSize = '1D'; return t; }],
  ['block-steps', 'the key 2 not taken: the step size still reads 1B', () => { const t = good('t161'); t.stepped[3].stepSize = '1B'; return t; }],
  ['block-steps', 'past the newest block the chart moved', () => { const t = good('t160'); Object.assign(last(t), { key: 'h976188', height: 976188 }); return t; }],
  ['block-steps', 'past the newest block a notice came up', () => { const t = good('t160'); last(t).notice = 'Error: HTTP 404. Press >> or End to try again.'; return t; }],

  ['empty-note', 'error analysis: a blank day before the first close, unexplained', () => { const t = good(emptyNote); t.facts.annotations = t.facts.annotations.filter((a) => !(a.x === 0.5 && a.y === 0.62)); return t; }],
  ['empty-note', 'the note on a day with bars', () => { const t = good(aDay); t.facts.annotations.push({ text: 'No USD value yet | Every coin last moved before the first BTC/USD close (16 Aug 2010).', xref: 'paper', yref: 'paper', x: 0.5, y: 0.62, box: null }); return t; }],
];

const SITE_FAILURES = [
  ['video-links', 'a link falling back to the channel', (s) => { s.links = s.links.map((l, i) => (i ? l : 'https://www.youtube.com/channel/UC1jY5BEQXSetr93AbZNDbwg')); }],
  ['video-links', 'no trace drew, so the links are unknown', (s) => { s.links = null; }],
  ['video-links', 'videos two months old', (s) => { s.today = new Date(Date.parse(s.youtube['usd-age'].end) + 61 * 864e5).toISOString().slice(0, 10); }],
  ['axis-history', 'the daily job stopped five days ago', (s) => { s.today = new Date(Date.parse(s.scales.end) + 5 * 864e5).toISOString().slice(0, 10); }],
];

test('the labelled examples cover every check, its good traces and its failures', async () => {
  const { TRACE_CHECKS, SITE_CHECKS } = await load();
  for (const c of TRACE_CHECKS) {
    assert.ok(FAILURES.some(([id]) => id === c.id), c.id + ' has failures to catch');
    assert.ok(fixture.good.some((t) => { try { return c.applies(t, ctx); } catch (e) { return false; } }), c.id + ' has good traces to pass');
  }
  for (const [id] of FAILURES) assert.ok(TRACE_CHECKS.some((c) => c.id === id), id + ' is a check');
  for (const c of SITE_CHECKS) assert.ok(SITE_FAILURES.some(([id]) => id === c.id), c.id + ' has failures to catch');
  assert.ok(fixture.good.length >= 30, 'a few dozen real traces');
  // Days and blocks, every window and language, more than one time zone, marked ranges and presses of the step buttons.
  const has = (pred) => fixture.good.some(pred);
  for (const w of ['desktop', 'laptop', 'phone', 'landscape']) assert.ok(has((t) => t.window === w), w);
  for (const l of ['en', 'zh', 'ja']) assert.ok(has((t) => t.lang === l && !t.facts.block) && has((t) => t.lang === l && t.facts.block), l + ', a day and a block');
  assert.ok(new Set(fixture.good.filter((t) => t.facts.block).map((t) => t.facts.tz)).size >= 4, 'blocks in four time zones');
  assert.ok(has((t) => t.facts.mark && t.facts.block) && has((t) => t.facts.date === fixture.inProgress && !t.facts.block));
});

test('every check passes the good traces it applies to (true negative rate 1)', async () => {
  const { TRACE_CHECKS, SITE_CHECKS } = await load();
  for (const t of fixture.good) for (const c of TRACE_CHECKS) {
    if (!c.applies(t, ctx)) continue;
    const [pass, why] = c.judge(t, ctx);
    assert.ok(pass, `${c.id} fails good trace ${t.id} (${t.shown} ${t.view} ${t.window} ${t.lang}): ${why}`);
  }
  for (const c of SITE_CHECKS) { const [pass, why] = c.judge(copy(fixture.site)); assert.ok(pass, c.id + ': ' + why); }
});

test('every check fails each failure made for it (true positive rate 1)', async () => {
  const { TRACE_CHECKS, SITE_CHECKS } = await load();
  const byId = Object.fromEntries(TRACE_CHECKS.map((c) => [c.id, c]));
  for (const [id, what, make] of FAILURES) {
    const t = make(), c = byId[id];
    assert.ok(c.applies(t, ctx), `${id} applies to "${what}"`);
    const [pass] = c.judge(t, ctx);
    assert.equal(pass, false, `${id} catches "${what}"`);
  }
  const siteById = Object.fromEntries(SITE_CHECKS.map((c) => [c.id, c]));
  for (const [id, what, change] of SITE_FAILURES) {
    const s = copy(fixture.site); change(s);
    assert.equal(siteById[id].judge(s)[0], false, `${id} catches "${what}"`);
  }
});

test('a made failure fails the check it was made for and no other', async () => {
  // A check that also failed on another check's failure would count one fault twice and blur which thing broke.
  const { TRACE_CHECKS } = await load();
  for (const [id, what, make] of FAILURES) {
    const t = make();
    if (t.error) continue;   // a chart that never drew has nothing for the other checks to read
    for (const c of TRACE_CHECKS) {
      if (c.id === id || !c.applies(t, ctx)) continue;
      const [pass, why] = c.judge(t, ctx);
      assert.ok(pass, `"${what}" (made for ${id}) also fails ${c.id}: ${why}`);
    }
  }
});

test('a marked range\'s box with its share lines back passes', async () => {
  // Removed in #192 and brought back on the owner's request (6 Nov 2026): the share of the day, its split, the days.
  const { TRACE_CHECKS } = await load();
  const markCheck = TRACE_CHECKS.find((c) => c.id === 'mark-box');
  const t = good((x) => x.facts.mark && x.facts.coinsInMark === true && x.lang === 'en');
  markText(t, 'Price: $885 – $1,335 | BTC Supply Last Moved Here: 19.1% | LTH BTC Supply Last Moved Here: 12.0% | STH BTC Supply Last Moved Here: 7.1% | All LTH Within: 54 Days (by 28 Sept 2017)');
  assert.deepEqual(markCheck.judge(t, ctx), [true]);
});

test('a request for a day\'s data that failed or was called off is not the chart failing to draw', async () => {
  // The page calls a request off after 15 s without an answer, and BRK sometimes answers an error without its CORS
  // header, which the browser logs. For a nearby day the page was fetching ahead, the chart on screen still drew
  // (good traces failed on this on 6 Nov 2026 and twice in the review of 17 Nov 2026). For what is on screen the page
  // asks once more and then shows a notice, which this check does fail.
  const { TRACE_CHECKS } = await load();
  const draws = TRACE_CHECKS.find((c) => c.id === 'draws');
  for (const events of [
    ['request failed: https://bitview.space/api/urpd/age_2y_to_3y/2017-08-02 net::ERR_ABORTED'],
    ['request failed: https://bitview.space/api/urpd/age_1w_to_1m/2015-06-25 net::ERR_FAILED',
      "console error: Access to fetch at 'https://bitview.space/api/urpd/age_1w_to_1m/2015-06-25' from origin 'https://www.bitcoinurpd.com' has been blocked by CORS policy (https://bitview.space/api/urpd/age_1w_to_1m/2015-06-25)"],
  ]) {
    const t = good(aDay); t.events = events;
    assert.equal(draws.judge(t, ctx)[0], true, events[0]);
  }
  const t = good(aDay); t.events = ['request failed: https://bitview.space/api/urpd/all/2017-08-04 net::ERR_FAILED']; t.facts.notice = 'Error: Failed to fetch. Press >> or End to try again.';
  assert.equal(draws.judge(t, ctx)[0], false, 'the same failure for the day on screen, with the page\'s notice');
});

test('16 Jun 2022: the box and BRK 0.62 points apart is a good trace, where the coins at the close itself explain it', async () => {
  // 0.62% of the coins last moved in the day's last block, at the close ($20,325.71), which BRK records as $20,330:
  // above the close, so the box leaves them out, while BRK, from their exact price, counts them in profit. The check's
  // first tolerance (half a point either way, a guess) failed this trace on 14 Nov 2026.
  const { TRACE_CHECKS } = await load();
  const check = TRACE_CHECKS.find((c) => c.id === 'in-profit'), t = good((x) => x.facts.date === '2022-06-16');
  const brk = fixture.refs['2022-06-16'].supply_in_profit_share;
  assert.ok(brk - t.facts.profitPctCoin > 0.6, 'further apart than the old half point');
  assert.ok(t.facts.inProfit.hi - t.facts.inProfit.lo > 0.6 && Math.abs(brk - t.facts.inProfit.hi) < 1e-3, 'by exactly the coins recorded at the close\'s own figure');
  assert.deepEqual(check.judge(t, ctx), [true]);
  // The same day with BRK a further tenth of a point away is beyond what those coins allow.
  const worse = { ...ctx, ref: (name, day) => (name === 'supply_in_profit_share' ? brk + 0.1 : ctx.ref(name, day)) };
  assert.equal(check.judge(t, worse)[0], false);
});

test('a run passes a trace only when it passes every check that applies, and counts each check', async () => {
  const { judge } = await load();
  const traces = [copy(fixture.good[0]), FAILURES[0][2]()];
  const r = judge(traces, ctx, copy(fixture.site));
  assert.equal(r.total, 2); assert.equal(r.passAll, 1);
  assert.equal(r.traces[1].pass, false); assert.equal(r.traces[1].verdicts.draws.pass, false);
  assert.equal(r.perCheck.draws.applied, 2); assert.equal(r.perCheck.draws.passed, 1);
  assert.equal(r.sitePass, true);
});

test('the title date is read in every language', async () => {
  const { titleDay } = await load();
  assert.equal(titleDay('Bitcoin URPD (% USD, AGE) as of 04 Nov 2026'), '2026-11-04');
  assert.equal(titleDay('Bitcoin URPD (% BTC, LTH/STH) as of 07 Sept 2022'), '2022-09-07');
  assert.equal(titleDay('比特币 URPD (% USD, 长/短期) 截至 2011年6月08日'), '2011-06-08');
  assert.equal(titleDay('ビットコイン URPD (% BTC、年齢) 基準日 2017年2月10日'), '2017-02-10');
  assert.equal(titleDay('no date'), null);
});

test('a block\'s title is read in every language, with its time and the zone it names', async () => {
  const { titleBlock, titleDay } = await load();
  assert.deepEqual(titleBlock('Bitcoin URPD (% USD, AGE) as of Block 840,000 (19 Apr 2024 20:09 GMT-4)'), { height: 840000, year: 2024, month: 4, day: 19, hour: 20, minute: 9, zone: 'GMT-4' });
  assert.deepEqual(titleBlock('Bitcoin URPD (% BTC, LTH/STH) as of Block 976,187 (17 Nov 2026 02:55 GMT+5:30)'), { height: 976187, year: 2026, month: 11, day: 17, hour: 2, minute: 55, zone: 'GMT+5:30' });
  assert.deepEqual(titleBlock('比特币 URPD（% USD，长/短期）截至 区块 621,337（2020年3月12日 19:11 GMT+8）'), { height: 621337, year: 2020, month: 3, day: 12, hour: 19, minute: 11, zone: 'GMT+8' });
  assert.deepEqual(titleBlock('ビットコイン URPD（% BTC、年齢） 基準日 ブロック 764,137（2022年11月21日 21:24 GMT+8）'), { height: 764137, year: 2022, month: 11, day: 21, hour: 21, minute: 24, zone: 'GMT+8' });
  assert.equal(titleBlock('Bitcoin URPD (% USD, AGE) as of 20 Apr 2024'), null, 'a day\'s title names no block');
  assert.equal(titleDay('Bitcoin URPD (% USD, AGE) as of Block 840,000 (19 Apr 2024 20:09 GMT-4)'), null, 'and a block\'s title is not read as a day');
  // The titles the site drew, each read back to the block it shows.
  for (const t of fixture.good.filter((x) => x.facts.block)) assert.equal(titleBlock(t.facts.title).height, t.facts.block.height, t.facts.title);
});

test('a moment is put on a zone\'s own clock, with its offset then', async () => {
  const { clockIn } = await load();
  const halving = fixture.blocks[840000].timestamp;   // block 840,000: 20 Apr 2024 00:09 UTC
  assert.deepEqual(clockIn(halving, 'UTC'), { year: 2024, month: 4, day: 20, hour: 0, minute: 9, offset: 0 });
  assert.deepEqual(clockIn(halving, 'America/New_York'), { year: 2024, month: 4, day: 19, hour: 20, minute: 9, offset: -240 }, 'the evening before, on summer time');
  assert.deepEqual(clockIn(halving, 'Asia/Kolkata'), { year: 2024, month: 4, day: 20, hour: 5, minute: 39, offset: 330 });
  assert.deepEqual(clockIn(halving, 'Pacific/Auckland'), { year: 2024, month: 4, day: 20, hour: 12, minute: 9, offset: 720 });
  assert.equal(clockIn(Date.UTC(2024, 0, 15, 12) / 1000, 'America/New_York').offset, -300, 'winter time');
  assert.equal(clockIn(Date.UTC(2024, 0, 15, 12) / 1000, 'Pacific/Auckland').offset, 780, 'summer time in the south');
});
