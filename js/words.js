// --- the words -----------------------------------------------------------------
// the page's words as html inside its canvas (index.html), the canvas's
// fallback content: never drawn, but there for whatever cannot see the
// canvas, a search engine or a screen reader. made once at load from what
// the page draws: the name as a heading, then each section as a heading
// with its text a paragraph each (TEXT, js/text.js) and its own links
// after them, the sections in its box a level down, and each of its items
// a heading a level down with its text and its links, as the page shows
// them, sep between. a link opens in a new tab, as one pressed on the
// page does. an item with no text has none here.

const Words = {
  // the words appended to into (the canvas), made with doc: name the
  // page's name, sections as SECTIONS writes them, text as TEXT and sep
  // what goes between an item's links
  build(doc, into, name, sections, text, sep) {
    const add = (to, tag, words) => {
      const el = doc.createElement(tag);
      if (words !== undefined) el.textContent = words;
      to.appendChild(el);
      return el;
    };
    // a section's links or an item's, a paragraph of them, sep between;
    // none for none
    const links = (list) => {
      if (!list.length) return;
      const line = add(into, 'p');
      list.forEach(([label, url], i) => {
        if (i) line.appendChild(doc.createTextNode(sep));
        const a = add(line, 'a', label);
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
      });
    };
    const section = (s, level) => {
      const words = text[s.title] || [];
      const whole = Array.isArray(words);
      add(into, 'h' + level, s.title);
      if (whole) for (const p of words) add(into, 'p', p);
      links(s.links || []);
      for (const o of s.subs || []) section(o, level + 1);
      for (const it of s.items || []) {
        add(into, 'h' + (level + 1), it.title);
        for (const p of (!whole && words[it.title]) || []) add(into, 'p', p);
        links(it.links || []);
      }
    };
    add(into, 'h1', name);
    for (const s of sections) section(s, 2);
  },
};
