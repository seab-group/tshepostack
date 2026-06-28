import '../test-setup'
import { describe, it, expect, beforeEach, afterEach, jest } from 'bun:test'
import { render, act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { QueueView } from './QueueView'
import type { QueueData } from '../types/queue'

// Make requestAnimationFrame synchronous so Framer Motion exit animations complete
// immediately in jsdom (no real render loop, rAF callbacks would otherwise never fire)
let _rafId = 0
const _rafCallbacks = new Map<number, FrameRequestCallback>()

function _syncRaf(cb: FrameRequestCallback): number {
  const id = ++_rafId
  // Queue so React can finish its own sync work first, then resolve the animation
  Promise.resolve().then(() => {
    if (_rafCallbacks.has(id)) {
      _rafCallbacks.delete(id)
      cb(0)
    }
  })
  _rafCallbacks.set(id, cb)
  return id
}

function _cancelRaf(id: number) {
  _rafCallbacks.delete(id)
}

Object.defineProperty(globalThis, 'requestAnimationFrame', { value: _syncRaf, writable: true, configurable: true })
Object.defineProperty(globalThis, 'cancelAnimationFrame', { value: _cancelRaf, writable: true, configurable: true })

// Stub ResizeObserver for Radix UI
if (typeof globalThis.ResizeObserver === 'undefined') {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    writable: true,
  })
}

// --- MockEventSource ---

class MockEventSource {
  static instances: MockEventSource[] = []

  static reset() {
    MockEventSource.instances = []
  }

  url: string
  readyState = 0
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  private handlers = new Map<string, ((e: MessageEvent) => void)[]>()

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    const list = this.handlers.get(type) ?? []
    list.push(fn)
    this.handlers.set(type, list)
  }

  emit(type: string, data: unknown) {
    const fns = this.handlers.get(type) ?? []
    const event = { data: JSON.stringify(data) } as MessageEvent
    for (const fn of fns) fn(event)
  }

  triggerOpen() {
    this.readyState = 1
    this.onopen?.()
  }

  close() {
    this.readyState = 2
  }
}

// --- Helpers ---

const MOCK_QUEUE: QueueData = {
  approvals: [
    { id: 'req-1', agentName: 'agent-fe', command: 'rm -rf /tmp/cache', risk: 'low' },
    { id: 'req-2', agentName: 'agent-be', command: 'DROP TABLE sessions;', risk: 'high' },
  ],
  attention: [
    { taskId: 'T10', agentName: 'agent-doc', mailboxNote: 'Spec is ambiguous on AC3, need clarification.' },
  ],
}

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
}

function renderQueue(qc: QueryClient, queue: QueueData = MOCK_QUEUE) {
  qc.setQueryData(['queue'], queue)
  return render(
    <QueryClientProvider client={qc}>
      <QueueView EventSourceClass={MockEventSource as unknown as typeof EventSource} />
    </QueryClientProvider>,
  )
}

let qc: QueryClient

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

afterEach(() => {
  cleanup()
  MockEventSource.reset()
  qc.clear()
  jest.useRealTimers()
})

