-- =============================================================================
-- Phase 3 — admin moderation support for "Närmaste masjid"
-- Run this in: Supabase Dashboard → SQL Editor. Idempotent / rerunnable.
--
-- Adds submitted_device_hash to mosques so an admin can block a submitter by
-- their (hashed) device even when there is no app_users.id. submit_mosque is
-- updated to store it. All admin read/write is already gated by the RLS
-- policies from 20260527_mosques.sql (is_linked_admin()); no new policies here.
-- =============================================================================

ALTER TABLE mosques
  ADD COLUMN IF NOT EXISTS submitted_device_hash TEXT; -- mirrors submission_rate_limits.device_id_hash

-- ── submit_mosque: also persist the submitter's device hash on the row ───────
-- (Hourly limit kept at 10 to match the current deployment.)
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
    image_url, image_storage_path, status, submitted_by_user_id, submitted_device_hash
  ) VALUES (
    p_name, p_address, p_postal_code, p_city, 'Sweden',
    p_latitude, p_longitude, p_opening_hours, p_parking_available, p_access_info,
    p_image_url, p_image_storage_path, 'pending', p_user_id, p_device_id_hash
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
