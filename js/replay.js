// --- the replay ------------------------------------------------------------------
// a famous game (js/games.js) played back on the chess set (js/chess.js),
// its moves read by the rules (js/rules.js). watch(game) begins one: the
// set is reset, no one's to take, and once every piece is home the game
// plays, a move every GAP seconds at speed 1 (step). each move is the
// set's own: the piece is led to its square over the others, the piece it
// takes knocked off the board as it comes down on it, a castling rook led
// to its square, a pawn on the last rank crowned. toggle stops and starts
// it, and starts it again from the first move once it has played out;
// faster picks the next of SPEEDS; next and back show one move on or
// back, and seek any number of them, each stopping it. the set is shown
// after some number of the game's moves (show) by where each piece stands
// then, and nothing else: going back, a piece goes back to the square it
// came from, one taken is led back from where it lies and a queen is a
// pawn again; over more than one move at once, each piece goes straight
// to where it stands, and one taken on the way is thrown off the board
// with no piece coming down on it. stop ends it, the set as it stands.

const Replay = {
  SPEEDS: [0.5, 1, 2, 4], // times as many moves a second as one every GAP
  GAP: 1.2,               // s between moves at speed 1

  on: false,      // a game is being played back
  live: false,    // the set has come to rest since it began, or began again
  playing: false, // its moves are being made, one after another
  speed: 1,       // which of SPEEDS
  wait: 0,        // s, at speed 1, until the next move
  game: null,     // the game, one of GAMES
  line: null,     // its moves, each { text, piece, taken }: as it is written, the set's piece that makes it, and the one it takes or -1
  stands: null,   // stands[n], the set after n moves, { sq, queen }: each of its 32 pieces' square, or -1 for one taken, and whether it is a queen crowned
  at: 0,          // how many moves the set is shown after

  // game begun: its moves read from the start, and where every piece
  // stands after each; the set reset, no one's to take, and the game
  // playing from its first move once the set is home
  watch(game) {
    if (!Chess.ready) return;
    const first = { sq: new Int8Array(32), queen: new Uint8Array(32) };
    for (let f = 0; f < 8; f++) {
      first.sq[f] = f;
      first.sq[8 + f] = 8 + f;
      first.sq[16 + f] = 56 + f;
      first.sq[24 + f] = 48 + f;
    }
    const line = [], stands = [first];
    let pos = Rules.start();
    for (const text of game.moves.split(' ')) {
      const move = Rules.san(pos, text);
      if (!move) break;
      const was = stands[stands.length - 1], now = { sq: was.sq.slice(), queen: was.queen.slice() };
      const piece = was.sq.indexOf(move.from), taken = move.takes >= 0 ? was.sq.indexOf(move.takes) : -1;
      if (taken >= 0) now.sq[taken] = -1;
      now.sq[piece] = move.to;
      if (move.rook) now.sq[was.sq.indexOf(move.rook.from)] = move.rook.to;
      if (move.promote) now.queen[piece] = 1;
      line.push({ text, piece, taken });
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
  // piece that stands elsewhere then led to its square, one taken by then
  // taken off the board, by the piece that takes it if n is the next move
  // and by none if not, one taken no more led back onto its square, and
  // each pawn a queen or not as it is then
  show(n) {
    if (!this.on) return;
    n = Math.max(0, Math.min(this.line.length, Math.round(n)));
    if (n === this.at) return;
    const a = this.stands[this.at], b = this.stands[n], move = n === this.at + 1 ? this.line[this.at] : null;
    for (let i = 0; i < 32; i++) if (a.sq[i] >= 0 && b.sq[i] < 0) Chess.off(i, move && move.taken === i ? move.piece : -1);
    for (let i = 0; i < 32; i++) {
      if (a.queen[i] !== b.queen[i]) Chess.crown(i, !!b.queen[i]);
      if (b.sq[i] < 0) continue;
      if (a.sq[i] < 0) Chess.back(i, b.sq[i]);
      else if (a.sq[i] !== b.sq[i]) Chess.go(i, b.sq[i]);
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
