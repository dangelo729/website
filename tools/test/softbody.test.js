// node tools/test/softbody.test.js
//
// loads js/softbody.js the way the page does, a classic script, in a vm
// context with no performance and a Date that throws, so the physics cannot
// lean on the wall clock. Math.random is a seeded generator the checks can
// count or forbid. exits 1 on failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const dist = (a, b) => Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));

// --- the script --------------------------------------------------------------
// mulberry32, so a failing run can be run again exactly
let seed = 0x5eed, randoms = 0, randomForbidden = false;
function rng() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const math = Object.create(Math);
math.random = () => {
  if (randomForbidden) throw new Error('Math.random inside a step that should not need it');
  randoms++;
  return rng();
};
const sandbox = { Math: math, Date: function () { throw new Error('Date used'); } };
const ctx = vm.createContext(sandbox);
const file = path.join(ROOT, 'js', 'softbody.js');
vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
// top-level const and class live in the realm's shared scope, as on the page
const { SOFT, Point, SoftBlob, World } = vm.runInContext('({ SOFT, Point, SoftBlob, World })', ctx);

check('globals defined', typeof SOFT === 'object' && typeof Point === 'function' &&
  typeof SoftBlob === 'function' && typeof World === 'function');

const finite = (b) => b.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) &&
  Number.isFinite(p.px) && Number.isFinite(p.py));
function worstChord(b) {
  let worst = 0;
  for (let i = 0; i < b.points.length; i++) {
    const d = dist(b.points[i], b.points[(i + 1) % b.points.length]);
    worst = Math.max(worst, Math.abs(d / b.chord - 1));
  }
  return worst;
}
// a locked bubble at (x, y), stepped until it has filled out
function settledWorld(x = 100, y = 100, steps = 600) {
  const world = new World(500, 300);
  const b = new SoftBlob(x, y, 32, 36, 1.2, true);
  world.blobs.push(b);
  for (let i = 0; i < steps; i++) world.tick();
  return { world, b };
}

// --- a locked blob at rest ---------------------------------------------------
{
  const { b } = settledWorld();
  const c = b.getCenter();
  check('rest: centre stays on the lock', dist(c, { x: 100, y: 100 }) <= 0.5, 'off by ' + dist(c, { x: 100, y: 100 }).toExponential(2));
  const a = b.getArea();
  check('rest: area within 5 % of target', Math.abs(a / b.area - 1) <= 0.05, (100 * (a / b.area - 1)).toFixed(2) + ' %');
  const wc = worstChord(b);
  check('rest: every chord within 15 % of blob.chord', wc <= 0.15, 'worst ' + (100 * wc).toFixed(2) + ' %');
  check('rest: no NaN', finite(b));
  check('rest: lock untouched', b.lockX === 100 && b.lockY === 100);
  check('rest: points start at the top, clockwise', (() => {
    const f = new SoftBlob(0, 0, 4, 10, 1, false).points;
    return near(f[0].x, 0, 1e-12) && near(f[0].y, -10, 1e-12) && near(f[1].x, 10, 1e-12) && near(f[1].y, 0, 1e-12);
  })());
}

// --- grab, drag, breakaway ---------------------------------------------------
{
  const { world, b } = settledWorld();
  check('grab: far from every point misses', world.grab(400, 100) === false && world.drag === null);
  check('grab: on the skin catches', world.grab(100 + 36, 100) === true && world.drag !== null);
  const d = world.drag;
  check('grab: five points, forces 1 .6 .6 .3 .3', d.points.length === 5 &&
    d.points.map((q) => q.force).join(' ') === '1 0.6 0.6 0.3 0.3', d.points.map((q) => q.force).join(' '));
  const at = b.points.indexOf(d.points[0].point), n = b.points.length;
  check('grab: the nearest point then its neighbours, left before right', at === 8 &&
    d.points[1].point === b.points[(at - 1 + n) % n] && d.points[2].point === b.points[(at + 1) % n] &&
    d.points[3].point === b.points[(at - 2 + n) % n] && d.points[4].point === b.points[(at + 2) % n], 'index ' + at);
  check('grab: sets the pointer', world.pointerX === 136 && world.pointerY === 100);

  // the drag's force against the lock: the skin gives a little toward the
  // pointer, the bubble does not travel.
  const p = d.points[0].point, x0 = p.x;
  world.pointer(100 + 60, 100);
  for (let i = 0; i < 120; i++) world.tick();
  check('drag: still held after 120 steps', world.drag === d);
  check('drag: the grabbed point moved toward the pointer', p.x - x0 > 0.2, 'dx ' + (p.x - x0).toFixed(3));
  const c = b.getCenter();
  check('drag: the lock keeps the centre within a few px', dist(c, { x: 100, y: 100 }) < 3, 'off by ' + dist(c, { x: 100, y: 100 }).toFixed(3));
  check('drag: no NaN', finite(b));

  // from wherever the pull has got the point to
  world.pointer(p.x + SOFT.DRAG.BREAKAWAY + 10, 100);
  world.tick();
  check('breakaway: past ' + SOFT.DRAG.BREAKAWAY + ' px lets go', world.drag === null);
}
{
  // an unlocked blob has nothing holding it back, so the same force carries it
  const world = new World(500, 300);
  const b = world.spawn(8, 100, 100);
  for (let i = 0; i < 60; i++) world.tick();
  const c0 = b.getCenter();
  check('drag unlocked: grab', world.grab(c0.x + 8, c0.y) === true);
  world.pointer(150, 100);
  for (let i = 0; i < 120; i++) world.tick();
  const c1 = b.getCenter();
  check('drag unlocked: the blob follows the pointer', c1.x - c0.x > 5, 'dx ' + (c1.x - c0.x).toFixed(3));
  check('drag unlocked: release', (world.release(), world.drag === null));
  world.grab(c1.x + 8, c1.y);
  world.pointerOff();
  check('pointerOff: keeps the drag, forgets the pointer', world.drag !== null && world.pointerX === null && world.pointerY === null);
}
{
  // a dragged point taken out of its ring ends the drag on the next step
  const { world, b } = settledWorld(250, 150, 60);
  world.grab(250 + 36, 150);
  b.removePoints([b.points.indexOf(world.drag.points[0].point)]);
  world.tick();
  check('validate: a dragged point gone from the ring releases', world.drag === null);
}

