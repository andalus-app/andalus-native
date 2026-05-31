-- ─────────────────────────────────────────────────────────────────────────────
-- youtube-streams live-detection cron
--
-- WHY: the youtube-streams Edge Function is pull-based — it only runs when it is
-- called. Live-stream detection (and the resulting push notification) therefore
-- used to depend on a user happening to have the app open near the moment a
-- broadcast went on air. This schedules a server-side ping every minute so
-- detection + push no longer depend on app usage at all.
--
-- QUOTA: a 1-minute ping does NOT multiply YouTube quota. The function returns
-- the cache (0 API units) until NORMAL_TTL_SEC / HOT_TTL_SEC expire — only the
-- TTLs gate real YouTube calls. NORMAL_TTL_SEC is set to 2400 (40 min → 36
-- refreshes/day ≈ 7,272 units) leaving headroom under the 10,000/day budget for
-- hot-mode events around scheduled streams.
--
-- AUTH: the function runs with verify_jwt=true. The anon key is a valid JWT and
-- is already public (shipped in the client), so it is safe to embed here — this
-- is exactly the request the app makes.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent: drop any previous schedule with this name before (re)creating it.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'youtube-streams-poll') then
    perform cron.unschedule('youtube-streams-poll');
  end if;
end $$;

select cron.schedule(
  'youtube-streams-poll',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://yqtnwgezqbznbpeooott.supabase.co/functions/v1/youtube-streams',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxdG53Z2V6cWJ6bmJwZW9vb3R0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzOTkyNzIsImV4cCI6MjA4ODk3NTI3Mn0.ELMMwwFKuT7JnXDU0NiQDYFXs8eZWSjThZH1bNJAw6Y'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
