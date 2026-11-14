// --- the mixing tray -------------------------------------------------------------
// wet paint for the graffiti wall's colours. one grid: the tray, w by h px
// with its top left at (0, 0), and up rows of air above it, y from -up to
// -1, where the colours' cells are. paint rests only on the tray, as
// grains, a pile of them a pixel, the top one seen. a grain's paint is
// [m, m * ks(r), m * ks(g), m * ks(b)]: its pigment load and, a channel
// each, what it absorbs over what it scatters. two grains that rub trade
// FRICTION of their difference, so paint is never made or lost; a grain
// shows as the list's colour nearest its paint in lab.
// a press on a cell holds a pen's worth of its colour, grains packed in
// the cell round the press, where they are not drawn. as the pointer pulls
// away they are let go, more the farther out it is, and chase it through
// the air; over the tray they come down where they are, picked up by the
// pen. let go before the tray, they run back into the cell. a press on the
// tray picks up the paint under the pen and all the paint touching it.
// each step every grain picked up that answers the pen's grip takes a step
// toward it, the nearest first, into an empty spot nearer it or round a
// corner; one that runs into paint not picked up picks it up; one on a
// pile slides off outward; one kept from its spot may rub the one in it,
// a step of that for each px the pen has come. a grain that slides rubs
// the one it slid off, the one it lands on and the one it comes up
// against. let go, every grain answers, and once nothing moves the paint
// is put down: a glob out of a cell that picked nothing else up takes the
// pen's exact shape, and the colour the paint shows nearest the pen is
// kept as the one mixed. a tap on a cell or on paint picks that colour.
// shares() is the tray as one paint: the colours it shows, each with its
// share of the tray's pixels.
// while flow is on, a cell held goes on giving paint, FLOW pens' worths a
// second: a new grain in each of the glob's places in the cell left empty,
// no more in the air at once than a second's worth. the tray keeps FULL of
// the biggest pen's worths of paint: what is over that dries away, DRY of
// it a second, a grain at a time off the paint's edges, what sticks out
// first.
// nothing here keeps time or draws: step(dt) takes FOLLOW steps a 1/60 s
// of the dt given, and paint() and flying() hand the picture over.

const MIX = {
  FOLLOW: 8,      // steps the paint takes a 1/60 s
  FRICTION: 0.5,  // the share of their difference two grains that rub trade: 0.5 leaves both their even mix
  GRIP: 0.6,      // the chance a grain answers the pen's pull each step while it is down; let go, all do
  PULL: 24,       // px out of its cell at which the pointer has drawn a whole glob out
  FLOW: 2,        // pens' worths a second a cell held gives while flow is on, and the most of them in the air at once
  FULL: 6,        // the paint the tray keeps, in the biggest pen's worths (WALL.SIZES)
  DRY: 0.2,       // the share of the paint over that which dries away a second
  PRESS: 0.12,    // the chance a grain kept from its spot rubs the one in it, each step the pen's travel pays for
  TRAVEL: 64,     // the most of those steps the pen's travel banks
  JITTER: 1.5,    // the random px squared added to a spot's distance, so grains choose among spots alike
  FLOOR: 0.02,    // the least reflectance a colour's channel is taken to have
  PAPER: 3,       // colour 0's pigment strength, the paper: it pulls hard
  BLACK: 0.3,     // colour 1's, black: it pulls weakly. every other colour's is 1
  DX: [1, 1, 0, -1, -1, -1, 0, 1], // the eight steps a grain can take
  DY: [0, 1, 1, 1, 0, -1, -1, -1],
};

