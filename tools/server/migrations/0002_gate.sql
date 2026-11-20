-- the site's lock, set from ops (tools/ops/controls.js) and read by the
-- site's gate (tools/server/gate.js): at most one row, none until ops
-- first sets it, and with none the site's lock is as its worker starts.
-- applied by hand with wrangler d1 migrations apply

-- locked 1 for a password asked for, 0 for open to everyone; hash, salt
-- and key null while the password is still the worker's secret, and once
-- one is set from ops its pbkdf2-sha-256 hash, its salt and the key the
-- gate's cookies are signed with, all hex; at, ms, when the row last
-- changed
CREATE TABLE gate (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  locked INTEGER NOT NULL CHECK (locked IN (0, 1)),
  hash TEXT,
  salt TEXT,
  key TEXT,
  at INTEGER NOT NULL
);
