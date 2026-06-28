export type AgentStatusValue = 'active' | 'paused' | 'stuck' | 'stopped'

export interface AgentInfo {
  name: string
  task: string | null
  tool: string | null
  summary: string | null
  status: AgentStatusValue
  since: string | null
}