class Mix {
  constructor(colours, w, h, up, random = Math.random) {
    this.w = w;
    this.h = h;
    this.up = up;
    this.random = random;
    const m = colours.length, one = new Float64Array(4);
    this.lp = new Float64Array(4 * m);   // each list colour's paint, at its strength
    this.lab = new Float64Array(3 * m);  // each list colour's lab
    for (let i = 0; i < m; i++) {
      Mix.paintOf(colours[i], i === 0 ? MIX.PAPER : i === 1 ? MIX.BLACK : 1, this.lp, 4 * i);
      Mix.paintOf(colours[i], 1, one, 0);
      Mix.labOf(one, 0, this.lab, 3 * i);
    }
    this.l3 = new Float64Array(3);       // a grain's lab, worked out
    // the tray: each pile a list from its top down through below
    this.top = new Int32Array(w * h).fill(-1);
    this.tall = new Int32Array(w * h);
    this.stack = new Int32Array(w * h);  // the piles grab() is still to spread from
    this.n = 0;                          // grains on the tray
    this.cap = 0;
    this.grow(1024);
    this.air = new Uint8Array(w * (up + h)); // where a grain in the air is
    this.held = null;     // a glob out of a cell, in the air
    this.tip = null;      // the pen on the tray: { x, y, moved, done, glob, travel }
    this.tn = 0;          // the grains it has picked up, in tg
    this.size = 1;        // the pen's diameter
    this.owed = 0;        // a step not yet taken, as a fraction
    this.colour = -1;     // the colour of the glob in the air, -1 when none
    this.dirty = true;
    this.feet = {};
    this.flow = false;    // whether a cell held goes on giving paint: the page's to set
    this.most = MIX.FULL * this.foot(WALL.SIZES[WALL.SIZES.length - 1]).n; // the grains the tray keeps
    this.drying = 0;      // a grain not yet dried away, as a fraction
    this.mixed = -1;      // the colour the paint last dragged shows nearest where the pen left it, once it is put down: the page's to take, and to set back to -1
    this.nk = new Float64Array(8); // a grain's spots nearer the pen, by distance plus a jitter
    this.nc = new Int8Array(8);
    this.outs = new Int8Array(8);  // the piles it can slide onto, those farther out
    this.anys = new Int8Array(8);
  }

  static lin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  static ks(r) { return (1 - r) * (1 - r) / (2 * r); }
  static back(k) { return 1 + k - Math.sqrt(k * k + 2 * k); }
  static f(v) { return v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116; }

  // the paint of '#rrggbb' at strength s, into out at o
  static paintOf(hex, s, out, o) {
    out[o] = s;
    for (let c = 0; c < 3; c++) {
      const r = Math.max(MIX.FLOOR, Mix.lin(parseInt(hex.slice(1 + 2 * c, 3 + 2 * c), 16) / 255));
      out[o + 1 + c] = s * Mix.ks(r);
    }
  }

  // the lab of the paint in p at o, into out at q
  static labOf(p, o, out, q) {
    const R = Mix.back(p[o + 1] / p[o]), G = Mix.back(p[o + 2] / p[o]), B = Mix.back(p[o + 3] / p[o]);
    const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.9505;
    const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.089;
    const fx = Mix.f(X), fy = Mix.f(Y), fz = Mix.f(Z);
    out[q] = 116 * fy - 16;
    out[q + 1] = 500 * (fx - fy);
    out[q + 2] = 200 * (fy - fz);
  }

  // room for cap grains, those there kept
  grow(cap) {
    const n = this.n;
    const re = (old, T, k) => {
      const a = new T(cap * k);
      if (old) a.set(old.subarray(0, n * k));
      return a;
    };
    this.gx = re(this.gx, Int32Array, 1);
    this.gy = re(this.gy, Int32Array, 1);
    this.p = re(this.p, Float64Array, 4);     // each grain's paint
    this.seen = re(this.seen, Int32Array, 1); // the list colour it shows, when not stale
    this.stale = re(this.stale, Uint8Array, 1);
    this.picked = re(this.picked, Uint8Array, 1); // picked up by the pen
    this.below = re(this.below, Int32Array, 1);   // the grain under it, -1 for none
    this.tg = re(this.tg, Int32Array, 1);
    this.keys = new Float64Array(cap);
    this.was = new Int32Array(cap);
    this.cap = cap;
  }

  // the pixels a pen of this size covers, as offsets from its point
  foot(size) {
    let f = this.feet[size];
    if (f) return f;
    const n = 40, mask = new Uint8Array(n * n);
    Wall.stamp(mask, n, n, n / 2, n / 2, size, 1);
    let m = 0;
    for (let i = 0; i < mask.length; i++) m += mask[i];
    const dx = new Int8Array(m), dy = new Int8Array(m);
    for (let i = 0, k = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      dx[k] = i % n - n / 2;
      dy[k++] = Math.floor(i / n) - n / 2;
    }
    return this.feet[size] = { n: m, dx, dy, mask };
  }

  // the list colour grain g shows
  shows(g) {
    if (this.stale[g]) {
      Mix.labOf(this.p, 4 * g, this.l3, 0);
      const lab = this.lab, l = this.l3[0], a = this.l3[1], b = this.l3[2];
      let best = 0, bd = Infinity;
      for (let i = 0, j = 0; j < lab.length; i++, j += 3) {
        const dl = lab[j] - l, da = lab[j + 1] - a, db = lab[j + 2] - b, e = dl * dl + da * da + db * db;
        if (e < bd) { bd = e; best = i; }
      }
      this.seen[g] = best;
      this.stale[g] = 0;
    }
    return this.seen[g];
  }

