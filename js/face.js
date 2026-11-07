// --- the face ----------------------------------------------------------------
// cicada's face, on the bubble: two eyes with pupils, a nose and a mouth, each
// a bitmap from face-art.js drawn as a sprite (js/raster.js) the way the
// letters are, on its float position and scaled with the bubble: at radius
// 36 on whole pixels that is the art 1:1, at any other size it is resampled,
// never stamped. every feature trails its own place on the bubble at its own
// rate, so when the bubble is pulled about the face lags behind it, comes
// apart a little and settles back together. the frames ease the same way:
// while another blob is close the nose sniffs and the mouth falls open, the
// pupils follow the nearest blob (the pointer when there is none), and now
// and then the eyes blink. while the pointer has hold of him the nose
// sniffs and the mouth opens the same way, and the eyes stare, unblinking,
// until he is let go. the maths is cicada's, run in
// whole 60 hz steps; the face never asks the clock or the pointer itself,
// the world and the time gone by are handed to it.

const FACE = {
  STEP_S: 1 / 60, MAX_CATCHUP_S: 0.1, // cicada's rates are per 60 hz frame, whatever the screen's rate
  DEFAULT_RADIUS: 36,                 // the offsets below are for this radius and scale with the bubble
  MIN_HITS: 6,                        // the letters' threshold: 6 of a pixel's 16 points on ink light it
  EYES: { LEFT: { x: -15, y: -10 }, RIGHT: { x: 15, y: -10 }, LEFT_RATE: 0.09, RIGHT_RATE: 0.10, FRAME_RATE: 0.3,
          OPEN_FRAME: 6, BLINK: true, BLINK_MIN_S: 3, BLINK_MAX_S: 7 }, // cicada drew the lids but never shut them
  NOSE: { x: 0, y: 0, RATE: 0.05, SNIFF_RATE: 0.4, SNIFF_TOP: 3, PROXIMITY: 2.5 },
  MOUF: { x: 0, y: 22, RATE: 0.01, OPEN_SPEED: 0.15, OPEN_FRAME: 9, PROXIMITY: 2.5 },
  PUPILS: { TRACK: 'blob-then-pointer', ELLIPSE_W: 5, ELLIPSE_H: 3, OFFSET_X: 0, OFFSET_Y: -3,
            MAX_DISTANCE: 150, RATE: 0.15, LEFT_LAZINESS: 1.0, RIGHT_LAZINESS: 0.85, RECENTER_RATE: 0.1,
            MIN_EYE_FRAME: 4,              // below this the lid is under where a pupil sits, so mid-blink they go
            ART: ['.#.', '#.#', '.#.'] },  // the ring cicada's radius 1 circle made: four pixels round an empty middle
};

class Face {
  constructor(blob) {
    const c = blob.getCenter();
    this.scale = blob.radius / FACE.DEFAULT_RADIUS;
    const s = this.scale;
    const at = (o) => ({ x: c.x + o.x * s, y: c.y + o.y * s });
    this.leftEye = at(FACE.EYES.LEFT);
    this.rightEye = at(FACE.EYES.RIGHT);
    this.nose = at(FACE.NOSE);
    this.mouf = at(FACE.MOUF);
    // frames are floats that ease toward a target and are rounded to draw
    this.eyeFrame = FACE.EYES.OPEN_FRAME;
    this.eyeTarget = FACE.EYES.OPEN_FRAME;
    this.noseFrame = 0;
    this.noseTarget = 0;
    this.sniffUp = true;
    this.moufFrame = 0;
    this.moufTarget = 0;
    this.sniffing = false;
    this.mouthOpen = false;
    // held by the pointer
    this.held = false;
    // as in cicada the pupils start in the middle of the eye and rise to rest
    this.leftPupil = { x: 0, y: 0 };
    this.rightPupil = { x: 0, y: 0 };
    this.blinkIn = Face.blinkWait();
    this.owed = 0;
    // every frame as a sprite's bitmap, made once, not each draw
    const ink = (art) => art.frames.map((rows) => Framebuffer.ink(rows));
    this.ink = { eyes: ink(FACE_ART.eyes), nose: ink(FACE_ART.nose), mouf: ink(FACE_ART.mouf), pupil: Framebuffer.ink(FACE.PUPILS.ART) };
  }

