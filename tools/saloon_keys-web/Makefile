# saloon's keys on the web: saloon's piano keyboard (src/keys: the layout,
# the press and the rise, and its art) and second_dimension's sprites, with
# the glue, through emscripten into one standalone wasm,
# ../../saloon/keys.wasm, with no javascript glue: js/keys.js instantiates
# it on the page. the sibling repos are read in place and never written;
# their objects are made here, under build/.
#
#   make          build ../../saloon/keys.wasm
#   make clean
#
# the keys need no arduino and no display: the three headers they ask the
# board for are in shim/, found before saloon's own (pins.h, the canvas's
# size for the panel's; hw/display.h, the lit colour; Adafruit_GFX.h, a
# canvas with a pixel). with neither ARDUINO nor SALOON_SIM defined
# saloon's core/util.h includes no Arduino.h, and its logging is compiled
# out. the glue is its own scene, so neither saloon's scene_piano nor its
# hands, its face or its sound is built. requires gnu make 3.81 (macos).

WS  := $(abspath ../../..)
SAL := $(WS)/saloon
SD  := $(WS)/second_dimension

EMCC  ?= em++
BUILD := build
OUT   := ../../saloon/keys.wasm

# daedalus's body's host flags (tools/daedalus_body-web): -ffp-contract=off
# keeps second_dimension's float math the shape its golden pins expect
FLAGS    := -std=c++17 -O2 -w -ffp-contract=off -DSALOON_LOG_ENABLED=0
CPPFLAGS := -Ishim -I$(SAL)/src -I$(SD)/src

# no entry, no runtime: the glue's functions and the memory are the exports,
# the memory fixed, so the page needs nothing of emscripten's
EXPORTS := _keys_init,_keys_on,_keys_off,_keys_all_off,_keys_point,_keys_step,_keys_at,_keys_ink,_keys_glow,_keys_w,_keys_h,_keys_base,_keys_down
LDFLAGS := -O2 -sSTANDALONE_WASM=1 --no-entry -sFILESYSTEM=0 -sINITIAL_MEMORY=1mb \
           -sEXPORTED_FUNCTIONS=$(EXPORTS)

SAL_CPP := $(SAL)/src/keys/keys.cpp
SD_CPP  := $(wildcard $(SD)/src/*.cpp)

OBJ := $(patsubst $(SAL)/src/%.cpp,$(BUILD)/sal/%.o,$(SAL_CPP)) \
       $(patsubst $(SD)/src/%.cpp,$(BUILD)/sd/%.o,$(SD_CPP)) \
       $(BUILD)/web_main.o

.PHONY: all clean

all: $(OUT)

$(OUT): $(OBJ)
	@mkdir -p $(dir $@)
	$(EMCC) $(LDFLAGS) $^ -o $@

clean:
	rm -rf $(BUILD) $(OUT)

# --- objects ------------------------------------------------------------------
$(BUILD)/sal/%.o: $(SAL)/src/%.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(FLAGS) $(CPPFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/sd/%.o: $(SD)/src/%.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(FLAGS) $(CPPFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/%.o: %.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(FLAGS) $(CPPFLAGS) -MMD -MP -c $< -o $@

-include $(shell find $(BUILD) -name '*.d' 2>/dev/null)
