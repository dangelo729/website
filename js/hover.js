// --- hover -------------------------------------------------------------------
// a mouse's pointer over anything a press would press turns it one of the
// look's three colours while it is there, teal, tan and mauve, by how
// deep it is in what holds it: the top level teal, what that holds tan,
// what that holds mauve, and teal again under that, and so on round
// (level). a finger has no hover. a page asks for the colours (colours)
// where it first wants them, as the palette (js/raster.js) numbers a
// colour by when it is first asked for, and has the pointer kept on its
// canvas (listen): at, where a mouse's pointer is, for the page to work
// out what it is over afresh each frame, so it follows what moves under a
// still pointer.

const HUES = {
  TEAL: '#49B6B0',  // the top level's
  TAN: '#B8B693',   // a level down's
  MAUVE: '#B5979A', // two levels down's
};

const Hover = {
  at: null,   // where a mouse's pointer is, world px on the screen, or null
  levels: [], // teal, tan and mauve as palette indexes, once asked for (colours)

  // the three asked of the palette (Framebuffer.colour), teal, tan and
  // mauve in turn; gives back levels
  colours() {
    Hover.levels = [HUES.TEAL, HUES.TAN, HUES.MAUVE].map((hex) => Framebuffer.colour(hex));
    return Hover.levels;
  },

  // the colour of what is n levels down, 0 the top, round again past the third
  level(n) {
    return Hover.levels[n % Hover.levels.length];
  },

  // at kept from the pointer's events on canvas, through view, the
  // viewport (js/view.js), which takes an event to world px: a move sets
  // it, but a finger's, which clears it, as a finger's press does, and the
  // pointer leaving clears it. the listeners go on in that order, after
  // any the canvas already has
  listen(canvas, view) {
    canvas.addEventListener('pointermove', (e) => { Hover.at = e.pointerType === 'touch' ? null : view.pointer(e); });
    canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') Hover.at = null; });
    canvas.addEventListener('pointerleave', () => { Hover.at = null; });
  },
};
