// node tools/test/shared.test.js
//
// checks a site's copies of shared_core's files are byte for byte
// shared_core's: every file under its js/, tools/server/ and tools/ops/,
// and this test, at the same path in the site. a missing copy fails.
// shared_core is found beside the site (../shared_core) or at SHARED_CORE;
// not found, nothing could be checked, which is a failure too. run in
// shared_core itself, it checks both sites beside it, ../website and
// ../chebble. a copy that differs is put right by make in shared_core.
// then what the shared pages (the gate's, and ops's where shared_core has
// it) ask of a site's own files: every script each loads a file of the
// site's js/, and the site's name (js/site.js's SITE.NAME), which a shared
// page shows for its own, index.html's title. then that each shared page
// and the site's index.html keep light or dark alike: each loads the
// switch (js/switch.js), and each head's first script, before any other,
// is the paper's colour before the scripts load, the same statements as
// shared_core's gate page's, reading what the switch keeps under its key
// (SWITCH.KEY). then that a
// site says the same of itself each place it does: its live site's host
// and whether it starts open, to its pages (js/site.js), to ops's worker
// (tools/ops/site.js) and to its own worker (wrangler.toml's OPEN). exits
// 1 on failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..');
const CORE = process.env.SHARED_CORE || path.join(ROOT, '..', 'shared_core');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
  return ok;
}

// every file under dir, relative to the root, .DS_Store skipped
function files(root, dir) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return files(root, rel);
    return e.isFile() && e.name !== '.DS_Store' ? [rel] : [];
  });
}

if (!fs.existsSync(path.join(CORE, 'tools', 'test', 'shared.test.js'))) {
  console.log('FAIL shared_core is not at ' + CORE + ': nothing checked (SHARED_CORE says where it is)');
  process.exit(1);
}

const shared = ['js', 'tools/server', 'tools/ops'].flatMap((dir) => files(CORE, dir));
shared.push(path.join('tools', 'test', 'shared.test.js'));
shared.sort();

// run in shared_core, both sites; run in a site, that site
const here = fs.realpathSync(ROOT) === fs.realpathSync(CORE);
const sites = here ? [path.join(ROOT, '..', 'website'), path.join(ROOT, '..', 'chebble')] : [ROOT];

for (const site of sites) {
  for (const file of shared) {
    const name = (here ? path.basename(site) + '/' : '') + file;
    const copy = path.join(site, file);
    if (!fs.existsSync(copy)) { check(name, false, 'missing'); continue; }
    const same = fs.readFileSync(copy).equals(fs.readFileSync(path.join(CORE, file)));
    check(name, same, same ? '' : 'differs from shared_core\'s');
  }
}

// the shared pages, each skipped while shared_core has none
const PAGES = ['tools/server/gate.html', 'tools/ops/ops.html'].filter((p) => fs.existsSync(path.join(CORE, p)));
const title = (html) => (html.match(/<title>([^<]*)<\/title>/) || [])[1];
const keyOf = (src) => (src.match(/const SWITCH = \{[^}]*?KEY: '([^']+)'/) || [])[1];
const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
// a head's first script, inline, and where it is; and a script's
// statements, its whole-line comments dropped and its spaces run together
const headScript = (html) => {
  const head = (html.match(/<head>([\s\S]*?)<\/head>/) || [])[1] || '', m = head.match(/<script>([\s\S]*?)<\/script>/);
  return m ? { src: m[1], at: html.indexOf(m[0]) } : null;
};
const statements = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join(' ').replace(/\s+/g, ' ').trim();
const paper = headScript(read(path.join(CORE, 'tools/server/gate.html')));

for (const site of sites) {
  const at = here ? path.basename(site) + '/' : '';
  const index = read(path.join(site, 'index.html'));
  let name;
  try {
    const ctx = vm.createContext({});
    vm.runInContext(read(path.join(site, 'js', 'site.js')), ctx);
    name = vm.runInContext('SITE.NAME', ctx);
  } catch (e) {}
  check(at + 'js/site.js\'s SITE.NAME is index.html\'s title', !!title(index) && name === title(index), name + ' / ' + title(index));
  for (const page of PAGES) {
    const html = read(path.join(site, page));
    const paths = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    for (const p of paths) {
      check(at + page + ': its script ' + p + ' is a file of the site', p.startsWith('/js/') && fs.existsSync(path.join(site, p)), p);
    }
  }
  // light or dark: each page loads the switch and carries the paper's
  // colour before the scripts load, first in its head
  const key = keyOf(read(path.join(site, 'js', 'switch.js')));
  check(at + 'the paper\'s colour before the scripts load reads what js/switch.js keeps under its key',
    !!paper && !!key && statements(paper.src).includes("localStorage.getItem('" + key + "')"), key);
  for (const page of ['index.html', ...PAGES]) {
    const html = read(path.join(site, page)), first = headScript(html), loads = html.search(/<script src="\/?js\/switch\.js"><\/script>/);
    check(at + page + ' loads the switch (js/switch.js)', loads > 0);
    check(at + page + '\'s head\'s first script is the paper\'s colour, the gate page\'s statements', !!first && !!paper && statements(first.src) === statements(paper.src));
    check(at + page + ': and before any other script', !!first && first.at < html.indexOf('<script src='), first && first.at);
  }
}

// a site's live host and how it starts, as its pages, ops's worker and its
// own worker's vars each have them
(async () => {
  for (const site of sites) {
    const at = here ? path.basename(site) + '/' : '';
    let page = null, own = null;
    try {
      const ctx = vm.createContext({});
      vm.runInContext(read(path.join(site, 'js', 'site.js')), ctx);
      page = vm.runInContext('SITE', ctx);
    } catch (e) {}
    try {
      own = (await import(pathToFileURL(path.join(site, 'tools', 'ops', 'site.js')).href)).SITE;
    } catch (e) {}
    if (!check(at + 'js/site.js and tools/ops/site.js each give a SITE', !!page && !!own)) continue;
    check(at + 'the live site\'s host is ops\'s worker\'s domain', !!page.HOSTS && page.HOSTS.main === own.DOMAIN, (page.HOSTS && page.HOSTS.main) + ' / ' + own.DOMAIN);
    check(at + 'it starts open to its pages as it does to ops\'s worker', !!own.STARTS && page.OPEN === !own.STARTS.main, page.OPEN + ' / ' + JSON.stringify(own.STARTS));
    // the worker's own vars: wrangler.toml's top level, before its first environment
    const top = read(path.join(site, 'wrangler.toml')).split(/^\[env\./m)[0];
    const open = /^OPEN\s*=\s*"1"\s*$/m.test(top);
    check(at + 'and as its worker\'s OPEN has it', page.OPEN === open, page.OPEN + ' / ' + open);
  }

  console.log('\n' + (failures ? failures + ' failed' : 'all passed'));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
