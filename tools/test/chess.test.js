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
// carried, it goes where the pointer's ray meets the hand's plane, and let
// go it lands standing near there and all comes to rest; one dropped on
// another leaves every piece finite, on the table and at rest; a piece down
// taken by its head hangs upright in time without flinging the pieces it
// lay by, and put down it stands; and a reset is the first picture byte for
// byte. then the tone look draws in the tone too, black's pieces' alone,
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
  // hand's plane less the held point, from to
  const toward = (q, o, to) => {
    const m = meet(q[0], q[1], o.plane), g = gripOf(o);
    return point(to[0] - (g[0] - m[0]), o.plane, to[2] - (g[2] - m[2]));
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
  check('and the canvas is the picture\'s: the middle of e2 and of e7 lands on their pixels', Chess.at(...mid(e2)) === e2 && Chess.at(...mid(e7)) === e7);

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
  check('carried, it goes where the pointer\'s ray meets the hand\'s plane, as far from it as at the take', across(piece(e2).p, e4) < 0.1, across(piece(e2).p, e4).toFixed(3) + ' from e4');
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

  Chess.reset();
  check('a reset stirs it', stirring() === 1);
  Chess.step(DT);
  check('and draws the set as it starts, the first picture byte for byte', apart(first, pic().px) === 0 && stirring() === 0);
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
  check('held to 800 across and 16 down at the least', pic().w === 800 && pic().h === 16);
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
