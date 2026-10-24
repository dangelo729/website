// daedalus on the web: the host sim's runner driven from javascript.
// the clock is virtual, so every daed_frame() is exactly one 12.5 ms frame
// of the program, whatever the browser's own frame rate; the page calls it
// as many times as wall time has moved on. the panel's bytes are the
// display twin's canvas (sim/display_sink.h layout), read in place.
#include <emscripten/emscripten.h>
#include <stdint.h>

#include "sim/clock.h"
#include "sim/display_sink.h"
#include "sim/midi_in_host.h"
#include "sim/pins_table.h"
#include "sim/random_host.h"
#include "sim/runner.h"

extern "C" {

EMSCRIPTEN_KEEPALIVE void daed_init(uint32_t seed)
{
    simClockSetMode(SimClockMode::Virtual);
    simPinNoise(false);
    simRandomSetSeedOverride(seed);
    simRunnerSetup();
}

EMSCRIPTEN_KEEPALIVE void daed_frame() { simRunnerFrame(); }

EMSCRIPTEN_KEEPALIVE const uint8_t* daed_buffer() { return simDisplayBuffer(); }
EMSCRIPTEN_KEEPALIVE int            daed_width() { return simDisplayWidth(); }
EMSCRIPTEN_KEEPALIVE int            daed_height() { return simDisplayHeight(); }

// one raw channel message, status byte first: the same queue a midi port's
// bytes would land on, polled by the next frame.
EMSCRIPTEN_KEEPALIVE void daed_midi(uint8_t status, uint8_t a, uint8_t b)
{
    const uint8_t msg[3] = { status, a, b };
    simMidiInInject(msg, 3);
}

} // extern "C"