  // two grains rub: each takes FRICTION of the difference from the other
  rub(a, b) {
    const P = this.p, i = 4 * a, j = 4 * b;
    if (Math.abs(P[i] - P[j]) + Math.abs(P[i + 1] - P[j + 1]) + Math.abs(P[i + 2] - P[j + 2]) + Math.abs(P[i + 3] - P[j + 3]) < 1e-9) return;
    for (let k = 0; k < 4; k++) {
      const d = MIX.FRICTION * (P[j + k] - P[i + k]);
      P[i + k] += d;
      P[j + k] -= d;
    }
    this.stale[a] = this.stale[b] = 1;
    this.dirty = true;
  }

  // grain g gone from the tray, the last grain taking its number
  gone(g) {
    const w = this.w, top = this.top, below = this.below, tg = this.tg;
    // whatever lies on grain a, or its pile's top, is to instead: its pile
    const unpile = (a, to) => {
      const p = this.gy[a] * w + this.gx[a];
      if (top[p] === a) top[p] = to;
      else {
        let o = top[p];
        while (below[o] !== a) o = below[o];
        below[o] = to;
      }
      return p;
    };
    // out of its pile, and out of the pen's grains if it was picked up
    this.tall[unpile(g, below[g])]--;
    if (this.picked[g]) {
      tg[tg.indexOf(g)] = tg[--this.tn];
      if (this.tip && this.tip.glob) this.tip.glob--;
    }
    const l = --this.n;
    if (l !== g) {
      unpile(l, g);
      if (this.picked[l]) tg[tg.indexOf(l)] = g;
      this.gx[g] = this.gx[l];
      this.gy[g] = this.gy[l];
      for (let k = 0; k < 4; k++) this.p[4 * g + k] = this.p[4 * l + k];
      this.seen[g] = this.seen[l];
      this.stale[g] = this.stale[l];
      this.picked[g] = this.picked[l];
      below[g] = below[l];
    }
    this.dirty = true;
  }

  // how many of the eight places round (x, y) that are on the tray have no paint
  bare(x, y) {
    const w = this.w, h = this.h, top = this.top;
    let n = 0;
    for (let c = 0; c < 8; c++) {
      const qx = x + MIX.DX[c], qy = y + MIX.DY[c];
      if (qx >= 0 && qy >= 0 && qx < w && qy < h && top[qy * w + qx] < 0) n++;
    }
    return n;
  }

  // dt of the paint over most drying away, DRY of what is over a second, a
  // grain at a time: from any grain, a straight walk each of the eight
  // ways to where the paint ends, and the top grain gone from the barest
  // of those ends, so the paint goes from its edges, what sticks out first
  dry(dt) {
    const over = this.n - this.most;
    if (over <= 0) {
      this.drying = 0;
      return;
    }
    this.drying += over * (1 - Math.exp(-MIX.DRY * dt));
    const w = this.w, h = this.h, top = this.top, rand = this.random;
    for (; this.drying >= 1 && this.n > this.most; this.drying--) {
      const g = Math.floor(rand() * this.n);
      let end = 0, most = -1, ties = 0;
      for (let c = 0; c < 8; c++) {
        let x = this.gx[g], y = this.gy[g];
        for (;;) {
          const qx = x + MIX.DX[c], qy = y + MIX.DY[c];
          if (qx < 0 || qy < 0 || qx >= w || qy >= h || top[qy * w + qx] < 0) break;
          x = qx;
          y = qy;
        }
        const e = this.bare(x, y);
        if (e > most) {
          most = e;
          ties = 0;
        }
        // one of the barest alike, each as likely
        if (e === most && rand() * ++ties < 1) end = y * w + x;
      }
      this.gone(top[end]);
    }
  }

  // the grains of pile i not yet picked up are: whether there were any
  pickUp(i) {
    const picked = this.picked, below = this.below;
    let fresh = false;
    for (let g = this.top[i]; g >= 0; g = below[g]) {
      if (picked[g]) continue;
      picked[g] = 1;
      this.tg[this.tn++] = g;
      fresh = true;
    }
    return fresh;
  }

  // the paint at (x, y) is picked up, and all the paint touching it
  grab(x, y) {
    const w = this.w, h = this.h, stack = this.stack, DX = MIX.DX, DY = MIX.DY;
    if (!this.pickUp(y * w + x)) return;
    let s = 0;
    stack[s++] = y * w + x;
    while (s) {
      const i = stack[--s], cx = i % w, cy = (i - cx) / w;
      for (let c = 0; c < 8; c++) {
        const qx = cx + DX[c], qy = cy + DY[c];
        if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
        if (this.pickUp(qy * w + qx)) stack[s++] = qy * w + qx;
      }
    }
  }

