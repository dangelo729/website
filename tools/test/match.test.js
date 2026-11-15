// node tools/test/match.test.js
//
// loads js/rules.js, js/chess.js and js/match.js the way the page does,
// classic scripts, in one vm context, and hands the set a fake window
// whose fetch answers with the real chess/chess.wasm, so a game is played
// on the real set by presses, carries and lifts at canvas px. checks that
// with no game a press is the set's own; that a game begun resets the set
// and waits for it, no piece to be taken until every piece is home, and
// then white is to move, no clock running until it has; that
// only the side to move's pieces can be taken, and one taken has the
// squares it may go to bordered and the nearest of them, or its own, to
// the pointer on the board filled; that let go over a square it may go to it is drawn down onto
// that square exactly, the move made, white's first starting the clocks
// and adding nothing, a later mover's clock stopped with the
// control's seconds added and the other's running; that let go nearest its
// own square, or called off, it goes back and no move is made; that a
// piece taken is thrown off the board onto the table and the game ends at checkmate, the
// set anyone's from then; then, in a second game with no clock, a pawn
// taken en passant, the pawn that takes it drawn down onto it first and
// then to its own square, a castle that moves the rook too, and a pawn crowned a
// queen, giving check; in a third a piece let go where it was pressed
// staying up over its square, the square a press would pick filled, a
// press in one place sending it to a square or onto the piece it takes,
// or back down, and a press on another piece or on itself again; in a
// fourth a clock that runs out loses, a piece up let fall, and a
// control with nothing to add adds nothing; in a fifth a stalemate, won
// by neither; and that a reset ends a game with every piece home, the taken
// ones back and the crowned one a pawn again. prints how long the moves
// take to come to rest. exits 1 on failure.

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
for (const name of ['rules', 'chess', 'match']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', name + '.js'), 'utf8'), ctx, { filename: 'js/' + name + '.js' });
const [Rules, Chess, Match] = ['Rules', 'Chess', 'Match'].map((name) => vm.runInContext(name, ctx));

// --- the fake window -------------------------------------------------------------
const wasm = fs.readFileSync(path.join(ROOT, 'chess', 'chess.wasm'));
const win = { fetch: () => Promise.resolve({ arrayBuffer: () => Promise.resolve(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.length)) }) };
const settle = () => new Promise((ok) => setImmediate(ok));

const DT = 1 / 60;
const HOVER = 3;      // the v the set fills and borders squares in
const GRIP_UP = 1.6;  // squares from a piece's top to the plane the hand carries it at (kLift less kGrip, tools/chess-web/web_main.cpp)
const sq = (name) => name.charCodeAt(0) - 97 + 8 * (+name[1] - 1);
const sqx = (s) => (s % 8) - 3.5, sqz = (s) => (s >> 3) - 3.5; // a square's middle, board frame
const f32 = (p, n) => Array.from(new Float32Array(Chess.mm.memory.buffer, p, n));
const piece = (i) => { const a = f32(Chess.mm.chess_piece(i), 8); return { x: a[0], y: a[1], z: a[2], plane: a[7] }; };
const point = (x, y, z) => f32(Chess.mm.chess_point(x, y, z), 2);
const hold = (secs) => { for (let i = 0; i < Math.round(secs / DT); i++) Match.step(DT); };
// the set stepped until nothing stirs: how long it took, s
const rest = () => { let n = 0; while (Chess.mm.chess_stirring() && n < 600) { Match.step(DT); n++; } return n * DT; };
// whether piece i stands on square s, as exactly as the set's own frame holds a place
const stands = (i, s) => { const a = piece(i); return Math.abs(a.x - sqx(s)) < 1e-5 && Math.abs(a.y) < 1e-6 && Math.abs(a.z - sqz(s)) < 1e-5; };
// whether piece i, taken, lies on the table past the slab, 4.4 squares from the board's middle each way and 0.35 under its top
const lies = (i) => { const a = piece(i); return Chess.mm.chess_state(i) === 2 && (Math.abs(a.x) > 4.4 || Math.abs(a.z) > 4.4) && a.y < 0.1 && a.y > -0.36; };
// how many of the picture's pixels are the hover colour
const lit = () => Chess.picture.px.reduce((n, v) => n + (v === HOVER ? 1 : 0), 0);

