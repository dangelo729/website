// upright on the web: saloon's piano as saloon plays it, its sim twin of the
// rig (saloon/extras/sim/sim/piano_rig.cpp) over upright's core, compiled
// with nothing else into ../../upright/upright.wasm, which
// js/piano-worklet.js plays a block at a time. the page only strikes keys:
// each key is let go RING after its last strike, counted in rendered
// blocks, so its damper lands on a plink already rung out and frees its
// voice. the same file builds natively for make measure.
#include <stdint.h>

#include "audio/piano_rig.h"
#include "sim/piano_rig_host.h"

namespace {

constexpr int   kFrames = 128;      // a block: upright's control block and a worklet's render quantum
constexpr float kRate   = 44100.0f; // upright's rate, and the page's audio context's

// a key's release, in seconds after its last strike: a held key at the
// page's knobs falls 60 db under its peak in 0.63 s at c4, the name's
// longest, and 0.21 s at a5 (make measure), so the damper lands on silence
constexpr float kRing       = 0.7f;
constexpr int   kRingBlocks = (int)(kRing * kRate / kFrames + 0.5f);

// the rig's levels ease to the knobs' at 8 a second: two seconds of silent
// blocks at init land them within 1e-7 of the knobs', so the first key
// already sounds the knobs' piano
constexpr int kSettleBlocks = (int)(2.0f * kRate / kFrames);

float out_[kFrames];
int   left_[128]; // each midi note's blocks to its release, 0 for none

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
}

// a key struck at velocity 1 .. 127, let go RING after this strike
void upright_strike(int note, int velocity)
{
    if (note < 0 || note > 127) return;
    pianoRigNoteOn((uint8_t)note, (uint8_t)velocity);
    left_[note] = kRingBlocks;
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
