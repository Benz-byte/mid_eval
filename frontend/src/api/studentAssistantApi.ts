export interface StudentAssistantInput<EventType> {
  id: string
  label: string
  schedule: EventType[]
}

export interface SchedulingSettings {
  minimumGapAfterThreeHourDutyMinutes: number
}

export const DEFAULT_SCHEDULING_SETTINGS: SchedulingSettings = {
  minimumGapAfterThreeHourDutyMinutes: 30,
}

export const DUTY_GAP_OPTIONS = [0, 30, 60, 90, 120] as const

export function normalizeSchedulingSettings(value?: Partial<SchedulingSettings> | null): SchedulingSettings {
  const gap = Number(value?.minimumGapAfterThreeHourDutyMinutes)
  return {
    minimumGapAfterThreeHourDutyMinutes: DUTY_GAP_OPTIONS.some(option => option === gap)
      ? gap
      : DEFAULT_SCHEDULING_SETTINGS.minimumGapAfterThreeHourDutyMinutes,
  }
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
  remainingHours?: number
}

export interface RelieverAssignment {
  date: string
  classId: string
  day: string
  startMinutes: number
  endMinutes: number
  courseCode: string
  room: string
  originalAssistantId: string
  originalAssistantLabel: string
  replacementAssistantId?: string
  replacementAssistantLabel?: string
}

export interface StudentAssistantResult {
  status: 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'INVALID'
  diagnostics: string[]
  assignments?: DutyAssignment[]
  assistantTotals?: AssistantTotal[]
  relieverAssignments?: RelieverAssignment[]
  appliedSettings?: SchedulingSettings & {
    dutyBreakConstraintCount?: number
  }
  summary?: {
    assistantCount: number
    coverageHours: number
    capacityHours?: number
    assignmentCount?: number
    assignedClassCount?: number
    unassignedClassCount?: number
  }
}

export async function solveStudentAssistantSchedule<EventType>(
  mainSchedule: EventType[],
  assistants: StudentAssistantInput<EventType>[],
  schedulingSettings: SchedulingSettings,
): Promise<StudentAssistantResult> {
  const randomSeed = crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff
  const response = await fetch(`${window.electron.flaskUrl}/api/student-assistant/solve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mainSchedule, assistants, schedulingSettings, randomSeed }),
  })

  const result = await response.json() as StudentAssistantResult
  if (!response.ok && result.status !== 'INVALID') {
    throw new Error('The scheduler service could not process the request.')
  }
  return result
}

export interface SharedStudentAssistantData<AssistantType, ResultType> {
  assistants: AssistantType[]
  solverResult: ResultType | null
  schedulingSettings?: SchedulingSettings
}

export async function loadSharedStudentAssistantData<AssistantType, ResultType>():
Promise<SharedStudentAssistantData<AssistantType, ResultType> | null> {
  if (!isCloudConfigured) return null
  return requestJson<SharedStudentAssistantData<AssistantType, ResultType> | null>(
    '/api/student-assistants/shared',
  )
}

export async function saveSharedStudentAssistantData<AssistantType, ResultType>(
  value: SharedStudentAssistantData<AssistantType, ResultType>,
): Promise<void> {
  if (!isCloudConfigured) return
  await requestJson<void>('/api/student-assistants/shared', {
    method: 'PUT',
    body: JSON.stringify(value),
  })
}

export function subscribeToSharedStudentAssistantData(onChange: () => void) {
  return isCloudConfigured ? pollForChanges(onChange) : () => undefined
}
import { pollForChanges, requestJson } from './apiClient'
import { isCloudConfigured } from './scheduleApi'
