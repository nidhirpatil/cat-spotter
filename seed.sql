-- Seed the two cats migrated from the original Go version.
-- Apply with: wrangler d1 execute cat-spotter --remote --file=seed.sql
-- (Run AFTER uploading their images to R2 — see README.)
INSERT OR IGNORE INTO cats (id, name, image_key, last_seen) VALUES
  ('85fc3879a574a11a', 'Puma', 'c97d9be7d208a5e9.jpg', 1782572801372),
  ('8b35d021561ab616', 'Chudail', '9bc49a97b9f62a75.jpg', NULL);
