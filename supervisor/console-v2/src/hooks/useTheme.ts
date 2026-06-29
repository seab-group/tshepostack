import { useState, useEffect } from 'react'
import {
  Theme,
  getStoredTheme,
  applyTheme,
  persistTheme,
  isDarkPreferred,
} from '../lib/theme'

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if (getStoredTheme() === 'system') {
        applyTheme('system')
      }
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  function toggle() {
    const isDark = document.documentElement.classList.contains('dark')
    const next: Theme = isDark ? 'light' : 'dark'
    persistTheme(next)
    applyTheme(next)
    setThemeState(next)
  }

  const isDark =
    theme === 'dark' || (theme === 'system' && isDarkPreferred())

  return { theme, toggle, isDark }
}
