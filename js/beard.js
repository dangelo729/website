// --- the beard ---------------------------------------------------------------
// daedalus's beard (src/body/beard.cpp in the daedalus repo), ported with
// only its mustache: a mass of 1 px hair strands under the bubble's nose,
// each a chain of points pinned at its root and hanging along its own lean.
// no one strand is seen at this count: they are plain lit pixels that
// overlap, and what carries the motion is the black between them, opening
// and closing as each strand drifts at its own phase. so every strand is a
// little unlike every other (its length, lean, stiffness and phase), or the
// mass would move as one stamp.
//
// the bands are data: each a line in the face's art px (the radius 36 frame
// face.js uses) from the mouth's centre, its strands dealt into locks along
// it, every share drawn from a hash of the strand's or the lock's index, so
// the same bands always grow the same hair. from the mouth's centre because
// the roots ride the mouth: the strands trail as it trails the bubble, and
// they grow and shrink with the face's scale.
//
// each step every root is pinned on its place and every other point is
// carried on by its own speed (the air taking a share of it), pulled along
// its strand's lean by gravity and sideways by a slow breeze at the strand's
// own phase; then, a few times from the root down, each point is bent a share
// of the way toward straight on and set back at its segment's length from
// the one above. moving a point alone would crack a jolt down the strand
// like a whip, so each point's speed gives back most of what the passes did
// to the one below (dynamic follow-the-leader). nothing reads a clock or a
// random number: the beard's time is its steps, and the same steps give the
// same beard.

const BEARD = {
  // bands in the face's art px (the radius-36 frame face.js uses), x,y from the MOUTH's centre, +y down; scaled by the face's scale at run time
  BANDS: [
    { x0: 0, y0: -10, x1: -13, y1: -8.5, count: 20, locks: 20, len0: 4, len1: 8, lean0: -0.30, lean1: -1.05, points: 3, stiff: 0.30 }, // the mustache, the viewer's left: from under the nose out past the lip's corner, leaning out and down
    { x0: 0, y0: -10, x1: 13, y1: -8.5, count: 20, locks: 20, len0: 4, len1: 8, lean0: 0.30, lean1: 1.05, points: 3, stiff: 0.30 },   // and the right
  ],
  // each lock's share: its place off its span's middle by up to SPREAD of a
  // span, its lean off the band's by up to LEAN_JITTER rad. each strand's:
  // its root off its lock's by up to LOCK_SPREAD of a span, its lean by up
  // to STRAND_LEAN rad, its length and stiffness by up to their jitter's
  // share of them, its breeze's phase anywhere round. SPREAD + LOCK_SPREAD
  // under a half keeps every root inside its lock's span, the locks in order
  SPREAD: 0.3, LEAN_JITTER: 0.12, LOCK_SPREAD: 0.15, STRAND_LEAN: 0.05, LEN_JITTER: 0.25, STIFF_JITTER: 0.3,
  // the physics, daedalus's: gravity along the lean (px/s²), the share of a
  // point's speed the air leaves it after a second, the breeze sideways
  // (px/s²) and its rate round, bend and length passes a step, the share of
  // the point below's correction a point's speed gives back, the longest step
  GRAVITY: 300, KEEP: 0.02, BREEZE: 20, BREEZE_HZ: 0.3, PASSES: 2, FOLLOW: 0.9, STEP_S: 1 / 60,
  // the hash's strides: a band's locks LOCKS_MOST apart, every lock's share
  // past every strand's
  LOCKS_MOST: 64, LOCK_SHARES: 1024,
};

