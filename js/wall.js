// --- the wall ------------------------------------------------------------------
// the graffiti wall: one bitmap W by H, a byte a pixel, each a colour index
// into COLOURS, 0 the paper. visitors draw on it with a round brush one of
// SIZES across: a stroke is a run of wall pixels, the brush stamped at
// every step of a bresenham walk from each to the next. the server
// (tools/wall-server) holds the true bitmap: it paints strokes in the order
// they reach it, relays each to every other socket, acks the sender and
// keeps the bitmap. the statics are what the page and the server share:
// the brush, a stroke, its cost in ink, the run-length coding of a bitmap
// and the messages, each a message type's byte and then
//   SNAPSHOT  W and H as u16 little-endian, then the bitmap packed
//   STROKE    colour, size, n, then n points, x and y each u16 little-endian
//   ACK       1 when the sender's oldest stroke not yet acked was painted, 0 refused
// an instance is the page's replica of it and its link: truth, the wall in
// the server's order, and shown, truth with the visitor's own ink not yet
// acked over it, both in the page's colours through a lut. the pen paints
// shown at once and sends its points in batches, BATCH ms apart or MOST
// points at a time; an ack paints the oldest batch onto truth or, refused,
// takes it off shown. ink is spent by the px of brush across times the px
// of travel and comes back RATE a second, and a stroke the pen cannot pay
// for is lifted. a lost socket drops the ink not yet acked and is tried
// again after each of RETRY in turn. nothing here keeps time: every time
// comes in from the caller, in ms.

