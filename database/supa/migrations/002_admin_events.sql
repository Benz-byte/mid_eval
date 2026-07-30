-- One database row per manually added event so changes can sync across devices.
-- Run this file once in Supabase Dashboard > SQL Editor.

create table if not exists public.admin_events (
  id text primary key,
  event jsonb not null,
  updated_at timestamptz not null default now()
);

-- Copy any events stored in the old shared_schedules JSON array.
insert into public.admin_events (id, event)
select item->>'id', item
from public.shared_schedules
cross join lateral jsonb_array_elements(admin_events) as item
where item->>'id' is not null
on conflict (id) do update set
  event = excluded.event,
  updated_at = now();

alter table public.admin_events enable row level security;

drop policy if exists "Prototype users can read admin events"
  on public.admin_events;
create policy "Prototype users can read admin events"
  on public.admin_events
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Prototype users can create admin events"
  on public.admin_events;
create policy "Prototype users can create admin events"
  on public.admin_events
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Prototype users can update admin events"
  on public.admin_events;
create policy "Prototype users can update admin events"
  on public.admin_events
  for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "Prototype users can delete admin events"
  on public.admin_events;
create policy "Prototype users can delete admin events"
  on public.admin_events
  for delete
  to anon, authenticated
  using (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'admin_events'
  ) then
    alter publication supabase_realtime add table public.admin_events;
  end if;
end
$$;
