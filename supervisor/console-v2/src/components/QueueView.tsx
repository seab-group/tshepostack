import { useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as Accordion from '@radix-ui/react-accordion'
import { AnimatePresence, motion } from 'framer-motion'
import { useFleetStream } from '../hooks/useFleetStream'
import type { QueueData, ApprovalItem, AttentionItem } from '../types/queue'

async function fetchQueue(): Promise<QueueData> {
  const res = await fetch('/api/queue')
  if (!res.ok) throw new Error('Failed to fetch queue')
  return res.json() as Promise<QueueData>
}

const RISK_COLOURS: Record<string, string> = {
  low: 'bg-green-100 text-green-800',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-red-100 text-red-800',
}

const EXIT_ANIM = { height: 0, opacity: 0 }
// duration 0 in test so AnimatePresence removes elements synchronously
const EXIT_TRANS = { duration: process.env.NODE_ENV === 'test' ? 0 : 0.3 }

interface ApprovalCardProps {
  item: ApprovalItem
  inFlight: boolean
  onApprove: () => void
  onReject: () => void
}

function ApprovalCard({ item, inFlight, onApprove, onReject }: ApprovalCardProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 1, height: 'auto' }}
      exit={EXIT_ANIM}
      transition={EXIT_TRANS}
      data-testid={`approval-card-${item.id}`}
    >
      <Accordion.Item value={item.id}>
        <Accordion.Header>
          <Accordion.Trigger
            data-testid={`approval-trigger-${item.id}`}
            className="flex w-full items-center justify-between p-3 text-left"
          >
            <span data-testid="agent-name">{item.agentName}</span>
            <span
              className={`rounded px-2 py-0.5 text-xs ${RISK_COLOURS[item.risk] ?? ''}`}
              data-testid="risk-badge"
            >
              {item.risk}
            </span>
            <span className="ml-2 truncate text-sm text-muted-foreground">{item.command}</span>
          </Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Content data-testid={`approval-content-${item.id}`}>
          <div className="space-y-2 p-3 pt-0">
            <code className="block whitespace-pre-wrap text-sm">{item.command}</code>
            <div className="flex gap-2">
              <motion.button
                animate={{ opacity: inFlight ? 0.5 : 1 }}
                disabled={inFlight}
                onClick={onApprove}
                data-testid="approve-btn"
                className="rounded bg-green-600 px-3 py-1 text-sm text-white disabled:cursor-not-allowed"
              >
                {inFlight ? '…' : 'Approve'}
              </motion.button>
              <motion.button
                animate={{ opacity: inFlight ? 0.5 : 1 }}
                disabled={inFlight}
                onClick={onReject}
                data-testid="reject-btn"
                className="rounded bg-red-600 px-3 py-1 text-sm text-white disabled:cursor-not-allowed"
              >
                {inFlight ? '…' : 'Reject'}
              </motion.button>
            </div>
          </div>
        </Accordion.Content>
      </Accordion.Item>
    </motion.div>
  )
}

interface AttentionCardProps {
  item: AttentionItem
  unblockOpen: boolean
  inFlight: boolean
  onUnblockToggle: () => void
  onUnblockSubmit: (text: string) => void
}

function AttentionCard({
  item,
  unblockOpen,
  inFlight,
  onUnblockToggle,
  onUnblockSubmit,
}: AttentionCardProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  return (
    <motion.div
      layout
      initial={{ opacity: 1, height: 'auto' }}
      exit={EXIT_ANIM}
      transition={EXIT_TRANS}
      data-testid={`attention-card-${item.taskId}`}
      className="rounded border p-3"
    >
      <div className="flex items-center gap-2">
        <span
          className="rounded bg-slate-200 px-2 py-0.5 text-xs font-mono"
          data-testid="task-id-pill"
        >
          {item.taskId}
        </span>
        <span className="text-sm font-medium" data-testid="attention-agent-name">
          {item.agentName}
        </span>
      </div>
      <p className="mt-1 text-sm" data-testid="mailbox-note">
        {item.mailboxNote}
      </p>
      {!unblockOpen && (
        <button
          onClick={onUnblockToggle}
          data-testid={`unblock-btn-${item.taskId}`}
          className="mt-2 rounded border px-3 py-1 text-sm"
        >
          Unblock
        </button>
      )}
      {unblockOpen && (
        <div className="mt-2 space-y-2">
          <textarea
            ref={textareaRef}
            rows={4}
            className="w-full resize-y rounded border p-2 text-sm"
            data-testid={`unblock-textarea-${item.taskId}`}
            placeholder="Reply to unblock this task…"
          />
          <button
            onClick={() => {
              const text = textareaRef.current?.value ?? ''
              if (!text.trim()) return
              onUnblockSubmit(text)
            }}
            disabled={inFlight}
            data-testid={`unblock-submit-${item.taskId}`}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            {inFlight ? '…' : 'Send reply'}
          </button>
        </div>
      )}
    </motion.div>
  )
}

