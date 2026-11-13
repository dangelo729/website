// --- the piano ---------------------------------------------------------------
// the page's piano, a key for each of DEGREES degrees of the page's scale
// (js/scale.js) up from its root: the name across the top of index.html is
// a row of them, a key a letter, daedalus's mallets strike four of them and
// the bubble one at random. it is upright, the physically modelled piano,
// exactly as saloon plays it at five knobs of its own: saloon's twin of its
// piano rig over upright's core, built by tools/upright-web into
// upright/upright.wasm, runs live in an audio worklet (js/piano-worklet.js)
// at upright's 44.1 khz, mono, through one master gain. a browser holds
// sound back until the visitor's first gesture, so nothing is made before
// one: the first pointerdown, pointerup, touchend, click or keydown makes
// the audio context inside its handler, a press among them so that a drag
// that feeds the bubble (index.html) is heard, and a touch's end wakes it,
// as ios wants; it loads the worklet and fetches the wasm, neither from
// the browser's cache, and the wasm's bytes go
// to the worklet to be compiled there; any gesture wakes the context if it
// is not running. a key of the scale is only ever struck: its note is its
// degree's in the scale as it is set at the strike, it rings its plink out
// and the wasm lets it go once it has rung. a strike before the worklet is
// ready, or while the context is not running, is silent, never queued.
//
// upright's own item (index.html) plays it as a hand does, any note at
// all: a key pressed is struck and held (press) until it is let go (lift),
// with the sustain pedal to hold the dampers off (pedal). and it turns the
// knobs (turn): the five as they stand (knobs) are the page's piano,
// whatever plays it, a knob turned landing under the keys still sounding,
// which ease to the new piano. each knob says where it is as saloon's sim
// does (say).

const Piano = {
  DEGREES: 13,   // its keys, the scale's degrees up from the root: one per letter of the name, p to o
  // saloon's five knobs in its order, each -1 .. 1, as the page starts
  // with them: instrument (string, tine, reed), tone (dark, bright), size
  // (toy, hall), detune (one, wide), damper (heavy, light)
  KNOBS: [0.73, -1, -0.59, 0.55, 0],
  // each knob's name, and what it is at -1, 0 and 1, saloon's words
  NAMES: ['instrument', 'tone', 'size', 'detune', 'damper'],
  ENDS: [['string', 'tine', 'reed'], ['dark', 'medium', 'bright'], ['toy', 'grand', 'hall'], ['one', 'three', 'wide'], ['heavy', 'felt', 'light']],
  STEP: 0.01,    // the grid a knob turns on, as saloon's sim's sliders do
  VELOCITY: 100, // every strike's, saloon's default
  // the master gain: a key alone, any key of any scale, peaks through it
  // at 0.46 at most, and sweeps along the name, keys 20 to 100 ms apart,
  // at 0.75 in the scale the page starts in and at 0.87 at most in any
  // mode from c4 or c5; the worklet never strikes two keys closer than 20
  // ms, so nothing louder reaches it there. from a lower octave the keys
  // ring longer and a fast sweep piles them up: 20 ms a key passes full
  // scale from c1, c2 and c3, and 40 ms a key from c2
  // (tools/upright-web's make measure measures all of it)
  MASTER: 1.25,
  MUTE_S: 0.03, // s, the time constant the master gain eases to silence and back by (mute)
  WORKLET: 'js/piano-worklet.js',
  WASM: 'upright/upright.wasm',

  ctx: null,     // the audio context, made on the first gesture
  node: null,    // the worklet's node, once loaded
  out: null,     // the master gain, once loaded
  ready: false,  // the worklet has the piano made
  muted: false,  // the master gain is at 0 or easing there
  knobs: null,   // the five as they stand now, KNOBS until one is turned (set under this object)

  // makes the audio on win's first gesture and wakes it on any later one
  listen(win) {
    const wake = () => this.wake(win);
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) win.addEventListener(type, wake, true);
  },

  // the audio context made at upright's rate, the worklet loaded and the
  // wasm fetched, its node made through the master gain, once; the context
  // resumed whenever it is not running. no worklet, no sound
  wake(win) {
    if (!this.ctx) {
      if (!win.AudioContext || !win.AudioWorkletNode) return;
      const ctx = new win.AudioContext({ sampleRate: 44100 });
      this.ctx = ctx;
      // the worklet by a query no cache has seen, the wasm checked with the
      // server before any copy is used, as the voice's are (js/voice.js)
      const fresh = '?' + Date.now();
      Promise.all([ctx.audioWorklet.addModule(this.WORKLET + fresh), win.fetch(this.WASM, { cache: 'no-cache' }).then((r) => r.arrayBuffer())])
        .then(([, wasm]) => {
          const node = new win.AudioWorkletNode(ctx, 'upright', {
            numberOfInputs: 0,
            outputChannelCount: [1],
            processorOptions: { wasm, knobs: this.knobs.slice(), velocity: this.VELOCITY },
          });
          const out = ctx.createGain();
          out.gain.value = this.muted ? 0 : this.MASTER;
          node.connect(out);
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
  // approach, MUTE_S its time constant. a piano made muted starts at 0
  mute(on) {
    this.muted = on;
    if (this.out) this.out.gain.setTargetAtTime(on ? 0 : this.MASTER, this.ctx.currentTime, this.MUTE_S);
  },

  // degree deg's key struck, its note the scale's as it is set now; nothing
  // until the worklet is ready, nor while the context is not running, which
  // would hold the strike and sound it when it wakes
  strike(deg) {
    if (!this.ready || this.ctx.state !== 'running') return;
    this.node.port.postMessage(Scale.midi(deg));
  },

  // midi note's key pressed at velocity 1 .. 127: struck, and held until
  // it is let go (lift). silent, never queued, as a strike is
  press(note, velocity) {
    if (!this.ready || this.ctx.state !== 'running') return;
    this.node.port.postMessage({ on: note, velocity });
  },

  // midi note's key let go: its damper lands, unless the pedal holds it
  // off. it goes whenever there is a node, so a key pressed is never left
  // down
  lift(note) {
    if (this.node) this.node.port.postMessage({ off: note });
  },

  // the sustain pedal: down, every damper lifted, and up, they land on the
  // keys already let go
  pedal(down) {
    if (this.node) this.node.port.postMessage({ pedal: down });
  },

  // knob i turned to v, held in -1 .. 1 on the STEP grid: the five as they
  // stand go to the worklet, if it is made, and a worklet made later is
  // made with them. a knob turned to where it is does nothing
  turn(i, v) {
    const n = Math.round(1 / this.STEP);
    v = Math.round(Math.min(1, Math.max(-1, v)) * n) / n + 0; // and a -0 a 0
    if (v === this.knobs[i]) return;
    this.knobs[i] = v;
    if (this.node) this.node.port.postMessage({ knobs: this.knobs.slice() });
  },

  // what knob i says at v, where it is unless given, as saloon's sim's
  // sliders do: its name, and the end's name past 0.9 either way, tine for
  // the instrument at 0, and else the number, signed, to two places
  say(i, v = this.knobs[i]) {
    const ends = this.ENDS[i];
    const word = v < -0.905 ? ends[0] : v > 0.905 ? ends[2] : i === 0 && Math.abs(v) < 0.005 ? ends[1] : (v < 0 ? '-' : '+') + Math.abs(v).toFixed(2);
    return this.NAMES[i] + ' ' + word;
  },
};
Piano.knobs = Piano.KNOBS.slice();
