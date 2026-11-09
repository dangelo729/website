// --- the mouth ---------------------------------------------------------------
// the bubble's mouth (js/face.js), moved by the voice that speaks through it
// (js/voice.js) and drawn by rule in the pixels of cicada's mouth art.
//
// the model is moon_man's (its face/mouth_model.cpp). the voice is a tube
// shaped by a tongue and lips, so the mapping is literal: how open the
// front of the tube is is the jaw, the lip opening against the cavity
// behind it is round to spread, and the voice's own level (voicing, hiss)
// gates it: silence relaxes the mouth shut, and a lip closure shuts it
// because the tube really closes there. an L puts the tongue out over the
// lower lip, held a beat past it so a short one still reads, and holds the
// jaw open enough to let it through. every value eases the house's way,
// dt-correct; closing outruns opening, since a crisp B or M is what sells
// it. with no voice at all (said null) it is a mouth in silence.
//
// the drawing is the art's: an oval whose rows run flat along the top and
// bottom, step out one pixel a row round the corners and drop straight
// down the sides; two buck teeth, one pixel each, hanging from the upper
// lip either side of the middle; and a cheek either side, a ( and a ),
// three pixels clear of the mouth's widest point, hanging from just above
// the shut line and taller as the mouth opens. a shut mouth is a stub
// three pixels wide. the jaw sets how many rows it opens, mostly down, as a
// jaw carries the lower lip; round to spread and the jaw together set how
// far out it goes, and a puckered mouth opened goes round. every one of
// cicada's ten frames is this drawing at its own rows and width
// (tools/test/mouth.test.js), so the shut mouth is his exactly. the
// tongue, when out, comes over the lower lip as a u five pixels across,
// the lip broken where it crosses, with a groove down its middle once it
// is all the way out, and the mouth held open round it, as far as it is
// out, wide enough that the lip shows either side of it.

const MOUTH = {
  // the tube map (moon_man's): the front cavity's mean diameter from shut
  // to open, an unrounded lip section's, and the lip opening over the
  // cavity, square rooted, from a pucker (UW) to a smile (IY). the glue
  // (tools/monk_mouth-web) reads the cavity and the lips off the voice
  FRONT_SHUT: 0.6, FRONT_OPEN: 2.2, LIP_FULL: 1.5,
  ROUND_RATIO: 0.55, SPREAD_RATIO: 1.4,
  FULL_VOICING: 0.7, // the voicing of a full vowel
  FRIC_WEIGHT: 0.35, // a hiss keeps a slit open, unvoiced
  // easing, per second, all of it times SPEED
  SPEED: 2, CLOSE_RATE: 35, OPEN_RATE: 12, WIDE_RATE: 10, ENERGY_RATE: 14,
  WIDE_REST: 0.5, // round to spread, relaxed
  // the tongue: out on an L and HOLD_S past it, easing out and in twice
  // over, an aim chasing out or in and the tongue chasing the aim; out, it
  // holds the jaw at least TONGUE_OPEN open
  TONGUE_OUT_RATE: 10, TONGUE_IN_RATE: 10, TONGUE_HOLD_S: 0.15, TONGUE_OPEN: 0.25,

  // the drawing, in the art's pixels: its bitmap, the middle of the shut
  // line, how many rows the jaw opens at most, the width at shut and how
  // much more fully open, as far as round (PUCKER) or spread (SPREAD) take
  // it, how much of a fully open pucker goes round, the share of the
  // opening above the shut line, the cheeks' gap and the narrowest mouth
  // they keep to, the tongue's rows at most and its sides from the
  // middle, and the rows and width the mouth opens to round it all the
  // way out
  W: 40, H: 24, X: 18, Y: 11,
  ROWS: 8, WIDTH: 1, WIDER: 4, PUCKER: 0.6, SPREAD: 1.4, ROUND: 0.5, UPPER: 0.35,
  CHEEK_GAP: 3, CHEEK_LEAST: 2, TONGUE_ROWS: 2, TONGUE_SIDE: 2, TONGUE_TALL: 4, TONGUE_WIDE: 5,
};

// a mouth in silence: voiceless, no hiss, the lips and the tube at rest
const MOUTH_SILENT = { voicing: 0, hiss: 0, lips: 1, front: MOUTH.FRONT_SHUT, lipMin: MOUTH.LIP_FULL, l: 0 };

class Mouth {
  constructor() {
    this.open = 0;         // the jaw: 0 shut .. 1 wide open
    this.wide = MOUTH.WIDE_REST; // 0 a pucker .. 1 a smile
    this.energy = 0;       // how much sound is coming out
    this.tongue = 0;       // 0 in .. 1 out over the lower lip
    this.tongueAim = 0;    // where the tongue is easing toward, itself eased
    this.tongueHold = 0;   // seconds the tongue stays out past its L
    this.drawn = new Map(); // each shape's bitmap, by its key, made once
  }

