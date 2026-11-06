// The evaluators in evals/checks.mjs, checked against labelled examples (evals/fixtures/labelled.json): real traces of
// the live site that review found good, and the same traces altered to reproduce each failure seen before (the
// regression history and the error analysis, see evals/README.md). Every check has to pass every good example it
// applies to (true negative rate 1) and fail every example made for it (true positive rate 1), so a check that
// misses its failure, or cries wolf on a good chart, fails here before it can mislead a run.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'evals', 'fixtures', 'labelled.json'), 'utf8'));
const load = () => import(path.join(__dirname, '..', 'evals', 'checks.mjs'));
const ctx = { ref: (name, day) => (fixture.refs[day] || {})[name] ?? null, inProgress: fixture.inProgress };
const copy = (v) => JSON.parse(JSON.stringify(v));
const good = (pred) => { const t = fixture.good.find(pred); assert.ok(t, 'a labelled trace for this example'); return copy(t); };
const withPrice = (t) => t.facts.spot > 0 && t.facts.date !== fixture.inProgress && !t.facts.mark && t.window === 'desktop';

// Each failure made from a good trace: which check must catch it, what it reproduces, how.
const FAILURES = [
  ['draws', '#191: the API changed and no day loaded', () => { const t = good(withPrice); t.facts.notice = 'Could not reach bitview.space. Check your connection and try again.'; return t; }],
  ['draws', 'a script error while drawing', () => { const t = good(withPrice); t.events = ['page error: TypeError: Cannot read properties of undefined']; return t; }],
  ['draws', 'a data request that failed', () => { const t = good(withPrice); t.events = ['request failed: https://bitview.space/api/urpd/all/2017-08-04 net::ERR_CONNECTION_RESET']; return t; }],
  ['draws', 'a day that never drew', () => { const t = good(withPrice); delete t.facts; t.error = 'Timeout 240000ms exceeded'; return t; }],
  ['right-day', '#6: the price two days behind', () => { const t = good(withPrice); t.facts.spot = t.facts.spot * 1.03; return t; }],
  ['right-day', '#4: a one-day shift in the title', () => { const t = good(withPrice); t.facts.title = t.facts.title.replace(/\d\d (\w+ \d{4})$/, (m, rest) => String(Number(m.slice(0, 2)) % 28 + 1).padStart(2, '0') + ' ' + rest); return t; }],
  ['right-day', 'the counter on another day', () => { const t = good(withPrice); t.facts.counter = (t.facts.dayNumber - 1) + '/' + t.facts.days; return t; }],
  ['supply', '#99: an age band lost on the way in', () => { const t = good(withPrice); t.facts.raw.supply -= 1000; return t; }],
  ['realized-cap', 'prices read with the wrong rounding', () => { const t = good(withPrice); t.facts.raw.value *= 1.01; return t; }],
  ['holders', 'the 150-day line one band off', () => { const t = good(withPrice); t.facts.raw.sth += 50000; t.facts.raw.lth -= 50000; return t; }],
  ['in-profit', '#144: the box 2.2 points off the recorded prices', () => { const t = good(withPrice); t.facts.profitPctCoin += 2.2; return t; }],
  ['bars-total', 'bars past the axis dropped', () => { const t = good(withPrice); t.facts.bars.forEach((b) => { b.sum *= 0.97; }); return t; }],
  ['labels-clear', '#24: the price box off the plot', () => { const t = good(withPrice); const a = t.facts.annotations.find((x) => /Price:/.test(x.text)); a.box = [a.box[0] + t.facts.page.innerWidth, a.box[1], a.box[2] + t.facts.page.innerWidth, a.box[3]]; return t; }],
  ['labels-clear', '#174: a box over the price box', () => { const t = good(withPrice); const a = t.facts.annotations.find((x) => /Price:/.test(x.text)); t.facts.annotations.push({ text: 'Price: $1 – $2 | All LTH Within: 3 Days', xref: 'x', yref: 'paper', width: 100, box: [a.box[0] + 5, a.box[1] + 5, a.box[2], a.box[3]] }); return t; }],
  ['labels-clear', '#39: a label on the legend', () => { const t = good(withPrice); const a = t.facts.annotations.find((x) => /Price:/.test(x.text)); a.box = [t.facts.legend[0], t.facts.legend[1], t.facts.legend[0] + 50, t.facts.legend[1] + 20]; return t; }],
  ['fits-window', '#15: the toolbar on two rows', () => { const t = good(withPrice); t.facts.toolbar.belowFirstRow = 3; return t; }],
  ['fits-window', '#101: the toolbar scrolls', () => { const t = good(withPrice); t.facts.toolbar.scrollWidth = t.facts.toolbar.clientWidth + 120; return t; }],
  ['fits-window', 'a page wider than the window', () => { const t = good(withPrice); t.facts.page.scrollWidth = t.facts.page.innerWidth + 40; return t; }],
  ['mark-box', 't111: Already All Long-Term Holders where no coin last moved', () => { const t = good((x) => x.facts && x.facts.mark && x.facts.coinsInMark === false && x.lang === 'en'); markText(t, 'Price: $0.05 – $0.12 | Already All Long-Term Holders'); return t; }],
  ['mark-box', 't116: 0 Days where no coin last moved', () => { const t = good((x) => x.facts && x.facts.mark && x.facts.coinsInMark === false && x.lang === 'en'); markText(t, '0 Days'); return t; }],
  ['mark-box', 'No BTC where coins last moved', () => { const t = good((x) => x.facts && x.facts.mark && x.facts.coinsInMark === true && x.lang === 'en'); markText(t, 'Price: $885 – $1,335 | No BTC Last Moved Here'); return t; }],
  ['mark-edges', 'the owner\'s drag: a white line over a bar', () => { const t = good((x) => x.facts && x.facts.markEdges && x.facts.markEdges.pitch >= 2); t.facts.markEdges.lines[0].onBar = 1.79; return t; }],
  ['mark-edges', 'a line missing', () => { const t = good((x) => x.facts && x.facts.markEdges && x.facts.markEdges.pitch >= 2); t.facts.markEdges.lines.pop(); return t; }],
  ['empty-note', 'error analysis: a blank day before the first close, unexplained', () => { const t = good((x) => x.facts && emptyNote(x)); t.facts.annotations = t.facts.annotations.filter((a) => !(a.x === 0.5 && a.y === 0.62)); return t; }],
  ['empty-note', 'the note on a day with bars', () => { const t = good(withPrice); t.facts.annotations.push({ text: 'No USD value yet | Every coin last moved before the first BTC/USD close (16 Aug 2010).', xref: 'paper', yref: 'paper', x: 0.5, y: 0.62, box: null }); return t; }],
];
function markText(t, text) { const a = t.facts.annotations.find((x) => x.xref === 'x' && x.width); a.text = text; }
function emptyNote(t) { return t.facts.annotations.some((a) => a.xref === 'paper' && a.yref === 'paper' && a.x === 0.5 && a.y === 0.62); }

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
  for (const c of SITE_CHECKS) assert.ok(SITE_FAILURES.some(([id]) => id === c.id), c.id + ' has failures to catch');
  assert.ok(fixture.good.length >= 8, 'a handful of real traces');
});

