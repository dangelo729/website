// checks js/raster.js against hand-worked cases, against a straight port
// of cicada's renderer, and its sprites against the page's old drawGlyph.
// node tools/test/raster.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// the browser's ImageData, as much of it as present() touches
class ImageData {
  constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
}
const sandbox = vm.createContext({ ImageData });
const file = path.join(__dirname, '..', '..', 'js', 'raster.js');
vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
const Framebuffer = sandbox.Framebuffer;

let checks = 0;
const failures = [];
function check(ok, what) { checks++; if (!ok) failures.push(what); }

// the lit pixels as sorted "x,y" strings
function lit(fb) {
  const out = [];
  for (let y = 0; y < fb.h; y++) for (let x = 0; x < fb.w; x++) if (fb.bits[y * fb.w + x]) out.push(x + ',' + y);
  return out;
}
const pts = (list) => list.map(([x, y]) => x + ',' + y).sort((a, b) => {
  const [ax, ay] = a.split(',').map(Number), [bx, by] = b.split(',').map(Number);
  return ay - by || ax - bx;
});
const same = (a, b) => a.length === b.length && a.every((s, i) => s === b[i]);
function expectLit(fb, list, what) {
  const got = lit(fb), want = pts(list);
  check(same(got, want), what + ': want ' + want.join(' ') + ' got ' + got.join(' '));
}

// cicada's Renderer, ported line for line onto a 0/1 array
function Cicada(w, h) {
  this.w = w; this.h = h; this.data = new Uint8Array(w * h);
}
Cicada.prototype.setPixel = function (x, y) {
  if (x >= 0 && x < this.w && y >= 0 && y < this.h) this.data[y * this.w + x] = 1;
};
Cicada.prototype.drawColoredPixelLine = function (x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    if (x0 >= 0 && x0 < this.w && y0 >= 0 && y0 < this.h) this.data[y0 * this.w + x0] = 1;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
};
Cicada.prototype.drawColoredPixelLineWorld = function (x0, y0, x1, y1) {
  this.drawColoredPixelLine(Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1));
};
Cicada.prototype.drawCircle = function (centerX, centerY, radius) {
  let x = radius;
  let y = 0;
  let error = 1 - x;
  while (x >= y) {
    this.setPixel(centerX + x, centerY + y);
    this.setPixel(centerX + y, centerY + x);
    this.setPixel(centerX - y, centerY + x);
    this.setPixel(centerX - x, centerY + y);
    this.setPixel(centerX - x, centerY - y);
    this.setPixel(centerX - y, centerY - x);
    this.setPixel(centerX + y, centerY - x);
    this.setPixel(centerX + x, centerY - y);
    y++;
    if (error < 0) { error += 2 * y + 1; } else { x--; error += 2 * (y - x) + 1; }
  }
};
Cicada.prototype.drawFilledCircle = function (centerX, centerY, radius) {
  let x = radius;
  let y = 0;
  let error = 1 - x;
  centerX = Math.round(centerX);
  centerY = Math.round(centerY);
  while (x >= y) {
    for (let i = centerX - x; i <= centerX + x; i++) { this.setPixel(i, centerY + y); this.setPixel(i, centerY - y); }
    for (let i = centerX - y; i <= centerX + y; i++) { this.setPixel(i, centerY + x); this.setPixel(i, centerY - x); }
    y++;
    if (error < 0) { error += 2 * y + 1; } else { x--; error += 2 * (y - x) + 1; }
  }
};
Cicada.prototype.drawFilledPolygon = function (points) {
  if (points.length < 3) return;
  let minY = Infinity, maxY = -Infinity;
  let minX = Infinity, maxX = -Infinity;
  for (const point of points) {
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
  }
  minY = Math.floor(minY);
  maxY = Math.ceil(maxY);
  for (let y = minY; y <= maxY; y++) {
    const intersections = [];
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      if ((p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y)) {
        const t = (y - p1.y) / (p2.y - p1.y);
        const x = p1.x + t * (p2.x - p1.x);
        intersections.push(x);
      }
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i < intersections.length; i += 2) {
      if (i + 1 < intersections.length) {
        const x1 = Math.round(intersections[i]);
        const x2 = Math.round(intersections[i + 1]);
        for (let x = x1; x <= x2; x++) {
          if (x >= 0 && x < this.w && y >= 0 && y < this.h) this.data[y * this.w + x] = 1;
        }
      }
    }
  }
};
function matches(fb, ref) {
  for (let i = 0; i < fb.bits.length; i++) if (fb.bits[i] !== ref.data[i]) return false;
  return true;
}

