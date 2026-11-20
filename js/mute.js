// --- the mute button ---------------------------------------------------------
// a corner icon (js/icon.js) that shows whether the page is muted and
// turns it on and off: a site's sound icon while the page plays and its
// muted icon while it is muted, each drawn as the letters are, wobbling,
// its paper and then its ink, its ink in the colour the page hands while a
// mouse is over it. a press on it, or a little round it, presses it (at),
// and the page's click mutes the page or gives it its sound back (set);
// what muting does is the page's, told each time (the mute it hands
// load). the browser keeps it under KEY, so a visitor who muted the page
// finds it muted the next time. a page hands load the window and what
// muting does as it starts, place its icons and where they stand each
// time it lays out, and draws the icon shown each frame.

const MUTE = {
  SCALE: LETTER.SCALE, // of an icon's px, as a letter's
  SEED: 99000,         // its wobble's, clear of the letters'
  KEY: 'muted',        // where the browser keeps it
};

const Mute = {
  win: null,  // the window: its storage
  mute: null, // what muting does, the page's: handed true to mute the page, false to give its sound back
  on: false,  // whether the page is muted
  art: {},    // each icon as { paper, ink } letters where it stands (js/icon.js), by name

  // handed the window and what muting does: the page muted at once if the
  // browser keeps that it was
  load(win, mute) {
    Mute.win = win;
    Mute.mute = mute;
    try { if (win.localStorage.getItem(MUTE.KEY) === '1') Mute.set(true); } catch (e) {}
  },

  // each of the icons, icons.sound and icons.muted, standing with its
  // right edge at right and its bottom edge at y (Icon.make); an empty
  // icon has none
  place(icons, right, y) {
    Mute.art = {};
    for (const name of ['sound', 'muted']) {
      const a = Icon.make(icons[name], right, y, MUTE.SEED, MUTE.SCALE);
      if (a) Mute.art[name] = a;
    }
  },

  // whether world (x, y) on the screen presses the icon shown
  at(x, y) {
    return Icon.at(Mute.art[Mute.on ? 'muted' : 'sound'], x, y);
  },

  // the icon shown at time t into framebuffer into, its ink in v
  draw(into, t, v) {
    Icon.draw(Mute.art[Mute.on ? 'muted' : 'sound'], into, t, v);
  },

  // the page muted, or given its sound back, what muting does told, and
  // the browser told
  set(on) {
    Mute.on = on;
    Mute.mute(on);
    try { Mute.win.localStorage.setItem(MUTE.KEY, on ? '1' : '0'); } catch (e) {}
  },
};
