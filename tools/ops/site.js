// --- the site's own ------------------------------------------------------------------
// what ops's worker (ops.js, handed it by worker.js) takes of
// dangelo.engineering: the domain its me cookie is for, how each of its
// sites starts, its tally's me cookie and zone, and what its /stats reads
// and answers past every site's numbers (stats.js): each day's time on the
// site, from stays, and what the page's sections and things are counted
// as. the answer's own, json, after actives:
//
//   {
//     ...
//     days: [                       // each day's counts with, where its stays are any,
//       { day: 'yyyy-mm-dd', counts: { ..., timed: 28, median: 95 } },
//       ...                         // timed, the visitors whose time on the site that day is
//     ],                            // known, and median, the middle one's s; neither with none
//     median: n,                    // the middle s of every visitor's every day in the window, 0 with none
//     names: { sections: [...], work: [...], doodles: [...] }, // what the page's sections and
//                                   // the things in them are counted as
//   }

import { TALLY, ZONE, SECTIONS, WORK, DOODLES, dayOf } from '../server/tally.js';

export const SITE = {
  DOMAIN: 'dangelo.engineering',      // the me cookie's: every site under it
  ME: TALLY.ME,                       // the me cookie's name, as the tally reads it
  STARTS: { main: false, dev: true }, // whether each is locked with no row yet, as its worker starts (OPEN, wrangler.toml)
  ZONE, dayOf,                        // the zone the tally cuts its days in, and the day an ms is in there
  reads, adds,                        // what /stats reads past every site's numbers, and answers of it
};

// what /stats reads past every site's numbers, for the window's days,
// oldest first: the stays of each
function reads(db, span) {
  return [db.prepare('SELECT day, seconds FROM stays WHERE day BETWEEN ? AND ?').bind(span[0], span[span.length - 1])];
}

// what those read (got) make the answer's own: each day's timed and
// median, added to its counts (counts, by day), the window's median, and
// the names
function adds(got, counts, span) {
  const stays = Object.fromEntries(span.map((d) => [d, []])), all = [];
  for (const r of got[0].results) {
    stays[r.day].push(r.seconds);
    all.push(r.seconds);
  }
  for (const d of span) if (stays[d].length) Object.assign(counts[d], { timed: stays[d].length, median: median(stays[d]) });
  return { median: median(all), names: { sections: SECTIONS, work: WORK, doodles: DOODLES } };
}

// the middle of ns, a list of numbers: of an even count, the two in the
// middle's mean, rounded; 0 with none
export function median(ns) {
  if (!ns.length) return 0;
  const s = ns.slice().sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
