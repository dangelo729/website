// --- skins ---------------------------------------------------------------------
// a box's shape as a soft body: a ring of verlet points, as js/softbody.js's
// blobs are, chasing a rounded rect (its target) wherever that goes. each
// point has its own place u round the outline, kept for its life, from 0 at
// the top edge's middle clockwise on screen to 1 back there, and its home
// is where u lands on the target. the outline is cut into eighths at fixed
// u, the edges' middles at even eighths and the corners' arcs' middles at
// odd ones (the anchors), so a point keeps to the same feature however the
// shape changes; within an eighth, u goes evenly along its length.
//
// each step every two neighbours are held to the outline's length between
// their homes, so the skin is always as long as the target's outline; the
// ring is blown out toward the target's area, like a skin with air in it;
// and every point is pulled toward its home. along the outline every point
// is pulled as hard as an anchor, so the skin slides round with its homes
// and keeps its order; across it, gently for the skin and hardest near the
// anchors, so they lead and the skin bows behind them and is dragged after
// them, jelly between eight handles. as the target grows a gap between
// homes past SPLIT takes new points, and as it shrinks a point whose
// neighbours' homes are under JOIN apart is dropped, so the ring keeps the
// same grain at any size. it runs whole fixed steps from the time it is
// given, as the world does, so it moves alike at any frame rate.
// everything is in world px, y down. the loops over the points count
// through them by index: a for-of there can leave safari stepping a skin
// ten times slower.

const SKIN = {
  STEP: 1 / 60,   // seconds, one step
  CATCH_UP: 0.1,  // seconds, the most it catches up after a stall
  DAMPING: 0.85,  // of its speed a point keeps each step: less is thicker jelly that sets sooner, more wobbles longer
  ITERATIONS: 6,  // passes of the chords, the air and the pull each step
  CHORD: 0.5,     // of a chord's error each pass, split between its ends: how stiffly the skin keeps its length
  // of the area missing from the target's each pass, spread round the
  // outline and pushed out along it: more fills the bows out sooner, but
  // past about 0.5 the skin starts to fold over itself as it shuts, and
  // at 2 a box that jumps blows it apart
  AIR: 0.3,
  // of the way home each pass, across the outline. PULL is the skin's:
  // less lags further behind the anchors and bows deeper. LEAD is the
  // anchors' (and every point's along the outline): how hard they lead
  PULL: 0.06,
  LEAD: 0.3,
  // world px along the outline from an anchor over which its pull falls
  // off to the skin's, along half a cosine: less leaves narrower handles
  // and deeper scallops between them, more a stiffer box that bows less
  SPREAD: 80,
  // the grain. a gap between two neighbours' homes longer than SPLIT world
  // px takes new points, evenly along it, and a point whose neighbours'
  // homes are under JOIN px apart is dropped. so the points stand between
  // about JOIN / 2 and SPLIT px apart round the outline: smaller is a
  // finer skin, smoother on its curves, and more points to step and draw.
  // JOIN must be under SPLIT, or a gap split in two would be joined
  // straight back
  SPLIT: 3,
  JOIN: 2.5,
  // the fewest points a ring keeps however small it is (a phone's o has
  // this many), and the most it takes however big (about's open box at
  // 1280 x 800 has about 1,700); past MOST its gaps stretch past SPLIT
  LEAST: 24,
  MOST: 2400,
};

class Skin {
  // a ring settled on target, { x0, y0, x1, y1, r }; spread is SPREAD for
  // this skin, less for a small one, whose every point would otherwise sit
  // within SPREAD of an anchor and be held as hard as one, so it would
  // never bow
  constructor(target, spread = SKIN.SPREAD) {
    this.spread = spread;
    // each { x, y, px, py, u, dx, dy, dw }, its home's { hx, hy, s } and the
    // outline's heading there { tx, ty }, the gap to the next one's home and
    // its pull
    this.points = [];
    this.acc = SKIN.STEP / 2;
    this.shape = Skin.outline(target); // the target worked out, kept and reused
    this.spare = [];       // the ring as the spacing builds it, before it goes back into points
    this.pool = [];        // screen()'s points, made once each and reused
    this.view = [];        // screen()'s array
    this.settle(target);
  }

