export type Theme = 'dark' | 'light'
export const THEME_STORAGE_KEY = 'auto-scheduler-theme'

export function loadTheme(): Theme {
  try { return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark' }
  catch { return 'dark' }
}

export function saveTheme(theme: Theme) {
  try { localStorage.setItem(THEME_STORAGE_KEY, theme) } catch { /* Theme still works when storage is unavailable. */ }
}
