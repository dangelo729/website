// --- the chess set ---------------------------------------------------------------
// chess, in doodles, is a chess set drawn in 3d by third_dimension in its
// outline look: a board with the 32 pieces on it, lying on a table that is
// never drawn, and a camera turned round it and over it and zoomed in on
// it; the pieces are rigid bodies that can be picked up, carried, dropped
// and knocked over (take, carry, drop), and led back to where they start,
// meeting each other on the way (reset), and the piece under the pointer
// is drawn in the hover colour (hover). for a game played on it
// (js/match.js) the set also keeps to whose pieces may be taken (mover),
// borders the squares the piece held may be put on and fills the nearest
// of them to the pointer or the one the page picks (mark, near, aimed,
// spot, square), draws a piece let go down onto a square or leads
// one there (go), has a piece taken knocked off the board by the one that
// takes it (off) or leads it back onto a square (back), and crowns a pawn
// or makes it a pawn again (crown); it knows nothing of the rules.
// all of it is chess/chess.wasm,
// built by tools/chess-web, run on the main thread a step a frame. the
// wasm is checked with the server before any copy is used, as the ship's
// is (js/ship.js), and instantiated once. what comes out is the picture,
// a v a pixel in the page's colours (colours) as Framebuffer's blits take
// it (js/raster.js), a view on the wasm's memory that a step rewrites only
// when something has changed, its camera fitted so the whole board stays
// inside it however it is turned; and, beside it, which piece is drawn at
// each of its px (at). what the page asks for before the wasm is in, its
// colours, its look and its size, is kept and handed over as it comes in.

const Chess = {
  WASM: 'chess/chess.wasm',

  ready: false,   // the wasm is in and the picture is its
  picture: null,  // { px, w, h }, a view on the wasm's memory
  asked: false,   // the wasm has been fetched for
  mm: null,       // its exports, once in
  buffer: null,   // its memory's buffer the view is on
  want: { paper: 0, ink: 1, tone: 2, hover: 3, look: 1, w: 0, h: 0 }, // what the page has asked for

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
        mm.chess_colours(a.paper, a.ink, a.tone, a.hover);
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

  // the v the picture draws each class in: the paper, the ink, the tone
  // black's pieces are filled with in the tone look, and the hover colour a
  // piece under the pointer, or held, has where it would have the ink
  colours(paper, ink, tone, hover) {
    Object.assign(this.want, { paper, ink, tone, hover });
    if (this.ready) this.mm.chess_colours(paper, ink, tone, hover);
  },

  // the look: 1, solid, black's pieces in ink with paper lines, as it
  // starts; 0, the tone look, in the tone with ink lines
  look(n) {
    this.want.look = n;
    if (this.ready) this.mm.chess_look(n);
  },

  // the canvas w x h px (the wasm holds it to 1280 x 720), drawn at that
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

  // the piece drawn at canvas px (x, y), 0 .. 31, or -1 for none
  at(x, y) {
    return this.ready ? this.mm.chess_at(x, y) : -1;
  },

  // the piece under the pointer, 0 .. 31, or -1 for none: drawn in the
  // hover colour from the next step, unless one is held
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

  // every piece led back to where it starts over the steps that follow,
  // nothing held, no square marked, the pieces taken off the board led
  // back from where they lie and every pawn crowned a pawn again
  reset() {
    if (this.ready) this.mm.chess_reset();
  },

  // whose pieces a press may take: -1 anyone's, as it starts, 0 white's, 1
  // black's, 2 no one's. but for anyone's, a piece knocked off the square
  // it stands on is led back to it
  mover(side) {
    if (this.ready) this.mm.chess_mover(side);
  },

  // the piece held, 0 .. 31 (0 to 7 white's back rank a to h, 8 to 15 its
  // pawns, 16 to 31 black's the same), or -1 for none
  held() {
    return this.ready ? this.mm.chess_held() : -1;
  },

  // square sq (file + 8 * rank, a1 0 .. h8 63) bordered in the hover
  // colour, one the piece held may be put on; and none bordered
  mark(sq) {
    if (this.ready) this.mm.chess_mark(sq);
  },
  unmark() {
    if (this.ready) this.mm.chess_unmark();
  },

  // the square filled in the hover colour as of the last step, while white
  // or black holds a piece: the one it stands on, or, once the pointer has
  // moved from where it took it, the nearest to the pointer on the board of
  // the squares bordered and that one; or -1
  near() {
    return this.ready ? this.mm.chess_near() : -1;
  },

  // whether the pointer has moved from where it took the piece held, far
  // enough to pick the square filled: false for a press still where it began
  aimed() {
    return this.ready && this.mm.chess_aimed() === 1;
  },

  // while a piece is held, the square filled is sq, the page's pick in the
  // pointer's place, until the piece is let go or another taken; -1, the
  // set picks it again
  spot(sq) {
    if (this.ready) this.mm.chess_spot(sq);
  },

  // the square of the board under canvas px (x, y), or -1 for none
  square(x, y) {
    return this.ready ? this.mm.chess_square(x, y) : -1;
  },

  // piece i stands on square sq from now: held, it is let go and drawn
  // down onto it; not held, it is led there over the others
  go(i, sq) {
    if (this.ready) this.mm.chess_go(i, sq);
  },

  // piece i taken off the board by piece by (-1 for none): it stands
  // where it is, light, until by comes down on it and shoves it, then is
  // thrown off the board to lie on the table, until a reset leads it back
  off(i, by = -1) {
    if (this.ready) this.mm.chess_off(i, by);
  },

  // piece i, taken off the board, a piece on it again, standing on square
  // sq from now: led there over the others from wherever it lies
  back(i, sq) {
    if (this.ready) this.mm.chess_back(i, sq);
  },

  // pawn i a queen where it is, until a reset, or, on false, a pawn again
  crown(i, on = true) {
    if (this.ready) this.mm.chess_crown(i, on ? 1 : 0);
  },

  // whether any piece is being led to where it stands
  leading() {
    return this.ready && this.mm.chess_leading() === 1;
  },
};
