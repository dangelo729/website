// node tools/test/piano.test.js
//
// loads js/scale.js and js/piano.js the way the page does, classic
// scripts, in one vm context, and hands the piano a fake window: its
// listeners are recorded, its AudioContext counts what is made, its
// worklet node records its options and every message posted to it, and
// its fetch and addModule answer at once. checks the keys, that nothing
// is made before a gesture, that a strike before the worklet is ready or
// while the context sleeps is silent, that a strike sends its degree's
// note in the scale as it is set then and nothing else, and that the
// knobs go to the worklet once. then loads js/piano-worklet.js with the
// real upright/upright.wasm and checks it renders: silent until a strike,
// a strike sounds. exits 1 on failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}

// --- the scripts -------------------------------------------------------------
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'scale.js'), 'utf8'), ctx, { filename: 'js/scale.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'piano.js'), 'utf8'), ctx, { filename: 'js/piano.js' });
const Scale = vm.runInContext('Scale', ctx);
const Piano = vm.runInContext('Piano', ctx);

// --- the fake window -----------------------------------------------------------
const made = { contexts: [], nodes: [], modules: [], fetched: [], posted: [] };
class AudioContext {
  constructor(options) {
    made.contexts.push(options);
    this.state = 'suspended';
    this.destination = {};
    this.audioWorklet = { addModule: (url) => { made.modules.push(url); return Promise.resolve(); } };
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  createGain() { return { gain: { value: 1 }, connect() {} }; }
}
class AudioWorkletNode {
  constructor(context, name, options) {
    this.name = name;
    this.options = options;
    this.port = { onmessage: null, postMessage: (m) => made.posted.push(m) };
    made.nodes.push(this);
  }
  connect() {}
}
const listeners = {};
const win = {
  AudioContext,
  AudioWorkletNode,
  addEventListener(type, fn, capture) { listeners[type] = { fn, capture }; },
  fetch(url) { made.fetched.push(url); return Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }); },
};
const settle = () => new Promise((ok) => setImmediate(ok));

(async () => {
  // --- the keys and the knobs ----------------------------------------------------
  check('thirteen keys, one per letter of the name', Piano.DEGREES === 13, Piano.DEGREES);
  check('five knobs, each in -1 .. 1', Piano.KNOBS.length === 5 && Piano.KNOBS.every((k) => k >= -1 && k <= 1), Piano.KNOBS.join(' '));

  // --- before a gesture ----------------------------------------------------------
  Piano.listen(win);
  const types = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];
  check('listens for every gesture, in capture', types.every((t) => listeners[t] && listeners[t].capture === true), Object.keys(listeners).join(' '));
  Piano.strike(0);
  await settle();
  check('nothing made before a gesture', made.contexts.length === 0 && made.fetched.length === 0 && made.modules.length === 0 && made.posted.length === 0);

  // --- the gesture ---------------------------------------------------------------
  listeners.pointerup.fn();
  check('the first gesture makes one context, at 44.1 khz', made.contexts.length === 1 && made.contexts[0].sampleRate === 44100);
  check('and wakes it', Piano.ctx.state === 'running');
  Piano.strike(0);
  check('a strike before the worklet is loaded is silent', made.posted.length === 0);
  await settle();
  check('the worklet is loaded and the wasm fetched', made.modules[0] === 'js/piano-worklet.js' && made.fetched[0] === 'upright/upright.wasm');
  const node = made.nodes[0];
  check('its node is made, mono', made.nodes.length === 1 && node.name === 'upright' && node.options.outputChannelCount[0] === 1);
  const opts = node && node.options.processorOptions;
  check('the knobs and the wasm go with it', !!opts && opts.wasm instanceof ArrayBuffer && opts.knobs.join() === Piano.KNOBS.join() && opts.velocity === 100);
  Piano.strike(0);
  check('a strike before the worklet is ready is silent', made.posted.length === 0);
  listeners.click.fn();
  await settle();
  check('a later gesture makes nothing more', made.contexts.length === 1 && made.nodes.length === 1 && made.fetched.length === 1);

  // --- strikes -----------------------------------------------------------------
  node.port.onmessage({ data: 'ready' });
  Piano.strike(0);
  Piano.strike(12);
  check('a strike sends its degree\'s note, and nothing else is sent', made.posted.join() === '60,81', made.posted.join());
  made.posted.length = 0;
  for (let d = 0; d < Piano.DEGREES; d++) Piano.strike(d);
  check('its keys in the scale the page starts in: c lydian up from c4', made.posted.join() === '60,62,64,66,67,69,71,72,74,76,78,79,81', made.posted.join());
  made.posted.length = 0;
  Scale.mode = 5;
  Scale.key = 9;
  Scale.octave = 1;
  for (let d = 0; d < Piano.DEGREES; d++) Piano.strike(d);
  check('the scale set again is in the next strike: a aeolian up from a2', made.posted.join() === '45,47,48,50,52,53,55,57,59,60,62,64,65', made.posted.join());
  Scale.mode = 3;
  Scale.key = 0;
  Scale.octave = 3;
  made.posted.length = 0;
  Piano.strike(0);
  Piano.strike(12);
  check('the knobs went once, with the node, never on the port', made.nodes.length === 1 && made.posted.every((m) => typeof m === 'number'));
  Piano.ctx.state = 'interrupted';
  Piano.strike(1);
  check('a strike while the context sleeps is silent', made.posted.length === 2);

  // --- the worklet, with the real wasm -------------------------------------------
  let Processor = null;
  const sent = [];
  class AudioWorkletProcessor { constructor() { this.port = { onmessage: null, postMessage: (m) => sent.push(m) }; } }
  const wctx = vm.createContext({ AudioWorkletProcessor, WebAssembly, Float32Array, registerProcessor: (name, P) => { Processor = P; } });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'piano-worklet.js'), 'utf8'), wctx, { filename: 'js/piano-worklet.js' });
  const wasm = fs.readFileSync(path.join(ROOT, 'upright', 'upright.wasm'));
  const p = new Processor({ processorOptions: { wasm: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.length), knobs: Piano.KNOBS, velocity: Piano.VELOCITY } });
  for (let i = 0; i < 50 && !sent.length; i++) await settle();
  check('the worklet makes the piano and says ready', sent[0] === 'ready', sent.join());
  const out = new Float32Array(128);
  const peakOf = (blocks) => {
    let peak = 0;
    for (let b = 0; b < blocks; b++) {
      p.process([], [[out]]);
      for (const x of out) peak = Math.max(peak, Math.abs(x));
    }
    return peak;
  };
  check('silent until a strike', peakOf(20) === 0);
  p.port.onmessage({ data: 60 });
  const peak = peakOf(100);
  check('a strike sounds, inside full scale', peak > 0.1 && peak < 1, peak.toFixed(3));

  console.log(failures ? failures + ' failed' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
