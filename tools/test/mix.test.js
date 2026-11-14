// node tools/test/mix.test.js
//
// loads js/wall.js and js/mix.js the way the page does, classic scripts
// sharing one global scope, in a vm context whose Date, performance,
// timers and Math.random throw, so the tray cannot keep time or draw
// randomness of its own; every tray is given a seeded random. drives it as
// a page would, pressing, moving in small steps with a frame between and
// lifting, then stepping until it is no longer busy. checks that a tap on
// a cell picks its colour and leaves the tray empty, a tap on paint picks
// the colour it shows and moves and mixes nothing, and a tap on bare tray
// picks nothing; that a glob dropped into the tray, the pointer there at once
// and let go, lands as exactly the pen's stamp at the let-go point, one
// layer, at every size, and one pulled in gives more paint on the way and
// lands in its colour, one layer; that a glob let go before the tray leaves nothing on it and nothing held; that
// random drags, fast, slow and out of the grid, never change the count
// but by the globs pulled in, and each settle comes to rest, all on the
// tray; that a colour pulled into another mixes before anything is let go
// and the paint's total is kept; that nothing mixes or moves while the
// pointer is still once it has settled; that yellow and blue stirred long
// enough end as one green; that step(dt) keeps time at 60 and 120 a
// second, a glob of one grain too, and takes no more than 4 FOLLOW steps
// however large dt is; that erase() takes away every grain of the piles
// in its box and no other, what the pen has picked up too, with as much
// of the box as is on the tray; that a tray keeps
// FULL of the biggest pen's worths, never more than a grain a pixel, and
// what is over what it keeps dries away off the paint's edges, DRY of it
// a second at 60 and 120 a second, down to what it keeps and no further,
// at rest and while it is dragged; and that a
// cell held gives FLOW pens' worths a second, at 60 and 120 a second, all
// of it put down when let go over the tray, none while the pointer is
// still in the cell, no more than a second's worth in the air, and all of
// it home again when let go there; and that paint dragged, once it is put down, leaves the
// colour it shows nearest the pen as the one mixed, and a tap none; and
// that the tray's shares are the blob's: the paint last tapped or put
// down and all the paint touching it, eight ways, or, while paint is
// dragged, what the pen has picked up; the colours it shows, the most
// first, each weighed by its pixels, and none of the paint not touching
// it; that a tap on bare tray or a glob let go in the air leaves the blob
// as it was, the tray erased leaves none, its grains drying away keep it right,
// and the picture is painted again as it changes; and that outline()
// marks exactly the bare pixels within r px, across and down, of the
// blob, and nothing past the tray's edges. prints, not
// checks, the ms a frame takes with about 2500 grains dragged, timed in
// node's own realm. exits 1 on failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail !== undefined && detail !== '' ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}

// --- the scripts ----------------------------------------------------------------
let reads = 0;
const sandbox = {};
for (const name of ['Date', 'performance', 'setTimeout', 'setInterval', 'requestAnimationFrame']) {
  Object.defineProperty(sandbox, name, { get() { reads++; throw new Error('the tray read ' + name); } });
}
const ctx = vm.createContext(sandbox);
for (const file of ['js/wall.js', 'js/mix.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
}
vm.runInContext('Math.random = function () { throw new Error("the tray read Math.random"); };', ctx);
const { Mix, MIX, Wall, WALL } = vm.runInContext('({ Mix, MIX, Wall, WALL })', ctx);
const COLOURS = WALL.COLOURS;

// --- helpers --------------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
// a tray the size of the prototype's, with room above it for four rows of cells
const W = 100, H = 132, UP = 120, DT = 1 / 60;
// it keeps all its paint, however much; drier's keeps what a page's does
const drier = (seed) => new Mix(COLOURS, W, H, UP, mulberry32(seed));
const tray = (seed) => Object.assign(drier(seed), { most: Infinity });

// colour i's cell: 22 px, 26 apart, four across, in the air above the tray.
// its box is the inside where its grains hide, and (cx, cy) its middle
function cell(i) {
  const x = 26 * (i % 4), y = -116 + 26 * ((i >> 2) % 4);
  return { box: { x0: x + 3, y0: y + 3, x1: x + 19, y1: y + 19 }, cx: x + 11, cy: y + 11 };
}
const index = (hex) => COLOURS.findIndex((c) => c.toLowerCase() === hex.toLowerCase());

const frames = (mix, n, dt = DT) => { for (let k = 0; k < n; k++) mix.step(dt); };
// steps until nothing is settling: how many it took
function rest(mix, most = 20000) {
  let k = 0;
  while (mix.busy && k < most) { mix.step(DT); k++; }
  return k;
}
// the pointer from (x0, y0) to (x1, y1) in moves of at most v px, a frame after each
function drag(mix, x0, y0, x1, y1, v) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / v));
  for (let k = 1; k <= n; k++) {
    mix.move(Math.round(x0 + (x1 - x0) * k / n), Math.round(y0 + (y1 - y0) * k / n));
    mix.step(DT);
  }
}
// a glob of colour c dropped at (x, y): the pointer from its cell straight
// there and let go at once, so the cell gives no more than a pen's worth,
// and settled
function glob(mix, c, x, y, size) {
  const b = cell(c);
  mix.hold(c, b.cx, b.cy, b.box, size);
  mix.move(x, y);
  const r = mix.lift();
  rest(mix);
  return r;
}
// a glob of colour c pulled out of its cell to (x, y) in moves of at most
// v px, the cell giving more as it goes, let go there and settled
function pullIn(mix, c, x, y, size, v = 3) {
  const b = cell(c);
  mix.hold(c, b.cx, b.cy, b.box, size);
  drag(mix, b.cx, b.cy, x, y, v);
  const r = mix.lift();
  rest(mix);
  return r;
}
// the pixels a pen of this size covers at (x, y), as a tray bitmap
function stamp(x, y, size) {
  const px = new Uint8Array(W * H);
  Wall.stamp(px, W, H, x, y, size, 1);
  return px;
}
const area = (size) => stamp(50, 66, size).reduce((a, v) => a + v, 0);

