import { Avatar } from 'tahi-dashboard'

const wrap = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.875rem',
  alignItems: 'center',
  padding: '1.25rem',
  background: 'var(--color-bg-cream)',
} as const

const col = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
  padding: '1.25rem',
  background: 'var(--color-bg-cream)',
} as const

export const Sizes = () => (
  <div style={wrap}>
    <Avatar name="Liam Miller" size="xs" tooltip={false} />
    <Avatar name="Staci Bonnie" size="sm" tooltip={false} />
    <Avatar name="Liam Miller" size="md" tooltip={false} />
    <Avatar name="Staci Bonnie" size="lg" tooltip={false} />
    <Avatar name="Liam Miller" size="xl" tooltip={false} />
  </div>
)

export const WithImages = () => (
  <div style={wrap}>
    <Avatar name="Liam Miller" src="https://i.pravatar.cc/80?img=11" size="lg" tooltip={false} />
    <Avatar name="Staci Bonnie" src="https://i.pravatar.cc/80?img=47" size="lg" tooltip={false} />
    <Avatar name="Olivia Chen" src="https://i.pravatar.cc/80?img=5" size="lg" tooltip={false} />
    <Avatar name="Hamish Tane" src="https://i.pravatar.cc/80?img=59" size="lg" tooltip={false} />
  </div>
)

export const InitialsFallback = () => (
  <div style={wrap}>
    <Avatar name="Liam Miller" size="md" tooltip={false} />
    <Avatar name="Staci Bonnie" size="md" tooltip={false} />
    <Avatar name="Acme Co" size="md" tooltip={false} />
    <Avatar name="Tahi Studio" size="md" tooltip={false} />
    <Avatar name="Physiotrack NZ" size="md" tooltip={false} />
  </div>
)

export const WithStatus = () => (
  <div style={wrap}>
    <Avatar name="Liam Miller" src="https://i.pravatar.cc/80?img=11" status="online" size="lg" tooltip={false} />
    <Avatar name="Staci Bonnie" src="https://i.pravatar.cc/80?img=47" status="away" size="lg" tooltip={false} />
    <Avatar name="Hamish Tane" src="https://i.pravatar.cc/80?img=59" status="offline" size="lg" tooltip={false} />
  </div>
)

export const Stack = () => (
  <div style={col}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>Homepage redesign team</span>
      <Avatar.Stack>
        <Avatar name="Liam Miller" src="https://i.pravatar.cc/80?img=11" size="sm" />
        <Avatar name="Staci Bonnie" src="https://i.pravatar.cc/80?img=47" size="sm" />
        <Avatar name="Olivia Chen" src="https://i.pravatar.cc/80?img=5" size="sm" />
      </Avatar.Stack>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>Scale retainer watchers</span>
      <Avatar.Stack max={3}>
        <Avatar name="Liam Miller" src="https://i.pravatar.cc/80?img=11" size="sm" />
        <Avatar name="Staci Bonnie" src="https://i.pravatar.cc/80?img=47" size="sm" />
        <Avatar name="Olivia Chen" src="https://i.pravatar.cc/80?img=5" size="sm" />
        <Avatar name="Hamish Tane" src="https://i.pravatar.cc/80?img=59" size="sm" />
        <Avatar name="Kate Brown" src="https://i.pravatar.cc/80?img=31" size="sm" />
      </Avatar.Stack>
    </div>
  </div>
)
