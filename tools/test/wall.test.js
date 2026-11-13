// node tools/test/wall.test.js
//
// loads js/raster.js and js/wall.js the way the page does, classic scripts
// sharing one global scope, in a vm context with a fake WebSocket the test
// plays the server through, and a Date, a performance and timers that
// throw, so the wall cannot keep time of its own. checks the brush's shape
// at each size and its clipping at the bitmap's edges; that a stroke is
// the brush stamped along raster.js's line() walk; the cost of a stroke;
// that packing round-trips blank, noisy and run-heavy bitmaps and that
// unpacking refuses anything malformed, short or long without throwing or
// writing past its end; that a stroke message round-trips and every bad
// one is refused; that a snapshot makes the replica live through its lut;
// that own ink shows at once and stays once acked; that a stroke from
// someone else between own send and ack leaves own ink on top in shown
// and truth in the server's order; that a refused ack takes its ink off
// and leaves the later ink not yet acked; that the pen sends every BATCH
// ms and at MOST points, carrying the last point on; that ink running dry
// lifts the pen, comes back over time and is charged exactly what each
// message costs; that a lost socket drops the ink not yet acked and is
// tried again on the RETRY schedule; and that disconnect stops trying.
// exits 1 on failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}

// --- the scripts ----------------------------------------------------------------
// the browser's ImageData, as much of it as a Framebuffer makes
class ImageData {
  constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
}
// the server's end of every socket the wall opens
const sockets = [];
class FakeSocket {
  constructor(url) { this.url = url; this.binaryType = 'blob'; this.out = []; this.closed = false; sockets.push(this); }
  send(bytes) { this.out.push(Array.from(bytes)); }
  close() { this.closed = true; }
}
let reads = 0;
const sandbox = { ImageData, WebSocket: FakeSocket };
for (const name of ['Date', 'performance', 'setTimeout', 'setInterval', 'requestAnimationFrame']) {
  Object.defineProperty(sandbox, name, { get() { reads++; throw new Error('the wall read ' + name); } });
}
const ctx = vm.createContext(sandbox);
for (const file of ['js/raster.js', 'js/wall.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
}
const { Wall, WALL, Framebuffer } = vm.runInContext('({ Wall, WALL, Framebuffer })', ctx);
const W = WALL.W, H = WALL.H;

// --- helpers --------------------------------------------------------------------
let seed = 1;
const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const int = (n) => Math.floor(rand() * n);

// the first index where a and b differ, -1 when they are the same
function differ(a, b) {
  if (a.length !== b.length) return 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}
const where = (i) => i < 0 ? '' : 'first differs at ' + (i % W) + ',' + Math.floor(i / W);

// the lit pixels of a w by h bitmap, as sorted "x,y" strings
function lit(px, w) {
  const out = [];
  for (let i = 0; i < px.length; i++) if (px[i]) out.push((i % w) + ',' + Math.floor(i / w));
  return out;
}

// the brush, straight from its definition
function brush(px, w, h, x, y, size, v) {
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const dx = i + 0.5 - size / 2, dy = j + 0.5 - size / 2;
      const qx = x - Math.floor(size / 2) + i, qy = y - Math.floor(size / 2) + j;
      if (dx * dx + dy * dy <= size * size / 4 && qx >= 0 && qx < w && qy >= 0 && qy < h) px[qy * w + qx] = v;
    }
  }
}

// a whole wall in the page's bytes, strokes { colour, size, pts } painted on in order
function paint(strokes, lut) {
  const px = new Uint8Array(W * H).fill(lut[0]);
  for (const s of strokes) Wall.stroke(px, W, H, s.pts, s.size, lut[s.colour]);
  return px;
}

// what the server says
const hear = (s, bytes) => s.onmessage({ data: Uint8Array.from(bytes).buffer });
const ack = (s, ok) => hear(s, [WALL.ACK, ok]);
const sent = (s, k) => Wall.decodeStroke(Uint8Array.from(s.out[k]));

const IDENTITY = Array.from({ length: 16 }, (_, i) => i);
const LUT = Array.from({ length: 16 }, (_, i) => 200 + i);

// a replica connected and live on a blank wall, at now
function live(lut, now = 0) {
  const w = new Wall(lut && Uint8Array.from(lut));
  w.connect('ws://wall.test/');
  const s = sockets[sockets.length - 1];
  w.step(now);
  hear(s, Wall.encodeSnapshot(new Uint8Array(W * H)));
  return { w, s };
}

