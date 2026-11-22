// node tools/test/clack.test.js
//
// loads js/clack.js the way the page does, a classic script, in a vm
// context, and hands it a fake window: its listeners are recorded, its
// AudioContext counts what is made and how it is wired, its worklet node
// records its options and every message posted to it, and its fetch and
// addModule answer at once. checks that nothing is made before a gesture,
// that neither the worklet nor the wasm comes from the browser's cache,
// that the node plays through the gain, the compressor and the master
// gain, that words before the worklet is ready, while the context sleeps
// or while muted are dropped, that words said go as whole records, a copy,
// each one's age made its delay, with the audio clock's reading, and that
// mute eases the master gain. then loads js/clack-worklet.js with the real
// chebble/chessboard.wasm, and js/chess.js with the real
// chebble/chess.wasm, and plays the real set through both: silent until
// anything is said, words that come before the engine is made dropped, a
// king let go over the board heard as it lands, nothing heard of a
// landing while muted, and a batch of more records than the engine holds
// said in runs, each with the batch's time. prints how loud the landing
// was. and the knobs: read from the real wasm on the main thread, from
// the server and not the cache, each knob's name, its ends' and the named
// sets just as the wasm says them, read here apart; turned, held to the
// grid, a -0 a 0, and nothing posted for a turn to where a knob is; what a
// knob says at its ends, its middle and between, against the wasm's own
// words; which named set the knobs are, for each of them and for none;
// posted to the node whenever there is one, muted and asleep too, and
// again when the worklet says ready if any is not 0; and in the worklet,
// handed to the engine at the top of the next block, the last of them if
// more than one came, dropped before the engine is made, and heard: a
// landing at a named set sounds otherwise than at the start. exits 1 on
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

// --- the script --------------------------------------------------------------
// the clack, loaded afresh
function load() {
  const ctx = vm.createContext({ Date, WebAssembly });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'clack.js'), 'utf8'), ctx, { filename: 'js/clack.js' });
  return vm.runInContext('Clack', ctx);
}
const Clack = load();

// --- the fake window -----------------------------------------------------------
const made = { contexts: [], nodes: [], gains: [], squeezes: [], wires: [], modules: [], fetched: [], fetchedWith: [], posted: [], moved: [] };
class Param {
  constructor(value) { this.value = value; this.eased = []; }
  setTargetAtTime(to, at, by) { this.eased.push([to, at, by]); }
}
const wired = (node) => Object.assign(node, { connect(to) { made.wires.push([node, to]); } });
class AudioContext {
  constructor(options) {
    made.contexts.push(options);
    this.state = 'suspended';
    this.currentTime = 0;
    this.destination = {};
    this.audioWorklet = { addModule: (url) => { made.modules.push(url); return Promise.resolve(); } };
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  createGain() { const g = wired({ gain: new Param(1) }); made.gains.push(g); return g; }
  createDynamicsCompressor() {
    const c = wired({ threshold: new Param(-24), knee: new Param(30), ratio: new Param(12), attack: new Param(0.003), release: new Param(0.25) });
    made.squeezes.push(c);
    return c;
  }
}
class AudioWorkletNode {
  constructor(context, name, options) {
    this.name = name;
    this.options = options;
    this.port = { onmessage: null, postMessage: (m, move) => { made.posted.push(m); made.moved.push(move); } };
    wired(this);
    made.nodes.push(this);
  }
}
const listeners = {};
const win = {
  AudioContext,
  AudioWorkletNode,
  addEventListener(type, fn, capture) { listeners[type] = { fn, capture }; },
  fetch(url, options) { made.fetched.push(url); made.fetchedWith.push(options); return Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }); },
};
const settle = () => new Promise((ok) => setImmediate(ok));
const near = (a, b) => Math.abs(a - b) < 1e-6;
const ENGINE = fs.readFileSync(path.join(ROOT, 'chebble', 'chessboard.wasm'));
const engineBytes = () => ENGINE.buffer.slice(ENGINE.byteOffset, ENGINE.byteOffset + ENGINE.length);

