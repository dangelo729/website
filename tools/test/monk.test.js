// node tools/test/monk.test.js
//
// loads js/voice.js and js/monk.js the way the page does, classic scripts,
// in one vm context, and hands the voice a fake window as
// tools/test/voice.test.js does: its AudioContext counts what is made, its
// worklet nodes record their options and every message posted to them,
// and its fetch and addModule answer at once. checks the ribbon's degrees,
// plain and held past their zones, that the singer makes nothing before a
// press, that its node is made in the voice's context from the same load,
// that nothing is sung until its worklet is ready and the context running,
// that a press sends one note, that a crossing sends the new note and,
// once the floor has passed, one fresh syllable, a crossing inside the
// floor waiting for it, that a lift sends the note off, and that the mouth
// is taken up once the context's time at the speaker reaches it and is in
// silence once the note is done. then loads js/voice-worklet.js with the
// real monk_mouth/monk_mouth.wasm and checks a note: it sounds, says the
// mouth every three blocks while it does, says done only after it is let
// go, and every syllable on every degree stays inside full scale through
// the master gain. the peaks it prints, through the master gain, are what
// js/monk.js's master is set by. exits 1 on failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}

// --- the scripts ---------------------------------------------------------------
const ctx = vm.createContext({ setTimeout });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'voice.js'), 'utf8'), ctx, { filename: 'js/voice.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'monk.js'), 'utf8'), ctx, { filename: 'js/monk.js' });
const Voice = vm.runInContext('Voice', ctx);
const Monk = vm.runInContext('Monk', ctx);

// --- the fake window -----------------------------------------------------------
const made = { contexts: [], nodes: [], modules: [], fetched: [] };
class AudioContext {
  constructor(options) {
    made.contexts.push(options);
    this.state = 'suspended';
    this.currentTime = 0;
    this.destination = {};
    this.audioWorklet = { addModule: (url) => { made.modules.push(url); return Promise.resolve(); } };
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  createGain() { return { gain: { value: 1, setTargetAtTime(v) { this.value = v; } }, connect() {} }; }
}
class AudioWorkletNode {
  constructor(context, name, options) {
    this.context = context;
    this.name = name;
    this.options = options;
    this.posted = [];
    this.port = { onmessage: null, postMessage: (m) => this.posted.push(m) };
    made.nodes.push(this);
  }
  connect() {}
}
const listeners = {};
const win = {
  AudioContext,
  AudioWorkletNode,
  addEventListener(type, fn) { listeners[type] = fn; },
  fetch(url) { made.fetched.push(url); return Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }); },
};
const settle = () => new Promise((ok) => setImmediate(ok));
const isSyllable = (phones) => {
  const [c, v, more] = phones.split(' ');
  return more === undefined && Monk.CONSONANTS.includes(c) && Monk.VOWELS.includes(v);
};

