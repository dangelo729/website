// --- the chess set ---------------------------------------------------------------
// chebble's item, in personal work, holds chebble's chess set, drawn in 3d
// by third_dimension in its outline look: a board with the 32 pieces on it,
// lying on a table that is never drawn, and a camera turned round it and
// over it and zoomed in on it; the pieces are rigid bodies that can be
// picked up, carried, dropped and knocked over (take, carry, drop), and led
// back to where they start, meeting each other on the way (reset), and the
// piece under the pointer is drawn in the hover colour (hover). for a
// famous game played back on it (js/replay.js) the set also keeps every
// piece from being taken (mover), says where a point of the board is
// drawn, for what the page draws over it (point), leads a piece to a
// square (go), has a piece taken knocked off the board by the one that
// takes it (off) or leads it back onto a square (back), has a pawn on its
// last rank knocked off by the piece it becomes, one of 16 spare bodies it
// keeps out of sight, 8 a side (crown), and borders squares (border,
// unborder); it knows nothing of the rules. and it says what touched in
// its last step (words), for its sound (js/clack.js). all of it is
// chebble/chess.wasm, chebble's, built there and copied here by
// tools/chebble-web, run on the main thread a step a frame. the wasm is
// checked with the server before any copy is used, as the ship's is
// (js/ship.js), and instantiated once. what comes out is the picture, a v
// a pixel in the page's colours (colours) as Framebuffer's blits take it
// (js/raster.js), a view on the wasm's memory that a step rewrites only
// when something has changed, its camera fitted so the whole board stays
// inside it however it is turned; and, beside it, which piece is drawn at
// each of its px (at). what the page asks for before the wasm is in, its
// colours, its look and its size, is kept and handed over as it comes in.
// a body is a number: 0 to 7 white's back rank a to h, 8 to 15 its pawns,
// 16 to 31 black's the same, 32 to 39 white's spares and 40 to 47 black's.
// a square is its file + 8 * its rank, a1 0 .. h8 63.

