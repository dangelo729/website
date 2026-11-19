// node tools/test/chess.test.js
//
// loads js/chess.js the way the page does, a classic script, in a vm
// context, and hands it a fake window whose fetch answers with the real
// chebble/chess.wasm. the set is chebble's, built and tested there; this
// checks the wrapper against it. that every export the wrapper names is in
// the wasm, which needs no imports; that nothing is there before the wasm
// is in and nothing asked of it then does anything; that it is fetched
// once and checked with the server; and then the set through the wrapper:
// its picture a v a pixel on the wasm's memory at the size asked, holding
// only the colours it was given, still at rest; the body named at a pixel
// the one drawn there; a piece hovered lit, and unlit again; a press on a
// piece taking it and on bare board none; a piece carried lifted, and let
// go landing, its landing said in whole words that name it; no piece
// taken with no one to move; a piece led to a square standing on it
// exactly, one taken thrown off the board once the piece that takes it
// comes down on it, and led back; a pawn crowned knocked off its square by
// a spare standing there as a queen; a square bordered and none; a reset
// leading every piece home and undoing all of it; the camera turned and
// zoomed, no further out than its fit; the tone look drawing the tone;
// and a resize drawing at the new size. prints what a drawing step costs.
// exits 1 on failure.

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
const source = fs.readFileSync(path.join(ROOT, 'js', 'chess.js'), 'utf8');
const ctx = vm.createContext({ WebAssembly });
vm.runInContext(source, ctx, { filename: 'js/chess.js' });
const Chess = vm.runInContext('Chess', ctx);

// --- the fake window -----------------------------------------------------------
const wasm = fs.readFileSync(path.join(ROOT, 'chebble', 'chess.wasm'));
const fetched = [];
const win = {
  fetch(url, options) {
    fetched.push({ url, options });
    return Promise.resolve({ arrayBuffer: () => Promise.resolve(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.length)) });
  },
};
const settle = () => new Promise((ok) => setImmediate(ok));

const DT = 1 / 60;
const PAPER = 5, INK = 9, TONE = 13, HOVER = 17, EARLY = 21, LAST = 25, TABLE = 29, TABLE_INK = 33; // the v's handed over, none the page's own
const W = 320, H = 240; // the canvas asked for
const PAWN = 1, QUEEN = 5; // the rules' kinds (js/rules.js)
const sq = (name) => name.charCodeAt(0) - 97 + 8 * (+name[1] - 1);
const sqx = (s) => (s % 8) - 3.5, sqz = (s) => (s >> 3) - 3.5; // a square's middle, board frame
const f32 = (p, n) => Array.from(new Float32Array(Chess.mm.memory.buffer, p, n));
const piece = (i) => { const a = f32(Chess.mm.chess_piece(i), 8); return { x: a[0], y: a[1], z: a[2] }; };
const state = (i) => Chess.mm.chess_state(i); // 0 on the board, 1 taken and standing, 2 flung
// the set stepped until nothing stirs: how long it took, s
const rest = () => { let n = 0; while (Chess.mm.chess_stirring() && n < 900) { Chess.step(DT); n++; } return n * DT; };
// whether body i stands on square s, as exactly as the set's own frame holds a place
const stands = (i, s) => { const a = piece(i); return Math.abs(a.x - sqx(s)) < 1e-5 && Math.abs(a.y) < 1e-6 && Math.abs(a.z - sqz(s)) < 1e-5; };
// whether body i lies on the table past the slab, 4.4 squares from the board's middle each way
const lies = (i) => { const a = piece(i); return state(i) === 2 && (Math.abs(a.x) > 4.4 || Math.abs(a.z) > 4.4) && a.y < 0.1; };
// the canvas px a body standing on square s is drawn at, up squares over its foot
const over = (s, up) => Chess.point(sqx(s), up, sqz(s));
// the square each of the 32 starts on
const start = (i) => i < 16 ? i : i < 24 ? 40 + i : 24 + i;
const held = (pic) => [...new Set(pic.px)].sort((a, b) => a - b).join(' ');

