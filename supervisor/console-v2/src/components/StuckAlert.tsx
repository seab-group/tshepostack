interface StuckAlertProps {
  agentName: string
  message?: string
}

export function StuckAlert({ agentName, message }: StuckAlertProps) {
  return (
    <div
      role="alert"
      data-testid="stuck-alert"
      style={{
        background: 'rgba(220, 38, 38, 0.1)',
        border: '1px solid #dc2626',
        borderRadius: '6px',
        padding: '12px 16px',
        display: 'flex',
        gap: '8px',
        alignItems: 'flex-start',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
        <circle cx="8" cy="8" r="7" stroke="#dc2626" strokeWidth="1.5" />
        <rect x="7" y="4" width="2" height="5" fill="#dc2626" />
        <rect x="7" y="10.5" width="2" height="2" fill="#dc2626" />
      </svg>
      <div>
        <div style={{ fontWeight: 600, color: '#dc2626', fontSize: '13px' }}>
          {agentName} is stuck
        </div>
        {message && (
          <div style={{ fontSize: '12px', color: 'var(--color-text-dim)', marginTop: 4 }}>
            {message}
          </div>
        )}
      </div>
    </div>
  )
}
