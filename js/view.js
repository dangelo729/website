// --- the viewport ------------------------------------------------------------
// the window is a viewport onto a grid of world pixels, each SCALE css
// pixels square. a page draws every pixel into one framebuffer
// (js/raster.js) the size of the visible world and copies it whole, once
// a frame, into its canvas's bitmap, which is that size exactly; the
// browser blows it up by SCALE, each pixel's edges kept hard. a world
// pixel is a css pixel, but a window fewer than across css pixels wide
// still shows across world pixels across, each as much smaller as fits
// them in, and no smaller than one of the screen's own pixels. across is
// VIEW.ACROSS unless the address gives another (?across=700), 0 for none:
// every world pixel a css pixel. a page hands load the window and its
// canvas, calls resize as it starts and whenever the window is resized,
// making its framebuffers at the size resize gives back, and takes a
// pointer event to world px with pointer.

const VIEW = {
  ACROSS: 585, // world px, the fewest a window shows across unless the address gives another
};

const View = {
  win: null,           // the window
  canvas: null,        // the page's canvas
  across: VIEW.ACROSS, // world px, the fewest the window shows across; 0, as many as it is css px wide
  SCALE: 1,            // css px a world pixel is across and down (resize)
  W: 0, H: 0,          // the viewport, in world px (resize)

  // handed the window and the page's canvas; across read from the
  // address's ?across=
  load(win, canvas) {
    View.win = win;
    View.canvas = canvas;
    const asked = new win.URLSearchParams(win.location.search).get('across'); // or null
    View.across = asked === null ? VIEW.ACROSS : Math.max(0, +asked || 0);
  },

  // SCALE and the viewport worked out from the window, and the canvas
  // sized to them: its bitmap W by H, its css size W * SCALE by H * SCALE.
  // the viewport is as many whole world px as fit the window, a hair under
  // a whole one counted whole, so a window across world px wide at SCALE
  // shows all of them; and never fewer than one. gives back { W, H }
  resize() {
    const win = View.win, canvas = View.canvas;
    View.SCALE = View.across ? Math.max(1 / (win.devicePixelRatio || 1), Math.min(1, win.innerWidth / View.across)) : 1;
    View.W = Math.max(1, Math.floor(win.innerWidth / View.SCALE + 1e-9));
    View.H = Math.max(1, Math.floor(win.innerHeight / View.SCALE + 1e-9));
    canvas.width = View.W;
    canvas.height = View.H;
    canvas.style.width = (View.W * View.SCALE) + 'px';
    canvas.style.height = (View.H * View.SCALE) + 'px';
    return { W: View.W, H: View.H };
  },

  // where pointer event e is, world px on the screen
  pointer(e) {
    const rect = View.canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / View.SCALE, y: (e.clientY - rect.top) / View.SCALE };
  },
};
