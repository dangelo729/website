// --- icons -------------------------------------------------------------------
// an icon is rows of a site's art (its js/icons.js), '#' ink, 'o' paper and
// '.' clear, drawn as the letters are (js/letter.js), wobbling, as two
// letters on one seed so they wobble as one: its paper, its rows with
// every 'o' inked, so nothing between its strokes shows through, then its
// ink over that. a page hands make the rows, where the icon stands (its
// right edge, and its bottom edge or its middle down), its seed and its
// scale, and draw the framebuffer and the colour of its ink: the page's
// hover colour while a mouse is over it. a press on it, or a little round
// it, at least LEAST world px across for a finger, presses it (at).

const ICON = {
  ROUND: 4,  // world px round an icon's box a press still presses it,
  LEAST: 20, // and the least world px across and down that makes the box
};

const Icon = {
  // rows as an icon, its two letters on seed at scale, { paper, ink }:
  // centred so it stands with its right edge at right and its bottom edge
  // at y, or, given middle, its middle at y; null for an empty one
  make(rows, right, y, seed, scale, middle = false) {
    rows = rows || [];
    const ink = Framebuffer.ink(rows), paper = Framebuffer.ink(rows.map((r) => r.replace(/o/g, '#')));
    if (!ink.w || !ink.h) return null;
    const x = right - ink.w * scale / 2, cy = middle ? y : y - ink.h * scale / 2;
    return { paper: Letter.make(paper, x, cy, seed, scale), ink: Letter.make(ink, x, cy, seed, scale) };
  },

  // whether world (x, y) on the screen presses icon a: its box and ROUND
  // round it, the two together at least LEAST across and down
  at(a, x, y) {
    if (!a) return false;
    const L = a.ink, w = L.g.w * L.scale, h = L.g.h * L.scale;
    const mx = Math.max(ICON.ROUND, (ICON.LEAST - w) / 2), my = Math.max(ICON.ROUND, (ICON.LEAST - h) / 2);
    return Math.abs(x - L.cx) <= w / 2 + mx && Math.abs(y - L.cy) <= h / 2 + my;
  },

  // icon a at time t into framebuffer into, dy world px down from where
  // it stands, its paper in paper and its ink in v
  draw(a, into, t, v, dy = 0) {
    if (!a) return;
    a.paper.draw(t, dy, into, 0, 0);
    a.ink.draw(t, dy, into, 0, v);
  },
};