class Beard {
  // w, h: the world, every point but the roots kept on its pixels
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.strands = Beard.lay();
    // every strand's points, its root first: where each is and where it was
    // a step ago. a root is pinned, never carried by a speed, so its px, py
    // are never read
    this.pts = this.strands.map((s) => Array.from({ length: s.points }, () => ({ x: 0, y: 0, px: 0, py: 0 })));
    // its lean's direction, + x right, + y down, and its segment's length
    // now, carried across a frame's steps as its root is
    this.dir = this.strands.map((s) => ({ x: Math.sin(s.lean), y: Math.cos(s.lean) }));
    this.seg = new Float64Array(this.strands.length);
    // where the verlet left each point of a strand, made once: a step should
    // not allocate
    let most = 0;
    for (const s of this.strands) most = Math.max(most, s.points);
    this.gone = new Float64Array(2 * most);
    this.breeze = 0;         // rad, in [0, 2π)
    this.was = BEARD.STEP_S; // the last step's length, so a step of another carries a speed on at the same px/s
    this.fresh = true;       // the next step lays every strand out at rest
    this.posed = false;      // a step has laid it out: till then nothing is drawn
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
  }

  // the next step poses every strand afresh where its root is then
  reset() {
    this.breeze = 0;
    this.fresh = true;
  }

  // one frame. mouth: the face's mouth, world px, a float; scale: the
  // face's. strand i's root is the mouth plus its offset at that scale, its
  // segments its length over its segments at that scale. the first step
  // after a reset lays every strand straight along its lean, still; no time
  // (dtS 0 or less) sets the roots and the lengths and moves nothing else;
  // any other cuts dtS into equal steps no longer than STEP_S, the roots and
  // lengths eased from their last to this frame's across them, so a long
  // frame does not jerk them all at once
  step(dtS, mouth, scale) {
    const B = BEARD, count = this.strands.length;
    if (this.fresh) {
      this.pose(mouth, scale);
      this.fresh = false;
      this.posed = true;
      return;
    }
    if (!(dtS > 0)) {
      for (let i = 0; i < count; i++) {
        const s = this.strands[i], root = this.pts[i][0];
        root.x = mouth.x + s.x * scale;
        root.y = mouth.y + s.y * scale;
        this.seg[i] = s.len / (s.points - 1) * scale;
      }
      return;
    }
    let n = 1;
    while (dtS > n * B.STEP_S) n++;
    const h = dtS / n, air = Math.pow(B.KEEP, h), turn = 2 * Math.PI;
    for (let k = 0; k < n; k++) {
      this.breeze = (this.breeze + turn * B.BREEZE_HZ * h) % turn;
      const keep = k === 0 ? air * (h / this.was) : air; // a speed carried from a step of another length, at the same px/s
      const w = 1 / (n - k);                              // the root's share of the way left: all of it on the frame's last step
      for (let i = 0; i < count; i++) {
        const s = this.strands[i];
        this.strandStep(i, h, keep, this.breeze, mouth.x + s.x * scale, mouth.y + s.y * scale, s.len / (s.points - 1) * scale, w);
      }
    }
    this.was = h;
  }

  // every strand straight along its lean from its root, at its segments'
  // lengths, still
  pose(mouth, scale) {
    for (let i = 0; i < this.strands.length; i++) {
      const s = this.strands[i], p = this.pts[i], d = this.dir[i];
      p[0].x = mouth.x + s.x * scale;
      p[0].y = mouth.y + s.y * scale;
      this.seg[i] = s.len / (s.points - 1) * scale;
      for (let j = 1; j < s.points; j++) {
        p[j].x = p[0].x + d.x * this.seg[i] * j;
        p[j].y = p[0].y + d.y * this.seg[i] * j;
        this.keepIn(p[j]);
        p[j].px = p[j].x;
        p[j].py = p[j].y;
      }
    }
  }

  // strand i on by one step of h s, its root a share w of the way to
  // (rx, ry) and its segment's length to len. keep: the share of a point's
  // speed carried on; breeze: the breeze's phase this step
  strandStep(i, h, keep, breeze, rx, ry, len, w) {
    const B = BEARD, s = this.strands[i], p = this.pts[i], gone = this.gone;
    p[0].x += (rx - p[0].x) * w;
    p[0].y += (ry - p[0].y) * w;
    this.seg[i] += (len - this.seg[i]) * w;
    const sx = this.dir[i].x, sy = this.dir[i].y, seg = this.seg[i];

    // verlet: on by its speed, the pull along its lean and the breeze's
    // sideways; where it got to kept, to see how far the passes move it
    const ax = (B.GRAVITY * sx + B.BREEZE * Math.sin(breeze + s.phase)) * h * h;
    const ay = B.GRAVITY * sy * h * h;
    for (let j = 1; j < s.points; j++) {
      const q = p[j];
      const vx = (q.x - q.px) * keep, vy = (q.y - q.py) * keep;
      q.px = q.x;
      q.py = q.y;
      q.x += vx + ax;
      q.y += vy + ay;
      gone[2 * j] = q.x;
      gone[2 * j + 1] = q.y;
    }

    // from the root down: each point but the first a share of the way toward
    // straight on from the two above it (the first turns freely about the
    // root, so the strand swings from it as a stiffish rod), then back at its
    // segment's length from the one above, it alone moving
    for (let pass = 0; pass < B.PASSES; pass++) {
      for (let j = 1; j < s.points; j++) {
        const a = p[j - 1], q = p[j];
        if (j >= 2) {
          const b = p[j - 2];
          q.x += (a.x + (a.x - b.x) - q.x) * s.stiff;
          q.y += (a.y + (a.y - b.y) - q.y) * s.stiff;
        }
        const dx = q.x - a.x, dy = q.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 0) {
          q.x = a.x + dx * (seg / d);
          q.y = a.y + dy * (seg / d);
        } else {
          q.x = a.x + sx * seg;
          q.y = a.y + sy * seg;
        }
      }
    }

    // the passes move a point and never the one above it; left so, a jolt
    // runs down the strand and cracks its tip. so each point's speed gives
    // up FOLLOW of the way the passes moved the point below, the pull that
    // point would have put on it (müller, kim and chentanez 2012)
    for (let j = 1; j + 1 < s.points; j++) {
      p[j].px += B.FOLLOW * (p[j + 1].x - gone[2 * (j + 1)]);
      p[j].py += B.FOLLOW * (p[j + 1].y - gone[2 * (j + 1) + 1]);
    }
    for (let j = 1; j < s.points; j++) this.keepIn(p[j]);
  }

  // a safety net: on the world's last pixel centres or inside them
  keepIn(q) {
    q.x = Math.min(Math.max(q.x, 0), this.w - 1);
    q.y = Math.min(Math.max(q.y, 0), this.h - 1);
  }

  // every segment a 1 px line between its two points, each on its nearest
  // pixel. only lit, never dark, so it lights over whatever is under it
  draw(fb) {
    if (!this.posed) return;
    for (let i = 0; i < this.strands.length; i++) {
      const p = this.pts[i];
      let x0 = Beard.pixel(p[0].x), y0 = Beard.pixel(p[0].y);
      for (let j = 1; j < p.length; j++) {
        const x1 = Beard.pixel(p[j].x), y1 = Beard.pixel(p[j].y);
        fb.line(x0, y0, x1, y1, 1);
        x0 = x1;
        y0 = y1;
      }
    }
  }

  // for the tests: strand i's points as of the last step, its root first;
  // null outside the strands or before the first step
  points(i) {
    if (!this.posed || !(i >= 0 && i < this.pts.length)) return null;
    return this.pts[i].map((q) => ({ x: q.x, y: q.y }));
  }

  // the pixel a point is drawn on: the nearest, a half rounded down, as
  // daedalus places one (Math.round would round it up)
  static pixel(v) {
    return Math.ceil(v - 0.5);
  }

  // lowbias32, a 32-bit integer mix
  static mix(x) {
    x >>>= 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return x >>> 0;
  }

  // strand i's share k, in [-1, 1). fixed by its index alone, so moving a
  // band's count reshuffles the strands after it and nothing else
  static share(i, k) {
    return ((Beard.mix((i * 8 + k + 1) >>> 0) >>> 8) * (2 / 16777216)) - 1;
  }

  // lock l of band b's share k: the same hash, past every strand's
  static lockShare(b, l, k) {
    return Beard.share(BEARD.LOCK_SHARES + b * BEARD.LOCKS_MOST + l, k);
  }

  // the strands, band by band: each band's dealt in turn into its locks,
  // each lock in the middle of its span along the band, off it by its
  // share, each root off its lock's by its own; its length and lean read
  // off the band where its root lies, then its lock's share of lean and its
  // own share of each. roots are art px from the mouth's centre
  static lay() {
    const B = BEARD, out = [];
    let i = 0;
    for (let b = 0; b < B.BANDS.length; b++) {
      const d = B.BANDS[b];
      for (let k = 0; k < d.count; k++, i++) {
        const l = Math.floor(k * d.locks / d.count);
        const span = 1 / d.locks;
        const u = (l + 0.5 + B.SPREAD * Beard.lockShare(b, l, 0) + B.LOCK_SPREAD * Beard.share(i, 0)) * span; // along the band, 0 .. 1
        out.push({
          x: d.x0 + (d.x1 - d.x0) * u,
          y: d.y0 + (d.y1 - d.y0) * u,
          len: (d.len0 + (d.len1 - d.len0) * u) * (1 + B.LEN_JITTER * Beard.share(i, 1)),
          lean: d.lean0 + (d.lean1 - d.lean0) * u + B.LEAN_JITTER * Beard.lockShare(b, l, 1) + B.STRAND_LEAN * Beard.share(i, 2),
          stiff: d.stiff * (1 + B.STIFF_JITTER * Beard.share(i, 3)),
          phase: 2 * Math.PI * 0.5 * (Beard.share(i, 4) + 1),
          band: b,
          points: d.points,
        });
      }
    }
    return out;
  }
}
