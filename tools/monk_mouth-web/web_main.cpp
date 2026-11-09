// monk_mouth on the web: one wp::Voice, the articulatory voice, a tube
// shaped like a vocal tract with air moving through it, compiled with
// nothing else into ../../monk_mouth/monk_mouth.wasm, which
// js/voice-worklet.js plays a block at a time. the voice is made in place
// in a static buffer, so nothing is ever taken from a heap. phones are
// written into the text buffer and then spoken, a line with its own notes
// and breath, and as it plays how many of its syllables have begun is
// counted from the vowel the voice reads back, and the mouth is read off
// the voice for the face to follow. the rest are the voice's own live
// setters, a few fields of its tuning by number, and the block.
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

// the line's vowels in order, a syllable each, and how many have been
// heard: the voice's readback has come to each, in turn, from something else
uint8_t vowels_[wp::kMaxSyllables];
int     vowelCount_ = 0;
int     heard_ = 0;
uint8_t last_ = wp::ph::none;   // the readback as of the last block

// the mouth as moon_man's face reads it (its face/mouth_model.cpp): the
// front cavity runs from the palate to the lips and the lips are the last
// few sections, as fractions of the tract (glottis 0, lips 1) so that one
// map serves every size. the cavity's mean diameter rides from about 0.6
// (IY, the tongue up at the palate) to 2.2 (AA, wide open), and an
// unrounded lip section is 1.5 across
constexpr float kFrontFrom = 0.55f;
constexpr float kLipFrom   = 0.886f;
constexpr float kFrontShut = 0.6f;
constexpr float kLipFull   = 1.5f;
float mouth_[6];
float tube_[wp::kMaxSections];

// the vowels of the phones in text_, in order, into vowels_
void listVowels()
{
    vowelCount_ = 0;
    for (const char* s = text_; *s;) {
        while (*s == ' ' || *s == '\t' || *s == '\n' || *s == '\r') ++s;
        const char* tok = s;
        while (*s && *s != ' ' && *s != '\t' && *s != '\n' && *s != '\r') ++s;
        if (s == tok) break;
        const uint8_t p = wp::parsePhone(tok, (int)(s - tok));
        if (wp::isVowel(p) && vowelCount_ < wp::kMaxSyllables) vowels_[vowelCount_++] = p;
    }
}

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
    if (!voice_->speak(text_, s)) return 0;
    listVowels();
    heard_ = 0;
    last_ = wp::ph::none;
    return 1;
}

// how many of the line's syllables have begun: the vowels heard so far
int voice_heard() { return heard_; }

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

// the mouth at the end of the last block, six floats: how voiced (the gain
// on the glottal pulse), how much hiss (0 .. 1), the lips' own pose (0
// shut), the front cavity's mean diameter, the narrowest lip section, and
// 1 while the voice names an L with the tongue against something, else 0
float* voice_mouth()
{
    const wp::BodyState s = voice_->state();
    const int n = voice_->diameters(tube_, wp::kMaxSections);
    float front = 0.0f, lipMin = kLipFull;
    int count = 0;
    for (int i = 0; i < n; ++i) {
        const float x = ((float)i + 0.5f) / (float)n;
        if (x >= kLipFrom) {
            if (tube_[i] < lipMin) lipMin = tube_[i];
        } else if (x >= kFrontFrom) {
            front += tube_[i];
            ++count;
        }
    }
    mouth_[0] = s.voicing;
    mouth_[1] = s.hiss;
    mouth_[2] = s.lips;
    mouth_[3] = count > 0 ? front / (float)count : kFrontShut;
    mouth_[4] = lipMin;
    mouth_[5] = s.phoneme == wp::ph::L && (s.slotActive[0] || s.slotActive[1]) ? 1.0f : 0.0f;
    return mouth_;
}

// the next block, kFrames samples in -1 .. 1
float* voice_render()
{
    voice_->render(out_, kFrames);
    const uint8_t p = voice_->state().phoneme;
    if (p != last_) {
        last_ = p;
        if (heard_ < vowelCount_ && p == vowels_[heard_]) ++heard_;
    }
    return out_;
}

} // extern "C"
