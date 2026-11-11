// --- the hands ---------------------------------------------------------------
// cicada's autonomous hands (its MainScene), bought in Personal work's box
// (index.html) and stepped by the bubble's world (js/softbody.js) every
// tick, before its blobs, once the world has had them share out the
// blobs (Hand.plan). a blob takes a crew of a hand for every spawn that
// went into it (Hand.crew), since every merge adds a spawn's worth of
// skin for a hand to drag, so a blob grown heavy by eating others is
// towed by as many hands as it has bubbles in it, and one short of hands
// struggles and breaks its holds. a hand with nothing in hand is given
// the blob that pays most for the time it takes to fetch, the pointer's
// and any whose crew all hold it already left out, the nearest hand
// getting each, the way to the one it is already after counted STICK
// times shorter. it comes up to APPROACH px off that blob's skin on its own side and, within
// REACH more, takes hold of the nearest point no other hold shares a
// point with, and its neighbours, as the pointer does (World.hold), so a
// crew holds side by side; then it heads for the centre blob with the
// blob in tow, easing off as the hold stretches past SLOWDOWN of the
// breakaway so the skin can keep up. if the skin lets go anyway the hand
// comes back for it; once the blob is eaten it looks for the next. with
// nothing to fetch it waits REST px out from the centre blob's skin at an
// angle of its own, a golden angle on from the hand before it. it moves
// as cicada's did: a push of so many px a step toward where it is going,
// DAMPING of its speed kept each step, never faster than TOP px a step,
// slower as it eases off, and inside the world. free it pushes ACCEL, a
// top speed near 140 px a second; towing it pushes cicada's TOW, times
// the square root of how many times cicada's its world's drag force is,
// so a stronger hold tows faster and never outruns the skin it holds. its
// x, y is the palm's middle, where its hold pulls. everything is in world
// px and 60 hz steps.

const HANDS = {
  APPROACH: 20, REACH: 5,                // px off a blob's skin it comes up to, and more it can still take hold from
  ACCEL: 0.15, TOW: 0.05,                // the push a step, free and towing at cicada's drag force
  DAMPING: 0.94, TOP: 6.5,               // cicada's share of speed kept a step, and the most
  SLOWDOWN: 0.8, SLOWEST: 0.1,           // of the breakaway a hold stretches before easing off, and the least speed it keeps
  STICK: 2,                              // the way to its own blob counts as this many times shorter, so it is switched or taken over only for clearly better
  REST: 40,                              // px out from the centre blob's skin where an idle hand waits
};

