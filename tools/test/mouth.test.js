// node tools/test/mouth.test.js
//
// loads js/raster.js, js/face-art.js and js/mouth.js the way the page does,
// classic scripts sharing one global scope, in a vm context. checks the
// drawing makes every one of cicada's mouth frames at its rows and width,
// pixel for pixel, and keeps his buck teeth and cheeks wherever the mouth
// goes; the tongue out over the lower lip; the model's jaw, round to
// spread and tongue; and silence, which is his shut frame exactly. then
// speaks lines of js/voice.js through the real monk_mouth/monk_mouth.wasm
// and runs the mouth on what the glue reads off the voice: it opens on
// the vowels, shuts on a b, and puts the tongue out on an l. prints the
// mouth through "bubble time"; exits 1 on failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const STEP = 1 / 60;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}

class ImageData {
  constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
}
const ctx = vm.createContext({ ImageData, setTimeout });
for (const file of ['js/raster.js', 'js/face-art.js', 'js/mouth.js', 'js/voice.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
}
const { FACE_ART, MOUTH, Mouth, Voice } = vm.runInContext('({ FACE_ART, MOUTH, Mouth, Voice })', ctx);
const FRAMES = FACE_ART.mouf.frames;
const at = (art, x, y) => art[y] && art[y][x] === '#';

// --- the drawing ---------------------------------------------------------------
// cicada's frames, 0 shut .. 9 open, each as the drawing's rows and width
const SHAPES = [[1, 1], [3, 1], [3, 2], [4, 2], [4, 3], [5, 3], [5, 4], [7, 4], [7, 5], [9, 5]];
const exact = SHAPES.map(([rows, width], k) => {
  const art = Mouth.art({ rows, width, up: Math.round((rows - 1) * MOUTH.UPPER), tongue: 0 });
  return art.join('\n') === FRAMES[k].join('\n') ? null : k;
}).filter((k) => k !== null);
check("cicada's ten frames, each made pixel for pixel by its rows and width", exact.length === 0, exact.length ? 'frames ' + exact.join(', ') + ' differ' : '');
check('the drawing is the frames\' size, 40 x 24', Mouth.art({ rows: 1, width: 1, up: 0, tongue: 0 }).every((r) => r.length === 40) && Mouth.art({ rows: 1, width: 1, up: 0, tongue: 0 }).length === 24);

// wherever it goes: the teeth hang from the upper lip either side of the
// middle once it is open, the cheeks sit three clear of its widest point,
// a ( and a ), and it stays inside the bitmap
let teeth = true, cheeks = true, inside = true;
for (let rows = 1; rows <= 13; rows++) for (let width = 1; width <= 7; width++) {
  if (rows === 2) continue;
  const up = Math.round((rows - 1) * MOUTH.UPPER), art = Mouth.art({ rows, width, up, tongue: 0 }), top = MOUTH.Y - up;
  if (rows >= 3 && !(at(art, 17, top + 1) && at(art, 19, top + 1) && !at(art, 18, top + 1))) teeth = false;
  const out = Math.max(width, 2) + 3;
  if (!(at(art, 18 - out, MOUTH.Y) && at(art, 18 + out, MOUTH.Y) && at(art, 18 - out + 1, MOUTH.Y - 1) && at(art, 18 + out - 1, MOUTH.Y - 1))) cheeks = false;
  if (top < 0 || top + rows - 1 >= 24 || 18 - out < 0 || 18 + out >= 40) inside = false;
}
check('open, two buck teeth hang under the upper lip, a pixel either side of the middle', teeth);
check('the cheeks, ( and ), three clear of the mouth whatever its width', cheeks);
check('every shape up to 13 rows and 7 wide stays inside the bitmap', inside);

// the tongue: out over the lower lip, the lip broken where it crosses, a u
// five across, grooved all the way out; half out, no groove
{
  for (const rows of [3, 5]) {
    const shape = { rows, width: rows === 3 ? 2 : 4, up: 1, tongue: 2 }, art = Mouth.art(shape), bottom = MOUTH.Y - 1 + rows - 1;
    const lip = Mouth.art({ ...shape, tongue: 0 }), half = Mouth.art({ ...shape, tongue: 1 });
    check('the tongue out of ' + rows + ' rows: the lower lip broken over it, a u five across, grooved',
      at(lip, 18, bottom) && !at(art, 18, bottom) && !at(art, 17, bottom) && !at(art, 19, bottom) &&
      at(art, 16, bottom + 1) && at(art, 20, bottom + 1) && at(art, 18, bottom + 1) && !at(art, 17, bottom + 1) &&
      [17, 18, 19].every((x) => at(art, x, bottom + 2)) && !at(art, 18, bottom + 3),
      '\n' + art.slice(9, 19).map((r) => '     ' + r.slice(8, 30)).join('\n'));
    check('half out of ' + rows + ' rows: a shallow u, no groove',
      at(half, 16, bottom) && at(half, 20, bottom) && !at(half, 18, bottom) && [17, 18, 19].every((x) => at(half, x, bottom + 1)) && !at(half, 18, bottom + 2));
  }
}

// --- the model -----------------------------------------------------------------
const run = (m, said, n) => { for (let i = 0; i < n; i++) m.update(said, STEP); return m; };
const AA = { voicing: 0.74, hiss: 0, lips: 1, front: 2.2, lipMin: 1.5, l: 0 };
const IY = { voicing: 0.74, hiss: 0, lips: 1, front: 0.6, lipMin: 1.5, l: 0 };
const UW = { voicing: 0.74, hiss: 0, lips: 0.35, front: 1.6, lipMin: 0.5, l: 0 };
const S = { voicing: 0, hiss: 0.8, lips: 1, front: 1.2, lipMin: 1.5, l: 0 };
{
  const m = new Mouth();
  check('new, it is shut and at rest', m.open === 0 && m.wide === MOUTH.WIDE_REST && m.tongue === 0);
  check('silent, it is cicada\'s shut frame', Mouth.art(m.shape()).join('\n') === FRAMES[0].join('\n'));
  run(m, AA, 60);
  check('an AA opens it all the way', m.open > 0.95 && m.shape().rows >= 9, m.open.toFixed(3) + ' ' + JSON.stringify(m.shape()));
  const wideOpen = m.open;
  run(m, { ...AA, lipMin: 0 }, 1);
  const shutFirst = wideOpen - m.open;
  const n = new Mouth();
  run(n, AA, 1);
  check('a lip closure shuts it faster than a vowel opens it', shutFirst > n.open, 'a step shuts ' + shutFirst.toFixed(3) + ', opens ' + n.open.toFixed(3));
  run(m, { ...AA, voicing: 0 }, 60);
  check('voiceless, it shuts', m.shape().rows === 1, JSON.stringify(m.shape()));
  const iy = run(new Mouth(), IY, 60), uw = run(new Mouth(), UW, 60);
  check('an IY spreads, a UW puckers', iy.wide > 0.8 && uw.wide < 0.2, 'IY ' + iy.wide.toFixed(2) + ', UW ' + uw.wide.toFixed(2));
  check('a UW opened goes round: as tall as it is wide', uw.shape().rows >= 2 * uw.shape().width - 1, JSON.stringify(uw.shape()));
  const s = run(new Mouth(), S, 60);
  check('a hiss keeps a slit open, unvoiced', s.open > 0.05 && s.open < 0.3, s.open.toFixed(3));
  const l = new Mouth();
  run(l, { ...AA, front: 1, l: 1 }, 6);
  const out = l.tongue;
  run(l, { ...AA, front: 1, l: 0 }, 3);
  const held = l.tongue;
  run(l, { ...AA, front: 1, l: 0 }, 60);
  check('an l puts the tongue out, held a beat past it, then back in', out > 0.5 && held >= out * 0.9 && l.tongue < 0.01, 'out ' + out.toFixed(2) + ', a beat on ' + held.toFixed(2) + ', after ' + l.tongue.toFixed(3));
  const t = run(new Mouth(), { ...IY, front: 0.6, l: 1 }, 12);
  check('the tongue out opens the mouth round it, the lip either side, even on a shut IY', t.shape().rows >= 4 && t.shape().width >= 5 && t.shape().tongue === 2, JSON.stringify(t.shape()));
  const half = new Mouth(), whole = new Mouth();
  for (let i = 0; i < 30; i++) half.update(AA, STEP / 2);
  run(whole, AA, 15);
  check('near dt-correct: twice the steps of half the time come to about the same', Math.abs(half.open - whole.open) < 0.01 && Math.abs(half.wide - whole.wide) < 0.01,
    'open ' + half.open.toFixed(4) + ' / ' + whole.open.toFixed(4) + ', wide ' + half.wide.toFixed(4) + ' / ' + whole.wide.toFixed(4));
  const g = new Mouth();
  check('a shape is drawn once and kept', g.ink() === g.ink() && g.ink().w === 40 && g.ink().h === 24);
}

// --- the real voice -------------------------------------------------------------
(async () => {
  const { instance } = await WebAssembly.instantiate(fs.readFileSync(path.join(ROOT, 'monk_mouth', 'monk_mouth.wasm')), {});
  const mm = instance.exports;
  if (mm._initialize) mm._initialize();
  const V = Voice.VOICE;
  mm.voice_init(V.sections, 1);
  mm.voice_sections(V.sections); mm.voice_tune(0, V.breathiness); mm.voice_tune(1, V.roughness); mm.voice_tune(2, V.diction);
  mm.voice_tenseness(V.tension); mm.voice_wobble(V.wobble);
  for (let i = 0; i < 345; i++) mm.voice_render();
  const BLOCK = 128 / 44100;
  // a line spoken and the mouth stepped through it at 60 hz on the glue's
  // readings: the readings and each step's mouth
  const speak = (line) => {
    const bytes = new Uint8Array(mm.memory.buffer, mm.voice_text(), 256);
    for (let i = 0; i < line.phones.length; i++) bytes[i] = line.phones.charCodeAt(i);
    bytes[line.phones.length] = 0;
    mm.voice_speak(line.midi, line.range, line.speed, line.breath);
    const m = new Mouth(), steps = [];
    let t = 0, next = 0, said = null;
    do {
      mm.voice_render();
      t += BLOCK;
      const v = new Float32Array(mm.memory.buffer, mm.voice_mouth(), 6);
      said = { voicing: v[0], hiss: v[1], lips: v[2], front: v[3], lipMin: v[4], l: v[5] };
      while (next <= t) {
        m.update(said, STEP);
        steps.push({ t: next, said, open: m.open, wide: m.wide, tongue: m.tongue, shape: m.shape() });
        next += STEP;
      }
    } while (mm.voice_busy() && t < 8);
    for (let i = 0; i < 60; i++) { m.update(null, STEP); }
    return { steps, after: m };
  };
  const finite = (x) => typeof x === 'number' && isFinite(x);
  let readable = true;
  for (const line of [...Voice.LINES, ...Voice.THANKS]) {
    const { steps, after } = speak(line);
    const opened = Math.max(...steps.map((s) => s.shape.rows));
    if (!steps.every((s) => ['voicing', 'hiss', 'lips', 'front', 'lipMin', 'l'].every((k) => finite(s.said[k])))) readable = false;
    check(line.text.replace(/\|/g, '') + ': opens as he speaks, shut again after', opened >= 3 && Mouth.art(after.shape()).join('\n') === FRAMES[0].join('\n'), 'opens to ' + opened + ' rows');
  }
  check("the glue's readings are six numbers every block", readable);

  // bubble time: open on the u, shut on the second b, the tongue out on the l
  const bt = Voice.THANKS.find((l) => l.text === 'Bub|ble time'), { steps } = speak(bt);
  const shutMid = steps.findIndex((s, i) => i > 0 && steps.slice(0, i).some((p) => p.shape.rows >= 3) && s.shape.rows === 1);
  const tongueAt = steps.findIndex((s) => s.shape.tongue > 0);
  check('bubble time: shuts for the b inside "bubble", after opening for the u', shutMid > 0, 'at ' + Math.round((steps[shutMid] || { t: 0 }).t * 1000) + ' ms');
  check('bubble time: the tongue comes out on the l', tongueAt > shutMid, 'at ' + Math.round((steps[tongueAt] || { t: 0 }).t * 1000) + ' ms');
  const nice = Voice.THANKS.find((l) => l.text === 'Nice'), n = speak(nice).steps;
  const spread = Math.max(...n.map((s) => s.wide)), puck = speak(Voice.THANKS.find((l) => l.text === 'Thank you')).steps;
  const youWide = Math.min(...puck.filter((s) => s.open > 0.2).map((s) => s.wide));
  check('nice spreads on its i more than thank you puckers on its you', spread > youWide + 0.2, 'nice up to ' + spread.toFixed(2) + ', you down to ' + youWide.toFixed(2));

  console.log('\nbubble time, every 50 ms: the mouth as drawn (rows x width, tongue)');
  let line = '';
  for (const s of steps) {
    if (Math.round(s.t * 1000) % 50 > 16) continue;
    line += String(Math.round(s.t * 1000)).padStart(5) + ' ' + s.shape.rows + 'x' + (2 * s.shape.width + 1) + (s.shape.tongue ? 't' : ' ');
  }
  console.log(line.match(/.{1,96}/g).join('\n'));

  console.log(failures ? failures + ' failed' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
