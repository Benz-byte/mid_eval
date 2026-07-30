export interface StudentAssistantInput<EventType> {
  id: string
  label: string
  schedule: EventType[]
}

export interface DutyAssignment {
  assistantId: string
  assistantLabel: string
  classId: string
  day: string
  startMinutes: number
  endMinutes: number
  courseCode: string
  subject: string
  room: string
  section: string
}

export interface AssistantTotal {
  assistantId: string
  assistantLabel: string
  hours: number
}

export interface StudentAssistantResult {
  status: 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'INVALID'
  diagnostics: string[]
  assignments?: DutyAssignment[]
  assistantTotals?: AssistantTotal[]
  summary?: {
    assistantCount: number
    coverageHours: number
    requiredHours?: number
    assignmentCount?: number
    assignedClassCount?: number
    unassignedClassCount?: number
  }
}

export async function solveStudentAssistantSchedule<EventType>(
  mainSchedule: EventType[],
  assistants: StudentAssistantInput<EventType>[],
): Promise<StudentAssistantResult> {
  const response = await fetch(`${window.electron.flaskUrl}/api/student-assistant/solve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mainSchedule, assistants }),
  })

  const result = await response.json() as StudentAssistantResult
  if (!response.ok && result.status !== 'INVALID') {
    throw new Error('The scheduler service could not process the request.')
  }
  return result
}
