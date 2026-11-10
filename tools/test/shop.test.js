// node tools/test/shop.test.js
//
// loads js/softbody.js and js/shop.js the way the page does, classic
// scripts sharing one global scope, in a vm context. checks a bubble pays
// by its size, 1 for the smallest the world spawns to 3 for the largest
// and on past it; the prices, drag strength's 1 rising 12 % a level,
// hands' 5 rising 30 %, spawn rate's 2 rising 15 %, max bubbles' 3 rising
// 50 % and bubble value's 3 rising 20 %, not whole numbers, and randomize
// voice a flat 5; that a level is bought only with
// bubbles enough, a hair short through float sums included, and costs its
// price; that drag strength pulls a tenth more a level, spawn rate
// spawns a tenth more often and bubble value pays 15 % more, all
// compounding, and max bubbles holds one more a level; and that nothing
// has a ceiling. exits 1 on failure.

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
for (const file of ['js/softbody.js', 'js/shop.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
}
const { Shop, SHOP, SOFT } = vm.runInContext('({ Shop, SHOP, SOFT })', ctx);
const near = (a, b) => Math.abs(a - b) < 1e-9;

// --- what a bubble pays ----------------------------------------------------------
{
  const S = SOFT.SPAWN, mid = (S.MIN_RADIUS + S.MAX_RADIUS) / 2;
  check('the smallest a world spawns pays 1, the largest 3, half way 2',
    near(Shop.reward(S.MIN_RADIUS), 1) && near(Shop.reward(S.MAX_RADIUS), 3) && near(Shop.reward(mid), 2),
    [S.MIN_RADIUS, mid, S.MAX_RADIUS].map((r) => 'r' + r + ' ' + Shop.reward(r)).join(', '));
  check('one grown past the largest pays past 3, in step', near(Shop.reward(S.MAX_RADIUS + (S.MAX_RADIUS - S.MIN_RADIUS) / 2), 4));
  check('never under 1', Shop.reward(1) === 1);
}

// prices: each level bought in turn, given just enough
const prices = (key, n) => {
  const s = new Shop(), out = [];
  for (let i = 0; i < n; i++) { const p = s.price(key); out.push(p); s.earn(p); s.buy(key); }
  return out;
};
const drag = prices('drag', 10), hands = prices('hands', 6);
check('drag strength: 1, then up 12 % a level, not rounded', drag.every((p, n) => near(p, Math.pow(1.12, n))), drag.map((p) => p.toFixed(2)).join(' '));
check('hands: 5, then up 30 % a level', hands.every((p, n) => near(p, 5 * Math.pow(1.3, n))), hands.map((p) => p.toFixed(2)).join(' '));
const spawn = prices('spawn', 6), max = prices('max', 6);
check('spawn rate: 2, then up 15 % a level', spawn.every((p, n) => near(p, 2 * Math.pow(1.15, n))), spawn.map((p) => p.toFixed(2)).join(' '));
check('max bubbles: 3, then up 50 % a level', max.every((p, n) => near(p, 3 * Math.pow(1.5, n))), max.map((p) => p.toFixed(2)).join(' '));
const value = prices('value', 6);
check('bubble value: 3, then up 20 % a level', value.every((p, n) => near(p, 3 * Math.pow(1.2, n))), value.map((p) => p.toFixed(2)).join(' '));
const voice = prices('voice', 6);
check('randomize voice: a flat 5, every time', voice.join() === '5,5,5,5,5,5', voice.join());

{
  const s = new Shop();
  check('new: no bubbles, nothing bought', s.bubbles === 0 && s.levels.drag === 0 && s.levels.hands === 0 && s.levels.spawn === 0 && s.levels.max === 0);
  s.earn(0.5);
  check('short of the price, nothing is bought', !s.can('drag') && s.buy('drag') === false && s.bubbles === 0.5 && s.levels.drag === 0);
  s.earn(0.5);
  check('bubbles earned by the fraction', s.bubbles === 1);
  check('with enough, a level is bought and paid for', s.can('drag') && s.buy('drag') === true && s.bubbles === 0 && s.levels.drag === 1);
  check('and the next costs more', near(s.price('drag'), 1.12));
  s.earn(0.1); s.earn(0.2); s.earn(0.82 - 1e-12);
  check('a hair short through float sums still buys, and never leaves less than nothing', s.buy('drag') && s.bubbles >= 0 && s.bubbles < 1e-9, s.bubbles);
  s.earn(100);
  check('hands are bought apart from drag strength', s.buy('hands') && s.levels.hands === 1 && s.levels.drag === 2 && near(s.bubbles, 95) && near(s.price('hands'), 6.5));
}

{
  const s = new Shop();
  const pull = [];
  for (let i = 0; i <= 3; i++) { pull.push(s.drag()); s.levels.drag++; }
  check('drag strength pulls a tenth more a level, compounding', pull.every((p, i) => Math.abs(p - Math.pow(1.1, i)) < 1e-12), pull.map((p) => p.toFixed(3)).join(' '));
  const t = new Shop(), often = [], more = [];
  for (let i = 0; i <= 3; i++) { often.push(t.spawn()); more.push(t.more()); t.levels.spawn++; t.levels.max++; }
  check('spawn rate spawns a tenth more often a level, compounding', often.every((p, i) => near(p, Math.pow(1.1, i))), often.map((p) => p.toFixed(3)).join(' '));
  check('max bubbles holds one more a level', more.join() === '0,1,2,3', more.join());
  const u = new Shop(), pays = [];
  for (let i = 0; i <= 3; i++) { pays.push(u.value()); u.levels.value++; }
  check('bubble value pays 15 % more a level, compounding', pays.every((p, i) => near(p, Math.pow(1.15, i))), pays.map((p) => p.toFixed(3)).join(' '));
  s.levels.drag = 60;
  s.levels.hands = 40;
  check('no ceiling: level 60 pulls 1.1^60 and costs what it should', Math.abs(s.drag() - Math.pow(1.1, 60)) < 1e-6 && near(s.price('drag'), Math.pow(1.12, 60)), s.drag().toFixed(1) + 'x for ' + s.price('drag').toFixed(2));
  s.earn(s.price('hands'));
  check('no ceiling: the 41st hand is bought like the first', s.buy('hands') && s.levels.hands === 41);
}

check('the new rates are as set', SHOP.SPAWN.PRICE === 2 && SHOP.SPAWN.GROWTH === 1.15 && SHOP.SPAWN.STEP === 1.1 && SHOP.MAX.PRICE === 3 && SHOP.MAX.GROWTH === 1.5 && SHOP.MAX.STEP === 1 && SHOP.VALUE.PRICE === 3 && SHOP.VALUE.GROWTH === 1.2 && SHOP.VALUE.STEP === 1.15 && SHOP.VOICE.PRICE === 5 && SHOP.VOICE.GROWTH === 1);
check('the rates are as set', SHOP.REWARD.LEAST === 1 && SHOP.REWARD.MOST === 3 && SHOP.DRAG.PRICE === 1 && SHOP.DRAG.GROWTH === 1.12 && SHOP.DRAG.STEP === 1.1 && SHOP.HANDS.PRICE === 5 && SHOP.HANDS.GROWTH === 1.3);

console.log(failures ? failures + ' failed' : 'all passed');
process.exit(failures ? 1 : 0);
