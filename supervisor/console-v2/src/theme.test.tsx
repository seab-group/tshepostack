import './test-setup'
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { render, fireEvent, act, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeToggle } from './components/ThemeToggle'
import { applyTheme } from './lib/theme'

type MqChangeHandler = (e: { matches: boolean }) => void

function setupMatchMedia(initialMatches: boolean) {
  const listeners: MqChangeHandler[] = []
  const mq = {
    matches: initialMatches,
    addEventListener(_type: string, fn: MqChangeHandler) {
      listeners.push(fn)
    },
    removeEventListener(_type: string, fn: MqChangeHandler) {
      const i = listeners.indexOf(fn)
      if (i >= 0) listeners.splice(i, 1)
    },
    addListener: () => {},
    removeListener: () => {},
    trigger(matches: boolean) {
      mq.matches = matches
      listeners.forEach(fn => fn({ matches }))
    },
  }
  Object.defineProperty(window, 'matchMedia', {
    value: (_query: string) => mq,
    writable: true,
    configurable: true,
  })
  return mq
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  )
}

describe('dark mode', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  afterEach(() => {
    cleanup()
  })

  it('AC3: dark system preference applies dark class on load', () => {
    setupMatchMedia(true)
    applyTheme('system')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('AC3: light system preference leaves dark class absent', () => {
    setupMatchMedia(false)
    applyTheme('system')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('AC4: explicit light overrides dark system preference', () => {
    setupMatchMedia(true)
    localStorage.setItem('console-theme', 'light')
    applyTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('AC4: explicit dark overrides light system preference', () => {
    setupMatchMedia(false)
    localStorage.setItem('console-theme', 'dark')
    applyTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('AC2: toggle switches from light to dark and saves localStorage', () => {
    setupMatchMedia(false)
    const { getByRole } = render(<ThemeToggle />, { wrapper: Wrapper })
    fireEvent.click(getByRole('button', { name: /toggle theme/i }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('console-theme')).toBe('dark')
  })

  it('AC2: toggle switches from dark to light', () => {
    setupMatchMedia(false)
    document.documentElement.classList.add('dark')
    localStorage.setItem('console-theme', 'dark')
    const { getByRole } = render(<ThemeToggle />, { wrapper: Wrapper })
    fireEvent.click(getByRole('button', { name: /toggle theme/i }))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('console-theme')).toBe('light')
  })

  it('AC5: system matchMedia change to dark updates class when theme=system', async () => {
    const mq = setupMatchMedia(false)
    localStorage.setItem('console-theme', 'system')
    render(<ThemeToggle />, { wrapper: Wrapper })
    await act(async () => {
      mq.trigger(true)
    })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('AC5: system matchMedia change to light removes dark class when theme=system', async () => {
    const mq = setupMatchMedia(true)
    document.documentElement.classList.add('dark')
    localStorage.setItem('console-theme', 'system')
    render(<ThemeToggle />, { wrapper: Wrapper })
    await act(async () => {
      mq.trigger(false)
    })
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('AC5: system matchMedia change does not update class when explicit theme set', async () => {
    const mq = setupMatchMedia(false)
    localStorage.setItem('console-theme', 'light')
    render(<ThemeToggle />, { wrapper: Wrapper })
    await act(async () => {
      mq.trigger(true)
    })
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
