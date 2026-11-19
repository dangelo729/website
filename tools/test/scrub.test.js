// node tools/test/scrub.test.js
//
// the scrubber, in three parts. first its core, as built
// (scrub/scrub.wasm), played a block at a time over a sound whose every
// sample says where it is: silent at rest; played, it spins up as fast
// as its catch has it, then steps with its target and puts out the
// sound's own samples, a catch behind; sought on or back it goes after
// its target as fast as it is far, backwards too, and comes to rest on
// it in silence; put somewhere, it is there at once; at the sound's end
// it stops; and it makes room for a sound as long as cicada's. then
// js/scrub-worklet.js with that wasm, in a vm context: what comes before
// it is ready is dropped, the sound goes in, and it says where it is only
// while that changes, with the count it was given. then js/scrub.js,
// loaded the way the page does and handed a fake window: nothing is made
// before it is told to, neither the worklet nor the wasm comes from the
// browser's cache, the sound is decoded, mixed to one channel, turned
// down to fit if it is past full scale with the master gain making up for
// it, and handed over whole once the worklet is ready, what was asked before the sound
// was in is done once it is, each thing asked goes to the worklet, a
// target the page has since moved is not taken back from it, where the
// sound is heard is reckoned on no further than AHEAD, and mute eases
// the master gain. last, the page's half and the worklet's are joined
// and a sound is played through both. exits 1 on failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}
const near = (a, b, by = 1e-6) => Math.abs(a - b) <= by;
const settle = () => new Promise((ok) => setImmediate(ok));

const HZ = 44100, BLOCK = 128, CATCH = 0.3;
const wasm = fs.readFileSync(path.join(ROOT, 'scrub', 'scrub.wasm'));
const env = { env: { emscripten_notify_memory_growth() {} } };

// a sound whose sample i is i's place in a ramp of 2000, so a sample
// heard says where in the ramp the playhead is
const PERIOD = 2000;
const ramp = (i) => (i % PERIOD) * 10 - 10000;

