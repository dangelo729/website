# the site's worker and ops's beside it: what they share with chebble, and
# their secrets. the gate (gate.js), its table (migrations/0002_gate.sql)
# and the look's scripts are meant to be the same files here and in
# chebble, a fix to one made in both; the sibling repo is read in place and
# never written. each worker's gate's password is in the vault
# (../vault.yml) and set at cloudflare as its PASSWORD secret, once the
# worker has been deployed with its script
#
#   make check        say whether each shared file differs from chebble's
#   make secret-dev   set dev.dangelo.engineering's password from the vault
#   make secret-ops   set ops.dangelo.engineering's
#   make secret-main  set dangelo.engineering's
#   make secrets      set all three
#
# requires gnu make 3.81 (macos).

ROOT   := $(abspath ../..)
CH     := $(abspath ../../../chebble)
SHARED := tools/server/gate.js tools/server/migrations/0002_gate.sql \
          js/raster.js js/skin.js js/type.js js/softbody.js js/cursor.js js/hand-art.js

.PHONY: check secrets secret-main secret-dev secret-ops

check:
	@for f in $(SHARED); do \
	  cmp -s $(CH)/$$f $(ROOT)/$$f && echo "$$f is chebble's" || echo "$$f differs from chebble's"; \
	done

# a password read out of the vault and piped to wrangler, never shown
secret-main:
	@cd $(ROOT) && ansible-vault view tools/vault.yml | awk '$$1 == "main_password:" { printf "%s", $$2 }' | npx wrangler secret put PASSWORD --env=""

secret-dev:
	@cd $(ROOT) && ansible-vault view tools/vault.yml | awk '$$1 == "dev_password:" { printf "%s", $$2 }' | npx wrangler secret put PASSWORD --env dev

secret-ops:
	@cd $(ROOT) && ansible-vault view tools/vault.yml | awk '$$1 == "ops_password:" { printf "%s", $$2 }' | npx wrangler secret put PASSWORD --env ops

secrets: secret-main secret-dev secret-ops
