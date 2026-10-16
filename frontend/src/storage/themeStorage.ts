export type Theme = 'dark' | 'light'
export const THEME_STORAGE_KEY = 'auto-scheduler-theme'
const THEME_EVENT = 'auto-scheduler-theme-change'

export function loadTheme(): Theme {
  try { return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark' }
  catch { return 'dark' }
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  try { localStorage.setItem(THEME_STORAGE_KEY, theme) } catch { /* Theme still works when storage is unavailable. */ }
  window.dispatchEvent(new Event(THEME_EVENT))
}

export function subscribeTheme(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) applyTheme(loadTheme())
  }
  window.addEventListener(THEME_EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(THEME_EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}
