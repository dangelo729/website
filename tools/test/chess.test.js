// node tools/test/chess.test.js
//
// loads js/chess.js the way the page does, a classic script, in a vm
// context, and hands it a fake window whose fetch answers with the real
// chess/chess.wasm. checks that nothing is there before the wasm is in and
// that nothing asked of it then does anything, that the wasm needs no
// imports and is fetched once and checked with the server, and then the
// set: its picture a v a pixel on the wasm's memory, in the solid look as
// it starts, holding only the paper and the ink it was given; at rest the
// picture stops changing and nothing stirs; the piece named at a pixel is
// the one drawn there, a pawn's pixels naming that pawn and bare paper
// naming none, and a press there taking nothing; a piece hovered draws the
// hover colour on its own pixels alone, and un-hovered the picture is as
// it was; a turn changes the picture and it settles, and turned back it is
// the first picture again. then the hand: the pointer's ray lands back on
// the board point it was put on the canvas from; a press on a pawn takes
// it, lit while it is held, and it rises straight up and hangs upright;
// carried, it goes over where the pointer's ray meets the board's top, and let
// go it lands standing near there and all comes to rest; one dropped on
// another leaves every piece finite, on the table and at rest; a piece down
// taken by its head hangs upright in time without flinging the pieces it
// lay by, and put down it stands. then a reset: every piece is led back
// to where it starts, none jumping there, the ones off their squares
// rising over the others, until the picture is the first byte for byte;
// with nothing moved it is over in a step; a piece taken on its way stays
// with the hand while the rest go home; and pieces swapped exactly, square
// for square, pass each other. then what a game asks of the set: with a
// side to move only its pieces are lit and taken; the squares marked are
// bordered and, once the pointer has moved, the nearest of them or the
// piece's own to the pointer on the board is the one filled; a piece let go onto a square is drawn down onto
// it exactly, and one not held is led to its; a piece knocked over is led
// back; one taken off the board is thrown off it, at once or as the piece
// that takes it comes down on it and shoves it, and comes to rest lying on
// the table past the slab; a pawn crowned is a queen; and a reset leads the
// ones taken back from where they lie and undoes all of it, back to the
// first picture; and the camera zooms in, eased, no further than the set
// lets it, and out again to the first picture. then
// the tone look draws in the tone too,
// black's pieces' alone,
// and differs, a black piece hovered there lit in its lines; a resize draws
// at the new size; turned through whole laps at the least tilt, the first
// and the most, nothing but paper ever touches the canvas's edge; and a
// step's dt is held to 0.1 s, a huge one drawing what 0.1 s draws. prints
// the canvas, how far the ink came to the edges, how long a long carry
// takes, the hardest meetings, and what init, a still step, a drawing step
// and a busy one cost. exits 1 on failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}

// --- the script --------------------------------------------------------------
const ctx = vm.createContext({ WebAssembly });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'chess.js'), 'utf8'), ctx, { filename: 'js/chess.js' });
const Chess = vm.runInContext('Chess', ctx);

// --- the fake window -----------------------------------------------------------
const wasm = fs.readFileSync(path.join(ROOT, 'chess', 'chess.wasm'));
const bytes = () => wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.length);
const fetched = [];
const win = {
  fetch(url, options) {
    fetched.push({ url, options });
    return Promise.resolve({ arrayBuffer: () => Promise.resolve(bytes()) });
  },
};
const settle = () => new Promise((ok) => setImmediate(ok));

const DT = 1 / 60;
const PAPER = 5, INK = 9, TONE = 13; // the v's handed over, none the page's own
const HOVER = 17;                    // and the hover's
const W = 480, H = 360;              // the canvas asked for
const LIFT = 1.7;                    // squares a held piece's foot is carried over the table (kLift, tools/chess-web/web_main.cpp)
const TABLE = 5.4;                   // squares the table reaches from the board's middle (kHalf)
const hold = (secs) => { for (let i = 0; i < Math.round(secs / DT); i++) Chess.step(DT); };
const stirring = () => Chess.mm.chess_stirring();
const deg = Math.PI / 180;

// how many pixels two pictures differ by, or -1 when their sizes do
const apart = (a, b) => a.length !== b.length ? -1 : a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0);
// the v's a picture holds
const held = (pic) => new Set(pic.px);
// how many of the canvas's edge pixels are not paper
function edge(pic) {
  const { px, w, h } = pic;
  let n = 0;
  for (let x = 0; x < w; x++) n += (px[x] !== PAPER) + (px[(h - 1) * w + x] !== PAPER);
  for (let y = 1; y < h - 1; y++) n += (px[y * w] !== PAPER) + (px[y * w + w - 1] !== PAPER);
  return n;
}
// how near anything not paper comes to each edge, px in from it: the
// first row from the top and from the bottom, and the first column from
// the left and from the right, that holds any
function room(pic) {
  const { px, w, h } = pic, row = (y) => { for (let x = 0; x < w; x++) if (px[y * w + x] !== PAPER) return true; return false; };
  const col = (x) => { for (let y = 0; y < h; y++) if (px[y * w + x] !== PAPER) return true; return false; };
  let top = 0, bottom = 0, left = 0, right = 0;
  while (top < h && !row(top)) top++;
  while (bottom < h && !row(h - 1 - bottom)) bottom++;
  while (left < w && !col(left)) left++;
  while (right < w && !col(w - 1 - right)) right++;
  return { top, bottom, left, right };
}

