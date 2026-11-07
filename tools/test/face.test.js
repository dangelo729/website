// node tools/test/face.test.js
//
// loads js/raster.js, js/face-art.js and js/face.js the way the page does,
// classic scripts sharing one global scope, in a vm context with no dom, no
// performance and a Date that throws, so the face cannot quietly lean on
// any of them. Math.random is counted and pinned to 0.5, which puts the
// blink wait at 5 s. the face draws into a real framebuffer (ImageData is
// stubbed); a fake blob and world stand in for softbody.js. prints the face
// as ascii; exits 1 on failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const STEP = 1 / 60;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const fmt = (p) => '(' + p.x.toFixed(4) + ', ' + p.y.toFixed(4) + ')';

// --- the scripts -------------------------------------------------------------
let randoms = 0;
const math = Object.create(Math);
math.random = () => { randoms++; return 0.5; };
// the browser's ImageData, as much of it as a Framebuffer makes
class ImageData {
  constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
}
const sandbox = { Math: math, ImageData };
for (const name of ['Date', 'performance', 'window', 'document', 'requestAnimationFrame']) {
  Object.defineProperty(sandbox, name, { get() { throw new Error('the face read ' + name); } });
}
const ctx = vm.createContext(sandbox);
for (const file of ['js/raster.js', 'js/face-art.js', 'js/face.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
}
const { FACE_ART, FACE, Face, Framebuffer } = vm.runInContext('({ FACE_ART, FACE, Face, Framebuffer })', ctx);

// --- fakes -------------------------------------------------------------------
function fakeBlob(x, y, radius) {
  const b = { x, y, radius, getCenter: () => ({ x: b.x, y: b.y }) };
  return b;
}
function fakeWorld(nearest, px = null, py = null, drag = null) {
  return { nearestTo: () => nearest, pointerX: px, pointerY: py, drag };
}
// a real framebuffer, big enough for every face here. a set off the grid
// would land nowhere in a Uint8Array, silently, so it throws instead
function makeFb() {
  const fb = new Framebuffer(240, 240), set = fb.set;
  fb.set = function (x, y, v = 1) {
    if (x !== Math.floor(x) || y !== Math.floor(y)) throw new Error('fb.set off the grid: ' + x + ', ' + y);
    set.call(this, x, y, v);
  };
  return fb;
}
// its lit pixels as "x,y"
function litSet(fb) {
  const out = new Set();
  for (let y = 0; y < fb.h; y++) for (let x = 0; x < fb.w; x++) if (fb.bits[y * fb.w + x]) out.add(x + ',' + y);
  return out;
}
// a pupil as draw should put it: the 3x3 plus on eye + offset, at the face's scale
function pupilPx(face, eye, pupil) {
  const fb = makeFb();
  fb.sprite(Framebuffer.ink(FACE.PUPILS.ART), eye.x + (pupil.x + 0.5) * face.scale, eye.y + (pupil.y + 0.5) * face.scale, face.scale, 0, 1, FACE.MIN_HITS);
  return litSet(fb);
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
function run(face, blob, world, n, dt = STEP, each) {
  for (let i = 0; i < n; i++) {
    face.update(blob, world, dt);
    if (each) each(face, i);
  }
}

// --- the art -----------------------------------------------------------------
for (const [part, w, h, n] of [['eyes', 28, 18, 7], ['nose', 24, 24, 4], ['mouf', 40, 24, 10]]) {
  const a = FACE_ART[part];
  const rowsOk = a.frames.every((f) => f.length === h && f.every((r) => r.length === w && /^[.#]+$/.test(r)));
  check('art ' + part + ' is ' + w + 'x' + h + 'x' + n, a.w === w && a.h === h && a.frames.length === n && rowsOk,
    a.w + 'x' + a.h + 'x' + a.frames.length);
}

// --- at rest -----------------------------------------------------------------
FACE.EYES.BLINK = false;
const blob = fakeBlob(100, 100, 36);
const empty = fakeWorld(null);
const rest = new Face(blob);
const randomsBefore = randoms;
run(rest, blob, empty, 200);
check('rest: left eye at (85, 90)', near(rest.leftEye.x, 85, 0.01) && near(rest.leftEye.y, 90, 0.01), fmt(rest.leftEye));
check('rest: right eye at (115, 90)', near(rest.rightEye.x, 115, 0.01) && near(rest.rightEye.y, 90, 0.01), fmt(rest.rightEye));
check('rest: nose at (100, 100)', near(rest.nose.x, 100, 0.01) && near(rest.nose.y, 100, 0.01), fmt(rest.nose));
check('rest: mouth at (100, 122)', near(rest.mouf.x, 100, 0.01) && near(rest.mouf.y, 122, 0.01), fmt(rest.mouf));
check('rest: pupils at (0, -3)', [rest.leftPupil, rest.rightPupil].every((p) => near(p.x, 0, 0.01) && near(p.y, -3, 0.01)),
  fmt(rest.leftPupil) + ' ' + fmt(rest.rightPupil));
check('rest: frames eyes 6, nose 0, mouth 0', rest.eyeFrame === 6 && rest.noseFrame === 0 && rest.moufFrame === 0,
  rest.eyeFrame + ' ' + rest.noseFrame + ' ' + rest.moufFrame);
check('rest: no Math.random with the blink off', randoms === randomsBefore, (randoms - randomsBefore) + ' calls');

// --- one step, cicada's rates --------------------------------------------------
{
  const b = fakeBlob(100, 100, 36);
  const f = new Face(b);
  b.x = 110;
  f.update(b, fakeWorld(null, 400, 100), STEP);
  check('step: eyes ease 0.09 / 0.10, nose 0.05, mouth 0.01',
    near(f.leftEye.x, 85.9, 1e-9) && near(f.rightEye.x, 116, 1e-9) && near(f.nose.x, 100.5, 1e-9) && near(f.mouf.x, 100.1, 1e-9),
    f.leftEye.x + ' ' + f.rightEye.x + ' ' + f.nose.x + ' ' + f.mouf.x);
  // from the eye as it is after this step's move
  const P = FACE.PUPILS;
  const want = (eye, lazy) => {
    const dx = 400 - eye.x, dy = 100 - eye.y, d = Math.sqrt(dx * dx + dy * dy), k = Math.min(1, d / P.MAX_DISTANCE);
    return { x: (P.OFFSET_X + dx / d * P.ELLIPSE_W * k) * P.RATE * lazy, y: (P.OFFSET_Y + dy / d * P.ELLIPSE_H * k) * P.RATE * lazy };
  };
  const wl = want(f.leftEye, 1.0), wr = want(f.rightEye, 0.85);
  check('step: pupils 0.15 of the way, right one 0.85 as keen',
    near(f.leftPupil.x, wl.x, 1e-9) && near(f.leftPupil.y, wl.y, 1e-9) && near(f.rightPupil.x, wr.x, 1e-9) && near(f.rightPupil.y, wr.y, 1e-9),
    fmt(f.leftPupil) + ' ' + fmt(f.rightPupil));
}

// --- the time step -------------------------------------------------------------
{
  const b = fakeBlob(100, 100, 36);
  const a = new Face(b), h = new Face(b), big = new Face(b), one = new Face(b);
  b.x = 140;
  const w = fakeWorld(null, 400, 100);
  run(a, b, w, 30, STEP);
  run(h, b, w, 60, STEP / 2);
  check('dt: two half steps are one step', a.leftEye.x === h.leftEye.x && a.leftPupil.x === h.leftPupil.x, a.leftEye.x + ' ' + h.leftEye.x);
  big.update(b, w, 5);
  const six = new Face(fakeBlob(100, 100, 36));
  run(six, b, w, 6, STEP);
  check('dt: a long stall catches up 0.1 s, not 5', near(big.leftEye.x, six.leftEye.x, 1e-9), big.leftEye.x + ' ' + six.leftEye.x);
  one.update(b, w);
  const ref = new Face(fakeBlob(100, 100, 36));
  ref.update(b, w, STEP);
  check('dt: none given runs one step', one.leftEye.x === ref.leftEye.x, one.leftEye.x + ' ' + ref.leftEye.x);
}

// --- what the pupils follow ------------------------------------------------------
{
  const pointer = new Face(blob);
  run(pointer, blob, fakeWorld(null, 400, 100), 200);
  check('pointer at (400, 100): left pupil to about (+5, -3)',
    near(pointer.leftPupil.x, 5, 0.05) && near(pointer.leftPupil.y, -3, 0.15), fmt(pointer.leftPupil));
  check('pointer at (400, 100): right pupil to about (+5, -3)',
    near(pointer.rightPupil.x, 5, 0.05) && near(pointer.rightPupil.y, -3, 0.15), fmt(pointer.rightPupil));

  // another blob far off on the left beats the pointer on the right
  const other = fakeBlob(-300, 100, 10);
  const far = { blob: other, dist: 400, edgeDist: 400 - 36 - 10 };
  const prefer = new Face(blob);
  run(prefer, blob, fakeWorld(far, 400, 100), 200);
  check('blob-then-pointer: a blob wins over the pointer', near(prefer.leftPupil.x, -5, 0.05), fmt(prefer.leftPupil));
  check('far blob: no sniff, mouth shut', prefer.noseFrame === 0 && prefer.moufFrame === 0, prefer.noseFrame + ' ' + prefer.moufFrame);

  FACE.PUPILS.TRACK = 'blob';
  const blobOnly = new Face(blob);
  run(blobOnly, blob, fakeWorld(null, 400, 100), 200);
  check("track 'blob': the pointer alone is ignored", near(blobOnly.leftPupil.x, 0, 0.01) && near(blobOnly.leftPupil.y, -3, 0.01), fmt(blobOnly.leftPupil));

  FACE.PUPILS.TRACK = 'pointer';
  const pointerOnly = new Face(blob);
  run(pointerOnly, blob, fakeWorld(far, 400, 100), 200);
  check("track 'pointer': a blob is ignored", near(pointerOnly.leftPupil.x, 5, 0.05), fmt(pointerOnly.leftPupil));
  FACE.PUPILS.TRACK = 'blob-then-pointer';
}

// --- something close: sniff and gape -------------------------------------------
{
  const close = new Face(blob);
  let top = -1, bottomAfterTop = -1, mouthAt = -1;
  run(close, blob, fakeWorld({ edgeDist: 0 }), 200, STEP, (f, i) => {
    if (top < 0 && f.noseFrame >= 2.9) top = i;
    if (top >= 0 && bottomAfterTop < 0 && f.noseFrame <= 0.1) bottomAfterTop = i;
    if (mouthAt < 0 && f.moufFrame === 9) mouthAt = i;
  });
  check('close: nose sniffs up to >= 2.9 and back to <= 0.1', top >= 0 && bottomAfterTop > top, 'up at ' + top + ', down at ' + bottomAfterTop);
  check('close: mouth opens to frame 9', mouthAt >= 0, 'at update ' + mouthAt);

  const edge = 36 * 2.5;
  const just = new Face(blob);
  run(just, blob, fakeWorld({ edgeDist: edge }), 20);
  const past = new Face(blob);
  run(past, blob, fakeWorld({ edgeDist: edge + 0.01 }), 20);
  check('close: 2.5 radii edge to edge is close, a hair more is not',
    just.sniffing && just.mouthOpen && !past.sniffing && !past.mouthOpen && past.noseFrame === 0 && past.moufFrame === 0);

  // and when it goes the nose and mouth settle back
  run(close, blob, empty, 200);
  check('close, then gone: nose and mouth back to 0', close.noseFrame === 0 && close.moufFrame === 0, close.noseFrame + ' ' + close.moufFrame);
}

// --- held: sniff, gape and stare -----------------------------------------------
// the pointer's drag on this bubble's skin: the nose sniffs and the mouth
// opens as for something close, the eyes stay their size; a drag on some
// other bubble is nothing to him
{
  const other = fakeBlob(300, 300, 36);
  const heldWorld = fakeWorld(null, 130, 100, { blob, points: [], x: 130, y: 100 });
  const f = new Face(blob);
  let mouthAt = -1, top = -1, bottomAfterTop = -1;
  run(f, blob, heldWorld, 200, STEP, (f, i) => {
    if (mouthAt < 0 && f.moufFrame === 9) mouthAt = i;
    if (top < 0 && f.noseFrame >= 2.9) top = i;
    if (top >= 0 && bottomAfterTop < 0 && f.noseFrame <= 0.1) bottomAfterTop = i;
  });
  check('held: he knows he is held, sniffs and gapes', f.held && f.sniffing && f.mouthOpen && mouthAt >= 0 && top >= 0 && bottomAfterTop > top,
    'mouth open at update ' + mouthAt + ', sniff up at ' + top + ', down at ' + bottomAfterTop);
  // drawn: the eyes' box as at rest
  const eyeBox = (face) => {
    const fb = makeFb();
    face.draw(fb);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, n = 0;
    for (const k of litSet(fb)) { const [x, y] = k.split(',').map(Number); if (y > 97) continue; n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { x0, x1, y0, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, n, fb };
  };
  const r = eyeBox(rest), h = eyeBox(f);
  check('held: drawn, the eyes are the size they are at rest, on the same middles', h.w === r.w && h.h === r.h && near((h.x0 + h.x1) / 2, (r.x0 + r.x1) / 2, 1) && near((h.y0 + h.y1) / 2, (r.y0 + r.y1) / 2, 1.5),
    'rest ' + r.w + 'x' + r.h + ' px over x ' + r.x0 + '..' + r.x1 + ' y ' + r.y0 + '..' + r.y1 + ', held ' + h.w + 'x' + h.h + ' over x ' + h.x0 + '..' + h.x1 + ' y ' + h.y0 + '..' + h.y1);
  // the pupils look at the pointer, to the right, inside the eye ring
  const pupilAt = (face, eye, pupil) => {
    const fb = makeFb(), s = face.scale;
    fb.sprite(Framebuffer.ink(FACE.PUPILS.ART), eye.x + (pupil.x + 0.5) * s, eye.y + (pupil.y + 0.5) * s, s, 0, 1, FACE.MIN_HITS);
    return litSet(fb);
  };
  const lp = pupilAt(f, f.leftEye, f.leftPupil), drawnHeld = litSet(h.fb);
  check('held: the pupils are drawn at the face\'s scale, looking right at the pointer', f.leftPupil.x > 1 && [...lp].every((k) => drawnHeld.has(k)), 'left pupil at ' + fmt(f.leftPupil));
  console.log('held, the staring eyes and the open mouth, x 60..140 y 70..130:\n' + dump(h.fb, 60, 70, 80, 60));
  // a drag on another bubble: nothing
  const g = new Face(blob);
  run(g, blob, fakeWorld(null, 130, 100, { blob: other, points: [], x: 300, y: 300 }), 60);
  check('held: a drag on another bubble leaves him be', !g.held && !g.sniffing && !g.mouthOpen && g.moufFrame === 0);
  // let go: back to rest
  run(f, blob, empty, 200);
  check('let go: nose and mouth back to rest', !f.held && f.noseFrame === 0 && f.moufFrame === 0, f.noseFrame + ' ' + f.moufFrame);
  // held, the eyes do not blink: 8 s held with the blink on and a 5 s wait,
  // never off frame 6, the wait not counted down; let go, it runs and the
  // blink comes 5 s on
  FACE.EYES.BLINK = true;
  const stare = new Face(blob);
  let offOpen = 0;
  run(stare, blob, heldWorld, 480, STEP, (f) => { if (f.eyeFrame !== 6 || f.eyeTarget !== 6) offOpen++; });
  check('held: a stare, no blink in 8 s with a 5 s wait, the wait kept whole', offOpen === 0 && stare.blinkIn === 5, offOpen + ' steps off open, wait left ' + stare.blinkIn.toFixed(2));
  let shutAt = -1;
  run(stare, blob, empty, 320, STEP, (f, i) => { if (shutAt < 0 && f.eyeTarget === 0) shutAt = i; });
  check('let go: the blink comes 5 s on', shutAt >= 0 && near((shutAt + 1) * STEP, 5, 0.05), 'at ' + ((shutAt + 1) * STEP).toFixed(3) + ' s');
  // grabbed mid-blink: the eyes open again; let go, the blink that was
  // under way comes at once
  const mid = new Face(blob);
  mid.eyeTarget = 0; mid.eyeFrame = 2; mid.blinkIn = 0;
  run(mid, blob, heldWorld, 30);
  check('held mid-blink: the eyes open again', mid.eyeTarget === 6 && mid.eyeFrame === 6);
  mid.update(blob, empty, STEP);
  check('let go mid-blink: the blink that was under way comes at once', mid.eyeTarget === 0);
  FACE.EYES.BLINK = false;
}

// --- size --------------------------------------------------------------------
{
  const big = fakeBlob(100, 100, 72);
  const born = new Face(big);
  check('radius 72: a new face starts at double the offsets',
    born.leftEye.x === 70 && born.leftEye.y === 80 && born.rightEye.x === 130 && born.mouf.y === 144);

  const grows = fakeBlob(100, 100, 36);
  const g = new Face(grows);
  run(g, grows, empty, 200);
  grows.radius = 72;
  run(g, grows, empty, 2000);
  check('radius 72: eyes ease out to (70, 80) and (130, 80)',
    near(g.leftEye.x, 70, 0.01) && near(g.leftEye.y, 80, 0.01) && near(g.rightEye.x, 130, 0.01) && near(g.rightEye.y, 80, 0.01),
    fmt(g.leftEye) + ' ' + fmt(g.rightEye));
  check('radius 72: nose stays at (100, 100), mouth eases to (100, 144)',
    near(g.nose.x, 100, 0.01) && near(g.nose.y, 100, 0.01) && near(g.mouf.x, 100, 0.01) && near(g.mouf.y, 144, 0.01),
    fmt(g.nose) + ' ' + fmt(g.mouf));
  check('radius 72: the pupil offsets stay in art pixels', near(g.leftPupil.y, -3, 0.01), fmt(g.leftPupil));
}

// --- drawing -------------------------------------------------------------------
// at radius 36 on whole pixels each feature is its art 1:1, top-left at
// pos - size / 2; the pupils are whatever their sprite makes
function expected(sprites, pupils) {
  const want = new Set();
  for (const [rows, x, y] of sprites) {
    rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === '#') want.add((x + i) + ',' + (y + j)); });
  }
  for (const p of pupils) for (const k of p) want.add(k);
  return want;
}
function same(a, b) {
  const extra = [...a].filter((k) => !b.has(k)), missing = [...b].filter((k) => !a.has(k));
  return { ok: extra.length === 0 && missing.length === 0, detail: extra.length + ' extra, ' + missing.length + ' missing' +
    (extra.length ? ' e.g. extra ' + extra[0] : '') + (missing.length ? ' e.g. missing ' + missing[0] : '') };
}
{
  const fb = makeFb();
  rest.draw(fb);
  const eye = FACE_ART.eyes.frames[6];
  // eye top-left: 85 - 14, 90 - 9; pupils on (85, 87) and (115, 87)
  let ring = true;
  for (const ex of [71, 101]) {
    eye.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === '#' && !fb.get(ex + i, 81 + j)) ring = false; });
  }
  check('draw: open eye rings at (71, 81) and (101, 81)', ring);
  const pl = pupilPx(rest, rest.leftEye, rest.leftPupil), pr = pupilPx(rest, rest.rightEye, rest.rightPupil), on = litSet(fb);
  check('draw: pupils are the 3x3 plus as a sprite on (85, 87) and (115, 87)', pl.size > 0 && pr.size > 0 && [...pl, ...pr].every((k) => on.has(k)),
    [...pl].join(' ') + ' / ' + [...pr].join(' '));
  const s = same(on, expected([
    [eye, 71, 81], [eye, 101, 81],
    [FACE_ART.nose.frames[0], 88, 88],
    [FACE_ART.mouf.frames[0], 80, 110],
  ], [pl, pr]));
  check('draw: nothing lit but eyes, pupils, nose at (88, 88) and mouth at (80, 110)', s.ok, s.detail);
  console.log('\nat rest, blob centre (100, 100) r 36, window x 60..139 y 78..127:\n' + dump(fb, 60, 78, 80, 50) + '\n');
}
{
  // a blob just off to the right and touching: pupils right, sniffing, mouth open
  const other = fakeBlob(160, 100, 12);
  const touching = { blob: other, dist: 60, edgeDist: 60 - 36 - 12 };
  const keen = new Face(blob);
  run(keen, blob, fakeWorld(touching), 200);
  const fb = makeFb();
  keen.draw(fb);
  const nf = Face.frame(FACE_ART.nose, keen.noseFrame);
  const lp = pupilPx(keen, keen.leftEye, keen.leftPupil), rp = pupilPx(keen, keen.rightEye, keen.rightPupil);
  // the middle of a pupil's pixels, which looking right is right of the eye's
  const midX = (p) => [...p].reduce((sum, k) => sum + Number(k.split(',')[0]) + 0.5, 0) / p.size;
  const eye = FACE_ART.eyes.frames[6];
  const s = same(litSet(fb), expected([
    [eye, 71, 81], [eye, 101, 81],
    [FACE_ART.nose.frames[nf], 88, 88],
    [FACE_ART.mouf.frames[9], 80, 110],
  ], [lp, rp]));
  check('draw, blob close on the right: mouth frame 9, pupils looking right', s.ok && keen.moufFrame === 9 && midX(lp) > 86 && midX(rp) > 116,
    s.detail + '; pupils ' + [...lp].join(' ') + ' / ' + [...rp].join(' ') + '; nose frame ' + nf);
  console.log('\na blob touching on the right (nose frame ' + nf + ', mouth 9), same window:\n' + dump(fb, 60, 78, 80, 50) + '\n');
}

