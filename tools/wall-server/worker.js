// --- the wall's server ---------------------------------------------------------
// the graffiti wall (js/wall.js) as a cloudflare worker and one durable
// object. the worker lets a websocket in on / from one of ORIGINS (any, or
// none, when ORIGINS is *), and /admin/... in with the ADMIN token, and
// hands both to the one WallRoom. the room holds the wall: it sends each
// socket the wall as it joins, paints each stroke in the order it arrives,
// relays it to every other socket and acks the sender, and refuses a
// stroke its socket's ink cannot pay for. the ink is a bucket a socket,
// GRACE times the page's pen and filled at its RATE, held in memory, so
// each visitor has a pen of their own whatever address they share. the wall
// is saved to sqlite SAVE_MS after it changes; before the first save of a
// utc day the wall as it was stored is kept under the day's date, the KEEP
// newest days of them. the admin can wipe the wall, list the days kept and
// roll back to one: either keeps the wall as it stood as 'before', so
// rolling back to 'before' swaps the two. sockets hibernate between
// messages, and the room may sleep with them; a save to come keeps it awake.

import { WALL, Wall } from './build/wall.js';
import { DurableObject } from 'cloudflare:workers';

const ROOM = {
  PER_IP: 8,      // sockets an ip may hold
  ALL: 256,       // sockets in all
  SAVE_MS: 3000,  // from the wall changing to its save
  KEEP: 14,       // dated snapshots kept
};

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/' && (request.headers.get('Upgrade') || '').toLowerCase() === 'websocket') {
      if (!allowed(request.headers.get('Origin'), env.ORIGINS)) return new Response('forbidden', { status: 403 });
      return room(env).fetch(request);
    }
    if (path.startsWith('/admin/')) {
      if (!admin(request.headers.get('Authorization'), env.ADMIN)) return new Response('forbidden', { status: 403 });
      return room(env).fetch(request);
    }
    return new Response('not found', { status: 404 });
  },
};

function room(env) {
  return env.WALL.get(env.WALL.idFromName('wall'), { locationHint: 'enam' });
}

function allowed(origin, origins) {
  if (origins === '*') return true;
  return !!origin && (origins || '').split(',').map((o) => o.trim()).indexOf(origin) >= 0;
}

// the bearer token compared in constant time, and never one when ADMIN is unset
function admin(given, token) {
  if (!token) return false;
  const enc = new TextEncoder(), a = enc.encode(given || ''), b = enc.encode('Bearer ' + token);
  // lengths that differ still take a comparison's time
  return a.byteLength === b.byteLength ? crypto.subtle.timingSafeEqual(a, b) : !crypto.subtle.timingSafeEqual(b, b);
}

// a row's bitmap, or a blank one when there is no row or it is the wrong size
function bitmap(row) {
  const px = row && row.px;
  return px && px.byteLength === WALL.W * WALL.H ? new Uint8Array(px) : new Uint8Array(WALL.W * WALL.H);
}

