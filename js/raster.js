// the world bitmap: one byte a world pixel, 1 lit and 0 dark, row-major,
// or past 1 for a colour of the page's (PALETTE, at the end). everything
// on the page is drawn into it and nothing else touches the canvas;
// present() hands the whole of it over once a frame, each byte as its
// colour (lit is ink, dark is paper: black on white). the
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
  // sprite()'s working: two products for each column of points across the
  // framebuffer, and for each row of points down one pixel
  this.across = new Float64Array(2 * SAMPLE.GRID * w);
  this.down = new Float64Array(2 * SAMPLE.GRID);
  // and where each column of pixels' middles lands in the bitmap, less the row's share
  this.mid = new Float64Array(2 * w);
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
// lines were, so the walk lands exactly on (x1, y1). thick is 1 or 2: at 2
// each pixel of the walk takes its neighbour across the line with it, the
// one below on a line at least as wide as it is tall and the one right of
// it on a steeper one, so it is 2 px thick at every slope as a 1 px line
// is 1
Framebuffer.prototype.line = function (x0, y0, x1, y1, v = 1, thick = 1) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  // the second pixel's step from the first
  const ax = dx >= dy ? 0 : 1, ay = 1 - ax;
  let err = dx - dy;
  for (;;) {
    this.set(x0, y0, v);
    if (thick === 2) this.set(x0 + ax, y0 + ay, v);
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
// both ends included. v is what each filled pixel is written, or a
// framebuffer of this one's size whose pixels are copied across from the
// same places, so what it holds shows through the ring and only there.
// rows and spans off the bitmap are skipped up front, which writes the same
// pixels as visiting them and clipping each. each edge is filed under the
// first row it crosses and kept in a list of the edges crossing the row
// until past its last, so a row works out only its own crossings, never
// every edge's. its working arrays are made once and grown for a bigger ring
Framebuffer.prototype.fillPolygon = function (pts, v = 1) {
  const n = pts.length;
  if (n < 3) return;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) { const y = pts[i].y; minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const y0 = Math.max(Math.floor(minY), 0), y1 = Math.min(Math.ceil(maxY), this.h - 1);
  if (!(y1 >= y0)) return;
  if (!this.poly || this.poly.n < n) this.poly = { n, next: new Int32Array(n), last: new Int32Array(n), act: new Int32Array(n), xs: new Float64Array(n) };
  if (!this.heads) this.heads = new Int32Array(this.h);
  const { next, last, act, xs } = this.poly, heads = this.heads;
  heads.fill(-1, 0, y1 - y0 + 1);
  // each edge's rows, lo <= y < hi between its ends' ys, cut to the bitmap's
  for (let i = 0; i < n; i++) {
    const a = pts[i].y, b = pts[i + 1 < n ? i + 1 : 0].y;
    const first = Math.max(Math.ceil(Math.min(a, b)), y0), end = Math.min(Math.ceil(Math.max(a, b)) - 1, y1);
    if (!(first <= end)) continue;
    last[i] = end;
    next[i] = heads[first - y0];
    heads[first - y0] = i;
  }
  const bits = this.bits, src = typeof v === 'number' ? null : v.bits, w = this.w;
  let active = 0;
  for (let y = y0; y <= y1; y++) {
    // the edges that end above this row out, the ones that start on it in
    let k = 0;
    for (let j = 0; j < active; j++) if (last[act[j]] >= y) act[k++] = act[j];
    active = k;
    for (let i = heads[y - y0]; i >= 0; i = next[i]) act[active++] = i;
    for (let j = 0; j < active; j++) {
      const i = act[j], p1 = pts[i], p2 = pts[i + 1 < n ? i + 1 : 0];
      xs[j] = p1.x + (y - p1.y) / (p2.y - p1.y) * (p2.x - p1.x);
    }
    // a few crossings by insertion, many by the typed sort: numbers
    // ascending either way
    if (active <= 16) {
      for (let j = 1; j < active; j++) {
        const x = xs[j];
        let m = j - 1;
        while (m >= 0 && xs[m] > x) { xs[m + 1] = xs[m]; m--; }
        xs[m + 1] = x;
      }
    } else xs.subarray(0, active).sort();
    const row = y * w;
    for (let j = 0; j + 1 < active; j += 2) {
      const a = Math.max(Math.round(xs[j]), 0), b = Math.min(Math.round(xs[j + 1]), w - 1);
      if (a > b) continue;
      if (src) bits.set(src.subarray(row + a, row + b + 1), row + a);
      else bits.fill(v, row + a, row + b + 1);
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
// the same offsets along one side: a column's across and a row's down, the
// points every pairing of the two
const SUB_AT = Array.from({ length: SAMPLE.GRID }, (_, i) => (i + 0.5) / SAMPLE.GRID - 0.5);

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

// how flat a bitmap { ink, w, h } is round each of its pixels: how many
// pixels out from it, straight and cornerwise, every pixel is as it is,
// ink or not, all that is off the bitmap being not; 255 is that many or
// more. a pixel of 3 has only its own kind in the 7 x 7 round it. it is
// worked out in two sweeps, down from the top left and back up from the
// bottom right, each pixel taking the least the four neighbours already
// swept leave it: nothing from one not as it is, one more than its own
// from one that is
Framebuffer.flat = function (g) {
  const w = g.w, h = g.h, pw = w + 2, n = pw * (h + 2);
  // each with a pixel more all round, the paper off the bitmap, flat as far as can be
  const on = new Uint8Array(n), far = new Uint8Array(n).fill(255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) on[(y + 1) * pw + x + 1] = g.ink[y * w + x] === 1 ? 1 : 0;
  // left and the three above
  for (let y = 1; y <= h; y++) for (let x = 1, i = y * pw + 1; x <= w; x++, i++) {
    const s = on[i], a = i - 1, b = i - pw - 1, c = i - pw, d = i - pw + 1;
    far[i] = on[a] !== s || on[b] !== s || on[c] !== s || on[d] !== s ? 0 : Math.min(255, 1 + Math.min(far[a], far[b], far[c], far[d]));
  }
  // right and the three below
  for (let y = h; y >= 1; y--) for (let x = w, i = y * pw + w; x >= 1; x--, i--) {
    const s = on[i], a = i + 1, b = i + pw + 1, c = i + pw, d = i + pw - 1;
    far[i] = on[a] !== s || on[b] !== s || on[c] !== s || on[d] !== s ? 0 : Math.min(far[i], 1 + Math.min(far[a], far[b], far[c], far[d]));
  }
  const flat = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) flat.set(far.subarray((y + 1) * pw + 1, (y + 1) * pw + 1 + w), y * w);
  return flat;
};

// g, a bitmap { ink, w, h }, with its centre at (cx, cy), scaled by s and
// turned by a radians (clockwise on screen). a pixel with minHits of its
// points on ink is written v; the rest are left alone, so a sprite lays
// over what is there as a blit does. a point tx, ty from the centre lands
// in the bitmap at ((cos tx + sin ty) / s + w / 2, (-sin tx + cos ty) / s
// + h / 2). the products with tx are made once a sprite for each column
// of points and those with ty once a row; a point adds its two in the
// order the sum is written, so every rounding is the one it would get
// worked out alone. only the pixels with a point in the turned box are
// asked, the box grown a sixteenth of a pixel all round (far more than
// rounding can move a point) and cut to the framebuffer, and a pixel
// stops asking once it has minHits or has missed too many to get them.
// a pixel's points all land within reach bitmap pixels of the one its
// middle lands in, so where the bitmap is flat that far round it
// (Framebuffer.flat, worked out the first time a bitmap is drawn and kept
// with it) they all land on ink or none does, and the pixel is lit or
// left without asking at any
Framebuffer.prototype.sprite = function (g, cx, cy, s, a, v = 1, minHits = SAMPLE.MIN_HITS) {
  const cos = Math.cos(a), sin = Math.sin(a), inv = 1 / s, n = SAMPLE.GRID;
  const hw = g.w * s / 2, hh = g.h * s / 2;
  const ex = Math.abs(cos) * hw + Math.abs(sin) * hh + 1 / 16, ey = Math.abs(sin) * hw + Math.abs(cos) * hh + 1 / 16;
  // a pixel's points sit lo to hi in from its top left
  const lo = 0.5 + SUB_AT[0], hi = 0.5 + SUB_AT[n - 1];
  const x0 = Math.max(0, Math.ceil(cx - ex - hi)), x1 = Math.min(this.w, Math.floor(cx + ex - lo) + 1);
  const y0 = Math.max(0, Math.ceil(cy - ey - hi)), y1 = Math.min(this.h, Math.floor(cy + ey - lo) + 1);
  if (x1 <= x0 || y1 <= y0) return;
  // each column's cos tx and -sin tx, and the row's sin ty and cos ty
  const across = this.across, down = this.down, mid = this.mid;
  const gw = g.w, gh = g.h, ink = g.ink, bits = this.bits, w = this.w, mx = gw / 2, my = gh / 2;
  for (let px = x0, k = 0, m = 0; px < x1; px++, m += 2) {
    for (let i = 0; i < n; i++, k += 2) {
      const tx = px + 0.5 + SUB_AT[i] - cx;
      across[k] = cos * tx;
      across[k + 1] = -sin * tx;
    }
    // the pixel's middle
    const tx = px + 0.5 - cx;
    mid[m] = cos * tx * inv + mx;
    mid[m + 1] = -sin * tx * inv + my;
  }
  const flat = g.flat || (g.flat = Framebuffer.flat(g));
  // a pixel's points are within its outermost's offset of its middle each
  // way, so in the bitmap within this much of where its middle lands, and
  // a hair for rounding
  const reach = Math.ceil(SUB_AT[n - 1] * (Math.abs(cos) + Math.abs(sin)) * inv + 1e-6);
  const most = n * n - minHits; // misses a pixel can take and still light
  const all = n * n >= minHits, none = 0 >= minHits; // whether every point on ink lights a pixel, and none
  for (let py = y0; py < y1; py++) {
    for (let j = 0, k = 0; j < n; j++, k += 2) {
      const ty = py + 0.5 + SUB_AT[j] - cy;
      down[k] = sin * ty;
      down[k + 1] = cos * ty;
    }
    const ty = py + 0.5 - cy, rx = sin * ty * inv, ry = cos * ty * inv;
    for (let px = x0, c = 0, m = 0; px < x1; px++, c += 2 * n, m += 2) {
      const fx = mid[m] + rx, fy = mid[m + 1] + ry;
      if (fx >= 0 && fx < gw && fy >= 0 && fy < gh) {
        const at = Math.floor(fy) * gw + Math.floor(fx);
        if (flat[at] >= reach) {
          if (ink[at] === 1 ? all : none) bits[py * w + px] = v;
          continue;
        }
      }
      let hits = 0, misses = 0;
      points: for (let i = c; i < c + 2 * n; i += 2) {
        const ax = across[i], ay = across[i + 1];
        for (let j = 0; j < 2 * n; j += 2) {
          const bx = (ax + down[j]) * inv + mx, by = (ay + down[j + 1]) * inv + my;
          if (bx >= 0 && bx < gw && by >= 0 && by < gh && ink[Math.floor(by) * gw + Math.floor(bx)] === 1) { if (++hits >= minHits) break points; }
          else if (++misses > most) break points;
        }
      }
      if (hits >= minHits) bits[py * w + px] = v;
    }
  }
};

// g, a bitmap { px, w, h } of v's (a picture in the page's colours), with
// its centre at (cx, cy), scaled by s and turned by a radians, as sprite()
// takes a letter: each pixel whose middle lands on it is written the v it
// lands on, paper too, so it covers what is under it. unturned at its own
// size, centred on a pixel's corner or middle as its size has it, it lands
// pixel for pixel as blitPixels() would put it
Framebuffer.prototype.spritePixels = function (g, cx, cy, s, a) {
  const cos = Math.cos(a), sin = Math.sin(a), inv = 1 / s;
  const hw = g.w * s / 2, hh = g.h * s / 2;
  const ex = Math.abs(cos) * hw + Math.abs(sin) * hh + 1, ey = Math.abs(sin) * hw + Math.abs(cos) * hh + 1;
  const x0 = Math.max(0, Math.floor(cx - ex)), x1 = Math.min(this.w, Math.ceil(cx + ex));
  const y0 = Math.max(0, Math.floor(cy - ey)), y1 = Math.min(this.h, Math.ceil(cy + ey));
  for (let py = y0; py < y1; py++) {
    const ty = py + 0.5 - cy;
    for (let px = x0; px < x1; px++) {
      const tx = px + 0.5 - cx;
      const gx = Math.floor((cos * tx + sin * ty) * inv + g.w / 2), gy = Math.floor((-sin * tx + cos * ty) * inv + g.h / 2);
      if (gx >= 0 && gx < g.w && gy >= 0 && gy < g.h) this.bits[py * this.w + px] = g.px[gy * g.w + gx];
    }
  }
};

// the neighbours strokeSprite() joins a pixel to: right, below and the two
// corners below, so every pair that touches is joined once
const JOINS = [[1, 0], [0, 1], [1, 1], [-1, 1]];

// g, a bitmap { ink, w, h } of 1 px strokes, with its centre at (cx, cy),
// scaled by s and turned by a radians as sprite() takes it, drawn as line
// art: each ink pixel's middle carried through the transform and every two
// that touch joined by a line thick px thick (1 or 2), so its strokes are
// thick px at any scale, as a line's are. two that touch only at a corner
// are not joined when a pixel both touch is ink, the stroke turning
// through that one; a pixel that touches none is a dot, at thick 2 a 2 x 2
// block, it and the pixels right of it, below it and below right, where a
// line puts its second pixels
Framebuffer.prototype.strokeSprite = function (g, cx, cy, s, a, v = 1, thick = 1) {
  const cos = Math.cos(a) * s, sin = Math.sin(a) * s, w = g.w, h = g.h;
  const ink = (x, y) => x >= 0 && x < w && y >= 0 && y < h && g.ink[y * w + x] === 1;
  const at = (x, y) => {
    const tx = x + 0.5 - w / 2, ty = y + 0.5 - h / 2;
    return [cx + cos * tx - sin * ty, cy + sin * tx + cos * ty];
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!ink(x, y)) continue;
    const [x0, y0] = at(x, y);
    for (const [dx, dy] of JOINS) {
      if (!ink(x + dx, y + dy) || (dx && dy && (ink(x + dx, y) || ink(x, y + dy)))) continue;
      const [x1, y1] = at(x + dx, y + dy);
      this.line(x0, y0, x1, y1, v, thick);
    }
    // a dot when none of the eight round it is ink
    let lone = true;
    for (let dy = -1; dy <= 1 && lone; dy++) for (let dx = -1; dx <= 1; dx++)
      if ((dx || dy) && ink(x + dx, y + dy)) { lone = false; break; }
    if (lone) {
      const px = Math.round(x0), py = Math.round(y0);
      this.set(px, py, v);
      if (thick === 2) { this.set(px + 1, py, v); this.set(px, py + 1, v); this.set(px + 1, py + 1, v); }
    }
  }
};

// a bitmap { ink, w, h } with its top left at integer (x, y): ink is
// written v and the rest left alone
Framebuffer.prototype.blitInk = function (g, x, y, v = 1) {
  for (let by = 0; by < g.h; by++) for (let bx = 0; bx < g.w; bx++)
    if (g.ink[by * g.w + bx]) this.set(x + bx, y + by, v);
};

// --- rounded rects -------------------------------------------------------------
// a box with float edges, x0 < x1 and y0 < y1, its corners quarter circles
// of radius r, no more than half its least side (there it is a stadium, a
// circle when it is square). a pixel is in it when its middle is: each
// row's run of them is worked out once, and a pixel of a run is the
// outline when the one left or right of it, or above or below it, is not
// in the box, which makes a 1 px line that steps across a diagonal as
// bresenham's does. fill, if given, goes in first: a v written to every
// pixel of the box, or a framebuffer of this one's size whose pixels are
// copied across, so what it holds shows through the box and only there.
// the outline is then written v, line px thick: thicker than 1, it is the
// box less the inside of the box inset line - 1 px all round (its corners
// line - 1 less round), so each px of thickness is another such ring.
// dots past 1 writes only the outline pixels whose x + y is a multiple of
// it, a dotted line: 2 every other pixel, 3 every third
Framebuffer.prototype.roundRect = function (x0, y0, x1, y1, r, fill = null, v = 1, line = 1, dots = 1) {
  if (!(x1 > x0 && y1 > y0)) return;
  r = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
  // row y's run of pixels in a box, [a, b], or null
  const runOf = (x0, y0, x1, y1, r) => (y) => {
    if (!(x1 > x0 && y1 > y0)) return null;
    const cy = y + 0.5;
    if (cy < y0 || cy > y1) return null;
    const dy = Math.max(y0 + r - cy, cy - (y1 - r), 0);
    const ex = r - Math.sqrt(Math.max(0, r * r - dy * dy));
    const a = Math.ceil(x0 + ex - 0.5), b = Math.floor(x1 - ex - 0.5);
    return a <= b ? [a, b] : null;
  };
  const k = Math.max(0, line - 1), run = runOf(x0, y0, x1, y1, r);
  const inner = k ? runOf(x0 + k, y0 + k, x1 - k, y1 - k, Math.max(0, r - k)) : run;
  const top = Math.max(Math.floor(y0), 0), bottom = Math.min(Math.ceil(y1), this.h - 1);
  let above = inner(top - 1), mid = inner(top);
  for (let y = top; y <= bottom; y++) {
    const below = inner(y + 1), here = k ? run(y) : mid;
    if (here) {
      const row = y * this.w, a = here[0], b = here[1];
      const lo = Math.max(a, 0), hi = Math.min(b, this.w - 1);
      if (typeof fill === 'number') for (let x = lo; x <= hi; x++) this.bits[row + x] = fill;
      else if (fill) for (let x = lo; x <= hi; x++) this.bits[row + x] = fill.bits[row + x];
      // the outline: not well inside the inner box, its run's ends or with
      // no run of it above or below
      for (let x = lo; x <= hi; x++)
        if ((!mid || x <= mid[0] || x >= mid[1] || !above || x < above[0] || x > above[1] || !below || x < below[0] || x > below[1]) &&
            (dots <= 1 || (x + y) % dots === 0))
          this.bits[row + x] = v;
    }
    above = mid;
    mid = below;
  }
};

// --- dither --------------------------------------------------------------------
// a grey image, w x h values from 0 (black) to 255 (white), row-major, as
// a bitmap { ink, w, h } by atkinson's dither: a pixel inks when it is
// under half grey, and an eighth of what that got wrong is handed on to
// each of the two right of it, the three under it and the one two under.
// the quarter thrown away is what gives the dither its open whites and
// full blacks
Framebuffer.atkinson = function (grey, w, h) {
  const e = Float32Array.from(grey), ink = new Uint8Array(w * h);
  const spread = [[1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, dark = e[i] < 128;
    ink[i] = dark ? 1 : 0;
    const err = (e[i] - (dark ? 0 : 255)) / 8;
    for (const [dx, dy] of spread) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < w && yy < h) e[yy * w + xx] += err;
    }
  }
  return { ink, w, h };
};

// the few colours an rgb image is best told in, by median cut: rgb is
// r, g, b per pixel, 0 to 255; the pixels start as one box, and the box
// whose widest channel spans the most is cut in two at its median along
// that channel, until there are n boxes or none can be cut. each box's
// colour is its pixels' mean, as [r, g, b] rounded
Framebuffer.medianCut = function (rgb, n) {
  const count = Math.floor(rgb.length / 3);
  if (!count) return [];
  // a box: its pixels, and its widest channel and how far it spans,
  // worked out once when it is made
  const box = (b) => {
    let ch = 0, span = -1;
    for (let c = 0; c < 3; c++) {
      let lo = Infinity, hi = -Infinity;
      for (const i of b) { const v = rgb[3 * i + c]; if (v < lo) lo = v; if (v > hi) hi = v; }
      if (hi - lo > span) { span = hi - lo; ch = c; }
    }
    return { b, ch, span };
  };
  const boxes = [box(Array.from({ length: count }, (_, i) => i))];
  while (boxes.length < n) {
    let best = -1, most = 0;
    boxes.forEach((x, i) => {
      if (x.b.length < 2) return;
      if (x.span > most) { most = x.span; best = i; }
    });
    if (best < 0) break;
    const ch = boxes[best].ch, b = boxes[best].b.sort((p, q) => rgb[3 * p + ch] - rgb[3 * q + ch]), mid = b.length >> 1;
    boxes.splice(best, 1, box(b.slice(0, mid)), box(b.slice(mid)));
  }
  return boxes.map(({ b }) => [0, 1, 2].map((c) => Math.round(b.reduce((sum, i) => sum + rgb[3 * i + c], 0) / b.length)));
};

// an rgb image, w x h, r, g, b per pixel from 0 to 255, in the nearest of
// colours ([r, g, b] each) by atkinson's dither, done on each channel: an
// eighth of each channel's miss goes to each of the same six neighbours
// as the grey dither's. a bitmap { px, w, h }, px each pixel's index in
// colours
Framebuffer.ditherColour = function (rgb, w, h, colours) {
  const e = Float32Array.from(rgb), px = new Uint8Array(w * h);
  const spread = [[1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, r = e[3 * i], g = e[3 * i + 1], b = e[3 * i + 2];
    let k = 0, least = Infinity;
    for (let c = 0; c < colours.length; c++) {
      const q = colours[c], d = (r - q[0]) * (r - q[0]) + (g - q[1]) * (g - q[1]) + (b - q[2]) * (b - q[2]);
      if (d < least) { least = d; k = c; }
    }
    px[i] = k;
    const q = colours[k], er = (r - q[0]) / 8, eg = (g - q[1]) / 8, eb = (b - q[2]) / 8;
    for (const [dx, dy] of spread) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || xx >= w || yy >= h) continue;
      const j = 3 * (yy * w + xx);
      e[j] += er; e[j + 1] += eg; e[j + 2] += eb;
    }
  }
  return { px, w, h };
};

