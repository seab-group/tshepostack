import '../test-setup'
import { describe, it, expect, beforeEach, afterEach, jest } from 'bun:test'
import { render, act, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { FleetView } from './FleetView'
import { DrawerProvider } from '../context/DrawerContext'
import type { AgentInfo } from '../types/fleet'

// Framer Motion uses requestAnimationFrame — stub for jsdom
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

const AGENTS: AgentInfo[] = [
  { name: 'agent-fe', task: 'T27', tool: 'Read', summary: 'reading spec', status: 'active', since: new Date(Date.now() - 60_000).toISOString() },
  { name: 'agent-be', task: 'T25', tool: 'Bash', summary: 'running tests', status: 'paused', since: new Date(Date.now() - 120_000).toISOString() },
  { name: 'agent-qa', task: 'T26', tool: 'Write', summary: 'checking tests', status: 'stuck', since: new Date(Date.now() - 30_000).toISOString() },
]

function Wrap({ children, qc }: { children: ReactNode; qc: QueryClient }) {
  return (
    <QueryClientProvider client={qc}>
      <DrawerProvider>{children}</DrawerProvider>
    </QueryClientProvider>
  )
}

function renderFleet(agents: AgentInfo[], qc: QueryClient) {
  return render(
    <Wrap qc={qc}>
      <FleetView agents={agents} />
    </Wrap>,
  )
}

let qc: QueryClient

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

afterEach(() => {
  cleanup()
  qc.clear()
  jest.useRealTimers()
})

describe('FleetView', () => {
  it('AC1: renders one AgentCard per agent in a CSS grid', () => {
    const { container } = renderFleet(AGENTS, qc)
    const grid = container.querySelector('[data-testid="fleet-grid"]')
    expect(grid).not.toBeNull()
    const cards = container.querySelectorAll('[data-testid="agent-card"]')
    expect(cards.length).toBe(3)
  })

  it('AC2: agent card shows agent name and elapsed time', () => {
    const { container } = renderFleet(AGENTS, qc)
    const names = Array.from(container.querySelectorAll('[data-testid="agent-name"]')).map(
      (el) => el.textContent,
    )
    expect(names).toContain('agent-fe')
    expect(names).toContain('agent-be')
    expect(names).toContain('agent-qa')
    const elapsedEls = container.querySelectorAll('[data-testid="elapsed"]')
    expect(elapsedEls.length).toBe(3)
    expect(elapsedEls[0]!.textContent).not.toBe('—')
  })

  it('AC3: status=stuck renders ring with color #dc2626', () => {
    const { container } = renderFleet(AGENTS, qc)
    const cards = container.querySelectorAll('[data-testid="agent-card"]')
    // agent-qa is at index 2 with status=stuck
    const stuckCard = cards[2]!
    const ring = stuckCard.querySelector('[data-ring-color]')
    expect(ring).not.toBeNull()
    expect((ring as HTMLElement).dataset['ringColor']).toBe('#dc2626')
  })

  it('AC6: StuckAlert renders when stuck query data exists for an agent', () => {
    qc.setQueryData(['stuck', 'agent-qa'], { message: 'silent for 10min' })
    const { container } = renderFleet(AGENTS, qc)
    const alerts = container.querySelectorAll('[data-testid="stuck-alert"]')
    expect(alerts.length).toBe(1)
    expect(alerts[0]!.textContent).toContain('agent-qa')
  })

  it('AC6: no StuckAlert when no stuck query data exists', () => {
    const { container } = renderFleet(AGENTS, qc)
    const alerts = container.querySelectorAll('[data-testid="stuck-alert"]')
    expect(alerts.length).toBe(0)
  })

  it('AC7: elapsed time updates after 10 seconds', async () => {
    jest.useFakeTimers()
    const since = new Date(Date.now() - 5_000).toISOString()
    const agents: AgentInfo[] = [
      { name: 'agent-fe', task: 'T27', tool: 'Read', summary: 'working', status: 'active', since },
    ]
    const { container } = renderFleet(agents, qc)
    const elapsedBefore = container.querySelector('[data-testid="elapsed"]')!.textContent

    await act(async () => {
      jest.advanceTimersByTime(10_001)
    })

    const elapsedAfter = container.querySelector('[data-testid="elapsed"]')!.textContent
    expect(elapsedAfter).not.toBe(elapsedBefore)
  })
})
