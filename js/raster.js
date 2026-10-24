// the world bitmap: one byte a world pixel, 1 lit and 0 dark, row-major.
// everything on the page is drawn into it and nothing else touches the
// canvas; present() hands the whole of it over once a frame. the
// primitives but sprite() are cicada's renderer's, pixel for pixel, so
// what is drawn here lands where it did there. every write is clipped
// silently.
function Framebuffer(w, h) {
  this.w = w;
  this.h = h;
  this.bits = new Uint8Array(w * h);
  // made once: a frame should not allocate
  this.img = new ImageData(w, h);
  this.px = new Uint32Array(this.img.data.buffer);
}

Framebuffer.prototype.clear = function () {
  this.bits.fill(0);
};

// integer coords
Framebuffer.prototype.set = function (x, y, v = 1) {
  if (x >= 0 && x < this.w && y >= 0 && y < this.h) this.bits[y * this.w + x] = v;
};

Framebuffer.prototype.get = function (x, y) {
  return x >= 0 && x < this.w && y >= 0 && y < this.h ? this.bits[y * this.w + x] : 0;
};

// bresenham, ends included. the ends are rounded first, as cicada's world
// lines were, so the walk lands exactly on (x1, y1)
Framebuffer.prototype.line = function (x0, y0, x1, y1, v = 1) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    this.set(x0, y0, v);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
};

// midpoint circle outline on integer coords. r = 1 is a plus of four
// pixels round an untouched centre, which is what cicada's pupils were
Framebuffer.prototype.circle = function (cx, cy, r, v = 1) {
  let x = r, y = 0, error = 1 - x;
  while (x >= y) {
    this.set(cx + x, cy + y, v);
    this.set(cx + y, cy + x, v);
    this.set(cx - y, cy + x, v);
    this.set(cx - x, cy + y, v);
    this.set(cx - x, cy - y, v);
    this.set(cx - y, cy - x, v);
    this.set(cx + y, cy - x, v);
    this.set(cx + x, cy - y, v);
    y++;
    if (error < 0) error += 2 * y + 1;
    else { x--; error += 2 * (y - x) + 1; }
  }
};

// the same walk, each octant pair as a span; the centre is rounded
Framebuffer.prototype.fillCircle = function (cx, cy, r, v = 1) {
  cx = Math.round(cx); cy = Math.round(cy);
  let x = r, y = 0, error = 1 - x;
  while (x >= y) {
    for (let i = cx - x; i <= cx + x; i++) { this.set(i, cy + y, v); this.set(i, cy - y, v); }
    for (let i = cx - y; i <= cx + y; i++) { this.set(i, cy + x, v); this.set(i, cy - x, v); }
    y++;
    if (error < 0) error += 2 * y + 1;
    else { x--; error += 2 * (y - x) + 1; }
  }
};

// scanline fill of a closed ring of float points: every integer row from
// floor(min y) to ceil(max y), each edge that crosses it half-open at the
// top, crossings sorted and filled in pairs between their rounded x's,
// both ends included. rows and spans off the bitmap are skipped up front,
// which writes the same pixels as visiting them and clipping each
Framebuffer.prototype.fillPolygon = function (pts, v = 1) {
  const n = pts.length;
  if (n < 3) return;
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const y0 = Math.max(Math.floor(minY), 0), y1 = Math.min(Math.ceil(maxY), this.h - 1);
  const xs = [];
  for (let y = y0; y <= y1; y++) {
    xs.length = 0;
    for (let i = 0; i < n; i++) {
      const p1 = pts[i], p2 = pts[(i + 1) % n];
      if ((p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y))
        xs.push(p1.x + (y - p1.y) / (p2.y - p1.y) * (p2.x - p1.x));
    }
    xs.sort((a, b) => a - b);
    const row = y * this.w;
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const a = Math.max(Math.round(xs[i]), 0), b = Math.min(Math.round(xs[i + 1]), this.w - 1);
      for (let x = a; x <= b; x++) this.bits[row + x] = v;
    }
  }
};

// rows in font.js's format, top-left at integer (x, y): '#' is written as
// v and '.' left alone, so a glyph or a face frame lays over what is there
Framebuffer.prototype.blitRows = function (rows, x, y, v = 1) {
  for (let r = 0; r < rows.length; r++) {
    const s = rows[r];
    for (let i = 0; i < s.length; i++) if (s[i] === '#') this.set(x + i, y + r, v);
  }
};

