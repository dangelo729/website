// --- the piano ---------------------------------------------------------------
// the name across the top of index.html as a row of piano keys, a note a
// letter, played on upright, the physically modelled piano, exactly as
// saloon plays it at five knobs of its own: saloon's twin of its piano rig
// over upright's core, built by tools/upright-web into upright/upright.wasm,
// runs live in an audio worklet (js/piano-worklet.js) at upright's 44.1
// khz, mono, through one master gain. a browser holds sound back until the
// visitor's first gesture, so nothing is made before one: the first
// pointerdown, pointerup, touchend, click or keydown makes the audio context
// inside its handler, a press among them so that a drag that feeds the
// bubble (index.html) is heard, and a touch's end wakes it, as ios wants;
// it loads the worklet and fetches the wasm, whose
// bytes go to the worklet to be compiled there; any gesture wakes the
// context if it is not running. a key is only ever struck: it rings its
// plink out and the wasm lets it go once it has rung. a strike before the
// worklet is ready, or while the context is not running, is silent, never
// queued.

const Piano = {
  // c lydian up from c4, one per letter of the name, p to o
  NOTES: [60, 62, 64, 66, 67, 69, 71, 72, 74, 76, 78, 79, 81],
  // saloon's five knobs in its order, each -1 .. 1: instrument (string,
  // tine, reed), tone (dark, bright), size (toy, hall), detune (one, wide),
  // damper (heavy, light)
  KNOBS: [0.73, -1, -0.59, 0.55, -0.76],
  VELOCITY: 100, // every strike's, saloon's default
  // the master gain: a key alone peaks through it at 0.46 at most, and
  // sweeps along the name, keys 20 to 100 ms apart, at 0.75
  // (tools/upright-web's make measure measures it); the worklet never
  // strikes two keys closer than 20 ms, so nothing louder reaches it
  MASTER: 1.25,
  MUTE_S: 0.03, // s, the time constant the master gain eases to silence and back by (mute)
  WORKLET: 'js/piano-worklet.js',
  WASM: 'upright/upright.wasm',

  ctx: null,     // the audio context, made on the first gesture
  node: null,    // the worklet's node, once loaded
  out: null,     // the master gain, once loaded
  ready: false,  // the worklet has the piano made
  muted: false,  // the master gain is at 0 or easing there

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
      Promise.all([ctx.audioWorklet.addModule(this.WORKLET), win.fetch(this.WASM).then((r) => r.arrayBuffer())])
        .then(([, wasm]) => {
          const node = new win.AudioWorkletNode(ctx, 'upright', {
            numberOfInputs: 0,
            outputChannelCount: [1],
            processorOptions: { wasm, knobs: this.KNOBS, velocity: this.VELOCITY },
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

  // letter i's key struck; nothing until the worklet is ready, nor while
  // the context is not running, which would hold the strike and sound it
  // when it wakes
  strike(i) {
    if (!this.ready || this.ctx.state !== 'running') return;
    this.node.port.postMessage(this.NOTES[i]);
  },
};
