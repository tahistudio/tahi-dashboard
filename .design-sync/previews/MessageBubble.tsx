import { MessageBubble } from 'tahi-dashboard'

const frame = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  padding: '1.25rem',
  background: 'var(--color-bg-cream)',
  width: '32rem',
  maxWidth: '100%',
} as const

// Recent-feeling timestamps so the bubble header reads "2h ago" etc.
const now = Date.now()
const mins = (m: number) => new Date(now - m * 60_000).toISOString()

export const Inbound = () => (
  <div style={frame}>
    <MessageBubble
      author={{ name: 'Anna Okafor', role: 'client', presence: 'online' }}
      timestamp={mins(48)}
      bodyHtml="<p>Morning Liam, the new homepage hero looks great. Could we try the testimonials section above the pricing block instead of below it?</p>"
    />
  </div>
)

export const Outbound = () => (
  <div style={frame}>
    <MessageBubble
      own
      author={{ name: 'Liam Miller', role: 'admin', presence: 'online' }}
      timestamp={mins(41)}
      bodyHtml="<p>Good call, Anna. We'll move testimonials up and push a fresh preview to staging this afternoon for you to review.</p>"
      seen
    />
  </div>
)

export const WithAttachment = () => (
  <div style={frame}>
    <MessageBubble
      author={{ name: 'Staci Bonnie', role: 'admin', presence: 'away' }}
      timestamp={mins(30)}
      bodyHtml="<p>Here's the latest homepage build for Acme Co plus the brand guide we worked from. Have a look when you get a sec.</p>"
      attachments={[
        { id: 'f1', name: 'homepage-v3.fig', sizeBytes: 8_460_000, uploadedBy: 'Staci Bonnie' },
        { id: 'f2', name: 'acme-brand-guide.pdf', sizeBytes: 2_140_000, uploadedBy: 'Staci Bonnie' },
      ]}
      reactions={[{ emoji: '🎉', count: 2 }, { emoji: '👍', count: 1, mine: true }]}
    />
  </div>
)

export const InternalNote = () => (
  <div style={frame}>
    <MessageBubble
      visibility="internal"
      author={{ name: 'Liam Miller', role: 'admin', presence: 'online' }}
      timestamp={mins(22)}
      bodyHtml="<p>Heads up: Acme is on the Scale retainer, so the testimonials rework counts against the large track this week. Let's not flag it as scope creep yet.</p>"
    />
  </div>
)

export const WithReply = () => (
  <div style={frame}>
    <MessageBubble
      author={{ name: 'Anna Okafor', role: 'client', presence: 'online' }}
      timestamp={mins(8)}
      replyTo={{ authorName: 'Staci Bonnie', preview: "Here's the latest homepage build for Acme Co plus the brand guide…" }}
      bodyHtml="<p>Perfect, downloading now. This is exactly the direction we wanted. Thank you both!</p>"
      reactions={[{ emoji: '❤️', count: 1, mine: true }]}
    />
  </div>
)

export const Conversation = () => (
  <div style={frame}>
    <MessageBubble
      author={{ name: 'Anna Okafor', role: 'client', presence: 'online' }}
      timestamp={mins(48)}
      bodyHtml="<p>Could we try the testimonials section above the pricing block?</p>"
    />
    <MessageBubble
      own
      author={{ name: 'Liam Miller', role: 'admin', presence: 'online' }}
      timestamp={mins(41)}
      bodyHtml="<p>Good call. Pushing a fresh preview to staging this afternoon.</p>"
      seen
    />
    <MessageBubble
      author={{ name: 'Staci Bonnie', role: 'admin', presence: 'away' }}
      timestamp={mins(30)}
      bodyHtml="<p>Latest homepage build attached.</p>"
      attachments={[{ id: 'f3', name: 'homepage-v3.fig', sizeBytes: 8_460_000 }]}
    />
  </div>
)