// a seeded random, so a failure repeats
let seed = 0x5eed;
function rand() {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (a, b) => a + (b - a) * rand();

// --- set, get, clear, clipping
{
  const fb = new Framebuffer(8, 6);
  check(fb.w === 8 && fb.h === 6 && fb.bits.length === 48, 'size');
  fb.set(2, 3);
  check(fb.get(2, 3) === 1, 'set then get');
  for (const [x, y] of [[-1, 0], [8, 0], [0, -1], [0, 6], [-5, -5], [100, 3]]) fb.set(x, y);
  expectLit(fb, [[2, 3]], 'set clips');
  check(fb.get(-1, 0) === 0 && fb.get(8, 0) === 0 && fb.get(0, 6) === 0 && fb.get(0, -1) === 0, 'get outside is 0');
  fb.set(2, 3, 0);
  check(fb.get(2, 3) === 0, 'set 0 clears a pixel');
  fb.set(7, 5); fb.set(0, 0);
  expectLit(fb, [[0, 0], [7, 5]], 'corners');
  fb.clear();
  expectLit(fb, [], 'clear');
}

// --- line
{
  const fb = new Framebuffer(8, 8);
  fb.line(0, 0, 4, 2);
  expectLit(fb, [[0, 0], [1, 0], [2, 1], [3, 1], [4, 2]], 'line 0,0 4,2');
  fb.clear(); fb.line(4, 2, 0, 0);
  expectLit(fb, [[4, 2], [3, 2], [2, 1], [1, 1], [0, 0]], 'line 4,2 0,0 (bresenham is not symmetric)');
  fb.clear(); fb.line(0, 0, 3, 3);
  expectLit(fb, [[0, 0], [1, 1], [2, 2], [3, 3]], 'line diagonal');
  fb.clear(); fb.line(0.4, 0.6, 2.5, 0.49);
  expectLit(fb, [[0, 1], [1, 1], [2, 0], [3, 0]], 'line rounds its ends');
  fb.clear(); fb.line(3, 3, 3, 3);
  expectLit(fb, [[3, 3]], 'line of one point');
  fb.clear(); fb.line(-2, 1, 10, 1);
  expectLit(fb, [0, 1, 2, 3, 4, 5, 6, 7].map((x) => [x, 1]), 'line clips');
  fb.clear(); fb.line(1, 1, 5, 5, 1); fb.line(1, 1, 5, 5, 0);
  expectLit(fb, [], 'line writes v');
  let ok = true;
  for (let n = 0; n < 500 && ok; n++) {
    const a = new Framebuffer(40, 30), b = new Cicada(40, 30);
    const c = [between(-10, 50), between(-10, 40), between(-10, 50), between(-10, 40)];
    a.line(...c); b.drawColoredPixelLineWorld(...c);
    ok = matches(a, b);
    if (!ok) failures.push('line vs cicada at ' + c.join(' '));
  }
  check(ok, 'line vs cicada');
}

// --- polygon
{
  const fb = new Framebuffer(8, 8);
  const square = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
  fb.fillPolygon(square);
  const want = [];
  for (let y = 0; y < 4; y++) for (let x = 0; x <= 4; x++) want.push([x, y]);
  expectLit(fb, want, 'square: rows 0..3, columns 0..4');
  const ref = new Cicada(8, 8);
  ref.drawFilledPolygon(square);
  check(matches(fb, ref), 'square vs cicada');
  fb.clear(); fb.fillPolygon(square.slice(0, 2));
  expectLit(fb, [], 'two points fill nothing');
  fb.clear(); fb.fillPolygon(square); fb.fillPolygon([{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }, { x: 1, y: 3 }], 0);
  check(fb.get(1, 1) === 0 && fb.get(3, 2) === 0 && fb.get(0, 0) === 1 && fb.get(4, 3) === 1, 'fill writes v');
  // rings like the bubble's, some hanging off every edge, against cicada
  let ok = true;
  for (let n = 0; n < 400 && ok; n++) {
    const W = 50, H = 40, a = new Framebuffer(W, H), b = new Cicada(W, H);
    const cx = between(-20, W + 20), cy = between(-20, H + 20), r = between(1, 30), k = 3 + Math.floor(rand() * 30);
    const ring = [];
    for (let i = 0; i < k; i++) {
      const t = -Math.PI / 2 + i / k * 2 * Math.PI, rr = r * between(0.6, 1.3);
      ring.push({ x: cx + rr * Math.cos(t), y: cy + rr * Math.sin(t) });
    }
    if (n % 7 === 0) for (const p of ring) { p.x = Math.round(p.x); p.y = Math.round(p.y); }
    a.fillPolygon(ring); b.drawFilledPolygon(ring);
    ok = matches(a, b);
    if (!ok) failures.push('polygon vs cicada at ' + JSON.stringify(ring));
  }
  check(ok, 'polygon vs cicada');
}

// --- circles
{
  const fb = new Framebuffer(11, 11);
  fb.circle(5, 5, 1);
  expectLit(fb, [[4, 5], [6, 5], [5, 4], [5, 6]], 'circle r 1 is a plus');
  check(fb.get(5, 5) === 0, 'circle r 1 leaves the centre');
  fb.clear(); fb.circle(5, 5, 0);
  expectLit(fb, [[5, 5]], 'circle r 0');
  let ok = true;
  for (let r = 0; r <= 12 && ok; r++) {
    const a = new Framebuffer(30, 30), b = new Cicada(30, 30);
    a.circle(14, 15, r); b.drawCircle(14, 15, r);
    ok = matches(a, b);
    const c = new Framebuffer(30, 30), d = new Cicada(30, 30);
    c.fillCircle(14.4, 15.6, r); d.drawFilledCircle(14.4, 15.6, r);
    ok = ok && matches(c, d);
    if (!ok) failures.push('circle vs cicada at r ' + r);
  }
  check(ok, 'circles vs cicada');
  fb.clear(); fb.fillCircle(5, 5, 1);
  expectLit(fb, [[4, 5], [5, 5], [6, 5], [5, 4], [5, 6]], 'fill circle r 1');
}

// --- rows
{
  const fb = new Framebuffer(6, 6);
  fb.set(2, 1);
  fb.blitRows(['#.', '.#', '##'], 1, 1);
  expectLit(fb, [[1, 1], [2, 1], [2, 2], [1, 3], [2, 3]], "rows: '#' written, '.' untouched");
  fb.blitRows(['#'], 2, 2, 0);
  check(fb.get(2, 2) === 0, 'rows write v');
  fb.clear(); fb.blitRows(['###', '###'], -1, 5);
  expectLit(fb, [[0, 5], [1, 5]], 'rows clip');
}

// --- packed
{
  const fb = new Framebuffer(12, 4);
  fb.bits.fill(1);
  // 10 wide, 2 high, 3 bytes a row, starting at byte 1
  const bytes = new Uint8Array([0xAA, 0b10000001, 0b01000000, 0xFF, 0b00000000, 0b11000000, 0x00]);
  fb.blitPacked(bytes, 1, 10, 2, 3, 1, 1);
  const row1 = [1, 0, 0, 0, 0, 0, 0, 1, 0, 1], row2 = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1];
  let ok = true;
  for (let x = 0; x < 10; x++) ok = ok && fb.get(1 + x, 1) === row1[x] && fb.get(1 + x, 2) === row2[x];
  check(ok, 'packed decodes msb first with a stride');
  ok = true;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 12; x++)
    if (!(y >= 1 && y <= 2 && x >= 1 && x <= 10)) ok = ok && fb.get(x, y) === 1;
  check(ok, 'packed leaves the rest alone');
  fb.clear();
  fb.blitPacked(new Uint8Array([0xFF, 0xFF]), 0, 16, 1, 2, -6, 0);
  let n = 0;
  for (let x = 0; x < 12; x++) n += fb.get(x, 0);
  check(n === 10 && fb.get(9, 0) === 1 && fb.get(10, 0) === 0, 'packed clips');
}

