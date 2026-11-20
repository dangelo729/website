// --- the logo ----------------------------------------------------------------
// a page's name across the top of the window: its words in the page's
// face (js/type.js), each glyph a letter (js/letter.js), in the second of
// the page's hover colours. its ink is centred across the window, its
// tallest TOP down from the window's top edge, SIZE world px to the em, or
// less where WIDTH of the window's width is narrower than that has it.
// left of its first letter is a dot in the first hover colour, its middle
// level with the top of that letter's ink, and right of its last a dot in
// the third, its middle level with the bottom of that letter's ink, each
// DOT ems across and GAP ems clear of its letter's ink across. a dot is a
// ring of verlet points (js/softbody.js), locked where the logo puts it
// and holding still there, in a world of its own the size of the window,
// so its px are the page's. it is made at each layout and settled in place
// at once, at a radius that puffs out to the one the logo gives it
// (puffed), and filled with its colour right out to its skin. a primary
// press within REACH of a dot's skin that the page says is the logo's
// takes hold of the skin's nearest point and two either side and pulls
// them toward the pointer, a dashed line from the point to the pointer,
// until the press lifts or the pull goes too far and the skin lets go,
// and the dot wobbles home; a lift that lets a dot go tells the page
// (grabbed), so the click it ends in presses nothing. nothing of it draws
// from Math.random. a page hands load its words, a canvas maker, its face
// and its hover colours as it starts, place the window's size each time it
// lays out, and listen its canvas; it steps the dots and draws the logo
// and the hold each frame.

const LOGO = {
  SIZE: 68,     // world px to the em, the most it will be
  WIDTH: 0.3,   // of the window's width its words' ink may span
  TOP: 30,      // world px from the window's top edge to its words' tallest ink
  DOT: 0.35,    // ems across a dot
  GAP: 0.1,     // ems across between a dot and its letter's ink
  REACH: 6,     // world px past a dot's skin a press still takes hold of it
  POINTS: 32,   // the points of a dot's ring,
  PUFF: 1.2,    // how many times its circle's area the ring is pushed out toward,
  SETTLE: 60,   // and the steps that leave it still where it is made
  FIRST: 98000, // its letters' seeds run from here, clear of the others'
};

