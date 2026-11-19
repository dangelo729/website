// node tools/test/film.test.js
//
// loads js/raster.js and js/film.js the way the page does, classic
// scripts, in a vm context with a scrubber that does only what the test
// tells it (the real one has its own test, tools/test/scrub.test.js), and
// hands the film a fake window: its fetch records what is asked for, its
// video element records its address and where it is sent, plays and stops
// when told, its image is loaded when the test says, and its canvas hands
// back the frame the test gives it and counts what is drawn into it.
// checks that nothing is asked of the server before the film is played or
// sought, and that then the scrubber's audio is made at once, the sound
// goes to the scrubber and the video is given to its element from memory;
// that each of the film's colours has a place in the framebuffer's
// palette and the table gives the nearest; that the picture is the poster
// until the video has a frame; that a pixel is decided by its own colour
// and its place alone; that the video keeps time with the sound, played on
// its own while the sound plays as recorded and sent after it only when
// it has run from it, and otherwise stopped and sought to where the sound
// is heard, one place at a time; that a frame is read only when the video
// has come to another and never while it is sought; and that playing,
// stopping, seeking, holding and muting are the scrubber's. then loads
// js/films.js as it stands and checks cicada's film: its video and its
// sound are where it says, and its size, length, colours and poster are
// whole. exits 1 on failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}
const settle = () => new Promise((ok) => setImmediate(ok));

// --- the scripts ---------------------------------------------------------------
// the framebuffer and the film, loaded afresh, with a scrubber that keeps
// what it is told and says what the test has it say
function load() {
  const scrub = {
    locked: false, loaded: false, aim: 0, said: 0, going: false, calls: [],
    make(win) { this.calls.push(['make', win]); },
    load(bytes) { this.calls.push(['load', bytes]); },
    play() { this.calls.push(['play']); this.going = true; },
    pause() { this.calls.push(['pause']); this.going = false; },
    hold(on) { this.calls.push(['hold', on]); },
    seek(seconds) { this.calls.push(['seek', seconds]); this.aim = seconds; },
    mute(on) { this.calls.push(['mute', on]); },
    playing() { return this.going; },
    heard() { return this.said; },
  };
  const ctx = vm.createContext({ Scrub: scrub, ImageData: class { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(4 * w * h); } } });
  for (const file of ['raster.js', 'film.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', file), 'utf8'), ctx, { filename: 'js/' + file });
  return { Film: vm.runInContext('Film', ctx), Framebuffer: vm.runInContext('Framebuffer', ctx), Scrub: scrub };
}

// --- the fake window -----------------------------------------------------------
// what it made, and frame, the r, g, b of each pixel the canvas hands
// back, or one r, g, b for them all
function fake() {
  const made = { videos: [], images: [], canvases: [], drawn: [], fetched: [], urls: [], frame: [0, 0, 0], fail: false };
  const document = {
    createElement(tag) {
      if (tag === 'video') {
        const v = {
          src: '', preload: '', muted: false, playsInline: false, paused: true, seeking: false, readyState: 0, plays: 0, pauses: 0, sent: [],
          play() { this.plays++; this.paused = false; return Promise.resolve(); },
          pause() { this.pauses++; this.paused = true; },
        };
        let at = 0;
        // sent somewhere, it is being sought until the test says it has got there
        Object.defineProperty(v, 'currentTime', { get: () => at, set(s) { at = s; v.sent.push(s); v.seeking = true; } });
        v.arrive = () => { v.seeking = false; };
        v.move = (s) => { at = s; };
        made.videos.push(v);
        return v;
      }
      if (tag === 'img') {
        const img = { src: '', complete: false, naturalWidth: 0 };
        made.images.push(img);
        return img;
      }
      const canvas = {
        width: 0, height: 0,
        getContext(kind, options) {
          canvas.asked = [kind, options];
          return {
            drawImage(from, x, y, w, h) { if (made.fail) throw new Error('tainted'); made.drawn.push([from, x, y, w, h]); },
            getImageData(x, y, w, h) {
              const data = new Uint8ClampedArray(4 * w * h), f = made.frame;
              for (let i = 0; i < w * h; i++) for (let k = 0; k < 3; k++) data[4 * i + k] = f.length === 3 ? f[k] : f[3 * i + k];
              return { data };
            },
          };
        },
      };
      made.canvases.push(canvas);
      return canvas;
    },
  };
  const win = {
    document,
    fetch(url) {
      made.fetched.push(url);
      return Promise.resolve({ arrayBuffer: () => Promise.resolve({ bytes: url }), blob: () => Promise.resolve({ blob: url }) });
    },
    URL: { createObjectURL(blob) { made.urls.push(blob); return 'blob:' + blob.blob; } },
  };
  return { made, win };
}

