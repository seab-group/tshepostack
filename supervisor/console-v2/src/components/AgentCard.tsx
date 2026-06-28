import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { useDrawer } from '../context/DrawerContext'
import type { AgentInfo, AgentStatusValue } from '../types/fleet'

const RING_COLORS: Record<AgentStatusValue, string> = {
  active: '#16a34a',
  paused: '#d97706',
  stuck: '#dc2626',
  stopped: '#9ca3af',
}

const cardVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
}

const ringPulse = {
  animate: {
    scale: [1, 1.1, 1],
    transition: { duration: 2, repeat: Infinity, ease: 'easeInOut' },
  },
}

function formatElapsed(since: string | null): string {
  if (!since) return '—'
  const ms = Date.now() - new Date(since).getTime()
  if (ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

interface AgentCardProps {
  agent: AgentInfo
}

export function AgentCard({ agent: initial }: AgentCardProps) {
  const { data: agent = initial } = useQuery<AgentInfo>({
    queryKey: ['fleet', initial.name],
    queryFn: () => initial,
    initialData: initial,
    staleTime: Infinity,
  })

  const [elapsed, setElapsed] = useState(() => formatElapsed(agent.since))
  const sinceRef = useRef(agent.since)
  sinceRef.current = agent.since

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(formatElapsed(sinceRef.current))
    }, 10_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    setElapsed(formatElapsed(agent.since))
  }, [agent.since])

  const { openDrawer } = useDrawer()
  const color = RING_COLORS[agent.status]

  return (
    <motion.div
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      onClick={() => openDrawer(agent.name)}
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-card)',
        padding: '16px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
      data-testid="agent-card"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <motion.div
            data-ring-color={color}
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              border: `3px solid ${color}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
            animate={agent.status === 'active' ? ringPulse.animate : undefined}
          >
            <svg width="48" height="48" viewBox="0 0 48 48" style={{ borderRadius: '50%' }}>
              <circle cx="24" cy="24" r="24" fill={color} opacity="0.15" />
              <text
                x="24"
                y="24"
                dominantBaseline="central"
                textAnchor="middle"
                fontSize="16"
                fontWeight="600"
                fill={color}
              >
                {agent.name.slice(0, 2).toUpperCase()}
              </text>
            </svg>
          </motion.div>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, color: 'var(--color-text)', fontSize: '14px' }} data-testid="agent-name">
            {agent.name}
          </div>
          {agent.task && (
            <div style={{ fontSize: '12px', color: 'var(--color-text-dim)' }} data-testid="task-id">
              {agent.task}
            </div>
          )}
        </div>
      </div>
      <div style={{ fontSize: '12px', color: 'var(--color-text-dim)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {agent.tool && (
          <div data-testid="tool-name">
            <span style={{ color: 'var(--color-text-micro)' }}>tool </span>{agent.tool}
          </div>
        )}
        {agent.summary && (
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} data-testid="summary">
            {agent.summary}
          </div>
        )}
        <div data-testid="elapsed" style={{ color: 'var(--color-text-micro)' }}>
          {elapsed}
        </div>
      </div>
    </motion.div>
  )
}
