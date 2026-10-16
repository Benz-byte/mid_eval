import { useSyncExternalStore } from 'react'
import { applyTheme, currentTheme, subscribeTheme } from '../../storage/themeStorage'

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => 'dark')
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
  return <button type="button" className="theme-toggle" title={label} aria-label={label}
    onClick={() => applyTheme(theme === 'dark' ? 'light' : 'dark')}>
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {theme === 'dark' ? <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </> : <path d="M20.9 13.1A9 9 0 0 1 10.9 3a9 9 0 1 0 10 10.1Z" />}
    </svg>
  </button>
}