// where there is paint, as a tray bitmap
const covered = (mix) => Uint8Array.from(mix.tall, (v) => v > 0 ? 1 : 0);
const tallest = (mix) => mix.tall.reduce((a, v) => Math.max(a, v), 0);
// grains lying off the tray, or not where their pile says
function strays(mix) {
  let bad = 0;
  for (let g = 0; g < mix.n; g++) {
    const x = mix.gx[g], y = mix.gy[g];
    if (x < 0 || y < 0 || x >= W || y >= H) bad++;
  }
  let piled = 0;
  for (const v of mix.tall) piled += v;
  return bad + Math.abs(piled - mix.n);
}
// the sum of each of the four components of every grain's paint
function totals(mix) {
  const t = [0, 0, 0, 0];
  for (let g = 0; g < mix.n; g++) for (let k = 0; k < 4; k++) t[k] += mix.p[4 * g + k];
  return t;
}
// the list colours the tray shows
function shown(mix) {
  const px = new Int32Array(W * H);
  mix.paint(px, Int32Array.from(COLOURS, (_, i) => i), -1);
  return { px, set: [...new Set(px)].filter((v) => v >= 0) };
}
function flown(mix) {
  const out = [];
  mix.flying((x, y) => out.push([x, y]));
  return out;
}
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// --- taps -------------------------------------------------------------------------
{
  const mix = tray(1), b = cell(5);
  mix.hold(5, b.cx, b.cy, b.box, 16);
  check('a press on a cell holds its colour', mix.colour === 5 && mix.busy);
  frames(mix, 20);
  mix.move(b.cx + 2, b.cy - 3);
  frames(mix, 20);
  const r = mix.lift();
  check('a tap on a cell picks its colour', r.pick === 5, r.pick);
  check('and leaves the tray empty and nothing held', mix.count() === 0 && !mix.busy && mix.colour === -1 && flown(mix).length === 0);
  const edge = tray(2), e = cell(6);
  edge.hold(6, e.cx, e.cy, e.box, 8);
  edge.move(e.box.x1 + 1, e.cy);
  frames(edge, 10);
  check('2 px outside the box is still a tap', edge.lift().pick === 6);
  edge.hold(6, e.cx, e.cy, e.box, 8);
  edge.move(e.box.x1 + 2, e.cy);
  frames(edge, 10);
  check('3 px outside it is not', edge.lift().pick === -1);
  rest(edge);
  check('and that glob, let go in the air, goes home', edge.count() === 0 && !edge.busy);
}

{
  const mix = tray(3);
  glob(mix, 9, 50, 66, 16);
  // a second colour pressed into it, so the tap lands on mixed paint
  glob(mix, 13, 50, 72, 12);
  const n = mix.count(), xs = mix.gx.slice(0, n), ys = mix.gy.slice(0, n), ps = mix.p.slice(0, 4 * n);
  const before = shown(mix).px;
  // a pixel showing neither colour as it is
  const at = before.findIndex((v) => v >= 0 && v !== 9 && v !== 13), tx = at % W, ty = (at - tx) / W;
  mix.press(tx, ty, 16);
  frames(mix, 5);
  const r = mix.lift();
  check('a tap on paint picks the colour it shows there, mixed', at >= 0 && r.pick === before[at], r.pick + ' shows ' + before[at]);
  check('and moves and mixes nothing', !mix.busy && same(xs, mix.gx.slice(0, n)) && same(ys, mix.gy.slice(0, n)) && same(ps, mix.p.slice(0, 4 * n)));
  mix.press(5, 125, 16);
  const bare = mix.lift();
  check('a tap on bare tray picks nothing', bare.pick === -1 && mix.count() === n && !mix.busy, bare.pick);
}

// --- a glob ------------------------------------------------------------------------
{
  const bad = [];
  WALL.SIZES.forEach((size, k) => {
    const mix = tray(10 + k), c = 2 + k % 14;
    glob(mix, c, 50, 66, size);
    const want = stamp(50, 66, size), got = covered(mix);
    const colours = shown(mix).set;
    if (!same(got, want) || mix.count() !== area(size) || tallest(mix) !== 1 || colours.length !== 1 || colours[0] !== c) {
      bad.push(size + ': ' + mix.count() + ' grains, ' + area(size) + ' wanted, ' + tallest(mix) + ' tall');
    }
  });
  check('a glob dropped into the tray lands as the pen\'s stamp, one layer, at every size', bad.length === 0, bad.join('; '));

  // pulled in, the cell gives more as the glob goes
  const more = [];
  WALL.SIZES.forEach((size, k) => {
    const mix = tray(10 + k), c = 2 + k % 14;
    pullIn(mix, c, 50, 66, size);
    const colours = shown(mix).set;
    if (mix.count() <= area(size) || tallest(mix) !== 1 || strays(mix) || colours.length !== 1 || colours[0] !== c) {
      more.push(size + ': ' + mix.count() + ' grains, more than ' + area(size) + ' wanted, ' + tallest(mix) + ' tall');
    }
  });
  check('a glob pulled into the tray gives more than a pen\'s worth and lands in its colour, one layer, at every size', more.length === 0, more.join('; '));

  // let go while the pointer is still trailing well ahead of the glob
  const fast = tray(30);
  pullIn(fast, 4, 60, 90, 16, 12);
  check('and so does one flung in and let go at once', fast.count() > area(16) && tallest(fast) === 1 && strays(fast) === 0 && same(shown(fast).set, [4]), fast.count());
}

{
  const mix = tray(40), b = cell(3);
  mix.hold(3, b.cx, b.cy, b.box, 16);
  drag(mix, b.cx, b.cy, 40, -50, 2);
  frames(mix, 10);
  const out = flown(mix);
  const inside = out.filter(([x, y]) => x >= b.box.x0 && x < b.box.x1 && y >= b.box.y0 && y < b.box.y1);
  const off = out.filter(([x, y]) => x < 0 || x >= W || y < -UP || y >= 0);
  check('pulled out, the glob flies, none of what is drawn in its cell or off the air', out.length > 0 && inside.length === 0 && off.length === 0, out.length + ' flying');
  mix.lift();
  const k = rest(mix);
  check('let go before the tray it leaves nothing on the tray and nothing held', mix.count() === 0 && !mix.busy && mix.colour === -1 && flown(mix).length === 0 && covered(mix).every((v) => !v), k + ' frames');
}

