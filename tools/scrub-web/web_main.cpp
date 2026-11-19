// the scrubber on the web: the scrubber's core (scrub_core.h) and room for
// the sound it plays, compiled with nothing else into
// ../../scrub/scrub.wasm, which js/scrub-worklet.js plays a block at a
// time. the page speaks in seconds, of the sound and of time: where the
// sound is wanted, how long the playhead takes to catch up, and where it
// is heard; the core counts samples.
#include <math.h>
#include <stdint.h>
#include <stdlib.h>

#include "scrub_core.h"

namespace {

constexpr int kFrames = 128; // a block: a worklet's render quantum

ScrubCore core_;
int16_t*  sound_ = nullptr; // the sound, the wasm's own to keep
double    hz_ = 44100.0;    // samples a second, the audio context's
float     out_[kFrames];

} // namespace

extern "C" {

// the playhead's catch, seconds: how long it takes to make up all but a
// third or so (1 / e) of how far it is behind
void scrub_catch(double seconds)
{
    core_.setRate(1.0 - exp(-1.0 / ((seconds > 1e-4 ? seconds : 1e-4) * hz_)));
}

// made for a context at hz samples a second, its catch seconds, with no
// sound yet
void scrub_init(double hz, double seconds)
{
    hz_ = hz;
    scrub_catch(seconds);
}

// room for a sound of count samples, where the page writes them: the
// sound before it is let go and the playhead goes to the start. 0 if
// there is no room
int16_t* scrub_sound(uint32_t count)
{
    core_.setBuffer(nullptr, 0);
    free(sound_);
    sound_ = (int16_t*)calloc(count, sizeof(int16_t));
    if (sound_) core_.setBuffer(sound_, count);
    return sound_;
}

// the sound wanted seconds in
void scrub_target(double seconds) { core_.setTarget(seconds * hz_); }

// the target moving on as fast as the sound was recorded times speed: 1
// plays, 0 stands
void scrub_speed(double speed) { core_.setSpeed(speed); }

// the sound put seconds in and at rest there, with no catching up
void scrub_cut(double seconds) { core_.cut(seconds * hz_); }

// the next block, kFrames samples in -1 .. 1
float* scrub_render()
{
    core_.render(out_, kFrames);
    return out_;
}

// where the sound is heard, seconds in; where it is wanted; how fast the
// playhead is going, of the sound as recorded, less than nothing going
// back; and whether it steps with its target, the sound's own samples
double scrub_playhead() { return core_.playhead() / hz_; }
double scrub_aim() { return core_.target() / hz_; }
double scrub_going() { return core_.step(); }
int    scrub_locked() { return core_.locked() ? 1 : 0; }

} // extern "C"
