import { useShortcutStore } from '../store/shortcutStore'

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: '⌘K / Ctrl+K', action: 'Open command palette' },
  { keys: '⌘1 / Ctrl+1', action: 'Navigate to Fleet tab' },
  { keys: '⌘2 / Ctrl+2', action: 'Navigate to Queue tab' },
  { keys: '⌘3 / Ctrl+3', action: 'Navigate to Pipeline tab' },
  { keys: '⌘4 / Ctrl+4', action: 'Navigate to Cost tab' },
  { keys: '⌘5 / Ctrl+5', action: 'Navigate to Trust tab' },
  { keys: 'Escape', action: 'Close drawer / sheet / modal' },
  { keys: '⌘? / Ctrl+?', action: 'Toggle this shortcuts overlay' },
]

export function ShortcutsDialog() {
  const helpOpen = useShortcutStore((s) => s.helpOpen)
  const toggleHelp = useShortcutStore((s) => s.toggleHelp)

  if (!helpOpen) return null

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={toggleHelp}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="bg-[--color-surface] border border-[--color-border] rounded-lg shadow-xl p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-4">Keyboard shortcuts</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[--color-text-dim] border-b border-[--color-border]">
              <th className="pb-2 font-medium">Shortcut</th>
              <th className="pb-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {SHORTCUTS.map(({ keys, action }) => (
              <tr key={keys} className="border-b border-[--color-border] last:border-0">
                <td className="py-2 pr-4">
                  <kbd className="font-mono text-xs bg-[--color-base] px-1.5 py-0.5 rounded border border-[--color-border]">
                    {keys}
                  </kbd>
                </td>
                <td className="py-2 text-[--color-text-dim]">{action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
