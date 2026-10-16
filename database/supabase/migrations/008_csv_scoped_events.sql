-- Events belong to the content identifier of their originating schedule file.
-- Existing unscoped events are preserved; their origin cannot be inferred safely.
alter table public.admin_events
  add column if not exists schedule_key text;

create index if not exists admin_events_schedule_key_idx
  on public.admin_events (schedule_key);
