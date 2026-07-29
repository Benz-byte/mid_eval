import { supabase } from '../../database/supa/supabase'

const SHARED_SCHEDULE_ID = 'ccs-main'

interface SharedScheduleRow<T> {
  id: string
  csv_name: string
  csv_events: T[]
  admin_events: T[]
  updated_at: string
}

export interface SharedSchedule<T> {
  csvName: string
  csvEvents: T[]
  adminEvents: T[]
}

export async function loadSharedSchedule<T>(): Promise<SharedSchedule<T> | null> {
  const { data, error } = await supabase
    .from('shared_schedules')
    .select('id,csv_name,csv_events,admin_events,updated_at')
    .eq('id', SHARED_SCHEDULE_ID)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as SharedScheduleRow<T>
  return {
    csvName: row.csv_name,
    csvEvents: Array.isArray(row.csv_events) ? row.csv_events : [],
    adminEvents: Array.isArray(row.admin_events) ? row.admin_events : [],
  }
}

export async function saveSharedSchedule<T>(schedule: SharedSchedule<T>): Promise<void> {
  const { error } = await supabase
    .from('shared_schedules')
    .upsert({
      id: SHARED_SCHEDULE_ID,
      csv_name: schedule.csvName,
      csv_events: schedule.csvEvents,
      admin_events: schedule.adminEvents,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })

  if (error) throw error
}

export function subscribeToSharedSchedule(onChange: () => void) {
  const channel = supabase
    .channel('shared-schedule-changes')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'shared_schedules',
        filter: `id=eq.${SHARED_SCHEDULE_ID}`,
      },
      onChange,
    )
    .subscribe()

  return () => {
    void supabase.removeChannel(channel)
  }
}

