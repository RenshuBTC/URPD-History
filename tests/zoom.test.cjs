// The price axis zoomed and moved with the mouse, and the range marked with the right button (17 Nov 2026: the owner
// asked for the wheel to zoom in and out, the left button to pan, and the marking to move to the right button).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, html, flush } = require('./helpers.cjs');
const plain = v => JSON.parse(JSON.stringify(v));

const DAY = 864e5, iso = t => new Date(t).toISOString().slice(0, 10);
const r2 = v => Math.round(v * 100) / 100;

// The page with a plot W px wide and 700 high at the window's corner, a clock the test moves, and the mouse's
// listeners, frames and body classes kept where the test can reach them.
function page({ W = 1498, bins = 625, dpr = 1, split = false } = {}) {
  const win = {}, raf = [], made = [], classes = new Set(), clock = { t: 1e12 };
  let ctx = null;
  class Clock extends Date { static now() { return clock.t; } }
  const h = app({
    Date: Clock,
    Plotly: { react(id, traces, layout, config) {
      const gd = ctx.document.getElementById(id), [a, b] = layout.xaxis.range;
      Object.assign(gd, { data: traces, layout, config });
      gd._fullLayout = { width: h.W + 160, legend: { _height: 29 }, yaxis: { _length: 700, _offset: 0 },
        xaxis: { _length: h.W, _offset: 0, p2d: p => a + p / h.W * (b - a), l2p: v => (v - a) / (b - a) * h.W } };
      h.draws++;
      return Promise.resolve();
    } },
    addEventListener(type, fn) { (win[type] = win[type] || []).push(fn); },
    requestAnimationFrame(fn) { raf.push(fn); return raf.length; }, cancelAnimationFrame() {}
  });
  ctx = h.c;
  const c = h.c, gd = h.element('chart');
  Object.assign(h, { W, win, raf, made, classes, clock, gd, draws: 0 });
  c.document.createElement = () => { const el = { style: {}, appendChild() {} }; made.push(el); return el; };
  c.document.body.appendChild = () => {};
  c.document.body.classList = { add: n => classes.add(n), remove: n => classes.delete(n) };
  c.NUM_BINS = bins; c.devicePixelRatio = dpr; c.splitMode = split; gd.clientWidth = W + 160;
  c.priceHighLow = { high: null, low: null };
  // 60 days from 1 Sep 2021 closing at $60,000, a coin every $250 from $1,000 to $70,750 and a heap at $40,000.
  const t0 = Date.parse('2021-09-01T00:00:00Z'), dates = Array.from({ length: 60 }, (_, i) => iso(t0 + i * DAY));
  c.allDates = dates; c.priceDates = dates.slice(); c.priceIndexByDate = Object.fromEntries(dates.map((d, i) => [d, i]));
  c.priceArray = dates.map(() => 60000);
  const band = Object.fromEntries(Array.from({ length: 280 }, (_, i) => [1000 + 250 * i, 1]));
  band[40000] = 40;
  h.raw = { all: { ...band }, age: [band] };
  h.data = c.buildData(dates[50], h.raw);
  h.frame = async () => { while (raf.length) raf.shift()(); await flush(); await c.chartRenderPromise; await flush(); };
  h.draw = async () => { await c.renderChart(h.data); await flush(); };
  h.bars = () => gd.data.filter(t => t.type === 'bar');
  // The mouse, in px from the plot's left edge at mid-height.
  const ev = (x, more = {}) => ({ clientX: x, clientY: 300, deltaX: 0, deltaY: 0, deltaMode: 0, prevented: false, preventDefault() { this.prevented = true; }, ...more });
  h.wheel = (x, dy, more) => { const e = ev(x, { deltaY: dy, ...more }); gd.emit('wheel', e); return e; };
  h.down = (x, button = 0, more) => gd.emit('mousedown', ev(x, { button, ...more }));
  h.move = (x) => (win.mousemove || []).forEach(f => f(ev(x)));
  h.up = () => (win.mouseup || []).forEach(f => f({}));
  h.menu = (x, y = 300) => { const e = ev(x, { clientY: y }); (win.contextmenu || []).forEach(f => f(e)); return e.prevented; };
  h.key = (key) => h.docListeners.keydown.forEach(f => f({ key, target: { tagName: 'BODY', blur() {} }, preventDefault() {} }));
  return h;
}