// --- sprites -----------------------------------------------------------------
// a sprite is a bitmap drawn as a continuous object: a centre anywhere, a
// scale and a turn. it is drawn as daedalus's head is, the other way round
// from a blit: every world pixel in its box is carried back through the
// inverse transform into the bitmap and asks what is there, so a sub-pixel
// move or a touch of scale shows as edge pixels popping, never as the
// block stepping. a pixel lights by coverage: it is asked at a grid of
// points and lit when enough of them land on ink. one point a pixel would
// be nearest neighbour, which drops a stroke scaled under 1 px whenever it
// falls between two pixel centres; any hit at all lights both pixels a
// stroke straddles, so nearly every one doubles. 6 of 16 sits between: a
// 1 px stroke scaled to between 0.75 and 1 px always has three columns of
// points across it, two of them in one pixel, 8 hits, so it always lights
// one; a pixel holding only one column of it, 4 hits, stays dark, so it
// doubles only when it puts two columns in each, sitting almost exactly
// between two pixels. under 0.75 px it can fall through.
const SAMPLE = {
  GRID: 4,     // points per pixel side: 16 a pixel
  MIN_HITS: 6, // of 16 on ink lights the pixel: 37.5 % coverage
};
// the points, as offsets from the pixel's centre
const SUB = [];
for (let i = 0; i < SAMPLE.GRID; i++) for (let j = 0; j < SAMPLE.GRID; j++)
  SUB.push([(i + 0.5) / SAMPLE.GRID - 0.5, (j + 0.5) / SAMPLE.GRID - 0.5]);
Framebuffer.SAMPLE = SAMPLE;
Framebuffer.SUB = SUB;

// rows in font.js's format as a sprite's bitmap, '#' 1 and '.' 0, as
// wide as the longest row and not trimmed
Framebuffer.ink = function (rows) {
  const h = rows.length;
  let w = 0;
  for (const r of rows) w = Math.max(w, r.length);
  const ink = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) for (let i = 0; i < rows[r].length; i++) ink[r * w + i] = rows[r][i] === '#' ? 1 : 0;
  return { ink, w, h };
};

// g, a bitmap { ink, w, h }, with its centre at (cx, cy), scaled by s and
// turned by a radians (clockwise on screen). a pixel with minHits of its
// points on ink is written v; the rest are left alone, so a sprite lays
// over what is there as a blit does
Framebuffer.prototype.sprite = function (g, cx, cy, s, a, v = 1, minHits = SAMPLE.MIN_HITS) {
  const cos = Math.cos(a), sin = Math.sin(a), inv = 1 / s;
  const hw = g.w * s / 2, hh = g.h * s / 2;
  // the turned box, a pixel wider all round
  const ex = Math.abs(cos) * hw + Math.abs(sin) * hh + 1, ey = Math.abs(sin) * hw + Math.abs(cos) * hh + 1;
  const x0 = Math.floor(cx - ex), x1 = Math.ceil(cx + ex), y0 = Math.floor(cy - ey), y1 = Math.ceil(cy + ey);
  for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) {
    let hits = 0;
    // once it has enough the rest cannot change it
    for (let k = 0; k < SUB.length && hits < minHits; k++) {
      const tx = px + 0.5 + SUB[k][0] - cx, ty = py + 0.5 + SUB[k][1] - cy;
      const bx = (cos * tx + sin * ty) * inv + g.w / 2, by = (-sin * tx + cos * ty) * inv + g.h / 2;
      const gx = Math.floor(bx), gy = Math.floor(by);
      if (gx >= 0 && gx < g.w && gy >= 0 && gy < g.h && g.ink[gy * g.w + gx] === 1) hits++;
    }
    if (hits >= minHits) this.set(px, py, v);
  }
};

// a 1-bit image, msb first, each row `stride` bytes from bytes[off], top-left
// at (x, y). opaque: dark bits are written too, as the panel is a screen
Framebuffer.prototype.blitPacked = function (bytes, off, bw, bh, stride, x, y) {
  for (let by = 0; by < bh; by++) {
    const row = off + by * stride;
    for (let bx = 0; bx < bw; bx++)
      this.set(x + bx, y + by, bytes[row + (bx >> 3)] & (0x80 >> (bx & 7)) ? 1 : 0);
  }
};

// lit is opaque white and dark opaque black; the canvas is exactly this
// size, so the copy lands at its corner
Framebuffer.prototype.present = function (ctx) {
  const bits = this.bits, px = this.px, n = bits.length;
  for (let i = 0; i < n; i++) px[i] = bits[i] ? 0xFFFFFFFF : 0xFF000000;
  ctx.putImageData(this.img, 0, 0);
};
