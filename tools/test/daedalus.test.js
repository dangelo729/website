// node tools/test/daedalus.test.js
//
// loads js/daedalus.js the way the page does, a classic script, in a vm
// context, and hands it a fake window whose fetch answers with the real
// daedalus/body.wasm. checks that nothing is there before the wasm is in
// and that a point or a step then does nothing, that the wasm needs no
// imports and is fetched once and checked with the server, and then the
// body: its picture an ink bitmap on the wasm's memory, inked at once; a
// step drops the flatness raster.js keeps with it; with no pointer no arm
// strikes, every mallet stays by its rest point and the picture keeps
// changing, the beard and the head swaying; a pointer coming into an
// arm's reach is struck at once, the mallet's face inside a pixel of it
// the step it strikes (the head jolts that step, and the shoulder with it,
// under an arm aimed from where it was), and again and again while it
// stays, each of those after a
// windup, and the arm goes home when it leaves; a pointer
// that comes and goes inside a tenth of a second is swung at once, where
// it was; one that keeps moving is struck where it was, behind it; one on
// his head, out of every arm's reach, or in an arm's reach but on the far
// side of him from it, is left alone by it; a pointer led all
// round every shoulder at the reach's end never lights the canvas's edge
// nor a column outside the middle 122 the page's box shows; a point that
// is not a number does nothing; and a step's dt is held to 0.1 s. prints the canvas, where
// the ink reached, and what init and a step cost. exits 1 on failure.

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
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'daedalus.js'), 'utf8'), ctx, { filename: 'js/daedalus.js' });
const Daedalus = vm.runInContext('Daedalus', ctx);

// --- the fake window -----------------------------------------------------------
const wasm = fs.readFileSync(path.join(ROOT, 'daedalus', 'body.wasm'));
const bytes = () => wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.length);
const fetched = [];
const win = {
  fetch(url, options) {
    fetched.push({ url, options });
    return Promise.resolve({ arrayBuffer: () => Promise.resolve(bytes()) });
  },
};
const settle = () => new Promise((ok) => setImmediate(ok));

const DT = 1 / 60;
const ARMS = 4;
// the glue's numbers (tools/daedalus_body-web/web_main.cpp), canvas px: the
// shoulders at rest, top left, top right, bottom left, bottom right, from
// the head's pivot in the canvas's middle; where each arm's bell's lip is
// on his panel; how big his arms are against their size there, each arm's
// rest point its lip that many times as far from its shoulder; and the
// reach's far end
const W = 128, H = 132;
const SHOULDER = [[W / 2 - 13, H / 2 - 15], [W / 2 + 12, H / 2 - 15], [W / 2 - 13, H / 2 + 14], [W / 2 + 12, H / 2 + 14]];
const LIP = [[W / 2 - 39, H / 2 - 6], [W / 2 + 38, H / 2 - 6], [W / 2 - 37, H / 2 + 21.5], [W / 2 + 36, H / 2 + 21.5]];
const ARM = 1.25;
const REST = LIP.map((p, i) => [SHOULDER[i][0] + (p[0] - SHOULDER[i][0]) * ARM, SHOULDER[i][1] + (p[1] - SHOULDER[i][1]) * ARM]);
const FAR = 46;
// the columns the page's box shows (index.html: DAEDALUS.W at the
// picture's scale), about the canvas's middle
const SHOWN = 122;
// and, s: the longest a swing lasts, how long an arm's aim stays on its
// mark after a strike, and the shortest windup, the top left arm's
const SWING = 0.2, STAY = 0.25, WIND = 0.4;
// px: how near its mark a mallet's face is the step it strikes
const ON = 1;

