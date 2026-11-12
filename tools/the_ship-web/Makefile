# the_ship on the web: the_ship's water and its steamboat (src/water/tank,
# src/boat), physics_box's fluid and skin and third_dimension's renderer,
# with the glue, through emscripten into one standalone wasm,
# ../../the_ship/the_ship.wasm, with no javascript glue: js/ship.js
# instantiates it on the page. the sibling repos are read in place and never
# written; their objects are made here, under build/.
#
#   make          build ../../the_ship/the_ship.wasm
#   make clean
#
# the ship's water needs no arduino: with neither ARDUINO nor SHIP_SIM
# defined its core/util.h includes no Arduino.h, its logging compiled out
# and FLASHMEM empty. the glue is its own scene and view, so neither the
# ship's scene_water nor its tank_view (nor the steam, nor the display) is
# built. requires gnu make 3.81 (macos).

WS := $(abspath ../../..)
SH := $(WS)/the_ship
PB := $(WS)/physics_box
TD := $(WS)/third_dimension

EMCC  ?= em++
BUILD := build
OUT   := ../../the_ship/the_ship.wasm

# moon_man's host flags (tools/moon_man-web), with the ship's logging
# compiled out and its flash attribute empty
FLAGS    := -std=c++17 -O2 -w -ffp-contract=off -DSHIP_LOG_ENABLED=0 -DFLASHMEM=
CPPFLAGS := -I$(SH)/src -I$(PB)/src -I$(TD)/src

# no entry, no runtime: the glue's functions and the memory are the exports,
# the memory fixed, so the page needs nothing of emscripten's
EXPORTS := _ship_init,_ship_turn,_ship_step,_ship_ink,_ship_w,_ship_h,_ship_yaw
LDFLAGS := -O2 -sSTANDALONE_WASM=1 --no-entry -sFILESYSTEM=0 -sINITIAL_MEMORY=1mb \
           -sEXPORTED_FUNCTIONS=$(EXPORTS)

SH_CPP := $(SH)/src/water/tank.cpp $(addprefix $(SH)/src/boat/,boat.cpp boat_build.cpp boat_pose.cpp)
PB_CPP := $(wildcard $(PB)/src/core/*.cpp)
TD_CPP := $(wildcard $(TD)/src/*.cpp) $(wildcard $(TD)/src/internal/*.cpp)

OBJ := $(patsubst $(SH)/src/%.cpp,$(BUILD)/sh/%.o,$(SH_CPP)) \
       $(patsubst $(PB)/src/%.cpp,$(BUILD)/pb/%.o,$(PB_CPP)) \
       $(patsubst $(TD)/src/%.cpp,$(BUILD)/td/%.o,$(TD_CPP)) \
       $(BUILD)/web_main.o

.PHONY: all clean

all: $(OUT)

$(OUT): $(OBJ)
	@mkdir -p $(dir $@)
	$(EMCC) $(LDFLAGS) $^ -o $@

clean:
	rm -rf $(BUILD) $(OUT)

# --- objects ------------------------------------------------------------------
$(BUILD)/sh/%.o: $(SH)/src/%.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(FLAGS) $(CPPFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/pb/%.o: $(PB)/src/%.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(FLAGS) $(CPPFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/td/%.o: $(TD)/src/%.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(FLAGS) $(CPPFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/%.o: %.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(FLAGS) $(CPPFLAGS) -MMD -MP -c $< -o $@

-include $(shell find $(BUILD) -name '*.d' 2>/dev/null)
