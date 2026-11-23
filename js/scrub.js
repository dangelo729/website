// --- the scrubber ----------------------------------------------------------------
// a sound played as a record under a hand is, and whatever keeps time with
// it told where it is heard. it knows nothing of the page: it is given a
// sound and told where the sound is wanted, and whether that moves on,
// and it says where the sound is heard. the sound is in memory whole, and
// a playhead goes over it after a target (scrubby's sb::Playhead):
// each sample the playhead makes up a little of how far it is behind, so
// its speed, and the pitch with it, is how far it has to go. sought far,
// the sound races there and slows as it arrives; played, the target moves
// on at the sound's own speed and the playhead spins up to it, as a
// turntable does, then steps with it, the sound's own samples untouched;
// stopped, it spins down. CATCH is how long the playhead takes to make up
// all but a third or so of how far it is behind.
//
// the core is scrub/scrub.wasm, built by tools/scrub-web, run live in an
// audio worklet (js/scrub-worklet.js) at 44.1 khz, mono, through one
// master gain, in a context of its own beside the page's others
// (js/piano.js, js/voice.js, js/clack.js). the context is made by make,
// which is to be called inside a press's handler, as browsers want; a
// touch's end wakes it, as ios wants, and any gesture wakes it if it is
// not running (listen). the worklet and the wasm are asked of the server
// every time, never taken from the browser's cache, and the wasm's bytes
// go to the worklet to be compiled there. the sound comes as an encoded
// file's bytes (load): the browser decodes it at the context's rate, its
// channels are mixed to one of sixteen bits a sample, and that is handed
// to the worklet once the worklet is ready. a sound whose loudest sample
// is past full scale, as a lossy file's can be, is turned down to fit,
// and the master gain makes up for it, so it is as loud as it was and
// nothing of it is cut off on the way.
//
// before the sound is in, what is asked is kept: once it is, it is put
// where it was last sought with no catching up, and plays if it was
// played. the worklet says where the sound is heard a hundred times a
// second or so while that changes, and between two of those the page
// reckons it on at the speed it was going (heard), no further than AHEAD.

