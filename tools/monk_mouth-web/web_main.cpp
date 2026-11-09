// monk_mouth on the web: one wp::Voice, the articulatory voice, a tube
// shaped like a vocal tract with air moving through it, compiled with
// nothing else into ../../monk_mouth/monk_mouth.wasm, which
// js/voice-worklet.js plays a block at a time. the voice is made in place
// in a static buffer, so nothing is ever taken from a heap. phones are
// written into the text buffer and then spoken, a line with its own notes
// and breath. the rest are the voice's own live setters, a few fields of
// its tuning by number, and the block.
#include <new>
#include <stdint.h>

#include "core/wp_voice.h"

namespace {

constexpr int   kFrames = 128;      // a block: the voice's control block and a worklet's render quantum
constexpr float kRate   = 44100.0f; // the voice's rate, and the page's audio context's
constexpr int   kText   = 256;      // the text buffer, its nul included

alignas(wp::Voice) unsigned char store_[sizeof(wp::Voice)];
wp::Voice* voice_ = nullptr;
float out_[kFrames];
char  text_[kText];

} // namespace

extern "C" {

// the voice made, sections long (22 is the engine's adult), seeded
void voice_init(float sections, int seed)
{
    voice_ = new (store_) wp::Voice(sections, (uint32_t)seed, kRate);
}

// the text buffer: phones in ascii, nul-terminated, kText bytes
char* voice_text() { return text_; }

// the text spoken on a baseline note, an accented syllable lifted range
// semitones over it, at a speed (1 conversational) and a breath; spoken,
// it has no vibrato. 1 if it was taken, 0 on a bad phone or an overflow,
// which disturbs nothing
int voice_speak(float midi, float range, float speed, float breath)
{
    text_[kText - 1] = 0;
    wp::Speech s;
    s.midi = midi;
    s.range = range;
    s.speed = speed;
    s.breath = breath;
    return voice_->speak(text_, s) ? 1 : 0;
}

// the live setters, each landing at the top of the next block
void voice_tenseness(float tension) { voice_->setTenseness(tension); }
void voice_wobble(float amount) { voice_->setWobble(amount); }
void voice_sections(float sections) { voice_->setSections(sections); }

// one field of the voice's tuning, the rest as they were: 0 glottisRest
// (breathiness), 1 growl (roughness), 2 diction
void voice_tune(int field, float value)
{
    wp::Tuning t = voice_->tuning();
    switch (field) {
        case 0: t.glottisRest = value; break;
        case 1: t.growl = value; break;
        case 2: t.diction = value; break;
        default: return;
    }
    voice_->setTuning(t);
}

// 1 while a line plays, or the breath has yet to fall to nothing
int voice_busy() { return voice_->busy() || voice_->state().breath > 0.0f ? 1 : 0; }

// whatever is sounding let go: the line dropped, the breath to nothing
void voice_stop() { voice_->stop(); }

// the next block, kFrames samples in -1 .. 1
float* voice_render()
{
    voice_->render(out_, kFrames);
    return out_;
}

} // extern "C"