// --- merge -------------------------------------------------------------------
{
  const A = new SoftBlob(100, 100, 32, 36, 1.2, false);
  const B = new SoftBlob(170, 100, 16, 10, 1.2, true);
  const aPts = A.points.slice(), bPts = B.points.slice();
  const oldA = A.area, oldB = B.area, puffA = A.puffiness;
  const seams = A.merge(B, 3, 5);
  check('merge: n + m - 2 points', A.points.length === 32 + 16 - 2, A.points.length);
  check('merge: every point object unique', new Set(A.points).size === A.points.length);
  // cicada's ring: this[0..i-1], other[j+1 .. j-1] round the ring, this[i+1..]
  const want = aPts.slice(0, 3);
  for (let k = 6; k !== 5; k = (k + 1) % 16) want.push(bPts[k]);
  for (let k = 4; k < 32; k++) want.push(aPts[k]);
  check('merge: splice order', want.length === A.points.length && want.every((q, k) => A.points[k] === q));
  check('merge: the colliding points are dropped', !A.points.includes(aPts[3]) && !A.points.includes(bPts[5]));
  // connectionIndices: i - 1, i, i + m - 2, i + m - 1
  check('merge: seams are cicada connectionIndices', seams.join(' ') === '2 3 17 18', seams.join(' '));
  check('merge: areas add', A.area === oldA + oldB);
  const puff = Math.min(puffA * (1 + (Math.sqrt((oldA + oldB) / oldA) - 1) * SOFT.MERGE_PUFF_SHARE), SOFT.MAX_PUFFINESS);
  check('merge: puffiness boost', A.puffiness === puff, A.puffiness);
  check('merge: radius from area and puffiness', A.radius === Math.sqrt(A.area / (Math.PI * A.puffiness)));
  check('merge: circumference and chord recomputed', A.circumference === 2 * Math.PI * A.radius &&
    A.chord === A.circumference / A.points.length);
  check('merge: lock inherited from the eaten blob', A.locked === true && A.lockX === 170 && A.lockY === 100);
}
{
  const A = new SoftBlob(100, 100, 32, 36, 1.2, true);
  const B = new SoftBlob(170, 100, 16, 10, 1.2, false);
  A.merge(B, 3, 5);
  check('merge: an unlocked meal leaves the lock alone', A.locked && A.lockX === 100 && A.lockY === 100);
  const C = new SoftBlob(0, 0, 8, 10, 1.2, false), D = new SoftBlob(0, 0, 8, 10, 1.2, false);
  check('merge: i = 0 gives three seams', C.merge(D, 0, 2).join(' ') === '0 6 7');
  check('merge: i = 0 ring', C.points.length === 14 && new Set(C.points).size === 14);
  const E = new SoftBlob(0, 0, 8, 10, 1.2, false), F = new SoftBlob(0, 0, 8, 10, 1.2, false);
  const eLast = E.points[7];
  const s = E.merge(F, 7, 2);
  check('merge: i = last gives three seams and no duplicates', s.join(' ') === '6 7 13' &&
    E.points.length === 14 && new Set(E.points).size === 14 && !E.points.includes(eLast), s.join(' ') + ' / ' + E.points.length);
  const big = new SoftBlob(0, 0, 32, 200, 2.4, false), crumb = new SoftBlob(0, 0, 32, 200, 2.4, false);
  big.merge(crumb, 1, 1);
  check('merge: puffiness capped', big.puffiness === SOFT.MAX_PUFFINESS);
}

// --- collides ----------------------------------------------------------------
{
  const A = new SoftBlob(100, 100, 32, 20, 1.2, false);
  // A[8] at x 120 and B[24] at x 121 are 1 px apart, but A[7] and B[25]
  // (1.77 px) come first in the scan, and the first pair found is the one
  const B = new SoftBlob(141, 100, 32, 20, 1.2, false);
  check('collides: the first touching pair in scan order', JSON.stringify(A.collides(B)) === '{"i":7,"j":25}', JSON.stringify(A.collides(B)));
  check('collides: threshold is strict', A.collides(B, 1) === null && A.collides(B, 1.0001) !== null);
  check('collides: apart is null', A.collides(new SoftBlob(200, 100, 32, 20, 1.2, false)) === null);
}

