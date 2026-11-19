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
  WORKLET: 'js/clack-worklet.js',
  WASM: 'chebble/chessboard.wasm',

  ctx: null,     // the audio context, made on the first gesture
  node: null,    // the worklet's node, once loaded
  out: null,     // the master gain, once loaded
  ready: false,  // the worklet has the engine made
  muted: false,  // the master gain is at 0 or easing there

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
          node.port.onmessage = () => { this.ready = true; };
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
};