test('a view of the price axis is whole bars of the day: at least ten, inside the axis, and the whole axis when as wide', () => {
  const { c } = app();
  const w = 200, full = 626 * w;
  assert.equal(c.priceWindow(null, w, full), null, 'nothing asked for: the whole axis');
  assert.deepEqual(plain(c.priceWindow({ lo: 50030, hi: 80110 }, w, full)), { k0: 250, k1: 400, lo: 50000, hi: 80000 }, 'rounded to bar edges, as many bars as it is wide');
  assert.deepEqual(plain(c.priceWindow({ lo: 50130, hi: 80310 }, w, full)), { k0: 251, k1: 402, lo: 50200, hi: 80400 });
  assert.deepEqual(plain(c.priceWindow({ lo: 50000, hi: 50300 }, w, full)), { k0: 250, k1: 260, lo: 50000, hi: 52000 }, 'never fewer than ten bars');
  assert.deepEqual(plain(c.priceWindow({ lo: 120000, hi: 140000 }, w, full)), { k0: 526, k1: 626, lo: 105200, hi: 125200 }, 'slid back inside the axis, as wide as it was');
  assert.deepEqual(plain(c.priceWindow({ lo: -5000, hi: 15000 }, w, full)), { k0: 0, k1: 100, lo: 0, hi: 20000 });
  assert.equal(c.priceWindow({ lo: 0, hi: full }, w, full), null, 'as wide as the axis: the whole axis');
  assert.equal(c.priceWindow({ lo: 60000, hi: 500000 }, w, full), null, 'wider than a day\'s axis (an earlier day): the whole axis');
  // An axis that ends past its last bar (the price above every bar) counts the room to its end.
  assert.deepEqual(plain(c.priceWindow({ lo: 126000, hi: 130000 }, w, 131300)), { k0: 630, k1: 650, lo: 126000, hi: 130000 });
  assert.deepEqual(plain(c.priceWindow({ lo: 130000, hi: 134000 }, w, 131300)), { k0: 637, k1: 657, lo: 127400, hi: 131400 });
  assert.equal(c.priceWindow({ lo: 0, hi: 100 }, 0, 0), null, 'a day with no axis');
  assert.equal(c.ZOOM_MIN_BARS, 10);
});

test('zoomed, the chart shows the same bars, only fewer: their prices, heights and hovers, twenty steps of labels and a left axis no higher than the tallest in view', async () => {
  const h = page(), { c, gd } = h;
  await h.draw();
  const whole = { x: plain(h.bars()[0].x), y: plain(h.bars()[0].y), hover: plain(h.bars()[0].customdata), range: plain(gd.layout.xaxis.range), top: gd.layout.yaxis.range[1], width: h.bars()[0].width[0] };
  const w = h.data.binWidth;
  assert.equal(whole.range[0], 0); assert.equal(whole.x.length, 626);
  assert.ok(!h.classes.has('zoomed'));
  // $50,000 to $62,000: the heap at $40,000 is out of view.
  c.priceView = { lo: 50000, hi: 62000 };
  await h.draw();
  const L = gd.layout, k0 = Math.round(50000 / w), n = Math.round(12000 / w), bar = h.bars()[0];
  assert.deepEqual(plain(L.xaxis.range), [k0 * w, (k0 + n) * w], 'the axis runs over whole bars');
  assert.equal(L.xaxis.fixedrange, true, 'Plotly still zooms nothing itself');
  assert.deepEqual(plain(bar.x), whole.x.slice(k0, k0 + n), 'the bars in view, at their own prices');
  assert.deepEqual(plain(bar.y), whole.y.slice(k0, k0 + n), 'each as tall as on the whole axis: a share of the whole day');
  assert.deepEqual(plain(bar.customdata), whole.hover.slice(k0, k0 + n), 'and with the same hover: its share, its running share of the day, its amount');
  assert.equal(bar.width.length, n);
  // Bars a pixel apart at the new pitch.
  const pitch = h.W / n;
  assert.ok(Math.abs(bar.width[0] - w * (pitch - 1) / pitch) < 1e-9 && bar.width[0] > whole.width, 'wider bars, still a pixel apart');
  // Twenty steps from the first price in view to the last, no two labels the same.
  assert.equal(L.xaxis.tickvals.length, 21);
  assert.ok(Math.abs(L.xaxis.tickvals[0] - k0 * w) < 1e-9 && Math.abs(L.xaxis.tickvals[20] - (k0 + n) * w) < 1e-9);
  L.xaxis.tickvals.forEach((v, k) => assert.ok(Math.abs(v - (k0 * w + k * n * w / 20)) < 1e-6));
  const labels = L.xaxis.ticktext.map(s => s.replace(/ /g, ''));
  assert.equal(new Set(labels).size, 21, labels.join(' '));
  assert.match(labels[0], /^\$50(\.\d+)?K$/); assert.match(labels[20], /^\$62(\.\d+)?K$/);
  assert.equal(L.xaxis.ticktext[0], ' '.repeat(labels[0].length) + labels[0], 'the first label starts at its gridline');
  // The left axis: the tallest bar in view, lower than the day's (the heap at $40,000).
  const seen = Math.max(...whole.y.slice(k0, k0 + n));
  assert.ok(seen < whole.top);
  assert.equal(L.yaxis.range[1], seen);
  assert.ok(h.classes.has('zoomed'), 'the hand shows over the plot');
  // With the heap in view the axis is the day's own again.
  c.priceView = { lo: 30000, hi: 62000 };
  await h.draw();
  assert.equal(gd.layout.yaxis.range[1], whole.top);
  // The whole axis again: exactly as before.
  c.priceView = null;
  await h.draw();
  assert.deepEqual(plain(gd.layout.xaxis.range), whole.range);
  assert.deepEqual(plain(h.bars()[0].y), whole.y);
  assert.equal(gd.layout.yaxis.range[1], whole.top);
  assert.ok(!h.classes.has('zoomed'));
});

