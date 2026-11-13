// --- the monk ------------------------------------------------------------------
// monk mouth in personal work sings: a face the voice moves (js/moon.js),
// and a ribbon under it. a press on the ribbon sings a note, the ribbon's
// length cut into DEGREES degrees of the page's scale (js/scale.js) up
// from its root, the scale monk mouth's settings set and the piano plays
// in too, and each
// attack and each note it moves to sings a fresh syllable, a consonant and
// a vowel drawn at random. it is moon_man's ribbon (its scene_sing): a
// fresh press takes the degree whose zone holds the finger; while it
// sings, the degree it holds keeps the finger inside its zone widened by
// HYST of a zone either side, so a finger resting on a boundary never
// chatters, and past that the degree is the one whose zone holds it. a new
// note is glided to, and struck with its syllable once MIN_STRIKE_MS have
// passed since the last strike and it is not the note last struck; a
// crossing inside that waits, and the syllable takes the note the finger
// is on by then. the note is worked out from the scale each frame, so a
// setting changed while a note is held moves it as a crossing does. the
// singer is a second monk_mouth voice beside the bubble's (js/voice.js):
// its own node of the same worklet (js/voice-worklet.js), made from the
// same bytes in the same context, through its own master gain. it is made
// the first frame the ribbon is pressed once that context exists, and
// nothing is sung until its worklet is ready and the context running; a
// press held through that is sung as soon as both are. its node is asked
// for the voice's raw state rather than the mouth, for moon_man's face to
// read (js/voice-worklet.js lays it out); it comes from the worklet as the
// bubble's mouth does, a little before the sound reaches the speaker, and
// waits (coming) until the context's time at the speaker has reached it.
// randomize() draws a wild voice, and the node holds every sample under
// CEILING through the master. the page sets down and calls update() once
// a frame.

