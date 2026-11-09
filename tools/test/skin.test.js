// node tools/test/skin.test.js
//
// loads js/skin.js the way the page does, a classic script, in a vm context
// with no performance, a Date that throws and a Math.random that throws, so
// the skin cannot lean on the wall clock or on chance. checks where homes
// land on a rounded rect, how a ring is laid out and kept in grain as its
// target grows and shrinks, that it steps alike at any frame rate, and that
// screen() makes nothing once it has made its points. exits 1 on failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;

// --- the script --------------------------------------------------------------
const math = Object.create(Math);
math.random = () => { throw new Error('Math.random used'); };
const ctx = vm.createContext({ Math: math, Date: function () { throw new Error('Date used'); } });
const file = path.join(ROOT, 'js', 'skin.js');
vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
// top-level const and class live in the realm's shared scope, as on the page
const { SKIN, Skin } = vm.runInContext('({ SKIN, Skin })', ctx);

check('globals defined', typeof SKIN === 'object' && typeof Skin === 'function');
check('JOIN is under SPLIT, so they do not fight', SKIN.JOIN < SKIN.SPLIT, SKIN.JOIN + ' < ' + SKIN.SPLIT);

// the shapes: the o shut, the about box open, a box with square corners,
// one whose corners are as round as they go (a stadium) and a small one
const O = { x0: 132.82, y0: 254.97, x1: 166.22, y1: 293.18, r: 16.7 };
const WIDE = { x0: 7.32, y0: 228.86, x1: 1272.32, y1: 792.86, r: 10 };
const SQUARE = { x0: 10, y0: 20, x1: 210, y1: 120, r: 0 };
const STADIUM = { x0: 0, y0: 0, x1: 300, y1: 40, r: 50 };
const SMALL = { x0: 50, y0: 50, x1: 56, y1: 57, r: 1 };
const SHAPES = { o: O, wide: WIDE, square: SQUARE, stadium: STADIUM };

// a rounded rect's corners' radius, clamped as the skin and roundRect clamp it
const radius = (t) => Math.max(0, Math.min(t.r, (t.x1 - t.x0) / 2, (t.y1 - t.y0) / 2));
// how far (x, y) is off a rounded rect's outline, either way
function off(t, x, y) {
  const r = radius(t), hw = (t.x1 - t.x0) / 2, hh = (t.y1 - t.y0) / 2;
  const qx = Math.abs(x - (t.x0 + hw)) - (hw - r), qy = Math.abs(y - (t.y0 + hh)) - (hh - r);
  return Math.abs(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r);
}
// the length round a rounded rect, worked out from its sides
const perimeter = (t) => { const r = radius(t); return 2 * (t.x1 - t.x0 - 2 * r) + 2 * (t.y1 - t.y0 - 2 * r) + 2 * Math.PI * r; };