  // dtS of time gone by toward the mouth the voice has now (said, the
  // glue's six values by name), or toward silence with said null
  update(said, dtS) {
    const M = MOUTH, s = said || MOUTH_SILENT;
    const clamp = (x) => Math.min(Math.max(x, 0), 1);
    const toward = (v, target, rate) => v + (target - v) * (1 - Math.exp(-rate * M.SPEED * dtS));

    const energy = clamp(s.voicing / M.FULL_VOICING + M.FRIC_WEIGHT * s.hiss);
    this.energy = toward(this.energy, energy, M.ENERGY_RATE);

    // open is the smaller of the cavity and the lips: a wide cavity behind
    // shut lips is a shut mouth. round to spread reads the lips' own pose,
    // so a closure shuts the mouth without puckering it, and relaxes to
    // rest as the sound dies away, where it would freeze on the last vowel
    const frontT = clamp((s.front - M.FRONT_SHUT) / (M.FRONT_OPEN - M.FRONT_SHUT));
    const lipT = clamp(s.lipMin / M.LIP_FULL);
    let openT = Math.min(frontT, lipT) * energy;
    const ratio = Math.sqrt(s.lips * M.LIP_FULL / Math.max(s.front, 0.05));
    const wideT = M.WIDE_REST + (clamp((ratio - M.ROUND_RATIO) / (M.SPREAD_RATIO - M.ROUND_RATIO)) - M.WIDE_REST) * this.energy;

    this.tongueHold = s.l ? M.TONGUE_HOLD_S : Math.max(this.tongueHold - dtS, 0);
    const tongueT = this.tongueHold > 0 ? 1 : 0;
    this.tongueAim = toward(this.tongueAim, tongueT, tongueT > this.tongueAim ? M.TONGUE_OUT_RATE : M.TONGUE_IN_RATE);
    this.tongue = toward(this.tongue, this.tongueAim, this.tongueAim > this.tongue ? M.TONGUE_OUT_RATE : M.TONGUE_IN_RATE);
    openT = Math.max(openT, M.TONGUE_OPEN * this.tongue);

    this.open = toward(this.open, openT, openT < this.open ? M.CLOSE_RATE : M.OPEN_RATE);
    this.wide = toward(this.wide, wideT, M.WIDE_RATE);
  }

  // the mouth as the art draws it: { rows, width, up, tongue }, its rows
  // from top to bottom (1 is shut), how far out it goes either side of the
  // middle, how many of its rows are above the shut line, and the
  // tongue's rows out under it
  shape() {
    const M = MOUTH, open = Math.min(this.open, 1);
    let width = Math.max(1, Math.round((M.WIDTH + M.WIDER * open) * (M.PUCKER + (M.SPREAD - M.PUCKER) * this.wide)));
    const round = (1 - this.wide) * open;
    const tall = 1 + M.ROWS * open;
    let r = tall + (2 * width + 1 - tall) * M.ROUND * round;
    // the tongue, as far as it is out, holds the mouth open round it
    const t = this.tongue, tongue = Math.round(t * M.TONGUE_ROWS);
    if (tongue > 0) {
      width = Math.max(width, Math.round(width + (M.TONGUE_WIDE - width) * t));
      r = Math.max(r, r + (M.TONGUE_TALL - r) * t);
    }
    const rows = r < 2 ? 1 : Math.max(3, Math.round(r));
    return { rows, width, up: Math.round((rows - 1) * M.UPPER), tongue: rows < 3 ? 0 : tongue };
  }

  // the bitmap for the mouth as it is (js/raster.js's ink), made once a shape
  ink() {
    const s = this.shape(), key = s.rows + ' ' + s.width + ' ' + s.up + ' ' + s.tongue;
    let g = this.drawn.get(key);
    if (!g) this.drawn.set(key, g = Framebuffer.ink(Mouth.art(s)));
    return g;
  }

  // a shape drawn: W by H rows of '#' and '.', as face-art.js's frames are
  static art({ rows, width, up, tongue }) {
    const M = MOUTH, px = Array.from({ length: M.H }, () => Array(M.W).fill('.'));
    const put = (x, y, v = '#') => { if (x >= 0 && x < M.W && y >= 0 && y < M.H) px[y][x] = v; };
    const cx = M.X, top = M.Y - up, bottom = top + rows - 1;

    // each row's reach either side: the whole width down the sides, a
    // pixel less a row into the corners, which run as far as they can and
    // no further than the width; shut, the one row reaches the width
    const corner = Math.min(width, Math.max(1, Math.floor((Math.min(rows, 2 * width + 1) - 3) / 2)));
    const reach = (y) => y < top || y > bottom ? -1 : rows === 1 ? width : width - Math.max(0, corner - Math.min(y - top, bottom - y));
    // a row draws from its reach in to one past the narrower of the rows
    // above and below it, so the outline steps without a gap: flat along
    // the top and bottom, a pixel at a time down the sides
    for (let y = top; y <= bottom; y++) {
      const w = reach(y), from = Math.min(w, Math.min(reach(y - 1), reach(y + 1)) + 1);
      for (let x = from; x <= w; x++) { put(cx - x, y); put(cx + x, y); }
    }
    // the buck teeth
    if (rows >= 3) { put(cx - 1, top + 1); put(cx + 1, top + 1); }
    // the cheeks, ( and ), bulging out a pixel between their ends
    const out = Math.max(width, M.CHEEK_LEAST) + M.CHEEK_GAP, tall = Math.min(5, 3 + Math.floor((rows - 1) / 3));
    for (let k = 0; k < tall; k++) {
      const end = k === 0 || k === tall - 1 ? 1 : 0;
      put(cx - out + end, M.Y - 1 + k);
      put(cx + out - end, M.Y - 1 + k);
    }
    // the tongue over the lower lip: the lip broken where it crosses, its
    // sides down from the lip, its tip under them and, all the way out, its
    // groove down the middle
    if (tongue > 0) {
      const t = M.TONGUE_SIDE;
      for (let x = -t + 1; x <= t - 1; x++) put(cx + x, bottom, '.');
      for (let y = bottom; y < bottom + tongue; y++) { put(cx - t, y); put(cx + t, y); }
      for (let x = -t + 1; x <= t - 1; x++) put(cx + x, bottom + tongue);
      if (tongue >= M.TONGUE_ROWS) put(cx, bottom + tongue - 1);
    }
    return px.map((r) => r.join(''));
  }
}
