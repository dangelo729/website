// node tools/test/keys.test.js
//
// loads js/keys.js the way the page does, a classic script, in a vm
// context, and hands it a fake window whose fetch answers with the real
// saloon/keys.wasm. checks that nothing is there before the wasm is in and
// that a note, a step or a look for a key then does nothing, that the wasm
// needs no imports and is fetched once and checked with the server, and
// then the keys: their picture an ink bitmap on the wasm's memory, facing
// the player, a line along the keys' backs at its top, the black keys ink
// under it and the white keys outlines with paper inside, their fronts at
// its bottom; a second picture the same size, of the outlines of the keys
// that glow, empty at rest; a step drops the flatness raster.js keeps
// with each; a note on puts its key down at once and holds it there, its
// outline in the second picture and nothing else's, and a note off lets
// it rise back to the picture it was, inside a tenth of a second; a key
// pointed at glows as one that is down does, without going down, until
// another is or none; each of the
// seventeen notes has a key of its own; a note in another octave goes down
// on the key of its name and moves the window by as few octaves as take it
// in, where a press then plays;
// two notes on one key share it, and it rises with the last; every key
// found by where it is drawn, the black keys over the white, and none off
// the picture; all the keys let go at once; and a step's dt that is not a
// number, or under 0, moves nothing. prints the picture. exits 1 on
// failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}

// --- the script --------------------------------------------------------------
const ctx = vm.createContext({ WebAssembly });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'keys.js'), 'utf8'), ctx, { filename: 'js/keys.js' });
const Keys = vm.runInContext('Keys', ctx);

// --- the fake window -----------------------------------------------------------
const wasm = fs.readFileSync(path.join(ROOT, 'saloon', 'keys.wasm'));
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
// saloon's keys (saloon/src/keys): seventeen notes from c4, a pressed key
// down 2 px, the black keys' places among the seventeen
const FIRST = 60, COUNT = 17, PRESS = 2;
const BLACK = [1, 3, 6, 8, 10, 13, 15];

