// --- the piano's worklet -----------------------------------------------------
// the audio thread's half of js/piano.js: upright/upright.wasm (built by
// tools/upright-web), saloon's piano over upright's core, rendered 128
// frames a process() call, mono. the wasm's bytes, the five knobs and the
// velocity come in the node's processorOptions: the bytes are compiled and
// instantiated here with no imports, the wasm's constructors run, the knobs
// landed and settled, and then the port says ready. until then the output
// is silent. a strike, a midi note, comes in on the port and waits its
// turn: one goes at the start of a block, and the next no sooner than
// SPACING blocks after it, so a sweep that crosses many keys at once plays
// them one after another, a plink each, rather than piling them into one
// block, which would pass full scale in the rig and be clamped. the wasm
// lets each key go once it has rung.

const SPACING = 7; // blocks, about 20 ms at 44.1 khz: the least time between two strikes

class UprightProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { wasm, knobs, velocity } = options.processorOptions;
    this.up = null;       // the wasm's exports, once made
    this.out = null;      // its block, a view on its memory
    this.velocity = velocity;
    this.strikes = [];    // the notes struck and not yet played, oldest first
    this.wait = 0;        // blocks until the next strike may go
    this.port.onmessage = (e) => this.strikes.push(e.data);
    WebAssembly.instantiate(wasm, {}).then(({ instance }) => {
      const up = instance.exports;
      up._initialize();
      up.upright_init(knobs[0], knobs[1], knobs[2], knobs[3], knobs[4]);
      this.up = up;
      this.port.postMessage('ready');
    });
  }

  process(inputs, outputs) {
    const up = this.up;
    if (!up) return true;
    if (this.wait > 0) this.wait--;
    if (this.wait === 0 && this.strikes.length) {
      up.upright_strike(this.strikes.shift(), this.velocity);
      this.wait = SPACING;
    }
    const at = up.upright_render();
    // made again if the wasm's memory has grown, which leaves the old view
    // on a buffer of nothing
    if (!this.out || this.out.buffer !== up.memory.buffer) this.out = new Float32Array(up.memory.buffer, at, 128);
    outputs[0][0].set(this.out);
    return true;
  }
}

registerProcessor('upright', UprightProcessor);
