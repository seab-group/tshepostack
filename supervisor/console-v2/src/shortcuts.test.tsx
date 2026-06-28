import './test-setup'
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { render, cleanup, act } from '@testing-library/react'
import { useShortcuts } from './hooks/useShortcuts'
import { useShortcutStore } from './store/shortcutStore'

function ShortcutsHost() {
  useShortcuts()
  return null
}

function fire(opts: KeyboardEventInit) {
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...opts }))
}

beforeEach(() => {
  useShortcutStore.setState({
    paletteOpen: false,
    activeTab: null,
    activeDrawer: null,
    helpOpen: false,
  })
})

afterEach(() => {
  cleanup()
})

describe('useShortcuts', () => {
  it('AC1: Ctrl+K fires open-palette action', () => {
    render(<ShortcutsHost />)
    act(() => { fire({ key: 'k', ctrlKey: true }) })
    expect(useShortcutStore.getState().paletteOpen).toBe(true)
  })

  it('AC1: Ctrl+1 fires navigate-fleet action', () => {
    render(<ShortcutsHost />)
    act(() => { fire({ key: '1', ctrlKey: true }) })
    expect(useShortcutStore.getState().activeTab).toBe('fleet')
  })

  it('AC1: Ctrl+2 fires navigate-queue action', () => {
    render(<ShortcutsHost />)
    act(() => { fire({ key: '2', ctrlKey: true }) })
    expect(useShortcutStore.getState().activeTab).toBe('queue')
  })

  it('AC1: Ctrl+3 fires navigate-pipeline action', () => {
    render(<ShortcutsHost />)
    act(() => { fire({ key: '3', ctrlKey: true }) })
    expect(useShortcutStore.getState().activeTab).toBe('pipeline')
  })

  it('AC1: Ctrl+4 fires navigate-cost action', () => {
    render(<ShortcutsHost />)
    act(() => { fire({ key: '4', ctrlKey: true }) })
    expect(useShortcutStore.getState().activeTab).toBe('cost')
  })

  it('AC1: Ctrl+5 fires navigate-trust action', () => {
    render(<ShortcutsHost />)
    act(() => { fire({ key: '5', ctrlKey: true }) })
    expect(useShortcutStore.getState().activeTab).toBe('trust')
  })

  it('AC1: Escape fires close-active action', () => {
    render(<ShortcutsHost />)
    useShortcutStore.setState({ paletteOpen: true })
    act(() => { fire({ key: 'Escape' }) })
    expect(useShortcutStore.getState().paletteOpen).toBe(false)
  })

  it('AC3: Escape closes help dialog when helpOpen is true', () => {
    render(<ShortcutsHost />)
    useShortcutStore.setState({ helpOpen: true })
    act(() => { fire({ key: 'Escape' }) })
    expect(useShortcutStore.getState().helpOpen).toBe(false)
  })

  it('AC3: Ctrl+? toggles help dialog open', () => {
    render(<ShortcutsHost />)
    act(() => { fire({ key: '?', ctrlKey: true }) })
    expect(useShortcutStore.getState().helpOpen).toBe(true)
  })

  it('AC3: Ctrl+? toggles help dialog closed when already open', () => {
    render(<ShortcutsHost />)
    useShortcutStore.setState({ helpOpen: true })
    act(() => { fire({ key: '?', ctrlKey: true }) })
    expect(useShortcutStore.getState().helpOpen).toBe(false)
  })

  it('AC2: shortcut suppressed when target is INPUT', () => {
    render(<ShortcutsHost />)
    const input = document.createElement('input')
    document.body.appendChild(input)
    const evt = new KeyboardEvent('keydown', { bubbles: true, key: 'k', ctrlKey: true })
    Object.defineProperty(evt, 'target', { value: input })
    act(() => { window.dispatchEvent(evt) })
    expect(useShortcutStore.getState().paletteOpen).toBe(false)
    document.body.removeChild(input)
  })

  it('AC2: shortcut suppressed when target is TEXTAREA', () => {
    render(<ShortcutsHost />)
    const ta = document.createElement('textarea')
    document.body.appendChild(ta)
    const evt = new KeyboardEvent('keydown', { bubbles: true, key: 'k', ctrlKey: true })
    Object.defineProperty(evt, 'target', { value: ta })
    act(() => { window.dispatchEvent(evt) })
    expect(useShortcutStore.getState().paletteOpen).toBe(false)
    document.body.removeChild(ta)
  })

  it('AC2: shortcut suppressed when target is SELECT', () => {
    render(<ShortcutsHost />)
    const sel = document.createElement('select')
    document.body.appendChild(sel)
    const evt = new KeyboardEvent('keydown', { bubbles: true, key: 'k', ctrlKey: true })
    Object.defineProperty(evt, 'target', { value: sel })
    act(() => { window.dispatchEvent(evt) })
    expect(useShortcutStore.getState().paletteOpen).toBe(false)
    document.body.removeChild(sel)
  })
})