describe('QueueView', () => {
  it('AC1: renders Pending approvals and Needs attention sections with count badges', () => {
    const { container } = renderQueue(qc)

    expect(container.querySelector('[data-testid="queue-view"]')).not.toBeNull()

    const approvalBadge = container.querySelector('[data-testid="approval-count-badge"]')
    expect(approvalBadge).not.toBeNull()
    expect(approvalBadge!.textContent).toBe('2')

    const attentionBadge = container.querySelector('[data-testid="attention-count-badge"]')
    expect(attentionBadge).not.toBeNull()
    expect(attentionBadge!.textContent).toBe('1')

    expect(container.querySelector('[data-testid="approval-card-req-1"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="approval-card-req-2"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="attention-card-T10"]')).not.toBeNull()
  })

  it('AC2: clicking accordion trigger expands the card content (only one at a time)', async () => {
    const { container } = renderQueue(qc)

    const trigger1 = container.querySelector('[data-testid="approval-trigger-req-1"]')
    expect(trigger1).not.toBeNull()

    // Content starts hidden (closed)
    const content1 = container.querySelector('[data-testid="approval-content-req-1"]')
    expect(content1).not.toBeNull()
    // Collapsed: Radix sets data-state="closed"
    expect(content1!.getAttribute('data-state')).toBe('closed')

    // Click to expand
    await act(async () => {
      fireEvent.click(trigger1!)
    })

    expect(content1!.getAttribute('data-state')).toBe('open')

    // Click second trigger — first should close
    const trigger2 = container.querySelector('[data-testid="approval-trigger-req-2"]')
    await act(async () => {
      fireEvent.click(trigger2!)
    })

    expect(content1!.getAttribute('data-state')).toBe('closed')
    const content2 = container.querySelector('[data-testid="approval-content-req-2"]')
    expect(content2!.getAttribute('data-state')).toBe('open')
  })

  it('AC3: clicking Approve sends POST /api/decision with approve payload', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    Object.defineProperty(globalThis, 'fetch', { value: mockFetch, writable: true })

    const { container } = renderQueue(qc)

    // Open first card
    const trigger1 = container.querySelector('[data-testid="approval-trigger-req-1"]')
    await act(async () => { fireEvent.click(trigger1!) })

    const approveBtn = container.querySelector('[data-testid="approve-btn"]')
    expect(approveBtn).not.toBeNull()

    await act(async () => { fireEvent.click(approveBtn!) })

    expect(mockFetch).toHaveBeenCalledWith('/api/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', agentName: 'agent-fe', requestId: 'req-1' }),
    })
  })

  it('AC3: clicking Reject sends POST /api/decision with reject payload', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    Object.defineProperty(globalThis, 'fetch', { value: mockFetch, writable: true })

    const { container } = renderQueue(qc)

    const trigger1 = container.querySelector('[data-testid="approval-trigger-req-1"]')
    await act(async () => { fireEvent.click(trigger1!) })

    const rejectBtn = container.querySelector('[data-testid="reject-btn"]')
    await act(async () => { fireEvent.click(rejectBtn!) })

    expect(mockFetch).toHaveBeenCalledWith('/api/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject', agentName: 'agent-fe', requestId: 'req-1' }),
    })
  })

  it('AC4: resolve SSE event with matching id removes the card from DOM', async () => {
    const { container } = renderQueue(qc)

    expect(container.querySelector('[data-testid="approval-card-req-1"]')).not.toBeNull()

    // Emit resolve SSE event
    await act(async () => {
      MockEventSource.instances[0]!.emit('resolve', { id: 'req-1' })
    })

    // Exit duration is 0 in test env; wait for AnimatePresence to remove the element
    await waitFor(
      () => expect(container.querySelector('[data-testid="approval-card-req-1"]')).toBeNull(),
      { timeout: 500 },
    )
  })

  it('AC5: attention card shows task_id pill, agent name, full mailbox note, and Unblock button', async () => {
    const { container } = renderQueue(qc)

    const card = container.querySelector('[data-testid="attention-card-T10"]')
    expect(card).not.toBeNull()

    expect(card!.querySelector('[data-testid="task-id-pill"]')!.textContent).toBe('T10')
    expect(card!.querySelector('[data-testid="attention-agent-name"]')!.textContent).toBe('agent-doc')
    expect(card!.querySelector('[data-testid="mailbox-note"]')!.textContent).toBe(
      'Spec is ambiguous on AC3, need clarification.',
    )

    const unblockBtn = container.querySelector('[data-testid="unblock-btn-T10"]')
    expect(unblockBtn).not.toBeNull()

    // Clicking Unblock expands the textarea
    await act(async () => { fireEvent.click(unblockBtn!) })

    expect(container.querySelector('[data-testid="unblock-textarea-T10"]')).not.toBeNull()
  })

  it('AC6: submitting Unblock reply sends POST /api/decision with unblock payload', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    Object.defineProperty(globalThis, 'fetch', { value: mockFetch, writable: true })

    const { container } = renderQueue(qc)

    // Open the unblock textarea
    const unblockBtn = container.querySelector('[data-testid="unblock-btn-T10"]')
    await act(async () => { fireEvent.click(unblockBtn!) })

    const textarea = container.querySelector('[data-testid="unblock-textarea-T10"]') as HTMLTextAreaElement
    expect(textarea).not.toBeNull()

    // Textarea is uncontrolled (ref-based); set DOM value directly
    textarea.value = 'AC3 means: validate the form before submitting.'

    const submitBtn = container.querySelector('[data-testid="unblock-submit-T10"]')
    await act(async () => { fireEvent.click(submitBtn!) })

    expect(mockFetch).toHaveBeenCalledWith('/api/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'unblock',
        text: 'AC3 means: validate the form before submitting.',
        agentName: 'agent-doc',
        taskId: 'T10',
      }),
    })
  })

  it('AC7: resolve SSE event decrements the total count badge', async () => {
    const { container } = renderQueue(qc)

    const totalBadge = container.querySelector('[data-testid="queue-total-badge"]')
    expect(totalBadge!.textContent).toBe('3') // 2 approvals + 1 attention

    // Resolve one approval
    await act(async () => {
      MockEventSource.instances[0]!.emit('resolve', { id: 'req-1' })
    })

    expect(totalBadge!.textContent).toBe('2')

    const approvalBadge = container.querySelector('[data-testid="approval-count-badge"]')
    expect(approvalBadge!.textContent).toBe('1')
  })
})
