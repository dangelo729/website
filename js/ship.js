// --- the ship in a bottle ------------------------------------------------------
// third dimension's demo (index.html) is the_ship's ship in a bottle: a
// glass bottle on its side, stoppered by a cork, a shallow sea sloshing in
// its belly and a small steamboat riding it, drawn by third_dimension in
// its outline look. the water is physics_box's fluid, and it feels the
// bottle turning: the page turns it (turn), and the drawn bottle eases
// round to where it has been turned. all of it is the_ship/the_ship.wasm,
// built by tools/the_ship-web, run on the main thread a step a frame. the
// wasm is checked with the server before any copy is used, as the face's
// is (js/moon.js), and instantiated once. what comes out each step is the
// picture, an ink bitmap (the lit pixels) as Framebuffer.prototype.sprite
// takes it (js/raster.js), a view on the wasm's memory that each step
// rewrites, its camera fitted so the whole bottle stays inside it however
// far it is turned. it is drawn at SCALE world px a pixel.

const Ship = {
  SCALE: 1.1, // world px a picture px
  WASM: 'the_ship/the_ship.wasm',

  ready: false,   // the wasm is in and the picture is its
  picture: null,  // { ink, w, h }, a view on the wasm's memory
  asked: false,   // the wasm has been fetched for
  mm: null,       // its exports, once in
  buffer: null,   // its memory's buffer the view is on

  // the wasm fetched and instantiated, once: made, its first frame drawn,
  // and its picture viewed. a ship whose water could not be had is never
  // ready
  load(win) {
    if (this.asked) return;
    this.asked = true;
    win.fetch(this.WASM, { cache: 'no-cache' })
      .then((r) => r.arrayBuffer())
      .then((bytes) => WebAssembly.instantiate(bytes, {}))
      .then(({ instance }) => {
        const mm = instance.exports;
        if (mm._initialize) mm._initialize();
        if (!mm.ship_init()) return;
        this.mm = mm;
        this.view();
        this.ready = true;
      })
      .catch(() => {});
  },

  // the picture made again on the wasm's memory at its size
  view() {
    const mm = this.mm, buf = mm.memory.buffer, w = mm.ship_w(), h = mm.ship_h();
    this.picture = { ink: new Uint8Array(buf, mm.ship_ink(), w * h), w, h };
    this.buffer = buf;
  },

  // the bottle turned rad further about its upright axis (+ counterclockwise
  // seen from above): where it is headed moves, and the drawn bottle eases
  // there over the next steps
  turn(rad) {
    if (this.ready) this.mm.ship_turn(rad);
  },

  // one frame, dtS seconds on; and, since the picture has been drawn
  // again, the flatness js/raster.js keeps with a bitmap dropped, to be
  // worked out again
  step(dtS) {
    if (!this.ready) return;
    const mm = this.mm;
    if (mm.memory.buffer !== this.buffer) this.view();
    mm.ship_step(dtS);
    this.picture.flat = null;
  },
};