  // so is whatever is under the pen at (x, y)
  take(x, y) {
    const f = this.foot(this.size);
    for (let k = 0; k < f.n; k++) {
      const qx = x + f.dx[k], qy = y + f.dy[k];
      if (qx >= 0 && qy >= 0 && qx < this.w && qy < this.h) this.grab(qx, qy);
    }
  }

  // the pen to (x, y) on the tray a px at a time, picking up along the way
  penTo(x, y) {
    const t = this.tip;
    x = Math.max(0, Math.min(this.w - 1, x));
    y = Math.max(0, Math.min(this.h - 1, y));
    const x0 = t.x, y0 = t.y, n = Math.max(Math.abs(x - x0), Math.abs(y - y0));
    t.travel = Math.min(MIX.TRAVEL, t.travel + n);
    for (let k = 1; k <= n; k++) {
      t.x = Math.round(x0 + (x - x0) * k / n);
      t.y = Math.round(y0 + (y - y0) * k / n);
      t.moved = true;
      this.take(t.x, t.y);
    }
  }

  // grain g a step (dx, dy): it rubs the one it slid off, the one it lands
  // on and the one it comes up against
  go(g, dx, dy) {
    const w = this.w, top = this.top, tall = this.tall, below = this.below;
    const x = this.gx[g], y = this.gy[g], p = y * w + x, tx = x + dx, ty = y + dy, q = ty * w + tx;
    top[p] = below[g];
    tall[p]--;
    if (top[p] >= 0) this.rub(g, top[p]);
    if (top[q] >= 0) this.rub(g, top[q]);
    below[g] = top[q];
    top[q] = g;
    tall[q]++;
    this.gx[g] = tx;
    this.gy[g] = ty;
    const ox = tx + dx, oy = ty + dy;
    if (ox >= 0 && oy >= 0 && ox < w && oy < this.h && top[oy * w + ox] >= 0) this.rub(g, top[oy * w + ox]);
    this.dirty = true;
  }

  // every grain picked up that answers the pen's grip takes a step toward
  // it, the nearest first, into an empty spot nearer it. one that runs into
  // paint not picked up picks it up. one lying on another with nowhere
  // nearer slides off outward. let go, every grain answers. returns how
  // many moved
  sweep() {
    const t = this.tip, w = this.w, h = this.h, rand = this.random, DX = MIX.DX, DY = MIX.DY;
    const gx = this.gx, gy = this.gy, top = this.top, tall = this.tall, picked = this.picked, tg = this.tg;
    const px = t.x, py = t.y;
    // nearest the pen first, ties as they were
    const n = this.tn, keys = this.keys, was = this.was;
    for (let k = 0; k < n; k++) {
      const g = tg[k], dx = gx[g] - px, dy = gy[g] - py;
      keys[k] = (dx * dx + dy * dy) * n + k;
      was[k] = g;
    }
    const sorted = keys.subarray(0, n).sort();
    for (let k = 0; k < n; k++) tg[k] = was[sorted[k] % n];
    // a grain kept from the spot it is pulled toward may rub the one in it, a
    // step of this for each px the pen has come, so nothing mixes while it is still
    const press = t.travel > 0;
    if (t.travel > 0) t.travel--;
    const nk = this.nk, nc = this.nc, outs = this.outs, anys = this.anys;
    let moved = 0;
    // grains picked up on the way are taken in turn after the rest
    for (let i = 0; i < this.tn; i++) {
      const g = tg[i], x = gx[g], y = gy[g], ht = tall[y * w + x];
      if (top[y * w + x] !== g) continue;
      const gd = (x - px) * (x - px) + (y - py) * (y - py);
      const pulled = t.done || rand() < MIX.GRIP;
      let went = false;
      if (pulled) {
        let m = 0;
        for (let c = 0; c < 8; c++) {
          const qx = x + DX[c], qy = y + DY[c];
          if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
          const d = (qx - px) * (qx - px) + (qy - py) * (qy - py);
          if (d >= gd) continue;
          const k = d + MIX.JITTER * rand();
          let j = m++;
          for (; j > 0 && nk[j - 1] > k; j--) { nk[j] = nk[j - 1]; nc[j] = nc[j - 1]; }
          nk[j] = k;
          nc[j] = c;
        }
        for (let j = 0; j < m && j < 3 && !went; j++) {
          const c = nc[j], qx = x + DX[c], qy = y + DY[c], o = top[qy * w + qx];
          if (o < 0) {
            this.go(g, DX[c], DY[c]);
            went = true;
          } else if (j === 0 && !picked[o]) {
            this.rub(g, o);
            this.grab(qx, qy);
          } else if (j === 0 && press && rand() < MIX.PRESS) this.rub(g, o);
        }
        if (!went && ht === 1) {
          // nowhere nearer beside it: round a corner, a step aside and one on,
          // if that ends nearer than it began
          let bc = -1, be = -1, bd = 0;
          for (let c = 0; c < 8; c++) {
            const mx = x + DX[c], my = y + DY[c];
            if (mx < 0 || my < 0 || mx >= w || my >= h || top[my * w + mx] >= 0) continue;
            for (let e = 0; e < 8; e++) {
              const qx = mx + DX[e], qy = my + DY[e];
              if (qx < 0 || qy < 0 || qx >= w || qy >= h || top[qy * w + qx] >= 0) continue;
              const d = (qx - px) * (qx - px) + (qy - py) * (qy - py);
              if (d < gd && (bc < 0 || d < bd)) { bc = c; be = e; bd = d; }
            }
          }
          if (bc >= 0) {
            this.go(g, DX[bc], DY[bc]);
            this.go(g, DX[be], DY[be]);
            went = true;
          }
        }
      }
      if (!went && ht > 1) {
        // onto one of the shortest piles beside it that is empty or picked
        // up, one farther out if there is one
        let low = ht, no = 0, na = 0;
        for (let c = 0; c < 8; c++) {
          const qx = x + DX[c], qy = y + DY[c];
          if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
          const q = qy * w + qx, hq = tall[q];
          if (hq >= ht || hq > low || (hq && !picked[top[q]])) continue;
          if (hq < low) { low = hq; no = 0; na = 0; }
          anys[na++] = c;
          if ((qx - px) * (qx - px) + (qy - py) * (qy - py) > gd) outs[no++] = c;
        }
        if (na) {
          const c = no ? outs[Math.floor(rand() * no)] : anys[Math.floor(rand() * na)];
          this.go(g, DX[c], DY[c]);
          went = true;
        }
      }
      if (went) moved++;
    }
    return moved;
  }

