// --- the film ------------------------------------------------------------------
// cicada's film (js/films.js), played through the framebuffer
// (index.html). its sound is the scrubber's (js/scrub.js), played as a
// record under a hand is, and its picture keeps time with that: the
// browser decodes the video, which has no sound of its own, in a video
// element that is never put on the page, and the picture is the frame
// where the sound is heard now. while the sound plays as recorded the
// video plays on its own, sent after the sound only if it has run DRIFT
// from it; while the sound is sought, spinning up or coming to rest, the
// video is stopped and sought to where the sound is heard, one place at a
// time, so the picture goes back and on with the sound.
//
// what is seen is the picture, a bitmap of the framebuffer's v's as
// Framebuffer.prototype.blitPixels takes it (js/raster.js), in the film's
// own few colours, each a place in the framebuffer's palette: a frame is
// drawn into a canvas at the picture's size and read back, and each pixel
// takes the nearest of the colours to its own once it has been moved
// lighter or darker by its place's share of SPREAD. a pixel is decided on
// its own, by a threshold that is its place's and never changes, so what
// stands still in the film stands still in the picture; a dither that
// hands a pixel's miss on to its neighbours, as the photos' does
// (Framebuffer.ditherColour), would shimmer from frame to frame. the
// thresholds are interleaved gradient noise over the picture, and the
// nearest colour comes from a table of every colour a pixel can be at
// five bits a channel. until the film has a frame of its own to show, the
// picture is its poster, a still of it, made the same way. a frame is read
// only when the video has come to another, and the picture stays as it is
// while the video is sought, until the frame sought is in.
//
// nothing of the film is asked of the server until it is first played or
// sought. then its video and its sound are fetched whole, the video kept
// in memory so a seek never waits on the server, and the sound handed to
// the scrubber.

