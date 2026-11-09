// --- the hands ---------------------------------------------------------------
// cicada's autonomous hands (its MainScene), bought in Personal work's box
// (index.html) and stepped by the bubble's world (js/softbody.js) every
// tick, before its blobs. a hand goes after the nearest small blob that no
// other hand is after and the pointer is not holding, and while it has
// none in hand switches to a free one RETARGET of the way as far off. it
// comes up to APPROACH px off that blob's skin on its own side and, within
// REACH more, takes hold of the nearest point and its neighbours as the
// pointer does (World.hold); then it heads for the centre blob with the
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
  RETARGET: 0.8,                         // a free blob this share as far off as its own is worth switching to
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

  // one step in world: what it is after, where that takes it, and its
  // hold carried with it
  step(world) {
    const H = HANDS, centre = world.blobs[0];
    if (this.drag && !world.holds(this.drag)) {
      this.drag = null;
      this.vx *= 0.5;
      this.vy *= 0.5;
    }
    if (this.target && !world.blobs.includes(this.target)) this.target = null;
    if (!this.drag) {
      const free = this.choose(world);
      if (!this.target || (free && free !== this.target && this.away(free) < this.away(this.target) * H.RETARGET)) this.target = free;
    }
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
        const near = this.target.closest(this.x, this.y);
        if (near.index !== -1) this.drag = world.hold(this.target, near.index);
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

  // the nearest blob worth fetching: not the centre one or any locked, not
  // one the pointer holds, not one another hand is after; null if none
  choose(world) {
    let best = null, most = Infinity;
    for (let i = 1; i < world.blobs.length; i++) {
      const b = world.blobs[i];
      if (b.locked || (world.drag && world.drag.blob === b)) continue;
      if (world.hands.some((h) => h !== this && h.target === b)) continue;
      const d = this.away(b);
      if (d < most) { most = d; best = b; }
    }
    return best;
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
