# moon_man on the web: moon_man's mouth and gaze (src/face), third_dimension's
# renderer and second_dimension's blit, with the glue, through emscripten
# into one standalone wasm, ../../moon_man/moon_man.wasm, with no
# javascript glue: js/moon.js instantiates it on the page. the sibling
# repos are read in place and never written; their objects are made here,
# under build/.
#
#   make          build ../../moon_man/moon_man.wasm
#   make clean
#
# the face's maths needs no arduino: moon_man's own host gate builds the
# same files with plain clang (its extras/host), and monk_mouth is only its
# headers here, the voice's state and phonemes. requires gnu make 3.81
# (macos).

WS := $(abspath ../../..)
MO := $(WS)/moon_man
TD := $(WS)/third_dimension
SD := $(WS)/second_dimension
MM := $(WS)/monk_mouth

EMCC  ?= em++
BUILD := build
OUT   := ../../moon_man/moon_man.wasm

# moon_man's host flags: its logging compiled out, and -ffp-contract=off
# keeping the renderers' float math the shape their golden pins expect
FLAGS    := -std=c++17 -O2 -w -ffp-contract=off -DMM_LOG_ENABLED=0
CPPFLAGS := -I$(MO)/src -I$(TD)/src -I$(SD)/src -I$(MM)/src

# no entry, no runtime: the glue's functions and the memory are the exports,
# the memory fixed, so the page needs nothing of emscripten's
EXPORTS := _moon_init,_moon_state,_moon_step,_moon_art_rows,_moon_art,_moon_ink,_moon_mask,_moon_w,_moon_h,_moon_x,_moon_y,_moon_yaw,_moon_pitch
LDFLAGS := -O2 -sSTANDALONE_WASM=1 --no-entry -sFILESYSTEM=0 -sINITIAL_MEMORY=2mb \
           -sEXPORTED_FUNCTIONS=$(EXPORTS)

MO_CPP := $(addprefix $(MO)/src/face/,mouth_model.cpp mouth_arc.cpp mouth_tube_geom.cpp tongue_geom.cpp gaze_model.cpp)
TD_CPP := $(wildcard $(TD)/src/*.cpp) $(wildcard $(TD)/src/internal/*.cpp)
SD_CPP := $(wildcard $(SD)/src/*.cpp)

OBJ := $(patsubst $(MO)/src/face/%.cpp,$(BUILD)/mo/%.o,$(MO_CPP)) \
       $(patsubst $(TD)/src/%.cpp,$(BUILD)/td/%.o,$(TD_CPP)) \
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
$(BUILD)/mo/%.o: $(MO)/src/face/%.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(FLAGS) $(CPPFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/td/%.o: $(TD)/src/%.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(FLAGS) $(CPPFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/sd/%.o: $(SD)/src/%.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(FLAGS) $(CPPFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/%.o: %.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(FLAGS) $(CPPFLAGS) -MMD -MP -c $< -o $@

-include $(shell find $(BUILD) -name '*.d' 2>/dev/null)