const Logo = {
  type: null,                    // its words as a line of type (js/type.js), once load has made it
  colours: null,                 // the page's hover colours, palette indexes: the left dot in the first, the letters in the second, the right dot in the third
  puffed: 0,                     // a ring's radius at rest over the radius it is made with, once load has settled one
  at: { letters: [], dots: [] }, // as laid out (place): its words' letters, and its dots, each { world, blob, x, y, r, v }
  hold: null,                    // the press holding a dot, { id, dot }: its pointer and the dot; or null

  // handed the page's words, a maker of canvases, its face and its hover
  // colours: the words made a line of type, and a ring settled to find
  // how far it puffs out
  load(text, makeCanvas, face, colours) {
    Logo.type = new Type(text, makeCanvas, face);
    Logo.colours = colours;
    const w = new World(100, 100), b = new SoftBlob(50, 50, LOGO.POINTS, 10, LOGO.PUFF, true);
    w.blobs.push(b);
    for (let i = 0; i < LOGO.SETTLE; i++) w.tick();
    const c = b.getCenter();
    Logo.puffed = b.points.reduce((r, p) => r + Math.hypot(p.x - c.x, p.y - c.y), 0) / b.points.length / 10;
  },

  // the logo laid out for a W x H window: its words' letters, and its two
  // dots, each r px round at (x, y) in colour v, made and settled there,
  // any hold on one let go; with no glyphs, no logo
  place(W, H) {
    const G = LOGO, t = Logo.type, n = t.glyphs.length, [lit, item, link] = Logo.colours;
    Logo.at = { letters: [], dots: [] };
    Logo.hold = null;
    if (!n) return;
    const ems = (t.left + t.right) / TYPE.EM, size = Math.min(G.SIZE, G.WIDTH * W / ems), k = size / TYPE.EM;
    const r = G.DOT * size / 2, out = G.GAP * size + r, first = t.glyphs[0], last = t.glyphs[n - 1];
    // the line's origin on its baseline: its ink centred across, its tallest TOP down
    const ox = (W - ems * size) / 2 + k * t.left, base = G.TOP + k * t.ascent;
    Logo.at.letters = t.glyphs.map((gl) => Letter.make(gl.g, ox + k * (gl.x + gl.dx), base + k * gl.dy, G.FIRST + gl.at, k, LETTER.WOBBLE, item));
    const dot = (x, y, v) => {
      const world = new World(W, H), blob = new SoftBlob(x, y, G.POINTS, r / Logo.puffed, G.PUFF, true);
      world.blobs.push(blob);
      for (let i = 0; i < G.SETTLE; i++) world.tick();
      return { world, blob, x, y, r, v };
    };
    Logo.at.dots = [
      dot(ox + k * (first.x + first.dx - first.g.w / 2) - out, base + k * (first.dy - first.g.h / 2), lit),
      dot(ox + k * (last.x + last.dx + last.g.w / 2) + out, base + k * (last.dy + last.g.h / 2), link),
    ];
  },

  // the dot a press at world (x, y) on the screen takes hold of: the
  // nearest, if the press is within REACH of its skin, or null
  dotAt(x, y) {
    const ds = Logo.at.dots;
    let best = null, most = Infinity;
    for (let i = 0; i < ds.length; i++) {
      const d = Math.hypot(x - ds[i].x, y - ds[i].y) - ds[i].r;
      if (d <= LOGO.REACH && d < most) { best = ds[i]; most = d; }
    }
    return best;
  },

  // each dot's world on to now, the frame's ms
  step(now) {
    const ds = Logo.at.dots;
    for (let i = 0; i < ds.length; i++) ds[i].world.step(now);
  },

  // the logo at time t into framebuffer into: its words' letters, and
  // each dot filled with its colour out to its skin's outer edge, the
  // ring's points pushed out along its normal by half UI.LINE, so it is as
  // big as an outline UI.LINE px thick round the ring would be and as
  // round as the ring is
  draw(into, t) {
    const ls = Logo.at.letters, ds = Logo.at.dots, out = UI.LINE / 2;
    for (let i = 0; i < ls.length; i++) ls[i].draw(t, 0, into);
    for (let j = 0; j < ds.length; j++) {
      const pts = ds[j].blob.points, n = pts.length, edge = [];
      for (let i = 0; i < n; i++) {
        // the secant across it turned a quarter: outward, on a ring that runs clockwise on screen
        const a = pts[(i + n - 1) % n], q = pts[i], c = pts[(i + 1) % n];
        const nx = c.y - a.y, ny = a.x - c.x, m = Math.hypot(nx, ny) || 1;
        edge.push({ x: q.x + out * nx / m, y: q.y + out * ny / m });
      }
      into.fillPolygon(edge, ds[j].v);
    }
  },

  // the hold on a dot into framebuffer into, in the dot's colour:
  // cicada's drag line, dashed, from the grabbed point to the pointer, its
  // dashes shrinking and gaps opening over the last 30 % of the reach
  // before the skin lets go, walked from the rounded ends
  drawHold(into) {
    const ds = Logo.at.dots;
    for (let j = 0; j < ds.length; j++) {
      const d = ds[j].world.drag;
      if (!d) continue;
      const c = d.points[0].point, reach = Math.min(Math.hypot(c.x - d.x, c.y - d.y) / SOFT.DRAG.BREAKAWAY, 1);
      const dashing = Math.pow(Math.max(0, (reach - 0.7) / 0.3), 2), dash = Math.max(2, 12 * (1 - dashing)), gap = 1 + 25 * dashing;
      const x0 = Math.round(c.x), y0 = Math.round(c.y), x1 = Math.round(d.x), y1 = Math.round(d.y), len = Math.hypot(x1 - x0, y1 - y0);
      if (len === 0) continue;
      const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
      for (let at = 0, drawing = true; at < len; drawing = !drawing) {
        const end = Math.min(at + (drawing ? dash : gap), len);
        if (drawing) into.line(x0 + ux * at, y0 + uy * at, x0 + ux * end, y0 + uy * end, ds[j].v);
        at = end;
      }
    }
  },

  // the press's events on canvas, through view, the viewport (js/view.js),
  // which takes an event to world px: a primary press of the main button
  // takes hold of the dot that at(x, y), the page's, gives for where it
  // went down (none where something over the dot takes the press), if
  // the dot's world grabs it there, and each move of its pointer takes
  // the pull there; a lift or a cancel lets the dot go, and a lift calls
  // grabbed, the page's, so the click it ends in presses nothing. the
  // listeners go on in that order, after any the canvas already has
  listen(canvas, view, at, grabbed) {
    canvas.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || e.button !== 0) return;
      const p = view.pointer(e), dot = at(p.x, p.y);
      if (dot && dot.world.grab(p.x, p.y)) Logo.hold = { id: e.pointerId, dot };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!Logo.hold || e.pointerId !== Logo.hold.id) return;
      const p = view.pointer(e);
      Logo.hold.dot.world.pointer(p.x, p.y);
    });
    const go = (e) => {
      if (!Logo.hold || e.pointerId !== Logo.hold.id) return;
      Logo.hold.dot.world.release();
      Logo.hold = null;
      if (e.type === 'pointerup') grabbed();
    };
    canvas.addEventListener('pointerup', go);
    canvas.addEventListener('pointercancel', go);
  },
};
