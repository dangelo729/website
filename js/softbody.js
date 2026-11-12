// --- soft bodies ---------------------------------------------------------------
// cicada's blobs, ported. a blob is a ring of verlet points: each pair of
// neighbours is held to a fixed chord, and the ring as a whole is pushed
// out toward a target area a little larger than its circumference can
// enclose, so it always sits slightly stretched, like a skin with air in it.
// a locked blob is eased back to its lock every step, and back to its own
// size after it has eaten; a dragged one has a few points pulled toward
// whatever holds it, the pointer or a hand (js/hands.js), as hard as its
// world's drag force. blobs that touch merge into one, and colour pulses
// run round the skin from where they met; a world that is spawning makes a
// small one now and then.
// everything is in world px and per 60 Hz step: the world runs whole steps
// from wall time, so a 120 Hz screen does not run it twice as fast, and it
// keeps its own clock in ms for anything timed (point reduction).

const SOFT = {
  STEP_MS: 1000 / 60, MAX_CATCHUP_MS: 100,
  DAMPING: 0.99, GRAVITY: 0, ITERATIONS: 10,
  DISTANCE_ERROR_THRESHOLD: 0.01, DISTANCE_CORRECTION_FACTOR: 0.5,
  // a ring that has just eaten is lobed, its skin many times as long as
  // its circumference: past LOBED times, the area pass spreads the missing
  // area over the skin's length over LOBED, not the circumference, or its
  // push would overshoot and swing wider every pass
  LOBED: 3,
  LOCK_RATE: 0.1, LOCK_DAMPING: 0.92, LOCK_DIFF_THRESHOLD: 0.1,
  COLLISION_THRESHOLD: 1.86, MERGE_PUFF_SHARE: 0.3, MAX_PUFFINESS: 2.5,
  // a locked blob's points past TARGET are shed every INTERVAL_MS, SHARE
  // of them a step for the time since it last shed and never fewer than
  // RATE, each removal MIN_SPACING from the next round the ring and the
  // ring never under MIN_VIABLE
  REDUCE: { ENABLED: true, TARGET: 32, RATE: 1, SHARE: 0.03, INTERVAL_MS: 20, MIN_SPACING: 2, MIN_VIABLE: 8 },
  // the pull on a held point, a fraction of its distance to the pointer
  // each iteration, cicada's as it runs: a pull barely moves the locked
  // bubble's skin, and a small blob comes after the pointer slowly,
  // gathering speed, towed across a room in several seconds
  DRAG: { GRAB: 40, BREAKAWAY: 80, FORCE: 0.0001, WEIGHTS: [1.0, 0.6, 0.3] },  // centre, first, second neighbours
  // three times cicada's sizes, fewer and slower: one every EVERY_MS
  // while the world is spawning, at most MAX_BLOBS with the centre one
  // (a world's own spawnMs and maxBlobs, these unless set),
  // none within EXCLUSION of the middle or CLEAR px of as far as another
  // blob's skin reaches, each set drifting at DRIFT px a
  // step, which the damping bleeds off over a few seconds
  SPAWN: { MIN_RADIUS: 6, MAX_RADIUS: 30, EXCLUSION: 110, CLEAR: 4, MAX_BLOBS: 7, POINTS: 32, PUFFINESS: 1.2, EVERY_MS: 2000, DRIFT: [0.1, 0.3] },
  // a locked blob grown by eating eases back to the area and puffiness it
  // was made with, at RATE a second
  SHRINK: { RATE: 0.2 },
  // and what it has past a circle's SHARE of its world's shorter side
  // across eases away at RATE a second, so however much it eats it comes
  // back to what fits its world
  FIT: { SHARE: 0.8, RATE: 5 },
  // cicada's colour pulse at half its speed and for longer: its head
  // moves SPEED points a step, a lap of the bubble in about a second, it
  // lights TRAIL points behind it, its colour goes once round its cycle
  // every CYCLE points, and it is gone LIFE steps (two and a half
  // seconds) after it set off
  PULSE: { SPEED: 0.5, TRAIL: 30, CYCLE: 60, LIFE: 150 },
};