// --- present
{
  const fb = new Framebuffer(3, 2);
  fb.set(0, 0); fb.set(2, 1);
  const calls = [];
  const ctx = { putImageData(img, x, y) { calls.push({ img, x, y, px: Array.from(new Uint32Array(img.data.buffer)), data: Array.from(img.data) }); } };
  fb.present(ctx);
  check(calls.length === 1 && calls[0].x === 0 && calls[0].y === 0, 'present puts at 0, 0');
  check(calls[0].img.width === 3 && calls[0].img.height === 2, 'present image size');
  // lit is ink, black; dark is paper, white
  const L = Framebuffer.INK, D = Framebuffer.PAPER;
  check(L === 0xFF000000 && D === 0xFFFFFFFF, 'ink is opaque black, paper opaque white');
  check(same(calls[0].px.map(String), [L, D, D, D, D, L].map(String)), 'present words: ' + calls[0].px.map((v) => v.toString(16)).join(' '));
  check(same(calls[0].data.slice(0, 8).map(String), [0, 0, 0, 255, 255, 255, 255, 255].map(String)), 'present bytes are opaque black and white');
  fb.set(0, 0, 0);
  fb.present(ctx);
  check(calls[1].img === calls[0].img, 'present reuses one image');
  check(calls[1].px[0] === D, 'present follows the bits');
}

