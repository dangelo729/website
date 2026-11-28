// --- the tally -------------------------------------------------------------------
// /api/tally: what the page (js/tally.js) tells the site it is used for,
// kept in the site's database (env.DB, d1, its tables made by
// migrations/). a POST of one json body of TALLY.BYTES at most, one of
// SHAPES with every field one it allows: anything else is refused, 400,
// and nothing is written. a section and a thing in one are named as the
// page names them, its word in small letters with a - for whatever is
// between them (SECTIONS, WORK, DOODLES and ABOUT, each what index.html's
// SECTIONS holds), and one of the page's own links by its title, named the
// same way (LINKS: its corner's, and about's to the same sites). the visitor is a random id in a cookie of the site's
// own (TALLY.COOKIE), set when there is none or it is not an id, and set
// again with every opening, so it lasts TALLY.DAYS from the last. the
// country is cloudflare's, kept only as its two letters; no address and no
// browser is kept. the site's owner is left out: a request carrying
// TALLY.ME leaves its visitor out from then on, and nothing a visitor left
// out does is kept. anything else is kept as it came, in events, and
// counted in daily, by the day in ZONE it came on, the two written
// together in one batch: visits, each opening; visitors, a visitor's first
// opening of the day, with device:<device> and country:<cc> ('-' for none
// known); new, a visitor's first opening ever; section:<name>, a section's
// box opened; item:<name>, a thing in one opened; link:<name>, a link of
// a thing's pressed, or one of the page's own; play:<name>, a doodle played with; and of a time,
// spent:<name>, the s a thing was open, while the s on the site are added
// to the visitor's for the day in stays. every answer asks not to be
// cached nor indexed.

export const ZONE = 'America/New_York'; // the zone whose days the counts are cut by

export const TALLY = {
  BYTES: 1024,    // the most a body may hold
  COOKIE: 'v',    // the visitor's cookie
  DAYS: 400,      // how long it lasts from the last opening, the most a browser keeps one
  ME: 'me',       // the cookie that marks the site owner's browser
  SECONDS: 86400, // the most s a time may say, of the site or of one thing
};

// the page's sections, and the things in them: work's, the doodles and
// about's
export const SECTIONS = ['work', 'professional', 'personal', 'doodles', 'about', 'contact'];
export const WORK = ['sennheiser', 'brandnewnoise', 'critter-guitari', 'third-dimension', 'second-dimension', 'monk-mouth', 'upright', 'scrubby', 'chebble', 'cicada', 'this-website'];
export const DOODLES = ['bubble-bob', 'graffiti-wall'];
export const ABOUT = ['hobbies'];
export const LINKS = ['github', 'linkedin']; // the page's own links out
const ITEMS = [...WORK, ...DOODLES, ...ABOUT];

const DAY_S = 86400;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/; // a visitor's id, as crypto.randomUUID makes them

// what a field may be: this value, one of these, a count of s, or the s
// of each of some things, by name
const is = (v) => (x) => x === v;
const oneOf = (...vs) => (x) => vs.includes(x);
const span = (x) => Number.isInteger(x) && x >= 1 && x <= TALLY.SECONDS;
const spans = (x) => !!x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).every((k) => ITEMS.includes(k) && span(x[k]));

// the bodies taken: each its every field, and what that field may be
const SHAPES = [
  { event: is('open'), device: oneOf('phone', 'desktop') },
  { event: is('section'), name: oneOf(...SECTIONS) },
  { event: is('item'), name: oneOf(...ITEMS) },
  { event: is('link'), name: oneOf(...ITEMS, ...LINKS) },
  { event: is('play'), name: oneOf(...DOODLES) },
  { event: is('time'), seconds: span, items: spans },
];

