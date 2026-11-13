// saloon's keys on the web: its piano keyboard, ten white keys and seven
// black, c to e, compiled with nothing else into ../../saloon/keys.wasm,
// which js/keys.js steps a frame at a time on the page. the keys are
// saloon's own (src/keys: the layout, the press and the rise), drawn by
// second_dimension from saloon's art, on canvases the keys fill
// (shim/pins.h). this file is their scene, scenes/scene_piano.cpp's with
// the sound, the hands and the face taken out: a note on presses its key,
// a note off lets it rise.
//
// the keys hold still but for that: they lie straight, as the art is
// drawn (saloon's detune knob at -1), at the layout's length (its damper
// knob at kDamper), whatever piano the page plays.
//
// saloon's panel shows white keys lit in the dark, their fronts along the
// top, under the hands. the page shows them as a player sees a piano, in
// ink on paper: each step the white keys are drawn alone on one canvas and
// the black keys alone on another (the other kind's sprite swapped for one
// that paints nothing, keysArtSet), and the picture is made of the two. a
// white key is its outline: every pixel that is not a white key's lit
// body and has one beside it, above it or under it is ink, so each key's
// front and sides are a line a pixel thick, two keys sharing the line
// between them. a black key is ink wherever its art is dark, over the
// white keys. a line of ink runs along the keys' backs, where they run
// off saloon's panel, and the rows are turned over, so the backs are
// along the picture's top and the fronts along its bottom.
//
// a second picture, the same size, holds the part of the first that is
// the outline of a key that glows, one that is down or the one the page's
// pointer is on (keys_point): a white key's, the ink beside its body; a
// black key's, its own outermost ink; and the line along the back of
// either. the page draws it over the first in another colour.
#include <math.h>
#include <stdint.h>
#include <string.h>

#include <Adafruit_GFX.h>

#include "keys/keys.h"
#include "keys/keys_art.h" // the sprites, for their sizes and to stand in for
#include "pins.h"

namespace {

// --- the canvases -----------------------------------------------------------------
// canvas px, the keys': w x keys' rows, a byte each. the picture is those
// rows and one more, the line along the keys' backs, drawn on the page at
// Keys.SCALE world px a px (js/keys.js)
constexpr int kW     = kOledWidth;
constexpr int kKeysH = kOledHeight;
constexpr int kH     = kKeysH + 1;

static_assert(kW == kKeysPitch * kKeysWhite + 1, "the canvas is the ten white keys across, the first's left edge on its first column");
static_assert(kKeysH == kKeysRows, "the canvas is a white key's rows down");

uint8_t      white_[kW * kKeysH]; // the white keys alone: kGfxLit, kGfxDark or 0 where none painted
uint8_t      black_[kW * kKeysH]; // the black keys alone
Adafruit_GFX whiteGfx_(white_, kW, kKeysH);
Adafruit_GFX blackGfx_(black_, kW, kKeysH);

uint8_t ink_[kW * kH];  // the picture: 1 ink, 0 paper
uint8_t glow_[kW * kH]; // the outlines of the keys that glow: 1 or 0

// each kind's sprite with nothing painted: the art's size and pivot, so
// the keys are laid out as they are, and an empty mask
const uint8_t   none_[sizeof white_key_mask > sizeof black_key_mask ? sizeof white_key_mask : sizeof black_key_mask] = {};
const SD_Sprite noWhite_ = { white_key.w, white_key.h, white_key.pivotX, white_key.pivotY, none_, none_ };
const SD_Sprite noBlack_ = { black_key.w, black_key.h, black_key.pivotX, black_key.pivotY, none_, none_ };

// the damper knob at which the keys are the layout's length
constexpr float kDamper = (1.0f - kKeysLenGrand) / (kKeysLenLong - kKeysLenGrand);

// a step's longest dt, s, as saloon's main loop clamps its hitches
constexpr float kMaxDt = 0.1f;

// the window's first note, a c: the seventeen notes from it are the keys.
// saloon's keys keep it to themselves, so it is read off each note on
int base_ = kKeysFirstNote;

// the drawn key the page's pointer is on (keys.h's order), or -1
int point_ = -1;

// the black keys' middle columns, canvas px, in note order, and the drawn
// key each is (keys.h's order); found once
float blackX_[kKeysBlack];
int   blackKey_[kKeysBlack];

// whether canvas (x, y) is a white key's lit body with no black key over it
bool body(int x, int y)
{
    if (x < 0 || x >= kW || y < 0 || y >= kKeysH) return false;
    return white_[y * kW + x] == kGfxLit && black_[y * kW + x] == 0;
}

// whether canvas (x, y) is a black key's dark; the row past the canvas's
// last, the line along the backs, counts as the key over it going on
bool dark(int x, int y)
{
    if (x < 0 || x >= kW || y < 0) return false;
    return black_[(y < kKeysH ? y : kKeysH - 1) * kW + x] == kGfxDark;
}

// whether drawn key k glows: it is down, or the pointer is on it
bool glows(int k) { return keysDown(k) > 0.0f || k == point_; }

// whether the white key whose body holds canvas column x glows, and the
// black key whose dark holds it
bool whiteGlows(int x) { return glows(x / kKeysPitch < kKeysWhite ? x / kKeysPitch : kKeysWhite - 1); }
bool blackGlows(int x)
{
    const float half = (float)(black_key.w / 2);
    for (int i = 0; i < kKeysBlack; i++)
        if (fabsf((float)x - blackX_[i]) <= half) return glows(blackKey_[i]);
    return false;
}

// the frame's two pictures, from the white keys and the black keys each
// drawn alone
void draw()
{
    memset(white_, 0, sizeof white_);
    keysArtSet("black_key", &noBlack_);
    keysDraw(whiteGfx_);
    keysArtSet("black_key", nullptr);
    memset(black_, 0, sizeof black_);
    keysArtSet("white_key", &noWhite_);
    keysDraw(blackGfx_);
    keysArtSet("white_key", nullptr);

    static const int kBeside[4][2] = { { -1, 0 }, { 1, 0 }, { 0, -1 }, { 0, 1 } };
    for (int y = 0; y <= kKeysH; y++) {
        // the canvas's rows turned over, the line along the backs first
        uint8_t* ink  = ink_ + (kH - 1 - y) * kW;
        uint8_t* glow = glow_ + (kH - 1 - y) * kW;
        for (int x = 0; x < kW; x++) {
            bool on = false, lit = false;
            if (y == kKeysH) {
                // the line along the backs: a glowing key's under its back
                on  = true;
                lit = dark(x, y - 1) ? blackGlows(x) : body(x, y - 1) && whiteGlows(x);
            } else if (black_[y * kW + x] != 0) {
                // a black key: ink where it is dark, and its outline where
                // that is its outermost
                on = dark(x, y);
                if (on && blackGlows(x))
                    for (const int* d : kBeside) lit = lit || !dark(x + d[0], y + d[1]);
            } else if (!body(x, y)) {
                // round a white key's body: ink, and a glowing key's
                // outline beside its body
                for (const int* d : kBeside) {
                    if (!body(x + d[0], y + d[1])) continue;
                    on  = true;
                    lit = lit || whiteGlows(x + d[0]);
                }
            }
            ink[x]  = on ? 1 : 0;
            glow[x] = on && lit ? 1 : 0;
        }
    }
}

} // namespace