const WALL = {
  W: 1344, H: 576,
  // the sixteen a visitor picks, then the colours they mix to (js/mix.js): each the even mix of two
  // before it, the one farthest from all before it (tools/mix/list.js). a colour's place in the list is
  // what the wall's bytes hold, so the list is only ever added to, at its end
  COLOURS: ['#fbf6f0', '#000000', '#49B6B0', '#B8B693', '#B5979A', '#D9534A', '#E8913A', '#EDC84A',
            '#6FAE5B', '#2F6B4F', '#3F7FBF', '#2B3A67', '#7E5AA8', '#E58FB0', '#8A5A3C', '#8C8C8C',
            '#c7a95e', '#6eb0da', '#eb867c', '#96565f', '#3f6164', '#af8ecd', '#4e4a33', '#7cad86',
            '#d29a74', '#817753', '#f1bcd2', '#55874e', '#51859e', '#8fa051', '#a2d18f', '#afce67',
            '#505d79', '#685859', '#5f897b', '#846b98', '#ec9362', '#f5e17c', '#f3ca94', '#b59ec2',
            '#efb354', '#b46e61', '#bababa', '#d2cc82', '#839cd3', '#f2a79e', '#70cc87', '#978045',
            '#89afa3', '#86a5b3', '#5068b2', '#887587', '#95786d', '#3d444d', '#885874', '#af7d9a',
            '#626c5c', '#5cb2c7', '#68805c', '#6678a4', '#83cb61', '#f2c3a8', '#b19575', '#8c9d69',
            '#cf6952', '#a4b9e0', '#aa7848', '#8f9880', '#a5cbad', '#f0ae6e', '#d8d6bf', '#425b8f',
            '#2d453d', '#c2bf5c', '#4e9274', '#c58286', '#df6641', '#465e3b', '#6f4f3e', '#7e89a2',
            '#7bd6d2', '#95c7d2', '#8ad4a4', '#e4dfa9', '#61723b', '#63b07b', '#8178bf', '#b0a66e',
            '#acbd82', '#687076', '#bfe0ae', '#d4b552', '#c69081', '#ca7d58', '#d0afa3', '#e57e45',
            '#a49944', '#7aa667', '#b68a45', '#cde190', '#4d7e84', '#619fa3', '#65bd9c', '#ab5553',
            '#d79fa8', '#afafc3', '#f4d386', '#ef9d81', '#433b35', '#976bac', '#906870', '#7c7f3a',
            '#83673b', '#625f37', '#d0b58c', '#303d5a', '#e1c7c7', '#5ca192', '#90d680', '#5599cf',
            '#8ed6be', '#ac7a5e', '#f7dbb2', '#746556', '#3e6657', '#aea08f', '#a9a0d6', '#db914b',
            '#8785ba', '#505752', '#acbc6c', '#c19c68', '#71596f', '#f8ea9e', '#f3b68e', '#aacec7',
            '#615f88', '#97675a', '#6e8c42', '#486d7f', '#708993', '#95c270', '#918b59', '#a9b4a1',
            '#6d5c95', '#a15642', '#cca5bc', '#b489b6', '#7498bd', '#d39b46', '#99ad87', '#827e6e',
            '#bdcde7', '#a58da2', '#b8b064', '#807272', '#9598bd', '#61be60', '#7aa246', '#89b951',
            '#7abeb7', '#ab6843', '#be773e', '#ca6d3f', '#71977a', '#cb6963', '#7c948e', '#5a9a56',
            '#3c7c52', '#d79460', '#f2bfb8', '#827b9e', '#4782ac', '#a48258', '#d3d769', '#96be89',
            '#f6d6c2', '#8c5144', '#7c5553', '#917157', '#5971ac', '#679669', '#455541', '#e3b464',
            '#564e5f', '#c2bbe1', '#c8c38d', '#d4b87c', '#d0856f', '#4f7446', '#de6560', '#a66d7e',
            '#b6696e', '#9f9e76', '#ae7c76', '#91c9e5', '#98a5a5', '#3e806f', '#375465', '#68a0b9',
            '#d8a98f', '#a4ad4e', '#989754', '#7cb89f', '#b8cb9f', '#f6d2df', '#de8e89', '#cab4c2',
            '#7fbf78', '#e88368', '#647b76', '#374e74', '#466990', '#89afcc', '#b45546', '#705d3f',
            '#b7953f', '#eca7c3', '#6b6a7e', '#a9bcc9', '#f2c665', '#deaf72', '#cbbeb0', '#ab838f'],
  SIZES: [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16], // brush diameters, px
  MOST: 64,               // points a stroke message holds at most
  BATCH: 50,              // ms between sends while the pen is down
  INK: 120000,            // a full pen, in px of brush width times px of travel
  RATE: 8000,             // ink back a second
  GRACE: 1.25,            // the server's pen is this many times as full, so an honest client is never refused
  SNAPSHOT: 0, STROKE: 1, ACK: 2, // message types, a message's first byte
  RETRY: [1000, 2000, 5000, 10000], // ms before each try to reconnect, the last one repeating
};

class Wall {
  constructor(lut) {
    if (!lut) {
      lut = new Uint8Array(WALL.COLOURS.length);
      for (let i = 0; i < lut.length; i++) lut[i] = i;
    }
    this.lut = lut;                                                 // a wall colour index to the page's v
    this.truth = new lut.constructor(WALL.W * WALL.H).fill(lut[0]); // the wall in the server's order, as wide a pixel as the lut's
    this.shown = new lut.constructor(WALL.W * WALL.H).fill(lut[0]); // truth with own ink not yet acked over it
    this.live = false;    // a snapshot has come on the current socket
    this.url = null;
    this.wanted = false;  // connected, or to be
    this.socket = null;
    this.tries = 0;       // into RETRY
    this.due = 0;         // when the next try is
    this.now = 0;         // the last now step() was given
    this.sent = [];       // each { colour, size, pts } sent and not yet acked, oldest first
    this.colour = -1;     // the stroke in progress, -1 when the pen is up
    this.size = 0;
    this.unsent = [];     // its points not yet sent, flat x, y
    this.paid = 0;        // what they have cost: 0 when they are none, or only the point carried on
    this.sentAt = 0;      // when the last batch was sent
    this.level = WALL.INK;
    this.filled = 0;      // when the ink was last topped up
  }

