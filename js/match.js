// --- the match -------------------------------------------------------------------
// a game of chess on the chess set (js/chess.js), two people at one
// screen, by the rules (js/rules.js). play(control) begins one: the set is
// reset, and once every piece is home white is to move. the clocks start
// with white's first move: from then the side to move's runs.
// the side to move takes one of its own pieces (take): the squares it may
// go to are bordered on the set and, of those and the one it stands on,
// the nearest to the pointer on the board is filled. let go (drop) over one
// it may go to, it is drawn down onto that square and the move is made:
// the piece it takes is knocked off the board as it comes down on it, a
// castling rook is led over to its square, a pawn on the last rank is crowned a queen, the mover's
// clock stops with the control's seconds added and the other side is to
// move. let go nearest its own square, or called off (cancel), it goes
// back and no move is made. a piece let go where it was pressed, the
// pointer not moved, stays up over its square instead, and a press let go
// in one place after it (tap) sends it: onto a square it may go to, the
// one under the press or the one the piece drawn under it stands on, as if
// let go there, or else back down; until then the square such a press
// would pick is the one filled (aim). pressed again itself it is carried
// as any piece taken is, or put back if let go at once, and a press on
// another of the mover's pieces takes that one in its place. the game is
// over at checkmate, at stalemate,
// and when a clock runs out, which loses; from then the set is anyone's
// again, the pieces left as they stand. reset() ends a game and leads every
// piece home. the clocks run only while the set is stepped (step), so a set
// shut or off the screen holds them. with no game, take, drop and cancel
// are the set's own. match keeps which of the set's pieces stands on each
// square (at): 0 to 7 white's back rank a to h, 8 to 15 its pawns, 16 to
// 31 black's the same.

