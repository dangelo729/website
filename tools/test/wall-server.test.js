// node tools/test/wall-server.test.js
//
// the wall's server end to end: run `make dev` in tools/wall-server first,
// so it is listening on localhost:8787 with its .dev.vars (any origin, the
// admin token 'dev'); with nothing listening this says so and exits 1.
// loads js/wall.js in a vm context with node's WebSocket, the way the page
// does with the browser's, and drives real Wall instances as the clients,
// with raw sockets for what a client never sends. it wipes the wall first,
// so it can be run again and again; every client here comes from the one
// address, so they share its sockets. checks that the
// admin routes refuse a wrong or missing token; that a joiner gets a
// snapshot and goes live; that what A draws reaches B, both matching A
// once acked; that a stroke drawn before C joins is in C's snapshot; that
// a stroke is relayed to everyone but its sender, who gets its ack; that a
// malformed message or a string gets its socket closed with 1008; that a
// ninth socket from one address is refused with 429; that a raw client
// spending past its socket's ink gets [ACK, 0] and the wall takes none of
// what it could not pay for, while another socket's ink is its own; that a
// client's close is answered, so it
// finishes at once; that a wipe clears every connected client; that the
// snapshots list 'before'; and that rolling back to 'before' restores what
// was wiped. exits 1 on failure.

const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const HOST = 'localhost', PORT = 8787;
const WS = 'ws://' + HOST + ':' + PORT + '/', HTTP = 'http://' + HOST + ':' + PORT;
const TOKEN = 'dev';

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}

const ctx = vm.createContext({ WebSocket });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/wall.js'), 'utf8'), ctx, { filename: 'js/wall.js' });
const { Wall, WALL } = vm.runInContext('({ Wall, WALL })', ctx);
const W = WALL.W, H = WALL.H;

// --- helpers --------------------------------------------------------------------
// the first index where a and b differ, -1 when they are the same
function differ(a, b) {
  if (a.length !== b.length) return 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}
const where = (i) => i < 0 ? '' : 'first differs at ' + (i % W) + ',' + Math.floor(i / W);
const blank = (px) => px.every((v) => v === 0);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// every client is stepped as the page would each frame
const clients = [];
function client() {
  const w = new Wall();
  w.connect(WS);
  clients.push(w);
  return w;
}
function tick() {
  const now = performance.now();
  for (const w of clients) w.step(now);
}
async function until(ok, ms = 5000) {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) return false;
    tick();
    await wait(5);
  }
  return true;
}

// a raw socket, open, and all it hears
function raw() {
  return new Promise((resolve) => {
    const s = new WebSocket(WS);
    s.binaryType = 'arraybuffer';
    const r = { s, heard: [], code: null, clean: false };
    s.onmessage = (e) => r.heard.push(typeof e.data === 'string' ? e.data : Array.from(new Uint8Array(e.data)));
    s.onclose = (e) => { r.code = e.code; r.clean = e.wasClean; resolve(r); };
    s.onopen = () => resolve(r);
  });
}

// the status an upgrade on / is answered with
function upgrade() {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port: PORT, path: '/', headers: {
      Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
    } });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve(101); });
    req.on('response', (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve(0));
  });
}

function admin(method, route, auth) {
  return fetch(HTTP + route, { method, headers: auth === undefined ? {} : { Authorization: auth } });
}

// a stroke of n points zigzagging w px across from (x, y), as raw bytes
function zigzag(colour, size, x, y, n, w) {
  const pts = [];
  for (let k = 0; k < n; k++) pts.push(x + (k % 2) * w, y + k);
  return { colour, size, pts, bytes: Wall.encodeStroke(colour, size, pts) };
}

