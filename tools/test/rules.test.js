// node tools/test/rules.test.js
//
// loads js/rules.js the way the page does, a classic script, in a vm
// context. checks the position a game starts from, that a move played
// leaves a new position and the one it was played from as it was, and
// perft, the count of the legal move tree's leaves, from six well known
// positions against their published counts. then by hand: fool's mate
// leaves white in check with no moves, a stalemate has no moves and no
// check, en passant takes the pawn beside it and only straight after it
// went two squares, castling moves king and rook and is not offered out of
// check, through or onto an attacked square, across a piece or without its
// right, a pawn reaching the last rank gives four moves and becomes what
// it is promoted to, and a king or rook moving or a rook taken on its
// starting square drops its castling right. last, moves read from their
// names in standard algebraic notation: a pawn's move and capture, en
// passant, a piece told apart by file, rank or both, x or not, castling
// with letters or zeros, promotion with = or not, a trailing +, #, ! or ?
// passed over, and null for a name that fits two moves, none, or a pawn
// reaching the last rank without its piece. exits 1 on failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}

// --- the script ------------------------------------------------------------------
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'rules.js'), 'utf8'), ctx, { filename: 'js/rules.js' });
const Rules = vm.runInContext('Rules', ctx);

// --- helpers ---------------------------------------------------------------------
// a square from its name: a1 0, h8 63
const sq = (name) => name.charCodeAt(0) - 97 + 8 * (name.charCodeAt(1) - 49);

// a position from fen's first four fields: pieces, side to move, castling, ep
function fen(text) {
  const [placement, turn, castle, ep] = text.split(' ');
  const board = new Int8Array(64), kinds = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };
  placement.split('/').forEach((row, i) => {
    let f = 0;
    for (const c of row) {
      if (c >= '1' && c <= '8') { f += Number(c); continue; }
      const kind = kinds[c.toLowerCase()];
      board[f + 8 * (7 - i)] = c === c.toLowerCase() ? -kind : kind;
      f++;
    }
  });
  let rights = 0;
  if (castle.includes('K')) rights |= 1;
  if (castle.includes('Q')) rights |= 2;
  if (castle.includes('k')) rights |= 4;
  if (castle.includes('q')) rights |= 8;
  return { board, turn: turn === 'w' ? 0 : 1, castle: rights, ep: ep === '-' ? -1 : sq(ep) };
}

// the legal move from one named square to another, the given promotion if any
function find(pos, from, to, promote = 0) {
  return Rules.moves(pos).find((m) => m.from === sq(from) && m.to === sq(to) && m.promote === promote);
}

// pos with the named moves played in turn, each of them required to be legal
function after(pos, ...names) {
  for (const name of names) {
    const m = find(pos, name.slice(0, 2), name.slice(2, 4));
    if (!m) throw new Error(name + ' is not legal');
    pos = Rules.play(pos, m);
  }
  return pos;
}

