-- Run after migrations 001-009. Keep deleted IDs so stale/offline clients
-- cannot recreate events, including events deleted before their first upload.
begin;

create table if not exists public.admin_event_deletions (
  event_id text primary key,
  deleted_at timestamptz not null default now()
);
alter table public.admin_event_deletions enable row level security;
revoke all on public.admin_event_deletions from anon, authenticated;
grant select on public.admin_event_deletions to anon, authenticated;
drop policy if exists "Read event deletions" on public.admin_event_deletions;
create policy "Read event deletions" on public.admin_event_deletions
  for select to anon, authenticated using (true);

create or replace function public.guard_admin_event_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  event_id_value text;
begin
  if TG_OP = 'DELETE' then event_id_value := OLD.id;
  else event_id_value := NEW.id;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(event_id_value, 0));
  if TG_OP = 'DELETE' then
    insert into public.admin_event_deletions(event_id) values (event_id_value)
      on conflict (event_id) do nothing;
    return OLD;
  end if;
  if TG_OP = 'UPDATE' and NEW.id is distinct from OLD.id then
    raise exception 'Event IDs cannot be changed';
  end if;
  if exists (select 1 from public.admin_event_deletions where event_id = event_id_value) then
    raise exception 'ADMIN_EVENT_DELETED';
  end if;
  return NEW;
end;
$$;

drop trigger if exists admin_event_deletion_guard on public.admin_events;
create trigger admin_event_deletion_guard before insert or update or delete
  on public.admin_events for each row execute function public.guard_admin_event_deletion();

create or replace function public.delete_admin_event(event_id_value text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if event_id_value is null or btrim(event_id_value) = '' then
    raise exception 'Event ID is required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(event_id_value, 0));
  insert into public.admin_event_deletions(event_id) values (event_id_value)
    on conflict (event_id) do nothing;
  delete from public.admin_events where id = event_id_value;
end;
$$;
revoke all on function public.guard_admin_event_deletion() from public;
revoke all on function public.delete_admin_event(text) from public;
grant execute on function public.delete_admin_event(text) to anon, authenticated;

commit;
