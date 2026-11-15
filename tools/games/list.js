// node tools/games/list.js [--fetch]
//
// the famous games js/games.js holds for the chess set, in menu order:
// each its name as the menu shows it, the zip its score comes from and
// the pgn header values that pick it out of that zip's games. with
// --fetch, each zip is downloaded again, the one game whose headers
// match is picked out of it, failing when none or several do, and that
// game's pgn, headers and movetext as the source has them, is written to
// tools/games/pgn, named for the game with dashes for its spaces. then,
// with --fetch or without, each game's pgn there is read, its movetext
// stripped to its moves (comments, variations, $ marks, move numbers and
// the result dropped) and every move played from the start through
// js/rules.js's san, failing on one that is not a legal move or that
// promotes to anything but a queen, which is all the set can crown.
// writes js/games.js, each game's name, result and moves as its source
// wrote them, and prints a line a game: its name, plies, result and
// whether it ends in checkmate, stalemate or neither. exits 1 on failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', '..');
const PGN = path.join(__dirname, 'pgn');
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'rules.js'), 'utf8'), ctx, { filename: 'js/rules.js' });
const Rules = vm.runInContext('Rules', ctx);

const PLAYERS = 'https://www.pgnmentor.com/players/';
const GAMES = [
  { name: 'the opera game', url: PLAYERS + 'Morphy.zip',
    match: { White: 'Morphy, Paul ', Black: 'Duke Karl Count Isouard', Date: '1858.??.??' } },
  { name: 'the immortal game', url: PLAYERS + 'Anderssen.zip',
    match: { White: 'Anderssen, Adolf', Black: 'Kieseritzky, Lionel', Date: '1851.??.??', Event: 'London \'Immortal game\'' } },
  { name: 'the evergreen game', url: PLAYERS + 'Anderssen.zip',
    match: { White: 'Anderssen, Adolf', Black: 'Dufresne, Jean', Date: '1852.??.??', Event: 'Berlin \'Evergreen\'' } },
  { name: 'the game of the century', url: PLAYERS + 'Fischer.zip',
    match: { White: 'Byrne, Donald', Black: 'Fischer, Robert James', Date: '1956.??.??' } },
  { name: 'fischer spassky 1972', url: PLAYERS + 'Fischer.zip',
    match: { White: 'Fischer, Robert James', Black: 'Spassky, Boris V', Date: '1972.??.??', Round: '6' } },
  { name: 'kasparov topalov 1999', url: PLAYERS + 'Kasparov.zip',
    match: { White: 'Kasparov, Gary', Black: 'Topalov, Veselin', Date: '1999.01.20' } },
  { name: 'deep blue kasparov 1997', url: PLAYERS + 'Kasparov.zip',
    match: { White: 'Comp Deep Blue', Black: 'Kasparov, Gary', Date: '1997.??.??', Round: '6' } },
  { name: 'rotlewi rubinstein 1907', url: PLAYERS + 'Rubinstein.zip',
    match: { White: 'Rotlewi, Georg A', Black: 'Rubinstein, Akiba', Date: '1907.??.??', Event: 'Lodz1' } },
];
const RESULTS = ['1-0', '0-1', '1/2-1/2'];

function fail(text) {
  console.error('FAIL ' + text);
  process.exit(1);
}

const file = (g) => path.join(PGN, g.name.replace(/ /g, '-') + '.pgn');

// the files a zip holds, by name, read from its central directory, each
// stored or deflated
function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1')), files = {};
  if (end < 0) fail('no zip\'s end found');
  for (let i = 0, at = buf.readUInt32LE(end + 16); i < buf.readUInt16LE(end + 10); i++) {
    const method = buf.readUInt16LE(at + 10), size = buf.readUInt32LE(at + 20), n = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42), name = buf.toString('latin1', at + 46, at + 46 + n);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (method !== 0 && method !== 8) fail(name + ' is packed by method ' + method);
    files[name] = method === 8 ? zlib.inflateRawSync(data) : data;
    at += 46 + n + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return files;
}

