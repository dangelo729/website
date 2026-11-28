// --- tally -----------------------------------------------------------------------
// what the page tells the site's own server it is used for: the page
// opened, a section's box opened, a thing in one opened, a link of a
// thing's pressed, a doodle played with, and the time spent on the page
// and with each thing open. each is one small json body posted to PATH on
// the page's own origin (tools/server/tally.js), and never sent again: a
// send that fails is let go. the opening goes first, and every other event
// only once its answer, which gives the visitor its cookie, has come or
// failed, so all a first visit sends is one visitor's; nothing else waits
// on an answer. load(win) is handed the window and takes all it uses from
// it; with none, or no fetch in it, nothing is sent. the page tells it it
// opened (open), once a load, a phone where the pointer is coarse and else
// a desktop; each section's box as it opens (section) and each thing as it
// opens (item), by the word the page shows, sent as its name (name); each
// press on a thing's link, or on one of the page's own (link); and each doodle played with (play), sent
// once a load for each. every frame it is told the frame's ms and the
// things open then (frame): the s since the frame before, unless they are
// GAP or more, are spent on the page and on each of those; and when the
// page is hidden or left (away) the whole s spent since the last time are
// sent, the page's and each thing's, no more than MOST of either, the
// part of a s over and whatever is past MOST kept for the next. nothing
// else is sent: nothing typed, drawn or played.

const Tally = {
  PATH: '/api/tally', // where each event is posted, on the page's own origin
  GAP: 1,             // s between two frames from which the page was not being drawn, and none are spent
  MOST: 86400,        // the most s one time says of the page or of a thing: what the server takes (TALLY.SECONDS)

  win: null,      // the window
  opened: false,  // the page's opening has been told
  first: null,    // the opening's send while it is out, which every other waits on; null before it, and once it is answered or has failed
  at: null,       // the last frame's ms, or null before the first
  seconds: 0,     // s spent on the page and not yet sent
  spent: {},      // s spent with each thing open and not yet sent, by its word
  played: {},     // the doodles told as played with, by their words

  // handed the window, whose fetch sends each event
  load(win) {
    this.win = win;
  },

  // the page opened, once a load: 'phone' where the pointer is coarse,
  // else 'desktop'
  open() {
    if (this.opened) return;
    this.opened = true;
    const win = this.win, phone = !!win && typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches;
    this.first = this.post({ event: 'open', device: phone ? 'phone' : 'desktop' }).then(() => { this.first = null; });
  },

  // a section's or a thing's word as its name: in small letters, a - for
  // whatever is between them
  name(word) {
    return word.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  },

  // a section's box opened, by its word
  section(word) {
    this.send({ event: 'section', name: this.name(word) });
  },

  // a thing opened, by its word
  item(word) {
    this.send({ event: 'item', name: this.name(word) });
  },

  // a link of a thing's pressed, by the thing's word, or one of the
  // page's own, by its own
  link(word) {
    this.send({ event: 'link', name: this.name(word) });
  },

  // a doodle played with, by its word, once a load
  play(word) {
    if (this.played[word]) return;
    this.played[word] = true;
    this.send({ event: 'play', name: this.name(word) });
  },

  // a frame, at now ms, the things in open, by their words, open in it:
  // the s since the frame before spent on the page and with each of them,
  // unless they are GAP or more
  frame(now, open) {
    const dt = this.at === null ? 0 : (now - this.at) / 1000;
    this.at = now;
    if (!(dt > 0 && dt < this.GAP)) return;
    this.seconds += dt;
    for (let i = 0; i < open.length; i++) this.spent[open[i]] = (this.spent[open[i]] || 0) + dt;
  },

  // the page hidden or left: the whole s spent since the last time sent,
  // the page's and each thing's of one or more, by name, MOST of each at
  // the most, and the rest kept
  away() {
    const seconds = Math.min(Math.floor(this.seconds), this.MOST);
    if (seconds < 1) return;
    this.seconds -= seconds;
    const items = {};
    for (const word in this.spent) {
      const s = Math.min(Math.floor(this.spent[word]), this.MOST);
      if (s < 1) continue;
      this.spent[word] -= s;
      items[this.name(word)] = s;
    }
    this.send({ event: 'time', seconds, items });
  },

  // body sent: at once, or while the opening's send is out, once it has
  // settled
  send(body) {
    if (this.first) this.first.then(() => this.post(body));
    else this.post(body);
  },

  // body posted to PATH as json, kept alive past the page, its answer and
  // its failure let go: a promise settled once it is answered or has failed
  post(body) {
    const win = this.win;
    if (!win || typeof win.fetch !== 'function') return Promise.resolve();
    try {
      return Promise.resolve(win.fetch(this.PATH, {
        method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })).then(() => {}, () => {});
    } catch (e) {
      return Promise.resolve();
    }
  },
};