test('every check passes the good traces it applies to (true negative rate 1)', async () => {
  const { TRACE_CHECKS, SITE_CHECKS } = await load();
  for (const t of fixture.good) for (const c of TRACE_CHECKS) {
    if (!c.applies(t, ctx)) continue;
    const [pass, why] = c.judge(t, ctx);
    assert.ok(pass, `${c.id} fails good trace ${t.id} (${t.facts && t.facts.date} ${t.view} ${t.window} ${t.lang}): ${why}`);
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

test('a marked range\'s box with its share lines back passes', async () => {
  // Removed in #192 and brought back on the owner's request (6 Nov 2026): the share of the day, its split, the days.
  const { TRACE_CHECKS } = await load();
  const markCheck = TRACE_CHECKS.find((c) => c.id === 'mark-box');
  const t = good((x) => x.facts && x.facts.mark && x.facts.coinsInMark === true && x.lang === 'en');
  markText(t, 'Price: $885 – $1,335 | BTC Supply Last Moved Here: 19.1% | LTH BTC Supply Last Moved Here: 12.0% | STH BTC Supply Last Moved Here: 7.1% | All LTH Within: 54 Days (by 28 Sept 2017)');
  assert.deepEqual(markCheck.judge(t, ctx), [true]);
});

test('a request the page called off itself is not the day failing to draw', async () => {
  // The page calls a request off after 15 s without an answer; for a nearby day it was fetching ahead, the day on screen
  // still drew (a good trace of 6 Nov 2026 failed on this). For the day on screen the page shows a notice instead.
  const { TRACE_CHECKS } = await load();
  const draws = TRACE_CHECKS.find((c) => c.id === 'draws'), t = good(withPrice);
  t.events = ['request failed: https://bitview.space/api/urpd/age_2y_to_3y/2017-08-02 net::ERR_ABORTED'];
  assert.equal(draws.judge(t, ctx)[0], true);
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
