// --- the face ----------------------------------------------------------------
// cicada's face, on the bubble: two eyes with pupils, a nose and a mouth, each
// a bitmap from face-art.js put down 1:1. every feature trails its own place
// on the bubble at its own rate, so when the bubble is pulled about the face
// lags behind it, comes apart a little and settles back together. the frames
// ease the same way: while another blob is close the nose sniffs and the
// mouth falls open, the pupils follow the nearest blob (the pointer when
// there is none), and now and then the eyes blink. the maths is cicada's, run
// in whole 60 hz steps; the face never asks the clock or the pointer itself,
// the world and the time gone by are handed to it.

const FACE = {
  STEP_S: 1 / 60, MAX_CATCHUP_S: 0.1, // cicada's rates are per 60 hz frame, whatever the screen's rate
  DEFAULT_RADIUS: 36,                 // the offsets below are for this radius and scale with the bubble
  EYES: { LEFT: { x: -15, y: -10 }, RIGHT: { x: 15, y: -10 }, LEFT_RATE: 0.09, RIGHT_RATE: 0.10, FRAME_RATE: 0.3,
          OPEN_FRAME: 6, BLINK: true, BLINK_MIN_S: 3, BLINK_MAX_S: 7 }, // cicada drew the lids but never shut them
  NOSE: { x: 0, y: 0, RATE: 0.05, SNIFF_RATE: 0.4, SNIFF_TOP: 3, PROXIMITY: 2.5 },
  MOUF: { x: 0, y: 18, RATE: 0.01, OPEN_SPEED: 0.15, OPEN_FRAME: 9, PROXIMITY: 2.5 },
  PUPILS: { TRACK: 'blob-then-pointer', RADIUS: 1, ELLIPSE_W: 5, ELLIPSE_H: 3, OFFSET_X: 0, OFFSET_Y: -3,
            MAX_DISTANCE: 150, RATE: 0.15, LEFT_LAZINESS: 1.0, RIGHT_LAZINESS: 0.85, RECENTER_RATE: 0.1,
            MIN_EYE_FRAME: 4 }, // below this the lid is under where a pupil sits, so mid-blink they go
};

class Face {
  constructor(blob) {
    const c = blob.getCenter();
    const s = blob.radius / FACE.DEFAULT_RADIUS;
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
    // as in cicada the pupils start in the middle of the eye and rise to rest
    this.leftPupil = { x: 0, y: 0 };
    this.rightPupil = { x: 0, y: 0 };
    this.blinkIn = Face.blinkWait();
    this.owed = 0;
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
    const s = blob.radius / FACE.DEFAULT_RADIUS;

    // close is edge to edge, in units of the bubble's own radius
    const near = world.nearestTo(blob);
    const edge = near ? near.edgeDist : Infinity;
    this.sniffing = edge <= blob.radius * N.PROXIMITY;
    this.mouthOpen = edge <= blob.radius * M.PROXIMITY;

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

  // open, wait a few seconds, shut; once nearly shut, open again
  blink() {
    const E = FACE.EYES;
    if (!E.BLINK) {
      this.eyeTarget = E.OPEN_FRAME;
    } else if (this.eyeTarget === E.OPEN_FRAME) {
      this.blinkIn -= FACE.STEP_S;
      if (this.blinkIn <= 0) this.eyeTarget = 0;
    } else if (this.eyeFrame <= 0.5) {
      this.eyeTarget = E.OPEN_FRAME;
      this.blinkIn = Face.blinkWait();
    }
  }

  draw(fb) {
    const A = FACE_ART, P = FACE.PUPILS;
    const eyes = Face.frame(A.eyes, this.eyeFrame);
    Face.blit(fb, A.eyes, eyes, this.leftEye);
    Face.blit(fb, A.eyes, eyes, this.rightEye);
    // cicada's radius 1 circle: four pixels round an empty middle
    if (eyes >= P.MIN_EYE_FRAME) {
      fb.circle(Math.round(this.leftEye.x + this.leftPupil.x), Math.round(this.leftEye.y + this.leftPupil.y), P.RADIUS, 1);
      fb.circle(Math.round(this.rightEye.x + this.rightPupil.x), Math.round(this.rightEye.y + this.rightPupil.y), P.RADIUS, 1);
    }
    Face.blit(fb, A.nose, Face.frame(A.nose, this.noseFrame), this.nose);
    Face.blit(fb, A.mouf, Face.frame(A.mouf, this.moufFrame), this.mouf);
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

  // centred on pos the way cicada rounds it: round(pos - w/2) + bx
  static blit(fb, art, i, pos) {
    fb.blitRows(art.frames[i], Math.round(pos.x - art.w / 2), Math.round(pos.y - art.h / 2), 1);
  }

  static blinkWait() {
    const E = FACE.EYES;
    return E.BLINK_MIN_S + Math.random() * (E.BLINK_MAX_S - E.BLINK_MIN_S);
  }
}