// rows y0 up to y1 (integers, y1 not included) back to paper, as far as
// they are on the bitmap: what was drawn there is cut off
Framebuffer.prototype.clearRows = function (y0, y1) {
  y0 = Math.max(0, y0);
  y1 = Math.min(this.h, y1);
  if (y1 > y0) this.bits.fill(0, y0 * this.w, y1 * this.w);
};

// a bitmap { px, w, h } of v's, its top left at integer (x, y), every
// pixel written: an opaque picture in the page's colours. what is on the
// framebuffer of each row is copied across whole
Framebuffer.prototype.blitPixels = function (g, x, y) {
  const x0 = Math.max(0, x), x1 = Math.min(this.w, x + g.w), y0 = Math.max(0, y), y1 = Math.min(this.h, y + g.h);
  if (x1 <= x0) return;
  for (let py = y0; py < y1; py++) {
    const from = (py - y) * g.w + x0 - x;
    this.bits.set(g.px.subarray(from, from + x1 - x0), py * this.w + x0);
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

// the page's colours, as the little-endian ABGR words a canvas pixel is,
// all opaque. a pixel's byte is its index in PALETTE: 0 is PAPER, what a
// clear leaves, and 1 is INK, what lit means to every primitive; colour()
// adds more, for a v past 1. black on an off-white paper, #fbf6f0; swap
// the first two for paper on black
Framebuffer.INK = 0xFF000000;
Framebuffer.PAPER = 0xFFF0F6FB;
Framebuffer.PALETTE = [Framebuffer.PAPER, Framebuffer.INK];

// '#rrggbb' as the v that draws in it: its index in PALETTE, added the
// first time it is asked for
Framebuffer.colour = function (hex) {
  const n = parseInt(hex.slice(1), 16);
  const word = (0xFF000000 | (n & 0xFF) << 16 | (n & 0xFF00) | (n >> 16 & 0xFF)) >>> 0;
  const i = Framebuffer.PALETTE.indexOf(word);
  return i >= 0 ? i : Framebuffer.PALETTE.push(word) - 1;
};

// the canvas is exactly this size, so the copy lands at its corner
Framebuffer.prototype.present = function (ctx) {
  const bits = this.bits, px = this.px, n = bits.length, pal = Framebuffer.PALETTE;
  for (let i = 0; i < n; i++) px[i] = pal[bits[i]];
  ctx.putImageData(this.img, 0, 0);
};
