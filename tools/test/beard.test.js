// node tools/test/beard.test.js
//
// loads js/raster.js and js/beard.js the way the page does, classic scripts
// sharing one global scope, in a vm context with no dom, no performance, a
// Date that throws and a Math.random that throws, so the beard cannot
// quietly lean on any of them: its time is its steps. it draws into a real
// framebuffer (ImageData is stubbed). prints the mustache as ascii; exits 1
// on failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const STEP = 1 / 60;
const SCALE = 0.8; // the page's face

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}

// --- the scripts -------------------------------------------------------------
const math = Object.create(Math);
math.random = () => { throw new Error('the beard read Math.random'); };
// the browser's ImageData, as much of it as a Framebuffer makes
class ImageData {
  constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
}
const sandbox = { Math: math, ImageData };
for (const name of ['Date', 'performance', 'window', 'document', 'requestAnimationFrame']) {
  Object.defineProperty(sandbox, name, { get() { throw new Error('the beard read ' + name); } });
}
const ctx = vm.createContext(sandbox);
for (const file of ['js/raster.js', 'js/beard.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
}
const { BEARD, Beard, Framebuffer } = vm.runInContext('({ BEARD, Beard, Framebuffer })', ctx);

// --- helpers -----------------------------------------------------------------
// every point of every strand, as of the last step
const all = (b) => b.strands.map((s, i) => b.points(i));
// any point not a finite number, anywhere since the last call
let nans = 0;
function finite(b) {
  for (const p of all(b)) for (const q of p) if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) nans++;
}
// strand i's root, segment and rest pose at a mouth and scale: straight
// along its lean from its root
const rootOf = (b, i, m, s) => ({ x: m.x + b.strands[i].x * s, y: m.y + b.strands[i].y * s });
const segOf = (b, i, s) => b.strands[i].len / (b.strands[i].points - 1) * s;
function restOf(b, m, s) {
  return b.strands.map((st, i) => {
    const r = rootOf(b, i, m, s), seg = segOf(b, i, s), sx = Math.sin(st.lean), sy = Math.cos(st.lean);
    return Array.from({ length: st.points }, (_, j) => ({ x: r.x + sx * seg * j, y: r.y + sy * seg * j }));
  });
}
// the furthest any point is from where another pose puts it
function worst(a, b) {
  let w = 0;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < a[i].length; j++) w = Math.max(w, Math.hypot(a[i][j].x - b[i][j].x, a[i][j].y - b[i][j].y));
  return w;
}
// a real framebuffer; a set off the grid would land nowhere in a
// Uint8Array, silently, so it throws instead
function makeFb(w = 240, h = 240) {
  const fb = new Framebuffer(w, h), set = fb.set;
  fb.set = function (x, y, v = 1) {
    if (x !== Math.floor(x) || y !== Math.floor(y)) throw new Error('fb.set off the grid: ' + x + ', ' + y);
    set.call(this, x, y, v);
  };
  return fb;
}
function dump(fb, x0, y0, w, h) {
  const out = [];
  for (let y = y0; y < y0 + h; y++) {
    let row = '';
    for (let x = x0; x < x0 + w; x++) row += fb.get(x, y) ? '#' : '.';
    out.push(row);
  }
  return out.join('\n');
}

// --- the hash ------------------------------------------------------------------
// lowbias32's values, from beard.cpp's mix compiled as it is
{
  const want = [[0, 0], [1, 1753845952], [2, 3507691905], [8, 3931332538], [1000, 1407151442], [0xdeadbeef, 3861431939], [0xffffffff, 1734902346]];
  const got = want.map(([v]) => Beard.mix(v));
  check('mix is lowbias32', want.every(([, w], k) => got[k] === w), got.join(' '));
  let inRange = true, exact = true;
  for (let i = 0; i < 2000; i++) for (let k = 0; k < 8; k++) {
    const s = Beard.share(i, k);
    if (!(s >= -1 && s < 1)) inRange = false;
    if (s !== (Beard.mix(i * 8 + k + 1) >>> 8) * (2 / 16777216) - 1) exact = false;
  }
  check('share is in [-1, 1) and the top 24 bits of the mix', inRange && exact);
  check('a lock\'s share is a strand\'s past LOCK_SHARES', Beard.lockShare(1, 3, 2) === Beard.share(BEARD.LOCK_SHARES + BEARD.LOCKS_MOST + 3, 2));
}

