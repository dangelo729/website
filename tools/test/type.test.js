// node tools/test/type.test.js
//
// loads js/raster.js and js/type.js the way the page does, classic scripts
// sharing one global scope, in a vm context with no dom, no performance and
// a Date that throws, so the type cannot quietly lean on any of them: its
// canvas is handed in. the canvas here is a fake: measureText answers from
// a table of metrics in bitmap px, kerning added to the first glyph's
// advance as a shaper does; fillText is recorded, and getImageData paints
// what was filled as a box: its top row at alpha 127, its bottom row at
// 128, a pixel in its middle at 127 with the one right of it at 128, and a
// soft column at 127 just left of it, so the cut at 128 is seen on both
// sides. one glyph is measured as webkit measures, its advance across
// rather than its ink. sizing the canvas resets its pen, as a real one
// does, and a measure or a fill in any font but the type's throws. the
// glyphs are then drawn into a real framebuffer (ImageData is stubbed).
// prints the fake line as ascii; exits 1 on failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const list = (a) => '[' + a.join(', ') + ']';

// --- the scripts -------------------------------------------------------------
// the browser's ImageData, as much of it as a Framebuffer makes
class ImageData {
  constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
}
const sandbox = { ImageData };
for (const name of ['Date', 'performance', 'window', 'document', 'requestAnimationFrame', 'OffscreenCanvas']) {
  Object.defineProperty(sandbox, name, { get() { throw new Error('the type read ' + name); } });
}
const ctx = vm.createContext(sandbox);
for (const file of ['js/raster.js', 'js/type.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
}
const { TYPE, Type, Framebuffer } = vm.runInContext('({ TYPE, Type, Framebuffer })', ctx);
const PAD = TYPE.PAD;

// --- the fake canvas -----------------------------------------------------------
// one glyph's metrics in bitmap px: its advance, and the box measureText
// gives it from its origin on the baseline, how far left of it, right,
// above and below. the box is painted, unless `ink` paints a narrower one
// across
const GLYPH = {
  A: { adv: 30, L: 0, R: 30, A: 40, D: 0 },
  V: { adv: 28, L: -1, R: 29, A: 40, D: 0 },         // ink starting right of its origin
  g: { adv: 25, L: -2, R: 23, A: 20, D: 9 },         // a descender
  i: { adv: 10, L: -3, R: 7, A: 42, D: 0 },          // the tallest
  '\'': { adv: 8, L: -2, R: 6, A: 40, D: -28 },      // all above the baseline: its descent is negative
  f: { adv: 14, L: -1.5, R: 20.25, A: 41.3, D: 0 },  // fractional, its ink past its advance
  P: { adv: 30, L: 0, R: 30, A: 40, D: 0, ink: { L: -4, R: 27 } }, // as webkit measures: the advance across, the ink inside it
  '~': { adv: 20, L: -2, R: 18, A: 20, D: -10, faint: true },      // filled under the cut: no ink
  ' ': { adv: 12, blank: true },
};
// pair kerning, added to the first glyph's advance
const KERN = { AV: -6, VA: -5, '\'A': -4 };
const FONT = '400 256px Helvetica, "Helvetica Neue", Arial, sans-serif';

// what the fake paints at a point from the glyph's origin
function alphaAt(m, gx, gy) {
  const p = m.ink || m;
  if (m.blank || gy < -m.A || gy >= m.D) return 0;
  if (gx >= -p.L - 1 && gx < -p.L) return 127; // the soft column
  if (gx < -p.L || gx >= p.R) return 0;
  if (m.faint) return 100;
  if (gy < -m.A + 1) return 127;
  if (gy >= m.D - 1) return 128;
  const hx = Math.floor((p.R - p.L) / 2), hy = Math.floor((m.D - m.A) / 2);
  if (gy >= hy && gy < hy + 1) {
    if (gx >= hx && gx < hx + 1) return 127; // the hole
    if (gx >= hx + 1 && gx < hx + 2) return 128;
  }
  return 255;
}

// each glyph's origin along a string, as the fake shaper sets it, and the
// string's width
function shape(s) {
  const chars = [...s], xs = [];
  let x = 0;
  chars.forEach((c, j) => {
    xs.push(x);
    x += GLYPH[c].adv + (j + 1 < chars.length ? KERN[c + chars[j + 1]] || 0 : 0);
  });
  return { chars, xs, width: x };
}

// opts: { noContext, noBox } for the canvases that fail, { font } for
// a type given its own face
function fakeCanvas(opts = {}) {
  const log = { contexts: [], measures: [], fills: [], reads: [], sizes: [] };
  const ctx2d = {
    font: '10px sans-serif', fillStyle: '#000000', textAlign: 'start', textBaseline: 'alphabetic',
    filled: null,
    measureText(s) {
      if (this.font !== (opts.font || FONT)) throw new Error('measured in ' + this.font);
      log.measures.push(s);
      const { chars, xs, width } = shape(s);
      if (opts.noBox) return { width };
      let left = -Infinity, right = -Infinity, ascent = -Infinity, descent = -Infinity;
      chars.forEach((c, j) => {
        const m = GLYPH[c];
        if (m.blank) return;
        left = Math.max(left, m.L - xs[j]);
        right = Math.max(right, xs[j] + m.R);
        ascent = Math.max(ascent, m.A);
        descent = Math.max(descent, m.D);
      });
      if (left === -Infinity) left = right = ascent = descent = 0;
      return { width, actualBoundingBoxLeft: left, actualBoundingBoxRight: right, actualBoundingBoxAscent: ascent, actualBoundingBoxDescent: descent };
    },
    clearRect() { this.filled = null; },
    fillText(ch, x, y) {
      if (this.font !== (opts.font || FONT)) throw new Error('filled in ' + this.font);
      if (this.fillStyle !== '#000' || this.textAlign !== 'left' || this.textBaseline !== 'alphabetic') throw new Error('filled with the wrong pen');
      log.fills.push({ ch, x, y });
      this.filled = { ch, x, y };
    },
    getImageData(sx, sy, w, h) {
      if (sx < 0 || sy < 0 || sx + w > canvas.width || sy + h > canvas.height) throw new Error('read past the canvas');
      log.reads.push({ ch: this.filled && this.filled.ch, w, h });
      const data = new Uint8ClampedArray(w * h * 4), f = this.filled;
      if (f) for (let py = 0; py < h; py++) for (let px = 0; px < w; px++)
        data[(py * w + px) * 4 + 3] = alphaAt(GLYPH[f.ch], sx + px + 0.5 - f.x, sy + py + 0.5 - f.y);
      return { data };
    },
  };
  // sizing a canvas clears it and resets its pen
  let cw = 300, ch = 150;
  const reset = () => { ctx2d.font = '10px sans-serif'; ctx2d.fillStyle = '#000000'; ctx2d.textAlign = 'start'; ctx2d.filled = null; };
  const canvas = {
    get width() { return cw; }, set width(v) { cw = v; log.sizes.push(['w', v]); reset(); },
    get height() { return ch; }, set height(v) { ch = v; log.sizes.push(['h', v]); reset(); },
    getContext(kind, attrs) { log.contexts.push({ kind, attrs }); return kind === '2d' && !opts.noContext ? ctx2d : null; },
  };
  return { canvas, log };
}
// a makeCanvas that counts its calls and keeps what it made
function maker(opts) {
  const made = [];
  const make = () => { const c = fakeCanvas(opts); made.push(c); return c.canvas; };
  return { make, made };
}

// a real framebuffer. a set off the grid would land nowhere in a
// Uint8Array, silently, so it throws instead
function makeFb(w, h) {
  const fb = new Framebuffer(w, h), set = fb.set;
  fb.set = function (x, y, v = 1) {
    if (x !== Math.floor(x) || y !== Math.floor(y)) throw new Error('fb.set off the grid: ' + x + ', ' + y);
    set.call(this, x, y, v);
  };
  return fb;
}
function litList(fb) {
  const out = [];
  for (let y = 0; y < fb.h; y++) for (let x = 0; x < fb.w; x++) if (fb.bits[y * fb.w + x]) out.push([x, y]);
  return out;
}
// a lit pixel's square overlaps the box
const inBox = ([x, y], b) => x + 1 > b.x0 && x < b.x1 && y + 1 > b.y0 && y < b.y1;
const fmtBox = (b) => 'x ' + b.x0.toFixed(2) + '..' + b.x1.toFixed(2) + ', y ' + b.y0.toFixed(2) + '..' + b.y1.toFixed(2);

// --- the font --------------------------------------------------------------------
{
  check('font: helvetica at the em, regular, its fallbacks after', Type.font() === FONT && TYPE.EM === 256 && TYPE.THRESHOLD === 128, Type.font());
}

// --- a line ------------------------------------------------------------------------
// every glyph here is measured as its ink across (as chrome measures), so
// each crop is its measured box less the top row the cut drops
const TEXT = 'AVA gi';
const { make, made } = maker();
const t = new Type(TEXT, make);
const log = made[0] && made[0].log;
{
  check('canvas: made once, a 2d context asked for, read often', made.length === 1 && log.contexts.length === 1 &&
    log.contexts[0].kind === '2d' && log.contexts[0].attrs && log.contexts[0].attrs.willReadFrequently === true);
  check('glyphs: one a letter, the space left out', t.glyphs.length === 5 && t.glyphs.map((g) => g.ch).join('') === 'AVAgi' &&
    list(t.glyphs.map((g) => g.at)) === '[0, 1, 2, 4, 5]', t.glyphs.map((g) => g.ch + '@' + g.at).join(' '));
  check('fills: one a character, the second A not filled again, never the space, each with its measured box PAD in from the corner', log.fills.map((f) => f.ch).join('') === 'AVgi' &&
    log.fills.every((f) => f.x === PAD + GLYPH[f.ch].L && f.y === PAD + GLYPH[f.ch].A), log.fills.map((f) => f.ch + ' ' + f.x + ',' + f.y).join(' '));
  check('reads: one a fill, each the measured box, rounded up, and PAD a side', log.reads.length === 4 && log.reads.every((r) => {
    const m = GLYPH[r.ch];
    return r.w === Math.ceil(m.L + m.R) + 2 * PAD && r.h === Math.ceil(m.A + m.D) + 2 * PAD;
  }), log.reads.map((r) => r.ch + ' ' + r.w + 'x' + r.h).join(', '));

  // the crop: the box across, its rows less the top one at 127; the soft
  // column at 127 left out
  const sizes = t.glyphs.map((gl) => gl.ch + ' ' + gl.g.w + 'x' + gl.g.h);
  check('bitmaps: cropped to the ink, the box less its top row', t.glyphs.every((gl) => {
    const m = GLYPH[gl.ch];
    return gl.g.w === m.L + m.R && gl.g.h === m.A + m.D - 1;
  }), sizes.join(', '));
  check('bitmaps: Framebuffer.ink\'s shape, a Uint8Array of 0 and 1, w * h long', t.glyphs.every((gl) =>
    Object.prototype.toString.call(gl.g.ink) === '[object Uint8Array]' && gl.g.ink.length === gl.g.w * gl.g.h && gl.g.ink.every((v) => v === 0 || v === 1)));

  // in the bitmap, (bx, by) is the painted pixel (bx - L, by - A + 1) from
  // the glyph's origin: all ink but the hole
  let exact = true, bad = '';
  for (const gl of t.glyphs) {
    const m = GLYPH[gl.ch], g = gl.g;
    for (let by = 0; by < g.h; by++) for (let bx = 0; bx < g.w; bx++) {
      const want = alphaAt(m, bx - m.L + 0.5, by - m.A + 1 + 0.5) >= 128 ? 1 : 0;
      if (g.ink[by * g.w + bx] !== want && exact) { exact = false; bad = gl.ch + ' at ' + bx + ',' + by; }
    }
  }
  check('cut: every pixel at alpha 128 or more is ink and nothing else', exact, bad);
  const A = t.glyphs[0], ga = A.g, at = (x, y) => ga.ink[y * ga.w + x];
  // A's hole is at (15, -20) from its origin: (15, 19) in its bitmap
  check('cut: alpha 127 is paper, 128 is ink', at(15, 19) === 0 && at(16, 19) === 1 && at(5, ga.h - 1) === 1,
    'hole ' + at(15, 19) + ', beside it ' + at(16, 19) + ', bottom row ' + at(5, ga.h - 1));

  // the crop's middle from the glyph's origin: the box's, half a row lower
  // for the dropped top row
  const offs = t.glyphs.map((gl) => '(' + gl.dx + ', ' + gl.dy + ')');
  check('centres: dx = (right - left) / 2, dy = (descent - ascent) / 2, the crop\'s', t.glyphs.every((gl) => {
    const m = GLYPH[gl.ch];
    return gl.dx === (m.R - m.L) / 2 && gl.dy === (m.D - m.A) / 2 + 0.5;
  }), offs.join(' '));
  check('centres: A (15, -19.5), g (12.5, -5), i (5, -20.5)', near(t.glyphs[0].dx, 15) && near(t.glyphs[0].dy, -19.5) &&
    near(t.glyphs[3].dx, 12.5) && near(t.glyphs[3].dy, -5) && near(t.glyphs[4].dx, 5) && near(t.glyphs[4].dy, -20.5));

  // the line set as the fake shaper sets it: A 0, V 30 - 6, A 24 + 28 - 5,
  // the space 30 on, g 12 on, i 25 on. summing each glyph's own advance
  // puts V at 30 and the second A at 58; the width of the line before each
  // glyph puts them at 30 and 52, leaving out the pair just before it
  const xs = t.glyphs.map((g) => g.x);
  check('positions: the line through the glyph less its own advance, every kern kept', list(xs) === '[0, 24, 47, 89, 114]', list(xs));
  check('positions: not the sum of advances (0, 30, 58, 100, 125)', xs[1] !== 30 && xs[2] !== 58);
  check('positions: each from a measure of the whole line\'s prefix', ['A', 'AV', 'AVA', 'AVA g', 'AVA gi'].every((p) => log.measures.includes(p)));

  // the whole line's ink, from the crops: from A's left edge at the origin
  // to i's right, 114 + 7; up to i's 42 less the dropped row and down to g's 9
  check('line: left 0, right 121, ascent 41 (the tallest), descent 9', t.left === 0 && t.right === 121 && t.ascent === 41 && t.descent === 9,
    'left ' + t.left + ', right ' + t.right + ', ascent ' + t.ascent + ', descent ' + t.descent);
  check('canvas: sized once to the biggest read, and every read inside it', made[0].canvas.width === 30 + 2 * PAD && made[0].canvas.height === 42 + 2 * PAD &&
    log.sizes.length === 2, made[0].canvas.width + 'x' + made[0].canvas.height);
  // the fake throws on a fill in its reset font: getting here means the pen went back on
  check('pen: put back on after the canvas was sized', log.fills.length === 4);
  check('shared: both A\'s glyphs are the one bitmap, each at its own place', t.glyphs[0].g === t.glyphs[2].g &&
    t.glyphs[0].dx === t.glyphs[2].dx && t.glyphs[0].dy === t.glyphs[2].dy && t.glyphs[0].x !== t.glyphs[2].x);
}

// --- odd glyphs --------------------------------------------------------------------
{
  // measured as webkit does: P's box is its advance, 0 to 30, its ink 4 to 27
  const mp = maker(), p = new Type('PA', mp.make), P = p.glyphs[0];
  check('webkit box: the read is the measured box, the bitmap only the ink', mp.made[0].log.reads[0].w === 30 + 2 * PAD && P.g.w === 23,
    'read ' + mp.made[0].log.reads[0].w + ', bitmap ' + P.g.w);
  // A was filled for the line above, in the same font
  check('shared: a later line fills only its new characters, the rest the bitmaps already made',
    mp.made[0].log.fills.map((f) => f.ch).join('') === 'P' && p.glyphs[1].g === t.glyphs[0].g, mp.made[0].log.fills.map((f) => f.ch).join(''));
  check('webkit box: its middle the ink\'s, 15.5 from the origin, not the box\'s 15', P.dx === 15.5);
  check('webkit box: the line\'s left edge is the ink\'s, 4 right of the origin', p.left === -4 && p.right === 60, 'left ' + p.left + ', right ' + p.right);

  const f = new Type('f', maker().make).glyphs[0];
  // the box 4 to 22.75 across and 4 to 45.3 down in the read: the pixels
  // whose middles are in it, less the top row
  check('fractional: bitmap 19 x 40, centre (11, -20.3)', f && f.g.w === 19 && f.g.h === 40 && near(f.dx, 11) && near(f.dy, -20.3),
    f && f.g.w + 'x' + f.g.h + ' (' + f.dx + ', ' + f.dy.toFixed(4) + ')');

  const q = new Type('\'', maker().make).glyphs[0];
  check('apostrophe: all above the baseline, 11 tall, its centre 33.5 up', q && q.g.h === 11 && q.dy === -33.5, q && q.g.h + ' tall, dy ' + q.dy);

  const mk = maker(), k = new Type('\'A', mk.make);
  check('kerning: \'A pulls the A in by 4', k.glyphs.length === 2 && k.glyphs[1].x === 4, list(k.glyphs.map((g) => g.x)));
  check('shared: a line of characters all filled already fills nothing and leaves its canvas unsized',
    mk.made[0].log.fills.length === 0 && mk.made[0].log.reads.length === 0 && mk.made[0].log.sizes.length === 0);

  // A filled already, only the ~ is filled
  const mf = maker(), faint = new Type('A~A', mf.make);
  check('faint: a glyph with no ink at the cut is left out, the rest kept', faint.glyphs.length === 2 && list(faint.glyphs.map((g) => g.at)) === '[0, 2]' &&
    mf.made[0].log.fills.map((f) => f.ch).join('') === '~');
}

// --- nothing to draw ----------------------------------------------------------------
{
  const empty = (t) => t.glyphs.length === 0 && t.left === 0 && t.right === 0 && t.ascent === 0 && t.descent === 0;
  const blanks = maker(), b = new Type('   ', blanks.make);
  check('blanks: spaces alone make no glyphs and fill nothing', empty(b) && blanks.made[0].log.fills.length === 0);
  check('blanks: an empty string makes no glyphs', empty(new Type('', maker().make)));
  check('faint alone: no ink anywhere makes no glyphs, the line\'s box all 0', empty(new Type('~', maker().make)));
  check('no 2d context: no glyphs, the line\'s box all 0', empty(new Type(TEXT, maker({ noContext: true }).make)));
  check('no canvas: no makeCanvas, or one that makes nothing, makes no glyphs', empty(new Type(TEXT)) && empty(new Type(TEXT, () => null)));
  check('old canvas: no ink box from measureText makes no glyphs', empty(new Type(TEXT, maker({ noBox: true }).make)));
}

// --- through the sampler --------------------------------------------------------------
// the line drawn the way index.html draws the name: each glyph a sprite at
// k, its bitmap's centre at the origin plus k (x + dx, dy). every lit
// pixel must overlap that glyph's crop, and its middle must be lit
function drawLine(fb, k, ox, base, only) {
  for (const gl of only ? [only] : t.glyphs) fb.sprite(gl.g, ox + k * (gl.x + gl.dx), base + k * gl.dy, k, 0);
}
function cropBox(gl, k, ox, base) {
  const cx = ox + k * (gl.x + gl.dx), cy = base + k * gl.dy, hw = k * gl.g.w / 2, hh = k * gl.g.h / 2;
  return { x0: cx - hw, x1: cx + hw, y0: cy - hh, y1: cy + hh };
}
{
  const k = 0.5, ox = 10.3, base = 30.6;
  let inside = true, middles = true, some = true;
  const notes = [];
  for (const gl of t.glyphs) {
    const fb = makeFb(120, 60);
    drawLine(fb, k, ox, base, gl);
    const box = cropBox(gl, k, ox, base), px = litList(fb);
    const out = px.filter((p) => !inBox(p, box));
    if (out.length) { inside = false; notes.push(gl.ch + ' ' + out.length + ' outside ' + fmtBox(box) + ' e.g. ' + out[0]); }
    if (!px.length) some = false;
    if (!fb.get(Math.floor((box.x0 + box.x1) / 2), Math.floor((box.y0 + box.y1) / 2))) middles = false;
  }
  check('sampler at k 0.5: every glyph lights only inside its own crop', inside, notes.join('; '));
  check('sampler at k 0.5: every glyph lights, its middle among them', some && middles);

  // the whole line, and smaller: at the page's scale (about 0.2) every lit
  // pixel is still inside the line's box
  for (const [k2, w, h, b2] of [[0.5, 120, 60, 24.25], [0.2, 60, 30, 12.25]]) {
    const fb = makeFb(w, h), o = 4.6;
    drawLine(fb, k2, o, b2);
    const box = { x0: o - k2 * t.left, x1: o + k2 * t.right, y0: b2 - k2 * t.ascent, y1: b2 + k2 * t.descent };
    const px = litList(fb), out = px.filter((p) => !inBox(p, box));
    check('sampler at k ' + k2 + ': the line lights ' + px.length + ' px, all inside its box ' + fmtBox(box), px.length > 0 && out.length === 0,
      out.length ? out.length + ' outside, e.g. ' + out[0] : '');
    if (k2 === 0.5) {
      const rows = [];
      for (let y = 0; y < 32; y++) { let r = ''; for (let x = 0; x < 70; x++) r += fb.get(x, y) ? '#' : '.'; rows.push(r); }
      console.log('\nthe fake line at k 0.5 (each glyph its box):\n' + rows.join('\n') + '\n');
    }
  }
}

// --- a face of its own -------------------------------------------------------------
// a type given a weight and a family measures and fills in them, and only
// them (the fake throws on any other font); either left out is TYPE's
{
  const FACE = '500 256px "Helvetica Neue", Helvetica';
  check('face: font() takes a weight and a family, each defaulting to TYPE\'s',
    Type.font(500, '"Helvetica Neue", Helvetica') === FACE && Type.font(700) === '700 256px ' + TYPE.FAMILY && Type.font() === FONT);
  const mf = maker({ font: FACE }), f = new Type(TEXT, mf.make, { weight: 500, family: '"Helvetica Neue", Helvetica' });
  check('face: a type in its own face measures and fills in it, the same glyphs out of the same fake',
    f.font === FACE && f.glyphs.length === t.glyphs.length && mf.made[0].log.fills.length === made[0].log.fills.length, f.font);
  const mw = maker({ font: '700 256px ' + TYPE.FAMILY }), w = new Type(TEXT, mw.make, { weight: 700 });
  check('face: a weight alone keeps the family', w.font === '700 256px ' + TYPE.FAMILY && w.glyphs.length === t.glyphs.length);
  check('face: none given is regular helvetica', t.font === FONT);
  check('face: its own bitmaps, not the regular line\'s', f.glyphs.every((gl, i) => gl.g !== t.glyphs[i].g) && w.glyphs[0].g !== f.glyphs[0].g);
}

console.log('\n' + (failures ? failures + ' failed' : 'all passed'));
process.exit(failures ? 1 : 0);
