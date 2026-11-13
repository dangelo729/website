// daedalus's body on the web: his head, his beard and his four arms with
// their mallets, and no bells, compiled with nothing else into
// ../../daedalus/body.wasm, which js/daedalus.js steps a frame at a time on
// the page. the body is daedalus's own (src/body: the rig, the model, the
// beard), drawn by second_dimension, on a canvas taller than his panel
// (shim/pins.h) so every arm's whole reach is on it. this file is his
// scene, scenes/scene_bell.cpp's with the bells taken out: where the scene
// hands the model each arm's bell, its strike point and its strike mark,
// this hands it a point of its own, the arm's aim, and strikes when the
// arm swings.
//
// his arms are kArm times their size on his panel, so they reach that much
// further: each arm's upper arm bone is given that scale, and every piece
// of the arm under it, its elbow, its forearm and its mallet, is drawn and
// pinned that much bigger, the root at its shoulder as it was. the model
// knows none of it, and aims the arm it thinks it has, so it is handed
// each aim brought in toward the shoulder by kArm (toModel): the arm as
// drawn then puts the mallet's face on the aim itself, as near as the
// shoulder holds still through the step. the shoulder is taken as last
// posed, and a strike's jolt moves it a pixel or so under the arm that
// step, so the face lands a quarter of that off its mark.
//
// an arm hunts the page's pointer. the pointer is in an arm's reach while
// it is between kNear and kFar px from the arm's shoulder, off his head
// (arms that go for a pointer on his face fold over it, and the body, one
// outline round all of it, is lost under them) and on the arm's own side
// of him, no more than kOverPx past his head's middle across or down (an
// arm reaching past it lies over his face too), the shoulder and the head
// taken where they are at rest, so his own sway never carries a pointer
// that holds still into reach or out of it. an arm
// with nothing in reach is home: its aim eases back to its rest point,
// where its bell's lip was. the pointer coming into reach of an arm at
// home, the arm swings at once: its aim goes fast at where the pointer is
// as the swing begins, its mark, and on coming within kHitPx of it (or
// after kSwingSec) it strikes: its aim is put on its mark, the model puts
// the mallet's face on the aim that frame and kicks the arm back off it,
// as it does off a bell, and the head jolts away. its aim stays on the
// mark for kStaySec, the mallet wobbling over it as it does over a bell's
// lip; then, the pointer out of reach, it goes home, and the pointer still
// in reach, it winds up: its aim eases to kWindPx short of the pointer,
// toward the shoulder, following it, for the arm's kWindSec, and it
// swings again, at where the pointer is then, or where it was last seen
// in reach if it has left. so the first strike comes as the pointer comes
// in and every one after it is wound up for, and a pointer that keeps
// moving is swung at where it was, and missed. every ease is the house
// approach, dt-correct.
//
// the model's sway follows the sound's level: here there is no sound, so
// it is handed a level of its own, kIdleRms, a slow sway all the time,
// and kLoudRms on a frame an arm strikes, the full sway, eased back down
// by the model.
//
// the picture lands in one canvas, a byte a pixel, 1 where the body lit it
// and 0 elsewhere, cleared each step: the body and its beard, then the
// mallets over them.
#include <math.h>
#include <stdint.h>
#include <string.h>

#include <Adafruit_GFX.h>

#include "body/body_model.h"
#include "body/body_rig.h"
#include "pins.h"