test('zoomed, Y-max still cuts what it cut and no more, the ▲ figure counts the bars in view, and a pinned Y-axis stays pinned', async () => {
  const h = page(), { c, gd } = h;
  const cutNote = () => gd.layout.annotations.find(a => /^▲/.test(a.text));
  c.yMaxPct = 90;
  await h.draw();
  const top90 = gd.layout.yaxis.range[1], y = plain(h.bars()[0].y), w = h.data.binWidth;
  assert.ok(cutNote(), 'bars above the 90th percentile run off the top');
  // A view over the heap: the axis ends where it did, the heap is still cut, alone.
  c.priceView = { lo: 38000, hi: 42000 };
  await h.draw();
  const k0 = Math.round(38000 / w), n = Math.round(4000 / w), seen = y.slice(k0, k0 + n), over = seen.filter(v => v > top90 * (1 + 1e-9));
  assert.equal(gd.layout.yaxis.range[1], top90);
  assert.ok(over.length >= 1);
  assert.equal(cutNote().text, '▲ ' + c.pctCompact(Math.max(...over)) + (over.length > 1 ? ' (+' + (over.length - 1) + ')' : ''));
  assert.equal(cutNote().xref, 'x'); assert.equal(cutNote().x, gd.layout.xaxis.range[0], 'at the left edge of the view');
  // A view with no bar above the level: nothing is cut, and the axis comes down to the tallest in view.
  c.priceView = { lo: 2000, hi: 6000 };
  await h.draw();
  const k1 = Math.round(2000 / w), n1 = Math.round(4000 / w), tallest = Math.max(...y.slice(k1, k1 + n1));
  assert.ok(tallest < top90);
  assert.equal(gd.layout.yaxis.range[1], tallest);
  assert.ok(!cutNote());
  // Pinned on the whole axis, the level holds in any view.
  c.priceView = null; c.yMaxPct = 100;
  await h.draw();
  c.peakPin();
  await h.draw();
  const pinned = gd.layout.yaxis.range[1];
  c.priceView = { lo: 2000, hi: 6000 };
  await h.draw();
  assert.equal(gd.layout.yaxis.range[1], pinned, 'a pin outranks the view');
});

test('with the dashed line out of a zoomed view the price box stays at the edge the line left by, pointing its way', async () => {
  const h = page(), { c, gd } = h;
  const box = () => gd.layout.annotations.find(a => /In Profit/.test(a.text));
  const line = () => gd.layout.shapes.find(s => s.type === 'line' && s.line.dash === 'dash' && s.xref === 'x');
  await h.draw();
  assert.equal(box().xref, 'x'); assert.equal(box().x, 60000); assert.ok(line());
  assert.match(box().text, /^Price: \$60,000<br>/);
  // In view: on its line, as on the whole axis.
  c.priceView = { lo: 50000, hi: 65000 };
  await h.draw();
  assert.equal(box().xref, 'x'); assert.equal(box().x, 60000); assert.equal(line().x0, 60000);
  assert.match(box().text, /^Price: \$60,000<br>/);
  const figures = box().text.replace(/^[^<]*/, '');
  // The view is above the price: the box at the left edge, an arrow before the price, no line.
  c.priceView = { lo: 62000, hi: 70000 };
  await h.draw();
  assert.equal(box().xref, 'paper'); assert.equal(box().x, 0); assert.equal(box().xanchor, 'left'); assert.equal(box().xshift, 6);
  assert.match(box().text, /^◀ Price: \$60,000<br>/);
  assert.equal(box().text.replace(/^[^<]*/, ''), figures, 'the same shares in profit and in loss: the whole day\'s');
  assert.ok(!line(), 'no line where the price is not in view');
  // The view is below the price: the box at the right edge, the arrow after the price.
  c.priceView = { lo: 20000, hi: 30000 };
  await h.draw();
  assert.equal(box().xref, 'paper'); assert.equal(box().x, 1); assert.equal(box().xanchor, 'right'); assert.equal(box().xshift, -6);
  assert.match(box().text, /^Price: \$60,000 ▶<br>/);
  assert.ok(!line());
});