// --- the brush --------------------------------------------------------------------
{
  const px = new Uint8Array(12 * 12);
  Wall.stamp(px, 12, 12, 5, 5, 2, 1);
  check('size 2 is a 2x2 block, up and left of the point', lit(px, 12).join(' ') === '4,4 5,4 4,5 5,5', lit(px, 12).join(' '));
  px.fill(0);
  Wall.stamp(px, 12, 12, 5, 5, 4, 1);
  const want = [];
  for (let y = 3; y <= 6; y++) for (let x = 3; x <= 6; x++) if (!((x === 3 || x === 6) && (y === 3 || y === 6))) want.push(x + ',' + y);
  check('size 4 is 4x4 less its corners', lit(px, 12).join(' ') === want.join(' '), lit(px, 12).join(' '));
  const counts = WALL.SIZES.map((size) => {
    const a = new Uint8Array(40 * 40), b = new Uint8Array(40 * 40);
    Wall.stamp(a, 40, 40, 20, 20, size, 3);
    brush(b, 40, 40, 20, 20, size, 3);
    return { size, n: lit(a, 40).length, same: differ(a, b) < 0 };
  });
  check('every size is the round brush its definition gives', counts.every((c) => c.same), counts.map((c) => c.size + ': ' + c.n + ' px').join(', '));
  const n = (size) => counts.find((c) => c.size === size).n;
  check('1 is a px, 3 a 3x3 block, 8 is 52 px and 16 is 208, counted by hand', n(1) === 1 && n(3) === 9 && n(8) === 52 && n(16) === 208);
  let clipped = true;
  for (const size of WALL.SIZES) {
    for (const [x, y] of [[0, 0], [9, 0], [0, 5], [9, 5], [4, 0], [0, 3], [-3, 2], [12, 8]]) {
      const a = new Uint8Array(10 * 6), b = new Uint8Array(10 * 6);
      Wall.stamp(a, 10, 6, x, y, size, 1);
      brush(b, 10, 6, x, y, size, 1);
      if (differ(a, b) >= 0) clipped = false;
    }
  }
  check('clipped at every edge and corner, never wrapping onto the next row', clipped);
  const big = new Uint8Array(W * H), ref = new Uint8Array(W * H);
  for (const [x, y] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]]) {
    Wall.stamp(big, W, H, x, y, 16, 1);
    brush(ref, W, H, x, y, 16, 1);
  }
  check('clipped at the wall\'s corners', differ(big, ref) < 0, where(differ(big, ref)));
}

// --- a stroke ---------------------------------------------------------------------
{
  // the walk raster.js's line() takes, each pixel of it stamped
  const fb = new Framebuffer(W, H);
  let same = true, detail = '';
  for (let t = 0; t < 40; t++) {
    const n = 1 + int(6), pts = [];
    for (let k = 0; k < n; k++) pts.push(int(W), int(H));
    if (t === 0) pts.splice(0, pts.length, 30, 40);
    const size = WALL.SIZES[t % WALL.SIZES.length];
    fb.clear();
    if (n === 1 || t === 0) fb.set(pts[0], pts[1], 1);
    for (let k = 2; k < pts.length; k += 2) fb.line(pts[k - 2], pts[k - 1], pts[k], pts[k + 1], 1);
    const want = new Uint8Array(W * H), got = new Uint8Array(W * H);
    for (let i = 0; i < fb.bits.length; i++) if (fb.bits[i]) Wall.stamp(want, W, H, i % W, Math.floor(i / W), size, 7);
    Wall.stroke(got, W, H, pts, size, 7);
    if (differ(got, want) >= 0 && same) { same = false; detail = 'size ' + size + ' ' + pts.join(',') + ' ' + where(differ(got, want)); }
  }
  check('a stroke is the brush at every pixel of line()\'s walk, one point a stamp', same, detail);
  const px = new Uint8Array(W * H);
  Wall.stroke(px, W, H, [5, 5, 5, 5, 8, 5], 2, 1);
  check('a point repeated adds nothing', lit(px, W).length === 2 * 5, lit(px, W).length + ' px');
}