// --- random drags ------------------------------------------------------------------
{
  const mix = tray(50), r = mulberry32(51), int = (n) => Math.floor(r() * n);
  glob(mix, 2, 30, 30, 16);
  glob(mix, 8, 70, 40, 12);
  glob(mix, 11, 40, 90, 16);
  glob(mix, 5, 75, 110, 10);
  glob(mix, 1, 20, 120, 8);
  glob(mix, 0, 60, 70, 14);
  let want = mix.count(), grew = false, counts = true, rested = true, onTray = true, detail = '', settles = 0, holds = 0, piled = 0, longest = 0;
  for (let t = 0; t < 120; t++) {
    const size = WALL.SIZES[int(WALL.SIZES.length)];
    let x, y, reached = false, n = 0;
    if (int(5) === 0) {
      const c = int(COLOURS.length), b = cell(c);
      x = b.cx; y = b.cy;
      mix.hold(c, x, y, b.box, size);
      n = mix.held.n;
      holds++;
    } else {
      const g = mix.count() ? int(mix.count()) : -1;
      x = g >= 0 && int(3) ? mix.gx[g] : int(W);
      y = g >= 0 && int(3) ? mix.gy[g] : int(H);
      mix.press(x, y, size);
    }
    const moves = 3 + int(60), fast = int(2);
    for (let k = 0; k < moves; k++) {
      if (int(8) === 0) {
        // far off the grid, clamped
        x = int(W + 160) - 80;
        y = int(H + UP + 200) - UP - 100;
      } else {
        const v = fast ? 6 + int(40) : 1 + int(3);
        x += int(2 * v + 1) - v;
        y += int(2 * v + 1) - v;
      }
      mix.move(x, y);
      // a glob whose pointer reaches the tray comes down on it whole, and more with it
      if (n && !reached && y >= 0) { reached = true; want += n; grew = true; }
      for (let s = int(3); s > 0; s--) mix.step(DT);
    }
    mix.lift();
    // most drags are left to settle; the rest are finished by the next press
    if (int(4)) {
      const k = rest(mix);
      settles++;
      longest = Math.max(longest, k);
      if (k >= 20000) rested = false;
      if ((grew ? mix.count() < want : mix.count() !== want) && counts) { counts = false; detail = 'drag ' + t + ': ' + mix.count() + ' grains, ' + want + (grew ? ' at least' : '') + ' wanted'; }
      want = mix.count();
      grew = false;
      if (tallest(mix) > 1) piled++;
      if (strays(mix)) onTray = false;
    }
  }
  const last = rest(mix);
  check('random drags never change the count but by the globs pulled in', counts && (grew ? mix.count() >= want : mix.count() === want), detail || mix.count() + ' grains, ' + holds + ' holds');
  check('each settle comes to rest', rested && last < 20000 && !mix.busy, settles + ' settles, the longest ' + longest + ' frames, ' + piled + ' left a pile taller than 1');
  check('and every grain lies on the tray, in its pile', onTray && strays(mix) === 0);
}

// --- mixing ------------------------------------------------------------------------
const YELLOW = index('#EDC84A'), BLUE = index('#3F7FBF');
const pure = (mix, c) => Array.from(mix.lp.slice(4 * c, 4 * c + 4));
// how far grain g's paint is from paint q
const from = (mix, g, q) => q.reduce((a, v, k) => a + Math.abs(mix.p[4 * g + k] - v), 0);
// what the paint's total should be: each grain began as pure paint of the colour it came from
const began = (mix, parts) => [0, 1, 2, 3].map((k) => parts.reduce((a, [n, q]) => a + n * q[k], 0));
const off = (a, b) => Math.max(...a.map((v, k) => Math.abs(v - b[k])));

{
  const mix = tray(60), blue = pure(mix, BLUE), yellow = pure(mix, YELLOW);
  glob(mix, BLUE, 50, 80, 16);
  const nb = mix.count();
  const b = cell(YELLOW);
  mix.hold(YELLOW, b.cx, b.cy, b.box, 16);
  drag(mix, b.cx, b.cy, 50, 40, 3);
  drag(mix, 50, 40, 50, 110, 2);
  drag(mix, 50, 110, 20, 100, 2);
  drag(mix, 20, 100, 50, 80, 2);
  let mixed = 0;
  for (let g = 0; g < mix.count(); g++) if (from(mix, g, blue) > 1e-6 && from(mix, g, yellow) > 1e-6) mixed++;
  check('yellow pulled through blue mixes with it before anything is let go', mix.busy && mixed > 0, mixed + ' grains mixed of ' + mix.count());
  const e = off(totals(mix), began(mix, [[nb, blue], [mix.count() - nb, yellow]]));
  check('and the paint\'s total is kept', e < 1e-9, e.toExponential(1));
  mix.lift();
  rest(mix);
  const e2 = off(totals(mix), began(mix, [[nb, blue], [mix.count() - nb, yellow]]));
  check('and kept once it is put down', e2 < 1e-9 && mix.count() > nb + area(16), e2.toExponential(1));
}

// --- still -------------------------------------------------------------------------
// steps until nothing has changed for a second, then a minute more: whether anything did
function still(mix) {
  let k = 0;
  for (; k < 200; k++) {
    mix.dirty = false;
    frames(mix, 60);
    if (!mix.dirty) break;
  }
  const n = mix.count(), xs = mix.gx.slice(0, n), ys = mix.gy.slice(0, n), ps = mix.p.slice(0, 4 * n), ts = mix.tall.slice();
  const air = flown(mix).join(' ');
  frames(mix, 3600);
  return {
    settled: k,
    ok: !mix.dirty && mix.busy && same(xs, mix.gx.slice(0, n)) && same(ys, mix.gy.slice(0, n)) && same(ps, mix.p.slice(0, 4 * n)) && same(ts, mix.tall) && air === flown(mix).join(' '),
  };
}
{
  const mix = tray(70);
  glob(mix, BLUE, 40, 60, 16);
  glob(mix, YELLOW, 60, 60, 16);
  mix.press(40, 60, 12);
  drag(mix, 40, 60, 70, 90, 3);
  const s = still(mix);
  check('a drag on the tray held still: once settled nothing mixes or moves', s.ok, 'settled after ' + s.settled + ' s');
  const b = cell(BLUE);
  mix.lift();
  rest(mix);
  mix.hold(BLUE, b.cx, b.cy, b.box, 16);
  drag(mix, b.cx, b.cy, 30, 0, 4);
  const t = still(mix);
  check('nor while a glob is held still at the tray\'s edge, some of it in the air', t.ok && mix.held !== null, 'settled after ' + t.settled + ' s');
  mix.lift();
  rest(mix);
  mix.hold(YELLOW, cell(YELLOW).cx, cell(YELLOW).cy, cell(YELLOW).box, 16);
  drag(mix, cell(YELLOW).cx, cell(YELLOW).cy, 50, -60, 4);
  const u = still(mix);
  check('nor while one is held still in the air', u.ok && flown(mix).length > 0, 'settled after ' + u.settled + ' s');
}

