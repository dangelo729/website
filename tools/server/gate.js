// --- the gate --------------------------------------------------------------------
// the site's worker (worker.js), the live site's and dev's alike, sends
// every request it is handed here, and so does ops's (tools/ops). what lets
// a visitor in is the worker's lock: whether it is locked, the key its
// cookies are signed with, and the password's hash and salt when one was
// set from ops. a lock that is open lets everyone in. a locked one lets in
// a visitor carrying a good cookie: they get the site, the repo's own
// files. one without it gets the gate page, at whatever address they
// opened, and the scripts that page loads, read out of its own script
// tags; anything else they ask for is answered with the gate page too. the
// page posts what is typed to /gate: the right password sets the cookie
// for DAYS, and the page reloads into the site. the cookie holds when it
// runs out, signed with the lock's key, so a new key turns every cookie
// away. with no key nobody is let in. every answer asks not to be indexed,
// but an open site's files, which are answered as they are.
//
// a worker's own lock (secret) is locked, its password the worker's secret
// (env.PASSWORD), which is its key too. a site's lock (stored) is its gate
// row in its own database (env.DB, made by migrations/0002_gate.sql, set
// from ops), kept in memory KEPT s in each isolate before the row is read
// again: locked as the row says; while the row's hash is null the password
// and the key are still the secret's, and once a password is set from ops
// it is checked against its hash, ROUNDS of pbkdf2-sha-256 under its salt,
// and the key is the row's, made anew with each password. with no row or
// no table, a site's lock is as its worker starts (starts): its password
// and its key the secret, and locked unless the worker starts open
// (env.OPEN, a var of its own in wrangler.toml, if it has one). a read
// that fails leaves the row as the isolate last read it.

export const GATE = {
  COOKIE: 'gate', // the cookie's name
  DAYS: 30,       // how long a cookie lets its visitor in
  LONGEST: 1024,  // characters past which a try is not checked
  ROUNDS: 30000,  // pbkdf2's rounds over a password set from ops
  KEPT: 30,       // s a site's lock is kept in memory before its row is read again
};

const DAY_S = 86400;

// a request answered: the site to a visitor the lock lets in, as it is if
// the lock is open, a try at the password on /gate, the gate page's own
// scripts, or else the gate page
export async function gate(request, env, page, lock = secret(env)) {
  const url = new URL(request.url);
  if (url.pathname === '/gate' && request.method === 'POST') return enter(request, lock);
  const reads = request.method === 'GET' || request.method === 'HEAD';
  if ((await admits(request, lock)) || (reads && opens(page).has(url.pathname))) {
    const file = await env.ASSETS.fetch(request);
    return lock.locked ? unindexed(file) : file;
  }
  return unindexed(new Response(page, {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  }));
}

// the paths the gate page's script tags load
export function opens(page) {
  return new Set([...page.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]));
}

// a try at the password: 204 and the cookie when it is right, 401 when it
// is not, 503 when there is no key to sign a cookie with
async function enter(request, lock) {
  if (!lock.key) return unindexed(new Response(null, { status: 503 }));
  const typed = await request.text();
  const right = typed.length <= GATE.LONGEST && (lock.hash
    ? typed.length > 0 && same(await stretch(typed, lock.salt), lock.hash)
    : same(await sign(lock.key, 'try ' + typed), await sign(lock.key, 'try ' + lock.key)));
  if (!right) return unindexed(new Response(null, { status: 401 }));
  const until = Date.now() + GATE.DAYS * DAY_S * 1000;
  const cookie = GATE.COOKIE + '=' + until + '.' + (await sign(lock.key, 'until ' + until)) +
    '; Max-Age=' + GATE.DAYS * DAY_S + '; Path=/; HttpOnly; Secure; SameSite=Lax';
  return unindexed(new Response(null, { status: 204, headers: { 'Set-Cookie': cookie, 'Cache-Control': 'no-store' } }));
}

// whether the lock lets the request in: open, or a good cookie carried
export async function admits(request, lock) {
  return !lock.locked || (await carries(request, lock));
}

// whether the request carries a cookie signed with the lock's key that has
// not yet run out
export async function carries(request, lock) {
  if (!lock.key) return false;
  const m = (request.headers.get('Cookie') || '').match(new RegExp('(?:^|;\\s*)' + GATE.COOKIE + '=(\\d+)\\.([\\w-]+)'));
  if (!m || Number(m[1]) <= Date.now()) return false;
  return same(m[2], await sign(lock.key, 'until ' + m[1]));
}

// the worker's own lock: locked, its password and its key the secret
export function secret(env) {
  return { locked: true, key: env.PASSWORD, hash: null, salt: null };
}

// a site's lock as its worker starts, with no gate row: its password and
// its key the secret, and locked unless the worker starts open (env.OPEN)
export function starts(env) {
  return { locked: env.OPEN !== '1', key: env.PASSWORD, hash: null, salt: null };
}

// each database's gate row as last read, and until when it is kept, ms
const rows = new WeakMap();

// the site's lock, as its gate row says: read at most once every KEPT s in
// an isolate, a read that fails leaving the row as it was last read, and
// as its worker starts with no row or no table
export async function stored(env) {
  const db = env.DB;
  if (!db) return starts(env);
  let got = rows.get(db);
  if (!got || got.until <= Date.now()) {
    let row = got ? got.row : null;
    try {
      row = await db.prepare('SELECT locked, hash, salt, key FROM gate WHERE id = 1').first();
    } catch (e) {}
    got = { row, until: Date.now() + GATE.KEPT * 1000 };
    rows.set(db, got);
  }
  const r = got.row;
  if (!r) return starts(env);
  if (r.hash && r.salt && r.key) return { locked: r.locked !== 0, key: r.key, hash: r.hash, salt: r.salt };
  return { locked: r.locked !== 0, key: env.PASSWORD, hash: null, salt: null };
}

// a password set from ops as a gate row keeps it, all hex: its hash under a
// fresh salt of 16 random bytes, and a fresh key of 32 for its cookies
export async function keep(password) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { hash: await stretch(password, salt), salt, key: hex(crypto.getRandomValues(new Uint8Array(32))) };
}

// password stretched: ROUNDS of pbkdf2-sha-256 under salt (hex), 32 bytes, hex
async function stretch(password, salt) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(salt), iterations: GATE.ROUNDS }, k, 256);
  return hex(new Uint8Array(bits));
}

// text signed with key: its hmac-sha256, base64url
async function sign(key, text) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(text)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// bytes as hex, and hex as bytes
const hex = (bytes) => Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (text) => new Uint8Array((text.match(/../g) || []).map((x) => parseInt(x, 16)));

// whether two strings are the same, in a time that does not depend on
// where they differ
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// the response, asking not to be indexed
function unindexed(response) {
  const r = new Response(response.body, response);
  r.headers.set('X-Robots-Tag', 'noindex');
  return r;
}