  // where u lands on target: { x, y, s }, s its length round the outline
  // from u = 0
  static home(target, u) {
    const h = {};
    Skin.place(Skin.outline(target), u, h);
    return { x: h.hx, y: h.hy, s: h.s };
  }

  // the length round target's outline
  static length(target) {
    return Skin.outline(target).len;
  }

  // target worked out into o (made if not given): its corners' radius, no
  // more than half its least side; each quarter's start, from an edge's
  // middle, its heading, its straight run before its corner (a) and its
  // corner's centre; each eighth's length and where each starts round the
  // outline (at, the anchors' places, at[8] the whole length); and the
  // area it holds. a quarter is a straight run a long, a quarter circle,
  // and a straight run as long as the next quarter's a, turned a quarter
  // clockwise from its heading
  static outline(t, o) {
    if (!o) o = { sx: new Float64Array(4), sy: new Float64Array(4), hx: new Float64Array(4), hy: new Float64Array(4),
      a: new Float64Array(4), cx: new Float64Array(4), cy: new Float64Array(4), eighth: new Float64Array(8), at: new Float64Array(9) };
    const hw = Math.max(0, (t.x1 - t.x0) / 2), hh = Math.max(0, (t.y1 - t.y0) / 2);
    const r = Math.max(0, Math.min(t.r, hw, hh)), mx = t.x0 + hw, my = t.y0 + hh;
    o.r = r;
    // the top's middle heading right, the right's heading down, the
    // bottom's heading left and the left's heading up
    const S = [[mx, t.y0, 1, 0, hw], [t.x1, my, 0, 1, hh], [mx, t.y1, -1, 0, hw], [t.x0, my, 0, -1, hh]];
    for (let q = 0; q < 4; q++) {
      const [sx, sy, hx, hy, half] = S[q];
      o.sx[q] = sx; o.sy[q] = sy; o.hx[q] = hx; o.hy[q] = hy;
      o.a[q] = half - r;
      // the corner's centre: the run's end, then r on along the next heading (-hy, hx)
      o.cx[q] = sx + hx * (half - r) - hy * r;
      o.cy[q] = sy + hy * (half - r) + hx * r;
    }
    const arc = Math.PI * r / 4; // an eighth of the corner's circle, half its quarter
    let s = 0;
    for (let k = 0; k < 8; k++) {
      const q = k >> 1;
      o.eighth[k] = (k & 1) ? arc + o.a[(q + 1) & 3] : o.a[q] + arc;
      o.at[k] = s;
      s += o.eighth[k];
    }
    o.at[8] = s;
    o.len = s;
    o.area = 4 * hw * hh - (4 - Math.PI) * r * r;
    return o;
  }

  // where u lands on the outline o, into h: h.hx and h.hy, the outline's
  // heading there, h.tx and h.ty, and h.s, how far round from u = 0
  static place(o, u, h) {
    let k = Math.floor(8 * u);
    if (k > 7) k = 7;
    else if (k < 0) k = 0;
    const q = k >> 1, a = o.a[q], r = o.r;
    // how far along the quarter: its first eighth ends a corner's half arc past a
    const d = (k & 1 ? o.eighth[k - 1] : 0) + (8 * u - k) * o.eighth[k];
    const hx = o.hx[q], hy = o.hy[q];
    if (d <= a) {
      h.hx = o.sx[q] + hx * d;
      h.hy = o.sy[q] + hy * d;
      h.tx = hx;
      h.ty = hy;
    } else if (d < a + Math.PI * r / 2) {
      // round the corner from its start, the run's end, to the next run's
      const th = (d - a) / r, c = Math.cos(th), sn = Math.sin(th);
      h.hx = o.cx[q] + hy * r * c + hx * r * sn;
      h.hy = o.cy[q] - hx * r * c + hy * r * sn;
      h.tx = hx * c - hy * sn;
      h.ty = hy * c + hx * sn;
    } else {
      // down the next run, from the corner's end
      const e = d - a - Math.PI * r / 2;
      h.hx = o.cx[q] + hx * r - hy * e;
      h.hy = o.cy[q] + hy * r + hx * e;
      h.tx = -hy;
      h.ty = hx;
    }
    h.s = o.at[2 * q] + d;
  }

