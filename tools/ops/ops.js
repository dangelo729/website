// --- the ops worker ------------------------------------------------------------------
// every request to a site's ops: the sites' numbers and their locks, for
// their owner. it is behind the sites' own gate (tools/server/gate.js, its
// page tools/server/gate.html bundled in as text), always locked to the
// worker's own secret (env.PASSWORD) and never to a gate row, so it can be
// neither opened nor given a new password from itself. the right password
// sets, beside the gate's cookie, the me cookie for the whole of the
// site's DOMAIN, which marks the owner's browser for the sites' tally
// (tools/server/tally.js) to leave out. behind the gate: / is its page
// (ops.html, bundled in as text), /stats a site's numbers (stats.js),
// /controls each site's lock (controls.js), any other GET or HEAD the
// repo's own files, for the page's scripts, and anything else 405. every
// answer asks not to be cached nor indexed. what is the site's own it is
// handed by the site's worker (worker.js, its SITE from site.js). an es
// module, run and deployed with wrangler as [env.ops] (wrangler.toml at
// the repo's root), the two sites' databases bound as MAIN and DEV

import gatePage from '../server/gate.html';
import page from './ops.html';
import { gate, carries, secret } from '../server/gate.js';
import { stats } from './stats.js';
import { controls } from './controls.js';

export const OPS = {
  DAYS: 400, // how long the me cookie lasts, the most a browser keeps one
};

// the worker for a site, its own (own) as its site.js says it: { DOMAIN,
// ME, STARTS, ZONE, dayOf, reads, adds }, the me cookie's domain and its
// name, how each of its sites starts (controls.js), and what its /stats
// reads and answers (stats.js)
export function ops(own) {
  const me = own.ME + '=1; Domain=' + own.DOMAIN + '; Path=/; Max-Age=' + OPS.DAYS * 86400 + '; HttpOnly; Secure; SameSite=Lax';
  return {
    async fetch(request, env) {
      return unkept(await route(request, env, own, me));
    },
  };
}

// a request answered: a try at the password, the gate page to a visitor
// without a good cookie, or else what is behind the gate
async function route(request, env, own, me) {
  const url = new URL(request.url), lock = secret(env);
  if (url.pathname === '/gate' && request.method === 'POST') {
    const r = await gate(request, env, gatePage, lock);
    if (r.status === 204) r.headers.append('Set-Cookie', me);
    return r;
  }
  if (!(await carries(request, lock))) return gate(request, env, gatePage, lock);
  if (url.pathname === '/stats') return request.method === 'GET' ? stats(request, env, own) : refused('GET');
  if (url.pathname === '/controls') return controls(request, env, own.STARTS);
  if (request.method !== 'GET' && request.method !== 'HEAD') return refused('GET, HEAD');
  if (url.pathname === '/') return new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  return env.ASSETS.fetch(request);
}

// a method not taken: 405, and those that are
function refused(allow) {
  return new Response(null, { status: 405, headers: { Allow: allow } });
}

// the response, asking not to be cached nor indexed
function unkept(response) {
  const r = new Response(response.body, response);
  r.headers.set('Cache-Control', 'no-store');
  r.headers.set('X-Robots-Tag', 'noindex');
  return r;
}