// --- colours
{
  const pal = Framebuffer.PALETTE;
  check(pal.length >= 2 && pal[0] === Framebuffer.PAPER && pal[1] === Framebuffer.INK, 'palette: paper is 0, ink is 1');
  const teal = Framebuffer.colour('#49B6B0');
  check(teal >= 2 && pal[teal] === 0xFFB0B649, 'colour: #49B6B0 is the abgr word ' + (pal[teal] >>> 0).toString(16));
  check(Framebuffer.colour('#49b6b0') === teal && Framebuffer.colour('#49B6B0') === teal, 'colour: asked again, the same index, any case');
  const mauve = Framebuffer.colour('#B5979A');
  check(mauve !== teal && pal[mauve] === 0xFF9A97B5, 'colour: another is another index');
  const fb = new Framebuffer(4, 1);
  fb.set(0, 0, 1); fb.set(1, 0, teal); fb.set(2, 0, mauve);
  let px = null;
  fb.present({ putImageData(img) { px = Array.from(new Uint32Array(img.data.buffer)); } });
  check(same(px.map(String), [Framebuffer.INK, 0xFFB0B649, 0xFF9A97B5, Framebuffer.PAPER].map(String)), 'present: each byte as its colour: ' + px.map((v) => v.toString(16)).join(' '));
  const d = new Uint8Array(new Uint32Array([pal[teal]]).buffer);
  check(d[0] === 0x49 && d[1] === 0xB6 && d[2] === 0xB0 && d[3] === 255, 'colour: its bytes are r, g, b, a as a canvas reads them');
}

