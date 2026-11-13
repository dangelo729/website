# upright on the web: saloon's sim twin of its piano rig, its knobs and
# upright's core through emscripten into one standalone wasm,
# ../../upright/upright.wasm, with no javascript glue: js/piano-worklet.js
# instantiates it in an audio worklet. the sibling repos are read in place
# and never written.
#
#   make          build ../../upright/upright.wasm
#   make measure  build/measure, the same glue native (clang): the ring, the
#                 peaks behind js/piano.js's master gain, the clamp and the
#                 cost of a block
#   make clean
#
# the twin (saloon/extras/sim/sim/piano_rig.cpp) needs only upright's core,
# saloon's knobs (src/audio/piano_knobs.cpp, its level table beside it),
# the sim's arduino stub for the knobs' <Arduino.h> (its headers only) and
# upright's header-only up_fit.h. requires gnu make 3.81 (macos).

WS  := $(abspath ../../..)
UP  := $(WS)/upright
SAL := $(WS)/saloon
SIM := $(SAL)/extras/sim

EMCC  ?= em++
CXX   := clang++
BUILD := build
OUT   := ../../upright/upright.wasm

# saloon's sim flags: -ffp-contract=off keeps the float math the same shape
# on every host; upright's core takes -fno-math-errno, as in its own builds
FLAGS    := -std=c++17 -O2 -w -ffp-contract=off -D SALOON_SIM
CPPFLAGS := -I$(SAL)/src -I$(SAL)/include -I$(UP)/src -I$(UP)/extras/host -I$(SIM)/arduino -I$(SIM)

# no entry, no runtime: the glue's functions and the memory are the exports,
# the memory fixed, so the page's worklet needs nothing of emscripten's
EXPORTS := _upright_init,_upright_strike,_upright_on,_upright_off,_upright_pedal,_upright_knobs,_upright_render
LDFLAGS := -O2 -sSTANDALONE_WASM=1 --no-entry -sFILESYSTEM=0 -sINITIAL_MEMORY=4mb \
           -sEXPORTED_FUNCTIONS=$(EXPORTS)

UP_CPP := $(wildcard $(UP)/src/core/*.cpp)
SRC    := $(SIM)/sim/piano_rig.cpp $(SAL)/src/audio/piano_knobs.cpp web_main.cpp

WASM_OBJ   := $(patsubst $(UP)/src/core/%.cpp,$(BUILD)/wasm/up/%.o,$(UP_CPP)) \
              $(BUILD)/wasm/piano_rig.o $(BUILD)/wasm/piano_knobs.o $(BUILD)/wasm/web_main.o
NATIVE_OBJ := $(patsubst $(UP)/src/core/%.cpp,$(BUILD)/native/up/%.o,$(UP_CPP)) \
              $(BUILD)/native/piano_rig.o $(BUILD)/native/piano_knobs.o $(BUILD)/native/web_main.o

.PHONY: all measure clean

all: $(OUT)

$(OUT): $(WASM_OBJ)
	@mkdir -p $(dir $@)
	$(EMCC) $(LDFLAGS) $^ -o $@

measure: $(BUILD)/measure
	./$(BUILD)/measure

$(BUILD)/measure: $(NATIVE_OBJ) $(BUILD)/native/measure.o
	$(CXX) $^ -o $@

clean:
	rm -rf $(BUILD) $(OUT)

# --- objects ------------------------------------------------------------------
$(BUILD)/wasm/up/%.o: $(UP)/src/core/%.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(FLAGS) -fno-math-errno $(CPPFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/wasm/piano_rig.o: $(SIM)/sim/piano_rig.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(FLAGS) $(CPPFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/wasm/piano_knobs.o: $(SAL)/src/audio/piano_knobs.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(FLAGS) $(CPPFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/wasm/%.o: %.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(FLAGS) $(CPPFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/native/up/%.o: $(UP)/src/core/%.cpp
	@mkdir -p $(dir $@)
	$(CXX) $(FLAGS) -fno-math-errno $(CPPFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/native/piano_rig.o: $(SIM)/sim/piano_rig.cpp
	@mkdir -p $(dir $@)
	$(CXX) $(FLAGS) $(CPPFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/native/piano_knobs.o: $(SAL)/src/audio/piano_knobs.cpp
	@mkdir -p $(dir $@)
	$(CXX) $(FLAGS) $(CPPFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/native/%.o: %.cpp
	@mkdir -p $(dir $@)
	$(CXX) $(FLAGS) $(CPPFLAGS) -MMD -MP -c $< -o $@

-include $(shell find $(BUILD) -name '*.d' 2>/dev/null)