check('cost: one point is its size', Wall.cost([10, 10], 4) === 4 && Wall.cost([0, 0], 16) === 16);
check('cost: a segment is its longer side plus one, times the size', Wall.cost([0, 0, 10, 3], 2) === 22 && Wall.cost([10, 3, 0, 0], 2) === 22);
check('cost: the points between segments counted once', Wall.cost([0, 0, 10, 3, 10, 3, 5, 20], 8) === (10 + 0 + 17 + 1) * 8, Wall.cost([0, 0, 10, 3, 10, 3, 5, 20], 8));

// --- packing ------------------------------------------------------------------------
{
  const trip = (px) => {
    const packed = Wall.pack(px), back = new Uint8Array(px.length);
    return { ok: Wall.unpack(packed, back) && differ(back, px) < 0, n: packed.length, bound: packed.length <= px.length + Math.ceil(px.length / 128) + 1 };
  };
  const blank = trip(new Uint8Array(W * H));
  check('a blank wall round-trips, a run of 128 in two bytes', blank.ok && blank.n === 2 * Math.ceil(W * H / 128), blank.n + ' bytes');
  const noisy = new Uint8Array(W * H);
  for (let i = 0; i < noisy.length; i++) noisy[i] = int(16);
  const n = trip(noisy);
  check('a noisy wall round-trips, never more than a byte in 128 longer', n.ok && n.bound, n.n + ' bytes for ' + W * H);
  const runs = new Uint8Array(W * H);
  for (let i = 0; i < runs.length;) { const len = 1 + int(300), v = int(16); runs.fill(v, i, i + len); i += len; }
  const r = trip(runs);
  check('a run-heavy wall round-trips', r.ok && r.bound && r.n < W * H / 20, r.n + ' bytes');
  // a, bb, c, dd ... and ab ab ... are the worst cases for a run-length coder
  const pairs = new Uint8Array(3000), alt = new Uint8Array(3000);
  for (let i = 0; i < 3000; i++) { pairs[i] = Math.floor(i / 3) * 2 + (i % 3 ? 1 : 0); alt[i] = i % 2; }
  const p = trip(pairs), a = trip(alt);
  check('the worst cases round-trip within the bound', p.ok && p.bound && a.ok && a.bound, p.n + ', ' + a.n + ' bytes for 3000');
  let small = true;
  for (const len of [0, 1, 2, 3, 4, 127, 128, 129, 130, 255, 256, 257]) {
    for (let t = 0; t < 20; t++) {
      const px = new Uint8Array(len);
      for (let i = 0; i < len; i++) px[i] = t % 2 ? int(3) : (i >> 2) % 2;
      const s = trip(px);
      if (!s.ok || !s.bound) small = false;
    }
  }
  check('every short length round-trips', small);

  // into a window of a larger buffer, its guards either side marked
  const guarded = (bytes, len) => {
    const buf = new Uint8Array(len + 8).fill(0xee), into = buf.subarray(4, 4 + len);
    let ok, threw = false;
    try { ok = Wall.unpack(Uint8Array.from(bytes), into); } catch (e) { threw = true; }
    const guards = buf.slice(0, 4).every((v) => v === 0xee) && buf.slice(4 + len).every((v) => v === 0xee);
    return { ok, threw, guards, into };
  };
  const g = guarded([2, 7, 8, 9, 254, 5], 6);
  check('a literal then a run unpack', g.ok === true && Array.from(g.into).join() === '7,8,9,5,5,5', Array.from(g.into).join());
  const skip = guarded([128, 2, 7, 8, 9, 128, 254, 5, 128], 6);
  check('a header of 128 is passed over', skip.ok === true && Array.from(skip.into).join() === '7,8,9,5,5,5');
  const bad = [
    ['a literal cut short', [3, 1, 2]],
    ['a run with no byte to repeat', [0, 9, 250]],
    ['too few bytes', [0, 9]],
    ['too many bytes', [2, 7, 8, 9, 250, 5]],
    ['a literal past the end', [9, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
    ['nothing', []],
  ];
  for (const [what, bytes] of bad) {
    const b = guarded(bytes, 6);
    check('unpack refuses ' + what + ', writing nothing past its end', b.ok === false && !b.threw && b.guards, String(b.ok));
  }
  let safe = true;
  for (let t = 0; t < 2000; t++) {
    const bytes = [];
    for (let i = 0, n = int(40); i < n; i++) bytes.push(int(256));
    const b = guarded(bytes, int(64));
    if (b.threw || !b.guards || typeof b.ok !== 'boolean') safe = false;
  }
  check('unpack never throws or writes past its end on noise', safe);
}

// --- the messages -------------------------------------------------------------------
{
  const e = Array.from(Wall.encodeStroke(5, 8, [300, 2]));
  check('a stroke message: type, colour, size, n, then u16 x and y little-endian', e.join() === '1,5,8,1,44,1,2,0', e.join());
  const pts = [];
  for (let k = 0; k < WALL.MOST; k++) pts.push(k ? int(W) : W - 1, k ? int(H) : H - 1);
  const d = Wall.decodeStroke(Wall.encodeStroke(15, 16, pts));
  check('a stroke of MOST points round-trips, the far corner too', d && d.colour === 15 && d.size === 16 && d.pts.join() === pts.join());
  const one = Wall.decodeStroke(Wall.encodeStroke(0, 2, [0, 0]));
  check('a stroke of one point round-trips', one && one.colour === 0 && one.size === 2 && one.pts.join() === '0,0');
  const good = Array.from(Wall.encodeStroke(3, 4, [10, 20, 30, 40]));
  const refused = [
    ['nothing', []],
    ['three bytes', [1, 3, 4]],
    ['another type', [WALL.ACK].concat(good.slice(1))],
    ['no points', [1, 3, 4, 0]],
    ['more than MOST points', [1, 3, 4, WALL.MOST + 1].concat(new Array(4 * (WALL.MOST + 1)).fill(0))],
    ['a byte short', good.slice(0, -1)],
    ['a byte long', good.concat([0])],
    ['a colour past the last', [1, WALL.COLOURS.length].concat(good.slice(2))],
    ['a size not among SIZES', [1, 3, 9].concat(good.slice(3))],
    ['a size of none', [1, 3, 0].concat(good.slice(3))],
    ['x off the wall', Array.from(Wall.encodeStroke(3, 4, [10, 20, W, 40]))],
    ['y off the wall', Array.from(Wall.encodeStroke(3, 4, [10, H, 30, 40]))],
  ];
  for (const [what, bytes] of refused) check('decodeStroke refuses ' + what, Wall.decodeStroke(Uint8Array.from(bytes)) === null);
  check('and takes the good one', Wall.decodeStroke(Uint8Array.from(good)).pts.join() === '10,20,30,40');
  const px = paint([{ colour: 9, size: 16, pts: [100, 100, 900, 300] }], IDENTITY);
  const snap = Wall.encodeSnapshot(px), back = new Uint8Array(W * H);
  check('a snapshot: its type, W and H, then the bitmap packed',
    snap[0] === WALL.SNAPSHOT && (snap[1] | snap[2] << 8) === W && (snap[3] | snap[4] << 8) === H && Wall.unpack(snap.subarray(5), back) && differ(back, px) < 0);
}

// --- the replica --------------------------------------------------------------------
{
  const w = new Wall(Uint8Array.from(LUT));
  check('a new replica: both bitmaps paper through the lut, not live', w.truth.every((v) => v === 200) && w.shown.every((v) => v === 200) && !w.live);
  check('the pen draws nothing before it is live', w.pen(5, 8, 100, 100, 0) === false && w.shown.every((v) => v === 200));
  const plain = new Wall();
  check('the lut is the identity when none is given', plain.truth.every((v) => v === 0));
  w.connect('ws://wall.test/');
  const s = sockets[sockets.length - 1];
  check('connect opens a socket for array buffers', s.url === 'ws://wall.test/' && s.binaryType === 'arraybuffer');
  const px = paint([{ colour: 3, size: 16, pts: [10, 10, 500, 200] }, { colour: 15, size: 8, pts: [W - 1, H - 1] }], IDENTITY);
  const snap = Array.from(Wall.encodeSnapshot(px));
  const wrongW = snap.slice(), wrongH = snap.slice();
  wrongW[1] ^= 1;
  wrongH[3] ^= 1;
  for (const [what, bytes] of [['a wrong W', wrongW], ['a wrong H', wrongH], ['a short one', snap.slice(0, -1)], ['a long one', snap.concat([0, 0])], ['five bytes', snap.slice(0, 5)]]) {
    hear(s, bytes);
    check('a snapshot with ' + what + ' is ignored', !w.live && w.truth.every((v) => v === 200));
  }
  hear(s, snap);
  const want = paint([{ colour: 3, size: 16, pts: [10, 10, 500, 200] }, { colour: 15, size: 8, pts: [W - 1, H - 1] }], LUT);
  check('a snapshot makes it live, each byte through the lut', w.live && differ(w.truth, want) < 0 && differ(w.shown, want) < 0, where(differ(w.truth, want)));
}

{
  const { w, s } = live(LUT, 1000);
  const own = { colour: 5, size: 8, pts: [100, 100, 140, 120] };
  const ok = w.pen(5, 8, 100.4, 99.6, 1000) && w.pen(5, 8, 140, 120, 1010);
  check('own ink shows at once, before it is sent', ok && differ(w.shown, paint([own], LUT)) < 0 && w.truth.every((v) => v === 200) && s.out.length === 0);
  w.lift();
  check('lift sends it', s.out.length === 1 && sent(s, 0).pts.join() === own.pts.join() && sent(s, 0).colour === 5 && sent(s, 0).size === 8);
  ack(s, 1);
  check('and it stays once acked, truth and shown the same', differ(w.shown, paint([own], LUT)) < 0 && differ(w.truth, w.shown) < 0);
  check('the pen is rounded and clamped onto the wall', w.pen(2, 2, -50, H + 50, 1100) && w.shown[(H - 1) * W] === LUT[2]);
}

{
  // someone else's stroke reaches the server between own send and its ack
  const { w, s } = live(LUT);
  const own = { colour: 5, size: 16, pts: [50, 50, 150, 50] };
  const theirs = { colour: 2, size: 16, pts: [100, 20, 100, 80] };
  w.pen(5, 16, 50, 50, 0); w.pen(5, 16, 150, 50, 0); w.lift();
  hear(s, Wall.encodeStroke(theirs.colour, theirs.size, theirs.pts));
  check('their stroke goes under own ink in shown', differ(w.shown, paint([theirs, own], LUT)) < 0 && w.shown[50 * W + 100] === LUT[5]);
  check('and onto truth alone', differ(w.truth, paint([theirs], LUT)) < 0);
  ack(s, 1);
  check('once acked, truth is theirs then own, the server\'s order, and shown is truth', differ(w.truth, paint([theirs, own], LUT)) < 0 && differ(w.shown, w.truth) < 0);
  // and after it
  const b = live(LUT);
  b.w.pen(5, 16, 50, 50, 0); b.w.pen(5, 16, 150, 50, 0); b.w.lift();
  ack(b.s, 1);
  hear(b.s, Wall.encodeStroke(theirs.colour, theirs.size, theirs.pts));
  check('a stroke after own ack goes on top of it', differ(b.w.truth, paint([own, theirs], LUT)) < 0 && differ(b.w.shown, b.w.truth) < 0 && b.w.shown[50 * W + 100] === LUT[2]);
  hear(b.s, [WALL.STROKE, 99, 1, 2]);
  check('a malformed stroke from the server is ignored', differ(b.w.truth, paint([own, theirs], LUT)) < 0);
}

{
  // the first of two sent strokes refused, a third not yet sent
  const { w, s } = live(LUT);
  const first = { colour: 5, size: 16, pts: [50, 50, 150, 50] };
  const second = { colour: 7, size: 8, pts: [100, 40, 100, 120] };
  const third = { colour: 9, size: 4, pts: [60, 52, 90, 52] };
  w.pen(5, 16, 50, 50, 0); w.pen(5, 16, 150, 50, 0);
  w.pen(7, 8, 100, 40, 0); w.pen(7, 8, 100, 120, 0); w.lift();
  w.pen(9, 4, 60, 52, 0); w.pen(9, 4, 90, 52, 0);
  check('three strokes shown, two sent', s.out.length === 2 && differ(w.shown, paint([first, second, third], LUT)) < 0);
  ack(s, 0);
  check('a refused ack takes its ink off and leaves the later ink', differ(w.shown, paint([second, third], LUT)) < 0 && w.truth.every((v) => v === 200), where(differ(w.shown, paint([second, third], LUT))));
  ack(s, 1);
  check('the next ack is the next stroke', differ(w.truth, paint([second], LUT)) < 0 && differ(w.shown, paint([second, third], LUT)) < 0);
  ack(s, 1);
  check('an ack with nothing waiting is ignored', differ(w.truth, paint([second], LUT)) < 0);
}

// --- batching -----------------------------------------------------------------------
{
  const { w, s } = live(IDENTITY, 1000);
  w.pen(1, 4, 10, 10, 1000);
  w.step(1000);
  check('a stroke\'s first point goes on the next step, BATCH since the last send', s.out.length === 1 && sent(s, 0).pts.join() === '10,10');
  w.pen(1, 4, 20, 10, 1010); w.pen(1, 4, 30, 10, 1020);
  w.step(1020); w.step(1000 + WALL.BATCH - 1);
  check('nothing more before BATCH ms', s.out.length === 1);
  w.step(1000 + WALL.BATCH);
  check('then the points since, the last point carried first', s.out.length === 2 && sent(s, 1).pts.join() === '10,10,20,10,30,10', s.out.length > 1 ? sent(s, 1).pts.join() : '');
  w.pen(1, 4, 30, 10, 1060);
  w.step(1200);
  w.lift();
  check('a batch holding only the carried point is never sent, by step or by lift', s.out.length === 2);
  check('a move to the same pixel is true and adds nothing', w.pen(1, 4, 30, 10, 1300) && w.pen(1, 4, 30, 10, 1300) && w.unsent.join() === '30,10');
  w.lift();
  const n = s.out.length;
  const pts = [];
  for (let k = 0; k <= WALL.MOST; k++) {
    const x = 100 + 3 * k, y = 200 + (k % 2) * 5;
    pts.push(x, y);
    w.pen(1, 4, x, y, 2000);
  }
  const m = s.out.slice(n).map((b) => Wall.decodeStroke(Uint8Array.from(b)).pts);
  check('MOST points are sent at once, without a step', m.length === 1 && m[0].length === 2 * WALL.MOST && m[0].join() === pts.slice(0, 2 * WALL.MOST).join());
  w.step(2000 + WALL.BATCH);
  const last = Wall.decodeStroke(Uint8Array.from(s.out[s.out.length - 1])).pts;
  check('and the next begins with their last point', s.out.length === n + 2 && last.join() === pts.slice(-4).join(), last.join());
  w.lift();
  const all = [];
  for (let k = 0; k < s.out.length; k++) all.push(sent(s, k));
  check('every message holds 1 to MOST points', all.every((b) => b && b.pts.length >= 2 && b.pts.length <= 2 * WALL.MOST));
  for (let k = 0; k < all.length; k++) ack(s, 1);
  check('the batches together paint what was shown', differ(w.truth, w.shown) < 0);
  w.pen(1, 4, 400, 400, 3000); w.pen(1, 8, 410, 400, 3000);
  check('a new size lifts the stroke and begins another', sent(s, s.out.length - 1).pts.join() === '400,400' && sent(s, s.out.length - 1).size === 4);
}

// --- ink ------------------------------------------------------------------------------
{
  const { w, s } = live(IDENTITY, 5000);
  check('a new pen is full', w.ink(5000) === 1);
  // the charges between sends, all at one time so nothing comes back
  let level = w.level, every = true, sends = 0, k = 0, ok = true, x = 40, y = 20;
  const before = new Uint8Array(W * H);
  while (ok) {
    before.set(w.shown);
    x = k % 2 ? 70 : 40;
    y = 20 + (k >> 1);
    ok = w.pen(3, 16, x, y, 5000);
    if (ok) w.step(5000);
    k++;
    while (sends < s.out.length) {
      const b = sent(s, sends++);
      if (Math.abs(level - w.level - Wall.cost(b.pts, b.size)) > 1e-9) every = false;
      level = w.level;
    }
  }
  check('each message is charged exactly what it costs', every && sends > 3, sends + ' messages, ' + k + ' moves');
  check('a move the pen cannot pay for is refused and nothing of it drawn', differ(w.shown, before) < 0 && w.level < 16 * 31);
  check('the pen is lifted, what it had paid for sent', w.colour === -1 && w.unsent.length === 0 && w.sent.length === sends);
  while (w.level >= 16) { w.pen(3, 16, 700, 500, 5000); w.lift(); }
  before.set(w.shown);
  check('a stroke cannot begin without ink for its first stamp', w.pen(3, 16, 900, 500, 5000) === false && differ(w.shown, before) < 0);
  const dry = w.ink(5000);
  check('ink comes back RATE a second', Math.abs(w.ink(6000) - dry - WALL.RATE / WALL.INK) < 1e-9, dry.toFixed(4) + ' then ' + w.ink(6000).toFixed(4));
  w.step(6000 + 1000 * WALL.INK / WALL.RATE);
  check('up to a full pen, no more', w.ink(6000 + 1000 * WALL.INK / WALL.RATE + 60000) === 1);
  // and over a session of strokes, sizes, colours and dry spells
  let spent = 0, charged = 0, now = 100000;
  const n = s.out.length;
  w.ink(now);
  for (let t = 0; t < 3000; t++) {
    if (int(20) === 0) w.lift();
    if (int(30) === 0) { x = int(W); y = int(H); }
    x += int(81) - 40;
    y += int(81) - 40;
    const was = w.level;
    w.pen(int(3) ? 4 : int(16), WALL.SIZES[int(50) ? WALL.SIZES.length - 1 : int(WALL.SIZES.length)], x, y, now);
    charged += was - w.level;
    if (int(3) === 0) w.step(now += 20);
  }
  w.lift();
  for (let k = n; k < s.out.length; k++) { const b = sent(s, k); spent += Wall.cost(b.pts, b.size); }
  check('over a session, all it was charged is all its messages cost', spent > 0 && Math.abs(spent - charged) < 1e-6, spent + ' and ' + charged.toFixed(3));
}

// --- the link -----------------------------------------------------------------------
{
  const { w, s } = live(LUT, 10000);
  w.pen(5, 8, 100, 100, 10000); w.pen(5, 8, 200, 100, 10000); w.lift(); ack(s, 1);
  const acked = w.truth.slice();
  w.pen(7, 8, 150, 50, 10000); w.pen(7, 8, 150, 150, 10000); w.lift();
  w.pen(9, 8, 300, 50, 10000); w.pen(9, 8, 310, 60, 10000);
  const made = sockets.length;
  s.onerror({}); s.onclose({});
  check('a lost socket: not live, and the ink not yet acked is gone', !w.live && differ(w.shown, acked) < 0 && differ(w.truth, acked) < 0);
  check('the pen draws nothing while it is gone', w.pen(5, 8, 400, 400, 10000) === false && differ(w.shown, acked) < 0);
  // an error then a close schedules once: RETRY[0], then RETRY[1]
  const opened = [];
  let t = 10000, sock = s;
  for (let k = 0; k < 6; k++) {
    const from = t, before = sockets.length;
    while (sockets.length === before && t < from + 20000) w.step(++t);
    opened.push(t - from);
    sock = sockets[sockets.length - 1];
    sock.onclose({});
  }
  check('tried again RETRY[0], RETRY[1] ... after the last step, the last repeating', opened.join() === [1000, 2000, 5000, 10000, 10000, 10000].join(), opened.join());
  check('one socket a try', sockets.length === made + 6);
  const old = sockets[sockets.length - 2];
  while (sockets.length === made + 6) w.step(++t);
  const cur = sockets[sockets.length - 1];
  hear(old, Wall.encodeSnapshot(new Uint8Array(W * H)));
  old.onclose({});
  w.step(t + 50000);
  check('an old socket\'s messages and closes are ignored', !w.live && sockets.length === made + 7);
  hear(cur, Wall.encodeSnapshot(new Uint8Array(W * H)));
  check('a snapshot on the current one makes it live', w.live);
  t += 50000;
  cur.onerror({}); cur.onclose({});
  const from = t, before = sockets.length;
  while (sockets.length === before && t < from + 20000) w.step(++t);
  check('and puts the tries back to the first', t - from === WALL.RETRY[0], t - from);
  const last = sockets[sockets.length - 1];
  hear(last, Wall.encodeSnapshot(new Uint8Array(W * H)));
  w.pen(5, 8, 100, 100, t); w.lift();
  w.disconnect();
  w.step(t + 1e6);
  check('disconnect closes the socket, drops the ink not yet acked and stops trying', last.closed && !w.live && w.shown.every((v) => v === LUT[0]) && sockets.length === before + 1);
  w.connect('ws://wall.test/');
  check('and connect opens one again at once', sockets.length === before + 2 && w.socket === sockets[sockets.length - 1]);
}

check('nothing read the clock or set a timer', reads === 0);

console.log(failures ? failures + ' failed' : 'all passed');
process.exit(failures ? 1 : 0);