// --- the bands -----------------------------------------------------------------
// what the layout takes for granted of every band (beard.h's static_asserts)
{
  const B = BEARD;
  const ok = B.BANDS.every((d) => d.count >= 1 && d.points >= 2 && d.locks >= 1 && d.locks <= d.count && d.locks <= B.LOCKS_MOST);
  const strands = B.BANDS.reduce((n, d) => n + d.count, 0);
  check('bands: a strand and a segment at least, locks 1 to count and no more than LOCKS_MOST', ok);
  check('bands: the strands\' shares and the locks\' never meet', strands <= B.LOCK_SHARES, strands + ' strands');
  check('bands: SPREAD + LOCK_SPREAD under a half, so the locks keep their order', B.SPREAD + B.LOCK_SPREAD < 0.5);
}

// --- the layout ----------------------------------------------------------------
const lay = new Beard(500, 300);
{
  const S = lay.strands, B = BEARD;
  check('layout: 40 strands, 20 a band, 3 points each', S.length === 40 && S.filter((s) => s.band === 0).length === 20 &&
    S.filter((s) => s.band === 1).length === 20 && S.every((s) => s.points === 3), S.length + ' strands');
  let onLine = true, uIn = true, inSpan = true, ordered = true, lens = true, leans = true, stiffs = true, phases = true, worstOff = 0;
  let i = 0;
  for (let b = 0; b < B.BANDS.length; b++) {
    const d = B.BANDS[b], ex = d.x1 - d.x0, ey = d.y1 - d.y0, span = 1 / d.locks;
    let lastU = -Infinity;
    for (let k = 0; k < d.count; k++, i++) {
      const s = S[i], l = Math.floor(k * d.locks / d.count);
      // where along the band the root lies, and how far off the line
      const u = ((s.x - d.x0) * ex + (s.y - d.y0) * ey) / (ex * ex + ey * ey);
      const uc = Math.min(1, Math.max(0, u));
      const off = Math.hypot(s.x - (d.x0 + ex * uc), s.y - (d.y0 + ey * uc));
      worstOff = Math.max(worstOff, off);
      if (off > 1e-6) onLine = false;
      if (!(u >= 0 && u <= 1)) uIn = false;
      if (!(u > l * span && u < (l + 1) * span)) inSpan = false;
      if (!(u > lastU)) ordered = false;
      lastU = u;
      const len = d.len0 + (d.len1 - d.len0) * u, lean = d.lean0 + (d.lean1 - d.lean0) * u, eps = 1e-9;
      if (!(s.len >= len * (1 - B.LEN_JITTER) - eps && s.len <= len * (1 + B.LEN_JITTER) + eps)) lens = false;
      if (!(Math.abs(s.lean - lean) <= B.LEAN_JITTER + B.STRAND_LEAN + eps)) leans = false;
      if (!(s.stiff >= d.stiff * (1 - B.STIFF_JITTER) - eps && s.stiff <= d.stiff * (1 + B.STIFF_JITTER) + eps)) stiffs = false;
      if (!(s.phase >= 0 && s.phase < 2 * Math.PI)) phases = false;
    }
  }
  check('layout: every root on its band\'s line', onLine && uIn, 'furthest off ' + worstOff.toExponential(2));
  check('layout: every root inside its lock\'s span, the locks in order along the band', inSpan && ordered);
  check('layout: lengths within LEN_JITTER of the band\'s at the root', lens,
    S.reduce((m, s) => Math.min(m, s.len), Infinity).toFixed(2) + ' .. ' + S.reduce((m, s) => Math.max(m, s.len), 0).toFixed(2) + ' art px');
  check('layout: leans within LEAN_JITTER + STRAND_LEAN of the band\'s', leans);
  check('layout: stiffness within STIFF_JITTER of the band\'s', stiffs);
  check('layout: phases in [0, 2π)', phases);
  // beard.cpp's lay() copied into c++ with these bands, in doubles
  const g0 = [-0.34892321765422823, -9.9597396287322049, 4.7577577705416676, -0.24462912395596506, 0.36292520284652707, 2.2647147819124469];
  const g39 = [12.53881758660078, -8.5532133553922174, 7.3114433109344938, 0.97958446152508261, 0.3565121698379517, 2.9827488681028291];
  const same = (s, g) => [s.x, s.y, s.len, s.lean, s.stiff, s.phase].every((v, k) => Math.abs(v - g[k]) < 1e-12);
  check('layout: strands 0 and 39 as beard.cpp\'s lay() makes them', same(S[0], g0) && same(S[39], g39));
  const again = Beard.lay();
  check('layout: the same every time', again.every((s, k) => ['x', 'y', 'len', 'lean', 'stiff', 'phase'].every((f) => s[f] === S[k][f])));
}

