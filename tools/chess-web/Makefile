# chess on the web: the chess set (pieces/, made by pieces.py),
# physics_box's rigid bodies and third_dimension's renderer, with the glue,
# through emscripten into one standalone wasm, ../../chess/chess.wasm, with
# no javascript glue: js/chess.js instantiates it on the page. the sibling
# repos are read in place and never written; their objects are made here,
# under build/, and so is each mesh's header, made of its obj by
# third_dimension's tools/obj2mesh.py.
#
#   make          build ../../chess/chess.wasm
#   make pieces   write pieces/*.obj and pieces/shapes.h again (pieces.py)
#   make clean
#
# requires gnu make 3.81 (macos).

WS := $(abspath ../../..)
PB := $(WS)/physics_box
TD := $(WS)/third_dimension

EMCC  ?= em++
BUILD := build
OUT   := ../../chess/chess.wasm

# the ship's flags (tools/the_ship-web)
FLAGS    := -std=c++17 -O2 -w -ffp-contract=off
CPPFLAGS := -I$(PB)/src -I$(TD)/src -I$(BUILD) -I.

# no entry, no runtime: the glue's functions and the memory are the exports,
# the memory fixed, so the page needs nothing of emscripten's and its view
# of the picture never moves
EXPORTS := _chess_init,_chess_colours,_chess_look,_chess_size,_chess_step,_chess_px,_chess_w,_chess_h,_chess_at,_chess_take,_chess_carry,_chess_drop,_chess_turn,_chess_reset,_chess_stirring,_chess_piece,_chess_point,_chess_meet,_chess_hit,_chess_hover,_chess_tip,_chess_put,_chess_leading,_chess_mover,_chess_held,_chess_mark,_chess_unmark,_chess_near,_chess_aimed,_chess_spot,_chess_square,_chess_go,_chess_off,_chess_back,_chess_crown,_chess_zoom,_chess_kind,_chess_shown,_chess_state
LDFLAGS := -O2 -sSTANDALONE_WASM=1 --no-entry -sFILESYSTEM=0 -sINITIAL_MEMORY=16mb \
           -sEXPORTED_FUNCTIONS=$(EXPORTS)

MESHES  := pawn rook knight bishop queen king slab dark frame ring tile band
HEADERS := $(patsubst %,$(BUILD)/meshes/%.h,$(MESHES))

# of physics_box, the rigid bodies alone
PB_CPP := $(PB)/src/core/pb_bodies.cpp
TD_CPP := $(wildcard $(TD)/src/*.cpp) $(wildcard $(TD)/src/internal/*.cpp)

OBJ := $(patsubst $(PB)/src/%.cpp,$(BUILD)/pb/%.o,$(PB_CPP)) \
       $(patsubst $(TD)/src/%.cpp,$(BUILD)/td/%.o,$(TD_CPP)) \
       $(BUILD)/web_main.o

.PHONY: all clean pieces

all: $(OUT)

$(OUT): $(OBJ)
	@mkdir -p $(dir $@)
	$(EMCC) $(LDFLAGS) $^ -o $@

pieces:
	python3 pieces.py

clean:
	rm -rf $(BUILD) $(OUT)

# --- meshes -------------------------------------------------------------------
$(BUILD)/meshes/%.h: pieces/%.obj
	@mkdir -p $(dir $@)
	python3 $(TD)/tools/obj2mesh.py $< -o $@ --name $*

# --- objects ------------------------------------------------------------------
$(BUILD)/pb/%.o: $(PB)/src/%.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(FLAGS) $(CPPFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/td/%.o: $(TD)/src/%.cpp
	@mkdir -p $(dir $@)
	$(EMCC) $(FLAGS) $(CPPFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/web_main.o: web_main.cpp $(HEADERS)
	@mkdir -p $(dir $@)
	$(EMCC) $(FLAGS) $(CPPFLAGS) -MMD -MP -c $< -o $@

-include $(shell find $(BUILD) -name '*.d' 2>/dev/null)
