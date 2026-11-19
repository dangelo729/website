// node tools/test/replay.test.js
//
// loads js/rules.js, js/chess.js, js/games.js and js/replay.js the way the
// page does, classic scripts, in one vm context, and hands the set a fake
// window whose fetch answers with the real chebble/chess.wasm, so a famous
// game is played back on the real set. checks that a game begun resets
// the set, no one's to take, and plays from its first move once the set
// is home, a move every GAP seconds at speed 1 and sooner at a faster
// one; that a move made leaves its piece exactly on its square, a
// castle its rook too, its two squares bordered in the last colour and no
// other, and a piece taken stands until the piece that takes it comes
// down on it and then lies on the table; that played out it stops, every
// body where the game leaves it; that a move back leads the piece back
// and the one it took back from the table, and a move on takes it again;
// that the set shown after any number of moves has every body where it
// stands then, from the last move straight to the first and back; that
// toggle stops it, starts it, and starts it again from the first move
// once played out; that every other famous game, its moves made one
// close after another, ends with every body where it should be, and so
// after a seek into it, a move back from there, and back at its start;
// that a pawn crowned is knocked off its square by a spare body standing
// there as a queen, that the queen can be taken, and that a move back
// puts each of them back; that a pawn crowned what its side has lost is
// replaced by the body lost; and that stopped it does nothing more.
// prints how long the moves take. exits 1 on failure.

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
const wasm = fs.readFileSync(path.join(ROOT, 'chebble', 'chess.wasm'));
const win = { fetch: () => Promise.resolve({ arrayBuffer: () => Promise.resolve(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.length)) }) };
const settle = () => new Promise((ok) => setImmediate(ok));

const DT = 1 / 60;
const BODIES = 48; // the set's: a game's 32 pieces and 8 spares a side
const sq = (name) => name.charCodeAt(0) - 97 + 8 * (+name[1] - 1);
const sqx = (s) => (s % 8) - 3.5, sqz = (s) => (s >> 3) - 3.5; // a square's middle, board frame
const f32 = (p, n) => Array.from(new Float32Array(Chess.mm.memory.buffer, p, n));
const piece = (i) => { const a = f32(Chess.mm.chess_piece(i), 8); return { x: a[0], y: a[1], z: a[2] }; };
const state = (i) => Chess.mm.chess_state(i); // 0 on the board, 1 taken and standing, 2 flung, 4 led off beside the board, 5 parked out of sight
const kind = (i) => Chess.mm.chess_kind(i);   // the set's own number for a body's kind
const tick = () => { Chess.step(DT); Replay.step(DT); };
const hold = (secs) => { for (let i = 0; i < Math.round(secs / DT); i++) tick(); };
// the set stepped until nothing stirs, the replay not stepped: how long it took, s
const rest = () => { let n = 0; while (Chess.mm.chess_stirring() && n < 900) { Chess.step(DT); n++; } return n * DT; };
// whether body i stands on square s, as exactly as the set's own frame holds a place
const stands = (i, s) => { const a = piece(i); return Math.abs(a.x - sqx(s)) < 1e-5 && Math.abs(a.y) < 1e-6 && Math.abs(a.z - sqz(s)) < 1e-5; };
// whether body i, taken, lies on the table past the slab, 4.4 squares from the board's middle each way
const lies = (i) => { const a = piece(i); return state(i) === 2 && (Math.abs(a.x) > 4.4 || Math.abs(a.z) > 4.4) && a.y < 0.1; };
// how many of the set's bodies are not as the replay has them after n moves: on their squares as the kind they are, or off the board
const wrong = (n) => {
  const s = Replay.stands[n];
  let bad = 0;
  for (let i = 0; i < BODIES; i++) if (!(s.sq[i] < 0 ? state(i) !== 0 : state(i) === 0 && stands(i, s.sq[i]) && kind(i) === Chess.KINDS[s.kind[i]])) bad++;
  return bad;
};
// the set stepped, the replay not, until every body is as the replay has it after n moves: how long it took, s
const come = (n) => { let k = 0; while (wrong(n) && k < 900) { Chess.step(DT); k++; } return k * DT; };
// the squares bordered, and in what, as 'e2:3 e4:3'
const bordered = () => {
  const out = [];
  for (let s = 0; s < 64; s++) if (Chess.mm.chess_bordered(s)) out.push('abcdefgh'[s % 8] + (1 + (s >> 3)) + ':' + Chess.mm.chess_bordered(s));
  return out.join(' ');
};