// --- sprites
{
  // index.html's drawGlyph word for word, as it was before it moved here
  // as sprite(), with the page's fb, SAMPLE_GRID and MIN_HITS round it
  let fb = null;
  const SAMPLE_GRID  = 4;   // points per pixel side: 16 a pixel
  const MIN_HITS     = 6;   // of 16 on ink lights the pixel: 37.5 % coverage
  // the glyph with its centre at (cx, cy), scaled by s and turned by a
  // radians (clockwise on screen), through the inverse transform
  const SUB = [];
  for (let i = 0; i < SAMPLE_GRID; i++) for (let j = 0; j < SAMPLE_GRID; j++)
    SUB.push([(i + 0.5) / SAMPLE_GRID - 0.5, (j + 0.5) / SAMPLE_GRID - 0.5]);
  function drawGlyph(g, cx, cy, s, a) {
    const cos = Math.cos(a), sin = Math.sin(a), inv = 1 / s;
    const hw = g.w * s / 2, hh = g.h * s / 2;
    const ex = Math.abs(cos) * hw + Math.abs(sin) * hh + 1, ey = Math.abs(sin) * hw + Math.abs(cos) * hh + 1;
    const x0 = Math.floor(cx - ex), x1 = Math.ceil(cx + ex), y0 = Math.floor(cy - ey), y1 = Math.ceil(cy + ey);
    for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) {
      let hits = 0;
      for (let k = 0; k < SUB.length && hits < MIN_HITS; k++) {
        const tx = px + 0.5 + SUB[k][0] - cx, ty = py + 0.5 + SUB[k][1] - cy;
        const u = (cos * tx + sin * ty) * inv + g.w / 2, v = (-sin * tx + cos * ty) * inv + g.h / 2;
        const gx = Math.floor(u), gy = Math.floor(v);
        if (gx >= 0 && gx < g.w && gy >= 0 && gy < g.h && g.ink[gy * g.w + gx] === 1) hits++;
      }
      if (hits >= MIN_HITS) fb.set(px, py);
    }
  }

  check(Framebuffer.SAMPLE.GRID === 4 && Framebuffer.SAMPLE.MIN_HITS === 6 && Framebuffer.SUB.length === 16 &&
    Framebuffer.SUB.every((p, k) => p[0] === SUB[k][0] && p[1] === SUB[k][1]), 'sample: 4x4 points, 6 to light, the page\'s offsets');
  const g0 = Framebuffer.ink(['#..', '.##', '#']);
  check(g0.w === 3 && g0.h === 3 && same(Array.from(g0.ink).map(String), '100011100'.split('')), 'ink: rows to bits, untrimmed, short rows dark');
  const randomRows = (w, h, p) => Array.from({ length: h }, () => Array.from({ length: w }, () => (rand() < p ? '#' : '.')).join(''));

  // at scale 1 with no turn a sprite whose cells land on pixels is its
  // bitmap: even sides on a whole-pixel centre, odd ones on a pixel's middle
  for (const odd of [false, true]) {
    let ok = true;
    for (let n = 0; n < 100 && ok; n++) {
      const w = 2 * (1 + Math.floor(rand() * 8)) - (odd ? 1 : 0), h = 2 * (1 + Math.floor(rand() * 8)) - (odd ? 1 : 0);
      const rows = randomRows(w, h, 0.4), x = Math.floor(between(-4, 30)), y = Math.floor(between(-4, 24));
      const a = new Framebuffer(32, 26), b = new Framebuffer(32, 26);
      a.sprite(Framebuffer.ink(rows), x + w / 2, y + h / 2, 1, 0);
      b.blitRows(rows, x, y);
      ok = same(lit(a), lit(b));
      if (!ok) failures.push('sprite at scale 1 vs its rows: ' + w + 'x' + h + ' at ' + x + ',' + y + ' ' + JSON.stringify(rows));
    }
    check(ok, odd ? 'sprite, odd sides, scale 1 on a pixel\'s middle, is its bitmap' : 'sprite, even sides, scale 1 on an integer centre, is its bitmap');
  }

  // the old drawGlyph, pixel for pixel, placed anywhere, part off the
  // bitmap too, at the letters' and the face's scales, tilted and turned
  {
    let ok = true;
    for (let n = 0; n < 300 && ok; n++) {
      const w = 1 + Math.floor(rand() * 14), h = 1 + Math.floor(rand() * 16), g = Framebuffer.ink(randomRows(w, h, 0.45));
      const cx = between(-6, 46), cy = between(-6, 36), s = between(0.8, 1.0), t = n % 2 ? between(-0.03, 0.03) : between(-Math.PI, Math.PI);
      const a = new Framebuffer(40, 30);
      a.sprite(g, cx, cy, s, t);
      fb = new Framebuffer(40, 30);
      drawGlyph(g, cx, cy, s, t);
      ok = a.bits.every((b, i) => b === fb.bits[i]);
      if (!ok) failures.push('sprite vs drawGlyph at ' + [w, h, cx, cy, s, t].join(' '));
    }
    check(ok, 'sprite vs the old drawGlyph, 300 places, scales 0.8..1, turns');
  }

  // v is what is written; minHits is how much ink it takes
  {
    const g = Framebuffer.ink(randomRows(9, 7, 0.5));
    const light = new Framebuffer(20, 16), dark = new Framebuffer(20, 16);
    light.sprite(g, 10.3, 7.6, 0.9, 0.2);
    dark.bits.fill(1);
    dark.sprite(g, 10.3, 7.6, 0.9, 0.2, 0);
    check(light.bits.some((b) => b) && light.bits.every((b, i) => b === 1 - dark.bits[i]), 'sprite writes v: dark over lit clears what it would light');
    const any = new Framebuffer(20, 16), all = new Framebuffer(20, 16);
    any.sprite(g, 10.3, 7.6, 0.9, 0.2, 1, 1);
    all.sprite(g, 10.3, 7.6, 0.9, 0.2, 1, 16);
    check(light.bits.every((b, i) => (!b || any.bits[i]) && (!all.bits[i] || b)) && lit(any).length > lit(light).length,
      'sprite minHits: 1 lights more, 16 less, each inside the other');
  }

  // a 1 px stroke at 0.8 never drops out: every pixel row (column) it
  // covers whole has a lit pixel in it, and never more than two
  {
    const L = 12, vert = Framebuffer.ink(Array(L).fill('#')), horiz = Framebuffer.ink(['#'.repeat(L)]);
    let gaps = 0, wide = 0, doubled = 0, rows = 0, where = '';
    for (let n = 0; n < 200; n++) {
      const cx = 20 + rand(), cy = 20 + rand();
      const a = new Framebuffer(40, 40), b = new Framebuffer(40, 40);
      a.sprite(vert, cx, cy, 0.8, 0);
      b.sprite(horiz, cx, cy, 0.8, 0);
      // the stroke runs from c - 4.8 to c + 4.8: the pixels it covers whole
      for (let k = Math.ceil(cy - L * 0.8 / 2); k + 1 <= cy + L * 0.8 / 2; k++) {
        let across = 0;
        for (let x = 0; x < 40; x++) across += a.get(x, k);
        rows++;
        if (across === 0) { gaps++; where = 'vertical at ' + cx.toFixed(3) + ',' + cy.toFixed(3) + ' row ' + k; }
        if (across > 2) wide++;
        if (across === 2) doubled++;
      }
      for (let k = Math.ceil(cx - L * 0.8 / 2); k + 1 <= cx + L * 0.8 / 2; k++) {
        let across = 0;
        for (let y = 0; y < 40; y++) across += b.get(k, y);
        rows++;
        if (across === 0) { gaps++; where = 'horizontal at ' + cx.toFixed(3) + ',' + cy.toFixed(3) + ' column ' + k; }
        if (across > 2) wide++;
        if (across === 2) doubled++;
      }
    }
    check(gaps === 0 && wide === 0, 'a 1 px stroke at 0.8 never drops out, 200 offsets: ' + gaps + ' gaps, ' + wide + ' wider than 2 of ' + rows + ' cross-sections' + (where ? ' (' + where + ')' : ''));
    console.log('a 1 px stroke at 0.8: ' + doubled + ' of ' + rows + ' cross-sections two pixels wide');
  }
}

