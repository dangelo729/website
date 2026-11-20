// --- letters -----------------------------------------------------------------
// a letter is one object: a bitmap (a glyph of js/type.js's cut to its ink,
// an icon, a box's art, or a picture in its own colours), a home position
// in continuous world space, a scale and a tilt, and slow sines of its own
// on each, at rates and phases seeded from its place in the text. it is
// drawn as a sprite (js/raster.js): every world pixel in its box is carried
// back through the transform into the bitmap and lit when enough of it
// lands on ink, so a sub-pixel move or a touch of scale shows as edge
// pixels popping, never as the block stepping, and a 1 px stroke at these
// scales always lights one pixel and only doubles when it sits almost
// exactly between two. a page hands Letter.fb the framebuffer its letters
// draw into unless told another, each time it makes it.

const LETTER = {
  SCALE: 1.56, // of a bitmap's px, a letter's scale unless it is given its own
  // the four sines together, as Letter.make takes them
  WOBBLE: {
    SWAY_PX: 0.1, SWAY_HZ: 0.4,       // along x
    BOB_PX: 0.1, BOB_HZ: 0.23,        // along y
    BREATHE: 0.008, BREATHE_HZ: 0.31, // of the scale: at SCALE, 1.55 to 1.57
    TILT_RAD: 0.006, TILT_HZ: 0.17,   // about the centre
  },
};

const Letter = (() => {
  // the framebuffer a letter draws into unless given another, set and read
  // as Letter.fb. a variable, not a property: every draw with no into
  // reads it, hundreds a frame, and webkit compiles that read of a
  // property into a slower draw in some loads
  let fb = null;

  // a stable number in [0, 1) from two integers
  function noise(i, k) {
    const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
    return s - Math.floor(s);
  }

  return {
    get fb() { return fb; },
    set fb(f) { fb = f; },

    noise,

    // the bitmap g centred on (cx, cy), drawn at scale and wobbled by
    // wob, its rates and phases seeded from i, in v: ink, or a colour of
    // the framebuffer's palette. g a picture ({ px, w, h }) rather than
    // ink, it goes through Framebuffer.spritePixels in its own colours,
    // wobbling as a letter does. g null, it is the wobble alone, for
    // something drawn its own way
    make(g, cx, cy, i, scale = LETTER.SCALE, wob = LETTER.WOBBLE, v = 1) {
      const rate = (base, k) => base * (0.8 + 0.4 * noise(i, k));
      const phase = (k) => 2 * Math.PI * noise(i, k);
      return {
        g, cx, cy, scale, wob, v,
        swayHz: rate(wob.SWAY_HZ, 1), bobHz: rate(wob.BOB_HZ, 2), breatheHz: rate(wob.BREATHE_HZ, 3), tiltHz: rate(wob.TILT_HZ, 4),
        swayPh: phase(5), bobPh: phase(6), breathePh: phase(7), tiltPh: phase(8),
        // where it is at time t: its centre, its scale and its tilt, { x, y, s, a }
        pose(t) {
          const w = 2 * Math.PI * t, m = this.wob;
          return {
            x: this.cx + m.SWAY_PX * Math.sin(w * this.swayHz + this.swayPh),
            y: this.cy + m.BOB_PX * Math.sin(w * this.bobHz + this.bobPh),
            s: this.scale * (1 + m.BREATHE * Math.sin(w * this.breatheHz + this.breathePh)),
            a: m.TILT_RAD * Math.sin(w * this.tiltHz + this.tiltPh),
          };
        },
        // at time t, dy world px down from home (up, for a scroll) and dx
        // across, into Letter.fb or another, turned turn radians more
        // (clockwise) than its tilt, in v if given rather than its own.
        // its pose is pose(t)'s, worked out in place with no object made
        // for it, each sum in the order pose(t) and the offsets would make
        // it. a picture unturned at its own size with its top left (x0,
        // y0) on a whole pixel is blitted, which lands it pixel for pixel
        // as the sprite would
        draw(t, dy = 0, into = fb, turn = 0, v = this.v, dx = 0) {
          const w = 2 * Math.PI * t, m = this.wob, g = this.g;
          const x = this.cx + m.SWAY_PX * Math.sin(w * this.swayHz + this.swayPh) + dx;
          const y = this.cy + m.BOB_PX * Math.sin(w * this.bobHz + this.bobPh) + dy;
          const s = this.scale * (1 + m.BREATHE * Math.sin(w * this.breatheHz + this.breathePh));
          const a = m.TILT_RAD * Math.sin(w * this.tiltHz + this.tiltPh) + turn;
          const x0 = x - g.w / 2, y0 = y - g.h / 2;
          if (!g.px) into.sprite(g, x, y, s, a, v);
          else if (s === 1 && a === 0 && Number.isInteger(x0) && Number.isInteger(y0)) into.blitPixels(g, x0, y0);
          else into.spritePixels(g, x, y, s, a);
        },
      };
    },
  };
})();