class Hand {
  // at x, y in its world; n, how many hands came before it, sets the angle
  // it waits at
  constructor(x, y, n = 0) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.target = null; // the blob it is after
    this.drag = null;   // its hold on it, while the world keeps it
    this.rest = -Math.PI / 2 + n * Math.PI * (3 - Math.sqrt(5));
  }

  // once a tick, before any hand steps: the hands share out the blobs.
  // a hand that lost its hold lets go, and one whose blob was eaten
  // forgets it. a hand still holding keeps its blob; every other is given
  // one by what it pays for the time: the blob's worth (Shop.reward)
  // shared among its crew, over the steps to come up to it at a free
  // hand's top speed and tow it to the centre blob's skin at a towing
  // one's, the way to its own blob counted STICK times shorter. a blob
  // has a place for each
  // of its crew not holding it already. the best pair of a hand and a
  // place goes first, then the best of the rest, and so on, so the
  // nearest hand gets each blob and no hand waits while a place it could
  // fill is open. a hand left over has none
  static plan(world) {
    const H = HANDS, hands = world.hands, blobs = world.blobs, centre = blobs[0];
    const free = [];
    for (let i = 0; i < hands.length; i++) {
      const h = hands[i];
      if (h.drag && !world.holds(h.drag)) {
        h.drag = null;
        h.vx *= 0.5;
        h.vy *= 0.5;
      }
      if (h.target && !blobs.includes(h.target)) h.target = null;
      if (!h.drag) free.push(h);
    }
    if (!centre || !free.length) return;

    // each open blob's places, middle, tow and pay a hand, once
    const keep = H.DAMPING / (1 - H.DAMPING);
    const fast = Math.min(H.TOP, H.ACCEL * keep);
    const slow = Math.min(H.TOP, H.TOW * Math.sqrt(world.dragForce / SOFT.DRAG.FORCE) * keep);
    const c = centre.getCenter(), open = [];
    for (let i = 1; i < blobs.length; i++) {
      const b = blobs[i];
      if (b.locked || (world.drag && world.drag.blob === b)) continue;
      const crew = Hand.crew(b);
      let places = crew;
      for (let j = 0; j < hands.length; j++) if (hands[j].drag && hands[j].drag.blob === b) places--;
      if (places <= 0) continue;
      const m = b.getCenter();
      const tow = Math.max(0, Math.hypot(m.x - c.x, m.y - c.y) - centre.radius - b.radius) / slow;
      open.push({ blob: b, x: m.x, y: m.y, places, tow, pay: Shop.reward(b.radius) / crew });
    }

    // what each free hand would earn a step on each, then the best pairs
    // in turn, a hand out once it has one and a blob once it is full
    const n = open.length, rate = new Float64Array(free.length * n);
    for (let i = 0; i < free.length; i++) {
      const h = free[i];
      for (let j = 0; j < n; j++) {
        const o = open[j];
        const come = Math.max(0, Math.hypot(o.x - h.x, o.y - h.y) - o.blob.radius - H.APPROACH) / fast;
        rate[i * n + j] = o.pay / (come / (h.target === o.blob ? H.STICK : 1) + o.tow + 1);
      }
      h.target = null;
    }
    for (let k = 0; k < free.length; k++) {
      let best = -1, most = 0;
      for (let q = 0; q < rate.length; q++) if (rate[q] > most) { most = rate[q]; best = q; }
      if (best < 0) break;
      const i = Math.floor(best / n), j = best % n;
      free[i].target = open[j].blob;
      for (let q = 0; q < n; q++) rate[i * n + q] = 0;
      if (--open[j].places === 0) for (let p = 0; p < free.length; p++) rate[p * n + j] = 0;
    }
  }

  // one step in world toward what it is after, and its hold carried with
  // it
  step(world) {
    const H = HANDS, centre = world.blobs[0];
    if (!centre) return;

    const c = centre.getCenter();
    let tx, ty, speed = 1;
    if (this.drag) {
      tx = c.x;
      ty = c.y;
      const p = this.drag.points[0].point;
      const stretch = Math.hypot(p.x - this.x, p.y - this.y) / SOFT.DRAG.BREAKAWAY;
      if (stretch > H.SLOWDOWN) speed = Math.max(H.SLOWEST, 1 - (stretch - H.SLOWDOWN) / (1 - H.SLOWDOWN));
    } else if (this.target) {
      const t = this.target.getCenter(), d = this.away(this.target), reach = this.target.radius + H.APPROACH;
      const ux = d > 0 ? (this.x - t.x) / d : 1, uy = d > 0 ? (this.y - t.y) / d : 0;
      tx = t.x + ux * reach;
      ty = t.y + uy * reach;
      if (d <= reach + H.REACH) {
        const i = this.grip(world, this.target);
        if (i !== -1) this.drag = world.hold(this.target, i);
      }
    } else {
      const r = centre.radius + H.REST;
      tx = c.x + r * Math.cos(this.rest);
      ty = c.y + r * Math.sin(this.rest);
    }
    const push = this.drag ? H.TOW * Math.sqrt(world.dragForce / SOFT.DRAG.FORCE) : H.ACCEL;
    this.move(tx, ty, push * speed, world);
    if (this.drag) {
      this.drag.x = this.x;
      this.drag.y = this.y;
    }
  }

  // the nearest point of blob whose hold, it and its neighbours as
  // World.hold takes them, shares no point with a hold already on blob;
  // -1 if every point's would
  grip(world, blob) {
    const taken = new Set();
    for (const d of [world.drag, ...world.held]) if (d && d.blob === blob) for (const p of d.points) taken.add(p.point);
    let index = -1, most = Infinity;
    blob.points.forEach((p, i) => {
      const d = Math.hypot(p.x - this.x, p.y - this.y);
      if (d < most && !blob.neighbors(i, 2).some((n) => taken.has(n.point))) { most = d; index = i; }
    });
    return index;
  }

  // how many hands blob takes: one for every spawn that went into it. a
  // merge joins two rings less a point of each at the seam, so a blob of
  // k spawns has k times two fewer than a spawn's points, and two
  static crew(blob) {
    const P = SOFT.SPAWN.POINTS;
    return Math.max(1, Math.round((blob.points.length - 2) / (P - 2)));
  }

  // how far a blob's centre is from the hand
  away(blob) {
    const c = blob.getCenter();
    return Math.hypot(c.x - this.x, c.y - this.y);
  }

  // a step toward (tx, ty), pushed push px; within a pixel of it, it slows
  // to a stop
  move(tx, ty, push, world) {
    const H = HANDS, dx = tx - this.x, dy = ty - this.y, d = Math.hypot(dx, dy);
    if (d > 1) {
      this.vx = (this.vx + dx / d * push) * H.DAMPING;
      this.vy = (this.vy + dy / d * push) * H.DAMPING;
      const v = Math.hypot(this.vx, this.vy), top = H.TOP;
      if (v > top) { this.vx *= top / v; this.vy *= top / v; }
      this.x += this.vx;
      this.y += this.vy;
    } else {
      this.vx *= 0.5;
      this.vy *= 0.5;
    }
    this.x = Math.min(Math.max(this.x, 0), world.w);
    this.y = Math.min(Math.max(this.y, 0), world.h);
  }
}
