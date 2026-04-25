-- =============================================================================
-- Announcements feature migration
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================================================

-- ── 1. Announcements table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS announcements (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title                   TEXT        NOT NULL,
  message                 TEXT,
  image_url               TEXT,
  link_url                TEXT,
  link_text               TEXT,
  display_type            TEXT        NOT NULL DEFAULT 'banner'
                            CHECK (display_type IN ('popup', 'banner')),
  notification_mode       TEXT        NOT NULL DEFAULT 'none'
                            CHECK (notification_mode IN ('none', 'push')),
  is_active               BOOLEAN     NOT NULL DEFAULT FALSE,
  starts_at               TIMESTAMPTZ,
  ends_at                 TIMESTAMPTZ,
  created_by_app_user_id  TEXT,       -- app_users.id is text, no FK constraint
  created_by_auth_user_id UUID,       -- mirrors auth.uid() of the admin who created it
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. Indexes ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_announcements_active
  ON announcements (is_active, starts_at, ends_at);

-- ── 3. Enable Row Level Security ───────────────────────────────────────────
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

-- ── 4. RLS: Anyone can read active announcements within their date window ──
-- This is the only policy that executes for anonymous (unauthenticated) users.
CREATE POLICY "anon_read_active_announcements"
  ON announcements
  FOR SELECT
  TO anon
  USING (
    is_active = TRUE
    AND (starts_at IS NULL OR starts_at <= NOW())
    AND (ends_at   IS NULL OR ends_at   >  NOW())
  );

-- ── 5. RLS: Authenticated users can also read active announcements ─────────
CREATE POLICY "auth_read_active_announcements"
  ON announcements
  FOR SELECT
  TO authenticated
  USING (
    is_active = TRUE
    AND (starts_at IS NULL OR starts_at <= NOW())
    AND (ends_at   IS NULL OR ends_at   >  NOW())
  );

-- ── 6. Helper function: verify caller is a linked admin ───────────────────
-- Used in write policies. Checks that auth.uid() matches an app_users record
-- with role='admin' AND a non-null auth_user_id (i.e. the user has been
-- manually linked to a Supabase Auth account).
-- SECURITY DEFINER runs as the function owner (postgres role) so it can query
-- app_users even if the caller has limited table access.
CREATE OR REPLACE FUNCTION is_linked_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app_users
    WHERE auth_user_id::text = auth.uid()::text
      AND role         = 'admin'
      AND auth_user_id IS NOT NULL
      AND deleted_at   IS NULL
  );
$$;

-- ── 7. RLS: Only linked admins may INSERT / UPDATE / DELETE ───────────────
CREATE POLICY "admin_insert_announcements"
  ON announcements
  FOR INSERT
  TO authenticated
  WITH CHECK ( is_linked_admin() );

CREATE POLICY "admin_update_announcements"
  ON announcements
  FOR UPDATE
  TO authenticated
  USING     ( is_linked_admin() )
  WITH CHECK( is_linked_admin() );

CREATE POLICY "admin_delete_announcements"
  ON announcements
  FOR DELETE
  TO authenticated
  USING ( is_linked_admin() );

-- ── 8. Admin read: linked admins can read ALL announcements (not just active)
CREATE POLICY "admin_read_all_announcements"
  ON announcements
  FOR SELECT
  TO authenticated
  USING ( is_linked_admin() );

-- ── 9. Supabase Storage: create the announcements bucket ──────────────────
-- Makes the bucket public so image URLs work without a signed token.
INSERT INTO storage.buckets (id, name, public)
VALUES ('announcements', 'announcements', TRUE)
ON CONFLICT (id) DO NOTHING;

-- ── 10. Storage RLS: anyone can read images (public bucket) ───────────────
CREATE POLICY "announcements_storage_public_read"
  ON storage.objects
  FOR SELECT
  TO anon
  USING ( bucket_id = 'announcements' );

-- ── 11. Storage RLS: only linked admins can upload ────────────────────────
CREATE POLICY "announcements_storage_admin_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'announcements'
    AND is_linked_admin()
  );

-- ── 12. Storage RLS: linked admins can delete their own uploads ───────────
CREATE POLICY "announcements_storage_admin_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'announcements'
    AND is_linked_admin()
  );

-- =============================================================================
-- SETUP CHECKLIST (do these after running the SQL above)
-- =============================================================================
-- 1. In Supabase Dashboard → Authentication → Users: create an Auth account
--    for each admin (email + password).
--
-- 2. Copy the UUID from the Auth user's "User UID" column.
--
-- 3. In Table Editor → app_users: set auth_user_id = <that UUID> for each
--    admin row. Leave it NULL for regular users.
--
-- 4. The admin must sign in with Supabase Auth (email + password) the first
--    time they access the hidden Admin Announcements screen. Subsequent
--    sessions auto-detect the stored session and skip straight to PIN.
-- =============================================================================