  // whether a grain in the air is kept from (x, y): another is there, or paint the pen has picked up is
  taken(x, y) {
    if (this.air[(y + this.up) * this.w + x]) return true;
    if (!this.tip || y < 0) return false;
    const g = this.top[y * this.w + x];
    return g >= 0 && this.picked[g] === 1;
  }

  // room in the glob held for more grains: those in the air numbered again
  // from 0, and the room doubled when they more than half fill it
  room() {
    const hd = this.held, n = hd.n, cap = Math.max(16, 2 * n > hd.cap ? 2 * hd.cap : hd.cap);
    const xs = new Int32Array(cap), ys = new Int32Array(cap), out = new Float64Array(cap), free = new Uint8Array(cap), list = new Int32Array(cap);
    for (let k = 0; k < n; k++) {
      const g = hd.list[k];
      xs[k] = hd.xs[g];
      ys[k] = hd.ys[g];
      out[k] = hd.out[g];
      free[k] = hd.free[g];
      list[k] = k;
    }
    Object.assign(hd, { xs, ys, out, free, list, keys: new Float64Array(cap), was: new Int32Array(cap), cap, made: n });
  }

  // a step of the cell held giving more paint: a new grain in each of the
  // glob's places in it that is empty, the nearest the press first, FLOW
  // pens' worths a second, while no more than a second's worth is in the air
  pour() {
    const hd = this.held, n = hd.sx.length, w = this.w, up = this.up;
    hd.owed = Math.min(n, hd.owed + MIX.FLOW * n / (60 * MIX.FOLLOW));
    for (let k = 0; k < n && hd.owed >= 1 && hd.n < MIX.FLOW * n; k++) {
      const i = (hd.sy[k] + up) * w + hd.sx[k];
      if (this.air[i]) continue;
      if (hd.made === hd.cap) this.room();
      const g = hd.made++;
      hd.xs[g] = hd.sx[k];
      hd.ys[g] = hd.sy[k];
      hd.out[g] = this.random();
      hd.free[g] = 0;
      hd.list[hd.n++] = g;
      this.air[i] = 1;
      hd.owed--;
      // more than a pen's worth: it does not take the pen's shape put down
      hd.poured = true;
      if (this.tip) this.tip.glob = 0;
    }
  }

