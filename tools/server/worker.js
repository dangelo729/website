// --- the site's worker -------------------------------------------------------------
// dangelo.engineering's and dev.dangelo.engineering's. it is handed the
// requests for the page itself and for whatever is no file of the repo's
// (wrangler.toml's run_worker_first); every other file is served without
// it. each goes through the gate (gate.js), its page (gate.html) bundled
// in as text, under the site's lock as its database says (stored, set from
// ops), but /api/tally from a visitor the lock lets in, which is counted
// (tally.js). an es module, run and deployed with wrangler (wrangler.toml
// at the repo's root)

import page from './gate.html';
import { gate, admits, stored } from './gate.js';
import { tally } from './tally.js';

export default {
  async fetch(request, env) {
    const lock = await stored(env);
    if (new URL(request.url).pathname === '/api/tally' && (await admits(request, lock))) return tally(request, env);
    return gate(request, env, page, lock);
  },
};
