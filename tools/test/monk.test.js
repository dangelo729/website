// node tools/test/monk.test.js
//
// loads js/scale.js, js/voice.js and js/monk.js the way the page does,
// classic scripts, in one vm context, and hands the voice a fake window as
// tools/test/voice.test.js does: its AudioContext counts what is made, its
// worklet nodes record their options and every message posted to them,
// and its fetch and addModule answer at once. the page's scale is set to
// c3 ionian for all of it but the loudness. checks the ribbon's eight
// degrees in it, the root to its octave, and the ribbon's
// degrees, plain and held past their zones, the random ranges, that the
// singer makes nothing before a press, that a voice drawn before its node
// is made goes with the node, that its node is made in the voice's context
// from the same load, asks for the voice's raw state and is held under the
// ceiling, that nothing is sung until its worklet is ready and the context
// running, that a press sends one note, that a crossing sends the new note
// and, once the floor has passed, one fresh syllable, a crossing inside
// the floor waiting for it, that a lift sends the note off, that the state
// is taken up once the context's time at the speaker reaches it and is in
// silence once the note is done, that a setting of the scale changed while
// a note is held sends the new note and then a syllable, as a crossing
// does, and that a voice drawn at random has every setting inside its
// range and goes to the node. then loads js/voice-worklet.js with the real
// monk_mouth/monk_mouth.wasm and checks a note: it sounds, says the
// voice's raw state every three blocks while it does, each a copy of its
// own as long as its tube says, says done only after it is let go, and
// every syllable on every degree from c3 stays inside full scale through
// the master gain, never reaching the ceiling. the peaks it prints, through
// the master gain, are what js/monk.js's master is set by. last, the
// loudness: the singer's own voice, every corner of the six settings that
// set a voice's level and voices drawn at random, each sung from every
// octave, peak no higher than 0.95 through the master, and none reaches
// the engine's own clamp. exits 1 on failure.

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
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'scale.js'), 'utf8'), ctx, { filename: 'js/scale.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'voice.js'), 'utf8'), ctx, { filename: 'js/voice.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'monk.js'), 'utf8'), ctx, { filename: 'js/monk.js' });
const Scale = vm.runInContext('Scale', ctx);
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
  // --- the scale ---------------------------------------------------------------------
  // c3 ionian, the scale every note below is in
  const D = Monk.DEGREES;
  Scale.mode = 0;
  Scale.key = 0;
  Scale.octave = 2;
  check('the ribbon\'s eight degrees are the page\'s scale\'s, its root to its octave: c3 .. c4',
    D === 8 && Array.from({ length: D }, (_, d) => Scale.midi(d)).join() === '48,50,52,53,55,57,59,60');

  // --- the degrees -----------------------------------------------------------------
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
  const home = Monk.VOICE;
  check('with no vibrato or lips of its own: the engine\'s', ['vibratoHz', 'vibratoCents', 'vibratoOnset', 'lipRound'].every((k) => home[k] === undefined));
  const FIELDS = ['sections', 'breathiness', 'roughness', 'tension', 'diction', 'wobble', 'glide', 'vibratoHz', 'vibratoCents', 'vibratoOnset', 'lipRound'];
  const R = Monk.RANDOM;
  check('the random ranges cover every setting, each lo under hi, the tube a little inside the engine\'s 2 .. 64',
    Object.keys(R).join() === FIELDS.join() && FIELDS.every((k) => R[k][0] < R[k][1]) && R.sections[0] > 2 && R.sections[1] < 64);
  const within = (v) => FIELDS.every((k) => v[k] >= R[k][0] && v[k] <= R[k][1]);

  // --- before a press ----------------------------------------------------------------
  let now = 1000;
  Monk.down = 0.5;
  Monk.update(now);
  await settle();
  check('a press before the voice\'s gesture makes nothing', made.contexts.length === 0 && !Monk.asked && Monk.deg === -1 && Monk.state === null);
  Monk.down = null;
  Voice.listen(win);
  listeners.pointerdown();
  await settle();
  check('the voice\'s gesture makes the context and the voice\'s node, once', made.contexts.length === 1 && made.nodes.length === 1 && made.modules.length === 1);
  Monk.update(now += 16);
  await settle();
  check('nothing made for the singer before the ribbon is pressed', made.nodes.length === 1 && !Monk.asked);
  Monk.randomize();
  const early = Monk.VOICE;
  check('a voice drawn before the node is made is the voice, every setting inside its range, and nothing is made',
    early !== home && within(early) && made.nodes.length === 1 && !Monk.asked);

  // --- the press -----------------------------------------------------------------------
  Monk.down = 0.5;
  Monk.update(now += 16);
  await settle();
  const node = made.nodes[1];
  check('a press makes the singer\'s node, in the voice\'s context, of the same worklet loaded once',
    made.nodes.length === 2 && node.name === 'voice' && node.context === Voice.ctx && made.modules.length === 1 && made.fetched.length === 1);
  const opts = node && node.options.processorOptions;
  check('mono, with its own voice, the one drawn before it, and the same wasm',
    node.options.outputChannelCount[0] === 1 && opts.voice === Monk.VOICE && opts.voice === early && opts.wasm === made.nodes[0].options.processorOptions.wasm);
  check('asking for the voice\'s raw state, as the voice\'s node does not', opts.state === true && !made.nodes[0].options.processorOptions.state);
  check('held under CEILING through the master, as the voice\'s node is not',
    opts.ceiling === Monk.CEILING / Monk.MASTER && Monk.CEILING <= 0.95 && !made.nodes[0].options.processorOptions.ceiling);
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

  // --- the state ---------------------------------------------------------------------------
  const state = new Float32Array(11 + 22);
  Voice.ctx.currentTime = 0.5;
  node.port.onmessage({ data: { t: 1, state } });
  Monk.update(now += 16);
  check('the state waits for the speaker to reach it', Monk.state === null && Monk.coming.length === 1);
  Voice.ctx.currentTime = 1;
  Monk.update(now += 16);
  check('then is the state', Monk.state === state && Monk.coming.length === 0);
  node.port.onmessage({ data: 'done' });
  Monk.update(now += 16);
  check('a done while a note is sung is the last note\'s: the state stays', Monk.state === state && Monk.busy);

  // --- the lift ----------------------------------------------------------------------------
  const sent = node.posted.length;
  Monk.down = null;
  Monk.update(now += 16);
  check('a lift lets the note go', node.posted.length === sent + 1 && node.posted[sent].type === 'off' && Monk.deg === -1);
  Monk.update(now += 16);
  check('once', node.posted.length === sent + 1);
  check('the state stays while the breath falls', Monk.state === state);
  node.port.onmessage({ data: { t: 1.01, state: new Float32Array(11 + 22) } });
  node.port.onmessage({ data: 'done' });
  Monk.update(now += 16);
  check('done, the state still to come waits', Monk.state === state && !Monk.busy);
  Voice.ctx.currentTime = 1.02;
  Monk.update(now += 16);
  check('and once it is heard, with nothing more to come, the state is in silence', Monk.state === null);
  Monk.down = 0.99;
  Monk.update(now += 16);
  const again = node.posted[node.posted.length - 1];
  check('a press again sends a note again, the top degree\'s', again.type === 'note' && again.midi === 60 && Monk.deg === 7 && made.nodes.length === 2);
  Monk.mute(true);
  check('muted, its master goes to 0', Monk.out.gain.value === 0);
  Monk.mute(false);

  // --- the scale changed mid-note --------------------------------------------------
  const sentAt = node.posted.length;
  Scale.octave = 3;
  Monk.update(now += 16);
  check('an octave changed while a note is held sends its new note at once', node.posted.length === sentAt + 1 && node.posted[sentAt].type === 'pitch' && node.posted[sentAt].midi === 72 && Monk.deg === 7);
  now += Monk.MIN_STRIKE_MS;
  Monk.update(now);
  check('then, once the floor has passed, one fresh syllable', node.posted.length === sentAt + 2 && node.posted[sentAt + 1].type === 'syllable' && isSyllable(node.posted[sentAt + 1].phones));
  Monk.down = 0.3;
  Monk.update(now += 16);
  now += Monk.MIN_STRIKE_MS;
  Monk.update(now);
  const modeAt = node.posted.length;
  Scale.mode = 5;
  Monk.update(now += 16);
  now += Monk.MIN_STRIKE_MS;
  Monk.update(now);
  check('a mode changed under a held degree: its new note, e4 to e flat 4, then a syllable',
    node.posted.length === modeAt + 2 && node.posted[modeAt].type === 'pitch' && node.posted[modeAt].midi === 63 && node.posted[modeAt + 1].type === 'syllable',
    node.posted.slice(modeAt).map((m) => m.type + ' ' + (m.midi || m.phones)).join(', '));
  const keyAt = node.posted.length;
  Scale.key = 2;
  Monk.update(now += 16);
  Scale.key = 0;
  Monk.update(now += 16);
  now += Monk.MIN_STRIKE_MS;
  Monk.update(now);
  check('a key changed and back inside the floor sends both notes and strikes nothing', node.posted.length === keyAt + 2 && node.posted.slice(keyAt).every((m) => m.type === 'pitch'));
  Scale.mode = 0;
  Scale.octave = 2;
  Monk.down = null;
  Monk.update(now += 16);

  // --- a wild voice ------------------------------------------------------------------
  const drawn = [];
  for (let i = 0; i < 300; i++) {
    Monk.randomize();
    drawn.push(node.posted[node.posted.length - 1]);
  }
  check('a voice drawn once the node is made goes to it, every setting inside its range, and is the voice',
    drawn.every((m) => m.type === 'voice' && within(m.voice)) && Monk.VOICE === drawn[drawn.length - 1].voice);
  const spread = FIELDS.every((k) => {
    const [lo, hi] = R[k], xs = drawn.map((m) => m.voice[k]);
    return Math.min(...xs) < lo + 0.1 * (hi - lo) && Math.max(...xs) > hi - 0.1 * (hi - lo);
  });
  check('and over many draws each setting reaches near both ends of its range', spread);

  // --- the worklet, with the real wasm -------------------------------------------
  let Processor = null;
  const said = [];
  class AudioWorkletProcessor { constructor() { this.port = { onmessage: null, postMessage: (m) => said.push(m) }; } }
  const wctx = vm.createContext({ AudioWorkletProcessor, WebAssembly, Float32Array, Uint8Array, currentTime: 0, registerProcessor: (name, P) => { Processor = P; } });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'voice-worklet.js'), 'utf8'), wctx, { filename: 'js/voice-worklet.js' });
  const wasm = fs.readFileSync(path.join(ROOT, 'monk_mouth', 'monk_mouth.wasm'));
  // the node's own options, with the real wasm and the singer's own voice
  const p = new Processor({ processorOptions: { wasm: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.length), voice: home, state: opts.state, ceiling: opts.ceiling } });
  for (let i = 0; i < 50 && !said.length; i++) await settle();
  check('the worklet makes the singer\'s voice and says ready', said[0] === 'ready', said.join());
  const out = new Float32Array(128);
  const BLOCK = 128 / 44100;
  // blocks rendered, the context's time a block on each: the peak played;
  // kept too, the peak of the voice's own blocks before the ceiling and
  // the lowest the ceiling's gain has come
  let raw = 0, low = 1;
  const render = (blocks) => {
    let peak = 0;
    for (let b = 0; b < blocks; b++) {
      p.process([], [[out]]);
      wctx.currentTime += BLOCK;
      for (let i = 0; i < 128; i++) {
        peak = Math.max(peak, Math.abs(out[i]));
        raw = Math.max(raw, Math.abs(p.out[i]));
      }
      low = Math.min(low, p.gain);
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
  // each state: 0 breath, 1 voicing, 2 hiss, 3 whistle, 4 whistleHz, 5
  // lips, 6 vibrato, 7 phoneme, 8 and 9 the slots held, 10 the tube's
  // length n, then the tube
  const states = r.held.filter((m) => m.state);
  const own = (s) => s instanceof Float32Array && s.buffer.byteLength === s.byteLength;
  check('a note sounds', r.peak > 0.01, 'peak ' + r.peak.toFixed(3));
  check('and says the voice\'s raw state every three blocks as it is held, at its time, and never the mouth',
    Math.abs(states.length - Math.floor(hold / 3)) <= 1 && states.every((m, i) => i === 0 || m.t > states[i - 1].t) && !r.held.some((m) => m.mouth),
    states.length + ' over ' + hold + ' blocks');
  check('each a copy of its own, eleven floats and then as many of the tube as its length, the voice\'s sections, all finite',
    states.length > 0 && states.every((m) => own(m.state) && m.state[10] === home.sections && m.state.length === 11 + m.state[10] && m.state.every(isFinite)),
    states.length && states[0].state.length + ' floats');
  check('the slots each held or not, the phoneme a whole number, and the note voiced and breathing',
    states.every((m) => (m.state[8] === 0 || m.state[8] === 1) && (m.state[9] === 0 || m.state[9] === 1) && Number.isInteger(m.state[7])) &&
    states.some((m) => m.state[1] > 0.5 && m.state[0] > 0));
  check('held, it is not done', !r.held.includes('done') && !r.held.includes('bad'));
  check('let go, it is done once its breath has fallen', r.done && r.after > 10 && r.after * BLOCK < 1, (r.after * BLOCK).toFixed(2) + ' s after');

  said.length = 0;
  p.port.onmessage({ data: { type: 'note', midi: 48, vel: Monk.VEL, phones: 'M AA' } });
  let peak = render(20), blocks = 20;
  for (let d = 1; d < D; d++) {
    p.port.onmessage({ data: { type: 'pitch', midi: Scale.midi(d) } });
    p.port.onmessage({ data: { type: 'syllable', phones: Monk.CONSONANTS[d] + ' ' + Monk.VOWELS[d] } });
    peak = Math.max(peak, render(Math.round(0.1 / BLOCK)));
    blocks += Math.round(0.1 / BLOCK);
  }
  const moved = said.filter((m) => m.state).length;
  check('a note moved and struck again up every degree plays on, saying the state', !said.includes('done') && Math.abs(moved - Math.floor(blocks / 3)) <= 1, moved + ' over ' + blocks + ' blocks');
  p.port.onmessage({ data: { type: 'off' } });
  let n = 0;
  while (!said.includes('done') && n < 8 / BLOCK) { peak = Math.max(peak, render(1)); n++; }
  check('and is done once let go, inside full scale', said.includes('done') && peak * Monk.MASTER < 1, (peak * Monk.MASTER).toFixed(3) + ' through the master');

  let lo = Infinity, hi = 0, loAt = '', hiAt = '', allDone = true;
  for (let d = 0; d < D; d++) {
    for (const c of Monk.CONSONANTS) {
      for (const v of Monk.VOWELS) {
        const s = sing(Scale.midi(d), c + ' ' + v, hold);
        allDone = allDone && s.done && s.peak > 0.01;
        if (s.peak < lo) { lo = s.peak; loAt = Scale.midi(d) + ' ' + c + ' ' + v; }
        if (s.peak > hi) { hi = s.peak; hiAt = Scale.midi(d) + ' ' + c + ' ' + v; }
        render(20);
      }
    }
  }
  check('every syllable on every degree from c3 sounds and is done, inside full scale through the master', allDone && hi * Monk.MASTER < 1);
  check('and never reaches the ceiling: it plays as the voice made it, the gain never down', hi * Monk.MASTER < Monk.CEILING && low === 1, 'gain down to ' + low);
  console.log('     peaks ' + lo.toFixed(3) + ' (' + loAt + ') to ' + hi.toFixed(3) + ' (' + hiAt + '), ' +
    (lo * Monk.MASTER).toFixed(3) + ' to ' + (hi * Monk.MASTER).toFixed(3) + ' through the master');

  // --- loudness ------------------------------------------------------------------------
  // a voice set and its tension let land, then sung from every octave in a
  // key and mode at random: twice on each, a note struck with a syllable on
  // a degree, held, moved to another degree and struck again, held, and let
  // go. its peak through the master and its quietest note's, and whether
  // the voice itself reached the engine's clamp
  const LEVEL = ['sections', 'breathiness', 'roughness', 'tension', 'diction', 'lipRound'];
  const any = (n) => Math.floor(Math.random() * n);
  const loud = (voice) => {
    p.port.onmessage({ data: { type: 'voice', voice } });
    render(Math.round(0.5 / BLOCK));
    raw = 0;
    let top = 0, least = Infinity, done = true;
    for (let o = 0; o < Scale.OCTAVES.length; o++) {
      for (let n = 0; n < 2; n++) {
        Scale.octave = o;
        Scale.key = any(12);
        Scale.mode = any(7);
        said.length = 0;
        p.port.onmessage({ data: { type: 'note', midi: Scale.midi(any(D)), vel: Monk.VEL, phones: Monk.syllable() } });
        let peak = render(Math.round(0.5 / BLOCK));
        p.port.onmessage({ data: { type: 'pitch', midi: Scale.midi(any(D)) } });
        peak = Math.max(peak, render(Math.round(Monk.MIN_STRIKE_MS / 1000 / BLOCK)));
        p.port.onmessage({ data: { type: 'syllable', phones: Monk.syllable() } });
        peak = Math.max(peak, render(Math.round(0.4 / BLOCK)));
        p.port.onmessage({ data: { type: 'off' } });
        let after = 0;
        while (!said.includes('done') && after < 8 / BLOCK) { peak = Math.max(peak, render(1)); after++; }
        render(20);
        done = done && said.includes('done');
        top = Math.max(top, peak);
        least = Math.min(least, peak);
      }
    }
    return { top: top * Monk.MASTER, least: least * Monk.MASTER, raw: raw * Monk.MASTER, done };
  };
  const voices = [['the singer\'s own', home]];
  for (let c = 0; c < 1 << LEVEL.length; c++) {
    Monk.randomize();
    const voice = Monk.VOICE;
    LEVEL.forEach((k, i) => { voice[k] = R[k][(c >> i) & 1]; });
    voices.push(['corner ' + c, voice]);
  }
  for (let i = 0; i < 64; i++) {
    Monk.randomize();
    voices.push(['drawn ' + i, Monk.VOICE]);
  }
  let top = 0, least = Infinity, over = 0, held = 0, topAt = '', leastAt = '', sung = true, clamped = 0, mine = null;
  for (const [name, voice] of voices) {
    const r = loud(voice);
    if (!mine) mine = r;
    sung = sung && r.done && r.least > 0;
    if (r.top > 0.95) over++;
    if (r.raw > Monk.CEILING) held++;
    if (r.raw >= Monk.MASTER) clamped++;
    if (r.top > top) { top = r.top; topAt = name; }
    if (r.least < least) { least = r.least; leastAt = name; }
  }
  Scale.mode = 0;
  Scale.key = 0;
  Scale.octave = 2;
  check('the singer\'s own voice from every octave peaks no higher than 0.95 through the master', mine.top <= 0.95 && mine.done,
    mine.top.toFixed(3) + ', ' + mine.raw.toFixed(3) + ' before the ceiling');
  check('every corner of the six settings that set a voice\'s level, and 64 voices drawn, from every octave: each sounds, is done, and peaks no higher than 0.95 through the master',
    sung && over === 0, (voices.length - 1) + ' voices, ' + over + ' over');
  check('and no voice reaches the engine\'s own clamp', clamped === 0, clamped + ' did');
  console.log('     loudest ' + top.toFixed(3) + ' (' + topAt + '), quietest note ' + least.toFixed(3) + ' (' + leastAt + ') through the master; ' +
    held + ' of ' + voices.length + ' held down by the ceiling somewhere');

  console.log(failures ? failures + ' failed' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
