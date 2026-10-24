// checks js/raster.js against hand-worked cases and against a straight
// port of cicada's renderer. node tools/test/raster.test.js
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
  const L = 0xFFFFFFFF, D = 0xFF000000;
  check(same(calls[0].px.map(String), [L, D, D, D, D, L].map(String)), 'present words: ' + calls[0].px.map((v) => v.toString(16)).join(' '));
  check(same(calls[0].data.slice(0, 8).map(String), [255, 255, 255, 255, 0, 0, 0, 255].map(String)), 'present bytes are opaque white and black');
  fb.set(0, 0, 0);
  fb.present(ctx);
  check(calls[1].img === calls[0].img, 'present reuses one image');
  check(calls[1].px[0] === D, 'present follows the bits');
}

if (failures.length) {
  for (const f of failures) console.error('FAIL ' + f);
  console.error('raster: ' + failures.length + ' failed of ' + checks);
  process.exit(1);
}
console.log('raster: ok (' + checks + ' checks)');