test('the wheel zooms the price axis about the price under the pointer, in and out, no closer than ten bars and no further than the whole axis', async () => {
  const h = page(), { c, gd } = h;
  await h.draw();
  const w = h.data.binWidth, full = gd.layout.xaxis.range[1], W = h.W;
  const priceAt = x => { const [a, b] = gd.layout.xaxis.range; return a + x / W * (b - a); };
  // Away from you (deltaY < 0) zooms in; the price under the pointer stays within a bar of it.
  let x = 900, before = priceAt(x), spanBefore = full;
  for (let i = 0; i < 6; i++) {
    const e = h.wheel(x, -100);
    assert.ok(e.prevented, 'the wheel is the chart\'s over the plot');
    await h.frame();
    const [a, b] = gd.layout.xaxis.range;
    assert.ok(b - a < spanBefore, 'narrower at every notch');
    assert.ok(Math.abs((b - a) / spanBefore - Math.exp(-100 * c.ZOOM_RATE)) < 0.02, 'by the same share each notch');
    assert.ok(Math.abs(priceAt(x) - before) <= w, `the price under the pointer stays (${priceAt(x)} for ${before})`);
    assert.ok(Math.abs(Math.round(a / w) - a / w) < 1e-9 && Math.abs(Math.round((b - a) / w) - (b - a) / w) < 1e-9, 'on whole bars');
    spanBefore = b - a; before = priceAt(x);
  }
  // Towards you zooms out, about the pointer wherever it now is.
  x = 300; before = priceAt(x);
  h.wheel(x, 100); await h.frame();
  assert.ok(gd.layout.xaxis.range[1] - gd.layout.xaxis.range[0] > spanBefore);
  assert.ok(Math.abs(priceAt(x) - before) <= w);
  // All the way out: the whole axis, and the view is let go.
  for (let i = 0; i < 20; i++) { h.wheel(x, 300); await h.frame(); }
  assert.deepEqual(plain(gd.layout.xaxis.range), [0, full]);
  assert.equal(c.priceView, null);
  // All the way in: ten bars.
  for (let i = 0; i < 60; i++) { h.wheel(700, -300); await h.frame(); }
  assert.ok(Math.abs((gd.layout.xaxis.range[1] - gd.layout.xaxis.range[0]) / w - 10) < 1e-9);
  // A wheel that counts in lines (Firefox) zooms as far for three lines as one that counts 100 px.
  c.priceView = null; await h.draw();
  h.wheel(700, -3, { deltaMode: 1 }); await h.frame();
  const lines = gd.layout.xaxis.range[1] - gd.layout.xaxis.range[0];
  c.priceView = null; await h.draw();
  h.wheel(700, -99); await h.frame();
  assert.equal(gd.layout.xaxis.range[1] - gd.layout.xaxis.range[0], lines);
});

test('the wheel is left alone with Ctrl or Command, off the plot and before a chart is drawn; small turns draw once a bar, once a frame', async () => {
  const h = page(), { c, gd } = h;
  assert.equal(h.wheel(700, -100).prevented, false, 'no chart yet');
  await h.draw();
  const full = plain(gd.layout.xaxis.range);
  for (const more of [{ ctrlKey: true }, { metaKey: true }, { clientY: 900 }, { clientY: -5 }]) {
    assert.equal(h.wheel(700, -100, more).prevented, false, JSON.stringify(more));
    await h.frame();
    assert.deepEqual(plain(gd.layout.xaxis.range), full, JSON.stringify(more));
  }
  assert.equal(h.wheel(-3, -100).prevented, false, 'left of the plot'); assert.equal(h.wheel(h.W + 3, -100).prevented, false, 'right of it');
  assert.equal(c.priceView, null);
  // A touchpad's small turns: many events, one draw a frame, and none while the bars in view are the same.
  h.draws = 0;
  for (let i = 0; i < 12; i++) h.wheel(700, -4);
  assert.equal(h.raf.length, 1, 'one draw waiting however many events');
  await h.frame();
  assert.equal(h.draws, 1);
  const zoomed = plain(gd.layout.xaxis.range);
  assert.ok(zoomed[1] - zoomed[0] < full[1]);
  h.draws = 0;
  const asked = c.priceView.hi - c.priceView.lo;
  h.wheel(700, -0.05); await h.frame();
  assert.equal(h.draws, 0, 'too small a turn to change the bars in view draws nothing');
  assert.deepEqual(plain(gd.layout.xaxis.range), zoomed);
  assert.ok(c.priceView.hi - c.priceView.lo < asked, 'but it is kept, and adds up');
});

