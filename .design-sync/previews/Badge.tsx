import { Badge } from 'tahi-dashboard'

const wrap = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', padding: '1.25rem' } as const

export const Tones = () => (
  <div style={wrap}>
    <Badge tone="positive">Delivered</Badge>
    <Badge tone="teal">In progress</Badge>
    <Badge tone="warning">In review</Badge>
    <Badge tone="purple">Client review</Badge>
    <Badge tone="info">Submitted</Badge>
    <Badge tone="danger">Overdue</Badge>
    <Badge tone="rose">Urgent</Badge>
    <Badge tone="neutral">Draft</Badge>
  </div>
)

export const Variants = () => (
  <div style={wrap}>
    <Badge variant="soft" tone="positive">Soft</Badge>
    <Badge variant="solid" tone="positive">Solid</Badge>
    <Badge variant="outline" tone="positive">Outline</Badge>
    <Badge variant="count">12</Badge>
  </div>
)

export const Leaders = () => (
  <div style={wrap}>
    <Badge tone="brand" leader="leaf">Tahi partner</Badge>
    <Badge tone="teal" leader="dot">Active</Badge>
    <Badge tone="warning" leader="dot">Paused</Badge>
    <Badge tone="neutral" size="sm" leader="dot">Small</Badge>
  </div>
)

export const Removable = () => (
  <div style={wrap}>
    <Badge tone="info" onRemove={() => {}}>Webflow</Badge>
    <Badge tone="purple" onRemove={() => {}}>SEO</Badge>
    <Badge tone="teal" selected onClick={() => {}}>Selected</Badge>
  </div>
)
