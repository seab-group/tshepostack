import '../test-setup'
import { describe, it, expect, afterEach, spyOn, jest } from 'bun:test'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useFleetStream } from './useFleetStream'

// --- Mock EventSource ---

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

  triggerError() {
    this.onerror?.()
  }

  close() {
    this.readyState = 2
  }
}

// --- Helpers ---

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
}

afterEach(() => {
  MockEventSource.reset()
  jest.useRealTimers()
})

// --- Tests ---

describe('useFleetStream', () => {
  it('AC1: opens EventSource on mount and closes it on unmount', () => {
    const qc = new QueryClient()
    const { unmount } = renderHook(
      () => useFleetStream(MockEventSource as unknown as typeof EventSource),
      { wrapper: makeWrapper(qc) },
    )

    expect(MockEventSource.instances).toHaveLength(1)
    expect(MockEventSource.instances[0].url).toBe('/api/events')

    unmount()

    expect(MockEventSource.instances[0].readyState).toBe(2)
  })

  it('AC1: hook returns connected=false initially, true after onopen', () => {
    const qc = new QueryClient()
    const { result, unmount } = renderHook(
      () => useFleetStream(MockEventSource as unknown as typeof EventSource),
      { wrapper: makeWrapper(qc) },
    )

    expect(result.current.connected).toBe(false)
    expect(result.current.lastEvent).toBeNull()

    act(() => { MockEventSource.instances[0].triggerOpen() })

    expect(result.current.connected).toBe(true)
    unmount()
  })

  it('AC2: reconnects with exponential backoff: 1s → 2s → 4s', () => {
    jest.useFakeTimers()

    const qc = new QueryClient()
    const { unmount } = renderHook(
      () => useFleetStream(MockEventSource as unknown as typeof EventSource),
      { wrapper: makeWrapper(qc) },
    )

    // Disconnect 1 → retry after 1000ms
    act(() => { MockEventSource.instances[0].triggerError() })
    expect(MockEventSource.instances).toHaveLength(1)

    act(() => { jest.advanceTimersByTime(1000) })
    expect(MockEventSource.instances).toHaveLength(2)

    // Disconnect 2 → retry after 2000ms
    act(() => { MockEventSource.instances[1].triggerError() })
    act(() => { jest.advanceTimersByTime(1999) })
    expect(MockEventSource.instances).toHaveLength(2)

    act(() => { jest.advanceTimersByTime(1) })
    expect(MockEventSource.instances).toHaveLength(3)

    // Disconnect 3 → retry after 4000ms
    act(() => { MockEventSource.instances[2].triggerError() })
    act(() => { jest.advanceTimersByTime(3999) })
    expect(MockEventSource.instances).toHaveLength(3)

    act(() => { jest.advanceTimersByTime(1) })
    expect(MockEventSource.instances).toHaveLength(4)

    unmount()
    jest.useRealTimers()
  })

  it('AC2: backoff resets to 1s after successful reconnect', () => {
    jest.useFakeTimers()

    const qc = new QueryClient()
    const { unmount } = renderHook(
      () => useFleetStream(MockEventSource as unknown as typeof EventSource),
      { wrapper: makeWrapper(qc) },
    )

    // Trigger error to advance backoff to 2s
    act(() => { MockEventSource.instances[0].triggerError() })
    act(() => { jest.advanceTimersByTime(1000) })
    expect(MockEventSource.instances).toHaveLength(2)

    // Successful reconnect → backoff resets
    act(() => { MockEventSource.instances[1].triggerOpen() })

    // Next error should use 1s again (not 2s)
    act(() => { MockEventSource.instances[1].triggerError() })
    act(() => { jest.advanceTimersByTime(999) })
    expect(MockEventSource.instances).toHaveLength(2)

    act(() => { jest.advanceTimersByTime(1) })
    expect(MockEventSource.instances).toHaveLength(3)

    unmount()
    jest.useRealTimers()
  })

  it('AC3: fleet-update event calls setQueryData with fleet key', () => {
    const qc = new QueryClient()
    const setQueryDataSpy = spyOn(qc, 'setQueryData')
    const { unmount } = renderHook(
      () => useFleetStream(MockEventSource as unknown as typeof EventSource),
      { wrapper: makeWrapper(qc) },
    )

    act(() => {
      MockEventSource.instances[0].emit('fleet-update', { agent: 'agent-fe', status: 'working' })
    })

    expect(setQueryDataSpy).toHaveBeenCalledWith(
      ['fleet', 'agent-fe'],
      { agent: 'agent-fe', status: 'working' },
    )
    unmount()
  })

  it('AC3: fleet-update event updates lastEvent', () => {
    const qc = new QueryClient()
    const { result, unmount } = renderHook(
      () => useFleetStream(MockEventSource as unknown as typeof EventSource),
      { wrapper: makeWrapper(qc) },
    )

    act(() => {
      MockEventSource.instances[0].emit('fleet-update', { agent: 'agent-fe', status: 'idle' })
    })

    expect(result.current.lastEvent).toMatchObject({ type: 'fleet-update', agent: 'agent-fe' })
    unmount()
  })

  it('AC4: approval event calls invalidateQueries with queue key', () => {
    const qc = new QueryClient()
    const invalidateSpy = spyOn(qc, 'invalidateQueries').mockImplementation(() => Promise.resolve())
    const { unmount } = renderHook(
      () => useFleetStream(MockEventSource as unknown as typeof EventSource),
      { wrapper: makeWrapper(qc) },
    )

    act(() => {
      MockEventSource.instances[0].emit('approval', { task: 'T26' })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['queue'] })
    unmount()
  })

  it('AC5: stuck event calls setQueryData with stuck key', () => {
    const qc = new QueryClient()
    const setQueryDataSpy = spyOn(qc, 'setQueryData')
    const { unmount } = renderHook(
      () => useFleetStream(MockEventSource as unknown as typeof EventSource),
      { wrapper: makeWrapper(qc) },
    )

    act(() => {
      MockEventSource.instances[0].emit('stuck', { agent: 'agent-be', reason: 'timeout' })
    })

    expect(setQueryDataSpy).toHaveBeenCalledWith(
      ['stuck', 'agent-be'],
      { agent: 'agent-be', reason: 'timeout' },
    )
    unmount()
  })

  it('AC6: two hook instances share a single EventSource', () => {
    const qc = new QueryClient()
    const wrapper = makeWrapper(qc)

    const hook1 = renderHook(
      () => useFleetStream(MockEventSource as unknown as typeof EventSource),
      { wrapper },
    )
    const hook2 = renderHook(
      () => useFleetStream(MockEventSource as unknown as typeof EventSource),
      { wrapper },
    )

    // Only one connection should have been created
    expect(MockEventSource.instances).toHaveLength(1)

    // Unmounting first consumer: connection should remain open
    hook1.unmount()
    expect(MockEventSource.instances[0].readyState).not.toBe(2)

    // Unmounting last consumer: connection closes
    hook2.unmount()
    expect(MockEventSource.instances[0].readyState).toBe(2)
  })

  it('AC6: second consumer receives connected=true when SSE already open', () => {
    const qc = new QueryClient()
    const wrapper = makeWrapper(qc)

    const hook1 = renderHook(
      () => useFleetStream(MockEventSource as unknown as typeof EventSource),
      { wrapper },
    )

    act(() => { MockEventSource.instances[0].triggerOpen() })
    expect(hook1.result.current.connected).toBe(true)

    // Second consumer mounts after connection is already open
    const hook2 = renderHook(
      () => useFleetStream(MockEventSource as unknown as typeof EventSource),
      { wrapper },
    )

    expect(hook2.result.current.connected).toBe(true)
    expect(MockEventSource.instances).toHaveLength(1)

    hook1.unmount()
    hook2.unmount()
  })
})