// --- homes -------------------------------------------------------------------
for (const [name, t] of Object.entries(SHAPES)) {
  let worst = 0, rising = true, last = -Infinity;
  for (let i = 0; i < 4000; i++) {
    const u = i / 4000, h = Skin.home(t, u);
    worst = Math.max(worst, off(t, h.x, h.y));
    if (!(h.s >= last) || (i > 0 && !(h.s > last) && perimeter(t) > 0)) rising = false;
    last = h.s;
  }
  check('homes: on the outline, ' + name, worst <= 1e-9, 'worst ' + worst.toExponential(2));
  check('homes: s rises with u, ' + name, rising);
  const len = Skin.length(t), end = Skin.home(t, 1 - 1e-12);
  check('homes: the length is the perimeter, and s reaches it, ' + name,
    near(len, perimeter(t), 1e-9) && near(end.s, len, 1e-6) && Skin.home(t, 0).s === 0, len.toFixed(6) + ' ' + end.s.toFixed(6));

  // the anchors: u = k / 8 on the edges' middles and the corners' arcs' middles
  const r = radius(t), cx = (t.x0 + t.x1) / 2, cy = (t.y0 + t.y1) / 2, d = r - r / Math.SQRT2;
  const want = [
    [cx, t.y0], [t.x1 - d, t.y0 + d], [t.x1, cy], [t.x1 - d, t.y1 - d],
    [cx, t.y1], [t.x0 + d, t.y1 - d], [t.x0, cy], [t.x0 + d, t.y0 + d],
  ];
  let anchors = true, bad = '';
  for (let k = 0; k < 8; k++) {
    const h = Skin.home(t, k / 8);
    if (!near(h.x, want[k][0], 1e-9) || !near(h.y, want[k][1], 1e-9)) { anchors = false; bad = bad || k + ': ' + h.x + ',' + h.y; }
  }
  check('homes: u = k / 8 lands on the edges\' and the corners\' middles, ' + name, anchors, bad);

  // within an eighth, u goes evenly along its length: equal steps of u make
  // equal steps of s, and s is the distance along the outline
  let even = true;
  for (let k = 0; k < 8 && even; k++) {
    const a = Skin.home(t, k / 8), b = Skin.home(t, (k + 0.5) / 8), c = Skin.home(t, (k + 1 - 1e-12) / 8);
    if (!near(b.s - a.s, c.s - b.s, 1e-6)) even = false;
  }
  let along = 0;
  for (let i = 0; i < 20000; i++) {
    const a = Skin.home(t, i / 20000), b = Skin.home(t, (i + 1) / 20000);
    along += Math.hypot(b.x - a.x, b.y - a.y);
  }
  check('homes: within an eighth s goes evenly with u, and is the length along, ' + name, even && near(along, perimeter(t), 1e-3 * perimeter(t)), along.toFixed(3));
}

// --- settle ------------------------------------------------------------------
// the gaps between neighbours' homes round the ring
function gaps(skin, t) {
  const pts = skin.points, n = pts.length, len = Skin.length(t), out = [];
  for (let i = 0; i < n; i++) {
    let g = pts[(i + 1) % n].s - pts[i].s;
    if (g < 0) g += len;
    out.push(g);
  }
  return out;
}
const worstOff = (skin) => skin.points.reduce((w, p) => Math.max(w, Math.hypot(p.x - p.hx, p.y - p.hy)), 0);
for (const [name, t] of Object.entries(SHAPES)) {
  const skin = new Skin(t), n = skin.points.length;
  const homed = skin.points.every((p) => { const h = Skin.home(t, p.u); return p.x === h.x && p.y === h.y && p.px === p.x && p.py === p.y; });
  const g = gaps(skin, t), lo = Math.min(...g), hi = Math.max(...g);
  check('settle: every point on its home and still, ' + name, homed);
  check('settle: gaps within JOIN / 2 and SPLIT, ' + name, lo >= SKIN.JOIN / 2 - 1e-9 && hi <= SKIN.SPLIT + 1e-9, n + ' points, gaps ' + lo.toFixed(3) + ' to ' + hi.toFixed(3));
  check('settle: count within LEAST and MOST, ' + name, n >= SKIN.LEAST && n <= SKIN.MOST, n);
  const uo = skin.points.every((p, i) => i === 0 || p.u > skin.points[i - 1].u);
  check('settle: in order round the outline, from an anchor at u = 0, ' + name, uo && skin.points[0].u === 0);
}
{
  const small = new Skin(SMALL), huge = new Skin({ x0: 0, y0: 0, x1: 4000, y1: 3000, r: 20 });
  check('settle: a small ring keeps LEAST', small.points.length >= SKIN.LEAST, small.points.length);
  check('settle: a huge ring takes no more than MOST', huge.points.length <= SKIN.MOST && huge.points.length > SKIN.MOST - 16, huge.points.length);
}

