// make measure: the glue (web_main.cpp) native, played as the page plays
// it, at the page's knobs (js/piano.js), in the scale the page starts in
// (js/scale.js). prints how long a held key takes to fall 60 db under its
// peak (the glue's ring), each key's peak struck alone, the peaks of sweeps
// along the name and of keys struck in one block (what js/piano.js's master
// gain is set by), the samples the rig's clamp to ±1 held, and what a block
// costs; and, for the scales the page can be set to, each octave's root
// held, the loudest key any of them reaches, and the loudest sweep in each
// octave.
#include <chrono>
#include <math.h>
#include <stdio.h>
#include <vector>

#include "audio/piano_rig.h"

extern "C" {
void   upright_init(float instrument, float tone, float size, float detune, float damper);
void   upright_strike(int note, int velocity);
float* upright_render();
}

namespace {

const int   kNotes[13]  = { 60, 62, 64, 66, 67, 69, 71, 72, 74, 76, 78, 79, 81 }; // the name's, p to o, in the scale the page starts in: c lydian from c4
// js/scale.js's seven modes, each its seven degrees in semitones over the root
const int   kSteps[7][7] = { { 0, 2, 4, 5, 7, 9, 11 }, { 0, 2, 3, 5, 7, 9, 10 }, { 0, 1, 3, 5, 7, 8, 10 }, { 0, 2, 4, 6, 7, 9, 11 },
                             { 0, 2, 4, 5, 7, 9, 10 }, { 0, 2, 3, 5, 7, 8, 10 }, { 0, 1, 3, 5, 6, 8, 10 } };
constexpr int kLowest = 24, kHighest = 104; // the keys the page's scales reach: c1, and the thirteenth degree from b5
const float kKnobs[5]   = { 0.73f, -1.0f, -0.59f, 0.55f, -0.76f };                 // the page's five
constexpr int    kVelocity = 100;
constexpr int    kFrames   = 128;
constexpr double kRate     = 44100.0;

struct Take {
    std::vector<float>  x;
    std::vector<double> cost; // seconds, a block each
};

// a fresh piano: every key let go, the rig made and the knobs settled
void fresh()
{
    pianoRigAllOff();
    upright_init(kKnobs[0], kKnobs[1], kKnobs[2], kKnobs[3], kKnobs[4]);
}

// seconds of blocks, the strikes (block, note) taken at their blocks' starts
Take play(const std::vector<std::pair<int, int>>& strikes, double seconds)
{
    Take         t;
    const int    blocks = (int)(seconds * kRate / kFrames);
    size_t       next   = 0;
    for (int b = 0; b < blocks; b++) {
        while (next < strikes.size() && strikes[next].first <= b) upright_strike(strikes[next++].second, kVelocity);
        const auto   t0  = std::chrono::steady_clock::now();
        const float* out = upright_render();
        t.cost.push_back(std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count());
        t.x.insert(t.x.end(), out, out + kFrames);
    }
    return t;
}

float peak(const std::vector<float>& x)
{
    float p = 0.0f;
    for (float v : x) p = fmaxf(p, fabsf(v));
    return p;
}

int clamped(const std::vector<float>& x)
{
    int n = 0;
    for (float v : x) n += fabsf(v) >= 1.0f;
    return n;
}

// seconds from the first sound to the last sample over 60 db under the peak
double fall(const std::vector<float>& x)
{
    const float p = peak(x);
    size_t      first = 0, last = 0;
    while (first < x.size() && x[first] == 0.0f) first++;
    for (size_t i = 0; i < x.size(); i++)
        if (fabsf(x[i]) > p * 1e-3f) last = i;
    return (double)(last - first) / kRate;
}

// a key struck and never let go, three seconds of it
std::vector<float> held(int note)
{
    fresh();
    pianoRigNoteOn((uint8_t)note, kVelocity);
    std::vector<float> x;
    for (int b = 0; b < (int)(3.0 * kRate / kFrames); b++) {
        const float* out = upright_render();
        x.insert(x.end(), out, out + kFrames);
    }
    return x;
}

// degree deg's note in mode from c in octave, as js/scale.js has it
int degree(int mode, int octave, int deg)
{
    return 12 * (octave + 1) + 12 * (deg / 7) + kSteps[mode][deg % 7];
}

} // namespace