// --- blitInk
{
  const fb = new Framebuffer(5, 4);
  fb.bits.fill(2);
  fb.blitInk({ ink: Uint8Array.from([1, 0, 0, 1]), w: 2, h: 2 }, 1, 1, 3);
  check(fb.get(1, 1) === 3 && fb.get(2, 2) === 3 && fb.get(2, 1) === 2 && fb.get(1, 2) === 2 && fb.get(0, 0) === 2, 'blitInk writes v on ink and leaves the rest');
  fb.blitInk({ ink: Uint8Array.from([1, 1, 1, 1]), w: 2, h: 2 }, 4, 3);
  check(fb.get(4, 3) === 1, 'blitInk clips at the edge');
}

// --- rounded rects
{
  // a pixel is in the box when its middle is: the box less its corners'
  // squares, or within r of a corner's centre
  const inBox = (px, py, x0, y0, x1, y1, r) => {
    r = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
    const cx = px + 0.5, cy = py + 0.5;
    if (cx < x0 || cx > x1 || cy < y0 || cy > y1) return false;
    const dx = Math.max(x0 + r - cx, cx - (x1 - r), 0), dy = Math.max(y0 + r - cy, cy - (y1 - r), 0);
    return dx * dx + dy * dy <= r * r + 1e-9;
  };
  const W = 40, H = 30;
  let rng = 7;
  const rand = () => (rng = (rng * 16807) % 2147483647) / 2147483647;
  let fillOk = true, edgeOk = true, outsideOk = true, bad = '';
  const src = new Framebuffer(W, H);
  for (let i = 0; i < src.bits.length; i++) src.bits[i] = 4 + (i % 3);
  for (let n = 0; n < 60; n++) {
    const x0 = -6 + rand() * 30, y0 = -6 + rand() * 20, x1 = x0 + 1 + rand() * 30, y1 = y0 + 1 + rand() * 20, r = rand() * 12;
    const fb = new Framebuffer(W, H);
    fb.bits.fill(9);
    fb.roundRect(x0, y0, x1, y1, r, src, 1);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = fb.bits[y * W + x], inside = inBox(x, y, x0, y0, x1, y1, r);
      const edge = inside && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !inBox(x + dx, y + dy, x0, y0, x1, y1, r));
      if (!inside && v !== 9) { outsideOk = false; bad = bad || [x0, y0, x1, y1, r, x, y].map((q) => +q.toFixed(2)).join(','); }
      if (edge && v !== 1) edgeOk = false;
      if (inside && !edge && v !== src.bits[y * W + x]) fillOk = false;
    }
  }
  check(outsideOk, 'roundRect leaves every pixel outside the box alone ' + bad);
  // line px thick: the box less the inside of the box inset line - 1
  let thickOk = true, thickBad = '';
  for (let n = 0; n < 60; n++) {
    const x0 = -6 + rand() * 30, y0 = -6 + rand() * 20, x1 = x0 + 1 + rand() * 30, y1 = y0 + 1 + rand() * 20, r = rand() * 12;
    const line = 2 + (n % 3), k = line - 1, rr = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
    const inner = (x, y) => inBox(x, y, x0 + k, y0 + k, x1 - k, y1 - k, Math.max(0, rr - k));
    const fb = new Framebuffer(W, H);
    fb.roundRect(x0, y0, x1, y1, r, 0, 1, line);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const inside = inBox(x, y, x0, y0, x1, y1, r);
      const deep = inner(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => inner(x + dx, y + dy));
      const want = inside && !deep ? 1 : 0;
      if (fb.bits[y * W + x] !== want) { thickOk = false; thickBad = thickBad || [x0, y0, x1, y1, r, line, x, y].map((q) => +q.toFixed(2)).join(','); }
    }
  }
  check(thickOk, 'roundRect line px thick outlines the box less the deep inside of the box inset line - 1 ' + thickBad);
  check(edgeOk, 'roundRect outlines every pixel in the box with a neighbour out of it');
  check(fillOk, 'roundRect copies the source through the rest of the box');
  // a square box with corners as round as they go is a circle: the same turned a quarter
  const fb = new Framebuffer(21, 21);
  fb.roundRect(0.3, 0.3, 20.7, 20.7, 100, 0, 1);
  let sym = true;
  for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) if (fb.get(x, y) !== fb.get(20 - y, x)) sym = false;
  check(sym && fb.get(0, 0) === 0 && fb.get(10, 0) === 1 && fb.get(10, 10) === 0, 'roundRect: a square with r past half is a circle, its outline lit and its middle filled 0');
  // dotted: the solid outline's pixels whose x + y is a multiple of dots, and no others
  let dotOk = true;
  for (const dots of [2, 3]) {
    const solid = new Framebuffer(W, H), dotted = new Framebuffer(W, H);
    solid.roundRect(3.2, 2.7, 33.9, 24.4, 6, null, 1, 1);
    dotted.roundRect(3.2, 2.7, 33.9, 24.4, 6, null, 1, 1, dots);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
      if (dotted.get(x, y) !== (solid.get(x, y) && (x + y) % dots === 0 ? 1 : 0)) dotOk = false;
  }
  check(dotOk, 'roundRect dots: the solid outline thinned to every dots-th pixel along x + y');
  const none = new Framebuffer(8, 8);
  none.roundRect(5, 2, 5, 6, 1, 0, 1);
  none.roundRect(2, 6, 6, 2, 1, 0, 1);
  check(lit(none).length === 0, 'roundRect draws nothing for an empty box');
  const leave = new Framebuffer(8, 8);
  leave.bits.fill(3);
  leave.roundRect(1, 1, 7, 7, 0, null, 1);
  check(leave.get(1, 1) === 1 && leave.get(6, 6) === 1 && leave.get(3, 3) === 3, 'roundRect with no fill leaves the inside alone');
}

