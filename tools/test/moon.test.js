// node tools/test/moon.test.js
//
// loads js/moon.js the way the page does, a classic script, in a vm
// context, and hands it a fake window whose fetch answers with the real
// moon_man/moon_man.wasm. checks that nothing is there before the wasm is
// in, that it is fetched once and checked with the server, that the art
// handed in before it is kept for it, and then the face: the features in
// the page's order, each a paper and an ink bitmap on the wasm's memory;
// silent, the mouth shut and the gaze home, the sprites' canvases holding
// the art at SCALE, the right eye the left's mirrored; fed a held open
// vowel's state, the lips open up; at each syllable's onset the head turns,
// and every feature's place, and the lips' ink as third_dimension renders
// it, moves the way the turn says, the lips furthest, then the nose, then
// the eyes, as far as each stands out from the head; an L brings the
// tongue out over the lower lip, below its inner edge; silence brings the
// gaze home but for the idle glance, and shuts the mouth; a vowel held on
// holds the head still, with no idle glance while it sings; silent, the
// head keeps glancing a little, never past the idle glance's cone; and art
// handed in again shows at the next
// step. the voice's states are made here, their tube an open vowel's as
// monk_mouth's voice holds it (22 sections, AA at midi 57). prints each
// feature's canvas and where it sits, and what a step costs. exits 1 on
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
const ctx = vm.createContext({ WebAssembly });
vm.runInContext('Math.random = () => 0.5', ctx); // the gaze's seed, the same every run
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'moon.js'), 'utf8'), ctx, { filename: 'js/moon.js' });
const Moon = vm.runInContext('Moon', ctx);

// --- the fake window -----------------------------------------------------------
const wasm = fs.readFileSync(path.join(ROOT, 'moon_man', 'moon_man.wasm'));
const fetched = [];
const win = {
  fetch(url, options) {
    fetched.push({ url, options });
    return Promise.resolve({ arrayBuffer: () => Promise.resolve(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.length)) });
  },
};
const settle = () => new Promise((ok) => setImmediate(ok));

// --- the voice's states ----------------------------------------------------------
// the tube of an open vowel held, glottis to lips, as monk_mouth's voice
// holds AA; a sung state on it, breath 0.8 and voiced, its lips open, the
// phoneme ph, the first constriction slot holding the tract or not
const TUBE = [0.6, 0.6, 0.6, 1.1, 1.1, 0.67, 0.58, 0.6, 0.71, 0.89, 1.14, 1.42, 1.71, 1.98, 2.2, 2.35, 2.42, 2.4, 2.27, 1.5, 1.5, 1.5];
const PH = { AA: 1, AE: 2, L: 25 };
function sung(ph, slot) {
  const s = new Float32Array(11 + TUBE.length);
  s.set([0.8, 0.7, 0, 0, 0, 1, 0, ph, slot ? 1 : 0, 0, TUBE.length]);
  s.set(TUBE, 11);
  return s;
}
const DT = 1 / 60;
const IDLE = 0.12; // radians, the idle glance's cone, as tools/moon_man-web/web_main.cpp has it
// secs of frames, each fed state
const hold = (state, secs) => { for (let i = 0; i < Math.round(secs / DT); i++) Moon.step(state, DT); };

// --- the bitmaps -------------------------------------------------------------------
const feature = (name) => Moon.features.find((f) => f.name === name);
// a bitmap's lit pixels: how many, their bounds and their middle, px
function lit(b) {
  let n = 0, sx = 0, sy = 0, x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    if (b.ink[y * b.w + x] !== 1) continue;
    n++; sx += x + 0.5; sy += y + 0.5;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { n, x0, x1, y0, y1, cx: sx / n, cy: sy / n };
}
const copy = (b) => ({ ink: Uint8Array.from(b.ink), w: b.w, h: b.h });
// whether a sprite feature's paper and ink hold rows at SCALE, the art's
// middle on the canvas's middle, mirrored if flip, and nothing else
function holds(f, rows, flip) {
  const S = Moon.SCALE, h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const W = f.ink.w, H = f.ink.h, x0 = (W - S * w) / 2, y0 = (H - S * h) / 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = Math.floor((x - x0) / S), v = Math.floor((y - y0) / S);
    const c = u >= 0 && u < w && v >= 0 && v < h ? rows[v][flip ? w - 1 - u : u] : '.';
    const i = y * W + x;
    if (f.paper.ink[i] !== (c === '#' || c === 'o' ? 1 : 0) || f.ink.ink[i] !== (c === '#' ? 1 : 0)) return false;
  }
  return true;
}