  // every grain of the glob let go of its cell takes a step toward the pen,
  // or home once let go before the tray, into an empty spot nearer it.
  // returns how many moved
  airSweep() {
    const hd = this.held, t = this.tip, w = this.w, h = this.h, up = this.up, air = this.air;
    const rand = this.random, DX = MIX.DX, DY = MIX.DY, half = this.size % 2 ? 0 : 0.5;
    let px, py;
    if (hd.back) {
      px = (hd.x0 + hd.x1 - 1) / 2;
      py = (hd.y0 + hd.y1 - 1) / 2;
    } else {
      px = (t ? t.x : hd.x) - half;
      py = (t ? t.y : hd.y) - half;
    }
    const far = hd.done ? Infinity : Math.hypot(Math.max(hd.x0 - hd.x, 0, hd.x - hd.x1 + 1), Math.max(hd.y0 - hd.y, 0, hd.y - hd.y1 + 1));
    // nearest first, ties as they were: four times a distance is whole
    const xs = hd.xs, ys = hd.ys, list = hd.list, n = hd.n, keys = hd.keys, was = hd.was;
    for (let k = 0; k < n; k++) {
      const g = list[k], dx = xs[g] - px, dy = ys[g] - py;
      keys[k] = 4 * (dx * dx + dy * dy) * n + k;
      was[k] = g;
    }
    const sorted = keys.subarray(0, n).sort();
    for (let k = 0; k < n; k++) list[k] = was[sorted[k] % n];
    let moved = 0;
    for (let k = 0; k < n; k++) {
      const g = list[k];
      if (!hd.free[g]) {
        if (hd.out[g] * MIX.PULL >= far) continue;
        hd.free[g] = 1;
      }
      if (!hd.done && rand() >= MIX.GRIP) continue;
      const x = xs[g], y = ys[g], gd = (x - px) * (x - px) + (y - py) * (y - py);
      let found = false, best = 0, bx = 0, by = 0;
      for (let c = 0; c < 8; c++) {
        const qx = x + DX[c], qy = y + DY[c];
        if (qx < 0 || qy < -up || qx >= w || qy >= h || this.taken(qx, qy)) continue;
        const d = (qx - px) * (qx - px) + (qy - py) * (qy - py);
        if (d >= gd) continue;
        const e = gd - d - MIX.JITTER * rand();
        if (!found || e > best) { found = true; best = e; bx = qx; by = qy; }
      }
      if (!found) continue;
      air[(y + up) * w + x] = 0;
      xs[g] = bx;
      ys[g] = by;
      air[(by + up) * w + bx] = 1;
      moved++;
    }
    if (hd.back) {
      // those back in the cell are home
      let m = 0;
      for (let k = 0; k < hd.n; k++) {
        const g = list[k];
        if (xs[g] >= hd.x0 && xs[g] < hd.x1 && ys[g] >= hd.y0 && ys[g] < hd.y1) air[(ys[g] + up) * w + xs[g]] = 0;
        else list[m++] = g;
      }
      hd.n = m;
    }
    if (moved) this.dirty = true;
    return moved;
  }

  // a grain of the glob onto the tray at (x, y), picked up, taking along
  // whatever it comes down on
  down(x, y) {
    this.grab(x, y);
    if (this.n === this.cap) this.grow(2 * this.cap);
    const g = this.n++, c = this.held.colour, p = y * this.w + x;
    for (let k = 0; k < 4; k++) this.p[4 * g + k] = this.lp[4 * c + k];
    this.seen[g] = c;
    this.stale[g] = 0;
    this.picked[g] = 1;
    this.gx[g] = x;
    this.gy[g] = y;
    this.below[g] = this.top[p];
    this.top[p] = g;
    this.tall[p]++;
    this.tg[this.tn++] = g;
    this.dirty = true;
  }

  // each grain in the air over the tray comes down where it is
  alight() {
    const hd = this.held, w = this.w, up = this.up;
    let m = 0;
    for (let k = 0; k < hd.n; k++) {
      const g = hd.list[k], x = hd.xs[g], y = hd.ys[g];
      if (y < 0) { hd.list[m++] = g; continue; }
      this.air[(y + up) * w + x] = 0;
      this.down(x, y);
    }
    hd.n = m;
  }

  // those left in the air come down on the nearest of the tray
  strand() {
    const hd = this.held;
    for (let k = 0; k < hd.n; k++) {
      const g = hd.list[k], x = hd.xs[g], y = hd.ys[g];
      this.air[(y + this.up) * this.w + x] = 0;
      this.down(x, Math.max(0, y));
    }
    hd.n = 0;
  }

  // the glob gone, any of it still in the air with it
  letGo() {
    const hd = this.held;
    for (let k = 0; k < hd.n; k++) {
      const g = hd.list[k];
      this.air[(hd.ys[g] + this.up) * this.w + hd.xs[g]] = 0;
    }
    this.held = null;
    this.colour = -1;
    this.dirty = true;
  }

