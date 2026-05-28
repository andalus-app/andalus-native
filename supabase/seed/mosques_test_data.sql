-- =============================================================================
-- OPTIONAL test data for "Närmaste masjid" (Phase 1 testing).
-- NOT a migration — run this manually in the Supabase SQL Editor only when you
-- want sample approved mosques. Safe to rerun (deletes its own rows first).
-- Coordinates are approximate; edit/remove as you like.
-- =============================================================================

-- Remove previously-seeded test rows so reruns don't pile up duplicates.
DELETE FROM mosques
WHERE name IN ('Stockholms moské', 'Göteborgs moské', 'Islamic Center Malmö');

INSERT INTO mosques
  (name, address, postal_code, city, latitude, longitude, status,
   parking_available, opening_hours, access_info)
VALUES
  ('Stockholms moské', 'Kapellgränd 10', '116 25', 'Stockholm',
   59.31402, 18.07564, 'approved', true,
   '{"alla":"05:00–23:00"}', 'Rullstolsanpassad entré'),
  ('Göteborgs moské', 'Ramberget, Hisingen', '417 06', 'Göteborg',
   57.73760, 11.99860, 'approved', true,
   '{"vardagar":"06:00–22:00","helg":"06:00–23:00"}', 'Parkering på området'),
  ('Islamic Center Malmö', 'Jägersrovägen 90', '212 37', 'Malmö',
   55.58820, 13.03800, 'approved', false,
   '{"alla":"05:30–22:30"}', 'Närhet till kollektivtrafik');

-- Tip: add one row near your actual test location to verify a sub-kilometre
-- distance and the pulsing "nearest" marker, e.g.:
--   INSERT INTO mosques (name, city, latitude, longitude, status)
--   VALUES ('Testmasjid (nära mig)', 'Test', <DIN_LAT>, <DIN_LNG>, 'approved');