interface QueueViewProps {
  EventSourceClass?: typeof EventSource
}

export function QueueView({ EventSourceClass }: QueueViewProps) {
  const queryClient = useQueryClient()
  const { lastEvent } = useFleetStream(EventSourceClass ?? window.EventSource)
  const { data } = useQuery({ queryKey: ['queue'], queryFn: fetchQueue })

  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set())
  const [inFlightIds, setInFlightIds] = useState<Set<string>>(new Set())
  const [expandedId, setExpandedId] = useState<string>('')
  const [unblockOpen, setUnblockOpen] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!lastEvent) return
    if (lastEvent.type === 'resolve') {
      setResolvedIds((prev) => new Set([...prev, lastEvent.id]))
    }
  }, [lastEvent])

  async function sendDecision(payload: Record<string, unknown>, cardId: string) {
    setInFlightIds((prev) => new Set([...prev, cardId]))
    try {
      await fetch('/api/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      setResolvedIds((prev) => new Set([...prev, cardId]))
    } finally {
      setInFlightIds((prev) => {
        const next = new Set(prev)
        next.delete(cardId)
        return next
      })
    }
  }

  const approvals = (data?.approvals ?? []).filter((a) => !resolvedIds.has(a.id))
  const attention = (data?.attention ?? []).filter((a) => !resolvedIds.has(a.taskId))
  const totalCount = approvals.length + attention.length

  return (
    <div data-testid="queue-view">
      <section>
        <h2 className="mb-2 font-semibold">
          Pending approvals{' '}
          <span
            data-testid="approval-count-badge"
            className="rounded-full bg-slate-200 px-2 py-0.5 text-xs"
          >
            {approvals.length}
          </span>
        </h2>
        <Accordion.Root
          type="single"
          value={expandedId}
          onValueChange={setExpandedId}
          className="space-y-1"
        >
          <AnimatePresence>
            {approvals.map((item) => (
              <ApprovalCard
                key={`approval-${item.id}`}
                item={item}
                inFlight={inFlightIds.has(item.id)}
                onApprove={() =>
                  sendDecision(
                    { action: 'approve', agentName: item.agentName, requestId: item.id },
                    item.id,
                  )
                }
                onReject={() =>
                  sendDecision(
                    { action: 'reject', agentName: item.agentName, requestId: item.id },
                    item.id,
                  )
                }
              />
            ))}
          </AnimatePresence>
        </Accordion.Root>
      </section>

      <section className="mt-4">
        <h2 className="mb-2 font-semibold">
          Needs attention{' '}
          <span
            data-testid="attention-count-badge"
            className="rounded-full bg-slate-200 px-2 py-0.5 text-xs"
          >
            {attention.length}
          </span>
        </h2>
        <AnimatePresence>
          {attention.map((item) => (
            <AttentionCard
              key={`attention-${item.taskId}`}
              item={item}
              unblockOpen={!!unblockOpen[item.taskId]}
              inFlight={inFlightIds.has(item.taskId)}
              onUnblockToggle={() =>
                setUnblockOpen((p) => ({ ...p, [item.taskId]: !p[item.taskId] }))
              }
              onUnblockSubmit={(text) =>
                sendDecision(
                  { action: 'unblock', text, agentName: item.agentName, taskId: item.taskId },
                  item.taskId,
                )
              }
            />
          ))}
        </AnimatePresence>
      </section>

      <span data-testid="queue-total-badge" className="sr-only">
        {totalCount}
      </span>
    </div>
  )
}
