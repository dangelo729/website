// node tools/test/tally.test.js
//
// loads js/tally.js the way the page does, a classic script, in a vm
// context of its own for each page load, and hands it a fake window whose
// fetch keeps each request and answers it, fails it or throws as the test
// says, so nothing reaches the network. checks that the page's opening is
// sent once a load, a phone where the pointer is coarse and else a
// desktop, and that first is its send while it is out and null before and
// after; that a word is sent as its name, small letters and a - between;
// the shapes of a section's box opened, a thing opened and a thing's link
// pressed, sent each time, and of a doodle played with, sent once a load
// for each; that the time between frames is spent on the page and on each
// thing open, but for a first frame, a gap of GAP or more, or a clock that
// stands still or goes back; that away sends the whole s spent since the
// last time, the page's and each thing's of one or more, keeps the rest
// for the next, sends nothing under 1 s, and over an hour at 60 frames a
// second loses nothing, and no time says more than MOST, the most the
// server takes, the rest kept; that with no window, or none with a fetch,
// nothing is sent and nothing thrown; that a send that fails, or throws, is let go
// and never sent again; that nothing else is sent until the opening is
// answered, which gives the visitor its cookie; that every request is a
// POST of json to /api/tally, kept alive; and that the script never
// reaches any other host. then reads index.html's SECTIONS and checks the
// names the server takes (tools/server/tally.js) are exactly those the
// page can send: its sections' and their boxes' sections', the doodles'
// things, and work's, each name once, and every word the page tells the
// tally a title. exits 1 on failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js', 'tally.js'), 'utf8');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}
// objects from the script's realm, compared by their json
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// a page loaded: the script run afresh, handed win if there is one
function page(win) {
  const ctx = vm.createContext({});
  vm.runInContext(SRC, ctx, { filename: 'js/tally.js' });
  const Tally = vm.runInContext('Tally', ctx);
  if (win !== undefined) Tally.load(win);
  return Tally;
}

// a fake window: its pointer coarse or not, and a fetch that keeps each
// request, answering it as answer says: 'ok', 'fail' (a network failure),
// 'throw' (thrown as it is called) or 'hold' (answered when the test calls
// each of held)
function window({ coarse = false, answer = 'ok', media = true } = {}) {
  const w = {
    sent: [],
    held: [],
    fetch(url, init) {
      w.sent.push({ url, init, body: JSON.parse(init.body) });
      if (answer === 'throw') throw new TypeError('no');
      if (answer === 'fail') return Promise.reject(new TypeError('Failed to fetch'));
      if (answer === 'hold') return new Promise((ok) => w.held.push(() => ok(new Response(null, { status: 204 }))));
      return Promise.resolve(new Response(null, { status: 204 }));
    },
  };
  if (media) w.matchMedia = (q) => ({ matches: q === '(pointer: coarse)' && coarse });
  return w;
}

// node's own queue run n times, every promise's turn taken
async function settle(n = 20) {
  for (let i = 0; i < n; i++) await new Promise((ok) => setImmediate(ok));
}

// the array literal in text from its [ at i to its matching ], quotes and
// comments skipped; or null if it never closes
function literal(text, i) {
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (c === '\'' || c === '"' || c === '`') {
      for (j++; j < text.length && text[j] !== c; j++) if (text[j] === '\\') j++;
    } else if (c === '/' && text[j + 1] === '/') {
      j = text.indexOf('\n', j);
      if (j < 0) return null;
    } else if (c === '/' && text[j + 1] === '*') {
      j = text.indexOf('*/', j + 2) + 1;
      if (j <= 0) return null;
    } else if (c === '[' || c === '{' || c === '(') depth++;
    else if (c === ']' || c === '}' || c === ')') {
      depth--;
      if (depth === 0) return text.slice(i, j + 1);
    }
  }
  return null;
}

