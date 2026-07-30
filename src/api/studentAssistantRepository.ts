import { supabase } from '../../database/supa/supabase'

const SHARED_STUDENT_ASSISTANT_ID = 'ccs-main'

interface StudentAssistantRow<AssistantType, ResultType> {
  assistants: AssistantType[]
  solver_result: ResultType | null
}

export interface SharedStudentAssistantData<AssistantType, ResultType> {
  assistants: AssistantType[]
  solverResult: ResultType | null
}

export async function loadSharedStudentAssistantData<AssistantType, ResultType>():
Promise<SharedStudentAssistantData<AssistantType, ResultType> | null> {
  if (!supabase) return null

  const { data, error } = await supabase
    .from('student_assistant_schedules')
    .select('assistants,solver_result')
    .eq('id', SHARED_STUDENT_ASSISTANT_ID)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as StudentAssistantRow<AssistantType, ResultType>
  return {
    assistants: Array.isArray(row.assistants) ? row.assistants : [],
    solverResult: row.solver_result ?? null,
  }
}

export async function saveSharedStudentAssistantData<AssistantType, ResultType>(
  value: SharedStudentAssistantData<AssistantType, ResultType>,
): Promise<void> {
  if (!supabase) return

  const { error } = await supabase
    .from('student_assistant_schedules')
    .upsert({
      id: SHARED_STUDENT_ASSISTANT_ID,
      assistants: value.assistants,
      solver_result: value.solverResult,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })

  if (error) throw error
}

export function subscribeToSharedStudentAssistantData(onChange: () => void) {
  const client = supabase
  if (!client) return () => undefined

  const channel = client
    .channel('student-assistant-schedule-changes')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'student_assistant_schedules',
        filter: `id=eq.${SHARED_STUDENT_ASSISTANT_ID}`,
      },
      onChange,
    )
    .subscribe()

  return () => {
    void client.removeChannel(channel)
  }
}