test('the left button, held and dragged, moves a zoomed price axis with the pointer; sideways wheel and Shift do the same; nothing moves the whole axis', async () => {
  const h = page(), { c, gd } = h;
  await h.draw();
  const w = h.data.binWidth, full = gd.layout.xaxis.range[1], W = h.W;
  // On the whole axis a left drag does nothing: no mark, no move.
  h.down(500); h.move(560); h.move(700); await h.frame(); h.up(); await h.frame();
  assert.deepEqual(plain(gd.layout.xaxis.range), [0, full]);
  assert.equal(c.rangeMark, null, 'the left button marks nothing');
  assert.ok(!h.classes.has('panning'));
  c.priceView = { lo: 30000, hi: 45000 };
  await h.draw();
  const [a0, b0] = gd.layout.xaxis.range, span = b0 - a0;
  // Dragged 300 px to the right: the bars follow the pointer, so lower prices come into view.
  h.down(600);
  h.move(602); await h.frame();
  assert.deepEqual(plain(gd.layout.xaxis.range), [a0, b0], 'not before the pointer has moved 4 px');
  assert.ok(!h.classes.has('panning'));
  h.move(700); await h.frame();
  assert.ok(h.classes.has('panning'), 'the closed hand while it is held');
  h.move(900); await h.frame();
  let [a, b] = gd.layout.xaxis.range;
  assert.ok(Math.abs((a0 - a) - 300 / W * span) <= w, `moved with the pointer (${a0 - a} for ${300 / W * span})`);
  assert.ok(Math.abs((b - a) - span) < 1e-6, 'as wide as it was');
  assert.ok(Math.abs(Math.round(a / w) - a / w) < 1e-9, 'a bar at a time');
  h.up(); await h.frame();
  assert.ok(!h.classes.has('panning'));
  assert.equal(c.rangeMark, null);
  // It stops at the ends of the axis.
  h.down(600); h.move(600 + 50 * W); await h.frame(); h.up();
  assert.equal(gd.layout.xaxis.range[0], 0);
  h.down(600); h.move(600 - 50 * W); await h.frame(); h.up();
  assert.ok(Math.abs(gd.layout.xaxis.range[1] - Math.ceil(full / w - 1e-9) * w) < 1e-6);
  // The wheel turned sideways, or with Shift, moves the view: to the right, higher prices.
  c.priceView = { lo: 30000, hi: 45000 };
  await h.draw();
  [a, b] = gd.layout.xaxis.range;
  assert.ok(h.wheel(700, 0, { deltaX: 150 }).prevented); await h.frame();
  assert.ok(Math.abs((gd.layout.xaxis.range[0] - a) - 150 / W * span) <= w);
  assert.ok(Math.abs((gd.layout.xaxis.range[1] - gd.layout.xaxis.range[0]) - span) < 1e-6, 'moved, not zoomed');
  [a] = gd.layout.xaxis.range;
  h.wheel(700, -150, { shiftKey: true }); await h.frame();
  assert.ok(Math.abs((a - gd.layout.xaxis.range[0]) - 150 / W * span) <= w, 'Shift turns the wheel sideways');
  // Sideways on the whole axis: nowhere to go.
  c.priceView = null; await h.draw();
  h.wheel(700, 0, { deltaX: 300 }); await h.frame();
  assert.equal(c.priceView, null);
});

test('the right button marks a range (so does Ctrl with the left), two quick right-clicks clear it, and the browser\'s menu stays shut over the plot', async () => {
  const h = page(), { c, gd } = h;
  await h.draw();
  const w = h.data.binWidth, W = h.W, full = gd.layout.xaxis.range[1];
  const drag = async (x0, x1, button, more) => { h.down(x0, button, more); for (let x = x0; x !== x1; x += Math.sign(x1 - x0) * 5) h.move(x); h.move(x1); await h.frame(); h.up(); await h.frame(); };
  await drag(400, 520, 2);
  assert.ok(c.rangeMark, 'marked with the right button');
  assert.ok(Math.abs(c.rangeMark.lo - Math.floor(400 / W * full / w) * w) < 1e-6 && Math.abs(c.rangeMark.hi - Math.ceil(520 / W * full / w) * w) < 1e-6, 'whole bars under the drag');
  const first = plain(c.rangeMark);
  // A single right-click leaves it; a second within 450 ms at the same place clears it.
  h.down(800, 2); h.up(); await h.frame();
  assert.deepEqual(plain(c.rangeMark), first);
  h.clock.t += 200;
  h.down(801, 2); h.up(); await h.frame();
  assert.equal(c.rangeMark, null, 'two quick right-clicks clear the mark');
  // Not two clicks far apart in time or place.
  await drag(400, 520, 2);
  h.down(800, 2); h.up(); h.clock.t += 600; h.down(800, 2); h.up(); await h.frame();
  assert.ok(c.rangeMark, 'too slow');
  h.clock.t += 1000;
  h.down(800, 2); h.up(); h.clock.t += 100; h.down(830, 2); h.up(); await h.frame();
  assert.ok(c.rangeMark, 'too far apart');
  // Two quick left clicks do not clear a mark (they belong to the zoom).
  h.clock.t += 1000;
  h.down(800); h.up(); h.clock.t += 100; h.down(800); h.up(); await h.frame();
  assert.ok(c.rangeMark, 'the left button leaves the mark alone');
  // Ctrl and the left button mark too, for a mouse with one button.
  c.rangeMark = null; await h.draw();
  await drag(900, 1000, 0, { ctrlKey: true });
  assert.ok(c.rangeMark && Math.abs(c.rangeMark.lo - Math.floor(900 / W * full / w) * w) < 1e-6);
  // The other buttons do nothing.
  c.rangeMark = null; await h.draw();
  await drag(400, 520, 1);
  assert.equal(c.rangeMark, null);
  // The browser's menu: shut over the plot, open elsewhere, and shut for a moment after a mark is let go wherever
  // the pointer is (Windows opens it when the button comes up).
  h.clock.t += 5000;
  assert.equal(h.menu(600), true, 'over the plot');
  assert.equal(h.menu(600, 900), false, 'below the plot');
  assert.equal(h.menu(-40), false, 'left of the plot');
  h.down(400, 2); h.move(480); await h.frame(); h.up();
  assert.equal(h.menu(-40), true, 'just after a mark is let go, anywhere');
  h.clock.t += 500;
  assert.equal(h.menu(-40), false, 'and not for long');
});

