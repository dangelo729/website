// node tools/test/scale.test.js
//
// loads js/scale.js the way the page does, a classic script, in a vm
// context. checks the seven modes, the twelve keys and the five octaves,
// that the page starts in c lydian from c4, the piano's thirteen degrees
// there, every mode's degrees from every key and every octave, the root
// where its key and octave put it and every seven degrees an octave on,
// three scales by hand, and that a setting changed is in the next note
// asked for. exits 1 on failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}

// --- the script --------------------------------------------------------------
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'scale.js'), 'utf8'), ctx, { filename: 'js/scale.js' });
const Scale = vm.runInContext('Scale', ctx);

// --- the modes, the keys and the octaves -----------------------------------------
const STEPS = [
  ['ionian', '0,2,4,5,7,9,11'], ['dorian', '0,2,3,5,7,9,10'], ['phrygian', '0,1,3,5,7,8,10'], ['lydian', '0,2,4,6,7,9,11'],
  ['mixolydian', '0,2,4,5,7,9,10'], ['aeolian', '0,2,3,5,7,8,10'], ['locrian', '0,1,3,5,6,8,10'],
];
check('the seven modes in order, each its seven steps over the root',
  Scale.MODES.length === 7 && STEPS.every(([name, steps], i) => Scale.MODES[i].name === name && Scale.MODES[i].steps.join() === steps));
check('twelve keys up from c, five octaves', Scale.KEYS.join() === 'C,C#,D,D#,E,F,F#,G,G#,A,A#,B' && Scale.OCTAVES.join() === '1,2,3,4,5');

// --- the scale it starts in ------------------------------------------------------
// the first n degrees' notes in the scale as it is set
const notes = (n) => Array.from({ length: n }, (_, d) => Scale.midi(d)).join();
check('set to c lydian from c4 at first', Scale.MODES[Scale.mode].name === 'lydian' && Scale.KEYS[Scale.key] === 'C' && Scale.OCTAVES[Scale.octave] === 4,
  Scale.MODES[Scale.mode].name + ' ' + Scale.KEYS[Scale.key] + Scale.OCTAVES[Scale.octave]);
check('thirteen degrees of it, the piano\'s: c4 .. a5', notes(13) === '60,62,64,66,67,69,71,72,74,76,78,79,81', notes(13));

// --- every scale -----------------------------------------------------------------
const wrong = [];
for (let m = 0; m < 7; m++) {
  for (let k = 0; k < 12; k++) {
    for (let o = 0; o < 5; o++) {
      Scale.mode = m;
      Scale.key = k;
      Scale.octave = o;
      const root = 12 * (o + 2) + k, steps = STEPS[m][1].split(',').map(Number);
      const want = steps.map((x) => root + x).concat(steps.map((x) => root + 12 + x)).join();
      if (notes(14) !== want) wrong.push(STEPS[m][0] + ' ' + Scale.KEYS[k] + (o + 1) + ': ' + notes(14));
    }
  }
}
check('every mode\'s degrees from every key and octave: the root at 12 * (octave + 1) + key, and every seven degrees an octave on', wrong.length === 0, wrong.slice(0, 3).join('; '));
const at = (m, k, o) => { Scale.mode = m; Scale.key = k; Scale.octave = o; return notes(8); };
check('a1 aeolian, d#4 lydian and b5 locrian, by hand',
  at(5, 9, 0) === '33,35,36,38,40,41,43,45' && at(3, 3, 3) === '63,65,67,69,70,72,74,75' && at(6, 11, 4) === '83,84,86,88,89,91,93,95');

// --- a setting changed -----------------------------------------------------------
at(3, 0, 3);
const was = Scale.midi(3);
Scale.mode = 0;
const mode = Scale.midi(3);
Scale.key = 2;
const key = Scale.midi(3);
Scale.octave = 1;
check('a mode, a key and an octave changed are each in the next note asked for', was === 66 && mode === 65 && key === 67 && Scale.midi(3) === 43,
  [was, mode, key, Scale.midi(3)].join(' '));
let lo = Infinity, hi = 0;
for (let m = 0; m < 7; m++) for (let k = 0; k < 12; k++) for (let o = 0; o < 5; o++) {
  Scale.mode = m; Scale.key = k; Scale.octave = o;
  lo = Math.min(lo, Scale.midi(0));
  hi = Math.max(hi, Scale.midi(12));
}
check('the piano\'s thirteen degrees in every scale are midi notes on a piano\'s keys, a0 to c8', lo >= 21 && hi <= 108, lo + ' .. ' + hi);

console.log(failures ? failures + ' failed' : 'all passed');
process.exit(failures ? 1 : 0);
