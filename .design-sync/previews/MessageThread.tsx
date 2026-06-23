import { MessageThread, MessageBubble } from 'tahi-dashboard'

const frame = {
  padding: '1.25rem',
  background: 'var(--color-bg-cream)',
  width: '34rem',
  maxWidth: '100%',
} as const

const now = Date.now()
const mins = (m: number) => new Date(now - m * 60_000).toISOString()

interface ThreadMsg {
  id: string
  timestamp: string
  author: { name: string; role: 'admin' | 'client'; presence?: 'online' | 'away' | 'offline' }
  bodyHtml: string
  own?: boolean
  seen?: boolean
  attachments?: ReadonlyArray<{ id: string; name: string; sizeBytes?: number; uploadedBy?: string }>
}

const messages: ThreadMsg[] = [
  {
    id: 'm1',
    timestamp: mins(54),
    author: { name: 'Anna Okafor', role: 'client', presence: 'online' },
    bodyHtml: '<p>Hi team, kicking off the homepage redesign request. Our main goal is a hero that leads with the new product photography.</p>',
  },
  {
    id: 'm2',
    timestamp: mins(47),
    author: { name: 'Liam Miller', role: 'admin', presence: 'online' },
    bodyHtml: '<p>Love it, Anna. Staci is drafting the hero now. We\'ll keep the existing pricing block and rework the testimonials around it.</p>',
    own: true,
    seen: true,
  },
  {
    id: 'm3',
    timestamp: mins(31),
    author: { name: 'Staci Bonnie', role: 'admin', presence: 'away' },
    bodyHtml: '<p>First pass of the homepage is on staging. Dropping the Figma file here too.</p>',
    attachments: [{ id: 'fa1', name: 'homepage-v3.fig', sizeBytes: 8_460_000, uploadedBy: 'Staci Bonnie' }],
  },
  {
    id: 'm4',
    timestamp: mins(12),
    author: { name: 'Anna Okafor', role: 'client', presence: 'online' },
    bodyHtml: '<p>That\'s a brilliant start. Two small notes coming, but the direction is spot on.</p>',
  },
]

const participants = [
  { id: 'p1', name: 'Liam Miller', role: 'admin' as const },
  { id: 'p2', name: 'Staci Bonnie', role: 'admin' as const },
  { id: 'p3', name: 'Anna Okafor', role: 'client' as const },
]

export const ClientThread = () => (
  <div style={frame}>
    <MessageThread
      title="Acme Co · Homepage redesign"
      subtitle="Request thread · 3 participants"
      visibility="external"
      participants={participants}
      maxHeight="26rem"
      messages={messages}
      renderMessage={(m) => (
        <MessageBubble
          author={m.author}
          timestamp={m.timestamp}
          bodyHtml={m.bodyHtml}
          own={m.own}
          seen={m.seen}
          attachments={m.attachments}
        />
      )}
    />
  </div>
)

export const InternalThread = () => (
  <div style={frame}>
    <MessageThread
      title="Acme Co · Homepage redesign"
      subtitle="Tahi team only"
      visibility="internal"
      participants={participants.slice(0, 2)}
      maxHeight="22rem"
      typingNames={['Staci Bonnie']}
      messages={messages.slice(0, 3)}
      renderMessage={(m) => (
        <MessageBubble
          author={m.author}
          timestamp={m.timestamp}
          bodyHtml={m.bodyHtml}
          own={m.own}
          seen={m.seen}
          visibility="internal"
        />
      )}
    />
  </div>
)
