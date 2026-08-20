-- Shared student-assistant inputs and generated recurring duty schedule.
-- Run this file once in Supabase Dashboard > SQL Editor.

create table if not exists public.student_assistant_schedules (
  id text primary key,
  assistants jsonb not null default '[]'::jsonb,
  solver_result jsonb,
  updated_at timestamptz not null default now()
);

alter table public.student_assistant_schedules enable row level security;

drop policy if exists "Prototype users can read student assistant schedules"
  on public.student_assistant_schedules;
create policy "Prototype users can read student assistant schedules"
  on public.student_assistant_schedules
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Prototype users can create student assistant schedules"
  on public.student_assistant_schedules;
create policy "Prototype users can create student assistant schedules"
  on public.student_assistant_schedules
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Prototype users can update student assistant schedules"
  on public.student_assistant_schedules;
create policy "Prototype users can update student assistant schedules"
  on public.student_assistant_schedules
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
      and tablename = 'student_assistant_schedules'
  ) then
    alter publication supabase_realtime
      add table public.student_assistant_schedules;
  end if;
end
$$;
