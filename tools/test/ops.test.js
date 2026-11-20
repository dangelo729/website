// node tools/test/ops.test.js
//
// runs the site's worker (tools/server/worker.js) in node as wrangler
// bundles it, its gate page imported as text, with a stand-in for the
// site's files that answers every path with the path, and a stand-in for
// d1 made on node's own sqlite (node:sqlite) with d1's prepare, bind,
// first, all, run and batch, a batch all or nothing, each database made
// afresh from the real migrations (tools/server/migrations). the clock is
// moved by hand. a site's env is dev's, which starts locked, unless it is
// given OPEN "1" as the live site is. checks that /api/tally is answered
// only to a visitor the gate lets in, anyone else getting the gate page,
// and every other path as the gate answers it; that bad bodies, too big,
// not json, not an event, a field missing, unknown or not one it may be, a
// name not one of SECTIONS, WORK or DOODLES where it must be, a time's s
// or a thing's not a whole 1 to SECONDS, are refused and nothing written;
// that the visitor's cookie is set when there is none or it is not an id,
// kept, and set again with each opening; that the counts are cut by new
// york's day, at its midnight, and across the end of daylight saving; that
// a visitor is new only at its first opening and counted a visitor once a
// day; that no address nor browser is kept, and a country only as two
// letters; that every section, thing, link and doodle the page can send is
// taken and counted as <event>:<name>, and none in another's place; that a
// time is kept as it came, its s added to the visitor's row for the day in
// stays, split at new york's midnight, and each thing's counted as
// spent:<name>; that each event and its counts are written in one batch,
// none of it if any fails; and that the owner is left out by the me
// cookie, a visitor from then on, what it did before left counted.
//
// then the site's lock as its database's gate row says: with no row, no
// table or a database that fails in a fresh isolate, as its worker
// starts, dev locked to its secret and the live site open, its page as it
// is; a read that fails after a row was read leaving that row, open or
// locked; a row open letting anyone into the files and /api/tally, the
// page with nothing asking it not to be indexed; a row with a password
// set from ops opening to it and not the secret, an old cookie turned
// away; a row with no password locked or open with the secret still the
// password, on either site; and the row, or none, kept KEPT s in memory,
// a change unseen before and seen after, read once in that time. then the
// ops worker (tools/ops/worker.js), run the same way with both sites'
// databases: its gate page, its cookie and the me cookie with it, for the
// whole of dangelo.engineering, HttpOnly, Secure, SameSite=Lax, 400 days,
// and only for the right password; its gate never the gate rows' nor
// opened by OPEN; its page and the look's files behind it, every answer
// neither cached nor indexed. /stats behind the gate: each window's every
// day, oldest first, empty ones too, cut at new york's midnight and across
// the end of daylight saving; each day's timed and median from stays, odd
// and even counts, and none on a day without; the window's median, 0 with
// none; the names; the actives from the start of the day 6 and 29 days
// back; main and dev each its own database; only daily, visitors by its
// index on last, and stays by its days read; and every bad query refused.
// /controls behind the gate: with no rows, main open and dev locked, as
// they start; what it answers holding no password, hash, salt nor key; a
// POST setting the lock and a password, each leaving the other, a password
// alone with no row keeping the site as it starts; and a malformed body, a
// wrong or missing origin, and any type but json all refused, nothing
// written. then ops setting dev's password and lock and the live site's,
// each site's worker following within KEPT s, and a time posted to dev in
// ops's numbers. last, wrangler.toml: what each worker is handed, OPEN
// where its STARTS says (tools/ops/site.js), and ops reading each site's
// own database. nothing reaches cloudflare. exits 1 on failure.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { registerHooks } = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const { pathToFileURL, fileURLToPath } = require('url');

const ROOT = path.join(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'tools/server/migrations');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// the gate page imported as wrangler bundles it: its text, the module's default
registerHooks({
  load(url, context, next) {
    if (url.startsWith('file:') && url.endsWith('.html')) {
      return { format: 'module', source: 'export default ' + JSON.stringify(fs.readFileSync(fileURLToPath(url), 'utf8')), shortCircuit: true };
    }
    return next(url, context);
  },
});

