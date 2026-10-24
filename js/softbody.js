// --- soft bodies ---------------------------------------------------------------
// cicada's blobs, ported. a blob is a ring of verlet points: each pair of
// neighbours is held to a fixed chord, and the ring as a whole is pushed
// out toward a target area a little larger than its circumference can
// enclose, so it always sits slightly stretched, like a skin with air in it.
// a locked blob is eased back to its lock every step; a dragged one has a
// few points pulled toward the pointer. blobs that touch merge into one.
// everything is in world px and per 60 Hz step: the world runs whole steps
// from wall time, so a 120 Hz screen does not run it twice as fast, and it
// keeps its own clock in ms for anything timed (point reduction).

const SOFT = {
  STEP_MS: 1000 / 60, MAX_CATCHUP_MS: 100,
  DAMPING: 0.99, GRAVITY: 0, ITERATIONS: 10,
  DISTANCE_ERROR_THRESHOLD: 0.01, DISTANCE_CORRECTION_FACTOR: 0.5,
  LOCK_RATE: 0.1, LOCK_DAMPING: 0.92, LOCK_DIFF_THRESHOLD: 0.1,
  COLLISION_THRESHOLD: 1.86, MERGE_PUFF_SHARE: 0.3, MAX_PUFFINESS: 2.5,
  REDUCE: { ENABLED: true, TARGET: 32, RATE: 1, INTERVAL_MS: 20, MIN_SPACING: 2, MIN_VIABLE: 8 },
  // the pull on a held point, a fraction of its distance to the pointer
  // each iteration. cicada's config carried 0.0001 (the skin barely moves)
  // and called 0.04 the slider's default (the skin spikes out after the
  // pointer). 0.002 dimples: a 24 px pull takes the skin about 5 px
  DRAG: { GRAB: 40, BREAKAWAY: 80, FORCE: 0.002, WEIGHTS: [1.0, 0.6, 0.3] },  // centre, first, second neighbours
  SPAWN: { MIN_RADIUS: 2, MAX_RADIUS: 10, EXCLUSION: 110, MAX_BLOBS: 15, POINTS: 32, PUFFINESS: 1.2 },
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
    this.locked = locked;
    this.lockX = locked ? cx : null;
    this.lockY = locked ? cy : null;
    this.lastReduceMs = 0;
    this.points = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i / n) - Math.PI / 2;
      this.points.push(new Point(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius));
    }
  }

  // one 60 Hz step, cicada's Blob.update in its order. drag is
  // { points: [{ point, force }], x, y } or null; tMs is the world's clock.
  step(w, h, drag, tMs) {
    const pts = this.points;
    for (const p of pts) { p.integrate(); p.applyGravity(); }

    // cicada turned each secant with a -PI/2 rotation; the same cos and sin
    // keep the sums the same down to the last bit
    const rc = Math.cos(-Math.PI / 2), rs = Math.sin(-Math.PI / 2);
    for (let it = 0; it < SOFT.ITERATIONS; it++) {
      const n = pts.length;

      // chords: each pair splits its error, too long pulls in, too short
      // pushes apart. a tiny error is left alone so a ring at rest is still
      for (let i = 0; i < n; i++) {
        const cur = pts[i], next = pts[(i + 1) % n];
        const dx = next.x - cur.x, dy = next.y - cur.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const error = dist - this.chord;
        if (Math.abs(error) > SOFT.DISTANCE_ERROR_THRESHOLD) {
          const c = error * SOFT.DISTANCE_CORRECTION_FACTOR;
          const ux = dist > 0 ? dx / dist : dx, uy = dist > 0 ? dy / dist : dy;
          cur.accumulate(ux * c, uy * c);
          next.accumulate(-(ux * c), -(uy * c));
        }
      }

      // area: the missing area spread over the circumference is how far
      // every point moves along its normal (the secant across it, turned)
      const offset = (this.area - this.getArea()) / this.circumference;
      for (let i = 0; i < n; i++) {
        const prev = pts[i === 0 ? n - 1 : i - 1], cur = pts[i], next = pts[(i + 1) % n];
        const sx = next.x - prev.x, sy = next.y - prev.y;
        const nx = sx * rc - sy * rs, ny = sx * rs + sy * rc;
        const m = Math.sqrt(nx * nx + ny * ny);
        const ux = m > 0 ? nx / m : nx, uy = m > 0 ? ny / m : ny;
        cur.accumulate(ux * offset, uy * offset);
      }

      for (const p of pts) p.applyDisplacement();

      if (drag) {
        for (const d of drag.points) d.point.attract(drag.x, drag.y, SOFT.DRAG.FORCE * d.force);
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

    // every merge adds points; a locked blob sheds them back to TARGET one
    // at a time, so it cannot grow without bound by eating
    const R = SOFT.REDUCE;
    if (this.locked && R.ENABLED && tMs - this.lastReduceMs >= R.INTERVAL_MS) {
      if (this.points.length > R.TARGET) this.reduce(R.TARGET, R.RATE);
      this.lastReduceMs = tMs;
    }
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

  // the first pair of points closer than threshold, scanning this ring first
  collides(other, threshold = SOFT.COLLISION_THRESHOLD) {
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

  // area, radius and circumference stay: the same skin in fewer, longer chords
  removePoints(indicesDesc) {
    for (const i of indicesDesc) this.points.splice(i, 1);
    this.chord = this.circumference / this.points.length;
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
    this.drag = null;      // { blob, points: [{ point, force }], x, y }
    this.pointerX = null;  // null while the pointer is off the page
    this.pointerY = null;
    this.nowMs = 0;        // virtual clock: STEP_MS a step
    this.merges = [];      // [{ blob, seams }] since the last step() call
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
  // not forever. merges are cleared once per call, so a frame sees every
  // merge since the last one even when it ran several. returns the count.
  step(wallNowMs) {
    this.merges = [];
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

    // pulled too far, the skin lets go
    if (this.drag) {
      const p = this.drag.points[0].point;
      const dx = p.x - this.drag.x, dy = p.y - this.drag.y;
      if (Math.sqrt(dx * dx + dy * dy) > SOFT.DRAG.BREAKAWAY) this.drag = null;
    }

    for (const b of this.blobs) {
      b.step(this.w, this.h, this.drag && this.drag.blob === b ? this.drag : null, this.nowMs);
    }

    // reduction may have taken a dragged point out of its ring
    const drag = this.drag;
    if (drag && !drag.points.every((d) => drag.blob.points.includes(d.point))) this.drag = null;

    // blobs[i] eats blobs[j]; a blob already eaten this step takes no part
    const gone = [];
    for (let i = 0; i < this.blobs.length; i++) {
      for (let j = i + 1; j < this.blobs.length; j++) {
        if (gone.includes(i) || gone.includes(j)) continue;
        const a = this.blobs[i], b = this.blobs[j];
        const hit = a.collides(b);
        if (!hit) continue;
        this.merges.push({ blob: a, seams: a.merge(b, hit.i, hit.j) });
        gone.push(j);
        if (this.drag && this.drag.blob === b) this.drag = null;
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

  spawn(radius, x, y) {
    const S = SOFT.SPAWN;
    const b = new SoftBlob(x, y, S.POINTS, radius, S.PUFFINESS, false);
    this.blobs.push(b);
    return b;
  }

  // a random size anywhere inside the world but not within EXCLUSION of
  // (cx, cy), so nothing is born already touching the centre blob. cicada
  // tried until it found a spot; a small world may have none, so this
  // gives up after a while and returns null, as it does when full.
  spawnRandom(cx = this.w / 2, cy = this.h / 2) {
    const S = SOFT.SPAWN;
    if (this.blobs.length >= S.MAX_BLOBS) return null;
    const r = S.MIN_RADIUS + Math.random() * (S.MAX_RADIUS - S.MIN_RADIUS);
    for (let tries = 0; tries < 100; tries++) {
      const x = r + Math.random() * (this.w - r * 2);
      const y = r + Math.random() * (this.h - r * 2);
      const dx = x - cx, dy = y - cy;
      if (Math.sqrt(dx * dx + dy * dy) > S.EXCLUSION) return this.spawn(r, x, y);
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
