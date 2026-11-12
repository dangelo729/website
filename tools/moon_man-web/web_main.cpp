// moon_man on the web: one moon man's head, headless, compiled with nothing
// else into ../../moon_man/moon_man.wasm, which js/moon.js steps a frame at
// a time on the page. the voice's state comes in each step and moon_man's
// own models read it, as his sing scene feeds them: the mouth
// (face/mouth_model: the jaw, the lips' spread, the tongue) and the gaze
// (face/gaze_model: the head's turn). the mouth is his real 3d mouth, the
// lips' tube, the tongue and the mouth's dark back (face/mouth_tube_geom,
// face/tongue_geom), posed on the turned head and rendered by
// third_dimension in his outline look, the rig's numbers and its posing
// maths as face/mouth_tube.cpp has them. the eyes and the nose are flat
// sprites painted by hand, each on a seat of its own on the same head: the
// seat rides the turn, and second_dimension's blit draws the sprite through
// the turn's effect on its own axes, the right eye the left eye's art
// mirrored. each of the four lands in a canvas of its own, a byte a pixel
// in two planes, ink (lit) and mask (covered at all), with where the
// canvas's middle sits from the head's centre on screen, so the page can
// draw each one itself.
#include <math.h>
#include <stdint.h>
#include <string.h>

#include <SD_Draw.h>
#include <TD_MonoTarget.h>
#include <TD_Scene.h>

#include "face/gaze_model.h"
#include "face/mouth_model.h"
#include "face/mouth_tube_geom.h"
#include "face/tongue_geom.h"

namespace {

// --- the rig, as face/mouth_tube.cpp has it --------------------------------------
// the camera's eye kCamDistPx in front of the z = 0 plane, its focal the
// same, so a world unit there is a face px (a pixel of moon_man's panel);
// two wing lights mirrored about the view axis; the head's centre kFaceBack
// behind that plane, at full size; the lips' pixel mesh scaled to it,
// dropped below the head's centre and brought forward onto the face, its
// arc stretched across and up and down; the eyes' seats either side of the
// midline and above the centre; the outline look's crease; and a tongue
// less out than kTongueShow, which can't be seen, not drawn
constexpr float kCamDistPx        = 160.0f;
constexpr float kAmbient          = 0.2f;
constexpr float kWingAzRad        = 0.9f;
constexpr float kWingElevRad      = 0.35f;
constexpr float kWingIntensity    = 0.5f;
constexpr float kFaceBack         = 33.0f;
constexpr float kMouthScale       = 0.85f;
constexpr float kMouthDown        = 16.0f;
constexpr float kMouthFwd         = 28.0f;
constexpr float kMouthWidth       = 0.7f;
constexpr float kMouthHeight      = 1.2f;
constexpr float kFaceEyeApart     = 12.5f;
constexpr float kFaceEyeUp        = 5.75f;
constexpr float kOutlineCreaseRad = 0.8f;
constexpr float kTongueShow       = 0.02f;

// the gaze's cone, as face/gaze_model.cpp has it: the head never turns past it
constexpr float kGazeConeRad = 0.35f;

// --- the sprites' seats (tune by eye) ---------------------------------------------
// how far in front of the head's centre each flat sprite stands, face px at
// full size: an eye on moon_man's head's surface over its seat (15.2 there)
// and as proud of it as his eyes are (1); the nose on the midline at the
// height of his nose's centre, a little proud of his head's surface there
// (18.8)
constexpr float kEyeFwd  = 16.2f;
constexpr float kNoseUp  = -1.5f; // above the head's centre: under it
constexpr float kNoseFwd = 20.0f;

// --- the lips' canvas (measured) ----------------------------------------------------
// face px, fixed in size and place: the mouth open to 1.1 at every spread,
// with the tongue in and out, and the gaze at rest and at the cone's edge
// every way, covers -18 .. 18 across the head's centre and -2 .. 34 down
// from it; this holds that with 2 px of room all round. a mouth past it, a
// vibrato far wider than the voice's own swinging the jaw on past wide
// open, is cut at its edge
constexpr int   kLipsW  = 40;
constexpr int   kLipsH  = 40;
constexpr float kLipsCX = 20.0f; // where the head's centre falls on it
constexpr float kLipsCY = 4.0f;

// --- the sprites' canvases ----------------------------------------------------------
constexpr int kArtMax    = 64;                // an art's widest and tallest, sprite px
constexpr int kArtStride = (kArtMax + 7) / 8; // a plane's bytes a row, at the widest
constexpr int kCanvasMax = 256;               // a sprite's canvas's widest and tallest
constexpr int kRoom      = 2;                 // canvas px round the art at its biggest
constexpr int kSweep     = 32;                // directions round the cone a canvas is sized at
constexpr int kRings     = 4;                 // and rings out to its edge

// the voice's state as the page hands it in: the breath, voicing, hiss,
// the whistle and its pitch, the lips, the vibrato, the phoneme, the two
// constriction slots, n, then the tube's n diameters
constexpr int kStateHead = 11;

// the four features, as the exports number them, and the two arts
enum { kLips, kEyeL, kEyeR, kNose, kFeatures };
enum { kArtEye, kArtNose, kArts };

// a feature's canvas: w x h, a byte a pixel in each plane, ink 1 where lit
// and mask 1 where covered at all; its middle (x, y) from the head's centre
// on screen, face px, y down
struct Canvas : SD_Target {
    uint8_t* ink;
    uint8_t* mask;
    int16_t  w = 0, h = 0;
    float    x = 0.0f, y = 0.0f;

