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
// the worklet says it is over, that what is being said is kept as it
// plays (the line, its syllables begun and its mouth, each taken up once
// the context's time at the speaker reaches it, and when it ended), that a
// meal sends
// one of the thanks THANK_MS later, that a drag too fast has one of the
// drag slower lines wait for the line playing to be over and then sends
// it, that the voice goes with the node, and
// that a voice drawn at random has every setting inside its RANDOM and goes
// to the worklet.
// then loads js/voice-worklet.js with the real
// monk_mouth/monk_mouth.wasm and checks it renders: silent until a sound,
// every line, every thanks and every drag slower line sounds, says each of its syllables as it
// begins, in turn, and the mouth every three blocks, each at its block's
// time, says done and stays inside full scale
// through the master gain, as every line does at every corner of RANDOM,
// and a line the engine will not take says bad. the
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
const ctx = vm.createContext({ setTimeout });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'voice.js'), 'utf8'), ctx, { filename: 'js/voice.js' });
const Voice = vm.runInContext('Voice', ctx);

// --- the fake window -----------------------------------------------------------
const made = { contexts: [], nodes: [], modules: [], fetched: [], fetchedWith: [], posted: [] };
class AudioContext {
  constructor(options) {
    made.contexts.push(options);
    this.state = 'suspended';
    this.currentTime = 0;
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
const sounds = () => made.posted.filter((m) => m.type === 'line');

(async () => {
  // --- the voice and the lines -----------------------------------------------------
  const V = Voice.VOICE;
  const fields = ['sections', 'breathiness', 'roughness', 'tension', 'diction', 'wobble'];
  check('the voice has its six settings', fields.every((k) => typeof V[k] === 'number' && isFinite(V[k])), fields.map((k) => V[k]).join(' '));
  check('a size the engine is tested at, 14 to 48 sections', V.sections >= 14 && V.sections <= 48, V.sections);
  const lineOk = (l) => typeof l.phones === 'string' && ['midi', 'range', 'speed', 'breath'].every((k) => typeof l[k] === 'number');
  check('lines, each phones, midi, range, speed and breath', Voice.LINES.length > 0 && Voice.LINES.every(lineOk));
  check('thanks, the same', Voice.THANKS.length > 0 && Voice.THANKS.every(lineOk));
  check('drag slower lines, the same', Voice.SLOWER.length > 0 && Voice.SLOWER.every(lineOk));
  const vowels = (l) => l.phones.trim().split(/\s+/).filter((t) => /\d$/.test(t)).length;
  const syllables = (l) => typeof l.text === 'string' ? l.text.trim().split(/[\s|]+/).length : -1;
  const counts = [...Voice.LINES, ...Voice.THANKS, ...Voice.SLOWER].filter((l) => syllables(l) !== vowels(l));
  check('every line, thanks and drag slower line has its text, a syllable for each vowel', counts.length === 0, counts.map((l) => l.text).join(', '));

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
  check('the worklet is loaded and the wasm fetched', /^js\/voice-worklet\.js\?\d+$/.test(made.modules[0]) && made.fetched[0] === 'monk_mouth/monk_mouth.wasm', made.modules[0]);
  check('neither from the cache: the worklet by a fresh query, the wasm checked with the server', made.fetchedWith[0] && made.fetchedWith[0].cache === 'no-cache');
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
  const isIn = (list) => (m) => m.type === 'line' && list.some((l) => l.phones === m.phones && l.midi === m.midi && l.range === m.range && l.speed === m.speed && l.breath === m.breath);
  const isLine = isIn(Voice.LINES), isThanks = isIn(Voice.THANKS);
  check('once the worklet is ready, the held line is sent, one line', made.posted.length === 1 && isLine(first) && Voice.held === null, first && first.type + ' ' + first.phones);
  check('and kept as being said: the line, none of it begun, not ended',
    Voice.said === 1 && Voice.line && Voice.line.phones === first.phones && Voice.heard === 0 && Voice.endedAt === null);
  const mouth = { voicing: 0.7, hiss: 0, lips: 1, front: 2, lipMin: 1.5, l: 0 };
  node.port.onmessage({ data: { t: 1, heard: 1 } });
  node.port.onmessage({ data: { t: 1.01, mouth } });
  Voice.update();
  check('a syllable begun and the mouth wait for the speaker to reach them', Voice.heard === 0 && Voice.mouth === null && Voice.coming.length === 2);
  Voice.ctx.currentTime = 1;
  Voice.update();
  check('then the syllable is heard, the mouth still to come', Voice.heard === 1 && Voice.mouth === null);
  Voice.ctx.currentTime = 1.02;
  Voice.update();
  check('then the mouth, and the line plays on', Voice.mouth === mouth && Voice.busy && Voice.endedAt === null && Voice.coming.length === 0);
  Voice.ctx.outputLatency = 0.1;
  node.port.onmessage({ data: { t: 1.05, heard: 2 } });
  Voice.ctx.currentTime = 1.1;
  Voice.update();
  check('the latency the context owns to holds it back', Voice.heard === 1);
  Voice.ctx.currentTime = 1.16;
  Voice.update();
  check('until the speaker has it', Voice.heard === 2);
  Voice.ctx.outputLatency = 0;
  Voice.complain();
  Voice.complain();
  check('and nothing more while it plays, nor held', made.posted.length === 1 && Voice.held === null);
  node.port.onmessage({ data: 'done' });
  check('done, it is kept as ended, and when', !Voice.busy && Voice.line !== null && Math.abs(Date.now() - Voice.endedAt) < 1000);
  Voice.update();
  check('done, with nothing more to come, the mouth is in silence', Voice.mouth === null);
  Voice.complain();
  check('once it is done, a grab sends one more, said afresh', made.posted.length === 2 && Voice.said === 2 && Voice.heard === 0 && Voice.endedAt === null);
  node.port.onmessage({ data: 'bad' });
  check('one the engine would not take is no line at all', !Voice.busy && Voice.line === null);
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
  const before = made.posted.length;
  Voice.thank();
  check('a meal sends nothing at once', made.posted.length === before);
  await new Promise((ok) => setTimeout(ok, Voice.THANK_MS + 50));
  check('and one of the thanks THANK_MS later', made.posted.length === before + 1 && isThanks(made.posted[before]), made.posted[before] && made.posted[before].phones);
  node.port.onmessage({ data: 'done' });
  const thanked = new Set();
  Voice.THANK_MS = 0;
  for (let i = 0; i < 200; i++) {
    Voice.thank();
    await new Promise((ok) => setTimeout(ok, 0));
    thanked.add(made.posted[made.posted.length - 1].phones);
    node.port.onmessage({ data: 'done' });
  }
  check('meals pick every thanks', thanked.size === Voice.THANKS.length, thanked.size + ' of ' + Voice.THANKS.length);
  const isSlower = isIn(Voice.SLOWER);
  Voice.complain();
  const playing = made.posted.length;
  Voice.slower();
  Voice.update();
  check('dragged too fast while a line plays: nothing more is sent, the line due', made.posted.length === playing && Voice.due !== null);
  node.port.onmessage({ data: 'done' });
  Voice.update();
  check('and once it is over, one of the drag slower lines', made.posted.length === playing + 1 && isSlower(made.posted[playing]) && Voice.due === null,
    made.posted[playing] && made.posted[playing].phones);
  node.port.onmessage({ data: 'done' });
  const slowed = new Set();
  for (let i = 0; i < 200; i++) {
    Voice.slower();
    Voice.update();
    slowed.add(made.posted[made.posted.length - 1].phones);
    node.port.onmessage({ data: 'done' });
  }
  check('drags too fast pick every drag slower line', slowed.size === Voice.SLOWER.length, slowed.size + ' of ' + Voice.SLOWER.length);
  Voice.set(Object.assign({}, V, { sections: 19 }));
  const last = made.posted[made.posted.length - 1];
  check('the voice set again goes to the worklet', last.type === 'voice' && last.voice.sections === 19);
  check('the random ranges cover the six settings, each lo under hi, at sizes the engine is tested at',
    fields.every((k) => Voice.RANDOM[k] && Voice.RANDOM[k][0] < Voice.RANDOM[k][1]) && Voice.RANDOM.sections[0] >= 14 && Voice.RANDOM.sections[1] <= 48);
  const drawn = [];
  for (let i = 0; i < 200; i++) { Voice.randomize(); drawn.push(made.posted[made.posted.length - 1]); }
  const within = (v) => fields.every((k) => v[k] >= Voice.RANDOM[k][0] && v[k] <= Voice.RANDOM[k][1]);
  check('a voice drawn at random goes to the worklet, every setting inside its range, and is the voice',
    drawn.every((m) => m.type === 'voice' && within(m.voice)) && Voice.VOICE === drawn[drawn.length - 1].voice);
  const spread = fields.every((k) => {
    const [lo, hi] = Voice.RANDOM[k], xs = drawn.map((m) => m.voice[k]);
    return Math.min(...xs) < lo + 0.2 * (hi - lo) && Math.max(...xs) > hi - 0.2 * (hi - lo);
  });
  check('and over many draws each setting reaches near both ends of its range', spread);

  // --- the worklet, with the real wasm -------------------------------------------
  let Processor = null;
  const sent = [];
  class AudioWorkletProcessor { constructor() { this.port = { onmessage: null, postMessage: (m) => sent.push(m) }; } }
  const wctx = vm.createContext({ AudioWorkletProcessor, WebAssembly, Float32Array, Uint8Array, currentTime: 0, registerProcessor: (name, P) => { Processor = P; } });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'voice-worklet.js'), 'utf8'), wctx, { filename: 'js/voice-worklet.js' });
  const wasm = fs.readFileSync(path.join(ROOT, 'monk_mouth', 'monk_mouth.wasm'));
  const p = new Processor({ processorOptions: { wasm: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.length), voice: V } });
  for (let i = 0; i < 50 && !sent.length; i++) await settle();
  check('the worklet makes the voice and says ready', sent[0] === 'ready', sent.join());
  const out = new Float32Array(128);
  const BLOCK = 128 / 44100;
  // renders until the worklet says done or bad, or eight seconds pass, the
  // context's time a block on each block: the peak, the seconds it took,
  // what it said last, the syllables it said had begun, in the order it
  // said them, and its mouths
  const play = (sound) => {
    sent.length = 0;
    p.port.onmessage({ data: sound });
    let peak = 0, blocks = 0;
    while (!sent.some((m) => typeof m === 'string') && blocks < 8 / BLOCK) {
      p.process([], [[out]]);
      wctx.currentTime += BLOCK;
      for (const x of out) peak = Math.max(peak, Math.abs(x));
      blocks++;
    }
    const of = (k) => sent.filter((m) => typeof m === 'object' && m[k] !== undefined);
    return { peak, secs: blocks * BLOCK, blocks, said: sent[sent.length - 1], heard: of('heard').map((m) => m.heard), heardAt: of('heard').map((m) => m.t), mouths: of('mouth') };
  };
  let silent = 0;
  for (let b = 0; b < 40; b++) {
    p.process([], [[out]]);
    for (const x of out) silent = Math.max(silent, Math.abs(x));
  }
  check('silent until a sound', silent === 0);

  let loudest = 0;
  const line = (l) => ({ type: 'line', phones: l.phones, midi: l.midi, range: l.range, speed: l.speed, breath: l.breath });
  for (const [what, l] of [...Voice.LINES.map((l) => ['line', l]), ...Voice.THANKS.map((l) => ['thanks', l]), ...Voice.SLOWER.map((l) => ['slower', l])]) {
    const m = line(l), r = play(m);
    loudest = Math.max(loudest, r.peak);
    check(what + ' ' + m.phones + ' sounds and is done, inside full scale',
      r.said === 'done' && r.peak > 0.01 && r.peak * Voice.MASTER < 1,
      'peak ' + r.peak.toFixed(3) + ', ' + (r.peak * Voice.MASTER).toFixed(3) + ' through the master, ' + r.secs.toFixed(2) + ' s');
    const n = vowels(l);
    check('  and says each of its ' + n + ' syllables as it begins, in turn, each at its time',
      r.heard.length === n && r.heard.every((h, i) => h === i + 1) && r.heardAt.every((t, i) => isFinite(t) && (i === 0 || t > r.heardAt[i - 1])), r.heard.join(' '));
    const fields = ['voicing', 'hiss', 'lips', 'front', 'lipMin', 'l'];
    check('  and the mouth every three blocks, six numbers, at its time',
      Math.abs(r.mouths.length - Math.floor(r.blocks / 3)) <= 1 && r.mouths.every((m, i) => fields.every((k) => isFinite(m.mouth[k])) && (i === 0 || m.t > r.mouths[i - 1].t)) &&
      r.mouths.some((m) => m.mouth.voicing > 0.5), r.mouths.length + ' over ' + r.blocks + ' blocks');
  }
  console.log('     the loudest peaks at ' + loudest.toFixed(3) + ', ' + (loudest * Voice.MASTER).toFixed(3) + ' through the master');

  // every line at each of RANDOM's 64 corners, its tension let land first
  const keys = Object.keys(Voice.RANDOM);
  let cornerLo = Infinity, cornerHi = 0, cornerDone = true;
  for (let c = 0; c < 1 << keys.length; c++) {
    const voice = {};
    keys.forEach((k, i) => { voice[k] = Voice.RANDOM[k][(c >> i) & 1]; });
    p.port.onmessage({ data: { type: 'voice', voice } });
    for (let b = 0; b < 400; b++) p.process([], [[out]]);
    for (const l of [...Voice.LINES, ...Voice.THANKS]) {
      const r = play(line(l));
      cornerDone = cornerDone && r.said === 'done' && r.peak > 0.01;
      cornerLo = Math.min(cornerLo, r.peak);
      cornerHi = Math.max(cornerHi, r.peak);
    }
  }
  check('every line at every corner of the random voices sounds and is done, inside full scale through the master',
    cornerDone && cornerHi * Voice.MASTER < 1, 'peaks ' + (cornerLo * Voice.MASTER).toFixed(3) + ' to ' + (cornerHi * Voice.MASTER).toFixed(3) + ' through the master');
  p.port.onmessage({ data: { type: 'voice', voice: V } });
  for (let b = 0; b < 400; b++) p.process([], [[out]]);

  const after = play({ type: 'line', phones: 'S T AA1 P / Q X', midi: 50, range: 5, speed: 1, breath: 0.8 });
  check('phones the engine will not take say bad, at once, and nothing begun', after.said === 'bad' && after.secs <= BLOCK && after.heard.length === 0 && after.mouths.length === 0, after.said);

  console.log(failures ? failures + ' failed' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
