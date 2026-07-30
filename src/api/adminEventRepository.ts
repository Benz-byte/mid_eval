import { supabase } from '../../database/supa/supabase'

interface AdminEventRow<T> {
  event: T
}

export async function loadSharedAdminEvents<T>(): Promise<T[]> {
  if (!supabase) return []

  const { data, error } = await supabase
    .from('admin_events')
    .select('event')
    .order('updated_at')

  if (error) throw error
  return (data as AdminEventRow<T>[]).map(row => row.event)
}

export async function saveSharedAdminEvent<T extends { id: string }>(event: T): Promise<void> {
  if (!supabase) return

  const { error } = await supabase
    .from('admin_events')
    .upsert({
      id: event.id,
      event,
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