(async () => {
  // --- the wrapper and the wasm -----------------------------------------------------
  const mod = new WebAssembly.Module(wasm), has = new Set(WebAssembly.Module.exports(mod).map((e) => e.name));
  const named = [...new Set(source.match(/\bchess_[a-z]+\b/g))].concat(['memory', '_initialize']);
  const missing = named.filter((name) => !has.has(name));
  check('every export the wrapper names is in the wasm', named.length > 20 && missing.length === 0, missing.length ? 'missing ' + missing.join(' ') : named.length + ' named');
  check('the wasm needs no imports', WebAssembly.Module.imports(mod).length === 0);

  // --- before the wasm is in ------------------------------------------------------
  check('nothing there before it is loaded', !Chess.ready && Chess.picture === null && fetched.length === 0);
  Chess.colours(PAPER, INK, TONE, HOVER, EARLY, LAST, TABLE, TABLE_INK);
  Chess.size(W, H);
  for (const ask of [() => Chess.turn(1, 1), () => Chess.step(DT), () => Chess.reset(), () => Chess.hover(3), () => Chess.carry(1, 1), () => Chess.drop(), () => Chess.mover(0),
    () => Chess.go(8, 16), () => Chess.off(8), () => Chess.back(8, 8, PAWN), () => Chess.crown(8, 32, 56, QUEEN), () => Chess.border(8, 3), () => Chess.unborder()]) ask();
  const nowhere = Chess.point(0, 0, 0), none = Chess.words();
  check('and nothing asked of it then does anything', Chess.at(1, 1) === -1 && !Chess.take(1, 1) && !Chess.zoom(2) && !Chess.leading() && Number.isNaN(nowhere.x) && none.length === 0);

  // --- the wasm in ----------------------------------------------------------------
  Chess.load(win);
  Chess.load(win);
  for (let i = 0; i < 200 && !Chess.ready; i++) await settle();
  check('it is fetched once, checked with the server', fetched.length === 1 && fetched[0].url === 'chebble/chess.wasm' && fetched[0].options.cache === 'no-cache', fetched.map((f) => f.url).join(' '));
  check('and the set is in', Chess.ready);
  const pic = Chess.picture;
  check('its picture is a v a pixel on the wasm\'s memory, at the size asked', pic.w === W && pic.h === H && pic.px.length === W * H && pic.px.buffer === Chess.mm.memory.buffer && pic.px.BYTES_PER_ELEMENT === 2);
  check('holding the paper, the ink and the table it was given, and nothing else', held(pic) === [PAPER, INK, TABLE].join(' '), held(pic));
  const first = pic.px.slice();
  Chess.step(DT);
  Chess.step(DT);
  check('at rest nothing stirs, the picture stays and nothing is said', !Chess.mm.chess_stirring() && first.every((v, i) => v === Chess.picture.px[i]) && Chess.words().length === 0);

  // --- what is drawn where ----------------------------------------------------------
  const e2 = over(sq('e2'), 0.5), e1 = over(sq('e1'), 0.9), e4 = over(sq('e4'), 0);
  check('the body named at a pixel is the one drawn there', Chess.at(e2.x, e2.y) === 12 && Chess.at(e1.x, e1.y) === 4 && Chess.at(e4.x, e4.y) === -1, [e2, e1, e4].map((p) => Chess.at(p.x, p.y)).join(' '));
  Chess.hover(12);
  Chess.step(DT);
  const lit = Chess.picture.px.reduce((n, v) => n + (v === HOVER), 0);
  Chess.hover(-1);
  Chess.step(DT);
  check('a piece hovered is lit in the hover colour, and unlit the picture is as it was', lit > 0 && first.every((v, i) => v === Chess.picture.px[i]), lit + ' px');

  // --- the hand ---------------------------------------------------------------------
  check('a press on bare board takes nothing', !Chess.take(e4.x, e4.y));
  check('a press on a piece takes it', Chess.take(e2.x, e2.y));
  for (let i = 0; i < 60; i++) {
    Chess.carry(e4.x, e4.y);
    Chess.step(DT);
  }
  const up = piece(12);
  check('carried, it is lifted over the board', up.y > 1 && Math.hypot(up.x - sqx(sq('e2')), up.z - sqz(sq('e2'))) > 0.5, 'its foot ' + up.y.toFixed(2) + ' up');
  Chess.drop();
  let said = 0, whole = true, finite = true, names = false, n = 0;
  do {
    Chess.step(DT);
    const words = Chess.words();
    whole = whole && words.length % Chess.WORD === 0 && (words.length === 0 || words.buffer === Chess.mm.memory.buffer);
    finite = finite && words.every(Number.isFinite);
    for (let k = 0; k < words.length; k += Chess.WORD) names = names || words[k + 1] === 12;
    said += words.length / Chess.WORD;
  } while (Chess.mm.chess_stirring() && ++n < 900);
  const down = piece(12);
  check('let go, it lands on the board and comes to rest', state(12) === 0 && Math.abs(down.y) < 0.01 && !Chess.mm.chess_stirring(), (n * DT).toFixed(2) + ' s');
  check('and its landing is said: whole words on the wasm\'s memory, every float finite, the piece named', said > 0 && whole && finite && names, said + ' words');
  Chess.mover(2);
  const d2 = over(sq('d2'), 0.5);
  check('with no one to move, no piece is taken', !Chess.take(d2.x, d2.y));
  Chess.mover(-1);

  // --- what a game played back asks -------------------------------------------------
  Chess.mover(2);
  Chess.go(12, sq('e4'));
  check('a piece sent to a square is led there', Chess.leading());
  rest();
  check('and stands on it exactly', stands(12, sq('e4')) && !Chess.leading());
  // black's d pawn (27) sent to d5, and white's e pawn (12) taking it there
  Chess.go(27, sq('d5'));
  rest();
  Chess.off(27, 12);
  Chess.go(12, sq('d5'));
  Chess.step(DT);
  check('a piece taken stands, taken, until the piece that takes it comes down on it', state(27) === 1);
  const flung = rest();
  check('then it is thrown off the board and lies on the table, the other on its square', lies(27) && stands(12, sq('d5')), flung.toFixed(2) + ' s');
  Chess.back(27, sq('d7'), PAWN);
  check('led back, it is a piece on the board again', state(27) === 0 && Chess.leading());
  rest();
  check('and stands on its square exactly', stands(27, sq('d7')));
  // black's a rook (16) and a pawn (24) off, and white's a pawn (8) crowned on a8
  Chess.off(16);
  Chess.off(24);
  Chess.crown(8, 32, sq('a8'), QUEEN);
  const crowned = rest();
  check('a pawn crowned is knocked off its last square by a spare standing there as a queen', lies(8) && state(32) === 0 && stands(32, sq('a8')) && Chess.mm.chess_kind(32) === Chess.KINDS[QUEEN], crowned.toFixed(2) + ' s');
  Chess.border(sq('a7'), 3);
  Chess.border(sq('a8'), 1);
  const ringed = [sq('a7'), sq('a8'), sq('a6')].map((s) => Chess.mm.chess_bordered(s)).join(' ');
  Chess.step(DT);
  check('a square is bordered in the colour asked, drawn in it, and no other', ringed === '3 1 0' && Chess.picture.px.includes(LAST) && Chess.picture.px.includes(HOVER), ringed);
  Chess.unborder();
  check('and none is', [...Array(64).keys()].every((s) => Chess.mm.chess_bordered(s) === 0));
  Chess.border(sq('a7'), 3);

  // --- a reset ------------------------------------------------------------------------
  Chess.mover(-1);
  Chess.reset();
  check('a reset leads the pieces home', Chess.leading());
  const home = rest();
  const away = [...Array(32).keys()].filter((i) => state(i) !== 0 || !stands(i, start(i)));
  check('every one of the 32 onto its square exactly, the pawn a pawn', away.length === 0 && Chess.mm.chess_kind(8) === Chess.KINDS[PAWN], away.length ? 'not home: ' + away.join(' ') : home.toFixed(2) + ' s');
  check('the spare off the board, and no square bordered', state(32) !== 0 && Chess.mm.chess_bordered(sq('a7')) === 0);
  check('and the picture is the first again', first.every((v, i) => v === Chess.picture.px[i]));

  // --- the camera ---------------------------------------------------------------------
  check('it zooms no further out than its fit', !Chess.zoom(0.5));
  check('and in', Chess.zoom(2));
  rest();
  const near = Chess.picture.px.slice();
  check('eased, the picture changed', near.some((v, i) => v !== first[i]));
  Chess.turn(1, 0);
  const t0 = process.hrtime.bigint();
  let steps = 0;
  while (Chess.mm.chess_stirring() && steps < 900) { Chess.step(DT); steps++; }
  const cost = Number(process.hrtime.bigint() - t0) / 1e6 / Math.max(1, steps);
  check('a turn changes the picture and it settles', steps > 0 && steps < 900 && Chess.picture.px.some((v, i) => v !== near[i]), (steps * DT).toFixed(2) + ' s');

  // --- the look and the size ----------------------------------------------------------
  Chess.look(0);
  Chess.step(DT);
  check('the tone look draws the tone too', Chess.picture.px.includes(TONE) && held(Chess.picture) === [PAPER, INK, TONE, TABLE].join(' '), held(Chess.picture));
  Chess.look(1);
  Chess.size(200, 150);
  Chess.step(DT);
  check('a resize draws at the new size', Chess.picture.w === 200 && Chess.picture.h === 150 && Chess.picture.px.length === 200 * 150 && Chess.picture.px.buffer === Chess.mm.memory.buffer);

  console.log('a drawing step at ' + W + ' x ' + H + ': ' + cost.toFixed(2) + ' ms');
  console.log(failures ? failures + ' failed' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