const Monk = {
  DEGREES: 8,                    // degrees along the ribbon, the scale's root to its octave
  HYST: 0.15,                    // of a zone, how far the degree being sung holds past its zone either side
  MIN_STRIKE_MS: 90,             // ms, the least time from one syllable to the next
  VEL: 0.8,                      // the note's velocity, its breath
  // the syllables: consonants that strike quickly into a vowel (stops,
  // nasals, liquids, glides) and pure vowels, which hold steady on a note,
  // arpabet phones as the voice takes them
  CONSONANTS: ['B', 'D', 'G', 'M', 'N', 'L', 'R', 'W', 'Y'],
  VOWELS: ['AA', 'AE', 'AH', 'AO', 'EH', 'ER', 'IH', 'IY', 'UW'],
  // who is singing: the engine's own voice and its own tension (js/voice.js
  // has what each setting is), and the glide from note to note, per second,
  // 95% of the way there in 0.4 s
  VOICE: { sections: 22, breathiness: 0, roughness: 0, tension: 0.6, diction: 1, wobble: 0.3, glide: 3 / 0.4 },
  // where randomize() draws each setting, lo .. hi, wide: the tube tiny to
  // huge (the engine takes 2 to 64), the folds shut to nearly a whisper,
  // the growl, the tension's whole range, consonants slurred to crisp, the
  // wobble none to a lot, the glide a slow slide to nearly a jump, the
  // vibrato's speed in hz, its swing in cents and how long a note waits
  // for it, and the lips on every vowel wide open to pursed. the vibrato
  // keeps near the engine's own, 5.5 hz and 25 cents: none to twice its
  // swing, a tremble, never a warble. diction stops at 2: past it, a stop
  // struck mid-note in a big tube clicks at the engine's own clamp
  RANDOM: {
    sections: [4, 60], breathiness: [0, 0.7], roughness: [0, 1], tension: [0, 1], diction: [0.3, 2], wobble: [0, 4],
    glide: [2, 100], vibratoHz: [4, 7], vibratoCents: [0, 50], vibratoOnset: [0, 0.5], lipRound: [-1, 1],
  },
  // the master gain: every syllable on every degree from c3, held and let
  // go, peaks through it at 0.25 to 0.55, where the bubble's lines do
  // (tools/test/monk.test.js prints them); a voice tuned again moves them
  MASTER: 1.9,
  // the most the singer peaks at through the master: its node holds every
  // sample under CEILING / MASTER (js/voice-worklet.js). the voice above
  // never reaches it from c3; higher notes and wild voices do
  CEILING: 0.9,
  MUTE_S: 0.03, // s, the time constant the master gain eases to silence and back by (mute)

  down: null,     // where the finger is on the ribbon, 0 .. 1, or null; the page sets it
  deg: -1,        // the degree being sung, 0 .. DEGREES - 1, or -1
  state: null,    // the voice's raw state as heard by now, a Float32Array, or null in silence
  asked: false,   // the node has been asked for
  node: null,     // the worklet's node, once made
  out: null,      // the master gain, once made
  ready: false,   // the worklet has the voice made
  muted: false,   // the master gain is at 0 or easing there
  busy: false,    // a note has gone to the worklet and is not yet over
  note: 0,        // the midi note being sung
  struck: 0,      // the note last struck with a syllable
  struckAt: 0,    // when, in update()'s ms
  crossed: false, // the note has moved since then
  coming: [],     // the states the worklet has said and are still to be heard: { t, state }, oldest first

  // once a frame, now in ms: the node asked for at the first press, the
  // state heard, and the note sung: struck at a press, moved and struck
  // again as the finger crosses the degrees, let go at the lift
  update(now) {
    if (!this.asked && this.down !== null && Voice.ctx && Voice.loading) this.make();
    if (!this.node) return;
    this.hear();
    if (this.deg < 0) {
      if (this.down !== null && this.ready && Voice.ctx.state === 'running') this.attack(now);
    } else if (this.down !== null) this.sing(now);
    else this.release();
  },

  // the singer's node, made in the voice's context from the same worklet
  // and the same wasm once both have come, saying the voice's raw state,
  // through its own master gain
  make() {
    this.asked = true;
    const win = Voice.win, ctx = Voice.ctx;
    Voice.loading
      .then(([, wasm]) => {
        const node = new win.AudioWorkletNode(ctx, 'voice', {
          numberOfInputs: 0,
          outputChannelCount: [1],
          processorOptions: { wasm, voice: this.VOICE, state: true, ceiling: this.CEILING / this.MASTER },
        });
        const out = ctx.createGain();
        out.gain.value = this.muted ? 0 : this.MASTER;
        node.connect(out);
        out.connect(ctx.destination);
        this.out = out;
        // ready once; after that the state as a note plays, then done: it
        // is over. a done that comes while a note is sung is the last
        // one's, and the note sung plays on
        node.port.onmessage = (e) => {
          const m = e.data;
          if (m === 'ready') this.ready = true;
          else if (m && m.state) this.coming.push(m);
          else if (m === 'done' && this.deg < 0) this.busy = false;
        };
        this.node = node;
      })
      .catch(() => {});
  },

  // the states the speaker has reached by now taken up, the last of them
  // the state; with nothing more to come and no note playing, silence
  hear() {
    const at = Voice.heardAt();
    while (this.coming.length && !(this.coming[0].t > at)) this.state = this.coming.shift().state;
    if (!this.busy && !this.coming.length) this.state = null;
  },

  // a press: the degree whose zone holds the finger, struck with a fresh
  // syllable
  attack(now) {
    this.deg = this.zone(this.down);
    this.note = Scale.midi(this.deg);
    this.struck = this.note;
    this.struckAt = now;
    this.crossed = false;
    this.busy = true;
    this.node.port.postMessage({ type: 'note', midi: this.note, vel: this.VEL, phones: this.syllable() });
  },

  // a press held: the degree the finger is on, glided to when its note is
  // new, and a fresh syllable struck once the floor has passed, on the note
  // as it is by then, unless that is the note last struck
  sing(now) {
    this.deg = this.hold(this.down, this.deg);
    const note = Scale.midi(this.deg);
    if (note !== this.note) {
      this.note = note;
      this.crossed = true;
      this.node.port.postMessage({ type: 'pitch', midi: note });
    }
    if (this.crossed && this.note !== this.struck && now - this.struckAt >= this.MIN_STRIKE_MS) {
      this.struck = this.note;
      this.struckAt = now;
      this.crossed = false;
      this.node.port.postMessage({ type: 'syllable', phones: this.syllable() });
    }
  },

  // the lift: the note let go, its breath falling to nothing
  release() {
    this.deg = -1;
    this.node.port.postMessage({ type: 'off' });
  },

  // the degree whose zone holds pos
  zone(pos) {
    return Math.min(this.DEGREES - 1, Math.max(0, Math.floor(pos * this.DEGREES)));
  },

  // the degree sung, owner, while pos stays inside its zone widened by
  // HYST either side; else the degree whose zone holds pos, a step or a leap
  hold(pos, owner) {
    const w = 1 / this.DEGREES;
    if (pos >= (owner - this.HYST) * w && pos <= (owner + 1 + this.HYST) * w) return owner;
    return this.zone(pos);
  },

  // a consonant and a vowel, at random, as phones
  syllable() {
    const c = this.CONSONANTS[Math.floor(Math.random() * this.CONSONANTS.length)];
    const v = this.VOWELS[Math.floor(Math.random() * this.VOWELS.length)];
    return c + ' ' + v;
  },

  // a new voice, each setting drawn evenly inside its RANDOM, kept as the
  // singer's voice: to the node's next block if it is made, and the node
  // made later is made with it
  randomize() {
    const voice = {};
    for (const k in this.RANDOM) {
      const [lo, hi] = this.RANDOM[k];
      voice[k] = lo + Math.random() * (hi - lo);
    }
    this.VOICE = voice;
    if (this.node) this.node.port.postMessage({ type: 'voice', voice });
  },

  // muted or not: the master gain eased to 0 or back to MASTER by the house
  // approach, MUTE_S its time constant. a singer made muted starts at 0
  mute(on) {
    this.muted = on;
    if (this.out) this.out.gain.setTargetAtTime(on ? 0 : this.MASTER, Voice.ctx.currentTime, this.MUTE_S);
  },
};
