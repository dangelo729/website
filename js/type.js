// --- type --------------------------------------------------------------------
// a line of type in a system font (the name across the top of index.html,
// in helvetica) as bitmaps for the sprite sampler (js/raster.js), so it is
// drawn the way font.js's letters are and never as browser text. each glyph
// is filled once, black, EM bitmap px to the em, into an offscreen canvas,
// read back, cut at half alpha into a 0/1 bitmap in Framebuffer.ink's shape
// and cropped to the ink the cut leaves, as index.html cuts font.js's
// glyphs to their ink. the page draws them at its size over EM, far smaller
// than they were filled, so the canvas's antialiasing is thrown away at the
// cut and the sampler, not the canvas, decides every world pixel; the
// bitmaps do not depend on the size, so a resize only moves and scales them.
//
// measureText's box for a glyph is only where to fill it and how much to
// read back, with PAD round it: across, webkit gives the glyph's advance
// rather than its ink (P's box starts at its origin, not at its stem), so
// the crop, each glyph's middle and the line's own box all come from the
// pixels, and come out the same in every browser.
//
// where each glyph sits along the line is measured on the whole string: the
// width of the line up to and through the glyph, less the glyph's own
// advance. that keeps the font's kerning (AV, Te) as the browser would set
// it, the pair with the glyph before included; measuring only the line
// before it would leave that pair out, and summing each glyph's own advance
// would lose all of it. helvetica is a system font where it is there, so it
// is ready at once, with no web font to wait for; where it is not, the
// browser's nearest (arial, any sans) is filled instead.
//
// everything here is in bitmap px at the em, from the line's origin on its
// baseline, x right and y down. the canvas is handed in (makeCanvas), not
// taken from the document, so a test can give it a fake; with no canvas, no
// 2d context or no ink box from measureText there are no glyphs, and the
// page draws no name.

const TYPE = {
  EM: 256,                                                  // bitmap px to the em: filled this big once, only ever sampled down
  WEIGHT: 400,                                              // regular, unless a Type is given its own face
  FAMILY: 'Helvetica, "Helvetica Neue", Arial, sans-serif', // the system's helvetica, else the nearest it has, unless given its own
  THRESHOLD: 128,                                           // alpha at or over this is ink: half covered or more
  PAD: 4,                                                   // bitmap px read past each measured box: the soft edge, a measure a little short
};

class Type {
  // face, if given, is { weight, family } for a line in other than the
  // regular helvetica; either left out is TYPE's
  constructor(text, makeCanvas, face = {}) {
    this.text = text;
    this.font = Type.font(face.weight, face.family);
    // a glyph is { ch, at, g, x, dx, dy }: ch at index `at` in the text, g
    // its bitmap { ink, w, h } cropped to its ink, x its origin along the
    // line and (dx, dy) the bitmap's centre from that origin. a space, or
    // a glyph with no ink at the cut, has none
    this.glyphs = [];
    // the whole line's ink, from its origin: how far left of it and right,
    // above the baseline and below
    this.left = 0;
    this.right = 0;
    this.ascent = 0;
    this.descent = 0;
    const canvas = makeCanvas ? makeCanvas() : null;
    const ctx = canvas && canvas.getContext ? canvas.getContext('2d', { willReadFrequently: true }) : null;
    if (!ctx) return;
    Type.pen(ctx, this.font);

    // measured first, all of them, so one canvas can be sized to hold any.
    // each is filled with its measured box PAD in from the corner
    const todo = [];
    let mostW = 1, mostH = 1;
    for (let at = 0; at < text.length;) {
      const ch = String.fromCodePoint(text.codePointAt(at)), next = at + ch.length;
      if (!/\s/.test(ch)) {
        const m = ctx.measureText(ch);
        const L = m.actualBoundingBoxLeft, R = m.actualBoundingBoxRight;
        const A = m.actualBoundingBoxAscent, D = m.actualBoundingBoxDescent;
        if (![L, R, A, D].every(Number.isFinite)) return; // a canvas too old to measure ink
        const w = Math.max(0, Math.ceil(L + R)) + 2 * TYPE.PAD, h = Math.max(0, Math.ceil(A + D)) + 2 * TYPE.PAD;
        const x = ctx.measureText(text.slice(0, next)).width - m.width;
        todo.push({ ch, at, x, w, h, ox: TYPE.PAD + L, oy: TYPE.PAD + A });
        mostW = Math.max(mostW, w);
        mostH = Math.max(mostH, h);
      }
      at = next;
    }
    if (!todo.length) return;

    // sizing the canvas clears it and resets the pen, so the pen goes on after
    canvas.width = mostW;
    canvas.height = mostH;
    Type.pen(ctx, this.font);
    let left = -Infinity, right = -Infinity, ascent = -Infinity, descent = -Infinity;
    for (const t of todo) {
      ctx.clearRect(0, 0, mostW, mostH);
      ctx.fillText(t.ch, t.ox, t.oy);
      const a = ctx.getImageData(0, 0, t.w, t.h).data;
      // the ink's own box at the cut
      let x0 = t.w, x1 = -1, y0 = t.h, y1 = -1;
      for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
        if (a[(y * t.w + x) * 4 + 3] < TYPE.THRESHOLD) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      if (x1 < 0) continue;
      const w = x1 - x0 + 1, h = y1 - y0 + 1, ink = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
        ink[y * w + x] = a[((y0 + y) * t.w + x0 + x) * 4 + 3] >= TYPE.THRESHOLD ? 1 : 0;
      // the crop's middle from the glyph's origin, and the line's ink grown to take it
      const dx = x0 + w / 2 - t.ox, dy = y0 + h / 2 - t.oy;
      this.glyphs.push({ ch: t.ch, at: t.at, g: { ink, w, h }, x: t.x, dx, dy });
      left = Math.max(left, w / 2 - t.x - dx);
      right = Math.max(right, t.x + dx + w / 2);
      ascent = Math.max(ascent, h / 2 - dy);
      descent = Math.max(descent, dy + h / 2);
    }
    if (!this.glyphs.length) return;
    this.left = left;
    this.right = right;
    this.ascent = ascent;
    this.descent = descent;
  }

  // the font as a canvas takes it, at the em: regular helvetica unless
  // given a weight or a family
  static font(weight = TYPE.WEIGHT, family = TYPE.FAMILY) {
    return weight + ' ' + TYPE.EM + 'px ' + family;
  }

  // the pen every measure and fill is made with: black, the type's font
  // at the em, kerning on, x from the origin and y from the baseline
  static pen(ctx, font = Type.font()) {
    ctx.font = font;
    ctx.fontKerning = 'normal';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#000';
  }
}