// --- reduction ---------------------------------------------------------------
{
  const R = SOFT.REDUCE;
  const b = new SoftBlob(250, 150, 60, 36, 1.2, true);
  let t = 0, ok = true, steps = 0;
  while (b.points.length > R.TARGET && steps < 200) {
    const before = b.points.length;
    b.step(500, 300, null, t + R.INTERVAL_MS / 2);  // not yet an interval since the last
    if (b.points.length !== before) ok = false;
    t += R.INTERVAL_MS;
    b.step(500, 300, null, t);
    if (b.points.length !== before - 1) ok = false;
    steps++;
  }
  check('reduce: one point per INTERVAL_MS of virtual time', ok && steps === 60 - R.TARGET, steps + ' intervals');
  for (let i = 0; i < 20; i++) { t += R.INTERVAL_MS; b.step(500, 300, null, t); }
  check('reduce: stops at exactly TARGET', b.points.length === R.TARGET, b.points.length);
  check('reduce: chord = circumference / points', b.chord === b.circumference / b.points.length);
  check('reduce: the blob holds together', finite(b) && worstChord(b) < 0.5, 'worst chord ' + (100 * worstChord(b)).toFixed(1) + ' %');

  const u = new SoftBlob(250, 150, 60, 36, 1.2, false);
  u.step(500, 300, null, 1000);
  check('reduce: only locked blobs shed points', u.points.length === 60);

  let spaced = true, sorted = true;
  for (let k = 0; k < 300; k++) {
    const idx = new SoftBlob(0, 0, 60, 36, 1.2, true).selectForRemoval(8);
    for (let a = 0; a < idx.length; a++) {
      if (a > 0 && idx[a] >= idx[a - 1]) sorted = false;
      for (let c = a + 1; c < idx.length; c++) {
        const gap = Math.abs(idx[a] - idx[c]), round = Math.min(gap, 60 - gap);
        if (round < R.MIN_SPACING + 1) spaced = false;
      }
    }
  }
  check('reduce: removals at least MIN_SPACING apart round the ring', spaced);
  check('reduce: indices descending', sorted);

  const small = new SoftBlob(0, 0, 12, 10, 1.2, true);
  let never = true;
  for (let k = 0; k < 50; k++) { small.reduce(0, 100); if (small.points.length < R.MIN_VIABLE) never = false; }
  check('reduce: never below MIN_VIABLE', never && small.points.length === R.MIN_VIABLE, small.points.length);
  check('reduce: at MIN_VIABLE it refuses', small.reduce(0, 1) === false);

  // through the world: the clock is STEP_MS a step, so a 20 ms interval
  // comes round every second step
  const world = new World(500, 300);
  const w60 = new SoftBlob(250, 150, 60, 36, 1.2, true);
  world.blobs.push(w60);
  let ticks = 0;
  while (w60.points.length > R.TARGET && ticks < 500) { world.tick(); ticks++; }
  for (let i = 0; i < 60; i++) world.tick();
  check('reduce: the world clock drives it to TARGET', w60.points.length === R.TARGET, ticks + ' steps');
  check('reduce: two steps a removal at 60 Hz', ticks === 2 * (60 - R.TARGET), ticks);
}

// --- the world's clock -------------------------------------------------------
{
  const world = new World(500, 300);
  world.blobs.push(new SoftBlob(250, 150, 32, 36, 1.2, true));
  check('clock: the first call only sets the clock', world.step(5000) === 0 && world.nowMs === 0);
  check('clock: 50 ms is three steps', world.step(5050) === 3 && near(world.nowMs, 50, 1e-9));
  check('clock: a stall catches up MAX_CATCHUP_MS, no more', world.step(9000) === 6, world.nowMs);
  check('clock: a short frame runs nothing', world.step(9001) === 0);
  check('clock: time going backwards runs nothing', world.step(8000) === 0 && world.step(8010) === 0);

  // a 60 Hz screen with a millisecond of jitter: one step every frame
  const w60 = new World(500, 300);
  let wall = 123.4, every = true;
  w60.step(wall);
  for (let i = 0; i < 600; i++) {
    wall = 123.4 + (i + 1) * 1000 / 60 + (i % 2 ? 1 : -1) * 0.9;
    if (w60.step(wall) !== 1) every = false;
  }
  check('clock: jittery 60 Hz frames run one step each', every);
  const w120 = new World(500, 300);
  let runs = 0;
  w120.step(0);
  for (let i = 1; i <= 1200; i++) runs += w120.step(i * 1000 / 120);
  check('clock: a 120 Hz screen runs at 60', runs === 600, runs);
}