(async () => {
  // --- before the wasm is in ------------------------------------------------------
  check('nothing there before it is loaded', !Chess.ready && Chess.picture === null && fetched.length === 0);
  Chess.colours(PAPER, INK, TONE, HOVER);
  Chess.size(W, H);
  Chess.turn(1, 1);
  Chess.step(DT);
  Chess.reset();
  Chess.carry(1, 1);
  Chess.drop();
  check('and a turn, a step or a reset does nothing, a press takes nothing and no piece is anywhere',
    !Chess.ready && Chess.picture === null && Chess.take(10, 10) === false && Chess.at(10, 10) === -1);

  // --- loaded ---------------------------------------------------------------------
  check('the wasm needs no imports', WebAssembly.Module.imports(new WebAssembly.Module(bytes())).length === 0);
  const t0 = process.hrtime.bigint();
  Chess.load(win);
  Chess.load(win);
  for (let i = 0; i < 200 && !Chess.ready; i++) await settle();
  const initMs = Number(process.hrtime.bigint() - t0) / 1e6;
  check('the wasm is fetched once, checked with the server', fetched.length === 1 && fetched[0].url === 'chess/chess.wasm' && fetched[0].options && fetched[0].options.cache === 'no-cache');
  check('and is in', Chess.ready);
  const pic = () => Chess.picture;
  check('its picture a v a pixel, at the size asked for before it was in, on the wasm\'s memory',
    Object.prototype.toString.call(pic().px) === '[object Uint16Array]' && pic().px.buffer === Chess.mm.memory.buffer && pic().w === W && pic().h === H && pic().px.length === W * H);
  console.log('     the canvas: ' + pic().w + ' x ' + pic().h + ' px');
  const v = held(pic());
  check('drawn at once in the solid look, as it starts: only the paper and the ink it was given', v.size === 2 && v.has(PAPER) && v.has(INK), [...v].join(', '));
  check('and nothing but paper at the canvas\'s edge', edge(pic()) === 0);

  // --- at rest ----------------------------------------------------------------------
  const first = Uint16Array.from(pic().px);
  check('at rest nothing stirs', stirring() === 0);
  hold(1);
  check('and a second on the picture has not changed', apart(first, pic().px) === 0 && stirring() === 0);

  // --- the pieces drawn ------------------------------------------------------------------
  // every pixel's piece, and what each side's pixels are drawn in
  const scan = () => {
    const names = new Int32Array(W * H), seen = new Set(), white = new Map(), black = new Map();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = Chess.at(x + 0.5, y + 0.5), c = pic().px[y * W + x];
      names[y * W + x] = i;
      if (i < 0) continue;
      seen.add(i);
      const m = i < 16 ? white : black;
      m.set(c, (m.get(c) || 0) + 1);
    }
    const share = (m, c) => (m.get(c) || 0) / [...m.values()].reduce((a, b) => a + b, 0);
    return { names, seen, white, black, share };
  };
  const solidScan = scan(), names = solidScan.names, seen = solidScan.seen;
  const only = (m, ...cs) => [...m.keys()].every((c) => cs.includes(c));
  check('each pixel names the piece drawn there: white\'s filled with paper, black\'s with ink, each with the other\'s lines',
    only(solidScan.white, PAPER, INK) && only(solidScan.black, PAPER, INK) && solidScan.share(solidScan.white, PAPER) > 0.5 && solidScan.share(solidScan.black, INK) > 0.5,
    'white\'s ' + (100 * solidScan.share(solidScan.white, PAPER)).toFixed(0) + ' % paper, black\'s ' + (100 * solidScan.share(solidScan.black, INK)).toFixed(0) + ' % ink');
  const e2 = 12, e7 = 28; // white's pawn on e2 and black's on e7
  const count = (i) => names.reduce((n, v) => n + (v === i ? 1 : 0), 0);
  check('a pawn\'s pixels name that pawn, white\'s e2 and black\'s e7', count(e2) > 20 && count(e7) > 10, count(e2) + ' and ' + count(e7) + ' px');
  check('every pawn is seen', [8, 9, 10, 11, 12, 13, 14, 15, 24, 25, 26, 27, 28, 29, 30, 31].every((i) => seen.has(i)), seen.size + ' of 32 pieces seen');
  check('bare paper names none: the corners, and off the canvas', Chess.at(0, 0) === -1 && Chess.at(W - 1, H - 1) === -1 && Chess.at(-1, 5) === -1 && Chess.at(W, 5) === -1 && Chess.at(NaN, 5) === -1);
  check('and a press on bare paper takes nothing', Chess.take(0.5, 0.5) === false && Chess.take(-3, 5) === false && stirring() === 0);

  // --- the hover --------------------------------------------------------------------
  // a piece hovered draws the hover colour where it would draw the ink,
  // only on the pixels the pick plane gives it; un-hovered, the picture is
  // as it was
  const litBy = (i) => {
    let on = 0, off = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (pic().px[y * W + x] !== HOVER) continue;
      if (Chess.at(x + 0.5, y + 0.5) === i) on++; else off++;
    }
    return { on, off };
  };
  const lit = (i) => {
    Chess.hover(i);
    const stirred = stirring();
    Chess.step(DT);
    return { stirred, ...litBy(i) };
  };
  const lw = lit(e2), lb = lit(e7);
  check('hovered, white\'s e2 draws its lines in the hover colour and black\'s e7 its fill, only on its own pixels',
    lw.stirred && lb.stirred && lw.on > 10 && lb.on > 50 && lw.off === 0 && lb.off === 0,
    'e2 ' + lw.on + ' px, ' + lw.off + ' elsewhere; e7 ' + lb.on + ' px, ' + lb.off + ' elsewhere');
  Chess.hover(-1);
  check('un-hovered, it stirs', stirring() === 1);
  Chess.step(DT);
  check('and the picture is the first byte for byte', apart(first, pic().px) === 0 && stirring() === 0);

  // --- a turn -----------------------------------------------------------------------
  // turned by amounts a float holds exactly, so turned back it is where it began
  Chess.turn(-0.125, -0.0625);
  check('a turn stirs it', stirring() === 1);
  Chess.step(DT);
  const turned = apart(first, pic().px);
  check('and changes the picture', turned > 0, turned + ' px changed');
  hold(2);
  const there = Uint16Array.from(pic().px);
  Chess.step(DT);
  check('and it settles', stirring() === 0 && apart(there, pic().px) === 0);
  Chess.turn(0.125, 0.0625);
  hold(2);
  check('turned back, it is the first picture byte for byte', apart(first, pic().px) === 0 && stirring() === 0);

  // --- the hand ---------------------------------------------------------------------
  // the pointer's ray: a board point put on the canvas and met again at its
  // own height lands back on itself, and the canvas is the picture's, a
  // pawn's middle landing on that pawn's pixels
  const f32 = (p, n) => Array.from(new Float32Array(Chess.mm.memory.buffer, p, n));
  const piece = (i) => { const a = f32(Chess.mm.chess_piece(i), 8); return { p: a.slice(0, 3), q: a.slice(3, 7), plane: a[7] }; };
  const point = (x, y, z) => f32(Chess.mm.chess_point(x, y, z), 2);
  const meet = (x, y, h) => f32(Chess.mm.chess_meet(x, y, h), 3);
  const tilt = (o) => Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (o.q[1] ** 2 + o.q[3] ** 2)))) / deg;
  const across = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
  // where the hand holds a piece, board frame: on its axis, as far up it as
  // its plane is under LIFT
  const gripOf = (o) => {
    const [w, x, y, z] = o.q, g = o.plane - LIFT;
    return [o.p[0] + 2 * (x * y - w * z) * g, o.p[1] + (1 - 2 * (x * x + z * z)) * g, o.p[2] + 2 * (y * z + w * x) * g];
  };
  // the pixel naming piece i nearest the middle of all that do
  const pixelOf = (i) => {
    const at = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Chess.at(x + 0.5, y + 0.5) === i) at.push([x + 0.5, y + 0.5]);
    const mx = at.reduce((s, a) => s + a[0], 0) / at.length, my = at.reduce((s, a) => s + a[1], 0) / at.length;
    return at.reduce((b, a) => Math.hypot(a[0] - mx, a[1] - my) < Math.hypot(b[0] - mx, b[1] - my) ? a : b);
  };
  // the pointer's place that carries a piece taken at canvas px q, as it
  // was then (o), to the board point to: where the ray at the take met the
  // board's top less the held point, from to
  const toward = (q, o, to) => {
    const m = meet(q[0], q[1], 0), g = gripOf(o);
    return point(to[0] - (g[0] - m[0]), 0, to[2] - (g[2] - m[2]));
  };
  // steps on until done() or secs, each timed; how long it took, s, -1 for never, and the longest step and the hardest meeting
  const until = (secs, done) => {
    let t = -1, hit = 0, ms = 0, n = 0;
    for (let k = 0; k < Math.round(secs / DT); k++) {
      const s0 = process.hrtime.bigint();
      Chess.step(DT);
      ms += Number(process.hrtime.bigint() - s0) / 1e6;
      n++;
      hit = Math.max(hit, Chess.mm.chess_hit());
      if (done()) { t = (k + 1) * DT; break; }
    }
    return { t, hit, ms: ms / n };
  };
  let worst = 0;
  for (const w of [[0, 0, 0], [3, 2.4, -2], [-4.5, 1, 4.5], [5, 3, 5], [-2, 0.5, -4]]) {
    const q = point(...w), m = meet(q[0], q[1], w[1]);
    worst = Math.max(worst, Math.hypot(m[0] - w[0], m[1] - w[1], m[2] - w[2]));
  }
  check('a board point put on the canvas and its ray met again at its height lands back on itself', worst < 1e-3, 'within ' + worst.toExponential(1) + ' of a square');
  const mid = (i) => { const o = piece(i); return point(o.p[0], 0.4, o.p[2]); };
  const everyone = [...Array(32).keys()];
  const starts = everyone.map(piece); // each piece as it starts
  const off = (i) => { const o = piece(i), s = starts[i]; return Math.hypot(o.p[0] - s.p[0], o.p[1] - s.p[1], o.p[2] - s.p[2]); };
  const exact = (i) => { const o = piece(i), s = starts[i]; return o.p.every((v, k) => v === s.p[k]) && o.q.every((v, k) => v === s.q[k]); };
  const stand = (i, p, q) => Chess.mm.chess_put(i, p[0], p[1], p[2], q[0], q[1], q[2], q[3]);
  const leading = () => Chess.mm.chess_leading();
  check('and the canvas is the picture\'s: the middle of e2 and of e7 lands on their pixels', Chess.at(...mid(e2)) === e2 && Chess.at(...mid(e7)) === e7);
  const spot = Chess.point(piece(e2).p[0], 0.4, piece(e2).p[2]);
  check('the page is told the same canvas px for a point of the board', spot.x === mid(e2)[0] && spot.y === mid(e2)[1], spot.x.toFixed(1) + ', ' + spot.y.toFixed(1));

  // a press on a pawn takes it, and it rises straight up as high as the
  // hand carries it, hanging upright
  const e2At = piece(e2), q0 = mid(e2);
  check('a press on a pawn takes it', Chess.take(...q0) === true && stirring() === 1);
  Chess.step(DT);
  check('and the picture changes at once', apart(first, pic().px) > 0);
  hold(1.5);
  Chess.hover(-1);
  Chess.step(DT);
  const heldLit = litBy(e2);
  check('held, it stays in the hover colour with no hover', heldLit.on > 10 && heldLit.off === 0, heldLit.on + ' px');
  const lifted = piece(e2);
  check('it rises straight up, its foot LIFT over the table, and hangs upright',
    Math.abs(lifted.p[1] - LIFT) < 0.05 && across(lifted.p, e2At.p) < 0.01 && tilt(lifted) < 2,
    'foot at ' + lifted.p[1].toFixed(3) + ', ' + across(lifted.p, e2At.p).toFixed(4) + ' across, leaning ' + tilt(lifted).toFixed(1) + ' degrees');

  // carried to e4 and let go: it lands standing near where it was let go,
  // and everything comes to rest
  const e4 = [0.5, 0, -0.5];
  Chess.carry(...toward(q0, e2At, e4));
  let swing = 0;
  for (let k = 0; k < Math.round(2 / DT); k++) { Chess.step(DT); swing = Math.max(swing, tilt(piece(e2))); }
  console.log('     carried 2 squares, it swings ' + swing.toFixed(1) + ' degrees at most');
  check('carried, it goes over where the pointer\'s ray meets the board\'s top, as far from it as at the take', across(piece(e2).p, e4) < 0.1, across(piece(e2).p, e4).toFixed(3) + ' from e4');
  Chess.drop();
  const fell = until(6, () => !stirring());
  const landed = piece(e2);
  check('let go, it lands standing near where it was let go, and comes to rest',
    across(landed.p, e4) < 0.25 && Math.abs(landed.p[1]) < 0.01 && tilt(landed) < 2 && fell.t > 0 && fell.t < 4,
    across(landed.p, e4).toFixed(3) + ' from e4, leaning ' + tilt(landed).toFixed(2) + ' degrees, still after ' + fell.t.toFixed(2) + ' s');
  const rest = Uint16Array.from(pic().px);
  hold(1);
  check('and then the picture is still', apart(rest, pic().px) === 0 && stirring() === 0);

  // d2 carried over d7 and dropped on it: what it knocks about stays finite
  // and on the table, and all of it comes to rest in a bounded time
  const d2 = 11, d7 = 27, qd = mid(d2), d2At = piece(d2), d7At = piece(d7);
  check('d2 taken', Chess.take(...qd) === true);
  hold(1);
  Chess.carry(...toward(qd, d2At, d7At.p));
  const crossing = until(4, () => across(piece(d2).p, d7At.p) < 0.1);
  console.log('     carried 5 squares at once, d2 is over d7 within 0.1 of a square after ' + crossing.t.toFixed(2) + ' s');
  hold(1);
  Chess.drop();
  const heap = until(12, () => !stirring());
  const all = [...Array(32).keys()].map(piece);
  const sane = all.every((o) => o.p.concat(o.q).every(Number.isFinite) && Math.abs(o.p[0]) <= TABLE && Math.abs(o.p[2]) <= TABLE && o.p[1] > -0.02);
  check('dropped onto d7: every piece finite, on the table, and all at rest within 10 s', sane && heap.t > 0 && heap.t < 10,
    'at rest after ' + heap.t.toFixed(2) + ' s, the hardest meeting ' + heap.hit.toFixed(1) + ' squares/s');
  const busyMs = heap.ms;

  // a piece down, taken by its head next to the ones it lies by: lifted, it
  // hangs upright within 2.5 s and flings none of them; carried to e5 and
  // put down, it stands
  const down = [...Array(32).keys()].filter((i) => tilt(piece(i)) > 60);
  check('a piece is down', down.length > 0, 'down: ' + down.join(', '));
  const f = down[0], fAt = piece(f), qf = pixelOf(f);
  const beside = [...Array(32).keys()].filter((i) => i !== f && across(piece(i).p, fAt.p) < 1.6), besideAt = beside.map((i) => piece(i).p);
  check('taken by its head', Chess.take(...qf) === true);
  let leant = 0, flung = 0;
  for (let k = 0; k < Math.round(3 / DT); k++) {
    Chess.step(DT);
    flung = Math.max(flung, Chess.mm.chess_hit());
    if (tilt(piece(f)) >= 10) leant = (k + 1) * DT;
  }
  const moved = beside.map((i, k) => across(piece(i).p, besideAt[k]));
  check('lifted by its head, it hangs upright within 2.5 s and flings none of the pieces it lay by', leant < 2.5 && Math.max(0, ...moved) < 0.25,
    'upright from ' + leant.toFixed(2) + ' s; the ' + beside.length + ' beside it moved ' + moved.map((m) => m.toFixed(3)).join(', ') + '; the hardest meeting ' + flung.toFixed(2) + ' squares/s');
  const e5 = [0.5, 0, 0.5];
  Chess.carry(...toward(qf, fAt, e5));
  hold(2.5);
  Chess.drop();
  const put = until(6, () => !stirring());
  const stood = piece(f);
  check('carried over e5 and put down, it stands near e5', tilt(stood) < 2 && Math.abs(stood.p[1]) < 0.01 && across(stood.p, e5) < 0.3 && put.t > 0,
    'it slid ' + across(stood.p, e5).toFixed(2) + ' from e5 landing, leaning ' + tilt(stood).toFixed(2) + ' degrees, still after ' + put.t.toFixed(2) + ' s');

  // a pawn and a rook on the a-file each leaned 30 degrees outward and let
  // go: each rights itself, standing where it stood, and comes to rest
  const a2 = 8, a1 = 0, a2At = piece(a2).p, a1At = piece(a1).p;
  Chess.mm.chess_tip(a2, 30 * deg);
  Chess.mm.chess_tip(a1, 30 * deg);
  const leaning = [tilt(piece(a2)), tilt(piece(a1))];
  const righted = until(6, () => !stirring());
  const ra2 = piece(a2), ra1 = piece(a1);
  check('a pawn and a rook leaned 30 degrees and let go right themselves and come to rest',
    leaning.every((t) => Math.abs(t - 30) < 0.5) && tilt(ra2) < 1 && tilt(ra1) < 1 && Math.abs(ra2.p[1]) < 0.01 && Math.abs(ra1.p[1]) < 0.01 &&
    across(ra2.p, a2At) < 0.3 && across(ra1.p, a1At) < 0.3 && righted.t > 0,
    'standing again ' + across(ra2.p, a2At).toFixed(2) + ' and ' + across(ra1.p, a1At).toFixed(2) + ' from where they stood, at rest after ' + righted.t.toFixed(2) + ' s');

  // --- a reset ----------------------------------------------------------------------
  // every piece is led back to where it starts with the others in its way,
  // the ones off their squares pulled there by their heads, hanging. a step
  // on none has jumped there; they rise over the others on the way; and in
  // a bounded time every piece is exactly as it starts, asleep, the picture
  // the first
  const strayed = everyone.filter((i) => off(i) > 0.5), was = everyone.map(piece);
  check('pieces are off their squares', strayed.length >= 2, strayed.length + ' more than half a square off');
  Chess.reset();
  check('a reset stirs it', stirring() === 1 && leading() === 1);
  Chess.step(DT);
  const jump = Math.max(...everyone.map((i) => { const o = piece(i); return Math.hypot(o.p[0] - was[i].p[0], o.p[1] - was[i].p[1], o.p[2] - was[i].p[2]); }));
  check('a step on no piece has jumped: each is within a fifth of a square of where it was, the strayed still off their squares',
    jump < 0.2 && strayed.every((i) => off(i) > 0.4) && apart(first, pic().px) > 0, 'the furthest moved ' + jump.toFixed(3));
  let high = 0;
  const home = until(8, () => { for (const i of strayed) high = Math.max(high, piece(i).p[1]); return !stirring(); });
  check('the strayed rise over the others on the way', high > 1.4 && high < 4, 'the highest foot ' + high.toFixed(2) + ' over the table');
  check('and inside 4 s every piece is exactly as it starts, the picture the first byte for byte',
    home.t > 0.5 && home.t < 4 && leading() === 0 && everyone.every(exact) && apart(first, pic().px) === 0,
    strayed.length + ' strayed home after ' + home.t.toFixed(2) + ' s, the hardest meeting ' + home.hit.toFixed(1) + ' squares/s');
  Chess.reset();
  Chess.step(DT);
  check('a reset with nothing moved is over in a step, the picture the first', leading() === 0 && stirring() === 0 && apart(first, pic().px) === 0);

  // e2 put on e5 and the queen laid on her side past it: a reset, and the
  // pawn pressed on its way is the hand's, carried on while the rest go
  // home, and stays where it is dropped; the next reset takes it home too
  const d1 = 3;
  stand(e2, e5, starts[e2].q);
  stand(d1, [-2, 0.35, 0.5], [Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
  Chess.step(DT);
  Chess.reset();
  hold(0.2);
  const flying = piece(e2);
  check('on its way e2 is in the air, off e5 and not yet home', flying.p[1] > 0.6 && across(flying.p, e5) > 0.2 && off(e2) > 1 && leading() === 1,
    'its foot ' + flying.p[1].toFixed(2) + ' up, ' + across(flying.p, e5).toFixed(2) + ' from e5');
  check('pressed there, it is taken', Chess.take(...pixelOf(e2)) === true);
  const rest2 = until(6, () => !leading());
  hold(1);
  const inHand = piece(e2);
  check('the rest go home without it, and it stays with the hand',
    rest2.t > 0 && rest2.t < 4 && everyone.every((i) => i === e2 || exact(i)) && off(e2) > 1 && Math.abs(inHand.p[1] - LIFT) < 0.1 && stirring() === 1,
    'the rest home after ' + rest2.t.toFixed(2) + ' s, e2 ' + off(e2).toFixed(2) + ' from e2 with its foot ' + inHand.p[1].toFixed(2) + ' up');
  Chess.drop();
  const dropped = until(6, () => !stirring());
  check('dropped, it stays where it lands', dropped.t > 0 && off(e2) > 1 && leading() === 0, off(e2).toFixed(2) + ' from e2');
  Chess.reset();
  const again = until(8, () => !stirring());
  check('and the next reset takes it home', again.t > 0 && again.t < 4 && everyone.every(exact) && apart(first, pic().px) === 0, 'after ' + again.t.toFixed(2) + ' s');

  // pieces swapped exactly, square for square, meet head on: each keeps to
  // its right and they pass
  const swap = (a, b) => { stand(a, starts[b].p, starts[a].q); stand(b, starts[a].p, starts[b].q); };
  swap(e2, e7);
  swap(d1, 4);
  swap(0, 31);
  Chess.step(DT);
  Chess.reset();
  const passed = until(8, () => !stirring());
  check('three pairs swapped exactly pass each other and are home inside 4 s', passed.t > 0.5 && passed.t < 4 && everyone.every(exact) && apart(first, pic().px) === 0,
    'home after ' + passed.t.toFixed(2) + ' s, the hardest meeting ' + passed.hit.toFixed(1) + ' squares/s');
  Chess.turn(NaN, NaN);
  check('a turn that is not a number does nothing', stirring() === 0);
  // the near side goes the way it is turned: the e2 pawn's middle right
  // and down on the canvas turned round and over
  const middle = () => {
    let n = 0, sx = 0, sy = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Chess.at(x + 0.5, y + 0.5) === e2) { n++; sx += x; sy += y; }
    return { x: sx / n, y: sy / n };
  };
  const m0 = middle();
  Chess.turn(0.2, 0);
  hold(2);
  const m1 = middle();
  Chess.turn(-0.2, 0.2);
  hold(2);
  const m2 = middle();
  Chess.turn(0, -0.2);
  hold(2);
  check('turned round, the near side goes right; turned over, down', m1.x > m0.x + 5 && m2.y > m0.y + 5,
    'e2\'s middle at ' + m0.x.toFixed(0) + ', ' + m0.y.toFixed(0) + ', round to ' + m1.x.toFixed(0) + ', over to ' + m2.y.toFixed(0) + ' down');

  // --- a game's pieces ----------------------------------------------------------------
  // what a game played on the set asks of it (js/match.js): whose pieces
  // the hand may take, the squares marked and the one filled, a piece let
  // go onto a square, one led to another, one knocked off its square led
  // back, one taken off the board, a pawn crowned, and a reset undoing it all
  const hovers = () => pic().px.reduce((n, v) => n + (v === HOVER ? 1 : 0), 0);
  const on = (i, sq) => { const o = piece(i), s = starts[i]; return Math.abs(o.p[0] - (sq % 8 - 3.5)) < 1e-5 && Math.abs(o.p[1]) < 1e-6 && Math.abs(o.p[2] - ((sq >> 3) - 3.5)) < 1e-5 && o.q.every((v, k) => v === s.q[k]); };
  const E2 = 12, E3 = 20, E4 = 28, H3 = 23; // squares, a1 0 to h8 63
  Chess.mover(0);
  Chess.hover(e7);
  Chess.step(DT);
  check('with white to move a black piece hovered is not lit, and a press on it takes nothing', hovers() === 0 && Chess.take(...pixelOf(e7)) === false && Chess.held() === -1);
  Chess.hover(-1);
  const qe = pixelOf(e2), oe = piece(e2);
  check('a white one is taken, and is the piece held', Chess.take(...qe) === true && Chess.held() === e2);
  hold(0.4);
  const alone = hovers();
  check('lifted, the square it stands on is the one filled', Chess.near() === E2 && alone > 0, alone + ' px in the hover colour');
  Chess.mark(E3);
  Chess.mark(E4);
  Chess.step(DT);
  check('two squares marked are bordered in the hover colour', hovers() > alone + 20, hovers() - alone + ' px more');
  Chess.carry(qe[0] + 2, qe[1] - 2);
  hold(0.2);
  check('with the pointer barely moved from where it took the piece, its own square is still the one filled', Chess.near() === E2 && Chess.aimed() === false);
  Chess.spot(E4);
  check('picked by the page, e4 is the one filled at once', Chess.near() === E4);
  Chess.spot(-1);
  check('and with none picked, its own again', Chess.near() === E2);
  check('the square under a canvas px: e3 at its middle, none off the board or at no px',
    Chess.square(...point(0.5, 0, -1.5)) === E3 && Chess.square(...point(0.5, 0, -4.6)) === -1 && Chess.square(NaN, NaN) === -1);
  Chess.carry(...point(0.5, 0, -1.5));
  hold(0.3);
  check('with the pointer over e3 on the board, e3 is the one filled, wherever the piece hangs', Chess.near() === E3 && Chess.aimed() === true);
  Chess.carry(...point(-0.5, 0, 0.5));
  hold(0.3);
  check('over d5, a square not marked, the nearest of them to the pointer: e4', Chess.near() === E4);
  Chess.carry(...point(0.5, 0, -0.5));
  hold(0.6);
  check('over e4, e4 is the one filled', Chess.near() === E4);
  Chess.unmark();
  Chess.go(e2, E4);
  check('let go onto e4 it is held no more, and led', Chess.held() === -1 && leading() === 1);
  const snap = until(4, () => !stirring());
  check('it is drawn down onto e4 and stands there exactly, turned as it starts, inside a second', snap.t > 0 && snap.t < 1 && on(e2, E4) && hovers() === 0,
    snap.t.toFixed(2) + ' s, landing at ' + snap.hit.toFixed(1) + ' squares/s');
  Chess.go(7, H3);
  const led = until(4, () => !stirring());
  check('a piece not held is led to its square over the others, which stay', led.t > 0 && led.t < 3 && on(7, H3) && everyone.every((i) => i === e2 || i === 7 || exact(i)), led.t.toFixed(2) + ' s');
  Chess.mm.chess_tip(d1, 1.3);
  const back = until(6, () => !stirring());
  check('a piece knocked over while a side is to move is led back onto its square', back.t > 0 && back.t < 4 && exact(d1), back.t.toFixed(2) + ' s');
  const state = (i) => Chess.mm.chess_state(i); // 0 on the board, 1 taken and standing, 2 flung
  const SLAB = 4.4, THICK = 0.35; // squares from the board's middle to the slab's sides, and the board's top over the table (kSlab, kThick)
  // whether piece i lies at rest on the table, past the slab
  const lies = (i) => { const o = piece(i).p; return (Math.abs(o[0]) > SLAB || Math.abs(o[2]) > SLAB) && o[1] < 0.1 && o[1] > -THICK - 0.01 && o.every(Number.isFinite); };
  Chess.off(e7, -1);
  Chess.step(DT);
  check('a piece taken off the board by none is flung at once', state(e7) === 2 && stirring() === 1);
  const flown = until(8, () => !stirring());
  check('it is thrown off the board and comes to rest on the table, far off, the rest still where they stand', flown.t > 0 && flown.t < 6 && state(e7) === 2 && lies(e7) &&
    Math.hypot(piece(e7).p[0], piece(e7).p[2]) > 8 && everyone.every((i) => i === e2 || i === 7 || i === e7 || exact(i)),
    flown.t.toFixed(2) + ' s, ' + Math.hypot(piece(e7).p[0], piece(e7).p[2]).toFixed(1) + ' squares from the board\'s middle');
  check('flung, it cannot be taken or led to a square', (Chess.go(e7, E3), Chess.step(DT), state(e7) === 2 && stirring() === 0 && lies(e7)));
  // one taken by a piece that comes down on it: black's d pawn, by the pawn on e4
  Chess.take(...pixelOf(e2));
  hold(0.4);
  Chess.carry(...toward(pixelOf(e2), piece(e2), [-0.5, 0, 2.5]));
  hold(0.8);
  Chess.off(27, e2);
  hold(0.2);
  check('one taken by a piece held stands where it was, the piece over it', state(27) === 1 && exact(27));
  Chess.go(e2, 51);
  const struck = until(3, () => state(27) !== 1);
  const footUp = piece(e2).p[1];
  check('let go onto its square, the piece comes down on it and shoves it, and it is thrown', struck.t > 0 && struck.t < 1 && state(27) === 2 && footUp > 0.4 && footUp < 1.1,
    'thrown after ' + struck.t.toFixed(2) + ' s, the foot ' + footUp.toFixed(2) + ' up');
  const down2 = until(8, () => !stirring());
  check('the piece lands on the square and the one taken lies on the table', down2.t > 0 && on(e2, 51) && state(27) === 2 && lies(27), down2.t.toFixed(2) + ' s');
  const top = (i) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Chess.at(x + 0.5, y + 0.5) === i) return y; return -1; };
  const low = top(8);
  Chess.mm.chess_crown(8, 1);
  until(2, () => !stirring());
  check('a pawn crowned is a queen where it stood, drawn taller', Chess.mm.chess_kind(8) === 4 && Chess.mm.chess_shown(8) === 1 && off(8) < 1e-6 && top(8) < low - 5, 'its top ' + (low - top(8)) + ' px higher');
  Chess.mover(-1);
  Chess.reset();
  Chess.step(DT);
  check('at a reset the ones flung are pieces on the board again, led home', state(e7) === 0 && state(27) === 0 && leading() === 1);
  const undone = until(8, () => !stirring());
  check('a reset leads the ones taken back from where they lie, makes the queen a pawn again and leads all home: the first picture, byte for byte',
    undone.t > 0 && undone.t < 4 && everyone.every(exact) && Chess.mm.chess_kind(8) === 0 && state(e7) === 0 && state(27) === 0 && apart(first, pic().px) === 0, undone.t.toFixed(2) + ' s');

  // --- a zoom -----------------------------------------------------------------------
  const inked = (i) => { let n = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Chess.at(x + 0.5, y + 0.5) === i) n++; return n; };
  const fitted = inked(d1);
  check('zoomed out from the fit, nothing moves', Chess.zoom(0.5) === false && stirring() === 0);
  check('a zoom that is not a number over 0 does nothing', Chess.zoom(NaN) === false && Chess.zoom(0) === false && Chess.zoom(-2) === false && stirring() === 0);
  check('zoomed in, it stirs', Chess.zoom(1.5) === true && stirring() === 1);
  const zoomed = until(4, () => !stirring());
  check('and eases in to rest, the pieces drawn bigger', zoomed.t > 0.1 && zoomed.t < 2 && inked(d1) > 1.8 * fitted, inked(d1) + ' px of the queen from ' + fitted + ', in ' + zoomed.t.toFixed(2) + ' s');
  Chess.zoom(100);
  hold(2);
  check('it goes no further in than the set lets it', Chess.zoom(1.01) === false);
  check('and out again as far as the fit', Chess.zoom(0.001) === true && Chess.zoom(0.9) === false);
  hold(2);
  check('where it is the first picture, byte for byte', stirring() === 0 && apart(first, pic().px) === 0);

  // --- the looks --------------------------------------------------------------------
  // the tone look: all three v's, white's pieces in paper and ink, black's
  // in the tone and ink, and the tone nowhere else
  const solid = Uint16Array.from(pic().px);
  Chess.look(0);
  check('a look stirs it', stirring() === 1);
  Chess.step(DT);
  const toned = held(pic());
  check('the tone look draws in all three v\'s', toned.size === 3 && toned.has(PAPER) && toned.has(INK) && toned.has(TONE), [...toned].join(', '));
  check('and differs from the solid', apart(solid, pic().px) > 0, apart(solid, pic().px) + ' px apart');
  const toneScan = scan();
  check('each pixel names the piece drawn there: white\'s in paper and ink, black\'s in the tone and ink',
    only(toneScan.white, PAPER, INK) && only(toneScan.black, TONE, INK) && toneScan.share(toneScan.black, TONE) > 0.5,
    'black\'s ' + (100 * toneScan.share(toneScan.black, TONE)).toFixed(0) + ' % tone');
  const px = pic().px;
  let loose = 0;
  toneScan.names.forEach((i, k) => { if (px[k] === TONE && i < 16) loose++; });
  check('and the tone is black\'s pieces\' alone', loose === 0, loose + ' tone pixels name none of black\'s');
  const tl = lit(e7), tlx = (() => { let n = 0; for (let k = 0; k < W * H; k++) if (toneScan.names[k] === e7 && pic().px[k] === TONE) n++; return n; })();
  check('in the tone look a black piece hovered draws its lines in the hover colour, its fill still the tone', tl.on > 10 && tl.off === 0 && tlx > 50, tl.on + ' px of lines, ' + tlx + ' of tone');
  Chess.hover(-1);
  Chess.step(DT);
  Chess.colours(PAPER, INK, 21, HOVER);
  Chess.step(DT);
  check('new colours draw at once', held(pic()).has(21) && !held(pic()).has(TONE));
  Chess.colours(PAPER, INK, TONE, HOVER);
  Chess.look(1);
  Chess.step(DT);
  check('back to the solid look, the picture is as it was', apart(solid, pic().px) === 0);

  // --- a resize -----------------------------------------------------------------------
  Chess.size(320, 400);
  check('a resize stirs it', stirring() === 1);
  Chess.step(DT);
  const small = pic();
  check('and draws at the new size, viewed again', small.w === 320 && small.h === 400 && small.px.length === 320 * 400 && held(small).size === 2 && edge(small) === 0);
  Chess.size(5000, 5);
  Chess.step(DT);
  check('held to 1280 across and 16 down at the least', pic().w === 1280 && pic().h === 16);
  Chess.size(W, H);
  Chess.step(DT);
  check('and back, the picture as it was', apart(solid, pic().px) === 0);

  // --- laps -----------------------------------------------------------------------------
  // a lap a 360th at a time, a step each, and a second to settle, at the
  // least tilt, the first and the most, at two sizes: the canvas's edge
  // never anything but paper, and how near the ink came to each edge
  let touched = 0, frames = 0, near;
  const look = () => {
    const r = room(pic());
    frames++;
    if (edge(pic())) touched++;
    for (const k in r) near[k] = Math.min(near[k], r[k]);
  };
  const lap = () => {
    for (let k = 0; k < 360; k++) {
      Chess.turn(2 * Math.PI / 360, 0);
      Chess.step(DT);
      look();
    }
    for (let k = 0; k < 60; k++) { Chess.step(DT); look(); }
  };
  const nearest = [];
  for (const [w, h] of [[W, H], [240, 420]]) {
    Chess.size(w, h);
    near = { top: h, bottom: h, left: w, right: w };
    Chess.turn(0, -Math.PI);
    hold(2);
    lap();
    Chess.turn(0, 21 * deg);
    hold(2);
    lap();
    Chess.turn(0, Math.PI);
    hold(2);
    lap();
    nearest.push(w + ' x ' + h + ': ' + near.top + ' px from the top, ' + near.bottom + ' the bottom, ' + near.left + ' the left, ' + near.right + ' the right');
  }
  check('turned whole laps at 15, 36 and 80 degrees over, at two sizes, nothing but paper ever at the canvas\'s edge', touched === 0, touched + ' of ' + frames + ' frames touch it');
  for (const n of nearest) console.log('     over the laps at ' + n);
  Chess.size(W, H);

  // --- the clamp --------------------------------------------------------------------
  // two more sets, each turned: one stepped 10 s, one 0.1 s
  const make = () => {
    const x = new WebAssembly.Instance(new WebAssembly.Module(bytes()), {}).exports;
    if (x._initialize) x._initialize();
    x.chess_init();
    x.chess_turn(1, 0.5);
    return x;
  };
  const a = make(), b = make();
  a.chess_step(10);
  b.chess_step(0.1);
  const pxOf = (x) => new Uint16Array(x.memory.buffer, x.chess_px(), x.chess_w() * x.chess_h());
  check('a huge dt is held to 0.1 s: it draws what 0.1 s draws', apart(pxOf(a), pxOf(b)) === 0 && a.chess_stirring() === 1);

  // --- the cost -----------------------------------------------------------------------
  hold(2);
  const M = 300;
  let s0 = process.hrtime.bigint();
  for (let i = 0; i < M; i++) Chess.step(DT);
  const stillUs = Number(process.hrtime.bigint() - s0) / 1e3 / M;
  s0 = process.hrtime.bigint();
  for (let i = 0; i < M; i++) { Chess.turn(0.01, 0); Chess.step(DT); }
  const drawMs = Number(process.hrtime.bigint() - s0) / 1e6 / M;
  console.log('     init takes ' + initMs.toFixed(1) + ' ms here, fetch and instantiate with it; a still step ' + stillUs.toFixed(2) + ' us; a drawing step at ' + W + ' x ' + H + ' ' + drawMs.toFixed(3) + ' ms');
  console.log('     a busy step, the pieces knocked about falling and drawn, ' + busyMs.toFixed(3) + ' ms at ' + W + ' x ' + H);

  console.log(failures ? failures + ' failed' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
