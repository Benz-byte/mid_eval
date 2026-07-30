import { supabase } from '../../database/supa/supabase'

export interface SharedAdminEvent {
  id: string
  source: 'admin'
  courseCode: string
  subject: string
  date: string
  startMinutes: number
  endMinutes: number
  classType: string
  section: string
  room: string
  studentCount: string
  instructorLastName: string
}

interface AdminEventRow {
  id: string
  title: string
  event_date: string
  room: string
  start_minutes: number
  end_minutes: number
}

export async function loadSharedAdminEvents(): Promise<SharedAdminEvent[]> {
  if (!supabase) return []

  const { data, error } = await supabase
    .from('admin_events')
    .select('id,title,event_date,room,start_minutes,end_minutes')
    .order('updated_at')

  if (error) throw error

  return (data as AdminEventRow[]).map(row => ({
    id: row.id,
    source: 'admin',
    courseCode: row.title,
    subject: '',
    date: row.event_date,
    startMinutes: row.start_minutes,
    endMinutes: row.end_minutes,
    classType: 'EVENT',
    section: '',
    room: row.room,
    studentCount: '',
    instructorLastName: '',
  }))
}

export async function saveSharedAdminEvent(event: {
  id: string
  courseCode: string
  date?: string
  room: string
  startMinutes: number
  endMinutes: number
}): Promise<void> {
  if (!supabase) return
  if (!event.date) throw new Error('An event date is required.')

  const { error } = await supabase
    .from('admin_events')
    .upsert({
      id: event.id,
      title: event.courseCode,
      event_date: event.date,
      room: event.room,
      start_minutes: event.startMinutes,
      end_minutes: event.endMinutes,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })

  if (error) throw error
}

export async function deleteSharedAdminEvent(id: string): Promise<void> {
  if (!supabase) return

  const { error } = await supabase
    .from('admin_events')
    .delete()
    .eq('id', id)

  if (error) throw error
}

export function subscribeToSharedAdminEvents(onChange: () => void) {
  const client = supabase
  if (!client) return () => undefined

  const channel = client
    .channel('admin-event-changes')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'admin_events',
      },
      onChange,
    )
    .subscribe()

  return () => {
    void client.removeChannel(channel)
  }
}
