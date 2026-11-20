// node tools/test/gate.test.js
//
// runs the site's gate (tools/server/gate.js) in node as its worker does,
// with a page of the test's own and a stand-in for the site's files that
// answers every path with the path. checks who is let in to what: no
// cookie, a try at the password right and wrong, a good cookie, one
// tampered with, run out, or signed with an old password, and no password
// set at all. then the locks, given to the gate as a worker gives them: a
// worker's own secret's the same as none given, and locked whatever its
// vars say; a site's as its worker starts (starts), open only where OPEN
// is "1"; an open one letting anyone in to anything, its files answered as
// they are with nothing asking them not to be indexed, while every answer
// of a locked one and every try at the password asks it; and one with a
// password set from ops, kept as pbkdf2 of ROUNDS under a fresh salt with
// a fresh key, that the new password opens and the secret does not, that
// turns away a cookie signed with the secret or with an earlier key, and
// that needs no secret at all. then a site's lock as its gate row says
// (stored), on a stand-in for its database with the clock moved by hand:
// as its worker starts with no database, no row, or one whose read fails
// in a fresh isolate; the row read at most once every KEPT s; a read that
// fails leaving the row as it was last read, open or locked, until a read
// works again; and each database its own row. then reads the real gate
// page (tools/server/gate.html) and checks every script it loads is a file
// of the site, its tries go to /gate, its title and logo are the site's
// own name (index.html's title), and it starts light unless the browser
// keeps dark where the site keeps it. exits 1 on failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const PAGE = '<html><script src="/js/raster.js"></script><script src="/js/type.js"></script><script>gate()</script></html>';
const SITE = { fetch: async (request) => new Response('site ' + new URL(request.url).pathname, { status: 200 }) };

// a request to dev.dangelo.engineering: method, path, and a cookie header and body if given
function ask(method, at, cookie, body) {
  const headers = cookie ? { Cookie: cookie } : {};
  return new Request('https://dev.dangelo.engineering' + at, { method, headers, body });
}

