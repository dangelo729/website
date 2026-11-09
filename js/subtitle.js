// --- subtitles ---------------------------------------------------------------
// what the bubble says, as words beside him (index.html). a line's text
// (js/voice.js) is split into syllables by the spaces between its words
// and a | inside one ('talk|ing a|bout'), one for each vowel of its
// phones, and shows one more syllable each time the voice begins one. the
// line goes somewhere round him at random, clear of him, inside an area
// and off anything it should not cover.

const Subtitle = {
  TRIES: 32, // angles tried round him before there is nowhere to put it

  // the text as shown, the |s gone, and where each syllable ends in it: the
  // first k syllables are whole.slice(0, ends[k - 1])
  split(text) {
    let whole = '';
    const ends = [];
    for (const word of text.trim().split(/\s+/)) {
      if (whole) whole += ' ';
      for (const syl of word.split('|')) {
        whole += syl;
        ends.push(whole.length);
      }
    }
    return { whole, ends };
  },

  // where a w by h box goes round a circle of radius r about (cx, cy): its
  // top left { x, y }. its middle goes out from the circle's along an angle
  // at random, whole px at a time, until no point of it is within r; it is
  // taken if it lies inside area { x0, y0, x1, y1 } and off every box of
  // keep (each { x0, y0, x1, y1 }), else another angle is tried. null if
  // none of TRIES is
  place(w, h, cx, cy, r, area, keep, random = Math.random) {
    const hw = w / 2, hh = h / 2;
    for (let n = 0; n < this.TRIES; n++) {
      const a = 2 * Math.PI * random(), ux = Math.cos(a), uy = Math.sin(a);
      let d = 0, bx = cx, by = cy;
      for (;;) {
        bx = cx + d * ux;
        by = cy + d * uy;
        const gx = Math.max(Math.abs(bx - cx) - hw, 0), gy = Math.max(Math.abs(by - cy) - hh, 0);
        if (gx * gx + gy * gy >= r * r) break;
        d++;
      }
      const x0 = bx - hw, y0 = by - hh, x1 = bx + hw, y1 = by + hh;
      if (x0 < area.x0 || y0 < area.y0 || x1 > area.x1 || y1 > area.y1) continue;
      if (keep.some((k) => x0 < k.x1 && x1 > k.x0 && y0 < k.y1 && y1 > k.y0)) continue;
      return { x: x0, y: y0 };
    }
    return null;
  },
};
