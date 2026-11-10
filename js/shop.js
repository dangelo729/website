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
// nothing has a ceiling.

const SHOP = {
  REWARD: { LEAST: 1, MOST: 3 },
  DRAG: { PRICE: 1, GROWTH: 1.12, STEP: 1.1 },
  HANDS: { PRICE: 5, GROWTH: 1.3 },
  SPAWN: { PRICE: 2, GROWTH: 1.15, STEP: 1.1 },
  MAX: { PRICE: 3, GROWTH: 1.5, STEP: 1 },
  VALUE: { PRICE: 3, GROWTH: 1.2, STEP: 1.15 },
  VOICE: { PRICE: 5, GROWTH: 1 },
  SLACK: 1e-9, // what the float sums may fall short of a price by and still buy it
};

class Shop {
  constructor() {
    this.bubbles = 0;                    // to spend
    this.levels = { drag: 0, hands: 0, spawn: 0, max: 0, value: 0, voice: 0 }; // bought of each
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

  earn(n = 1) {
    this.bubbles += n;
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