  // the brush at integer (x, y): of the size by size box round it, the
  // pixels whose middles are within size / 2 of its middle. 2 is a 2x2
  // block, 4 is 4x4 less its corners
  static stamp(px, w, h, x, y, size, v) {
    const half = size / 2, r2 = half * half;
    const x0 = x - Math.floor(half), y0 = y - Math.floor(half);
    for (let j = 0; j < size; j++) {
      const py = y0 + j;
      if (py < 0 || py >= h) continue;
      const dy = j + 0.5 - half;
      for (let i = 0; i < size; i++) {
        const qx = x0 + i;
        if (qx < 0 || qx >= w) continue;
        const dx = i + 0.5 - half;
        if (dx * dx + dy * dy <= r2) px[py * w + qx] = v;
      }
    }
  }

  // pts flat integers x0, y0, x1, y1 ...: one point is one stamp; more
  // stamp every step of a bresenham walk from each to the next, ends
  // included, the walk js/raster.js's line() takes
  static stroke(px, w, h, pts, size, v) {
    if (pts.length === 2) {
      Wall.stamp(px, w, h, pts[0], pts[1], size, v);
      return;
    }
    for (let k = 2; k + 1 < pts.length; k += 2) {
      let x = pts[k - 2], y = pts[k - 1];
      const x1 = pts[k], y1 = pts[k + 1];
      const dx = Math.abs(x1 - x), dy = Math.abs(y1 - y);
      const sx = x < x1 ? 1 : -1, sy = y < y1 ? 1 : -1;
      let err = dx - dy;
      for (;;) {
        Wall.stamp(px, w, h, x, y, size, v);
        if (x === x1 && y === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx) { err += dx; y += sy; }
      }
    }
  }

  // the ink a stroke spends: the steps of its walk, each point it shares
  // counted once, times the brush's size
  static cost(pts, size) {
    let steps = 1;
    for (let k = 2; k + 1 < pts.length; k += 2) {
      steps += Math.max(Math.abs(pts[k] - pts[k - 2]), Math.abs(pts[k + 1] - pts[k - 1]));
    }
    return steps * size;
  }

  // packbits: a header byte h under 128 is followed by h + 1 bytes as they
  // are, one over 128 by a byte that repeats 257 - h times. runs of three or
  // more repeat, so the packing is never more than a byte in 128 longer
  static pack(px) {
    const n = px.length, out = new Uint8Array(n + Math.ceil(n / 128) + 1);
    let i = 0, o = 0;
    while (i < n) {
      const v = px[i];
      let r = 1;
      while (i + r < n && r < 128 && px[i + r] === v) r++;
      if (r >= 3) {
        out[o++] = 257 - r;
        out[o++] = v;
        i += r;
        continue;
      }
      // as they are, up to 128 of them or the next run of three
      const start = i++;
      while (i < n && i - start < 128 && !(i + 2 < n && px[i] === px[i + 1] && px[i] === px[i + 2])) i++;
      out[o++] = i - start - 1;
      for (let k = start; k < i; k++) out[o++] = px[k];
    }
    return out.slice(0, o);
  }

  // bytes packed into into: true when they fill it exactly. a header of
  // 128 is passed over, as packbits has it; anything cut short or running
  // past into's end is false, and nothing past its end is written
  static unpack(bytes, into) {
    const n = bytes.length, m = into.length;
    let i = 0, o = 0;
    while (i < n) {
      const h = bytes[i++];
      if (h < 128) {
        const len = h + 1;
        if (i + len > n || o + len > m) return false;
        for (let k = 0; k < len; k++) into[o++] = bytes[i++];
      } else if (h > 128) {
        const len = 257 - h;
        if (i >= n || o + len > m) return false;
        into.fill(bytes[i++], o, o + len);
        o += len;
      }
    }
    return o === m;
  }

  static encodeStroke(colour, size, pts) {
    const n = pts.length >> 1, out = new Uint8Array(4 + 4 * n);
    out[0] = WALL.STROKE;
    out[1] = colour;
    out[2] = size;
    out[3] = n;
    for (let k = 0; k < n; k++) {
      const x = pts[2 * k], y = pts[2 * k + 1], o = 4 + 4 * k;
      out[o] = x & 255;
      out[o + 1] = x >> 8;
      out[o + 2] = y & 255;
      out[o + 3] = y >> 8;
    }
    return out;
  }