int main()
{
    // a held key: struck and never let go
    printf("a held key's fall to -60 db under its peak:\n");
    double ringMax = 0.0;
    for (int note : kNotes) {
        const double f = fall(held(note));
        ringMax        = fmax(ringMax, f);
        printf("  %d  %.3f s\n", note, f);
    }
    printf("  longest %.3f s\n", ringMax);

    // each key struck alone, let go by the glue's ring
    printf("each key struck alone:\n ");
    float single = 0.0f;
    for (int note : kNotes) {
        fresh();
        const float p = peak(play({ { 0, note } }, 1.5).x);
        single        = fmaxf(single, p);
        printf(" %d %.3f", note, p);
    }
    printf("\n  loudest %.3f\n", single);

    // sweeps along the name, each key struck once, ms apart, both ways
    printf("sweeps, each key ringing its full plink:\n");
    float sweep = 0.0f;
    for (int dir = 0; dir < 2; dir++) {
        for (int ms = 20; ms <= 100; ms += 5) {
            std::vector<std::pair<int, int>> s;
            for (int k = 0; k < 13; k++) {
                const int note = kNotes[dir == 0 ? k : 12 - k];
                s.push_back({ (int)(k * ms * 1e-3 * kRate / kFrames), note });
            }
            fresh();
            Take        t = play(s, 3.0);
            const float p = peak(t.x);
            if (p > sweep) sweep = p;
            printf("  %s %3d ms  peak %.3f  clamped %d\n", dir == 0 ? "up  " : "down", ms, p, clamped(t.x));
        }
    }
    printf("  loudest %.3f\n", sweep);

    // keys struck in one block, as a sweep that crosses them between two
    // pointer events strikes them, from p along the name; the last, every key
    printf("keys struck in one block:\n");
    for (int k = 1; k <= 13; k++) {
        std::vector<std::pair<int, int>> s;
        for (int i = 0; i < k; i++) s.push_back({ 0, kNotes[i] });
        fresh();
        const Take a = play(s, 3.0);
        printf("  %2d  peak %.3f  clamped %d\n", k, peak(a.x), clamped(a.x));
    }

    // the scales the page can be set to: each octave's c held, every key
    // any of them reaches struck alone, and the name swept in every mode
    // from c in each octave, both ways, the loudest of them at each spacing
    printf("each octave's c, held, its fall to -60 db under its peak:\n ");
    for (int octave = 1; octave <= 5; octave++) printf(" c%d %.3f s", octave, fall(held(12 * (octave + 1))));
    float any   = 0.0f;
    int   anyAt = 0;
    for (int note = kLowest; note <= kHighest; note++) {
        fresh();
        const float p = peak(play({ { 0, note } }, 1.5).x);
        if (p > any) {
            any   = p;
            anyAt = note;
        }
    }
    printf("\nevery key the page's scales reach, %d to %d, struck alone: loudest %.3f (%d)\n", kLowest, kHighest, any, anyAt);
    printf("sweeps in every mode from c, the loudest in each octave, * where the clamp held a sample:\n");
    for (int octave = 1; octave <= 5; octave++) {
        printf("  octave %d ", octave);
        for (int ms = 20; ms <= 100; ms += 20) {
            float loudest = 0.0f;
            int   over    = 0;
            for (int mode = 0; mode < 7; mode++) {
                for (int dir = 0; dir < 2; dir++) {
                    std::vector<std::pair<int, int>> s;
                    for (int k = 0; k < 13; k++) s.push_back({ (int)(k * ms * 1e-3 * kRate / kFrames), degree(mode, octave, dir == 0 ? k : 12 - k) });
                    fresh();
                    const Take t = play(s, 3.0);
                    loudest      = fmaxf(loudest, peak(t.x));
                    over += clamped(t.x);
                }
            }
            printf("  %3d ms %.3f%s", ms, loudest, over ? "*" : " ");
        }
        printf("\n");
    }

    // a block's cost, each block's least over five plays (the os's pauses
    // dropped): every key in one block, and a sweep up 20 ms apart
    std::vector<std::pair<int, int>> every, up;
    for (int k = 0; k < 13; k++) {
        every.push_back({ 0, kNotes[k] });
        up.push_back({ (int)(k * 20e-3 * kRate / kFrames), kNotes[k] });
    }
    for (int c = 0; c < 2; c++) {
        std::vector<double> least;
        for (int r = 0; r < 5; r++) {
            fresh();
            const Take t = play(c == 0 ? every : up, 3.0);
            if (least.empty()) least = t.cost;
            for (size_t b = 0; b < least.size(); b++) least[b] = fmin(least[b], t.cost[b]);
        }
        double sum = 0.0, worst = 0.0;
        for (double d : least) {
            sum += d;
            worst = fmax(worst, d);
        }
        printf("a block's cost, %s: mean %.1f us, worst %.1f us (a block lasts %.0f us)\n", c == 0 ? "every key in one block" : "a sweep 20 ms apart",
               sum / (double)least.size() * 1e6, worst * 1e6, kFrames / kRate * 1e6);
    }
    return 0;
}
