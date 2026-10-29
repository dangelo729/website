// node tools/test/cursor.test.js
//
// loads js/raster.js, js/hand-art.js and js/cursor.js the way the page does,
// classic scripts sharing one global scope, in a vm context with no dom, no
// performance, and a Date and a Math.random that throw, so the cursor cannot
// quietly lean on any of them. it draws into a real framebuffer (ImageData is
// stubbed); the test hands it the pointer and the time as the page does.
// prints the open hand and the fist as ascii; exits 1 on failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const STEP = 1 / 60;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}

// --- the scripts -------------------------------------------------------------
// every read of a forbidden global is counted as well as thrown, so one
// swallowed by a try below still fails the last check
let reads = 0;
const math = Object.create(Math);
math.random = () => { reads++; throw new Error('the cursor called Math.random'); };
// the browser's ImageData, as much of it as a Framebuffer makes
class ImageData {
  constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
}
const sandbox = { Math: math, ImageData };
for (const name of ['Date', 'performance', 'window', 'document', 'requestAnimationFrame']) {
  Object.defineProperty(sandbox, name, { get() { reads++; throw new Error('the cursor read ' + name); } });
}
const ctx = vm.createContext(sandbox);
for (const file of ['js/raster.js', 'js/hand-art.js', 'js/cursor.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
}
const { HAND_ART, CURSOR, Cursor, Framebuffer } = vm.runInContext('({ HAND_ART, CURSOR, Cursor, Framebuffer })', ctx);
const A = HAND_ART.hand, S = CURSOR.SCALE;

// --- helpers -------------------------------------------------------------------
// a real framebuffer. a set off the grid would land nowhere in a
// Uint8Array, silently, so it throws instead
function makeFb(w = 200, h = 160) {
  const fb = new Framebuffer(w, h), set = fb.set;
  fb.set = function (x, y, v = 1) {
    if (x !== Math.floor(x) || y !== Math.floor(y)) throw new Error('fb.set off the grid: ' + x + ', ' + y);
    set.call(this, x, y, v);
  };
  return fb;
}
// its pixels of value v as "x,y"
function pixels(fb, v = 1) {
  const out = new Set();
  for (let y = 0; y < fb.h; y++) for (let x = 0; x < fb.w; x++) if (fb.bits[y * fb.w + x] === v) out.add(x + ',' + y);
  return out;
}
const xy = (k) => k.split(',').map(Number);
function box(set) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const k of set) { const [x, y] = xy(k); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x0, x1, y0, y1 };
}
const fmtBox = (b) => 'x ' + b.x0 + '..' + b.x1 + ', y ' + b.y0 + '..' + b.y1;
function same(a, b) {
  const extra = [...a].filter((k) => !b.has(k)), missing = [...b].filter((k) => !a.has(k));
  return { ok: extra.length === 0 && missing.length === 0, detail: extra.length + ' extra, ' + missing.length + ' missing' +
    (extra.length ? ' e.g. extra ' + extra[0] : '') + (missing.length ? ' e.g. missing ' + missing[0] : '') };
}
function dump(fb, x0, y0, w, h) {
  const out = [];
  for (let y = y0; y < y0 + h; y++) {
    let row = '';
    for (let x = x0; x < x0 + w; x++) row += fb.get(x, y) ? '#' : '.';
    out.push(row);
  }
  return out;
}
// two windows side by side
const pair = (a, b) => a.map((r, i) => r + '   ' + b[i]).join('\n');
// what the cursor draws on a dark field: its lit pixels
function drawn(c, w, h) {
  const fb = makeFb(w, h);
  c.draw(fb);
  return pixels(fb);
}
// one frame's sprite alone, its centre where the brief puts it: the pointer
// less the hotspot at the cursor's scale
function spriteAt(g, x, y, w, h) {
  const fb = makeFb(w, h);
  fb.sprite(g, Math.floor(x - CURSOR.HOT.x * S) + 0.5, Math.floor(y - CURSOR.HOT.y * S) + 0.5, S, 0, 1, CURSOR.MIN_HITS);
  return pixels(fb);
}
function run(c, n, dt = STEP, each) {
  for (let i = 0; i < n; i++) {
    c.update(dt);
    if (each) each(c, i);
  }
}
const at = (c) => Cursor.frameIndex(c.frame);

