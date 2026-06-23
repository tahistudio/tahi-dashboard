import { BarChart } from 'tahi-dashboard'

const revenue = [
  { label: 'Jan', value: 18 },
  { label: 'Feb', value: 22 },
  { label: 'Mar', value: 19 },
  { label: 'Apr', value: 27 },
  { label: 'May', value: 31 },
  { label: 'Jun', value: 24 },
]

const box = { width: '24rem', maxWidth: '100%', padding: '1.25rem', background: 'var(--color-bg)' } as const

export const Standard = () => (
  <div style={box}>
    <BarChart data={revenue} height={200} formatValue={(v) => `$${v}k`} ariaLabel="Monthly revenue" />
  </div>
)

export const PillWithCallout = () => (
  <div style={box}>
    <BarChart data={revenue} height={200} variant="pill" valueCallout tone="positive" formatValue={(v) => `$${v}k`} />
  </div>
)

export const Toned = () => (
  <div style={box}>
    <BarChart
      height={200}
      data={[
        { label: 'Q1', value: 12, tone: 'positive' },
        { label: 'Q2', value: -6, tone: 'negative' },
        { label: 'Q3', value: 9, tone: 'positive' },
        { label: 'Q4', value: 4, tone: 'neutral', striped: true },
      ]}
    />
  </div>
)