test('a double-click gives the whole axis back, and so does Escape, after a marked range has gone', async () => {
  const h = page(), { c, gd } = h;
  await h.draw();
  const full = plain(gd.layout.xaxis.range);
  c.priceView = { lo: 30000, hi: 45000 };
  await h.draw();
  // One click: nothing. A second within 450 ms at the same place: the whole axis.
  h.down(700); h.up(); await h.frame();
  assert.ok(c.priceView);
  h.clock.t += 200;
  h.down(702); h.up(); await h.frame();
  assert.equal(c.priceView, null);
  assert.deepEqual(plain(gd.layout.xaxis.range), full);
  // Too slow, or after a drag: not a double-click.
  c.priceView = { lo: 30000, hi: 45000 }; await h.draw();
  h.clock.t += 5000;
  h.down(700); h.up(); h.clock.t += 600; h.down(700); h.up(); await h.frame();
  assert.ok(c.priceView, 'too slow');
  h.clock.t += 5000;
  h.down(700); h.up(); h.clock.t += 100; h.down(700); h.move(760); await h.frame(); h.up(); await h.frame();
  assert.ok(c.priceView, 'a drag is not a click');
  // Escape: a marked range first, then the zoom.
  c.rangeMark = { lo: 32000, hi: 36000 }; c.priceView = { lo: 30000, hi: 45000 }; await h.draw();
  h.key('Escape'); await h.frame();
  assert.equal(c.rangeMark, null); assert.ok(c.priceView, 'the first Escape clears the mark');
  h.key('Escape'); await h.frame();
  assert.equal(c.priceView, null, 'the second gives the whole axis back');
  assert.deepEqual(plain(gd.layout.xaxis.range), full);
});

test('the view stays across days, weightings and settings, and each day draws it on its own bars', async () => {
  const h = page(), { c, gd } = h;
  c.priceView = { lo: 30000, hi: 45000 };
  await h.draw();
  const first = plain(gd.layout.xaxis.range);
  c.coinMode = true; await h.draw();
  assert.deepEqual(plain(gd.layout.xaxis.range), first, '% BTC');
  c.coinMode = false; c.splitMode = true; await h.draw();
  assert.deepEqual(plain(gd.layout.xaxis.range), first, 'LTH/STH');
  // Other bins: the same prices, on that setting's bar edges.
  c.NUM_BINS = 300;
  h.data = c.buildData(c.allDates[50], h.raw);
  await h.draw();
  const w = h.data.binWidth, [a, b] = gd.layout.xaxis.range;
  assert.ok(Math.abs(a - 30000) <= w / 2 + 1e-6 && Math.abs(b - 45000) <= w + 1e-6, `${a} to ${b}`);
  assert.ok(Math.abs(Math.round(a / w) - a / w) < 1e-9 && Math.abs(Math.round(b / w) - b / w) < 1e-9);
  assert.deepEqual(plain(c.priceView), { lo: 30000, hi: 45000 }, 'what was asked for is kept as asked');
});