// a verlet point: its velocity is where it is less where it was. the
// constraints of one pass pile their nudges into (dx, dy) and are averaged
// and applied together, so no constraint gets the last word by running last.
class Point {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.px = x; this.py = y;
    this.dx = 0; this.dy = 0; this.dw = 0;
  }

  integrate(damping = SOFT.DAMPING) {
    const vx = (this.x - this.px) * damping, vy = (this.y - this.py) * damping;
    this.px = this.x; this.py = this.y;
    this.x += vx; this.y += vy;
  }

  applyGravity(g = SOFT.GRAVITY) {
    this.y += g;
  }

  accumulate(ox, oy) {
    this.dx += ox; this.dy += oy;
    this.dw += 1;
  }

  applyDisplacement() {
    if (this.dw > 0) {
      this.x += this.dx / this.dw;
      this.y += this.dy / this.dw;
      this.dx = 0; this.dy = 0; this.dw = 0;
    }
  }

  // the walls stop a point dead: its previous position comes with it, so
  // it does not bounce back out with the speed it hit at
  keepIn(w, h) {
    if (this.x < 0) { this.x = 0; this.px = 0; }
    else if (this.x > w) { this.x = w; this.px = w; }
    if (this.y < 0) { this.y = 0; this.py = 0; }
    else if (this.y > h) { this.y = h; this.py = h; }
  }

  // a nudge of f of the way to the target; inside the verlet step it acts
  // as a spring, since the nudge becomes velocity
  attract(tx, ty, f) {
    this.x += (tx - this.x) * f;
    this.y += (ty - this.y) * f;
  }
}