const Film = {
  SPREAD: 40, // levels of a channel's 256: how far apart, darkest to lightest, a pixel's place's threshold moves it before its nearest colour is taken
  DRIFT: 0.1, // s, how far the video may run from the sound, playing on its own, before it is sent after it

  win: null,      // the window it was loaded in
  film: null,     // the film, one of FILMS, once loaded
  video: null,    // its video element, never on the page
  still: null,    // its poster, an image
  canvas: null,   // the canvas a frame is read back through,
  pen: null,      // and its 2d context
  nearest: null,  // the v of the nearest of its colours, by five bits each of r, g and b
  grain: null,    // each of the picture's pixels' threshold, levels, half of SPREAD either way
  picture: null,  // { px, w, h }, once sized
  shown: null,    // what the picture shows: a frame of the film, counted from its start, -1 its poster, or null nothing yet
  asked: false,   // the film has been asked of the server

  // film made ready in win, once: each of its colours given its place in
  // the framebuffer's palette and the table of the nearest made, its
  // poster loaded, and its video element made, silent, with no address
  // yet, and the canvas
  load(film, win) {
    if (this.film) return;
    this.film = film;
    this.win = win;
    const doc = win.document;
    const rgb = film.colours.map((hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, n >> 8 & 255, n & 255]; });
    const v = film.colours.map((hex) => Framebuffer.colour(hex));
    this.nearest = new Uint16Array(32768);
    for (let i = 0; i < 32768; i++) {
      const r = (i >> 10) * 8 + 4, g = (i >> 5 & 31) * 8 + 4, b = (i & 31) * 8 + 4;
      let k = 0, least = Infinity;
      for (let c = 0; c < rgb.length; c++) {
        const q = rgb[c], d = (r - q[0]) * (r - q[0]) + (g - q[1]) * (g - q[1]) + (b - q[2]) * (b - q[2]);
        if (d < least) { least = d; k = c; }
      }
      this.nearest[i] = v[k];
    }
    this.still = doc.createElement('img');
    this.still.src = film.poster;
    const video = doc.createElement('video');
    video.playsInline = true;
    video.preload = 'auto';
    video.muted = true;
    this.video = video;
    this.canvas = doc.createElement('canvas');
  },

  // the picture w x h, whole px: made again at another size, the canvas
  // with it and each of its pixels' thresholds, with nothing shown in it
  size(w, h) {
    if (!this.film || w < 1 || h < 1 || (this.picture && this.picture.w === w && this.picture.h === h)) return;
    this.picture = { px: new Uint16Array(w * h), w, h };
    this.canvas.width = w;
    this.canvas.height = h;
    this.pen = this.canvas.getContext('2d', { willReadFrequently: true });
    this.grain = new Int8Array(w * h);
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
      const f = 0.06711056 * x + 0.00583715 * y, n = 52.9829189 * (f - Math.floor(f));
      this.grain[i] = Math.round(this.SPREAD * (n - Math.floor(n) - 0.5));
    }
    this.shown = null;
  },

  // the video kept in time with the sound, and the picture brought up to
  // the video. once the video has a frame in: while the sound plays as
  // recorded the video is played from where the sound is heard, and sent
  // there again only if it has run DRIFT from it; otherwise it is
  // stopped. then, when it is not being sought, its frame is read back if
  // that is another than the one shown, and, stopped, it is sent on to
  // where the sound is heard now if that is another frame again. with no
  // frame of the video's in, the picture is the poster, once that has
  // loaded, if nothing is shown yet
  step() {
    if (!this.picture) return;
    const video = this.video, fps = this.film.fps;
    if (this.asked && video.readyState >= 2) {
      const s = Math.min(Scrub.heard(), this.film.seconds - 1 / fps), stopped = !Scrub.locked;
      if (stopped) {
        if (!video.paused) video.pause();
      } else if (video.paused) {
        video.currentTime = s;
        this.go();
      } else if (!video.seeking && Math.abs(video.currentTime - s) > this.DRIFT) video.currentTime = s;
      if (video.seeking) return;
      const n = Math.floor(video.currentTime * fps);
      if (n !== this.shown) {
        this.read(video);
        this.shown = n;
      }
      if (stopped && Math.floor(s * fps) !== n) video.currentTime = s;
    } else if (this.shown === null && this.still.complete && this.still.naturalWidth) {
      this.read(this.still);
      this.shown = -1;
    }
  },

  // from, the video or the poster, drawn across the canvas and read back
  // into the picture: each pixel moved by its place's threshold, held to
  // a channel's range, and given the nearest of the film's colours. the
  // picture is left as it is if the canvas cannot be read
  read(from) {
    const p = this.picture, n = p.w * p.h, px = p.px, grain = this.grain, nearest = this.nearest;
    let d = null;
    try {
      this.pen.drawImage(from, 0, 0, p.w, p.h);
      d = this.pen.getImageData(0, 0, p.w, p.h).data;
    } catch (e) {
      return;
    }
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const o = grain[i];
      let r = d[j] + o, g = d[j + 1] + o, b = d[j + 2] + o;
      r = r < 0 ? 0 : r > 255 ? 255 : r;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      b = b < 0 ? 0 : b > 255 ? 255 : b;
      px[i] = nearest[r >> 3 << 10 | g >> 3 << 5 | b >> 3];
    }
  },

  // the film asked of the server, once, inside a press's handler: the
  // scrubber's audio made there, as browsers want, the sound fetched and
  // handed to it, and the video fetched whole and given to its element
  // from memory, played so the browser takes it in: the next step stops
  // it unless the sound is playing
  open() {
    if (this.asked) return;
    this.asked = true;
    const win = this.win, film = this.film;
    Scrub.make(win);
    win.fetch(film.sound).then((r) => r.arrayBuffer()).then((bytes) => Scrub.load(bytes)).catch(() => {});
    win.fetch(film.src).then((r) => r.blob()).then((blob) => {
      this.video.src = win.URL.createObjectURL(blob);
      this.go();
    }).catch(() => {});
  },

  // the video played, whether or not the browser lets it
  go() {
    const went = this.video.play();
    if (went && went.catch) went.catch(() => {});
  },

  // whether it is playing: its sound is, and has not run out
  playing() {
    return this.asked && Scrub.playing();
  },

  // whether it is playing with its sound or its video not in yet
  waiting() {
    return this.playing() && (!Scrub.loaded || this.video.readyState < 2);
  },

  // played on from where it is, or from its start once it has run out,
  // asked of the server first if it has not been. called inside a press's
  // handler
  play() {
    if (!this.film) return;
    this.open();
    Scrub.play();
  },

  // stopped: the sound spins down where it is
  pause() {
    if (this.asked) Scrub.pause();
  },

  // stopped if it is playing, played if not
  toggle() {
    if (this.playing()) this.pause();
    else this.play();
  },

  // sought to f of the way through, 0 .. 1, asked of the server first if
  // it has not been: the sound is wanted there, and goes there as fast as
  // it is far
  seek(f) {
    if (!this.film) return;
    this.open();
    Scrub.seek(Math.min(1, Math.max(0, f)) * this.film.seconds);
  },

  // held where it is sought, so it does not play on from there, or let go
  hold(on) {
    if (this.asked) Scrub.hold(on);
  },

  // how far through it is wanted, 0 .. 1
  at() {
    if (!this.film) return 0;
    return Math.min(1, Math.max(0, Scrub.aim / this.film.seconds));
  },

  // its sound off or on
  mute(on) {
    Scrub.mute(on);
  },
};