namespace {

// --- the canvas -------------------------------------------------------------------
// canvas px, the picture's: w x h, a byte each, drawn on the page at
// Daedalus.SCALE world px a px (js/daedalus.js)
constexpr int kW = kOledWidth;
constexpr int kH = kOledHeight;

uint8_t      ink_[kW * kH];
Adafruit_GFX gfx_(ink_, kW, kH);

// --- tune by eye -----------------------------------------------------------------
// how big his arms are against their size on his panel
constexpr float kArm = 1.25f;

// where each arm's bell's lip is on his panel, px from the head's pivot
// (kW / 2, kH / 2), kBodyArm's order (top left, top right, bottom left,
// bottom right), the right two the left two mirrored about the head's
// middle. an arm's rest point is its lip kArm times as far from its
// shoulder, so at rest it is posed as it is on his panel
constexpr float kLipX[2] = { -39.0f, -37.0f }; // the upper left arm's and the lower's
constexpr float kLipY[2] = { -6.0f, 21.5f };
constexpr float kLip[kBodyArms][2] = {
    { kW / 2 + kLipX[0], kH / 2 + kLipY[0] },
    { kW / 2 - kLipX[0] - 1.0f, kH / 2 + kLipY[0] },
    { kW / 2 + kLipX[1], kH / 2 + kLipY[1] },
    { kW / 2 - kLipX[1] - 1.0f, kH / 2 + kLipY[1] },
};

// an arm's reach, px from its shoulder to the pointer: the model's chain
// (the upper arm, then the elbow to the mallet's face at the rest grip)
// reaches from 7.3 px to 37.3, kArm times that as drawn, 9.1 to 46.6.
// the sway carries a shoulder a few px off its rest place: a pointer at
// the far end is then struck a pixel or two short, under the mallet's
// head still
constexpr float kNear = 11.5f;
constexpr float kFar  = 46.0f;

// his head as the arms keep off it: an ellipse about its middle at rest,
// the canvas's, the shell's 19 by 16 px and a mallet's head more
constexpr float kHeadRx = 22.0f;
constexpr float kHeadRy = 19.0f;

// how far past his head's middle, across and down, an arm still goes for
// a pointer on the other side of it
constexpr float kOverPx = 10.0f;

constexpr float kWindPx   = 10.0f; // how far short of the pointer an arm winds up, toward its shoulder
constexpr float kWindSec[kBodyArms] = { 0.40f, 0.52f, 0.46f, 0.58f }; // how long each winds up before it swings again: no two alike, so they fall out of step
constexpr float kSwingSec = 0.2f;  // the longest a swing lasts before it strikes where it has got to
constexpr float kStaySec  = 0.25f; // how long its aim stays on its mark after a strike
constexpr float kHitPx    = 1.5f;  // how near its mark a swing strikes
constexpr float kForce    = 0.9f;  // a strike's force, 0 .. 1, as a key's velocity

// how fast an arm's aim closes on where it is going, 1/s: going home,
// winding up and swinging
constexpr float kHomeRate  = 5.0f;
constexpr float kAimRate   = 12.0f;
constexpr float kSwingRate = 45.0f;

// the level the sway is handed while no arm strikes: a quarter of the full
// sway's (the model takes its square root)
constexpr float kIdleRms = 0.0625f * kLoudRms;

// a step's longest dt, s, as daedalus's main loop clamps its hitches
constexpr float kMaxDt = 0.1f;

// --- the hunt ---------------------------------------------------------------------
enum Phase : uint8_t { kHome, kWind, kSwing, kStay };

struct Hunt {
    Phase    phase;
    float    t;      // how long it has wound up, swung or stayed, s
    float    ax, ay; // its aim, canvas px: the strike point the model is handed
    float    sx, sy; // where the pointer was last seen in its reach
    float    tx, ty; // its mark: where its swing is going, or has struck
    uint32_t mark;   // its strikes so far: the model's strike mark
};

Hunt     hunt_[kBodyArms];
float    rest_[kBodyArms][2]; // each arm's rest point, canvas px
float    home_[kBodyArms][2]; // and its shoulder at rest
bool     pointing_ = false; // the page has a pointer
float    px_ = 0.0f, py_ = 0.0f; // and where, canvas px
uint32_t strikes_ = 0;      // every arm's strikes so far
uint32_t struck_  = 0;      // the arms that struck on the last step, a bit an arm

// arm i's shoulder as posed, canvas px
void shoulder(int i, float& x, float& y)
{
    bodyRig().world(kBodyArm[i].joint).apply(0.0f, 0.0f, &x, &y);
}

// canvas (x, y) as the model is handed it for arm i: brought in toward the
// arm's shoulder as posed by kArm
void toModel(int i, float& x, float& y)
{
    float jx, jy;
    shoulder(i, jx, jy);
    x = jx + (x - jx) / kArm;
    y = jy + (y - jy) / kArm;
}

// whether canvas (x, y) is on his head at rest
bool onHead(float x, float y)
{
    const float ex = (x - (kW / 2 - 0.5f)) / kHeadRx, ey = (y - (kH / 2 - 0.5f)) / kHeadRy;
    return ex * ex + ey * ey < 1.0f;
}

// whether canvas (x, y) is on arm i's side of him: the left arms' (0 and
// 2) left of kOverPx right of his head's middle, the right arms' the other
// way, and the upper arms' (0 and 1) above kOverPx under it, the lower
// arms' the other way
bool onSide(int i, float x, float y)
{
    const float across = (i & 1) ? x - (kW / 2 - 0.5f) : (kW / 2 - 0.5f) - x;
    const float down   = (i & 2) ? y - (kH / 2 - 0.5f) : (kH / 2 - 0.5f) - y;
    return across >= -kOverPx && down >= -kOverPx;
}

// the frame's picture: the body and its beard, then the mallets
void draw()
{
    memset(ink_, 0, sizeof ink_);
    bodyDraw(gfx_);
    bodyDrawMallets(gfx_);
}

// one frame of the hunt and the body, dt s on
void step(float dt)
{
    BodyBell bells[kBodyArms] = {};
    bool     struck = false;
    struck_ = 0;
    const bool off  = pointing_ && !onHead(px_, py_); // the page has a pointer, and it is off his head
    for (int i = 0; i < kBodyArms; i++) {
        Hunt&       h  = hunt_[i];
        const float jx = home_[i][0], jy = home_[i][1];
        const float dx = px_ - jx, dy = py_ - jy, d = sqrtf(dx * dx + dy * dy);
        const bool  in = off && d >= kNear && d <= kFar && onSide(i, px_, py_);
        if (in) {
            h.sx = px_;
            h.sy = py_;
        }
        if (h.phase == kHome && in) {
            h.phase = kSwing;
            h.t     = 0.0f;
            h.tx    = h.sx;
            h.ty    = h.sy;
        } else if (h.phase == kWind) {
            h.t += dt;
            if (h.t >= kWindSec[i]) {
                h.phase = kSwing;
                h.t     = 0.0f;
                h.tx    = h.sx;
                h.ty    = h.sy;
            }
        }
        // where its aim is going, and how fast
        float gx = rest_[i][0], gy = rest_[i][1], rate = kHomeRate;
        if (h.phase == kWind) {
            const float sx = h.sx - jx, sy = h.sy - jy, sd = sqrtf(sx * sx + sy * sy);
            const float back = fminf(kWindPx, fmaxf(sd - kNear, 0.0f));
            gx   = h.sx - (sd > 0.0f ? sx / sd : 0.0f) * back;
            gy   = h.sy - (sd > 0.0f ? sy / sd : 0.0f) * back;
            rate = kAimRate;
        } else if (h.phase == kSwing || h.phase == kStay) {
            gx   = h.tx;
            gy   = h.ty;
            rate = kSwingRate;
        }
        const float k = 1.0f - expf(-rate * dt);
        h.ax += (gx - h.ax) * k;
        h.ay += (gy - h.ay) * k;
        if (h.phase == kSwing) {
            h.t += dt;
            const float ex = h.tx - h.ax, ey = h.ty - h.ay;
            if (sqrtf(ex * ex + ey * ey) <= kHitPx || h.t >= kSwingSec) {
                h.ax = h.tx;
                h.ay = h.ty;
                ++h.mark;
                ++strikes_;
                struck_ |= 1u << i;
                struck  = true;
                h.phase = kStay;
                h.t     = 0.0f;
            }
        } else if (h.phase == kStay) {
            h.t += dt;
            if (h.t >= kStaySec) {
                h.phase = in ? kWind : kHome;
                h.t     = 0.0f;
            }
        }
        float mx = h.ax, my = h.ay;
        toModel(i, mx, my);
        bells[i] = { true, mx, my, h.mark, kForce };
    }
    bodyStep(dt, bells, struck ? kLoudRms : kIdleRms);
}

} // namespace