// a picture's lit pixels: how many and their bounds, px
function lit(b) {
  let n = 0, x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    if (b.ink[y * b.w + x] !== 1) continue;
    n++;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { n, x0, x1, y0, y1 };
}
// how many pixels two inks differ by
const apart = (a, b) => a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0);
const strikes = () => Daedalus.mm.body_strikes();
const tip = (i) => [Daedalus.mm.body_tip_x(i), Daedalus.mm.body_tip_y(i)];
const far = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
// the page's pointer put on canvas (x, y): world px from the picture's middle
const pointAt = (x, y) => Daedalus.point((x - W / 2 + 0.5) * Daedalus.SCALE, (y - H / 2 + 0.5) * Daedalus.SCALE);
// secs of steps, with what each step's strikes were: the steps a strike
// came on, each { at, tips }, the step's number and every mallet's face
function hold(secs, each) {
  const hits = [];
  for (let k = 0; k < Math.round(secs / DT); k++) {
    if (each) each(k * DT);
    const was = strikes();
    Daedalus.step(DT);
    if (strikes() !== was) hits.push({ at: k, n: strikes() - was, tips: [0, 1, 2, 3].map(tip) });
  }
  return hits;
}

(async () => {
  // --- before the wasm is in ------------------------------------------------------
  check('nothing there before it is loaded', !Daedalus.ready && Daedalus.picture === null && fetched.length === 0);
  Daedalus.point(10, 10);
  Daedalus.pointOff();
  Daedalus.step(DT);
  check('and a point or a step does nothing', !Daedalus.ready && Daedalus.picture === null);

  // --- loaded ---------------------------------------------------------------------
  check('the wasm needs no imports', WebAssembly.Module.imports(new WebAssembly.Module(bytes())).length === 0);
  const t0 = process.hrtime.bigint();
  Daedalus.load(win);
  Daedalus.load(win);
  for (let i = 0; i < 200 && !Daedalus.ready; i++) await settle();
  const initMs = Number(process.hrtime.bigint() - t0) / 1e6;
  check('the wasm is fetched once, checked with the server', fetched.length === 1 && fetched[0].url === 'daedalus/body.wasm' && fetched[0].options && fetched[0].options.cache === 'no-cache');
  check('and is in', Daedalus.ready);
  const pic = Daedalus.picture;
  check('its picture an ink bitmap, w x h, on the wasm\'s memory',
    Object.prototype.toString.call(pic.ink) === '[object Uint8Array]' && pic.ink.buffer === Daedalus.mm.memory.buffer && pic.ink.length === pic.w * pic.h && pic.w === Daedalus.mm.body_w() && pic.h === Daedalus.mm.body_h());
  check('the canvas the size the page lays out for', pic.w === W && pic.h === H, pic.w + ' x ' + pic.h);
  console.log('     the canvas: ' + pic.w + ' x ' + pic.h + ' px, drawn at scale ' + Daedalus.SCALE + ', ' + pic.w * Daedalus.SCALE + ' x ' + pic.h * Daedalus.SCALE + ' world px');
  const first = lit(pic);
  check('inked at once, the body at rest', first.n > 0 && strikes() === 0, first.n + ' px lit');
  check('nothing but 0 and 1 in it', pic.ink.every((v) => v === 0 || v === 1));
  pic.flat = 'kept';
  Daedalus.step(DT);
  check('a step drops the flatness raster.js keeps with a bitmap', pic.flat === null);

  // every lit pixel so far, over the whole run
  const reach = { x0: W, x1: -1, y0: H, y1: -1 };
  let touched = 0, frames = 0;
  const look = () => {
    const l = lit(pic);
    frames++;
    if (l.x0 <= 0 || l.y0 <= 0 || l.x1 >= W - 1 || l.y1 >= H - 1) touched++;
    reach.x0 = Math.min(reach.x0, l.x0); reach.x1 = Math.max(reach.x1, l.x1);
    reach.y0 = Math.min(reach.y0, l.y0); reach.y1 = Math.max(reach.y1, l.y1);
  };

  // --- no pointer -------------------------------------------------------------------
  const before = Uint8Array.from(pic.ink);
  let hits = hold(3, look);
  const home = () => Math.max(...REST.map((r, i) => far(tip(i), r)));
  check('with no pointer no arm strikes, and every mallet stays by its rest point', hits.length === 0 && home() < 4, 'the furthest ' + home().toFixed(2) + ' px off');
  const moved = apart(before, pic.ink);
  check('and the picture keeps changing, the beard and the head swaying', moved > 0, moved + ' px changed in three seconds');

  // --- a pointer held -----------------------------------------------------------------
  // up and left of the top left shoulder, in its reach alone
  const P = [SHOULDER[0][0] - 20, SHOULDER[0][1] - 16];
  pointAt(P[0], P[1]);
  hits = hold(3, look);
  check('a pointer coming into an arm\'s reach is struck at once, no windup first', hits.length > 0 && hits[0].at * DT <= SWING, hits.length ? 'after ' + (hits[0].at * DT).toFixed(2) + ' s' : 'never');
  check('the mallet\'s face inside a pixel of it the step it strikes', hits.length > 0 && hits.every((h) => far(h.tips[0], P) < ON), hits.length ? 'the furthest ' + Math.max(...hits.map((h) => far(h.tips[0], P))).toFixed(2) + ' px off' : '');
  check('again and again while it stays', hits.length >= 3, hits.length + ' strikes in three seconds');
  const gaps = hits.slice(1).map((h, k) => (h.at - hits[k].at) * DT);
  check('each of those after a windup', gaps.length > 0 && Math.min(...gaps) >= STAY + WIND - DT, 'from ' + Math.min(...gaps).toFixed(2) + ' to ' + Math.max(...gaps).toFixed(2) + ' s apart');
  check('and by that arm alone', [1, 2, 3].every((i) => far(tip(i), REST[i]) < 4));
  Daedalus.pointOff();
  const left = strikes();
  hold(3, look);
  check('the pointer gone, the arm goes home', home() < 4 && strikes() - left <= 1, 'the furthest ' + home().toFixed(2) + ' px off');

  // --- a tap --------------------------------------------------------------------------
  const T = [SHOULDER[3][0] + 18, SHOULDER[3][1] + 20];
  pointAt(T[0], T[1]);
  hits = hold(0.1, look);
  Daedalus.pointOff();
  hits = hits.concat(hold(3, look));
  check('a pointer that comes and goes inside a tenth of a second is swung at once, where it was',
    hits.length === 1 && far(hits[0].tips[3], T) < ON, hits.length + ' strikes' + (hits.length ? ', ' + far(hits[0].tips[3], T).toFixed(2) + ' px off' : ''));

  // --- a pointer that keeps moving ------------------------------------------------------
  // across the two upper arms' reach and back, 120 px a second
  const SPEED = 120, Y = SHOULDER[0][1] - 22, X0 = 24, X1 = 104;
  let at = [X0, Y];
  const sweep = (t) => {
    const u = (t * SPEED) % (2 * (X1 - X0));
    at = [X0 + (u < X1 - X0 ? u : 2 * (X1 - X0) - u), Y];
    pointAt(at[0], at[1]);
  };
  // each strike: how many steps back the pointer was nearest where the
  // mallet's face that struck is now, how near that was, and how far the
  // face is from where the pointer is now
  const trail = [], swings = [];
  for (let k = 0; k < 6 / DT; k++) {
    sweep(k * DT);
    trail.unshift(at);
    if (trail.length > 30) trail.pop();
    Daedalus.step(DT);
    look();
    for (let i = 0; i < ARMS; i++) {
      if (!(Daedalus.mm.body_struck() & (1 << i))) continue;
      const q = tip(i);
      let best = null;
      trail.forEach((p, ago) => { if (!best || far(q, p) < best.near) best = { ago, near: far(q, p), off: far(q, at) }; });
      swings.push(best);
    }
  }
  check('a pointer that keeps moving is swung at', swings.length > 0, swings.length + ' strikes in six seconds');
  check('and struck where it was, behind it', swings.length > 0 && swings.every((w) => w.near < ON && w.ago >= 1 && w.off > 1),
    swings.length ? 'from ' + Math.min(...swings.map((w) => w.off)).toFixed(2) + ' to ' + Math.max(...swings.map((w) => w.off)).toFixed(2) + ' px off it, ' + Math.min(...swings.map((w) => w.ago)) + ' to ' + Math.max(...swings.map((w) => w.ago)) + ' steps late' : '');
  Daedalus.pointOff();
  hold(2, look);

  // --- left alone -----------------------------------------------------------------------
  let was = strikes();
  pointAt(W / 2 - 0.5, H / 2 - 0.5);
  hold(2, look);
  check('a pointer on his head is left alone', strikes() === was && home() < 4);
  pointAt(W / 2 - 0.5, 1);
  hold(2, look);
  pointAt(2, H / 2);
  hold(2, look);
  check('and so is one out of every arm\'s reach', strikes() === was && home() < 4);
  // left of his head, in both left arms' reach, and in the right arms'
  // too but for his head between
  const L = [W / 2 - 26, H / 2];
  check('a pointer beside his head is in reach of the arms both sides of him', [0, 1, 2, 3].every((i) => far(SHOULDER[i], L) < FAR));
  pointAt(L[0], L[1]);
  const sides = [0, 0, 0, 0];
  for (let k = 0; k < 3 / DT; k++) {
    Daedalus.step(DT);
    look();
    for (let i = 0; i < ARMS; i++) if (Daedalus.mm.body_struck() & (1 << i)) sides[i]++;
  }
  check('and is struck by the arms on its side alone', sides[0] > 0 && sides[2] > 0 && sides[1] === 0 && sides[3] === 0, sides.join(', ') + ' strikes an arm');
  Daedalus.pointOff();
  hold(2, look);
  was = strikes();
  Daedalus.point(NaN, 0);
  hold(1, look);
  check('a point that is not a number does nothing', strikes() === was && home() < 4);

  // --- the reach --------------------------------------------------------------------------
  // the pointer led round each shoulder at the reach's end, 10 degrees a
  // step and three quarters of a second on each
  for (let i = 0; i < ARMS; i++) for (let a = 0; a < 360; a += 10) {
    pointAt(SHOULDER[i][0] + FAR * Math.cos(a * Math.PI / 180), SHOULDER[i][1] + FAR * Math.sin(a * Math.PI / 180));
    hold(0.75, look);
  }
  Daedalus.pointOff();
  hold(2, look);
  check('led all round every shoulder, no lit pixel ever touches the canvas\'s edge', touched === 0,
    touched + ' of ' + frames + ' frames touch it; the ink reached x ' + reach.x0 + '..' + reach.x1 + ', y ' + reach.y0 + '..' + reach.y1);
  const col0 = (W - SHOWN) / 2, col1 = col0 + SHOWN - 1;
  check('nor a column outside the middle the page\'s box shows', reach.x0 >= col0 && reach.x1 <= col1, 'x ' + reach.x0 + '..' + reach.x1 + ' in ' + col0 + '..' + col1);
  console.log('     over the run the ink reached x ' + reach.x0 + '..' + reach.x1 + ' of 0..' + (W - 1) + ', y ' + reach.y0 + '..' + reach.y1 + ' of 0..' + (H - 1));

  // --- the clamp --------------------------------------------------------------------------
  // two more bodies, a pointer in reach of each: one stepped 10 s, one 0.1 s
  const make = () => {
    const x = new WebAssembly.Instance(new WebAssembly.Module(bytes()), {}).exports;
    if (x._initialize) x._initialize();
    x.body_init();
    x.body_point(P[0], P[1]);
    return x;
  };
  const a = make(), b = make();
  a.body_step(10);
  b.body_step(0.1);
  const inkOf = (x) => new Uint8Array(x.memory.buffer, x.body_ink(), x.body_w() * x.body_h());
  check('a huge dt is held to 0.1 s: the mallet where a tenth of a second puts it, and the picture the same',
    a.body_tip_x(0) === b.body_tip_x(0) && a.body_tip_y(0) === b.body_tip_y(0) && apart(inkOf(a), inkOf(b)) === 0,
    'at ' + a.body_tip_x(0).toFixed(3) + ', ' + a.body_tip_y(0).toFixed(3));

  // --- the cost -----------------------------------------------------------------------------
  pointAt(P[0], P[1]);
  const s0 = process.hrtime.bigint(), M = 600;
  for (let i = 0; i < M; i++) Daedalus.step(DT);
  console.log('     init takes ' + initMs.toFixed(1) + ' ms here, fetch and instantiate with it, and a step ' + (Number(process.hrtime.bigint() - s0) / 1e6 / M).toFixed(3) + ' ms');

  console.log(failures ? failures + ' failed' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
