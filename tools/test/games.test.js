// node tools/test/games.test.js
//
// loads js/rules.js and js/games.js the way the page does, classic
// scripts, in a vm context. checks every game has a name, a result as pgn
// writes it and moves, that every move of every game reads in turn as a
// legal move, that no game promotes to anything but a queen, and each
// game's plies, result and ending, checkmate or not, against the scores
// tools/games/list.js fetched. exits 1 on failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}

// --- the scripts -----------------------------------------------------------------
const ctx = vm.createContext({});
for (const f of ['js/rules.js', 'js/games.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
const { Rules, GAMES } = vm.runInContext('({ Rules, GAMES })', ctx);

// --- each game -------------------------------------------------------------------
// in menu order: name, plies, result, and whether it ends in checkmate
const WANT = [
  ['the opera game', 33, '1-0', true],
  ['the immortal game', 45, '1-0', true],
  ['the evergreen game', 47, '1-0', true],
  ['the game of the century', 82, '0-1', true],
  ['fischer spassky 1972', 81, '1-0', false],
  ['kasparov topalov 1999', 87, '1-0', false],
  ['deep blue kasparov 1997', 37, '1-0', false],
  ['rotlewi rubinstein 1907', 50, '0-1', false],
];

check('GAMES is a list of games', Array.isArray(GAMES) && GAMES.length > 0, GAMES && GAMES.length);
const ends = [];
for (const g of GAMES) {
  check((g.name || 'a game') + ': a name, a result and moves, nothing else',
    Object.keys(g).join() === 'name,result,moves' && typeof g.name === 'string' && g.name.length > 0 &&
    ['1-0', '0-1', '1/2-1/2'].includes(g.result) && typeof g.moves === 'string' && /^\S+( \S+)*$/.test(g.moves),
    Object.keys(g).join());
  // every move read in turn: the first that is not a legal move, and any
  // promotion to something other than a queen
  const moves = g.moves.split(' ');
  let pos = Rules.start(), bad = -1, crown = -1;
  for (let i = 0; i < moves.length && bad < 0; i++) {
    const m = Rules.san(pos, moves[i]);
    if (!m) { bad = i; break; }
    if (m.promote && m.promote !== Rules.QUEEN && crown < 0) crown = i;
    pos = Rules.play(pos, m);
  }
  check(g.name + ': every move reads in turn as a legal move', bad < 0, bad >= 0 && 'ply ' + (bad + 1) + ', ' + moves[bad]);
  check(g.name + ': no promotion but to a queen', crown < 0, crown >= 0 && 'ply ' + (crown + 1) + ', ' + moves[crown]);
  ends.push({ plies: moves.length, mate: bad < 0 && Rules.check(pos) && Rules.moves(pos).length === 0 });
}
WANT.forEach(([name, plies, result, mate], i) => {
  const g = GAMES[i] || {}, e = ends[i] || {};
  check(name + ': game ' + (i + 1) + ', ' + plies + ' plies, ' + result + ', ' + (mate ? 'ending in checkmate' : 'not ending in mate'),
    g.name === name && e.plies === plies && g.result === result && e.mate === mate,
    g.name + ', ' + e.plies + ' plies, ' + g.result + ', mate ' + e.mate);
});

console.log(failures ? failures + ' failed' : 'all passed');
process.exit(failures ? 1 : 0);