// --- before the first step -----------------------------------------------------
{
  const b = new Beard(500, 300), fb = makeFb();
  b.draw(fb);
  check('unposed: no points, nothing drawn', b.points(0) === null && fb.bits.every((v) => v === 0));
}

// --- the pose ------------------------------------------------------------------
const mouth = { x: 100, y: 100 };
{
  const b = new Beard(500, 300);
  b.step(STEP, { x: 30, y: 40 }, 1);
  b.reset();
  b.step(STEP, mouth, SCALE); // a step after a reset poses, whatever its dt
  finite(b);
  let rootsOn = true, straight = true, still = true, worstErr = 0;
  for (let i = 0; i < b.strands.length; i++) {
    const p = b.points(i), r = rootOf(b, i, mouth, SCALE), seg = segOf(b, i, SCALE), s = b.strands[i];
    if (p[0].x !== r.x || p[0].y !== r.y) rootsOn = false;
    for (let j = 1; j < p.length; j++) {
      const dx = p[j].x - p[j - 1].x, dy = p[j].y - p[j - 1].y;
      const err = Math.max(Math.abs(dx - Math.sin(s.lean) * seg), Math.abs(dy - Math.cos(s.lean) * seg));
      worstErr = Math.max(worstErr, err);
      if (err > 1e-9) straight = false;
      const q = b.pts[i][j];
      if (q.px !== q.x || q.py !== q.y) still = false;
    }
  }
  check('pose: every root at the mouth plus its offset times the scale', rootsOn);
  check('pose: every strand straight along its lean, segments len / 2 * 0.8', straight, 'worst ' + worstErr.toExponential(2) + ' px');
  check('pose: still, the breeze at 0', still && b.breeze === 0 && b.posed);
}

// --- a still root, 600 steps ---------------------------------------------------
{
  const b = new Beard(500, 300);
  b.step(0, mouth, SCALE);
  const rest = restOf(b, mouth, SCALE);
  let segWorst = 0, drift = 0, rootsHeld = true;
  const tipLo = b.strands.map(() => Infinity), tipHi = b.strands.map(() => -Infinity);
  for (let k = 0; k < 600; k++) {
    b.step(STEP, mouth, SCALE);
    finite(b);
    const now = all(b);
    drift = Math.max(drift, worst(now, rest));
    for (let i = 0; i < now.length; i++) {
      const p = now[i], seg = segOf(b, i, SCALE);
      if (p[0].x !== rest[i][0].x || p[0].y !== rest[i][0].y) rootsHeld = false;
      for (let j = 1; j < p.length; j++) segWorst = Math.max(segWorst, Math.abs(Math.hypot(p[j].x - p[j - 1].x, p[j].y - p[j - 1].y) - seg));
      // how far the tip goes across its strand
      const t = p[p.length - 1], s = b.strands[i];
      const across = (t.x - p[0].x) * Math.cos(s.lean) - (t.y - p[0].y) * Math.sin(s.lean);
      tipLo[i] = Math.min(tipLo[i], across);
      tipHi[i] = Math.max(tipHi[i], across);
    }
  }
  const sway = tipHi.map((h, i) => h - tipLo[i]);
  check('still: segment lengths hold within 1e-3 after every step', segWorst <= 1e-3, 'worst ' + segWorst.toExponential(2) + ' px');
  check('still: the roots stay exactly on their places', rootsHeld);
  check('still: the breeze sways every tip, by its own amount', sway.every((w) => w > 0.05) && Math.max(...sway) > 0.3,
    'tips sway ' + Math.min(...sway).toFixed(2) + ' .. ' + Math.max(...sway).toFixed(2) + ' px across their strands');
  check('still: no point drifts more than 2 px from its rest place', drift <= 2, 'furthest ' + drift.toFixed(3) + ' px');
}