test('a marked range in a zoomed view: its lines between the bars in view, its box over the part in view with the whole mark\'s figures', async () => {
  // The bars as Plotly draws them from the view's left edge: each edge at its position in px, rounded to 0.01, then to a
  // whole pixel, less 0.01 for the hairline outline (as tests/axes.test.cjs has them on the whole axis).
  const drawnBars = (gd, m, lo) => {
    const out = [];
    for (const tr of gd.data.filter(t => t.type === 'bar')) tr.x.forEach((x, i) => {
      if (!(tr.y[i] > 0)) return;
      const p0 = x - tr.width[i] / 2 - lo, p1 = p0 + tr.width[i];
      out.push([Math.round(r2(p0 * m)) - 0.01, Math.round(r2(p1 * m)) - 0.01]);
    });
    return out;
  };
  const covered = (bars, a, b) => bars.reduce((s, [x0, x1]) => s + Math.max(0, Math.min(x1, b) - Math.max(x0, a)), 0);
  for (const [W, bins, dpr, view] of [[1498, 625, 1, [20000, 45000]], [1252, 625, 1, [10000, 60000]], [1600, 300, 1, [30000, 40000]], [1120, 1000, 1, [5000, 65000]], [1120, 1000, 2, [5000, 65000]], [1300, 1000, 2, [1000, 70000]]]) {
    const h = page({ W, bins, dpr }), { c, gd } = h;
    c.priceView = { lo: view[0], hi: view[1] };
    await h.draw();
    const [lo, hi] = gd.layout.xaxis.range, span = hi - lo, m = W / span, w = h.data.binWidth, pitch = W * w / span, gaps = pitch >= 2;
    const what = `${W} px, ${bins} bins, ${dpr}x, $${lo} to $${hi} (a ${pitch.toFixed(2)} px pitch)`;
    const bars = drawnBars(gd, m, lo), seps = [];
    const sepTrace = gd.data.find(t => t.meta === 'separators');
    assert.equal(!!sepTrace, !gaps && pitch * dpr >= 1, `separators only between bars too narrow for a gap (${what})`);
    if (sepTrace) sepTrace.x.forEach(x => { if (x !== null) { assert.ok(x > lo - w && x < hi + w, `a separator in view (${what})`); seps.push(r2((x - lo) * m)); } });
    const checkLine = (centre, width, label) => {
      if (gaps) { assert.equal(width, 1, label); assert.ok(covered(bars, centre - 0.5, centre + 0.5) < 0.02, `${label}: in a gap, on no bar (${what})`); return; }
      assert.equal(width, 1 / dpr, `${label}: a device pixel wide (${what})`);
      const near = seps.reduce((b, s) => Math.abs(s - centre) < Math.abs(b - centre) ? s : b, Infinity);
      if (Math.abs(near - centre) < pitch / 2) assert.ok(Math.abs(near - centre) < 0.011, `${label}: on the separator (${what})`);
    };
    // Dragged with the right button from 30% of the way along the view, a pixel at a time.
    const x0 = Math.round(0.3 * W) + 0.4;
    h.down(x0, 2);
    for (let dx = 5; dx <= 45; dx += 4) {
      h.move(x0 + dx);
      while (h.raf.length) h.raf.shift()();
      const band = h.made[h.made.length - 2].style;
      const l = parseFloat(band.left), wd = parseFloat(band.width), bl = parseFloat(band.borderLeftWidth), br = parseFloat(band.borderRightWidth);
      checkLine(l + bl / 2, bl, `the dragged band's left line at +${dx} px`);
      checkLine(l + wd - br / 2, br, `the dragged band's right line at +${dx} px`);
    }
    const last = h.made[h.made.length - 2].style, lastL = parseFloat(last.left), lastR = lastL + parseFloat(last.width);
    h.up(); await h.frame();
    const lines = gd.layout.shapes.filter(s => s.type === 'line' && s.line.color === c.MARK_EDGE);
    assert.equal(lines.length, 2, what);
    assert.ok(Math.abs(r2((lines[0].x0 - lo) * m) - (lastL + lines[0].line.width / 2)) < 0.011, `the drawn left line where the dragged one was (${what})`);
    assert.ok(Math.abs(r2((lines[1].x0 - lo) * m) - (lastR - lines[1].line.width / 2)) < 0.011, `the drawn right line where the dragged one was (${what})`);
    lines.forEach((ln, i) => checkLine(r2((ln.x0 - lo) * m), ln.line.width, `the drawn ${i ? 'right' : 'left'} line`));
    assert.ok(c.rangeMark.lo >= lo - 1e-6 && c.rangeMark.hi <= hi + 1e-6 && Math.abs(c.rangeMark.lo - (lo + Math.floor(x0 / W * span / w) * w)) < 1e-6, `the prices under the drag, in the view (${what})`);
  }
  // A mark the view cuts: drawn as far as the view goes, its box over that part, its words the whole mark's.
  const h = page(), { c, gd } = h;
  const markBox = () => gd.layout.annotations.find(a => a.xref === 'x' && a.width);
  const flat = a => a.text.replace(/<br>/g, ' ').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<');
  c.rangeMark = { lo: 30000, hi: 50000 };
  await h.draw();
  const whole = flat(markBox());
  assert.match(whole, /^Price: \$30,000 – \$50,000 /);
  c.priceView = { lo: 40000, hi: 70000 };
  await h.draw();
  const [lo, hi] = gd.layout.xaxis.range, m = h.W / (hi - lo), box = markBox(), w = h.data.binWidth;
  assert.match(flat(box), /^Price: \$30,000 – \$50,000 /, 'the box names the whole mark');
  const share = /Last Moved Here: [\d.]+%/.exec(whole)[0];
  assert.ok(flat(box).includes(share), 'and gives its share of the day: ' + share);
  const tint = gd.layout.shapes.find(s => s.type === 'rect' && s.fillcolor === c.MARK_TINT);
  assert.ok(tint.x0 >= lo - w && tint.x0 <= lo + w && Math.abs(tint.x1 - 50000) <= w, 'tinted from the view\'s edge to the mark\'s end');
  assert.ok(box.x >= lo - 1e-6 && (box.x - lo) * m + box.width <= (50000 - lo) * m + w * m, 'the box inside the part in view');
  // A mark out of view altogether: nothing drawn, and it is still there when the view comes back.
  c.priceView = { lo: 55000, hi: 70000 };
  await h.draw();
  assert.ok(!markBox() && !gd.layout.shapes.some(s => s.fillcolor === c.MARK_TINT));
  assert.deepEqual(plain(c.rangeMark), { lo: 30000, hi: 50000 });
});

