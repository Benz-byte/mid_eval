-- Enforce unique active archive names, ignoring capitalization/extra spaces.
-- Existing duplicates must be reviewed and removed through the app first.
-- This migration never renames or deletes existing snapshots.
create unique index if not exists schedule_archives_unique_name
on public.schedule_archives (lower(regexp_replace(trim(name), '[[:space:]]+', ' ', 'g')))
where deleted_at is null;
