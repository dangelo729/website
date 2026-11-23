// node tools/giant/art.js [cicada]
//
// takes cicada's giant and the hand under his bar for the page from
// cicada's own bitmaps, in a checkout of cicada (the sibling ../cicada of
// the repo's root unless another is given): FACE, his face, frame by
// frame, and HAND, the hand, each a header of arrays of bytes and a table
// at its bottom naming them in the order cicada draws them. each frame is
// a bit a pixel, ink 1, the first pixel of a byte its top bit, each row a
// whole number of bytes, and is kept as it is, as a hex string. writes
// js/giant-art.js: each set's frames' size, cicada px, and its frames in
// its table's order. prints what it wrote. exits 1 on failure.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

// each set: its header in cicada, its table's name there, and its frames'
// size, cicada px, and how many it has
const SETS = {
  face: { file: 'src/assets/giant_bitmap.h', table: 'giant', w: 64, h: 32, count: 23 },
  hand: { file: 'src/assets/giant_hand_bitmap.h', table: 'giant_hand', w: 74, h: 32, count: 54 },
};

function fail(why) {
  console.error(why);
  process.exit(1);
}

const cicada = path.resolve(process.argv[2] || path.join(ROOT, '..', 'cicada'));
if (!fs.existsSync(path.join(cicada, SETS.face.file))) fail('usage: node tools/giant/art.js [cicada]  (no ' + SETS.face.file + ' in ' + cicada + ')');

// a set's frames in its table's order, each its bytes as hex
function frames(set) {
  const src = fs.readFileSync(path.join(cicada, set.file), 'utf8');
  const arrays = {};
  for (const m of src.matchAll(/const\s+unsigned\s+char\s+(\w+)\s*\[\s*\]\s*PROGMEM\s*=\s*\{([^}]*)\}/g)) {
    arrays[m[1]] = (m[2].match(/0x[0-9a-fA-F]{2}/g) || []).map((x) => x.slice(2).toLowerCase()).join('');
  }
  const table = src.match(new RegExp('const\\s+unsigned\\s+char\\s*\\*\\s*' + set.table + '\\s*\\[\\s*\\d+\\s*\\]\\s*=\\s*\\{([^}]*)\\}'));
  if (!table) fail('no table ' + set.table + ' in ' + set.file);
  const names = table[1].match(/\w+/g) || [];
  if (names.length !== set.count) fail(set.table + ' names ' + names.length + ' frames, not ' + set.count);
  const bytes = Math.ceil(set.w / 8) * set.h;
  return names.map((name) => {
    const hex = arrays[name];
    if (hex === undefined) fail(set.table + ' names ' + name + ', which ' + set.file + ' does not hold');
    if (hex.length !== 2 * bytes) fail(name + ' is ' + hex.length / 2 + ' bytes, not ' + bytes);
    return hex;
  });
}

const art = {};
for (const key in SETS) {
  const set = SETS[key];
  art[key] = { w: set.w, h: set.h, frames: frames(set) };
}

const head = [
  '// cicada\'s giant and the hand under his bar (js/giant.js), written by',
  '// tools/giant/art.js (node tools/giant/art.js [cicada]) from cicada\'s own',
  '// bitmaps: drawn there, not here. face is his face and hand the hand,',
  '// each its frames\' size, cicada px, and its frames in the order cicada',
  '// draws them, each a hex string of its bytes: a bit a pixel, ink 1, the',
  '// first pixel of a byte its top bit, each row a whole number of bytes.',
];
const out = path.join(ROOT, 'js', 'giant-art.js');
fs.writeFileSync(out, head.join('\n') + '\nconst GIANT_ART = ' + JSON.stringify(art, null, 2) + ';\n');

for (const key in art) console.log(key + ': ' + art[key].frames.length + ' frames, ' + art[key].w + ' x ' + art[key].h);
console.log('wrote js/giant-art.js, ' + (fs.statSync(out).size / 1024).toFixed(0) + ' kb');
