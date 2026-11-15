// node tools/test/replay.test.js
//
// loads js/rules.js, js/chess.js, js/games.js and js/replay.js the way the
// page does, classic scripts, in one vm context, and hands the set a fake
// window whose fetch answers with the real chess/chess.wasm, so a famous
// game is played back on the real set. checks that a game begun resets
// the set, no one's to take, and plays from its first move once the set
// is home, a move every GAP seconds at speed 1 and sooner at a faster
// one; that a move made leaves its piece exactly on its square, a
// castle its rook too, and a piece taken stands until the piece that
// takes it comes down on it and then lies on the table; that played out
// it stops, every piece where the game leaves it; that a move back
// leads the piece back and the one it took back from the table, and a
// move on takes it again; that the set shown after any number of moves
// has every piece where it stands then, from the last move straight to
// the first and back; that toggle stops it, starts it, and starts it
// again from the first move once played out; that a pawn crowned is a
// queen and, a move back, a pawn again; and that stopped it does nothing
// more. prints how long the moves take to come to rest. exits 1 on failure.

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
const ctx = vm.createContext({ WebAssembly });
for (const name of ['rules', 'chess', 'games', 'replay']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', name + '.js'), 'utf8'), ctx, { filename: 'js/' + name + '.js' });
const [Chess, GAMES, Replay] = ['Chess', 'GAMES', 'Replay'].map((name) => vm.runInContext(name, ctx));

// --- the fake window -------------------------------------------------------------
const wasm = fs.readFileSync(path.join(ROOT, 'chess', 'chess.wasm'));
const win = { fetch: () => Promise.resolve({ arrayBuffer: () => Promise.resolve(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.length)) }) };
const settle = () => new Promise((ok) => setImmediate(ok));

const DT = 1 / 60;
const sq = (name) => name.charCodeAt(0) - 97 + 8 * (+name[1] - 1);
const sqx = (s) => (s % 8) - 3.5, sqz = (s) => (s >> 3) - 3.5; // a square's middle, board frame
const f32 = (p, n) => Array.from(new Float32Array(Chess.mm.memory.buffer, p, n));
const piece = (i) => { const a = f32(Chess.mm.chess_piece(i), 8); return { x: a[0], y: a[1], z: a[2] }; };
const state = (i) => Chess.mm.chess_state(i); // 0 on the board, 1 taken and standing, 2 flung
const tick = () => { Chess.step(DT); Replay.step(DT); };
const hold = (secs) => { for (let i = 0; i < Math.round(secs / DT); i++) tick(); };
// the set stepped until nothing stirs, the replay not stepped: how long it took, s
const rest = () => { let n = 0; while (Chess.mm.chess_stirring() && n < 900) { Chess.step(DT); n++; } return n * DT; };
// whether piece i stands on square s, as exactly as the set's own frame holds a place
const stands = (i, s) => { const a = piece(i); return Math.abs(a.x - sqx(s)) < 1e-5 && Math.abs(a.y) < 1e-6 && Math.abs(a.z - sqz(s)) < 1e-5; };
// whether piece i, taken, lies on the table past the slab, 4.4 squares from the board's middle each way and 0.35 under its top
const lies = (i) => { const a = piece(i); return state(i) === 2 && (Math.abs(a.x) > 4.4 || Math.abs(a.z) > 4.4) && a.y < 0.1 && a.y > -0.36; };
// how many of the set's pieces are not as the replay has them after n moves: on their squares, or lying on the table
const wrong = (n) => {
  const s = Replay.stands[n];
  let bad = 0;
  for (let i = 0; i < 32; i++) if (!(s.sq[i] < 0 ? lies(i) : state(i) === 0 && stands(i, s.sq[i]))) bad++;
  return bad;
};

