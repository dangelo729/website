// --- the shimmer -------------------------------------------------------------
// a picture that holds still and shimmers as a letter does (js/letter.js):
// picture g into into, s times its size, the w x h box with its top left
// at (x, y), whole px, showing g from its (sx, sy) on, each pixel of the
// box g's under its middle. that middle is pushed up to SWAY_PX across
// and BOB_PX down by a wobble that every corner of a grid of TILE px
// squares over the box has of its own, a letter's sway and bob seeded
// from seed, going evenly from corner to corner between them, across
// along each row of squares and down along each column, so g's pixels,
// off the framebuffer's grid, pop at their edges here and there as a
// letter's do. over, g's 0s are left alone. given paper, a v, and s no
// less than a half, g shrunk keeps every pixel of it that is not paper
// (blitMapped, js/raster.js). the corners' wobbles and the maps from the
// box's px to g's are kept from draw to draw, grown as a bigger box asks.

const SHIMMER = {
  TILE: 24, // world px, the squares over a picture whose corners each wobble on their own
};

const Shimmer = {
  n: 0,                    // how many corners sway and bob hold
  sway: null,              // each corner's wobble across, world px, for the draw at hand
  bob: null,               // and down
  cols: new Int32Array(0), // g's column under each px across each row of squares
  rows: new Int32Array(0), // g's row under each px down each column of them

  // picture g drawn shimmering into into: from its (sx, sy) on, s times
  // its size, into the w x h box at (x, y), at time t, its wobble seeded
  // from seed; over, its 0s left alone; paper, the v it keeps every
  // other pixel over, shrunk
  draw(into, g, sx, sy, x, y, w, h, s, t, seed, over, paper = -1) {
    const T = SHIMMER.TILE, nx = Math.ceil(w / T), ny = Math.ceil(h / T), across = nx + 1, n = across * (ny + 1);
    const S = Shimmer, k = 2 * Math.PI * t, m = LETTER.WOBBLE, cw = w + 1, rh = h + 1;
    if (S.n < n) { S.n = n; S.sway = new Float64Array(n); S.bob = new Float64Array(n); }
    if (S.cols.length < ny * cw) S.cols = new Int32Array(ny * cw);
    if (S.rows.length < nx * rh) S.rows = new Int32Array(nx * rh);
    const sway = S.sway, bob = S.bob, cols = S.cols, rows = S.rows;
    for (let c = 0; c < n; c++) {
      sway[c] = m.SWAY_PX * Math.sin(k * m.SWAY_HZ * (0.8 + 0.4 * Letter.noise(seed + c, 1)) + 2 * Math.PI * Letter.noise(seed + c, 5));
      bob[c] = m.BOB_PX * Math.sin(k * m.BOB_HZ * (0.8 + 0.4 * Letter.noise(seed + c, 2)) + 2 * Math.PI * Letter.noise(seed + c, 6));
    }
    // g's column under each column of each row of squares, and its row
    // under each row of each column of them, and one more of each past the box
    for (let b = 0; b < ny; b++) for (let i = 0; i <= w; i++) {
      const a = Math.min(nx - 1, Math.floor(i / T)), c = b * across + a, d = sway[c] + (sway[c + 1] - sway[c]) * (i + 0.5 - a * T) / T;
      cols[b * cw + i] = Math.min(g.w - 1, Math.max(0, Math.floor(sx + (i + 0.5 - d) / s)));
    }
    for (let a = 0; a < nx; a++) for (let j = 0; j <= h; j++) {
      const b = Math.min(ny - 1, Math.floor(j / T)), c = b * across + a, d = bob[c] + (bob[c + across] - bob[c]) * (j + 0.5 - b * T) / T;
      rows[a * rh + j] = Math.min(g.h - 1, Math.max(0, Math.floor(sy + (j + 0.5 - d) / s)));
    }
    for (let b = 0; b < ny; b++) for (let a = 0; a < nx; a++)
      into.blitMapped(g, x + a * T, y + b * T, Math.min(T, w - a * T), Math.min(T, h - b * T), cols, b * cw + a * T, rows, a * rh + b * T, over, paper);
  },
};
