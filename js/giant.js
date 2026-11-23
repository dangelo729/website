// --- the giant -----------------------------------------------------------------
// scrubby's demo (index.html): cicada's giant, his face, and the hand under
// a bar beside him, which is the scrubber, in cicada's own frames
// (js/giant-art.js). it knows nothing of the page: the page draws his
// frame and the hand's, says when he is clicked, whether the hand is held
// and where along the bar it is wanted, and shuts him away.
//
// clicked, he listens: the microphone is asked for then, and never before,
// and what it hears is recorded until he is clicked again, or for LONGEST
// s, or until he is shut away; then the microphone is let go and what he
// heard is the sound his scrubber plays as a record under a hand is
// (js/scrub.js), a scrubber of his own beside the film's, CATCH its catch.
// refused, he is at rest again; with no microphone to ask, or no way to
// record one, a click does nothing. while he listens his sound is stopped
// where it is and the hand does nothing. a new sound comes with the hand
// at the bar's left, wanted at its start.
//
// his face is one of 23 frames: REST at rest, from there down to 0 his
// ears growing, and up from it to OPEN his mouth opening, and from OPEN
// to the last, his mouth open, a ring in it turning, RING frames round. he
// steps a frame at a time toward the frame he is wanted at, one each EARS
// s among his ears' frames and one each MOUTH s among his mouth's: 0
// while he listens, OPEN while his mouth is open, else REST. his mouth is
// open while there is a sound, he is not listening and the hand is held
// or the sound is still moving, its playhead going at QUIET of its own
// speed or more. open at OPEN or past, the ring turns after the sound's
// target, TURNS frames for the whole sound, round from its last frame to
// its first and back, going the shorter way round to where it is wanted
// by the house approach, RING_EASE of the way left each 60 hz frame;
// shutting, it steps back down with the rest. the hand is one of 54
// frames, its finger at a place along the bar from its left end, TIP[0]
// px across its bitmap in the first, to its right end, TIP[1] px across in
// the last, a px a frame: the one as far through them as the hand has
// got, which goes toward where the sound is wanted by the house approach,
// HAND_EASE of the way left each 60 hz frame.

