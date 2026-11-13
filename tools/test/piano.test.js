// node tools/test/piano.test.js
//
// loads js/scale.js and js/piano.js the way the page does, classic
// scripts, in one vm context, and hands the piano a fake window: its
// listeners are recorded, its AudioContext counts what is made, its
// worklet node records its options and every message posted to it, and
// its fetch and addModule answer at once. checks the keys, that nothing
// is made before a gesture, that neither the worklet nor the wasm comes
// from the browser's cache, that a strike before the worklet is ready or
// while the context sleeps is silent, that a strike sends its degree's
// note in the scale as it is set then and nothing else, and that the
// knobs go to the worklet once; then the hand's half: a key pressed and
// let go, the pedal, a knob turned, held to its range and its grid, what
// each knob says, and that a piano made after a knob was turned is made
// with it. then loads js/piano-worklet.js with the real
// upright/upright.wasm and checks it renders: silent until a strike, a
// strike sounds; a key held rings on and let go is damped; the pedal
// holds a key let go; a strike on a held key does not let it go; and
// knobs turned on the port make the piano those knobs make. exits 1 on
// failure.

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
// the scale and the piano, loaded afresh
function load() {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'scale.js'), 'utf8'), ctx, { filename: 'js/scale.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'piano.js'), 'utf8'), ctx, { filename: 'js/piano.js' });
  return { Scale: vm.runInContext('Scale', ctx), Piano: vm.runInContext('Piano', ctx) };
}
const { Scale, Piano } = load();

// --- the fake window -----------------------------------------------------------
const made = { contexts: [], nodes: [], modules: [], fetched: [], fetchedWith: [], posted: [] };
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
  fetch(url, options) { made.fetched.push(url); made.fetchedWith.push(options); return Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }); },
};
const settle = () => new Promise((ok) => setImmediate(ok));

