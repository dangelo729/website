// node tools/test/hands.test.js
//
// loads js/softbody.js and js/hands.js the way the page does, classic
// scripts sharing one global scope, in a vm context, and runs a world the
// size of Personal work's room with its bubble locked in the middle.
// checks a hand fetches a small blob: comes up beside it, takes hold as
// the pointer does, tows it in and has it eaten; a hold that breaks lets
// go and the hand comes back; two hands go after two blobs, not the same
// one; a blob takes a hand for every spawn in it, so a crew tows a heavy
// one together, holding side by side, faster than one hand that keeps
// losing its hold; a blob the pointer holds is left alone; an idle hand
// waits beside the bubble; a hand never leaves the world; and a stronger
// drag force tows faster. exits 1 on failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}

const ctx = vm.createContext({});
for (const file of ['js/softbody.js', 'js/hands.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
}
const { World, SoftBlob, Hand, HANDS, SOFT } = vm.runInContext('({ World, SoftBlob, Hand, HANDS, SOFT })', ctx);

// a room as wide as the page's at 1200 px, its bubble locked in the middle
const W = 1180, H = 293;
const room = () => {
  const w = new World(W, H);
  w.blobs.push(new SoftBlob(W / 2, H / 2, 32, 38.3, 1.2, true));
  return w;
};
const secs = (k) => (k / 60).toFixed(1) + ' s';

// --- one hand, one blob ----------------------------------------------------------
{
  const w = room(), small = w.spawn(10, 1000, 200), hand = new Hand(1100, 30, 0);
  w.hands.push(hand);
  let target = -1, held = -1, heldAt = null, eaten = -1, out = false;
  for (let k = 0; k < 60 * 60 && eaten < 0; k++) {
    w.tick();
    if (target < 0 && hand.target === small) target = k;
    if (held < 0 && hand.drag) { held = k; heldAt = { hand: { x: hand.x, y: hand.y }, c: small.getCenter() }; }
    if (hand.x < 0 || hand.x > W || hand.y < 0 || hand.y > H) out = true;
    if (!w.blobs.includes(small)) eaten = k;
  }
  check('a hand goes after the small blob at once', target === 0, 'at step ' + target);
  const reach = heldAt && Math.hypot(heldAt.hand.x - heldAt.c.x, heldAt.hand.y - heldAt.c.y);
  check('it takes hold beside it, APPROACH off its skin', held > 0 && reach <= small.radius + HANDS.APPROACH + HANDS.REACH + 1, 'at ' + secs(held) + ', ' + (reach || 0).toFixed(1) + ' px from its middle');
  check('it tows it in to be eaten, in under 30 s', eaten > held && eaten < 60 * 30, 'eaten at ' + secs(eaten));
  w.tick();
  check('with it eaten, the hold is gone, and a step on the hand has let go and looks for the next', w.held.length === 0 && hand.drag === null && hand.target === null);
  check('the hand never leaves the world', !out);
}

// --- the hold as the world keeps it ------------------------------------------------
{
  const w = room(), small = w.spawn(10, 800, 150), hand = new Hand(840, 150, 0);
  w.hands.push(hand);
  for (let k = 0; k < 600 && !hand.drag; k++) w.tick();
  const d = hand.drag;
  check('the hold is the world\'s: five points of the blob, weighted as the pointer\'s', d && w.holds(d) && d.blob === small && d.points.length === 5 &&
    d.points.map((p) => p.force).sort().join() === '0.3,0.3,0.6,0.6,1');
  check('and the hold is where the hand is', d && d.x === hand.x && d.y === hand.y);
  // a hold pulled past the breakaway lets go, and the hand comes back for it
  for (const p of small.points) { p.x += 200; p.px += 200; }
  w.tick();
  check('stretched past the breakaway it lets go', !w.holds(d) && w.held.length === 0);
  w.tick();
  check('the hand drops it but keeps after it', hand.drag === null && hand.target === small);
  let again = false;
  for (let k = 0; k < 60 * 20 && !again; k++) { w.tick(); again = hand.drag !== null; }
  check('and comes back and takes hold again', again);
  w.letGo(hand.drag);
  check('letGo ends a hold', w.held.length === 0);
}

// --- two hands, two blobs; the pointer's blob is left alone ------------------------
{
  const w = room(), a = w.spawn(10, 100, 60), b = w.spawn(10, 1080, 230);
  const h1 = new Hand(600, 40, 0), h2 = new Hand(620, 40, 1);
  w.hands.push(h1, h2);
  w.tick();
  check('two hands go after two blobs, not the same one', h1.target && h2.target && h1.target !== h2.target);
  let both = -1;
  for (let k = 0; k < 60 * 60 && both < 0; k++) { w.tick(); if (w.blobs.length === 1) both = k; }
  check('and between them both are eaten', both > 0, 'by ' + secs(both));

  const v = room(), held = v.spawn(10, 300, 150), free = v.spawn(10, 1000, 150), h = new Hand(320, 60, 0);
  v.hands.push(h);
  v.grab(300 + 10, 150);
  v.tick();
  check('a blob the pointer holds is left alone, though nearer', v.drag && v.drag.blob === held && h.target === free);
}

// --- a crew for a heavy blob ---------------------------------------------------------
{
  // k spawns in a row, touching, merged into one out at x
  const heavy = (w, k, x) => {
    for (let i = 0; i < k; i++) w.spawn(20, x + (i - (k - 1) / 2) * 40.5 * 0.98, 150);
    for (let s = 0; s < 120 && w.blobs.length > 2; s++) w.tick();
    return w.blobs[1];
  };
  const crews = [1, 2, 3, 4].map((k) => Hand.crew(heavy(room(), k, 1000)));
  check('a blob takes a hand for every spawn that went into it', crews.join() === '1,2,3,4', crews.join());

  const light = room(), one = light.spawn(10, 1000, 150), h1 = new Hand(600, 40, 0), h2 = new Hand(620, 40, 1);
  light.hands.push(h1, h2);
  light.tick();
  check('a lone spawn takes one hand, the other stays free', [h1.target, h2.target].filter((t) => t === one).length === 1);

  // three hands on a blob of three, against one on its own
  const tow = (n) => {
    const w = room(), blob = heavy(w, 3, 1000);
    for (let i = 0; i < n; i++) w.hands.push(new Hand(1100, 30 + i * 60, i));
    let breaks = 0, most = 0, shared = false, had = w.hands.map(() => false);
    for (let k = 0; k < 60 * 90; k++) {
      w.tick();
      if (!w.blobs.includes(blob)) return { k, breaks, most, shared };
      w.hands.forEach((h, i) => { if (had[i] && !h.drag) breaks++; had[i] = !!h.drag; });
      const holds = w.held.filter((d) => d.blob === blob);
      most = Math.max(most, holds.length);
      const pts = holds.flatMap((d) => d.points.map((p) => p.point));
      if (new Set(pts).size < pts.length) shared = true;
    }
    return { k: Infinity, breaks, most, shared };
  };
  const alone = tow(1), crew = tow(3);
  check('one hand alone keeps losing its hold on it', alone.breaks >= 5, alone.breaks + ' breaks, ' + secs(alone.k));
  check('three hands all take hold of it at once', crew.most === 3, crew.most + ' at most');
  check('side by side: no two holds share a point', !crew.shared);
  check('and tow it in well ahead of one alone', crew.k < alone.k / 2, secs(crew.k) + ' against ' + secs(alone.k) + ', ' + crew.breaks + ' breaks');
}

// --- idle --------------------------------------------------------------------------
{
  const w = room(), hand = new Hand(100, 250, 0);
  w.hands.push(hand);
  for (let k = 0; k < 60 * 20; k++) w.tick();
  const c = w.blobs[0].getCenter(), r = w.blobs[0].radius + HANDS.REST;
  const at = { x: c.x + r * Math.cos(hand.rest), y: c.y + r * Math.sin(hand.rest) };
  check('with nothing to fetch it waits REST off the bubble at its own angle', Math.hypot(hand.x - at.x, hand.y - at.y) < 2 && hand.target === null,
    'at (' + hand.x.toFixed(1) + ', ' + hand.y.toFixed(1) + ') for (' + at.x.toFixed(1) + ', ' + at.y.toFixed(1) + ')');
  const angles = [0, 1, 2, 3].map((n) => new Hand(0, 0, n).rest);
  const apart = angles.every((x, i) => angles.every((y, j) => i === j || Math.abs(Math.atan2(Math.sin(x - y), Math.cos(x - y))) > 0.5));
  check('each hand waits at an angle of its own', apart, angles.map((x) => x.toFixed(2)).join(' '));
}

// --- a stronger hold tows faster -------------------------------------------------------
{
  const time = (scale) => {
    const w = room(), small = w.spawn(10, 1000, 200);
    w.dragForce = SOFT.DRAG.FORCE * scale;
    w.hands.push(new Hand(1100, 30, 0));
    for (let k = 0; k < 60 * 60; k++) { w.tick(); if (!w.blobs.includes(small)) return k; }
    return Infinity;
  };
  const base = time(1), ten = time(Math.pow(1.1, 10)), thirty = time(Math.pow(1.1, 30));
  check('a stronger drag force tows faster: drag level 10, then 30', ten < base && thirty < ten, secs(base) + ', ' + secs(ten) + ', ' + secs(thirty));
}

console.log(failures ? failures + ' failed' : 'all passed');
process.exit(failures ? 1 : 0);