  // { colour, size, pts }, or null for anything but a whole stroke of a
  // colour, a size and 1 to MOST points, all on the wall
  static decodeStroke(bytes) {
    if (bytes.length < 4 || bytes[0] !== WALL.STROKE) return null;
    const colour = bytes[1], size = bytes[2], n = bytes[3];
    if (n < 1 || n > WALL.MOST || bytes.length !== 4 + 4 * n) return null;
    if (colour >= WALL.COLOURS.length || WALL.SIZES.indexOf(size) < 0) return null;
    const pts = new Array(2 * n);
    for (let k = 0; k < n; k++) {
      const o = 4 + 4 * k;
      const x = bytes[o] | bytes[o + 1] << 8, y = bytes[o + 2] | bytes[o + 3] << 8;
      if (x >= WALL.W || y >= WALL.H) return null;
      pts[2 * k] = x;
      pts[2 * k + 1] = y;
    }
    return { colour, size, pts };
  }

  static encodeSnapshot(px) {
    const packed = Wall.pack(px), out = new Uint8Array(5 + packed.length);
    out[0] = WALL.SNAPSHOT;
    out[1] = WALL.W & 255;
    out[2] = WALL.W >> 8;
    out[3] = WALL.H & 255;
    out[4] = WALL.H >> 8;
    out.set(packed, 5);
    return out;
  }

  connect(url) {
    this.shut();
    this.url = url;
    this.wanted = true;
    this.open();
  }

  disconnect() {
    this.wanted = false;
    this.shut();
  }

  open() {
    const s = new WebSocket(this.url);
    s.binaryType = 'arraybuffer';
    // only the current socket is heard, and a close after an error is the same loss
    s.onmessage = (e) => { if (this.socket === s) this.receive(new Uint8Array(e.data)); };
    s.onclose = s.onerror = () => { if (this.socket === s) this.lost(); };
    this.socket = s;
  }

  // the socket gone of itself: tried again RETRY[tries] after the last step
  lost() {
    this.socket = null;
    this.drop();
    if (!this.wanted) return;
    this.due = this.now + WALL.RETRY[this.tries];
    this.tries = Math.min(this.tries + 1, WALL.RETRY.length - 1);
  }

  shut() {
    const s = this.socket;
    this.socket = null;
    if (s) s.close();
    this.drop();
  }

  // not live: the ink not yet acked is gone from shown and the pen is up
  drop() {
    this.live = false;
    this.sent.length = 0;
    this.colour = -1;
    this.unsent = [];
    this.paid = 0;
    this.shown.set(this.truth);
  }

  step(now) {
    this.now = now;
    this.fill(now);
    if (this.colour >= 0 && this.paid > 0 && now - this.sentAt >= WALL.BATCH) this.send(now);
    if (this.wanted && !this.socket && now >= this.due) this.open();
  }

  // the pen down at, or moved to, wall pixel (x, y): false when it draws nothing
  pen(colour, size, x, y, now) {
    if (!this.live) return false;
    this.fill(now);
    x = Math.min(WALL.W - 1, Math.max(0, Math.round(x)));
    y = Math.min(WALL.H - 1, Math.max(0, Math.round(y)));
    if (this.colour >= 0 && (colour !== this.colour || size !== this.size)) this.lift();
    const v = this.lut[colour];
    if (this.colour < 0) {
      // a new stroke: its first point is a stamp
      if (this.level < size) return false;
      this.level -= size;
      this.paid = size;
      this.colour = colour;
      this.size = size;
      this.unsent = [x, y];
      Wall.stamp(this.shown, WALL.W, WALL.H, x, y, size, v);
    } else {
      const u = this.unsent, lx = u[u.length - 2], ly = u[u.length - 1];
      if (x === lx && y === ly) return true;
      // the point carried on is paid for with the first step after it
      const c = (this.paid ? 0 : size) + Math.max(Math.abs(x - lx), Math.abs(y - ly)) * size;
      if (this.level < c) {
        this.lift();
        return false;
      }
      this.level -= c;
      this.paid += c;
      u.push(x, y);
      Wall.stroke(this.shown, WALL.W, WALL.H, [lx, ly, x, y], size, v);
    }
    if (this.unsent.length >= 2 * WALL.MOST) this.send(now);
    return true;
  }

