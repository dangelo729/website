// --- the stats -------------------------------------------------------------------
// GET /stats?site=main|dev&days=7|30|90: a site's numbers for the ops page,
// read from its database (env.MAIN, dangelo.engineering's, or env.DEV,
// dev.dangelo.engineering's), as /api/tally counted them
// (tools/server/tally.js, whose header names the metrics). the window is
// today, in ZONE, and the days before it, days long. a query with anything
// but one site and one window of these is refused, 400; a database that
// fails is 500 with what went wrong, { error }. it reads only daily,
// visitors by its index on last, and stays by its days. the answer, json:
//
//   {
//     site: 'main' | 'dev',
//     zone: 'America/New_York',     // the zone whose days these are
//     today: 'yyyy-mm-dd',          // today in it
//     days: [                       // every day in the window, oldest first, today last
//       { day: 'yyyy-mm-dd', counts: { visits: 41, visitors: 30, new: 12, ..., timed: 28, median: 95 } },
//       ...                         // a day with nothing counted has counts {}
//     ],                            // timed, the visitors whose time on the site that day is
//                                   // known, and median, the middle one's s; neither with none
//     actives: { week: n, month: n }, // visitors last seen since the start of the day 6
//                                     // days before today, and of the day 29 before
//     median: n,                    // the middle s of every visitor's every day in the window, 0 with none
//     names: { sections: [...], work: [...], doodles: [...] }, // what the page's sections and
//                                   // the things in them are counted as
//   }

import { ZONE, SECTIONS, WORK, DOODLES, dayOf } from '../server/tally.js';

export const STATS = {
  SITES: { main: 'MAIN', dev: 'DEV' }, // each site, and its database's binding
  DAYS: ['7', '30', '90'],             // the windows, days long
  WEEK: 7, MONTH: 30,                  // days the actives are counted over, today among them
};

// a request to /stats answered
export async function stats(request, env) {
  const q = new URL(request.url).searchParams, site = q.get('site'), days = q.get('days');
  if ([...q.keys()].sort().join(' ') !== 'days site' || !Object.hasOwn(STATS.SITES, site) || !STATS.DAYS.includes(days)) {
    return Response.json({ error: 'site main or dev, days 7, 30 or 90' }, { status: 400 });
  }
  const db = env[STATS.SITES[site]], today = dayOf(Date.now()), span = [];
  for (let i = Number(days) - 1; i >= 0; i--) span.push(back(today, i));
  let got;
  try {
    got = await db.batch([
      db.prepare('SELECT day, metric, n FROM daily WHERE day BETWEEN ? AND ?').bind(span[0], today),
      db.prepare('SELECT count(*) AS n FROM visitors WHERE last >= ?').bind(startOf(back(today, STATS.WEEK - 1))),
      db.prepare('SELECT count(*) AS n FROM visitors WHERE last >= ?').bind(startOf(back(today, STATS.MONTH - 1))),
      db.prepare('SELECT day, seconds FROM stays WHERE day BETWEEN ? AND ?').bind(span[0], today),
    ]);
  } catch (e) {
    return Response.json({ error: String((e && e.message) || e) }, { status: 500 });
  }
  const counts = Object.fromEntries(span.map((d) => [d, {}])), stays = Object.fromEntries(span.map((d) => [d, []])), all = [];
  for (const r of got[0].results) counts[r.day][r.metric] = r.n;
  for (const r of got[3].results) {
    stays[r.day].push(r.seconds);
    all.push(r.seconds);
  }
  for (const d of span) if (stays[d].length) Object.assign(counts[d], { timed: stays[d].length, median: median(stays[d]) });
  return Response.json({
    site, zone: ZONE, today,
    days: span.map((day) => ({ day, counts: counts[day] })),
    actives: { week: got[1].results[0].n, month: got[2].results[0].n },
    median: median(all),
    names: { sections: SECTIONS, work: WORK, doodles: DOODLES },
  });
}

// the middle of ns, a list of numbers: of an even count, the two in the
// middle's mean, rounded; 0 with none
export function median(ns) {
  if (!ns.length) return 0;
  const s = ns.slice().sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

// the day n days before day, both yyyy-mm-dd
function back(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

// how far ahead of utc ZONE's clock is at ms: the clock there read as if it
// were utc's, less ms
const CLOCK = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
function ahead(ms) {
  const p = Object.fromEntries(CLOCK.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

// ms at the start of day, yyyy-mm-dd, in ZONE: utc's midnight that day, put
// back by how far ahead the zone is there, and again by how far it is at
// that guess, in case the two differ
export function startOf(day) {
  const [y, m, d] = day.split('-').map(Number), utc = Date.UTC(y, m - 1, d);
  return utc - ahead(utc - ahead(utc));
}
