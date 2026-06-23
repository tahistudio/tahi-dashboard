import { DonutChart } from 'tahi-dashboard'

const box = { padding: '1.5rem', background: 'var(--color-bg)', display: 'inline-flex', flexWrap: 'wrap' as const, gap: '2rem', alignItems: 'flex-start' }

export const RevenueByService = () => (
  <div style={box}>
    <DonutChart
      segments={[
        { label: 'Webflow builds', value: 48 },
        { label: 'Retainers', value: 32 },
        { label: 'Strategy', value: 12 },
        { label: 'Workshops', value: 8 },
      ]}
      size={200}
      centreLabel="Revenue"
      centreValue="$33k"
      ariaLabel="Revenue by service type"
    />
  </div>
)

export const RequestsByStatus = () => (
  <div style={box}>
    <DonutChart
      segments={[
        { label: 'In progress', value: 14 },
        { label: 'In review', value: 6 },
        { label: 'Delivered', value: 28 },
        { label: 'On hold', value: 4 },
        { label: 'Submitted', value: 9 },
      ]}
      size={180}
      centreLabel="Requests"
      centreValue="61"
      ariaLabel="Requests by status"
    />
  </div>
)

export const TimeByClient = () => (
  <div style={box}>
    <DonutChart
      segments={[
        { label: 'Acme Corp', value: 42 },
        { label: 'Bright Labs', value: 28 },
        { label: 'Koru Digital', value: 18 },
        { label: 'Pounamu Media', value: 12 },
        { label: 'Internal', value: 8 },
      ]}
      size={220}
      centreLabel="Hours"
      centreValue="108h"
      legend
      ariaLabel="Time allocation by client"
    />
  </div>
)
