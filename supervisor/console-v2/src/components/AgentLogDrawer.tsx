import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LogEvent } from '../types/fleet'
import { useFleetStream } from '../hooks/useFleetStream'

interface AgentLogDrawerProps {
  agent: string
  onClose: () => void
  EventSourceClass?: typeof EventSource
}

function formatTs(iso: string): string {
  try {
    const d = new Date(iso)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    const ss = String(d.getSeconds()).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  } catch {
    return iso.slice(11, 19)
  }
}

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - 100
}

export function AgentLogDrawer({ agent, onClose, EventSourceClass }: AgentLogDrawerProps) {
  const queryClient = useQueryClient()
  const listRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const [restartConfirm, setRestartConfirm] = useState(false)

  const { lastEvent } = useFleetStream(
    EventSourceClass ?? (typeof window !== 'undefined' ? window.EventSource : EventSource),
  )

  const { data } = useQuery<{ events: LogEvent[] }>({
    queryKey: ['log', agent],
    queryFn: async () => {
      const res = await fetch(`/api/log/${encodeURIComponent(agent)}?n=50`)
      if (!res.ok) throw new Error('fetch failed')
      return res.json()
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchInterval: false,
  })

  const events = data?.events ?? []

  // Append fleet-update events for this agent without refetch
  useEffect(() => {
    if (!lastEvent || lastEvent.type !== 'fleet-update') return
    if ((lastEvent as { agent?: string }).agent !== agent) return

    const payload = lastEvent as unknown as { agent: string; ts?: string; tool?: string; summary?: string; file?: string }
    const newEvent: LogEvent = {
      ts: payload.ts ?? new Date().toISOString(),
      tool: payload.tool,
      summary: payload.summary ?? '',
      file: payload.file,
    }

    queryClient.setQueryData<{ events: LogEvent[] }>(['log', agent], (old) => ({
      events: [...(old?.events ?? []), newEvent],
    }))
  }, [lastEvent, agent, queryClient])

  // Auto-scroll to bottom when events change, if near bottom
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    if (isNearBottom(el)) {
      el.scrollTop = el.scrollHeight
    }
  }, [events.length])

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function copyLog() {
    const text = events
      .map((ev) => [formatTs(ev.ts), ev.tool, ev.summary, ev.file].filter(Boolean).join(' | '))
      .join('\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function restartAgent() {
    setRestartConfirm(false)
    await fetch(`/api/fleet/restart?agent=${encodeURIComponent(agent)}`, { method: 'POST' })
  }

  return (
    <>
      {/* Backdrop */}
      <div
        data-testid="drawer-backdrop"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.20)',
          zIndex: 40,
        }}
      />

      {/* Drawer panel */}
      <motion.div
        data-testid="agent-log-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Log: ${agent}`}
        initial={{ x: 480 }}
        animate={{ x: 0 }}
        exit={{ x: 480 }}
        transition={{ type: 'spring', duration: 0.25, bounce: 0 }}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: 480,
          height: '100%',
          background: 'var(--color-surface, #ffffff)',
          borderLeft: '1px solid var(--color-border, #e2e8f0)',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 16px',
            borderBottom: '1px solid var(--color-border, #e2e8f0)',
            flexShrink: 0,
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{agent}</span>

          <div style={{ position: 'relative' }}>
            <button
              data-testid="copy-log-btn"
              onClick={copyLog}
              style={{
                fontSize: 12,
                padding: '4px 8px',
                border: '1px solid var(--color-border, #e2e8f0)',
                borderRadius: 4,
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              Copy log
            </button>
            <AnimatePresence>
              {copied && (
                <motion.span
                  data-testid="copied-tooltip"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: -8 }}
                  exit={{ opacity: 0 }}
                  style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: '#1e293b',
                    color: '#fff',
                    fontSize: 11,
                    padding: '2px 6px',
                    borderRadius: 3,
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                  }}
                >
                  Copied!
                </motion.span>
              )}
            </AnimatePresence>
          </div>

          <button
            data-testid="restart-agent-btn"
            onClick={() => setRestartConfirm(true)}
            style={{
              fontSize: 12,
              padding: '4px 8px',
              border: '1px solid #fca5a5',
              borderRadius: 4,
              background: 'transparent',
              color: '#dc2626',
              cursor: 'pointer',
            }}
          >
            Restart agent
          </button>

          <button
            data-testid="drawer-close-btn"
            onClick={onClose}
            aria-label="Close"
            style={{
              fontSize: 16,
              lineHeight: 1,
              padding: '2px 6px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--color-text-dim, #64748b)',
            }}
          >
            ×
          </button>
        </div>

        {/* Confirm restart modal */}
        <AnimatePresence>
          {restartConfirm && (
            <motion.div
              data-testid="restart-confirm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0,0,0,0.30)',
              }}
            >
              <div
                style={{
                  background: 'var(--color-surface, #fff)',
                  border: '1px solid var(--color-border, #e2e8f0)',
                  borderRadius: 8,
                  padding: 24,
                  maxWidth: 320,
                  width: '100%',
                  textAlign: 'center',
                }}
              >
                <p style={{ marginBottom: 16, fontSize: 14 }}>
                  Restart <strong>{agent}</strong>?
                </p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  <button
                    data-testid="restart-confirm-ok"
                    onClick={restartAgent}
                    style={{ padding: '6px 16px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                  >
                    Restart
                  </button>
                  <button
                    data-testid="restart-confirm-cancel"
                    onClick={() => setRestartConfirm(false)}
                    style={{ padding: '6px 16px', background: 'transparent', border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 4, cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Event list */}
        <div
          ref={listRef}
          data-testid="log-list"
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px 0',
          }}
        >
          {events.length === 0 ? (
            <div style={{ padding: '24px 16px', color: 'var(--color-text-dim, #64748b)', fontSize: 13 }}>
              No events yet.
            </div>
          ) : (
            events.map((ev, i) => (
              <div
                key={i}
                data-testid="log-event"
                style={{
                  padding: '6px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  borderBottom: '1px solid var(--color-border, #f1f5f9)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    data-testid="log-ts"
                    style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--color-text-micro, #94a3b8)', flexShrink: 0 }}
                  >
                    {formatTs(ev.ts)}
                  </span>
                  {ev.tool && (
                    <span
                      data-testid="log-tool"
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '1px 5px',
                        borderRadius: 3,
                        background: 'var(--color-accent, #e0f2fe)',
                        color: 'var(--color-accent-fg, #0369a1)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {ev.tool}
                    </span>
                  )}
                  <span
                    data-testid="log-summary"
                    style={{ fontSize: 12, color: 'var(--color-text, #0f172a)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {ev.summary}
                  </span>
                </div>
                {ev.file && (
                  <span
                    data-testid="log-file"
                    style={{ fontSize: 11, color: 'var(--color-text-dim, #64748b)', fontFamily: 'monospace', paddingLeft: 4 }}
                  >
                    {ev.file}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </motion.div>
    </>
  )
}
