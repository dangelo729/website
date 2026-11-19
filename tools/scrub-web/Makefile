# the scrubber on the web: the scrubber's core (scrub_core.h) and its glue
# (web_main.cpp) through emscripten into one standalone wasm,
# ../../scrub/scrub.wasm, with no javascript glue: js/scrub-worklet.js
# instantiates it in an audio worklet. its memory grows to hold the sound
# the page gives it. the core is this repo's for now, in a header of its
# own that knows nothing of the web.
#
#   make          build ../../scrub/scrub.wasm
#   make clean
#
# requires gnu make 3.81 (macos).

EMCC  ?= em++
BUILD := build
OUT   := ../../scrub/scrub.wasm

FLAGS := -std=c++17 -O2 -w -ffp-contract=off

# no entry, no runtime: the glue's functions and the memory are the exports.
# the memory starts small and grows as the sound is made room for, up to
# MOST; the worklet is told when it has (env.emscripten_notify_memory_growth),
# the one thing it is asked for
MOST    := 512mb
EXPORTS := _scrub_init,_scrub_catch,_scrub_sound,_scrub_target,_scrub_speed,_scrub_cut,_scrub_render,_scrub_playhead,_scrub_aim,_scrub_going,_scrub_locked
LDFLAGS := -O2 -sSTANDALONE_WASM=1 --no-entry -sFILESYSTEM=0 -sINITIAL_MEMORY=1mb -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=$(MOST) \
           -sEXPORTED_FUNCTIONS=$(EXPORTS)

.PHONY: all clean

all: $(OUT)

$(OUT): $(BUILD)/web_main.o
	@mkdir -p $(dir $@)
	$(EMCC) $(LDFLAGS) $^ -o $@
	@chmod 644 $@

$(BUILD)/web_main.o: web_main.cpp scrub_core.h
	@mkdir -p $(dir $@)
	$(EMCC) $(FLAGS) -c $< -o $@

clean:
	rm -rf $(BUILD) $(OUT)
