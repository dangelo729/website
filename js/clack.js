// --- the clack -----------------------------------------------------------------
// the chess set's sound (js/chess.js): a piece set down, slid, knocked over
// or dropped on another is heard, and nothing of it is recorded. every
// step the set says what its solver found touched, and the chessboard
// engine, a synthesizer of a chess set's wood, felt and board, plays that.
// the engine is chebble's, built there and copied here by tools/chebble-web
// as chebble/chessboard.wasm; it runs live in an audio worklet
// (js/clack-worklet.js) at 44.1 khz, mono, through a gain, the browser's
// compressor, which brings a slide up toward a landing, and one master
// gain, in a context of its own beside the piano's and the voice's
// (js/piano.js, js/voice.js). as theirs, the audio is made inside the
// handler of the visitor's first gesture, a touch's end wakes it, as ios
// wants, and any gesture wakes the context if it is not running; the
// worklet and the wasm are asked of the server every time, never taken
// from the browser's cache, and the wasm's bytes go to the worklet to be
// compiled there.
//
// what touched comes as the set's words (say), whole records of RECORD
// floats, a view on the set's memory: they are copied, each record's age,
// the seconds before the end of its step it happened, made its delay, LAG
// less that, and the copy posted with the audio clock's reading, so the
// worklet plays each record LAG after its moment by the audio clock
// however long the frame took. words before the worklet is ready, while
// the context is not running, or while muted, are dropped, never queued.
//
// and it turns the engine's three knobs (turn), what the set is made of,
// each -1 .. 1, all 0 the engine as it starts: what each is called, what
// it is called at either end and at its middle, and the named sets it
// has, each a place for all three, are the wasm's, read on the main
// thread when the page asks (load), before any audio exists. the
// three as they stand (knobs) go to the worklet whenever one is turned and
// there is a node, muted or not, running or not, and again as it says it
// is ready, if any is not 0, so a knob turned before then is heard too. a
// named set turns all three (pick); which one the knobs are is preset, and
// what a knob says where it is, shows.

