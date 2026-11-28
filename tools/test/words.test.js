// node tools/test/words.test.js
//
// loads js/words.js the way the page does, a classic script, in a vm
// context, and hands it a fake document whose elements keep what is put
// in them. checks that the words go into the element given and nowhere
// else: the name a heading first, each section a heading with its text a
// paragraph each and its own links after them, the sections in its box
// and its items a level down, an
// item's text after its heading and its links after that, each a real
// link that opens in a new tab, the separator between them, and an item
// with no text a heading alone. then builds them from index.html's
// SECTIONS and js/text.js's TEXT and checks every paragraph and every
// link the page has is there once, and that the page loads the script and
// builds them into its canvas. exits 1 on failure.

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
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'words.js'), 'utf8'), ctx, { filename: 'js/words.js' });
const Words = vm.runInContext('Words', ctx);

// --- the fake document ---------------------------------------------------------
// an element keeps its tag, its words and what is appended to it; a text
// node its words. the document makes nothing else
function element(tag) {
  return { tag, textContent: '', children: [], appendChild(c) { this.children.push(c); return c; } };
}
const doc = {
  made: 0,
  createElement(tag) { this.made++; return element(tag); },
  createTextNode(text) { this.made++; return { text }; },
};
// an element's children as lines: 'tag words', a paragraph of links as
// its parts, each link 'a label' and each text node its words
const lines = (el) => el.children.map((c) => c.children.length ? c.tag + ' ' + c.children.map((k) => k.tag ? k.tag + ' ' + k.textContent : k.text).join('') : c.tag + ' ' + c.textContent);

// --- a small page ----------------------------------------------------------------
const SECTIONS = [
  { title: 'Work', photo: false, o: 0, subs: [
    { title: 'Personal', photo: false, o: 0, items: [
      { title: 'One', links: [['one.com', 'https://one.com'], ['github.com/one', 'https://github.com/one']] },
      { title: 'Two' },
      { title: 'Three', links: [['three.org', 'https://three.org']] },
    ] },
  ] },
  { title: 'Doodles', photo: false, o: 0, items: [{ title: 'Bubble Bob', game: true }] },
  { title: 'About', photo: true, o: 0, links: [['about.example', 'https://about.example']] },
  { title: 'Contact', photo: false, o: 0 },
];
const TEXT = {
  About: ['First.', 'Second.'],
  Personal: { One: ['One\'s first.', 'One\'s second.'], Three: [] },
  Contact: ['Write!', 'me@example.com', '+1 555-0100'],
};
const canvas = element('canvas');
Words.build(doc, canvas, 'A Name', SECTIONS, TEXT, ' | ');
const got = lines(canvas);
const want = [
  'h1 A Name',
  'h2 Work',
  'h3 Personal',
  'h4 One', 'p One\'s first.', 'p One\'s second.', 'p a one.com | a github.com/one',
  'h4 Two',
  'h4 Three', 'p a three.org',
  'h2 Doodles',
  'h3 Bubble Bob',
  'h2 About', 'p First.', 'p Second.', 'p a about.example',
  'h2 Contact', 'p Write!', 'p me@example.com', 'p +1 555-0100',
];
check('the name, the sections, their boxes\' sections and items, each its text and links, in order', got.join('\n') === want.join('\n'), got.join('\n') === want.join('\n') ? '' : '\n' + got.join('\n'));
const links = canvas.children.flatMap((c) => c.children.filter((k) => k.tag === 'a'));
check('each link a real link to its url', links.length === 4 && links.map((a) => a.href).join(' ') === 'https://one.com https://github.com/one https://three.org https://about.example', links.map((a) => a.href).join(' '));
check('each opening in a new tab, as the page\'s do', links.every((a) => a.target === '_blank' && a.rel === 'noopener'));
check('nothing made that is not in the canvas', doc.made === canvas.children.length + canvas.children.reduce((n, c) => n + c.children.length, 0), doc.made + ' made');
const again = element('canvas');
Words.build(doc, again, 'A Name', SECTIONS, {}, ' | ');
const bare = ['h1 A Name', 'h2 Work', 'h3 Personal', 'h4 One', 'p a one.com | a github.com/one', 'h4 Two', 'h4 Three', 'p a three.org',
  'h2 Doodles', 'h3 Bubble Bob', 'h2 About', 'p a about.example', 'h2 Contact'];
check('with no text at all: the headings and the links alone', lines(again).join('\n') === bare.join('\n'), lines(again).join('\n') === bare.join('\n') ? '' : '\n' + lines(again).join('\n'));

// --- the page's own ----------------------------------------------------------------
// the array literal in text from its [ at i to its matching ], quotes and
// comments skipped; or null if it never closes
function literal(text, i) {
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (c === '\'' || c === '"' || c === '`') {
      for (j++; j < text.length && text[j] !== c; j++) if (text[j] === '\\') j++;
    } else if (c === '/' && text[j + 1] === '/') {
      j = text.indexOf('\n', j);
      if (j < 0) return null;
    } else if (c === '/' && text[j + 1] === '*') {
      j = text.indexOf('*/', j + 2) + 1;
      if (j <= 0) return null;
    } else if (c === '[' || c === '{' || c === '(') depth++;
    else if (c === ']' || c === '}' || c === ')') {
      depth--;
      if (depth === 0) return text.slice(i, j + 1);
    }
  }
  return null;
}
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const at = html.indexOf('const SECTIONS = [');
const page = at < 0 ? null : vm.runInNewContext('(' + literal(html, at + 'const SECTIONS = '.length) + ')', {});
const words = vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'text.js'), 'utf8') + '\nTEXT', {});
check('index.html\'s SECTIONS and js/text.js\'s TEXT read', Array.isArray(page) && page.length > 0 && !!words.About);
if (Array.isArray(page)) {
  const real = element('canvas');
  Words.build(doc, real, 'Peter D\'Angelo', page, words, ' | ');
  const paras = real.children.filter((c) => c.tag === 'p' && !c.children.length).map((c) => c.textContent);
  const all = (v) => Array.isArray(v) ? v : Object.values(v).flat();
  const written = Object.values(words).flatMap(all);
  const once = (xs, x) => xs.filter((y) => y === x).length === 1;
  check('every paragraph of TEXT there once', written.length > 0 && written.every((p) => once(paras, p)) && paras.length === written.length, paras.length + ' of ' + written.length);
  const walk = (s) => [...(s.links || []), ...(s.items || []).flatMap((it) => it.links || []), ...(s.subs || []).flatMap(walk)];
  const pageLinks = page.flatMap(walk);
  const realLinks = real.children.flatMap((c) => c.children.filter((k) => k.tag === 'a'));
  check('every link of SECTIONS there once, its label and its url', pageLinks.length > 0 && realLinks.length === pageLinks.length &&
    pageLinks.every(([label, url]) => realLinks.filter((a) => a.textContent === label && a.href === url).length === 1), realLinks.length + ' of ' + pageLinks.length);
  const contact = real.children.findIndex((c) => c.textContent === 'Contact');
  check('the contact details under Contact, as the page shows them', contact >= 0 && real.children.slice(contact + 1).map((c) => c.textContent).join('\n') === words.Contact.join('\n'));
}
check('the page loads js/words.js and builds the words into its canvas', /<script src="js\/words\.js"><\/script>/.test(html) && /Words\.build\(document, canvas, /.test(html));

console.log(failures ? failures + ' failed' : 'all passed');
process.exit(failures ? 1 : 0);
