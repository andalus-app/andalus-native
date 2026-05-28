-- =============================================================================
-- Phase 2A — address backfill provenance columns for mosques
-- Run this in: Supabase Dashboard → SQL Editor (before running the backfill).
-- Idempotent / rerunnable.
-- =============================================================================

ALTER TABLE mosques
  ADD COLUMN IF NOT EXISTS address_source   TEXT,                       -- e.g. 'nominatim' | 'admin'
  ADD COLUMN IF NOT EXISTS address_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfilled addresses start unverified; an admin flips address_verified=true
-- (and address_source='admin') after manually checking/correcting them.
COMMENT ON COLUMN mosques.address_source   IS 'Origin of address fields: nominatim (auto reverse-geocode) or admin (manual).';
COMMENT ON COLUMN mosques.address_verified IS 'TRUE once an admin has confirmed the address. Auto-backfill leaves it FALSE.';
