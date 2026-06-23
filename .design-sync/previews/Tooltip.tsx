import { TahiButton, Avatar } from 'tahi-dashboard'

// The Tooltip component is hover/focus-driven and uses a portal — it will not
// paint its bubble in a static screenshot. We render a static inline replica
// of the tooltip bubble alongside the trigger so the visual is captured.

const cell = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1.25rem',
  padding: '1.5rem',
  background: 'var(--color-bg-cream)',
} as const

const bubbleTop = {
  position: 'relative',
  display: 'inline-flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.375rem',
} as const

const bubbleBottom = {
  position: 'relative',
  display: 'inline-flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.375rem',
} as const

const tooltipBubble = {
  background: 'var(--color-brand-deepest, #1a2e17)',
  color: '#ffffff',
  fontSize: '0.75rem',
  fontWeight: 500,
  lineHeight: 1.3,
  padding: '0.4rem 0.625rem',
  borderRadius: 'var(--radius-sm)',
  boxShadow: '0 4px 16px rgba(18, 26, 15, 0.18)',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
} as const

const caretUp = {
  width: 0,
  height: 0,
  borderLeft: '5px solid transparent',
  borderRight: '5px solid transparent',
  borderTop: '5px solid var(--color-brand-deepest, #1a2e17)',
} as const

const caretDown = {
  width: 0,
  height: 0,
  borderLeft: '5px solid transparent',
  borderRight: '5px solid transparent',
  borderBottom: '5px solid var(--color-brand-deepest, #1a2e17)',
} as const

export const TooltipOnButton = () => (
  <div style={cell}>
    <div style={{ display: 'flex', gap: '2.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
      {/* Top placement — bubble above trigger */}
      <div style={bubbleTop}>
        <div style={tooltipBubble}>Sync with Xero</div>
        <div style={caretUp} />
        <TahiButton variant="secondary" size="sm">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 7A5 5 0 1 1 7 2M12 2v3h-3" />
          </svg>
        </TahiButton>
      </div>
      {/* Top placement with longer label */}
      <div style={bubbleTop}>
        <div style={tooltipBubble}>Download INV-0042 as PDF</div>
        <div style={caretUp} />
        <TahiButton variant="ghost" size="sm">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 2v7M4 6l3 3 3-3M3 11h8" />
          </svg>
        </TahiButton>
      </div>
    </div>
  </div>
)

export const TooltipOnAvatar = () => (
  <div style={cell}>
    <div style={{ display: 'flex', gap: '2rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
      {/* Avatar with name tooltip */}
      <div style={bubbleTop}>
        <div style={tooltipBubble}>Liam Miller</div>
        <div style={caretUp} />
        <Avatar name="Liam Miller" src="https://i.pravatar.cc/80?img=11" size="md" tooltip={false} />
      </div>
      <div style={bubbleTop}>
        <div style={tooltipBubble}>Staci Bonnie</div>
        <div style={caretUp} />
        <Avatar name="Staci Bonnie" src="https://i.pravatar.cc/80?img=47" size="md" tooltip={false} />
      </div>
    </div>
  </div>
)

export const TooltipBottomPlacement = () => (
  <div style={cell}>
    <div style={{ display: 'flex', gap: '2.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {/* Bottom placement */}
      <div style={bubbleBottom}>
        <TahiButton variant="primary" size="sm">Send contract</TahiButton>
        <div style={caretDown} />
        <div style={tooltipBubble}>Sends via Resend to client</div>
      </div>
      <div style={bubbleBottom}>
        <TahiButton variant="ghost" size="sm">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="7" cy="7" r="5" />
            <path d="M7 5v2.5l1.5 1.5" />
          </svg>
        </TahiButton>
        <div style={caretDown} />
        <div style={tooltipBubble}>Last updated 3 min ago</div>
      </div>
    </div>
  </div>
)