(async () => {
  // --- the keys and the knobs ----------------------------------------------------
  check('thirteen keys, one per letter of the name', Piano.DEGREES === 13, Piano.DEGREES);
  check('five knobs, each in -1 .. 1', Piano.KNOBS.length === 5 && Piano.KNOBS.every((k) => k >= -1 && k <= 1), Piano.KNOBS.join(' '));
  check('the knobs as they stand start as those, a list of their own', Piano.knobs !== Piano.KNOBS && Piano.knobs.join() === Piano.KNOBS.join());
  check('each knob has a name and its three ends\' names', Piano.NAMES.length === 5 && Piano.ENDS.length === 5 && Piano.ENDS.every((e) => e.length === 3));

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
  check('the worklet is loaded and the wasm fetched', /^js\/piano-worklet\.js\?\d+$/.test(made.modules[0]) && made.fetched[0] === 'upright/upright.wasm', made.modules[0]);
  check('neither from the cache: the worklet by a fresh query, the wasm checked with the server', made.fetchedWith[0] && made.fetchedWith[0].cache === 'no-cache');
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
  Piano.press(60, 100);
  check('and so is a key pressed', made.posted.length === 2);
  Piano.ctx.state = 'running';

  // --- the hand ------------------------------------------------------------------
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  made.posted.length = 0;
  Piano.press(61, 64);
  Piano.lift(61);
  Piano.pedal(true);
  Piano.pedal(false);
  check('a key pressed and let go, and the pedal down and up, go to the worklet in order',
    same(made.posted, [{ on: 61, velocity: 64 }, { off: 61 }, { pedal: true }, { pedal: false }]), JSON.stringify(made.posted));
  made.posted.length = 0;
  Piano.turn(2, 0.5);
  const with2 = (v) => Piano.KNOBS.map((k, i) => i === 2 ? v : k); // the page's five, the size turned to v
  check('a knob turned sends the five as they stand', same(made.posted, [{ knobs: with2(0.5) }]) && made.posted[0].knobs !== Piano.knobs, JSON.stringify(made.posted));
  Piano.turn(2, 0.5);
  Piano.turn(2, 0.5004);
  check('a knob turned to where it is sends nothing', made.posted.length === 1);
  Piano.turn(0, 7);
  Piano.turn(1, -7);
  Piano.turn(3, 0.123456);
  Piano.turn(4, -0.004);
  check('a knob is held in -1 .. 1, on a grid of hundredths, and a -0 is a 0',
    same(Piano.knobs, [1, -1, 0.5, 0.12, 0]) && !Object.is(Piano.knobs[4], -0), Piano.knobs.join(' '));
  check('the page\'s knobs are not the ones turned', Piano.KNOBS.join() !== Piano.knobs.join() && Piano.KNOBS[2] !== 0.5, Piano.KNOBS.join(' '));
  check('each knob says its name and its end\'s name past 0.9',
    Piano.say(0) === 'instrument reed' && Piano.say(1) === 'tone dark' && Piano.say(2, -0.91) === 'size toy' && Piano.say(2, 0.95) === 'size hall', [0, 1].map((i) => Piano.say(i)).join(', '));
  check('or else the number, signed, to two places', Piano.say(2) === 'size +0.50' && Piano.say(2, -0.9) === 'size -0.90' && Piano.say(3) === 'detune +0.12' && Piano.say(1, 0) === 'tone +0.00', Piano.say(2));
  check('and the instrument tine at its middle', Piano.say(0, 0) === 'instrument tine');

  // --- a piano made after a knob was turned -----------------------------------------
  {
    const late = load().Piano, count = made.nodes.length;
    late.turn(2, 0.25);
    late.listen(win);
    listeners.pointerup.fn();
    await settle();
    const opts = made.nodes.length === count + 1 && made.nodes[count].options.processorOptions;
    check('a piano made after a knob was turned is made with it', !!opts && opts.knobs.join() === with2(0.25).join(), opts && opts.knobs.join());
  }

  // --- the worklet, with the real wasm -------------------------------------------
  let Processor = null;
  const sent = [];
  class AudioWorkletProcessor { constructor() { this.port = { onmessage: null, postMessage: (m) => sent.push(m) }; } }
  const wctx = vm.createContext({ AudioWorkletProcessor, WebAssembly, Float32Array, registerProcessor: (name, P) => { Processor = P; } });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'piano-worklet.js'), 'utf8'), wctx, { filename: 'js/piano-worklet.js' });
  const wasm = fs.readFileSync(path.join(ROOT, 'upright', 'upright.wasm'));
  // a worklet's processor made with knobs, once it has said ready
  const make = async (knobs) => {
    const before = sent.length;
    const q = new Processor({ processorOptions: { wasm: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.length), knobs, velocity: Piano.VELOCITY } });
    for (let i = 0; i < 50 && sent.length === before; i++) await settle();
    return q;
  };
  const out = new Float32Array(128);
  // the loudest sample of a processor's next blocks
  const peakOf = (q, blocks) => {
    let peak = 0;
    for (let b = 0; b < blocks; b++) {
      q.process([], [[out]]);
      for (const x of out) peak = Math.max(peak, Math.abs(x));
    }
    return peak;
  };
  const SEC = Math.round(44100 / 128); // blocks a second
  const p = await make(Piano.KNOBS);
  check('the worklet makes the piano and says ready', sent[0] === 'ready', sent.join());
  check('silent until a strike', peakOf(p, 20) === 0);
  p.port.onmessage({ data: 60 });
  const peak = peakOf(p, 100);
  check('a strike sounds, inside full scale', peak > 0.1 && peak < 1, peak.toFixed(3));

  // --- the hand, on a grand ------------------------------------------------------------
  // saloon's grand, whose held c4 rings for seconds and whose damper takes a third of one
  const GRAND = [-1, 0, 0, 0, 0];
  const g = await make(GRAND);
  g.port.onmessage({ data: { on: 60, velocity: 100 } });
  const struck = peakOf(g, SEC), ringing = peakOf(g, SEC);
  check('a key held sounds, and rings on while it is held', struck > 0.05 && ringing > 0.1 * struck, struck.toFixed(3) + ' then ' + ringing.toFixed(3));
  g.port.onmessage({ data: { off: 60 } });
  peakOf(g, SEC);
  const damped = peakOf(g, SEC);
  check('let go, its damper lands', damped < 0.01 * struck, damped.toExponential(1));

  const d = await make(GRAND);
  d.port.onmessage({ data: { pedal: true } });
  d.port.onmessage({ data: { on: 60, velocity: 100 } });
  d.port.onmessage({ data: { off: 60 } });
  peakOf(d, SEC);
  const under = peakOf(d, SEC);
  check('a key let go under the pedal rings on', under > 0.1 * struck, under.toFixed(3));
  d.port.onmessage({ data: { pedal: false } });
  peakOf(d, SEC);
  const lifted = peakOf(d, SEC);
  check('and the pedal lifted, its damper lands', lifted < 0.01 * struck, lifted.toExponential(1));

  // a strike rings 0.7 s and is let go; on a key that is held it is not
  const a = await make(GRAND), b = await make(GRAND);
  a.port.onmessage({ data: 60 });
  b.port.onmessage({ data: { on: 60, velocity: 100 } });
  b.port.onmessage({ data: 60 });
  peakOf(a, 2 * SEC);
  peakOf(b, 2 * SEC);
  const alone = peakOf(a, SEC), kept = peakOf(b, SEC);
  check('a strike is let go once it has rung, but not on a key that is held', alone < 0.001 * struck && kept > 0.02 * struck, alone.toExponential(1) + ' against ' + kept.toFixed(3));

  // --- the knobs, turned on the port -----------------------------------------------------
  // two seconds on, the levels have eased to the knobs': the piano is the one made with them
  const WURLI = [1, 0.5, 0.25, -1, 0];
  const turned = await make(GRAND), born = await make(WURLI), grand = await make(GRAND);
  turned.port.onmessage({ data: { knobs: WURLI } });
  for (const q of [turned, born, grand]) {
    peakOf(q, 2 * SEC);
    q.port.onmessage({ data: { on: 60, velocity: 100 } });
  }
  const outA = new Float32Array(128), outB = new Float32Array(128), outC = new Float32Array(128);
  let differ = 0, apart = 0, loud = 0;
  for (let i = 0; i < SEC; i++) {
    turned.process([], [[outA]]);
    born.process([], [[outB]]);
    grand.process([], [[outC]]);
    for (let k = 0; k < 128; k++) {
      differ = Math.max(differ, Math.abs(outA[k] - outB[k]));
      apart = Math.max(apart, Math.abs(outC[k] - outB[k]));
      loud = Math.max(loud, Math.abs(outB[k]));
    }
  }
  check('knobs turned on the port make the piano those knobs make', loud > 0.05 && differ < 0.01 * loud, differ.toExponential(1) + ' of ' + loud.toFixed(3));
  check('which is not the piano it was', apart > 0.5 * loud, apart.toFixed(3) + ' of ' + loud.toFixed(3));

  console.log(failures ? failures + ' failed' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
