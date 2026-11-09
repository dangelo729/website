# monk_mouth on the web: one voice of monk_mouth's core and its glue through
# emscripten into one standalone wasm, ../../monk_mouth/monk_mouth.wasm,
# with no javascript glue: js/voice-worklet.js instantiates it in an audio
# worklet. monk_mouth is read in place and never written; its objects are
# made here, under build/.
#
#   make          build ../../monk_mouth/monk_mouth.wasm
#   make clean
#
# the core includes nothing but the c++ standard library and holds no heap.
# requires gnu make 3.81 (macos).

WS := $(abspath ../../..)
MM := $(WS)/monk_mouth

EMCC  ?= em++
BUILD := build
OUT   := ../../monk_mouth/monk_mouth.wasm

# the core takes -fno-math-errno, as upright's does
FLAGS    := -std=c++17 -O2 -w -fno-math-errno
CPPFLAGS := -I$(MM)/src

# no entry, no runtime: the glue's functions and the memory are the exports,
# the memory fixed, so the page's worklet needs nothing of emscripten's
EXPORTS := _voice_init,_voice_text,_voice_speak,_voice_tenseness,_voice_wobble,_voice_sections,_voice_tune,_voice_busy,_voice_stop,_voice_render
LDFLAGS := -O2 -sSTANDALONE_WASM=1 --no-entry -sFILESYSTEM=0 -sINITIAL_MEMORY=1mb \
           -sEXPORTED_FUNCTIONS=$(EXPORTS)

MM_CPP := $(wildcard $(MM)/src/core/*.cpp)
OBJ    := $(patsubst $(MM)/src/core/%.cpp,$(BUILD)/mm/%.o,$(MM_CPP)) $(BUILD)/web_main.o

.PHONY: all clean

all: $(OUT)

$(OUT): $(OBJ)
	@mkdir -p $(dir $@)
	$(EMCC) $(LDFLAGS) $^ -o $@

clean:
	rm -rf $(BUILD) $(OUT)

# --- objects ------------------------------------------------------------------
$(BUILD)/mm/%.o: $(MM)/src/core/%.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(FLAGS) $(CPPFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/%.o: %.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(FLAGS) $(CPPFLAGS) -MMD -MP -c $< -o $@

-include $(shell find $(BUILD) -name '*.d' 2>/dev/null)
