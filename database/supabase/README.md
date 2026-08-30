# Supabase database

Run the SQL files in `migrations/` once, in numerical order, through the
Supabase Dashboard SQL Editor:

1. `001_shared_schedule.sql`
2. `002_admin_events.sql`
3. `003_student_assistant_schedules.sql`
4. `004_admin_event_assistants.sql`
5. `005_duty_break_setting.sql`

The SQL files define the hosted tables and policies. Runtime CRUD is handled
by the Python repositories in `backend/database/supabase/`.