// what the wasm itself says of its knobs and its named sets, read here
// apart from the clack: each knob's name and its ends', each named set's
// name and where it puts each knob, as the wasm has it, and what it
// answers past the last of each
async function truth() {
  const { instance } = await WebAssembly.instantiate(engineBytes(), {});
  const x = instance.exports;
  x._initialize();
  const text = (at) => {
    const m = new Uint8Array(x.memory.buffer);
    let s = '';
    for (let i = at; m[i]; i++) s += String.fromCharCode(m[i]);
    return s;
  };
  const names = [], ends = [], presets = [];
  for (let k = 0; x.chessboard_knob(k); k++) {
    names.push(text(x.chessboard_knob(k)));
    ends.push([0, 1, 2].map((e) => text(x.chessboard_end(k, e))));
  }
  for (let p = 0; p < x.chessboard_presets(); p++) presets.push({ name: text(x.chessboard_preset(p)), knobs: names.map((n, k) => x.chessboard_preset_knob(p, k)) });
  const past = names.every((n, k) => x.chessboard_end(k, 3) === 0) && x.chessboard_preset(presets.length) === 0;
  return { names, ends, presets, past, count: x.chessboard_presets() };
}

(async () => {
  // --- before a gesture ----------------------------------------------------------
  const R = Clack.RECORD;
  // two records and part of a third, each float its own place but the two ages
  const two = Float32Array.from({ length: 2 * R + 5 }, (v, i) => i);
  two[Clack.AGE] = 0.01;
  two[R + Clack.AGE] = 0.004;
  Clack.listen(win);
  const types = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];
  check('listens for every gesture, in capture', types.every((t) => listeners[t] && listeners[t].capture === true), Object.keys(listeners).join(' '));
  Clack.say(two);
  await settle();
  check('nothing made before a gesture', made.contexts.length === 0 && made.fetched.length === 0 && made.modules.length === 0 && made.posted.length === 0);

  // --- the gesture ---------------------------------------------------------------
  listeners.pointerup.fn();
  check('the first gesture makes one context, at 44.1 khz', made.contexts.length === 1 && made.contexts[0].sampleRate === 44100);
  check('and wakes it', Clack.ctx.state === 'running');
  Clack.say(two);
  check('words before the worklet is loaded are dropped', made.posted.length === 0);
  await settle();
  check('the worklet is loaded and the wasm fetched', /^js\/clack-worklet\.js\?\d+$/.test(made.modules[0]) && made.fetched[0] === 'chebble/chessboard.wasm', made.modules[0]);
  check('neither from the cache: the worklet by a fresh query, the wasm checked with the server', made.fetchedWith[0] && made.fetchedWith[0].cache === 'no-cache');
  const node = made.nodes[0];
  check('its node is made, mono, with no input', made.nodes.length === 1 && node.name === 'clack' && node.options.outputChannelCount[0] === 1 && node.options.numberOfInputs === 0);
  check('the wasm goes with it', !!node && node.options.processorOptions.wasm instanceof ArrayBuffer);
  const [gain, out] = made.gains, squeeze = made.squeezes[0], S = Clack.SQUEEZE;
  const chain = [[node, gain], [gain, squeeze], [squeeze, out], [out, Clack.ctx.destination]];
  check('it plays through the gain, the compressor and the master gain',
    made.gains.length === 2 && made.squeezes.length === 1 && made.wires.length === 4 && chain.every(([a, b], i) => made.wires[i][0] === a && made.wires[i][1] === b));
  check('the gain and the master as they are set', gain.gain.value === 5.25 && out.gain.value === 0.6 && Clack.out === out, gain.gain.value + ' ' + out.gain.value);
  check('and the compressor', squeeze.threshold.value === -40 && squeeze.knee.value === 10 && squeeze.ratio.value === 12 && squeeze.attack.value === 0.003 && squeeze.release.value === 0.4
    && Object.keys(S).join() === 'threshold,knee,ratio,attack,release');
  Clack.say(two);
  check('words before the worklet is ready are dropped', made.posted.length === 0 && !Clack.ready);
  listeners.click.fn();
  await settle();
  check('a later gesture makes nothing more', made.contexts.length === 1 && made.nodes.length === 1 && made.fetched.length === 1);

  // --- words said ----------------------------------------------------------------
  node.port.onmessage({ data: 'ready' });
  Clack.ctx.currentTime = 12.5;
  Clack.say(two);
  const m = made.posted[0];
  check('ready, words said are posted once, with the audio clock\'s reading', Clack.ready && made.posted.length === 1 && m.at === 12.5);
  check('as whole records, what is left over dropped', !!m && m.words instanceof Float32Array && m.words.length === 2 * R);
  check('each one\'s age made its delay, LAG less it', !!m && near(m.words[Clack.AGE], Clack.LAG - 0.01) && near(m.words[R + Clack.AGE], Clack.LAG - 0.004), m && m.words[Clack.AGE].toFixed(4) + ' ' + m.words[R + Clack.AGE].toFixed(4));
  check('and nothing else of them changed', !!m && Array.from(m.words).every((v, i) => i % R === Clack.AGE || v === i));
  check('a copy, handed over whole, the set\'s own words left as they were', !!m && m.words.buffer !== two.buffer && made.moved[0].length === 1 && made.moved[0][0] === m.words.buffer && near(two[Clack.AGE], 0.01));
  Clack.say(two.subarray(0, R - 1));
  Clack.say(new Float32Array(0));
  check('less than a record says nothing', made.posted.length === 1);
  Clack.ctx.state = 'interrupted';
  Clack.say(two);
  check('words while the context sleeps are dropped', made.posted.length === 1);
  Clack.ctx.state = 'running';

  // --- muted -----------------------------------------------------------------------
  Clack.mute(true);
  check('muted, the master gain eases to silence', Clack.muted && out.gain.eased.length === 1 && out.gain.eased[0].join() === [0, 12.5, Clack.MUTE_S].join(), out.gain.eased.join(' | '));
  Clack.say(two);
  check('and words are dropped', made.posted.length === 1);
  Clack.mute(false);
  check('unmuted, it eases back', !Clack.muted && out.gain.eased.length === 2 && out.gain.eased[1].join() === [Clack.MASTER, 12.5, Clack.MUTE_S].join());
  Clack.say(two);
  check('and words go again', made.posted.length === 2);
  {
    const late = load(), count = made.gains.length;
    late.mute(true);
    late.listen(win);
    listeners.pointerup.fn();
    await settle();
    check('a sound made muted starts at silence', made.gains.length === count + 2 && made.gains[count + 1].gain.value === 0);
  }

  // --- the knobs, read ---------------------------------------------------------------
  const T = await truth();
  check('the wasm has three knobs, each with three ends, and named sets, none past the last',
    T.names.length === 3 && T.ends.every((e) => e.length === 3 && e.every((w) => w.length > 0)) && T.names.every((n) => n.length > 0) && T.presets.length > 0 && T.presets.length === T.count && T.past,
    T.names.length + ' knobs, ' + T.presets.length + ' named sets');
  const K = load(), asked = [];
  let done = 0;
  check('before they are read, nothing is known and no named set is the knobs', K.names === null && K.presets === null && K.preset() === -1 && K.knobs.length === T.names.length && K.knobs.every((v) => v === 0));
  K.load({ fetch: (url, options) => { asked.push([url, options]); return Promise.resolve({ arrayBuffer: () => Promise.resolve(engineBytes()) }); } }, () => done++);
  for (let i = 0; i < 200 && !done; i++) await settle();
  check('read from the wasm once, from the server and not the cache, and the page told once', done === 1 && asked.length === 1 && asked[0][0] === 'chebble/chessboard.wasm' && asked[0][1].cache === 'no-cache');
  check('each knob\'s name and its ends\' as the wasm says them', JSON.stringify(K.names) === JSON.stringify(T.names) && JSON.stringify(K.ends) === JSON.stringify(T.ends), K.names.join(' '));
  check('each named set\'s name, in the wasm\'s order, and where it puts the knobs, on the grid',
    K.presets.length === T.presets.length && K.presets.every((p, i) => p.name === T.presets[i].name && p.knobs.length === 3 && p.knobs.every((v, k) => Math.abs(v - T.presets[i].knobs[k]) <= 0.005 && Math.round(v * 100) / 100 === v)),
    K.presets.map((p) => p.name).join(' '));

  // --- the knobs, turned -------------------------------------------------------------
  const which = () => T.presets.findIndex((p) => p.knobs.every((v, k) => Math.round(v * 100) / 100 === K.knobs[k]));
  check('at the start, the named set the knobs are is the one that puts them all at 0, or none', K.preset() === which(), String(K.preset()));
  K.turn(0, 0.123);
  K.turn(1, -7);
  K.turn(2, -0.004);
  check('a knob turned is held to the grid, in -1 .. 1, a -0 a 0', K.knobs[0] === 0.12 && K.knobs[1] === -1 && Object.is(K.knobs[2], 0), K.knobs.join(' '));
  check('which named set the knobs are follows them', K.preset() === which());
  for (let p = 0; p < K.presets.length; p++) {
    K.pick(p);
    const first = K.presets.findIndex((q) => q.knobs.every((v, k) => v === K.presets[p].knobs[k]));
    check('a named set picked turns the three to it, and it is the knobs\' (' + K.presets[p].name + ')', K.knobs.every((v, k) => v === K.presets[p].knobs[k]) && K.preset() === first, K.knobs.join(' '));
  }
  K.turn(0, K.knobs[0] + (K.knobs[0] < 1 ? 0.01 : -0.01));
  check('a knob turned off it, the knobs are that named set\'s no longer', K.preset() === which() && K.preset() !== K.presets.length - 1);
  // what a knob says, against the wasm's own words
  const says = (k, v, word) => K.shows(k, v) === T.names[k] + ' ' + word;
  check('a knob says its name and its -1 end\'s word below -0.905', T.names.every((n, k) => says(k, -1, T.ends[k][0]) && says(k, -0.91, T.ends[k][0])), K.shows(0, -1));
  check('its middle\'s word within 0.005 of 0', T.names.every((n, k) => says(k, 0, T.ends[k][1]) && says(k, 0.004, T.ends[k][1]) && says(k, -0.004, T.ends[k][1])), K.shows(1, 0));
  check('its 1 end\'s word above 0.905', T.names.every((n, k) => says(k, 1, T.ends[k][2]) && says(k, 0.91, T.ends[k][2])), K.shows(2, 1));
  check('and else the number, signed, to two places', T.names.every((n, k) => says(k, 0.35, '+0.35') && says(k, -0.25, '-0.25') && says(k, -0.9, '-0.90') && says(k, 0.01, '+0.01')), K.shows(0, 0.35) + ', ' + K.shows(2, -0.25));
  K.turn(1, 0.5);
  check('and where it is, unless given', K.shows(1) === T.names[1] + ' +0.50');

  // --- the knobs, to the worklet -----------------------------------------------------
  {
    const L = load(), was = made.posted.length, nodes = made.nodes.length;
    L.turn(0, 0.5);
    L.turn(1, -0.25);
    check('a knob turned before there is a node posts nothing', made.posted.length === was && L.knobs[0] === 0.5);
    L.listen(win);
    listeners.pointerup.fn();
    await settle();
    const ln = made.nodes[nodes];
    check('its node is made as any is', made.nodes.length === nodes + 1 && !!ln);
    L.turn(2, 0.25);
    check('one turned once there is a node goes to it, the three as they stand, before the worklet is ready', made.posted.length === was + 1 && JSON.stringify(made.posted[was]) === JSON.stringify({ knobs: [0.5, -0.25, 0.25] }));
    ln.port.onmessage({ data: 'ready' });
    const m = made.posted[was + 1];
    check('ready, the knobs as they stand are posted again, a copy', L.ready && made.posted.length === was + 2 && JSON.stringify(m) === JSON.stringify({ knobs: [0.5, -0.25, 0.25] }) && m.knobs !== L.knobs);
    L.turn(2, 0.25);
    check('a knob turned to where it is posts nothing', made.posted.length === was + 2);
    L.mute(true);
    L.turn(0, -0.5);
    L.ctx.state = 'suspended';
    L.turn(1, 1);
    check('muted, or asleep, a knob turned still goes', made.posted.length === was + 4 && JSON.stringify(made.posted[was + 3]) === JSON.stringify({ knobs: [-0.5, 1, 0.25] }));
    L.ctx.state = 'running';
  }
  {
    const L = load(), was = made.posted.length, nodes = made.nodes.length;
    L.listen(win);
    listeners.pointerup.fn();
    await settle();
    made.nodes[nodes].port.onmessage({ data: 'ready' });
    check('ready with every knob at 0, nothing is posted', made.posted.length === was);
  }

  // --- the worklet, with the real wasm -------------------------------------------
  let Processor = null;
  const sent = [];
  class AudioWorkletProcessor { constructor() { this.port = { onmessage: null, postMessage: (msg) => sent.push(msg) }; } }
  const RATE = 44100, BLOCK = 128;
  const wctx = vm.createContext({ AudioWorkletProcessor, WebAssembly, Float32Array, registerProcessor: (name, P) => { Processor = { name, P }; }, sampleRate: RATE, currentTime: 0 });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'clack-worklet.js'), 'utf8'), wctx, { filename: 'js/clack-worklet.js' });
  check('the worklet registers the processor the node asks for', !!Processor && Processor.name === node.name);
  const engine = fs.readFileSync(path.join(ROOT, 'chebble', 'chessboard.wasm'));
  const p = new Processor.P({ processorOptions: { wasm: engine.buffer.slice(engine.byteOffset, engine.byteOffset + engine.length) } });
  const block = new Float32Array(BLOCK);
  p.port.onmessage({ data: { words: two.slice(0, 2 * R), at: 0 } });
  check('before the engine is made a block is silent, and words that come are dropped', p.process([], [[block]]) === true && block.every((x) => x === 0) && p.waiting.length === 0);
  for (let i = 0; i < 50 && !sent.length; i++) await settle();
  check('made, the port says ready', sent.length === 1 && sent[0] === 'ready' && p.most > 0, p.most + ' records at a time');
  // the audio clock, s, and the loudest sample of the blocks up to time to
  let clock = 0;
  const play = (to) => {
    let peak = 0;
    while (clock < to) {
      wctx.currentTime = clock;
      p.process([], [[block]]);
      for (const x of block) peak = Math.max(peak, Math.abs(x));
      clock += BLOCK / RATE;
    }
    return peak;
  };
  check('nothing said, it is silent', play(1) === 0);

  // --- the real set, heard -------------------------------------------------------
  const cctx = vm.createContext({ WebAssembly });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'chess.js'), 'utf8'), cctx, { filename: 'js/chess.js' });
  const Chess = vm.runInContext('Chess', cctx);
  const set = fs.readFileSync(path.join(ROOT, 'chebble', 'chess.wasm'));
  Chess.size(320, 240);
  Chess.load({ fetch: () => Promise.resolve({ arrayBuffer: () => Promise.resolve(set.buffer.slice(set.byteOffset, set.byteOffset + set.length)) }) });
  for (let i = 0; i < 200 && !Chess.ready; i++) await settle();
  check('the set is in', Chess.ready);
  // the clack's node posts to the processor, and the page's frames run the
  // set a step, say its words and play the blocks up to the frame's end
  const DT = 1 / 60;
  let batches = 0;
  node.port.postMessage = (msg) => { batches++; p.port.onmessage({ data: msg }); };
  const frames = (count, each) => {
    let peak = 0, time = clock;
    for (let i = 0; i < count; i++) {
      if (each) each();
      Chess.step(DT);
      Clack.ctx.currentTime = clock;
      Clack.say(Chess.words());
      peak = Math.max(peak, play(time += DT));
    }
    return peak;
  };
  // white's king taken by its head, carried up the board and let go
  const over = (x, y, z) => Chess.point(x, y, z);
  const king = over(0.5, 0.9, -3.5), mid = over(0.5, 0, 0.5);
  check('the king is taken', Chess.take(king.x, king.y));
  frames(50, () => Chess.carry(mid.x, mid.y));
  Chess.drop();
  const landed = frames(150);
  check('let go over the board, its landing is heard', batches > 0 && landed > 0.01, 'peak ' + (20 * Math.log10(landed)).toFixed(1) + ' dbfs out of the engine, ' + batches + ' batches');
  const quiet = frames(360);
  check('and dies away once the set is at rest', quiet < landed / 100, 'peak ' + (20 * Math.log10(Math.max(quiet, 1e-9))).toFixed(1) + ' dbfs');
  // white's a pawn the same way, muted
  Clack.mute(true);
  const before = batches, pawn = over(-3.5, 0.5, -2.5), took = Chess.take(pawn.x, pawn.y);
  frames(50, () => Chess.carry(mid.x, mid.y));
  Chess.drop();
  const hushed = frames(150);
  check('muted, nothing of a landing reaches the engine', took && batches === before && hushed <= quiet);
  Clack.mute(false);

  // --- more records than the engine holds ------------------------------------------
  const runs = [], cb = p.cb;
  p.cb = Object.assign({}, cb, { chessboard_say: (count, shift) => { runs.push([count, shift]); return cb.chessboard_say(count, shift); } });
  const one = Float32Array.from({ length: R }, () => 0);
  one[1] = 4;          // the king
  one[2] = 80;         // on the board
  one[8] = 0.5;        // closing at half a metre a second
  one[9] = 1;          // with its own weight
  one[Clack.AGE] = 0.01;
  const many = new Float32Array((p.most + 3) * R);
  for (let i = 0; i < p.most + 3; i++) many.set(one, i * R);
  wctx.currentTime = clock;
  p.port.onmessage({ data: { words: many, at: clock + 0.25 } });
  p.process([], [[block]]);
  check('a batch of more records than it holds is said in runs, each with the batch\'s time on from the block\'s',
    runs.length === 2 && runs[0][0] === p.most && runs[1][0] === 3 && runs.every((r) => near(r[1], 0.25)) && p.waiting.length === 0, runs.map((r) => r[0]).join(' + '));
  clock += BLOCK / RATE;
  check('and it sounds', play(clock + 1) > 0.001);

  // --- the knobs, in the worklet -------------------------------------------------------
  {
    const turned = [], said = p.cb;
    p.cb = Object.assign({}, said, { chessboard_knobs: (...k) => { turned.push(k); return said.chessboard_knobs(...k); } });
    p.port.onmessage({ data: { knobs: [0.1, 0.2, 0.3] } });
    p.port.onmessage({ data: { knobs: [-0.5, 0.25, 1] } });
    check('knobs that come wait for the next block, and are no words', turned.length === 0 && p.waiting.length === 0);
    play(clock + BLOCK / RATE);
    check('at its top the last of them is handed to the engine, once', turned.length === 1 && turned[0].join() === '-0.5,0.25,1', turned.map((k) => k.join(' ')).join(' | '));
    play(clock + BLOCK / RATE);
    check('and not again', turned.length === 1);
  }
  {
    const make = () => new Processor.P({ processorOptions: { wasm: engineBytes() } });
    const early = make();
    early.port.onmessage({ data: { knobs: [1, 1, 1] } });
    const at0 = make(), at1 = make();
    for (let i = 0; i < 200 && !(early.cb && at0.cb && at1.cb); i++) await settle();
    check('knobs that come before the engine is made are dropped', !!early.cb && early.knobs === null);
    // the named set furthest from the start, and the king's landing
    // heard through an engine at the start and one at that named set
    const far = K.presets.reduce((b, q) => q.knobs.reduce((s, v) => s + Math.abs(v), 0) > b.knobs.reduce((s, v) => s + Math.abs(v), 0) ? q : b);
    at1.port.onmessage({ data: { knobs: far.knobs.slice() } });
    const land = (q) => {
      const out = [];
      wctx.currentTime = 0;
      q.port.onmessage({ data: { words: one.slice(), at: 0 } });
      for (let i = 0; i < Math.ceil(0.5 * RATE / BLOCK); i++) {
        wctx.currentTime = i * BLOCK / RATE;
        q.process([], [[block]]);
        for (const x of block) out.push(x);
      }
      return out;
    };
    const a0 = land(at0), a1 = land(at1);
    const loud = (o) => o.reduce((m, x) => Math.max(m, Math.abs(x)), 0), apart = a0.reduce((m, x, i) => Math.max(m, Math.abs(x - a1[i])), 0);
    check('a landing at a named set sounds otherwise than at the start', far.knobs.some((v) => v) && loud(a0) > 0.001 && loud(a1) > 0.001 && a1.every(Number.isFinite) && apart > 0.001,
      far.name + ': peaks ' + loud(a0).toFixed(3) + ' and ' + loud(a1).toFixed(3) + ', apart by ' + apart.toFixed(3) + ' at most');
  }

  console.log(failures ? failures + ' failed' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
