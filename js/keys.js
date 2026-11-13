// --- the keys ------------------------------------------------------------------
// upright's demo (index.html) is saloon's piano keyboard: ten white keys
// and seven black, c to e, seen from above as a player sees them, their
// fronts along the bottom, drawn by second_dimension from saloon's art. a
// note on presses its key, which slides back from its front at once and
// reads as shortened, and a note off lets it rise (on, off). a note in any octave
// goes down on a key of its name: the seventeen keys are a window of
// notes, c4 to e5 at first, that moves by whole octaves to take in a note
// outside it. the keys lie straight and keep their length whatever piano
// the page plays.
// all of it is saloon/keys.wasm, built by tools/saloon_keys-web, run on
// the main thread a step a frame. the wasm is checked with the server
// before any copy is used, as the ship's is (js/ship.js), and instantiated
// once. what comes out each step is two pictures the same size, ink
// bitmaps as Framebuffer.prototype.sprite takes them (js/raster.js), views
// on the wasm's memory that each step rewrites: the picture, each white
// key its outline alone and each black key ink all over, with a line
// along their backs; and glow, the part of it that is the outline of a
// key that is down or that the page's pointer is on (point), for the page
// to draw over the picture in another colour. they are drawn at SCALE
// world px a pixel.

const Keys = {
  SCALE: 2.2, // world px a picture px
  WASM: 'saloon/keys.wasm',

  ready: false,   // the wasm is in and the pictures are its
  picture: null,  // { ink, w, h }, a view on the wasm's memory
  glow: null,     // the same, of the outlines of the keys that are down and the key pointed at
  asked: false,   // the wasm has been fetched for
  mm: null,       // its exports, once in
  buffer: null,   // its memory's buffer the view is on

  // the wasm fetched and instantiated, once: made, its first frame drawn,
  // and its pictures viewed. keys that could not be made are never ready
  load(win) {
    if (this.asked) return;
    this.asked = true;
    win.fetch(this.WASM, { cache: 'no-cache' })
      .then((r) => r.arrayBuffer())
      .then((bytes) => WebAssembly.instantiate(bytes, {}))
      .then(({ instance }) => {
        const mm = instance.exports;
        if (mm._initialize) mm._initialize();
        if (!mm.keys_init()) return;
        this.mm = mm;
        this.view();
        this.ready = true;
      })
      .catch(() => {});
  },

  // the pictures made again on the wasm's memory at their size
  view() {
    const mm = this.mm, buf = mm.memory.buffer, w = mm.keys_w(), h = mm.keys_h();
    this.picture = { ink: new Uint8Array(buf, mm.keys_ink(), w * h), w, h };
    this.glow = { ink: new Uint8Array(buf, mm.keys_glow(), w * h), w, h };
    this.buffer = buf;
  },

  // midi note's key pressed, and let go; and every key let go
  on(note) {
    if (this.ready) this.mm.keys_on(note);
  },
  off(note) {
    if (this.ready) this.mm.keys_off(note);
  },
  allOff() {
    if (this.ready) this.mm.keys_all_off();
  },

  // the key the page's pointer is on, by its midi note in the window as it
  // stands, as at gives it, or -1 for none: its outline glows from the next
  // step, until another is pointed at
  point(note) {
    if (this.ready) this.mm.keys_point(note);
  },

  // the midi note of the key at x and y world px from the picture's middle
  // as it is drawn, in the window as it stands, or -1 off the picture
  at(x, y) {
    if (!this.ready) return -1;
    const p = this.picture;
    return this.mm.keys_at(x / this.SCALE + p.w / 2, y / this.SCALE + p.h / 2);
  },

  // one frame, dtS seconds on; and, since the pictures have been drawn
  // again, the flatness js/raster.js keeps with a bitmap dropped from
  // each, to be worked out again
  step(dtS) {
    if (!this.ready) return;
    const mm = this.mm;
    if (mm.memory.buffer !== this.buffer) this.view();
    mm.keys_step(dtS);
    this.picture.flat = null;
    this.glow.flat = null;
  },
};
