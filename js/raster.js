// the world bitmap: one byte a world pixel, 1 lit and 0 dark, row-major.
// everything on the page is drawn into it and nothing else touches the
// canvas; present() hands the whole of it over once a frame. the
// primitives are cicada's renderer's, pixel for pixel, so what is drawn
// here lands where it did there. every write is clipped silently.
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