// --- merging through World.step ----------------------------------------------
{
  const world = new World(500, 300);
  const A = world.spawn(20, 200, 150);
  const B = world.spawn(20, 242, 150);  // a 2 px gap: they touch as they fill out
  check('collide: apart at the start', A.collides(B) === null);
  let wall = 1000, mergedOn = -1, seen = null, calls = 0;
  world.step(wall);
  for (let k = 0; k < 30 && mergedOn < 0; k++) {
    wall += 17;
    const steps = world.step(wall);
    calls++;
    if (world.merges.length) { mergedOn = k; seen = world.merges.slice(); }
    if (steps !== 1) break;
  }
  check('collide: they merge within a few steps', mergedOn >= 0 && mergedOn < 10, 'step ' + mergedOn);
  check('collide: one blob left, the lower index', world.blobs.length === 1 && world.blobs[0] === A);
  check('collide: merges held the event that step', seen && seen.length === 1 && seen[0].blob === A &&
    (seen[0].seams.length === 4 || seen[0].seams.length === 3), seen && JSON.stringify(seen[0].seams));
  check('collide: merged ring is n + m - 2', A.points.length === 62, A.points.length);
  world.step(wall + 17);
  check('collide: merges cleared on the next step', world.merges.length === 0);
}
{
  // the centre blob stays blobs[0] and eats; a dragged meal ends the drag
  // settled first: a fresh bubble fills out by 3.5 px in its first step,
  // and collision is point to point, so its skin would jump clean through
  // a small ring that close without either noticing (cicada's too)
  const { world, b: centre } = settledWorld(250, 150, 300);
  const edge = Math.max(...centre.points.map((p) => p.x));
  const near1 = world.spawn(5, edge + 5 + 1, 150);
  const far = world.spawn(5, 60, 60);
  world.grab(edge + 5 + 1 + 5, 150);
  check('eat: drag on the small blob', world.drag && world.drag.blob === near1);
  for (let i = 0; i < 10 && world.blobs.includes(near1); i++) world.tick();
  check('eat: the centre ate it and is still blobs[0]', world.blobs.length === 2 && world.blobs[0] === centre && world.blobs[1] === far);
  check('eat: the merge says what ate and what it ate, at its size', world.merges.length === 1 && world.merges[0].blob === centre && world.merges[0].eaten === near1 && near1.radius === 5);
  check('eat: still locked where it was', centre.locked && centre.lockX === 250 && centre.lockY === 150);
  check('eat: the drag on the eaten blob ended', world.drag === null);
}
{
  // two merges in one step with the later one at a lower index: the right
  // blobs go (cicada spliced in push order and could take the wrong one)
  const world = new World(500, 300);
  const b0 = world.spawn(10, 100, 100);
  const b1 = world.spawn(10, 300, 100);
  const b2 = world.spawn(10, 300 + 21, 100);
  const b3 = world.spawn(10, 400, 250);
  const b4 = world.spawn(10, 100 + 21, 100);
  world.tick();
  check('two merges: b0 ate b4, b1 ate b2, b3 untouched',
    world.blobs.length === 3 && world.blobs[0] === b0 && world.blobs[1] === b1 && world.blobs[2] === b3,
    world.blobs.map((b) => [b0, b1, b2, b3, b4].indexOf(b)).join(' '));
}

// --- spawning ----------------------------------------------------------------
{
  const S = SOFT.SPAWN;
  let outside = true, inside = true, sized = true, count = 0;
  for (let k = 0; k < 2000; k++) {
    const world = new World(500, 300);
    const b = world.spawnRandom();
    if (!b) continue;
    count++;
    const c = b.getCenter();
    if (dist(c, { x: 250, y: 150 }) <= S.EXCLUSION - 1e-9) outside = false;
    if (!(b.radius >= S.MIN_RADIUS && b.radius < S.MAX_RADIUS)) sized = false;
    if (b.points.some((p) => p.x < -1e-9 || p.x > 500 + 1e-9 || p.y < -1e-9 || p.y > 300 + 1e-9)) inside = false;
    if (b.locked || b.points.length !== S.POINTS || b.puffiness !== S.PUFFINESS) sized = false;
  }
  check('spawn: always placed', count === 2000, count);
  check('spawn: never within EXCLUSION of the world centre', outside);
  check('spawn: the whole ring inside the world', inside);
  check('spawn: radius in range, unlocked, cicada defaults', sized);

  const world = new World(500, 300);
  world.blobs.push(new SoftBlob(250, 150, 32, 36, 1.2, true));
  let made = 0;
  for (let k = 0; k < 40; k++) if (world.spawnRandom()) made++;
  check('spawn: respects MAX_BLOBS', world.blobs.length === S.MAX_BLOBS && made === S.MAX_BLOBS - 1, world.blobs.length);

  const tiny = new World(100, 100);
  check('spawn: a world with no room gives up', tiny.spawnRandom() === null && tiny.blobs.length === 0);

  const off = new World(500, 300);
  let clear = true;
  for (let k = 0; k < 500; k++) {
    off.blobs.length = 0;
    const b = off.spawnRandom(120, 80);
    if (b && dist(b.getCenter(), { x: 120, y: 80 }) <= S.EXCLUSION - 1e-9) clear = false;
  }
  check('spawn: exclusion round a given centre', clear);
}

