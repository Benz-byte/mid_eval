import { loadTheme, saveTheme, THEME_STORAGE_KEY, type Theme } from '../../storage/themeStorage'

const THEME_EVENT = 'auto-scheduler-theme-change'

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  saveTheme(theme)
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
