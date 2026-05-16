-- Fix display_type CHECK constraint to include home_top and notification_only.
-- The original migration only allowed ('popup', 'banner'), which caused silent
-- INSERT/UPDATE failures for those two types.
-- Run in: Supabase Dashboard → SQL Editor

ALTER TABLE announcements
  DROP CONSTRAINT IF EXISTS announcements_display_type_check;

ALTER TABLE announcements
  ADD CONSTRAINT announcements_display_type_check
  CHECK (display_type IN ('popup', 'banner', 'home_top', 'notification_only'));
