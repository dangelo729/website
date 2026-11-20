// --- the switch --------------------------------------------------------------
// light or dark: a switch, an icon (js/icon.js) of a site's art, with a
// ball over it, the ball a press takes hold of. dark is how dark the page
// is, 0 light to 1 dark, and the ball is that far along the switch, from
// as far in from its left end as it is from its top to as far in from its
// right, where the switch is drawn; the page hands dark to its
// framebuffer's present (js/raster.js), where between the two that share
// of its pixels are their dark colours and the rest their light, each
// going over at a point of its own. dark eases to where it is going (to)
// by the house approach, dt-correct, and is there once it is within NEAR.
// a click on the switch, or a little round it, sends it to the other end
// (send, from the page's click); a primary press the page says is the
// switch's that goes SLOP px across takes the ball, which then goes as
// far along as the pointer has gone since the press, no further than
// either end, and let go, or the press cancelled, to the nearer end. a
// lift that lets the ball go tells the page (grabbed), so the click the
// press ends in presses nothing. one press at a time: another pointer's
// is ignored while one holds it. the switch and the ball are in the first
// of the page's hover colours while a mouse is over them or the ball is
// held. the document behind the canvas is the paper's colour of the end
// the page is nearer, and the tab's icon is that end's (js/favicon.js),
// its three dots the page's hover colours. the page starts as the browser
// keeps it, under KEY, once the visitor has sent the switch to an end on
// any page of the site; where it keeps nothing, as the system is, light
// or dark. a page hands load the window and its hover colours as it
// starts, place the art and where the switch stands each time it lays
// out, and listen its canvas; it steps the switch and draws it each frame,
// and reads dark for its present.

const SWITCH = {
  SCALE: LETTER.SCALE, // of the icon's px, as a letter's
  SEED: 99200,         // its wobble's, clear of the letters'
  KEY: 'dark',         // where the browser keeps it
  SLOP: 3,             // world px across a press goes before it has the ball
  RATE: 0.7,           // of the way left to where it is going, each 60 hz frame
  NEAR: 0.002,         // of the way: as near as this, it is there
};

