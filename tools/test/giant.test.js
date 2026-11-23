// node tools/test/giant.test.js
//
// loads js/giant-art.js and js/giant.js the way the page does, classic
// scripts, in a vm context with scrubbers that do only what the test
// tells them (the real one has its own test, tools/test/scrub.test.js),
// and hands the giant a fake window: its microphone records what is asked
// of it and answers when the test says, its recorder records when it is
// started and stopped and hands over what it recorded, and its timers
// fire when the test says. checks that the art unpacks to its frames at
// their sizes, the same bits as written, his ears growing a px a side a
// frame and the hand's finger's tip a px a frame along the bar between
// TIP's two; that nothing is asked of the microphone, nor any audio made,
// before he is clicked; that a click asks for the microphone and makes
// his scrubber's audio, and records once it is given; that a second click
// stops the recorder and lets the microphone go, and what was recorded
// goes to his scrubber with the hand back at the bar's left; that a
// refusal, or no microphone to ask, leaves him at rest; that he stops by
// himself after LONGEST; that a microphone given late is let go; that his
// frames step as they should, his ears out while he listens and in after,
// his mouth open while there is a sound and the hand is held or the sound
// moves, and the ring turned after the sound's target the shorter way
// round; that the hand eases after where the sound is wanted and the
// sound is sought as far through it; and that muting him mutes his
// scrubber and shutting him away stops and stills him. exits 1 on failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}
const near = (a, b, by = 1e-9) => Math.abs(a - b) <= by;
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((ok) => setImmediate(ok)); };

// --- the scripts ---------------------------------------------------------------
// the art and the giant, loaded afresh, with scrubbers that keep what they
// are told: the giant's is the one another made
function load() {
  const made = [];
  const Scrub = {
    another(seconds) {
      const s = {
        CATCH: seconds, calls: [], loaded: false, seconds: 0, aim: 0, at: 0, by: 0, muted: false,
        listen(win) { this.calls.push(['listen', win]); },
        make(win) { this.calls.push(['make', win]); },
        load(bytes) { this.calls.push(['load', bytes]); },
        seek(seconds) { this.calls.push(['seek', seconds]); this.aim = seconds; },
        cut(seconds) { this.calls.push(['cut', seconds]); this.aim = this.at = seconds; this.by = 0; },
        mute(on) { this.calls.push(['mute', on]); this.muted = on; },
        heard() { return this.at; },
      };
      made.push(s);
      return s;
    },
  };
  const ctx = vm.createContext({ Scrub });
  for (const file of ['giant-art.js', 'giant.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', file), 'utf8'), ctx, { filename: 'js/' + file });
  return { Giant: vm.runInContext('Giant', ctx), ART: vm.runInContext('GIANT_ART', ctx), made };
}

// --- the fake window -----------------------------------------------------------
// what was asked of it and what it made: each ask of the microphone, with
// its answers (ok gives a stream of one track, no refuses), the streams,
// the recorders, the blobs and the timers. no: no microphone to ask
function fake(no) {
  const w = { asked: [], answers: [], streams: [], recorders: [], blobs: [], timers: [], cleared: [] };
  const stream = () => {
    const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
    const s = { tracks, getTracks: () => tracks };
    w.streams.push(s);
    return s;
  };
  class MediaRecorder {
    constructor(s) {
      this.stream = s;
      this.state = 'inactive';
      this.mimeType = 'audio/webm';
      this.ondataavailable = null;
      this.onstop = null;
      this.starts = 0;
      this.stops = 0;
      w.recorders.push(this);
    }
    start() { this.starts++; this.state = 'recording'; }
    // what it recorded handed over, and then that it has stopped, later
    stop() {
      this.stops++;
      this.state = 'inactive';
      Promise.resolve().then(() => {
        this.ondataavailable({ data: { size: 5 } });
        this.onstop();
      });
    }
  }
  class Blob {
    constructor(parts, options) { this.parts = parts; this.type = options.type; this.bytes = new ArrayBuffer(5 * parts.length); w.blobs.push(this); }
    arrayBuffer() { return Promise.resolve(this.bytes); }
  }
  w.win = {
    navigator: no ? {} : { mediaDevices: { getUserMedia(c) { w.asked.push(c); return new Promise((ok, refuse) => w.answers.push({ ok: () => ok(stream()), no: () => refuse(new Error('refused')) })); } } },
    MediaRecorder: no ? undefined : MediaRecorder,
    Blob,
    setTimeout(fn, ms) { w.timers.push({ fn, ms }); return w.timers.length; },
    clearTimeout(id) { w.cleared.push(id); },
  };
  return w;
}