    Canvas(uint8_t* i, uint8_t* m) : ink(i), mask(m) {}

    int16_t width() const override { return w; }
    int16_t height() const override { return h; }

    void plot(int16_t px, int16_t py, bool on) override
    {
        const int at = py * w + px;
        ink[at]  = on ? 1 : 0;
        mask[at] = 1;
    }

    void clear()
    {
        memset(ink, 0, (size_t)w * (size_t)h);
        memset(mask, 0, (size_t)w * (size_t)h);
    }
};

uint8_t lipsInk_[kLipsW * kLipsH];
uint8_t lipsMask_[kLipsW * kLipsH];
uint8_t spriteInk_[3][kCanvasMax * kCanvasMax];
uint8_t spriteMask_[3][kCanvasMax * kCanvasMax];
Canvas  canvas_[kFeatures] = {
    Canvas(lipsInk_, lipsMask_),
    Canvas(spriteInk_[0], spriteMask_[0]),
    Canvas(spriteInk_[1], spriteMask_[1]),
    Canvas(spriteInk_[2], spriteMask_[2]),
};

// an art packed as a sprite: its two planes, second_dimension's layout,
// its pivot the top left pixel
struct Art {
    uint8_t   ink[kArtStride * kArtMax];
    uint8_t   mask[kArtStride * kArtMax];
    SD_Sprite sprite;
};
Art     art_[kArts];
uint8_t rows_[kArtMax * kArtMax]; // the page writes an art's rows here

// a seat on the head: its offset from the head's centre at rest, face px,
// y up, -z toward the camera; each sprite's art, and whether it is drawn
// mirrored
struct Seat {
    float x, y, z;
};
constexpr Seat kSeats[kFeatures] = {
    {0.0f, -kMouthDown, -kMouthFwd},
    {-kFaceEyeApart, kFaceEyeUp, -kEyeFwd},
    {kFaceEyeApart, kFaceEyeUp, -kEyeFwd},
    {0.0f, kNoseUp, -kNoseFwd},
};
constexpr int  kArtOf[kFeatures]  = {-1, kArtEye, kArtEye, kArtNose};
constexpr bool kMirror[kFeatures] = {false, false, true, false};

// the lips' plot: a pixel the render covers, lit or dark
void plotLips(void*, int16_t x, int16_t y, uint8_t on) { canvas_[kLips].plot(x, y, on != 0); }

TD_Object     lips_(mouthTubeMesh(kMouthTubeFace));
TD_Object     tongue_(tongueMesh(kMouthTubeFace));
TD_Object     plug_(mouthTubePlugMesh(kMouthTubeFace)); // the mouth's back
TD_Scene      scene_;
TD_Light      wing_; // the second wing; scene_.light is the first
TD_MonoTarget target_(plotLips, nullptr, kLipsW, kLipsH);
MouthModel    mouth_;
GazeModel     gaze_;
float         state_[kStateHead + wp::kMaxSections];
float         scale_ = 1.0f; // canvas px a sprite px, at rest

// carry o, pinned at seat `at`, with the head turned (yaw, pitch) about its
// centre, on the view axis kFaceBack behind the z = 0 plane: the seat turns
// through the same Rx(pitch) * Ry(yaw) the object does (mouth_tube.cpp's
// ride)
void ride(TD_Object& o, const Seat& at, float yaw, float pitch)
{
    const float cy = cosf(yaw), sy = sinf(yaw);
    const float cx = cosf(pitch), sx = sinf(pitch);
    const float x1 = cy * at.x + sy * at.z;
    const float z1 = -sy * at.x + cy * at.z;
    o.setRotation(pitch, yaw, 0.0f);
    o.setPosition(x1, cx * at.y - sx * z1, kFaceBack + sx * at.y + cx * z1);
}

// where seat `at` lands with the head turned (yaw, pitch), carried as ride
// carries it and seen by the camera: its offset from the head's centre on
// screen, face px, y down, and its depth from the camera's eye
struct Spot {
    float x, y, depth;
};
Spot spot(const Seat& at, float yaw, float pitch)
{
    const float cy = cosf(yaw), sy = sinf(yaw);
    const float cx = cosf(pitch), sx = sinf(pitch);
    const float x1    = cy * at.x + sy * at.z;
    const float z1    = -sy * at.x + cy * at.z;
    const float y1    = cx * at.y - sx * z1;
    const float depth = kCamDistPx + kFaceBack + sx * at.y + cx * z1;
    return {kCamDistPx * x1 / depth, -kCamDistPx * y1 / depth, depth};
}

// the mouth's back cut to this frame's view: the camera's eye carried into
// the lips' own space, their pose undone (mouth_tube.cpp's cutPlug)
void cutPlug()
{
    const TD_Object& l  = lips_;
    const float      dx = -l.x(), dy = -l.y(), dz = -kCamDistPx - l.z();
    const float      cp = cosf(l.rotX()), sp = sinf(l.rotX());
    const float      y1 = cp * dy + sp * dz, z1 = -sp * dy + cp * dz;
    const float      cy = cosf(l.rotY()), sy = sinf(l.rotY());
    const float      x2 = cy * dx - sy * z1, z2 = sy * dx + cy * z1;
    mouthTubePlugFill(kMouthTubeFace, x2 / l.scale(), y1 / l.scale(), z2 / l.scale());
}

// sprite f's matrix with the head turned (yaw, pitch): its own x and y axes
// (the head's x, and its y downward) through the turn, as the screen sees
// them by weak perspective at the seat's depth against its depth at rest,
// so a sprite px is scale_ canvas px at rest; mirrored in its own x for the
// right eye. the move is drawSprite's
SD_Xform turn(int f, float yaw, float pitch)
{
    const float k = scale_ * spot(kSeats[f], 0.0f, 0.0f).depth / spot(kSeats[f], yaw, pitch).depth;
    const float m = kMirror[f] ? -1.0f : 1.0f;
    SD_Xform    t;
    t.a  = m * k * cosf(yaw);
    t.b  = 0.0f;
    t.c  = -m * k * sinf(pitch) * sinf(yaw);
    t.d  = k * cosf(pitch);
    t.tx = 0.0f;
    t.ty = 0.0f;
    return t;
}

// sprite f drawn into its canvas, cleared, with the head turned (yaw,
// pitch): the art's middle on the canvas's middle, the canvas's middle on
// the seat
void drawSprite(int f, float yaw, float pitch)
{
    Canvas&          c  = canvas_[f];
    const SD_Sprite& s  = art_[kArtOf[f]].sprite;
    const Spot       at = spot(kSeats[f], yaw, pitch);
    c.x = at.x;
    c.y = at.y;
    c.clear();
    if (s.w < 1 || s.h < 1) return;
    SD_Xform    t  = turn(f, yaw, pitch);
    const float mx = 0.5f * (float)(s.w - 1), my = 0.5f * (float)(s.h - 1);
    t.tx = 0.5f * (float)(c.w - 1) - (t.a * mx + t.b * my);
    t.ty = 0.5f * (float)(c.h - 1) - (t.c * mx + t.d * my);
    sd_draw(c, s, t, SD_SAMPLE_2x2);
}

// the canvas of each sprite drawn from art `which`, just big enough for it
// at its biggest: the art's box through the turn at rest and on kRings rings
// out to the cone's edge, kSweep ways round each, and kRoom round that, held
// even (so a sprite px at an even scale lands on whole canvas px) and to
// kCanvasMax
void sizeCanvases(int which)
{
    const SD_Sprite& s = art_[which].sprite;
    for (int f = kEyeL; f < kFeatures; f++) {
        if (kArtOf[f] != which) continue;
        float hx = 0.0f, hy = 0.0f;
        for (int r = 0; r <= kRings; r++) {
            const float rad = kGazeConeRad * (float)r / (float)kRings;
            for (int i = 0; i < kSweep; i++) {
                const float    a = 6.2831853f * (float)i / (float)kSweep;
                const SD_Xform t = turn(f, rad * cosf(a), rad * sinf(a));
                hx = fmaxf(hx, fabsf(t.a) * 0.5f * (float)s.w + fabsf(t.b) * 0.5f * (float)s.h);
                hy = fmaxf(hy, fabsf(t.c) * 0.5f * (float)s.w + fabsf(t.d) * 0.5f * (float)s.h);
            }
        }
        const int w = 2 * ((int)ceilf(hx) + kRoom), h = 2 * ((int)ceilf(hy) + kRoom);
        canvas_[f].w = (int16_t)(w < kCanvasMax ? w : kCanvasMax);
        canvas_[f].h = (int16_t)(h < kCanvasMax ? h : kCanvasMax);
        canvas_[f].clear();
    }
}

// one frame drawn with the head turned (yaw, pitch): the lips, the tongue
// and the mouth's back ride it and render into the lips' canvas, and each
// sprite is drawn on its seat
void draw(float yaw, float pitch)
{
    TD_Object* const parts[] = {&lips_, &plug_, &tongue_};
    for (TD_Object* o : parts) ride(*o, kSeats[kLips], yaw, pitch);
    cutPlug();
    canvas_[kLips].clear();
    scene_.render(target_);
    for (int f = kEyeL; f < kFeatures; f++) drawSprite(f, yaw, pitch);
}

// feature f's canvas, f held to the four
Canvas& feature(int f) { return canvas_[f < 0 ? 0 : (f >= kFeatures ? kFeatures - 1 : f)]; }

} // namespace

