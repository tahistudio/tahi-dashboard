import { KPICard } from 'tahi-dashboard'

const strip = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: '0.875rem',
  padding: '1.25rem',
  background: 'var(--color-bg-cream)',
}

const single = {
  padding: '1.25rem',
  background: 'var(--color-bg-cream)',
  maxWidth: '18rem',
}

/** Three-card strip: MRR (featured) + active requests + avg response */
export const Strip = () => (
  <div style={strip}>
    <KPICard
      label="Monthly recurring revenue"
      value="$24,580"
      variant="featured"
      delta={{ value: '+12%', direction: 'up' }}
      trailing="vs last month"
    />
    <KPICard
      label="Active requests"
      value="18"
      delta={{ value: '+3', direction: 'up' }}
      trailing="this week"
    />
    <KPICard
      label="Avg response time"
      value="2.4h"
      delta={{ value: '-0.8h', direction: 'up' }}
      trailing="team average"
    />
  </div>
)

/** Featured variant — single focus tile */
export const Featured = () => (
  <div style={single}>
    <KPICard
      label="Monthly recurring revenue"
      value="$24,580"
      variant="featured"
      delta={{ value: '+12%', direction: 'up' }}
      trailing="vs last month"
    />
  </div>
)

/** Down delta — revenue dip */
export const WithDownDelta = () => (
  <div style={{ ...strip, gridTemplateColumns: 'repeat(2, 1fr)', maxWidth: '32rem' }}>
    <KPICard
      label="Overdue invoices"
      value="$8,400"
      delta={{ value: '+$3,200', direction: 'down' }}
      trailing="3 invoices"
    />
    <KPICard
      label="Delivered this month"
      value="11"
      delta={{ value: '-2', direction: 'down' }}
      trailing="vs 13 last month"
    />
  </div>
)

/** Interactive clickable tile */
export const Clickable = () => (
  <div style={single}>
    <KPICard
      label="Open retainer tracks"
      value="6"
      delta={{ value: 'flat', direction: 'flat' }}
      trailing="across 4 clients"
      href="#retainers"
    />
  </div>
)
