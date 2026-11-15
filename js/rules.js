// --- the rules of chess --------------------------------------------------------
// the rules a game on the chess set is played by: every legal move from a
// position, and the position a move leaves. a square is a number, file + 8
// * rank: a1 0, h1 7, a2 8, h8 63. a side is 0 for white, 1 for black. a
// board is an Int8Array of 64: 0 an empty square, a white piece its kind
// (PAWN 1 to KING 6), a black piece minus its kind. a position is { board,
// turn, castle, ep }: turn the side to move, castle's bits the castling
// still allowed (1 white king's side, 2 white queen's side, 4 black king's
// side, 8 black queen's side), and ep the square a pawn that has just gone
// two squares passed over, or -1. a move is { from, to, takes, rook,
// promote }: takes the square of the piece taken, or -1 (to, but the
// pawn's own square en passant), rook the castling rook's { from, to } or
// null, and promote the kind a pawn reaching the last rank becomes, or 0.
// moves are found plainly: each piece's moves as it moves, then those that
// leave the mover's own king attacked dropped, and a move is read from its
// name in standard algebraic notation, as pgn writes it, by finding the
// one legal move that fits it. there are no draws here, by repetition,
// fifty moves or material.

const Rules = {
  PAWN: 1, KNIGHT: 2, BISHOP: 3, ROOK: 4, QUEEN: 5, KING: 6,

  JUMPS: [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]], // a knight's, each [file, rank]
  STEPS: [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]],   // a king's, and the lines the others slide along: four straight, four diagonal
  RIGHTS: { 0: 2, 4: 3, 7: 1, 56: 8, 60: 12, 63: 4 }, // the castling bits a move from or onto each of these squares drops
  PROMOTE: [5, 4, 3, 2], // what a pawn reaching the last rank may become: queen, rook, bishop, knight

  // the square at file f and rank r, or -1 off the board
  on(f, r) {
    return f >= 0 && f < 8 && r >= 0 && r < 8 ? f + 8 * r : -1;
  },

  // the position a game starts from
  start() {
    const board = new Int8Array(64), back = [4, 2, 3, 5, 6, 3, 2, 4];
    for (let f = 0; f < 8; f++) {
      board[f] = back[f];
      board[8 + f] = 1;
      board[48 + f] = -1;
      board[56 + f] = -back[f];
    }
    return { board, turn: 0, castle: 15, ep: -1 };
  },

  // true when side by attacks square: looked for outward from the square, a
  // pawn, knight or king of by's a step away, or a slider of by's the first
  // piece met along a line
  attacked(pos, square, by) {
    const b = pos.board, s = by ? -1 : 1, f = square % 8, r = square >> 3;
    for (let i = -1; i <= 1; i += 2) {
      const p = this.on(f + i, r - s);
      if (p >= 0 && b[p] === s * this.PAWN) return true;
    }
    for (let i = 0; i < 8; i++) {
      const n = this.on(f + this.JUMPS[i][0], r + this.JUMPS[i][1]);
      if (n >= 0 && b[n] === s * this.KNIGHT) return true;
      const k = this.on(f + this.STEPS[i][0], r + this.STEPS[i][1]);
      if (k >= 0 && b[k] === s * this.KING) return true;
    }
    for (let i = 0; i < 8; i++) {
      const df = this.STEPS[i][0], dr = this.STEPS[i][1], slider = i < 4 ? this.ROOK : this.BISHOP;
      for (let x = f + df, y = r + dr; x >= 0 && x < 8 && y >= 0 && y < 8; x += df, y += dr) {
        const p = b[x + 8 * y];
        if (!p) continue;
        if (p === s * slider || p === s * this.QUEEN) return true;
        break;
      }
    }
    return false;
  },

  // true when the side to move's king is attacked
  check(pos) {
    return this.attacked(pos, pos.board.indexOf(pos.turn ? -this.KING : this.KING), 1 - pos.turn);
  },

  // every legal move for the side to move
  moves(pos) {
    const b = pos.board, side = pos.turn, them = 1 - side, s = side ? -1 : 1, list = [];
    // a move onto to, four of them for a pawn reaching the last rank
    const add = (from, to, takes) => {
      if (b[from] * s === this.PAWN && (to < 8 || to >= 56)) {
        for (let i = 0; i < 4; i++) list.push({ from, to, takes, rook: null, promote: this.PROMOTE[i] });
      } else {
        list.push({ from, to, takes, rook: null, promote: 0 });
      }
    };
    for (let from = 0; from < 64; from++) {
      const kind = b[from] * s, f = from % 8, r = from >> 3;
      if (kind <= 0) continue;
      if (kind === this.PAWN) {
        // one ahead onto an empty square, two from its first rank, and one
        // ahead diagonally onto the other side's piece or the ep square
        const one = from + 8 * s;
        if (!b[one]) {
          add(from, one, -1);
          if (r === (side ? 6 : 1) && !b[one + 8 * s]) add(from, one + 8 * s, -1);
        }
        for (let i = -1; i <= 1; i += 2) {
          const to = this.on(f + i, r + s);
          if (to < 0) continue;
          if (b[to] * s < 0) add(from, to, to);
          else if (to === pos.ep) add(from, to, to - 8 * s);
        }
      } else if (kind === this.KNIGHT || kind === this.KING) {
        // a step, onto an empty square or the other side's piece
        const steps = kind === this.KNIGHT ? this.JUMPS : this.STEPS;
        for (let i = 0; i < 8; i++) {
          const to = this.on(f + steps[i][0], r + steps[i][1]);
          if (to >= 0 && b[to] * s <= 0) add(from, to, b[to] ? to : -1);
        }
      } else {
        // a bishop along the diagonals, a rook along the straight lines, a
        // queen along both, each up to the edge or the first piece, taking
        // it if it is the other side's
        const first = kind === this.BISHOP ? 4 : 0, end = kind === this.ROOK ? 4 : 8;
        for (let i = first; i < end; i++) {
          const df = this.STEPS[i][0], dr = this.STEPS[i][1];
          for (let x = f + df, y = r + dr; x >= 0 && x < 8 && y >= 0 && y < 8; x += df, y += dr) {
            const to = x + 8 * y;
            if (b[to] * s > 0) break;
            add(from, to, b[to] ? to : -1);
            if (b[to]) break;
          }
        }
      }
    }
    // castling: with its right, king and rook home, the squares between them
    // empty, and the king not in check, passing over or landing on an
    // attacked square
    const home = side ? 56 : 0, king = s * this.KING, rook = s * this.ROOK;
    const safe = (square) => !this.attacked(pos, square, them);
    if (b[home + 4] === king && safe(home + 4)) {
      if ((pos.castle & (side ? 4 : 1)) && b[home + 7] === rook && !b[home + 5] && !b[home + 6] && safe(home + 5) && safe(home + 6)) {
        list.push({ from: home + 4, to: home + 6, takes: -1, rook: { from: home + 7, to: home + 5 }, promote: 0 });
      }
      if ((pos.castle & (side ? 8 : 2)) && b[home] === rook && !b[home + 1] && !b[home + 2] && !b[home + 3] && safe(home + 3) && safe(home + 2)) {
        list.push({ from: home + 4, to: home + 2, takes: -1, rook: { from: home, to: home + 3 }, promote: 0 });
      }
    }
    // legal: those after which the mover's king is not attacked
    return list.filter((m) => {
      const next = this.play(pos, m);
      return !this.attacked(next, next.board.indexOf(king), them);
    });
  },

  // the position after move, a new one: pos is left as it was
  play(pos, move) {
    const b = pos.board.slice(), piece = b[move.from];
    if (move.takes >= 0) b[move.takes] = 0;
    b[move.from] = 0;
    b[move.to] = move.promote ? Math.sign(piece) * move.promote : piece;
    if (move.rook) {
      b[move.rook.to] = b[move.rook.from];
      b[move.rook.from] = 0;
    }
    const castle = pos.castle & ~((this.RIGHTS[move.from] || 0) | (this.RIGHTS[move.to] || 0));
    const ep = Math.abs(piece) === this.PAWN && Math.abs(move.to - move.from) === 16 ? (move.from + move.to) / 2 : -1;
    return { board: b, turn: 1 - pos.turn, castle, ep };
  },

  // the legal move text names for the side to move, or null when it names
  // none or more than one. text is O-O or O-O-O (or with zeros) to castle,
  // else the piece, N B R Q or K and none for a pawn, the file, rank or
  // both it moves from when they are needed to tell two apart, an x or
  // not, the square it moves to, and the piece a pawn reaching the last
  // rank becomes, after an = or not: e4, exd5, Nbd7, R1e2, Qh4e1, e8=Q. a
  // trailing +, #, ! or ? is passed over.
  san(pos, text) {
    const t = text.replace(/[+#!?]+$/, '').replace(/0/g, 'O'), list = this.moves(pos);
    let fit;
    if (t === 'O-O' || t === 'O-O-O') {
      const to = (pos.turn ? 56 : 0) + (t === 'O-O' ? 6 : 2);
      fit = list.filter((m) => m.rook && m.to === to);
    } else {
      const p = /^([NBRQK]?)([a-h]?)([1-8]?)x?([a-h][1-8])=?([NBRQ]?)$/.exec(t);
      if (!p) return null;
      const kind = p[1] ? 'NBRQK'.indexOf(p[1]) + 2 : this.PAWN, promote = p[5] ? 'NBRQ'.indexOf(p[5]) + 2 : 0;
      const to = p[4].charCodeAt(0) - 97 + 8 * (p[4].charCodeAt(1) - 49);
      fit = list.filter((m) => !m.rook && m.to === to && m.promote === promote && Math.abs(pos.board[m.from]) === kind &&
        (!p[2] || m.from % 8 === p[2].charCodeAt(0) - 97) && (!p[3] || m.from >> 3 === p[3].charCodeAt(0) - 49));
    }
    return fit.length === 1 ? fit[0] : null;
  },
};
