// --- the scrubber's worklet ------------------------------------------------------
// the audio thread's half of js/scrub.js: scrub/scrub.wasm (built by
// tools/scrub-web), the scrubber's core, rendered 128 frames a process()
// call, mono. the wasm's bytes and the playhead's catch come in the node's
// processorOptions: the bytes are compiled and instantiated here, told
// only when the wasm's memory grows, the wasm's constructors run, the
// core made at the context's rate, and then the port says { ready }.
// until then the output is silent and what comes in on the port is
// dropped. after it, what comes in is the sound, { sound }, an Int16Array
// of its samples, written into room the wasm makes for it, the port
// saying { loaded } once it is in, or that it is not; where the sound is
// wanted, { target }, seconds in; how fast that moves on, { speed }, 1
// playing and 0 standing; the sound put somewhere at rest, { cut },
// seconds in; and the playhead's catch, { seconds }. each of target and
// cut may come with a count, { n }, said back with what the port says
// from then on. every EVERY blocks, if anything has changed since it last
// said, the port says where the sound is heard and where it is wanted,
// seconds in, how fast the playhead is going, of the sound as recorded,
// whether it steps with its target, and the last count it was given:
// { at, aim, going, locked, n }.

const EVERY = 3; // blocks between what it says to the page: about 9 ms at 44.1 khz

class ScrubProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { wasm, seconds } = options.processorOptions;
    this.sc = null;      // the wasm's exports, once made
    this.out = null;     // its block, a view on its memory
    this.left = 0;       // blocks until it next says where it is
    this.n = 0;          // the last count it was given
    this.said = [0, 0, false]; // where it was heard and wanted and whether it was locked, as it last said
    this.port.onmessage = (e) => { if (this.sc) this.hear(e.data); };
    WebAssembly.instantiate(wasm, { env: { emscripten_notify_memory_growth() {} } }).then(({ instance }) => {
      const sc = instance.exports;
      sc._initialize();
      sc.scrub_init(sampleRate, seconds);
      this.sc = sc;
      this.port.postMessage({ ready: true });
    });
  }

  // what came in on the port, done
  hear(m) {
    const sc = this.sc;
    if (m.n !== undefined) this.n = m.n;
    if (m.sound) {
      const at = sc.scrub_sound(m.sound.length);
      if (at) new Int16Array(sc.memory.buffer, at, m.sound.length).set(m.sound);
      this.port.postMessage({ loaded: at !== 0 });
    }
    else if (m.target !== undefined) sc.scrub_target(m.target);
    else if (m.speed !== undefined) sc.scrub_speed(m.speed);
    else if (m.cut !== undefined) sc.scrub_cut(m.cut);
    else if (m.seconds !== undefined) sc.scrub_catch(m.seconds);
  }

  process(inputs, outputs) {
    const sc = this.sc;
    if (!sc) return true;
    const at = sc.scrub_render();
    // made again if the wasm's memory has grown, which leaves the old view
    // on a buffer of nothing
    if (!this.out || this.out.buffer !== sc.memory.buffer) this.out = new Float32Array(sc.memory.buffer, at, 128);
    outputs[0][0].set(this.out);
    if (--this.left > 0) return true;
    this.left = EVERY;
    const heard = sc.scrub_playhead(), aim = sc.scrub_aim(), locked = sc.scrub_locked() === 1, s = this.said;
    if (heard === s[0] && aim === s[1] && locked === s[2]) return true;
    s[0] = heard;
    s[1] = aim;
    s[2] = locked;
    this.port.postMessage({ at: heard, aim, going: sc.scrub_going(), locked, n: this.n });
    return true;
  }
}

registerProcessor('scrub', ScrubProcessor);
