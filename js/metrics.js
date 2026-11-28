// --- metrics -----------------------------------------------------------------
// this site's metrics as ops's page (tools/ops/ops.html) shows them: the
// submenus of its metrics menu (SUBS), and what each of this site's own
// holds of the numbers /stats answers (tools/ops/stats.js and
// tools/ops/site.js), a daily graph or rows, as the page's specOf has
// them (of). visitors, visits and where are the page's own. this site's:
// time, a visitor's time on the site a day; sections, how often each
// section was opened; work, how often each of work's things was opened,
// how long it stayed open and its links pressed; doodles, each one
// opened and played with; and about, how often each of about's things
// was opened and each of the page's own links pressed. the page hands
// load what of it they use before any is shown

const Metrics = {
  SUBS: [['visitors', 'visitors'], ['visits', 'visits'], ['time', 'time'], ['sections', 'sections'], ['work', 'work'], ['doodles', 'doodles'], ['about', 'about'], ['where', 'where']], // each submenu, and what its header says
  page: null,    // what of the page they use, as load was handed it
  colours: null, // the doodles' colours, in turn, from the bottom of a bar up

  // what of the page they use: { num, pct, count, WINDOW, HOVER,
  // HOVER_ITEM, HOVER_LINK }, how a count and a share are said, a day's
  // count of a name, what follows a window's length, and the hover colours
  load(page) {
    Metrics.page = page;
    Metrics.colours = [page.HOVER_ITEM, 1, page.HOVER, page.HOVER_LINK];
  },

  // whether the numbers d hold this site's own: the window's median, and
  // what its sections and things are counted as
  shaped(d) {
    return typeof d.median === 'number' && !!d.names && ['sections', 'work', 'doodles'].every((k) => Array.isArray(d.names[k]));
  },

  // s as a length of time: 48 s, 1 m 5 s, 2 h 3 m
  clock(s) {
    s = Math.round(s);
    const m = Math.floor(s / 60) % 60, h = Math.floor(s / 3600);
    return s < 60 ? s + ' s' : s < 3600 ? m + ' m' + (s % 60 ? ' ' + s % 60 + ' s' : '') : h + ' h' + (m ? ' ' + m + ' m' : '');
  },

  // a section's or a thing's name as it is said: a space for each -
  wordOf: (name) => name.replace(/-/g, ' '),

  // what submenu key holds of the numbers d, a daily graph's or rows', as
  // the page's specOf has them: time and doodles a daily graph, sections,
  // work and about rows
  of(key, d) {
    const { num, pct, count, WINDOW } = Metrics.page, clock = Metrics.clock, wordOf = Metrics.wordOf;
    const days = d.days, today = days[days.length - 1].counts, span = days.length + WINDOW;
    const sum = (f) => days.reduce((s, x) => s + f(x.counts), 0);
    // a visitor's time on the site a day: each day's median, and the window's
    if (key === 'time') return {
      parts: (c) => [count(c, 'median')], colours: [1], legend: null, num: clock,
      says: ['today ' + clock(count(today, 'median')) + ' · ' + span + ' ' + clock(d.median), 'a visitor a day · the median'],
      day: (c) => count(c, 'timed') ? clock(count(c, 'median')) + ' · ' + num(count(c, 'timed')) + (count(c, 'timed') === 1 ? ' visitor' : ' visitors') : 'no one timed',
      under: [],
    };
    // the doodles: each one's openings a day, and under them, of each,
    // how often it was opened and played with and how long it stayed open
    if (key === 'doodles') {
      const names = d.names.doodles, opened = (c) => names.map((n) => count(c, 'item:' + n)), total = (c) => opened(c).reduce((s, n) => s + n, 0);
      return {
        parts: opened, colours: names.map((n, i) => Metrics.colours[i % Metrics.colours.length]), legend: names.length > 1 ? names.map(wordOf) : null,
        says: ['today ' + num(total(today)) + ' · ' + span + ' ' + num(sum(total)), 'played with ' + num(sum((c) => names.reduce((s, n) => s + count(c, 'play:' + n), 0)))],
        day: (c) => {
          const o = opened(c);
          return ['opened ' + num(total(c))].concat(names.map((n, i) => o[i] ? wordOf(n) + ' ' + num(o[i]) : '').filter(Boolean)).join(' · ');
        },
        under: names.map((n) => {
          const o = sum((c) => count(c, 'item:' + n));
          return wordOf(n) + ' · opened ' + num(o) + ' · played ' + num(sum((c) => count(c, 'play:' + n))) + ' · ' + clock(o ? sum((c) => count(c, 'spent:' + n)) / o : 0) + ' each';
        }),
      };
    }
    // sections: each section's openings over the window, the most first, a
    // bar right across the most of any's. work: the same of each of work's
    // things, with how long it stayed open an opening and its links pressed
    const sumOf = {};
    for (let i = 0; i < days.length; i++) {
      const c = days[i].counts;
      for (const k in c) sumOf[k] = (sumOf[k] || 0) + c[k];
    }
    const of = (k) => sumOf[k] || 0;
    // about: each of about's things' openings, with how long it stayed
    // open an opening, and each of the page's own links' presses, the
    // most first
    if (key === 'about') {
      const things = d.names.about || [], links = d.names.links || [];
      const rows = things.map((n) => {
        const o = of('item:' + n);
        return { name: wordOf(n), n: o, tells: 'opened ' + num(o) + ' · ' + clock(o ? of('spent:' + n) / o : 0) + ' each' };
      }).concat(links.map((n) => ({ name: wordOf(n), n: of('link:' + n), tells: 'pressed ' + num(of('link:' + n)) }))).sort((a, b) => b.n - a.n);
      const pressed = (c) => links.reduce((s, n) => s + count(c, 'link:' + n), 0);
      return {
        nothing: false, whole: rows.reduce((m, r) => Math.max(m, r.n), 0), split: null, rows,
        says: ['today ' + num(pressed(today)) + ' · ' + span + ' ' + num(sum(pressed)), 'links pressed · things opened ' + num(things.reduce((s, n) => s + of('item:' + n), 0))],
      };
    }
    const kind = key === 'sections' ? 'section:' : 'item:', names = key === 'sections' ? d.names.sections : d.names.work;
    const all = names.reduce((s, n) => s + of(kind + n), 0), now = names.reduce((s, n) => s + count(today, kind + n), 0);
    const rows = names.map((n) => {
      const o = of(kind + n);
      return { name: wordOf(n), n: o, tells: key === 'sections' ? 'opened ' + num(o) + ' · ' + pct(o, all)
        : 'opened ' + num(o) + ' · ' + clock(o ? of('spent:' + n) / o : 0) + ' each · links ' + num(of('link:' + n)) };
    }).sort((a, b) => b.n - a.n);
    const first = rows[0] && rows[0].n ? rows[0].name + ' the most' : 'none opened';
    return {
      nothing: false, whole: rows.reduce((m, r) => Math.max(m, r.n), 0), split: null, rows,
      says: ['today ' + num(now) + ' · ' + span + ' ' + num(all), key === 'sections' ? first : first + ' · links pressed ' + num(names.reduce((s, n) => s + of('link:' + n), 0))],
    };
  },
};
