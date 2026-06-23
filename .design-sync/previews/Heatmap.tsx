import { Heatmap } from 'tahi-dashboard'

const box = { width: '36rem', maxWidth: '100%', padding: '1.25rem', background: 'var(--color-bg)' } as const
const narrowBox = { width: '28rem', maxWidth: '100%', padding: '1.25rem', background: 'var(--color-bg)' } as const

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const hours = ['8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm']

// Realistic request activity heatmap (by day of week x hour of day)
const activityRows = [
  {
    label: 'Mon',
    cells: [
      { key: '8am', value: 1 }, { key: '9am', value: 4 }, { key: '10am', value: 8 },
      { key: '11am', value: 6 }, { key: '12pm', value: 3 }, { key: '1pm', value: 5 },
      { key: '2pm', value: 9 }, { key: '3pm', value: 7 }, { key: '4pm', value: 4 },
      { key: '5pm', value: 2 },
    ],
  },
  {
    label: 'Tue',
    cells: [
      { key: '8am', value: 2 }, { key: '9am', value: 5 }, { key: '10am', value: 10 },
      { key: '11am', value: 8 }, { key: '12pm', value: 4 }, { key: '1pm', value: 6 },
      { key: '2pm', value: 11 }, { key: '3pm', value: 9 }, { key: '4pm', value: 5 },
      { key: '5pm', value: 1 },
    ],
  },
  {
    label: 'Wed',
    cells: [
      { key: '8am', value: 1 }, { key: '9am', value: 3 }, { key: '10am', value: 7 },
      { key: '11am', value: 9 }, { key: '12pm', value: 5 }, { key: '1pm', value: 7 },
      { key: '2pm', value: 12 }, { key: '3pm', value: 10 }, { key: '4pm', value: 6 },
      { key: '5pm', value: 2 },
    ],
  },
  {
    label: 'Thu',
    cells: [
      { key: '8am', value: 2 }, { key: '9am', value: 6 }, { key: '10am', value: 9 },
      { key: '11am', value: 7 }, { key: '12pm', value: 4 }, { key: '1pm', value: 8 },
      { key: '2pm', value: 10 }, { key: '3pm', value: 8 }, { key: '4pm', value: 3 },
      { key: '5pm', value: 1 },
    ],
  },
  {
    label: 'Fri',
    cells: [
      { key: '8am', value: 1 }, { key: '9am', value: 4 }, { key: '10am', value: 6 },
      { key: '11am', value: 5 }, { key: '12pm', value: 3 }, { key: '1pm', value: 4 },
      { key: '2pm', value: 6 }, { key: '3pm', value: 5 }, { key: '4pm', value: 2 },
      { key: '5pm', value: 0 },
    ],
  },
]

// Client response times by day (Mon-Fri) x client
const clientClients = ['Acme', 'Bright', 'Koru', 'Pounamu', 'Tidal']
const clientDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const responseRows = [
  { label: 'Acme', cells: clientDays.map((d, i) => ({ key: d, value: [2, 4, 1, 3, 2][i] })) },
  { label: 'Bright', cells: clientDays.map((d, i) => ({ key: d, value: [5, 3, 6, 4, 7][i] })) },
  { label: 'Koru', cells: clientDays.map((d, i) => ({ key: d, value: [1, 2, 1, 2, 1][i] })) },
  { label: 'Pounamu', cells: clientDays.map((d, i) => ({ key: d, value: [3, 3, 4, 2, 3][i] })) },
  { label: 'Tidal', cells: clientDays.map((d, i) => ({ key: d, value: [8, 6, 5, 7, 9][i] })) },
]

export const RequestActivityHeatmap = () => (
  <div style={box}>
    <div style={{ marginBottom: '0.75rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
      Request submissions by day + hour
    </div>
    <Heatmap
      rows={activityRows}
      columns={hours}
      tone="positive"
      fluid
      formatValue={(v) => `${v} requests`}
      ariaLabel="Request activity heatmap by hour"
    />
  </div>
)

export const ClientResponseHeatmap = () => (
  <div style={narrowBox}>
    <div style={{ marginBottom: '0.75rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
      Avg client response time (hrs) this week
    </div>
    <Heatmap
      rows={responseRows}
      columns={clientDays}
      tone="negative"
      fluid
      formatValue={(v) => `${v}h avg`}
      ariaLabel="Client response time heatmap"
    />
  </div>
)

export const TeamLoadHeatmap = () => (
  <div style={box}>
    <div style={{ marginBottom: '0.75rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
      Team task load by person + day
    </div>
    <Heatmap
      rows={[
        { label: 'Liam', cells: days.map((d, i) => ({ key: d, value: [6, 8, 7, 9, 5][i], meta: `${[6, 8, 7, 9, 5][i]} tasks` })) },
        { label: 'Staci', cells: days.map((d, i) => ({ key: d, value: [4, 5, 6, 4, 3][i], meta: `${[4, 5, 6, 4, 3][i]} tasks` })) },
      ]}
      columns={days}
      tone="positive"
      fluid
      formatValue={(v) => `${v} tasks`}
      ariaLabel="Team task load heatmap"
    />
  </div>
)