  lift() {
    if (this.colour >= 0 && this.paid > 0) this.send(this.now);
    this.colour = -1;
    this.unsent = [];
    this.paid = 0;
  }

  // the unsent points as a batch, the next starting from their last
  send(now) {
    const u = this.unsent;
    this.socket.send(Wall.encodeStroke(this.colour, this.size, u));
    this.sent.push({ colour: this.colour, size: this.size, pts: u });
    this.sentAt = now;
    this.unsent = [u[u.length - 2], u[u.length - 1]];
    this.paid = 0;
  }

  fill(now) {
    if (now <= this.filled) return;
    this.level = Math.min(WALL.INK, this.level + WALL.RATE * (now - this.filled) / 1000);
    this.filled = now;
  }

  // how full the pen is, 0 to 1
  ink(now) {
    this.fill(now);
    return this.level / WALL.INK;
  }

  receive(bytes) {
    const type = bytes[0];
    if (type === WALL.SNAPSHOT) {
      if (bytes.length < 5) return;
      if ((bytes[1] | bytes[2] << 8) !== WALL.W || (bytes[3] | bytes[4] << 8) !== WALL.H) return;
      const raw = new Uint8Array(WALL.W * WALL.H), lut = this.lut, truth = this.truth;
      if (!Wall.unpack(bytes.subarray(5), raw)) return;
      for (let i = 0; i < raw.length; i++) truth[i] = lut[raw[i]];
      this.shown.set(truth);
      this.sent.length = 0;
      this.colour = -1;
      this.unsent = [];
      this.paid = 0;
      this.live = true;
      this.tries = 0;
    } else if (type === WALL.STROKE) {
      // someone else's: it comes before all of own ink not yet acked
      const s = Wall.decodeStroke(bytes);
      if (!s) return;
      const v = this.lut[s.colour];
      Wall.stroke(this.truth, WALL.W, WALL.H, s.pts, s.size, v);
      Wall.stroke(this.shown, WALL.W, WALL.H, s.pts, s.size, v);
      this.repaint();
    } else if (type === WALL.ACK) {
      const b = this.sent.shift();
      if (!b) return;
      if (bytes[1] === 1) {
        Wall.stroke(this.truth, WALL.W, WALL.H, b.pts, b.size, this.lut[b.colour]);
        return;
      }
      // refused: truth back over its box, and the rest of own ink over that
      const p = b.pts;
      let x0 = WALL.W, y0 = WALL.H, x1 = -1, y1 = -1;
      for (let k = 0; k < p.length; k += 2) {
        if (p[k] < x0) x0 = p[k];
        if (p[k] > x1) x1 = p[k];
        if (p[k + 1] < y0) y0 = p[k + 1];
        if (p[k + 1] > y1) y1 = p[k + 1];
      }
      x0 = Math.max(0, x0 - b.size);
      y0 = Math.max(0, y0 - b.size);
      x1 = Math.min(WALL.W - 1, x1 + b.size);
      y1 = Math.min(WALL.H - 1, y1 + b.size);
      for (let y = y0; y <= y1; y++) {
        const r = y * WALL.W;
        this.shown.set(this.truth.subarray(r + x0, r + x1 + 1), r + x0);
      }
      this.repaint();
    }
  }

  // own ink not yet acked over shown, oldest first
  repaint() {
    for (let k = 0; k < this.sent.length; k++) {
      const b = this.sent[k];
      Wall.stroke(this.shown, WALL.W, WALL.H, b.pts, b.size, this.lut[b.colour]);
    }
    if (this.colour >= 0) Wall.stroke(this.shown, WALL.W, WALL.H, this.unsent, this.size, this.lut[this.colour]);
  }
}
