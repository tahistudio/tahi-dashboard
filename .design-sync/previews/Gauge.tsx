import { Gauge } from 'tahi-dashboard'

const box = { padding: '1.5rem', background: 'var(--color-bg)', display: 'inline-flex', flexWrap: 'wrap' as const, gap: '1.5rem', alignItems: 'center' }

export const CapacityGauges = () => (
  <div style={box}>
    <Gauge value={78} size={160} tone="positive" label="Capacity" sub="This week" ariaLabel="Team capacity 78%" />
    <Gauge value={52} size={160} tone="positive" label="Billable rate" sub="Last 30 days" ariaLabel="Billable rate 52%" />
    <Gauge value={91} size={160} tone="negative" label="Capacity" sub="Next week" ariaLabel="Next week capacity 91%" />
  </div>
)

export const RetainerHealth = () => (
  <div style={{ ...box, flexDirection: 'column' as const, alignItems: 'flex-start', width: '24rem', maxWidth: '100%' }}>
    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>Retainer health overview</div>
    <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' as const }}>
      <div style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: '0.5rem' }}>
        <Gauge value={84} size={120} tone="positive" label="On track" ariaLabel="On-track clients 84%" />
        <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>Acme Corp</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: '0.5rem' }}>
        <Gauge value={43} size={120} tone="negative" label="At risk" ariaLabel="At-risk engagement 43%" />
        <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>Bright Labs</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: '0.5rem' }}>
        <Gauge value={67} size={120} tone="neutral" label="Steady" ariaLabel="Steady client 67%" />
        <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>Koru Digital</span>
      </div>
    </div>
  </div>
)

export const CustomFormatGauge = () => (
  <div style={box}>
    <Gauge
      value={33200}
      size={180}
      tone="positive"
      formatCentre={() => '$33.2k'}
      label="MRR"
      sub="of $40k target"
      ariaLabel="MRR $33.2k of $40k target"
    />
    <Gauge
      value={14}
      size={140}
      tone="neutral"
      formatCentre={(v) => `${v}`}
      label="Active clients"
      ariaLabel="14 active clients"
    />
  </div>
)