async function main() {
  try {
    const res = await fetch(HTTP + '/nothing');
    check('the server answers anything else with 404', res.status === 404, res.status);
  } catch (e) {
    console.log('nothing is listening on ' + HOST + ':' + PORT + ': run make dev in tools/wall-server first');
    process.exit(1);
  }

  // --- admin --------------------------------------------------------------------
  const routes = [['POST', '/admin/wipe'], ['GET', '/admin/snapshots'], ['POST', '/admin/rollback?day=before']];
  const refused = [];
  for (const [method, route] of routes) {
    for (const auth of [undefined, 'Bearer nope', 'Bearer ' + TOKEN + 'x', TOKEN, 'Bearer ']) {
      refused.push((await admin(method, route, auth)).status);
    }
  }
  check('the admin routes refuse a missing or wrong token with 403', refused.every((s) => s === 403), refused.join(' '));
  const wiped = await admin('POST', '/admin/wipe', 'Bearer ' + TOKEN);
  check('a wipe with the token', wiped.status === 200, wiped.status);

  // --- clients ------------------------------------------------------------------
  const A = client();
  check('a joiner gets a snapshot and goes live, the wall blank after the wipe', await until(() => A.live) && blank(A.truth) && blank(A.shown));
  const B = client();
  await until(() => B.live);
  for (let k = 0; k <= 40; k++) {
    A.pen(5, 8, 100 + 10 * k, 100 + 3 * k + (k % 3) * 4, performance.now());
    tick();
    await wait(4);
  }
  for (let k = 0; k <= 20; k++) {
    A.pen(10, 16, 300 + 5 * k, 300 - 4 * k, performance.now());
    tick();
    await wait(4);
  }
  A.lift();
  const settled = await until(() => A.sent.length === 0 && differ(B.shown, A.shown) < 0);
  check('A draws, and B\'s shown matches A\'s', settled && !blank(A.shown), where(differ(B.shown, A.shown)));
  check('both match once acked, truth and shown', differ(A.truth, A.shown) < 0 && differ(B.truth, A.truth) < 0 && differ(B.shown, B.truth) < 0);
  const C = client();
  await until(() => C.live);
  check('a stroke drawn before C joins is in C\'s snapshot', C.live && differ(C.truth, A.truth) < 0, where(differ(C.truth, A.truth)));

  // --- raw sockets --------------------------------------------------------------
  const r1 = await raw();
  await until(() => r1.heard.length > 0);
  check('a raw socket gets the snapshot first', r1.heard.length === 1 && r1.heard[0][0] === WALL.SNAPSHOT);
  // A, B, C and r1 hold four of the address's eight: four more fill it
  const more = [];
  for (let k = 0; k < 4; k++) more.push(await raw());
  check('a ninth socket from one address is refused with 429', await upgrade() === 429);
  for (const r of more) r.s.close();
  await until(() => more.every((r) => r.code !== null));
  const dot = zigzag(12, 4, 700, 400, 3, 20);
  r1.s.send(dot.bytes);
  const want = A.truth.slice();
  Wall.stroke(want, W, H, dot.pts, dot.size, dot.colour);
  await until(() => r1.heard.length > 1 && differ(C.truth, want) < 0);
  await wait(50);
  check('a stroke is acked to its sender and not sent back to it', r1.heard.length === 2 && r1.heard[1].join() === WALL.ACK + ',1', r1.heard.slice(1).map((h) => h.slice(0, 4).join()).join(' '));
  check('and relayed to everyone else', differ(A.truth, want) < 0 && differ(B.truth, want) < 0 && differ(C.truth, want) < 0);
  r1.s.send(Uint8Array.of(WALL.STROKE, 99, 4, 1, 0, 0, 0, 0));
  await until(() => r1.code !== null);
  check('a malformed stroke closes its socket with 1008', r1.code === 1008, r1.code);
  const r2 = await raw();
  r2.s.send('hello');
  await until(() => r2.code !== null);
  check('a string closes its socket with 1008', r2.code === 1008, r2.code);
  const r3 = await raw();
  await until(() => r3.heard.length > 0);
  // each costs about a fifteenth of the server's full pen: a burst of sixteen spends past it
  const burst = [];
  for (let k = 0; k < 16; k++) burst.push(zigzag(k % 15 + 1, 16, 40 + 80 * k, 120, WALL.MOST, 10));
  const cost = Wall.cost(burst[0].pts, 16);
  for (const b of burst) r3.s.send(b.bytes);
  await until(() => r3.heard.length === 1 + burst.length);
  const acks = r3.heard.slice(1).map((h) => h[0] === WALL.ACK ? h[1] : -1);
  const paid = acks.indexOf(0);
  check('spending past the server\'s ink gets [ACK, 0], every ack after it too',
    paid >= 0 && acks.slice(0, paid).every((a) => a === 1) && acks.slice(paid).every((a) => a === 0), acks.join(' ') + ', each ' + cost + ' of ' + WALL.INK * WALL.GRACE);
  const after = want.slice();
  for (let k = 0; k < paid; k++) Wall.stroke(after, W, H, burst[k].pts, 16, burst[k].colour);
  await wait(100);
  await until(() => differ(C.truth, after) < 0, 1000);
  check('and the wall takes only what was paid for', differ(A.truth, after) < 0 && differ(C.truth, after) < 0, where(differ(C.truth, after)));
  // r3's pen is empty; another socket's is its own, and full
  const r4 = await raw();
  await until(() => r4.heard.length > 0);
  r4.s.send(burst[0].bytes);
  await until(() => r4.heard.length > 1);
  check('each socket has its own ink', r4.heard.length === 2 && r4.heard[1].join() === WALL.ACK + ',1', r4.heard.slice(1).map((h) => h.join()).join(' '));
  Wall.stroke(after, W, H, burst[0].pts, 16, burst[0].colour);
  await until(() => differ(A.truth, after) < 0 && differ(B.truth, after) < 0 && differ(C.truth, after) < 0);
  r4.s.close();
  r3.s.close();
  check('a client\'s close is answered at once', await until(() => r3.code !== null, 1000) && r3.clean && r3.code === 1005, r3.code);

  // --- wipe and rollback ----------------------------------------------------------
  const pre = A.truth.slice();
  const wipe = await admin('POST', '/admin/wipe', 'Bearer ' + TOKEN);
  const cleared = await until(() => [A, B, C].every((w) => w.live && blank(w.truth) && blank(w.shown)));
  check('a wipe clears every connected client', wipe.status === 200 && cleared);
  const list = await admin('GET', '/admin/snapshots', 'Bearer ' + TOKEN);
  const days = list.status === 200 ? await list.json() : [];
  check('the snapshots list before', Array.isArray(days) && days.indexOf('before') >= 0 && days.every((d) => d === 'before' || /^\d{4}-\d\d-\d\d$/.test(d)), JSON.stringify(days));
  const none = await admin('POST', '/admin/rollback?day=1999-01-01', 'Bearer ' + TOKEN);
  check('rolling back to a day with no snapshot is 404', none.status === 404, none.status);
  const back = await admin('POST', '/admin/rollback?day=before', 'Bearer ' + TOKEN);
  const restored = await until(() => [A, B, C].every((w) => differ(w.truth, pre) < 0 && differ(w.shown, pre) < 0));
  check('rolling back to before restores what was wiped, on every client', back.status === 200 && restored, where(differ(A.truth, pre)));

  for (const w of clients) w.disconnect();
  await wait(100);
  console.log(failures ? failures + ' failed' : 'all passed');
  process.exit(failures ? 1 : 0);
}

main();
