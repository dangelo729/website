// --- the menus -----------------------------------------------------------------
// a menu, shut, is a button: a rounded rect, RADIUS of its text's size
// round its corners, filled with paper over whatever is under it and
// outlined LINE px, a caret and its words at its left. a press on it opens
// it: the button is its shut shape, and its open one reaches round what it
// holds. it swings there and back on a spring, set off with a KICK when it
// opens (the page adds it to its speed), so it bursts open and swings past
// it before it settles, its edges warbling WARBLE px either way, and a
// skin (js/skin.js) chases it, its anchors' pull reaching only SPREAD
// along it, so it bows between them, with the menu's insides, drawn apart,
// copied through the skin, so it wipes them in as it grows. its caret
// turns from > to v as it opens, and a press on its header shuts it. a
// submenu is a menu inside a menu, its insides drawn apart again and
// copied through its own skin. a button that picks is a menu too: shut,
// round the one picked; pressed, it opens down round the others, and a
// press on one of the others picks it and shuts the button. the numbers
// are UI's (js/ui.js). the spring a menu swings on (spring), and the
// approach its caret turns by (ease), move anything else a page moves as
// a menu moves.
//
// a menu is an object, { open, p, v, turn, skin, room, warble }, as shut
// makes it: whether it is open, how far (p, 0 shut, 1 open and past as it
// swings) and how fast, its caret's turn, its skin and the room it was
// made in, and each edge's warble, four { hz, ph }, drawn from Math.random
// as it is made, so each draw comes where the page makes the menu. its
// layout is the page's, { room, size, shut, full, header }: the room it is
// laid out in, its text's size, its rects shut and open, and its header's
// caret and words. a page hands load what makes a canvas, once, for the
// caret; it steps each menu each frame (step), and draws each into the
// framebuffer it hands, its insides apart in another, in the hover colour
// it hands (draw).

