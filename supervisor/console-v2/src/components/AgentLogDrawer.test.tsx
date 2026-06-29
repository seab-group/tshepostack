import '../test-setup'
import { describe, it, expect, beforeEach, afterEach, jest } from 'bun:test'
import { render, act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { AnimatePresence } from 'framer-motion'
import { AgentLogDrawer } from './AgentLogDrawer'
import type { LogEvent } from '../types/fleet'

// Stub rAF/cAF for Framer Motion
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    value: (cb: FrameRequestCallback) => setTimeout(cb, 0),
    writable: true,
  })
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    value: (id: number) => clearTimeout(id),
    writable: true,
  })
}

// Stub clipboard
if (typeof globalThis.navigator !== 'undefined' && !globalThis.navigator.clipboard) {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText: jest.fn().mockResolvedValue(undefined) },
    writable: true,
    configurable: true,
  })
}

// Minimal MockEventSource — supports addEventListener + close
class MockEventSource {
  url: string
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  private handlers: Record<string, ((e: MessageEvent) => void)[]> = {}

  constructor(url: string) {
    this.url = url
    MockEventSource._last = this
  }

  static _last: MockEventSource | null = null

  addEventListener(type: string, handler: (e: MessageEvent) => void) {
    if (!this.handlers[type]) this.handlers[type] = []
    this.handlers[type]!.push(handler)
  }

  emit(type: string, data: unknown) {
    const event = { data: JSON.stringify(data) } as MessageEvent
    for (const h of this.handlers[type] ?? []) h(event)
  }

  close() {}
}

const EVENTS: LogEvent[] = [
  { ts: '2026-06-28T10:00:01Z', tool: 'Read', summary: 'reading spec', file: 'tasks/T28.md' },
  { ts: '2026-06-28T10:00:05Z', tool: 'Bash', summary: 'running tests' },
  { ts: '2026-06-28T10:00:09Z', summary: 'analysis complete' },
]

function Wrap({ children, qc }: { children: ReactNode; qc: QueryClient }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

let qc: QueryClient
let closeFn: ReturnType<typeof jest.fn>

beforeEach(() => {
  MockEventSource._last = null
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  closeFn = jest.fn()
})

afterEach(() => {
  cleanup()
  qc.clear()
})

function renderDrawer(agentName = 'agent-fe', preloadEvents?: LogEvent[]) {
  if (preloadEvents) {
    qc.setQueryData(['log', agentName], { events: preloadEvents })
  }
  return render(
    <Wrap qc={qc}>
      <AnimatePresence>
        <AgentLogDrawer
          agent={agentName}
          onClose={closeFn}
          EventSourceClass={MockEventSource as unknown as typeof EventSource}
        />
      </AnimatePresence>
    </Wrap>,
  )
}

describe('AgentLogDrawer', () => {
  it('AC2: renders initial log events from cache in list', async () => {
    const { container } = renderDrawer('agent-fe', EVENTS)
    await act(async () => {})

    const eventEls = container.querySelectorAll('[data-testid="log-event"]')
    expect(eventEls.length).toBe(3)

    // First event: timestamp, tool badge, summary, file
    const ts = eventEls[0]!.querySelector('[data-testid="log-ts"]')
    expect(ts?.textContent).toBe('10:00:01')

    const tool = eventEls[0]!.querySelector('[data-testid="log-tool"]')
    expect(tool?.textContent).toBe('Read')

    const summary = eventEls[0]!.querySelector('[data-testid="log-summary"]')
    expect(summary?.textContent).toBe('reading spec')

    const file = eventEls[0]!.querySelector('[data-testid="log-file"]')
    expect(file?.textContent).toBe('tasks/T28.md')

    // Third event: no tool badge, no file
    const tool3 = eventEls[2]!.querySelector('[data-testid="log-tool"]')
    expect(tool3).toBeNull()
    const file3 = eventEls[2]!.querySelector('[data-testid="log-file"]')
    expect(file3).toBeNull()
  })

  it('AC3: fleet-update SSE event for open agent is appended to the list', async () => {
    renderDrawer('agent-fe', EVENTS)
    await act(async () => {})

    const sse = MockEventSource._last!
    await act(async () => {
      sse.emit('fleet-update', {
        agent: 'agent-fe',
        ts: '2026-06-28T10:00:15Z',
        tool: 'Write',
        summary: 'wrote output',
        file: 'output.md',
      })
    })

    const updated = qc.getQueryData<{ events: LogEvent[] }>(['log', 'agent-fe'])
    expect(updated?.events.length).toBe(4)
    expect(updated?.events[3]!.tool).toBe('Write')
    expect(updated?.events[3]!.summary).toBe('wrote output')
  })

  it('AC3: fleet-update for a different agent is NOT appended to this agent\'s log', async () => {
    renderDrawer('agent-fe', EVENTS)
    await act(async () => {})

    const sse = MockEventSource._last!
    await act(async () => {
      sse.emit('fleet-update', {
        agent: 'agent-be',
        ts: '2026-06-28T10:00:15Z',
        summary: 'other agent work',
      })
    })

    const data = qc.getQueryData<{ events: LogEvent[] }>(['log', 'agent-fe'])
    expect(data?.events.length).toBe(3)
  })

  it('AC6: Escape key calls onClose', async () => {
    renderDrawer('agent-fe', EVENTS)
    await act(async () => {})

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(closeFn).toHaveBeenCalledTimes(1)
  })

  it('AC6: clicking backdrop calls onClose', async () => {
    const { container } = renderDrawer('agent-fe', EVENTS)
    await act(async () => {})

    const backdrop = container.querySelector('[data-testid="drawer-backdrop"]') as HTMLElement
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop)
    expect(closeFn).toHaveBeenCalledTimes(1)
  })

  it('AC6: clicking × button calls onClose', async () => {
    const { container } = renderDrawer('agent-fe', EVENTS)
    await act(async () => {})

    const closeBtn = container.querySelector('[data-testid="drawer-close-btn"]') as HTMLElement
    fireEvent.click(closeBtn)
    expect(closeFn).toHaveBeenCalledTimes(1)
  })

  it('AC5: Copy log button triggers clipboard.writeText with formatted text', async () => {
    const { container } = renderDrawer('agent-fe', EVENTS)
    await act(async () => {})

    const copyBtn = container.querySelector('[data-testid="copy-log-btn"]') as HTMLElement
    await act(async () => { fireEvent.click(copyBtn) })

    expect((navigator.clipboard.writeText as ReturnType<typeof jest.fn>).mock.calls.length).toBeGreaterThan(0)
    const written = (navigator.clipboard.writeText as ReturnType<typeof jest.fn>).mock.calls.at(-1)?.[0] as string
    expect(written).toContain('reading spec')
    expect(written).toContain('running tests')
    expect(written).toContain('Read')
  })
})
