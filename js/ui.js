// --- the numbers ---------------------------------------------------------------
// the sizes, springs and rates a page builds its buttons, menus and fields
// from, and the face its words are set in: one table, read where each is
// used (js/menu.js among them). a number only one page has is in a table
// of that page's own.

const UI = {
  EDGE: 21,         // world px, how far everything keeps from the window's edges
  STACK_BELOW: 463, // world px, the window's width under which the text is PHONE
  MOST: 16,         // the text's world px to the em
  PHONE: 11,        // the text's world px to the em, under STACK_BELOW
  CAPTION: 0.85,    // of the text's size, a caption's and the menus' words', no less than CAP_LEAST
  CAP_LEAST: 10,    // world px to the em
  CAP_LEAD: 1.3,    // a caption's ems, baseline to baseline
  LINE: 2,          // world px, an outline's thickness
  RATE: 0.3,        // what eases (Menu.ease), a caret's turn among it: of the way left to open each 60 hz frame opening, of the way from open shutting
  HEAD: 0.08,       // what eases, shutting: the way from open grows as if this much further, its start's speed over its end's
  FLIP: 2.76,       // how many times as fast as RATE has it a menu's caret turns
  RESPONSE: 0.4,    // seconds, the menus' spring's swing undamped: how quick it swings
  WARBLE: 0.24,     // world px each edge drifts either way, on its own slow sine at the letters' rates
  PAD_X: 0.5, PAD_Y: 0.25, RADIUS: 0.4, // of the text's size: round a button's words, and its corners
  APART: 0.4,                           // of the text's size, between a header's caret and title
  ROW: 0.4, MARGIN: 0.4,                // of the text's size, between a menu's buttons, and round them in the open menu
  BOUNCE: 0.45,                         // the spring's: damped 1 - BOUNCE (0.35 swings about 7 % past open)
  KICK: 12,                             // a second, added to a menu's speed toward open as it opens: with BOUNCE, about 19 % past open
  SPREAD: 14,                           // px, how far along a menu's skin an anchor's pull reaches
  CAP: 0.75, DESC: 0.2,                 // of the text's size, the face's caps over its baseline and descenders under
  GROW: 1.1,  // a box's art is drawn this many times its size, off the pixels' grid, so its edges shimmer as a letter's do
  // the face the words are set in (js/type.js): helvetica neue's medium.
  // at these sizes regular's strokes fall under a pixel and break up, and
  // bold's fill the counters
  FACE: { weight: 500, family: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
};