test('a narrow zoomed plot labels fewer price steps, and a long last label ends at its gridline', async () => {
  const h = page({ W: 520 }), { c, gd } = h;
  c.priceView = { lo: 61000, hi: 63000 };
  await h.draw();
  const shown = gd.layout.xaxis.ticktext.map((s, k) => [k, s.replace(/ /g, '')]).filter(([, s]) => s);
  assert.ok(shown.length < 21 && shown.length >= 2, 'fewer labels than steps');
  assert.equal(gd.layout.xaxis.tickvals.length, 21, 'every gridline stays');
  const px = (s) => s.length * 0.6 * 11 * 1.07, step = (shown[1][0] - shown[0][0]) * 520 / 20;
  assert.ok(px(shown[0][1]) + px(shown[1][1]) / 2 + 8 <= step + 1e-9, 'the first label, starting at its line, clears the next');
  // Labels in this view need more figures than two: no two the same.
  assert.equal(new Set(shown.map(([, s]) => s)).size, shown.length);
  // A label too long for the margin beside the plot ends at its line.
  assert.deepEqual(plain(c.windowLabels([61000, 61100, 61200])), ['$61K', '$61.1K', '$61.2K']);
  assert.deepEqual(plain(c.windowLabels([61000, 61010, 61020])), ['$61K', '$61.01K', '$61.02K']);
  assert.deepEqual(plain(c.windowLabels([0.5, 0.51, 0.52])), ['$0.5', '$0.51', '$0.52']);
  assert.deepEqual(plain(c.windowLabels([1234567.1, 1234567.2])), ['$1,234,567.1', '$1,234,567.2'], 'written out where seven figures do not tell them apart');
});

test('the explainer and the README say what the mouse does, in every language', () => {
  const m = html.match(/var EXPLAINER = (\{[\s\S]*?\n\});/);
  const E = eval('(' + m[1] + ')');
  const titles = { en: ['Hovering a bar', 'Zooming the price axis', 'Marking a price range'], zh: ['悬停查看柱子', '缩放价格轴', '标记价格区间'], ja: ['棒にカーソルを合わせる', '価格軸を拡大・縮小する', '価格の範囲に印を付ける'] };
  for (const lang of ['en', 'zh', 'ja']) {
    const names = E[lang].sections.map(s => s[0]), at = names.indexOf(titles[lang][1]);
    assert.deepEqual(names.slice(at - 1, at + 2), titles[lang], lang);
    assert.equal(E[lang].sections.length, 22, lang);
  }
  const text = (lang, title) => E[lang].sections.find(s => s[0] === title)[1];
  assert.match(text('en', 'Zooming the price axis'), /mouse wheel.*left mouse button.*Double-click the chart or press Escape/);
  assert.match(text('en', 'Marking a price range'), /^Hold the right mouse button down and drag.*right-click the chart twice in quick succession or press Escape/);
  assert.doesNotMatch(text('en', 'Marking a price range'), /double-click|Click and drag/);
  assert.match(text('zh', '缩放价格轴'), /滚轮.*鼠标左键.*双击图表或按 Esc 键/); assert.match(text('zh', '标记价格区间'), /^在图表上按住鼠标右键.*快速右键单击两次或按 Esc 键/);
  assert.match(text('ja', '価格軸を拡大・縮小する'), /マウスホイール.*左ボタン.*ダブルクリックするか Esc キー/); assert.match(text('ja', '価格の範囲に印を付ける'), /^チャート上でマウスの右ボタン.*2 回右クリックするか Esc キー/);
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  assert.match(readme, /\*\*Mouse wheel\*\* over the chart — zoom the price axis/);
  assert.match(readme, /\*\*Hold the right button and drag\*\* across the chart/);
  assert.doesNotMatch(readme, /\*\*Click and drag\*\*/);
  assert.match(readme, /on a phone the chart itself does not pan or zoom\./);
  // The hand over a zoomed plot, the closed hand while it is held.
  assert.match(html, /body\.zoomed #chart \.nsewdrag \{ cursor: grab !important; \}/);
  assert.match(html, /body\.panning, body\.panning \* \{ cursor: grabbing !important; user-select: none; \}/);
});

test('a phone keeps the chart a picture: no wheel, no drag, no mark', async () => {
  const listeners = (overrides) => {
    const win = {}, h = app({ addEventListener(type, fn) { (win[type] = win[type] || []).push(fn); }, ...overrides });
    return { mobile: h.c.IS_MOBILE, wheel: h.element('chart').listenerCount('wheel'), mousedown: h.element('chart').listenerCount('mousedown'), menu: (win.contextmenu || []).length };
  };
  assert.deepEqual(listeners({}), { mobile: false, wheel: 1, mousedown: 1, menu: 1 }, 'a desktop reads the wheel and both buttons');
  assert.deepEqual(listeners({ __PHONE: { w: 2000, h: 924 } }), { mobile: true, wheel: 0, mousedown: 0, menu: 0 }, 'a phone reads none of them');
});
