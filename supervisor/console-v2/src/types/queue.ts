export interface ApprovalItem {
  id: string
  agentName: string
  command: string
  risk: 'low' | 'medium' | 'high'
}

export interface AttentionItem {
  taskId: string
  agentName: string
  mailboxNote: string
}

export interface QueueData {
  approvals: ApprovalItem[]
  attention: AttentionItem[]
}