// --- stirring ----------------------------------------------------------------------
{
  const mix = tray(80);
  glob(mix, YELLOW, 30, 66, 16);
  glob(mix, BLUE, 70, 66, 16);
  let stirs = 0, set = shown(mix).set;
  for (; stirs < 100 && set.length > 1; stirs++) {
    // round and round through both, the way a stick is
    mix.press(30, 66, 16);
    let x = 30, y = 66;
    for (let k = 1; k <= 240; k++) {
      const a = k / 240 * 6 * Math.PI, nx = Math.round(50 - 20 * Math.cos(a)), ny = Math.round(66 + 30 * Math.sin(2 * a) / 2);
      drag(mix, x, y, nx, ny, 3);
      x = nx; y = ny;
    }
    mix.lift();
    rest(mix);
    set = shown(mix).set;
  }
  const c = set[0], [r, g, b] = c >= 0 ? rgb(COLOURS[c]) : [0, 0, 0];
  check('yellow and blue stirred long enough end as one list colour', set.length === 1, stirs + ' stirs, ' + set.map((i) => COLOURS[i]).join(' '));
  check('and it is greener than it is grey', set.length === 1 && g > r && g > b, COLOURS[c]);
}

// --- time ----------------------------------------------------------------------------
// a block of paint pulled down the tray at 180 px a second, dt a step:
// where the paint's middle is after half a second, and where the pen is
function pull(dt, seed) {
  const mix = tray(seed);
  glob(mix, 2, 30, 20, 16);
  glob(mix, 3, 46, 20, 16);
  glob(mix, 4, 30, 36, 16);
  glob(mix, 5, 46, 36, 16);
  mix.press(38, 20, 16);
  for (let t = dt; t <= 0.5 + 1e-9; t += dt) {
    mix.move(38, Math.round(20 + 180 * t));
    mix.step(dt);
  }
  let sx = 0, sy = 0;
  for (let g = 0; g < mix.count(); g++) { sx += mix.gx[g]; sy += mix.gy[g]; }
  return { x: sx / mix.count(), y: sy / mix.count(), pen: mix.tip.y };
}
{
  const a = pull(1 / 60, 90), b = pull(1 / 120, 91), c = pull(1 / 60, 92);
  const gap = Math.hypot(a.x - b.x, a.y - b.y), noise = Math.hypot(a.x - c.x, a.y - c.y);
  check('the same pull at 120 steps a second ends where it does at 60, the paint still trailing',
    gap < 3 && a.pen - a.y > 10 && b.pen - b.y > 10,
    'middle at ' + a.y.toFixed(1) + ' and ' + b.y.toFixed(1) + ', the pen at ' + a.pen + ', two runs at 60 ' + noise.toFixed(2) + ' px apart');

  // a glob of one grain, whose steps often move nothing: how far it trails
  // a pen pulled at 300 px a second for 0.4 s, over 20 runs
  const lag = (dt) => {
    let sum = 0;
    for (let s = 0; s < 20; s++) {
      const one = tray(200 + s);
      glob(one, 2, 50, 10, 1);
      one.press(50, 10, 1);
      for (let t = dt; t <= 0.4 + 1e-9; t += dt) {
        one.move(50, Math.round(10 + 300 * t));
        one.step(dt);
      }
      sum += one.tip.y - one.gy[0];
    }
    return sum / 20;
  };
  const l30 = lag(1 / 30), l60 = lag(1 / 60), l120 = lag(1 / 120);
  check('and one grain trails as far at 30, 60 and 120 a second', Math.max(l30, l60, l120) - Math.min(l30, l60, l120) < 2,
    l30.toFixed(1) + ', ' + l60.toFixed(1) + ' and ' + l120.toFixed(1) + ' px');

  // steps counted by what each call does
  const mix = tray(93);
  glob(mix, 2, 30, 20, 16);
  glob(mix, 3, 46, 20, 16);
  mix.press(38, 20, 16);
  mix.move(38, 120);
  let steps = 0;
  const once = mix.once;
  mix.once = function () { steps++; return once.call(this); };
  mix.step(1 / 120);
  const half = steps;
  mix.step(1 / 120);
  check('step(1/120) takes FOLLOW / 2 steps', half === MIX.FOLLOW / 2 && steps === MIX.FOLLOW, half + ', then ' + steps);
  steps = 0;
  for (let k = 0; k < 4; k++) mix.step(1 / 240);
  check('step(1/240) four times takes FOLLOW, the fractions carried', steps === MIX.FOLLOW, steps);
  steps = 0;
  mix.step(3);
  check('a huge dt takes no more than 4 FOLLOW', steps === 4 * MIX.FOLLOW, steps);
  steps = 0;
  mix.step(1 / 60);
  check('and owes nothing after it', steps === MIX.FOLLOW, steps);
}

