-- One workload setting: the minimum gap required after three continuous duty hours.
-- Run this file once in Supabase Dashboard > SQL Editor after 004_admin_event_assistants.sql.

alter table public.student_assistant_schedules
  add column if not exists scheduling_settings jsonb not null
  default '{"minimumGapAfterThreeHourDutyMinutes":30}'::jsonb;

update public.student_assistant_schedules
set scheduling_settings = '{"minimumGapAfterThreeHourDutyMinutes":30}'::jsonb
where scheduling_settings is null;