const Switch = {
  win: null,     // the window: its document, its storage and its system's scheme
  colours: null, // the page's hover colours, palette indexes: the switch's lit in the first, the tab icon's dots in all three
  dark: 0,       // how dark the page is, 0 light to 1 dark
  to: 0,         // where it is going
  art: null,     // the switch as { paper, ink } letters (js/icon.js), ball, its ball's bitmaps { paper, ink } or null, and reach, its px from its middle to the ball's at either end; or null
  hold: null,    // the press on it, { id, x, from, on }: where it went down, how dark the page was, and whether it has the ball; or null

  // handed the window and the page's hover colours: the page started as
  // the browser keeps it, or as the system is, and the document and the
  // tab's icon put at that end
  load(win, colours) {
    Switch.win = win;
    Switch.colours = colours;
    Switch.dark = Switch.to = Switch.starts() ? 1 : 0;
    Switch.paper();
  },

  // whether the page starts dark: as the browser keeps that the visitor
  // sent it, or, where it keeps nothing, as the system is
  starts() {
    let kept = null;
    try { kept = Switch.win.localStorage.getItem(SWITCH.KEY); } catch (e) {}
    if (kept !== null) return kept === '1';
    try { return Switch.win.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; }
  },

  // the document behind the canvas in the paper's colour at the end the
  // page is nearer, and the tab's icon that end's
  paper() {
    const w = Switch.dark < 0.5 ? Framebuffer.PAPER : Framebuffer.INK;
    Switch.win.document.documentElement.style.background = 'rgb(' + [w & 255, w >> 8 & 255, w >> 16 & 255].join(',') + ')';
    Favicon.show(Switch.dark, Switch.colours);
  },

  // the switch, rows, standing with its right edge at right and its
  // bottom edge at y, or, given middle, its middle at y (Icon.make), and
  // ball, its ball's rows; an empty switch is none, and an empty ball none
  place(rows, ball, right, y, middle = false) {
    const a = Switch.art = Icon.make(rows, right, y, SWITCH.SEED, SWITCH.SCALE, middle);
    if (!a) return;
    const br = ball || [], ink = Framebuffer.ink(br), paper = Framebuffer.ink(br.map((r) => r.replace(/o/g, '#')));
    const g = a.ink.g;
    a.ball = ink.w && ink.h ? { paper, ink } : null;
    a.reach = Math.max(0, (g.w - g.h + ink.h - ink.w) / 2);
  },

  // whether world (x, y) on the screen presses the switch: its box and a
  // little round it (Icon.at)
  at(x, y) {
    return Icon.at(Switch.art, x, y);
  },

  // the switch at time t into framebuffer into, dy world px down from
  // where it stands, and its ball as far along it as the page is dark,
  // where the switch is drawn; their ink in the first hover colour if
  // over or held
  draw(into, t, over, dy = 0) {
    const a = Switch.art, lit = over || (Switch.hold && Switch.hold.on), v = lit ? Switch.colours[0] : 1;
    if (!a) return;
    Icon.draw(a, into, t, v, dy);
    if (!a.ball) return;
    const p = a.ink.pose(t), along = (2 * Switch.dark - 1) * a.reach * p.s;
    const x = p.x + Math.cos(p.a) * along, y = p.y + Math.sin(p.a) * along + dy;
    into.sprite(a.ball.paper, x, y, p.s, p.a, 0);
    into.sprite(a.ball.ink, x, y, p.s, p.a, v);
  },

  // the page sent to an end, 1 dark or 0 light, and the browser told
  send(to) {
    Switch.to = to;
    try { Switch.win.localStorage.setItem(SWITCH.KEY, to ? '1' : '0'); } catch (e) {}
  },

  // dark eased dt seconds toward where it is going, the house approach
  // dt-correct, and there once it is near; the document behind the canvas
  // and the tab's icon follow it over the middle
  step(dt) {
    if (Switch.dark === Switch.to) return;
    const was = Switch.dark < 0.5;
    Switch.dark += (Switch.to - Switch.dark) * (1 - Math.pow(1 - SWITCH.RATE, 60 * dt));
    if (Math.abs(Switch.to - Switch.dark) < SWITCH.NEAR) Switch.dark = Switch.to;
    if (Switch.dark < 0.5 !== was) Switch.paper();
  },

  // the press's events on canvas, through view, the viewport (js/view.js),
  // which takes an event to world px: a primary press that at(x, y), the
  // page's, says is the switch's is watched; a move SLOP px across takes
  // the ball, which goes with the pointer from there; a lift or a cancel
  // lets the press go, a ball that was held to the nearer end, and a
  // lift that let one go calls grabbed, the page's, so the click it ends
  // in presses nothing. the listeners go on in that order, after any the
  // canvas already has
  listen(canvas, view, at, grabbed) {
    canvas.addEventListener('pointerdown', (e) => {
      const p = view.pointer(e);
      if (e.isPrimary && !Switch.hold && at(p.x, p.y)) Switch.hold = { id: e.pointerId, x: p.x, from: Switch.dark, on: false };
    });
    canvas.addEventListener('pointermove', (e) => {
      const h = Switch.hold;
      if (!h || e.pointerId !== h.id || !Switch.art || !Switch.art.reach) return;
      const across = view.pointer(e).x - h.x;
      if (!h.on && Math.abs(across) < SWITCH.SLOP) return;
      h.on = true;
      Switch.to = Math.min(1, Math.max(0, h.from + across / (2 * Switch.art.reach * SWITCH.SCALE)));
    });
    const go = (e) => {
      const h = Switch.hold;
      if (!h || e.pointerId !== h.id) return;
      Switch.hold = null;
      if (!h.on) return;
      Switch.send(Switch.to < 0.5 ? 0 : 1);
      if (e.type === 'pointerup') grabbed();
    };
    canvas.addEventListener('pointerup', go);
    canvas.addEventListener('pointercancel', go);
  },
};
