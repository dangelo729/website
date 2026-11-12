// node tools/test/ship.test.js
//
// loads js/ship.js the way the page does, a classic script, in a vm
// context, and hands it a fake window whose fetch answers with the real
// the_ship/the_ship.wasm. checks that nothing is there before the wasm is
// in and that a turn or a step then does nothing, that the wasm needs no
// imports and is fetched once and checked with the server, and then the
// ship: its picture an ink bitmap on the wasm's memory, inked at once; a
// step drops the flatness raster.js keeps with it; a turn moves the yaw
// toward where it was turned, a step's share of the way at the scene's
// rate, and it settles there; turned a whole lap in small steps, no lit
// pixel ever touches the canvas's edge, the bottle whole at every yaw; at
// rest the picture keeps changing, the water swaying; and a step's dt is
// held to 0.1 s, a huge one drawing what 0.1 s draws. prints the canvas,
// where the lap's ink reached, and what init and a step cost. exits 1 on
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
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'ship.js'), 'utf8'), ctx, { filename: 'js/ship.js' });
const Ship = vm.runInContext('Ship', ctx);

// --- the fake window -----------------------------------------------------------
const wasm = fs.readFileSync(path.join(ROOT, 'the_ship', 'the_ship.wasm'));
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
const RATE = 8; // 1/s, the scene's turn rate (tools/the_ship-web/web_main.cpp)
const hold = (secs) => { for (let i = 0; i < Math.round(secs / DT); i++) Ship.step(DT); };

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
const yaw = () => Ship.mm.ship_yaw();