// --- the eraser ----------------------------------------------------------------------
{
  const mix = tray(100);
  glob(mix, 2, 50, 66, 16);
  const before = covered(mix), box = { x0: 40, y0: 60, x1: 50, y1: 70 };
  const inBox = (i) => i % W >= box.x0 && i % W < box.x1 && Math.floor(i / W) >= box.y0 && Math.floor(i / W) < box.y1;
  const under = before.reduce((a, v, i) => a + (v && inBox(i) ? 1 : 0), 0);
  mix.dirty = false;
  const went = mix.erase(box.x0, box.y0, box.x1, box.y1), after = covered(mix);
  check('erase() takes the paint in its box, short of its far edges, and says how much', under > 0 && went === under && mix.count() === area(16) - under && after.every((v, i) => v === (inBox(i) ? 0 : before[i])), went + ' grains');
  check('and the picture is painted again', mix.dirty && shown(mix).px.every((v, i) => (v === -1) === !after[i]));
  mix.dirty = false;
  check('a box with no paint in it takes none and changes nothing', mix.erase(box.x0, box.y0, box.x1, box.y1) === 0 && mix.erase(0, 0, 10, 10) === 0 && !mix.dirty);
  // paint piled up: a cell held over the tray, and grains come down on one spot of its paint as they do from the air
  const m1 = tray(103), c1 = cell(6);
  m1.hold(6, c1.cx, c1.cy, c1.box, 16);
  drag(m1, c1.cx, c1.cy, 50, 66, 3);
  frames(m1, 30);
  const pile = m1.tall.indexOf(1), px = pile % W, py = Math.floor(pile / W);
  for (let k = 0; k < 3; k++) m1.down(px, py);
  const piled = tallest(m1), n = m1.count(), tn = m1.tn;
  const near = (i) => Math.abs(i % W - px) < 6 && Math.abs(Math.floor(i / W) - py) < 6;
  const deep = m1.tall.reduce((a, v, i) => a + (near(i) ? v : 0), 0), took = m1.erase(px - 5, py - 5, px + 6, py + 6);
  check('every grain of a pile in the box goes, out of what the pen has picked up too', piled === 4 && took === deep && deep > 4 && m1.count() === n - deep && m1.tn === tn - deep && m1.tall.every((v, i) => !near(i) || v === 0) && m1.top.every((g, i) => !near(i) || g === -1), 'tallest ' + piled + ', ' + took + ' grains');
  m1.lift();
  rest(m1);
  check('and what is left comes to rest, all on the tray', !m1.busy && m1.count() > 0 && strays(m1) === 0 && tallest(m1) === 1);
  // a box partly, or wholly, off the tray
  const m2 = tray(101);
  glob(m2, 3, 2, 2, 8);
  glob(m2, 3, W - 3, H - 3, 8);
  const c0 = m2.count(), a0 = m2.erase(-20, -20, 6, 6), a1 = m2.erase(W - 6, H - 6, W + 20, H + 20), a2 = m2.erase(W, 0, W + 9, 9) + m2.erase(-9, 0, 0, 9) + m2.erase(0, H, 9, H + 9) + m2.erase(30, 30, 20, 20);
  check('a box over the tray\'s edge takes what is on the tray, and one off it or inside out nothing', a0 > 0 && a1 > 0 && a2 === 0 && m2.count() === c0 - a0 - a1 && strays(m2) === 0, a0 + ' and ' + a1);
  // while the pen drags paint
  const m3 = tray(102);
  glob(m3, 2, 50, 66, 16);
  m3.press(50, 66, 16);
  drag(m3, 50, 66, 70, 66, 3);
  const held = m3.tn, c3 = m3.count(), a3 = m3.erase(0, 0, W, H);
  check('the whole tray erased mid-drag takes what the pen has picked up too', held > 0 && a3 === c3 && m3.count() === 0 && m3.tn === 0 && tallest(m3) === 0);
  m3.move(60, 60);
  frames(m3, 30);
  m3.lift();
  rest(m3);
  check('and nothing is left to move', m3.count() === 0 && !m3.busy);
  glob(m3, 7, 50, 66, 10);
  check('and it works as new after', same(covered(m3), stamp(50, 66, 10)) && m3.count() === area(10));
}

// --- drying --------------------------------------------------------------------------
// the grains the pen has picked up are the ones marked so, each once
function heldRight(mix) {
  const seen = new Set();
  for (let k = 0; k < mix.tn; k++) {
    const g = mix.tg[k];
    if (g >= mix.n || !mix.picked[g] || seen.has(g)) return false;
    seen.add(g);
  }
  let picked = 0;
  for (let g = 0; g < mix.n; g++) picked += mix.picked[g];
  return picked === mix.tn;
}
{
  check('a tray keeps FULL of the biggest pen\'s worths, or a grain a pixel where that is less', drier(120).most === Math.min(MIX.FULL * area(16), W * H), drier(120).most);
  const small = new Mix(COLOURS, 20, 20, UP, mulberry32(123));
  check('so a small tray keeps its area', small.most === 20 * 20, small.most);
  // a tray that keeps six of the biggest pen's worths: eight of the
  // biggest globs put down apart, two more than it keeps, and then left to dry
  const most = 6 * area(16), globs = 8;
  const wet = (seed) => {
    const mix = tray(seed);
    for (let i = 0; i < globs; i++) glob(mix, 2 + i, 14 + 24 * (i % 4), 30 + 60 * (i >> 2), 16);
    mix.most = most;
    return mix;
  };
  const mix = wet(121), over = mix.count() - most;
  let edge = true, down = true, was = covered(mix), n = mix.count();
  for (let k = 0; k < 60; k++) {
    mix.step(DT);
    const now = covered(mix);
    for (let i = 0; i < now.length; i++) {
      if (!was[i] || now[i]) continue;
      // gone this frame: beside the tray's edge or a place with no paint
      const x = i % W, y = (i - x) / W;
      let open = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      for (let c = 0; c < 8 && !open; c++) open = !now[(y + MIX.DY[c]) * W + x + MIX.DX[c]];
      if (!open) edge = false;
    }
    if (mix.count() > n) down = false;
    n = mix.count();
    was = now;
  }
  const want = most + over * Math.exp(-MIX.DRY);
  check('what is over that dries away off the paint\'s edges', over === 2 * area(16) && edge && down && n < most + over);
  check('DRY of it a second', Math.abs(n - want) <= 2, n + ' grains after a second, ' + want.toFixed(1) + ' wanted');
  const fast = wet(121);
  frames(fast, 120, 1 / 120);
  check('and as much at 120 steps a second', Math.abs(fast.count() - want) <= 2, fast.count());
  frames(mix, 3600);
  const dry = mix.count();
  mix.dirty = false;
  frames(mix, 600);
  check('down to what it keeps and no further, and then nothing changes', dry === most && mix.count() === most && !mix.dirty, dry);
  check('every grain left lies on the tray, in its pile, one layer', strays(mix) === 0 && tallest(mix) === 1);
  // dragged while it dries
  const stir = wet(122);
  stir.press(14, 30, 16);
  let ok = true, held = 0;
  for (let k = 1; k <= 240; k++) {
    const a = k / 60 * 2;
    stir.move(Math.round(50 + 36 * Math.cos(a)), Math.round(60 + 40 * Math.sin(a)));
    stir.step(DT);
    if (strays(stir) || !heldRight(stir)) ok = false;
    held = Math.max(held, stir.tn);
  }
  const mid = stir.count();
  stir.lift();
  rest(stir);
  check('paint picked up dries as it is dragged, every grain in its pile and the pen\'s its own', ok && held > area(16) && mid < globs * area(16) && mid > most, held + ' held at most, ' + mid + ' grains left');
  check('and it is put down as ever', !stir.busy && stir.tn === 0 && strays(stir) === 0 && tallest(stir) === 1 && heldRight(stir));
}

