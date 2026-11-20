// --- the stats -------------------------------------------------------------------
// GET /stats?site=main|dev&days=7|30|90: a site's numbers for the ops page,
// read from its database (env.MAIN, the live site's, or env.DEV, dev's), as
// /api/tally counted them (tools/server/tally.js, whose header names the
// metrics). the window is today, in the tally's zone, and the days before
// it, days long. a query with anything but one site and one window of
// these is refused, 400; a database that fails is 500 with what went
// wrong, { error }. it reads daily, and visitors by its index on last, and
// whatever the site's own reads past those (reads, site.js). the answer,
// json:
//
//   {
//     site: 'main' | 'dev',
//     zone: 'America/New_York',     // the zone whose days these are
//     today: 'yyyy-mm-dd',          // today in it
//     days: [                       // every day in the window, oldest first, today last
//       { day: 'yyyy-mm-dd', counts: { visits: 41, visitors: 30, new: 12, ... } },
//       ...                         // a day with nothing counted has counts {}
//     ],
//     actives: { week: n, month: n }, // visitors last seen since the start of the day 6
//                                     // days before today, and of the day 29 before
//     ...                           // and the site's own past these (adds, site.js)
//   }

export const STATS = {
  SITES: { main: 'MAIN', dev: 'DEV' }, // each site, and its database's binding
  DAYS: ['7', '30', '90'],             // the windows, days long
  WEEK: 7, MONTH: 30,                  // days the actives are counted over, today among them
};

// a request to /stats answered, the site's own (own) as its site.js says
// it: ZONE and dayOf, the tally's zone and the day an ms is in it there;
// reads(db, span), the statements it reads past every site's for the
// window's days, oldest first; and adds(got, counts, span), what those
// read made the answer's own past actives, given each day's counts by day
// to add to
export async function stats(request, env, own) {
  const q = new URL(request.url).searchParams, site = q.get('site'), days = q.get('days');
  if ([...q.keys()].sort().join(' ') !== 'days site' || !Object.hasOwn(STATS.SITES, site) || !STATS.DAYS.includes(days)) {
    return Response.json({ error: 'site main or dev, days 7, 30 or 90' }, { status: 400 });
  }
  const db = env[STATS.SITES[site]], today = own.dayOf(Date.now()), span = [];
  for (let i = Number(days) - 1; i >= 0; i--) span.push(back(today, i));
  let got;
  try {
    got = await db.batch([
      db.prepare('SELECT day, metric, n FROM daily WHERE day BETWEEN ? AND ?').bind(span[0], today),
      db.prepare('SELECT count(*) AS n FROM visitors WHERE last >= ?').bind(startOf(back(today, STATS.WEEK - 1), own.ZONE)),
      db.prepare('SELECT count(*) AS n FROM visitors WHERE last >= ?').bind(startOf(back(today, STATS.MONTH - 1), own.ZONE)),
      ...own.reads(db, span),
    ]);
  } catch (e) {
    return Response.json({ error: String((e && e.message) || e) }, { status: 500 });
  }
  const counts = Object.fromEntries(span.map((d) => [d, {}]));
  for (const r of got[0].results) counts[r.day][r.metric] = r.n;
  const more = own.adds(got.slice(3), counts, span);
  return Response.json(Object.assign({
    site, zone: own.ZONE, today,
    days: span.map((day) => ({ day, counts: counts[day] })),
    actives: { week: got[1].results[0].n, month: got[2].results[0].n },
  }, more));
}

// the day n days before day, both yyyy-mm-dd
function back(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

// how far ahead of utc a zone's clock is at ms, read by clock, that zone's
// formatter: the clock there read as if it were utc's, less ms
function ahead(ms, clock) {
  const p = Object.fromEntries(clock.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

// ms at the start of day, yyyy-mm-dd, in zone: utc's midnight that day, put
// back by how far ahead the zone is there, and again by how far it is at
// that guess, in case the two differ
export function startOf(day, zone) {
  const clock = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const [y, m, d] = day.split('-').map(Number), utc = Date.UTC(y, m - 1, d);
  return utc - ahead(utc - ahead(utc, clock), clock);
}
