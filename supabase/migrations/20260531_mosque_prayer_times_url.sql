-- =============================================================================
-- Phase 2D — prayer_times_url on mosques (linked from the "Bönetider" box in
-- the masjid card; opened in-app via a fullscreen WebView, not in Safari).
-- Run in: Supabase Dashboard → SQL Editor. Idempotent / rerunnable.
--
-- nearby_mosques is recreated (RETURNS TABLE columns change → DROP+CREATE).
-- submit_mosque gets one extra parameter with DEFAULT NULL so older clients
-- continue to work (Supabase RPC sends named args; missing → default).
-- =============================================================================

ALTER TABLE mosques
  ADD COLUMN IF NOT EXISTS prayer_times_url TEXT;

-- ── nearby_mosques: include prayer_times_url ────────────────────────────────
DROP FUNCTION IF EXISTS nearby_mosques(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER);

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
  phone             TEXT,
  website           TEXT,
  prayer_times_url  TEXT,
  image_url         TEXT,
  distance_meters   DOUBLE PRECISION
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    m.id, m.name, m.address, m.postal_code, m.city, m.country,
    m.latitude, m.longitude, m.opening_hours, m.parking_available, m.access_info,
    m.phone, m.website, m.prayer_times_url, m.image_url,
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

-- ── submit_mosque: accept + store prayer_times_url (default NULL) ───────────
DROP FUNCTION IF EXISTS submit_mosque(
  TEXT, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION,
  JSONB, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
);

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
  p_device_id_hash     TEXT,
  p_phone              TEXT DEFAULT NULL,
  p_website            TEXT DEFAULT NULL,
  p_prayer_times_url   TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  SELECT EXISTS (
    SELECT 1 FROM blocked_submitters b
    WHERE (b.blocked_until IS NULL OR b.blocked_until > now())
      AND (
        (p_user_id        IS NOT NULL AND b.user_id        = p_user_id) OR
        (p_device_id_hash IS NOT NULL AND b.device_id_hash = p_device_id_hash)
      )
  ) INTO v_blocked;
  IF v_blocked THEN RAISE EXCEPTION 'submitter_blocked'; END IF;

  SELECT count(*) INTO v_count_hour
  FROM submission_rate_limits r
  WHERE r.submitted_at > now() - interval '1 hour'
    AND (
      (p_user_id        IS NOT NULL AND r.user_id        = p_user_id) OR
      (p_device_id_hash IS NOT NULL AND r.device_id_hash = p_device_id_hash)
    );
  IF v_count_hour >= 10 THEN RAISE EXCEPTION 'rate_limit_hour'; END IF;

  SELECT count(*) INTO v_count_day
  FROM submission_rate_limits r
  WHERE r.submitted_at > now() - interval '1 day'
    AND (
      (p_user_id        IS NOT NULL AND r.user_id        = p_user_id) OR
      (p_device_id_hash IS NOT NULL AND r.device_id_hash = p_device_id_hash)
    );
  IF v_count_day >= 10 THEN RAISE EXCEPTION 'rate_limit_day'; END IF;

  INSERT INTO mosques (
    name, address, postal_code, city, country,
    latitude, longitude, opening_hours, parking_available, access_info,
    phone, website, prayer_times_url, image_url, image_storage_path,
    status, submitted_by_user_id, submitted_device_hash
  ) VALUES (
    p_name, p_address, p_postal_code, p_city, 'Sweden',
    p_latitude, p_longitude, p_opening_hours, p_parking_available, p_access_info,
    p_phone, p_website, p_prayer_times_url, p_image_url, p_image_storage_path,
    'pending', p_user_id, p_device_id_hash
  ) RETURNING id INTO v_new_id;

  INSERT INTO submission_rate_limits (user_id, device_id_hash, submitted_at, submission_type)
  VALUES (p_user_id, p_device_id_hash, now(), 'mosque');

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_mosque(
  TEXT, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION,
  JSONB, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO anon, authenticated;
