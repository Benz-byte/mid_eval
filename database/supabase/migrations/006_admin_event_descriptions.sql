-- Optional event descriptions; existing events remain unchanged.
alter table public.admin_events
  add column if not exists description text not null default '';
