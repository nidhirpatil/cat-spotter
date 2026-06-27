-- Cat Spotter schema. Apply with:
--   wrangler d1 execute cat-spotter --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS cats (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  image_key TEXT,            -- R2 object key for the photo, or NULL
  last_seen INTEGER          -- unix milliseconds when last spotted, or NULL
);

-- Speeds up the "most recently spotted" ordering on the home page.
CREATE INDEX IF NOT EXISTS idx_cats_last_seen ON cats (last_seen DESC);