// leaves of the legal move tree depth moves deep
function perft(pos, depth) {
  const list = Rules.moves(pos);
  if (depth === 1) return list.length;
  let n = 0;
  for (let i = 0; i < list.length; i++) n += perft(Rules.play(pos, list[i]), depth - 1);
  return n;
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// --- the start -------------------------------------------------------------------
{
  check('the kinds: pawn 1, knight 2, bishop 3, rook 4, queen 5, king 6',
    Rules.PAWN === 1 && Rules.KNIGHT === 2 && Rules.BISHOP === 3 && Rules.ROOK === 4 && Rules.QUEEN === 5 && Rules.KING === 6);
  const pos = Rules.start(), want = fen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
  check('the start: an Int8Array of 64, every piece where it belongs',
    Object.prototype.toString.call(pos.board) === '[object Int8Array]' && pos.board.length === 64 && same(pos.board, want.board),
    Array.from(pos.board).join(','));
  check('white king on e1, black queen on d8, a black pawn on h7',
    pos.board[sq('e1')] === 6 && pos.board[sq('d8')] === -5 && pos.board[sq('h7')] === -1);
  check('the start: white to move, every castling right, no ep', pos.turn === 0 && pos.castle === 15 && pos.ep === -1);
  check('two starts are two positions', Rules.start() !== Rules.start() && Rules.start().board !== Rules.start().board);
  check('the start is not check', Rules.check(pos) === false);
}

// --- playing a move --------------------------------------------------------------
{
  const pos = Rules.start(), before = Array.from(pos.board);
  const list = Rules.moves(pos);
  const e4 = find(pos, 'e2', 'e4');
  const next = Rules.play(pos, e4);
  check('a move is { from, to, takes, rook, promote }',
    e4.from === sq('e2') && e4.to === sq('e4') && e4.takes === -1 && e4.rook === null && e4.promote === 0, JSON.stringify(e4));
  check('play gives a new position and a new board', next !== pos && next.board !== pos.board);
  check('and leaves the one it was played from as it was',
    same(pos.board, before) && pos.turn === 0 && pos.castle === 15 && pos.ep === -1 && Rules.moves(pos).length === list.length);
  check('e4: the pawn on e4, e2 empty, black to move', next.board[sq('e4')] === 1 && next.board[sq('e2')] === 0 && next.turn === 1);
  check('a pawn gone two squares sets ep to the square it passed over', next.ep === sq('e3'), next.ep);
  const nf6 = Rules.play(next, find(next, 'g8', 'f6'));
  check('any other move sets ep to -1', nf6.ep === -1 && nf6.turn === 0 && nf6.board[sq('f6')] === -2 && nf6.board[sq('g8')] === 0);
  const slow = after(Rules.start(), 'e2e3', 'a7a6', 'e3e4');
  check('a pawn gone one square twice sets no ep', slow.ep === -1);
}

// --- attacked --------------------------------------------------------------------
{
  const pos = Rules.start();
  check('at the start white attacks e3 and f3, not e4', Rules.attacked(pos, sq('e3'), 0) && Rules.attacked(pos, sq('f3'), 0) && !Rules.attacked(pos, sq('e4'), 0));
  check('and black attacks e6 and c6, not e5 or e3', Rules.attacked(pos, sq('e6'), 1) && Rules.attacked(pos, sq('c6'), 1) && !Rules.attacked(pos, sq('e5'), 1) && !Rules.attacked(pos, sq('e3'), 1));
  const q = fen('4k3/8/3p4/8/3Q4/8/8/4K3 w - -');
  check('a queen attacks along her lines and stops at a piece',
    Rules.attacked(q, sq('d6'), 0) && !Rules.attacked(q, sq('d7'), 0) && Rules.attacked(q, sq('h8'), 0) && Rules.attacked(q, sq('a1'), 0) && Rules.attacked(q, sq('a4'), 0) && !Rules.attacked(q, sq('e6'), 0));
}

// --- perft -----------------------------------------------------------------------
const PERFT = [
  ['the start', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -', [20, 400, 8902, 197281]],
  ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -', [48, 2039, 97862]],
  ['position 3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -', [14, 191, 2812, 43238, 674624]],
  ['position 4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq -', [6, 264, 9467, 422333]],
  ['position 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ -', [44, 1486, 62379]],
  ['position 6', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - -', [46, 2079, 89890]],
];
for (const [name, text, counts] of PERFT) {
  const t = Date.now(), got = counts.map((_, d) => perft(fen(text), d + 1));
  check('perft, ' + name + ', depth 1 to ' + counts.length, same(got, counts), got.join(' ') + ' in ' + (Date.now() - t) + ' ms');
}
check('perft from Rules.start() matches the start read from fen', perft(Rules.start(), 3) === 8902);

// --- mate and stalemate ----------------------------------------------------------
{
  const mate = after(Rules.start(), 'f2f3', 'e7e5', 'g2g4', 'd8h4');
  check('fool\'s mate: white in check with no moves', Rules.check(mate) && Rules.moves(mate).length === 0);
  const stale = fen('7k/5Q2/6K1/8/8/8/8/8 b - -');
  check('stalemate: black has no moves and is not in check', !Rules.check(stale) && Rules.moves(stale).length === 0);
  const checked = fen('4k3/8/8/8/8/8/8/4K2r w - -');
  check('in check, only moves out of it: the king off the first rank', Rules.check(checked) &&
    Rules.moves(checked).every((m) => m.from === sq('e1') && m.to >= 8), Rules.moves(checked).map((m) => m.to).join(','));
  const pinned = fen('4k3/4r3/8/8/8/8/4N3/4K3 w - -');
  check('a pinned piece has no moves off the line', Rules.moves(pinned).every((m) => m.from !== sq('e2')));
}

// --- en passant ------------------------------------------------------------------
{
  const pos = after(Rules.start(), 'e2e4', 'a7a6', 'e4e5', 'd7d5');
  const ep = find(pos, 'e5', 'd6');
  check('en passant: offered straight after d5, ep on d6', pos.ep === sq('d6') && !!ep);
  check('en passant: takes the pawn\'s own square, not the one moved to', ep && ep.takes === sq('d5') && ep.to === sq('d6'), ep && ep.takes);
  const next = Rules.play(pos, ep);
  check('en passant played: the pawn on d6, d5 and e5 empty',
    next.board[sq('d6')] === 1 && next.board[sq('d5')] === 0 && next.board[sq('e5')] === 0 && next.ep === -1);
  const late = after(pos, 'a2a3', 'a6a5');
  check('en passant: not offered a move later', !find(late, 'e5', 'd6'));
  const black = after(Rules.start(), 'a2a3', 'd7d5', 'a3a4', 'd5d4', 'e2e4');
  const bep = find(black, 'd4', 'e3');
  check('en passant for black: takes e4 landing on e3', bep && bep.takes === sq('e4') && Rules.play(black, bep).board[sq('e4')] === 0 && Rules.play(black, bep).board[sq('e3')] === -1);
  const exposed = fen('8/8/8/KPp4r/8/8/8/7k w - c6');
  check('en passant is not offered when it leaves the king attacked along the rank', !find(exposed, 'b5', 'c6'));
}

// --- castling --------------------------------------------------------------------
{
  const pos = fen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq -');
  const short = find(pos, 'e1', 'g1'), long = find(pos, 'e1', 'c1');
  check('castling king\'s side carries the rook\'s squares', short && short.rook && short.rook.from === sq('h1') && short.rook.to === sq('f1') && short.takes === -1);
  check('castling queen\'s side carries the rook\'s squares', long && long.rook && long.rook.from === sq('a1') && long.rook.to === sq('d1'));
  const s = Rules.play(pos, short);
  check('castled king\'s side: king on g1, rook on f1, e1 and h1 empty, white\'s rights gone',
    s.board[sq('g1')] === 6 && s.board[sq('f1')] === 4 && s.board[sq('e1')] === 0 && s.board[sq('h1')] === 0 && s.castle === 12, s.castle);
  const l = Rules.play(pos, long);
  check('castled queen\'s side: king on c1, rook on d1, a1 and e1 empty',
    l.board[sq('c1')] === 6 && l.board[sq('d1')] === 4 && l.board[sq('a1')] === 0 && l.board[sq('e1')] === 0 && l.castle === 12);
  const b = fen('r3k2r/8/8/8/8/8/8/R3K2R b KQkq -');
  const bs = Rules.play(b, find(b, 'e8', 'g8'));
  check('black castles too: king on g8, rook on f8, black\'s rights gone', bs.board[sq('g8')] === -6 && bs.board[sq('f8')] === -4 && bs.castle === 3);
  const offered = (text) => Rules.moves(fen(text)).filter((m) => m.rook).map((m) => m.to === sq('g1') ? 'short' : 'long').sort().join(' ');
  check('through an attacked square: f1 attacked, king\'s side not offered', offered('5r1k/8/8/8/8/8/8/R3K2R w KQ -') === 'long');
  check('through an attacked square: d1 attacked, queen\'s side not offered', offered('3r3k/8/8/8/8/8/8/R3K2R w KQ -') === 'short');
  check('onto an attacked square: g1 attacked, king\'s side not offered', offered('6rk/8/8/8/8/8/8/R3K2R w KQ -') === 'long');
  check('b1 attacked still allows queen\'s side, the king never crossing it', offered('1r5k/8/8/8/8/8/8/R3K2R w KQ -') === 'long short');
  check('out of check: neither side offered', offered('4r2k/8/8/8/8/8/8/R3K2R w KQ -') === '');
  check('a piece between: not offered', offered('7k/8/8/8/8/8/8/RN2K1NR w KQ -') === '');
  check('without the right: not offered', offered('7k/8/8/8/8/8/8/R3K2R w Q -') === 'long' && offered('7k/8/8/8/8/8/8/R3K2R w - -') === '');
}

// --- castling rights -------------------------------------------------------------
{
  const pos = fen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq -');
  check('the h1 rook moving drops white\'s king\'s side', after(pos, 'h1h2').castle === 14);
  check('the a1 rook moving drops white\'s queen\'s side', after(pos, 'a1b1').castle === 13);
  check('the king moving drops both of white\'s', after(pos, 'e1e2').castle === 12);
  check('a1 taking a8 drops white\'s queen\'s side and black\'s', after(pos, 'a1a8').castle === 5, after(pos, 'a1a8').castle);
  const b = fen('r3k2r/8/8/8/8/8/8/R3K2R b KQkq -');
  check('black\'s h8 rook taking h1 drops black\'s king\'s side and white\'s', after(b, 'h8h1').castle === 10, after(b, 'h8h1').castle);
  check('a rook taken on its starting square by another piece drops its right',
    after(fen('r3k2r/8/8/8/8/8/6b1/R3K2R b KQkq -'), 'g2h1').castle === 14);
  check('other moves keep the rights', after(Rules.start(), 'g1f3', 'b8c6', 'e2e4', 'e7e5').castle === 15);
}

// --- promotion -------------------------------------------------------------------
{
  const pos = fen('1r6/P7/8/7k/8/8/8/K7 w - -');
  const straight = Rules.moves(pos).filter((m) => m.from === sq('a7') && m.to === sq('a8'));
  check('a pawn reaching the last rank: four moves, queen, rook, bishop and knight',
    straight.length === 4 && straight.map((m) => m.promote).sort().join() === '2,3,4,5', straight.map((m) => m.promote).join());
  const taking = Rules.moves(pos).filter((m) => m.from === sq('a7') && m.to === sq('b8'));
  check('and four more taking on b8', taking.length === 4 && taking.every((m) => m.takes === sq('b8')));
  check('no move to the last rank without a promotion', Rules.moves(pos).every((m) => m.from !== sq('a7') || m.promote !== 0));
  const q = Rules.play(pos, find(pos, 'a7', 'a8', Rules.QUEEN));
  check('promoted to a queen: a queen on a8, a7 empty', q.board[sq('a8')] === 5 && q.board[sq('a7')] === 0);
  const n = Rules.play(pos, find(pos, 'a7', 'b8', Rules.KNIGHT));
  check('promoted to a knight taking: a knight on b8, the rook gone', n.board[sq('b8')] === 2);
  const b = fen('7k/8/8/8/8/8/p7/7K b - -');
  const bq = Rules.play(b, find(b, 'a2', 'a1', Rules.QUEEN));
  check('black promotes to a black queen', bq.board[sq('a1')] === -5 && bq.board[sq('a2')] === 0);
  check('and the queen gives check', Rules.check(bq));
}

// --- standard algebraic notation -------------------------------------------------
{
  // true when text names the legal move from one named square to another,
  // the given promotion if any, as Rules.moves gives it
  const reads = (pos, text, from, to, promote = 0) => {
    const m = Rules.san(pos, text), want = find(pos, from, to, promote);
    return !!m && !!want && JSON.stringify(m) === JSON.stringify(want) && Object.keys(m).join() === 'from,to,takes,rook,promote';
  };
  const start = Rules.start();
  check('san: e4 and e3, a pawn one or two squares', reads(start, 'e4', 'e2', 'e4') && reads(start, 'e3', 'e2', 'e3'));
  check('san: Nf3, a piece', reads(start, 'Nf3', 'g1', 'f3'));
  const black = after(start, 'e2e4');
  check('san: black\'s move for black to move', reads(black, 'e5', 'e7', 'e5') && reads(black, 'Nc6', 'b8', 'c6'));
  const d5 = after(start, 'e2e4', 'd7d5');
  check('san: exd5, a pawn taking', reads(d5, 'exd5', 'e4', 'd5') && Rules.san(d5, 'exd5').takes === sq('d5'));
  const ep = after(start, 'e2e4', 'a7a6', 'e4e5', 'd7d5');
  check('san: exd6 en passant takes the pawn on d5', reads(ep, 'exd6', 'e5', 'd6') && Rules.san(ep, 'exd6').takes === sq('d5'));
  const knights = fen('1n2k3/8/5n2/8/8/8/8/4K3 b - -');
  check('san: Nbd7 and Nfd7, two knights told apart by file', reads(knights, 'Nbd7', 'b8', 'd7') && reads(knights, 'Nfd7', 'f6', 'd7'));
  check('san: N8d7 and N6d7, and by rank', reads(knights, 'N8d7', 'b8', 'd7') && reads(knights, 'N6d7', 'f6', 'd7'));
  check('san: Nd7, fitting both, is null', Rules.san(knights, 'Nd7') === null);
  const rooks = fen('7k/8/8/8/8/4R3/8/K3R3 w - -');
  check('san: R1e2 and R3e2, two rooks on a file told apart by rank', reads(rooks, 'R1e2', 'e1', 'e2') && reads(rooks, 'R3e2', 'e3', 'e2'));
  check('san: Re2 and Ree2, fitting both, are null', Rules.san(rooks, 'Re2') === null && Rules.san(rooks, 'Ree2') === null);
  const queens = fen('1k6/8/8/8/4Q2Q/8/8/K6Q w - -');
  check('san: Qh4e1, three queens told apart by file and rank', reads(queens, 'Qh4e1', 'h4', 'e1'));
  check('san: Qee1 and Q1e1, where file or rank alone is enough', reads(queens, 'Qee1', 'e4', 'e1') && reads(queens, 'Q1e1', 'h1', 'e1'));
  check('san: Qe1, Qhe1 and Q4e1, each fitting two or three, are null',
    Rules.san(queens, 'Qe1') === null && Rules.san(queens, 'Qhe1') === null && Rules.san(queens, 'Q4e1') === null);
  const take = fen('4k3/8/8/3p4/8/2N5/8/4K3 w - -');
  check('san: Nxd5 and Nd5, the x or not', reads(take, 'Nxd5', 'c3', 'd5') && reads(take, 'Nd5', 'c3', 'd5'));
  const castle = fen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq -');
  check('san: O-O and O-O-O castle', reads(castle, 'O-O', 'e1', 'g1') && reads(castle, 'O-O-O', 'e1', 'c1') && Rules.san(castle, 'O-O').rook.from === sq('h1'));
  check('san: 0-0 and 0-0-0 too', reads(castle, '0-0', 'e1', 'g1') && reads(castle, '0-0-0', 'e1', 'c1'));
  const bcastle = fen('r3k2r/8/8/8/8/8/8/R3K2R b KQkq -');
  check('san: black castles on its own rank', reads(bcastle, 'O-O', 'e8', 'g8') && reads(bcastle, 'O-O-O', 'e8', 'c8'));
  check('san: Kg1 is not castling', Rules.san(castle, 'Kg1') === null);
  check('san: O-O without the right is null', Rules.san(fen('r3k2r/8/8/8/8/8/8/R3K2R w Qkq -'), 'O-O') === null);
  const promote = fen('1r6/P7/8/7k/8/8/8/K7 w - -');
  check('san: a8=Q and a8Q promote to a queen', reads(promote, 'a8=Q', 'a7', 'a8', Rules.QUEEN) && reads(promote, 'a8Q', 'a7', 'a8', Rules.QUEEN));
  check('san: axb8=N promotes to a knight taking', reads(promote, 'axb8=N', 'a7', 'b8', Rules.KNIGHT));
  check('san: a8 and axb8, no piece named, are null', Rules.san(promote, 'a8') === null && Rules.san(promote, 'axb8') === null);
  check('san: a8=K is null', Rules.san(promote, 'a8=K') === null);
  check('san: a trailing +, #, ! or ? is passed over',
    reads(start, 'e4!', 'e2', 'e4') && reads(start, 'e4?!', 'e2', 'e4') && reads(start, 'Nf3!!', 'g1', 'f3') &&
    reads(after(start, 'f2f3', 'e7e5', 'g2g4'), 'Qh4#', 'd8', 'h4') && reads(after(start, 'e2e4', 'f7f5'), 'Qh5+', 'd1', 'h5'));
  check('san: an illegal move is null: e5, Nf4 and Ke2 at the start',
    Rules.san(start, 'e5') === null && Rules.san(start, 'Nf4') === null && Rules.san(start, 'Ke2') === null);
  check('san: a pinned knight\'s move is null', Rules.san(fen('4k3/4r3/8/8/8/8/4N3/4K3 w - -'), 'Nc3') === null);
  check('san: text that is no move is null', Rules.san(start, '') === null && Rules.san(start, 'e9') === null && Rules.san(start, '1-0') === null);
}

console.log(failures ? failures + ' failed' : 'all passed');
process.exit(failures ? 1 : 0);
