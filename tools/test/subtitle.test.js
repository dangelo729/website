// node tools/test/subtitle.test.js
//
// loads js/subtitle.js the way the page does, a classic script, in a vm
// context. checks a line's text splits into its syllables and back into
// the text as shown, and that a box is placed round a circle at random,
// clear of it, inside the area and off what it should keep off, all the
// way round over many tries, as close as a whole px allows, and nowhere
// when nothing fits. exits 1 on failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'subtitle.js'), 'utf8'), ctx, { filename: 'js/subtitle.js' });
const Subtitle = vm.runInContext('Subtitle', ctx);

// --- split -------------------------------------------------------------------
const shown = (text) => {
  const { whole, ends } = Subtitle.split(text);
  return ends.map((e) => whole.slice(0, e));
};
const a = Subtitle.split("That's what I'm talk|ing a|bout");
check('the |s go from the text as shown', a.whole === "That's what I'm talking about", a.whole);
check('a syllable for each word and each | in one', a.ends.length === 7, a.ends.length);
check('syllable by syllable',
  shown("That's what I'm talk|ing a|bout").join(' / ') === "That's / That's what / That's what I'm / That's what I'm talk / That's what I'm talking / That's what I'm talking a / That's what I'm talking about",
  shown("That's what I'm talk|ing a|bout").join(' / '));
check('one word, one syllable', shown('Ouch').join() === 'Ouch');
check('one word, three', shown('Bub|bli|cious').join(' / ') === 'Bub / Bubbli / Bubblicious', shown('Bub|bli|cious').join(' / '));
check('spaces at the ends and doubled are dropped', Subtitle.split('  Stop   that ').whole === 'Stop that');

// --- place -------------------------------------------------------------------
// a seeded random, so a run is the same run every time
let seed = 1;
const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const area = { x0: 0, y0: 0, x1: 600, y1: 260 };
const cx = 300, cy = 130, r = 60, w = 180, h = 16;
const clear = (p) => {
  const gx = Math.max(Math.abs(p.x + w / 2 - cx) - w / 2, 0), gy = Math.max(Math.abs(p.y + h / 2 - cy) - h / 2, 0);
  return Math.hypot(gx, gy);
};
const keep = [{ x0: 0, y0: 0, x1: 40, y1: 40 }];
const off = (p, k) => !(p.x < k.x1 && p.x + w > k.x0 && p.y < k.y1 && p.y + h > k.y0);
const places = [];
for (let n = 0; n < 500; n++) places.push(Subtitle.place(w, h, cx, cy, r, area, keep, random));
check('somewhere every time there is room', places.every((p) => p !== null));
check('clear of the circle', places.every((p) => clear(p) >= r - 1e-9), 'nearest ' + Math.min(...places.map(clear)).toFixed(2));
check('as close as a whole px allows', places.every((p) => clear(p) < r + 1.5), 'furthest ' + Math.max(...places.map(clear)).toFixed(2));
check('inside the area', places.every((p) => p.x >= area.x0 && p.y >= area.y0 && p.x + w <= area.x1 && p.y + h <= area.y1));
check('off what it keeps off', places.every((p) => keep.every((k) => off(p, k))));
const sides = new Set(places.map((p) => (p.x + w / 2 < cx - r ? 'left' : p.x + w / 2 > cx + r ? 'right' : '') + (p.y + h / 2 < cy ? 'above' : 'below')));
check('all the way round', ['above', 'below', 'leftabove', 'leftbelow', 'rightabove', 'rightbelow'].every((s) => sides.has(s)), [...sides].join(' '));
check('nowhere when nothing fits', Subtitle.place(w, h, cx, cy, r, { x0: 150, y0: 75, x1: 450, y1: 185 }, [], random) === null);

console.log(failures ? failures + ' failed' : 'all passed');
process.exit(failures ? 1 : 0);