// a film of two colours, 100 s long at 30 frames a second
const TWO = { src: 'films/two.mp4', sound: 'films/two.m4a', w: 16, h: 9, fps: 30, seconds: 100, colours: ['#000000', '#ffffff'], poster: 'data:image/jpeg;base64,AAAA' };

(async () => {
  // --- loaded ----------------------------------------------------------------------
  const { Film, Framebuffer, Scrub } = load(), { made, win } = fake();
  const before = Framebuffer.PALETTE.length;
  Film.step();
  Film.size(8, 4);
  check('before it is loaded there is no picture, and nothing is played or sought', Film.picture === null && Film.at() === 0 && !Film.playing() && (Film.play(), Film.seek(0.5), Film.toggle(), Film.hold(true), made.videos.length === 0 && Scrub.calls.length === 0));
  Film.load(TWO, win);
  const video = made.videos[0], still = made.images[0];
  check('loaded, it has a video element, its poster and a canvas', made.videos.length === 1 && made.images.length === 1 && made.canvases.length === 1 && Film.video === video);
  check('nothing is asked of the server, and the scrubber is not made', video.src === '' && made.fetched.length === 0 && !Film.asked && Scrub.calls.length === 0);
  check('the poster is the film\'s', still.src === TWO.poster);
  check('the video is silent and plays inline', video.muted === true && video.playsInline === true);
  check('each colour has a place in the palette, never the page\'s own paper or ink', Framebuffer.PALETTE.length === before + 2);
  const black = Framebuffer.colour('#000000'), white = Framebuffer.colour('#ffffff');
  check('the table gives the nearest: black for the dark half, white for the light', Film.nearest.length === 32768 && Film.nearest[0] === black && Film.nearest[32767] === white
    && Film.nearest[15 << 10 | 15 << 5 | 15] === black && Film.nearest[16 << 10 | 16 << 5 | 16] === white);
  check('and nothing but the film\'s colours', Film.nearest.every((v) => v === black || v === white));
  Film.load({ ...TWO, src: 'other.mp4' }, win);
  check('a second load makes nothing more', made.videos.length === 1 && Film.film === TWO);

  // --- sized ---------------------------------------------------------------------
  Film.step();
  check('with no size there is no picture, and nothing is read', Film.picture === null && made.drawn.length === 0);
  Film.size(8, 4);
  const canvas = made.canvases[0], first = Film.picture;
  check('sized, the picture is that size, sixteen bits a pixel, and the canvas with it', first.w === 8 && first.h === 4 && first.px.BYTES_PER_ELEMENT === 2 && first.px.length === 32 && canvas.width === 8 && canvas.height === 4);
  check('the canvas is one read often', canvas.asked[0] === '2d' && canvas.asked[1].willReadFrequently === true);
  Film.size(8, 4);
  check('the same size again makes nothing', Film.picture === first);
  Film.size(0, 4);
  check('nor does no size at all', Film.picture === first);
  Film.size(64, 36);
  const half = Film.SPREAD / 2;
  let sum = 0, low = Infinity, high = -Infinity;
  for (const o of Film.grain) { sum += o; low = Math.min(low, o); high = Math.max(high, o); }
  check('each pixel has a threshold, within half of SPREAD either way and even about nothing', Film.grain.length === 64 * 36 && low >= -half && high <= half && low < -0.8 * half && high > 0.8 * half && Math.abs(sum / Film.grain.length) < 1,
    low + ' .. ' + high + ', mean ' + (sum / Film.grain.length).toFixed(2));

  // --- the poster ------------------------------------------------------------------
  Film.step();
  check('nothing is shown before the poster has loaded', Film.shown === null && made.drawn.length === 0);
  still.complete = true;
  still.naturalWidth = 16;
  made.frame = [255, 255, 255];
  Film.step();
  check('loaded, the poster is drawn across the canvas and shown', Film.shown === -1 && made.drawn.length === 1 && made.drawn[0][0] === still && made.drawn[0].slice(1).join() === '0,0,64,36');
  check('white, it is all white', Film.picture.px.every((v) => v === white));
  Film.step();
  Film.step();
  check('and it is read once', made.drawn.length === 1);
  Film.size(32, 18);
  Film.step();
  check('at another size it is read again', Film.shown === -1 && made.drawn.length === 2 && Film.picture.w === 32);

  // --- a pixel on its own ------------------------------------------------------------
  const W = 32, H = 18, N = W * H;
  const shade = (v) => { made.frame = [v, v, v]; Film.shown = null; Film.step(); return Array.from(Film.picture.px); };
  check('black is all black', shade(0).every((v) => v === black));
  check('dark enough is all black, and light enough all white', shade(127 - half - 8).every((v) => v === black) && shade(128 + half + 8).every((v) => v === white));
  const grey = shade(128), whites = grey.filter((v) => v === white).length;
  check('between the two, some pixels go each way by their places', whites > 0.3 * N && whites < 0.7 * N, whites + ' of ' + N + ' white');
  check('the same frame makes the same picture', shade(128).join() === grey.join());
  const one = new Uint8Array(3 * N).fill(128), spot = 5 * W + 11;
  one[3 * spot] = one[3 * spot + 1] = one[3 * spot + 2] = grey[spot] === white ? 0 : 255;
  made.frame = one;
  Film.shown = null;
  Film.step();
  const moved = Array.from(Film.picture.px).reduce((n, v, i) => n + (v !== grey[i] ? 1 : 0), 0);
  check('a frame with one pixel changed changes that pixel and no other', moved === 1 && Film.picture.px[spot] !== grey[spot], moved + ' changed');
  made.fail = true;
  const kept = Array.from(Film.picture.px);
  Film.shown = null;
  Film.step();
  check('a canvas that cannot be read leaves the picture as it was', Array.from(Film.picture.px).join() === kept.join());
  made.fail = false;

  // --- asked of the server -----------------------------------------------------------
  made.frame = [255, 255, 255];
  Film.shown = null;
  Film.step();
  const reads = () => made.drawn.length;
  let count = reads();
  check('before it is played it is not playing, and is at its start', !Film.playing() && !Film.waiting() && Film.at() === 0);
  Film.hold(true);
  Film.pause();
  check('held or stopped before it is asked for, the scrubber hears nothing', Scrub.calls.length === 0);
  Film.play();
  check('played, the scrubber\'s audio is made at once, in the press, and told to play', Film.asked && Scrub.calls.length === 2 && Scrub.calls[0][0] === 'make' && Scrub.calls[0][1] === win && Scrub.calls[1][0] === 'play');
  check('its sound and its video are asked of the server', made.fetched.join() === [TWO.sound, TWO.src].join());
  check('and it is playing, with nothing in yet', Film.playing() && Film.waiting());
  await settle();
  check('the sound goes to the scrubber', Scrub.calls.length === 3 && Scrub.calls[2][0] === 'load' && Scrub.calls[2][1].bytes === TWO.sound);
  check('and the video to its element from memory, played so the browser takes it in', made.urls.length === 1 && made.urls[0].blob === TWO.src && video.src === 'blob:' + TWO.src && video.plays === 1);
  Film.play();
  Film.seek(0.2);
  await settle();
  check('asked for again, nothing more is fetched or made', made.fetched.length === 2 && Scrub.calls.filter((c) => c[0] === 'make' || c[0] === 'load').length === 2);
  Film.step();
  check('with no frame of the video\'s in, the picture is still the poster, and the video is left alone', Film.shown === -1 && reads() === count && video.pauses === 0);

  // --- in time with the sound, stopped -------------------------------------------------
  Scrub.loaded = true;
  video.readyState = 4;
  video.sent.length = 0;
  Scrub.said = 0;
  made.frame = [0, 0, 0];
  Film.step();
  check('a frame in and the sound not playing as recorded, the video is stopped', video.pauses === 1 && video.paused);
  check('and its frame is read', Film.shown === 0 && reads() === count + 1 && made.drawn[count][0] === video && Film.picture.px.every((v) => v === black));
  check('and it is no longer waiting', Film.playing() && !Film.waiting());
  Film.step();
  check('the sound heard in the same frame, the video is not sent anywhere', video.sent.length === 0 && reads() === count + 1);
  Scrub.said = 2.5;
  Film.step();
  check('heard in another, the video is sent there', video.sent.join() === '2.5' && video.seeking);
  Scrub.said = 2.7;
  made.frame = [255, 255, 255];
  Film.step();
  Film.step();
  check('while it is sought it is sent nowhere else, and the picture stays as it is', video.sent.join() === '2.5' && reads() === count + 1 && Film.picture.px.every((v) => v === black));
  video.arrive();
  Film.step();
  check('there, its frame is read and it is sent on to where the sound is heard now', Film.shown === 75 && reads() === count + 2 && Film.picture.px.every((v) => v === white) && video.sent.join() === '2.5,2.7');
  video.arrive();
  Scrub.said = 1.2;
  Film.step();
  check('and back, when the sound goes back', Film.shown === 81 && video.sent.join() === '2.5,2.7,1.2');
  video.arrive();
  Scrub.said = 1000;
  Film.step();
  check('no further than a frame short of its end', Math.abs(video.sent[3] - (100 - 1 / 30)) < 1e-9);
  video.arrive();
  Scrub.said = 10;
  Film.step();
  video.arrive();
  Film.step();

  // --- in time with the sound, playing ---------------------------------------------------
  const plays = video.plays;
  video.sent.length = 0;
  Scrub.locked = true;
  Scrub.said = 10.02;
  Film.step();
  check('the sound playing as recorded, the video is sent where it is heard and played', video.sent.join() === '10.02' && video.plays === plays + 1 && !video.paused);
  video.arrive();
  video.move(10.05);
  Scrub.said = 10.06;
  Film.step();
  check('playing, it is left to play, and its frame read', video.sent.length === 1 && Film.shown === 301 && video.plays === plays + 1);
  count = reads();
  video.move(10.06);
  Scrub.said = 10.07;
  Film.step();
  check('the same frame is not read again', reads() === count && Film.shown === 301);
  video.move(10.2);
  Scrub.said = 10.2 + Film.DRIFT - 0.01;
  Film.step();
  check('run a little from the sound, it is left to play', video.sent.length === 1 && reads() === count + 1);
  Scrub.said = 10.2 + Film.DRIFT + 0.05;
  Film.step();
  check('run DRIFT from it, it is sent after it', video.sent.length === 2 && Math.abs(video.sent[1] - Scrub.said) < 1e-9 && !video.paused);
  video.arrive();
  Scrub.locked = false;
  Film.step();
  check('the sound sought or spinning down, the video is stopped again', video.paused);

  // --- the scrubber's -------------------------------------------------------------------
  const said = () => Scrub.calls[Scrub.calls.length - 1];
  Film.pause();
  check('stopped, the scrubber is', said()[0] === 'pause' && !Film.playing() && !Film.waiting());
  Film.toggle();
  check('toggled, it plays', said()[0] === 'play' && Film.playing());
  Film.toggle();
  check('and toggled again, stops', said()[0] === 'pause' && !Film.playing());
  Film.seek(0.5);
  check('sought, the sound is wanted that far through', said()[0] === 'seek' && said()[1] === 50 && Film.at() === 0.5);
  Film.seek(-1);
  check('no further than its start', said()[1] === 0 && Film.at() === 0);
  Film.seek(2);
  check('nor its end', said()[1] === 100 && Film.at() === 1);
  Film.hold(true);
  check('held, the scrubber is', said()[0] === 'hold' && said()[1] === true);
  Film.hold(false);
  check('and let go', said()[0] === 'hold' && said()[1] === false);
  Film.mute(true);
  check('muted, the scrubber is', said()[0] === 'mute' && said()[1] === true && video.muted === true);
  Film.mute(false);
  check('and the video stays silent with its sound back', said()[1] === false && video.muted === true);
  Scrub.loaded = false;
  Film.play();
  check('playing with its sound not in, it is waiting', Film.waiting());
  Scrub.loaded = true;
  video.readyState = 1;
  check('and with its video not in', Film.waiting());

  // --- sought before it is played --------------------------------------------------------
  {
    const { Film: late, Scrub: s } = load(), { made: m, win: w } = fake();
    late.load(TWO, w);
    late.seek(0.25);
    check('sought before it is played, the scrubber\'s audio is made and the film asked of the server', late.asked && s.calls[0][0] === 'make' && s.calls[1][0] === 'seek' && s.calls[1][1] === 25 && m.fetched.length === 2);
    check('and it is not playing', !late.playing() && !late.waiting() && late.at() === 0.25);
    late.hold(true);
    check('asked for, it can be held', s.calls[2][0] === 'hold');
  }

  // --- cicada's film -------------------------------------------------------------------
  {
    const ctx = vm.createContext({});
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'films.js'), 'utf8'), ctx, { filename: 'js/films.js' });
    const F = vm.runInContext('FILMS', ctx).cicada;
    check('cicada\'s film is there', !!F);
    const size = (file) => (fs.existsSync(path.join(ROOT, file)) ? fs.statSync(path.join(ROOT, file)).size : 0);
    check('its video is where it says', size(F.src) > 0, F.src + ', ' + (size(F.src) / 1048576).toFixed(1) + ' mb');
    check('and its sound', size(F.sound) > 0 && F.sound !== F.src, F.sound + ', ' + (size(F.sound) / 1048576).toFixed(1) + ' mb');
    check('its size, its frames a second and its length are whole', Number.isInteger(F.w) && Number.isInteger(F.h) && F.w > 0 && F.h > 0 && F.fps > 0 && F.seconds > 0, F.w + ' x ' + F.h + ' at ' + F.fps + ', ' + F.seconds + ' s');
    check('its colours are colours, black and then the paper first, no two the same',
      F.colours.every((c) => /^#[0-9a-f]{6}$/.test(c)) && F.colours[0] === '#000000' && new Set(F.colours).size === F.colours.length
      && parseInt(F.colours[1].slice(1), 16) === ((Framebuffer.PAPER & 255) << 16 | (Framebuffer.PAPER & 0xFF00) | Framebuffer.PAPER >> 16 & 255), F.colours.length + ' colours');
    check('its poster is a jpeg in a data: url', /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(F.poster) && F.poster.length > 1000, (F.poster.length / 1024).toFixed(0) + ' kb');
    const { Film: real, Framebuffer: fb } = load(), { win: w } = fake(), was = fb.PALETTE.length;
    real.load(F, w);
    check('loaded, every colour has a place of its own', fb.PALETTE.length === was + F.colours.length && new Set(real.nearest).size > 1 && new Set(real.nearest).size <= F.colours.length, new Set(real.nearest).size + ' in the table');
    const v0 = fb.colour(F.colours[0]), v1 = fb.colour(F.colours[1]);
    check('black is black and the lightest the paper', real.nearest[0] === v0 && real.nearest[32767] === v1);
  }

  console.log(failures ? failures + ' failed' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
