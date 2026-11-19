// the scrubber's core: a playhead over a sound held in memory, heard as a
// record under a hand is. nothing here knows what it runs on: no arduino,
// no audio library, no file. it is the playhead of the teensy audio
// library's live scrubber (AudioPlayScrub) with its two modes made one.
// there is a target, where the sound is wanted, and the playhead, where it
// is heard, and every sample the playhead goes rate of the way to the
// target, so its speed, and with it the pitch, is how far behind it is:
// sought far, it races there and slows as it arrives; left alone, it comes
// to rest. the target may move too, speed samples a sample: at 1 the sound
// plays, the playhead a little behind its target and as fast, having spun
// up to it as a turntable does, and at 0 it spins down to a stop. once the
// playhead is as fast as a target moving at 1, within LOCK, it is put on a
// whole sample and from there steps a whole sample at a time with it, so
// what plays is the sound's own samples, untouched, until the target is
// moved or stopped or runs out. between samples the sound is read through
// a cubic, four samples about the playhead, and it fades to nothing as the
// playhead slows under QUIET, so a playhead at rest on a sample is silent.
// the playhead and the target are doubles: a float cannot tell one sample
// from the next past a few minutes of sound.
#pragma once

#include <math.h>
#include <stdint.h>

class ScrubCore {
public:
    // of 1, how near a target's speed of 1 the playhead's must be before it steps with it
    static constexpr double LOCK = 0.002;
    // samples a sample, the playhead's speed under which the sound fades, to nothing at rest
    static constexpr double QUIET = 0.02;

    // the sound: count samples, mono, the caller's to keep. the playhead
    // and the target go to its start
    void setBuffer(const int16_t* samples, uint32_t count)
    {
        samples_ = samples;
        count_ = count;
        cut(0.0);
    }

    // of the way to its target the playhead goes each sample, over 0 and
    // no more than 1: less is a heavier record, slower to catch up
    void setRate(double rate)
    {
        rate_ = rate < 1e-9 ? 1e-9 : rate > 1.0 ? 1.0 : rate;
    }

    // samples a sample the target itself moves: 1 plays, 0 stands
    void setSpeed(double speed)
    {
        if (speed == speed_) return;
        speed_ = speed;
        locked_ = false;
    }

    // the target put at sample at, held to the sound
    void setTarget(double at)
    {
        target_ = hold(at);
        locked_ = false;
    }

    // the target and the playhead both put at sample at, at rest there
    void cut(double at)
    {
        target_ = playhead_ = hold(at);
        step_ = 0.0;
        locked_ = false;
    }

    // the next n samples into out, -1 .. 1
    void render(float* out, int n)
    {
        const double last = count_ ? (double)(count_ - 1) : 0.0;
        for (int i = 0; i < n; i++) {
            if (locked_ && target_ + 1.0 <= last) {
                target_ += 1.0;
                playhead_ += 1.0;
                out[i] = samples_[(uint32_t)playhead_] * (1.0f / 32768.0f);
                continue;
            }
            locked_ = false;
            target_ = hold(target_ + speed_);
            step_ = (target_ - playhead_) * rate_;
            playhead_ += step_;
            if (speed_ == 1.0 && target_ < last && fabs(step_ - 1.0) < LOCK) {
                playhead_ = floor(playhead_ + 0.5);
                step_ = 1.0;
                locked_ = true;
            }
            const double fast = fabs(step_);
            out[i] = count_ ? read(playhead_) * (float)(fast < QUIET ? fast / QUIET : 1.0) : 0.0f;
        }
    }

    double playhead() const { return playhead_; } // the sample it is heard at
    double target() const { return target_; }     // the sample it is wanted at
    double step() const { return step_; }         // samples the playhead went over the last sample
    bool locked() const { return locked_; }       // it steps whole samples with its target

private:
    // at, no further than the sound's ends
    double hold(double at) const
    {
        const double last = count_ ? (double)(count_ - 1) : 0.0;
        return at < 0.0 ? 0.0 : at > last ? last : at;
    }

    // sample i, the sound's first before its start and its last past its end
    float sample(int64_t i) const
    {
        return (float)samples_[i < 0 ? 0 : i >= (int64_t)count_ ? count_ - 1 : (uint32_t)i];
    }

    // the sound at at, between samples: a catmull-rom cubic through the
    // four samples about it, which passes through each sample itself
    float read(double at) const
    {
        const double whole = floor(at);
        const int64_t i = (int64_t)whole;
        const float t = (float)(at - whole);
        const float a = sample(i - 1), b = sample(i), c = sample(i + 1), d = sample(i + 2);
        const float y = b + 0.5f * t * (c - a + t * (2.0f * a - 5.0f * b + 4.0f * c - d + t * (3.0f * (b - c) + d - a)));
        return y * (1.0f / 32768.0f);
    }

    const int16_t* samples_ = nullptr;
    uint32_t count_ = 0;
    double rate_ = 1.0;
    double speed_ = 0.0;
    double target_ = 0.0;
    double playhead_ = 0.0;
    double step_ = 0.0;
    bool locked_ = false;
};
