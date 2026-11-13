// --- daedalus ------------------------------------------------------------------
// second dimension's demo (index.html) is daedalus's body: his head, his
// beard and his four arms, a mallet in each hand, drawn by
// second_dimension as they are on his own panel, his arms a little bigger
// so they reach further, and no bells. his arms hunt the page's pointer
// instead: one whose reach the pointer comes into
// swings at it at once and strikes where it was, and while it stays winds
// up beside it and swings again, so a pointer that keeps moving is missed.
// the page says where its pointer is (point) or that it has none
// (pointOff), and reads the arms that struck in each step (struck), to
// play each strike a note.
// all of it is daedalus/body.wasm, built by tools/daedalus_body-web, run
// on the main thread a step a frame. the wasm is checked with the server
// before any copy is used, as the ship's is (js/ship.js), and instantiated
// once. what comes out each step is the picture, an ink bitmap (the lit
// pixels) as Framebuffer.prototype.sprite takes it (js/raster.js), a view
// on the wasm's memory that each step rewrites: his head in its middle,
// and every place a mallet can reach inside it. it is drawn at SCALE world
// px a pixel.

const Daedalus = {
  SCALE: 2.2, // world px a picture px
  WASM: 'daedalus/body.wasm',

  ready: false,   // the wasm is in and the picture is its
  picture: null,  // { ink, w, h }, a view on the wasm's memory
  asked: false,   // the wasm has been fetched for
  mm: null,       // its exports, once in
  buffer: null,   // its memory's buffer the view is on
  struck: 0,      // the arms that struck in the last step, a bit an arm: 1 his upper left's, 2 his upper right's, 4 his lower left's, 8 his lower right's

  // the wasm fetched and instantiated, once: made, its first frame drawn,
  // and its picture viewed. a body that could not be made is never ready
  load(win) {
    if (this.asked) return;
    this.asked = true;
    win.fetch(this.WASM, { cache: 'no-cache' })
      .then((r) => r.arrayBuffer())
      .then((bytes) => WebAssembly.instantiate(bytes, {}))
      .then(({ instance }) => {
        const mm = instance.exports;
        if (mm._initialize) mm._initialize();
        if (!mm.body_init()) return;
        this.mm = mm;
        this.view();
        this.ready = true;
      })
      .catch(() => {});
  },

  // the picture made again on the wasm's memory at its size
  view() {
    const mm = this.mm, buf = mm.memory.buffer, w = mm.body_w(), h = mm.body_h();
    this.picture = { ink: new Uint8Array(buf, mm.body_ink(), w * h), w, h };
    this.buffer = buf;
  },

  // the page's pointer, x and y world px from the picture's middle as it
  // is drawn: the picture's pixel it is in, the pixel's middle a whole
  // number
  point(x, y) {
    if (!this.ready) return;
    const p = this.picture;
    this.mm.body_point(x / this.SCALE + p.w / 2 - 0.5, y / this.SCALE + p.h / 2 - 0.5);
  },

  // the page has no pointer
  pointOff() {
    if (this.ready) this.mm.body_point_off();
  },

  // one frame, dtS seconds on, and the arms that struck in it; and, since
  // the picture has been drawn again, the flatness js/raster.js keeps with
  // a bitmap dropped, to be worked out again
  step(dtS) {
    if (!this.ready) return;
    const mm = this.mm;
    if (mm.memory.buffer !== this.buffer) this.view();
    mm.body_step(dtS);
    this.struck = mm.body_struck();
    this.picture.flat = null;
  },
};