(async () => {
  // --- before the wasm is in ------------------------------------------------------
  check('nothing there before it is loaded', !Ship.ready && Ship.picture === null && fetched.length === 0);
  Ship.turn(1);
  Ship.step(DT);
  check('and a turn or a step does nothing', !Ship.ready && Ship.picture === null);

  // --- loaded ---------------------------------------------------------------------
  check('the wasm needs no imports', WebAssembly.Module.imports(new WebAssembly.Module(bytes())).length === 0);
  const t0 = process.hrtime.bigint();
  Ship.load(win);
  Ship.load(win);
  for (let i = 0; i < 200 && !Ship.ready; i++) await settle();
  const initMs = Number(process.hrtime.bigint() - t0) / 1e6;
  check('the wasm is fetched once, checked with the server', fetched.length === 1 && fetched[0].url === 'the_ship/the_ship.wasm' && fetched[0].options && fetched[0].options.cache === 'no-cache');
  check('and is in', Ship.ready);
  const pic = Ship.picture;
  check('its picture an ink bitmap, w x h, on the wasm\'s memory',
    Object.prototype.toString.call(pic.ink) === '[object Uint8Array]' && pic.ink.buffer === Ship.mm.memory.buffer && pic.ink.length === pic.w * pic.h && pic.w === Ship.mm.ship_w() && pic.h === Ship.mm.ship_h());
  console.log('     the canvas: ' + pic.w + ' x ' + pic.h + ' px, drawn at scale ' + Ship.SCALE + ', ' + pic.w * Ship.SCALE + ' x ' + pic.h * Ship.SCALE + ' world px');
  const first = lit(pic);
  check('inked at once, the bottle at rest', first.n > 0 && yaw() === 0, first.n + ' px lit');
  check('nothing but 0 and 1 in it', pic.ink.every((v) => v === 0 || v === 1));
  pic.flat = 'kept';
  Ship.step(DT);
  check('a step drops the flatness raster.js keeps with a bitmap', pic.flat === null);

  // --- a turn -----------------------------------------------------------------------
  hold(0.5);
  Ship.turn(1);
  Ship.step(DT);
  const share = 1 - Math.exp(-RATE * DT);
  check('a turn moves the yaw toward it, a step\'s share of the way', Math.abs(yaw() - share) < 1e-4, 'yaw ' + yaw().toFixed(4) + ' against ' + share.toFixed(4));
  hold(2);
  check('and it settles there', Math.abs(yaw() - 1) < 1e-3, 'yaw ' + yaw().toFixed(5));
  Ship.turn(NaN);
  Ship.step(DT);
  check('a turn that is not a number does nothing', Math.abs(yaw() - 1) < 1e-3);

  // --- a lap ------------------------------------------------------------------------
  // a lap a 720th at a time, a step each, and a second to settle: the
  // canvas's border never lit
  const W = pic.w, H = pic.h, N = 720;
  let touched = 0, frames = 0;
  const reach = { x0: W, x1: -1, y0: H, y1: -1 };
  const look = () => {
    const l = lit(pic);
    frames++;
    if (l.x0 <= 0 || l.y0 <= 0 || l.x1 >= W - 1 || l.y1 >= H - 1) touched++;
    reach.x0 = Math.min(reach.x0, l.x0); reach.x1 = Math.max(reach.x1, l.x1);
    reach.y0 = Math.min(reach.y0, l.y0); reach.y1 = Math.max(reach.y1, l.y1);
  };
  for (let k = 0; k < N; k++) {
    Ship.turn(2 * Math.PI / N);
    Ship.step(DT);
    look();
  }
  for (let k = 0; k < 60; k++) { Ship.step(DT); look(); }
  check('turned a whole lap, no lit pixel ever touches the canvas\'s edge', touched === 0,
    touched + ' of ' + frames + ' frames touch it; the ink reached x ' + reach.x0 + '..' + reach.x1 + ', y ' + reach.y0 + '..' + reach.y1);
  check('and the lap comes back to where it started', Math.abs(((yaw() - 1) % (2 * Math.PI) + 2 * Math.PI + Math.PI) % (2 * Math.PI) - Math.PI) < 1e-3, 'yaw ' + yaw().toFixed(4));
  console.log('     over the lap the ink reached x ' + reach.x0 + '..' + reach.x1 + ' of 0..' + (W - 1) + ', y ' + reach.y0 + '..' + reach.y1 + ' of 0..' + (H - 1));

  // --- at rest ----------------------------------------------------------------------
  const before = Uint8Array.from(pic.ink);
  const still = yaw();
  hold(1);
  const moved = apart(before, pic.ink);
  check('at rest the picture keeps changing, the water swaying', moved > 0 && Math.abs(yaw() - still) < 1e-3, moved + ' px changed in a second');

  // --- the clamp --------------------------------------------------------------------
  // two more ships, each turned 1: one stepped 10 s, one 0.1 s
  const make = () => {
    const x = new WebAssembly.Instance(new WebAssembly.Module(bytes()), {}).exports;
    if (x._initialize) x._initialize();
    x.ship_init();
    x.ship_turn(1);
    return x;
  };
  const a = make(), b = make();
  a.ship_step(10);
  b.ship_step(0.1);
  const inkOf = (x) => new Uint8Array(x.memory.buffer, x.ship_ink(), x.ship_w() * x.ship_h());
  check('a huge dt is held to 0.1 s: the yaw a tenth of a second on, and the picture the same',
    Math.abs(a.ship_yaw() - (1 - Math.exp(-RATE * 0.1))) < 1e-4 && a.ship_yaw() === b.ship_yaw() && apart(inkOf(a), inkOf(b)) === 0,
    'yaw ' + a.ship_yaw().toFixed(4) + ' and ' + b.ship_yaw().toFixed(4));

  // --- the cost -----------------------------------------------------------------------
  const s0 = process.hrtime.bigint(), M = 300;
  for (let i = 0; i < M; i++) { Ship.turn(0.01); Ship.step(DT); }
  console.log('     init takes ' + initMs.toFixed(1) + ' ms here, fetch and instantiate with it, and a step ' + (Number(process.hrtime.bigint() - s0) / 1e6 / M).toFixed(3) + ' ms');

  console.log(failures ? failures + ' failed' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
