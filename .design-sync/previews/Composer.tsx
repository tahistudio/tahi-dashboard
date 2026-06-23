import { Composer } from 'tahi-dashboard'

const frame = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  padding: '1.25rem',
  background: 'var(--color-bg-cream)',
  width: '34rem',
  maxWidth: '100%',
} as const

const label = {
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--color-text-subtle)',
} as const

const noop = () => {}

// @-mention sources scoped to the Acme Co homepage conversation.
const mentionSources = {
  people: [
    { id: 'u1', type: 'person' as const, label: 'Liam Miller', sub: 'Tahi Studio' },
    { id: 'u2', type: 'person' as const, label: 'Staci Bonnie', sub: 'Tahi Studio' },
    { id: 'u3', type: 'person' as const, label: 'Anna Okafor', sub: 'Acme Co' },
  ],
  orgs: [{ id: 'o1', type: 'org' as const, label: 'Acme Co', sub: 'Scale retainer' }],
  requests: [{ id: 'r1', type: 'request' as const, label: 'Homepage redesign', sub: 'In progress' }],
}

export const AtRest = () => (
  <div style={frame}>
    <span style={label}>Public reply</span>
    <Composer
      placeholder="Reply to Anna…"
      mentionSources={mentionSources}
      onSend={noop}
    />
  </div>
)

export const WithInternalToggle = () => (
  <div style={frame}>
    <span style={label}>Public / Internal toggle</span>
    <Composer
      placeholder="Reply to Anna, or switch to an internal note…"
      canBeInternal
      mentionSources={mentionSources}
      onSend={noop}
    />
  </div>
)

export const Slim = () => (
  <div style={frame}>
    <span style={label}>Compact (no toolbar, text only)</span>
    <Composer
      placeholder="Add a quick comment…"
      hideToolbar
      noFiles
      noVoice
      onSend={noop}
    />
  </div>
)