// --- dither
{
  const ink = (g) => Array.from(g.ink);
  check(same(ink(Framebuffer.atkinson([100, 100, 100, 100], 4, 1)).map(String), ['1', '1', '1', '0']),
    'atkinson: a row of 100s inks while the eighths it hands right keep it under half grey');
  check(Framebuffer.atkinson(new Array(64).fill(255), 8, 8).ink.every((v) => v === 0), 'atkinson: white inks nothing');
  check(Framebuffer.atkinson(new Array(64).fill(0), 8, 8).ink.every((v) => v === 1), 'atkinson: black inks everything');
  const density = (v) => Framebuffer.atkinson(new Array(400).fill(v), 20, 20).ink.reduce((a, b) => a + b, 0) / 400;
  check(density(64) > density(128) && density(128) > density(192) && density(192) > 0, 'atkinson: darker greys ink more, ' + [64, 128, 192].map(density).join(' '));
  const g = [10, 20, 30];
  Framebuffer.atkinson(g, 3, 1);
  check(g[0] === 10 && g[2] === 30, 'atkinson leaves its input alone');
}

// --- colour
{
  // two clusters, reds and blues: two boxes cut them apart, each its mean
  const rgb = [250, 0, 0, 240, 10, 0, 0, 0, 250, 10, 0, 230];
  const two = Framebuffer.medianCut(rgb, 2).map((c) => c.join(' ')).sort();
  check(same(two, ['245 5 0', '5 0 240']), 'medianCut: two boxes are the two clusters, each its mean: ' + two.join(', '));
  check(Framebuffer.medianCut(rgb, 10).length === 4, 'medianCut: no more boxes than pixels to cut');
  check(Framebuffer.medianCut([], 4).length === 0, 'medianCut: nothing in, nothing out');
  const pal = [[0, 0, 0], [255, 255, 255], [255, 0, 0]];
  const g = Framebuffer.ditherColour([250, 5, 5, 0, 0, 0, 255, 255, 255], 3, 1, pal);
  check(g.w === 3 && g.h === 1 && same(Array.from(g.px).map(String), ['2', '0', '1']), 'ditherColour: each pixel its nearest colour when the error is small: ' + Array.from(g.px));
  // a flat mid grey between black and white comes out as both, about half each
  const flat = new Array(3 * 400).fill(128), d = Framebuffer.ditherColour(flat, 20, 20, pal.slice(0, 2));
  const white = Array.from(d.px).filter((k) => k === 1).length / 400;
  check(white > 0.3 && white < 0.7 && !Array.from(d.px).includes(2), 'ditherColour: a grey between two colours dithers to both, ' + white + ' white');
  const fb = new Framebuffer(4, 3);
  fb.bits.fill(9);
  fb.blitPixels({ px: Uint8Array.from([0, 1, 5, 7]), w: 2, h: 2 }, 1, 1);
  check(fb.get(1, 1) === 0 && fb.get(2, 1) === 1 && fb.get(1, 2) === 5 && fb.get(2, 2) === 7 && fb.get(0, 0) === 9, 'blitPixels writes every pixel, paper too');
}

// clearRows
{
  const fb = new Framebuffer(3, 4);
  fb.bits.fill(5);
  fb.clearRows(1, 3);
  check(same(Array.from(fb.bits).map(String), '555000000555'.split('')), 'clearRows clears the rows between, the last not included: ' + Array.from(fb.bits).join(''));
  fb.bits.fill(5);
  fb.clearRows(-2, 1);
  fb.clearRows(3, 9);
  fb.clearRows(2, 2);
  check(same(Array.from(fb.bits).map(String), '000555555000'.split('')), 'clearRows clips to the bitmap and clears nothing when empty: ' + Array.from(fb.bits).join(''));
}

if (failures.length) {
  for (const f of failures) console.error('FAIL ' + f);
  console.error('raster: ' + failures.length + ' failed of ' + checks);
  process.exit(1);
}
console.log('raster: ok (' + checks + ' checks)');
