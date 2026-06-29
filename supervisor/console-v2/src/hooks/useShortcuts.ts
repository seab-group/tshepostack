import { useEffect } from 'react'
import { useShortcutStore } from '../store/shortcutStore'

const SUPPRESSED_TAGS = ['INPUT', 'TEXTAREA', 'SELECT']

function isMac(): boolean {
  return typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
}

function modKey(e: KeyboardEvent): boolean {
  return isMac() ? e.metaKey : e.ctrlKey
}

export function useShortcuts(): void {
  const openPalette = useShortcutStore((s) => s.openPalette)
  const navigateTo = useShortcutStore((s) => s.navigateTo)
  const closeActive = useShortcutStore((s) => s.closeActive)
  const toggleHelp = useShortcutStore((s) => s.toggleHelp)

  useEffect(() => {
    function handler(e: KeyboardEvent): void {
      const target = e.target as HTMLElement
      if (SUPPRESSED_TAGS.includes(target.tagName) || target.isContentEditable) return

      if (modKey(e) && e.key === 'k') { e.preventDefault(); openPalette(); return }
      if (modKey(e) && e.key === '1') { e.preventDefault(); navigateTo('fleet'); return }
      if (modKey(e) && e.key === '2') { e.preventDefault(); navigateTo('queue'); return }
      if (modKey(e) && e.key === '3') { e.preventDefault(); navigateTo('pipeline'); return }
      if (modKey(e) && e.key === '4') { e.preventDefault(); navigateTo('cost'); return }
      if (modKey(e) && e.key === '5') { e.preventDefault(); navigateTo('trust'); return }
      if (e.key === 'Escape') { closeActive(); return }
      if (modKey(e) && e.key === '?') { e.preventDefault(); toggleHelp(); return }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [openPalette, navigateTo, closeActive, toggleHelp])
}