const Chess = {
  WASM: 'chebble/chess.wasm',
  KINDS: [-1, 0, 2, 3, 1, 4, 5], // the wasm's number for each of the rules' kinds (js/rules.js), none -1: a pawn 0, a rook 1, a knight 2, a bishop 3, a queen 4, a king 5
  WORD: 16,                      // floats a word (words)

  ready: false,   // the wasm is in and the picture is its
  picture: null,  // { px, w, h }, a view on the wasm's memory
  asked: false,   // the wasm has been fetched for
  mm: null,       // its exports, once in
  buffer: null,   // its memory's buffer the view is on
  want: { paper: 0, ink: 1, tone: 2, hover: 3, early: 3, last: 3, table: 0, tableInk: 1, look: 1, w: 0, h: 0 }, // what the page has asked for

  // the wasm fetched and instantiated, once: made, handed what the page
  // has asked for, its first frame drawn, and its picture viewed. a set
  // whose memory could not be had is never ready
  load(win) {
    if (this.asked) return;
    this.asked = true;
    win.fetch(this.WASM, { cache: 'no-cache' })
      .then((r) => r.arrayBuffer())
      .then((bytes) => WebAssembly.instantiate(bytes, {}))
      .then(({ instance }) => {
        const mm = instance.exports, a = this.want;
        if (mm._initialize) mm._initialize();
        if (!mm.chess_init()) return;
        mm.chess_colours(a.paper, a.ink, a.tone, a.hover, a.early, a.last, a.table, a.tableInk);
        mm.chess_look(a.look);
        if (a.w && a.h) mm.chess_size(a.w, a.h);
        mm.chess_step(0);
        this.mm = mm;
        this.view();
        this.ready = true;
      })
      .catch(() => {});
  },

  // the picture made again on the wasm's memory at its size as drawn
  view() {
    const mm = this.mm, buf = mm.memory.buffer, w = mm.chess_w(), h = mm.chess_h();
    this.picture = { px: new Uint16Array(buf, mm.chess_px(), w * h), w, h };
    this.buffer = buf;
  },

  // the v the picture draws each class in: the board's and the pieces'
  // paper and ink, the tone black's pieces are filled with in the tone
  // look, the hover colour a piece under the pointer, or held, has where it
  // would have the ink, the early and the last colours, two more a square
  // may be bordered in (border), the hover colour where they are not
  // given, and the table, where nothing is drawn, with its ink, the line of
  // the ring under a piece held, the paper and the ink where they are not
  // given
  colours(paper, ink, tone, hover, early = hover, last = hover, table = paper, tableInk = ink) {
    Object.assign(this.want, { paper, ink, tone, hover, early, last, table, tableInk });
    if (this.ready) this.mm.chess_colours(paper, ink, tone, hover, early, last, table, tableInk);
  },

  // the look: 1, solid, black's pieces in ink with paper lines, as it
  // starts; 0, the tone look, in the tone with ink lines
  look(n) {
    this.want.look = n;
    if (this.ready) this.mm.chess_look(n);
  },

  // the canvas w x h px (the wasm holds it to 1920 x 1200), drawn at that
  // size from the next step
  size(w, h) {
    if (w === this.want.w && h === this.want.h) return;
    this.want.w = w;
    this.want.h = h;
    if (this.ready) this.mm.chess_size(w, h);
  },

  // one frame, dtS seconds on: the picture drawn again only if something
  // has changed, and viewed again at the size it was drawn at
  step(dtS) {
    if (!this.ready) return;
    const mm = this.mm;
    mm.chess_step(dtS);
    if (mm.memory.buffer !== this.buffer || mm.chess_w() !== this.picture.w || mm.chess_h() !== this.picture.h) this.view();
  },

  // what touched in the last step, as the set's solver found it: a piece
  // and a piece, the board or the table, WORD floats a word, in the
  // chessboard engine's own terms (js/clack.js hands them to it as they
  // are). a view on the wasm's memory that the next step rewrites; an
  // empty one before the wasm is in
  words() {
    if (!this.ready) return new Float32Array(0);
    const mm = this.mm;
    return new Float32Array(mm.memory.buffer, mm.chess_words(), mm.chess_said() * this.WORD);
  },

  // the body drawn at canvas px (x, y), or -1 for none
  at(x, y) {
    return this.ready ? this.mm.chess_at(x, y) : -1;
  },

  // the body under the pointer, or -1 for none: drawn in the hover colour
  // from the next step, unless one is held
  hover(i) {
    if (this.ready) this.mm.chess_hover(i);
  },

  // a press at canvas px (x, y): whether it took hold of the piece there
  take(x, y) {
    return this.ready && this.mm.chess_take(x, y) === 1;
  },

  // the pointer at canvas px (x, y) while a piece is held
  carry(x, y) {
    if (this.ready) this.mm.chess_carry(x, y);
  },

  // the piece held let go
  drop() {
    if (this.ready) this.mm.chess_drop();
  },

  // the camera turned round radians further round the board and over
  // radians further over it, the board's near side going right and down;
  // the drawn camera eases there over the next steps
  turn(round, over) {
    if (this.ready) this.mm.chess_turn(round, over);
  },

  // the camera zoomed by times as far in again (under 1, out), no further
  // out than the whole board in the canvas and no further in than the set
  // lets it; the drawn zoom eases there over the next steps. whether that
  // moved it
  zoom(by) {
    return this.ready && this.mm.chess_zoom(by) === 1;
  },

  // each of the 32 led back to where it starts over the steps that follow,
  // nothing held, no square bordered, no pawn waiting to be crowned, the
  // pieces taken off the board led back from where they lie, and each
  // spare that came in led off out of sight
  reset() {
    if (this.ready) this.mm.chess_reset();
  },

  // whose pieces a press may take: -1 anyone's, as it starts, 0 white's, 1
  // black's, 2 no one's. but for anyone's, a piece knocked off the square
  // it stands on is led back to it
  mover(side) {
    if (this.ready) this.mm.chess_mover(side);
  },

  // the canvas px the board's point (x, y, z) is drawn at as of the last
  // step, { x, y }: squares from its top's middle, x from the a file's
  // side to the h file's, y up, z from white's side to black's
  point(x, y, z) {
    if (!this.ready) return { x: NaN, y: NaN };
    const at = new Float32Array(this.mm.memory.buffer, this.mm.chess_point(x, y, z), 2);
    return { x: at[0], y: at[1] };
  },

  // body i stands on square sq from now: held, it is let go and drawn
  // down onto it; not held, it is led there over the others
  go(i, sq) {
    if (this.ready) this.mm.chess_go(i, sq);
  },

  // body i taken off the board by body by (-1 for none): it stands where
  // it is, light, until by comes down on it and shoves it, then is thrown
  // off the board to lie on the table, until back or a reset leads it back
  off(i, by = -1) {
    if (this.ready) this.mm.chess_off(i, by);
  },

  // body i, off the board, a piece on it again, standing on square sq
  // from now, led there over the others from wherever it lies; a spare is
  // the rules' kind (a knight, a bishop, a rook or a queen) first, and one
  // still out of sight comes in from off the canvas
  back(i, sq, kind) {
    if (this.ready) this.mm.chess_back(i, sq, this.KINDS[kind]);
  },

  // pawn i crowned on square sq, replaced there by body by, of its side,
  // as the rules' kind: the pawn is led onto sq, or stands there already,
  // and once it does, by is brought in as back brings it, comes down on
  // the pawn and knocks it off the board
  crown(i, by, sq, kind) {
    if (this.ready) this.mm.chess_crown(i, by, sq, this.KINDS[kind]);
  },

  // square sq bordered in colour n, 1 the hover colour, 2 the early, 3 the
  // last, or 0 for none, until it is bordered otherwise, unborder or a
  // reset; and no square bordered
  border(sq, n) {
    if (this.ready) this.mm.chess_border(sq, n);
  },
  unborder() {
    if (this.ready) this.mm.chess_unborder();
  },

  // whether any piece is being led to where it stands
  leading() {
    return this.ready && this.mm.chess_leading() === 1;
  },
};
