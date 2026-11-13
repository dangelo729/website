// --- the moon man's face ------------------------------------------------------
// monk mouth's demo (index.html) wears moon_man's face: his real 3d mouth,
// its lips, its tongue and its dark back, shaped from the voice's raw state
// by moon_man's own mouth model and drawn by third_dimension in his outline
// look, on a head his own gaze model turns, glancing somewhere new at each
// syllable's onset and coming home in silence, where it glances a little
// every second or few (tools/moon_man-web); and the eyes and the nose,
// flat sprites painted by hand, each on a seat of its own on that head and
// angled to follow its turn by second_dimension's blit, the right eye the
// left eye's art mirrored. all of it is moon_man/moon_man.wasm, built by
// tools/moon_man-web, run on the main thread a step a frame. the wasm is
// checked with the server before any copy is used, as the voice's is
// (js/voice.js), and instantiated once. what comes out each step is the
// face a feature at a time, in the order the page draws them: the lips, the
// nose, the left eye and the right eye, each a paper bitmap (every pixel it
// covers) and an ink bitmap (the lit ones) as Framebuffer.prototype.sprite
// takes them (js/raster.js), views on the wasm's memory that each step
// rewrites, with where its middle sits from the head's centre and the scale
// it is drawn at. the lips are moon_man's panel's pixels, face px, drawn
// at SCALE; the sprites are made at SCALE world px a sprite px already, and
// drawn at 1.

const Moon = {
  SCALE: 2, // world px a face px, and a sprite px at rest
  WASM: 'moon_man/moon_man.wasm',
  ART_MAX: 64,  // an art's widest and tallest, sprite px
  STATE: 75,    // floats the wasm's state buffer holds: 11, then up to 64 diameters
  // the features in the order the page draws them, and each one's number in the wasm
  NAMES: ['lips', 'nose', 'leftEye', 'rightEye'],
  AT: [0, 3, 1, 2],

  ready: false,  // the wasm is in and the features are its
  features: [],  // { name, paper, ink, x, y, scale } in draw order; x, y world px from the head's centre
  asked: false,  // the wasm has been fetched for
  mm: null,      // its exports, once in
  buffer: null,  // its memory's buffer the views are on
  input: null,   // its state buffer, a view
  rows: null,    // the eye's and the nose's rows, kept for the wasm

  // the wasm fetched and instantiated, once: made with the sprites at SCALE
  // and its gaze seeded at random, handed the art if it has come, and its
  // features viewed
  load(win) {
    if (this.asked) return;
    this.asked = true;
    win.fetch(this.WASM, { cache: 'no-cache' })
      .then((r) => r.arrayBuffer())
      .then((bytes) => WebAssembly.instantiate(bytes, {}))
      .then(({ instance }) => {
        const mm = instance.exports;
        if (mm._initialize) mm._initialize();
        mm.moon_init(this.SCALE, 1 + Math.floor(Math.random() * 0xfffffffe));
        this.mm = mm;
        this.features = this.NAMES.map((name, i) => ({ name, paper: null, ink: null, x: 0, y: 0, scale: this.AT[i] === 0 ? this.SCALE : 1 }));
        if (this.rows) this.give();
        this.view();
        this.place();
        this.ready = true;
      })
      .catch(() => {});
  },

  // the eye's and the nose's rows of '#' ink, 'o' paper and '.' clear,
  // kept and handed to the wasm now if it is in, else once it is: each
  // shows from the next step
  art(eyeRows, noseRows) {
    this.rows = [eyeRows, noseRows];
    if (this.mm) {
      this.give();
      this.view();
    }
  },

  // the kept rows into the wasm, the eye's then the nose's, each as wide as
  // its longest row and cut to ART_MAX: '#' 2, 'o' 1 and anything else 0
  give() {
    const mm = this.mm;
    for (let a = 0; a < 2; a++) {
      const rows = this.rows[a] || [], h = Math.min(rows.length, this.ART_MAX);
      let w = 0;
      for (let r = 0; r < h; r++) w = Math.max(w, rows[r].length);
      w = Math.min(w, this.ART_MAX);
      const bytes = new Uint8Array(mm.memory.buffer, mm.moon_art_rows(), w * h);
      for (let r = 0; r < h; r++) {
        for (let i = 0; i < w; i++) {
          const c = rows[r][i];
          bytes[r * w + i] = c === '#' ? 2 : c === 'o' ? 1 : 0;
        }
      }
      mm.moon_art(a, w, h);
    }
  },

  // each feature's bitmaps made again on the wasm's memory at its canvas's
  // size, and the state buffer's view
  view() {
    const mm = this.mm, buf = mm.memory.buffer;
    for (let i = 0; i < this.features.length; i++) {
      const f = this.features[i], n = this.AT[i], w = mm.moon_w(n), h = mm.moon_h(n);
      f.paper = { ink: new Uint8Array(buf, mm.moon_mask(n), w * h), w, h };
      f.ink = { ink: new Uint8Array(buf, mm.moon_ink(n), w * h), w, h };
    }
    this.input = new Float32Array(buf, mm.moon_state(), this.STATE);
    this.buffer = buf;
  },

  // each feature's middle from the head's centre, world px; and, since its
  // planes have been drawn again, the flatness js/raster.js keeps with a
  // bitmap dropped, to be worked out again
  place() {
    const mm = this.mm;
    for (let i = 0; i < this.features.length; i++) {
      const f = this.features[i], n = this.AT[i];
      f.x = mm.moon_x(n) * this.SCALE;
      f.y = mm.moon_y(n) * this.SCALE;
      f.paper.flat = null;
      f.ink.flat = null;
    }
  },

  // one frame, dtS seconds on: state the voice's raw state (11 floats, then
  // the tube's diameters), or null in silence
  step(state, dtS) {
    if (!this.ready) return;
    const mm = this.mm;
    if (mm.memory.buffer !== this.buffer) this.view();
    if (state) this.input.set(state.length > this.STATE ? state.subarray(0, this.STATE) : state);
    mm.moon_step(dtS, state ? 1 : 0);
    this.place();
  },
};
