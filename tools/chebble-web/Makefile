# chebble on the web: its chess set (chess.wasm) and the set's sound, the
# chessboard engine (chessboard.wasm), each one standalone wasm with no
# javascript glue: js/chess.js instantiates the set on the page and
# js/clack-worklet.js the engine in its worklet. both are chebble's, built
# there, and nothing is built here: they are copied as they stand there into
# ../../chebble/. the sibling repo is read in place and never written.
#
#   make          copy both from chebble as they stand there
#   make check    say whether either differs from chebble's
#
# requires gnu make 3.81 (macos).

WS  := $(abspath ../../..)
CH  := $(WS)/chebble
OUT := ../../chebble

.PHONY: all check

all:
	@mkdir -p $(OUT)
	cp $(CH)/chess/chess.wasm $(OUT)/chess.wasm
	cp $(CH)/chessboard/chessboard.wasm $(OUT)/chessboard.wasm

check:
	@cmp -s $(CH)/chess/chess.wasm $(OUT)/chess.wasm && echo "chess.wasm is chebble's" || echo "chess.wasm differs from chebble's"
	@cmp -s $(CH)/chessboard/chessboard.wasm $(OUT)/chessboard.wasm && echo "chessboard.wasm is chebble's" || echo "chessboard.wasm differs from chebble's"