(async () => {
  // --- before the wasm ---------------------------------------------------------
  check('nothing ready before it is asked for', !Keys.ready && Keys.picture === null);
  Keys.on(60);
  Keys.off(60);
  Keys.allOff();
  Keys.point(60);
  Keys.step(DT);
  check('a note and a step before the wasm do nothing, and no key is found', Keys.at(0, 0) === -1 && !Keys.ready);

  // --- the wasm ----------------------------------------------------------------
  const imports = WebAssembly.Module.imports(new WebAssembly.Module(wasm));
  check('the wasm needs no imports', imports.length === 0, imports.map((i) => i.module + '.' + i.name).join(' '));
  Keys.load(win);
  Keys.load(win);
  for (let i = 0; i < 50 && !Keys.ready; i++) await settle();
  check('the wasm is fetched once, and checked with the server', fetched.length === 1 && fetched[0].url === 'saloon/keys.wasm' && fetched[0].options.cache === 'no-cache', fetched.length);
  check('the keys are ready', Keys.ready);
  if (!Keys.ready) { console.log('1 failed'); process.exit(1); }
  const mm = Keys.mm, p = Keys.picture, w = p.w, h = p.h;
  const snap = () => Buffer.from(p.ink);
  const down = (s) => mm.keys_down(s);

  // --- the picture ---------------------------------------------------------------
  check('the picture is an ink bitmap on the wasm\'s memory', p.ink.buffer === mm.memory.buffer && p.ink.length === w * h && w === 121 && h === 22, w + ' x ' + h);
  const hp = Keys.glow;
  check('and so is the picture of the keys that glow, the same size', hp.ink.buffer === mm.memory.buffer && hp.ink !== p.ink && hp.w === w && hp.h === h);
  const rest = snap();
  const heldNow = () => Buffer.from(hp.ink);
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) row += rest[y * w + x] ? '#' : '.';
    console.log(row);
  }
  let ink = 0;
  for (const v of rest) ink += v;
  check('every pixel is ink or not, and most are paper', rest.every((v) => v === 0 || v === 1) && ink > 0 && ink < w * h / 2, ink + ' of ' + w * h);
  const rowInk = (y) => { let n = 0; for (let x = 0; x < w; x++) n += rest[y * w + x]; return n; };
  check('a line along the keys\' backs, at the top', rowInk(0) === w);
  // a row through the white keys near their fronts: a line between each two and one at each end
  const FRONT = h - 6, BACK = 6;
  const runs = (y) => { let n = 0; for (let x = 0; x < w; x++) if (!rest[y * w + x] && (x === 0 || rest[y * w + x - 1])) n++; return n; };
  check('ten white keys, each an outline with paper inside', runs(FRONT) === 10 && rowInk(FRONT) === 11, runs(FRONT) + ' runs, ' + rowInk(FRONT) + ' ink');
  // a row through the black keys: a run of ink wider than a line is one of them
  const wide = (y) => { let n = 0, run = 0; for (let x = 0; x <= w; x++) { if (x < w && rest[y * w + x]) run++; else { if (run > 1) n++; run = 0; } } return n; };
  check('seven black keys, ink all over, under the line along the backs', wide(BACK) === 7, wide(BACK));
  check('and none near the fronts: the keys face the player', wide(FRONT) === 0, wide(FRONT));
  check('nothing glows at rest', heldNow().every((v) => v === 0));

  // --- a step ------------------------------------------------------------------
  p.flat = new Uint8Array(1);
  hp.flat = new Uint8Array(1);
  Keys.step(DT);
  check('a step drops the flatness kept with each picture', p.flat === null && hp.flat === null);
  check('at rest a step leaves the picture as it was', snap().equals(rest));

  // --- a key down, and up ----------------------------------------------------------
  Keys.on(64);
  check('a note on puts its key down at once', down(4) === PRESS, down(4));
  Keys.step(DT);
  const held = snap();
  check('and the picture shows it', !held.equals(rest));
  // e4 is the third white key: its body between columns 24 and 36, the lines it shares with its neighbours
  const lit = heldNow();
  let litN = 0, inKey = true, onInk = true;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (lit[y * w + x]) { litN++; if (x < 24 || x > 36) inKey = false; if (!held[y * w + x]) onInk = false; }
  check('its outline is in the picture of the keys that glow, and nothing else\'s', litN > 20 && inKey && onInk, litN + ' px');
  // a row over its front, which is two rows back from where it lies at rest
  const SIDE = FRONT - 2;
  check('a line down each of its sides and along its back, and paper inside', lit[SIDE * w + 24] === 1 && lit[SIDE * w + 36] === 1 && lit[30] === 1 && lit[SIDE * w + 30] === 0 && held[SIDE * w + 30] === 0);
  for (let i = 0; i < 60; i++) Keys.step(DT);
  check('held, it stays down', down(4) === PRESS && snap().equals(held) && heldNow().equals(lit));
  Keys.off(64);
  let steps = 0;
  while (down(4) > 0 && steps < 60) { Keys.step(DT); steps++; }
  check('let go, it rises to rest inside a tenth of a second', down(4) === 0 && steps * DT <= 0.1, (steps * DT).toFixed(3) + ' s');
  Keys.step(DT);
  check('and the picture is the one it was, with nothing glowing', snap().equals(rest) && heldNow().every((v) => v === 0));

  // --- a key pointed at ------------------------------------------------------------------
  Keys.point(64);
  check('a key pointed at glows from the next step, not before', heldNow().every((v) => v === 0));
  Keys.step(DT);
  const pointed = heldNow();
  let pointN = 0, pointIn = true;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (pointed[y * w + x]) { pointN++; if (x < 24 || x > 36 || !rest[y * w + x]) pointIn = false; }
  check('its outline, where it lies at rest, and nothing else\'s', pointN > 20 && pointIn && pointed[FRONT * w + 24] === 1 && pointed[FRONT * w + 36] === 1, pointN + ' px');
  check('and it has not gone down: the picture is as it was', down(4) === 0 && snap().equals(rest));
  Keys.point(61);
  Keys.step(DT);
  const moved = heldNow();
  check('another pointed at, it glows and the first does not', moved[BACK * w + 10] === 1 && moved[FRONT * w + 36] === 0 && !moved.equals(pointed));
  Keys.on(67);
  Keys.step(DT);
  check('beside a key that is down, which glows too', heldNow()[BACK * w + 10] === 1 && heldNow()[SIDE * w + 60] === 1);
  Keys.off(67);
  Keys.point(200);
  for (let i = 0; i < 10; i++) Keys.step(DT);
  check('a note outside the window is no key, and nothing glows', heldNow().every((v) => v === 0));
  Keys.point(64);
  Keys.point(-1);
  Keys.step(DT);
  check('and none pointed at, none glows', heldNow().every((v) => v === 0));

  // --- a black key down ---------------------------------------------------------------
  // c#4 is the first black key, on the line between the first two white keys, column 12
  Keys.on(61);
  Keys.step(DT);
  const sharp = heldNow(), sharpInk = snap();
  let sharpN = 0, near = true;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (sharp[y * w + x]) { sharpN++; if (Math.abs(x - 12) > 3) near = false; }
  check('a black key down has its outline there too', sharpN > 10 && near, sharpN + ' px');
  check('round ink that stays as it is', sharpInk[BACK * w + 12] === 1 && sharp[BACK * w + 12] === 0);
  Keys.off(61);
  for (let i = 0; i < 10; i++) Keys.step(DT);

  // --- every note its own key ------------------------------------------------------
  let own = true;
  for (let s = 0; s < COUNT; s++) {
    Keys.on(FIRST + s);
    for (let k = 0; k < COUNT; k++) if ((down(k) > 0) !== (k === s)) own = false;
    Keys.off(FIRST + s);
    for (let i = 0; i < 10; i++) Keys.step(DT);
  }
  check('each of the seventeen notes puts down a key of its own', own);
  check('the window starts at c4', mm.keys_base() === FIRST, mm.keys_base());

  // --- where the keys are ----------------------------------------------------------
  // the picture's px (x, y) from its top left, as Keys.at takes it: world px from its middle
  const at = (x, y) => Keys.at((x + 0.5 - w / 2) * Keys.SCALE, (y + 0.5 - h / 2) * Keys.SCALE);
  const whites = [];
  for (let s = 0; s < COUNT; s++) if (!BLACK.includes(s)) whites.push(s);
  check('across the fronts, the ten white keys in order', whites.every((s, i) => at(6 + 12 * i, FRONT) === FIRST + s), whites.map((s, i) => at(6 + 12 * i, FRONT)).join(' '));
  const found = new Set();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) found.add(at(x, y));
  check('every pixel of the picture is a key\'s, and every key is found', found.size === COUNT && !found.has(-1), found.size);
  // a black key is found where the picture is ink, and nowhere near the fronts
  let onBlack = true;
  for (const s of BLACK) {
    let any = false;
    for (let x = 1; x < w - 1; x++) if (at(x - 1, BACK) === FIRST + s && at(x, BACK) === FIRST + s && at(x + 1, BACK) === FIRST + s) { any = true; if (!rest[BACK * w + x]) onBlack = false; }
    if (!any) onBlack = false;
  }
  check('the black keys are found on their ink, over the white keys', onBlack);
  check('and not over the white keys\' fronts', BLACK.every((s) => { for (let x = 0; x < w; x++) if (at(x, FRONT) === FIRST + s) return false; return true; }));
  check('no key off the picture', at(-1, 5) === -1 && at(w, 5) === -1 && at(5, -1) === -1 && at(5, h) === -1 && Keys.at(NaN, 0) === -1);

  // --- another octave ----------------------------------------------------------------
  Keys.on(84);
  check('a note in another octave goes down on the key of its name', down(12) === PRESS && down(0) === 0, down(12));
  check('and the window moves by as few octaves as take it in', mm.keys_base() === 72, mm.keys_base());
  check('where a press on a key then plays', at(6, FRONT) === 72 && at(6 + 12 * 9, FRONT) === 72 + 16, at(6, FRONT) + ' ' + at(6 + 12 * 9, FRONT));
  Keys.off(84);
  for (let i = 0; i < 10; i++) Keys.step(DT);
  Keys.on(60);
  check('and back down for a note under it', mm.keys_base() === 60 && down(0) === PRESS, mm.keys_base());

  // --- two notes, one key ------------------------------------------------------------
  Keys.on(48);
  check('a note an octave under the window lands on the key held already', mm.keys_base() === 48 && down(0) === PRESS);
  Keys.off(60);
  for (let i = 0; i < 10; i++) Keys.step(DT);
  check('which stays down while one of them holds it', down(0) === PRESS, down(0));
  Keys.off(48);
  for (let i = 0; i < 10; i++) Keys.step(DT);
  check('and rises with the last', down(0) === 0, down(0));

  // --- all off, and a bad dt -----------------------------------------------------------
  const base = mm.keys_base();
  Keys.on(base);
  Keys.on(base + 4);
  Keys.on(base + 7);
  Keys.allOff();
  Keys.step(NaN);
  Keys.step(-1);
  check('a step whose dt is not a number, or under 0, moves nothing', down(0) === PRESS && down(4) === PRESS && down(7) === PRESS);
  for (let i = 0; i < 10; i++) Keys.step(DT);
  check('every key let go at once rises', [0, 4, 7].every((s) => down(s) === 0));
  Keys.on(200);
  Keys.on(-1);
  Keys.off(200);
  Keys.step(DT);
  check('a note that is no midi note does nothing', Array.from({ length: COUNT }, (_, s) => down(s)).every((d) => d === 0));

  console.log(failures ? failures + ' failed' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