// --- spawning over time, and the drift -----------------------------------------
{
  const S = SOFT.SPAWN;
  const world = new World(500, 300);
  world.blobs.push(new SoftBlob(250, 150, 32, 36, 1.2, true));
  const at = [], spawnRandom = world.spawnRandom.bind(world);
  world.spawnRandom = (...a) => { at.push(world.nowMs); return spawnRandom(...a); };
  for (let i = 0; i < 300; i++) world.tick();
  check('spawning: off, nothing is made', at.length === 0 && world.blobs.length === 1);
  world.spawning = true;
  let most = 0;
  for (let i = 0; i < 60 * 20; i++) { world.tick(); most = Math.max(most, world.blobs.length); }
  const gaps = at.slice(1).map((t, k) => t - at[k]);
  check('spawning: on, one every EVERY_MS', at.length >= 9 && gaps.every((g) => g >= S.EVERY_MS - 1e-6 && g < S.EVERY_MS + SOFT.STEP_MS + 1e-6), at.length + ' in 20 s');
  check('spawning: never past MAX_BLOBS', most <= S.MAX_BLOBS && most > 1, most);

  const drift = new World(500, 300);
  let ranged = true, rigid = true;
  for (let k = 0; k < 200; k++) {
    drift.blobs.length = 0;
    const b = drift.spawnRandom();
    const v = b.points.map((q) => ({ x: q.x - q.px, y: q.y - q.py })), m = Math.hypot(v[0].x, v[0].y);
    if (m < S.DRIFT[0] - 1e-9 || m > S.DRIFT[1] + 1e-9) ranged = false;
    if (v.some((u) => !near(u.x, v[0].x, 1e-9) || !near(u.y, v[0].y, 1e-9))) rigid = false;
  }
  check('drift: a spawned blob comes in moving, DRIFT px a step', ranged);
  check('drift: the whole ring at one velocity', rigid);
  drift.blobs.length = 0;
  const b = drift.spawnRandom(), c0 = b.getCenter();
  for (let i = 0; i < 600; i++) drift.tick();
  const c1 = b.getCenter(), p = b.points[0];
  check('drift: it drifts a little and comes to rest', dist(c0, c1) > 3 && dist(c0, c1) < 40 && Math.hypot(p.x - p.px, p.y - p.py) < 0.01,
    'moved ' + dist(c0, c1).toFixed(1) + ' px');
}

// --- shrinking back -----------------------------------------------------------
{
  const { world, b: centre } = settledWorld(250, 150, 300);
  check('shrink: a blob that has not eaten keeps its area exactly', centre.area === centre.homeArea);
  const home = centre.homeArea, r0 = centre.radius;
  const edge = Math.max(...centre.points.map((q) => q.x));
  const meal = world.spawn(10, edge + 10 + 1, 150);
  for (let i = 0; i < 10 && world.blobs.includes(meal); i++) world.tick();
  check('shrink: the meal is eaten and the bubble grows', world.blobs.length === 1 && centre.area > home * 1.05, (centre.area / home).toFixed(3));
  let falling = true, last = centre.area;
  for (let i = 0; i < 60; i++) { world.tick(); if (centre.area > last) falling = false; last = centre.area; }
  check('shrink: back to its 32 points within a second', centre.points.length === SOFT.REDUCE.TARGET, centre.points.length);
  for (let i = 0; i < 60 * 30; i++) { world.tick(); if (centre.area > last) falling = false; last = centre.area; }
  check('shrink: the area only ever falls', falling);
  check('shrink: back to its own size in half a minute', near(centre.area, home, home * 0.005) && near(centre.radius, r0, r0 * 0.005),
    (centre.area / home).toFixed(4));
  check('shrink: no NaN', finite(centre));
}

// --- colour pulses -----------------------------------------------------------
{
  const P = SOFT.PULSE;
  const a = new SoftBlob(100, 100, 32, 20, 1.2), b = new SoftBlob(142, 100, 32, 20, 1.2);
  check('pulse: none on a fresh blob', a.pulses.length === 0 && a.points.every((_, i) => a.pulseAt(i) === null));
  const seams = a.merge(b, 8, 24);
  check('pulse: two set off from every seam, one each way', a.pulses.length === 2 * seams.length &&
    seams.every((k) => a.pulses.some((q) => q.start === k && q.dir === 1) && a.pulses.some((q) => q.start === k && q.dir === -1)));
  check('pulse: a seam lit full as they set off', seams.every((k) => a.pulseAt(k).strength === 1));

  // one pulse alone, stepped until its head has gone twelve points
  a.pulses = [{ start: 10, dir: 1, travelled: 0, age: 0, offset: 0.25 }];
  const steps = Math.round(12 / P.SPEED);
  for (let k = 0; k < steps; k++) a.step(1000, 1000, null, 0);
  const head = a.pulseAt(22), tail = a.pulseAt(10);
  check('pulse: its head moves SPEED points a step, lit as its life allows, nothing ahead of it',
    head && near(head.strength, 1 - steps / P.LIFE, 1e-12) && a.pulseAt(23) === null, head && head.strength);
  check('pulse: its trail fades behind it, nothing behind its start',
    tail && near(tail.strength, (1 - 12 / P.TRAIL) * (1 - steps / P.LIFE), 1e-12) && a.pulseAt(9) === null);
  check('pulse: the colour goes round its cycle with the distance from its start',
    near(head.along, (12 / P.CYCLE + 0.25) % 1, 1e-12) && near(tail.along, 0.25, 1e-12));
  a.removePoints([5, 2]);
  check('pulse: points taken from under its start bring the start down', a.pulses[0].start === 8);
  for (let k = steps; k < P.LIFE; k++) a.step(1000, 1000, null, 0);
  check('pulse: gone LIFE steps after it set off', a.pulses.length === 0);

  // the other way round
  a.pulses = [{ start: 10, dir: -1, travelled: 0, age: 0, offset: 0 }];
  for (let k = 0; k < Math.round(5 / P.SPEED); k++) a.step(1000, 1000, null, 0);
  check('pulse: one going the other way lights the points below its start', a.pulseAt(5) && a.pulseAt(10) && a.pulseAt(4) === null && a.pulseAt(11) === null);

  // a merge lets the other's points in at i: a pulse past i keeps its point
  const c = new SoftBlob(100, 100, 32, 20, 1.2), d = new SoftBlob(142, 100, 32, 20, 1.2);
  const p3 = c.points[3], p20 = c.points[20];
  c.pulses = [{ start: 3, dir: 1, travelled: 4, age: 4, offset: 0 }, { start: 20, dir: -1, travelled: 4, age: 4, offset: 0 }];
  c.merge(d, 8, 24);
  check('pulse: one already going keeps its point through a merge', c.points[c.pulses[0].start] === p3 && c.points[c.pulses[1].start] === p20);
}

