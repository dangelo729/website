// node tools/film/cut.js <original>
//
// cuts cicada's film for the page from its original, the video as it is
// on youtube (youtu.be/UaM-aSDtS_s) at 1080p. needs ffmpeg and ffprobe.
// its picture is written to cicada/cicada.mp4, W x H at FPS frames a
// second, h.264 in an mp4 with no sound, its index first, and a keyframe
// every KEY seconds, so a seek has one near; small, as the page shows it
// no bigger and in a few colours (js/film.js), and its grain smoothed a
// little, which the page's dither would otherwise show as a shimmer. its
// sound is written apart, to cicada/cicada.m4a, aac, its two channels
// mixed to one: the page plays it through the scrubber (js/scrub.js),
// which takes one. then the picture is read back, a frame every EVERY seconds
// at SAMPLE px wide, and the film's colours are taken over all of them:
// COLOURS less two by median cut (js/raster.js), and black and the
// page's paper, as a photo's are. its poster is the original's frame
// POSTER seconds in, a jpeg. writes js/films.js: where the picture and
// the sound are, the picture's size and frames a second, how long the
// film runs, its colours and its poster. prints what it wrote. exits 1 on
// failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const ctx = vm.createContext({ ImageData: class { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(4 * w * h); } } });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'raster.js'), 'utf8'), ctx, { filename: 'js/raster.js' });
const Framebuffer = vm.runInContext('Framebuffer', ctx);

const NAME = 'cicada';
const SRC = 'cicada/cicada.mp4';   // where its picture goes, from the page,
const SOUND = 'cicada/cicada.m4a'; // and its sound
const W = 640, H = 360;          // px, the film as cut
const FPS = 30;                  // its frames a second
const KEY = 2;                   // s between its keyframes
const CRF = 31;                  // x264's quality: more is smaller and rougher
const BITS = '96k';              // its sound's bit rate, one channel
const SMOOTH = '1.5:1.5:4:4';    // hqdn3d's strengths: its grain smoothed across the frame and from frame to frame
const COLOURS = 28;              // its colours, black and the paper among them
const EVERY = 4;                 // s between the frames its colours are taken over,
const SAMPLE = 128;              // each this many px wide
const POSTER = 25;               // s into the original, its poster's frame,
const POSTER_Q = 5;              // and the jpeg's quality, 2 best to 31 worst

function fail(why) {
  console.error(why);
  process.exit(1);
}
const run = (tool, args) => execFileSync(tool, ['-v', 'error', ...args], { maxBuffer: 1 << 30 });

const original = process.argv[2];
if (!original || !fs.existsSync(original)) fail('usage: node tools/film/cut.js <original>');

// its picture, and its sound
const out = path.join(ROOT, SRC), heard = path.join(ROOT, SOUND);
fs.mkdirSync(path.dirname(out), { recursive: true });
run('ffmpeg', ['-y', '-i', original, '-map_metadata', '-1', '-an',
  '-vf', `fps=${FPS},scale=${W}:${H}:flags=lanczos,hqdn3d=${SMOOTH}`,
  '-c:v', 'libx264', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', String(CRF),
  '-g', String(KEY * FPS), '-keyint_min', String(KEY * FPS), '-sc_threshold', '0', '-movflags', '+faststart', out]);
run('ffmpeg', ['-y', '-i', original, '-map_metadata', '-1', '-vn', '-c:a', 'aac', '-b:a', BITS, '-ac', '1', '-movflags', '+faststart', heard]);
const length = (file) => Number(run('ffprobe', ['-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
const seconds = length(heard);
if (!(seconds > 0) || !(length(out) > 0)) fail('no length read from ' + SRC + ' or ' + SOUND);

// its colours
const sh = Math.round(SAMPLE * H / W);
const frames = run('ffmpeg', ['-i', out, '-vf', `fps=1/${EVERY},scale=${SAMPLE}:${sh}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
if (!frames.length || frames.length % (3 * SAMPLE * sh)) fail('the frames read back are not whole: ' + frames.length + ' bytes');
const paper = Framebuffer.PAPER, hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const colours = [[0, 0, 0], [paper & 255, paper >> 8 & 255, paper >> 16 & 255], ...Framebuffer.medianCut(Float32Array.from(frames), COLOURS - 2)].map(hex);
if (colours.length !== COLOURS) fail('only ' + colours.length + ' colours');

// its poster
const poster = run('ffmpeg', ['-ss', String(POSTER), '-i', original, '-frames:v', '1', '-vf', `scale=${W}:${H}:flags=lanczos`, '-q:v', String(POSTER_Q), '-f', 'mjpeg', '-']);
if (poster.length < 1000) fail('no poster read from the original');

const film = { src: SRC, sound: SOUND, w: W, h: H, fps: FPS, seconds: Math.round(seconds * 1000) / 1000, colours, poster: 'data:image/jpeg;base64,' + poster.toString('base64') };
const head = [
  '// the films the page plays through its framebuffer (js/film.js), written',
  '// by tools/film/cut.js (node tools/film/cut.js <original>): cut there, not',
  '// here. each is where its video, which has no sound, and its sound are,',
  '// from the page, the size the video was cut to, px, its frames a second,',
  '// how long the film runs, seconds, its own few colours, black and the',
  '// page\'s paper first, and its poster, a still of it as a jpeg in a',
  '// data: url, so it is there with the page.',
];
fs.writeFileSync(path.join(ROOT, 'js', 'films.js'), head.join('\n') + '\nconst FILMS = ' + JSON.stringify({ [NAME]: film }, null, 2) + ';\n');

const kb = (n) => (n / 1024).toFixed(0) + ' kb';
console.log(SRC + ': ' + W + ' x ' + H + ' at ' + FPS + ' a second, ' + length(out).toFixed(3) + ' s, ' + kb(fs.statSync(out).size));
console.log(SOUND + ': ' + film.seconds + ' s, ' + kb(fs.statSync(heard).size));
console.log('colours: ' + colours.join(' '));
console.log('poster: ' + kb(poster.length) + ' from ' + POSTER + ' s in');
console.log('wrote js/films.js, ' + kb(fs.statSync(path.join(ROOT, 'js', 'films.js')).size));