// --- determinism ---------------------------------------------------------------
{
  const a = new Beard(500, 300), b = new Beard(500, 300);
  const ma = { x: 100, y: 100 }, mb = { x: 100, y: 100 };
  let same = true;
  for (let f = 0; f < 400; f++) {
    const dt = f % 37 === 0 ? 0.1 : f % 11 === 0 ? 0 : f % 3 === 0 ? 0.0167 : 0.0166;
    const dx = f === 120 ? 20 : f > 200 && f < 300 ? 0.3 * Math.sin(f * 0.1) : 0, dy = f > 200 && f < 300 ? 0.2 : 0;
    ma.x += dx; ma.y += dy; mb.x += dx; mb.y += dy;
    const s = f >= 350 ? 0.9 : SCALE;
    a.step(dt, ma, s);
    b.step(dt, mb, s);
    finite(a);
    const pa = all(a), pb = all(b);
    for (let i = 0; i < pa.length && same; i++) for (let j = 0; j < pa[i].length; j++) if (pa[i][j].x !== pb[i][j].x || pa[i][j].y !== pb[i][j].y) same = false;
  }
  check('determinism: two beards stepped alike are alike, bit for bit, over 400 frames', same);
}

// --- the frame's time ----------------------------------------------------------
{
  const b = new Beard(500, 300);
  b.step(0, mouth, SCALE);
  b.step(STEP, mouth, SCALE);
  check('dt: a 60 hz frame is one step', b.was === STEP, 'step ' + b.was);
  const before = b.breeze, to = { x: 107.3, y: 97.9 };
  b.step(0.1, to, SCALE);
  finite(b);
  let breeze = before;
  for (let k = 0; k < 6; k++) breeze = (breeze + 2 * Math.PI * BEARD.BREEZE_HZ * (0.1 / 6)) % (2 * Math.PI);
  check('dt: 0.1 s runs 6 steps of 1/60', b.was === 0.1 / 6 && b.breeze === breeze, 'step ' + b.was + ', breeze ' + b.breeze.toFixed(6));
  check('dt: and leaves every root exactly on its target', b.strands.every((s, i) => {
    const p = b.points(i)[0], r = rootOf(b, i, to, SCALE);
    return p.x === r.x && p.y === r.y;
  }));
  // no time: the roots and lengths move to the new mouth and scale, nothing else
  for (const dt of [0, -0.5, NaN]) {
    const keep = all(b), was = b.was, br = b.breeze, m = { x: 90 + (dt || 0), y: 120 };
    b.step(dt, m, 0.9);
    const now = all(b);
    const rootsMoved = now.every((p, i) => { const r = rootOf(b, i, m, 0.9); return p[0].x === r.x && p[0].y === r.y && b.seg[i] === segOf(b, i, 0.9); });
    const restKept = now.every((p, i) => p.every((q, j) => j === 0 || (q.x === keep[i][j].x && q.y === keep[i][j].y)));
    check('dt ' + dt + ': roots and lengths only, nothing else moves', rootsMoved && restKept && b.was === was && b.breeze === br);
  }
}

// --- a jump --------------------------------------------------------------------
// the root jumps 20 px right in one frame: the tips lag it, and the strands
// settle back onto their rest. rest under the breeze is a twin posed at the
// new place and stepped alike (the same breeze, never jolted); the straight
// pose alone is printed too
{
  const b = new Beard(500, 300), twin = new Beard(500, 300);
  const m = { x: 100, y: 100 }, there = { x: 120, y: 100 };
  b.step(0, m, SCALE);
  twin.step(0, there, SCALE);
  const before = all(b);
  m.x += 20;
  b.step(STEP, m, SCALE);
  twin.step(STEP, there, SCALE);
  const first = all(b);
  const rootsOn = first.every((p, i) => { const r = rootOf(b, i, m, SCALE); return p[0].x === r.x && p[0].y === r.y; });
  const tipDx = first.map((p, i) => p[p.length - 1].x - before[i][p.length - 1].x);
  check('jump: the roots land on their targets on the first frame', rootsOn);
  check('jump: every tip lags its root on the first frame', tipDx.every((d) => d < 20 - 0.25),
    'tips moved ' + Math.min(...tipDx).toFixed(2) + ' .. ' + Math.max(...tipDx).toFixed(2) + ' px, mean ' + (tipDx.reduce((a, d) => a + d, 0) / tipDx.length).toFixed(2));
  const rest = restOf(b, m, SCALE);
  let underTwin = -1, underRest = -1, at2 = 0;
  for (let k = 2; k <= 300; k++) {
    b.step(STEP, m, SCALE);
    twin.step(STEP, there, SCALE);
    finite(b);
    const now = all(b), wt = worst(now, all(twin)), wr = worst(now, rest);
    if (k === 120) at2 = wt;
    if (wt >= 0.5) underTwin = -1; else if (underTwin < 0) underTwin = k;
    if (wr >= 0.5) underRest = -1; else if (underRest < 0) underRest = k;
  }
  check('jump: settled within 2 s, every point within 0.5 px of its rest from then on', underTwin > 0 && underTwin <= 120,
    'under 0.5 px of the twin from ' + (underTwin / 60).toFixed(2) + ' s (' + at2.toFixed(3) + ' px at 2 s); of the straight pose from ' + (underRest / 60).toFixed(2) + ' s');
}

