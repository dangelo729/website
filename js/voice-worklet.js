// --- the voice's worklet ------------------------------------------------------
// the audio thread's half of js/voice.js: monk_mouth/monk_mouth.wasm (built
// by tools/monk_mouth-web), one voice of monk_mouth, rendered 128 frames a
// process() call, mono. the wasm's bytes and the voice come in the node's
// processorOptions: the bytes are compiled and instantiated here with no
// imports, the voice made at its size and set, a second of silent blocks
// lets its tension land, and then the port says ready. until then the
// output is silent. what comes in on the port waits for the top of the
// next block: the voice set again; a line, its phones spoken by the
// engine, notes and breath and all; or a note sung (js/monk.js), struck
// with a syllable, moved to other notes, a fresh syllable sung on it, and
// let go. one line at a time: as it plays the port says how many of its
// syllables have begun ({ t, heard }) each time one more has. as a line or
// a note plays the port says the mouth as the voice has it ({ t, mouth })
// every MOUTH_EVERY blocks, t the context's time of the block, or, for a
// node made with state in its processorOptions, the voice's raw state
// ({ t, state }): a Float32Array of its own, STATE floats and then the
// tube's diameters, as tools/monk_mouth-web's voice_state() lays them out.
// once it is over, its breath fallen to nothing, the port says done; a line
// the engine would not take says bad at once. a node made with a ceiling in
// its processorOptions plays every block a block late, held under the
// ceiling (limit), and its t are a block later to match.

const RATE = 44100;                  // the wasm's rate, and the context's
const FRAMES = 128;                  // a block
const SETTLE = Math.ceil(RATE / FRAMES); // blocks, a second: the tension lands from the engine's 0.6
const TEXT = 256;                    // the wasm's text buffer, its nul included
const MOUTH_EVERY = 3;               // blocks between the mouth's readings: 8.7 ms
const STATE = 11;                    // the raw state's floats before the tube, the tube's length the last of them
const RELEASE_S = 0.1;               // s, the time constant a ceiling's gain eases back toward 1 by
const RELEASE = 1 - Math.exp(-FRAMES / RATE / RELEASE_S); // that, a block's worth

class VoiceProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { wasm, voice, state, ceiling } = options.processorOptions;
    this.state = !!state; // the port says the voice's raw state rather than the mouth
    this.mm = null;       // the wasm's exports, once made
    this.out = null;      // its block, a view on its memory
    this.waiting = [];    // what came in on the port, oldest first
    this.playing = false; // a line is playing
    this.heard = 0;       // its syllables begun, as last said on the port
    this.blocks = 0;      // blocks it has played
    this.ceiling = ceiling || 0;          // the most any sample played may be, or 0 for none
    this.lag = this.ceiling ? FRAMES / RATE : 0; // s, how late a block is played
    this.late = new Float32Array(FRAMES); // under a ceiling, the block before, played now
    this.latePeak = 0;                    // its peak
    this.gain = 1;                        // the gain it was played at by its end
    this.port.onmessage = (e) => this.waiting.push(e.data);
    WebAssembly.instantiate(wasm, {}).then(({ instance }) => {
      const mm = instance.exports;
      if (mm._initialize) mm._initialize();
      mm.voice_init(voice.sections, 1);
      this.mm = mm;
      this.set(voice);
      for (let i = 0; i < SETTLE; i++) mm.voice_render();
      this.port.postMessage('ready');
    });
  }

  // who is speaking: the size, the three fields of the tuning, the tension
  // and the wobble, and where the voice has them, the glide from note to
  // note, the vibrato (its speed in hz, its swing in cents and how long a
  // note waits for it) and how the lips hold every vowel
  set(voice) {
    const mm = this.mm;
    mm.voice_sections(voice.sections);
    mm.voice_tune(0, voice.breathiness);
    mm.voice_tune(1, voice.roughness);
    mm.voice_tune(2, voice.diction);
    mm.voice_tenseness(voice.tension);
    mm.voice_wobble(voice.wobble);
    if (voice.glide !== undefined) mm.voice_glide(voice.glide);
    if (voice.vibratoHz !== undefined) mm.voice_vibrato(voice.vibratoHz, voice.vibratoCents, voice.vibratoOnset);
    if (voice.lipRound !== undefined) mm.voice_tune(3, voice.lipRound);
  }

  // phones into the wasm's text buffer, ascii, cut to fit
  text(phones) {
    const bytes = new Uint8Array(this.mm.memory.buffer, this.mm.voice_text(), TEXT);
    const n = Math.min(phones.length, TEXT - 1);
    for (let i = 0; i < n; i++) bytes[i] = phones.charCodeAt(i) & 0x7f;
    bytes[n] = 0;
  }

  // a message from the port: the voice set; a note struck at a velocity
  // with its syllable, playing from then; the note moved; a fresh syllable
  // sung on it; the note let go; or a line spoken unless one is playing
  take(m) {
    const mm = this.mm;
    if (m.type === 'voice') return this.set(m.voice);
    if (m.type === 'note') {
      mm.voice_note_on(m.midi, m.vel);
      this.text(m.phones);
      mm.voice_syllable();
      this.playing = true;
      this.blocks = 0;
      return;
    }
    if (m.type === 'pitch') return mm.voice_pitch(m.midi);
    if (m.type === 'syllable') {
      this.text(m.phones);
      mm.voice_syllable();
      return;
    }
    if (m.type === 'off') return mm.voice_note_off();
    if (this.playing) return;
    this.text(m.phones);
    if (this.mm.voice_speak(m.midi, m.range, m.speed, m.breath)) {
      this.playing = true;
      this.heard = 0;
      this.blocks = 0;
    } else this.port.postMessage('bad');
  }

  process(inputs, outputs) {
    const mm = this.mm;
    if (!mm) return true;
    while (this.waiting.length) this.take(this.waiting.shift());
    const at = mm.voice_render();
    // made again if the wasm's memory has grown, which leaves the old view
    // on a buffer of nothing
    if (!this.out || this.out.buffer !== mm.memory.buffer) this.out = new Float32Array(mm.memory.buffer, at, FRAMES);
    if (this.ceiling) this.limit(outputs[0][0]);
    else outputs[0][0].set(this.out);
    const t = currentTime + this.lag;
    if (this.playing && mm.voice_heard() !== this.heard) {
      this.heard = mm.voice_heard();
      this.port.postMessage({ t, heard: this.heard });
    }
    // every MOUTH_EVERY blocks the mouth, or the raw state copied out of
    // the wasm's memory, its tube as long as its length says, so what goes
    // on the port is its own few floats
    if (this.playing && ++this.blocks % MOUTH_EVERY === 0) {
      if (this.state) {
        const f = new Float32Array(mm.memory.buffer), at = mm.voice_state() >> 2;
        this.port.postMessage({ t, state: f.slice(at, at + STATE + f[at + STATE - 1]) });
      } else {
        const v = new Float32Array(mm.memory.buffer, mm.voice_mouth(), 6);
        this.port.postMessage({ t, mouth: { voicing: v[0], hiss: v[1], lips: v[2], front: v[3], lipMin: v[4], l: v[5] } });
      }
    }
    if (this.playing && !mm.voice_busy()) {
      this.playing = false;
      this.port.postMessage('done');
    }
    return true;
  }

  // under a ceiling: the block before played into out now, a block late, so
  // its gain sees this one coming. the gain it ends on eases back toward 1
  // by the house approach, RELEASE_S its time constant, but no further than
  // keeps both it and this block under the ceiling; across it the gain runs
  // straight from the one it began on, which kept it under too, so no
  // sample passes the ceiling and the gain never steps
  limit(out) {
    const now = this.out, late = this.late;
    let peak = 0;
    for (let i = 0; i < FRAMES; i++) {
      const a = Math.abs(now[i]);
      if (a > peak) peak = a;
    }
    const top = Math.max(peak, this.latePeak);
    let gain = this.gain + (1 - this.gain) * RELEASE;
    if (top * gain > this.ceiling) gain = this.ceiling / top;
    const from = this.gain, step = (gain - from) / FRAMES;
    for (let i = 0; i < FRAMES; i++) out[i] = late[i] * (from + step * (i + 1));
    this.gain = gain;
    late.set(now);
    this.latePeak = peak;
  }
}

registerProcessor('voice', VoiceProcessor);
