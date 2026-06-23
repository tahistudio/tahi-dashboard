import { FunnelChart } from 'tahi-dashboard'

const box = { width: '28rem', maxWidth: '100%', padding: '1.25rem', background: 'var(--color-bg)' } as const

export const SalesPipeline = () => (
  <div style={box}>
    <div style={{ marginBottom: '0.75rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
      Sales pipeline (contacts)
    </div>
    <FunnelChart
      stages={[
        { label: 'Leads', value: 148 },
        { label: 'Qualified', value: 72 },
        { label: 'Proposal sent', value: 31 },
        { label: 'Negotiating', value: 14 },
        { label: 'Closed won', value: 8 },
      ]}
      stageHeight={52}
      ariaLabel="Sales pipeline funnel"
    />
  </div>
)

export const ProjectPhasesFunnel = () => (
  <div style={box}>
    <div style={{ marginBottom: '0.75rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
      Active project phases
    </div>
    <FunnelChart
      stages={[
        { label: 'Scoped', value: 22 },
        { label: 'In progress', value: 14 },
        { label: 'In review', value: 7 },
        { label: 'Delivered', value: 4 },
      ]}
      stageHeight={60}
      formatValue={(v) => `${v} projects`}
      ariaLabel="Projects by phase"
    />
  </div>
)

export const RevenueFunnel = () => (
  <div style={box}>
    <div style={{ marginBottom: '0.75rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
      Pipeline value ($k)
    </div>
    <FunnelChart
      stages={[
        { label: 'Prospecting', value: 320 },
        { label: 'Qualifying', value: 185 },
        { label: 'Proposal', value: 96 },
        { label: 'Committed', value: 48 },
        { label: 'Signed', value: 28 },
      ]}
      stageHeight={48}
      formatValue={(v) => `$${v}k`}
      showPercent
      ariaLabel="Pipeline value by stage"
    />
  </div>
)