// a pgn file's games, each { text, headers }, its lines ending in \n
function games(text) {
  return text.replace(/\r\n?/g, '\n').split(/\n\s*\n(?=\[)/).map((t) => {
    const headers = {};
    for (const h of t.matchAll(/^\[(\w+) "(.*)"\]$/gm)) headers[h[1]] = h[2];
    return { text: t.trim() + '\n', headers };
  });
}

// each game's zip downloaded, the one game matching its headers picked
// out of its pgn files and written to tools/games/pgn
async function fetchAll() {
  const zips = {};
  for (const g of GAMES) {
    if (!zips[g.url]) {
      const res = await fetch(g.url, { headers: { 'user-agent': 'curl' } });
      if (!res.ok) fail(g.url + ' answers ' + res.status);
      const files = unzip(Buffer.from(await res.arrayBuffer()));
      zips[g.url] = Object.keys(files).filter((n) => /\.pgn$/i.test(n)).flatMap((n) => games(files[n].toString('latin1')));
    }
    const hits = zips[g.url].filter((x) => Object.keys(g.match).every((k) => x.headers[k] === g.match[k]));
    if (hits.length !== 1) fail(g.name + ': ' + hits.length + ' games in ' + g.url + ' match ' + JSON.stringify(g.match));
    fs.mkdirSync(PGN, { recursive: true });
    fs.writeFileSync(file(g), hits[0].text);
  }
}

// each game read from tools/games/pgn and played through, js/games.js
// written, and a line printed a game
function build() {
  const out = [];
  for (const g of GAMES) {
    if (!fs.existsSync(file(g))) fail(g.name + ': no ' + path.relative(ROOT, file(g)) + ', run with --fetch');
    const pgn = fs.readFileSync(file(g), 'utf8').replace(/\r\n?/g, '\n');
    const result = (/^\[Result "(.*)"\]$/m.exec(pgn) || [])[1];
    if (!RESULTS.includes(result)) fail(g.name + ': its result is ' + result);
    let text = pgn.replace(/^\[.*\]$/gm, ' ').replace(/\{[^}]*\}/g, ' ');
    while (/\([^()]*\)/.test(text)) text = text.replace(/\([^()]*\)/g, ' ');
    const moves = text.replace(/\$\d+/g, ' ').replace(/\d+\.+/g, ' ').split(/\s+/).filter((t) => t && !RESULTS.includes(t) && t !== '*');
    let pos = Rules.start();
    for (let i = 0; i < moves.length; i++) {
      const m = Rules.san(pos, moves[i]), at = 'move ' + ((i >> 1) + 1) + (i % 2 ? '...' : '.') + ' ' + moves[i];
      if (!m) fail(g.name + ': ' + at + ' is not a legal move');
      if (m.promote && m.promote !== Rules.QUEEN) fail(g.name + ': ' + at + ' promotes to something other than a queen');
      pos = Rules.play(pos, m);
    }
    const end = Rules.moves(pos).length ? 'neither mate nor stalemate' : Rules.check(pos) ? 'checkmate' : 'stalemate';
    console.log(g.name + ': ' + moves.length + ' plies, ' + result + ', ' + end);
    out.push({ name: g.name, result, moves: moves.join(' ') });
  }
  fs.writeFileSync(path.join(ROOT, 'js', 'games.js'),
    '// the famous games for the chess set, in menu order, written by\n' +
    '// tools/games/list.js (node tools/games/list.js): edit there, not here.\n' +
    '// each is its name as the menu shows it, its result as pgn writes it,\n' +
    '// 1-0, 0-1 or 1/2-1/2, and its moves from the start in standard\n' +
    '// algebraic notation, as its source wrote them, one space apart.\n' +
    'const GAMES = ' + JSON.stringify(out, null, 2) + ';\n');
}

(process.argv.includes('--fetch') ? fetchAll() : Promise.resolve()).then(build);