const Scrub = {
  CATCH: 0.3,    // s, how long the playhead takes to make up all but 1 / e of how far it is behind its target
  MASTER: 1,     // the master gain
  MUTE_S: 0.03,  // s, the time constant the master gain eases to silence and back by (mute)
  AHEAD: 0.05,   // s, the furthest past what the worklet last said that the playhead is reckoned on
  END: 0.05,     // s, how near the sound's end its target must be for the sound to have run out
  WORKLET: 'js/scrub-worklet.js',
  WASM: 'scrub/scrub.wasm',

  win: null,     // the window it was made in
  ctx: null,     // the audio context, once made
  node: null,    // the worklet's node, once loaded
  out: null,     // the master gain, once loaded
  ready: false,  // the worklet has the core made
  loaded: false, // and the sound is in it
  sound: null,   // the sound decoded and not yet handed to the worklet, an Int16Array
  seconds: 0,    // how long the sound runs, once decoded
  level: 1,      // how much the sound was turned down to fit sixteen bits, which the master gain makes up
  muted: false,  // the master gain is at 0 or easing there
  going: false,  // the sound is meant to be playing
  held: false,   // its target is held where it is: it does not move on while it is
  aim: 0,        // s, where the sound is wanted
  at: 0,         // s, where it was heard as the worklet last said,
  by: 0,         // how fast the playhead was going then, of the sound as recorded,
  when: 0,       // and the page's clock as it said so, ms
  locked: false, // the playhead steps with its target: the sound plays as recorded
  n: 0,          // how many times the page has put the target somewhere: what the worklet says of the target from before the last is not taken

  // wakes the audio on any of win's gestures, once it is made
  listen(win) {
    const wake = () => this.wake();
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) win.addEventListener(type, wake, true);
  },

  // the context resumed, if it is made and not running
  wake() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume();
  },

  // the audio made, once: the context at the core's rate, the worklet
  // loaded and the wasm fetched, its node made with the playhead's catch
  // and played through the master gain. no worklet, no sound
  make(win) {
    if (this.ctx || !win.AudioContext || !win.AudioWorkletNode) return;
    this.win = win;
    const ctx = new win.AudioContext({ sampleRate: 44100 });
    this.ctx = ctx;
    // the worklet by a query no cache has seen, the wasm checked with the
    // server before any copy is used, as the piano's are (js/piano.js)
    const fresh = '?' + Date.now();
    Promise.all([ctx.audioWorklet.addModule(this.WORKLET + fresh), win.fetch(this.WASM, { cache: 'no-cache' }).then((r) => r.arrayBuffer())])
      .then(([, wasm]) => {
        const node = new win.AudioWorkletNode(ctx, 'scrub', {
          numberOfInputs: 0,
          outputChannelCount: [1],
          processorOptions: { wasm, seconds: this.CATCH },
        });
        const out = ctx.createGain();
        out.gain.value = this.muted ? 0 : this.MASTER * this.level;
        node.connect(out);
        out.connect(ctx.destination);
        node.port.onmessage = (e) => this.hear(e.data);
        this.node = node;
        this.out = out;
      })
      .catch(() => {});
    this.wake();
  },

  // the sound, an encoded file's bytes: decoded at the context's rate,
  // its channels mixed to one of sixteen bits a sample, turned down to
  // fit if its loudest is past full scale, the master gain making up
  // for that, and handed to the worklet, or kept until the worklet is
  // ready. the bytes are the browser's from here
  load(bytes) {
    if (!this.ctx) return;
    new Promise((ok, no) => this.ctx.decodeAudioData(bytes, ok, no))
      .then((buffer) => {
        const count = buffer.length, channels = buffer.numberOfChannels, mono = new Int16Array(count);
        // its channels summed, or its one channel as it is
        let mix = buffer.getChannelData(0);
        if (channels > 1) {
          mix = new Float32Array(count);
          for (let c = 0; c < channels; c++) {
            const data = buffer.getChannelData(c);
            for (let i = 0; i < count; i++) mix[i] += data[i];
          }
        }
        let loudest = 0;
        for (let i = 0; i < count; i++) {
          const v = Math.abs(mix[i]);
          if (v > loudest) loudest = v;
        }
        this.level = Math.max(1, loudest / channels);
        const fit = 32767 / (channels * this.level);
        for (let i = 0; i < count; i++) mono[i] = Math.round(fit * mix[i]);
        if (this.out && !this.muted) this.out.gain.value = this.MASTER * this.level;
        this.sound = mono;
        this.seconds = buffer.duration;
        this.send();
      })
      .catch(() => {});
  },

  // the sound handed over whole to the worklet, once both are there
  send() {
    if (!this.ready || !this.sound) return;
    this.node.port.postMessage({ sound: this.sound }, [this.sound.buffer]);
    this.sound = null;
  },

  // what the worklet says: that its core is made, and the sound goes to
  // it; that the sound is in, and it is put where it was last sought, at
  // rest, and played if it is meant to be; or where the sound is heard
  // and wanted now, the target taken only if the page has not put it
  // somewhere since
  hear(m) {
    if (m.ready) {
      this.ready = true;
      this.send();
    } else if (m.loaded !== undefined) {
      this.loaded = m.loaded;
      if (!m.loaded) return;
      this.aim = Math.min(this.seconds, this.aim);
      this.cut(this.aim);
      this.tell();
    } else {
      this.at = m.at;
      this.by = m.going;
      this.locked = m.locked;
      this.when = this.win.performance.now();
      if (m.n === this.n) this.aim = m.aim;
    }
  },

  // the worklet told whether the target moves on: at the sound's own
  // speed while it is meant to be playing and is not held
  tell() {
    if (this.loaded) this.node.port.postMessage({ speed: this.going && !this.held ? 1 : 0 });
  },

  // the sound put seconds in and at rest there, with no catching up
  cut(seconds) {
    this.aim = this.at = seconds;
    this.by = 0;
    this.locked = false;
    this.n++;
    if (this.loaded) this.node.port.postMessage({ cut: seconds, n: this.n });
  },

  // played on from where it is wanted, or from its start once it has run
  // out
  play() {
    this.going = true;
    if (this.loaded && this.aim > this.seconds - this.END) this.cut(0);
    this.tell();
  },

  // stopped: its target stands, and the playhead comes to rest on it
  pause() {
    if (!this.going) return;
    this.going = false;
    this.tell();
  },

  // its target held where it is put, or let go to move on if the sound is
  // meant to be playing
  hold(on) {
    if (this.held === on) return;
    this.held = on;
    this.tell();
  },

  // the sound wanted seconds in, no further than its ends
  seek(seconds) {
    this.aim = Math.max(0, this.loaded ? Math.min(this.seconds, seconds) : seconds);
    this.n++;
    if (this.loaded) this.node.port.postMessage({ target: this.aim, n: this.n });
  },

  // whether it is playing: meant to be, and not run out
  playing() {
    return this.going && (!this.loaded || this.aim < this.seconds - this.END);
  },

  // where the sound is heard now, seconds in: where the worklet last said,
  // reckoned on at the speed the playhead was going, no further than
  // AHEAD; and before the sound is in, where it is wanted
  heard() {
    if (!this.loaded) return this.aim;
    const on = Math.min(this.AHEAD, Math.max(0, (this.win.performance.now() - this.when) / 1000));
    return Math.min(this.seconds, Math.max(0, this.at + this.by * on));
  },

  // muted or not: the master gain eased to 0 or back to MASTER, and what
  // makes up for a sound turned down, by the house approach, MUTE_S its
  // time constant. a sound made muted starts at 0
  mute(on) {
    this.muted = on;
    if (this.out) this.out.gain.setTargetAtTime(on ? 0 : this.MASTER * this.level, this.ctx.currentTime, this.MUTE_S);
  },

  // another scrubber, for another sound beside this one's: the same ways
  // and none of this one's state, each field as it starts, nothing made
  // yet, and its playhead's catch seconds
  another(seconds) {
    return Object.assign(Object.create(this), {
      CATCH: seconds,
      win: null, ctx: null, node: null, out: null, ready: false, loaded: false, sound: null, seconds: 0, level: 1,
      muted: false, going: false, held: false, aim: 0, at: 0, by: 0, when: 0, locked: false, n: 0,
    });
  },
};