(async () => {
  const opera = GAMES.find((g) => g.name === 'the opera game');
  Replay.watch(opera);
  check('before the set is in, no game is begun', !Replay.on);
  Chess.colours(0, 1, 2, 3);
  Chess.size(480, 360);
  Chess.load(win);
  for (let i = 0; i < 200 && !Chess.ready; i++) await settle();
  check('the set is in', Chess.ready);
  Chess.turn(0, 2);
  rest();

  // --- a game begun ----------------------------------------------------------------
  // a pawn knocked off its square first, so the set has something to lead home
  Chess.mm.chess_put(12, 0.5, 0, 0.5, 1, 0, 0, 0);
  Replay.watch(opera);
  check('a game begun is on and playing, not yet live, shown before its first move', Replay.on && Replay.playing && !Replay.live && Replay.at === 0 && Replay.said() === '');
  check('its moves are read, and where every piece stands after each', Replay.line.length === 33 && Replay.stands.length === 34);
  tick();
  const c = f32(Chess.mm.chess_point(sqx(sq('a2')), 0.5, sqz(sq('a2'))), 2);
  check('the set is led home first, no piece to be taken, and no move made', Chess.leading() && !Chess.take(c[0], c[1]) && Replay.at === 0);
  let n = 0;
  while (!Replay.live && n++ < 600) tick();
  check('once it is home the game is live', Replay.live && !Chess.leading() && stands(12, sq('e2')), (n * DT).toFixed(2) + ' s');
  hold(Replay.GAP - 0.1);
  check('nothing moves until GAP is up', Replay.at === 0 && stands(12, sq('e2')));
  hold(0.2);
  check('then the first move is made', Replay.at === 1 && Replay.said() === '1. e4' && Chess.leading());
  const took = rest();
  check('and its pawn stands on e4 exactly', stands(12, sq('e4')) && wrong(1) === 0, took.toFixed(2) + ' s');
  hold(Replay.GAP);
  check('black\'s is made GAP after it', Replay.at === 2 && Replay.said() === '1... e5');

  // --- stopped and started, faster and slower ----------------------------------------
  Replay.toggle();
  hold(3 * Replay.GAP);
  check('stopped, no move is made', !Replay.playing && Replay.at === 2);
  Replay.toggle();
  hold(Replay.GAP + 0.1);
  check('started, the next is made GAP on', Replay.playing && Replay.at === 3);
  Replay.faster();
  hold(Replay.GAP / 2 + 0.1);
  check('at the next speed, twice as soon', Replay.SPEEDS[Replay.speed] === 2 && Replay.at === 4);
  Replay.faster();
  Replay.faster();
  check('past the last speed is the first', Replay.SPEEDS[Replay.speed] === 0.5);
  hold(Replay.GAP + 0.1);
  check('where a move takes twice as long', Replay.at === 4);
  hold(Replay.GAP);
  check('and is made', Replay.at === 5);
  Replay.faster();

  // --- a piece taken ---------------------------------------------------------------
  // 4. dxe5, the d pawn (11) taking black's e pawn (28)
  n = 0;
  while (Replay.at < 7 && n++ < 600) tick();
  check('a piece taken stands, taken, as the move is made', Replay.said() === '4. dxe5' && state(28) === 1);
  n = 0;
  while (state(28) === 1 && n++ < 300) tick();
  const at = piece(11);
  check('until the piece that takes it has come down on it', state(28) === 2 && Math.hypot(at.x - sqx(sq('e5')), at.z - sqz(sq('e5'))) < 0.8 && at.y > 0.03, (n * DT).toFixed(2) + ' s, its foot ' + at.y.toFixed(2) + ' up');
  Replay.toggle();
  const flown = rest();
  check('and then it lies on the table, the pawn on its square', lies(28) && stands(11, sq('e5')) && wrong(7) === 0, flown.toFixed(2) + ' s');

  // --- played out ------------------------------------------------------------------
  Replay.faster();
  Replay.faster();
  Replay.toggle();
  n = 0;
  while (Replay.playing && n++ < 3000) tick();
  check('played out it stops at its last move', !Replay.playing && Replay.at === 33 && Replay.said() === '17. Rd8+', (n * DT).toFixed(1) + ' s at speed ' + Replay.SPEEDS[Replay.speed]);
  rest();
  check('every piece where the game leaves it: the castled king and rook, the rook on d8, the taken on the table', wrong(33) === 0 && stands(4, sq('c1')) && stands(7, sq('d8')) && lies(3));
  hold(2 * Replay.GAP);
  check('and nothing more is made', Replay.at === 33);

  // --- a move back, a move on --------------------------------------------------------
  Replay.back();
  rest();
  check('a move back leads the rook back to d1', Replay.at === 32 && !Replay.playing && stands(7, sq('d1')) && wrong(32) === 0);
  Replay.back();
  check('another, and the queen the knight took is a piece on the board again', Replay.at === 31 && state(3) === 0 && Chess.leading());
  const back = rest();
  check('led back from the table onto b8, the knight back on d7', stands(3, sq('b8')) && stands(22, sq('d7')) && wrong(31) === 0, back.toFixed(2) + ' s');
  Replay.next();
  check('a move on takes it again', Replay.at === 32 && state(3) === 1);
  rest();
  check('the knight coming down on it', lies(3) && stands(22, sq('b8')) && wrong(32) === 0);

  // --- shown after any number of moves ---------------------------------------------
  Replay.seek(10);
  const mid = rest();
  check('shown after ten moves, every piece stands where it did then, the taken since back', Replay.at === 10 && wrong(10) === 0, mid.toFixed(2) + ' s');
  Replay.seek(0);
  const home = rest();
  check('shown before the first, every piece is home', Replay.at === 0 && wrong(0) === 0 && Replay.said() === '', home.toFixed(2) + ' s');
  Replay.seek(33);
  check('shown after the last at once, the taken are thrown off by none', Replay.at === 33 && state(28) !== 0 && state(3) !== 0);
  const all = rest();
  check('and every piece comes to where the game leaves it', wrong(33) === 0, all.toFixed(2) + ' s');
  Replay.seek(99);
  Replay.seek(33.4);
  check('a number past its moves is its last', Replay.at === 33);
  Replay.seek(-3);
  check('and one before them its first', Replay.at === 0);
  Replay.seek(33);
  rest();

  // --- started again ---------------------------------------------------------------
  Replay.toggle();
  check('started when played out, it is shown before its first move again, playing', Replay.playing && Replay.at === 0 && !Replay.live && Chess.leading());
  n = 0;
  while (!Replay.live && n++ < 900) tick();
  check('and plays once the set is home', Replay.live && wrong(0) === 0 && Replay.at === 0, (n * DT).toFixed(2) + ' s');
  hold(Replay.GAP / Replay.SPEEDS[Replay.speed] + 0.1);
  check('from its first move', Replay.at === 1);

  // --- a pawn crowned ----------------------------------------------------------------
  Replay.watch({ name: 'a pawn crowned', result: '*', moves: 'a4 b5 axb5 a6 bxa6 Bb7 axb7 Nc6 bxa8=Q' });
  Replay.seek(9);
  rest();
  check('a pawn that reaches the last rank is a queen there, the rook it took on the table', Chess.mm.chess_kind(8) === 4 && wrong(9) === 0 && lies(16));
  Replay.back();
  rest();
  check('and a move back a pawn again on b7, the rook back on a8', Chess.mm.chess_kind(8) === 0 && wrong(8) === 0 && stands(16, sq('a8')));

  // --- stopped -----------------------------------------------------------------------
  Replay.watch(opera);
  n = 0;
  while (Replay.at < 2 && n++ < 900) tick();
  Replay.stop();
  hold(3 * Replay.GAP);
  Replay.next();
  Replay.toggle();
  check('a game stopped makes no more moves, whatever is asked', !Replay.on && !Replay.playing && Replay.at === 2);

  console.log(failures ? failures + ' failed' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