(async () => {
  // --- the core --------------------------------------------------------------------
  const { instance } = await WebAssembly.instantiate(wasm, env);
  const sc = instance.exports;
  check('the wasm asks only to say when its memory grows', WebAssembly.Module.imports(new WebAssembly.Module(wasm)).map((i) => i.module + '.' + i.name).join() === 'env.emscripten_notify_memory_growth');
  sc._initialize();
  sc.scrub_init(HZ, CATCH);
  const block = () => new Float32Array(sc.memory.buffer, sc.scrub_render(), BLOCK);
  check('with no sound a block is silent', Array.from(block()).every((x) => x === 0));
  const COUNT = 20 * HZ, at = sc.scrub_sound(COUNT);
  check('room is made for a sound', at !== 0);
  const sound = new Int16Array(sc.memory.buffer, at, COUNT);
  for (let i = 0; i < COUNT; i++) sound[i] = ramp(i);
  // blocks played, and the loudest sample of them
  const play = (blocks) => { let peak = 0; for (let b = 0; b < blocks; b++) { const o = block(); for (let i = 0; i < BLOCK; i++) peak = Math.max(peak, Math.abs(o[i])); } return peak; };
  const blocks = (seconds) => Math.round(seconds * HZ / BLOCK);
  check('at rest at its start it is silent', play(20) === 0 && sc.scrub_playhead() === 0 && sc.scrub_going() === 0 && sc.scrub_locked() === 0);

  sc.scrub_speed(1);
  play(blocks(CATCH));
  check('played, it spins up: a catch on it is going at all but 1 / e of the sound\'s speed', near(sc.scrub_going(), 1 - 1 / Math.E, 0.01) && sc.scrub_locked() === 0, sc.scrub_going().toFixed(3));
  let n = 0;
  while (!sc.scrub_locked() && n++ < blocks(5)) block();
  check('and then steps with its target', sc.scrub_locked() === 1 && sc.scrub_going() === 1, 'after ' + ((blocks(CATCH) + n) * BLOCK / HZ).toFixed(2) + ' s');
  const from = Math.round(sc.scrub_playhead() * HZ), out = Array.from(block());
  check('locked, it is on a whole sample', near(sc.scrub_playhead() * HZ, Math.round(sc.scrub_playhead() * HZ), 1e-6));
  check('and puts out the sound\'s own samples, one after another', out.every((x, i) => x === Math.fround(ramp(from + 1 + i) / 32768)));
  check('a catch behind its target', near(sc.scrub_aim() - sc.scrub_playhead(), CATCH, 0.01), (sc.scrub_aim() - sc.scrub_playhead()).toFixed(4) + ' s');
  const was = sc.scrub_playhead();
  play(10);
  check('a block on with each block', near((sc.scrub_playhead() - was) * HZ, 10 * BLOCK, 1e-6));

  sc.scrub_speed(0);
  check('stopped, it is locked no longer', (block(), sc.scrub_locked() === 0));
  play(blocks(CATCH));
  check('and spins down', sc.scrub_going() > 0 && sc.scrub_going() < 0.45, sc.scrub_going().toFixed(3));
  play(blocks(8));
  check('to rest on its target, in silence', near(sc.scrub_playhead(), sc.scrub_aim(), 1e-4) && play(10) < 1e-4, 'peak ' + play(10).toExponential(1));

  const here = sc.scrub_playhead();
  sc.scrub_target(here + 10);
  block();
  check('sought on, it goes after its target as fast as it is far', near(sc.scrub_going(), 10 / CATCH, 0.5) && sc.scrub_aim() === here + 10, sc.scrub_going().toFixed(1) + ' times the sound\'s speed');
  check('and is heard as it goes', play(4) > 0.1);
  play(blocks(CATCH) - 5);
  check('a catch on it has all but 1 / e of the way made up', near((sc.scrub_aim() - sc.scrub_playhead()) / 10, 1 / Math.E, 0.01), ((sc.scrub_aim() - sc.scrub_playhead()) / 10).toFixed(3));
  play(blocks(8));
  check('and it comes to rest there', near(sc.scrub_playhead(), here + 10, 1e-4) && play(10) < 1e-4);
  sc.scrub_target(here + 4);
  block();
  check('sought back, it goes backwards', sc.scrub_going() < -15 && sc.scrub_going() > -21, sc.scrub_going().toFixed(1));
  const p0 = sc.scrub_playhead();
  play(20);
  check('the playhead going back with it', sc.scrub_playhead() < p0 && sc.scrub_playhead() > here + 4);
  play(blocks(8));
  check('to rest', near(sc.scrub_playhead(), here + 4, 1e-4));

  sc.scrub_cut(2.5);
  check('put somewhere, it is there at once, at rest', sc.scrub_playhead() === 2.5 && sc.scrub_aim() === 2.5 && sc.scrub_going() === 0 && play(10) === 0);
  sc.scrub_target(-3);
  check('its target goes no further than the sound\'s start', sc.scrub_aim() === 0);
  sc.scrub_target(1e6);
  check('nor its end', near(sc.scrub_aim(), (COUNT - 1) / HZ, 1e-9));
  sc.scrub_cut(COUNT / HZ - 1);
  sc.scrub_speed(1);
  play(blocks(6));
  check('played to its end, it stops there', near(sc.scrub_aim(), (COUNT - 1) / HZ, 1e-9) && sc.scrub_locked() === 0 && near(sc.scrub_playhead(), sc.scrub_aim(), 1e-4) && play(10) < 1e-4);
  sc.scrub_speed(0);

  sc.scrub_cut(1);
  sc.scrub_catch(1.2);
  sc.scrub_target(5);
  block();
  check('a longer catch is a heavier record', near(sc.scrub_going(), 4 / 1.2, 0.1), sc.scrub_going().toFixed(2));
  sc.scrub_catch(CATCH);

  const LONG = 265 * HZ, big = sc.scrub_sound(LONG);
  check('there is room for a sound as long as cicada\'s', big !== 0 && sc.memory.buffer.byteLength >= 2 * LONG, (sc.memory.buffer.byteLength / 1048576).toFixed(0) + ' mb');
  check('and a new sound starts at rest at its start, silent', sc.scrub_playhead() === 0 && sc.scrub_aim() === 0 && play(4) === 0);
  new Int16Array(sc.memory.buffer, big, LONG)[LONG - 1] = 12345;
  sc.scrub_cut(4 * 60);
  sc.scrub_speed(1);
  play(blocks(4));
  check('four minutes in it still steps a whole sample at a time', sc.scrub_locked() === 1 && near(sc.scrub_playhead() * HZ, Math.round(sc.scrub_playhead() * HZ), 1e-5));

  // --- the worklet ---------------------------------------------------------------
  let Processor = null;
  const sent = [];
  class AudioWorkletProcessor { constructor() { this.port = { onmessage: null, postMessage: (m) => sent.push(m) }; } }
  const wctx = vm.createContext({ AudioWorkletProcessor, WebAssembly, Float32Array, Int16Array, registerProcessor: (name, P) => { Processor = { name, P }; }, sampleRate: HZ });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'scrub-worklet.js'), 'utf8'), wctx, { filename: 'js/scrub-worklet.js' });
  const EVERY = vm.runInContext('EVERY', wctx);
  check('the worklet registers a processor', !!Processor && Processor.name === 'scrub');
  const bytes = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.length);
  const p = new Processor.P({ processorOptions: { wasm: bytes, seconds: CATCH } });
  const heard = new Float32Array(BLOCK);
  const turn = () => p.process([], [[heard]]);
  p.port.onmessage({ data: { speed: 1 } });
  check('before the core is made a block is silent and what comes is dropped', turn() === true && heard.every((x) => x === 0) && sent.length === 0);
  for (let i = 0; i < 50 && !sent.length; i++) await settle();
  check('made, the port says ready', sent.length === 1 && sent[0].ready === true);
  const tune = Int16Array.from({ length: 4 * HZ }, (v, i) => ramp(i));
  p.port.onmessage({ data: { sound: tune } });
  check('the sound goes in, and the port says so', sent.length === 2 && sent[1].loaded === true);
  for (let i = 0; i < 3 * EVERY; i++) turn();
  check('at rest it says nothing', sent.length === 2 && heard.every((x) => x === 0));
  p.port.onmessage({ data: { target: 1.5, n: 7 } });
  for (let i = 0; i < EVERY; i++) turn();
  const said = sent[sent.length - 1];
  check('moving, it says where it is heard and wanted, how fast it goes and the count it was given', sent.length === 3 && said.at > 0 && said.at < 1.5 && said.aim === 1.5 && said.going > 1 && said.locked === false && said.n === 7, JSON.stringify(said));
  check('and it is heard', heard.some((x) => x !== 0));
  for (let i = 0; i < 3 * EVERY; i++) turn();
  check('once every few blocks', sent.length === 6);
  p.port.onmessage({ data: { cut: 0.5, n: 8 } });
  for (let i = 0; i < 4 * EVERY; i++) turn();
  check('put somewhere, it says so once and then nothing', sent.length === 7 && sent[6].at === 0.5 && sent[6].aim === 0.5 && sent[6].n === 8);
  p.port.onmessage({ data: { speed: 1 } });
  for (let i = 0; i < blocks(3); i++) turn();
  check('played, it comes to step with its target and says so', sent[sent.length - 1].locked === true && sent[sent.length - 1].going === 1);
  p.port.onmessage({ data: { speed: 0 } });
  p.port.onmessage({ data: { seconds: 0.05 } });
  p.port.onmessage({ data: { target: 3 } });
  turn();
  check('its catch may be changed', sent[sent.length - 1].n === 8 && near(p.sc.scrub_going(), (3 - p.sc.scrub_playhead()) / 0.05, 3));

  // --- the page's half -----------------------------------------------------------
  function load() {
    const ctx = vm.createContext({ Date, Promise, Int16Array, Float32Array });
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'scrub.js'), 'utf8'), ctx, { filename: 'js/scrub.js' });
    return vm.runInContext('Scrub', ctx);
  }
  const made = { contexts: [], nodes: [], gains: [], wires: [], modules: [], fetched: [], fetchedWith: [], posted: [], moved: [], decoded: [] };
  class Param {
    constructor(value) { this.value = value; this.eased = []; }
    setTargetAtTime(to, at, by) { this.eased.push([to, at, by]); }
  }
  const wired = (node) => Object.assign(node, { connect(to) { made.wires.push([node, to]); } });
  // what a decode makes: two channels, the second the first turned over but where both are loud, half as loud again as full scale at the loudest
  const LEFT = Float32Array.from([0, 0.5, -0.5, 0.75, 1.5, -1.5]), RIGHT = Float32Array.from([0, -0.5, 0.5, 0.75, 1.5, -1.5]);
  class AudioContext {
    constructor(options) {
      made.contexts.push(options);
      this.state = 'suspended';
      this.currentTime = 3;
      this.destination = {};
      this.resumed = 0;
      this.audioWorklet = { addModule: (url) => { made.modules.push(url); return Promise.resolve(); } };
    }
    resume() { this.resumed++; this.state = 'running'; return Promise.resolve(); }
    createGain() { const g = wired({ gain: new Param(1) }); made.gains.push(g); return g; }
    decodeAudioData(data, ok) { made.decoded.push(data); ok({ length: 6, numberOfChannels: 2, duration: 200, getChannelData: (c) => (c ? RIGHT : LEFT) }); }
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
  let clock = 1000;
  const win = {
    AudioContext, AudioWorkletNode,
    performance: { now: () => clock },
    addEventListener(type, fn, capture) { listeners[type] = { fn, capture }; },
    fetch(url, options) { made.fetched.push(url); made.fetchedWith.push(options); return Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }); },
  };
  const Scrub = load();
  Scrub.listen(win);
  check('it listens for every gesture, in capture', ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'].every((t) => listeners[t] && listeners[t].capture === true));
  listeners.click.fn();
  Scrub.load(new ArrayBuffer(4));
  Scrub.play();
  Scrub.seek(40);
  await settle();
  check('nothing is made by a gesture, nor by what is asked before it is made', made.contexts.length === 0 && made.fetched.length === 0 && made.decoded.length === 0);
  check('what was asked is kept', Scrub.going && Scrub.aim === 40 && Scrub.playing() && Scrub.heard() === 40);

  Scrub.make(win);
  check('made, there is one context at 44.1 khz, woken', made.contexts.length === 1 && made.contexts[0].sampleRate === 44100 && Scrub.ctx.state === 'running');
  await settle();
  check('the worklet is loaded and the wasm fetched', /^js\/scrub-worklet\.js\?\d+$/.test(made.modules[0]) && made.fetched[0] === 'scrub/scrub.wasm', made.modules[0]);
  check('neither from the cache', made.fetchedWith[0] && made.fetchedWith[0].cache === 'no-cache');
  const node = made.nodes[0];
  check('its node is made, mono, with no input, the wasm and the catch with it',
    made.nodes.length === 1 && node.name === 'scrub' && node.options.numberOfInputs === 0 && node.options.outputChannelCount[0] === 1
    && node.options.processorOptions.wasm instanceof ArrayBuffer && node.options.processorOptions.seconds === Scrub.CATCH);
  check('and plays through the master gain', made.gains.length === 1 && made.wires.length === 2 && made.wires[0][0] === node && made.wires[0][1] === made.gains[0] && made.wires[1][1] === Scrub.ctx.destination && made.gains[0].gain.value === Scrub.MASTER);
  Scrub.make(win);
  await settle();
  check('made again, nothing more is', made.contexts.length === 1 && made.nodes.length === 1);
  Scrub.ctx.state = 'interrupted';
  listeners.touchend.fn();
  check('a gesture wakes a context that is not running', Scrub.ctx.state === 'running' && Scrub.ctx.resumed === 2);

  const file = new ArrayBuffer(16);
  Scrub.load(file);
  await settle();
  check('the sound is decoded, and kept until the worklet is ready', made.decoded[0] === file && made.posted.length === 0 && Scrub.seconds === 200 && !Scrub.loaded);
  node.port.onmessage({ data: { ready: true } });
  const first = made.posted[0];
  check('ready, it is handed over whole', made.posted.length === 1 && first.sound.length === 6 && made.moved[0].length === 1 && made.moved[0][0] === first.sound.buffer && Scrub.sound === null);
  check('its channels mixed to one of sixteen bits, turned down to fit', Array.from(first.sound).join() === [0, 0, 0, 16384, 32767, -32767].join() && Scrub.level === 1.5, Array.from(first.sound).join(' '));
  check('and the master gain makes up for it', made.gains[0].gain.value === Scrub.MASTER * 1.5);
  check('until the sound is in, nothing else goes to the worklet', (Scrub.seek(50), Scrub.pause(), Scrub.play(), Scrub.hold(true), Scrub.hold(false), made.posted.length === 1));
  node.port.onmessage({ data: { loaded: true } });
  check('in, it is put where it was last sought, at rest, and played as it was meant to be',
    Scrub.loaded && made.posted.length === 3 && made.posted[1].cut === 50 && made.posted[1].n === Scrub.n && made.posted[2].speed === 1);
  check('and it is heard there', Scrub.heard() === 50 && !Scrub.locked);

  const count = () => made.posted.length, last = () => made.posted[made.posted.length - 1];
  let c = count();
  Scrub.pause();
  check('stopped, its target stands', count() === c + 1 && last().speed === 0 && !Scrub.playing());
  Scrub.pause();
  check('stopped again, nothing is said', count() === c + 1);
  Scrub.play();
  Scrub.hold(true);
  check('held, its target stands though it is playing', last().speed === 0 && Scrub.playing());
  Scrub.hold(true);
  c = count();
  Scrub.seek(120);
  check('sought, the worklet is told where, with a new count', count() === c + 1 && last().target === 120 && last().n === Scrub.n && Scrub.aim === 120);
  Scrub.seek(-5);
  Scrub.seek(999);
  check('no further than the sound\'s ends', made.posted[c + 1].target === 0 && last().target === 200);
  Scrub.seek(120);
  Scrub.hold(false);
  check('let go, it moves on', last().speed === 1);

  const seen = Scrub.n;
  node.port.onmessage({ data: { at: 60, aim: 119, going: 30, locked: false, n: seen - 1 } });
  check('what the worklet says of where it is heard is taken', Scrub.at === 60 && Scrub.by === 30 && !Scrub.locked);
  check('but not its target from before the page last moved it', Scrub.aim === 120);
  node.port.onmessage({ data: { at: 61, aim: 120.5, going: 30, locked: false, n: seen } });
  check('its target since is', Scrub.aim === 120.5);
  check('where it is heard is where it was last said', Scrub.heard() === 61);
  clock += 20;
  check('reckoned on at the speed it was going', near(Scrub.heard(), 61 + 30 * 0.02));
  clock += 500;
  check('no further than AHEAD', near(Scrub.heard(), 61 + 30 * Scrub.AHEAD));
  node.port.onmessage({ data: { at: 199.99, aim: 200, going: 1, locked: true, n: seen } });
  check('and no further than its end', Scrub.locked && (clock += 30, Scrub.heard() === 200));
  check('its target at its end, it has run out', !Scrub.playing() && Scrub.going);
  c = count();
  Scrub.play();
  check('played then, it is put at its start and plays', count() === c + 2 && made.posted[c].cut === 0 && last().speed === 1 && Scrub.aim === 0 && Scrub.heard() === 0 && Scrub.playing());

  Scrub.mute(true);
  check('muted, the master gain eases to silence', Scrub.muted && made.gains[0].gain.eased.length === 1 && made.gains[0].gain.eased[0].join() === [0, 3, Scrub.MUTE_S].join());
  Scrub.mute(false);
  check('and back, to as loud as the sound was', !Scrub.muted && made.gains[0].gain.eased[1].join() === [Scrub.MASTER * 1.5, 3, Scrub.MUTE_S].join());
  {
    const quiet = load(), before = made.gains.length;
    quiet.mute(true);
    quiet.make(win);
    await settle();
    check('a scrubber made muted starts at silence', made.gains.length === before + 1 && made.gains[before].gain.value === 0);
    const none = load();
    none.make({ fetch: win.fetch });
    check('with no worklet there is no sound, and nothing breaks', none.ctx === null && (none.load(new ArrayBuffer(1)), none.play(), none.seek(3), none.heard() === 3));
  }

  // --- the two halves joined --------------------------------------------------------
  {
    const S = load(), sentBack = [];
    let proc = null, time = 5000;
    class Node {
      constructor(context, name, options) {
        this.port = { onmessage: null, postMessage: (m) => proc.port.onmessage({ data: m }) };
        proc = new Processor.P(options);
        proc.port.postMessage = (m) => { sentBack.push(m); this.port.onmessage({ data: m }); };
      }
      connect() {}
    }
    const tones = Float32Array.from({ length: 6 * HZ }, (v, i) => ramp(i) / 32768);
    class Ctx extends AudioContext {
      decodeAudioData(data, ok) { ok({ length: tones.length, numberOfChannels: 1, duration: 6, getChannelData: () => tones }); }
    }
    const w = { AudioContext: Ctx, AudioWorkletNode: Node, performance: { now: () => time }, fetch: () => Promise.resolve({ arrayBuffer: () => Promise.resolve(bytes) }) };
    S.make(w);
    S.load(new ArrayBuffer(1));
    S.seek(1);
    S.play();
    for (let i = 0; i < 50 && !S.loaded; i++) await settle();
    check('joined, the sound goes in through both', S.ready && S.loaded && S.seconds === 6);
    const o = new Float32Array(BLOCK);
    const run = (seconds) => { for (let i = 0; i < blocks(seconds); i++) { proc.process([], [[o]]); time += 1000 * BLOCK / HZ; } };
    run(0.05);
    check('it starts where it was sought before the sound was in', S.at >= 1 && S.at < 1.02, S.at.toFixed(4));
    run(3);
    check('and plays, in step with its target', S.locked && S.by === 1 && near(S.heard(), 1 + 3.05 - S.CATCH, 0.02), S.heard().toFixed(3));
    S.hold(true);
    S.seek(5);
    run(0.02);
    check('sought on and held, it races after its target', !S.locked && S.by > 3 && S.aim === 5, S.by.toFixed(1) + ' times');
    run(4);
    check('and comes to rest on it', near(S.heard(), 5, 1e-3) && S.playing());
    S.hold(false);
    run(3);
    check('let go, it plays to its end and runs out', !S.playing() && near(S.heard(), 6, 0.01));
  }

  console.log(failures ? failures + ' failed' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
