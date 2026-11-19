// --- the clack's worklet -------------------------------------------------------
// the audio thread's half of js/clack.js: chebble/chessboard.wasm, the
// chessboard engine, rendered 128 frames a process() call, mono. the
// wasm's bytes come in the node's processorOptions: they are compiled and
// instantiated here with no imports, the wasm's constructors run, the
// engine's set made at the context's rate, and then the port says ready.
// until then the output is silent, and what comes in on the port is
// dropped. after it, what comes in is a step's words, { words, at }: words
// a Float32Array of whole records, RECORD floats each, the last but one of
// them the record's delay, and at the page's audio clock as it posted
// them. each process() takes every batch waiting, oldest first: its
// records are written into the engine's own, a run of no more than it
// holds at a time, and said, each to sound its delay after at, which is
// at less this block's time on from this block's top. then the block is
// rendered.

const RECORD = 16; // floats a record

class ClackProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { wasm } = options.processorOptions;
    this.cb = null;     // the wasm's exports, once made
    this.most = 0;      // the records its buffer holds
    this.words = null;  // its records, a view on its memory
    this.out = null;    // its block, a view on its memory
    this.waiting = [];  // the batches come and not yet said, oldest first
    this.port.onmessage = (e) => { if (this.cb) this.waiting.push(e.data); };
    WebAssembly.instantiate(wasm, {}).then(({ instance }) => {
      const cb = instance.exports;
      cb._initialize();
      cb.chessboard_init(sampleRate);
      this.most = cb.chessboard_most();
      this.cb = cb;
      this.port.postMessage('ready');
    });
  }

  process(inputs, outputs) {
    const cb = this.cb;
    if (!cb) return true;
    for (let i = 0; i < this.waiting.length; i++) {
      const { words, at } = this.waiting[i], n = Math.floor(words.length / RECORD);
      for (let from = 0; from < n; from += this.most) {
        const run = Math.min(this.most, n - from);
        // made again if the wasm's memory has grown, which leaves the old
        // view on a buffer of nothing
        if (!this.words || this.words.buffer !== cb.memory.buffer) this.words = new Float32Array(cb.memory.buffer, cb.chessboard_words(), this.most * RECORD);
        this.words.set(words.subarray(from * RECORD, (from + run) * RECORD));
        cb.chessboard_say(run, at - currentTime);
      }
    }
    this.waiting.length = 0;
    const at = cb.chessboard_render();
    if (!this.out || this.out.buffer !== cb.memory.buffer) this.out = new Float32Array(cb.memory.buffer, at, 128);
    outputs[0][0].set(this.out);
    return true;
  }
}

registerProcessor('clack', ClackProcessor);
