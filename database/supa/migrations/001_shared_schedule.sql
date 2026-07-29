-- Shared CCS schedule storage for the current prototype.
-- Run this file once in Supabase Dashboard > SQL Editor.

create table if not exists public.shared_schedules (
  id text primary key,
  csv_name text not null default '',
  csv_events jsonb not null default '[]'::jsonb,
  admin_events jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.shared_schedules enable row level security;

drop policy if exists "Prototype users can read shared schedules"
  on public.shared_schedules;
create policy "Prototype users can read shared schedules"
  on public.shared_schedules
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Prototype users can create shared schedules"
  on public.shared_schedules;
create policy "Prototype users can create shared schedules"
  on public.shared_schedules
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Prototype users can update shared schedules"
  on public.shared_schedules;
create policy "Prototype users can update shared schedules"
  on public.shared_schedules
  for update
  to anon, authenticated
  using (true)
  with check (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shared_schedules'
  ) then
    alter publication supabase_realtime add table public.shared_schedules;
  end if;
end
$$;