const Clack = {
  RECORD: 16,    // floats a record of the set's words
  AGE: 14,       // which of them is its age as the set says it, and its delay as the worklet takes it
  LAG: 0.03,     // s: a record is played this long after its moment by the audio clock
  GAIN: 5.25,    // the engine's gain, before the compressor
  // the compressor after it: its threshold (db), knee (db), ratio, attack
  // (s) and release (s)
  SQUEEZE: { threshold: -40, knee: 10, ratio: 12, attack: 0.003, release: 0.4 },
  MASTER: 0.6,   // the master gain, after the compressor
  MUTE_S: 0.03,  // s, the time constant the master gain eases to silence and back by (mute)
  STEP: 0.01,    // the grid a knob turns on
  WORKLET: 'js/clack-worklet.js',
  WASM: 'chebble/chessboard.wasm',

  ctx: null,     // the audio context, made on the first gesture
  node: null,    // the worklet's node, once loaded
  out: null,     // the master gain, once loaded
  ready: false,  // the worklet has the engine made
  muted: false,  // the master gain is at 0 or easing there
  knobs: [0, 0, 0], // the three as they stand, in the order chessboard_knobs takes them, all 0 until one is turned
  names: null,   // each knob's name, in the wasm's order, once read (load)
  ends: null,    // and what each is called at -1, at 0 and at 1
  presets: null, // the named sets, in the wasm's order, each { name, knobs }: where it puts the three, on the grid

  // the knobs' names, their ends' and the named sets read from the wasm,
  // fetched, checked with the server before any copy is used, as the
  // chess set's is (js/chess.js), and instantiated with no imports; its
  // strings latin1 and ended by a 0. done is called once they are kept,
  // outside the wasm's own failures, so its own are not hidden; the
  // instance is let go. a wasm that never comes leaves them null
  load(win, done) {
    win.fetch(this.WASM, { cache: 'no-cache' })
      .then((r) => r.arrayBuffer())
      .then((bytes) => WebAssembly.instantiate(bytes, {}))
      .then(({ instance }) => {
        const cb = instance.exports;
        cb._initialize();
        const text = (at) => {
          const mem = new Uint8Array(cb.memory.buffer);
          let s = '';
          for (let i = at; mem[i]; i++) s += String.fromCharCode(mem[i]);
          return s;
        };
        const names = [], ends = [], presets = [];
        for (let k = 0; cb.chessboard_knob(k); k++) {
          names.push(text(cb.chessboard_knob(k)));
          ends.push([0, 1, 2].map((e) => text(cb.chessboard_end(k, e))));
        }
        for (let p = 0; p < cb.chessboard_presets(); p++) presets.push({ name: text(cb.chessboard_preset(p)), knobs: names.map((n, k) => this.grid(cb.chessboard_preset_knob(p, k))) });
        this.names = names;
        this.ends = ends;
        this.presets = presets;
      })
      .then(() => done(), () => {});
  },

  // v held in -1 .. 1 on the STEP grid, a -0 a 0
  grid(v) {
    const n = Math.round(1 / this.STEP);
    return Math.round(Math.min(1, Math.max(-1, v)) * n) / n + 0;
  },

  // makes the audio on win's first gesture and wakes it on any later one
  listen(win) {
    const wake = () => this.wake(win);
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) win.addEventListener(type, wake, true);
  },

  // the audio context made at the engine's rate, the worklet loaded and the
  // wasm fetched, its node made through the gain, the compressor and the
  // master gain, once; the context resumed whenever it is not running. no
  // worklet, no sound
  wake(win) {
    if (!this.ctx) {
      if (!win.AudioContext || !win.AudioWorkletNode) return;
      const ctx = new win.AudioContext({ sampleRate: 44100 });
      this.ctx = ctx;
      // the worklet by a query no cache has seen, the wasm checked with the
      // server before any copy is used, as the piano's are (js/piano.js)
      const fresh = '?' + Date.now();
      Promise.all([ctx.audioWorklet.addModule(this.WORKLET + fresh), win.fetch(this.WASM, { cache: 'no-cache' }).then((r) => r.arrayBuffer())])
        .then(([, wasm]) => {
          const node = new win.AudioWorkletNode(ctx, 'clack', {
            numberOfInputs: 0,
            outputChannelCount: [1],
            processorOptions: { wasm },
          });
          const gain = ctx.createGain();
          gain.gain.value = this.GAIN;
          const squeeze = ctx.createDynamicsCompressor();
          for (const key in this.SQUEEZE) squeeze[key].value = this.SQUEEZE[key];
          const out = ctx.createGain();
          out.gain.value = this.muted ? 0 : this.MASTER;
          node.connect(gain);
          gain.connect(squeeze);
          squeeze.connect(out);
          out.connect(ctx.destination);
          node.port.onmessage = () => {
            this.ready = true;
            if (this.knobs.some((v) => v)) node.port.postMessage({ knobs: this.knobs.slice() });
          };
          this.node = node;
          this.out = out;
        })
        .catch(() => {});
    }
    if (this.ctx.state !== 'running') this.ctx.resume();
  },

  // muted or not: the master gain eased to 0 or back to MASTER by the house
  // approach, MUTE_S its time constant. a sound made muted starts at 0
  mute(on) {
    this.muted = on;
    if (this.out) this.out.gain.setTargetAtTime(on ? 0 : this.MASTER, this.ctx.currentTime, this.MUTE_S);
  },

  // a step's words said: its whole records copied, each one's age made its
  // delay, and posted with the audio clock's reading; nothing until the
  // worklet is ready, nor while the context is not running, nor muted, nor
  // for less than a record
  say(words) {
    if (!this.ready || this.muted || this.ctx.state !== 'running') return;
    const n = words.length - words.length % this.RECORD;
    if (!n) return;
    const copy = words.slice(0, n);
    for (let i = this.AGE; i < n; i += this.RECORD) copy[i] = this.LAG - copy[i];
    this.node.port.postMessage({ words: copy, at: this.ctx.currentTime }, [copy.buffer]);
  },

  // knob i turned to v, held to the grid (grid): the three as they stand
  // go to the worklet whenever there is a node. a knob turned to where it
  // is does nothing
  turn(i, v) {
    v = this.grid(v);
    if (v === this.knobs[i]) return;
    this.knobs[i] = v;
    if (this.node) this.node.port.postMessage({ knobs: this.knobs.slice() });
  },

  // all three turned to where named set p puts them
  pick(p) {
    const to = this.presets[p].knobs;
    for (let i = 0; i < to.length; i++) this.turn(i, to[i]);
  },

  // which named set the knobs are, its place, every knob where it puts
  // it; or -1 for none, or before they are read
  preset() {
    return this.presets ? this.presets.findIndex((p) => p.knobs.every((v, i) => v === this.knobs[i])) : -1;
  },

  // what knob i says at v, where it is unless given: its name, and what it
  // is called at an end past 0.905 either way, at its middle within 0.005
  // of it, and else the number, signed, to two places
  shows(i, v = this.knobs[i]) {
    const ends = this.ends[i];
    const word = v < -0.905 ? ends[0] : v > 0.905 ? ends[2] : Math.abs(v) < 0.005 ? ends[1] : (v < 0 ? '-' : '+') + Math.abs(v).toFixed(2);
    return this.names[i] + ' ' + word;
  },
};
