// node tools/test/voice.test.js
//
// loads js/voice.js the way the page does, a classic script, in a vm
// context, and hands it a fake window: its listeners are recorded, its
// AudioContext counts what is made, its worklet node records its options
// and every message posted to it, and its fetch and addModule answer at
// once. checks the voice and the lines, that nothing is made
// before a gesture, that a grab before the worklet is ready or while the
// context sleeps has its line held and sent once both are, or dropped if
// it waited too long, that a grab sends one sound and nothing more until
// the worklet says it is over, and that the voice goes with the node. then
// loads js/voice-worklet.js with the real
// monk_mouth/monk_mouth.wasm and checks it renders: silent until a sound,
// every line sounds, says done and stays inside full scale
// through the master gain, and a line the engine will not take says bad. the
// peaks it prints, through the master gain, are what js/voice.js's master
// is set by. exits 1 on failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}

// --- the script --------------------------------------------------------------
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'voice.js'), 'utf8'), ctx, { filename: 'js/voice.js' });
const Voice = vm.runInContext('Voice', ctx);

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
const sounds = () => made.posted.filter((m) => m.type === 'line');

(async () => {
  // --- the voice and the lines -----------------------------------------------------
  const V = Voice.VOICE;
  const fields = ['sections', 'breathiness', 'roughness', 'tension', 'diction', 'wobble'];
  check('the voice has its six settings', fields.every((k) => typeof V[k] === 'number' && isFinite(V[k])), fields.map((k) => V[k]).join(' '));
  check('a size the engine is tested at, 14 to 48 sections', V.sections >= 14 && V.sections <= 48, V.sections);
  check('lines, each phones, midi, range, speed and breath',
    Voice.LINES.length > 0 && Voice.LINES.every((l) => typeof l.phones === 'string' && ['midi', 'range', 'speed', 'breath'].every((k) => typeof l[k] === 'number')));

  // --- before a gesture ----------------------------------------------------------
  Voice.listen(win);
  const types = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];
  check('listens for every gesture, a press among them, in capture', types.every((t) => listeners[t] && listeners[t].capture === true), Object.keys(listeners).join(' '));
  Voice.complain();
  await settle();
  check('nothing made before a gesture', made.contexts.length === 0 && made.fetched.length === 0 && made.modules.length === 0 && made.posted.length === 0);
  check('nor held', Voice.held === null);

  // --- the gesture ---------------------------------------------------------------
  listeners.pointerdown.fn();
  check('the first gesture, a press, makes one context, at 44.1 khz', made.contexts.length === 1 && made.contexts[0].sampleRate === 44100);
  check('and wakes it', Voice.ctx.state === 'running');
  Voice.complain();
  check('a grab before the worklet is loaded waits, its line held', made.posted.length === 0 && Voice.held !== null);
  await settle();
  check('the worklet is loaded and the wasm fetched', made.modules[0] === 'js/voice-worklet.js' && made.fetched[0] === 'monk_mouth/monk_mouth.wasm');
  const node = made.nodes[0];
  check('its node is made, mono', made.nodes.length === 1 && node.name === 'voice' && node.options.outputChannelCount[0] === 1);
  const opts = node && node.options.processorOptions;
  check('the voice and the wasm go with it', !!opts && opts.wasm instanceof ArrayBuffer && fields.every((k) => opts.voice[k] === V[k]));
  Voice.complain();
  check('a grab before the worklet is ready waits too', made.posted.length === 0 && Voice.held !== null);
  listeners.click.fn();
  await settle();
  check('a later gesture makes nothing more', made.contexts.length === 1 && made.nodes.length === 1 && made.fetched.length === 1);

  // --- grabs ---------------------------------------------------------------------
  node.port.onmessage({ data: 'ready' });
  const first = made.posted[0];
  const isLine = (m) => m.type === 'line' && Voice.LINES.some((l) => l.phones === m.phones && l.midi === m.midi && l.range === m.range && l.speed === m.speed && l.breath === m.breath);
  check('once the worklet is ready, the held line is sent, one line', made.posted.length === 1 && isLine(first) && Voice.held === null, first && first.type + ' ' + first.phones);
  Voice.complain();
  Voice.complain();
  check('and nothing more while it plays, nor held', made.posted.length === 1 && Voice.held === null);
  node.port.onmessage({ data: 'done' });
  Voice.complain();
  check('once it is done, a grab sends one more', made.posted.length === 2);
  node.port.onmessage({ data: 'bad' });
  Voice.ctx.state = 'interrupted';
  Voice.complain();
  check('a grab while the context sleeps waits', made.posted.length === 2 && Voice.held !== null);
  listeners.pointerdown.fn();
  await settle();
  check('and is sent once a gesture wakes it', made.posted.length === 3 && isLine(made.posted[2]) && Voice.held === null);
  node.port.onmessage({ data: 'done' });
  Voice.ctx.state = 'interrupted';
  Voice.complain();
  const clock = vm.runInContext('Date', ctx);
  const now = clock.now;
  clock.now = () => now() + Voice.HOLD + 1;
  listeners.pointerdown.fn();
  await settle();
  clock.now = now;
  check('a line held longer than HOLD is dropped', made.posted.length === 3 && Voice.held === null && Voice.ctx.state === 'running');
  const picks = new Set();
  for (let i = 0; i < 200; i++) {
    Voice.complain();
    picks.add(made.posted[made.posted.length - 1].phones);
    node.port.onmessage({ data: 'done' });
  }
  check('grabs pick every line, and only lines', picks.size === Voice.LINES.length && sounds().every(isLine), picks.size + ' of ' + Voice.LINES.length);
  Voice.set(Object.assign({}, V, { sections: 19 }));
  const last = made.posted[made.posted.length - 1];
  check('the voice set again goes to the worklet', last.type === 'voice' && last.voice.sections === 19);

  // --- the worklet, with the real wasm -------------------------------------------
  let Processor = null;
  const sent = [];
  class AudioWorkletProcessor { constructor() { this.port = { onmessage: null, postMessage: (m) => sent.push(m) }; } }
  const wctx = vm.createContext({ AudioWorkletProcessor, WebAssembly, Float32Array, Uint8Array, registerProcessor: (name, P) => { Processor = P; } });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'voice-worklet.js'), 'utf8'), wctx, { filename: 'js/voice-worklet.js' });
  const wasm = fs.readFileSync(path.join(ROOT, 'monk_mouth', 'monk_mouth.wasm'));
  const p = new Processor({ processorOptions: { wasm: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.length), voice: V } });
  for (let i = 0; i < 50 && !sent.length; i++) await settle();
  check('the worklet makes the voice and says ready', sent[0] === 'ready', sent.join());
  const out = new Float32Array(128);
  const BLOCK = 128 / 44100;
  // renders until the worklet says done or bad, or eight seconds pass:
  // the peak, the seconds it took and what it said
  const play = (sound) => {
    sent.length = 0;
    p.port.onmessage({ data: sound });
    let peak = 0, blocks = 0;
    while (!sent.length && blocks < 8 / BLOCK) {
      p.process([], [[out]]);
      for (const x of out) peak = Math.max(peak, Math.abs(x));
      blocks++;
    }
    return { peak, secs: blocks * BLOCK, said: sent[0] };
  };
  let silent = 0;
  for (let b = 0; b < 40; b++) {
    p.process([], [[out]]);
    for (const x of out) silent = Math.max(silent, Math.abs(x));
  }
  check('silent until a sound', silent === 0);

  let loudest = 0;
  const line = (l) => ({ type: 'line', phones: l.phones, midi: l.midi, range: l.range, speed: l.speed, breath: l.breath });
  for (const [what, m] of Voice.LINES.map((l) => ['line', line(l)])) {
    const r = play(m);
    loudest = Math.max(loudest, r.peak);
    check(what + ' ' + m.phones + ' sounds and is done, inside full scale',
      r.said === 'done' && r.peak > 0.01 && r.peak * Voice.MASTER < 1,
      'peak ' + r.peak.toFixed(3) + ', ' + (r.peak * Voice.MASTER).toFixed(3) + ' through the master, ' + r.secs.toFixed(2) + ' s');
  }
  console.log('     the loudest peaks at ' + loudest.toFixed(3) + ', ' + (loudest * Voice.MASTER).toFixed(3) + ' through the master');

  const after = play({ type: 'line', phones: 'S T AA1 P / Q X', midi: 50, range: 5, speed: 1, breath: 0.8 });
  check('phones the engine will not take say bad, at once', after.said === 'bad' && after.secs <= BLOCK, after.said);

  console.log(failures ? failures + ' failed' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
