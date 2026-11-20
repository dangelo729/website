// --- the ops worker ------------------------------------------------------------------
// every request to ops.dangelo.engineering, answered by ops's worker
// (ops.js) as this site's own says (site.js). an es module, run and
// deployed with wrangler as [env.ops] (wrangler.toml at the repo's root)

import { ops } from './ops.js';
import { SITE } from './site.js';

export default ops(SITE);