  // the u that lands s round the outline o, s from 0 to its length
  static uAt(o, s) {
    let k = 0;
    while (k < 7 && s >= o.at[k + 1]) k++;
    const f = o.eighth[k] > 0 ? (s - o.at[k]) / o.eighth[k] : 0;
    return Math.min(k + Math.max(0, Math.min(f, 1)), 8 - 1e-12) / 8;
  }

  // a point at u, at (x, y) and where it was (px, py)
  static point(u, x, y, px, py) {
    return { x, y, px, py, u, dx: 0, dy: 0, dw: 0, hx: x, hy: y, tx: 1, ty: 0, s: 0, gap: 0, pull: 0 };
  }

  // the ring laid out on target at rest, each point on its home and still:
  // in each eighth as many as keep its gaps no more than SPLIT, more when
  // that would be under LEAST all round and fewer when over MOST, each
  // eighth's evenly along it from its anchor on
  settle(target) {
    const o = Skin.outline(target, this.shape);
    const count = (gap, round) => {
      let n = 0;
      for (let k = 0; k < 8; k++) n += Math.max(1, round(o.eighth[k] / gap) || 0);
      return n;
    };
    let gap = SKIN.SPLIT, round = Math.ceil;
    if (count(gap, round) < SKIN.LEAST) gap = o.len / SKIN.LEAST;
    else if (count(gap, round) > SKIN.MOST) { gap = o.len / (SKIN.MOST - 8); round = Math.floor; }
    this.points = [];
    for (let k = 0; k < 8; k++) {
      const m = Math.max(1, round(o.eighth[k] / gap) || 0);
      for (let j = 0; j < m; j++) {
        const p = Skin.point((k + j / m) / 8, 0, 0, 0, 0);
        Skin.place(o, p.u, p);
        p.x = p.px = p.hx;
        p.y = p.py = p.hy;
        this.points.push(p);
      }
    }
    this.acc = SKIN.STEP / 2;
  }

  // dt seconds on toward target: as many whole steps as the time it has
  // been given covers, catching up no more than CATCH_UP after a stall.
  // the first call has half a step in hand, as the world does, so frames
  // at the step's rate land mid-step. returns how many it ran
  step(dt, target) {
    this.acc = Math.min(this.acc + dt, SKIN.CATCH_UP);
    if (!(this.acc >= SKIN.STEP - 1e-6)) return 0;
    Skin.outline(target, this.shape);
    let steps = 0;
    // a step's worth in seconds is not exact in binary: without a hair of
    // slack, three steps' worth would run two
    while (this.acc >= SKIN.STEP - 1e-6) {
      this.tick();
      this.acc -= SKIN.STEP;
      steps++;
    }
    return steps;
  }

