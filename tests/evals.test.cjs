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
// The price box in any language: the box of coloured lines at the top of the plot that is not a marked range's.
const priceBoxAny = (t) => t.facts.annotations.find((x) => x.color && !x.width && x.yref === 'paper' && x.y === 1);
const markBox = (t) => t.facts.annotations.find((x) => x.xref === 'x' && x.width);
const last = (t) => t.stepped[t.stepped.length - 1];
function markText(t, text) { markBox(t).text = text; }
// The price axis zoomed, and the mouse (17 Nov 2026). A trace whose final picture is a part of the price axis, the first
// act of a kind in a trace of the mouse, and that act altered.
const span = (r) => r[1] - r[0];
const zoomed = (t) => !!t.facts.zoom && (t.facts.xRange[0] > 0 || t.facts.xRange[1] < t.facts.zoom.whole.range[1] - 1e-6);
const cutMark = (t) => zoomed(t) && !!t.facts.mark && !!markBox(t) && (t.facts.mark.lo < t.facts.xRange[0] || t.facts.mark.hi > t.facts.xRange[1]);
const acted = (kind, also = () => true) => (t) => Array.isArray(t.moused) && t.moused.some((m) => m.act[0] === kind && also(m));
const act = (t, kind, also = () => true) => t.moused.find((m) => m.act[0] === kind && also(m));
const isWhole = (s) => s.range[0] === 0 && Math.abs(s.range[1] - s.axisEnd) < 1e-6;
function mouseFault(kind, also, change) { return () => { const t = good(acted(kind, also)); change(act(t, kind, also), t); return t; }; }
// Every label of the axis written again, in what the page asked for and in what is on screen.
function relabel(t, write) { const p = t.facts.priceLabels; p.asked = p.asked.map((x, k) => (x ? write(x, k) : x)); p.seen = p.asked.filter(Boolean); }
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

  ['mark-edges', 'the owner\'s drag: a white line over a bar', () => { const t = good((x) => x.facts.markEdges && x.facts.markEdges.pitch >= 2 && x.facts.markEdges.lines.length === 2); t.facts.markEdges.lines[0].onBar = 1.79; return t; }],
  ['mark-edges', 'a line missing', () => { const t = good((x) => x.facts.markEdges && x.facts.markEdges.pitch >= 2 && x.facts.markEdges.lines.length === 2); t.facts.markEdges.lines.pop(); return t; }],
  // The review of 17 Nov 2026, as the page drew them before #208: a line at the edge of a view that cuts the mark short.
  ['mark-edges', 't191: a white line at the view\'s edge, where the mark does not end, over the last bar in view', () => { const t = good((x) => cutMark(x) && x.facts.markEdges.pitch >= 2 && x.facts.markEdges.lines.length === 1); t.facts.markEdges.lines.push({ c: 1497.5, w: 1, onBar: 0.99 }); return t; }],
  ['mark-edges', 't190: the same at the view\'s left edge, beside the first bar', () => { const t = good((x) => cutMark(x) && x.facts.markEdges.pitch >= 2 && x.facts.markEdges.lines.length === 1); t.facts.markEdges.lines.unshift({ c: -0.5, w: 1, onBar: 0 }); return t; }],
  ['mark-edges', 't192: two lines on a mark wider than the view', () => { const t = good((x) => cutMark(x) && x.facts.markEdges.pitch >= 2 && x.facts.markEdges.lines.length === 0); t.facts.markEdges.lines.push({ c: -0.5, w: 1, onBar: 0 }, { c: 1497.5, w: 1, onBar: 0.99 }); return t; }],
  ['mark-box', 't202: a mark from $10.69 to $11.17, bars 4.4 cents wide, read "$11 – $11"', () => { const t = good((x) => x.facts.mark && x.facts.binWidth > 0.01 && x.facts.binWidth < 0.1 && markBox(x) && /\$\d+\.\d\d –/.test(markBox(x).text)); markText(t, markBox(t).text.replace(/\$[\d.]+ –(?: \|)? \$[\d.]+/, '$11 – $11')); return t; }],
  ['mark-box', '18 May 2010: bars a sixth of a cent wide, and the range to the cent', () => { const t = good((x) => x.facts.mark && x.facts.binWidth < 0.01 && markBox(x) && /\$0\.\d{3} –/.test(markBox(x).text)); markText(t, markBox(t).text.replace(/\$(0\.\d\d)\d –(?: \|)? \$(0\.\d\d)\d/, '$$$1 – $$$2')); return t; }],
  ['mark-box', 'another range\'s prices in the box', () => { const t = good('t123'); markText(t, markBox(t).text.replace(/\$[\d,]+ – \$[\d,]+/, '$885 – $1,335')); return t; }],

  ['bars-total', 'bars lost on a day that was then zoomed', () => { const t = good(zoomed); t.facts.zoom.whole.total = 97.2; return t; }],

  // The two faults of the day the wheel zoom went live, and the third the review found, each as the page drew it then.
  ['price-labels', '#205: a zoomed view labelled to two figures, $113,231 as "$110K"', () => { const t = good((x) => zoomed(x) && x.facts.priceLabels.vals[20] > 1e5 && x.facts.priceLabels.asked[20]); relabel(t, (x, k) => (k === 20 ? '$' + Math.round(t.facts.priceLabels.vals[20] / 1e4) * 10 + 'K' : x)); return t; }],
  ['price-labels', '#206: a zoomed view\'s last label asked for and not on screen', () => { const t = good((x) => zoomed(x) && x.facts.priceLabels.asked[20]); t.facts.priceLabels.seen.pop(); return t; }],
  ['price-labels', 't172: $9,891 written $9.891K', () => { const t = good((x) => zoomed(x) && /^\$\d,\d{3}$/.test(x.facts.priceLabels.asked[0])); relabel(t, (x) => (/^\$\d,\d{3}$/.test(x) ? x.replace(',', '.') + 'K' : x)); return t; }],
  ['price-labels', 't175: a zoomed view of 8 Jun 2011 labelled in dimes, $8.1 for $8.05', () => { const t = good((x) => zoomed(x) && x.facts.priceLabels.asked.filter(Boolean).every((l) => /^\$\d+\.\d\d$/.test(l)) && x.facts.priceLabels.vals[1] - x.facts.priceLabels.vals[0] > 0.15); relabel(t, (x) => '$' + Number(x.slice(1)).toFixed(1)); return t; }],
  ['price-labels', 't176: a view in cents with a last zero dropped, $11.3 between $11.22 and $11.38', () => { const t = good((x) => zoomed(x) && x.facts.priceLabels.asked.filter(Boolean).some((l) => /^\$\d+\.\d0$/.test(l))); relabel(t, (x) => x.replace(/(\.\d)0$/, '$1')); return t; }],
  ['price-labels', 'two gridlines in a row reading the same', () => { const t = good(aDay); relabel(t, (x, k) => (k === 3 ? t.facts.priceLabels.asked[2] : x)); return t; }],
  ['price-labels', 'the whole axis labelled a gridline along', () => { const t = good(aDay); const was = t.facts.priceLabels.asked.slice(); assert.ok(was.every(Boolean)); relabel(t, (x, k) => (k === 0 ? x : k < 20 ? was[k + 1] : was[1])); return t; }],
  ['price-labels', 'a label on the whole axis that Plotly hid', () => { const t = good(aDay); t.facts.priceLabels.seen.splice(5, 1); return t; }],

  ['zoom-view', 'part of a bar at the view\'s left edge', () => { const t = good(zoomed); t.facts.xRange[0] += t.facts.binWidth / 3; return t; }],
  ['zoom-view', 'nine bars in view', () => { const t = good((x) => zoomed(x) && Math.round(span(x.facts.xRange) / x.facts.binWidth) === 10); t.facts.xRange[1] -= t.facts.binWidth; return t; }],
  ['zoom-view', 'the view two bars along from the prices asked for', () => { const t = good((x) => zoomed(x) && x.facts.xRange[0] > 0 && !x.facts.mark && x.facts.xRange[1] < x.facts.zoom.whole.range[1] - 3 * x.facts.binWidth); t.facts.xRange[0] += 2 * t.facts.binWidth; t.facts.xRange[1] += 2 * t.facts.binWidth; return t; }],
  ['zoom-view', 'a view half as wide as was asked for', () => { const t = good((x) => zoomed(x) && !x.facts.mark && span(x.facts.xRange) / x.facts.binWidth > 40); t.facts.xRange[1] = t.facts.xRange[0] + Math.round(span(t.facts.xRange) / t.facts.binWidth / 2) * t.facts.binWidth; return t; }],
  ['zoom-view', 'a view kept where none was asked for', () => { const t = good(zoomed); t.facts.zoom.asked = null; return t; }],
  ['zoom-view', 'a bar another height than on the whole axis', () => { const t = good(zoomed); t.facts.zoom.off.height = 0.004; return t; }],
  ['zoom-view', 'a bar\'s running share counted over the view, not the day', () => { const t = good(zoomed); t.facts.zoom.off.share = 3.2; return t; }],
  ['zoom-view', 'a bar missing from the view', () => { const t = good(zoomed); t.facts.zoom.counts[0].got -= 1; return t; }],
  ['zoom-view', 'the left axis left at the whole axis\'s top over a quiet stretch of prices', () => { const t = good((x) => zoomed(x) && !x.facts.pinned && x.facts.zoom.tallest > 0 && x.facts.zoom.tallest < x.facts.zoom.whole.yTop * 0.9); t.facts.yRange[1] = t.facts.zoom.whole.yTop; return t; }],
  ['zoom-view', 'a pinned Y-axis moved to the tallest bar in view', () => { const t = good((x) => zoomed(x) && x.facts.pinned && x.facts.zoom.tallest > 0 && x.facts.zoom.tallest < x.facts.zoom.whole.yTop * 0.999); t.facts.yRange[1] = t.facts.zoom.tallest; return t; }],
  ['zoom-view', 'nineteen steps of gridlines', () => { const t = good(zoomed); const p = t.facts.priceLabels; p.vals.pop(); if (p.asked.pop()) p.seen.pop(); return t; }],
  ['zoom-view', 'the price left of the view and its box still on its line', () => { const t = good((x) => zoomed(x) && x.facts.spot > 0 && x.facts.spot < x.facts.xRange[0]); const b = priceBoxAny(t); b.xref = 'x'; b.x = t.facts.spot; b.text = b.text.replace('◀ ', ''); return t; }],
  ['zoom-view', 'the price right of the view and no arrow on its box', () => { const t = good((x) => zoomed(x) && x.facts.spot > x.facts.xRange[1]); const b = priceBoxAny(t); b.text = b.text.replace(' ▶', ''); return t; }],
  ['zoom-view', 'the dashed line drawn for a price out of view', () => { const t = good((x) => zoomed(x) && x.facts.spot > 0 && x.facts.spot < x.facts.xRange[0]); t.facts.priceLine = t.facts.spot; return t; }],
  ['zoom-view', 'the price in view and its box against the edge', () => { const t = good((x) => zoomed(x) && x.facts.spot >= x.facts.xRange[0] && x.facts.spot <= x.facts.xRange[1]); const b = priceBoxAny(t); b.xref = 'paper'; b.x = 1; return t; }],

  // The mouse. #207, as measured on the live page before it: the price under the pointer almost three bars off.
  ['mouse', '#207: sixteen notches of the wheel left the price under the pointer 2.8 bars off', mouseFault('wheel', (m) => m.act[2] <= -12, (m) => { const by = 2.8 * m.after.binWidth; m.after.range = m.after.range.map((v) => v - by); })],
  ['mouse', 'the wheel turned away made the view wider', mouseFault('wheel', (m) => m.act[2] < 0 && !isWhole(m.before), (m) => { m.after.range = [m.before.range[0] - 20 * m.before.binWidth, m.before.range[1] + 20 * m.before.binWidth]; })],
  ['mouse', 'the wheel turned away did nothing', mouseFault('wheel', (m) => m.act[2] < 0 && isWhole(m.before), (m) => { m.after = copy(m.before); })],
  ['mouse', 'the wheel turned towards zoomed in', mouseFault('wheel', (m) => m.act[2] > 0 && !isWhole(m.before) && !isWhole(m.after), (m) => { const w = m.before.binWidth, c = (m.before.range[0] + m.before.range[1]) / 2; m.after.range = [Math.round((c - 6 * w) / w) * w, Math.round((c + 6 * w) / w) * w]; })],
  ['mouse', 'the wheel changed the whole axis when turned towards', mouseFault('wheel', (m) => m.act[2] > 0 && isWhole(m.before), (m) => { m.after.range = [0, m.after.range[1] - 30 * m.after.binWidth]; m.after.view = { lo: 0, hi: m.after.range[1] }; })],
  ['mouse', 'the wheel turned sideways zoomed instead', mouseFault('sideways', (m) => !isWhole(m.before), (m) => { m.after.range = [m.before.range[0], m.before.range[1] - 8 * m.before.binWidth]; })],
  ['mouse', 'Shift and the wheel went the other way along the axis', mouseFault('shift-wheel', (m) => !isWhole(m.before), (m) => { const by = m.after.range[0] - m.before.range[0]; assert.ok(Math.abs(by) > 3 * m.before.binWidth); m.after.range = m.before.range.map((v) => v - by); })],
  ['mouse', 'a left drag moved the axis half as far as the pointer', mouseFault('drag', (m) => !isWhole(m.before) && Math.abs(m.after.range[0] - m.before.range[0]) > 6 * m.before.binWidth, (m) => { const w = m.before.binWidth, by = Math.round((m.after.range[0] - m.before.range[0]) / 2 / w) * w; m.after.range = m.before.range.map((v) => v + by); })],
  ['mouse', 'a left drag marked a range, as it did before the right button took that over', mouseFault('drag', (m) => !m.before.mark, (m) => { m.after.mark = { lo: m.after.range[0], hi: m.after.range[0] + 10 * m.after.binWidth }; })],
  ['mouse', 'a left drag moved the whole axis', mouseFault('drag', (m) => isWhole(m.before), (m) => { m.after.range = [10 * m.after.binWidth, m.after.range[1]]; m.after.view = { lo: m.after.range[0], hi: m.after.range[1] }; })],
  ['mouse', 'the closed hand left on after a drag', mouseFault('drag', () => true, (m) => { m.after.panning = true; })],
  ['mouse', 'a right drag moved the axis and marked nothing', mouseFault('mark', (m) => !isWhole(m.before), (m) => { m.after.mark = null; m.after.range = m.before.range.map((v) => v + 5 * m.before.binWidth); })],
  ['mouse', 'a right drag marked two bars short of where it stopped', mouseFault('mark', () => true, (m) => { m.after.mark.hi -= 2 * m.before.binWidth; })],
  ['mouse', 'a right drag marked nothing', mouseFault('mark', (m) => !m.before.mark, (m) => { m.after.mark = null; })],
  ['mouse', 'the browser\'s menu opened over the chart at a right drag', mouseFault('mark', () => true, (m) => { m.menu = [false]; })],
  ['mouse', 'Ctrl and the left button moved the axis, on a mouse with one button', mouseFault('ctrl-mark', (m) => !isWhole(m.before), (m) => { m.after.mark = copy(m.before.mark); m.after.range = m.before.range.map((v) => v - 4 * m.before.binWidth); })],
  ['mouse', 'two clicks left the view zoomed', mouseFault('click2', (m) => !isWhole(m.before), (m) => { m.after = copy(m.before); })],
  ['mouse', 'two right-clicks left the mark', mouseFault('right-click2', (m) => !!m.before.mark, (m) => { m.after.mark = copy(m.before.mark); })],
  ['mouse', 'the browser\'s menu opened at the second right-click', mouseFault('right-click2', () => true, (m) => { m.menu = [true, false]; })],
  ['mouse', 'Escape gave the whole axis back while a range was still marked', mouseFault('key', (m) => !!m.before.mark && !!m.before.view, (m) => { m.after.mark = copy(m.before.mark); m.after.view = null; m.after.range = [0, m.after.axisEnd]; })],
  ['mouse', 'Escape left a zoomed view with nothing marked', mouseFault('key', (m) => !m.before.mark && !!m.before.view, (m) => { m.after = copy(m.before); })],
  ['mouse', 'a step to the next day gave the whole axis back', mouseFault('press', (m) => !!m.before.view, (m) => { m.after.view = null; m.after.range = [0, m.after.axisEnd]; })],
  ['mouse', 'a step to the next day drew the view on part-bars', mouseFault('press', (m) => !!m.before.view, (m) => { m.after.range = m.after.range.map((v) => v + m.after.binWidth / 2); })],

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
  // A browser that kept a pinned scale, opened afresh (fourth analysis, 20 Nov 2026). Each is what the page did with
  // that store before it took a kept pin only in the shape it writes one, put onto a trace of the page as fixed.
  ['pin-true', 't210 before the fix: the browser kept "abc" for the settings on screen, and PIN Y-AXIS was pressed over the day\'s own scale', () => { const t = good('k209'); Object.assign(t.facts.pin.opened, { pressed: true, held: 'abc' }); return t; }],
  ['pin-true', 't211 before the fix: pressed over a pin of no height', () => { const t = good('k209'); Object.assign(t.facts.pin.opened, { pressed: true, held: ['2026-11-19', 0] }); return t; }],
  ['pin-true', 't212 before the fix: the store was a word, and a press of PIN Y-AXIS pinned nothing', () => { const t = good('k212'); Object.assign(t.facts.pin.pressed, { pressed: false, held: null, kept: '"oops"' }); return t; }],
  ['pin-true', 't213 before the fix: the store was a list, and the pin was written back without itself', () => { const t = good('k213'); t.facts.pin.pressed.kept = '[1,2]'; return t; }],
  ['pin-true', 'a kept pin the left axis is not drawn against', () => { const t = good('k206'); t.facts.pin.opened.top = t.facts.pin.opened.dayTop; return t; }],
  ['pin-true', 'not pressed while a kept pin holds the axis', () => { const t = good('k207'); t.facts.pin.opened.pressed = false; return t; }],
  ['pin-true', 'a press that pins another day than the one on screen', () => { const t = good('k208'); t.facts.pin.pressed.held[0] = '2026-11-01'; return t; }],
  ['pin-true', 'a press that leaves the pin on', () => { const t = good('k206'); Object.assign(t.facts.pin.pressed, { pressed: true, held: t.facts.pin.opened.held, top: t.facts.pin.opened.top, kept: t.facts.pin.opened.kept }); return t; }],
  ['draws', 't209 before the fix: a kept pin whose height was text, and no chart at all', () => { const t = good('k209'); delete t.facts; t.error = 'the page gave up: Error: v.toFixed is not a function. Press >> or End to try again.'; return t; }],
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
  // The price axis zoomed: the price in view, left and right of it, ten bars, a pin, a block, another language, bars
  // under a dollar wide, a mark the view cuts at either end and one wider than it; and every act of the mouse.
  assert.ok(has((t) => zoomed(t) && t.facts.spot >= t.facts.xRange[0] && t.facts.spot <= t.facts.xRange[1]) && has((t) => zoomed(t) && t.facts.spot > 0 && t.facts.spot < t.facts.xRange[0]) && has((t) => zoomed(t) && t.facts.spot > t.facts.xRange[1]));
  assert.ok(has((t) => zoomed(t) && t.facts.pinned) && has((t) => zoomed(t) && t.facts.block) && has((t) => zoomed(t) && t.lang !== 'en') && has((t) => zoomed(t) && t.facts.binWidth < 1));
  assert.ok(has((t) => cutMark(t) && t.facts.mark.lo < t.facts.xRange[0] && t.facts.mark.hi <= t.facts.xRange[1]) && has((t) => cutMark(t) && t.facts.mark.hi > t.facts.xRange[1] && t.facts.mark.lo >= t.facts.xRange[0]) && has((t) => cutMark(t) && t.facts.markEdges.lines.length === 0));
  for (const kind of ['wheel', 'shift-wheel', 'sideways', 'drag', 'mark', 'ctrl-mark', 'click2', 'right-click2', 'key', 'press']) assert.ok(has(acted(kind)), 'a trace with ' + kind);
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