// --- a small blob towed --------------------------------------------------------
{
  const world = new World(1260, 383);
  const centre = new SoftBlob(630, 190, 32, 38, 1.2, true);
  world.blobs.push(centre);
  for (let i = 0; i < 60; i++) world.tick();
  const b = world.spawn(18, 380, 190);
  for (let i = 0; i < 30; i++) world.tick();
  const c0 = b.getCenter();
  world.grab(c0.x + 18, c0.y);
  const d = world.drag;
  check('tow: a small blob is taken as any is, five points', d.blob === b && d.points.length === 5 &&
    d.points.map((q) => q.force).join(' ') === '1 0.6 0.6 0.3 0.3');
  // the pointer kept 60 px ahead of the grabbed point, toward the centre
  let s = 0, held = true;
  for (; s < 60 * 20 && world.blobs.includes(b); s++) {
    world.pointer(d.points[0].point.x + 60, 190);
    world.tick();
    if (world.blobs.includes(b) && world.drag !== d) held = false;
  }
  check('tow: kept within reach, it is towed onto the bubble and eaten', held && !world.blobs.includes(b), (s / 60).toFixed(1) + ' s');
}

// --- nearestTo ---------------------------------------------------------------
{
  const world = new World(500, 300);
  const centre = new SoftBlob(250, 150, 32, 36, 1.2, true);
  world.blobs.push(centre);
  check('nearest: alone is null', world.nearestTo(centre) === null);
  const a = world.spawn(4, 250 + 100, 150);
  const big = world.spawn(30, 250, 150 + 110);
  const r = world.nearestTo(centre);
  check('nearest: the nearest centre', r.blob === a && near(r.dist, 100, 1e-9), r.dist);
  check('nearest: edgeDist is the smallest gap of all', near(r.edgeDist, 110 - 36 - 30, 1e-9), r.edgeDist);
}

// --- determinism -------------------------------------------------------------
{
  function run() {
    const world = new World(500, 300);
    world.blobs.push(new SoftBlob(250, 150, 32, 36, 1.2, true));
    world.spawn(6, 60, 60);
    world.spawn(9, 420, 230);
    world.grab(66, 60);
    let wall = 0;
    world.step(wall);
    for (let i = 0; i < 300; i++) {
      wall += 7 + (i % 5) * 3;  // uneven frames, the same in both runs
      world.pointer(66 + i * 0.1, 60 + Math.sin(i / 20) * 10);
      world.step(wall);
    }
    return world;
  }
  randomForbidden = true;
  let w1, w2, threw = null;
  try { w1 = run(); w2 = run(); } catch (e) { threw = e.message; }
  randomForbidden = false;
  check('determinism: no Math.random without reduction', threw === null, threw);
  if (w1 && w2) {
    let same = w1.blobs.length === w2.blobs.length && w1.nowMs === w2.nowMs;
    for (let k = 0; same && k < w1.blobs.length; k++) {
      const p = w1.blobs[k].points, q = w2.blobs[k].points;
      if (p.length !== q.length) same = false;
      for (let i = 0; same && i < p.length; i++) {
        if (p[i].x !== q[i].x || p[i].y !== q[i].y || p[i].px !== q[i].px || p[i].py !== q[i].py) same = false;
      }
    }
    check('determinism: identical positions, bit for bit', same);
    check('determinism: the drag was live', w1.drag !== null);
  }
}

// --- moveLockTo --------------------------------------------------------------
{
  const { world, b } = settledWorld(100, 100, 100);
  const c0 = b.getCenter();
  const vel = b.points.map((p) => [p.x - p.px, p.y - p.py]);
  b.moveLockTo(150, 120);
  const c1 = b.getCenter();
  check('moveLockTo: the lock moves', b.lockX === 150 && b.lockY === 120);
  check('moveLockTo: the centre moves with it', near(c1.x - c0.x, 50, 1e-9) && near(c1.y - c0.y, 20, 1e-9));
  check('moveLockTo: no velocity added', b.points.every((p, i) => near(p.x - p.px, vel[i][0], 1e-9) && near(p.y - p.py, vel[i][1], 1e-9)));
  for (let i = 0; i < 100; i++) world.tick();
  check('moveLockTo: it stays put afterwards', dist(b.getCenter(), { x: 150, y: 120 }) <= 0.5);
  const u = new SoftBlob(10, 10, 16, 5, 1.2, false);
  u.moveLockTo(40, 30);
  check('moveLockTo: an unlocked blob moves its centre, no lock', near(u.getCenter().x, 40, 1e-9) &&
    near(u.getCenter().y, 30, 1e-9) && u.lockX === null && u.locked === false);
}

