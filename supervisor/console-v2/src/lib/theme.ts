export type Theme = 'light' | 'dark' | 'system'

export const THEME_KEY = 'console-theme'

export function getStoredTheme(): Theme {
  try {
    return (localStorage.getItem(THEME_KEY) as Theme) ?? 'system'
  } catch {
    return 'system'
  }
}

export function isDarkPreferred(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function applyTheme(theme: Theme): void {
  const dark = theme === 'dark' || (theme === 'system' && isDarkPreferred())
  document.documentElement.classList.toggle('dark', dark)
}

export function persistTheme(theme: Theme): void {
  localStorage.setItem(THEME_KEY, theme)
}