  // dtS of time gone by runs that many whole steps, so calling this once a
  // frame on a 120 hz screen does not double the face's speed and calling it
  // once a 60 hz step runs exactly one. no dt at all is taken as one step.
  update(blob, world, dtS) {
    if (!(dtS >= 0)) dtS = FACE.STEP_S;
    // owed is counted in steps, so taking a whole one off is exact
    const most = Math.round(FACE.MAX_CATCHUP_S / FACE.STEP_S);
    this.owed = Math.min(this.owed + dtS / FACE.STEP_S, most);
    while (this.owed >= 1) {
      this.owed -= 1;
      this.step(blob, world);
    }
  }

  // carried at once, as the bubble's lock is on a resize; eased, the mouth
  // (a hundredth of the way a step) would take seconds to catch up
  moveBy(dx, dy) {
    for (const p of [this.leftEye, this.rightEye, this.nose, this.mouf]) { p.x += dx; p.y += dy; }
  }

  // one of cicada's frames: proximity, then eyes, nose, mouth, pupils
  step(blob, world) {
    const E = FACE.EYES, N = FACE.NOSE, M = FACE.MOUF;
    const c = blob.getCenter();
    this.scale = blob.radius / FACE.DEFAULT_RADIUS;
    const s = this.scale;

    // close is edge to edge, in units of the bubble's own radius; held is
    // the pointer's drag on this bubble's skin
    const near = world.nearestTo(blob);
    const edge = near ? near.edgeDist : Infinity;
    this.held = !!(world.drag && world.drag.blob === blob);
    this.sniffing = this.held || edge <= blob.radius * N.PROXIMITY;
    this.mouthOpen = this.held || edge <= blob.radius * M.PROXIMITY;

    this.blink();
    this.eyeFrame = Face.ease(this.eyeFrame, this.eyeTarget, E.FRAME_RATE);
    Face.follow(this.leftEye, c, E.LEFT, s, E.LEFT_RATE);
    Face.follow(this.rightEye, c, E.RIGHT, s, E.RIGHT_RATE);

    // a sniff runs up to the top frame and back down, over and over
    if (this.sniffing) {
      if (this.sniffUp) {
        this.noseTarget = N.SNIFF_TOP;
        if (this.noseFrame >= N.SNIFF_TOP - 0.1) this.sniffUp = false;
      } else {
        this.noseTarget = 0;
        if (this.noseFrame <= 0.1) this.sniffUp = true;
      }
    } else {
      this.noseTarget = 0;
    }
    this.noseFrame = Face.ease(this.noseFrame, this.noseTarget, N.SNIFF_RATE);
    Face.follow(this.nose, c, N, s, N.RATE);

    this.moufTarget = this.mouthOpen ? M.OPEN_FRAME : 0;
    this.moufFrame = Face.ease(this.moufFrame, this.moufTarget, M.OPEN_SPEED);
    Face.follow(this.mouf, c, M, s, M.RATE);

    // the pupils look from where the eyes are now, after they have moved
    const P = FACE.PUPILS;
    const t = Face.lookAt(near, world);
    if (t) {
      Face.look(this.leftPupil, this.leftEye, t, P.LEFT_LAZINESS);
      Face.look(this.rightPupil, this.rightEye, t, P.RIGHT_LAZINESS);
    } else {
      for (const p of [this.leftPupil, this.rightPupil]) {
        p.x += (P.OFFSET_X - p.x) * P.RECENTER_RATE;
        p.y += (P.OFFSET_Y - p.y) * P.RECENTER_RATE;
      }
    }
  }