// a giant loaded into a fake window, and his scrubber
function giant(no) {
  const { Giant, ART, made } = load(), w = fake(no);
  Giant.load(ART, w.win);
  return { G: Giant, ART, w, s: made[0] };
}
// he stepped n times, dt s each
const steps = (G, n, dt) => { for (let i = 0; i < n; i++) G.step(dt); };
// the frames he went through, stepped dt s at a time until he has been at the same one k steps running
function walk(G, dt, k = 3) {
  const seen = [G.face];
  let same = 0;
  for (let i = 0; i < 1000 && same < k; i++) {
    G.step(dt);
    if (G.face === seen[seen.length - 1]) same++;
    else { seen.push(G.face); same = 0; }
  }
  return seen;
}
const names = (s) => s.calls.map((c) => c[0]);

(async () => {
  // --- the art -------------------------------------------------------------------
  {
    const { G, ART } = giant();
    check('his face: 23 frames, 64 x 32', ART.face.w === 64 && ART.face.h === 32 && ART.face.frames.length === 23 && G.faces.length === 23);
    check('the hand: 54 frames, 74 x 32', ART.hand.w === 74 && ART.hand.h === 32 && ART.hand.frames.length === 54 && G.hands.length === 54);
    const whole = (set, frames) => frames.every((g) => g.w === set.w && g.h === set.h && Object.prototype.toString.call(g.ink) === '[object Uint8Array]' && g.ink.length === g.w * g.h && g.ink.every((v) => v === 0 || v === 1));
    check('each a bitmap the framebuffer\'s sprite takes, its ink 1 and its paper 0', whole(ART.face, G.faces) && whole(ART.hand, G.hands));
    // a bitmap packed again as it was written: a bit a pixel, a byte's top bit first, each row whole bytes
    const pack = (g) => {
      const stride = Math.ceil(g.w / 8), bytes = new Uint8Array(stride * g.h);
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.ink[y * g.w + x]) bytes[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
      return Buffer.from(bytes).toString('hex');
    };
    check('each holds the very bits written for it', G.faces.every((g, i) => pack(g) === ART.face.frames[i]) && G.hands.every((g, i) => pack(g) === ART.hand.frames[i]));
    check('every frame is another', new Set(ART.face.frames).size === 23 && new Set(ART.hand.frames).size === 54);
    const left = (g) => { for (let x = 0; x < g.w; x++) for (let y = 0; y < g.h; y++) if (g.ink[y * g.w + x]) return x; return -1; };
    check('his ears grow a px a side a frame from REST down to 0', G.faces.slice(0, G.REST + 1).every((g, i) => left(g) === left(G.faces[G.REST]) - (G.REST - i)), G.faces.slice(0, 8).map(left).join(' '));
    // the ink under the bar, between its ends' brackets
    const tip = (g) => { const at = []; for (let x = 8; x < 66; x++) if (g.ink[6 * g.w + x]) at.push(x); return at; };
    check('the hand\'s finger\'s tip a px a frame along the bar, TIP[0] in the first and TIP[1] in the last',
      G.TIP[1] - G.TIP[0] === G.hands.length - 1 && G.hands.every((g, i) => tip(g).join() === String(G.TIP[0] + i)), tip(G.hands[0]).join() + ' .. ' + tip(G.hands[53]).join());
  }

  // --- nothing before a click ----------------------------------------------------
  {
    const { G, w, s } = giant();
    check('his scrubber is one of his own, with his catch, woken by the window\'s gestures', s.CATCH === G.CATCH && names(s).join() === 'listen' && s.calls[0][1] === w.win);
    G.mute(true);
    G.mute(false);
    G.hold(true);
    G.seek(0.5);
    steps(G, 20, 1 / 60);
    G.hold(false);
    G.shut();
    steps(G, 20, 1 / 60);
    check('nothing is asked of the microphone, nor any audio made, before he is clicked', w.asked.length === 0 && w.recorders.length === 0 && !names(s).includes('make'));
    check('and he is at rest', G.face === G.REST && !G.listening);
  }

  // --- a click, and another --------------------------------------------------------
  {
    const { G, w, s } = giant();
    G.toggle();
    check('clicked, he asks for the microphone, sound alone, and makes his scrubber\'s audio there', w.asked.length === 1 && w.asked[0].audio === true && Object.keys(w.asked[0]).length === 1 && names(s).includes('make') && s.calls.find((c) => c[0] === 'make')[1] === w.win);
    check('and listens, recording nothing until the microphone is given', G.listening && w.recorders.length === 0);
    G.step(G.EARS);
    check('his ears grow a frame each EARS', G.face === G.REST - 1);
    G.step(3 * G.EARS);
    check('as many as a step holds', G.face === G.REST - 4);
    steps(G, 10, G.EARS);
    check('out to 0', G.face === 0);
    w.answers[0].ok();
    await settle();
    const r = w.recorders[0], st = w.streams[0];
    check('given, the microphone is recorded', w.recorders.length === 1 && r.stream === st && r.starts === 1 && r.state === 'recording');
    check('for LONGEST at most', w.timers.length === 1 && w.timers[0].ms === G.LONGEST * 1000);
    G.seek(0.7);
    G.hold(true);
    G.step(1 / 60);
    check('while he listens the hand does nothing and his mouth stays shut', G.want === 0 && !names(s).includes('seek') && G.face === 0);
    G.hold(false);
    const before = s.calls.length;
    G.toggle();
    check('clicked again, he stops: the recorder stopped, the microphone let go, the timer too', !G.listening && r.stops === 1 && st.tracks.every((t) => t.stopped) && w.cleared.length === 1);
    await settle();
    const after = s.calls.slice(before);
    check('and what was recorded, all of it, is his sound', w.blobs.length === 1 && w.blobs[0].parts.length === 1 && w.blobs[0].type === 'audio/webm'
      && after.map((c) => c[0]).join() === 'cut,load' && after[0][1] === 0 && after[1][1] === w.blobs[0].bytes, after.map((c) => c[0]).join());
    check('with the hand back at the bar\'s left', G.want === 0);
    check('his ears go back in a frame each EARS', walk(G, G.EARS).join() === '0,1,2,3,4,5,6,7');
    w.timers[0].fn();
    check('the timer of a recording stopped does nothing', w.recorders.length === 1 && r.stops === 1);
  }

  // --- a refusal, no microphone, a late answer, the limit ----------------------------
  {
    const { G, w, s } = giant();
    G.toggle();
    steps(G, 3, G.EARS);
    w.answers[0].no();
    await settle();
    check('refused, he stops listening, records nothing and lets nothing go to his scrubber', !G.listening && w.recorders.length === 0 && w.streams.length === 0 && !names(s).includes('load'));
    check('and goes back to rest', walk(G, G.EARS).join() === '4,5,6,7');
  }
  {
    const { G, w, s } = giant(true);
    G.toggle();
    G.step(G.EARS);
    check('with no microphone to ask, a click does nothing', !G.listening && G.face === G.REST && !names(s).includes('make') && w.asked.length === 0);
  }
  {
    const { G, w } = giant();
    G.toggle();
    G.toggle();
    w.answers[0].ok();
    await settle();
    check('a microphone given after he has stopped is let go at once, unrecorded', w.recorders.length === 0 && w.streams[0].tracks.every((t) => t.stopped) && !G.listening);
    G.toggle();
    G.toggle();
    G.toggle();
    w.answers[1].ok();
    await settle();
    check('and one given to an ask before the last', w.recorders.length === 0 && w.streams[1].tracks.every((t) => t.stopped) && G.listening);
    w.answers[2].ok();
    await settle();
    check('the last ask\'s is recorded', w.recorders.length === 1 && w.recorders[0].stream === w.streams[2] && !w.streams[2].tracks[0].stopped);
  }
  {
    const { G, w, s } = giant();
    G.toggle();
    w.answers[0].ok();
    await settle();
    w.timers[0].fn();
    await settle();
    check('after LONGEST he stops by himself, the microphone let go, what he heard his sound', !G.listening && w.recorders[0].stops === 1 && w.streams[0].tracks[0].stopped && names(s).includes('load'));
  }

  // --- his sound, the hand and his mouth ------------------------------------------
  {
    const { G, s } = giant();
    G.seek(0.6);
    steps(G, 200, 1 / 60);
    check('with no sound the hand still goes where it is wanted', G.handFrame() === Math.round(0.6 * 53) && near(G.hand, 0.6, 1e-6));
    G.hold(true);
    steps(G, 30, 1 / 60);
    check('but his mouth stays shut', G.face === G.REST);
    G.hold(false);

    s.loaded = true;
    s.seconds = 10;
    G.seek(0);
    steps(G, 400, 1 / 60);
    G.seek(1);
    G.step(1 / 60);
    check('the hand eases toward where it is wanted, HAND_EASE of the way a 60 hz frame', near(G.hand, G.HAND_EASE, 1e-9));
    G.hand = 0;
    G.step(1 / 120);
    G.step(1 / 120);
    check('the same at any frame rate', near(G.hand, G.HAND_EASE, 1e-9));
    steps(G, 400, 1 / 60);
    check('and gets there: the last frame, its finger at the bar\'s right end', G.handFrame() === 53);
    G.seek(0.25);
    check('sought, his sound is wanted as far through', s.aim === 2.5);
    G.seek(-3);
    const lo = s.aim;
    G.seek(7);
    check('no further than either end', lo === 0 && s.aim === 10 && G.want === 1);
    G.seek(0.25);
    steps(G, 400, 1 / 60);
    check('the hand\'s frame as far through its 54 as it has got', G.handFrame() === Math.round(0.25 * 53));

    G.hold(true);
    check('held with a sound, his mouth opens a frame each MOUTH, from REST to OPEN', walk(G, G.MOUTH).join() === '7,8,9,10,11');
    G.seek(0.25 + 1 / 20);
    steps(G, 100, 1 / 60);
    check('the ring turns a frame for each twentieth of the sound the target goes', G.face === G.OPEN + 1 && near(G.ring, 1, 1e-3));
    G.seek(0.25 + 1 / 20 - 4 / 20);
    steps(G, 100, 1 / 60);
    check('back too, round from its first frame to its last', G.face === G.OPEN + G.RING - 3, G.face);
    G.seek(0.25 + 1 / 20 - 4 / 20 + 10 / 20);
    G.step(1 / 60);
    const way = G.ring;
    steps(G, 100, 1 / 60);
    check('going the shorter way round', way < G.RING - 3 && way > G.RING - 4 && G.face === G.OPEN + 7, way.toFixed(3) + ', ' + G.face);
    G.hold(false);
    s.by = 0.5;
    steps(G, 20, 1 / 60);
    check('let go, it stays open while the sound moves', G.face === G.OPEN + 7);
    s.by = -0.5;
    steps(G, 20, 1 / 60);
    check('back or on', G.face === G.OPEN + 7);
    s.by = G.QUIET / 2;
    check('and once it is at rest, shuts a frame each MOUTH, the ring stepping back with it', walk(G, G.MOUTH).join() === '18,17,16,15,14,13,12,11,10,9,8,7');
    s.by = 1;
    check('moving again, it opens again', walk(G, G.MOUTH).join() === '7,8,9,10,11');
    G.seek(G.want + 7 / 20);
    steps(G, 100, 1 / 60);
    s.by = 0;
    steps(G, 5, G.MOUTH);
    const part = G.face;
    G.hold(true);
    G.step(1 / 60);
    check('opened again part way through shutting, the ring is where his frame was', part === G.OPEN + 2 && G.face === part, part + ', ' + G.face);
  }
  {
    const { G, w, s } = giant();
    s.loaded = true;
    s.seconds = 10;
    G.hold(true);
    G.seek(0.5);
    s.by = 3;
    s.at = 2;
    steps(G, 6, G.MOUTH);
    check('open', G.face >= G.OPEN);
    G.toggle();
    check('clicked, his sound is stopped where it is heard and the hand let go', s.calls[s.calls.length - 2][0] === 'cut' && s.calls[s.calls.length - 2][1] === 2 && s.by === 0 && !G.held);
    const seen = walk(G, G.EARS, 30);
    check('and his mouth shuts and his ears grow, all the way to 0', seen[seen.length - 1] === 0 && seen.every((f, i) => i === 0 || f === seen[i - 1] - 1), seen.join());
    w.answers[0].ok();
    await settle();
    s.by = 0.5;
    G.shut();
    await settle();
    check('shut away while he listens, he stops, the microphone let go, what he heard his sound', !G.listening && w.recorders[0].stops === 1 && w.streams[0].tracks[0].stopped && names(s).includes('load'));
    s.by = 2;
    s.aim = 5;
    s.at = 4;
    const n = s.calls.length;
    G.shut();
    G.shut();
    check('shut away while his sound moves, it is stopped where it is heard, once', s.calls.length === n + 1 && s.calls[n][0] === 'cut' && s.calls[n][1] === 4);
  }

  // --- mute ------------------------------------------------------------------------
  {
    const { Giant: G, ART, made } = load(), w = fake();
    G.mute(true);
    G.load(ART, w.win);
    const s = made[0];
    check('muted before his scrubber is made, it is made muted', s.muted && names(s).join() === 'listen,mute');
    G.mute(false);
    G.mute(true);
    check('muting him mutes his scrubber, and back', s.calls.slice(-2).map((c) => c[1]).join() === 'false,true' && s.muted);
  }

  console.log(failures ? failures + ' failed' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
