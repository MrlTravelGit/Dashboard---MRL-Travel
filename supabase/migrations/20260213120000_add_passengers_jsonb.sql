-- Add passengers JSONB column to bookings (used by the UI to list all passengers)
alter table if exists public.bookings
  add column if not exists passengers jsonb not null default '[]'::jsonb;

-- Optional: force PostgREST to reload schema cache (helps avoid "schema cache" errors)
-- This works in Supabase SQL editor.
select pg_notify('pgrst', 'reload schema');