// --- d1 on node's sqlite ------------------------------------------------------------
// a database made afresh, every migration applied in order. as d1, a
// statement is bound to make another, a value undefined is refused, and a
// batch is all or nothing; each batch's statements are kept, by their sql.
// down, every statement is refused as it is prepared
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const f of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
  const statement = (sql, args) => {
    for (const a of args) if (a === undefined) throw new Error("D1_TYPE_ERROR: Type 'undefined' not supported");
    const result = () => ({ success: true, results: db.prepare(sql).all(...args).map((r) => ({ ...r })), meta: {} });
    return {
      sql,
      result,
      bind: (...more) => statement(sql, more),
      first: async (col) => {
        const r = result().results[0];
        return r === undefined ? null : col === undefined ? r : r[col];
      },
      all: async () => result(),
      run: async () => result(),
    };
  };
  const D = {
    db,
    batches: [],
    down: false,
    prepare: (sql) => {
      if (D.down) throw new Error('D1_ERROR: the database is down');
      return statement(sql, []);
    },
    async batch(list) {
      D.batches.push(list.map((s) => s.sql));
      db.exec('BEGIN');
      try {
        const out = list.map((s) => s.result());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return D;
}
const TABLES = ['events', 'daily', 'visitors', 'stays', 'excluded'];
// a table's rows, as plain objects
const rows = (D, table) => D.db.prepare('SELECT * FROM ' + table).all().map((r) => ({ ...r }));
// how many rows there are in every table together
const written = (D) => TABLES.reduce((n, t) => n + rows(D, t).length, 0);
// every table, as json
const dump = (D) => JSON.stringify(TABLES.map((t) => rows(D, t)));
// the day's counts, by metric
const counts = (D, day) => Object.fromEntries(D.db.prepare('SELECT metric, n FROM daily WHERE day = ? ORDER BY metric').all(day).map((r) => [r.metric, r.n]));
// the counts as json, metrics in order
const countsAre = (D, day, want) => same(counts(D, day), Object.fromEntries(Object.entries(want).sort(([a], [b]) => (a < b ? -1 : 1))));
// the stays, in order
const stays = (D) => D.db.prepare('SELECT day, visitor, seconds FROM stays ORDER BY day, visitor').all().map((r) => ({ ...r }));

// --- the clock, the site, and asking it ----------------------------------------------
let clock = Date.parse('2026-10-30T12:00:00Z');
const realNow = Date.now;
Date.now = () => clock;
const at = (iso) => { clock = Date.parse(iso); };

const PASSWORD = 'a long walk to the sea';
const SITE = { fetch: async (request) => new Response('site ' + new URL(request.url).pathname, { status: 200 }) };
// a site's worker's env: its password, its files and a database of its
// own, as dev's, which starts locked; the live site's starts open
const site = (more) => Object.assign({ PASSWORD, ASSETS: SITE, DB: d1() }, more);
const live = (more) => site(Object.assign({ OPEN: '1' }, more));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// a request to dev.dangelo.engineering: method, path, its cookies, a body
// (json unless a string), more headers, and the country cloudflare says
// (none for null)
function ask(method, at, { cookies = [], body, headers = {}, country = 'US' } = {}) {
  const h = Object.assign({}, headers);
  if (cookies.length) h.Cookie = cookies.join('; ');
  const r = new Request('https://dev.dangelo.engineering' + at, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  r.cf = country === null ? {} : { country };
  return r;
}

// wrangler.toml read as its tables: each [name] an object of its keys and
// each [[name]] a list of them, a value json where it is and its text
// where it is not
function toml(text) {
  const out = { '': {} }, lines = text.split('\n');
  let table = out[''];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/(^|\s)#.*$/, '').trim();
    if (!line) continue;
    let m = line.match(/^\[\[([\w.]+)\]\]$/);
    if (m) {
      (out[m[1]] = out[m[1]] || []).push(table = {});
      continue;
    }
    m = line.match(/^\[([\w.]+)\]$/);
    if (m) {
      table = out[m[1]] = {};
      continue;
    }
    m = line.match(/^(\w+)\s*=\s*(.*)$/);
    if (!m) throw new Error('wrangler.toml, line ' + (i + 1) + ': ' + line);
    let value = m[2];
    while ((value.match(/\[/g) || []).length > (value.match(/\]/g) || []).length && i + 1 < lines.length) value += ' ' + lines[++i].trim();
    try {
      table[m[1]] = JSON.parse(value);
    } catch (e) {
      table[m[1]] = value;
    }
  }
  return out;
}

(async () => {
  const worker = (await import(pathToFileURL(path.join(ROOT, 'tools/server/worker.js')).href)).default;
  const { TALLY, ZONE, SECTIONS, WORK, DOODLES, dayOf } = await import(pathToFileURL(path.join(ROOT, 'tools/server/tally.js')).href);
  const gates = await import(pathToFileURL(path.join(ROOT, 'tools/server/gate.js')).href);
  const PAGE = fs.readFileSync(path.join(ROOT, 'tools/server/gate.html'), 'utf8');
  let GATE = ''; // the gate's cookie, as name=value

  // an event posted to /api/tally through the worker as the page posts
  // it, with the gate's cookie unless gate is false, the visitor's v and
  // the me cookie if given: the answer, its status, and the visitor's
  // cookie it sets, whole and its id
  async function post(env, body, { v, me, gate = true, cookies = [], headers, country } = {}) {
    const cs = [...cookies];
    if (gate) cs.push(GATE);
    if (v) cs.push('v=' + v);
    if (me) cs.push('me=1');
    const r = await worker.fetch(ask('POST', '/api/tally', { cookies: cs, body, headers, country }), env);
    const set = r.headers.get('Set-Cookie'), m = set && set.match(/^v=([^;]*)/);
    return { r, status: r.status, set, v: m ? m[1] : null };
  }
  const OPEN = { event: 'open', device: 'desktop' }, PHONE = { event: 'open', device: 'phone' };
  const SEC = { event: 'section', name: 'work' }, ITEM = { event: 'item', name: 'sennheiser' }, LINK = { event: 'link', name: 'upright' }, PLAY = { event: 'play', name: 'bubble-bob' };
  const TIME = { event: 'time', seconds: 30, items: { sennheiser: 20 } };
  const time = (seconds, items = {}) => ({ event: 'time', seconds, items });
  // the counts of a new visitor's one opening on a desktop in the us
  const OPENED = { visits: 1, visitors: 1, new: 1, 'device:desktop': 1, 'country:US': 1 };
  // a new visitor's first opening: its id
  const visitor = async (env, body = OPEN, more) => (await post(env, body, more)).v;
  const unindexed = (a) => a.r.headers.get('Cache-Control') === 'no-store' && a.r.headers.get('X-Robots-Tag') === 'noindex';

  // --- the stand-in -------------------------------------------------------------------
  let D = d1();
  try {
    await D.batch([D.prepare('INSERT INTO excluded (visitor) VALUES (?)').bind('x'), D.prepare('INSERT INTO nowhere VALUES (1)')]);
  } catch (e) {}
  check('the stand-in: a batch that fails writes nothing', rows(D, 'excluded').length === 0);
  await D.batch([D.prepare('INSERT INTO excluded (visitor) VALUES (?)').bind('x')]);
  check('and one that does not writes it', rows(D, 'excluded').length === 1);
  let threw = false;
  try {
    D.prepare('SELECT ?').bind(undefined);
  } catch (e) {
    threw = true;
  }
  check('and undefined is refused, as d1 refuses it', threw);
  check('the migrations make the tables, with nothing in them', same(D.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name),
    ['daily', 'events', 'excluded', 'gate', 'stays', 'visitors']) && written(d1()) === 0);
  const columns = (t) => D.db.prepare('PRAGMA table_info(' + t + ')').all().map((c) => c.name);
  check('an event keeps no address nor browser: its columns', same(columns('events'), ['at', 'event', 'visitor', 'name', 'seconds', 'items', 'device', 'country']), columns('events').join(' '));
  check('nor a visitor', same(columns('visitors'), ['visitor', 'first', 'last', 'device', 'country']));
  check('nor a stay: its day, its visitor and its s', same(columns('stays'), ['day', 'visitor', 'seconds']), columns('stays').join(' '));

  // --- behind the gate ------------------------------------------------------------------
  let env = site();
  let a = await post(env, OPEN, { gate: false });
  check('no gate cookie: /api/tally is the gate page, 401', a.status === 401 && (await a.r.text()) === PAGE, a.status);
  check('nothing written, no visitor cookie', written(env.DB) === 0 && !a.v);
  let g = await worker.fetch(ask('POST', '/gate', { body: 'the wrong password' }), env);
  check('a wrong password at /gate: 401', g.status === 401, g.status);
  g = await worker.fetch(ask('POST', '/gate', { body: PASSWORD }), env);
  GATE = (g.headers.get('Set-Cookie') || '').split(';')[0];
  check('the right one: the gate\'s cookie', g.status === 204 && GATE.startsWith('gate='), GATE);
  a = await post(env, OPEN);
  check('with it: /api/tally answers, 204', a.status === 204 && written(env.DB) > 0, a.status);
  const [name, value] = GATE.split('=');
  a = await post(env, OPEN, { gate: false, cookies: [name + '=' + value.replace(/\.(.)/, (m, c) => '.' + (c === 'A' ? 'B' : 'A'))] });
  check('a tampered gate cookie: the gate page', a.status === 401 && (await a.r.text()) === PAGE, a.status);
  let r = await worker.fetch(ask('GET', '/', { cookies: [GATE] }), env);
  check('the cookie: / is the site, as it was, not indexed', r.status === 200 && (await r.text()) === 'site /' && r.headers.get('X-Robots-Tag') === 'noindex', r.status);
  r = await worker.fetch(ask('GET', '/index.html'), env);
  check('no cookie: the page by its name is the gate page', r.status === 401 && (await r.text()) === PAGE, r.status);
  r = await worker.fetch(ask('GET', '/some/where'), env);
  check('no cookie: any other path is the gate page, as it was', r.status === 401 && (await r.text()) === PAGE, r.status);
  r = await worker.fetch(ask('GET', '/api/tally', { cookies: [GATE] }), env);
  check('a GET of /api/tally through the gate: refused, 400', r.status === 400, r.status);
  r = await worker.fetch(ask('GET', '/api/tally'), env);
  check('and without the cookie: the gate page', r.status === 401, r.status);
  env = site({ PASSWORD: undefined });
  a = await post(env, OPEN);
  check('no password set: nobody\'s event is taken, the gate page', a.status === 401 && written(env.DB) === 0, a.status);

  // --- bad bodies --------------------------------------------------------------------------
  env = site();
  const and = (body, more) => Object.assign({}, body, more);
  const BAD = [
    ['not json', 'open'], ['empty', ''], ['json null', 'null'], ['an array', '[{"event":"open","device":"phone"}]'], ['a string', '"open"'], ['a number', '7'],
    ['no event', {}], ['an unknown event', { event: 'visit' }], ['an event as a list', { event: ['open'], device: 'phone' }], ['an event in capitals', { event: 'OPEN', device: 'phone' }],
    ['open with no device', { event: 'open' }], ['open, an unknown device', { event: 'open', device: 'tablet' }], ['open, a field more', and(PHONE, { name: 'work' })],
    ['open, a __proto__ field', '{"event":"open","device":"phone","__proto__":{"x":1}}'],
    ['a section with no name', { event: 'section' }], ['a section unknown', and(SEC, { name: 'blog' })], ['a section by its word', and(SEC, { name: 'Work' })],
    ['a section named as a thing', and(SEC, { name: 'sennheiser' })], ['a section\'s name a list', and(SEC, { name: ['work'] })], ['a section, a field more', and(SEC, { seconds: 5 })],
    ['a thing with no name', { event: 'item' }], ['a thing unknown', and(ITEM, { name: 'nothing' })], ['a thing by its word', and(ITEM, { name: 'Critter & Guitari' })],
    ['a thing named as a section', and(ITEM, { name: 'work' })], ['a thing from the prototype', and(ITEM, { name: 'constructor' })], ['a thing, a field more', and(ITEM, { device: 'phone' })],
    ['a link with no name', { event: 'link' }], ['a link unknown', and(LINK, { name: 'github' })], ['a link named as a section', and(LINK, { name: 'contact' })],
    ['play with no name', { event: 'play' }], ['play, a thing of work', and(PLAY, { name: 'chebble' })], ['play, unknown', and(PLAY, { name: 'pong' })],
    ['a time with no s', { event: 'time', items: {} }], ['a time with no items', { event: 'time', seconds: 30 }], ['a time, a field more', and(TIME, { name: 'work' })],
    ['a time of 0 s', and(TIME, { seconds: 0 })], ['a time below 0', and(TIME, { seconds: -5 })], ['a time not whole', and(TIME, { seconds: 1.5 })],
    ['a time as text', and(TIME, { seconds: '30' })], ['a time null', and(TIME, { seconds: null })], ['a time true', and(TIME, { seconds: true })],
    ['a time past SECONDS', and(TIME, { seconds: TALLY.SECONDS + 1 })],
    ['a time\'s items null', and(TIME, { items: null })], ['its items a list', and(TIME, { items: [20] })], ['its items text', and(TIME, { items: 'sennheiser' })], ['its items a number', and(TIME, { items: 5 })],
    ['a thing unknown', and(TIME, { items: { blog: 5 } })], ['a section as a thing', and(TIME, { items: { work: 5 } })], ['a thing by its word', and(TIME, { items: { Sennheiser: 5 } })],
    ['a thing of 0 s', and(TIME, { items: { sennheiser: 0 } })], ['a thing below 0', and(TIME, { items: { sennheiser: -1 } })], ['a thing not whole', and(TIME, { items: { sennheiser: 2.5 } })],
    ['a thing\'s s as text', and(TIME, { items: { sennheiser: '5' } })], ['a thing\'s s null', and(TIME, { items: { sennheiser: null } })], ['a thing past SECONDS', and(TIME, { items: { sennheiser: TALLY.SECONDS + 1 } })],
    ['a thing\'s s an object', and(TIME, { items: { sennheiser: { s: 5 } } })], ['one thing good and one unknown', and(TIME, { items: { sennheiser: 5, blog: 5 } })],
    ['a thing from the prototype', and(TIME, { items: { toString: 5 } })], ['a __proto__ thing', '{"event":"time","seconds":30,"items":{"__proto__":5}}'],
  ];
  const wrong = [];
  let bare = true;
  for (const [what, body] of BAD) {
    a = await post(env, body);
    if (a.status !== 400 || a.set) wrong.push(what + ' ' + a.status);
    bare = bare && unindexed(a);
  }
  const base = JSON.stringify(PHONE), pad = (n) => base.slice(0, -1) + ' '.repeat(n - base.length) + '}';
  a = await post(env, pad(TALLY.BYTES + 1));
  if (a.status !== 400) wrong.push('a body a byte past BYTES ' + a.status);
  a = await post(env, JSON.stringify(PHONE), { headers: { 'Content-Length': String(TALLY.BYTES + 1) } });
  if (a.status !== 400) wrong.push('a body said to be past BYTES ' + a.status);
  check('every bad body refused, 400, and no cookie set', wrong.length === 0, wrong.join(', ') || BAD.length + 2 + ' bodies');
  check('and nothing written', written(env.DB) === 0, dump(env.DB));
  check('each refusal not cached nor indexed', bare);
  a = await post(env, pad(TALLY.BYTES));
  check('a body of BYTES exactly is taken', a.status === 204 && rows(env.DB, 'events').length === 1, a.status);

  // --- the visitor's cookie --------------------------------------------------------------------
  env = site();
  at('2026-11-16T15:00:00Z');
  a = await post(env, OPEN);
  const A = a.v;
  check('a first opening: 204, the visitor\'s cookie set, a random id', a.status === 204 && UUID.test(A || ''), a.set);
  check('it is HttpOnly, Secure, SameSite=Lax, for the whole site, for 400 days, this host\'s only',
    /; HttpOnly/.test(a.set) && /; Secure/.test(a.set) && /; SameSite=Lax/.test(a.set) && /; Path=\//.test(a.set) &&
    a.set.includes('; Max-Age=' + 400 * 86400) && !/domain/i.test(a.set), a.set);
  check('the answer is not cached nor indexed', unindexed(a));
  a = await post(env, OPEN, { v: A });
  check('an opening with it: kept, and set again, so it lasts from now', a.status === 204 && a.v === A, a.set);
  a = await post(env, SEC, { v: A });
  check('another event with it: kept, not set again', a.status === 204 && a.set === null, a.set);
  a = await post(env, SEC);
  check('another event with none: one set, a new id', a.status === 204 && UUID.test(a.v || '') && a.v !== A, a.set);
  a = await post(env, OPEN, { v: 'not-an-id' });
  check('one not an id: put by, a new one set', a.status === 204 && UUID.test(a.v || '') && a.v !== A, a.set);
  a = await post(env, OPEN, { v: A.toUpperCase() });
  check('one in capitals is not an id either', UUID.test(a.v || '') && a.v !== A && a.v !== A.toUpperCase(), a.set);
  check('the visitor\'s three events kept by its id', rows(env.DB, 'events').filter((e) => e.visitor === A).length === 3);

  // --- new york's days --------------------------------------------------------------------------
  check('the zone is new york\'s', ZONE === 'America/New_York');
  const days = ['2026-07-01T03:59:00Z', '2026-07-01T04:00:00Z', '2026-11-17T04:59:59Z', '2026-11-17T05:00:00Z'].map((s) => dayOf(Date.parse(s)));
  check('days cut at new york\'s midnight: 4 h past utc\'s in summer, 5 in winter', same(days, ['2026-06-30', '2026-07-01', '2026-11-16', '2026-11-17']), days.join(' '));
  env = site();
  at('2026-11-17T04:59:00Z');
  const N = await visitor(env, PHONE);
  check('a phone opens at 23:59 in new york: the 16th\'s visit, visitor, new one, phone and country',
    countsAre(env.DB, '2026-11-16', { visits: 1, visitors: 1, new: 1, 'device:phone': 1, 'country:US': 1 }), JSON.stringify(counts(env.DB, '2026-11-16')));
  at('2026-11-17T04:59:30Z');
  await post(env, PHONE, { v: N });
  check('again that minute: a visit more, the same visitor', countsAre(env.DB, '2026-11-16', { visits: 2, visitors: 1, new: 1, 'device:phone': 1, 'country:US': 1 }), JSON.stringify(counts(env.DB, '2026-11-16')));
  at('2026-11-17T05:00:00Z');
  await post(env, PHONE, { v: N });
  check('again at midnight: the 17th\'s visit and visitor, not new', countsAre(env.DB, '2026-11-17', { visits: 1, visitors: 1, 'device:phone': 1, 'country:US': 1 }), JSON.stringify(counts(env.DB, '2026-11-17')));
  check('the 16th as it was', countsAre(env.DB, '2026-11-16', { visits: 2, visitors: 1, new: 1, 'device:phone': 1, 'country:US': 1 }));
  at('2026-11-17T05:01:00Z');
  await visitor(env, OPEN, { country: 'GB' });
  check('another visitor, new, on a desktop in britain', countsAre(env.DB, '2026-11-17', { visits: 2, visitors: 2, new: 1, 'device:phone': 1, 'device:desktop': 1, 'country:US': 1, 'country:GB': 1 }),
    JSON.stringify(counts(env.DB, '2026-11-17')));
  const nv = rows(env.DB, 'visitors').find((v) => v.visitor === N);
  check('the visitor kept with its first and last opening', nv && nv.first === Date.parse('2026-11-17T04:59:00Z') && nv.last === Date.parse('2026-11-17T05:00:00Z') && nv.device === 'phone' && nv.country === 'US', JSON.stringify(nv));

  env = site();
  at('2026-11-01T03:59:00Z');
  const S = await visitor(env);
  at('2026-11-01T04:00:00Z');
  await post(env, OPEN, { v: S });
  at('2026-11-02T04:59:00Z');
  await post(env, OPEN, { v: S });
  at('2026-11-02T05:00:00Z');
  await post(env, OPEN, { v: S });
  const dst = ['2026-10-31', '2026-11-01', '2026-11-02'].map((d) => counts(env.DB, d));
  check('across the end of daylight saving: 23:59 on the 31st the 31st\'s, 00:00 (4 h past utc\'s) the 1st\'s',
    same(dst[0], { 'country:US': 1, 'device:desktop': 1, new: 1, visitors: 1, visits: 1 }) && dst[1].visitors === 1, JSON.stringify(dst));
  check('the 1st 25 hours long: 23:59 that night (5 h past utc\'s) still the 1st\'s, a visit more, the same visitor', dst[1].visits === 2 && dst[1].visitors === 1 && !dst[1].new, JSON.stringify(dst[1]));
  check('and its midnight the 2nd\'s', same(dst[2], { 'country:US': 1, 'device:desktop': 1, visitors: 1, visits: 1 }), JSON.stringify(dst[2]));

  env = site();
  at('2026-11-16T15:00:00Z');
  await visitor(env, OPEN, { country: 'usa' });
  await visitor(env, OPEN, { country: null });
  await visitor(env, OPEN, { country: 'T1' });
  const cs = rows(env.DB, 'events').map((e) => e.country);
  check('a country kept only as two letters or digits, none else', same(cs, [null, null, 'T1']) && countsAre(env.DB, '2026-11-16', { visits: 3, visitors: 3, new: 3, 'device:desktop': 3, 'country:-': 2, 'country:T1': 1 }),
    cs.join(' ') + ' ' + JSON.stringify(counts(env.DB, '2026-11-16')));

  // --- sections, things, links and doodles ---------------------------------------------------------------
  env = site();
  at('2026-11-16T15:00:00Z');
  const G = await visitor(env);
  const ITEMS = [...WORK, ...DOODLES];
  check('there are sections, things of work and doodles to count', SECTIONS.length > 0 && WORK.length > 0 && DOODLES.length > 0);
  const takes = [];
  for (const n of SECTIONS) takes.push({ event: 'section', name: n });
  for (const n of ITEMS) takes.push({ event: 'item', name: n }, { event: 'link', name: n });
  for (const n of DOODLES) takes.push({ event: 'play', name: n });
  const refused = [];
  for (const body of takes) if ((await post(env, body, { v: G })).status !== 204) refused.push(body.event + ' ' + body.name);
  check('every section, every thing and its link, and every doodle played with: taken', refused.length === 0, refused.join(', ') || takes.length + ' events');
  const want = Object.assign({}, OPENED);
  for (const b of takes) want[b.event + ':' + b.name] = 1;
  check('each counted as its event and its name, once each', countsAre(env.DB, '2026-11-16', want), JSON.stringify(counts(env.DB, '2026-11-16')));
  const crossed = [];
  for (const n of SECTIONS) for (const event of ['item', 'link', 'play']) if ((await post(env, { event, name: n }, { v: G })).status !== 400) crossed.push(event + ' ' + n);
  for (const n of ITEMS) if ((await post(env, { event: 'section', name: n }, { v: G })).status !== 400) crossed.push('section ' + n);
  for (const n of WORK) if ((await post(env, { event: 'play', name: n }, { v: G })).status !== 400) crossed.push('play ' + n);
  check('none in another\'s place: a section as a thing, a link or played with, a thing as a section, work as played with: refused', crossed.length === 0, crossed.join(', '));
  check('and nothing more counted', countsAre(env.DB, '2026-11-16', want));
  await post(env, SEC, { v: G });
  await post(env, SEC, { v: G });
  await post(env, PLAY, { v: G });
  check('the same again: counted again, play too, as the page sends it once a load', counts(env.DB, '2026-11-16')['section:work'] === 3 && counts(env.DB, '2026-11-16')['play:bubble-bob'] === 2);
  const named = rows(env.DB, 'events').filter((e) => e.event !== 'open');
  check('each kept as it came: its event and its name, by its visitor, and nothing of a time or an opening',
    named.length === takes.length + 3 && named.every((e) => e.visitor === G && typeof e.name === 'string' && e.seconds === null && e.items === null && e.device === null && e.country === 'US') &&
    same(named.slice(0, takes.length).map((e) => [e.event, e.name]), takes.map((b) => [b.event, b.name])), JSON.stringify(named.slice(0, 2)));

  // --- time ----------------------------------------------------------------------------------------------
  env = site();
  at('2026-11-16T15:00:00Z');
  const V = await visitor(env);
  a = await post(env, time(30, { sennheiser: 20, 'bubble-bob': 5 }), { v: V });
  check('a time: 204, no cookie set', a.status === 204 && !a.set, a.status);
  let te = rows(env.DB, 'events').filter((e) => e.event === 'time');
  check('kept as it came: its s, and its things\' as json', te.length === 1 && te[0].seconds === 30 && same(JSON.parse(te[0].items), { sennheiser: 20, 'bubble-bob': 5 }) &&
    te[0].name === null && te[0].device === null && te[0].visitor === V && te[0].country === 'US', JSON.stringify(te));
  check('its s the visitor\'s for the day in stays', same(stays(env.DB), [{ day: '2026-11-16', visitor: V, seconds: 30 }]), JSON.stringify(stays(env.DB)));
  check('each thing\'s s counted as spent:<name>, and nothing else', countsAre(env.DB, '2026-11-16', Object.assign({ 'spent:sennheiser': 20, 'spent:bubble-bob': 5 }, OPENED)),
    JSON.stringify(counts(env.DB, '2026-11-16')));
  at('2026-11-16T15:10:00Z');
  await post(env, time(45, { sennheiser: 40 }), { v: V });
  await post(env, time(5), { v: V });
  check('more the same day: added to its row, one a visitor a day', same(stays(env.DB), [{ day: '2026-11-16', visitor: V, seconds: 80 }]), JSON.stringify(stays(env.DB)));
  check('and to each thing\'s', countsAre(env.DB, '2026-11-16', Object.assign({ 'spent:sennheiser': 60, 'spent:bubble-bob': 5 }, OPENED)), JSON.stringify(counts(env.DB, '2026-11-16')));
  te = rows(env.DB, 'events').filter((e) => e.event === 'time');
  check('a time with no thing open taken, its things {}', te.length === 3 && te[2].seconds === 5 && te[2].items === '{}', JSON.stringify(te[2]));
  const W = await visitor(env);
  await post(env, time(12, { upright: 12 }), { v: W });
  check('another visitor: a row of its own', same(stays(env.DB), [{ day: '2026-11-16', visitor: V, seconds: 80 }, { day: '2026-11-16', visitor: W, seconds: 12 }].sort((x, y) => (x.visitor < y.visitor ? -1 : 1))),
    JSON.stringify(stays(env.DB)));
  at('2026-11-17T04:59:59Z');
  await post(env, time(7, { cicada: 7 }), { v: V });
  at('2026-11-17T05:00:00Z');
  await post(env, time(8, { cicada: 8 }), { v: V });
  const vs = stays(env.DB).filter((x) => x.visitor === V);
  check('across new york\'s midnight: 23:59:59 the 16th\'s row, 00:00 the 17th\'s', same(vs, [{ day: '2026-11-16', visitor: V, seconds: 87 }, { day: '2026-11-17', visitor: V, seconds: 8 }]), JSON.stringify(vs));
  check('and each day\'s spent its own', counts(env.DB, '2026-11-16')['spent:cicada'] === 7 && countsAre(env.DB, '2026-11-17', { 'spent:cicada': 8 }), JSON.stringify(counts(env.DB, '2026-11-17')));
  a = await post(env, time(TALLY.SECONDS, { sennheiser: TALLY.SECONDS, 'graffiti-wall': 1 }), { v: V });
  check('SECONDS exactly taken, of the site and of a thing', TALLY.SECONDS === 86400 && a.status === 204, a.status);
  a = await post(env, time(1, Object.fromEntries(ITEMS.map((n) => [n, 1]))), { v: V });
  check('a time of every thing at once taken', a.status === 204 && ITEMS.every((n) => counts(env.DB, '2026-11-17')['spent:' + n] >= 1), a.status);
  a = await post(env, time(3));
  check('a time with no visitor cookie: one set, its s kept under the new id', a.status === 204 && UUID.test(a.v || '') && stays(env.DB).some((x) => x.visitor === a.v && x.seconds === 3), a.set);
  check('a time is no visit: no visits nor visitors counted for it', !('visits' in counts(env.DB, '2026-11-17')) && !('visitors' in counts(env.DB, '2026-11-17')), JSON.stringify(counts(env.DB, '2026-11-17')));

  // --- one batch ---------------------------------------------------------------------------------------
  env = site();
  let before = env.DB.batches.length;
  const B = await visitor(env);
  let bs = env.DB.batches.slice(before), last = bs[bs.length - 1] || [];
  check('an opening: what is known read in one batch, then the event, the visitor and the counts written in another',
    bs.length === 2 && bs[0].every((s) => s.startsWith('SELECT')) && last.some((s) => s.startsWith('INSERT INTO events')) &&
    last.some((s) => s.startsWith('INSERT INTO visitors')) && last.filter((s) => s.startsWith('INSERT INTO daily')).length === 5, JSON.stringify(bs.map((b) => b.length)));
  before = env.DB.batches.length;
  await post(env, time(9, { upright: 4, cicada: 9 }), { v: B });
  bs = env.DB.batches.slice(before);
  last = bs[bs.length - 1] || [];
  check('a time: whether its visitor is left out read, then the event, the stay and each thing\'s s written in one',
    bs.length === 2 && bs[0].length === 1 && bs[0][0].startsWith('SELECT') && last.length === 4 && last[0].startsWith('INSERT INTO events') &&
    last.filter((s) => s.startsWith('INSERT INTO stays')).length === 1 && last.filter((s) => s.startsWith('INSERT INTO daily')).length === 2, JSON.stringify(bs));
  before = env.DB.batches.length;
  await post(env, LINK, { v: B });
  bs = env.DB.batches.slice(before);
  last = bs[bs.length - 1] || [];
  check('a link: the event and its count in one', bs.length === 2 && last.length === 2 && last[0].startsWith('INSERT INTO events') && last[1].startsWith('INSERT INTO daily'), JSON.stringify(bs));
  const keptNow = () => JSON.stringify(['events', 'daily'].map((t) => rows(env.DB, t)));
  const was0 = keptNow();
  env.DB.db.exec('DROP TABLE stays');
  let failed = null;
  try {
    await post(env, time(9, { upright: 9 }), { v: B });
  } catch (e) {
    failed = e;
  }
  check('a time whose stay cannot be written: the worker fails, and neither its event nor its counts are kept', !!failed && keptNow() === was0, failed ? failed.message : 'answered');

  // --- the owner left out ---------------------------------------------------------------------------------
  env = site();
  at('2026-11-16T15:00:00Z');
  const P = await visitor(env, PHONE);
  await post(env, time(20, { upright: 20 }), { v: P });
  const kept = () => JSON.stringify(['events', 'daily', 'visitors', 'stays'].map((t) => rows(env.DB, t)));
  const was = kept();
  a = await post(env, OPEN, { me: true });
  const O = a.v;
  check('the me cookie: 204, a visitor cookie still set, the visitor left out', a.status === 204 && UUID.test(O || '') && same(rows(env.DB, 'excluded'), [{ visitor: O }]), a.set);
  check('and its opening not kept nor counted', kept() === was);
  for (const body of [OPEN, SEC, ITEM, LINK, PLAY, TIME]) await post(env, body, { v: O });
  check('from then on, without the cookie, nothing it does is kept: no event, count, visitor nor time', kept() === was);
  a = await post(env, SEC, { v: P, me: true });
  check('the me cookie with any event: that visitor left out from then', a.status === 204 && rows(env.DB, 'excluded').some((e) => e.visitor === P) && kept() === was);
  await post(env, time(40, { upright: 40 }), { v: P });
  await post(env, PHONE, { v: P });
  check('nothing it does after kept, what it did before still counted', kept() === was &&
    countsAre(env.DB, '2026-11-16', { visits: 1, visitors: 1, new: 1, 'device:phone': 1, 'country:US': 1, 'spent:upright': 20 }) && same(stays(env.DB), [{ day: '2026-11-16', visitor: P, seconds: 20 }]),
    JSON.stringify(counts(env.DB, '2026-11-16')));
  a = await post(env, TIME, { me: true });
  check('a time with the me cookie and no visitor yet: a new visitor, left out, its time not kept', a.status === 204 && UUID.test(a.v || '') && rows(env.DB, 'excluded').some((e) => e.visitor === a.v) && kept() === was);
  a = await post(env, OPEN, { cookies: ['home=1', 'theme=dark'] });
  check('a cookie whose name only ends in me is not the me cookie', !rows(env.DB, 'excluded').some((e) => e.visitor === a.v) && counts(env.DB, '2026-11-16').visits === 2);

  // --- the site's lock, as its database says ---------------------------------------------------------
  const KEPT = gates.GATE.KEPT * 1000;
  // the gate row put in a database by hand: locked 1 or 0, and a password kept by keep, or none
  const lockRow = (D, locked, k) => D.db.prepare('INSERT OR REPLACE INTO gate (id, locked, hash, salt, key, at) VALUES (1, ?, ?, ?, ?, ?)')
    .run(locked, k ? k.hash : null, k ? k.salt : null, k ? k.key : null, clock);
  // a try at a site's password: its status, and the gate's cookie it sets as name=value
  const enter = async (env, password) => {
    const g = await worker.fetch(ask('POST', '/gate', { body: password }), env);
    return { status: g.status, cookie: (g.headers.get('Set-Cookie') || '').split(';')[0] };
  };
  // a GET of a site's path with these cookies: its status, its text, and its X-Robots-Tag
  const get = async (env, at, cookies = []) => {
    const res = await worker.fetch(ask('GET', at, { cookies }), env);
    return { status: res.status, text: await res.text(), robots: res.headers.get('X-Robots-Tag') };
  };
  // whether a site is locked to its secret: no cookie the gate page, the
  // tally refused, the secret the password, and a cookie from it letting in
  const lockedToSecret = async (env) => {
    const no = await get(env, '/'), wrongTry = await enter(env, 'the wrong password'), e = await enter(env, PASSWORD);
    const tallied = await post(env, OPEN, { gate: false }), withCookie = await get(env, '/', [e.cookie]);
    return no.status === 401 && no.text === PAGE && no.robots === 'noindex' && wrongTry.status === 401 && e.status === 204 && tallied.status === 401 &&
      withCookie.status === 200 && withCookie.text === 'site /' && withCookie.robots === 'noindex';
  };
  // whether a site is open: no cookie its page and files as they are,
  // nothing asking them not to be indexed, and its password, the secret
  // unless one is given, still giving a cookie
  const open = async (env, password = PASSWORD) => {
    const no = await get(env, '/'), file = await get(env, '/cicada/cicada.mp4'), e = await enter(env, password);
    return no.status === 200 && no.text === 'site /' && no.robots === null && file.status === 200 && file.text === 'site /cicada/cicada.mp4' && file.robots === null && e.status === 204;
  };
  at('2026-11-16T15:00:00Z');
  check('dev, no gate row: as it starts, locked to its secret', await lockedToSecret(site()));
  check('the live site, no gate row: as it starts, open, its page as it is', await open(live()));
  env = live();
  a = await post(env, OPEN, { gate: false });
  check('and /api/tally taken from anyone there, its answer still not cached nor indexed', a.status === 204 && UUID.test(a.v || '') && counts(env.DB, '2026-11-16').visits === 1 && unindexed(a), a.status);
  env = site();
  env.DB.db.exec('DROP TABLE gate');
  const env2 = live();
  env2.DB.db.exec('DROP TABLE gate');
  check('no gate table: the same, dev locked and the live site open', (await lockedToSecret(env)) && (await open(env2)));
  env = site();
  env.DB.down = true;
  check('a database that fails in a fresh isolate: dev as it starts, locked', await lockedToSecret(env));
  env = live();
  env.DB.down = true;
  check('and the live site as it starts, open', await open(env));
  env = live({ DB: { prepare: () => ({ bind() { return this; }, first: async () => { throw new Error('D1_ERROR: timed out'); } }) } });
  check('a database whose read times out: the same', await open(env));

  env = site();
  lockRow(env.DB, 0);
  check('dev opened by its row', await open(env));
  env.DB.down = true;
  at(new Date(clock + KEPT).toISOString());
  check('then a read that fails: still open, the row as last read, not locked as dev starts', await open(env));
  env.DB.down = false;
  env = live();
  const fromOps = await gates.keep('locked from ops');
  lockRow(env.DB, 1, fromOps);
  check('the live site locked from ops', (await get(env, '/')).status === 401 && (await enter(env, 'locked from ops')).status === 204);
  env.DB.down = true;
  at(new Date(clock + KEPT).toISOString());
  check('then a read that fails: still locked, its password from ops, not open as it starts', (await get(env, '/')).status === 401 &&
    (await enter(env, 'locked from ops')).status === 204 && (await enter(env, PASSWORD)).status === 401);
  env.DB.down = false;

  env = site();
  lockRow(env.DB, 0);
  r = await worker.fetch(ask('GET', '/'), env);
  check('a row open: no cookie, / is the site', r.status === 200 && (await r.text()) === 'site /', r.status);
  check('as it is, nothing asking it not to be indexed', r.headers.get('X-Robots-Tag') === null, r.headers.get('X-Robots-Tag'));
  check('any file of the site, as it is', same(await get(env, '/chebble/chess.wasm'), { status: 200, text: 'site /chebble/chess.wasm', robots: null }));
  a = await post(env, OPEN, { gate: false });
  check('and /api/tally taken from anyone, the opening counted', a.status === 204 && UUID.test(a.v || '') && counts(env.DB, '2026-11-16').visits === 1, a.status);
  env = site();
  lockRow(env.DB, 0, await gates.keep('open words'));
  check('a row open with a password set: still open to anyone', (await open(env, 'open words')) && (await post(env, OPEN, { gate: false })).status === 204);

  env = site();
  lockRow(env.DB, 1);
  check('a row locked with no password set: as dev starts, the secret the password', await lockedToSecret(env));
  env = live();
  lockRow(env.DB, 1);
  check('and on the live site: locked to its secret', await lockedToSecret(env));
  env = site();
  const old = await enter(env, PASSWORD);
  at('2026-11-16T15:01:00Z');
  lockRow(env.DB, 1, await gates.keep('a new password'));
  at('2026-11-16T15:02:00Z');
  check('a password set from ops: the secret no longer opens it', (await enter(env, PASSWORD)).status === 401);
  const nu = await enter(env, 'a new password');
  check('the new one does', nu.status === 204 && nu.cookie.startsWith('gate='), nu.status);
  check('a cookie from the secret turned away, from / and from /api/tally', (await get(env, '/', [old.cookie])).status === 401 &&
    (await post(env, OPEN, { gate: false, cookies: [old.cookie] })).status === 401);
  check('the new cookie lets in, to / and to /api/tally', (await get(env, '/', [nu.cookie])).status === 200 && (await post(env, OPEN, { gate: false, cookies: [nu.cookie] })).status === 204);

  env = site();
  const reads = { n: 0 }, prepare = env.DB.prepare;
  env.DB.prepare = (sql) => { if (/FROM gate/.test(sql)) reads.n++; return prepare(sql); };
  at('2026-11-16T16:00:00Z');
  const t0 = clock;
  check('the cache: locked with no row', (await get(env, '/')).status === 401);
  lockRow(env.DB, 0);
  at(new Date(t0 + KEPT - 1).toISOString());
  check('the row opened: not seen a ms before KEPT', (await get(env, '/')).status === 401 && (await post(env, OPEN, { gate: false })).status === 401);
  for (let i = 0; i < 8; i++) await get(env, '/');
  check('and the row read once in that time', reads.n === 1, reads.n + ' reads');
  at(new Date(t0 + KEPT).toISOString());
  check('seen at KEPT: open', (await get(env, '/')).status === 200 && reads.n === 2, reads.n + ' reads');
  lockRow(env.DB, 1);
  at(new Date(t0 + KEPT + 1000).toISOString());
  check('locked again: still open until KEPT from the last read', (await get(env, '/')).status === 200);
  at(new Date(t0 + 2 * KEPT).toISOString());
  check('and locked from then', (await get(env, '/')).status === 401);
  env = live();
  const t1 = clock;
  check('the live site\'s cache: open with no row', (await get(env, '/')).status === 200);
  lockRow(env.DB, 1);
  at(new Date(t1 + KEPT - 1).toISOString());
  check('a row locking it: not seen a ms before KEPT, none kept as long as a row', (await get(env, '/')).status === 200);
  at(new Date(t1 + KEPT).toISOString());
  check('and seen at KEPT: locked', (await get(env, '/')).status === 401);

  // --- ops: its gate ------------------------------------------------------------------------------------
  const { default: ops } = await import(pathToFileURL(path.join(ROOT, 'tools/ops/worker.js')).href);
  const { OPS } = await import(pathToFileURL(path.join(ROOT, 'tools/ops/ops.js')).href);
  const { SITE: OWN, median } = await import(pathToFileURL(path.join(ROOT, 'tools/ops/site.js')).href);
  const OPS_PAGE = fs.readFileSync(path.join(ROOT, 'tools/ops/ops.html'), 'utf8');
  const OPS_PASSWORD = 'the lighthouse keeper', ORIGIN = 'https://ops.dangelo.engineering';
  // ops's env: its password, the repo's files, and both sites' databases
  const opsEnv = (more) => Object.assign({ PASSWORD: OPS_PASSWORD, ASSETS: SITE, MAIN: d1(), DEV: d1() }, more);
  // a request to ops.dangelo.engineering: method, path, its cookies, a body (json unless a string), more headers
  const askOps = (method, at, { cookies = [], body, headers = {} } = {}) => {
    const h = Object.assign({}, headers);
    if (cookies.length) h.Cookie = cookies.join('; ');
    return new Request(ORIGIN + at, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  };
  const unkept = (res) => res.headers.get('Cache-Control') === 'no-store' && res.headers.get('X-Robots-Tag') === 'noindex';
  let OP = opsEnv();
  r = await ops.fetch(askOps('GET', '/'), OP);
  check('ops, no cookie: / is the gate page, 401', r.status === 401 && (await r.text()) === PAGE, r.status);
  check('not cached nor indexed', unkept(r));
  r = await ops.fetch(askOps('GET', '/stats?site=dev&days=7'), OP);
  check('no cookie: /stats is the gate page', r.status === 401 && (await r.text()) === PAGE, r.status);
  r = await ops.fetch(askOps('GET', '/js/raster.js'), OP);
  check('no cookie: the gate page\'s own scripts let out, not cached nor indexed', r.status === 200 && (await r.text()) === 'site /js/raster.js' && unkept(r), r.status);
  r = await ops.fetch(askOps('GET', '/js/wall.js'), OP);
  check('no cookie: any other file the gate page', r.status === 401, r.status);
  r = await ops.fetch(askOps('POST', '/gate', { body: 'the wrong password' }), OP);
  check('a wrong password: 401, no cookie at all, not the me cookie either', r.status === 401 && r.headers.getSetCookie().length === 0, r.headers.getSetCookie().join(' | '));
  r = await ops.fetch(askOps('POST', '/gate', { body: OPS_PASSWORD }), OP);
  const sets = r.headers.getSetCookie(), gateSet = sets.find((c) => c.startsWith('gate=')) || '', meSet = sets.find((c) => c.startsWith('me=')) || '';
  check('the right password: 204, the gate\'s cookie and the me cookie', r.status === 204 && sets.length === 2 && gateSet && meSet, sets.join(' | '));
  check('the gate\'s cookie as the site\'s: HttpOnly, Secure, SameSite=Lax, Path=/, DAYS, this host\'s only',
    /; HttpOnly/.test(gateSet) && /; Secure/.test(gateSet) && /; SameSite=Lax/.test(gateSet) && /; Path=\//.test(gateSet) &&
    gateSet.includes('; Max-Age=' + gates.GATE.DAYS * 86400) && !/domain/i.test(gateSet), gateSet);
  check('the me cookie: for the whole of dangelo.engineering, HttpOnly, Secure, SameSite=Lax, 400 days',
    meSet === 'me=1; Domain=dangelo.engineering; Path=/; Max-Age=' + 400 * 86400 + '; HttpOnly; Secure; SameSite=Lax' && OPS.DAYS === 400 && OWN.DOMAIN === 'dangelo.engineering', meSet);
  check('its answer not cached nor indexed', unkept(r));
  const OPS_GATE = gateSet.split(';')[0], ME = meSet.split(';')[0];
  r = await worker.fetch(ask('GET', '/', { cookies: [OPS_GATE] }), site());
  check('ops\'s gate cookie does not open the site', r.status === 401, r.status);
  env = site();
  a = await post(env, OPEN, { cookies: [ME] });
  check('the site\'s tally leaves out a browser with ops\'s me cookie', a.status === 204 && same(rows(env.DB, 'excluded'), [{ visitor: a.v }]) && rows(env.DB, 'events').length === 0);
  env = live();
  a = await post(env, OPEN, { gate: false, cookies: [ME] });
  check('the live site\'s too, open to anyone', a.status === 204 && same(rows(env.DB, 'excluded'), [{ visitor: a.v }]) && rows(env.DB, 'events').length === 0);

  OP = opsEnv({ OPEN: '1' });
  for (const D of [OP.MAIN, OP.DEV]) lockRow(D, 0, await gates.keep('row words'));
  r = await ops.fetch(askOps('GET', '/'), OP);
  check('ops given OPEN "1", both sites\' rows open: ops still locked', r.status === 401 && (await r.text()) === PAGE, r.status);
  r = await ops.fetch(askOps('GET', '/js/wall.js'), OP);
  check('and the repo\'s files behind its gate', r.status === 401, r.status);
  r = await ops.fetch(askOps('POST', '/gate', { body: 'row words' }), OP);
  check('a row\'s password does not open ops', r.status === 401, r.status);
  r = await ops.fetch(askOps('POST', '/gate', { body: OPS_PASSWORD }), OP);
  check('its own secret does', r.status === 204, r.status);
  r = await ops.fetch(askOps('POST', '/gate', { body: OPS_PASSWORD }), opsEnv({ PASSWORD: undefined }));
  check('no secret on ops: a try 503, and no me cookie', r.status === 503 && r.headers.getSetCookie().length === 0, r.status);
  r = await ops.fetch(askOps('GET', '/'), Object.assign(opsEnv({ PASSWORD: undefined, OPEN: '1' }), { DB: OP.DEV }));
  check('nor is ops opened by a gate row in any binding, nor by OPEN', r.status === 401, r.status);

  OP = opsEnv();
  r = await ops.fetch(askOps('GET', '/', { cookies: [OPS_GATE] }), OP);
  check('the cookie: / is ops\'s page, html, not cached nor indexed', r.status === 200 && (await r.text()) === OPS_PAGE && /^text\/html/.test(r.headers.get('Content-Type')) && unkept(r), r.status);
  r = await ops.fetch(askOps('GET', '/js/type.js', { cookies: [OPS_GATE] }), OP);
  check('any other GET: the repo\'s files, not cached nor indexed', r.status === 200 && (await r.text()) === 'site /js/type.js' && unkept(r), r.status);
  r = await ops.fetch(askOps('POST', '/js/type.js', { cookies: [OPS_GATE], body: 'x' }), OP);
  check('a POST to one: 405', r.status === 405 && unkept(r), r.status);
  check('ops\'s page loads only the look\'s scripts, files of the site', (() => {
    const ps = [...OPS_PAGE.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    return ps.length > 0 && ps.every((p) => p.startsWith('/js/') && fs.existsSync(path.join(ROOT, p)));
  })());

  // --- /stats ---------------------------------------------------------------------------------------------
  const ms = [[], [5], [3, 1, 2], [10, 9, 2], [1, 2], [1, 4], [4, 1, 3, 2], [7, 7, 1, 100], [86400, 1]].map(median);
  check('median: 0 with none, an odd count\'s middle by value, an even count\'s two middles\' mean, a half rounded up', same(ms, [0, 5, 2, 9, 2, 3, 3, 7, 43201]), ms.join(' '));
  const arg = [3, 1, 2];
  median(arg);
  check('and the list it is given left as it was', same(arg, [3, 1, 2]));
  OP = opsEnv();
  const daily = (D, day, metric, n) => D.db.prepare('INSERT INTO daily (day, metric, n) VALUES (?, ?, ?)').run(day, metric, n);
  const seen = (D, id, iso) => D.db.prepare('INSERT INTO visitors (visitor, first, last, device, country) VALUES (?, ?, ?, ?, ?)').run(id, Date.parse('2026-01-01T00:00:00Z'), Date.parse(iso), 'desktop', 'US');
  const stay = (D, day, id, s) => D.db.prepare('INSERT INTO stays (day, visitor, seconds) VALUES (?, ?, ?)').run(day, id, s);
  for (const [day, metric, n] of [['2026-11-16', 'visits', 5], ['2026-11-16', 'visitors', 3], ['2026-11-16', 'section:work', 1], ['2026-11-10', 'visits', 2], ['2026-11-09', 'visits', 9],
    ['2026-10-18', 'visits', 4], ['2026-10-17', 'visits', 8], ['2026-08-19', 'visits', 1], ['2026-08-18', 'visits', 7], ['2026-11-17', 'visits', 6]]) daily(OP.DEV, day, metric, n);
  daily(OP.MAIN, '2026-11-16', 'visits', 100);
  // dev's visitors: today, the start of the week to the ms and a ms before it, the start of the month and a ms before it, and long ago
  for (const [id, iso] of [['a', '2026-11-17T04:00:00.000Z'], ['b', '2026-11-10T05:00:00.000Z'], ['c', '2026-11-10T04:59:59.999Z'], ['d', '2026-10-18T04:00:00.000Z'],
    ['e', '2026-10-18T03:59:59.999Z'], ['f', '2026-08-01T12:00:00.000Z']]) seen(OP.DEV, id, iso);
  seen(OP.MAIN, 'm', '2026-11-16T12:00:00.000Z');
  // dev's stays: three on the 16th, two on the 15th, one on the 10th, one on each day just out of a window, and utc's 17th
  for (const [day, id, s] of [['2026-11-17', 'z', 7], ['2026-11-16', 'a', 30], ['2026-11-16', 'b', 90], ['2026-11-16', 'c', 60], ['2026-11-15', 'a', 10], ['2026-11-15', 'b', 41],
    ['2026-11-10', 'x', 100], ['2026-11-09', 'y', 5000], ['2026-08-19', 'q', 2000], ['2026-08-18', 'r', 1]]) stay(OP.DEV, day, id, s);
  // the stats asked for, with ops's cookie: the status and the json
  const statsOf = async (query, env = OP, cookies = [OPS_GATE]) => {
    const res = await ops.fetch(askOps('GET', '/stats' + query, { cookies }), env);
    return { res, status: res.status, body: await res.json().catch(() => null) };
  };
  // days with each one's counts in the order of their metrics, to compare
  const inOrder = (days) => days.map((d) => ({ day: d.day, counts: Object.fromEntries(Object.entries(d.counts).sort(([x], [y]) => (x < y ? -1 : 1))) }));
  // the days from first to last, yyyy-mm-dd
  const daysFrom = (first, n) => Array.from({ length: n }, (_, i) => new Date(Date.parse(first + 'T12:00:00Z') + i * 86400000).toISOString().slice(0, 10));

  at('2026-11-17T04:30:00Z');
  const batchesBefore = OP.DEV.batches.length;
  let st = await statsOf('?site=dev&days=7', OP, []);
  check('/stats, no cookie: the gate page, nothing read', st.status === 401 && OP.DEV.batches.length === batchesBefore, st.status);
  st = await statsOf('?site=dev&days=7');
  const b7 = st.body;
  check('/stats: 200, json, not cached nor indexed', st.status === 200 && /^application\/json/.test(st.res.headers.get('Content-Type')) && unkept(st.res), st.status);
  check('its shape: site, zone, today, days, actives, median, names', b7 && same(Object.keys(b7), ['site', 'zone', 'today', 'days', 'actives', 'median', 'names']), b7 && Object.keys(b7).join(' '));
  check('23:30 in new york on the 16th, already the 17th in utc: today is the 16th, in new york\'s zone', b7.today === '2026-11-16' && b7.zone === 'America/New_York' && b7.site === 'dev', b7.today);
  check('7 days: the 10th to the 16th, oldest first, every one', same(b7.days.map((d) => d.day), daysFrom('2026-11-10', 7)), b7.days.map((d) => d.day).join(' '));
  check('each day its counts, with timed and median where it has stays, an empty day {}, the 9th and utc\'s 17th left out', same(inOrder(b7.days), inOrder([
    { day: '2026-11-10', counts: { visits: 2, timed: 1, median: 100 } }, { day: '2026-11-11', counts: {} }, { day: '2026-11-12', counts: {} }, { day: '2026-11-13', counts: {} },
    { day: '2026-11-14', counts: {} }, { day: '2026-11-15', counts: { timed: 2, median: 26 } },
    { day: '2026-11-16', counts: { visits: 5, visitors: 3, 'section:work': 1, timed: 3, median: 60 } },
  ])), JSON.stringify(b7.days));
  check('timed and median of an odd count the middle one, of an even the two middles\' mean, 25.5 rounded to 26', b7.days[6].counts.median === 60 && b7.days[5].counts.median === 26);
  check('the window\'s median: of its every stay, six, the 3rd and 4th\'s mean, 50.5 to 51', b7.median === 51, b7.median);
  check('the names: SECTIONS, WORK and DOODLES', same(b7.names, { sections: SECTIONS, work: WORK, doodles: DOODLES }), JSON.stringify(b7.names));
  check('the actives: 2 since the start of the 10th (05:00 utc, to the ms), 4 since the start of oct 18th (04:00 utc, before the clocks went back)',
    same(b7.actives, { week: 2, month: 4 }), JSON.stringify(b7.actives));
  st = await statsOf('?site=dev&days=30');
  const d30 = st.body.days.map((d) => d.day);
  check('30 days: oct 18th to nov 16th, through the end of daylight saving, none twice or missing', same(d30, daysFrom('2026-10-18', 30)), d30[0] + '..' + d30[29] + ', ' + d30.length);
  check('the 9th and the 18th in, the 17th of october out', st.body.days.find((d) => d.day === '2026-11-09').counts.visits === 9 && st.body.days[0].counts.visits === 4 &&
    !st.body.days.some((d) => d.day === '2026-10-17'));
  check('its median with the 9th\'s stay: seven, the 4th', st.body.median === 60 && same(st.body.days.find((d) => d.day === '2026-11-09').counts, { visits: 9, timed: 1, median: 5000 }), st.body.median);
  st = await statsOf('?days=90&site=dev');
  const d90 = st.body.days.map((d) => d.day);
  check('90 days: aug 19th to nov 16th, the 19th in and the 18th out', same(d90, daysFrom('2026-08-19', 90)) && st.body.days[0].counts.visits === 1 &&
    st.body.days.find((d) => d.day === '2026-10-17').counts.visits === 8, d90[0] + '..' + d90[89] + ', ' + d90.length);
  check('its median with aug 19th\'s stay and not the 18th\'s: eight, 60 and 90\'s mean', st.body.median === 75 && same(inOrder([st.body.days[0]])[0].counts, { median: 2000, timed: 1, visits: 1 }), st.body.median);
  check('the actives the same whatever the window', same(st.body.actives, { week: 2, month: 4 }), JSON.stringify(st.body.actives));
  at('2026-11-17T05:00:00Z');
  st = await statsOf('?site=dev&days=7');
  check('at new york\'s midnight: today the 17th, its counts and stay in, the 10th out', st.body.today === '2026-11-17' && same(st.body.days.map((d) => d.day), daysFrom('2026-11-11', 7)) &&
    same(st.body.days[6].counts, { visits: 6, timed: 1, median: 7 }), st.body.today + ' ' + JSON.stringify(st.body.days[6]));
  check('and the window\'s median the 11th to the 17th\'s, 35.5 to 36', st.body.median === 36, st.body.median);
  check('and the actives from the starts of the 11th and oct 19th: one fewer in each', same(st.body.actives, { week: 1, month: 3 }), JSON.stringify(st.body.actives));
  at('2026-11-17T04:30:00Z');
  st = await statsOf('?site=main&days=7');
  check('main: dangelo.engineering\'s own database, no stays: no timed nor median on any day, its median 0', st.body.site === 'main' && same(st.body.days[6].counts, { visits: 100 }) &&
    st.body.days.slice(0, 6).every((d) => same(d.counts, {})) && same(st.body.actives, { week: 1, month: 1 }) && st.body.median === 0 &&
    same(st.body.names, { sections: SECTIONS, work: WORK, doodles: DOODLES }), JSON.stringify(st.body));
  const sqls = OP.DEV.batches[OP.DEV.batches.length - 1] || [];
  check('it reads only daily, visitors and stays', sqls.length > 0 && sqls.every((q) => /FROM (daily|visitors|stays)\b/.test(q) && !/\b(events|excluded|gate)\b/.test(q)), sqls.join(' | '));
  const plan = (q) => OP.DEV.db.prepare('EXPLAIN QUERY PLAN ' + q).all(...(q.match(/\?/g) || []).map(() => '')).map((x) => x.detail).join('; ');
  const plans = sqls.filter((q) => /FROM visitors/.test(q)).map(plan);
  check('visitors by its index on last', plans.length === 2 && plans.every((p) => /USING COVERING INDEX visitors_last/.test(p)), plans.join(' | '));
  const stayPlans = sqls.filter((q) => /FROM stays/.test(q)).map(plan);
  check('stays by its days, its key\'s first', stayPlans.length === 1 && /SEARCH stays USING PRIMARY KEY \(day>\? AND day<\?\)/.test(stayPlans[0]), stayPlans.join(' | '));
  const BAD_QUERIES = ['', '?site=dev', '?days=7', '?site=prod&days=7', '?site=Dev&days=7', '?site=__proto__&days=7', '?site=dev&days=14', '?site=dev&days=7.0', '?site=dev&days=07',
    '?site=dev&days=', '?site=dev&days=7&site=main', '?site=dev&days=7&days=7', '?site=dev&days=7&x=1'];
  const wrongQ = [];
  for (const q of BAD_QUERIES) {
    st = await statsOf(q);
    if (st.status !== 400 || !st.body || typeof st.body.error !== 'string' || !unkept(st.res)) wrongQ.push((q || 'none') + ' ' + st.status);
  }
  check('every bad query refused, 400, { error }', wrongQ.length === 0, wrongQ.join(', ') || BAD_QUERIES.length + ' queries');
  r = await ops.fetch(askOps('POST', '/stats?site=dev&days=7', { cookies: [OPS_GATE], body: '{}' }), OP);
  check('a POST to /stats: 405', r.status === 405, r.status);
  st = await statsOf('?site=dev&days=7', opsEnv({ DEV: { prepare: () => ({ bind() { return this; } }), batch: async () => { throw new Error('D1_ERROR: down'); } } }));
  check('a database that fails: 500, and what went wrong', st.status === 500 && /down/.test(st.body.error) && unkept(st.res), st.status);

  // --- /controls --------------------------------------------------------------------------------------------
  OP = opsEnv();
  at('2026-11-16T15:00:00Z');
  const gateRows = () => JSON.stringify([rows(OP.MAIN, 'gate'), rows(OP.DEV, 'gate')]);
  // a POST to /controls as the ops page sends it, its type, origin and cookies changed where given; the status and the json
  const control = async (body, { cookies = [OPS_GATE], type = 'application/json', origin = ORIGIN, headers = {}, env = OP } = {}) => {
    const h = Object.assign({}, headers);
    if (type !== null) h['Content-Type'] = type;
    if (origin !== null) h.Origin = origin;
    const res = await ops.fetch(askOps('POST', '/controls', { cookies, body, headers: h }), env);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) {}
    return { res, status: res.status, text, body: json };
  };
  const controlsNow = async (cookies = [OPS_GATE], env = OP) => {
    const res = await ops.fetch(askOps('GET', '/controls', { cookies }), env);
    const text = await res.text();
    return { res, status: res.status, text, body: res.status === 200 ? JSON.parse(text) : null };
  };
  const STARTED = { main: { locked: false, password: 'secret', at: null }, dev: { locked: true, password: 'secret', at: null } };
  check('SITE.STARTS as each site\'s worker starts: main given OPEN "1" open, dev locked',
    same(OWN.STARTS, { main: gates.starts({ OPEN: '1' }).locked, dev: gates.starts({}).locked }), JSON.stringify(OWN.STARTS));
  let c = await controlsNow([]);
  check('/controls, no cookie: the gate page', c.status === 401 && c.text === PAGE, c.status);
  c = await control({ site: 'dev', locked: false }, { cookies: [] });
  check('a POST without the cookie: the gate page, nothing written', c.status === 401 && gateRows() === '[[],[]]', c.status);
  c = await controlsNow();
  check('GET, no rows: each as it starts, main open and dev locked, both to their secret, never changed', c.status === 200 && same(c.body, STARTED) && unkept(c.res), c.text);
  c = await control({ site: 'dev', password: 'dev words' });
  const dv = rows(OP.DEV, 'gate')[0] || {};
  check('POST a password alone for dev, no row yet: kept locked, as dev starts, its password from ops', c.status === 200 &&
    same(c.body, { main: STARTED.main, dev: { locked: true, password: 'ops', at: clock } }) && dv.locked === 1 && /^[0-9a-f]{64}$/.test(dv.hash || '') && rows(OP.MAIN, 'gate').length === 0, c.text);
  at('2026-11-16T15:01:00Z');
  c = await control({ site: 'main', password: 'the new words' });
  const m1 = rows(OP.MAIN, 'gate')[0] || {};
  check('POST a password alone for main, no row yet: kept open, as main starts, its password from ops', c.status === 200 &&
    same(c.body.main, { locked: false, password: 'ops', at: clock }) && m1.locked === 0 && c.body.dev.locked === true, c.text);
  check('main\'s row: the password kept as pbkdf2 under a fresh salt, a fresh key', /^[0-9a-f]{32}$/.test(m1.salt || '') && /^[0-9a-f]{64}$/.test(m1.key || '') &&
    m1.hash === crypto.pbkdf2Sync('the new words', Buffer.from(m1.salt, 'hex'), gates.GATE.ROUNDS, 32, 'sha256').toString('hex'), JSON.stringify(m1));
  const leaks = (text) => ['the new words', 'dev words', m1.hash, m1.salt, m1.key, dv.hash, dv.salt, dv.key, OPS_PASSWORD, PASSWORD].some((x) => text.includes(x));
  check('its answer holds no password, hash, salt nor key', !leaks(c.text) && Object.values(c.body).every((x) => same(Object.keys(x), ['locked', 'password', 'at'])), c.text);
  c = await controlsNow();
  check('nor does GET', !leaks(c.text) && same(c.body.main, { locked: false, password: 'ops', at: clock }), c.text);
  at('2026-11-16T15:02:00Z');
  c = await control({ site: 'main', locked: true });
  let m2 = rows(OP.MAIN, 'gate')[0];
  check('POST main locked alone: the password as it was', c.status === 200 && m2.locked === 1 && m2.hash === m1.hash && m2.salt === m1.salt && m2.key === m1.key && m2.at === clock &&
    same(c.body.main, { locked: true, password: 'ops', at: clock }), JSON.stringify(m2));
  at('2026-11-16T15:03:00Z');
  c = await control({ site: 'main', locked: false });
  m2 = rows(OP.MAIN, 'gate')[0];
  check('POST main open alone: the password as it was', c.status === 200 && m2.locked === 0 && m2.hash === m1.hash && m2.key === m1.key && same(c.body.main, { locked: false, password: 'ops', at: clock }), JSON.stringify(m2));
  c = await control({ site: 'main', password: 'the new words' });
  const m3 = rows(OP.MAIN, 'gate')[0];
  check('the same password again alone: a new salt, hash and key, still open', m3.locked === 0 && m3.salt !== m1.salt && m3.hash !== m1.hash && m3.key !== m1.key, JSON.stringify(m3));
  c = await control({ site: 'dev', locked: false, password: 'both at once' }, { type: 'application/json; charset=utf-8' });
  const d1r = rows(OP.DEV, 'gate')[0];
  check('both at once, json with a charset: dev open, a password from ops', c.status === 200 && d1r.locked === 0 && d1r.hash && d1r.hash !== dv.hash && same(c.body.dev, { locked: false, password: 'ops', at: clock }), c.text);
  c = await control({ site: 'dev', password: 'x'.repeat(gates.GATE.LONGEST) });
  check('a password LONGEST long taken', c.status === 200, c.status);
  const OP2 = opsEnv();
  c = await control({ site: 'dev', locked: false }, { env: OP2 });
  check('a lock alone with no row yet: as given, the password still the secret', c.status === 200 && same(c.body, { main: STARTED.main, dev: { locked: false, password: 'secret', at: clock } }) &&
    same(rows(OP2.DEV, 'gate'), [{ id: 1, locked: 0, hash: null, salt: null, key: null, at: clock }]), c.text);
  c = await control({ site: 'main', locked: true }, { env: OP2 });
  check('main locked alone, no row yet: locked to its secret', c.status === 200 && same(c.body.main, { locked: true, password: 'secret', at: clock }), c.text);

  const rowsBefore = gateRows();
  const BAD_CONTROLS = [
    ['not json', 'locked'], ['empty', ''], ['json null', 'null'], ['an array', '[{"site":"dev","locked":true}]'], ['a string', '"dev"'], ['nothing', {}],
    ['no site', { locked: true }], ['a site alone', { site: 'dev' }], ['an unknown site', { site: 'prod', locked: true }], ['a site in capitals', { site: 'DEV', locked: true }],
    ['a site as a list', { site: ['dev'], locked: true }], ['a site from the prototype', { site: '__proto__', locked: true }], ['locked as text', { site: 'dev', locked: 'false' }],
    ['locked as 0', { site: 'dev', locked: 0 }], ['locked null', { site: 'dev', locked: null }], ['an empty password', { site: 'dev', password: '' }],
    ['a password as a number', { site: 'dev', password: 5 }], ['a password as a list', { site: 'dev', password: ['a'] }], ['a password null', { site: 'dev', password: null }],
    ['a password past LONGEST', { site: 'dev', password: 'x'.repeat(gates.GATE.LONGEST + 1) }], ['a field more', { site: 'dev', locked: true, also: 1 }],
    ['a __proto__ field', '{"site":"dev","locked":true,"__proto__":{"x":1}}'],
  ];
  const wrongC = [];
  for (const [what, body] of BAD_CONTROLS) {
    c = await control(body);
    if (c.status !== 400 || !c.body || typeof c.body.error !== 'string' || !unkept(c.res)) wrongC.push(what + ' ' + c.status);
  }
  c = await control(JSON.stringify({ site: 'dev', locked: false }) + ' '.repeat(8192));
  if (c.status !== 400) wrongC.push('a body past BYTES ' + c.status);
  c = await control(JSON.stringify({ site: 'dev', locked: false }), { headers: { 'Content-Length': '9000' } });
  if (c.status !== 400) wrongC.push('a body said to be past BYTES ' + c.status);
  check('every malformed body refused, 400, { error }', wrongC.length === 0, wrongC.join(', ') || BAD_CONTROLS.length + 2 + ' bodies');
  check('and nothing written', gateRows() === rowsBefore);
  const FORGED = [
    ['no origin', { origin: null }], ['another site\'s origin', { origin: 'https://evil.example' }], ['origin null', { origin: 'null' }],
    ['dev.dangelo.engineering\'s origin', { origin: 'https://dev.dangelo.engineering' }], ['dangelo.engineering\'s', { origin: 'https://dangelo.engineering' }],
    ['www.dangelo.engineering\'s', { origin: 'https://www.dangelo.engineering' }], ['ops over http', { origin: 'http://ops.dangelo.engineering' }],
    ['ops with a path', { origin: 'https://ops.dangelo.engineering/' }], ['no type', { type: null }], ['text/plain', { type: 'text/plain' }],
    ['a form', { type: 'application/x-www-form-urlencoded' }], ['a multipart form', { type: 'multipart/form-data; boundary=x' }], ['not quite json', { type: 'application/jsonp' }],
  ];
  const wrongF = [];
  for (const [what, how] of FORGED) {
    c = await control({ site: 'dev', locked: false }, how);
    if (c.status !== 403 || !unkept(c.res)) wrongF.push(what + ' ' + c.status);
  }
  check('a wrong or missing origin, or any type but json: refused, 403', wrongF.length === 0, wrongF.join(', ') || FORGED.length + ' posts');
  check('and nothing written', gateRows() === rowsBefore);
  r = await ops.fetch(askOps('PUT', '/controls', { cookies: [OPS_GATE], body: '{}' }), OP);
  check('a PUT: 405', r.status === 405, r.status);
  const down = opsEnv({ DEV: { prepare() { throw new Error('D1_ERROR: down'); } } });
  c = await control({ site: 'dev', locked: false }, { env: down });
  const cg = await ops.fetch(askOps('GET', '/controls', { cookies: [OPS_GATE] }), down);
  check('a database that fails: 500, and what went wrong', c.status === 500 && /down/.test(c.body.error) && cg.status === 500, c.status + ' ' + cg.status);

  // --- ops to the sites ----------------------------------------------------------------------------------------
  at('2026-11-16T17:00:00Z');
  const dev = site(), main = live();
  OP = opsEnv({ DEV: dev.DB, MAIN: main.DB });
  const was1 = await enter(dev, PASSWORD);
  c = await control({ site: 'dev', password: 'set from ops' });
  check('ops sets dev\'s password', c.status === 200 && same(c.body.dev, { locked: true, password: 'ops', at: clock }), c.text);
  check('dev.dangelo.engineering within KEPT: the secret still', (await enter(dev, 'set from ops')).status === 401 && (await enter(dev, PASSWORD)).status === 204 &&
    (await get(dev, '/', [was1.cookie])).status === 200);
  at(new Date(clock + KEPT).toISOString());
  const now1 = await enter(dev, 'set from ops');
  check('after: the new password opens it, the secret does not', now1.status === 204 && (await enter(dev, PASSWORD)).status === 401);
  check('the cookie from the secret turned away, the new one let in', (await get(dev, '/', [was1.cookie])).status === 401 && (await get(dev, '/', [now1.cookie])).status === 200 &&
    (await post(dev, OPEN, { gate: false, cookies: [now1.cookie] })).status === 204);
  check('dangelo.engineering as it was: open, the secret still its password, the one from ops not', (await open(main)) && (await enter(main, 'set from ops')).status === 401);
  c = await control({ site: 'dev', locked: false });
  at(new Date(clock + KEPT).toISOString());
  check('ops opens dev: anyone in, to the files and /api/tally', (await open(dev, 'set from ops')) && (await post(dev, OPEN, { gate: false })).status === 204);
  c = await control({ site: 'dev', locked: true });
  at(new Date(clock + KEPT).toISOString());
  check('and locks it again: the gate page, the password from ops still the one', (await get(dev, '/')).status === 401 && (await get(dev, '/', [now1.cookie])).status === 200 &&
    (await enter(dev, 'set from ops')).status === 204);
  await get(main, '/');
  c = await control({ site: 'main', locked: true });
  check('ops locks dangelo.engineering: within KEPT of its last read still open', c.status === 200 && same(c.body.main, { locked: true, password: 'secret', at: clock }) && (await get(main, '/')).status === 200, c.text);
  at(new Date(clock + KEPT).toISOString());
  check('after: locked to its secret', await lockedToSecret(main));
  c = await control({ site: 'main', password: 'main from ops' });
  at(new Date(clock + KEPT).toISOString());
  check('a password for it from ops: still locked, the new one opening it and the secret not', (await get(main, '/')).status === 401 &&
    (await enter(main, 'main from ops')).status === 204 && (await enter(main, PASSWORD)).status === 401);
  c = await control({ site: 'main', locked: false });
  at(new Date(clock + KEPT).toISOString());
  check('and opened again: anyone in, its page as it is', (await get(main, '/')).status === 200 && (await get(main, '/')).robots === null);

  const X = (await post(dev, OPEN, { gate: false, cookies: [now1.cookie] })).v, Y = (await post(dev, PHONE, { gate: false, cookies: [now1.cookie] })).v;
  await post(dev, time(40, { cicada: 40 }), { gate: false, cookies: [now1.cookie], v: X });
  await post(dev, time(20, { cicada: 15, 'graffiti-wall': 5 }), { gate: false, cookies: [now1.cookie], v: Y });
  st = await statsOf('?site=dev&days=7');
  const today = st.body && st.body.days[6].counts;
  check('two of dev\'s visitors\' times in ops\'s numbers: today\'s timed, its median, each thing\'s spent and the window\'s median',
    st.status === 200 && today.timed === 2 && today.median === 30 && today['spent:cicada'] === 55 && today['spent:graffiti-wall'] === 5 && st.body.median === 30, JSON.stringify(today));

  // --- wrangler.toml ----------------------------------------------------------------------------------------
  let T = null, why = '';
  try {
    T = toml(fs.readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8'));
  } catch (e) {
    why = e.message;
  }
  check('wrangler.toml read', !!T, why);
  T = T || {};
  const top = T[''] || {}, dv2 = T['env.dev'] || {}, op = T['env.ops'] || {};
  check('the sites\' worker tools/server/worker.js, dev\'s too, and ops\'s tools/ops/worker.js', top.main === 'tools/server/worker.js' && dv2.main === undefined && op.main === 'tools/ops/worker.js',
    top.main + ' ' + dv2.main + ' ' + op.main);
  // whether a path is handed to the worker first by run_worker_first: true
  // for every one, or its patterns, * any characters
  const first = (patterns, p) => patterns === true || (Array.isArray(patterns) &&
    patterns.some((x) => new RegExp('^' + x.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(p)));
  const sitePatterns = (T.assets || {}).run_worker_first;
  const missed = ['/', '/index', '/index.html', '/api/tally', '/gate'].filter((p) => !first(sitePatterns, p));
  check('the site\'s worker handed the page, /api/tally and /gate before any file', Array.isArray(sitePatterns) && missed.length === 0, missed.join(' ') || JSON.stringify(sitePatterns));
  check('and the repo\'s other files served without it', !first(sitePatterns, '/js/raster.js') && !first(sitePatterns, '/cicada/cicada.mp4'));
  check('ops\'s handed every request, every file behind its gate', (T['env.ops.assets'] || {}).run_worker_first === true && (T['env.ops.assets'] || {}).binding === 'ASSETS');
  check('OPEN "1" in the top level\'s vars, and none in dev\'s nor ops\'s, as SITE.STARTS says', (T.vars || {}).OPEN === '1' && !T['env.dev.vars'] && !T['env.ops.vars'] &&
    same(OWN.STARTS, { main: gates.starts(T.vars || {}).locked, dev: gates.starts(T['env.dev.vars'] || {}).locked }), JSON.stringify(T.vars));
  const dbOf = (list, binding) => (list || []).find((x) => x.binding === binding) || {};
  const liveDB = dbOf(T.d1_databases, 'DB'), devDB = dbOf(T['env.dev.d1_databases'], 'DB'), opsMain = dbOf(T['env.ops.d1_databases'], 'MAIN'), opsDev = dbOf(T['env.ops.d1_databases'], 'DEV');
  check('ops reads each site\'s own database: MAIN the live site\'s, DEV dev\'s, the two not the same', !!liveDB.database_id && !!devDB.database_id && liveDB.database_id !== devDB.database_id &&
    opsMain.database_id === liveDB.database_id && opsDev.database_id === devDB.database_id && opsMain.database_name === liveDB.database_name && opsDev.database_name === devDB.database_name,
    [liveDB, devDB, opsMain, opsDev].map((x) => x.database_id).join(' '));
  check('each made by the same migrations', [liveDB, devDB, opsMain, opsDev].every((x) => x.migrations_dir === 'tools/server/migrations'));

  Date.now = realNow;
  console.log('\n' + (failures ? failures + ' failed' : 'all passed'));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
