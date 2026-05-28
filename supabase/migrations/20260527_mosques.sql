-- =============================================================================
-- "Närmaste masjid" feature migration
-- Run this in: Supabase Dashboard → SQL Editor
--
-- Reuses the is_linked_admin() SECURITY DEFINER helper created in
-- 20260408_announcements.sql. If that migration has not been run, create the
-- helper first (it is required by the admin write policies below).
--
-- NOTE on id types: app users are identified by app_users.id which is TEXT in
-- this project (see 20260408_announcements.sql). Therefore submitted_by_user_id
-- and the rate-limit/blocked user_id columns are TEXT (they hold app_users.id),
-- while approved_by_admin_id is UUID (it mirrors auth.uid() of the admin).
-- =============================================================================

-- ── 1. mosques table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mosques (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  address             TEXT,
  postal_code         TEXT,
  city                TEXT,
  country             TEXT NOT NULL DEFAULT 'Sweden',
  latitude            DOUBLE PRECISION NOT NULL,
  longitude           DOUBLE PRECISION NOT NULL,
  opening_hours       JSONB,
  parking_available   BOOLEAN,
  access_info         TEXT,
  image_storage_path  TEXT,
  image_url           TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected', 'blocked')),
  submitted_by_user_id  TEXT,   -- app_users.id (TEXT), no FK
  approved_by_admin_id  UUID,   -- auth.uid() of the approving admin
  rejection_reason    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mosques_status ON mosques (status);
CREATE INDEX IF NOT EXISTS idx_mosques_lat_lng ON mosques (latitude, longitude);

-- Keep updated_at fresh on every UPDATE.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mosques_updated_at ON mosques;
CREATE TRIGGER trg_mosques_updated_at
  BEFORE UPDATE ON mosques
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 2. submission_rate_limits table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS submission_rate_limits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT,
  device_id_hash  TEXT,
  ip_hash         TEXT,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  submission_type TEXT NOT NULL DEFAULT 'mosque'
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup
  ON submission_rate_limits (submitted_at, user_id, device_id_hash);

-- ── 3. blocked_submitters table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blocked_submitters (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             TEXT,
  device_id_hash      TEXT,
  reason              TEXT,
  blocked_until       TIMESTAMPTZ,   -- NULL = permanent
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_admin_id UUID
);

CREATE INDEX IF NOT EXISTS idx_blocked_user   ON blocked_submitters (user_id);
CREATE INDEX IF NOT EXISTS idx_blocked_device ON blocked_submitters (device_id_hash);

-- =============================================================================
-- 4. Row Level Security
-- =============================================================================
ALTER TABLE mosques                ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocked_submitters     ENABLE ROW LEVEL SECURITY;

-- ── mosques: public may read ONLY approved rows ──────────────────────────────
DROP POLICY IF EXISTS "anon_read_approved_mosques" ON mosques;
CREATE POLICY "anon_read_approved_mosques"
  ON mosques FOR SELECT TO anon
  USING (status = 'approved');

DROP POLICY IF EXISTS "auth_read_approved_mosques" ON mosques;
CREATE POLICY "auth_read_approved_mosques"
  ON mosques FOR SELECT TO authenticated
  USING (status = 'approved');

-- ── mosques: linked admins may read ALL rows + write ─────────────────────────
DROP POLICY IF EXISTS "admin_read_all_mosques" ON mosques;
CREATE POLICY "admin_read_all_mosques"
  ON mosques FOR SELECT TO authenticated
  USING ( is_linked_admin() );

DROP POLICY IF EXISTS "admin_insert_mosques" ON mosques;
CREATE POLICY "admin_insert_mosques"
  ON mosques FOR INSERT TO authenticated
  WITH CHECK ( is_linked_admin() );

DROP POLICY IF EXISTS "admin_update_mosques" ON mosques;
CREATE POLICY "admin_update_mosques"
  ON mosques FOR UPDATE TO authenticated
  USING ( is_linked_admin() ) WITH CHECK ( is_linked_admin() );

DROP POLICY IF EXISTS "admin_delete_mosques" ON mosques;
CREATE POLICY "admin_delete_mosques"
  ON mosques FOR DELETE TO authenticated
  USING ( is_linked_admin() );

-- NOTE: there is intentionally NO anon/authenticated INSERT policy on mosques.
-- Regular users submit ONLY through submit_mosque() (SECURITY DEFINER), which
-- forces status='pending' and enforces rate limits server-side.

-- ── rate_limits / blocked_submitters: admins manage; RPC (definer) bypasses ──
DROP POLICY IF EXISTS "admin_rw_rate_limits" ON submission_rate_limits;
CREATE POLICY "admin_rw_rate_limits"
  ON submission_rate_limits FOR ALL TO authenticated
  USING ( is_linked_admin() ) WITH CHECK ( is_linked_admin() );

DROP POLICY IF EXISTS "admin_rw_blocked" ON blocked_submitters;
CREATE POLICY "admin_rw_blocked"
  ON blocked_submitters FOR ALL TO authenticated
  USING ( is_linked_admin() ) WITH CHECK ( is_linked_admin() );

-- =============================================================================
-- 5. GRANTs (required in addition to RLS — neither alone is sufficient)
-- =============================================================================
GRANT SELECT                         ON mosques TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON mosques TO authenticated;
GRANT ALL                            ON mosques TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON submission_rate_limits TO authenticated;
GRANT ALL                            ON submission_rate_limits TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON blocked_submitters TO authenticated;
GRANT ALL                            ON blocked_submitters TO service_role;

-- =============================================================================
-- 6. nearby_mosques RPC — Haversine distance, approved-only, sorted ascending
--    Returns distance_meters; supports limit/offset for "Visa fler".
--    SECURITY DEFINER + WHERE status='approved' → safe to expose to anon.
-- =============================================================================
CREATE OR REPLACE FUNCTION nearby_mosques(
  p_lat    DOUBLE PRECISION,
  p_lng    DOUBLE PRECISION,
  p_limit  INTEGER DEFAULT 5,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id                UUID,
  name              TEXT,
  address           TEXT,
  postal_code       TEXT,
  city              TEXT,
  country           TEXT,
  latitude          DOUBLE PRECISION,
  longitude         DOUBLE PRECISION,
  opening_hours     JSONB,
  parking_available BOOLEAN,
  access_info       TEXT,
  image_url         TEXT,
  distance_meters   DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id, m.name, m.address, m.postal_code, m.city, m.country,
    m.latitude, m.longitude, m.opening_hours, m.parking_available, m.access_info,
    m.image_url,
    (6371000 * 2 * asin(sqrt(
        power(sin(radians(m.latitude  - p_lat) / 2), 2) +
        cos(radians(p_lat)) * cos(radians(m.latitude)) *
        power(sin(radians(m.longitude - p_lng) / 2), 2)
    )))::DOUBLE PRECISION AS distance_meters
  FROM mosques m
  WHERE m.status = 'approved'
  ORDER BY distance_meters ASC
  LIMIT  GREATEST(COALESCE(p_limit, 5), 0)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

GRANT EXECUTE ON FUNCTION nearby_mosques(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER)
  TO anon, authenticated, service_role;

-- =============================================================================
-- 7. submit_mosque RPC — user submissions (status forced to 'pending')
--    Enforces: blocked-submitter check + rate limits (3/hour, 10/day).
--    Used by the Phase 2 "Lägg till masjid" flow. Safe for anon (definer).
-- =============================================================================
CREATE OR REPLACE FUNCTION submit_mosque(
  p_name               TEXT,
  p_address            TEXT,
  p_postal_code        TEXT,
  p_city               TEXT,
  p_latitude           DOUBLE PRECISION,
  p_longitude          DOUBLE PRECISION,
  p_opening_hours      JSONB,
  p_parking_available  BOOLEAN,
  p_access_info        TEXT,
  p_image_url          TEXT,
  p_image_storage_path TEXT,
  p_user_id            TEXT,
  p_device_id_hash     TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blocked    BOOLEAN;
  v_count_hour INTEGER;
  v_count_day  INTEGER;
  v_new_id     UUID;
BEGIN
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'mosque_name_required';
  END IF;
  IF p_latitude IS NULL OR p_longitude IS NULL THEN
    RAISE EXCEPTION 'mosque_coords_required';
  END IF;

  -- Blocked submitter (active block by user id OR device hash)
  SELECT EXISTS (
    SELECT 1 FROM blocked_submitters b
    WHERE (b.blocked_until IS NULL OR b.blocked_until > now())
      AND (
        (p_user_id        IS NOT NULL AND b.user_id        = p_user_id) OR
        (p_device_id_hash IS NOT NULL AND b.device_id_hash = p_device_id_hash)
      )
  ) INTO v_blocked;
  IF v_blocked THEN
    RAISE EXCEPTION 'submitter_blocked';
  END IF;

  -- Rate limit: max 10 per hour
  SELECT count(*) INTO v_count_hour
  FROM submission_rate_limits r
  WHERE r.submitted_at > now() - interval '1 hour'
    AND (
      (p_user_id        IS NOT NULL AND r.user_id        = p_user_id) OR
      (p_device_id_hash IS NOT NULL AND r.device_id_hash = p_device_id_hash)
    );
  IF v_count_hour >= 10 THEN
    RAISE EXCEPTION 'rate_limit_hour';
  END IF;

  -- Rate limit: max 10 per day
  SELECT count(*) INTO v_count_day
  FROM submission_rate_limits r
  WHERE r.submitted_at > now() - interval '1 day'
    AND (
      (p_user_id        IS NOT NULL AND r.user_id        = p_user_id) OR
      (p_device_id_hash IS NOT NULL AND r.device_id_hash = p_device_id_hash)
    );
  IF v_count_day >= 10 THEN
    RAISE EXCEPTION 'rate_limit_day';
  END IF;

  INSERT INTO mosques (
    name, address, postal_code, city, country,
    latitude, longitude, opening_hours, parking_available, access_info,
    image_url, image_storage_path, status, submitted_by_user_id
  ) VALUES (
    p_name, p_address, p_postal_code, p_city, 'Sweden',
    p_latitude, p_longitude, p_opening_hours, p_parking_available, p_access_info,
    p_image_url, p_image_storage_path, 'pending', p_user_id
  )
  RETURNING id INTO v_new_id;

  INSERT INTO submission_rate_limits (user_id, device_id_hash, submitted_at, submission_type)
  VALUES (p_user_id, p_device_id_hash, now(), 'mosque');

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_mosque(
  TEXT, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION,
  JSONB, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT
) TO anon, authenticated;

-- =============================================================================
-- 8. Storage bucket: mosque-images (public read; 5 MB; images only)
-- =============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('mosque-images', 'mosque-images', TRUE, 5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public read (URLs are unguessable; pending rows are hidden by mosques RLS so
-- a pending image path is not discoverable through the app).
DROP POLICY IF EXISTS "mosque_images_public_read" ON storage.objects;
CREATE POLICY "mosque_images_public_read"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING ( bucket_id = 'mosque-images' );

-- Linked admins may upload/delete anywhere in the bucket (manual add / replace).
DROP POLICY IF EXISTS "mosque_images_admin_insert" ON storage.objects;
CREATE POLICY "mosque_images_admin_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK ( bucket_id = 'mosque-images' AND is_linked_admin() );

DROP POLICY IF EXISTS "mosque_images_admin_delete" ON storage.objects;
CREATE POLICY "mosque_images_admin_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING ( bucket_id = 'mosque-images' AND is_linked_admin() );

-- User submissions (Phase 2) may upload ONLY into the submissions/ folder.
DROP POLICY IF EXISTS "mosque_images_user_submit_insert" ON storage.objects;
CREATE POLICY "mosque_images_user_submit_insert"
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'mosque-images'
    AND (storage.foldername(name))[1] = 'submissions'
  );

-- =============================================================================
-- SETUP NOTES
-- =============================================================================
-- • Admin auth reuses the announcements setup: an app_users row with
--   role='admin' and a non-null auth_user_id linked to a Supabase Auth account.
-- • is_linked_admin() must already exist (from 20260408_announcements.sql).
-- • This migration inserts NO mosque rows. For optional test data, run the
--   separate seed file manually: supabase/seed/mosques_test_data.sql
-- • Rerunnable: every CREATE POLICY is preceded by DROP POLICY IF EXISTS, the
--   bucket upsert uses ON CONFLICT DO UPDATE, functions use CREATE OR REPLACE,
--   and tables/indexes use IF NOT EXISTS.
-- =============================================================================