extern "C" {

// the keys at rest, straight and at the layout's length, the black keys'
// places found, and their first pictures drawn
int keys_init()
{
    keysAllOff();
    keysSetDetune(-1.0f);
    keysSetDamper(kDamper);
    keysStep(0.0f);
    base_  = kKeysFirstNote;
    point_ = -1;
    int n  = 0;
    for (int note = kKeysFirstNote; note < kKeysFirstNote + kKeysCount && n < kKeysBlack; note++) {
        float y;
        bool  seen;
        if (keysOf((uint8_t)note) < kKeysWhite) continue;
        keysLanding((uint8_t)note, blackX_[n], y, seen);
        blackKey_[n++] = keysOf((uint8_t)note);
    }
    draw();
    return 1;
}

// a note on: its key goes down, the window moved to take the note in
void keys_on(int note)
{
    if (note < 0 || note > 127) return;
    const uint8_t drawn = keysNoteOn((uint8_t)note);
    if (drawn) base_ = note - (drawn - kKeysFirstNote);
}

// a note off: its key rises once no held note is on it; and every key let go
void keys_off(int note)
{
    if (note >= 0 && note <= 127) keysNoteOff((uint8_t)note);
}
void keys_all_off() { keysAllOff(); }

// the key the page's pointer is on, by its note in the window as it
// stands (keys_at's), or none for a note outside the window
void keys_point(int note)
{
    const int s = note - base_;
    point_      = s >= 0 && s < kKeysCount ? keysOf((uint8_t)(kKeysFirstNote + s)) : -1;
}

// one frame, dt s on, and its pictures
void keys_step(float dt)
{
    if (!(dt > 0.0f)) dt = 0.0f;
    if (dt > kMaxDt) dt = kMaxDt;
    keysStep(dt);
    draw();
}

// the note of the key at the picture's (x, y), in the window as it stands,
// or -1 off the picture: a black key's, within half its art's width of its
// middle column and in its rows, else the white key's whose middle column
// is nearest. the keys are taken where they lie at rest, and the line
// along the backs is the keys' under it
int keys_at(float x, float y)
{
    if (!(x >= 0.0f && x < (float)kW && y >= 0.0f && y < (float)kH)) return -1;
    // the canvas's row, the picture's turned back over
    const float px = floorf(x), py = (float)(kH - 1) - floorf(y), half = (float)(black_key.w / 2);
    float       lx, ly, least = (float)kW;
    bool        seen;
    int         white = -1;
    for (int n = kKeysFirstNote; n < kKeysFirstNote + kKeysCount; n++) {
        if (!keysLanding((uint8_t)n, lx, ly, seen)) continue;
        const float d = fabsf(px - lx);
        if (keysOf((uint8_t)n) >= kKeysWhite) {
            if (d <= half && py >= (float)(kKeysH - keysRows(true))) return base_ + n - kKeysFirstNote;
        } else if (d < least) {
            least = d;
            white = n;
        }
    }
    return white < 0 ? -1 : base_ + white - kKeysFirstNote;
}

const uint8_t* keys_ink() { return ink_; }
const uint8_t* keys_glow() { return glow_; }
int            keys_w() { return kW; }
int            keys_h() { return kH; }

// for the page's tests: the window's first note, and px the key of the
// window's note s (0 its first, a c, to 16) is down, 0 at rest
int   keys_base() { return base_; }
float keys_down(int s) { return s >= 0 && s < kKeysCount ? keysDown(keysOf((uint8_t)(kKeysFirstNote + s))) : 0.0f; }

} // extern "C"
