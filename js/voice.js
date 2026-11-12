// --- the voice -----------------------------------------------------------------
// the bubble in personal work complains out loud when it is taken hold of,
// a moment after it eats a bubble thanks whoever fed it, and when the
// pointer's string keeps snapping tells them to drag slower: a short line
// each time, said by monk_mouth, the articulatory voice, air
// through a tube shaped like a vocal tract, so that every sound is a mouth
// moving and nothing is recorded. its core, built by tools/monk_mouth-web
// into monk_mouth/monk_mouth.wasm, runs live in an audio worklet
// (js/voice-worklet.js) at 44.1 khz, mono, through one master gain, in a
// context of its own beside the piano's (js/piano.js). as the piano's, the
// audio is made inside the handler of the visitor's first gesture, a press
// among them, since a grab is one, and any gesture wakes the context if it
// is not running. the worklet and the wasm are asked of the server every
// time, never taken from the browser's cache, so they are always its
// current pair, made for this script. a grab plays one of the lines at
// random, a meal one of the thanks THANK_MS later, and neither plays while
// a line is still playing. what is being said is kept for the subtitles
// (index.html) and the face (js/face.js): the line, how many of its
// syllables have begun, the mouth as the voice has it, and when it ended.
// the worklet says each of them as it makes the sound, a little before
// the sound reaches the speaker, so they wait (coming) until the context's
// time at the speaker has reached theirs, and update() takes them up. a
// grab that comes before the worklet is ready or while the context is not
// running, as the first one does, since it is what makes the audio, has
// its line held until both are, and dropped if that takes longer than
// HOLD. who speaks and what they say are plain data below,
// tuned by ear on tools/voice/; the shop (index.html) sells a new voice
// drawn at random.

