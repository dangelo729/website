# daedalus on the web: the host sim's sources (daedalus/extras/sim) through
# emscripten into one javascript file with the wasm inside it,
# ../../daedalus/daedalus.js, which index.html loads. the sibling repos are
# read in place and never written.
#
#   make          build ../../daedalus/daedalus.js
#   make clean
#
# the sim's own twins are reused but for two: midi_in (its RtMidi port has
# no web backend; midi_in_web.cpp keeps the queue alone) and the main
# (web_main.cpp exports the runner to javascript). script, finger and png
# are the headless run's and are left out. requires gnu make 3.81 (macos).

WS   := $(abspath ../../..)
DAED := $(WS)/daedalus
SIM  := $(DAED)/extras/sim
BF   := $(WS)/belfry
TD   := $(WS)/third_dimension
SD   := $(WS)/second_dimension
GFX_DIR := $(DAED)/.pio/libdeps/teensy41/Adafruit GFX Library

EMCC  ?= em++
BUILD := build
OUT   := ../../daedalus/daedalus.js

# the sim's flags: -ffp-contract=off keeps the renderers' float math the
# shape their golden pins expect, DAED_SIM takes the host branches, and
# ARDUINO stays undefined (arduino/WProgram.h defines it for Adafruit_GFX).
CXXFLAGS_OURS := -std=c++17 -O2 -Wall -Wextra -ffp-contract=off -D DAED_SIM
CXXFLAGS_LIB  := -std=c++17 -O2 -ffp-contract=off -D DAED_SIM
CXXFLAGS_VEND := -std=c++17 -O2 -w -ffp-contract=off -D DAED_SIM
CPPFLAGS := -I$(DAED)/src -I$(DAED)/include -I$(BF)/src -I$(BF)/extras/host \
            -I$(TD)/src -I$(SD)/src -I$(SIM)/arduino -I$(SIM) -I"$(GFX_DIR)"

# one file, the wasm as base64 inside the js, so the page works from a
# file:// url too. the runner's exports and the heap view are all the page
# touches.
LDFLAGS := -O2 -sMODULARIZE=1 -sEXPORT_NAME=createDaedalus -sSINGLE_FILE=1 \
           -sENVIRONMENT=web -sALLOW_MEMORY_GROWTH=1 \
           -sEXPORTED_RUNTIME_METHODS=HEAPU8 \
           -sEXPORTED_FUNCTIONS=_daed_init,_daed_frame,_daed_buffer,_daed_width,_daed_height,_daed_midi

# --- sources ------------------------------------------------------------------
SRC_CPP := $(shell find $(DAED)/src -name '*.cpp' ! -path '*/hw/display.cpp' ! -path '*/hw/midi_in.cpp' \
                                                  ! -path '*/hw/speaker.cpp' ! -path '*/audio/bell_rig.cpp' | sort)
SIM_CPP := $(addprefix $(SIM)/sim/,clock.cpp display.cpp speaker.cpp runner.cpp bell_rig.cpp midi_parse.cpp pins_table.cpp)
ARD_CPP := $(wildcard $(SIM)/arduino/*.cpp)
BF_CPP  := $(wildcard $(BF)/src/core/*.cpp)
TD_CPP  := $(wildcard $(TD)/src/*.cpp) $(wildcard $(TD)/src/internal/*.cpp)
SD_CPP  := $(wildcard $(SD)/src/*.cpp)
WEB_CPP := web_main.cpp midi_in_web.cpp

SRC_OBJ := $(patsubst $(DAED)/src/%.cpp,$(BUILD)/src/%.o,$(SRC_CPP))
SIM_OBJ := $(patsubst $(SIM)/sim/%.cpp,$(BUILD)/sim/%.o,$(SIM_CPP))
ARD_OBJ := $(patsubst $(SIM)/arduino/%.cpp,$(BUILD)/arduino/%.o,$(ARD_CPP))
BF_OBJ  := $(patsubst $(BF)/src/core/%.cpp,$(BUILD)/bf/%.o,$(BF_CPP))
TD_OBJ  := $(patsubst $(TD)/src/%.cpp,$(BUILD)/td/%.o,$(TD_CPP))
SD_OBJ  := $(patsubst $(SD)/src/%.cpp,$(BUILD)/sd/%.o,$(SD_CPP))
WEB_OBJ := $(patsubst %.cpp,$(BUILD)/web/%.o,$(WEB_CPP))
GFX_OBJ := $(BUILD)/vendor/Adafruit_GFX.o

OBJ := $(SRC_OBJ) $(SIM_OBJ) $(ARD_OBJ) $(BF_OBJ) $(TD_OBJ) $(SD_OBJ) $(WEB_OBJ) $(GFX_OBJ)

.PHONY: all clean

all: $(OUT)

$(OUT): $(OBJ)
	@mkdir -p $(dir $@)
	$(EMCC) $(LDFLAGS) $^ -o $@

clean:
	rm -rf $(BUILD) $(OUT)

# --- objects ------------------------------------------------------------------
$(BUILD)/src/%.o: $(DAED)/src/%.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(CXXFLAGS_OURS) $(CPPFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/sim/%.o: $(SIM)/sim/%.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(CXXFLAGS_OURS) $(CPPFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/arduino/%.o: $(SIM)/arduino/%.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(CXXFLAGS_OURS) $(CPPFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/web/%.o: %.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(CXXFLAGS_OURS) $(CPPFLAGS) -MMD -MP -c $< -o $@

# belfry's core builds with -fno-math-errno everywhere it runs
$(BUILD)/bf/%.o: $(BF)/src/core/%.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(CXXFLAGS_LIB) -fno-math-errno $(CPPFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/td/%.o: $(TD)/src/%.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(CXXFLAGS_LIB) $(CPPFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/sd/%.o: $(SD)/src/%.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(CXXFLAGS_LIB) $(CPPFLAGS) -MMD -MP -c $< -o $@

# the gfx path has spaces: no prerequisite (make would split it)
$(GFX_OBJ): Makefile
	@mkdir -p $(dir $@)
	$(EMCC) $(CXXFLAGS_VEND) $(CPPFLAGS) -c "$(GFX_DIR)/Adafruit_GFX.cpp" -o $@

-include $(shell find $(BUILD) -name '*.d' 2>/dev/null)