// --- against cicada, bit for bit ---------------------------------------------
// cicada's Vector2D, VerletPoint and Blob.update (pulses aside), ported line
// for line with its config numbers, stepped beside SoftBlob.step: every
// coordinate must match exactly, drag and walls included
{
  class V {
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }
    add(v) { this.x += v.x; this.y += v.y; return this; }
    mult(n) { this.x *= n; this.y *= n; return this; }
    div(n) { if (n !== 0) { this.x /= n; this.y /= n; } return this; }
    mag() { return Math.sqrt(this.x * this.x + this.y * this.y); }
    normalize() { const m = this.mag(); if (m > 0) this.div(m); return this; }
    setMag(len) { this.normalize(); this.mult(len); return this; }
    rotate(a) {
      const cos = Math.cos(a), sin = Math.sin(a);
      const nx = this.x * cos - this.y * sin, ny = this.x * sin + this.y * cos;
      this.x = nx; this.y = ny; return this;
    }
    copy() { return new V(this.x, this.y); }
    static add(a, b) { return new V(a.x + b.x, a.y + b.y); }
    static sub(a, b) { return new V(a.x - b.x, a.y - b.y); }
  }
  class VP {
    constructor(pos) { this.pos = pos.copy(); this.ppos = pos.copy(); this.displacement = new V(); this.displacementWeight = 0; }
    verletIntegrate(d = 0.99) { const t = this.pos.copy(); const vel = V.sub(this.pos, this.ppos).mult(d); this.pos.add(vel); this.ppos = t; }
    applyGravity(g = 0) { this.pos.y += g; }
    accumulateDisplacement(o) { this.displacement.add(o); this.displacementWeight += 1; }
    applyDisplacement() {
      if (this.displacementWeight > 0) {
        this.displacement.div(this.displacementWeight); this.pos.add(this.displacement);
        this.displacement = new V(); this.displacementWeight = 0;
      }
    }
    keepInBounds(w, h) {
      if (this.pos.x < 0) { this.pos.x = 0; this.ppos.x = this.pos.x; } else if (this.pos.x > w) { this.pos.x = w; this.ppos.x = this.pos.x; }
      if (this.pos.y < 0) { this.pos.y = 0; this.ppos.y = this.pos.y; } else if (this.pos.y > h) { this.pos.y = h; this.ppos.y = this.pos.y; }
    }
    attractToPosition(t, f) { const d = V.sub(t, this.pos); d.mult(f); this.pos.add(d); }
  }
  class CB {
    constructor(origin, n, radius, puff, locked) {
      this.area = Math.PI * radius * radius * puff;
      this.circumference = 2 * Math.PI * radius;
      this.chordLength = this.circumference / n;
      this.isLocked = locked;
      this.lockedPosition = locked ? origin.copy() : null;
      this.points = [];
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i / n) - Math.PI / 2;
        this.points.push(new VP(V.add(origin, new V(Math.cos(a) * radius, Math.sin(a) * radius))));
      }
    }
    getArea() {
      let area = 0;
      for (let i = 0; i < this.points.length; i++) {
        const cur = this.points[i].pos, next = this.points[(i + 1) % this.points.length].pos;
        area += (cur.x - next.x) * (cur.y + next.y) / 2;
      }
      return Math.abs(area);
    }
    getCenter() { const c = new V(); for (const p of this.points) c.add(p.pos); c.div(this.points.length); return c; }
    update(w, h, iterations, dragged, dragPos) {
      for (const p of this.points) { p.verletIntegrate(); p.applyGravity(); }
      for (let j = 0; j < iterations; j++) {
        for (let i = 0; i < this.points.length; i++) {
          const cur = this.points[i], next = this.points[(i + 1) % this.points.length];
          const diff = V.sub(next.pos, cur.pos), d = diff.mag(), error = d - this.chordLength;
          if (Math.abs(error) > 0.01) {
            const offset = diff.copy().setMag(error * 0.5), neg = offset.copy().mult(-1);
            cur.accumulateDisplacement(offset); next.accumulateDisplacement(neg);
          }
        }
        const offset = (this.area - this.getArea()) / this.circumference;
        for (let i = 0; i < this.points.length; i++) {
          const prev = this.points[i === 0 ? this.points.length - 1 : i - 1], cur = this.points[i];
          const next = this.points[(i + 1) % this.points.length];
          cur.accumulateDisplacement(V.sub(next.pos, prev.pos).copy().rotate(-Math.PI / 2).setMag(offset));
        }
        for (const p of this.points) p.applyDisplacement();
        // cicada's config force, CONFIG.ATTRACTION_FORCE
        if (dragged && dragPos) for (const d of dragged) d.point.attractToPosition(dragPos, 0.0001 * d.force);
        for (const p of this.points) p.keepInBounds(w, h);
      }
      if (this.isLocked && this.lockedPosition) {
        const diff = V.sub(this.lockedPosition, this.getCenter());
        if (diff.mag() > 0.1) {
          const offset = diff.copy().mult(0.1);
          for (const p of this.points) {
            p.pos.add(offset);
            p.ppos = V.sub(p.pos, V.sub(p.pos, p.ppos).copy().mult(0.92));
          }
        }
      }
    }
  }

  // the bubble dragged hard about, and a small blob dragged into a corner
  const cases = [[100, 100, 32, 36, 1.2, true, 8, [160, 130]], [8, 293, 32, 10, 1.2, false, 20, [-40, 340]]];
  let same = true, where = '', walls = 0;
  for (const [x, y, n, r, puff, locked, at, to] of cases) {
    const mine = new SoftBlob(x, y, n, r, puff, locked), ref = new CB(new V(x, y), n, r, puff, locked);
    const ix = [at, (at - 1 + n) % n, (at + 1) % n, (at - 2 + n) % n, (at + 2) % n], f = [1, 0.6, 0.6, 0.3, 0.3];
    const drag = { points: ix.map((k, q) => ({ point: mine.points[k], force: f[q] })), x: 0, y: 0 };
    const refDrag = ix.map((k, q) => ({ point: ref.points[k], force: f[q] }));
    for (let s = 0; s < 400 && same; s++) {
      const on = s >= 30 && s < 300;  // rest, then a drag that wanders, then let go
      drag.x = to[0] + 20 * Math.sin(s / 17); drag.y = to[1] + 20 * Math.cos(s / 23);
      mine.step(500, 300, on ? [drag] : null, 0);
      ref.update(500, 300, 10, on ? refDrag : null, on ? new V(drag.x, drag.y) : null);
      if (mine.points.some((p) => p.x === 0 || p.y === 300)) walls++;
      for (let i = 0; i < n; i++) {
        const a = mine.points[i], b = ref.points[i];
        if (a.x !== b.pos.x || a.y !== b.pos.y || a.px !== b.ppos.x || a.py !== b.ppos.y) {
          same = false; where = 'blob at ' + x + ', ' + y + ' step ' + s + ' point ' + i;
          break;
        }
      }
    }
  }
  check('cicada: SoftBlob.step matches Blob.update bit for bit, drag and walls too', same && walls > 50, where || walls + ' steps on a wall');
}