const Voice = {
  // who is speaking: its size in sections (22 is the engine's adult, 16 a
  // small throat), breathiness (how open the folds sit), roughness (every
  // other pulse weaker, an octave under the note, heard as growl), tension
  // (breathy 0 .. pressed 1), diction (consonants crisp above 1, lazy
  // under) and wobble (the drift that keeps a held note alive)
  VOICE: { sections: 33, breathiness: 0.05, roughness: 0.75, tension: 0.75, diction: 1, wobble: 1.2 },
  // where randomize() draws each of them, lo .. hi: moon_man's own draws
  // on its size, breath and rasp knobs, and wider; every line stays inside
  // full scale through the master anywhere in them
  RANDOM: { sections: [14, 44], breathiness: [0, 0.4], roughness: [0, 1], tension: [0.3, 0.9], diction: [0.6, 1.6], wobble: [0, 2] },
  // what it says when taken hold of: arpabet phones, stress digits on the
  // vowels and a / at each word's end, spoken on a baseline midi note, an
  // accented syllable lifted range semitones over it, at a speed (1
  // conversational) and a breath, the loudness of its stressed syllables;
  // and its text, the subtitle, a syllable for each vowel, split by the
  // spaces between words and a | inside one (js/subtitle.js)
  LINES: [
    { phones: 'S T AA1 P / DH AE2 T', midi: 63, range: 5, speed: 0.8, breath: 0.8, text: 'Stop that' },
    { phones: 'K W IH1 T / IH0 T', midi: 63, range: 5, speed: 0.8, breath: 0.8, text: 'Quit it' },
    { phones: 'AW1 CH', midi: 63, range: 5, speed: 0.8, breath: 0.8, text: 'Ouch' },
  ],
  // what it says once it has eaten, the same way
  THANKS: [
    { phones: 'TH AE1 NG K / Y UW0', midi: 65, range: 6, speed: 0.8, breath: 0.8, text: 'Thank you' },
    { phones: 'N AY1 S', midi: 65, range: 6, speed: 0.8, breath: 0.8, text: 'Nice' },
    { phones: 'DH AE2 T S / W AH0 T / AY0 M / T AO1 K IH0 NG / AH0 B AW2 T', midi: 65, range: 6, speed: 0.8, breath: 0.8, text: "That's what I'm talk|ing a|bout" },
    { phones: 'G UH2 D / S T AH1 F', midi: 65, range: 6, speed: 0.8, breath: 0.8, text: 'Good stuff' },
    { phones: 'B AH1 B AH0 L / T AY2 M', midi: 65, range: 6, speed: 0.8, breath: 0.8, text: 'Bub|ble time' },
    { phones: 'B AH2 B IH0 L IH1 SH AH0 S', midi: 65, range: 6, speed: 0.8, breath: 0.8, text: 'Bub|bi|li|cious' },
  ],
  // what it says when it is dragged too fast, the same way
  SLOWER: [
    { phones: 'Y UH0 R / D R AE2 G IH0 NG / T UW2 / F AE1 S T', midi: 63, range: 5, speed: 0.8, breath: 0.8, text: "You're drag|ging too fast" },
    { phones: 'D R AE2 G / S L OW1 ER0 / B AH2 B AH0 L B R EY2 N', midi: 63, range: 5, speed: 0.8, breath: 0.8, text: 'Drag slow|er bub|ble|brain' },
  ],
  THANK_MS: 500, // from the meal to its thanks
  // the master gain: the lines and the thanks above, at the voice above,
  // peak through it at 0.18 to 0.56, each played many times in random
  // order with gaps between them as grabs come (tools/test/voice.test.js
  // prints each one's peak); a voice or a sound tuned again moves them
  MASTER: 1.5,
  MUTE_S: 0.03, // s, the time constant the master gain eases to silence and back by (mute)
  // ms a grab's line is held for the worklet to be ready and the context
  // running; past it the line is dropped, too late to answer its grab
  HOLD: 1000,
  WORKLET: 'js/voice-worklet.js',
  WASM: 'monk_mouth/monk_mouth.wasm',

  ctx: null,     // the audio context, made on the first gesture
  node: null,    // the worklet's node, once loaded
  out: null,     // the master gain, once loaded
  ready: false,  // the worklet has the voice made
  muted: false,  // the master gain is at 0 or easing there
  busy: false,   // a sound has gone to the worklet and is not yet over
  held: null,    // a line waiting for the voice: { line, at }, at in ms
  due: null,     // a line waiting for the one playing to be over, or null
  said: 0,       // how many lines have gone to the worklet
  line: null,    // the last of them, null if the engine would not take it
  heard: 0,      // how many of its syllables have begun, as heard by now
  mouth: null,   // the mouth as heard by now (js/mouth.js), or null in silence
  coming: [],    // what the worklet has said and is still to be heard: { t, heard } and { t, mouth }, oldest first
  endedAt: null, // when it ended, Date.now()'s ms, or null while it plays
  win: null,     // the window the audio was made in
  loading: null, // the worklet loaded and the wasm fetched, a promise of both, for every node made in the context

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
      this.win = win;
      const ctx = new win.AudioContext({ sampleRate: 44100 });
      this.ctx = ctx;
      // the worklet by a query no cache has seen, the wasm checked with the
      // server before any copy is used
      const fresh = '?' + Date.now();
      this.loading = Promise.all([ctx.audioWorklet.addModule(this.WORKLET + fresh), win.fetch(this.WASM, { cache: 'no-cache' }).then((r) => r.arrayBuffer())]);
      this.loading
        .then(([, wasm]) => {
          const node = new win.AudioWorkletNode(ctx, 'voice', {
            numberOfInputs: 0,
            outputChannelCount: [1],
            processorOptions: { wasm, voice: this.VOICE },
          });
          const out = ctx.createGain();
          out.gain.value = this.muted ? 0 : this.MASTER;
          node.connect(out);
          out.connect(ctx.destination);
          this.out = out;
          // ready once; after that, a line's syllables as they begin, then
          // done or bad: the line is over
          node.port.onmessage = (e) => {
            const m = e.data;
            if (m === 'ready') { this.ready = true; this.flush(); }
            else if (m && m.t !== undefined) this.coming.push(m);
            else {
              this.busy = false;
              if (m === 'bad') this.line = null;
              else this.endedAt = Date.now();
            }
          };
          this.node = node;
        })
        .catch(() => {});
    }
    if (this.ctx.state !== 'running') this.ctx.resume().then(() => this.flush(), () => {});
  },

  // muted or not: the master gain eased to 0 or back to MASTER by the house
  // approach, MUTE_S its time constant. a voice made muted starts at 0; it
  // still speaks, so its lines and their subtitles go on unheard
  mute(on) {
    this.muted = on;
    if (this.out) this.out.gain.setTargetAtTime(on ? 0 : this.MASTER, this.ctx.currentTime, this.MUTE_S);
  },

  // the bubble taken hold of: one of the lines, at random
  complain() {
    this.say(this.LINES[Math.floor(Math.random() * this.LINES.length)]);
  },

  // the bubble fed: one of the thanks, at random, THANK_MS later
  thank() {
    const line = this.THANKS[Math.floor(Math.random() * this.THANKS.length)];
    setTimeout(() => this.say(line), this.THANK_MS);
  },

  // the bubble dragged too fast: one of SLOWER, at random, said once
  // whatever is playing is over and heard (update)
  slower() {
    this.due = this.SLOWER[Math.floor(Math.random() * this.SLOWER.length)];
  },

  // a line spoken: to the worklet; nothing before a gesture or while a line
  // is still playing, and held until the worklet is ready and the context
  // running
  say(line) {
    if (!this.ctx || this.busy) return;
    if (!this.ready || this.ctx.state !== 'running') {
      this.held = { line, at: Date.now() };
      return;
    }
    this.held = null;
    this.busy = true;
    this.said++;
    this.line = line;
    this.heard = 0;
    this.mouth = null;
    this.coming = [];
    this.endedAt = null;
    this.node.port.postMessage({ type: 'line', phones: line.phones, midi: line.midi, range: line.range, speed: line.speed, breath: line.breath });
  },

  // the held line said once the worklet is ready and the context running,
  // unless it has waited longer than HOLD
  flush() {
    const held = this.held;
    if (!held || !this.ready || this.ctx.state !== 'running') return;
    this.held = null;
    if (Date.now() - held.at <= this.HOLD) this.say(held.line);
  },

  // once a frame: whatever has come from the worklet that the speaker has
  // reached by now is heard, the syllables begun and the mouth; with
  // nothing more to come and no line playing, the mouth is in silence and
  // a line that was due is said
  update() {
    if (!this.ctx) return;
    const now = this.heardAt();
    while (this.coming.length && !(this.coming[0].t > now)) {
      const m = this.coming.shift();
      if (m.heard !== undefined) this.heard = m.heard;
      if (m.mouth) this.mouth = m.mouth;
    }
    if (!this.busy && !this.coming.length) {
      this.mouth = null;
      if (this.due) {
        const line = this.due;
        this.due = null;
        this.say(line);
      }
    }
  },

  // the context's time at the speaker now: the output's own timestamp,
  // carried on to this moment, where the browser gives one, else the
  // context's time less the latencies it owns to
  heardAt() {
    const ctx = this.ctx, perf = this.win && this.win.performance;
    const s = ctx.getOutputTimestamp && perf ? ctx.getOutputTimestamp() : null;
    if (s && s.contextTime > 0 && s.performanceTime > 0) return s.contextTime + (perf.now() - s.performanceTime) / 1000;
    return ctx.currentTime - (ctx.baseLatency || 0) - (ctx.outputLatency || 0);
  },

  // who is speaking, set again: it goes with the node when it is made, and
  // to the worklet's next block once it is
  set(voice) {
    this.VOICE = voice;
    if (this.node) this.node.port.postMessage({ type: 'voice', voice });
  },

  // a new voice, each setting drawn evenly inside its RANDOM, and set
  randomize() {
    const voice = {};
    for (const k in this.RANDOM) {
      const [lo, hi] = this.RANDOM[k];
      voice[k] = lo + Math.random() * (hi - lo);
    }
    this.set(voice);
  },
};
