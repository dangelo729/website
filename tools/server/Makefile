# the site's worker and ops's beside it: their secrets. each worker's
# gate's password is in the vault (../vault.yml) and set at cloudflare as
# its PASSWORD secret, once the worker has been deployed with its script
#
#   make secret-dev   set dev.dangelo.engineering's password from the vault
#   make secret-ops   set ops.dangelo.engineering's
#   make secret-main  set dangelo.engineering's
#   make secrets      set all three
#
# requires gnu make 3.81 (macos).

ROOT   := $(abspath ../..)

.PHONY: all secrets secret-main secret-dev secret-ops

# a bare make sets nothing: each secret is asked for by name
all:
	@echo "make secret-dev, secret-ops, secret-main or secrets"

# a password read out of the vault and piped to wrangler, never shown
secret-main:
	@cd $(ROOT) && ansible-vault view tools/vault.yml | awk '$$1 == "main_password:" { printf "%s", $$2 }' | npx wrangler secret put PASSWORD --env=""

secret-dev:
	@cd $(ROOT) && ansible-vault view tools/vault.yml | awk '$$1 == "dev_password:" { printf "%s", $$2 }' | npx wrangler secret put PASSWORD --env dev

secret-ops:
	@cd $(ROOT) && ansible-vault view tools/vault.yml | awk '$$1 == "ops_password:" { printf "%s", $$2 }' | npx wrangler secret put PASSWORD --env ops

secrets: secret-main secret-dev secret-ops
