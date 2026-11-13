# daedalus's body on the web: daedalus's body (src/body: the rig, the model
# and the beard) and second_dimension's sprites, with the glue, through
# emscripten into one standalone wasm, ../../daedalus/body.wasm, with no
# javascript glue: js/daedalus.js instantiates it on the page. the sibling
# repos are read in place and never written; their objects are made here,
# under build/.
#
#   make          build ../../daedalus/body.wasm
#   make clean
#
# the body needs no arduino and no display: the three headers it asks the
# board for are in shim/, found before daedalus's own (pins.h, the canvas's
# size for the panel's; hw/display.h, the lit colour; Adafruit_GFX.h, a
# canvas with a pixel and a line). the glue is its own scene, so neither
# daedalus's scene_bell nor its bells (nor its sound) is built. requires
# gnu make 3.81 (macos).

WS := $(abspath ../../..)
DA := $(WS)/daedalus
SD := $(WS)/second_dimension

EMCC  ?= em++
BUILD := build
OUT   := ../../daedalus/body.wasm

# the ship's host flags (tools/the_ship-web): -ffp-contract=off keeps
# second_dimension's float math the shape its golden pins expect
FLAGS    := -std=c++17 -O2 -w -ffp-contract=off
CPPFLAGS := -Ishim -I$(DA)/src -I$(SD)/src

# no entry, no runtime: the glue's functions and the memory are the exports,
# the memory fixed, so the page needs nothing of emscripten's
EXPORTS := _body_init,_body_point,_body_point_off,_body_step,_body_ink,_body_w,_body_h,_body_strikes,_body_struck,_body_tip_x,_body_tip_y
LDFLAGS := -O2 -sSTANDALONE_WASM=1 --no-entry -sFILESYSTEM=0 -sINITIAL_MEMORY=1mb \
           -sEXPORTED_FUNCTIONS=$(EXPORTS)

DA_CPP := $(addprefix $(DA)/src/body/,body_rig.cpp body_model.cpp beard.cpp)
SD_CPP := $(wildcard $(SD)/src/*.cpp)

OBJ := $(patsubst $(DA)/src/%.cpp,$(BUILD)/da/%.o,$(DA_CPP)) \
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
$(BUILD)/da/%.o: $(DA)/src/%.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(FLAGS) $(CPPFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/sd/%.o: $(SD)/src/%.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(FLAGS) $(CPPFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/%.o: %.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(FLAGS) $(CPPFLAGS) -MMD -MP -c $< -o $@

-include $(shell find $(BUILD) -name '*.d' 2>/dev/null)
