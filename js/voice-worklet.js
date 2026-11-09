// --- the voice's worklet ------------------------------------------------------
// the audio thread's half of js/voice.js: monk_mouth/monk_mouth.wasm (built
// by tools/monk_mouth-web), one voice of monk_mouth, rendered 128 frames a
// process() call, mono. the wasm's bytes and the voice come in the node's
// processorOptions: the bytes are compiled and instantiated here with no
// imports, the voice made at its size and set, a second of silent blocks
// lets its tension land, and then the port says ready. until then the
// output is silent. what comes in on the port waits for the top of the
// next block: the voice set again, or a line, its phones spoken by the
// engine, notes and breath and all. one line at a time: as it plays the
// port says how many of its syllables have begun ({ t, heard }) each time
// one more has, and the mouth as the voice has it ({ t, mouth }) every
// MOUTH_EVERY blocks, t the context's time of the block, and once it is
// over, its breath fallen to nothing, done; a line the engine would not
// take says bad at once.

const RATE = 44100;                  // the wasm's rate, and the context's
const FRAMES = 128;                  // a block
const SETTLE = Math.ceil(RATE / FRAMES); // blocks, a second: the tension lands from the engine's 0.6
const TEXT = 256;                    // the wasm's text buffer, its nul included
const MOUTH_EVERY = 3;               // blocks between the mouth's readings: 8.7 ms

class VoiceProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { wasm, voice } = options.processorOptions;
    this.mm = null;       // the wasm's exports, once made
    this.out = null;      // its block, a view on its memory
    this.waiting = [];    // what came in on the port, oldest first
    this.playing = false; // a line is playing
    this.heard = 0;       // its syllables begun, as last said on the port
    this.blocks = 0;      // blocks it has played
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
  // and the wobble
  set(voice) {
    const mm = this.mm;
    mm.voice_sections(voice.sections);
    mm.voice_tune(0, voice.breathiness);
    mm.voice_tune(1, voice.roughness);
    mm.voice_tune(2, voice.diction);
    mm.voice_tenseness(voice.tension);
    mm.voice_wobble(voice.wobble);
  }

  // phones into the wasm's text buffer, ascii, cut to fit
  text(phones) {
    const bytes = new Uint8Array(this.mm.memory.buffer, this.mm.voice_text(), TEXT);
    const n = Math.min(phones.length, TEXT - 1);
    for (let i = 0; i < n; i++) bytes[i] = phones.charCodeAt(i) & 0x7f;
    bytes[n] = 0;
  }

  // a message from the port: the voice set, or a line spoken unless one
  // is playing
  take(m) {
    if (m.type === 'voice') return this.set(m.voice);
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
    outputs[0][0].set(this.out);
    if (this.playing && mm.voice_heard() !== this.heard) {
      this.heard = mm.voice_heard();
      this.port.postMessage({ t: currentTime, heard: this.heard });
    }
    if (this.playing && ++this.blocks % MOUTH_EVERY === 0) {
      const v = new Float32Array(mm.memory.buffer, mm.voice_mouth(), 6);
      this.port.postMessage({ t: currentTime, mouth: { voicing: v[0], hiss: v[1], lips: v[2], front: v[3], lipMin: v[4], l: v[5] } });
    }
    if (this.playing && !mm.voice_busy()) {
      this.playing = false;
      this.port.postMessage('done');
    }
    return true;
  }
}

registerProcessor('voice', VoiceProcessor);