(async () => {
  const opera = GAMES.find((g) => g.name === 'the opera game');
  Replay.watch(opera);
  check('before the set is in, no game is begun', !Replay.on);
  Chess.colours(0, 1, 2, 3, 4, 5);
  Chess.size(320, 240);
  Chess.load(win);
  for (let i = 0; i < 200 && !Chess.ready; i++) await settle();
  check('the set is in', Chess.ready);
  rest();

  // --- a game begun ----------------------------------------------------------------
  // a pawn knocked off its square first, so the set has something to lead home
  Chess.mm.chess_put(12, 0.5, 0, 0.5, 1, 0, 0, 0);
  Replay.watch(opera);
  check('a game begun is on and playing, not yet live, shown before its first move', Replay.on && Replay.playing && !Replay.live && Replay.at === 0 && Replay.said() === '');
  check('its moves are read, and where every body stands after each', Replay.line.length === 33 && Replay.stands.length === 34);
  const first = Replay.stands[0];
  check('it starts with the 32 on their squares and the 16 spares not in it',
    first.sq.length === BODIES && Array.from(first.sq.slice(0, 32)).every((s) => s >= 0) && Array.from(first.sq.slice(32)).every((s) => s === -2) && first.sq[4] === sq('e1') && first.sq[28] === sq('e7'));
  tick();
  const c = Chess.point(sqx(sq('a2')), 0.5, sqz(sq('a2')));
  check('the set is led home first, no piece to be taken, and no move made', Chess.leading() && !Chess.take(c.x, c.y) && Replay.at === 0);
  let n = 0;
  while (!Replay.live && n++ < 600) tick();
  check('once it is home the game is live', Replay.live && !Chess.leading() && stands(12, sq('e2')), (n * DT).toFixed(2) + ' s');
  hold(Replay.GAP - 0.1);
  check('nothing moves until GAP is up, and no square is bordered', Replay.at === 0 && stands(12, sq('e2')) && bordered() === '');
  hold(0.2);
  check('then the first move is made', Replay.at === 1 && Replay.said() === '1. e4' && Chess.leading());
  check('its two squares bordered in the last colour, and no other', bordered() === 'e2:3 e4:3', bordered());
  const took = rest();
  check('and its pawn stands on e4 exactly', stands(12, sq('e4')) && wrong(1) === 0, took.toFixed(2) + ' s');
  hold(Replay.GAP);
  check('black\'s is made GAP after it, and its squares are the two bordered', Replay.at === 2 && Replay.said() === '1... e5' && bordered() === 'e5:3 e7:3', bordered());

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
  check('until the piece that takes it has come down on it', state(28) === 2 && Math.hypot(at.x - sqx(sq('e5')), at.z - sqz(sq('e5'))) < 0.8, (n * DT).toFixed(2) + ' s');
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
  check('every body where the game leaves it: the castled king, the rook on d8, the taken on the table', wrong(33) === 0 && stands(4, sq('c1')) && stands(7, sq('d8')) && lies(3));
  check('the last move\'s squares bordered', bordered() === 'd1:3 d8:3', bordered());
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
  const mid = come(10);
  check('shown after ten moves, every body stands where it did then, the taken since back', Replay.at === 10 && wrong(10) === 0, mid.toFixed(2) + ' s');
  Replay.seek(0);
  const home = come(0);
  check('shown before the first, every piece is home and no square bordered', Replay.at === 0 && wrong(0) === 0 && Replay.said() === '' && bordered() === '', home.toFixed(2) + ' s');
  Replay.seek(33);
  check('shown after the last at once, the taken are thrown off by none', Replay.at === 33 && state(28) !== 0 && state(3) !== 0);
  const all = come(33);
  check('and every body comes to where the game leaves it', wrong(33) === 0, all.toFixed(2) + ' s');
  Replay.seek(99);
  Replay.seek(33.4);
  check('a number past its moves is its last', Replay.at === 33);
  Replay.seek(-3);
  check('and one before them its first', Replay.at === 0);
  Replay.seek(33);
  come(33);

  // --- started again ---------------------------------------------------------------
  Replay.toggle();
  check('started when played out, it is shown before its first move again, playing', Replay.playing && Replay.at === 0 && !Replay.live && Chess.leading());
  n = 0;
  while (!Replay.live && n++ < 900) tick();
  check('and plays once the set is home', Replay.live && wrong(0) === 0 && Replay.at === 0, (n * DT).toFixed(2) + ' s');
  hold(Replay.GAP / Replay.SPEEDS[Replay.speed] + 0.1);
  check('from its first move', Replay.at === 1);

  // --- every other game --------------------------------------------------------------
  // its moves made one every tenth of a second, so each is made while the
  // ones before it are still being made
  for (const g of GAMES) {
    if (g === opera) continue;
    Replay.watch(g);
    come(0);
    const len = Replay.line.length, moves = g.moves.split(' ');
    for (let k = 1; k <= len; k++) {
      Replay.next();
      for (let i = 0; i < 6; i++) Chess.step(DT);
    }
    const end = come(len), endWrong = wrong(len), at = Math.floor(len / 2);
    Replay.seek(at);
    Replay.back();
    const middle = come(at - 1), midWrong = wrong(at - 1);
    Replay.seek(0);
    const start = come(0);
    check(g.name + ': every move read, and every body right at its end, a move back from its middle and its start',
      len === moves.length && endWrong === 0 && midWrong === 0 && wrong(0) === 0 && bordered() === '',
      len + ' moves, ' + end.toFixed(2) + ', ' + middle.toFixed(2) + ' and ' + start.toFixed(2) + ' s');
  }

  // --- a pawn crowned ----------------------------------------------------------------
  // white's h pawn (15) takes its way to g8, where black's h rook (23)
  // stands, and is crowned a queen; black's g knight (22) takes the queen
  Replay.watch({ name: 'a pawn crowned', result: '*', moves: 'h4 g5 hxg5 h6 gxh6 Nf6 h7 Rg8 hxg8=Q Nxg8' });
  check('a pawn crowned is replaced by its side\'s first spare, a queen on its square from then, the pawn off',
    Replay.line.length === 10 && Replay.line[8].crowned === 32 && Replay.line[8].piece === 15 && Replay.line[8].taken === 23
    && Replay.stands[9].sq[32] === sq('g8') && Replay.stands[9].kind[32] === 5 && Replay.stands[9].sq[15] === -1 && Replay.stands[8].sq[32] === -2);
  Replay.seek(8);
  come(8);
  check('before it, the pawn stands on h7 and the spare is out of sight', wrong(8) === 0 && stands(15, sq('h7')) && state(32) === 5);
  Replay.next();
  const crowned = rest();
  check('crowned, the spare stands on g8 as a queen, and the pawn and the rook it took lie on the table',
    wrong(9) === 0 && state(32) === 0 && stands(32, sq('g8')) && kind(32) === 4 && lies(15) && lies(23), crowned.toFixed(2) + ' s');
  Replay.next();
  rest();
  check('the queen is taken as any piece is', wrong(10) === 0 && lies(32) && stands(22, sq('g8')));
  Replay.back();
  come(9);
  check('a move back, and it stands on g8 again', wrong(9) === 0 && stands(32, sq('g8')) && stands(22, sq('f6')));
  Replay.back();
  const uncrowned = rest();
  check('another, and the queen is thrown off, the pawn back on h7 a pawn, the rook back on g8',
    wrong(8) === 0 && state(32) !== 0 && stands(15, sq('h7')) && kind(15) === 0 && stands(23, sq('g8')), uncrowned.toFixed(2) + ' s');
  Replay.seek(10);
  come(10);
  check('shown after the queen is taken at once, the spare never comes onto the board', wrong(10) === 0 && state(32) !== 0 && state(15) !== 0);
  // white's g knight (6) is taken on g5, and its h pawn (15) crowned a knight on f8
  Replay.watch({ name: 'a pawn crowned what its side lost', result: '*', moves: 'Nf3 g5 Nxg5 h6 h4 hxg5 hxg5 a6 g6 a5 g7 a4 gxf8=N' });
  check('a pawn crowned what its side has lost is replaced by the body lost', Replay.line.length === 13 && Replay.line[12].crowned === 6 && Replay.stands[13].sq[6] === sq('f8') && Replay.stands[13].kind[6] === 2);
  Replay.seek(12);
  come(12);
  Replay.next();
  const lost = rest();
  check('led back from the table onto the pawn\'s square, a knight, and no spare comes in', wrong(13) === 0 && stands(6, sq('f8')) && kind(6) === 2 && lies(15) && state(32) !== 0, lost.toFixed(2) + ' s');

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