const EYE = [
  '..#####..',
  '.#ooooo#.',
  '#oooo##o#',
  '#oooo##o#',
  '#oooo##o#',
  '.#ooooo#.',
  '..#####..',
];
const NOSE = [
  '..#..',
  '.#o#.',
  '.#o#.',
  '#ooo#',
  '.###.',
];

(async () => {
  // --- before the wasm is in ------------------------------------------------------
  check('nothing there before it is loaded', !Moon.ready && Moon.features.length === 0 && fetched.length === 0);
  Moon.step(null, DT);
  check('and a step does nothing', !Moon.ready && Moon.features.length === 0);
  Moon.art(EYE, NOSE);
  check('the art handed in before it is in is kept', Moon.rows && Moon.rows[0] === EYE && Moon.rows[1] === NOSE);

  // --- loaded ---------------------------------------------------------------------
  Moon.load(win);
  Moon.load(win);
  for (let i = 0; i < 200 && !Moon.ready; i++) await settle();
  check('the wasm is fetched once, checked with the server', fetched.length === 1 && fetched[0].url === 'moon_man/moon_man.wasm' && fetched[0].options && fetched[0].options.cache === 'no-cache');
  check('and is in', Moon.ready);
  const names = Moon.features.map((f) => f.name);
  check('four features in the order the page draws them', names.join() === 'lips,nose,leftEye,rightEye', names.join());
  const buf = Moon.mm.memory.buffer;
  check('each a paper and an ink bitmap, w x h, on the wasm\'s memory',
    Moon.features.every((f) => [f.paper, f.ink].every((b) => Object.prototype.toString.call(b.ink) === '[object Uint8Array]' && b.ink.buffer === buf && b.ink.length === b.w * b.h && b.w > 0 && b.h > 0) &&
      f.paper.w === f.ink.w && f.paper.h === f.ink.h));
  check('the lips drawn at SCALE, the sprites at 1, SCALE 2', Moon.SCALE === 2 && Moon.features.every((f) => f.scale === (f.name === 'lips' ? Moon.SCALE : 1)));

  // --- silent, at rest -----------------------------------------------------------------
  const lips = feature('lips'), nose = feature('nose'), eyeL = feature('leftEye'), eyeR = feature('rightEye');
  hold(null, 0.5);
  const shut = lit(lips.paper);
  check('silent, the gaze is home', Moon.mm.moon_yaw() === 0 && Moon.mm.moon_pitch() === 0 && nose.x === 0 && eyeL.x === -eyeR.x && eyeL.y === eyeR.y && eyeL.x < 0,
    'eyes at ' + eyeL.x.toFixed(2) + ', ' + eyeL.y.toFixed(2) + ' and ' + eyeR.x.toFixed(2) + ', nose at ' + nose.x.toFixed(2) + ', ' + nose.y.toFixed(2));
  check('and the mouth is shut: its lips cover a band under 12 face px tall', shut.n > 0 && shut.y1 - shut.y0 + 1 < 12, (shut.y1 - shut.y0 + 1) + ' px');
  check('the left eye\'s canvas holds its art at SCALE', holds(eyeL, EYE, false), eyeL.ink.w + ' x ' + eyeL.ink.h);
  check('the right eye\'s holds it mirrored', holds(eyeR, EYE, true), eyeR.ink.w + ' x ' + eyeR.ink.h);
  check('the nose\'s holds its art', holds(nose, NOSE, false), nose.ink.w + ' x ' + nose.ink.h);
  const lipsAt = [lips.x, lips.y, lips.paper.w, lips.paper.h].join();
  for (const f of Moon.features) console.log('     ' + f.name + ': ' + f.paper.w + ' x ' + f.paper.h + ' px at scale ' + f.scale + ', its middle at ' + f.x.toFixed(2) + ', ' + f.y.toFixed(2) + ' world px from the head\'s centre');
  lips.ink.flat = 'kept';
  Moon.step(null, DT);
  check('a step drops the flatness raster.js keeps with a bitmap', lips.ink.flat === null && lips.paper.flat === null);

  // --- an open vowel ---------------------------------------------------------------
  hold(sung(PH.AA, false), 0.6);
  const open = lit(lips.paper);
  check('a held open vowel opens the mouth up: its lips cover half again the height or more, down past where they were',
    open.y1 - open.y0 + 1 >= 1.5 * (shut.y1 - shut.y0 + 1) && open.y1 > shut.y1, (shut.y1 - shut.y0 + 1) + ' px to ' + (open.y1 - open.y0 + 1));

  // --- the turn ------------------------------------------------------------------
  // a vowel to another vowel is an onset: the head turns, the mouth the same
  // shape. each pair of frames after one compared: on a yaw, every feature
  // moves across the opposite way, the lips furthest, then the nose, then
  // the eyes; on a pitch, every feature moves up for up
  const now = () => {
    const l = lit(lips.ink);
    return { yaw: Moon.mm.moon_yaw(), pitch: Moon.mm.moon_pitch(), lips: [lips.x + Moon.SCALE * (l.cx - lips.ink.w / 2), lips.y + Moon.SCALE * (l.cy - lips.ink.h / 2)],
      nose: [nose.x, nose.y], eyes: [(eyeL.x + eyeR.x) / 2, (eyeL.y + eyeR.y) / 2] };
  };
  let before = now(), across = 0, upDown = 0, wrong = [], order = 0, disorder = [];
  for (let i = 0; i < 12; i++) {
    hold(sung(i % 2 ? PH.AA : PH.AE, false), 0.6);
    const after = now(), dy = after.yaw - before.yaw, dp = after.pitch - before.pitch;
    const d = (k, j) => after[k][j] - before[k][j];
    if (Math.abs(dy) >= 0.05) {
      across++;
      if (!['lips', 'nose', 'eyes'].every((k) => Math.sign(d(k, 0)) === -Math.sign(dy))) wrong.push('yaw ' + dy.toFixed(3) + ': ' + ['lips', 'nose', 'eyes'].map((k) => d(k, 0).toFixed(2)).join(' '));
      if (Math.abs(dy) >= 0.1) {
        order++;
        if (!(Math.abs(d('lips', 0)) > Math.abs(d('nose', 0)) && Math.abs(d('nose', 0)) > Math.abs(d('eyes', 0)))) disorder.push(['lips', 'nose', 'eyes'].map((k) => d(k, 0).toFixed(2)).join(' '));
      }
    }
    if (Math.abs(dp) >= 0.05) {
      upDown++;
      if (!['lips', 'nose', 'eyes'].every((k) => Math.sign(d(k, 1)) === -Math.sign(dp))) wrong.push('pitch ' + dp.toFixed(3) + ': ' + ['lips', 'nose', 'eyes'].map((k) => d(k, 1).toFixed(2)).join(' '));
    }
    before = after;
  }
  check('each onset turns the head', across >= 3 && upDown >= 3, across + ' turns across and ' + upDown + ' up or down of 12');
  check('and the lips as rendered, the nose and the eyes all move the way it turns: across against the yaw, up with the pitch', wrong.length === 0, wrong.join('; '));
  check('across, the lips furthest, then the nose, then the eyes', order > 0 && disorder.length === 0, order + ' turns' + (disorder.length ? ': ' + disorder.join('; ') : ''));
  check('the lips\' canvas stays where it is', [lips.x, lips.y, lips.paper.w, lips.paper.h].join() === lipsAt);

  // --- the tongue ----------------------------------------------------------------
  // the lower lip's inner edge and its bottom at the mouth's middle: up from
  // the lips' lowest ink in that column, the first ink over a gap
  hold(sung(PH.AA, false), 0.8);
  const wide = copy(lips.ink), mid = Math.floor(lit(wide).cx);
  let bottom = -1, inner = -1;
  for (let y = wide.h - 1; y >= 0 && inner < 0; y--) {
    const on = wide.ink[y * wide.w + mid] === 1;
    if (on && bottom < 0) bottom = y;
    else if (on && bottom >= 0 && wide.ink[(y + 1) * wide.w + mid] === 0) inner = y;
  }
  hold(sung(PH.L, true), 0.3);
  let below = 0;
  for (let y = inner + 1; y < bottom; y++) for (let x = mid - 2; x <= mid + 2; x++) {
    const i = y * wide.w + x;
    if (lips.ink.ink[i] === 1 && wide.ink[i] === 0) below++;
  }
  check('an L brings the tongue out over the lower lip: new ink at the mouth\'s middle below the lip\'s inner edge',
    inner >= 0 && below > 0, 'inner edge at row ' + inner + ', bottom at ' + bottom + ', ' + below + ' px of tongue between');

  // --- singing, no idle glance -------------------------------------------------------
  // a vowel held on, one gaze for the whole of it: settled for a second,
  // then looked at every half second for 4 s, the head holds still
  hold(sung(PH.AA, false), 1);
  const held = [Moon.mm.moon_yaw(), Moon.mm.moon_pitch()];
  let drift = 0;
  for (let i = 0; i < 8; i++) {
    hold(sung(PH.AA, false), 0.5);
    drift = Math.max(drift, Math.hypot(Moon.mm.moon_yaw() - held[0], Moon.mm.moon_pitch() - held[1]));
  }
  check('while it sings there is no idle glance: a vowel held 4 s holds the head still', drift < 1e-3, 'it moved ' + drift.toExponential(1) + ' rad');

  // --- silence ---------------------------------------------------------------------
  hold(null, 1.5);
  const after = lit(lips.paper);
  const off = () => Math.hypot(Moon.mm.moon_yaw(), Moon.mm.moon_pitch());
  check('silence brings the gaze home but for the idle glance: the head turned no further than its cone', off() <= IDLE + 1e-3,
    'yaw ' + Moon.mm.moon_yaw().toFixed(3) + ', pitch ' + Moon.mm.moon_pitch().toFixed(3));
  check('and shuts the mouth', after.y1 - after.y0 <= shut.y1 - shut.y0 + 1, (after.y1 - after.y0 + 1) + ' px tall');

  // --- the idle glance ---------------------------------------------------------------
  // silent for 12 s, looked at every half second: the head moves to a new
  // look again and again, and never further than the idle glance's cone
  let looks = 0, most = 0, was = [Moon.mm.moon_yaw(), Moon.mm.moon_pitch()];
  for (let i = 0; i < 24; i++) {
    hold(null, 0.5);
    const is = [Moon.mm.moon_yaw(), Moon.mm.moon_pitch()];
    if (Math.hypot(is[0] - was[0], is[1] - was[1]) > 0.01) looks++;
    most = Math.max(most, off());
    was = is;
  }
  check('silent, the head keeps glancing a little', looks >= 4, looks + ' new looks in 12 s');
  check('never past the idle glance\'s cone', most > 0.02 && most <= IDLE + 1e-3, 'the most ' + most.toFixed(3) + ' rad');

  // --- art again ----------------------------------------------------------------------
  const EYE2 = ['##oo', '#..o', 'oo##'];
  const NOSE2 = ['.#.', '#o#'];
  hold(null, 1);
  Moon.art(EYE2, NOSE2);
  check('art handed in again sizes the canvases at once, each view on its size',
    [eyeL, eyeR, nose].every((f) => f.ink.ink.length === f.ink.w * f.ink.h && f.paper.ink.length === f.ink.w * f.ink.h) && eyeL.ink.w < 22, eyeL.ink.w + ' x ' + eyeL.ink.h);
  Moon.step(null, DT);
  check('and shows at the next step, the right eye mirrored', holds(eyeL, EYE2, false) && holds(eyeR, EYE2, true) && holds(nose, NOSE2, false));

  // --- the cost ------------------------------------------------------------------------
  const t0 = process.hrtime.bigint(), N = 600;
  for (let i = 0; i < N; i++) Moon.step(sung(i % 60 < 30 ? PH.AA : PH.AE, false), DT);
  console.log('     a sung step takes ' + (Number(process.hrtime.bigint() - t0) / 1e6 / N).toFixed(3) + ' ms here');

  console.log(failures ? failures + ' failed' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