const Menu = {
  caret: null, // a menu's caret, a > in UI.FACE (js/type.js), once load has made it

  // the caret made, on canvases from makeCanvas (js/type.js)
  load(makeCanvas) {
    Menu.caret = new Type('>', makeCanvas, UI.FACE);
  },

  // a menu, shut and still, with no skin and no room yet, and each edge's
  // warble: a rate of 0.15 to 0.35 a second and a phase, drawn from
  // Math.random in that order, edge by edge
  shut() {
    return {
      open: false, p: 0, v: 0, turn: 0, skin: null, room: null,
      warble: [0, 1, 2, 3].map(() => ({ hz: 0.15 + 0.2 * Math.random(), ph: 2 * Math.PI * Math.random() })),
    };
  },

  // p, how far something that opens and shuts is open (a caret's turn,
  // say), dt on toward open or back to shut, travel px the most anything
  // moves on the way, speed times as fast. in the way left to open, q = 1
  // - p: opening it shrinks by RATE of itself a 60 hz frame, and goes to
  // nothing once under a px of travel; shutting, it and HEAD grow by as
  // much, so it leaves open going and speeds up into shut, and out at 1 it
  // is shut. a frame of any other length moves it as far as that many 60
  // hz frames would
  ease(p, open, dt, travel, speed = 1) {
    const px = 1 / Math.max(1, travel), f = Math.pow(1 - UI.RATE, 60 * dt * speed);
    let q = 1 - p;
    if (open) q = q * f < px ? 0 : q * f;
    else q = Math.min(1, (q + UI.HEAD) / f - UI.HEAD);
    return 1 - q;
  },

  // s, { p, v }, a place and its speed, stepped exactly by dt toward to
  // by the underdamped spring's closed form (RESPONSE s a swing undamped,
  // damped 1 - BOUNCE), as step steps a menu
  spring(s, to, dt) {
    const w = 2 * Math.PI / UI.RESPONSE, z = 1 - UI.BOUNCE, sg = z * w, wd = w * Math.sqrt(1 - z * z), x0 = s.p - to, v0 = s.v;
    const e = Math.exp(-sg * dt), c = Math.cos(wd * dt), sn = Math.sin(wd * dt);
    s.p = to + e * (x0 * c + (v0 + sg * x0) / wd * sn);
    s.v = e * (v0 * c - (w * w * x0 + sg * v0) / wd * sn);
  },

  // menu m's shape at p, from shut (0) to open (1), as laid out in ui,
  // its corners a button's, or, where its shut shape has a roundness of
  // its own (r), that shut and a button's once it is open; and, given a
  // time t, each edge warbled WARBLE px either way on its own sine
  at(m, ui, p, t) {
    const a = ui.shut, b = ui.full, r = UI.RADIUS * ui.size, c = { r: a.r === undefined ? r : a.r + (r - a.r) * Math.min(1, p) };
    for (const k of ['x0', 'y0', 'x1', 'y1']) c[k] = a[k] + (b[k] - a[k]) * p;
    if (t !== undefined) {
      const w = (e) => UI.WARBLE * Math.sin(2 * Math.PI * t * m.warble[e].hz + m.warble[e].ph);
      c.x0 += w(0);
      c.y0 += w(1);
      c.x1 += w(2);
      c.y1 += w(3);
    }
    return c;
  },

  // menu m, laid out as ui, dt on toward open or back to its button on
  // the spring: p and its speed v stepped exactly by dt, by the
  // underdamped spring's closed form (RESPONSE s a swing undamped, damped
  // 1 - BOUNCE), so it moves alike at any frame rate, stopping dead at
  // shut and at rest open within a px on the edge that moves furthest;
  // its caret turning FLIP times as fast as ease has it, and its skin
  // after it; laid out again in a new room, a new skin is settled where
  // the menu now is. with no ui, nothing moves
  step(m, ui, dt, t) {
    if (!ui) return;
    const a = ui.shut, b = ui.full;
    const px = 1 / Math.max(1, Math.abs(b.x0 - a.x0), Math.abs(b.y0 - a.y0), Math.abs(b.x1 - a.x1), Math.abs(b.y1 - a.y1));
    const target = m.open ? 1 : 0, w = 2 * Math.PI / UI.RESPONSE, z = 1 - UI.BOUNCE;
    const sg = z * w, wd = w * Math.sqrt(1 - z * z), x0 = m.p - target, v0 = m.v;
    const e = Math.exp(-sg * dt), c = Math.cos(wd * dt), sn = Math.sin(wd * dt);
    m.p = target + e * (x0 * c + (v0 + sg * x0) / wd * sn);
    m.v = e * (v0 * c - (w * w * x0 + sg * v0) / wd * sn);
    if (m.p <= 0) { m.p = 0; m.v = Math.max(0, m.v); }
    if (m.open && Math.abs(m.p - 1) < px && Math.abs(m.v) / 60 < px) { m.p = 1; m.v = 0; }
    m.turn = Menu.ease(m.turn, m.open, dt, 4 * ui.size, UI.FLIP);
    const shape = Menu.at(m, ui, m.p, t);
    if (!m.skin || m.room !== ui.room) {
      m.skin = new Skin(shape, UI.SPREAD);
      m.room = ui.room;
    } else m.skin.step(dt, shape);
  },

  // the measures and makers of a menu's parts in room at the text's size
  // size: { room, size, k, pad, apart, th, ph, lead, margin, row, wide,
  // letters, headed, head, pick }. th is a button's height and ph a row of
  // a button that picks, a button's less the room under its words for
  // descenders, so it stands a little less tall than what is under it;
  // wide(t) how wide the ink of t, a line's Type, is; letters(t, x0, y0,
  // sd) its letters, its ink's left at x0, on the baseline of a row whose
  // top is y0, their seeds from sd; headed(t) how wide a header saying t
  // is, its caret and t with two pads; head(t, x0, y0, sd) a header's
  // caret and words saying t, from x0 across on the row whose top is y0,
  // { caret, title }; and pick(types, x0, x1, py, sd) a button that picks
  // from x0 across to x1 with its top at py, a menu of its own ({ room,
  // size, shut, full, rows }): shut, round one row; open, down round a row
  // for each of types, rows[j] its place and, for each of them, the
  // letters that say it there, { j, rect, says }
  kit(room, size) {
    const U = UI, k = size / TYPE.EM, pad = U.PAD_X * size, apart = U.APART * size, cg = Menu.caret.glyphs[0], cw = cg ? k * cg.g.w : 0;
    const th = Math.round(size * (2 * U.PAD_Y + U.CAP + U.DESC)), ph = Math.round(size * (2 * U.PAD_Y + U.CAP));
    const wide = (t) => k * (t.left + t.right);
    const letters = (t, x0, y0, sd) => t.glyphs.map((gl) => Letter.make(gl.g, x0 + k * (gl.x + gl.dx + t.left), y0 + size * (U.PAD_Y + U.CAP) + k * gl.dy, sd + gl.at, k, LETTER.WOBBLE));
    return {
      room, size, k, pad, apart, th, ph, lead: Math.round(U.CAP_LEAD * size), margin: Math.round(U.MARGIN * size), row: Math.round(U.ROW * size),
      wide, letters,
      headed: (t) => Math.round(cw + apart + wide(t) + 2 * pad),
      head: (t, x0, y0, sd) => ({
        caret: cg ? Letter.make(cg.g, x0 + pad + cw / 2, y0 + size * (U.PAD_Y + U.CAP) + k * cg.dy, sd, k, LETTER.WOBBLE) : null,
        title: letters(t, x0 + pad + cw + apart, y0, sd + 10),
      }),
      pick: (types, x0, x1, py, sd) => {
        const rows = types.map((nt, j) => ({
          j, rect: { x0, y0: py + j * ph, x1, y1: py + (j + 1) * ph },
          says: types.map((ct) => letters(ct, x0 + pad, py + j * ph, sd + 100 * j)),
        }));
        return { room, size, shut: rows[0].rect, full: { x0, y0: py, x1, y1: py + types.length * ph }, rows };
      },
    };
  },

  // menu m, laid out as ui, dy world px down, on what the pointer is on
  // (on), into framebuffer into: while it is open at all, its insides
  // drawn into framebuffer apart over the menu's skin's box by
  // inside(ui, dy, t, on), and its header over them, so what its insides
  // put where the header is goes under it; then apart copied into into
  // through the skin and the skin outlined over it, in lit while its
  // header is hovered and in ink otherwise. a submenu is drawn as a menu
  // is, into the framebuffer its menu's insides are drawn apart in. a
  // menu wholly above or below into is not drawn
  draw(ui, m, dy, t, on, inside, into, apart, lit) {
    if (!m.skin) return;
    const v = on && on.menu === m ? lit : 1, box = m.skin.bounds();
    if (box.y0 + dy > into.h + UI.LINE || box.y1 + dy < -UI.LINE) return;
    apart.clearRows(Math.floor(box.y0 + dy) - UI.LINE, Math.ceil(box.y1 + dy) + UI.LINE + 1);
    if (m.p > 0) inside(ui, dy, t, on);
    if (ui.header.caret) ui.header.caret.draw(t, dy, apart, m.turn * Math.PI / 2, v);
    for (let i = 0; i < ui.header.title.length; i++) ui.header.title[i].draw(t, dy, apart, 0, v);
    const pts = m.skin.screen(dy), n = pts.length;
    into.fillPolygon(pts, apart);
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[i + 1 < n ? i + 1 : 0];
      into.line(p.x, p.y, q.x, q.y, v, UI.LINE);
    }
  },

  // button that picks pm, laid out as P (Menu.kit's pick) and listing
  // order, its row j saying P's type order[j], dy world px down, on what
  // the pointer is on (on), into framebuffer into: its skin outlined round
  // the one picked and, as far down as it has opened (grown), the others
  // under it. under the pointer its outline and the one picked are in lit,
  // and another of those it picks from in next; otherwise they are in ink
  drawPick(P, pm, order, dy, grown, t, on, into, lit, next) {
    const pv = on && on.option === P.rows[0] ? lit : 1;
    for (let j = 0; j < order.length; j++) {
      const r = P.rows[j];
      if (j && r.rect.y1 - UI.PAD_Y * P.size > P.shut.y1 + grown) break;
      const line = r.says[order[j]], rv = !j ? pv : on && on.option === r ? next : 1;
      for (let i = 0; i < line.length; i++) line[i].draw(t, dy, into, 0, rv);
    }
    if (!pm.skin) return;
    const ring = pm.skin.screen(dy), n = ring.length;
    for (let i = 0; i < n; i++) {
      const p = ring[i], q = ring[i + 1 < n ? i + 1 : 0];
      into.line(p.x, p.y, q.x, q.y, pv, UI.LINE);
    }
  },

  // a rounded box w x h as a sprite's ink, r round its corners: its
  // inside (fill) and its outline line px thick, UI.LINE unless given
  // (line)
  inkBox(w, h, r, line = UI.LINE) {
    const f = new Framebuffer(w, h), l = new Framebuffer(w, h);
    f.roundRect(0, 0, w, h, r, 1, 1, UI.LINE);
    l.roundRect(0, 0, w, h, r, null, 1, line);
    return { fill: { ink: Uint8Array.from(f.bits), w, h }, line: { ink: Uint8Array.from(l.bits), w, h } };
  },
};
