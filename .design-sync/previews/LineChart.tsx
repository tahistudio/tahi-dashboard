import { LineChart } from 'tahi-dashboard'

const box = { width: '28rem', maxWidth: '100%', padding: '1.25rem', background: 'var(--color-bg)' } as const
const wideBox = { width: '32rem', maxWidth: '100%', padding: '1.25rem', background: 'var(--color-bg)' } as const

const mrrData = [
  { label: 'Jan', value: 18400 },
  { label: 'Feb', value: 19200 },
  { label: 'Mar', value: 20100 },
  { label: 'Apr', value: 21500 },
  { label: 'May', value: 23800 },
  { label: 'Jun', value: 24600 },
  { label: 'Jul', value: 26200 },
  { label: 'Aug', value: 25400 },
  { label: 'Sep', value: 27900 },
  { label: 'Oct', value: 29100 },
  { label: 'Nov', value: 31400 },
  { label: 'Dec', value: 33200 },
]

const capacityData = [
  { label: 'W1', value: 62 },
  { label: 'W2', value: 71 },
  { label: 'W3', value: 85 },
  { label: 'W4', value: 78 },
  { label: 'W5', value: 88 },
  { label: 'W6', value: 92 },
  { label: 'W7', value: 84 },
  { label: 'W8', value: 76 },
]

const responseTimeData = [
  { label: 'Mon', value: 3.2 },
  { label: 'Tue', value: 2.8 },
  { label: 'Wed', value: 4.1 },
  { label: 'Thu', value: 2.5 },
  { label: 'Fri', value: 3.8 },
  { label: 'Sat', value: 6.2 },
  { label: 'Sun', value: 5.9 },
]

export const MrrGrowthLine = () => (
  <div style={wideBox}>
    <div style={{ marginBottom: '0.5rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
      MRR growth (2026)
    </div>
    <LineChart
      data={mrrData}
      height={220}
      tone="positive"
      formatValue={(v) => `$${(v / 1000).toFixed(0)}k`}
      ariaLabel="Monthly recurring revenue 2026"
    />
  </div>
)

export const MrrAreaFilled = () => (
  <div style={wideBox}>
    <div style={{ marginBottom: '0.5rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
      MRR area view
    </div>
    <LineChart
      data={mrrData}
      height={220}
      tone="positive"
      area
      dots
      formatValue={(v) => `$${(v / 1000).toFixed(0)}k`}
      ariaLabel="Monthly recurring revenue area"
    />
  </div>
)

export const CapacityTrend = () => (
  <div style={box}>
    <div style={{ marginBottom: '0.5rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
      Team capacity (%) by week
    </div>
    <LineChart
      data={capacityData}
      height={200}
      tone="positive"
      area
      formatValue={(v) => `${v}%`}
      ariaLabel="Weekly team capacity utilisation"
    />
  </div>
)

export const ResponseTimeWarning = () => (
  <div style={box}>
    <div style={{ marginBottom: '0.5rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
      Avg response time (hrs) this week
    </div>
    <LineChart
      data={responseTimeData}
      height={200}
      tone="negative"
      dots
      formatValue={(v) => `${v}h`}
      ariaLabel="Average response time by day"
    />
  </div>
)
