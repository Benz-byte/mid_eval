-- Workload limits and the minimum gap required after three continuous duty hours.
-- Run this file once in Supabase Dashboard > SQL Editor after 004_admin_event_assistants.sql.

alter table public.student_assistant_schedules
  add column if not exists scheduling_settings jsonb not null
  default '{"minimumGapAfterThreeHourDutyMinutes":30,"maximumDailyDutyMinutes":240,"maximumWeeklyDutyMinutes":1200}'::jsonb;

alter table public.student_assistant_schedules
  alter column scheduling_settings set default
  '{"minimumGapAfterThreeHourDutyMinutes":30,"maximumDailyDutyMinutes":240,"maximumWeeklyDutyMinutes":1200}'::jsonb;

update public.student_assistant_schedules
set scheduling_settings = '{"minimumGapAfterThreeHourDutyMinutes":30,"maximumDailyDutyMinutes":240,"maximumWeeklyDutyMinutes":1200}'::jsonb
  || coalesce(scheduling_settings, '{}'::jsonb);
