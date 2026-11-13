// upright on the web: saloon's piano as saloon plays it, its sim twin of the
// rig (saloon/extras/sim/sim/piano_rig.cpp) over upright's core, compiled
// with nothing else into ../../upright/upright.wasm, which
// js/piano-worklet.js plays a block at a time. the page plays it two ways.
// it strikes a key: the key is let go RING after its last strike, counted
// in rendered blocks, so its damper lands on a plink already rung out and
// frees its voice. and it holds a key, as a hand does: struck when it goes
// down and let go when it is, with the sustain pedal to hold the dampers
// off, and the five knobs turned under it. a key that is held is not let
// go by a strike's ring. the same file builds natively for make measure.
#include <stdint.h>

#include "audio/piano_rig.h"
#include "sim/piano_rig_host.h"

namespace {

constexpr int   kFrames = 128;      // a block: upright's control block and a worklet's render quantum
constexpr float kRate   = 44100.0f; // upright's rate, and the page's audio context's

// a key's release, in seconds after its last strike: a held key at the
// page's knobs falls 60 db under its peak in 0.63 s at c4, the longest of
// the name's in the scale the page starts in, and 0.21 s at a5 (make
// measure), so there the damper lands on silence; a key from a lower
// octave rings longer, 1.6 s at c1 and c2, and the damper cuts it short
constexpr float kRing       = 0.7f;
constexpr int   kRingBlocks = (int)(kRing * kRate / kFrames + 0.5f);

// the rig's levels ease to the knobs' at 8 a second: two seconds of silent
// blocks at init land them within 1e-7 of the knobs', so the first key
// already sounds the knobs' piano
constexpr int kSettleBlocks = (int)(2.0f * kRate / kFrames);

float out_[kFrames];
int   left_[128]; // each midi note's blocks to its release, 0 for none
bool  held_[128]; // each midi note's key is held down

} // namespace

extern "C" {

// the rig made, the five knobs landed in saloon's order (instrument, tone,
// size, detune, damper) and settled
void upright_init(float instrument, float tone, float size, float detune, float damper)
{
    const float five[5] = { instrument, tone, size, detune, damper };
    pianoRigInit();
    pianoRigSetKnobs(five);
    for (int i = 0; i < kSettleBlocks; i++) pianoRigRender(out_, kFrames);
    for (int& n : left_) n = 0;
    for (bool& h : held_) h = false;
}

// a key struck at velocity 1 .. 127, let go RING after this strike, or,
// held, when it is let go
void upright_strike(int note, int velocity)
{
    if (note < 0 || note > 127) return;
    pianoRigNoteOn((uint8_t)note, (uint8_t)velocity);
    if (!held_[note]) left_[note] = kRingBlocks;
}

// a key held down, struck at velocity 1 .. 127, until it is let go
void upright_on(int note, int velocity)
{
    if (note < 0 || note > 127) return;
    pianoRigNoteOn((uint8_t)note, (uint8_t)velocity);
    held_[note] = true;
    left_[note] = 0;
}

// a held key let go: its damper lands unless the pedal holds it off
void upright_off(int note)
{
    if (note < 0 || note > 127 || !held_[note]) return;
    pianoRigNoteOff((uint8_t)note);
    held_[note] = false;
}

// the sustain pedal: down lifts every damper, up lets them land on the
// keys already let go
void upright_pedal(int down) { pianoRigPedal(down != 0); }

// the five knobs turned, in saloon's order: every key sounding eases to
// the new piano, and a key struck after it lands on it whole
void upright_knobs(float instrument, float tone, float size, float detune, float damper)
{
    const float five[5] = { instrument, tone, size, detune, damper };
    pianoRigSetKnobs(five);
}

// the next block, kFrames samples in -1 .. 1, then every key whose ring is
// over let go for the block after
float* upright_render()
{
    pianoRigRender(out_, kFrames);
    for (int n = 0; n < 128; n++)
        if (left_[n] > 0 && --left_[n] == 0) pianoRigNoteOff((uint8_t)n);
    return out_;
}

} // extern "C"
