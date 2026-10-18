# Supabase database

Run the SQL files in `migrations/` once, in numerical order, through the
Supabase Dashboard SQL Editor:

1. `001_shared_schedule.sql`
2. `002_admin_events.sql`
3. `003_student_assistant_schedules.sql`
4. `004_admin_event_assistants.sql`
5. `005_duty_break_setting.sql`
6. `006_admin_event_descriptions.sql`
7. `007_schedule_archives.sql`
8. `008_csv_scoped_events.sql`
9. `009_unique_archive_names.sql`
10. `010_admin_event_deletions.sql`

Migration 010 records permanently deleted event IDs in `admin_event_deletions`.
Run only this new migration if 001-009 are already applied, then restart the
backend. It adds a guard for direct writes and an atomic delete function, including
deletes before an event's first upload. It does not delete existing events. Missing
migration errors leave event writes queued locally. Do not clear deletion records:
they prevent older devices from restoring deleted cards. Deletions made before
this migration cannot be reconstructed automatically.

Migration 008 adds the originating CSV content identifier to events. Until it is
applied, new scoped events remain locally saved and queued for sync rather than
being uploaded without their scope. Older unscoped events are not deleted or
automatically attached to a CSV. Restart the backend after updating the code.

The SQL files define the hosted tables and policies. Runtime CRUD is handled
by the Python repositories in `backend/database/supabase/`.

## Schedule archives

Run `migrations/007_schedule_archives.sql` after the existing migrations to enable
archive synchronization between devices. Until that migration is applied, archive
saves remain local and pending cloud sync. Restart the Flask backend after updating
the application code so `/api/archives` is available.

The archive table stores complete immutable snapshots separately from active
schedules. Deletion uses tombstones so offline devices cannot resurrect deleted
archives. The policies follow this prototype's existing shared-access model; they
are not per-user access control for a public production deployment.
