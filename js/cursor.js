// --- the cursor --------------------------------------------------------------
// the pointer, drawn into the frame as one of cicada's hands: hand1 from
// hand-art.js at 0.3 of its size, a sprite (js/raster.js) through the letters'
// sampler like everything else, while the page hides the native pointer over
// the canvas. it sits open with its palm's middle on the pointer; while the
// button is held it closes through the art's transitional frames to the
// fist, one frame a 60 hz step, and when the button lifts it opens back
// through them. behind it goes cicada's dark ellipse, bottom-anchored and as
// tall as the frame's ink, so the hand reads over the letters and the
// bubble. the frames walk in whole 60 hz steps; the cursor never asks the
// clock or the pointer itself, the page hands it where the pointer is,
// whether the button is down and the time gone by.

const CURSOR = {
  STEP_S: 1 / 60, MAX_CATCHUP_S: 0.1, // frames walk per 60 hz step whatever the screen's rate
  SCALE: 0.53,                        // of the art: cicada's hand at 0.53, 11 x 18 world px
  MIRROR: false,                      // hand1 as drawn, thumb on the left; true reverses every row
  HOT: { x: 0, y: 4 },                // art px from the bitmap's centre that sits on the pointer: the palm's middle
  OPEN_FRAME: 0, GRAB_FRAME: 13,
  CLOSE_S: 13 / 60, OPEN_S: 13 / 60,  // seconds to walk open -> fist and back: one frame a step, every transitional sprite shown
  BACKING: { WIDTH: 1.0, HEIGHT: 0.98, X_OFFSET: -1, POINTS: 48 }, // cicada's dark ellipse behind the hand, bottom-anchored
  MIN_HITS: 3,                        // of a pixel's 16 sample points on ink to light it; the letters use 6, this small 3 keeps the outline whole
};

class Cursor {
  constructor() {
    const frames = HAND_ART.hand.frames;
    // every frame as a sprite's bitmap, made once, not each draw
    const rows = (f) => CURSOR.MIRROR ? f.map((r) => r.split('').reverse().join('')) : f;
    this.ink = frames.map((f) => Framebuffer.ink(rows(f)));
    // each frame's first row with ink: the fist's is 8 rows down, so its
    // backing is only as tall as what is drawn
    this.top = frames.map((f) => Math.max(0, f.findIndex((r) => r.includes('#'))));
    // the pointer, in world px, unrounded; it is drawn on its pixel
    this.x = 0;
    this.y = 0;
    this.shown = false;
    this.held = false;
    // a float walked toward the fist or the open hand and rounded to draw
    this.frame = CURSOR.OPEN_FRAME;
    this.owed = 0;
    // the backing's polygon, refilled each draw: a frame should not allocate
    this.ring = [];
    for (let k = 0; k < CURSOR.BACKING.POINTS; k++) this.ring.push({ x: 0, y: 0 });
  }

  // where the pointer is; a touch is moved with shown false, as there is
  // nothing to see under a finger
  moveTo(x, y, shown = true) {
    this.x = x;
    this.y = y;
    this.shown = shown;
  }

  press() { this.held = true; }
  release() { this.held = false; }
  hide() { this.shown = false; }

  // dtS of time gone by runs that many whole steps, so calling this once a
  // frame on a 120 hz screen does not double the hand's speed and calling it
  // once a 60 hz step runs exactly one. no dt at all is taken as one step.
  update(dtS) {
    if (!(dtS >= 0)) dtS = CURSOR.STEP_S;
    // owed is counted in steps, so taking a whole one off is exact
    const most = Math.round(CURSOR.MAX_CATCHUP_S / CURSOR.STEP_S);
    this.owed = Math.min(this.owed + dtS / CURSOR.STEP_S, most);
    while (this.owed >= 1) {
      this.owed -= 1;
      this.step();
    }
  }

  // one step of the walk toward the fist while held, the open hand while
  // not, at a steady rate and never past it
  step() {
    const C = CURSOR, target = this.held ? C.GRAB_FRAME : C.OPEN_FRAME;
    const by = Math.abs(C.GRAB_FRAME - C.OPEN_FRAME) * C.STEP_S / (this.held ? C.CLOSE_S : C.OPEN_S);
    if (this.frame < target) this.frame = Math.min(target, this.frame + by);
    else if (this.frame > target) this.frame = Math.max(target, this.frame - by);
  }

  // the backing and then the hand, the bitmap's centre put on the middle
  // of the pixel the hotspot's pointer puts it in. the art's 1 px strokes
  // are a third of a world pixel wide at this scale, so what the sampler
  // makes of the hand depends wholly on where in a pixel it lands: on a
  // pixel's middle every frame samples the same way wherever the pointer
  // is, and the hand moves in whole world pixels, as a pointer on a pixel
  // grid should
  draw(fb) {
    if (!this.shown) return;
    const B = CURSOR.BACKING, s = CURSOR.SCALE, ring = this.ring, n = ring.length;
    const f = Cursor.frameIndex(this.frame), g = this.ink[f];
    const cx = Math.floor(this.x - CURSOR.HOT.x * s) + 0.5, cy = Math.floor(this.y - CURSOR.HOT.y * s) + 0.5;
    // as wide as the bitmap, as tall as the frame's ink, its bottom on the bitmap's
    const rx = g.w / 2 * B.WIDTH * s, ry = (g.h - this.top[f]) / 2 * B.HEIGHT * s;
    const ex = cx + B.X_OFFSET * s, ey = cy + g.h / 2 * s - ry;
    // fillPolygon fills a pixel when its corner is inside, the sprite asks
    // at the pixel's middle: half a pixel back puts the two on one grid
    for (let k = 0; k < n; k++) {
      const a = 2 * Math.PI * k / n;
      ring[k].x = ex + rx * Math.cos(a) - 0.5;
      ring[k].y = ey + ry * Math.sin(a) - 0.5;
    }
    fb.fillPolygon(ring, 0);
    fb.sprite(g, cx, cy, s, 0, 1, CURSOR.MIN_HITS);
  }

  // a float frame as the index of the one to draw
  static frameIndex(f) {
    return Math.max(0, Math.min(HAND_ART.hand.frames.length - 1, Math.round(f)));
  }
}
