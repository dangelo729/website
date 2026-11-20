// --- the controls ----------------------------------------------------------------
// /controls: each site's lock, dangelo.engineering's (main, env.MAIN) and
// dev.dangelo.engineering's (dev, env.DEV), kept as the gate row in the
// site's own database (tools/server/migrations/0002_gate.sql) that its
// gate reads (tools/server/gate.js, within GATE.KEPT s). GET answers both,
// json:
//
//   {
//     main: { locked: false, password: 'secret', at: null },
//     dev:  { locked: true, password: 'ops', at: 1795300000000 },
//   }
//
// locked, whether the site asks for a password; password, 'secret' while
// it is still the worker's own secret and 'ops' once one has been set from
// here; at, ms, when its row last changed, or null for none yet, when the
// site is as its worker starts (STARTS). never a password, a hash, a salt
// or a key.
//
// POST takes json { site: 'main' | 'dev', locked?: true | false,
// password?: '...' }, one of the two at least: a password of 1 to
// GATE.LONGEST characters is kept as the gate keeps it, a new hash, salt
// and key (keep); locked alone leaves the password as it is, and a
// password alone leaves the lock. it answers as GET does, after. against a
// form or a script on another site posting here with the owner's cookie,
// a POST without Content-Type application/json, or whose Origin is not
// this address's own, is refused, 403; a body of more than BYTES, not json,
// or not that shape, is refused, 400; neither writes anything. a database
// that fails is 500 with what went wrong, { error }.

import { GATE, keep } from '../server/gate.js';

export const CONTROLS = {
  SITES: { main: 'MAIN', dev: 'DEV' },   // each site, and its database's binding
  STARTS: { main: false, dev: true },    // whether each is locked with no row yet, as its worker starts (OPEN, wrangler.toml)
  BYTES: 8192,                           // the most a body may hold
};

// a request to /controls answered
export async function controls(request, env) {
  if (request.method === 'GET') return answer(env);
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } });
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json' || request.headers.get('Origin') !== new URL(request.url).origin) {
    return Response.json({ error: 'json from this page only' }, { status: 403 });
  }
  const b = await read(request);
  if (!b) return Response.json({ error: 'site main or dev, locked true or false, password 1 to ' + GATE.LONGEST + ' characters' }, { status: 400 });
  const k = b.password === undefined ? { hash: null, salt: null, key: null } : await keep(b.password);
  const sets = ['at = excluded.at'];
  if (b.locked !== undefined) sets.push('locked = excluded.locked');
  if (b.password !== undefined) sets.push('hash = excluded.hash', 'salt = excluded.salt', 'key = excluded.key');
  const db = env[CONTROLS.SITES[b.site]];
  try {
    // with no row yet the site is as it starts, so locked not given is that
    await db.prepare('INSERT INTO gate (id, locked, hash, salt, key, at) VALUES (1, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET ' + sets.join(', '))
      .bind((b.locked === undefined ? CONTROLS.STARTS[b.site] : b.locked) ? 1 : 0, k.hash, k.salt, k.key, Date.now()).run();
  } catch (e) {
    return failed(e);
  }
  return answer(env);
}

// both sites' locks, as GET answers them
async function answer(env) {
  const out = {};
  try {
    for (const [site, binding] of Object.entries(CONTROLS.SITES)) {
      const r = await env[binding].prepare('SELECT locked, hash IS NOT NULL AS ops, at FROM gate WHERE id = 1').first();
      out[site] = r ? { locked: r.locked !== 0, password: r.ops ? 'ops' : 'secret', at: r.at } : { locked: CONTROLS.STARTS[site], password: 'secret', at: null };
    }
  } catch (e) {
    return failed(e);
  }
  return Response.json(out);
}

// the request's body, if it is json of BYTES at most in the shape POST
// takes; or null
async function read(request) {
  if (Number(request.headers.get('Content-Length')) > CONTROLS.BYTES) return null;
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > CONTROLS.BYTES) return null;
  let b;
  try {
    b = JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    return null;
  }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  const fits = Object.keys(b).every((k) => k === 'site' || k === 'locked' || k === 'password') &&
    typeof b.site === 'string' && Object.hasOwn(CONTROLS.SITES, b.site) &&
    (b.locked === undefined || typeof b.locked === 'boolean') &&
    (b.password === undefined || (typeof b.password === 'string' && b.password.length > 0 && b.password.length <= GATE.LONGEST)) &&
    (b.locked !== undefined || b.password !== undefined);
  return fits ? b : null;
}

// a database that failed: 500, and what went wrong
function failed(e) {
  return Response.json({ error: String((e && e.message) || e) }, { status: 500 });
}
