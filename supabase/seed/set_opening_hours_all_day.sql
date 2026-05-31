-- =============================================================================
-- Set opening hours to "Dygnet runt" (open 24/7) on mosques that have none.
-- Run this in: Supabase Dashboard → SQL Editor
--
-- Stored format matches the app's 24/7 sentinel: { "alla": "Dygnet runt" }.
-- The masjid card renders this under "Öppettider" as "Mån–Sön: Dygnet runt"
-- (components/masjid/format.ts → formatOpeningHours).
--
-- SAFETY:
--   * Only rows WITHOUT opening hours are touched (opening_hours IS NULL or an
--     empty object). Mosques that already have real hours are NOT overwritten.
--   * UPDATE only — no inserts/deletes.
--   * Idempotent: re-running changes nothing on already-set rows.
--
-- Run AFTER the import (import_mosques_scraped.sql) so the freshly imported
-- mosques — which are inserted with opening_hours = NULL — are included here.
-- =============================================================================

UPDATE mosques
SET opening_hours = jsonb_build_object('alla', 'Dygnet runt')
WHERE opening_hours IS NULL
   OR opening_hours = '{}'::jsonb;

-- How many mosques now show "Dygnet runt":
--   SELECT count(*) FROM mosques WHERE opening_hours = jsonb_build_object('alla', 'Dygnet runt');