const Giant = {
  CATCH: 0.15,     // s, his scrubber's playhead's catch: how long it takes to make up all but 1 / e of how far it is behind
  LONGEST: 30,     // s, the longest he listens
  EARS: 0.015,     // s, a step among his ears' frames, REST and under
  MOUTH: 0.03,     // s, a step among his mouth's, REST and over
  REST: 7,         // his frame at rest
  OPEN: 11,        // his frame with his mouth open, the ring's first
  RING: 12,        // the ring's frames, OPEN on
  TURNS: 20,       // ring frames the ring turns as its target goes the whole sound
  RING_EASE: 0.2,  // of the way left to where it is wanted the ring goes, each 60 hz frame
  HAND_EASE: 0.3,  // of the way left to where the sound is wanted the hand goes, each 60 hz frame
  QUIET: 0.02,     // of the sound's own speed, the playhead's under which the sound is at rest: where the scrubber's core fades it to nothing
  TIP: [10, 63],   // cicada px across the hand's bitmap, its finger's tip in its first frame and in its last

  win: null,       // the window it was loaded in
  faces: [],       // his frames, each { ink, w, h }, as Framebuffer.prototype.sprite takes it (js/raster.js)
  hands: [],       // the hand's
  scrub: null,     // his scrubber, once loaded
  muted: false,    // his sound is off
  face: 7,         // his frame
  since: 0,        // s since his frame last stepped, while it has somewhere to step to
  ring: 0,         // ring frames, how far round from OPEN the ring has turned, 0 .. RING
  ringTo: 0,       // and where it is wanted
  was: 0,          // where the sound was wanted when he last stepped, 0 .. 1 of the way through
  want: 0,         // where it is wanted now
  hand: 0,         // how far along the bar the hand has got, 0 .. 1
  held: false,     // the hand is held
  listening: false, // he is recording, or asking to
  asks: 0,         // how many times he has started listening: what comes of any but the last is let go
  stream: null,    // the microphone's stream, while he records
  recorder: null,  // what records it
  limit: null,     // the timer that stops him after LONGEST

  // the art unpacked and win kept, once, and his scrubber made, which any
  // of win's gestures wakes, muted if he was before it was made
  load(art, win) {
    if (this.scrub) return;
    this.win = win;
    this.faces = this.unpack(art.face);
    this.hands = this.unpack(art.hand);
    this.scrub = Scrub.another(this.CATCH);
    this.scrub.listen(win);
    if (this.muted) this.scrub.mute(true);
  },

  // a set's frames as bitmaps, ink 1 and paper 0, each from its hex: a bit
  // a pixel, the first pixel of a byte its top bit, each row a whole
  // number of bytes
  unpack(set) {
    const w = set.w, h = set.h, stride = Math.ceil(w / 8);
    return set.frames.map((hex) => {
      const ink = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const byte = parseInt(hex.substr(2 * (y * stride + (x >> 3)), 2), 16);
          ink[y * w + x] = byte >> (7 - (x & 7)) & 1;
        }
      }
      return { ink, w, h };
    });
  },

  // listening if he is not, stopped if he is. called inside a press's
  // handler, as browsers want of the microphone and of sound
  toggle() {
    if (this.listening) this.stop();
    else this.listen();
  },

  // listening, if there is a microphone to ask for and a way to record
  // it: his sound stopped where it is, the hand let go, his scrubber's
  // audio made, and the microphone asked for. given, what it hears is
  // recorded, for LONGEST s at most; refused, he stops. a microphone
  // given once he has stopped, or started again, is let go at once, and
  // what was recorded before he started again is let go too
  listen() {
    const win = this.win, devices = win.navigator && win.navigator.mediaDevices;
    if (!devices || !devices.getUserMedia || !win.MediaRecorder) return;
    this.still();
    this.held = false;
    this.scrub.make(win);
    this.listening = true;
    const ask = ++this.asks;
    devices.getUserMedia({ audio: true }).then((stream) => {
      if (ask !== this.asks || !this.listening) {
        this.free(stream);
        return;
      }
      this.stream = stream;
      const recorder = new win.MediaRecorder(stream), chunks = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = () => {
        if (ask !== this.asks || !chunks.length) return;
        new win.Blob(chunks, { type: recorder.mimeType }).arrayBuffer()
          .then((bytes) => { if (ask === this.asks) this.take(bytes); })
          .catch(() => {});
      };
      this.recorder = recorder;
      recorder.start();
      this.limit = win.setTimeout(() => { if (ask === this.asks) this.stop(); }, this.LONGEST * 1000);
    }).catch(() => { if (ask === this.asks) this.stop(); });
  },

  // stopped listening: the timer let go, the recorder stopped, which
  // hands what it recorded to take once it has it all, and the
  // microphone let go
  stop() {
    if (!this.listening) return;
    this.listening = false;
    if (this.limit !== null) this.win.clearTimeout(this.limit);
    this.limit = null;
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.recorder = null;
    if (this.stream) this.free(this.stream);
    this.stream = null;
  },

  // a stream's tracks stopped: its microphone let go
  free(stream) {
    for (const track of stream.getTracks()) track.stop();
  },

  // what he recorded, an encoded file's bytes, his sound: the hand back at
  // the bar's left, the sound wanted at its start, and the bytes handed to
  // his scrubber, which decodes them
  take(bytes) {
    this.want = 0;
    this.scrub.cut(0);
    this.scrub.load(bytes);
  },

  // his sound put at rest where it is heard, at once, if it is moving or
  // wanted anywhere else
  still() {
    const s = this.scrub;
    if (s.loaded && (s.by !== 0 || s.aim !== s.at)) s.cut(s.heard());
  },

  // shut away: the hand let go, his listening stopped and his sound
  // stilled
  shut() {
    this.held = false;
    this.stop();
    this.still();
  },

  // the hand held, or let go
  hold(on) {
    this.held = on;
  },

  // the hand wanted f of the way along the bar, 0 .. 1, and his sound as
  // far through; while he listens, nothing
  seek(f) {
    if (this.listening) return;
    this.want = Math.min(1, Math.max(0, f));
    this.scrub.seek(this.want * this.scrub.seconds);
  },

  // whether his mouth is wanted open: there is a sound, he is not
  // listening and the hand is held or the sound is moving
  opens() {
    const s = this.scrub;
    return s.loaded && !this.listening && (this.held || Math.abs(s.by) >= this.QUIET);
  },

  // the hand's frame: as far through them as it has got along the bar
  handFrame() {
    return Math.round(this.hand * (this.hands.length - 1));
  },

  // dt s on: the hand toward where the sound is wanted; and his face, his
  // mouth open at OPEN or past, the ring turned after where the sound is
  // wanted, and otherwise a frame at a time toward the frame he is wanted
  // at, as many as dt holds, the ring where that frame has it
  step(dt) {
    const ease = (k) => 1 - Math.pow(1 - k, 60 * dt), n = this.RING, wrap = (r) => (r % n + n) % n;
    this.hand += (this.want - this.hand) * ease(this.HAND_EASE);
    const open = this.opens();
    if (open && this.face >= this.OPEN) {
      this.ringTo = wrap(this.ringTo + this.TURNS * (this.want - this.was));
      let d = this.ringTo - this.ring;
      d -= n * Math.round(d / n);
      this.ring = wrap(this.ring + d * ease(this.RING_EASE));
      this.face = this.OPEN + Math.round(this.ring) % n;
      this.since = 0;
    } else {
      const to = this.listening ? 0 : open ? this.OPEN : this.REST;
      this.since += dt;
      while (this.face !== to) {
        const next = this.face + (to > this.face ? 1 : -1), each = Math.max(this.face, next) > this.REST ? this.MOUTH : this.EARS;
        if (this.since < each) break;
        this.since -= each;
        this.face = next;
      }
      if (this.face === to) this.since = 0;
      this.ring = this.ringTo = Math.max(0, this.face - this.OPEN);
    }
    this.was = this.want;
  },

  // his sound off or on
  mute(on) {
    this.muted = on;
    if (this.scrub) this.scrub.mute(on);
  },
};