// --- points ------------------------------------------------------------------
{
  const p = new Point(10, 10);
  p.px = 8; p.py = 10;
  p.integrate();
  check('point: verlet keeps damped velocity', near(p.x, 11.98, 1e-12) && p.px === 10);
  p.accumulate(1, 0); p.accumulate(3, 2); p.applyDisplacement();
  check('point: displacements average', near(p.x, 13.98, 1e-12) && near(p.y, 11, 1e-12) && p.dw === 0);
  p.x = -5; p.px = -2; p.keepIn(100, 100);
  check('point: a wall stops it dead', p.x === 0 && p.px === 0);
  p.attract(10, 11, 0.5);
  check('point: attract moves f of the way', p.x === 5 && p.y === 11);
}

// the sandbox's Math.random is the one the script saw, so forbidding it
// above meant something
check('Math.random came through the sandbox', randoms > 0, randoms + ' calls');

// --- the world's drag force ------------------------------------------------------
// the pointer's pull is as hard as its world's drag force, cicada's unless
// set: four times it, a blob held the same way for the same second comes
// further
{
  const moved = (scale) => {
    const w = new World(600, 300), b = w.spawn(12, 150, 150);
    w.dragForce = SOFT.DRAG.FORCE * scale;
    w.grab(150 + 12, 150);
    w.pointer(200, 150);
    for (let k = 0; k < 60; k++) w.tick();
    return b.getCenter().x - 150;
  };
  const w = new World(600, 300);
  check('drag force: cicada\'s unless set', w.dragForce === SOFT.DRAG.FORCE);
  const one = moved(1), four = moved(4);
  check('drag force: four times as hard tows a held blob further in a second', four > one * 1.5 && one > 0, one.toFixed(2) + ' px, then ' + four.toFixed(2) + ' px');
}

// --- the world's own spawning ------------------------------------------------------
// a world spawns every spawnMs up to maxBlobs, SPAWN's unless set: a
// quarter the wait spawns about four times as many, and a higher limit
// holds more
{
  const count = (ms, most, secs) => {
    const w = new World(1200, 300);
    w.blobs.push(new SoftBlob(600, 150, 32, 38, 1.2, true));
    w.spawnMs = ms;
    w.maxBlobs = most;
    w.spawning = true;
    // spawns counted as they are made: blobs that touch merge, so the
    // count on screen would miss some
    let made = 0, peak = 0;
    const spawn = w.spawnRandom.bind(w);
    w.spawnRandom = (...a) => { const b = spawn(...a); if (b) made++; return b; };
    for (let k = 0; k < secs * 60; k++) {
      w.tick();
      peak = Math.max(peak, w.blobs.length);
    }
    return { made, peak };
  };
  const S = SOFT.SPAWN, w = new World(100, 100);
  check('spawning: SPAWN\'s wait and limit unless set', w.spawnMs === S.EVERY_MS && w.maxBlobs === S.MAX_BLOBS);
  const slow = count(S.EVERY_MS, 1000, 30), fast = count(S.EVERY_MS / 4, 1000, 30);
  check('spawning: a quarter the wait spawns about four times as many', fast.made >= 3.5 * slow.made && fast.made <= 4.5 * slow.made, slow.made + ' then ' + fast.made + ' in 30 s');
  const more = count(100, S.MAX_BLOBS + 5, 10);
  check('spawning: a higher limit holds more, and no more', more.peak === S.MAX_BLOBS + 5, more.peak);
}

console.log(failures ? failures + ' failed' : 'all passed');
process.exit(failures ? 1 : 0);