  // the paint picked up is put down. a glob out of a cell that picked
  // nothing else up takes the pen's shape: the grains outside it, or on
  // another, take the empty places in it
  putDown() {
    const t = this.tip, w = this.w, h = this.h, top = this.top, tall = this.tall;
    if (t.glob && this.tn === t.glob) {
      const f = this.foot(this.size), empty = [];
      for (let k = 0; k < f.n; k++) {
        const x = t.x + f.dx[k], y = t.y + f.dy[k];
        if (x >= 0 && y >= 0 && x < w && y < h && top[y * w + x] < 0) empty.push(y * w + x);
      }
      for (let i = 0; i < this.tn && empty.length; i++) {
        const g = this.tg[i], x = this.gx[g], y = this.gy[g], p = y * w + x;
        const dx = x - t.x + 20, dy = y - t.y + 20;
        const inside = dx >= 0 && dy >= 0 && dx < 40 && dy < 40 && f.mask[dy * 40 + dx] === 1;
        if ((inside && tall[p] === 1) || top[p] !== g) continue;
        const q = empty.pop();
        top[p] = this.below[g];
        tall[p]--;
        this.below[g] = top[q];
        top[q] = g;
        tall[q]++;
        this.gx[g] = q % w;
        this.gy[g] = (q - q % w) / w;
        this.dirty = true;
      }
    }
    // dragged, the colour it shows nearest the pen is the one mixed
    let near = -1, nd = Infinity;
    for (let i = 0; i < this.tn; i++) {
      const g = this.tg[i], dx = this.gx[g] - t.x, dy = this.gy[g] - t.y;
      this.picked[g] = 0;
      if (t.moved && dx * dx + dy * dy < nd && top[this.gy[g] * w + this.gx[g]] === g) {
        nd = dx * dx + dy * dy;
        near = g;
      }
    }
    if (near >= 0) this.mixed = this.shows(near);
    this.tn = 0;
    this.tip = null;
  }

  // one step of the glob in the air and of the paint picked up: how many grains moved
  once() {
    let moved = 0;
    if (this.held) {
      if (this.flow && !this.held.done) this.pour();
      moved += this.airSweep();
      if (this.tip && !this.held.back) this.alight();
    }
    if (this.tip && this.tip.moved) moved += this.sweep();
    return moved;
  }

  // whatever is still settling from the last drag is finished at once, a
  // drag still on let go first
  settle() {
    if ((this.held && !this.held.done) || (this.tip && !this.tip.done)) this.lift();
    for (let k = 0; k < 4000 && this.held && this.held.done; k++) {
      const moved = this.once();
      if (!this.held.back && this.tip && !moved && this.held.n) this.strand();
      if ((this.held.back || this.tip) && !this.held.n) this.letGo();
    }
    if (this.held) this.letGo();
    if (!this.tip) return;
    for (let k = 0; k < 2000 && this.tip.moved && this.sweep(); k++);
    this.putDown();
  }

  // a press on colour's cell at (x, y): a pen's worth of its paint, packed in
  // box, the inside of the cell, nearest the press. size is the pen's diameter
  hold(colour, x, y, box, size) {
    this.settle();
    const w = this.w, h = this.h, up = this.up;
    x = Math.max(0, Math.min(w - 1, Math.round(x)));
    y = Math.max(-up, Math.min(h - 1, Math.round(y)));
    this.size = size;
    const spots = [];
    for (let qy = Math.max(-up, box.y0); qy < Math.min(h, box.y1); qy++) {
      for (let qx = Math.max(0, box.x0); qx < Math.min(w, box.x1); qx++) spots.push({ x: qx, y: qy, d: (qx - x) * (qx - x) + (qy - y) * (qy - y) });
    }
    spots.sort((a, b) => a.d - b.d);
    const n = Math.min(spots.length, this.foot(size).n);
    const hd = {
      colour, x, y, moved: false, done: false, back: false,
      x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1,
      n,                            // grains still in the air, in list
      made: n, cap: n,              // the next grain's number, and the room there is for them
      sx: new Int32Array(n), sy: new Int32Array(n), // the glob's places in the cell
      owed: 0, poured: false,       // of flow: a grain not yet given, as a fraction, and whether any has been
      xs: new Int32Array(n), ys: new Int32Array(n),
      out: new Float64Array(n),     // how far out, of PULL, the pointer lets each go
      free: new Uint8Array(n),      // let go of the cell
      list: new Int32Array(n), keys: new Float64Array(n), was: new Int32Array(n),
    };
    for (let k = 0; k < n; k++) {
      hd.xs[k] = hd.sx[k] = spots[k].x;
      hd.ys[k] = hd.sy[k] = spots[k].y;
      hd.out[k] = this.random();
      hd.list[k] = k;
      this.air[(spots[k].y + up) * w + spots[k].x] = 1;
    }
    this.held = hd;
    this.colour = colour;
    this.dirty = true;
  }