// the ring starts on a circle at the top (-PI/2) and runs clockwise on
// screen, so the area pass's quarter turn of each secant points outward.
// not Blob: a top-level class in a classic script would shadow the
// browser's own window.Blob for every script on the page.
class SoftBlob {
  constructor(cx, cy, n, radius, puffiness, locked = false) {
    this.radius = radius;
    this.puffiness = puffiness;
    this.area = Math.PI * radius * radius * puffiness;
    this.circumference = 2 * Math.PI * radius;
    this.chord = this.circumference / n;
    this.homeArea = this.area;      // its own size, which a locked blob shrinks back to
    this.homePuffiness = puffiness;
    this.locked = locked;
    this.lockX = locked ? cx : null;
    this.lockY = locked ? cy : null;
    this.lastReduceMs = 0;
    this.pulses = [];   // { start, dir, travelled, age, offset }: colour running round the ring (pulseAt)
    this.points = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i / n) - Math.PI / 2;
      this.points.push(new Point(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius));
    }
  }

  // one 60 Hz step, cicada's Blob.update in its order. drags are what hold
  // it, each { points: [{ point, force }], x, y }, or null for none; each
  // held point is pulled force times its own weight of the way to its
  // drag's x, y each iteration, all the way at the most. tMs is the
  // world's clock.
  step(w, h, drags, tMs, force = SOFT.DRAG.FORCE) {
    // each pulse ages a step and moves on SPEED points, or, LIFE steps
    // old, goes
    for (let k = this.pulses.length - 1; k >= 0; k--) {
      const p = this.pulses[k];
      if (++p.age >= SOFT.PULSE.LIFE) this.pulses.splice(k, 1);
      else p.travelled += SOFT.PULSE.SPEED;
    }

    const pts = this.points;
    for (const p of pts) { p.integrate(); p.applyGravity(); }

    // cicada turned each secant with a -PI/2 rotation; the same cos and sin
    // keep the sums the same down to the last bit
    const rc = Math.cos(-Math.PI / 2), rs = Math.sin(-Math.PI / 2);
    for (let it = 0; it < SOFT.ITERATIONS; it++) {
      const n = pts.length;

      // chords: each pair splits its error, too long pulls in, too short
      // pushes apart. a tiny error is left alone so a ring at rest is still.
      // length is the skin's, as it stands
      let length = 0;
      for (let i = 0; i < n; i++) {
        const cur = pts[i], next = pts[(i + 1) % n];
        const dx = next.x - cur.x, dy = next.y - cur.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        length += dist;
        const error = dist - this.chord;
        if (Math.abs(error) > SOFT.DISTANCE_ERROR_THRESHOLD) {
          const c = error * SOFT.DISTANCE_CORRECTION_FACTOR;
          const ux = dist > 0 ? dx / dist : dx, uy = dist > 0 ? dy / dist : dy;
          cur.accumulate(ux * c, uy * c);
          next.accumulate(-(ux * c), -(uy * c));
        }
      }

      // area: the missing area spread over the circumference, or over the
      // skin's length over LOBED if that is more, is how far every point
      // moves along its normal (the secant across it, turned)
      const offset = (this.area - this.getArea()) / Math.max(this.circumference, length / SOFT.LOBED);
      for (let i = 0; i < n; i++) {
        const prev = pts[i === 0 ? n - 1 : i - 1], cur = pts[i], next = pts[(i + 1) % n];
        const sx = next.x - prev.x, sy = next.y - prev.y;
        const nx = sx * rc - sy * rs, ny = sx * rs + sy * rc;
        const m = Math.sqrt(nx * nx + ny * ny);
        const ux = m > 0 ? nx / m : nx, uy = m > 0 ? ny / m : ny;
        cur.accumulate(ux * offset, uy * offset);
      }

      for (const p of pts) p.applyDisplacement();

      if (drags) {
        for (const drag of drags) for (const d of drag.points) d.point.attract(drag.x, drag.y, Math.min(force * d.force, 1));
      }

      for (const p of pts) p.keepIn(w, h);
    }

    // the lock eases the whole ring a tenth of the way home and bleeds off
    // its velocity, so a locked blob wobbles back instead of springing past
    if (this.locked && this.lockX !== null) {
      const c = this.getCenter();
      const dx = this.lockX - c.x, dy = this.lockY - c.y;
      if (Math.sqrt(dx * dx + dy * dy) > SOFT.LOCK_DIFF_THRESHOLD) {
        const ox = dx * SOFT.LOCK_RATE, oy = dy * SOFT.LOCK_RATE;
        for (const p of pts) {
          p.x += ox; p.y += oy;
          p.px = p.x - (p.x - p.px) * SOFT.LOCK_DAMPING;
          p.py = p.y - (p.y - p.py) * SOFT.LOCK_DAMPING;
        }
      }
    }

    // every merge adds points; a locked blob sheds them back toward TARGET
    // by the house approach, SHARE of the points past it a step, so the
    // more it has eaten the faster it sheds and it cannot grow without
    // bound by eating, and RATE at a time at the least, so it gets there
    const R = SOFT.REDUCE;
    if (this.locked && R.ENABLED && tMs - this.lastReduceMs >= R.INTERVAL_MS) {
      const over = this.points.length - R.TARGET;
      if (over > 0) {
        const share = 1 - Math.pow(1 - R.SHARE, (tMs - this.lastReduceMs) / SOFT.STEP_MS);
        this.reduce(R.TARGET, Math.max(R.RATE, Math.round(over * share)));
      }
      this.lastReduceMs = tMs;
    }

    // and it eases back to its own size, the skin's chords shortening as
    // its area and air come down
    if (this.locked && this.area !== this.homeArea) this.shrink();
  }

  // one step of the area and the puffiness toward home, the exponential
  // approach at SHRINK.RATE; within a hair of it, home exactly
  shrink() {
    const k = 1 - Math.exp(-SOFT.SHRINK.RATE * SOFT.STEP_MS / 1000);
    this.area += (this.homeArea - this.area) * k;
    this.puffiness += (this.homePuffiness - this.puffiness) * k;
    if (Math.abs(this.area - this.homeArea) < 1e-6 * this.homeArea) {
      this.area = this.homeArea;
      this.puffiness = this.homePuffiness;
    }
    this.radius = Math.sqrt(this.area / (Math.PI * this.puffiness));
    this.circumference = 2 * Math.PI * this.radius;
    this.chord = this.circumference / this.points.length;
  }

  // one step of its area down toward most, if it is over, the
  // exponential approach at FIT.RATE, the skin's chords shortening with
  // it; within a hair of most, most exactly, and never under its own size
  fit(most) {
    most = Math.max(most, this.homeArea);
    if (this.area <= most) return;
    this.area += (most - this.area) * (1 - Math.exp(-SOFT.FIT.RATE * SOFT.STEP_MS / 1000));
    if (this.area - most < 1e-6 * most) this.area = most;
    this.radius = Math.sqrt(this.area / (Math.PI * this.puffiness));
    this.circumference = 2 * Math.PI * this.radius;
    this.chord = this.circumference / this.points.length;
  }

  // how far its skin reaches from its centre
  reach() {
    const c = this.getCenter();
    let most = 0;
    for (const p of this.points) {
      const dx = p.x - c.x, dy = p.y - c.y;
      most = Math.max(most, Math.sqrt(dx * dx + dy * dy));
    }
    return most;
  }

  // shoelace
  getArea() {
    const pts = this.points, n = pts.length;
    let area = 0;
    for (let i = 0; i < n; i++) {
      const cur = pts[i], next = pts[(i + 1) % n];
      area += (cur.x - next.x) * (cur.y + next.y) / 2;
    }
    return Math.abs(area);
  }

  // the mean of the points, not the area centroid: cheap, and what the
  // lock has always aimed at
  getCenter() {
    let x = 0, y = 0;
    for (const p of this.points) { x += p.x; y += p.y; }
    return { x: x / this.points.length, y: y / this.points.length };
  }

  closest(x, y) {
    let point = null, index = -1, dist = Infinity;
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      const dx = p.x - x, dy = p.y - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < dist) { dist = d; point = p; index = i; }
    }
    return { point, index, dist };
  }

  // the point at index, then count neighbours each side, left before right,
  // with falling weights: a drag pulls a soft bump, not a single spike
  neighbors(index, count) {
    const n = this.points.length, W = SOFT.DRAG.WEIGHTS;
    const out = [{ point: this.points[index], force: W[0] }];
    for (let i = 1; i <= count; i++) {
      const force = i === 1 ? W[1] : W[2];
      out.push({ point: this.points[(index - i + n) % n], force });
      out.push({ point: this.points[(index + i) % n], force });
    }
    return out;
  }

  // the smallest box round its points
  bounds() {
    const pts = this.points;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
    return { x0, y0, x1, y1 };
  }

  // the first pair of points closer than threshold, scanning this ring
  // first. rings whose boxes are more than threshold apart have no such
  // pair, so their points are never compared
  collides(other, threshold = SOFT.COLLISION_THRESHOLD) {
    const a = this.bounds(), b = other.bounds();
    if (a.x1 + threshold < b.x0 || b.x1 + threshold < a.x0 ||
        a.y1 + threshold < b.y0 || b.y1 + threshold < a.y0) return null;
    for (let i = 0; i < this.points.length; i++) {
      const a = this.points[i];
      for (let j = 0; j < other.points.length; j++) {
        const b = other.points[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        if (Math.sqrt(dx * dx + dy * dy) < threshold) return { i, j };
      }
    }
    return null;
  }

  // the two touching points are dropped and the rings spliced through the
  // gap: this ring up to i, the other all the way round from j + 1 back to
  // j, then the rest of this ring. areas add; a bigger blob gets a little
  // puffier so it does not go slack as it grows. returns the seam indices,
  // the points whose neighbours changed (three when the seam meets an end).
  merge(other, i, j) {
    const n = this.points.length, m = other.points.length;
    const seams = [], pts = [];
    for (let k = 0; k < i; k++) pts.push(this.points[k]);
    if (i > 0) seams.push(pts.length - 1);
    seams.push(pts.length);
    let last = pts.length;
    for (let k = (j + 1) % m; k !== j; k = (k + 1) % m) {
      pts.push(other.points[k]);
      last = pts.length - 1;
    }
    seams.push(last);
    // cicada wrapped this index and so, when i was its last point, laid
    // the whole ring in a second time; unwrapped, nothing follows
    if (i + 1 < n) seams.push(pts.length);
    for (let k = i + 1; k < n; k++) pts.push(this.points[k]);
    this.points = pts;

    // a pulse already going round this ring keeps its place in it, past
    // the other's points let in at i; from every seam two more set off,
    // one each way, each its own way into the colours' cycle
    for (const p of this.pulses) if (p.start > i) p.start += m - 2;
    for (const k of seams) {
      for (const dir of [1, -1]) this.pulses.push({ start: k, dir, travelled: 0, age: 0, offset: Math.random() });
    }

    const total = this.area + other.area;
    const size = Math.sqrt(total / this.area);
    const boost = 1 + (size - 1) * SOFT.MERGE_PUFF_SHARE;
    const puff = Math.min(this.puffiness * boost, SOFT.MAX_PUFFINESS);
    const r = Math.sqrt(total / (Math.PI * puff));
    this.radius = r;
    this.puffiness = puff;
    this.area = total;
    this.circumference = 2 * Math.PI * r;
    this.chord = this.circumference / this.points.length;

    // whatever eats the centre blob becomes the centre blob
    if (other.locked && other.lockX !== null) {
      this.locked = true;
      this.lockX = other.lockX;
      this.lockY = other.lockY;
      this.homeArea = other.homeArea;
      this.homePuffiness = other.homePuffiness;
    }
    return seams;
  }

  // drop up to rate points, never below target or MIN_VIABLE
  reduce(target, rate = 1) {
    const MIN = SOFT.REDUCE.MIN_VIABLE, n = this.points.length;
    if (n <= target || n <= MIN) return false;
    const count = Math.min(rate, n - Math.max(target, MIN));
    if (count <= 0) return false;
    const indices = this.selectForRemoval(count);
    if (indices.length === 0) return false;
    this.removePoints(indices);
    return true;
  }

  // random indices, each at least MIN_SPACING + 1 round the ring from the
  // others, so removals spread out and never open a hole in one place.
  // sorted descending, so splicing one does not shift the rest.
  selectForRemoval(count) {
    const n = this.points.length, spacing = SOFT.REDUCE.MIN_SPACING;
    const selected = [], forbidden = new Set();
    let attempts = 0;
    while (selected.length < count && attempts < n * 2) {
      attempts++;
      const index = Math.floor(Math.random() * n);
      if (forbidden.has(index)) continue;
      selected.push(index);
      for (let o = -spacing; o <= spacing; o++) forbidden.add((index + o + n) % n);
    }
    return selected.sort((a, b) => b - a);
  }

  // area, radius and circumference stay: the same skin in fewer, longer
  // chords. each pulse's start comes down past the points taken from
  // under it
  removePoints(indicesDesc) {
    for (const i of indicesDesc) this.points.splice(i, 1);
    this.chord = this.circumference / this.points.length;
    const n = this.points.length;
    for (const p of this.pulses) {
      let below = 0;
      for (const i of indicesDesc) if (i < p.start) below++;
      p.start = Math.min(Math.max(p.start - below, 0), n - 1);
    }
  }

  // the strongest pulse at point i, or null where none reaches: how
  // strongly it lights the point, 1 at its head as it sets off, falling
  // to 0 along its trail and over its life, and where the point is in the
  // colours' cycle, 0 .. 1. cicada's sums, so a pulse lights only what it
  // has passed on its first way round
  pulseAt(i) {
    const P = SOFT.PULSE, n = this.points.length;
    let best = null;
    for (const p of this.pulses) {
      const from = p.dir === 1 ? (i - p.start + n) % n : (p.start - i + n) % n;
      if (from > p.travelled) continue;
      const behind = p.travelled - from;
      if (behind > P.TRAIL) continue;
      const strength = (1 - behind / P.TRAIL) * (1 - p.age / P.LIFE);
      if (!best || strength > best.strength) best = { strength, along: (from / P.CYCLE + p.offset) % 1 };
    }
    return best;
  }

  // carry the lock and the whole ring, positions and previous positions
  // alike, so the move adds no velocity. an unlocked blob moves its centre.
  moveLockTo(x, y) {
    let fx = this.lockX, fy = this.lockY;
    if (fx === null) { const c = this.getCenter(); fx = c.x; fy = c.y; }
    const dx = x - fx, dy = y - fy;
    for (const p of this.points) { p.x += dx; p.y += dy; p.px += dx; p.py += dy; }
    if (this.locked) { this.lockX = x; this.lockY = y; }
  }
}

