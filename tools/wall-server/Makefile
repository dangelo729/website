# the graffiti wall's server: a cloudflare worker, worker.js, and the one
# durable object that holds the wall, run and deployed with wrangler through
# npx. it shares the wall's core with the page: js/wall.js is read in place
# and never written, and build/wall.js is it followed by an export line, so
# the worker can import the same WALL and Wall the page loads as a classic
# script.
#
#   make          build build/wall.js
#   make dev      build, then serve it on port 8787, to this machine only
#   make lan      the same, open to the lan, for a phone beside it; so is
#                 wrangler's own explorer of the wall's storage
#   make deploy   build, then deploy it to cloudflare
#   make secret   give the deployed worker its admin token, from .admin-token
#   make clean
#
# make dev and make lan keep the wall under .wrangler/ and read .dev.vars,
# which lets any origin in and sets the admin token; neither is committed,
# nor is .admin-token, the deployed worker's own.
# requires gnu make 3.81 (macos) and node.

BUILD := build
CORE  := ../../js/wall.js

.PHONY: all dev lan deploy secret clean

all: $(BUILD)/wall.js

$(BUILD)/wall.js: $(CORE)
	@mkdir -p $(BUILD)
	cat $< > $@
	echo 'export { WALL, Wall };' >> $@

dev: all
	npx --yes wrangler dev --ip 127.0.0.1 --port 8787

lan: all
	npx --yes wrangler dev --ip 0.0.0.0 --port 8787

deploy: all
	npx --yes wrangler deploy

secret:
	npx --yes wrangler secret put ADMIN < .admin-token

clean:
	rm -rf $(BUILD)