// --- at 0.8: the page's bubble -------------------------------------------------
// radius 28.8: nothing lands 1:1, every feature is resampled. each one alone
// keeps between 0.6 and 1.4 times its art's ink, and the face is those
// sprites and nothing else
{
  const small = fakeBlob(100, 100, 36 * 0.8);
  const f = new Face(small);
  run(f, small, empty, 200);
  check('radius 28.8: scale 0.8, eyes at (88, 92) and (112, 92), mouth at (100, 117.6)',
    near(f.scale, 0.8, 1e-12) && near(f.leftEye.x, 88, 1e-9) && near(f.leftEye.y, 92, 1e-9) && near(f.rightEye.x, 112, 1e-9) &&
    near(f.mouf.x, 100, 1e-9) && near(f.mouf.y, 117.6, 1e-9), f.scale + ' ' + fmt(f.leftEye) + ' ' + fmt(f.rightEye) + ' ' + fmt(f.mouf));
  const fb = makeFb();
  f.draw(fb);
  const s = f.scale, I = f.ink;
  const parts = [
    ['left eye', I.eyes[6], f.leftEye],
    ['right eye', I.eyes[6], f.rightEye],
    ['left pupil', I.pupil, { x: f.leftEye.x + f.leftPupil.x * s, y: f.leftEye.y + f.leftPupil.y * s }],
    ['right pupil', I.pupil, { x: f.rightEye.x + f.rightPupil.x * s, y: f.rightEye.y + f.rightPupil.y * s }],
    ['nose', I.nose[0], f.nose],
    ['mouth', I.mouf[0], f.mouf],
  ];
  const union = new Set();
  for (const [name, g, at] of parts) {
    const one = makeFb();
    one.sprite(g, at.x, at.y, s, 0, 1, FACE.MIN_HITS);
    const px = litSet(one);
    for (const k of px) union.add(k);
    let ink = 0;
    for (const b of g.ink) ink += b;
    check('radius 28.8: ' + name + ' lit 0.6x..1.4x its ink', px.size > 0 && px.size >= 0.6 * ink && px.size <= 1.4 * ink,
      px.size + ' lit of ' + ink + ' ink, ' + (px.size / ink).toFixed(2) + 'x');
  }
  const u = same(litSet(fb), union);
  check('radius 28.8: the face is those sprites and nothing else', u.ok, u.detail);
  console.log('\nat rest, blob centre (100, 100) r 28.8, window x 60..139 y 78..127:\n' + dump(fb, 60, 78, 80, 50) + '\n');
}

