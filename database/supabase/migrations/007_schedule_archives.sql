-- Independent, immutable schedule snapshots. No foreign keys to active schedules.
create table if not exists public.schedule_archives (
  id uuid primary key,
  name text not null,
  school_year text not null,
  semester text not null,
  created_at timestamptz not null,
  snapshot jsonb not null,
  deleted_at timestamptz
);

create or replace function public.preserve_schedule_archive_snapshot()
returns trigger language plpgsql as $$
begin
  if new.id is distinct from old.id or new.name is distinct from old.name
    or new.school_year is distinct from old.school_year
    or new.semester is distinct from old.semester
    or new.created_at is distinct from old.created_at
    or new.snapshot is distinct from old.snapshot then
    raise exception 'Saved archive snapshots cannot be changed';
  end if;
  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'Deleted archives cannot be restored';
  end if;
  return new;
end;
$$;

drop trigger if exists preserve_schedule_archive_snapshot on public.schedule_archives;
create trigger preserve_schedule_archive_snapshot before update on public.schedule_archives
for each row execute function public.preserve_schedule_archive_snapshot();

alter table public.schedule_archives enable row level security;
drop policy if exists "Prototype users can read archives" on public.schedule_archives;
create policy "Prototype users can read archives" on public.schedule_archives
for select to anon, authenticated using (true);
drop policy if exists "Prototype users can save archives" on public.schedule_archives;
create policy "Prototype users can save archives" on public.schedule_archives
for insert to anon, authenticated with check (true);
drop policy if exists "Prototype users can delete archives" on public.schedule_archives;
create policy "Prototype users can delete archives" on public.schedule_archives
for update to anon, authenticated using (true) with check (deleted_at is not null);