(async () => {
  const { gate, GATE, secret, starts, stored, admits, keep, opens } = await import(pathToFileURL(path.join(ROOT, 'tools/server/gate.js')).href);
  const env = { PASSWORD: 'a long walk to the sea', ASSETS: SITE };
  const go = (request, e = env) => gate(request, e, PAGE);

  // --- no cookie -----------------------------------------------------------------
  let r = await go(ask('GET', '/'));
  check('no cookie: / is the gate page, 401', r.status === 401 && (await r.text()) === PAGE, r.status);
  check('the gate page is not cached', r.headers.get('Cache-Control') === 'no-store');
  check('the gate page asks not to be indexed', r.headers.get('X-Robots-Tag') === 'noindex');
  r = await go(ask('GET', '/some/where?x=1'));
  check('no cookie: any address is the gate page', r.status === 401 && (await r.text()) === PAGE, r.status);
  r = await go(ask('GET', '/js/raster.js'));
  check('no cookie: the gate page\'s own script is let out', r.status === 200 && (await r.text()) === 'site /js/raster.js', r.status);
  check('its own script asks not to be indexed', r.headers.get('X-Robots-Tag') === 'noindex');
  r = await go(ask('HEAD', '/js/type.js'));
  check('no cookie: HEAD of its own script is let out', r.status === 200, r.status);
  r = await go(ask('GET', '/js/wall.js'));
  check('no cookie: any other script is the gate page', r.status === 401 && (await r.text()) === PAGE, r.status);
  r = await go(ask('GET', '/cicada/cicada.mp4'));
  check('no cookie: the film is the gate page', r.status === 401, r.status);
  r = await go(ask('POST', '/js/raster.js', null, 'x'));
  check('no cookie: a POST to its own script is the gate page', r.status === 401, r.status);
  r = await go(ask('GET', '/gate'));
  check('no cookie: GET /gate is the gate page', r.status === 401 && (await r.text()) === PAGE, r.status);

  // --- tries at the password -----------------------------------------------------
  r = await go(ask('POST', '/gate', null, 'a long walk to the see'));
  check('a wrong password: 401, no cookie', r.status === 401 && !r.headers.get('Set-Cookie'), r.status);
  r = await go(ask('POST', '/gate', null, ''));
  check('an empty try: 401', r.status === 401, r.status);
  r = await go(ask('POST', '/gate', null, 'x'.repeat(GATE.LONGEST + 1)));
  check('a try past LONGEST: 401', r.status === 401, r.status);
  r = await go(ask('POST', '/gate', null, env.PASSWORD));
  const set = r.headers.get('Set-Cookie') || '';
  check('the right password: 204', r.status === 204, r.status);
  check('its cookie is HttpOnly, Secure, SameSite=Lax, Path=/', /; HttpOnly/.test(set) && /; Secure/.test(set) && /; SameSite=Lax/.test(set) && /; Path=\//.test(set), set);
  check('its cookie lasts DAYS', set.includes('; Max-Age=' + GATE.DAYS * 86400), set);
  check('its answer asks not to be indexed', r.headers.get('X-Robots-Tag') === 'noindex');
  const cookie = set.split(';')[0];
  check('its cookie is named GATE.COOKIE', cookie.startsWith(GATE.COOKIE + '='), cookie);

  // --- with the cookie -----------------------------------------------------------
  r = await go(ask('GET', '/', cookie));
  check('the cookie: / is the site', r.status === 200 && (await r.text()) === 'site /', r.status);
  r = await go(ask('GET', '/js/wall.js', 'dark=1; ' + cookie + '; other=2'));
  check('the cookie among others: any file of the site', r.status === 200 && (await r.text()) === 'site /js/wall.js', r.status);
  check('the site asks not to be indexed', r.headers.get('X-Robots-Tag') === 'noindex');
  const [name, value] = cookie.split('=');
  const [until, sig] = value.split('.');
  const flip = (s) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
  r = await go(ask('GET', '/', name + '=' + until + '.' + flip(sig)));
  check('a tampered signature: the gate page', r.status === 401, r.status);
  r = await go(ask('GET', '/', name + '=' + (Number(until) + 1000) + '.' + sig));
  check('a lengthened expiry: the gate page', r.status === 401, r.status);
  r = await go(ask('GET', '/', cookie), { PASSWORD: 'another password', ASSETS: SITE });
  check('a cookie signed with an old password: the gate page', r.status === 401, r.status);
  const now = Date.now;
  Date.now = () => now() + (GATE.DAYS * 86400 + 60) * 1000;
  r = await go(ask('GET', '/', cookie));
  Date.now = now;
  check('a cookie run out: the gate page', r.status === 401, r.status);

  // --- no password set -----------------------------------------------------------
  const none = { ASSETS: SITE };
  r = await go(ask('POST', '/gate', null, ''), none);
  check('no password set: a try is 503', r.status === 503, r.status);
  r = await go(ask('POST', '/gate', null, 'undefined'), none);
  check('no password set: "undefined" is 503 too', r.status === 503, r.status);
  r = await go(ask('GET', '/', cookie), none);
  check('no password set: a cookie gets the gate page', r.status === 401, r.status);

  // --- the worker's own lock -----------------------------------------------------
  const lock = (l, e = env) => (request) => gate(request, e, PAGE, l);
  check('a worker\'s own lock: locked, its password and its key the secret', same(secret(env), { locked: true, key: env.PASSWORD, hash: null, salt: null }));
  check('and locked even on a worker that starts open', same(secret(Object.assign({ OPEN: '1' }, env)), { locked: true, key: env.PASSWORD, hash: null, salt: null }));
  const own = lock(secret(env));
  r = await own(ask('GET', '/'));
  check('given it: no cookie, the gate page, as with none given', r.status === 401 && (await r.text()) === PAGE, r.status);
  r = await own(ask('GET', '/', cookie));
  check('and the cookie lets in', r.status === 200 && (await r.text()) === 'site /', r.status);
  check('it admits the cookie, and not a request without', (await admits(ask('GET', '/', cookie), secret(env))) && !(await admits(ask('GET', '/'), secret(env))));

  // --- a site's lock as its worker starts ----------------------------------------
  const main = Object.assign({ OPEN: '1' }, env);
  check('a site with no OPEN starts as its own secret\'s lock: locked, the secret its password and key', same(starts(env), secret(env)), JSON.stringify(starts(env)));
  check('one with OPEN "1" starts open, the secret still its password and key', same(starts(main), { locked: false, key: env.PASSWORD, hash: null, salt: null }), JSON.stringify(starts(main)));
  const OPENS = ['0', 'true', 'yes', '', ' 1', '01', 1, true].filter((v) => !starts(Object.assign({}, env, { OPEN: v })).locked);
  check('OPEN anything but "1", the number 1 and true among them: locked', OPENS.length === 0, OPENS.map((v) => JSON.stringify(v)).join(' '));
  const live = lock(starts(main), main);
  r = await live(ask('GET', '/'));
  check('started open: no cookie, / is the site', r.status === 200 && (await r.text()) === 'site /', r.status);
  check('as it is, nothing asking it not to be indexed', r.headers.get('X-Robots-Tag') === null, r.headers.get('X-Robots-Tag'));
  r = await live(ask('POST', '/gate', null, env.PASSWORD));
  check('and the right password still gets the cookie, that answer not indexed', r.status === 204 && /^gate=/.test(r.headers.get('Set-Cookie') || '') && r.headers.get('X-Robots-Tag') === 'noindex', r.status);
  r = await lock(starts(env))(ask('GET', '/'));
  check('started locked: no cookie, the gate page', r.status === 401 && (await r.text()) === PAGE, r.status);

  // --- an open lock ----------------------------------------------------------------
  const open = lock({ locked: false, key: env.PASSWORD, hash: null, salt: null });
  r = await open(ask('GET', '/'));
  check('open: no cookie, / is the site', r.status === 200 && (await r.text()) === 'site /', r.status);
  check('answered as the site answers it, nothing asking it not to be indexed', r.headers.get('X-Robots-Tag') === null, r.headers.get('X-Robots-Tag'));
  r = await open(ask('GET', '/chebble/chess.wasm'));
  check('open: any file of the site, as it is', r.status === 200 && (await r.text()) === 'site /chebble/chess.wasm' && r.headers.get('X-Robots-Tag') === null, r.status);
  r = await open(ask('GET', '/js/raster.js'));
  check('open: the gate page\'s own scripts as they are too', r.status === 200 && r.headers.get('X-Robots-Tag') === null, r.headers.get('X-Robots-Tag'));
  r = await open(ask('GET', '/', cookie));
  check('open: with a cookie, as it is', r.status === 200 && r.headers.get('X-Robots-Tag') === null, r.headers.get('X-Robots-Tag'));
  r = await open(ask('POST', '/js/wall.js', null, 'x'));
  check('open: a POST goes to the site too, as with a cookie', r.status === 200, r.status);
  r = await open(ask('POST', '/gate', null, env.PASSWORD));
  check('open: the right password still gets the cookie, that answer not indexed', r.status === 204 && /^gate=/.test(r.headers.get('Set-Cookie') || '') && r.headers.get('X-Robots-Tag') === 'noindex', r.status);
  r = await open(ask('POST', '/gate', null, 'wrong'));
  check('open: a wrong one 401, not indexed', r.status === 401 && r.headers.get('X-Robots-Tag') === 'noindex', r.status);
  r = await lock({ locked: false, key: undefined, hash: null, salt: null })(ask('GET', '/'));
  check('open with no password set: still the site', r.status === 200, r.status);
  check('an open lock admits anyone', await admits(ask('GET', '/'), { locked: false, key: undefined, hash: null, salt: null }));

  // --- a password set from ops -----------------------------------------------------
  const WORDS = 'the tide comes in';
  const k = await keep(WORDS), k2 = await keep(WORDS);
  check('kept: a hash of 32 bytes, a salt of 16 and a key of 32, all hex', /^[0-9a-f]{64}$/.test(k.hash) && /^[0-9a-f]{32}$/.test(k.salt) && /^[0-9a-f]{64}$/.test(k.key), JSON.stringify(k).length);
  check('the hash is pbkdf2-sha-256 of the password under the salt, 30,000 rounds', GATE.ROUNDS === 30000 &&
    k.hash === crypto.pbkdf2Sync(WORDS, Buffer.from(k.salt, 'hex'), GATE.ROUNDS, 32, 'sha256').toString('hex'));
  check('the same password kept again: another salt, hash and key', k2.salt !== k.salt && k2.hash !== k.hash && k2.key !== k.key);
  check('nothing kept is the password', !JSON.stringify(k).includes(WORDS));
  const ops = { locked: true, key: k.key, hash: k.hash, salt: k.salt }, fromOps = lock(ops);
  const t0 = performance.now();
  r = await fromOps(ask('POST', '/gate', null, WORDS));
  const took = performance.now() - t0;
  const fresh = (r.headers.get('Set-Cookie') || '').split(';')[0];
  check('set from ops: the new password, 204 and a cookie', r.status === 204 && fresh.startsWith(GATE.COOKIE + '='), r.status + ', ' + took.toFixed(1) + ' ms in node');
  r = await fromOps(ask('POST', '/gate', null, env.PASSWORD));
  check('the secret no longer opens it', r.status === 401 && !r.headers.get('Set-Cookie'), r.status);
  r = await fromOps(ask('POST', '/gate', null, WORDS.slice(0, -1)));
  check('nor a password a letter short', r.status === 401, r.status);
  r = await fromOps(ask('POST', '/gate', null, ''));
  check('nor an empty try', r.status === 401, r.status);
  r = await fromOps(ask('POST', '/gate', null, 'x'.repeat(GATE.LONGEST + 1)));
  check('nor a try past LONGEST', r.status === 401, r.status);
  r = await fromOps(ask('GET', '/', cookie));
  check('a cookie signed with the secret: the gate page', r.status === 401 && (await r.text()) === PAGE, r.status);
  r = await fromOps(ask('GET', '/', fresh));
  check('the new cookie: the site, not indexed', r.status === 200 && (await r.text()) === 'site /' && r.headers.get('X-Robots-Tag') === 'noindex', r.status);
  r = await own(ask('GET', '/', fresh));
  check('the new cookie under the secret: the gate page', r.status === 401, r.status);
  r = await lock({ locked: true, key: k2.key, hash: k2.hash, salt: k2.salt })(ask('GET', '/', fresh));
  check('the same password set again: the cookie before turned away, a new key', r.status === 401, r.status);
  r = await lock(ops, { ASSETS: SITE })(ask('POST', '/gate', null, WORDS));
  check('set from ops with no secret on the worker: the new password still opens it', r.status === 204, r.status);
  r = await lock(Object.assign({}, ops, { locked: false }))(ask('GET', '/'));
  check('and set from ops but open: anyone in, the site as it is', r.status === 200 && r.headers.get('X-Robots-Tag') === null, r.status);

  // --- a site's lock as its gate row says --------------------------------------------
  // a stand-in for a site's database holding its gate row, or null for
  // none: each read counted, and thrown while it is down
  const base = (row) => {
    const D = {
      row, down: false, reads: 0,
      prepare: (sql) => ({
        first: async () => {
          D.reads++;
          if (D.down) throw new Error('D1_ERROR: the database is down');
          if (!/FROM gate WHERE id = 1/.test(sql)) throw new Error('not the gate row: ' + sql);
          return D.row && { ...D.row };
        },
      }),
    };
    return D;
  };
  const KEPT = GATE.KEPT * 1000;
  let clock = Date.parse('2026-11-16T15:00:00Z');
  Date.now = () => clock;
  const dev = (DB) => Object.assign({ DB }, env), live2 = (DB) => Object.assign({ DB, OPEN: '1' }, env);
  const unlocked = { locked: false, key: env.PASSWORD, hash: null, salt: null }, toSecret = secret(env);

  check('no database: as its worker starts, locked or open', same(await stored(env), toSecret) && same(await stored(main), unlocked));
  let D = base(null), E = base(null);
  check('no row: as its worker starts, dev locked and the live site open', same(await stored(dev(D)), toSecret) && same(await stored(live2(E)), unlocked));
  D = base(null);
  D.down = true;
  E = base(null);
  E.down = true;
  check('a read that fails in a fresh isolate: as its worker starts too', same(await stored(dev(D)), toSecret) && same(await stored(live2(E)), unlocked) && D.reads === 1 && E.reads === 1,
    D.reads + ' ' + E.reads + ' reads');
  check('and not read again within KEPT', same(await stored(dev(D)), toSecret) && D.reads === 1, D.reads + ' reads');

  D = base({ locked: 0, hash: null, salt: null, key: null });
  check('a row open: open, the secret still the password and key', same(await stored(dev(D)), unlocked));
  D = base({ locked: 1, hash: null, salt: null, key: null });
  check('a row locked with no password set: on the live site too, locked to its secret', same(await stored(live2(D)), toSecret));
  D = base({ locked: 1, hash: k.hash, salt: k.salt, key: k.key });
  check('a row with a password set from ops: its hash, salt and key', same(await stored(dev(D)), ops));

  D = base({ locked: 0, hash: null, salt: null, key: null });
  const t = clock;
  await stored(dev(D));
  D.row = { locked: 1, hash: null, salt: null, key: null };
  clock = t + KEPT - 1;
  check('the row kept KEPT s: a change unseen a ms before, the row read once', !(await stored(dev(D))).locked && D.reads === 1, D.reads + ' reads');
  clock = t + KEPT;
  check('and seen at KEPT', (await stored(dev(D))).locked && D.reads === 2, D.reads + ' reads');

  D = base({ locked: 0, hash: null, salt: null, key: null });
  await stored(dev(D));
  D.down = true;
  D.row = { locked: 1, hash: null, salt: null, key: null };
  clock += KEPT;
  check('dev, opened by its row, and a read that fails: still open, not locked as it starts', same(await stored(dev(D)), unlocked) && D.reads === 2, D.reads + ' reads');
  const failedAt = clock;
  clock = failedAt + 1000;
  D.down = false;
  check('the read that failed kept KEPT s too: not tried again a s after', same(await stored(dev(D)), unlocked) && D.reads === 2, D.reads + ' reads');
  clock = failedAt + KEPT;
  check('and once it works again, KEPT after the one that failed, the row as it is now', same(await stored(dev(D)), toSecret) && D.reads === 3, D.reads + ' reads');

  E = base({ locked: 1, hash: k.hash, salt: k.salt, key: k.key });
  check('the live site, locked from ops', same(await stored(live2(E)), ops));
  E.down = true;
  clock += KEPT;
  check('and a read that fails: still locked to the password from ops, not open as it starts', same(await stored(live2(E)), ops));
  clock += KEPT;
  r = await gate(ask('GET', '/'), live2(E), PAGE, await stored(live2(E)));
  check('so the gate still asks for that password', r.status === 401 && (await r.text()) === PAGE, r.status);

  const one = base({ locked: 0, hash: null, salt: null, key: null }), two = base({ locked: 1, hash: null, salt: null, key: null });
  check('each database its own row', !(await stored(dev(one))).locked && (await stored(dev(two))).locked && !(await stored(dev(one))).locked);
  Date.now = now;

  // --- the real gate page --------------------------------------------------------
  const real = fs.readFileSync(path.join(ROOT, 'tools/server/gate.html'), 'utf8');
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const paths = [...opens(real)];
  check('the gate page loads scripts', paths.length > 0, paths.join(' '));
  for (const p of paths) {
    check('its script ' + p + ' is a file of the site', p.startsWith('/js/') && fs.existsSync(path.join(ROOT, p)), p);
  }
  check('the gate page sends its tries to /gate', /fetch\(\s*'\/gate'/.test(real));
  const title = (html) => (html.match(/<title>([^<]*)<\/title>/) || [])[1];
  const logo = (real.match(/const LOGO = \{\s*TEXT: "([^"]+)"/) || [])[1];
  check('its title is the site\'s, as index.html\'s', title(index) && title(real) === title(index), title(real) + ' / ' + title(index));
  check('and its logo says the same', logo === title(index), logo);

  // where each page keeps the switch, and the gate page's start, run on a
  // stand-in for the browser's storage and its system scheme
  const keyOf = (html) => (html.match(/const SWITCH = \{[^}]*?KEY: '([^']+)'/) || [])[1];
  check('the gate page keeps light or dark where the site does', keyOf(real) && keyOf(real) === keyOf(index), keyOf(real) + ' / ' + keyOf(index));
  const src = (real.match(/function startsDark\(\) \{[\s\S]*?\n {4}\}/) || [])[0];
  check('the gate page has its start', !!src);
  const startsDark = (kept, { throws = false, dark = true } = {}) => {
    const localStorage = { getItem: (k) => { if (throws) throw new Error('denied'); return k === keyOf(real) ? kept : null; } };
    const ctx = vm.createContext({ SWITCH: { KEY: keyOf(real) }, localStorage, matchMedia: (q) => ({ matches: dark && /prefers-color-scheme: dark/.test(q) }) });
    return vm.runInContext(src + '; startsDark()', ctx);
  };
  const starting = [startsDark(null), startsDark('1'), startsDark('0'), startsDark(null, { throws: true }), startsDark(null, { dark: false })];
  check('it starts light with nothing kept, even on a dark system; dark only where the browser keeps dark; light where it keeps nothing it can read',
    same(starting, [false, true, false, false, false]), starting.join(' '));

  console.log('\n' + (failures ? failures + ' failed' : 'all passed'));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