// --- kept in -------------------------------------------------------------------
// a mouth in a corner: every point but the roots is held on the world's
// pixels. the roots are pinned where the mouth puts them, off it or not, as
// daedalus's are
{
  const corner = (m0, name) => {
    const b = new Beard(500, 300), m = { x: m0.x, y: m0.y };
    let inside = true, offRoots = 0;
    b.step(0, m, SCALE);
    for (let k = 0; k < 300; k++) {
      m.x = m0.x + Math.sin(k * 0.05); m.y = m0.y + Math.cos(k * 0.07);
      b.step(k % 50 === 0 ? 0.1 : STEP, m, SCALE);
      finite(b);
      for (const p of all(b)) {
        if (p[0].x < 0 || p[0].y < 0 || p[0].x > 499 || p[0].y > 299) offRoots++;
        for (let j = 1; j < p.length; j++) if (!(p[j].x >= 0 && p[j].y >= 0 && p[j].x <= 499 && p[j].y <= 299)) inside = false;
      }
    }
    check('keepIn: a mouth at (' + m0.x + ', ' + m0.y + ') in 500x300, every point but the roots on [0, 499] x [0, 299]', inside,
      offRoots + ' root placings off the world over 300 frames');
  };
  corner({ x: 2, y: 2 }, 'top left');
  corner({ x: 497, y: 297 }, 'bottom right');
  const b = new Beard(100, 100);
  b.step(0, { x: 50, y: 50 }, SCALE);
  b.resize(40, 30);
  b.reset();
  b.step(STEP, { x: 50, y: 50 }, SCALE);
  check('resize + reset: the next step poses inside the new size', all(b).every((p) => p.every((q, j) => j === 0 || (q.x <= 39 && q.y <= 29))) && b.breeze === 0);
}

check('no NaN anywhere, every check\'s every step', nans === 0, nans + ' non-finite');

// --- drawing -------------------------------------------------------------------
{
  check('pixel: the nearest, a half rounded down', Beard.pixel(10.5) === 10 && Beard.pixel(10.51) === 11 && Beard.pixel(10.49) === 10 &&
    Beard.pixel(-0.5) === -1 && Beard.pixel(3) === 3);
  const b = new Beard(240, 240);
  b.step(0, mouth, SCALE);
  for (let k = 0; k < 90; k++) b.step(STEP, mouth, SCALE);
  const fb = makeFb();
  b.draw(fb);
  let lit = 0;
  for (const v of fb.bits) { if (v !== 0 && v !== 1) lit = -1e9; lit += v; }
  const ends = all(b).every((p) => p.every((q) => fb.get(Beard.pixel(q.x), Beard.pixel(q.y)) === 1));
  check('draw: lights pixels, every point\'s own among them', lit > 40 && ends, lit + ' lit');
  const full = makeFb();
  full.bits.fill(1);
  b.draw(full);
  check('draw: nothing dark is written', full.bits.every((v) => v === 1));
  console.log('\nthe mustache alone, mouth (100, 100) scale 0.8, 1.5 s on, window x 76..123 y 90..105:\n' + dump(fb, 76, 90, 48, 16) + '\n');
}

console.log('\n' + (failures ? failures + ' failed' : 'all passed'));
process.exit(failures ? 1 : 0);
