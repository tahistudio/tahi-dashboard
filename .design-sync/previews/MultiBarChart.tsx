import { MultiBarChart } from 'tahi-dashboard'

const box = { width: '32rem', maxWidth: '100%', padding: '1.25rem', background: 'var(--color-bg)' } as const

const revenueVsCost = [
  { label: 'Jan', Revenue: 18400, Costs: 8200 },
  { label: 'Feb', Revenue: 19200, Costs: 8600 },
  { label: 'Mar', Revenue: 20100, Costs: 9100 },
  { label: 'Apr', Revenue: 21500, Costs: 9400 },
  { label: 'May', Revenue: 23800, Costs: 10200 },
  { label: 'Jun', Revenue: 24600, Costs: 10800 },
]

const requestsByCategory = [
  { label: 'W1', Design: 8, Dev: 5, Strategy: 2 },
  { label: 'W2', Design: 11, Dev: 7, Strategy: 3 },
  { label: 'W3', Design: 9, Dev: 9, Strategy: 1 },
  { label: 'W4', Design: 13, Dev: 6, Strategy: 4 },
  { label: 'W5', Design: 10, Dev: 8, Strategy: 2 },
  { label: 'W6', Design: 14, Dev: 10, Strategy: 3 },
]

const hoursStackedByClient = [
  { label: 'Mon', Acme: 6.5, Bright: 4.0, Koru: 2.5 },
  { label: 'Tue', Acme: 7.0, Bright: 3.5, Koru: 3.0 },
  { label: 'Wed', Acme: 5.5, Bright: 5.0, Koru: 2.0 },
  { label: 'Thu', Acme: 8.0, Bright: 4.5, Koru: 1.5 },
  { label: 'Fri', Acme: 4.0, Bright: 2.5, Koru: 1.5 },
]

export const RevenueVsCosts = () => (
  <div style={box}>
    <div style={{ marginBottom: '0.5rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
      Revenue vs costs (H1 2026)
    </div>
    <MultiBarChart
      data={revenueVsCost}
      series={[
        { key: 'Revenue', label: 'Revenue', tone: 'positive' },
        { key: 'Costs', label: 'Costs', tone: 'negative' },
      ]}
      height={240}
      formatValue={(v) => `$${(v / 1000).toFixed(0)}k`}
      ariaLabel="Revenue versus costs H1 2026"
    />
  </div>
)

export const RequestsByCategory = () => (
  <div style={box}>
    <div style={{ marginBottom: '0.5rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
      Requests by category (6 weeks)
    </div>
    <MultiBarChart
      data={requestsByCategory}
      series={[
        { key: 'Design', label: 'Design' },
        { key: 'Dev', label: 'Development' },
        { key: 'Strategy', label: 'Strategy' },
      ]}
      height={220}
      ariaLabel="Requests by category over 6 weeks"
    />
  </div>
)

export const HoursStackedByClient = () => (
  <div style={box}>
    <div style={{ marginBottom: '0.5rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
      Hours by client this week (stacked)
    </div>
    <MultiBarChart
      data={hoursStackedByClient}
      series={[
        { key: 'Acme', label: 'Acme Corp' },
        { key: 'Bright', label: 'Bright Labs' },
        { key: 'Koru', label: 'Koru Digital' },
      ]}
      stacked
      height={220}
      formatValue={(v) => `${v}h`}
      ariaLabel="Hours by client stacked per day"
    />
  </div>
)
