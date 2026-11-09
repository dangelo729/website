// --- the voice -----------------------------------------------------------------
// the bubble in personal work complains out loud when it is taken hold of:
// a short line, said by monk_mouth, the articulatory voice, air
// through a tube shaped like a vocal tract, so that every sound is a mouth
// moving and nothing is recorded. its core, built by tools/monk_mouth-web
// into monk_mouth/monk_mouth.wasm, runs live in an audio worklet
// (js/voice-worklet.js) at 44.1 khz, mono, through one master gain, in a
// context of its own beside the piano's (js/piano.js). as the piano's, the
// audio is made inside the handler of the visitor's first gesture, a press
// among them, since a grab is one, and any gesture wakes the context if it
// is not running. a grab plays one of the lines at random, and nothing
// while one is still playing. a grab that comes before the worklet is
// ready or while the context is not running, as the first one does, since
// it is what makes the audio, has its line held until both are, and
// dropped if that takes longer than HOLD. who speaks and what they say are
// plain data below, tuned by ear on tools/voice/.

const Voice = {
  // who is speaking: its size in sections (22 is the engine's adult, 16 a
  // small throat), breathiness (how open the folds sit), roughness (every
  // other pulse weaker, an octave under the note, heard as growl), tension
  // (breathy 0 .. pressed 1), diction (consonants crisp above 1, lazy
  // under) and wobble (the drift that keeps a held note alive)
  VOICE: { sections: 26, breathiness: 0.05, roughness: 0.4, tension: 0.75, diction: 1, wobble: 0.3 },
  // what it says: arpabet phones, stress digits on the vowels and a / at
  // each word's end, spoken on a baseline midi note, an accented syllable
  // lifted range semitones over it, at a speed (1 conversational) and a
  // breath, the loudness of its stressed syllables
  LINES: [
    { phones: 'S T AA1 P / DH AE2 T', midi: 43, range: 5, speed: 1.1, breath: 0.8 },
    { phones: 'K W IH1 T / IH0 T', midi: 43, range: 5, speed: 1.1, breath: 0.8 },
    { phones: 'AW1 CH', midi: 43, range: 5, speed: 1.1, breath: 0.8 },
  ],
  // the master gain: the lines above, at the voice above,
  // peak through it at 0.43 to 0.50, each played many times in random
  // order with gaps between them as grabs come (tools/test/voice.test.js
  // prints each one's peak); a voice or a sound tuned again moves them
  MASTER: 2.4,
  // ms a grab's line is held for the worklet to be ready and the context
  // running; past it the line is dropped, too late to answer its grab
  HOLD: 1000,
  WORKLET: 'js/voice-worklet.js',
  WASM: 'monk_mouth/monk_mouth.wasm',

  ctx: null,     // the audio context, made on the first gesture
  node: null,    // the worklet's node, once loaded
  ready: false,  // the worklet has the voice made
  busy: false,   // a sound has gone to the worklet and is not yet over
  held: null,    // a sound waiting for the voice: { sound, at }, at in ms

  // makes the audio on win's first gesture and wakes it on any later one
  listen(win) {
    const wake = () => this.wake(win);
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) win.addEventListener(type, wake, true);
  },

  // the audio context made at the voice's rate, the worklet loaded and the
  // wasm fetched, its node made through the master gain, once; the context
  // resumed whenever it is not running. no worklet, no sound
  wake(win) {
    if (!this.ctx) {
      if (!win.AudioContext || !win.AudioWorkletNode) return;
      const ctx = new win.AudioContext({ sampleRate: 44100 });
      this.ctx = ctx;
      Promise.all([ctx.audioWorklet.addModule(this.WORKLET), win.fetch(this.WASM).then((r) => r.arrayBuffer())])
        .then(([, wasm]) => {
          const node = new win.AudioWorkletNode(ctx, 'voice', {
            numberOfInputs: 0,
            outputChannelCount: [1],
            processorOptions: { wasm, voice: this.VOICE },
          });
          const out = ctx.createGain();
          out.gain.value = this.MASTER;
          node.connect(out);
          out.connect(ctx.destination);
          // ready once; after that, done or bad: the sound is over
          node.port.onmessage = (e) => {
            if (e.data === 'ready') { this.ready = true; this.flush(); }
            else this.busy = false;
          };
          this.node = node;
        })
        .catch(() => {});
    }
    if (this.ctx.state !== 'running') this.ctx.resume().then(() => this.flush(), () => {});
  },

  // the bubble taken hold of: one of the lines, at random
  complain() {
    this.say(this.LINES[Math.floor(Math.random() * this.LINES.length)]);
  },

  // a line spoken
  say(line) {
    this.send({ type: 'line', phones: line.phones, midi: line.midi, range: line.range, speed: line.speed, breath: line.breath });
  },

  // a sound to the worklet; nothing before a gesture or while a sound is
  // still playing, and held until the worklet is ready and the context
  // running
  send(sound) {
    if (!this.ctx || this.busy) return;
    if (!this.ready || this.ctx.state !== 'running') {
      this.held = { sound, at: Date.now() };
      return;
    }
    this.held = null;
    this.busy = true;
    this.node.port.postMessage(sound);
  },

  // the held sound sent once the worklet is ready and the context running,
  // unless it has waited longer than HOLD
  flush() {
    const held = this.held;
    if (!held || !this.ready || this.ctx.state !== 'running') return;
    this.held = null;
    if (Date.now() - held.at <= this.HOLD) this.send(held.sound);
  },

  // who is speaking, set again: it goes with the node when it is made, and
  // to the worklet's next block once it is
  set(voice) {
    this.VOICE = voice;
    if (this.node) this.node.port.postMessage({ type: 'voice', voice });
  },
};
