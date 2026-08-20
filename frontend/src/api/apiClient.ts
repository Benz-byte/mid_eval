export const backendUrl = () => window.electron.flaskUrl

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${backendUrl()}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(body?.error || `Backend request failed (${response.status}).`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export function pollForChanges(onChange: () => void, intervalMs = 5000) {
  const timer = window.setInterval(onChange, intervalMs)
  return () => window.clearInterval(timer)
}
