// --- the bars ----------------------------------------------------------------
// a bar a press slides along, a slider's or a scrubber's: a box outlined
// UI.LINE px (js/ui.js), its corners rounded, a tick in the middle of
// each of its zones, and a dot where it is, which goes where it is going
// on the house approach (dotTo). how a bar looks is the page's, handed to
// draw as { R, TICK_IN, MARK }: its corners' radius, how far each tick
// stops short of its top and bottom edges, and its dot's radius, world px.

const BAR = {
  SNAP: 0.3, // of the way left to where it is going a bar's dot goes, each 60 hz frame
};

const Bar = {
  // a bar into into, its box b as laid out, dy world px down: outlined
  // UI.LINE px, look.R round its corners, a tick UI.LINE px wide
  // centred on the middle of each of its n zones, stopping look.TICK_IN
  // short of its top and bottom edges, and, at at (0 .. 1 across it, or
  // null for none), a dot look.MARK px round, all in v
  draw(into, b, dy, n, at, v, look) {
    const y0 = b.y0 + dy, y1 = b.y1 + dy;
    into.roundRect(b.x0, y0, b.x1, y1, look.R, null, v, UI.LINE);
    for (let k = 0; k < n; k++) {
      const x = Math.round(b.x0 + (b.x1 - b.x0) * (k + 0.5) / n) - 1;
      into.line(x, y0 + look.TICK_IN, x, y1 - 1 - look.TICK_IN, v, UI.LINE);
    }
    if (at !== null) into.fillCircle(b.x0 + (b.x1 - b.x0) * at, (y0 + y1) / 2, look.MARK, v);
  },

  // a dot at at, 0 .. 1 across its bar, dt on toward to by the house
  // approach, dt-correct, SNAP of the way left each 60 hz frame; at null,
  // on to at once
  dotTo(at, to, dt) {
    return at === null ? to : at + (to - at) * (1 - Math.pow(1 - BAR.SNAP, 60 * dt));
  },
};