// --- the art and the ink -------------------------------------------------------
{
  const rowsOk = A.frames.every((f) => f.length === 34 && f.every((r) => r.length === 21 && /^[.#]+$/.test(r)));
  check('art: hand is 21x34x14 of . and #', A.w === 21 && A.h === 34 && A.frames.length === 14 && rowsOk, A.w + 'x' + A.h + 'x' + A.frames.length);
  const c = new Cursor();
  let asArt = c.ink.length === 14;
  A.frames.forEach((rows, f) => {
    const g = c.ink[f];
    if (!g || g.w !== 21 || g.h !== 34) { asArt = false; return; }
    for (let y = 0; y < 34; y++) for (let x = 0; x < 21; x++) if (g.ink[y * 21 + x] !== (rows[y][x] === '#' ? 1 : 0)) asArt = false;
  });
  check('ink: one bitmap a frame, hand1 as drawn while MIRROR is false', asArt && CURSOR.MIRROR === false);
  const tops = c.top.join(',');
  check('ink: each frame\'s top inked row, the open hand\'s 0 and the fist\'s 8', c.top.length === 14 && c.top[0] === 0 && c.top[13] === 8 &&
    c.top.every((t, f) => t === A.frames[f].findIndex((r) => r.includes('#'))), tops);
  check('start: at (0, 0), hidden, not held, open, nothing owed', c.x === 0 && c.y === 0 && c.shown === false && c.held === false &&
    c.frame === CURSOR.OPEN_FRAME && c.owed === 0 && c.ring.length === CURSOR.BACKING.POINTS);
  const ink0 = c.ink[0], ring = c.ring, p0 = ring[0];
  c.moveTo(50, 50);
  c.draw(makeFb());
  check('draw: the ink and the ring made once in the constructor, not each draw', c.ink[0] === ink0 && c.ring === ring && ring[0] === p0 && ring.length === CURSOR.BACKING.POINTS);
}

// --- hidden --------------------------------------------------------------------
{
  const c = new Cursor();
  const fb = makeFb();
  c.draw(fb);
  const lit = makeFb();
  lit.bits.fill(1);
  c.draw(lit);
  check('hidden: a new cursor draws nothing, on a dark field or a lit one', pixels(fb).size === 0 && pixels(lit, 0).size === 0);
}

// --- the hotspot -----------------------------------------------------------------
// the bitmap's centre is the middle of the pixel the pointer less HOT *
// SCALE falls in: at (100, 100) that is (100.5, 98.5), the bitmap 6.3 x 10.2
// world px over x 97.35..103.65, y 93.4..103.6
{
  const c = new Cursor();
  c.moveTo(100, 100);
  check('moveTo: the pointer is stored and the hand shown', c.x === 100 && c.y === 100 && c.shown === true);
  const px = drawn(c);
  const r = same(px, spriteAt(c.ink[0], 100, 100));
  check('draw: the open hand is frame 0 as a sprite centred on the pointer\'s pixel\'s middle less HOT * SCALE', r.ok && px.size > 0, r.detail);
  const cx = Math.floor(100 - CURSOR.HOT.x * S) + 0.5, cy = Math.floor(100 - CURSOR.HOT.y * S) + 0.5, hw = A.w * S / 2, hh = A.h * S / 2;
  const b = box(px);
  // every lit pixel overlapping the bitmap's box (a pixel lights on its
  // sample points, so one whose middle is just outside can), and the open
  // hand's ink reaching all four sides of it, which it does in the art
  const inside = [...px].every((k) => { const [x, y] = xy(k); return x + 1 > cx - hw && x < cx + hw && y + 1 > cy - hh && y < cy + hh; });
  const reaches = b.x0 <= Math.floor(cx - hw) + 1 && b.x1 >= Math.ceil(cx + hw) - 2 && b.y0 <= Math.floor(cy - hh) + 1 && b.y1 >= Math.ceil(cy + hh) - 2;
  check('draw: the lit box is the bitmap\'s, x ' + (cx - hw) + '..' + (cx + hw) + ', y ' + (cy - hh) + '..' + (cy + hh), inside && reaches, fmtBox(b));
  // the pointer's pixel in the palm: open itself, the outline both sides on
  // its row, a finger above it in its column
  const row = [...px].map(xy).filter(([, y]) => y === 100), col = [...px].map(xy).filter(([x]) => x === 100);
  const inPalm = !px.has('100,100') && row.some(([x]) => x < 100) && row.some(([x]) => x > 100) && col.some(([, y]) => y < 100);
  check('draw: the pointer sits in the palm, outlined either side and a finger above', inPalm,
    'row 100 lit at x ' + row.map(([x]) => x).join(',') + '; column 100 lit at y ' + col.map(([, y]) => y).join(','));
  // a fractional pointer is drawn on a pixel's middle: (60.37, 41.81) and
  // (60.9, 41.3) draw alike, the bitmap's centre on (60.5, 40.5) (the
  // hotspot 1.2 px down from it); (61, 41.81) is a pixel to the right. on a
  // pixel's middle the frame samples the same way wherever the pointer is,
  // so the open hand lights the same number of pixels at every position
  c.moveTo(60.37, 41.81);
  const f = same(drawn(c), spriteAt(c.ink[0], 60.37, 41.81));
  check('draw: a fractional pointer (60.37, 41.81) is the sprite on the pixel\'s middle (60.5, 40.5)', f.ok, f.detail);
  const fa = drawn(c);
  c.moveTo(60.9, 41.3);
  const fb2 = same(drawn(c), fa);
  check('draw: (60.9, 41.3) draws the same', fb2.ok, fb2.detail);
  c.moveTo(61, 41.81);
  const shifted = new Set([...fa].map((k) => { const [x, y] = xy(k); return (x + 1) + ',' + y; }));
  const fc = same(drawn(c), shifted);
  check('draw: (61, 41.81) draws it one pixel to the right', fc.ok, fc.detail);
  let least = Infinity, most = 0;
  for (let k = 0; k < 40; k++) { c.moveTo(70 + k * 0.137, 50 + k * 0.071); const n = drawn(c).size; least = Math.min(least, n); most = Math.max(most, n); }
  check('draw: the open hand lights the same pixels in number at 40 pointer phases', least === most, least + '..' + most + ' px');
}

// --- press and release -------------------------------------------------------------
{
  const c = new Cursor();
  c.moveTo(100, 100);
  c.press();
  const seen = [at(c)], whole = [c.frame], drawsOk = [];
  run(c, 13, STEP, (k) => {
    seen.push(at(k));
    whole.push(k.frame);
    const r = same(drawn(k), spriteAt(k.ink[at(k)], 100, 100));
    drawsOk.push(r.ok);
  });
  check('press: held, and 13 steps visit frames 0..13 in order, one a step', c.held === true && seen.join(',') === '0,1,2,3,4,5,6,7,8,9,10,11,12,13' &&
    whole.every((v, i) => v === i), seen.join(','));
  check('press: each step draws its own frame\'s sprite', drawsOk.length === 13 && drawsOk.every(Boolean));
  run(c, 30);
  check('press: held on, it stays the fist', c.frame === 13, String(c.frame));
  c.release();
  const back = [];
  run(c, 13, STEP, (k) => back.push(k.frame));
  check('release: 13 steps walk back 12..0, one a step', c.held === false && back.join(',') === '12,11,10,9,8,7,6,5,4,3,2,1,0', back.join(','));
  run(c, 30);
  check('release: let go, it stays open', c.frame === 0, String(c.frame));
  // let go half closed, it turns round where it is
  c.press();
  run(c, 5);
  c.release();
  const turn = [];
  run(c, 6, STEP, (k) => turn.push(k.frame));
  check('release mid-close: from frame 5 straight back down', turn.join(',') === '4,3,2,1,0,0', turn.join(','));
  const before = { x: c.x, y: c.y, shown: c.shown };
  c.press(); c.release();
  check('press and release touch neither the pointer nor shown', c.x === before.x && c.y === before.y && c.shown === before.shown && c.held === false);
}

// --- the time step -------------------------------------------------------------------
{
  const half = new Cursor();
  half.press();
  half.update(STEP / 2);
  const afterOne = half.frame;
  half.update(STEP / 2);
  check('dt: two updates of 1/120 s are one step', afterOne === 0 && half.frame === 1, afterOne + ' then ' + half.frame);
  const big = new Cursor();
  big.press();
  big.update(1);
  const most = Math.round(CURSOR.MAX_CATCHUP_S / CURSOR.STEP_S);
  check('dt: a 1 s stall catches up ' + most + ' steps, not 60', big.frame === most, String(big.frame));
  const none = new Cursor();
  none.press();
  none.update();
  check('dt: none given runs one step', none.frame === 1, String(none.frame));
  const zero = new Cursor();
  zero.press();
  zero.update(0);
  check('dt: 0 runs nothing', zero.frame === 0 && zero.owed === 0);
}

// --- the fist ------------------------------------------------------------------------
const OPEN_AT = { x: 30, y: 30 }, FIST_AT = { x: 30, y: 30 };
let openFb = null, fistFb = null, openLit = null, fistLit = null;
{
  const open = new Cursor(), fist = new Cursor();
  open.moveTo(OPEN_AT.x, OPEN_AT.y);
  fist.moveTo(FIST_AT.x, FIST_AT.y);
  fist.press();
  run(fist, 20);
  openFb = makeFb(60, 60); open.draw(openFb);
  fistFb = makeFb(60, 60); fist.draw(fistFb);
  const o = pixels(openFb), f = pixels(fistFb), ob = box(o), fb = box(f);
  const rows = (set) => new Set([...set].map((k) => xy(k)[1])).size;
  check('fist: fewer rows than the open hand, its top 8 art rows (' + (8 * S).toFixed(1) + ' px) lower, the same bottom',
    rows(f) < rows(o) && fb.y0 - ob.y0 >= Math.floor(8 * S) && fb.y0 - ob.y0 <= Math.ceil(8 * S) && fb.y1 === ob.y1,
    'open ' + rows(o) + ' rows ' + fmtBox(ob) + ', fist ' + rows(f) + ' rows ' + fmtBox(fb));
  const d = same(f, o);
  check('fist: not the open hand', !d.ok && f.size > 0, d.detail);
  const r = same(f, spriteAt(fist.ink[13], FIST_AT.x, FIST_AT.y, 60, 60));
  check('fist: frame 13 as a sprite on the same hotspot', r.ok, r.detail);
}

// --- the backing ---------------------------------------------------------------------
// on a lit field: an ellipse behind the hand goes dark, every pixel of the
// hand's own sprite stays lit, nothing outside the bitmap's box is touched,
// and the backing is as tall as the frame's ink
const backed = {};
function backing(name, frame, x, y) {
  const c = new Cursor();
  c.moveTo(x, y);
  if (frame) { c.press(); run(c, 20); }
  const fb = makeFb(60, 60);
  fb.bits.fill(1);
  c.draw(fb);
  const dark = pixels(fb, 0), hand = spriteAt(c.ink[at(c)], x, y, 60, 60);
  const cx = Math.floor(x - CURSOR.HOT.x * S) + 0.5, cy = Math.floor(y - CURSOR.HOT.y * S) + 0.5, hw = A.w * S / 2, hh = A.h * S / 2;
  const top = cy - hh + c.top[at(c)] * S;
  const lost = [...hand].filter((k) => dark.has(k)).length;
  // the ring is nudged X_OFFSET * SCALE left, and fillPolygon rounds its
  // spans' ends: half a pixel of slack each side
  const left = cx - hw + CURSOR.BACKING.X_OFFSET * S - 0.5;
  const outBox = [...dark].filter((k) => { const [px, py] = xy(k); return px + 0.5 < left || px + 0.5 > cx + hw + 0.5 || py + 0.5 < top || py + 0.5 > cy + hh; }).length;
  const b = box(dark);
  check(name + ': dark behind the hand, its own pixels all lit, nothing outside the box', dark.size > 0 && lost === 0 && outBox === 0,
    dark.size + ' dark, ' + lost + ' of ' + hand.size + ' hand pixels lost, ' + outBox + ' outside; dark ' + fmtBox(b));
  backed[name] = { fb, dark, b, top, bottom: cy + hh };
  return backed[name];
}
{
  const o = backing('backing open', 0, 30, 30);
  const f = backing('backing fist', 13, 30, 30);
  // the bitmap's bottom edge is 28.5 + 5.1 = 33.6 here: the ellipse fills
  // every row whose middle is above it
  check('backing: bottom-anchored, both down to the bitmap\'s bottom row', o.b.y1 === Math.ceil(o.bottom - 0.5) - 1 && f.b.y1 === o.b.y1,
    'open to row ' + o.b.y1 + ', fist to row ' + f.b.y1 + ', bottom edge ' + o.bottom);
  check('backing: the fist\'s is its own height, shorter than the open hand\'s', f.b.y0 > o.b.y0 && f.dark.size < o.dark.size,
    'open from row ' + o.b.y0 + ' (' + o.dark.size + ' px), fist from row ' + f.b.y0 + ' (' + f.dark.size + ' px), fist top edge ' + f.top);
}

// --- hiding --------------------------------------------------------------------------
{
  const c = new Cursor();
  c.moveTo(100, 100, false);
  check('moveTo(x, y, false): moved but not shown, draws nothing', c.x === 100 && c.y === 100 && c.shown === false && drawn(c).size === 0);
  c.moveTo(100, 100);
  const shown = drawn(c).size;
  c.hide();
  const lit = makeFb();
  lit.bits.fill(1);
  c.draw(lit);
  check('hide(): drawn, then hidden draws nothing, backing and all', shown > 0 && drawn(c).size === 0 && pixels(lit, 0).size === 0 && c.x === 100 && c.y === 100);
  c.press();
  run(c, 4);
  check('hidden: the frames still walk, so a hand shown mid-press is where it should be', c.frame === 4, String(c.frame));
  c.moveTo(80, 80);
  check('moveTo again: shown again', c.shown === true && drawn(c).size > 0);
}

// --- the mirror ----------------------------------------------------------------------
// pixel x covers x..x + 1, so turned over about the centre cx it lands on
// 2 cx - 1 - x
{
  const plain = new Cursor();
  plain.moveTo(100, 100);
  const a = drawn(plain);
  CURSOR.MIRROR = true;
  let m = null, inkOk = false;
  try {
    m = new Cursor();
    m.moveTo(100, 100);
    inkOk = A.frames.every((rows, f) => rows.every((r, y) => { for (let x = 0; x < 21; x++) if (m.ink[f].ink[y * 21 + x] !== (r[20 - x] === '#' ? 1 : 0)) return false; return true; }));
  } finally {
    CURSOR.MIRROR = false;
  }
  const cx = Math.floor(100 - CURSOR.HOT.x * S) + 0.5;
  const turned = new Set([...a].map((k) => { const [x, y] = xy(k); return (2 * cx - 1 - x) + ',' + y; }));
  const r = same(drawn(m), turned);
  check('mirror: MIRROR true reverses every row of every frame', inkOk);
  check('mirror: the open hand drawn with MIRROR true is the plain one turned over about its centre', r.ok && a.size > 0, r.detail);
  check('mirror: the flag restored', CURSOR.MIRROR === false && new Cursor().ink[0].ink[3] === 0);
}

// --- no NaN, off the edge ---------------------------------------------------------------
{
  const c = new Cursor();
  c.press();
  for (const dt of [undefined, NaN, -1, 0, 1e-9, STEP, 0.25, Infinity]) c.update(dt);
  const ok = [c.frame, c.owed].every(Number.isFinite) && c.frame >= 0 && c.frame <= 13;
  let threw = null;
  try {
    for (const [x, y] of [[1, 1], [-4, -4], [39, 39], [-1000, 5], [1e6, 1e6], [0.5, 39.5]]) {
      c.moveTo(x, y);
      c.draw(makeFb(40, 40));
    }
  } catch (e) { threw = e; }
  check('no NaN: odd dt, and drawn half off and wholly off the bitmap', ok && !threw, threw ? threw.message : 'frame ' + c.frame + ', owed ' + c.owed);
}

check('never read Date, performance, window, document, requestAnimationFrame or Math.random', reads === 0, reads + ' reads');

// --- the pictures ----------------------------------------------------------------------
// the pointer at (30, 30) is the bitmap's centre at (30, 28), x 24.75..35.25,
// y 19.5..36.5
console.log('\nthe pointer at (30, 30), x 22..37, y 18..37: open | fist, on dark:\n' +
  pair(dump(openFb, 22, 18, 16, 20), dump(fistFb, 22, 18, 16, 20)) + '\n');
console.log('the same on a lit field, the backing dark behind each:\n' +
  pair(dump(backed['backing open'].fb, 22, 18, 16, 20), dump(backed['backing fist'].fb, 22, 18, 16, 20)) + '\n');

console.log('\n' + (failures ? failures + ' failed' : 'all passed'));
process.exit(failures ? 1 : 0);
