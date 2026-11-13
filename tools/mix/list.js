// node tools/mix/list.js [n]
//
// the wall's colours past the sixteen a visitor picks (js/wall.js,
// COLOURS), as they were made: grown from the sixteen, each new one the
// even mix (js/mix.js's paint) of two already on the list, the one
// farthest in lab from everything on it, until there are n, or as many as
// the list has when no n is given. prints the list as COLOURS holds it and
// says whether it begins as the list in js/wall.js does: it must, as a
// colour's place on the list is what the wall's bytes hold, so the list
// is only ever grown at its end. exits 1 when it does not. floats differ
// a hair from one javascript to the next, so the list is kept as printed
// and never made again where it is used.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const ctx = vm.createContext({});
for (const f of ['js/wall.js', 'js/mix.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
const { WALL, MIX, Mix } = vm.runInContext('({ WALL, MIX, Mix })', ctx);

const PICKS = 16;
const n = +process.argv[2] || WALL.COLOURS.length;
const srgb = (c) => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
const apart = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const labOf = (p) => { const l = [0, 0, 0]; Mix.labOf(p, 0, l, 0); return l; };

// each colour on the list: its paint and its lab
const list = WALL.COLOURS.slice(0, PICKS).map((hex, i) => {
  const p = [0, 0, 0, 0];
  Mix.paintOf(hex, i === 0 ? MIX.PAPER : i === 1 ? MIX.BLACK : 1, p, 0);
  return { hex, p, lab: labOf(p) };
});
// every even mix of two on the list, and how far it is from the nearest on it
const mixes = [];
function add(k) {
  for (let i = 0; i < k; i++) {
    const a = list[i].p, b = list[k].p, p = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, (a[3] + b[3]) / 2];
    const c = { p, lab: labOf(p), d: Infinity };
    for (const o of list) c.d = Math.min(c.d, apart(c.lab, o.lab));
    mixes.push(c);
  }
}
for (let k = 1; k < list.length; k++) add(k);
while (list.length < n) {
  let best = 0;
  for (let k = 1; k < mixes.length; k++) if (mixes[k].d > mixes[best].d) best = k;
  const c = mixes[best];
  mixes[best] = mixes[mixes.length - 1];
  mixes.pop();
  for (const o of mixes) o.d = Math.min(o.d, apart(o.lab, c.lab));
  c.hex = '#' + [1, 2, 3].map((k) => Math.round(255 * Math.min(1, Math.max(0, srgb(Mix.back(c.p[k] / c.p[0]))))).toString(16).padStart(2, '0')).join('');
  list.push(c);
  add(list.length - 1);
}

for (let i = 0; i < list.length; i += 8) console.log(list.slice(i, i + 8).map((c) => "'" + c.hex + "'").join(', ') + ',');
const both = Math.min(list.length, WALL.COLOURS.length);
let at = -1;
for (let i = 0; i < both && at < 0; i++) if (list[i].hex.toLowerCase() !== WALL.COLOURS[i].toLowerCase()) at = i;
console.log(at < 0 ? 'the first ' + both + ' are as js/wall.js has them' : 'colour ' + at + ' is ' + list[at].hex + ', and ' + WALL.COLOURS[at] + ' in js/wall.js');
process.exit(at < 0 ? 0 : 1);