  // one fixed step toward the outline worked out in shape
  tick() {
    const o = this.shape;
    for (let i = 0, a = this.points; i < a.length; i++) Skin.place(o, a[i].u, a[i]);
    this.space();
    const pts = this.points, n = pts.length, len = o.len;
    // each point's gap to the next one's home, and its pull: LEAD within
    // SPREAD of an anchor, falling off along a half cosine to PULL
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[i + 1 < n ? i + 1 : 0];
      let gap = q.s - p.s;
      if (gap < 0) gap += len;
      p.gap = gap;
      const k = Math.min(7, Math.floor(8 * p.u));
      const d = Math.max(0, Math.min(p.s - o.at[k], o.at[k + 1] - p.s));
      const w = d < this.spread ? 0.5 + 0.5 * Math.cos(Math.PI * d / this.spread) : 0;
      p.pull = SKIN.PULL + (SKIN.LEAD - SKIN.PULL) * w;
    }
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const vx = (p.x - p.px) * SKIN.DAMPING, vy = (p.y - p.py) * SKIN.DAMPING;
      p.px = p.x;
      p.py = p.y;
      p.x += vx;
      p.y += vy;
    }
    for (let it = 0; it < SKIN.ITERATIONS; it++) {
      // chords: each pair splits its error, too long pulls in, too short
      // pushes apart
      for (let i = 0; i < n; i++) {
        const p = pts[i], q = pts[i + 1 < n ? i + 1 : 0];
        const dx = q.x - p.x, dy = q.y - p.y, dist = Math.sqrt(dx * dx + dy * dy);
        const c = (dist - p.gap) * SKIN.CHORD;
        const ux = dist > 0 ? dx / dist : 0, uy = dist > 0 ? dy / dist : 0;
        p.dx += ux * c; p.dy += uy * c; p.dw++;
        q.dx -= ux * c; q.dy -= uy * c; q.dw++;
      }
      // air: the area missing from the target's, spread round its outline,
      // is how far every point is pushed along its normal, the secant
      // across it turned a quarter: outward, on a ring that runs clockwise
      // on screen
      let area = 0;
      for (let i = 0; i < n; i++) {
        const p = pts[i], q = pts[i + 1 < n ? i + 1 : 0];
        area += p.x * q.y - q.x * p.y;
      }
      const offset = SKIN.AIR * (o.area - area / 2) / len;
      for (let i = 0; i < n; i++) {
        const a = pts[i > 0 ? i - 1 : n - 1], p = pts[i], c = pts[i + 1 < n ? i + 1 : 0];
        const nx = c.y - a.y, ny = a.x - c.x, m = Math.sqrt(nx * nx + ny * ny);
        if (m > 0) { p.dx += nx / m * offset; p.dy += ny / m * offset; }
        p.dw++;
      }
      // the nudges averaged, then the pull home: along the outline as hard
      // as an anchor's, so the skin slides round with its homes and keeps
      // its order, never bunching or looping over itself, and across it by
      // its own pull, which is where it lags and bows
      for (let i = 0; i < n; i++) {
        const p = pts[i];
        if (p.dw > 0) {
          p.x += p.dx / p.dw;
          p.y += p.dy / p.dw;
          p.dx = 0; p.dy = 0; p.dw = 0;
        }
        const ex = p.hx - p.x, ey = p.hy - p.y, along = ex * p.tx + ey * p.ty;
        p.x += p.tx * along * SKIN.LEAD + (ex - p.tx * along) * p.pull;
        p.y += p.ty * along * SKIN.LEAD + (ey - p.ty * along) * p.pull;
      }
    }
  }

  // the grain kept: a gap between neighbours' homes past SPLIT takes as
  // many new points as bring it under, evenly along the outline between
  // them, each where the line between its neighbours is by as much and
  // where they were by as much, so it adds no speed; then, going round, a
  // point whose last kept neighbour's home and next one's are under JOIN
  // apart is dropped. no more than MOST, no fewer than LEAST
  space() {
    const o = this.shape, len = o.len, pts = this.points, n = pts.length, out = this.spare;
    out.length = 0;
    let count = n;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[i + 1 < n ? i + 1 : 0];
      out.push(p);
      let gap = q.s - p.s;
      if (gap < 0) gap += len;
      if (gap <= SKIN.SPLIT || count >= SKIN.MOST) continue;
      const m = Math.min(Math.ceil(gap / SKIN.SPLIT) - 1, SKIN.MOST - count);
      for (let j = 1; j <= m; j++) {
        const f = j / (m + 1);
        let s = p.s + gap * f;
        if (s >= len) s -= len;
        const np = Skin.point(Skin.uAt(o, s), p.x + (q.x - p.x) * f, p.y + (q.y - p.y) * f, p.px + (q.px - p.px) * f, p.py + (q.py - p.py) * f);
        Skin.place(o, np.u, np);
        out.push(np);
      }
      count += m;
    }
    // back into points, the dropped left out
    pts.length = 0;
    const m = out.length;
    let prev = out[m - 1], kept = m;
    for (let i = 0; i < m; i++) {
      const p = out[i], next = i + 1 < m ? out[i + 1] : pts[0];
      let span = next.s - prev.s;
      if (span < 0) span += len;
      if (span < SKIN.JOIN && kept > SKIN.LEAST) { kept--; continue; }
      pts.push(p);
      prev = p;
    }
  }

  // the points' box, { x0, y0, x1, y1 }
  bounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0, a = this.points; i < a.length; i++) {
      const p = a[i];
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
    return { x0, y0, x1, y1 };
  }

  // the points dy down, for drawing: one array of { x, y } kept and
  // refilled, each object made once, so a frame makes nothing per point
  screen(dy) {
    const pts = this.points, n = pts.length, pool = this.pool, view = this.view;
    while (pool.length < n) pool.push({ x: 0, y: 0 });
    view.length = n;
    for (let i = 0; i < n; i++) {
      const v = pool[i];
      v.x = pts[i].x;
      v.y = pts[i].y + dy;
      view[i] = v;
    }
    return view;
  }
}