  // a press on the tray at (x, y): the paint under the pen picked up
  press(x, y, size) {
    this.settle();
    x = Math.max(0, Math.min(this.w - 1, Math.round(x)));
    y = Math.max(0, Math.min(this.h - 1, Math.round(y)));
    this.size = size;
    this.tip = { x, y, moved: false, done: false, glob: 0, travel: 0 };
    this.tn = 0;
    this.take(x, y);
  }

  move(x, y) {
    x = Math.max(0, Math.min(this.w - 1, Math.round(x)));
    y = Math.max(-this.up, Math.min(this.h - 1, Math.round(y)));
    const hd = this.held;
    if (hd && !hd.done) {
      // more than 2 px outside the box, or on the tray, the pointer has left the cell
      const ox = Math.max(hd.x0 - x, 0, x - hd.x1 + 1), oy = Math.max(hd.y0 - y, 0, y - hd.y1 + 1);
      if (Math.max(ox, oy) > 2 || y >= 0) hd.moved = true;
      hd.x = x;
      hd.y = y;
      // over the tray: the pen drags there from here on, and the glob comes down as it arrives
      if (!this.tip && y >= 0) {
        this.tip = { x, y, moved: true, done: false, glob: hd.poured ? 0 : hd.n, travel: 0 };
        this.tn = 0;
        this.take(x, y);
        this.alight();
      }
    }
    if (this.tip && !this.tip.done) this.penTo(x, y);
  }

  lift() {
    let pick = -1;
    const hd = this.held, t = this.tip;
    if (hd && !hd.done) {
      if (!hd.moved) {
        pick = hd.colour;
        this.letGo();
      } else {
        hd.done = true;
        if (!t) {
          hd.back = true;
          hd.free.fill(1);
        }
      }
    }
    if (t && !t.done) {
      if (t.moved) t.done = true;
      else {
        const g = this.top[t.y * this.w + t.x];
        if (g >= 0) pick = this.shows(g);
        this.putDown();
      }
    }
    return { pick };
  }

  // dt of drying (dry), then
  // FOLLOW steps a 1/60 s of dt, the fraction carried to the next call, no
  // more than four frames' worth at once. while the pen is down every step
  // is taken, as a step that moves nothing may be followed by one that
  // does; let go, the steps end at one that moves nothing, and then the
  // glob's last grains come down, the glob is done with once none is left
  // in the air, and the paint is put down
  step(dt) {
    this.dry(dt);
    this.owed += MIX.FOLLOW * 60 * dt;
    let n = Math.floor(this.owed);
    this.owed -= n;
    n = Math.min(n, 4 * MIX.FOLLOW);
    if (n <= 0) return;
    const down = (this.held && !this.held.done) || (this.tip && !this.tip.done);
    let moved = 1;
    for (let k = 0; k < n && (moved || down); k++) moved = this.once();
    if (this.held && this.tip && this.held.done && !moved && this.held.n) {
      this.strand();
      moved = 1;
    }
    if (this.held && this.held.done && !this.held.n) this.letGo();
    if (this.tip && this.tip.moved && this.tip.done && !moved && !this.held) this.putDown();
  }

  clear() {
    if (this.held) this.letGo();
    this.tip = null;
    this.tn = 0;
    this.top.fill(-1);
    this.tall.fill(0);
    this.n = 0;
    this.drying = 0;
    this.mixed = -1;
    this.dirty = true;
  }

  // the tray as a picture: each pixel lut[the colour its top grain shows], or empty
  paint(px, lut, empty) {
    const top = this.top;
    for (let i = 0; i < top.length; i++) px[i] = top[i] < 0 ? empty : lut[this.shows(top[i])];
  }

  // the colours the tray shows, the one on the most pixels first and no
  // more of them than most, each with its share of those pixels as a
  // weight, the first's 255 and none under 1: { colours, weights }, or
  // null with no paint
  shares(most) {
    const top = this.top, counts = new Map();
    for (let i = 0; i < top.length; i++) {
      if (top[i] < 0) continue;
      const c = this.shows(top[i]);
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    if (!counts.size) return null;
    const by = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, most);
    return { colours: by.map((e) => e[0]), weights: by.map((e) => Math.max(1, Math.round(255 * e[1] / by[0][1]))) };
  }

  // fn(x, y) for each grain in the air outside its cell, all of them this.colour
  flying(fn) {
    const hd = this.held;
    if (!hd) return;
    for (let k = 0; k < hd.n; k++) {
      const g = hd.list[k], x = hd.xs[g], y = hd.ys[g];
      if (x < hd.x0 || x >= hd.x1 || y < hd.y0 || y >= hd.y1) fn(x, y);
    }
  }

  get busy() { return this.held !== null || this.tip !== null; }

  count() { return this.n; }
}