// --- flow ----------------------------------------------------------------------------
{
  const size = 8, pen = area(size), b = cell(5), total = (mix) => mix.count() + (mix.held ? mix.held.n : 0);
  // a cell held, the pointer at once at the tray's middle and held there
  const pour = (seed, dt, secs) => {
    const mix = tray(seed);
    mix.hold(5, b.cx, b.cy, b.box, size);
    mix.move(50, 66);
    frames(mix, Math.round(secs / dt), dt);
    return mix;
  };
  const mix = pour(130, DT, 2), made = total(mix), want = pen * (1 + 2 * MIX.FLOW);
  check('a cell held gives FLOW pens\' worths a second', made <= want + 1 && made >= want - pen / 2, made + ' grains after two seconds, ' + want + ' at most');
  const fast = total(pour(130, 1 / 120, 2));
  check('and as much at 120 steps a second', fast <= want + 1 && fast >= want - pen / 2, fast);
  mix.lift();
  rest(mix);
  const seen = shown(mix);
  check('let go, no more comes and all of it is put down in its colour, one layer', !mix.busy && mix.colour === -1 && mix.count() === made && strays(mix) === 0 && tallest(mix) === 1 && same(seen.set, [5]), mix.count());
  // the pointer still in the cell
  const still = tray(131);
  still.hold(5, b.cx, b.cy, b.box, size);
  frames(still, 120);
  const kept = still.held.n;
  check('with the pointer still in its cell it gives nothing more, and a tap picks as ever', kept === pen && still.lift().pick === 5 && still.count() === 0 && !still.busy, kept);
  // held in the air, off the tray
  const air = tray(132);
  air.hold(5, b.cx, b.cy, b.box, size);
  air.move(80, -40);
  let up = 0;
  for (let k = 0; k < 600; k++) {
    air.step(DT);
    up = Math.max(up, air.held.n);
  }
  check('held in the air, no more than a second\'s worth is ever out', up > pen && up <= MIX.FLOW * pen && air.count() === 0, up);
  air.lift();
  rest(air);
  check('and let go there it all goes home', !air.busy && air.count() === 0 && air.colour === -1 && flown(air).length === 0);
  // the biggest pen's flow into a tray that dries, keeping six of its worths
  const big = Object.assign(drier(133), { most: 6 * area(16) }), c = cell(9);
  big.hold(9, c.cx, c.cy, c.box, 16);
  big.move(50, 66);
  let sound = true;
  for (let k = 0; k < 1200; k++) {
    big.step(DT);
    if (k % 60 === 0 && (strays(big) || !heldRight(big))) sound = false;
  }
  const level = big.most + MIX.FLOW * area(16) / MIX.DRY;
  check('a long flow into a tray that dries levels off, the glob\'s grains numbered again as they land', sound && big.count() > big.most && big.count() < level && big.held.cap <= 4 * area(16), big.count() + ' grains, level at ' + level + ', room for ' + big.held.cap);
  big.lift();
  rest(big);
  frames(big, 3600);
  check('and let go, it dries down to what the tray keeps', !big.busy && big.count() === big.most && strays(big) === 0, big.count());
}

// --- the colour mixed ----------------------------------------------------------------
{
  const mix = tray(140), b = cell(5);
  mix.hold(5, b.cx, b.cy, b.box, 8);
  const tap = mix.lift().pick;
  check('a tap on a cell leaves no colour mixed', tap === 5 && mix.mixed === -1, mix.mixed);
  glob(mix, 7, 40, 60, 16);
  check('a glob put down is the colour mixed', mix.mixed === 7, mix.mixed);
  mix.mixed = -1;
  mix.press(40, 60, 16);
  const onPaint = mix.lift().pick;
  check('a tap on paint leaves none', onPaint === 7 && mix.mixed === -1, mix.mixed);
  glob(mix, 10, 62, 60, 16);
  mix.mixed = -1;
  mix.press(40, 60, 16);
  drag(mix, 40, 60, 62, 60, 2);
  for (let k = 1; k <= 24; k++) {
    const x = Math.round(51 + 12 * Math.cos(k * Math.PI / 8)), y = Math.round(60 + 12 * Math.sin(k * Math.PI / 8));
    mix.move(x, y);
    mix.step(DT);
  }
  const still = mix.mixed, pen = { x: mix.tip.x, y: mix.tip.y };
  mix.lift();
  rest(mix);
  // the colours the paint nearest the pen shows
  let nd = Infinity;
  const near = new Set();
  for (let i = 0; i < mix.top.length; i++) {
    if (mix.top[i] < 0) continue;
    const d = (i % W - pen.x) ** 2 + (Math.floor(i / W) - pen.y) ** 2;
    if (d < nd) { nd = d; near.clear(); }
    if (d === nd) near.add(mix.shows(mix.top[i]));
  }
  check('paint stirred is none until it is put down, then the colour it shows nearest the pen', still === -1 && near.has(mix.mixed), mix.mixed + ' of ' + [...near]);
  const c = cell(3);
  mix.mixed = -1;
  mix.hold(3, c.cx, c.cy, c.box, 8);
  drag(mix, c.cx, c.cy, c.cx + 30, c.cy, 3);
  mix.lift();
  rest(mix);
  check('a glob let go in the air leaves none', mix.mixed === -1 && !mix.busy, mix.mixed);
}