  // open, wait a few seconds, shut; once nearly shut, open again. held,
  // the eyes stay open, a stare: a blink under way is undone and the wait
  // is not counted down, so one that was due comes once he is let go
  blink() {
    const E = FACE.EYES;
    if (!E.BLINK || this.held) {
      this.eyeTarget = E.OPEN_FRAME;
    } else if (this.eyeTarget === E.OPEN_FRAME) {
      this.blinkIn -= FACE.STEP_S;
      if (this.blinkIn <= 0) this.eyeTarget = 0;
    } else if (this.eyeFrame <= 0.5) {
      this.eyeTarget = E.OPEN_FRAME;
      this.blinkIn = Face.blinkWait();
    }
  }

  // every feature a sprite on its float position at the bubble's scale,
  // nothing rounded but the frame
  draw(fb) {
    const A = FACE_ART, I = this.ink, P = FACE.PUPILS, s = this.scale, m = FACE.MIN_HITS;
    const eyes = Face.frame(A.eyes, this.eyeFrame);
    fb.sprite(I.eyes[eyes], this.leftEye.x, this.leftEye.y, s, 0, 1, m);
    fb.sprite(I.eyes[eyes], this.rightEye.x, this.rightEye.y, s, 0, 1, m);
    // the pupil's ellipse is in art pixels: its offset scales with the
    // face, so the pupil stays inside the eye. the half pixel is cicada's:
    // its plus sat on a whole pixel, whose middle is half a pixel on, which
    // is also the middle of the art's eye ring
    if (eyes >= P.MIN_EYE_FRAME) {
      fb.sprite(I.pupil, this.leftEye.x + (this.leftPupil.x + 0.5) * s, this.leftEye.y + (this.leftPupil.y + 0.5) * s, s, 0, 1, m);
      fb.sprite(I.pupil, this.rightEye.x + (this.rightPupil.x + 0.5) * s, this.rightEye.y + (this.rightPupil.y + 0.5) * s, s, 0, 1, m);
    }
    fb.sprite(I.nose[Face.frame(A.nose, this.noseFrame)], this.nose.x, this.nose.y, s, 0, 1, m);
    fb.sprite(I.mouf[Face.frame(A.mouf, this.moufFrame)], this.mouf.x, this.mouf.y, s, 0, 1, m);
  }

  // cicada's frame easing: a fraction of the gap each step, snapped when tiny
  static ease(v, target, rate) {
    if (v === target) return v;
    const d = target - v;
    return Math.abs(d) < 0.01 ? target : v + d * rate;
  }

  // a feature eases toward the bubble's centre plus its offset at this size
  static follow(pos, c, o, s, rate) {
    pos.x += (c.x + o.x * s - pos.x) * rate;
    pos.y += (c.y + o.y * s - pos.y) * rate;
  }

  // the nearest other blob, else the pointer, as FACE.PUPILS.TRACK allows
  static lookAt(near, world) {
    const mode = FACE.PUPILS.TRACK;
    if (mode !== 'pointer' && near && near.blob) return near.blob.getCenter();
    if (mode !== 'blob' && world.pointerX != null && world.pointerY != null) return { x: world.pointerX, y: world.pointerY };
    return null;
  }

  // toward the target along an ellipse above the eye's middle, further out
  // the further away it is, until MAX_DISTANCE puts it on the rim
  static look(pupil, eye, t, laziness) {
    const P = FACE.PUPILS;
    const dx = t.x - eye.x, dy = t.y - eye.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d === 0) return;
    const k = Math.min(1, d / P.MAX_DISTANCE);
    const tx = P.OFFSET_X + dx / d * P.ELLIPSE_W * k;
    const ty = P.OFFSET_Y + dy / d * P.ELLIPSE_H * k;
    pupil.x += (tx - pupil.x) * P.RATE * laziness;
    pupil.y += (ty - pupil.y) * P.RATE * laziness;
  }

  static frame(art, f) {
    return Math.max(0, Math.min(art.frames.length - 1, Math.round(f)));
  }

  static blinkWait() {
    const E = FACE.EYES;
    return E.BLINK_MIN_S + Math.random() * (E.BLINK_MAX_S - E.BLINK_MIN_S);
  }
}
