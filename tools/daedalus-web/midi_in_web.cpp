// the web twin of hw/midi_in.cpp: the sim twin's queue and parse with no
// port behind it. bytes arrive through simMidiInInject alone (the page's
// keyboard), and the frame's poll parses and logs them exactly as the sim
// twin does. single-threaded: no mutex.
#include "hw/midi_in.h"

#include <stddef.h>
#include <stdint.h>
#include <vector>

#include "core/util.h"
#include "sim/midi_in_host.h"
#include "sim/midi_parse.h"

namespace {

MidiEvent events_[kMidiInMaxEvents];
int       count_ = 0;

std::vector<std::vector<uint8_t>> queue_; // raw messages, oldest first

void logEvent(const MidiEvent& e)
{
    switch (e.kind) {
    case MidiKind::NoteOn:        DAED_LOG("[midi] ch %d note on %d vel %d", e.channel, e.a, e.b); break;
    case MidiKind::NoteOff:       DAED_LOG("[midi] ch %d note off %d", e.channel, e.a); break;
    case MidiKind::ControlChange: DAED_LOG("[midi] ch %d cc %d = %d", e.channel, e.a, e.b); break;
    case MidiKind::PitchBend:     DAED_LOG("[midi] ch %d bend %d", e.channel, e.bend); break;
    }
}

} // namespace

void midiInInit() { count_ = 0; }

void midiInPoll()
{
    count_ = 0;
    std::vector<std::vector<uint8_t>> pending;
    pending.swap(queue_);
    for (const std::vector<uint8_t>& raw : pending) {
        MidiEvent e;
        if (!midiParse(raw.data(), raw.size(), e)) continue;
        if (count_ >= kMidiInMaxEvents) continue; // drained, not kept
        events_[count_++] = e;
        logEvent(e);
    }
}

int midiInCount() { return count_; }

const MidiEvent& midiInEvent(int i)
{
    static const MidiEvent kNone = { MidiKind::NoteOff, 0, 0, 0, 0 };
    return (i >= 0 && i < count_) ? events_[i] : kNone;
}

const char* midiInPortName() { return "web"; }

void simMidiInEnable(bool) {}
void simMidiInPreferPort(const char*) {}

void simMidiInInject(const uint8_t* bytes, size_t n)
{
    if (!bytes || n == 0) return;
    queue_.emplace_back(bytes, bytes + n);
}
