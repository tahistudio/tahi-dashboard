import { ProgressBar } from 'tahi-dashboard'

const col = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
  padding: '1.25rem',
  background: 'var(--color-bg-cream)',
  maxWidth: '22rem',
} as const

export const BasicValues = () => (
  <div style={col}>
    <ProgressBar value={0} label="Tasks complete" trailing="0 / 12" />
    <ProgressBar value={35} label="Retainer hours used" trailing="7h / 20h" />
    <ProgressBar value={72} label="Proposal sections done" trailing="13 / 18" />
    <ProgressBar value={100} label="Onboarding checklist" trailing="8 / 8" />
  </div>
)

export const Tones = () => (
  <div style={col}>
    <ProgressBar value={55} tone="positive" label="Design tracks" trailing="55%" />
    <ProgressBar value={80} tone="warning" label="Small track capacity" trailing="80%" />
    <ProgressBar value={100} tone="danger" label="Monthly hours cap" trailing="Exceeded" />
    <ProgressBar value={40} tone="neutral" label="Content reviewed" trailing="40%" />
  </div>
)

export const AutoTone = () => (
  <div style={col}>
    <ProgressBar value={45} max={100} label="Acme Co retainer — auto tone" trailing="45 / 100h" />
    <ProgressBar value={78} max={100} label="Physiotrack NZ — auto tone" trailing="78 / 100h" />
    <ProgressBar value={102} max={100} label="Sunrise Media — auto tone" trailing="102 / 100h" />
  </div>
)

export const Heights = () => (
  <div style={col}>
    <ProgressBar value={60} height={4} label="Thin track" />
    <ProgressBar value={60} height={8} label="Default" />
    <ProgressBar value={60} height={14} label="Thick track" />
  </div>
)

export const Segmented = () => (
  <div style={col}>
    <ProgressBar
      segments={[
        { value: 18, tone: 'positive', label: 'Delivered' },
        { value: 6, tone: 'warning', label: 'In progress' },
        { value: 2, tone: 'danger', label: 'Blocked' },
      ]}
      max={32}
      label="Sprint requests"
    />
    <ProgressBar
      segments={[
        { value: 12, tone: 'positive', label: 'Paid' },
        { value: 3, tone: 'warning', label: 'Pending' },
        { value: 1, tone: 'danger', label: 'Overdue' },
      ]}
      max={20}
      label="Invoices this quarter"
    />
  </div>
)