// the day in ZONE at ms, as yyyy-mm-dd
const DAY = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
export function dayOf(ms) {
  const p = Object.fromEntries(DAY.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return p.year + '-' + p.month + '-' + p.day;
}

// a request to /api/tally answered: the event kept and counted, or the
// visitor left out, or refused
export async function tally(request, env) {
  if (request.method !== 'POST') return answer(400);
  const b = await read(request);
  if (!b) return answer(400);
  const cookies = request.headers.get('Cookie') || '';
  const was = cookie(cookies, TALLY.COOKIE), visitor = was && ID.test(was) ? was : crypto.randomUUID();
  const given = b.event === 'open' || visitor !== was ? visitor : null; // the visitor's cookie set with the answer, or null
  const me = cookie(cookies, TALLY.ME) !== null;
  const cc = request.cf && request.cf.country, country = typeof cc === 'string' && /^[A-Z0-9]{2}$/.test(cc) ? cc : null;
  const now = Date.now(), day = dayOf(now), DB = env.DB;
  const q = (sql, ...args) => DB.prepare(sql).bind(...args);

  // what is known: whether the visitor is left out; opening, when it last
  // opened
  const reads = [q('SELECT 1 AS x FROM excluded WHERE visitor = ?', visitor)];
  if (b.event === 'open') reads.push(q('SELECT last FROM visitors WHERE visitor = ?', visitor));
  const got = (await DB.batch(reads)).map((r) => r.results[0] || null);
  const out = !!got[0];

  // the owner: the visitor left out, and nothing kept
  if (me || out) {
    if (!out) await q('INSERT OR IGNORE INTO excluded (visitor) VALUES (?)', visitor).run();
    return answer(204, given);
  }

  // anyone else: the event as it came, and what it counts for
  const bump = (metric, n = 1) => q('INSERT INTO daily (day, metric, n) VALUES (?, ?, ?) ON CONFLICT (day, metric) DO UPDATE SET n = n + excluded.n', day, metric, n);
  const writes = [q('INSERT INTO events (at, event, visitor, name, seconds, items, device, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    now, b.event, visitor, b.name ?? null, b.seconds ?? null, b.items ? JSON.stringify(b.items) : null, b.device ?? null, country)];
  if (b.event === 'open') {
    const last = got[1] && got[1].last;
    writes.push(q('INSERT INTO visitors (visitor, first, last, device, country) VALUES (?, ?, ?, ?, ?) ON CONFLICT (visitor) DO UPDATE SET last = ?, device = ?, country = ?',
      visitor, now, now, b.device, country, now, b.device, country), bump('visits'));
    if (!got[1]) writes.push(bump('new'));
    if (!got[1] || dayOf(last) !== day) writes.push(bump('visitors'), bump('device:' + b.device), bump('country:' + (country || '-')));
  } else if (b.event === 'time') {
    writes.push(q('INSERT INTO stays (day, visitor, seconds) VALUES (?, ?, ?) ON CONFLICT (day, visitor) DO UPDATE SET seconds = seconds + excluded.seconds', day, visitor, b.seconds));
    for (const name of Object.keys(b.items)) writes.push(bump('spent:' + name, b.items[name]));
  } else writes.push(bump(b.event + ':' + b.name));
  await DB.batch(writes);
  return answer(204, given);
}

// the request's body, if it is json of BYTES at most in one of SHAPES; or
// null
async function read(request) {
  if (Number(request.headers.get('Content-Length')) > TALLY.BYTES) return null;
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > TALLY.BYTES) return null;
  let b;
  try {
    b = JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    return null;
  }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  const keys = Object.keys(b);
  const fits = (s) => keys.length === Object.keys(s).length && keys.every((k) => Object.hasOwn(s, k) && s[k](b[k]));
  return SHAPES.some(fits) ? b : null;
}

// the value of the cookie named name in a Cookie header, or null
function cookie(header, name) {
  const m = header.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return m ? m[1] : null;
}

// an answer of status with no body, not to be cached nor indexed, and the
// visitor's cookie set to visitor if there is one
function answer(status, visitor) {
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
  if (visitor) headers['Set-Cookie'] = TALLY.COOKIE + '=' + visitor + '; Max-Age=' + TALLY.DAYS * DAY_S + '; Path=/; HttpOnly; Secure; SameSite=Lax';
  return new Response(null, { status, headers });
}