extern "C" {

// the body at rest, its arms at their size, every arm home on its rest
// point, and its first picture drawn
int body_init()
{
    bodyReset();
    const BodyShift still   = { 0.0f, 0.0f, 1.0f };
    const BodyShift face[kBodyFaceParts] = { still, still, still, still, still, still };
    bodyPlace(still, face);
    for (int i = 0; i < kBodyArms; i++) bodyBone(kBodyArm[i].upper).scale = kArm;
    bodyRig().pose();
    for (int i = 0; i < kBodyArms; i++) {
        float& jx = home_[i][0];
        float& jy = home_[i][1];
        shoulder(i, jx, jy);
        rest_[i][0] = jx + (kLip[i][0] - jx) * kArm;
        rest_[i][1] = jy + (kLip[i][1] - jy) * kArm;
        hunt_[i]    = { kHome, 0.0f, rest_[i][0], rest_[i][1], 0.0f, 0.0f, 0.0f, 0.0f, 0u };
    }
    pointing_ = false;
    strikes_  = 0;
    struck_   = 0;
    step(0.0f);
    draw();
    return 1;
}

// the page's pointer, canvas px, integers at pixel centres; and no pointer
void body_point(float x, float y)
{
    if (!isfinite(x) || !isfinite(y)) return;
    pointing_ = true;
    px_       = x;
    py_       = y;
}
void body_point_off() { pointing_ = false; }

// one frame, dt s on, and its picture
void body_step(float dt)
{
    if (!(dt > 0.0f)) dt = 0.0f;
    if (dt > kMaxDt) dt = kMaxDt;
    step(dt);
    draw();
}

const uint8_t* body_ink() { return ink_; }
int            body_w() { return kW; }
int            body_h() { return kH; }

// for the page's tests: every arm's strikes so far, the arms that struck
// on the last step, a bit an arm, and arm i's mallet's face as posed,
// canvas px (0 for an arm that is none)
int   body_strikes() { return (int)strikes_; }
int   body_struck() { return (int)struck_; }
float body_tip_x(int i)
{
    float x = 0.0f, y = 0.0f;
    if (i >= 0 && i < kBodyArms) bodyRig().world(kBodyArm[i].mallet).apply(kBodyMalletX, kBodyMalletY, &x, &y);
    return x;
}
float body_tip_y(int i)
{
    float x = 0.0f, y = 0.0f;
    if (i >= 0 && i < kBodyArms) bodyRig().world(kBodyArm[i].mallet).apply(kBodyMalletX, kBodyMalletY, &x, &y);
    return y;
}

} // extern "C"
