// --- the site ----------------------------------------------------------------
// this site, as the pages that are shared_core's say it: the gate's page
// (tools/server/gate.html) and ops's (tools/ops/ops.html), which hold no
// site's name of their own.

const SITE = {
  NAME: "Peter D'Angelo", // its name: the gate page's title and its logo's words
  HOSTS: { main: 'dangelo.engineering', dev: 'dev.dangelo.engineering' }, // its live site's host and dev's: what ops's page calls each
  OPEN: true, // whether its live site starts open, with no lock set from ops, as its worker does (OPEN, wrangler.toml)
};
