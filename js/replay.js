// --- the replay ------------------------------------------------------------------
// a famous game (js/games.js) played back on the chess set (js/chess.js),
// its moves read by the rules (js/rules.js). watch(game) begins one: the
// set is reset, no one's to take, and once every piece is home the game
// plays, a move every GAP seconds at speed 1 (step). each move is the
// set's own: the piece is led to its square over the others, the piece it
// takes knocked off the board as it comes down on it, a castling rook led
// to its square, and a pawn on the last rank knocked off the board by the
// piece it becomes, a spare body of the set's brought in onto it. toggle
// stops and starts it, and starts it again from the first move once it has
// played out; faster picks the next of SPEEDS; next and back show one move
// on or back, and seek any number of them, each stopping it. the set is
// shown after some number of the game's moves (show) by where each of its
// BODIES bodies stands then (the set numbers them, js/chess.js), and
// nothing else: going back, a piece goes back to the square it came from,
// one taken is led back from where it lies, and a pawn's new piece is
// thrown off the board and the pawn led back; over more than one move at
// once, each piece goes straight to where it stands, and one taken on the
// way is thrown off the board with no piece coming down on it. the
// squares the last move shown went from and to are bordered in the set's
// last colour. stop ends it, the set as it stands.

const Replay = {
  SPEEDS: [0.5, 1, 2, 4], // times as many moves a second as one every GAP
  GAP: 1.2,               // s between moves at speed 1
  BODIES: 48,             // the set's bodies: a game's 32 pieces and 8 spares a side
  HOME: [4, 2, 3, 5, 6, 3, 2, 4], // the kind (the rules') of each of a side's back rank pieces, a to h

  on: false,      // a game is being played back
  live: false,    // the set has come to rest since it began, or began again
  playing: false, // its moves are being made, one after another
  speed: 1,       // which of SPEEDS
  wait: 0,        // s, at speed 1, until the next move
  game: null,     // the game, one of GAMES
  line: null,     // its moves, each { text, from, to, piece, taken, crowned }: as it is written, the squares it goes from and to, the set's body that makes it, the one it takes or -1, and the one that stands in a pawn's place as it is crowned or -1
  stands: null,   // stands[n], the set after n moves, { sq, kind }: each body's square, -1 for one taken and -2 for a spare not in the game, and its kind (the rules'), 0 for a spare never in it
  at: 0,          // how many moves the set is shown after

  // the side body i is, 0 white or 1 black
  side(i) {
    return i < 16 || (i >= 32 && i < 40) ? 0 : 1;
  },

  // game begun: its moves read from the start, and where every body
  // stands after each; the set reset, no one's to take, and the game
  // playing from its first move once the set is home. a pawn crowned is
  // taken off, and a body of its side stands on its square as what it
  // becomes: the first of that side's taken that is that kind, or else its
  // first spare not yet in the game
  watch(game) {
    if (!Chess.ready) return;
    const n = this.BODIES, first = { sq: new Int8Array(n).fill(-2), kind: new Uint8Array(n) };
    for (let f = 0; f < 8; f++) {
      first.sq[f] = f;
      first.sq[8 + f] = 8 + f;
      first.sq[16 + f] = 56 + f;
      first.sq[24 + f] = 48 + f;
      first.kind[f] = first.kind[16 + f] = this.HOME[f];
      first.kind[8 + f] = first.kind[24 + f] = Rules.PAWN;
    }
    const line = [], stands = [first];
    let pos = Rules.start();
    for (const text of game.moves.split(' ')) {
      const move = Rules.san(pos, text);
      if (!move) break;
      const was = stands[stands.length - 1], now = { sq: was.sq.slice(), kind: was.kind.slice() };
      const piece = was.sq.indexOf(move.from), taken = move.takes >= 0 ? was.sq.indexOf(move.takes) : -1, side = this.side(piece);
      let crowned = -1;
      if (move.promote) {
        for (let i = 0; i < n && crowned < 0; i++) if (was.sq[i] === -1 && was.kind[i] === move.promote && this.side(i) === side) crowned = i;
        for (let i = 32; i < n && crowned < 0; i++) if (was.sq[i] === -2 && this.side(i) === side) crowned = i;
      }
      if (taken >= 0) now.sq[taken] = -1;
      now.sq[piece] = move.to;
      if (move.rook) now.sq[was.sq.indexOf(move.rook.from)] = move.rook.to;
      if (crowned >= 0) {
        now.sq[piece] = -1;
        now.sq[crowned] = move.to;
        now.kind[crowned] = move.promote;
      }
      line.push({ text, from: move.from, to: move.to, piece, taken, crowned });
      stands.push(now);
      pos = Rules.play(pos, move);
    }
    this.on = true;
    this.live = false;
    this.playing = true;
    this.wait = this.GAP;
    this.game = game;
    this.line = line;
    this.stands = stands;
    this.at = 0;
    Chess.reset();
    Chess.mover(2);
  },

  // no game played back: the set left as it stands
  stop() {
    this.on = false;
    this.playing = false;
  },

  // dtS seconds on: nothing until the set has come to rest; then, while it
  // plays, the next move made once its wait is over, and the game stopped
  // at its last
  step(dtS) {
    if (!this.on) return;
    if (!this.live) {
      if (Chess.leading()) return;
      this.live = true;
    }
    if (!this.playing) return;
    this.wait -= dtS * this.SPEEDS[this.speed];
    if (this.wait > 0) return;
    this.wait = this.GAP;
    this.show(this.at + 1);
    if (this.at === this.line.length) this.playing = false;
  },

  // the set shown after n of the game's moves, held to those it has: each
  // body on the board no more by then taken off it, by the piece that
  // takes it if n is the next move and by none if not, one on it again led
  // back onto its square as the kind it is then, and one that stands
  // elsewhere led to its square; a pawn crowned by the next move is the
  // set's to crown, onto its square and knocked off by the body that
  // stands in its place, and neither is moved otherwise. the squares move
  // n went from and to are bordered in the last colour, and none before
  // the first
  show(n) {
    if (!this.on) return;
    n = Math.max(0, Math.min(this.line.length, Math.round(n)));
    if (n === this.at) return;
    const a = this.stands[this.at], b = this.stands[n], move = n === this.at + 1 ? this.line[this.at] : null;
    const crown = !!move && move.crowned >= 0;
    for (let i = 0; i < this.BODIES; i++) {
      if (a.sq[i] < 0 || b.sq[i] >= 0 || (crown && i === move.piece)) continue;
      Chess.off(i, move && move.taken === i ? move.piece : -1);
    }
    for (let i = 0; i < this.BODIES; i++) {
      if (b.sq[i] < 0 || (crown && i === move.crowned)) continue;
      if (a.sq[i] < 0) Chess.back(i, b.sq[i], b.kind[i]);
      else if (a.sq[i] !== b.sq[i]) Chess.go(i, b.sq[i]);
    }
    if (crown) Chess.crown(move.piece, move.crowned, move.to, b.kind[move.crowned]);
    Chess.unborder();
    if (n) {
      Chess.border(this.line[n - 1].from, 3);
      Chess.border(this.line[n - 1].to, 3);
    }
    this.at = n;
  },

  // stopped if it plays; started if not, from the first move, the set led
  // home first, if every move has been made
  toggle() {
    if (!this.on) return;
    this.playing = !this.playing;
    if (!this.playing) return;
    this.wait = this.GAP;
    if (this.at < this.line.length) return;
    this.show(0);
    this.live = false;
  },

  // the next of SPEEDS, the first after the last
  faster() {
    this.speed = (this.speed + 1) % this.SPEEDS.length;
  },

  // stopped, and the set shown one move on, one back, or after n moves
  next() {
    this.seek(this.at + 1);
  },
  back() {
    this.seek(this.at - 1);
  },
  seek(n) {
    this.playing = false;
    this.show(n);
  },

  // what the set is shown after, or was as the game stopped: the move
  // made last, as a game's score numbers it, white's '12. Nf3' and
  // black's '12... Nf6', or '' before the first
  said() {
    if (!this.at) return '';
    return Math.ceil(this.at / 2) + (this.at % 2 ? '. ' : '... ') + this.line[this.at - 1].text;
  },
};