(async () => {
  // --- the degrees -----------------------------------------------------------------
  const D = Monk.DEGREES;
  check('eight degrees of c major up from c3, c3 .. c4', D === 8 && Array.from({ length: D }, (_, d) => Monk.midi(d)).join() === '48,50,52,53,55,57,59,60');
  check('a fresh press: the zone that holds it, the ribbon\'s ends inside it',
    Monk.zone(0) === 0 && Monk.zone(0.1249) === 0 && Monk.zone(0.125) === 1 && Monk.zone(0.5) === 4 && Monk.zone(0.999) === 7 && Monk.zone(1) === 7);
  const w = 1 / D, edge = Monk.HYST * w;
  check('a degree sung holds HYST of a zone past its zone, either side',
    Monk.hold(0.5 - edge + 0.001, 4) === 4 && Monk.hold(0.625 + edge - 0.001, 4) === 4 && Monk.hold(0.5 - edge - 0.001, 4) === 3 && Monk.hold(0.625 + edge + 0.001, 4) === 5);
  check('and past that it is the zone that holds the finger, a leap as a step', Monk.hold(0.05, 4) === 0 && Monk.hold(0.95, 4) === 7);
  const picks = new Set();
  for (let i = 0; i < 2000; i++) picks.add(Monk.syllable());
  check('a syllable is a consonant and a vowel, every pair of them drawn', [...picks].every(isSyllable) && picks.size === Monk.CONSONANTS.length * Monk.VOWELS.length, picks.size);
  check('the voice is the engine\'s own, its tension the engine\'s 0.6, its glide 3 / 0.4 per second',
    Monk.VOICE.sections === 22 && Monk.VOICE.breathiness === 0 && Monk.VOICE.roughness === 0 && Monk.VOICE.diction === 1 && Monk.VOICE.tension === 0.6 && Monk.VOICE.wobble === 0.3 && Monk.VOICE.glide === 7.5);

  // --- before a press ----------------------------------------------------------------
  let now = 1000;
  Monk.down = 0.5;
  Monk.update(now);
  await settle();
  check('a press before the voice\'s gesture makes nothing', made.contexts.length === 0 && !Monk.asked && Monk.deg === -1 && Monk.mouth === null);
  Monk.down = null;
  Voice.listen(win);
  listeners.pointerdown();
  await settle();
  check('the voice\'s gesture makes the context and the voice\'s node, once', made.contexts.length === 1 && made.nodes.length === 1 && made.modules.length === 1);
  Monk.update(now += 16);
  await settle();
  check('nothing made for the singer before the ribbon is pressed', made.nodes.length === 1 && !Monk.asked);

  // --- the press -----------------------------------------------------------------------
  Monk.down = 0.5;
  Monk.update(now += 16);
  await settle();
  const node = made.nodes[1];
  check('a press makes the singer\'s node, in the voice\'s context, of the same worklet loaded once',
    made.nodes.length === 2 && node.name === 'voice' && node.context === Voice.ctx && made.modules.length === 1 && made.fetched.length === 1);
  const opts = node && node.options.processorOptions;
  check('mono, with its own voice and the same wasm', node.options.outputChannelCount[0] === 1 && opts.voice === Monk.VOICE && opts.wasm === made.nodes[0].options.processorOptions.wasm);
  check('through its own master gain at MASTER', Monk.out && Monk.out !== Voice.out && Monk.out.gain.value === Monk.MASTER);
  Monk.update(now += 16);
  check('a press before the worklet is ready sings nothing', node.posted.length === 0 && Monk.deg === -1);
  node.port.onmessage({ data: 'ready' });
  Voice.ctx.state = 'interrupted';
  Monk.update(now += 16);
  check('nor while the context sleeps', node.posted.length === 0 && Monk.deg === -1);
  Voice.ctx.state = 'running';
  Monk.update(now += 16);
  const note = node.posted[0];
  check('held through both, it is sung once both are: one note, its degree\'s, with a syllable',
    node.posted.length === 1 && note.type === 'note' && note.midi === 55 && note.vel === Monk.VEL && isSyllable(note.phones) && Monk.deg === 4,
    note && note.type + ' ' + note.midi + ' ' + note.phones);
  Monk.update(now += 16);
  check('and nothing more while the finger stays', node.posted.length === 1);

  // --- crossings -------------------------------------------------------------------------
  Monk.down = 0.49;
  Monk.update(now += 16);
  check('a finger just past the zone\'s edge keeps the degree', node.posted.length === 1 && Monk.deg === 4);
  Monk.down = 0.45;
  Monk.update(now += 16);
  const pitch = node.posted[1];
  check('a crossing sends the new note at once', node.posted.length === 2 && pitch.type === 'pitch' && pitch.midi === 53 && Monk.deg === 3, pitch && pitch.type);
  const struckAt = now - 16 * 3;
  now = struckAt + Monk.MIN_STRIKE_MS - 1;
  Monk.update(now);
  check('its syllable waits for the floor', node.posted.length === 2);
  now = struckAt + Monk.MIN_STRIKE_MS;
  Monk.update(now);
  const syl = node.posted[2];
  check('then one fresh syllable', node.posted.length === 3 && syl.type === 'syllable' && isSyllable(syl.phones), syl && syl.type);
  Monk.down = 0.3;
  Monk.update(now += 16);
  check('a crossing inside the floor sends its note', node.posted.length === 4 && node.posted[3].type === 'pitch' && node.posted[3].midi === 52);
  Monk.down = 0.2;
  Monk.update(now += 16);
  check('and another', node.posted.length === 5 && node.posted[4].type === 'pitch' && node.posted[4].midi === 50);
  Monk.update(now += 16);
  check('their syllable waits', node.posted.length === 5);
  now += Monk.MIN_STRIKE_MS;
  Monk.update(now);
  Monk.update(now += 16);
  check('then one, on the note the finger is on by then', node.posted.length === 6 && node.posted[5].type === 'syllable');
  Monk.down = 0.4;
  Monk.update(now += 16);
  Monk.down = 0.2;
  Monk.update(now += 16);
  now += Monk.MIN_STRIKE_MS;
  Monk.update(now);
  check('a crossing back onto the note last struck strikes nothing', node.posted.length === 8 && node.posted.slice(6).every((m) => m.type === 'pitch'));

  // --- the mouth ---------------------------------------------------------------------------
  const mouth = { voicing: 0.7, hiss: 0, lips: 1, front: 2, lipMin: 1.5, l: 0 };
  Voice.ctx.currentTime = 0.5;
  node.port.onmessage({ data: { t: 1, mouth } });
  Monk.update(now += 16);
  check('the mouth waits for the speaker to reach it', Monk.mouth === null && Monk.coming.length === 1);
  Voice.ctx.currentTime = 1;
  Monk.update(now += 16);
  check('then is the mouth', Monk.mouth === mouth && Monk.coming.length === 0);
  node.port.onmessage({ data: 'done' });
  Monk.update(now += 16);
  check('a done while a note is sung is the last note\'s: the mouth stays', Monk.mouth === mouth && Monk.busy);

  // --- the lift ----------------------------------------------------------------------------
  const sent = node.posted.length;
  Monk.down = null;
  Monk.update(now += 16);
  check('a lift lets the note go', node.posted.length === sent + 1 && node.posted[sent].type === 'off' && Monk.deg === -1);
  Monk.update(now += 16);
  check('once', node.posted.length === sent + 1);
  check('the mouth stays while the breath falls', Monk.mouth === mouth);
  node.port.onmessage({ data: { t: 1.01, mouth: Object.assign({}, mouth, { voicing: 0.1 }) } });
  node.port.onmessage({ data: 'done' });
  Monk.update(now += 16);
  check('done, the mouth still to come waits', Monk.mouth === mouth && !Monk.busy);
  Voice.ctx.currentTime = 1.02;
  Monk.update(now += 16);
  check('and once it is heard, with nothing more to come, the mouth is in silence', Monk.mouth === null);
  Monk.down = 0.99;
  Monk.update(now += 16);
  const again = node.posted[node.posted.length - 1];
  check('a press again sends a note again, the top degree\'s', again.type === 'note' && again.midi === 60 && Monk.deg === 7 && made.nodes.length === 2);
  Monk.mute(true);
  check('muted, its master goes to 0', Monk.out.gain.value === 0);
  Monk.mute(false);

  // --- the worklet, with the real wasm -------------------------------------------
  let Processor = null;
  const said = [];
  class AudioWorkletProcessor { constructor() { this.port = { onmessage: null, postMessage: (m) => said.push(m) }; } }
  const wctx = vm.createContext({ AudioWorkletProcessor, WebAssembly, Float32Array, Uint8Array, currentTime: 0, registerProcessor: (name, P) => { Processor = P; } });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'voice-worklet.js'), 'utf8'), wctx, { filename: 'js/voice-worklet.js' });
  const wasm = fs.readFileSync(path.join(ROOT, 'monk_mouth', 'monk_mouth.wasm'));
  const p = new Processor({ processorOptions: { wasm: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.length), voice: Monk.VOICE } });
  for (let i = 0; i < 50 && !said.length; i++) await settle();
  check('the worklet makes the singer\'s voice and says ready', said[0] === 'ready', said.join());
  const out = new Float32Array(128);
  const BLOCK = 128 / 44100;
  // blocks rendered, the context's time a block on each: the peak
  const render = (blocks) => {
    let peak = 0;
    for (let b = 0; b < blocks; b++) {
      p.process([], [[out]]);
      wctx.currentTime += BLOCK;
      for (let i = 0; i < 128; i++) peak = Math.max(peak, Math.abs(out[i]));
    }
    return peak;
  };
  // a note struck with its syllable, held, then let go and rendered until
  // done or eight seconds: the peak, and the blocks held and after
  const sing = (midi, phones, hold) => {
    said.length = 0;
    p.port.onmessage({ data: { type: 'note', midi, vel: Monk.VEL, phones } });
    let peak = render(hold);
    const held = said.slice();
    p.port.onmessage({ data: { type: 'off' } });
    let after = 0;
    while (!said.includes('done') && after < 8 / BLOCK) { peak = Math.max(peak, render(1)); after++; }
    return { peak, held, after, done: said.includes('done') };
  };
  check('silent until a note', render(40) === 0);

  const hold = Math.round(0.6 / BLOCK);
  const r = sing(55, 'B AA', hold);
  const mouths = r.held.filter((m) => m.mouth);
  const fields = ['voicing', 'hiss', 'lips', 'front', 'lipMin', 'l'];
  check('a note sounds', r.peak > 0.01, 'peak ' + r.peak.toFixed(3));
  check('and says the mouth every three blocks as it is held, six numbers, at its time',
    Math.abs(mouths.length - Math.floor(hold / 3)) <= 1 && mouths.every((m, i) => fields.every((k) => isFinite(m.mouth[k])) && (i === 0 || m.t > mouths[i - 1].t)) &&
    mouths.some((m) => m.mouth.voicing > 0.5), mouths.length + ' over ' + hold + ' blocks');
  check('held, it is not done', !r.held.includes('done') && !r.held.includes('bad'));
  check('let go, it is done once its breath has fallen', r.done && r.after > 10 && r.after * BLOCK < 1, (r.after * BLOCK).toFixed(2) + ' s after');

  said.length = 0;
  p.port.onmessage({ data: { type: 'note', midi: 48, vel: Monk.VEL, phones: 'M AA' } });
  let peak = render(20), blocks = 20;
  for (let d = 1; d < D; d++) {
    p.port.onmessage({ data: { type: 'pitch', midi: Monk.midi(d) } });
    p.port.onmessage({ data: { type: 'syllable', phones: Monk.CONSONANTS[d] + ' ' + Monk.VOWELS[d] } });
    peak = Math.max(peak, render(Math.round(0.1 / BLOCK)));
    blocks += Math.round(0.1 / BLOCK);
  }
  const moved = said.filter((m) => m.mouth).length;
  check('a note moved and struck again up every degree plays on, saying the mouth', !said.includes('done') && Math.abs(moved - Math.floor(blocks / 3)) <= 1, moved + ' over ' + blocks + ' blocks');
  p.port.onmessage({ data: { type: 'off' } });
  let n = 0;
  while (!said.includes('done') && n < 8 / BLOCK) { peak = Math.max(peak, render(1)); n++; }
  check('and is done once let go, inside full scale', said.includes('done') && peak * Monk.MASTER < 1, (peak * Monk.MASTER).toFixed(3) + ' through the master');

  let lo = Infinity, hi = 0, loAt = '', hiAt = '', allDone = true;
  for (let d = 0; d < D; d++) {
    for (const c of Monk.CONSONANTS) {
      for (const v of Monk.VOWELS) {
        const s = sing(Monk.midi(d), c + ' ' + v, hold);
        allDone = allDone && s.done && s.peak > 0.01;
        if (s.peak < lo) { lo = s.peak; loAt = Monk.midi(d) + ' ' + c + ' ' + v; }
        if (s.peak > hi) { hi = s.peak; hiAt = Monk.midi(d) + ' ' + c + ' ' + v; }
        render(20);
      }
    }
  }
  check('every syllable on every degree sounds and is done, inside full scale through the master', allDone && hi * Monk.MASTER < 1);
  console.log('     peaks ' + lo.toFixed(3) + ' (' + loAt + ') to ' + hi.toFixed(3) + ' (' + hiAt + '), ' +
    (lo * Monk.MASTER).toFixed(3) + ' to ' + (hi * Monk.MASTER).toFixed(3) + ' through the master');

  console.log(failures ? failures + ' failed' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
