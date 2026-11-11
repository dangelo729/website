// --- the shop ------------------------------------------------------------------
// what the bubbles in Personal work's box buy (index.html): every bubble the
// bubble eats pays by its size, LEAST for the smallest its world spawns
// (js/softbody.js's SPAWN) to MOST for the largest, in step with its
// radius, and on past MOST for one grown bigger by eating others. drag
// strength makes the bubble's world pull a held skin STEP times as hard a
// level, compounding, for PRICE times GROWTH to the level, so each level
// costs a little more for the same tenth more pull. hands buys one of
// cicada's hands (js/hands.js) a level, spawn rate makes the world spawn
// STEP times as often a level, compounding, max bubbles lets it hold STEP
// more at once, and bubble value makes every bubble pay STEP times as
// much a level, compounding, each for its PRICE times its GROWTH to the
// level. randomize voice draws the bubble a new voice (js/voice.js), for
// a flat PRICE every time, its GROWTH 1. none of it is whole numbers, and
// nothing has a ceiling. the rate is the bubbles earned over the last
// RATE_MS, a second, and every figure shown is to two places, or from
// FIGURES on in scientific notation.

const SHOP = {
  REWARD: { LEAST: 1, MOST: 3 },
  DRAG: { PRICE: 1, GROWTH: 1.12, STEP: 1.1 },
  HANDS: { PRICE: 5, GROWTH: 1.3 },
  SPAWN: { PRICE: 2, GROWTH: 1.15, STEP: 1.1 },
  MAX: { PRICE: 3, GROWTH: 1.5, STEP: 1 },
  VALUE: { PRICE: 3, GROWTH: 1.2, STEP: 1.15 },
  VOICE: { PRICE: 5, GROWTH: 1 },
  SLACK: 1e-9, // what the float sums may fall short of a price by and still buy it
  RATE_MS: 10000, // the rate's window
  FIGURES: 1e4,   // a figure this big or bigger is shown as 1.23e4
};

class Shop {
  constructor() {
    this.bubbles = 0;                    // to spend
    this.levels = { drag: 0, hands: 0, spawn: 0, max: 0, value: 0, voice: 0 }; // bought of each
    this.earned = [];                    // each { ms, n } earned, oldest first, until it is out of the rate's window
  }

  // the next level of key: 'drag', 'hands', 'spawn', 'max', 'value' or 'voice'
  price(key) {
    const S = SHOP[key.toUpperCase()];
    return S.PRICE * Math.pow(S.GROWTH, this.levels[key]);
  }

  can(key) {
    return this.bubbles >= this.price(key) - SHOP.SLACK;
  }

  // the next level of key, if there are bubbles enough: true if bought
  buy(key) {
    if (!this.can(key)) return false;
    this.bubbles = Math.max(0, this.bubbles - this.price(key));
    this.levels[key]++;
    return true;
  }

  // n bubbles, earned at ms
  earn(n = 1, ms = 0) {
    this.bubbles += n;
    this.earned.push({ ms, n });
  }

  // bubbles a second: what was earned in the RATE_MS up to ms, over it
  rate(ms) {
    const e = this.earned;
    let old = 0;
    while (old < e.length && e[old].ms <= ms - SHOP.RATE_MS) old++;
    if (old) e.splice(0, old);
    let sum = 0;
    for (let i = 0; i < e.length; i++) sum += e[i].n;
    return sum / (SHOP.RATE_MS / 1000);
  }

  // n to two places, or from FIGURES on in scientific notation: 12345 is 1.23e4
  static figure(n) {
    return n < SHOP.FIGURES ? n.toFixed(2) : n.toExponential(2).replace('+', '');
  }

  // what a bubble of this radius pays when it is eaten
  static reward(radius) {
    const R = SHOP.REWARD, S = SOFT.SPAWN;
    return Math.max(R.LEAST, R.LEAST + (R.MOST - R.LEAST) * (radius - S.MIN_RADIUS) / (S.MAX_RADIUS - S.MIN_RADIUS));
  }

  // how many times cicada's pull a held skin has now
  drag() {
    return Math.pow(SHOP.DRAG.STEP, this.levels.drag);
  }

  // how many times as often the world spawns now
  spawn() {
    return Math.pow(SHOP.SPAWN.STEP, this.levels.spawn);
  }

  // how many more blobs the world may hold now
  more() {
    return SHOP.MAX.STEP * this.levels.max;
  }

  // how many times as much a bubble pays now
  value() {
    return Math.pow(SHOP.VALUE.STEP, this.levels.value);
  }
}