// --- blinking ------------------------------------------------------------------
{
  FACE.EYES.BLINK = true;
  const r0 = randoms;
  const b = new Face(blob);
  check('blink: the wait is drawn once with Math.random', randoms === r0 + 1 && b.blinkIn === 5, randoms - r0 + ' calls, ' + b.blinkIn + ' s');
  let firstShut = -1, shutFb = null, openAgain = -1;
  run(b, blob, empty, 420, STEP, (f, i) => {
    const drawn = Face.frame(FACE_ART.eyes, f.eyeFrame);
    if (firstShut < 0 && drawn === 0) {
      firstShut = i;
      shutFb = makeFb();
      f.draw(shutFb);
    }
    if (firstShut >= 0 && openAgain < 0 && f.eyeFrame === 6) openAgain = i;
  });
  const shutS = (firstShut + 1) * STEP, openS = (openAgain + 1) * STEP;
  check('blink: shut after 5 s and open again within half a second', firstShut >= 0 && near(shutS, 5, 0.2) && openAgain > firstShut && openS - shutS < 0.5,
    'shut at ' + shutS.toFixed(3) + ' s, fully open at ' + openS.toFixed(3) + ' s');
  check('blink: a second wait was drawn', randoms === r0 + 2, randoms - r0 + ' calls');
  const shutEye = FACE_ART.eyes.frames[0];
  const s = shutFb && same(litSet(shutFb), expected([
    [shutEye, 71, 81], [shutEye, 101, 81],
    [FACE_ART.nose.frames[0], 88, 88],
    [FACE_ART.mouf.frames[0], 80, 110],
  ], []));
  check('blink: shut eyes are drawn with no pupils', !!s && s.ok, s && s.detail);
  FACE.EYES.BLINK = false;
}

// --- carried -------------------------------------------------------------------
{
  // a resize carries the face with the bubble, nothing eased, pupils as they were
  const f = new Face(blob);
  const before = [f.leftEye, f.rightEye, f.nose, f.mouf].map((p) => ({ x: p.x, y: p.y }));
  const pupil = { x: f.leftPupil.x, y: f.leftPupil.y };
  f.moveBy(30, -12);
  const moved = [f.leftEye, f.rightEye, f.nose, f.mouf].every((p, i) => p.x === before[i].x + 30 && p.y === before[i].y - 12);
  check('moveBy: every feature carried exactly, the pupils left alone', moved && f.leftPupil.x === pupil.x && f.leftPupil.y === pupil.y);
}

console.log('\n' + (failures ? failures + ' failed' : 'all passed'));
process.exit(failures ? 1 : 0);
