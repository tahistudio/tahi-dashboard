import { Card, Badge, TahiButton } from 'tahi-dashboard'

const frame = { padding: '1.25rem', background: 'var(--color-bg-cream)', maxWidth: '24rem' } as const

export const Default = () => (
  <div style={frame}>
    <Card>
      <Card.Header>
        <div>
          <Card.Title>Homepage redesign</Card.Title>
          <Card.Subtitle>Acme Co · updated 2h ago</Card.Subtitle>
        </div>
        <Card.Action>
          <Badge tone="teal" leader="dot">In progress</Badge>
        </Card.Action>
      </Card.Header>
      <Card.Body>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', lineHeight: 1.5, margin: 0 }}>
          Three tracks moving this sprint. Next milestone is the pricing page build,
          scheduled for client review on Thursday.
        </p>
      </Card.Body>
      <Card.Footer bordered>
        <TahiButton size="sm">View request</TahiButton>
        <TahiButton size="sm" variant="ghost">Message</TahiButton>
      </Card.Footer>
    </Card>
  </div>
)

export const Variants = () => (
  <div style={{ ...frame, display: 'flex', flexDirection: 'column', gap: '0.875rem', maxWidth: '22rem' }}>
    <Card variant="default" padding="md"><Card.Title>Default</Card.Title><Card.Subtitle>1px border, hover lift</Card.Subtitle></Card>
    <Card variant="flat" padding="md"><Card.Title>Flat</Card.Title><Card.Subtitle>No border, no hover</Card.Subtitle></Card>
    <Card variant="elevated" padding="md"><Card.Title>Elevated</Card.Title><Card.Subtitle>Floating UI, shadow-md</Card.Subtitle></Card>
  </div>
)

export const Sectioned = () => (
  <div style={frame}>
    <Card padding="md">
      <Card.Title>Engagement</Card.Title>
      <Card.Section label="Plan">
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>Scale · two tracks</span>
      </Card.Section>
      <Card.Section label="Owner">
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>Liam Miller</span>
      </Card.Section>
      <Card.Section label="Status" last>
        <Badge tone="positive" leader="dot">Healthy</Badge>
      </Card.Section>
    </Card>
  </div>
)