test('the collector looks for the page\'s notice by whether it is displayed', () => {
  // The notice (#status) is fixed to the window, and an element fixed to the window has no offsetParent whether it
  // shows or not. That was the collector's test until 17 Nov 2026: it never saw a notice, so a draw the page had given
  // up on was waited out for 240 s (twice in that day's review of the live site), and the draws check's notice clause,
  // which passes its made failures above, could not fire on a real trace.
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /#status \{[^}]*position: fixed/, 'the notice is fixed to the window');
  assert.match(html, /el\.style\.display = text \? "block" : "none"/, 'and shown by its display');
  const code = fs.readFileSync(path.join(__dirname, '..', 'evals', 'collect.mjs'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(code, /offsetParent/);
  assert.equal((code.match(/getComputedStyle\((?:s|status)\)\.display !== "none"/g) || []).length, 3, 'in the facts, while waiting for a chart, and after each press');
});

test('a price label is read back as dollars', async () => {
  const { labelDollars } = await load();
  assert.deepEqual(['$95.2K', '$1.26M', '$0.385', '$0', '$1,234', '$102,570', '$9.50', '$1,000.5K', '$2B'].map(labelDollars), [95200, 1260000, 0.385, 0, 1234, 102570, 9.5, 1000500, 2e9]);
  assert.deepEqual(['', 'K', '$', '95.2K', '$1.2X', null].map(labelDollars), [null, null, null, null, null, null]);
  // Every label the site drew, on the whole axis and zoomed, in every language.
  for (const t of fixture.good) for (const x of t.facts.priceLabels.asked) if (x) assert.equal(typeof labelDollars(x), 'number', x + ' on ' + t.id);
});

test('the prices drawn are held to the view asked for as the page says a day shows one', async () => {
  const { viewFault } = await load();
  const w = 200, end = 626 * w;
  assert.equal(viewFault([0, end], null, w, end), null, 'the whole axis, nothing asked for');
  assert.equal(viewFault([50000, 80000], { lo: 50030, hi: 80110 }, w, end), null, 'rounded to bar edges');
  assert.equal(viewFault([50200, 80400], { lo: 50130, hi: 80310 }, w, end), null);
  assert.equal(viewFault([50000, 52000], { lo: 50000, hi: 50300 }, w, end), null, 'never fewer than ten bars');
  assert.equal(viewFault([105200, 125200], { lo: 120000, hi: 140000 }, w, end), null, 'slid back inside the axis');
  assert.equal(viewFault([0, 20000], { lo: -5000, hi: 15000 }, w, end), null);
  assert.equal(viewFault([0, end], { lo: 60000, hi: 500000 }, w, end), null, 'wider than the axis: the whole axis');
  assert.equal(viewFault([0, end], { lo: 0, hi: end - 60 }, w, end), null, 'as wide as the axis, to the bar');
  assert.equal(viewFault([0, 131300], null, w, 131300), null, 'an axis that ends past its last bar, at the price');
  assert.equal(viewFault([127400, 131400], { lo: 130000, hi: 134000 }, w, 131300), null, 'and a view against that end');
  assert.equal(viewFault([0, 0], null, 0, 0), null, 'a day with no axis');
  assert.match(viewFault([50100, 80000], { lo: 50030, hi: 80110 }, w, end), /part of a bar/);
  assert.match(viewFault([50000, 51800], { lo: 50000, hi: 50300 }, w, end), /9 bars in view, fewer than 10/);
  assert.match(viewFault([50400, 80400], { lo: 50030, hi: 80110 }, w, end), /starts at bar 252/);
  assert.match(viewFault([50000, 70000], { lo: 50030, hi: 80110 }, w, end), /100 bars in view, 150\.40 were asked for/);
  assert.match(viewFault([0, end], { lo: 50030, hi: 80110 }, w, end), /the whole axis is drawn/);
  assert.match(viewFault([50000, 80000], null, w, end), /where the whole axis was asked for/);
  assert.match(viewFault([120000, 126000], { lo: 120000, hi: 126000 }, w, end), /reaches past the axis/);
});

test('the review\'s own traces of 17 Nov 2026, as the page drew them before #207 and #208, fail the checks made for them', async () => {
  // The checks were written against these before the page was fixed: each fault found by eye in that run is one a check
  // now names, and the traces without one pass (evals/README.md). They are kept as the made failures above; this holds
  // the three checks' reasons to what was on screen.
  const { TRACE_CHECKS } = await load();
  const byId = Object.fromEntries(TRACE_CHECKS.map((c) => [c.id, c]));
  const why = (id, t) => byId[id].judge(t, ctx)[1];
  const made = (what) => FAILURES.find(([, w]) => w.startsWith(what))[2]();
  assert.match(why('mark-edges', made('t191')), /^2 white lines, and 1 end of the mark in view$/);
  assert.match(why('mark-edges', made('t192')), /^2 white lines, and 0 ends of the mark in view$/);
  assert.match(why('mark-box', made('t202')), /^the box gives the range as \$11 – \$11, the mark is \$\d+\.\d+ to \$\d+\.\d+ and a bar \$0\.0\d+ wide$/);
  assert.match(why('price-labels', made('t172')), /^a price written as \$\d\.\d{3}K$/);
  assert.match(why('price-labels', made('#205')), /^\$1\d0K on the gridline at \$1\d\d,\d{3} \(a step is \$[\d,]+\)$/);
  assert.match(why('price-labels', made('#206')), /^not on screen: \$/);
  assert.match(why('price-labels', made('t175')), /^a price written with one decimal: \$\d+\.\d$/);
  assert.match(why('price-labels', made('t176')), /^a price written with one decimal: \$\d+\.\d$/);
  assert.match(why('price-labels', made('the whole axis labelled a gridline along')), /^\$[\d.]+[KM]? on the gridline at \$[\d.,]+$/);
  assert.match(why('mouse', made('#207')), /^the wheel turned 1\d notches away at 0\.\d\d: the price under the pointer went from \$[\d,]+ to \$[\d,]+, -[23]\.\d\d bars$/);
});
