-- the site's numbers, written by /api/tally (tools/server/tally.js): every
-- event as it came, the counts kept a day as events come, each visitor
-- with when it was first seen, each visitor's time on the site a day, and
-- those left out. each site has its own database (wrangler.toml); applied
-- by hand with wrangler d1 migrations apply

-- every event kept: at, ms; a visitor's random id; name, the section or
-- the thing it is of; seconds, a time's on the site, and items, json, its
-- s on each thing open, by name
CREATE TABLE events (
  at INTEGER NOT NULL,
  event TEXT NOT NULL,
  visitor TEXT NOT NULL,
  name TEXT,
  seconds INTEGER,
  items TEXT,
  device TEXT,
  country TEXT
);
CREATE INDEX events_event_at ON events (event, at);

-- each day's count of each metric, the day new york's, yyyy-mm-dd
CREATE TABLE daily (
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (day, metric)
) WITHOUT ROWID;

-- each visitor: its first and last opening, ms, and its device and
-- country at the last
CREATE TABLE visitors (
  visitor TEXT PRIMARY KEY,
  first INTEGER NOT NULL,
  last INTEGER NOT NULL,
  device TEXT,
  country TEXT
) WITHOUT ROWID;
CREATE INDEX visitors_last ON visitors (last);

-- each visitor's s on the site each day it was told of any
CREATE TABLE stays (
  day TEXT NOT NULL,
  visitor TEXT NOT NULL,
  seconds INTEGER NOT NULL,
  PRIMARY KEY (day, visitor)
) WITHOUT ROWID;

-- the visitors left out, the site owner's
CREATE TABLE excluded (
  visitor TEXT PRIMARY KEY
) WITHOUT ROWID;