// the blobs, the drag and the clocks. blobs[0] is the centre blob: merges
// always keep the lower index, so it stays first.
class World {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.blobs = [];
    this.drag = null;      // the pointer's: { blob, points: [{ point, force }], x, y }
    this.held = [];        // the hands' drags, each as the pointer's
    this.hands = [];       // what holds them (js/hands.js), each stepped every tick before the blobs
    this.dragForce = SOFT.DRAG.FORCE; // the pull on a held point, of its way to its drag each iteration
    this.spawnMs = SOFT.SPAWN.EVERY_MS;   // ms between small blobs while spawning
    this.maxBlobs = SOFT.SPAWN.MAX_BLOBS; // the most blobs it spawns up to, the centre one among them
    this.pointerX = null;  // null while the pointer is off the page
    this.pointerY = null;
    this.nowMs = 0;        // virtual clock: STEP_MS a step
    this.merges = [];      // [{ blob, seams, eaten }] since the last step() call: what ate, its seams and what it ate, as it was
    this.snaps = 0;        // the pointer's drags pulled too far and let go since the last step() call
    this.spawning = false; // a small blob every spawnMs while true
    this.lastSpawnMs = 0;
    this.acc = 0;
    this.lastWallMs = null;
  }

  resize(w, h) {
    this.w = w; this.h = h;
  }

  // as many whole steps as wall time has moved on. the first call only
  // sets the clock, with half a step in hand: frames that come at the step
  // rate then land mid-step, and their jitter never tips one frame into
  // no step and the next into two. after a stall it catches up a little,
  // not forever. merges and snaps are cleared once per call, so a frame
  // sees every one since the last even when it ran several. returns the count.
  step(wallNowMs) {
    this.merges = [];
    this.snaps = 0;
    if (this.lastWallMs === null) { this.lastWallMs = wallNowMs; this.acc = SOFT.STEP_MS / 2; }
    this.acc += wallNowMs - this.lastWallMs;
    this.lastWallMs = wallNowMs;
    if (this.acc > SOFT.MAX_CATCHUP_MS) this.acc = SOFT.MAX_CATCHUP_MS;
    if (this.acc < 0) this.acc = 0;
    let steps = 0;
    // 1000 / 60 is not exact in binary: without a hair of slack, three
    // steps' worth of ms would run two
    while (this.acc >= SOFT.STEP_MS - 1e-6) {
      this.tick();
      this.acc -= SOFT.STEP_MS;
      steps++;
    }
    return steps;
  }

  // one fixed step, cicada's MainScene.update minus the scenery
  tick() {
    this.nowMs += SOFT.STEP_MS;

    if (this.spawning && this.nowMs - this.lastSpawnMs >= this.spawnMs) {
      this.lastSpawnMs = this.nowMs;
      this.spawnRandom();
    }

    // the hands share out the blobs (js/hands.js), then go where they are
    // going, and their drags with them
    if (this.hands.length) Hand.plan(this);
    for (const hand of this.hands) hand.step(this);

    // pulled too far, the skin lets go
    const broken = (drag) => {
      const p = drag.points[0].point;
      const dx = p.x - drag.x, dy = p.y - drag.y;
      return Math.sqrt(dx * dx + dy * dy) > SOFT.DRAG.BREAKAWAY;
    };
    if (this.drag && broken(this.drag)) { this.drag = null; this.snaps++; }
    this.held = this.held.filter((d) => !broken(d));

    // a locked blob bigger than fits the world eases back to that
    const most = Math.PI * Math.pow(SOFT.FIT.SHARE * Math.min(this.w, this.h) / 2, 2);
    const drags = this.drag ? [this.drag, ...this.held] : this.held;
    for (const b of this.blobs) {
      if (b.locked) b.fit(most);
      const on = drags.filter((d) => d.blob === b);
      b.step(this.w, this.h, on.length ? on : null, this.nowMs, this.dragForce);
    }

    // reduction may have taken a dragged point out of its ring
    const whole = (drag) => drag.points.every((d) => drag.blob.points.includes(d.point));
    if (this.drag && !whole(this.drag)) this.drag = null;
    this.held = this.held.filter(whole);

    // blobs[i] eats blobs[j]; a blob already eaten this step takes no part
    const gone = [];
    for (let i = 0; i < this.blobs.length; i++) {
      for (let j = i + 1; j < this.blobs.length; j++) {
        if (gone.includes(i) || gone.includes(j)) continue;
        const a = this.blobs[i], b = this.blobs[j];
        const hit = a.collides(b);
        if (!hit) continue;
        this.merges.push({ blob: a, seams: a.merge(b, hit.i, hit.j), eaten: b });
        gone.push(j);
        if (this.drag && this.drag.blob === b) this.drag = null;
        this.held = this.held.filter((d) => d.blob !== b);
      }
    }
    // highest index first, so each splice leaves the others where they were
    gone.sort((p, q) => q - p);
    for (const k of gone) this.blobs.splice(k, 1);
  }

  // the nearest point of any blob, if within GRAB, and its neighbours
  grab(x, y) {
    this.pointerX = x; this.pointerY = y;
    let blob = null, index = -1, min = Infinity;
    for (const b of this.blobs) {
      const c = b.closest(x, y);
      if (c.dist < min) { min = c.dist; blob = b; index = c.index; }
    }
    if (min < SOFT.DRAG.GRAB && index !== -1) {
      this.drag = { blob, points: blob.neighbors(index, 2), x, y };
      return true;
    }
    return false;
  }

  pointer(x, y) {
    this.pointerX = x; this.pointerY = y;
    if (this.drag) { this.drag.x = x; this.drag.y = y; }
  }

  // the drag stays: a captured pointer can leave the page and come back
  pointerOff() {
    this.pointerX = null; this.pointerY = null;
  }

  release() {
    this.drag = null;
  }

  // a hand takes hold of blob's point index and its neighbours, as the
  // pointer does, pulling them toward the drag's x, y, which start on the
  // point; the drag is the hand's to move, and lasts until the skin lets
  // go, the blob is eaten or letGo
  hold(blob, index) {
    const p = blob.points[index];
    const drag = { blob, points: blob.neighbors(index, 2), x: p.x, y: p.y };
    this.held.push(drag);
    return drag;
  }

  letGo(drag) {
    this.held = this.held.filter((d) => d !== drag);
  }

  // whether a hand's drag still holds
  holds(drag) {
    return this.held.includes(drag);
  }

  spawn(radius, x, y) {
    const S = SOFT.SPAWN;
    const b = new SoftBlob(x, y, S.POINTS, radius, S.PUFFINESS, false);
    this.blobs.push(b);
    return b;
  }

  // a random size anywhere inside the world but not within EXCLUSION of
  // (cx, cy), so nothing is born already touching the centre blob, nor
  // within CLEAR of as far as any blob's skin reaches from its centre, so
  // nothing is born on or inside another. cicada
  // tried until it found a spot; a small or crowded world may have none,
  // so this gives up after a while and returns null, as it does when full. it
  // comes in drifting, DRIFT px a step in any direction.
  spawnRandom(cx = this.w / 2, cy = this.h / 2) {
    const S = SOFT.SPAWN;
    if (this.blobs.length >= this.maxBlobs) return null;
    const r = S.MIN_RADIUS + Math.random() * (S.MAX_RADIUS - S.MIN_RADIUS);
    const others = this.blobs.map((b) => ({ c: b.getCenter(), reach: b.reach() }));
    const taken = (x, y) => others.some((o) => {
      const dx = x - o.c.x, dy = y - o.c.y;
      return Math.sqrt(dx * dx + dy * dy) < o.reach + r + S.CLEAR;
    });
    for (let tries = 0; tries < 100; tries++) {
      const x = r + Math.random() * (this.w - r * 2);
      const y = r + Math.random() * (this.h - r * 2);
      const dx = x - cx, dy = y - cy;
      if (Math.sqrt(dx * dx + dy * dy) > S.EXCLUSION && !taken(x, y)) {
        const b = this.spawn(r, x, y);
        const a = 2 * Math.PI * Math.random(), v = S.DRIFT[0] + Math.random() * (S.DRIFT[1] - S.DRIFT[0]);
        for (const p of b.points) { p.px = p.x - v * Math.cos(a); p.py = p.y - v * Math.sin(a); }
        return b;
      }
    }
    return null;
  }

  // the other blob whose centre is nearest, for the eyes. edgeDist is the
  // smallest gap between skins over all the others, so a proximity test on
  // it is cicada's "is any blob close", even when a big blob farther off
  // is the one nearly touching.
  nearestTo(blob) {
    const c = blob.getCenter();
    let best = null, dist = Infinity, edgeDist = Infinity;
    for (const o of this.blobs) {
      if (o === blob) continue;
      const oc = o.getCenter();
      const dx = oc.x - c.x, dy = oc.y - c.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < dist) { dist = d; best = o; }
      const e = d - blob.radius - o.radius;
      if (e < edgeDist) edgeDist = e;
    }
    return best ? { blob: best, dist, edgeDist } : null;
  }
}