const Match = {
  // the time controls: each side's ms as it starts and the ms a move adds;
  // 0 ms is no clock
  CONTROLS: [
    { name: '3 + 2', ms: 180000, add: 2000 },
    { name: '10 minutes', ms: 600000, add: 0 },
    { name: 'unlimited', ms: 0, add: 0 },
  ],

  on: false,      // a game has been begun, and not reset away
  live: false,    // its pieces are home and white is, or has been, to move
  timed: false,   // white has made its first move: the clocks run
  control: null,  // its time control, one of CONTROLS
  pos: null,      // its position (Rules)
  at: null,       // the piece on each square, -1 for none
  clock: [0, 0],  // ms each side has left
  check: false,   // the side to move is in check
  over: null,     // how it ended, { how: 'checkmate' | 'stalemate' | 'time', winner: 0 | 1, or -1 for neither }, or null
  hand: null,     // the piece the side to move has taken, { piece, from, moves, up, again }: its square and its legal moves, whether it
                  //   is up with no press on it, and whether it was pressed again while up; or null

  // a game begun with control: the position and the pieces as they start,
  // the clocks full, the set reset and no one's to take until it is home
  play(control) {
    if (!Chess.ready) return;
    this.on = true;
    this.live = false;
    this.timed = false;
    this.control = control;
    this.pos = Rules.start();
    this.at = new Int8Array(64).fill(-1);
    for (let f = 0; f < 8; f++) {
      this.at[f] = f;
      this.at[8 + f] = 8 + f;
      this.at[56 + f] = 16 + f;
      this.at[48 + f] = 24 + f;
    }
    this.clock = [control.ms, control.ms];
    this.check = false;
    this.over = null;
    this.hand = null;
    Chess.reset();
    Chess.mover(2);
  },

  // no game: every piece led home, anyone's to take
  reset() {
    this.on = false;
    this.live = false;
    this.over = null;
    this.hand = null;
    Chess.reset();
    Chess.mover(-1);
  },

  // the set dtS seconds on, and the game with it: live, white to move,
  // once the set is home; then, once white has moved, the clock of the
  // side to move run down, and the game lost on time when it runs out
  step(dtS) {
    Chess.step(dtS);
    if (!this.on || this.over) return;
    if (!this.live) {
      if (Chess.leading()) return;
      this.live = true;
      Chess.mover(this.pos.turn);
      return;
    }
    if (!this.control.ms || !this.timed) return;
    const side = this.pos.turn;
    this.clock[side] -= dtS * 1000;
    if (this.clock[side] > 0) return;
    this.clock[side] = 0;
    this.end('time', 1 - side);
  },

  // a press at canvas px (x, y): whether it took a piece. in a game, only
  // the side to move's, and the squares it may go to are bordered (a pawn
  // reaching the last rank is crowned a queen, so only that move of its
  // four is kept). with a piece up, only a press on that piece, taken
  // again, or on another of the mover's on the board, taken in its place
  // as the first goes back, takes anything
  take(x, y) {
    const up = this.hand && this.hand.up ? this.hand : null;
    if (up) {
      const on = Chess.at(x, y);
      if (on < 0 || (on !== up.piece && (this.at.indexOf(on) < 0 || (on < 16) !== (this.pos.turn === 0)))) return false;
      if (on !== up.piece) this.cancel();
    }
    if (!Chess.take(x, y)) return false;
    if (!this.on || this.over) return true;
    const piece = Chess.held(), from = this.at.indexOf(piece);
    if (from < 0) return true;
    const moves = Rules.moves(this.pos).filter((m) => m.from === from && (!m.promote || m.promote === Rules.QUEEN));
    this.hand = { piece, from, moves, up: false, again: !!up && up.piece === piece };
    for (const m of moves) Chess.mark(m.to);
    return true;
  },

  // the piece held let go: in a game, onto the square filled, the move
  // there made, or back onto its own. let go where it was pressed, the
  // pointer not moved, it stays up, held over its square, or, pressed so
  // while it was up, goes back
  drop() {
    const h = this.hand;
    if (!h) { Chess.drop(); return; }
    if (Chess.aimed()) this.put(h, Chess.near());
    else if (h.again) this.cancel();
    else h.up = true;
  },

  // the piece in hand h let go onto square to: the move there made, or,
  // where it has none, back onto its own
  put(h, to) {
    const move = h.moves.find((m) => m.to === to);
    this.hand = null;
    Chess.unmark();
    if (move) this.make(move, h.piece);
    else Chess.go(h.piece, h.from);
  },

  // the square a press at canvas px (x, y) picks for the piece up: one it
  // may go to, where the piece drawn under the press stands (or, taken in
  // passing, the square the pawn that takes it goes to) or, failing that,
  // the board is under the press; or -1
  pick(x, y) {
    const h = this.hand, on = Chess.at(x, y), stands = on >= 0 && on !== h.piece ? this.at.indexOf(on) : -1;
    const taking = stands >= 0 && h.moves.find((m) => m.to === stands || m.takes === stands);
    if (taking) return taking.to;
    const sq = Chess.square(x, y);
    return h.moves.some((m) => m.to === sq) ? sq : -1;
  },

  // the pointer at canvas px (x, y) with nothing pressed (not numbers, off
  // the board): with a piece up, the square a press there would pick is
  // the one filled, or the piece's own
  aim(x, y) {
    const h = this.hand;
    if (!h || !h.up) return;
    const sq = this.pick(x, y);
    Chess.spot(sq >= 0 ? sq : h.from);
  },

  // a press let go where it was made, at canvas px (x, y), having taken
  // nothing: with a piece up, the piece is sent to the square it picks, as
  // if let go there, or back down where it picks none
  tap(x, y) {
    const h = this.hand;
    if (h && h.up) this.put(h, this.pick(x, y));
  },

  // the hold called off: in a game the piece goes back onto its square
  cancel() {
    const h = this.hand;
    this.hand = null;
    if (!h) { Chess.drop(); return; }
    Chess.unmark();
    Chess.go(h.piece, h.from);
  },

  // move made with piece, the one held: the piece it takes off the board
  // by it, piece onto its square, the castling rook led to its, a pawn on the
  // last rank crowned; the mover's clock, if it ran, given the control's
  // add, and the clocks running from white's first; and the
  // position after it, with the game over if the side now to move has no
  // move, by checkmate if it is in check and by stalemate if not
  make(move, piece) {
    const at = this.at, side = this.pos.turn;
    if (move.takes >= 0) {
      Chess.off(at[move.takes], piece);
      at[move.takes] = -1;
    }
    at[move.from] = -1;
    at[move.to] = piece;
    Chess.go(piece, move.to);
    if (move.rook) {
      const rook = at[move.rook.from];
      at[move.rook.from] = -1;
      at[move.rook.to] = rook;
      Chess.go(rook, move.rook.to);
    }
    if (move.promote) Chess.crown(piece);
    this.pos = Rules.play(this.pos, move);
    if (this.control.ms && this.timed) this.clock[side] += this.control.add;
    this.timed = true;
    this.check = Rules.check(this.pos);
    if (Rules.moves(this.pos).length) Chess.mover(this.pos.turn);
    else this.end(this.check ? 'checkmate' : 'stalemate', this.check ? side : -1);
  },

  // the game over, how and who won: nothing held by the game, a piece up
  // let fall, no square bordered, and the set anyone's
  end(how, winner) {
    this.over = { how, winner };
    if (this.hand && this.hand.up) Chess.drop();
    this.hand = null;
    Chess.unmark();
    Chess.mover(-1);
  },

  // ms as a clock says it, minutes and seconds, a second showing until it
  // is all gone
  figure(ms) {
    const s = Math.ceil(Math.max(0, ms) / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  },
};