extern "C" {

void moon_step(float dt, int sounding);

// the head made: the lips', the tongue's and the mouth's back's meshes, the
// scene in the outline look with its wing lights and its camera, the
// renderer's buffers and outline tables built on the meshes' rest shapes,
// the gaze seeded, the sprites drawn spriteScale canvas px a sprite px at
// rest, both arts empty, and a first frame, the mouth shut and the gaze home
void moon_init(float spriteScale, int seed)
{
    mouthTubeGeomInit();
    tongueGeomInit();
    scene_.add(lips_);
    scene_.add(tongue_);
    scene_.add(plug_);
    plug_.setMaterial(TD_MATERIAL_BLACK); // dark in every look
    plug_.setInk(false);                  // it hides what is behind; it draws no line
    TD_Object* const parts[] = {&lips_, &plug_, &tongue_};
    for (TD_Object* o : parts) o->setScale(kMouthScale);

    scene_.setRenderMode(TD_OUTLINE);
    scene_.setOutlineCrease(kOutlineCreaseRad);
    scene_.setAmbient(kAmbient);
    scene_.light.setIntensity(kWingIntensity);
    wing_.setIntensity(kWingIntensity);
    scene_.light.setDirection(kWingAzRad, kWingElevRad);
    wing_.setDirection(-kWingAzRad, kWingElevRad);
    scene_.addLight(wing_);
    scene_.camera.lookAt({0.0f, 0.0f, -kCamDistPx}, {0.0f, 0.0f, 0.0f});
    scene_.camera.setFocalPixels(kCamDistPx);
    scene_.camera.setCenterPixels(kLipsCX, kLipsCY);
    target_.setAutoClear(false); // the canvas is cleared each frame here

    uint32_t        nv = 0, nf = 0;
    const TD_Mesh* const meshes[] = {&mouthTubeMesh(kMouthTubeFace), &tongueMesh(kMouthTubeFace),
                                     &mouthTubePlugMesh(kMouthTubeFace)};
    for (const TD_Mesh* m : meshes) {
        nv += m->nverts;
        nf += m->nfaces;
    }
    scene_.renderer().reserve(nv, nf, 3);
    scene_.prebuildOutline(); // the tongue still showing, so its table is built too

    Canvas& lips = canvas_[kLips];
    lips.w = kLipsW;
    lips.h = kLipsH;
    lips.x = 0.5f * (float)kLipsW - kLipsCX;
    lips.y = 0.5f * (float)kLipsH - kLipsCY;

    gaze_.seed((uint32_t)seed);
    scale_ = spriteScale > 0.0f ? spriteScale : 1.0f;
    for (int i = 0; i < kArts; i++) {
        art_[i].sprite = {0, 0, 0, 0, art_[i].ink, art_[i].mask};
        sizeCanvases(i);
    }
    moon_step(0.0f, 0);
}

// the state buffer: kStateHead floats and up to wp::kMaxSections diameters
float* moon_state() { return state_; }

// one frame, dt seconds on: the voice's state from the state buffer when
// sounding, else a silent body (no breath, the lips open, no phoneme, no
// tube), into the mouth's and the gaze's models; the mouth's arc built
// round the origin and stretched to the face's proportions there, the lips
// filled on it, the tongue draped over the lower lip when it shows; and
// the frame drawn at the gaze's turn
void moon_step(float dt, int sounding)
{
    if (!(dt > 0.0f)) dt = 0.0f;
    wp::BodyState s;
    int           n = 0;
    if (sounding) {
        s.breath        = state_[0];
        s.voicing       = state_[1];
        s.hiss          = state_[2];
        s.whistle       = state_[3];
        s.whistleHz     = state_[4];
        s.lips          = state_[5];
        s.vibrato       = state_[6];
        s.phoneme       = state_[7] >= 0.0f && state_[7] < 255.0f ? (uint8_t)state_[7] : (uint8_t)wp::ph::none;
        s.slotActive[0] = state_[8] != 0.0f;
        s.slotActive[1] = state_[9] != 0.0f;
        n = state_[10] > 0.0f ? (state_[10] < (float)wp::kMaxSections ? (int)state_[10] : wp::kMaxSections) : 0;
    }
    mouth_.update(s, state_ + kStateHead, n, dt);
    gaze_.update(s, dt);

    MouthLoop arc;
    mouthLoopPoints(mouth_.params(), 0.0f, 0.0f, arc);
    for (int k = 0; k < MouthLoop::kN; k++) {
        arc.x[k] *= kMouthWidth;
        arc.y[k] *= kMouthHeight;
    }
    mouthTubeGeomFill(kMouthTubeFace, arc, 0.0f, 0.0f);
    const float out = mouth_.params().tongue01;
    tongue_.setVisible(out > kTongueShow);
    if (tongue_.visible()) tongueGeomFill(kMouthTubeFace, mouthTubeLowerLip(kMouthTubeFace), out);
    draw(gaze_.yaw(), gaze_.pitch());
}

// the rows buffer: an art's rows, a byte a sprite px, 0 clear, 1 paper, 2
// ink, up to kArtMax x kArtMax
uint8_t* moon_art_rows() { return rows_; }

// art `which` (0 the eye, 1 the nose) taken from the rows buffer, w x h,
// a row of w bytes at a time, and its sprites' canvases sized to it,
// cleared until the next step draws them; 1 if taken, 0 for a size past
// kArtMax, which leaves it as it was. 0 x 0 is no art, nothing drawn
int moon_art(int which, int w, int h)
{
    if (which < 0 || which >= kArts || w < 0 || h < 0 || w > kArtMax || h > kArtMax) return 0;
    Art&      a      = art_[which];
    const int stride = (w + 7) / 8;
    memset(a.ink, 0, sizeof a.ink);
    memset(a.mask, 0, sizeof a.mask);
    for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
            const uint8_t v   = rows_[y * w + x];
            const int     at  = y * stride + (x >> 3);
            const uint8_t bit = (uint8_t)(0x80u >> (x & 7));
            if (v == 1 || v == 2) a.mask[at] |= bit;
            if (v == 2) a.ink[at] |= bit;
        }
    }
    a.sprite.w = (int16_t)w;
    a.sprite.h = (int16_t)h;
    sizeCanvases(which);
    return 1;
}

// feature f (0 the lips, 1 the left eye, 2 the right eye, 3 the nose): its
// canvas's two planes, w x h bytes each, row by row; its size; and its
// middle from the head's centre on screen, face px, y down. the lips'
// canvas is face px; a sprite's is canvas px, spriteScale of them a sprite
// px at rest
uint8_t* moon_ink(int f) { return feature(f).ink; }
uint8_t* moon_mask(int f) { return feature(f).mask; }
int      moon_w(int f) { return feature(f).w; }
int      moon_h(int f) { return feature(f).h; }
float    moon_x(int f) { return feature(f).x; }
float    moon_y(int f) { return feature(f).y; }

// the head's turn this frame, radians: positive yaw turns his face to the
// screen's left, positive pitch looks up
float moon_yaw() { return gaze_.yaw(); }
float moon_pitch() { return gaze_.pitch(); }

} // extern "C"