// a press on the piece standing on square from: at the canvas px of a point
// of it that is drawn, looked for down its axis from its top. whether it
// took the piece
function press(from) {
  const i = Match.at ? Match.at[sq(from)] : -1, a = piece(i), top = a.plane - GRIP_UP;
  for (const up of [0.95, 0.8, 0.6, 0.4, 0.2]) {
    const c = point(a.x, a.y + up * top, a.z);
    if (Chess.at(c[0], c[1]) !== i) continue;
    return Match.take(c[0], c[1]);
  }
  return false;
}
// the pointer moved to over the middle of square to, on the board
function over(to) {
  const c = point(sqx(sq(to)), 0, sqz(sq(to)));
  Chess.carry(c[0], c[1]);
}
// a move by hand: the piece on from taken, the pointer moved to over to on the board, and the piece let go
function ply(from, to) {
  if (!press(from)) return false;
  hold(0.3);
  over(to);
  hold(0.5);
  Match.drop();
  return true;
}
// a line of moves, each from and to, played and let come to rest: whether every press took its piece
function line(moves) {
  let ok = true;
  for (const m of moves.split(' ')) {
    ok = ply(m.slice(0, 2), m.slice(2, 4)) && ok;
    rest();
  }
  return ok;
}

(async () => {
  Match.play(Match.CONTROLS[0]);
  check('before the set is in, a game is not begun', !Match.on);
  Chess.colours(0, 1, 2, HOVER);
  Chess.size(480, 360);
  Chess.load(win);
  for (let i = 0; i < 200 && !Chess.ready; i++) await settle();
  check('the set is in', Chess.ready);
  // seen from nearly straight over, so every piece's top is drawn
  Chess.turn(0, 2);
  rest();

  // --- no game ---------------------------------------------------------------------
  const c = point(sqx(sq('e7')), 0.7, sqz(sq('e7')));
  check('with no game a press takes any piece, black\'s too', Match.take(c[0], c[1]) && Chess.held() === 28 && Match.hand === null);
  hold(0.3);
  check('and no square is filled or bordered', Chess.near() === -1);
  const far = point(sqx(sq('e5')), 0, sqz(sq('e5')));
  Chess.carry(far[0], far[1]);
  hold(0.5);
  Match.drop();
  rest();
  check('let go, it falls where it is', !stands(28, sq('e7')) && piece(28).z < 2);

  // --- a game begun ----------------------------------------------------------------
  Match.play(Match.CONTROLS[0]);
  check('a game begun is on, not yet live, its clocks full', Match.on && !Match.live && Match.clock[0] === 180000 && Match.clock[1] === 180000 && Match.over === null);
  Match.step(DT);
  check('while the set is led home no piece can be taken', Chess.leading() && !press('e2'));
  hold(0.2);
  check('and no clock runs', !Match.live && Match.clock[0] === 180000);
  rest();
  Match.step(DT);
  check('once every piece is home it is live, white to move', Match.live && Match.pos.turn === 0 && !Chess.leading());
  hold(1);
  check('and still no clock runs, white not having moved', !Match.timed && Match.clock[0] === 180000 && Match.clock[1] === 180000, Match.clock.join(', '));

  // --- a piece taken ------------------------------------------------------------------
  check('black\'s pieces cannot be taken on white\'s move', !press('e7') && Chess.held() === -1);
  const bare = lit();
  check('white\'s e pawn can', press('e2') && Chess.held() === 12 && Match.hand.from === sq('e2'));
  check('its two squares are its moves', Match.hand.moves.map((m) => m.to).sort().join() === [sq('e3'), sq('e4')].join());
  hold(0.3);
  check('its own square is the one filled as it is lifted', Chess.near() === sq('e2'));
  check('and the picture has the hover colour: the piece, the square filled and the borders', bare === 0 && lit() > 100, lit() + ' px');
  over('e4');
  hold(0.5);
  check('with the pointer over e4 on the board, e4 is the one filled', Chess.near() === sq('e4'));

  // --- a move -------------------------------------------------------------------------
  Match.drop();
  check('let go there the move is made: black to move, the pawn e4\'s', Match.pos.turn === 1 && Match.at[sq('e4')] === 12 && Match.at[sq('e2')] === -1 && Match.hand === null);
  check('white\'s first move starts the clocks, its own as full as it was', Match.timed && Match.clock[0] === 180000);
  const t1 = rest();
  check('the pawn is drawn down onto e4 exactly, and all comes to rest', stands(12, sq('e4')) && !Chess.leading() && lit() === 0, t1.toFixed(2) + ' s');
  const whites = Match.clock[0], blacks = Match.clock[1];
  hold(1);
  check('black\'s clock runs now, white\'s not', Match.clock[0] === whites && Math.abs(blacks - Match.clock[1] - 1000) < 20);

  // --- back, and called off -----------------------------------------------------------
  check('white\'s pieces cannot be taken on black\'s move', !press('d2'));
  press('e7');
  hold(0.3);
  over('d8');
  hold(0.5);
  check('with the pointer nearest its own square of those it may be put on, that one is filled', Chess.near() === sq('e7'));
  Match.drop();
  rest();
  check('and let go there it goes back: no move made', stands(28, sq('e7')) && Match.pos.turn === 1 && Match.at[sq('e7')] === 28);
  press('e7');
  hold(0.3);
  over('e5');
  hold(0.5);
  Match.cancel();
  rest();
  check('a hold called off over e5 goes back too', stands(28, sq('e7')) && Match.pos.turn === 1 && Match.hand === null);

  // --- a piece taken off, and checkmate -------------------------------------------------
  const blacks2 = Match.clock[1];
  const moved = ply('e7', 'e5');
  check('black\'s move stops its clock with the control\'s two seconds added', moved && Math.abs(Match.clock[1] - (blacks2 - 800 + 2000)) < 40, (Match.clock[1] - blacks2).toFixed(0) + ' ms more');
  rest();
  check('the scholar\'s mate is played by hand', line('d1h5 b8c6 f1c4 g8f6') && Match.pos.turn === 0 && !Match.over);
  const stopped = Match.clock[1];
  ply('h5', 'f7');
  check('the queen takes on f7: the pawn there is off the board', Match.at[sq('f7')] === 3 && !Match.at.includes(29));
  check('it is checkmate, white\'s game', Match.over && Match.over.how === 'checkmate' && Match.over.winner === 0 && Match.check);
  const t2 = rest();
  check('the queen stands on f7 and the pawn lies on the table, thrown off the board', stands(3, sq('f7')) && lies(29), t2.toFixed(2) + ' s');
  hold(1);
  check('the clocks have stopped', Match.clock[1] === stopped);
  check('and the set is anyone\'s again', press('a7') && Match.hand === null);
  Match.drop();
  rest();

  // --- en passant, a castle, a crowning ---------------------------------------------------
  Match.play(Match.CONTROLS[2]);
  rest();
  Match.step(DT);
  check('a new game leads the pawn back and starts over', Match.live && Chess.mm.chess_state(29) === 0 && stands(29, sq('f7')) && stands(3, sq('d1')) && Match.pos.turn === 0);
  hold(1);
  check('with no clock none runs', Match.clock[0] === 0 && Match.clock[1] === 0 && !Match.over);
  check('white\'s pawn reaches e5 and black\'s goes by it', line('e2e4 a7a6 e4e5 d7d5'));
  ply('e5', 'd6');
  // while black's pawn still stands, how near white's comes to over it, and how high its foot is as it is struck
  let near = Infinity, foot = -1;
  for (let i = 0; i < 120 && Chess.mm.chess_state(27) === 1; i++) {
    Match.step(DT);
    const a = piece(12);
    near = Math.min(near, Math.hypot(a.x - sqx(sq('d5')), a.z - sqz(sq('d5'))));
    foot = a.y;
  }
  check('taking en passant, the pawn is drawn down onto the pawn it takes first and strikes it', near < 0.3 && foot > 0.5 && foot < 0.95 && Chess.mm.chess_state(27) === 2,
    'within ' + near.toFixed(2) + ' of over it, its foot ' + foot.toFixed(2) + ' up');
  const t3 = rest();
  check('taken en passant: white\'s pawn on d6, black\'s gone from d5', stands(12, sq('d6')) && Match.at[sq('d5')] === -1 && !Match.at.includes(27) && lies(27), t3.toFixed(2) + ' s');
  check('the way is cleared to castle', line('h7h6 g1f3 h6h5 f1c4 h5h4'));
  ply('e1', 'g1');
  const t4 = rest();
  check('castled: the king on g1 and the rook led to f1', stands(4, sq('g1')) && stands(7, sq('f1')) && Match.at[sq('f1')] === 7 && Match.at[sq('h1')] === -1, t4.toFixed(2) + ' s');
  check('the pawn reaches c7', line('g7g6 d6c7 g6g5'));
  ply('c7', 'd8');
  const t5 = rest();
  check('taking on d8 it is crowned a queen there, black\'s queen off the board', stands(12, sq('d8')) && Chess.mm.chess_kind(12) === 4 && Chess.mm.chess_shown(12) === 1 && !Match.at.includes(19), t5.toFixed(2) + ' s');
  check('and gives check, the game going on', Match.check && !Match.over && Match.pos.board[sq('d8')] === Rules.QUEEN && Match.pos.turn === 1);

  // --- a piece sent by a press ---------------------------------------------------------------
  // a press at the canvas px of the middle of square name, on the board;
  // and one on piece i, where it is drawn
  const squarePx = (name) => point(sqx(sq(name)), 0, sqz(sq(name)));
  const piecePx = (i) => {
    const a = piece(i), top = a.plane - GRIP_UP;
    for (const up of [0.95, 0.8, 0.6, 0.4, 0.2]) {
      const c = point(a.x, a.y + up * top, a.z);
      if (Chess.at(c[0], c[1]) === i) return c;
    }
    return [NaN, NaN];
  };
  Match.play(Match.CONTROLS[2]);
  rest();
  Match.step(DT);
  press('e2');
  Match.drop();
  check('a piece let go where it was pressed stays up, still held', Chess.held() === 12 && Match.hand && Match.hand.up && Match.pos.turn === 0);
  hold(0.6);
  const up = piece(12);
  check('it hangs over its square, its squares still bordered and its own filled',
    Math.hypot(up.x - sqx(sq('e2')), up.z - sqz(sq('e2'))) < 0.05 && up.y > 1.5 && Chess.near() === sq('e2') && lit() > 100,
    'its foot ' + up.y.toFixed(2) + ' up');
  Match.aim(...squarePx('e4'));
  check('with the pointer over e4, nothing pressed, e4 is the one filled', Chess.near() === sq('e4'));
  Match.aim(...squarePx('d5'));
  check('over a square it cannot go to, its own', Chess.near() === sq('e2'));
  Match.aim(NaN, NaN);
  check('and off the board, its own', Chess.near() === sq('e2'));
  check('a press on the bare board takes nothing while it is up', !Match.take(...squarePx('e4')) && Chess.held() === 12 && Match.hand.up);
  Match.tap(...squarePx('e4'));
  check('let go where it was made, on e4, that press sends the piece there: the move is made', Match.pos.turn === 1 && Match.at[sq('e4')] === 12 && Match.hand === null && Chess.held() === -1);
  const t7 = rest();
  check('and it is drawn down onto e4 exactly', stands(12, sq('e4')) && lit() === 0, t7.toFixed(2) + ' s');
  press('e7');
  Match.drop();
  hold(0.3);
  check('black\'s e pawn is up; a press on its d pawn takes that one in its place', Match.hand.up && Match.take(...piecePx(27)) && Chess.held() === 27 && Match.hand.piece === 27 && !Match.hand.up);
  Match.drop();
  hold(0.6);
  check('the e pawn has gone back down, the d pawn is up', stands(28, sq('e7')) && Match.hand.up && Chess.held() === 27 && Match.pos.turn === 1);
  check('pressed again itself it is taken, to be carried', Match.take(...piecePx(27)) && Chess.held() === 27 && !Match.hand.up && Match.hand.again);
  Match.drop();
  rest();
  check('and let go at once it goes back down: no move made', Match.hand === null && Chess.held() === -1 && stands(27, sq('d7')) && Match.pos.turn === 1);
  press('d7');
  Match.drop();
  hold(0.3);
  Match.tap(...squarePx('d5'));
  rest();
  check('sent to d5 by a press there', stands(27, sq('d5')) && Match.pos.turn === 0);
  press('e4');
  Match.drop();
  hold(0.3);
  Match.aim(...piecePx(27));
  check('with white\'s pawn up and the pointer on the pawn it may take, that pawn\'s square is the one filled', Chess.near() === sq('d5'));
  Match.tap(...piecePx(27));
  check('a press on that pawn takes it', Match.at[sq('d5')] === 12 && !Match.at.includes(27) && Match.pos.turn === 1);
  const t8 = rest();
  check('white\'s pawn stands on d5 and black\'s lies on the table', stands(12, sq('d5')) && lies(27), t8.toFixed(2) + ' s');
  press('g8');
  Match.drop();
  hold(0.3);
  Match.tap(...squarePx('g5'));
  rest();
  check('a press on a square it cannot go to puts it back down: no move made', Match.hand === null && Chess.held() === -1 && stands(22, sq('g8')) && Match.pos.turn === 1);

  // --- a clock run out ----------------------------------------------------------------------
  Match.play(Match.CONTROLS[1]);
  rest();
  Match.step(DT);
  ply('e2', 'e4');
  rest();
  const full = Match.clock[1];
  ply('e7', 'e5');
  check('a control with nothing to add adds nothing', Match.clock[1] < full && Match.clock[1] > full - 2000);
  rest();
  press('d2');
  Match.drop();
  hold(0.3);
  Match.clock[0] = 40;
  hold(0.1);
  check('a clock that runs out loses: black\'s game, on time', Match.over && Match.over.how === 'time' && Match.over.winner === 1 && Match.clock[0] === 0);
  check('and the piece that was up is let fall', Chess.held() === -1 && Match.hand === null);
  rest();

  // --- stalemate ------------------------------------------------------------------------------
  Match.play(Match.CONTROLS[2]);
  rest();
  Match.step(DT);
  check('ten moves are played to a stalemate', line('e2e3 a7a5 d1h5 a8a6 h5a5 h7h5 h2h4 a6h6 a5c7 f7f6 c7d7 e8f7 d7b7 d8d3 b7b8 d3h7 b8c8 f7g6 c8e6'));
  check('won by neither', Match.over && Match.over.how === 'stalemate' && Match.over.winner === -1 && !Match.check);

  // --- a reset ----------------------------------------------------------------------------------
  Match.reset();
  check('a reset ends the game', !Match.on && !Match.over);
  const t6 = rest();
  let home = true;
  for (let i = 0; i < 32; i++) home = home && stands(i, i < 8 ? i : i < 16 ? i : i < 24 ? 56 + i - 16 : 48 + i - 24) && Chess.mm.chess_state(i) === 0;
  check('and every piece is home, the taken ones back', home, t6.toFixed(2) + ' s');
  check('any piece can be taken again, black\'s too', Match.take(c[0], c[1]) && Chess.held() === 28 && Match.hand === null);
  Match.drop();
  rest();

  console.log(failures ? failures + ' failed' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