export class WallRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS wall (id INTEGER PRIMARY KEY, px BLOB)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS snapshots (day TEXT PRIMARY KEY, px BLOB)');
    this.px = null;        // the wall, loaded on first use
    this.dirty = false;    // changed since it was saved
    this.timer = null;     // the save to come
    this.ink = new WeakMap(); // each socket's { level, at }
  }

  wall() {
    if (!this.px) this.px = bitmap(this.sql.exec('SELECT px FROM wall WHERE id = 1').toArray()[0]);
    return this.px;
  }

  async fetch(request) {
    const url = new URL(request.url), path = url.pathname, method = request.method;
    if (path === '/') return this.join(request);
    if (path === '/admin/wipe' && method === 'POST') {
      this.keep('before', this.wall());
      this.px = new Uint8Array(WALL.W * WALL.H);
      this.save();
      this.tell();
      return new Response('wiped');
    }
    if (path === '/admin/snapshots' && method === 'GET') {
      return Response.json(this.sql.exec('SELECT day FROM snapshots ORDER BY day DESC').toArray().map((r) => r.day));
    }
    if (path === '/admin/rollback' && method === 'POST') {
      const day = url.searchParams.get('day') || '';
      const row = this.sql.exec('SELECT px FROM snapshots WHERE day = ?', day).toArray()[0];
      if (!row) return new Response('no snapshot for ' + day, { status: 404 });
      // read before 'before' is written, so rolling back to 'before' swaps them
      const px = bitmap(row);
      this.keep('before', this.wall());
      this.px = px;
      this.save();
      this.tell();
      return new Response('rolled back to ' + day);
    }
    return new Response('not found', { status: 404 });
  }

  join(request) {
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    const all = this.ctx.getWebSockets();
    let mine = 0;
    for (let i = 0; i < all.length; i++) if (all[i].deserializeAttachment().ip === ip) mine++;
    if (mine >= ROOM.PER_IP) return new Response('too many sockets from this address', { status: 429 });
    if (all.length >= ROOM.ALL) return new Response('the wall is full', { status: 503 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ ip });
    pair[1].send(Wall.encodeSnapshot(this.wall()));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(ws, message) {
    const s = typeof message === 'string' ? null : Wall.decodeStroke(new Uint8Array(message));
    if (!s) {
      ws.close(1008, 'not a stroke');
      return;
    }
    if (!this.pay(ws, Wall.cost(s.pts, s.size))) {
      ws.send(Uint8Array.of(WALL.ACK, 0));
      return;
    }
    Wall.stroke(this.wall(), WALL.W, WALL.H, s.pts, s.size, s.colour);
    this.touch();
    const all = this.ctx.getWebSockets();
    for (let i = 0; i < all.length; i++) {
      if (all[i] === ws) continue;
      try { all[i].send(message); } catch (e) {}
    }
    ws.send(Uint8Array.of(WALL.ACK, 1));
  }

  // a client's close answered with its own code, or with none when it gave
  // none (1005), so its handshake finishes. one that went without a close
  // (1006) is gone already, and closing it throws
  webSocketClose(ws, code, reason) {
    try {
      if (code === 1005) ws.close();
      else ws.close(code, reason);
    } catch (e) {}
  }

  // the runtime has dropped a socket that errored: nothing is left to close
  webSocketError() {}

  // cost taken from socket ws's ink, if it holds that much
  pay(ws, cost) {
    const now = Date.now(), full = WALL.INK * WALL.GRACE;
    let b = this.ink.get(ws);
    if (!b) this.ink.set(ws, b = { level: full, at: now });
    b.level = Math.min(full, b.level + WALL.RATE * (now - b.at) / 1000);
    b.at = now;
    if (cost > b.level) return false;
    b.level -= cost;
    return true;
  }

  // the wall changed: saved SAVE_MS from now, unless a save is already coming
  touch() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.dirty) this.save();
    }, ROOM.SAVE_MS);
  }

  // the wall into its row. the first save of a utc day keeps the row as it
  // was under the day's date, and lets all but the KEEP newest dates go
  save() {
    const day = new Date().toISOString().slice(0, 10);
    if (!this.sql.exec('SELECT day FROM snapshots WHERE day = ?', day).toArray().length) {
      const row = this.sql.exec('SELECT px FROM wall WHERE id = 1').toArray()[0];
      this.keep(day, row ? new Uint8Array(row.px) : new Uint8Array(WALL.W * WALL.H));
      this.sql.exec("DELETE FROM snapshots WHERE day != 'before' AND day NOT IN " +
        "(SELECT day FROM snapshots WHERE day != 'before' ORDER BY day DESC LIMIT ?)", ROOM.KEEP);
    }
    this.sql.exec('INSERT OR REPLACE INTO wall (id, px) VALUES (1, ?)', this.wall());
    this.dirty = false;
  }

  keep(day, px) {
    this.sql.exec('INSERT OR REPLACE INTO snapshots (day, px) VALUES (?, ?)', day, px);
  }

  // a fresh snapshot to every socket
  tell() {
    const snap = Wall.encodeSnapshot(this.wall()), all = this.ctx.getWebSockets();
    for (let i = 0; i < all.length; i++) {
      try { all[i].send(snap); } catch (e) {}
    }
  }
}
