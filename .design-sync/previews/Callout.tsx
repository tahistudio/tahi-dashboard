import { Callout } from 'tahi-dashboard'

const col = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.625rem',
  padding: '1.25rem',
  background: 'var(--color-bg-cream)',
  maxWidth: '28rem',
} as const

export const Tones = () => (
  <div style={col}>
    <Callout tone="info" title="Stripe integration connected">
      Invoices will sync automatically when Acme Co pays online.
    </Callout>
    <Callout tone="success" title="Contract signed">
      Liam Miller countersigned the Physiotrack NZ MSA on 18 Jun 2026.
    </Callout>
    <Callout tone="warning" title="Retainer hours nearly out">
      Physiotrack NZ has used 38 of 40 hours this month.
    </Callout>
    <Callout tone="danger" title="Payment overdue">
      INV-0042 for Acme Co is 14 days past due. Last reminder sent 7 Jun.
    </Callout>
    <Callout tone="tip" title="Schedule a discovery call">
      Acme Co has been a client for 90 days without a check-in.
    </Callout>
    <Callout tone="neutral">
      Draft mode: changes are not visible to clients until you publish.
    </Callout>
  </div>
)

export const WithActions = () => (
  <div style={col}>
    <Callout
      tone="warning"
      title="Retainer hours nearly out"
      action={{ label: 'Review usage', onClick: () => {} }}
    >
      Acme Co has used 19 of 20 small-track hours this month.
    </Callout>
    <Callout
      tone="danger"
      title="Xero sync failed"
      action={{ label: 'Reconnect Xero', onClick: () => {} }}
    >
      The OAuth token expired. Reconnect to resume invoice sync.
    </Callout>
    <Callout
      tone="tip"
      title="Proposal ready to share"
      action={{ label: 'Share with client', onClick: () => {} }}
    >
      The Scale retainer proposal for Acme Co is finalised.
    </Callout>
  </div>
)

export const SolidVariant = () => (
  <div style={col}>
    <Callout
      tone="success"
      variant="solid"
      title="Invoice sent"
      action={{ label: 'View invoice', onClick: () => {} }}
    >
      INV-0052 was emailed to Staci Bonnie at acme@example.co.nz.
    </Callout>
    <Callout
      tone="danger"
      variant="solid"
      title="Request blocked"
      action={{ label: 'Resolve', onClick: () => {} }}
    >
      Homepage redesign is waiting on client assets before work can continue.
    </Callout>
  </div>
)

export const Dismissible = () => (
  <div style={col}>
    <Callout
      tone="info"
      title="New feature: Schedule builder"
      dismissible
      onDismiss={() => {}}
    >
      Build project schedules and share a live timeline view with clients.
    </Callout>
    <Callout
      tone="tip"
      title="Tip: bulk-assign requests"
      dismissible
      onDismiss={() => {}}
    >
      Select multiple requests in the kanban view and assign them in one go.
    </Callout>
  </div>
)
