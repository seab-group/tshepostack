import { AnimatePresence } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import { AgentCard } from './AgentCard'
import { StuckAlert } from './StuckAlert'
import type { AgentInfo } from '../types/fleet'

interface FleetViewProps {
  agents: AgentInfo[]
}

export function FleetView({ agents }: FleetViewProps) {
  const queryClient = useQueryClient()

  const stuckAgents = agents.filter(
    (a) => queryClient.getQueryData(['stuck', a.name]) != null,
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {stuckAgents.map((a) => {
        const data = queryClient.getQueryData<{ message?: string }>(['stuck', a.name])
        return <StuckAlert key={a.name} agentName={a.name} message={data?.message} />
      })}
      <div
        data-testid="fleet-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '16px',
        }}
      >
        <AnimatePresence>
          {agents.map((agent) => (
            <AgentCard key={agent.name} agent={agent} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}
