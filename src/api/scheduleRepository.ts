import { isCloudConfigured, supabase } from '../../database/supa/supabase'

const SHARED_SCHEDULE_ID = 'ccs-main'

interface SharedScheduleRow<T> {
  id: string
  csv_name: string
  csv_events: T[]
}

export interface SharedSchedule<T> {
  csvName: string
  csvEvents: T[]
}

export { isCloudConfigured }

export async function loadSharedSchedule<T>(): Promise<SharedSchedule<T> | null> {
  if (!supabase) return null

  const { data, error } = await supabase
    .from('shared_schedules')
    .select('id,csv_name,csv_events')
    .eq('id', SHARED_SCHEDULE_ID)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as SharedScheduleRow<T>
  return {
    csvName: row.csv_name,
    csvEvents: Array.isArray(row.csv_events) ? row.csv_events : [],
  }
}

export async function saveSharedSchedule<T>(schedule: SharedSchedule<T>): Promise<void> {
  if (!supabase) return

  const { error } = await supabase
    .from('shared_schedules')
    .upsert({
      id: SHARED_SCHEDULE_ID,
      csv_name: schedule.csvName,
      csv_events: schedule.csvEvents,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })

  if (error) throw error
}

export function subscribeToSharedSchedule(onChange: () => void) {
  const client = supabase
  if (!client) return () => undefined

  const channel = client
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
    void client.removeChannel(channel)
  }
}