// --- the blob ------------------------------------------------------------------------
// the tray pixels whose top grain is marked in flags, in order
function pixelsOf(mix, flags) {
  const out = [];
  for (let i = 0; i < W * H; i++) if (mix.top[i] >= 0 && flags[mix.top[i]]) out.push(i);
  return out;
}
// tray pixel i and all the paint touching it, eight ways: their pixels, in order
function touching(mix, i) {
  const out = new Set([i]), todo = [i];
  while (todo.length) {
    const j = todo.pop(), x = j % W, y = (j - x) / W;
    for (let c = 0; c < 8; c++) {
      const qx = x + MIX.DX[c], qy = y + MIX.DY[c], q = qy * W + qx;
      if (qx >= 0 && qy >= 0 && qx < W && qy < H && mix.tall[q] && !out.has(q)) {
        out.add(q);
        todo.push(q);
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}
// what shares(most) should be for these tray pixels: the colours they
// show, by their pixels, the most first, the first's weight 255 and none
// under 1; null for none
function sharesOf(mix, pixels, most) {
  const seen = shown(mix).px, counts = new Map();
  for (const i of pixels) counts.set(seen[i], (counts.get(seen[i]) || 0) + 1);
  if (!counts.size) return null;
  const by = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, most);
  return { colours: by.map((e) => e[0]), weights: by.map((e) => Math.max(1, Math.round(255 * e[1] / by[0][1]))) };
}
const json = (v) => JSON.stringify(v);

{
  // a and b, two globs side by side with a column of bare tray between them
  const mix = tray(160);
  glob(mix, 7, 30, 66, 8);
  glob(mix, 10, 39, 66, 8);
  const a = touching(mix, 66 * W + 30), b = touching(mix, 66 * W + 39);
  const apart = a.every((i) => !b.includes(i)) && a.some((i) => i % W === 33) && b.some((i) => i % W === 35);
  check('b, put down last, is the blob', apart && json(pixelsOf(mix, mix.blob)) === json(b), b.length + ' px');
  // a tap on a's edge with a pen that reaches over the gap onto b
  mix.press(33, 66, 16);
  const tap = mix.lift().pick;
  check('a tap on a, its pen over b too, makes a alone the blob', tap === 7 && json(pixelsOf(mix, mix.blob)) === json(a), pixelsOf(mix, mix.blob).length + ' px');
  // a dot of paint put down up and left of a's top left, touching it only at that corner
  let q = -1;
  for (const i of a) {
    const qx = i % W - 1, qy = (i - i % W) / W - 1;
    if (!mix.tall[qy * W + qx] && [[-1, 0], [1, 0], [0, -1], [0, 1]].every(([ex, ey]) => !mix.tall[(qy + ey) * W + qx + ex])) { q = qy * W + qx; break; }
  }
  const was = a.map((i) => mix.top[i]).join();
  glob(mix, 4, q % W, (q - q % W) / W, 1);
  const ad = [...a, q].sort((m, n) => m - n);
  check('a dot put down touching a only at a corner makes the two the blob, eight ways', q >= 0 && mix.tall[q] === 1 && a.map((i) => mix.top[i]).join() === was && json(pixelsOf(mix, mix.blob)) === json(ad), q % W + ', ' + (q - q % W) / W);
  mix.press(39, 66, 8);
  mix.lift();
  check('a tap on b makes it the blob again', json(pixelsOf(mix, mix.blob)) === json(b));
  mix.dirty = false;
  mix.press(q % W, (q - q % W) / W, 1);
  mix.lift();
  check('and one on the dot makes the dot and a, and the picture is to be painted again', json(pixelsOf(mix, mix.blob)) === json(ad) && mix.dirty);
  // b pressed and dragged away from a
  const before = json(mix.shares(32));
  mix.press(39, 66, 8);
  frames(mix, 3);
  check('a press on paint leaves the blob as it was until it moves', json(mix.shares(32)) === before && before === json(sharesOf(mix, ad, 32)));
  mix.dirty = false;
  mix.move(41, 66);
  const moved = mix.dirty;
  frames(mix, 1);
  drag(mix, 41, 66, 60, 90, 2);
  const held = pixelsOf(mix, mix.picked), live = mix.shares(32);
  check('dragged, the blob is the paint the pen has picked up, the picture painted again as it starts', moved && held.length > 0 && held.every((i) => !a.includes(i)) && json(live) === json(sharesOf(mix, held, 32)) && live.colours.join() === '10', held.length + ' px, ' + json(live));
  mix.lift();
  rest(mix);
  const put = pixelsOf(mix, mix.blob);
  check('put down, it is the paint where it shows the colour mixed and all the paint touching it', put.length > 0 && json(touching(mix, put[0])) === json(put) && put.some((i) => shown(mix).px[i] === mix.mixed) && put.every((i) => !ad.includes(i)), put.length + ' px');
  // a glob let go in the air
  const c = cell(3), sh = json(mix.shares(32));
  mix.hold(3, c.cx, c.cy, c.box, 8);
  drag(mix, c.cx, c.cy, c.cx + 30, c.cy, 3);
  mix.lift();
  rest(mix);
  check('a glob let go in the air leaves the blob as it was', !mix.busy && json(pixelsOf(mix, mix.blob)) === json(put) && json(mix.shares(32)) === sh);
  mix.press(90, 10, 16);
  mix.lift();
  check('and so does a tap on bare tray', json(pixelsOf(mix, mix.blob)) === json(put) && json(mix.shares(32)) === sh);
  const xs = put.map((i) => i % W), cut = (Math.min(...xs) + Math.max(...xs) + 1) >> 1;
  mix.erase(0, 0, cut, H);
  const left = pixelsOf(mix, mix.blob);
  check('the blob erased in part is what is left of it', left.length > 0 && left.length < put.length && json(left) === json(put.filter((i) => i % W >= cut)) && mix.shares(32) !== null, left.length + ' of ' + put.length + ' px');
  mix.erase(0, 0, W, H);
  check('and the tray erased leaves none', mix.shares(32) === null && pixelsOf(mix, mix.blob).length === 0);
  glob(mix, 5, 50, 66, 8);
  check('and the next glob put down is the blob, all of it and only it', json(pixelsOf(mix, mix.blob)) === json(touching(mix, 66 * W + 50)) && mix.count() === area(8) && pixelsOf(mix, mix.blob).length === area(8));
}

{
  // four globs apart, the bottom two first so none comes down through
  // another, the second tapped, and then most of the paint dried away:
  // grains of the blob and of the rest take each other's numbers as they go
  const mix = tray(170);
  for (let i = 0; i < 4; i++) glob(mix, 2 + i, 25 + 50 * (i % 2), 95 - 60 * (i >> 1), 16);
  mix.press(75, 95, 16);
  const tap = mix.lift().pick, blob = pixelsOf(mix, mix.blob);
  mix.most = area(16);
  let right = tap === 3 && blob.length === area(16) && json(blob) === json(touching(mix, 95 * W + 75)), left = blob;
  for (let k = 0; k < 300; k++) {
    mix.step(DT);
    left = blob.filter((i) => mix.tall[i] > 0);
    if (json(pixelsOf(mix, mix.blob)) !== json(left) || json(mix.shares(32)) !== json(sharesOf(mix, left, 32))) right = false;
  }
  check('the blob\'s grains drying away leave the rest of it the blob, its shares what that shows', right && left.length > 0 && left.length < blob.length && mix.count() < 4 * area(16) - blob.length + left.length, left.length + ' of ' + blob.length + ' px left, ' + mix.count() + ' grains');
}

// --- the tray's shares ---------------------------------------------------------------
{
  const mix = tray(150);
  check('an empty tray has no shares', mix.shares(32) === null);
  glob(mix, 7, 30, 40, 16);
  const one = mix.shares(32);
  check('one glob put down is the blob: its colour, its weight 255', one.colours.join() === '7' && one.weights.join() === '255', json(one));
  glob(mix, 10, 70, 100, 8);
  const two = mix.shares(32);
  check('a second put down apart is the blob alone, the paint last touched', two.colours.join() === '10' && two.weights.join() === '255', json(two));
  mix.press(30, 40, 16);
  const tap = mix.lift().pick, first = mix.shares(32);
  check('a tap on the first makes it the blob alone', tap === 7 && first.colours.join() === '7' && first.weights.join() === '255', json(first));
  mix.press(90, 10, 16);
  check('a tap on bare tray leaves it so', mix.lift().pick === -1 && json(mix.shares(32)) === json(first));
  // a third glob far off, and then the first two stirred together and put down
  glob(mix, 12, 90, 10, 4);
  mix.press(30, 40, 16);
  drag(mix, 30, 40, 70, 100, 2);
  drag(mix, 70, 100, 40, 60, 2);
  mix.lift();
  rest(mix);
  const blob = pixelsOf(mix, mix.blob), far = touching(mix, 10 * W + 90);
  const all = mix.shares(224), want = sharesOf(mix, blob, 224);
  check('stirred and put down, its shares are the colours the blob shows, by their pixels, the most first, none under 1', all !== null && all.colours.length > 1 && json(all) === json(want) && all.weights.every((w, i) => w >= 1 && (i === 0 || w <= all.weights[i - 1])), all && all.colours.length + ' colours over ' + blob.length + ' px');
  check('no more than asked for', json(mix.shares(1)) === json({ colours: [all.colours[0]], weights: [255] }));
  check('and the paint not touching it is never counted', far.length === area(4) && far.every((i) => !blob.includes(i)) && json(all) !== json(sharesOf(mix, blob.concat(far), 224)), far.length + ' px apart');
}

// --- the outline ---------------------------------------------------------------------
const V = -9;
// the tray's picture as shown() makes it, as a plain array, so a write past either end of it would show
const picture = (mix) => Array.from(shown(mix).px);
const whole = (px) => px.length === W * H && Object.keys(px).length === W * H;
// the bare tray pixels within r px, across and down, of these, in order
function ring(mix, pixels, r) {
  const out = new Set();
  for (const i of pixels) {
    const x = i % W, y = (i - x) / W;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const qx = x + dx, qy = y + dy;
      if (qx >= 0 && qy >= 0 && qx < W && qy < H && !mix.tall[qy * W + qx]) out.add(qy * W + qx);
    }
  }
  return [...out].sort((a, b) => a - b);
}
// the pixels of px set to V
const marked = (px) => px.reduce((o, v, i) => { if (v === V) o.push(i); return o; }, []);
{
  // b put down beside a, a column of bare tray between them: b is the blob
  const mix = tray(180);
  glob(mix, 7, 30, 66, 8);
  glob(mix, 10, 39, 66, 8);
  const b = pixelsOf(mix, mix.blob), px = picture(mix), was = px.slice();
  mix.outline(px, V, 2);
  const got = marked(px), want = ring(mix, b, 2);
  check('outline() marks exactly the bare pixels within 2 px, across and down, of the blob', got.length > 0 && json(got) === json(want), got.length + ' px');
  check('and none with paint, the blob\'s or the paint beside it', whole(px) && px.every((v, i) => v === was[i] || (v === V && was[i] === -1)) && got.some((i) => i % W === 34));
  // the blob against the tray's corners
  const edge = (x, y, seed) => {
    const m = tray(seed);
    glob(m, 7, x, y, 12);
    const px = picture(m), b = pixelsOf(m, m.blob);
    m.outline(px, V, 2);
    const got = marked(px);
    return { ok: b.length > 0 && whole(px) && json(got) === json(ring(m, b, 2)), got };
  };
  const tl = edge(0, 0, 181), br = edge(W - 1, H - 1, 182);
  check('against the tray\'s edges it marks nothing past them, nor wraps to the far side', tl.ok && br.ok && tl.got.every((i) => i % W < W / 2) && br.got.every((i) => i % W >= W / 2), tl.got.length + ' and ' + br.got.length + ' px');
  const fresh = tray(183), none = picture(fresh);
  fresh.outline(none, V, 2);
  mix.erase(0, 0, W, H);
  const erased = picture(mix);
  mix.outline(erased, V, 2);
  check('a tray with no blob, new or erased, has no outline', marked(none).length === 0 && marked(erased).length === 0);
}

check('nothing read the clock, set a timer or called Math.random', reads === 0);

// --- timing --------------------------------------------------------------------------
// timed in node's own realm, where a global costs what it does on a page:
// the sandbox reaches its globals through an interceptor, several times slower
{
  for (const file of ['js/wall.js', 'js/mix.js']) {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), { filename: file });
  }
  const mix = new (vm.runInThisContext('Mix'))(COLOURS, W, H, UP, mulberry32(110));
  mix.most = Infinity;
  for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) glob(mix, 2 + (i + 4 * j) % 14, 26 + 15 * i, 45 + 15 * j, 16);
  mix.press(48, 60, 16);
  mix.step(DT);
  const ms = [];
  for (let k = 1; k <= 240; k++) {
    const a = k / 60 * 2;
    mix.move(Math.round(50 + 30 * Math.cos(a)), Math.round(66 + 40 * Math.sin(a)));
    const t0 = process.hrtime.bigint();
    mix.step(DT);
    ms.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  const held = mix.tn;
  mix.lift();
  ms.sort((a, b) => a - b);
  const mean = ms.reduce((a, v) => a + v, 0) / ms.length;
  console.log('time ' + mean.toFixed(2) + ' ms a step(1/60) on average, ' + ms[Math.floor(ms.length * 0.95)].toFixed(2) + ' at the 95th, ' + ms[ms.length - 1].toFixed(2) + ' at most, ' + held + ' of ' + mix.count() + ' grains dragged');
}

console.log(failures ? failures + ' failed' : 'all passed');
process.exit(failures ? 1 : 0);