(async () => {
  // --- the opening -----------------------------------------------------------------
  let w = window();
  let T = page(w);
  check('before the opening, first is null', T.first === null);
  T.open();
  check('the page opened: one open, a desktop', w.sent.length === 1 && same(w.sent[0].body, { event: 'open', device: 'desktop' }), JSON.stringify(w.sent.map((s) => s.body)));
  const r = w.sent[0];
  check('posted to /api/tally, json, kept alive', r.url === '/api/tally' && r.init.method === 'POST' && r.init.keepalive === true &&
    r.init.headers['Content-Type'] === 'application/json' && typeof r.init.body === 'string', JSON.stringify(r.init));
  T.open();
  check('opened once a load: a second open sends nothing', w.sent.length === 1);
  await settle();
  check('once it is answered, first is null again', T.first === null);
  w = window({ coarse: true });
  page(w).open();
  check('a coarse pointer: a phone', w.sent.length === 1 && same(w.sent[0].body, { event: 'open', device: 'phone' }));
  w = window({ media: false });
  page(w).open();
  check('no matchMedia: a desktop', w.sent.length === 1 && same(w.sent[0].body, { event: 'open', device: 'desktop' }));
  w = window({ answer: 'hold' });
  T = page(w);
  T.open();
  const out = T.first;
  check('while the opening is out, first is its send', !!out && typeof out.then === 'function');
  w.held.shift()();
  await settle();
  check('and null once it is answered', T.first === null);
  w = window({ answer: 'fail' });
  T = page(w);
  T.open();
  await settle();
  check('or once it has failed', T.first === null);

  // --- names -------------------------------------------------------------------------
  T = page(window());
  const names = ['Work', 'Critter & Guitari', 'This website!', 'BrandNewNoise', 'Third Dimension', '  Bubble   Bob ', 'monk-mouth', 'A1 -- b2'].map((x) => T.name(x));
  check('a word as its name: small letters, one - for whatever is between, none at either end',
    same(names, ['work', 'critter-guitari', 'this-website', 'brandnewnoise', 'third-dimension', 'bubble-bob', 'monk-mouth', 'a1-b2']), names.join(' '));

  // --- sections, things, links and doodles ---------------------------------------------
  w = window();
  T = page(w);
  T.section('Work');
  T.section('Work');
  T.item('Critter & Guitari');
  T.link('This website!');
  T.link('This website!');
  T.play('Bubble Bob');
  T.play('Bubble Bob');
  T.play('Graffiti Wall');
  T.play('Bubble Bob');
  T.play('Graffiti Wall');
  const bodies = w.sent.map((s) => s.body);
  check('a section\'s box opened, each time, by its name', same(bodies.slice(0, 2), [{ event: 'section', name: 'work' }, { event: 'section', name: 'work' }]), JSON.stringify(bodies.slice(0, 2)));
  check('a thing opened, by its name', same(bodies[2], { event: 'item', name: 'critter-guitari' }), JSON.stringify(bodies[2]));
  check('a thing\'s link pressed, each time, by the thing\'s name', same(bodies.slice(3, 5), [{ event: 'link', name: 'this-website' }, { event: 'link', name: 'this-website' }]), JSON.stringify(bodies.slice(3, 5)));
  check('each doodle played with, once a load for each', same(bodies.slice(5), [{ event: 'play', name: 'bubble-bob' }, { event: 'play', name: 'graffiti-wall' }]), JSON.stringify(bodies.slice(5)));
  check('one request each, every one a POST to /api/tally', w.sent.length === 7 && w.sent.every((s) => s.url === '/api/tally' && s.init.method === 'POST'));
  w = window();
  T = page(w);
  T.play('Bubble Bob');
  check('a new load: played with again, sent again', w.sent.length === 1 && same(w.sent[0].body, { event: 'play', name: 'bubble-bob' }));

  // --- time ---------------------------------------------------------------------------------
  w = window();
  T = page(w);
  const S = 'Sennheiser', B = 'Bubble Bob';
  // frames, each [ms, the things open by their words]
  const frames = (list) => { for (const [now, open] of list) T.frame(now, open); };
  const left = () => ({ seconds: T.seconds, spent: Object.assign({}, T.spent) });
  check('GAP is 1 s', T.GAP === 1);
  frames([[1000, [S]]]);
  check('a first frame: nothing spent', T.seconds === 0 && same(T.spent, {}), JSON.stringify(left()));
  frames([[1250, [S]], [1500, [S]], [1750, [S, B]], [2000, [S, B]]]);
  check('the s between frames spent on the page and on each thing open', same(left(), { seconds: 1, spent: { [S]: 1, [B]: 0.5 } }), JSON.stringify(left()));
  frames([[3000, [S, B]]]);
  check('a gap of GAP exactly: nothing spent', same(left(), { seconds: 1, spent: { [S]: 1, [B]: 0.5 } }), JSON.stringify(left()));
  frames([[3250, [S, B]]]);
  check('and from the frame after it, spent again', same(left(), { seconds: 1.25, spent: { [S]: 1.25, [B]: 0.75 } }), JSON.stringify(left()));
  frames([[8250, [S]], [8250, [S]], [8000, [S]]]);
  check('a gap of 5 s, a clock that stands still, one that goes back: nothing spent', same(left(), { seconds: 1.25, spent: { [S]: 1.25, [B]: 0.75 } }), JSON.stringify(left()));
  frames([[8500, [S]], [8750, []], [9000, [B]]]);
  check('counted from the frame that went back; a frame with nothing open spent on the page alone', same(left(), { seconds: 2.25, spent: { [S]: 1.75, [B]: 1 } }), JSON.stringify(left()));
  frames([[9250, [S, S]]]);
  check('a thing open twice in a frame spends its time twice', same(left(), { seconds: 2.5, spent: { [S]: 2.25, [B]: 1 } }), JSON.stringify(left()));
  check('nothing sent while frames come', w.sent.length === 0);
  T.away();
  check('away: the whole s sent, the page\'s and each thing\'s, by name', w.sent.length === 1 && same(w.sent[0].body, { event: 'time', seconds: 2, items: { sennheiser: 2, 'bubble-bob': 1 } }),
    JSON.stringify(w.sent.map((s) => s.body)));
  check('and the part of a s over kept', same(left(), { seconds: 0.5, spent: { [S]: 0.25, [B]: 0 } }), JSON.stringify(left()));
  T.away();
  check('away again at once: under 1 s, nothing sent', w.sent.length === 1);
  frames([[9500, []], [9750, []]]);
  T.away();
  check('the page\'s kept part and 0.5 s more: 1 s sent, a thing under 1 s left out', same(w.sent[1] && w.sent[1].body, { event: 'time', seconds: 1, items: {} }), JSON.stringify(w.sent[1] && w.sent[1].body));
  check('and its part kept', same(left(), { seconds: 0, spent: { [S]: 0.25, [B]: 0 } }), JSON.stringify(left()));
  frames([[10000, [S]], [10250, [S]], [10500, [S]]]);
  T.away();
  check('under 1 s on the page: nothing sent, though a thing has a whole s', w.sent.length === 2 && same(left(), { seconds: 0.75, spent: { [S]: 1, [B]: 0 } }), JSON.stringify(left()));
  frames([[10750, [B]]]);
  T.away();
  check('once the page has 1 s: the thing\'s kept part sent with it', same(w.sent[2] && w.sent[2].body, { event: 'time', seconds: 1, items: { sennheiser: 1 } }), JSON.stringify(w.sent[2] && w.sent[2].body));
  check('and the rest kept', same(left(), { seconds: 0, spent: { [S]: 0, [B]: 0.25 } }), JSON.stringify(left()));
  check('each time a POST to /api/tally, kept alive', w.sent.every((s) => s.url === '/api/tally' && s.init.method === 'POST' && s.init.keepalive === true));

  w = window();
  T = page(w);
  const HZ = 60, SECONDS = 3700;
  let sent = 0, items = 0;
  for (let i = 0; i <= SECONDS * HZ; i++) {
    T.frame(5000 + i * 1000 / HZ, [S]);
    if (i % (HZ * 600) === 0) T.away();
  }
  T.away();
  for (const s of w.sent) {
    sent += s.body.seconds;
    items += s.body.items.sennheiser || 0;
  }
  check('an hour at 60 frames a second, away every 10 minutes: what is sent and what is kept add up to the time drawn',
    Math.abs(sent + T.seconds - SECONDS) < 1e-6 && Math.abs(items + T.spent[S] - SECONDS) < 1e-6 && w.sent.every((s) => Number.isInteger(s.body.seconds) && s.body.seconds >= 1),
    sent + ' s sent, ' + T.seconds.toFixed(9) + ' kept, ' + w.sent.length + ' sends');

  w = window();
  T = page(w);
  const MOST = Number((/SECONDS: (\d+),/.exec(fs.readFileSync(path.join(ROOT, 'tools', 'server', 'tally.js'), 'utf8')) || [])[1]);
  check('MOST is the most s the server takes of a time', MOST > 0 && T.MOST === MOST, T.MOST + ' and ' + MOST);
  for (let i = 0; i <= 2 * (MOST + 1000); i++) T.frame(5000 + i * 500, i % 2 ? [S] : []);
  T.away();
  await settle();
  check('more than MOST s on the page: a time says MOST, and the rest is kept for the next',
    w.sent.length === 1 && w.sent[0].body.seconds === MOST && Math.abs(T.seconds - 1000) < 1e-6, JSON.stringify(w.sent.map((s) => s.body)) + ' ' + T.seconds);
  check('a thing open half of it says its own s', w.sent[0].body.items.sennheiser === (MOST + 1000) / 2, JSON.stringify(w.sent[0].body.items));
  T.away();
  await settle();
  check('the next says what was kept', w.sent.length === 2 && w.sent[1].body.seconds === 1000 && same(w.sent[1].body.items, {}), JSON.stringify(w.sent[1] && w.sent[1].body));

  // --- the opening first ---------------------------------------------------------------
  w = window({ answer: 'hold' });
  T = page(w);
  T.open();
  T.section('Doodles');
  T.item('Graffiti Wall');
  T.link('Upright');
  T.play('Graffiti Wall');
  frames([[0, ['Graffiti Wall']], [500, ['Graffiti Wall']], [1000, ['Graffiti Wall']]]);
  T.away();
  await settle();
  check('until the opening is answered, nothing else is sent', w.sent.length === 1 && w.sent[0].body.event === 'open', JSON.stringify(w.sent.map((s) => s.body.event)));
  w.held.shift()();
  await settle();
  check('once it is, the rest follow, in turn', same(w.sent.map((s) => s.body.event), ['open', 'section', 'item', 'link', 'play', 'time']), JSON.stringify(w.sent.map((s) => s.body.event)));
  T.section('About');
  check('and from then on at once', w.sent.length === 7 && same(w.sent[6].body, { event: 'section', name: 'about' }));

  // --- nothing to send with ------------------------------------------------------------
  let threw = false;
  try {
    for (const win of [undefined, { matchMedia: () => ({ matches: false }) }]) {
      T = page(win);
      T.open();
      T.section('Work');
      T.item('Upright');
      T.link('Upright');
      T.play('Bubble Bob');
      T.frame(0, ['Upright']);
      T.frame(900, ['Upright']);
      T.frame(1800, ['Upright']);
      T.away();
    }
    await settle();
  } catch (e) {
    threw = e;
  }
  check('never handed a window, or one with no fetch: nothing thrown', !threw, threw ? threw.message : undefined);

  // --- sends that fail ------------------------------------------------------------------
  let unhandled = 0;
  const count = () => unhandled++;
  process.on('unhandledRejection', count);
  w = window({ answer: 'fail' });
  T = page(w);
  T.open();
  T.section('Work');
  T.frame(0, []);
  T.frame(600, []);
  T.frame(1200, []);
  T.away();
  await settle();
  check('a send that fails is let go: nothing unhandled', unhandled === 0, unhandled);
  check('and never sent again', w.sent.length === 3 && w.sent.filter((s) => s.body.event === 'open').length === 1);
  T.frame(1800, []);
  T.frame(2400, []);
  T.away();
  check('a time that failed not sent again with the next', same(w.sent[3].body, { event: 'time', seconds: 1, items: {} }), JSON.stringify(w.sent[3] && w.sent[3].body));
  w = window({ answer: 'throw' });
  T = page(w);
  threw = false;
  try {
    T.open();
    T.item('Cicada');
  } catch (e) {
    threw = e;
  }
  await settle();
  check('a fetch that throws is let go, and the next is still sent', !threw && w.sent.length === 2 && unhandled === 0, threw ? threw.message : undefined);
  process.off('unhandledRejection', count);

  // --- no other host ------------------------------------------------------------------------
  check('the script reaches no other host', !/https?:|\/\//.test(SRC.replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '')));

  // --- the names the page can send --------------------------------------------------------------
  const server = await import(pathToFileURL(path.join(ROOT, 'tools/server/tally.js')).href);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const at = [...html.matchAll(/const SECTIONS = \[/g)];
  check('index.html holds one SECTIONS literal', at.length === 1, at.length + ' found');
  let list = null, why = 'not found';
  if (at.length === 1) {
    const text = literal(html, at[0].index + at[0][0].length - 1);
    try {
      list = text && vm.runInNewContext('(' + text + ')', {});
      if (!list) why = 'never closes';
    } catch (e) {
      why = e.message;
    }
  }
  check('it is a list made of nothing but values', Array.isArray(list) && list.length > 0, Array.isArray(list) ? list.length + ' sections' : why);
  // every section's title, its boxes' sections' in turn, and the titles of
  // the things in each, the doodles' apart from the rest
  const T2 = page(window());
  const sections = [], doodles = [], work = [], untitled = [];
  const walk = (s) => {
    if (!s || typeof s.title !== 'string') return untitled.push(JSON.stringify(s).slice(0, 40));
    sections.push(s.title);
    for (const it of s.items || []) {
      if (!it || typeof it.title !== 'string') untitled.push(JSON.stringify(it).slice(0, 40));
      else (s.title === 'Doodles' ? doodles : work).push(it.title);
    }
    for (const sub of s.subs || []) walk(sub);
  };
  for (const s of Array.isArray(list) ? list : []) walk(s);
  check('every section and every thing in one has a title, and there are some of each', untitled.length === 0 && sections.length > 0 && doodles.length > 0 && work.length > 0,
    untitled.join(', ') || sections.length + ' sections, ' + doodles.length + ' doodles, ' + work.length + ' of work');
  const asNames = (words) => words.map((x) => T2.name(x));
  const asSet = (xs) => [...new Set(xs)].sort();
  const all = asNames([...sections, ...doodles, ...work]);
  check('each name once among them all', new Set(all).size === all.length, all.join(' '));
  check('the sections\' names: the server\'s SECTIONS', same(asSet(asNames(sections)), asSet(server.SECTIONS)) && new Set(server.SECTIONS).size === server.SECTIONS.length,
    asNames(sections).join(' ') + ' / ' + server.SECTIONS.join(' '));
  check('the doodles\' names: its DOODLES', same(asSet(asNames(doodles)), asSet(server.DOODLES)) && new Set(server.DOODLES).size === server.DOODLES.length,
    asNames(doodles).join(' ') + ' / ' + server.DOODLES.join(' '));
  check('every other thing\'s name: its WORK', same(asSet(asNames(work)), asSet(server.WORK)) && new Set(server.WORK).size === server.WORK.length,
    asNames(work).join(' ') + ' / ' + server.WORK.join(' '));
  const calls = [...html.matchAll(/Tally\.(section|item|link|play)\(([^)]*)\)/g)];
  const notTitles = calls.filter((m) => !/^[\w.]+\.title$/.test(m[2].trim())).map((m) => m[0]);
  check('every word the page tells the tally of is a title', calls.length > 0 && notTitles.length === 0, notTitles.join(', ') || calls.length + ' calls');
  const told = (html.match(/openThings\.push\(([^)]*)\)/) || [])[1];
  check('and so is every thing it tells it is open', !!told && /\.title$/.test(told.trim()), told);

  console.log('\n' + (failures ? failures + ' failed' : 'all passed'));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