// --- growing and shrinking ---------------------------------------------------
{
  const skin = new Skin(O), n0 = skin.points.length;
  let most = 0, gapOk = true, finite = true, worstGap = 0;
  for (let i = 0; i < 180; i++) {
    skin.step(1 / 60, WIDE);
    most = Math.max(most, skin.points.length);
    const g = Math.max(...gaps(skin, WIDE));
    worstGap = Math.max(worstGap, g);
    if (g > SKIN.SPLIT + 1e-9) gapOk = false;
    if (!skin.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) finite = false;
  }
  const grown = skin.points.length;
  check('grow: the count grows', grown > n0, n0 + ' to ' + grown);
  check('grow: no gap past SPLIT after any step', gapOk, 'worst ' + worstGap.toFixed(3));
  check('grow: no more than MOST', most <= SKIN.MOST, most);
  check('grow: every point stays a number', finite);
  check('grow: lands on its homes within 0.05 px in 3 s', worstOff(skin) < 0.05, worstOff(skin).toFixed(4));
  for (let i = 0; i < 180; i++) skin.step(1 / 60, O);
  check('shrink: sheds points', skin.points.length < grown && skin.points.length >= SKIN.LEAST, grown + ' to ' + skin.points.length);
  check('shrink: lands back on its homes within 0.05 px in 3 s', worstOff(skin) < 0.05, worstOff(skin).toFixed(4));
  const g = gaps(skin, O);
  check('shrink: its gaps under SPLIT', Math.max(...g) <= SKIN.SPLIT + 1e-9, Math.min(...g).toFixed(3) + ' to ' + Math.max(...g).toFixed(3));

  // past MOST it stops taking points
  const big = new Skin(O), HUGE = { x0: 0, y0: 0, x1: 4000, y1: 3000, r: 20 };
  let over = 0;
  for (let i = 0; i < 120; i++) { big.step(1 / 60, HUGE); over = Math.max(over, big.points.length); }
  check('grow: a target past MOST\'s reach takes MOST and no more', over === SKIN.MOST, over);
}

// --- frame rate --------------------------------------------------------------
// the same second stepped in frames of 1/30, 1/60 and 1/144 s runs the same
// steps toward the same target, so the points land in the same places
{
  const run = (dt) => {
    const skin = new Skin(O);
    let steps = 0;
    const n = Math.round(1 / dt);
    for (let i = 0; i < n; i++) steps += skin.step(dt, WIDE);
    return { skin, steps };
  };
  const a = run(1 / 30), b = run(1 / 60), c = run(1 / 144);
  const same = (p, q) => p.skin.points.length === q.skin.points.length &&
    p.skin.points.every((x, i) => near(x.x, q.skin.points[i].x, 1e-9) && near(x.y, q.skin.points[i].y, 1e-9));
  check('frame rate: the same steps at 30, 60 and 144 hz', a.steps === b.steps && b.steps === c.steps, a.steps + ' ' + b.steps + ' ' + c.steps);
  check('frame rate: the same places at 30, 60 and 144 hz', same(a, b) && same(b, c));
  const stall = new Skin(O);
  check('frame rate: a stall catches up no more than CATCH_UP', stall.step(5, WIDE) === Math.floor((SKIN.CATCH_UP + 1e-6) / SKIN.STEP));
}

// --- bounds and screen -------------------------------------------------------
{
  const skin = new Skin(WIDE), b = skin.bounds();
  check('bounds: the points\' box', near(b.x0, WIDE.x0, 1e-9) && near(b.x1, WIDE.x1, 1e-9) && near(b.y0, WIDE.y0, 1e-9) && near(b.y1, WIDE.y1, 1e-9),
    [b.x0, b.y0, b.x1, b.y1].map((v) => v.toFixed(3)).join(' '));
  const first = skin.screen(-100), objects = first.slice();
  const ok1 = first.length === skin.points.length && first.every((v, i) => v.x === skin.points[i].x && v.y === skin.points[i].y - 100);
  skin.step(1 / 60, WIDE);
  const second = skin.screen(5);
  const ok2 = second === first && second.every((v, i) => v === objects[i] && v.x === skin.points[i].x && v.y === skin.points[i].y + 5);
  check('screen: each point dy down', ok1);
  check('screen: the same array and objects come back, refilled', ok2);
}

console.log(failures ? failures + ' failed' : 'all passed');
process.exit(failures ? 1 : 0);
