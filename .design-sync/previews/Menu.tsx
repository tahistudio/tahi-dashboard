/**
 * Menu uses <Popover> which renders via createPortal to document.body.
 * The open state panel therefore renders OUTSIDE the preview card container.
 * To make the menu content visible in the screenshot, we render the panel
 * chrome inline using plain div/button elements that match the Menu.Item
 * visual exactly (same font-size, padding, colour tokens, layout) --
 * bypassing the portal entirely.
 *
 * cfg.overrides.Menu = { "cardMode": "portal-bypass" } is not needed;
 * the static inline approach works. This IS a genuine limitation: the live
 * <Menu> component itself cannot be demonstrated open-in-card.
 */

const menuPanelStyle = {
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-md)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
  padding: '0.25rem',
  minWidth: '12rem',
  display: 'flex',
  flexDirection: 'column' as const,
}

const itemStyle = (danger = false) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '0.625rem',
  padding: '0.5rem 0.625rem',
  borderRadius: 'var(--radius-sm)',
  fontSize: '0.8125rem',
  fontWeight: 500,
  color: danger ? 'var(--color-danger)' : 'var(--color-text)',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  width: '100%',
  textAlign: 'left' as const,
  minHeight: '2rem',
})

const iconStyle = (danger = false) => ({
  display: 'inline-flex',
  flexShrink: 0,
  color: danger ? 'var(--color-danger)' : 'var(--color-text-muted)',
})

const dividerStyle = {
  height: '1px',
  background: 'var(--color-border-subtle)',
  margin: '0.25rem 0',
}

const labelStyle = {
  fontSize: '0.625rem',
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.08em',
  color: 'var(--color-text-subtle)',
  padding: '0.5rem 0.625rem 0.25rem',
}

const EditIcon = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
)

const CopyIcon = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)

const ShareIcon = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </svg>
)

const TrashIcon = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14H6L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4h6v2" />
  </svg>
)

const frame = {
  padding: '1.25rem',
  background: 'var(--color-bg-cream)',
  display: 'inline-flex',
  alignItems: 'flex-start',
  gap: '1.5rem',
}

/** Request context menu — open state (static inline render) */
export const RequestActions = () => (
  <div style={frame}>
    <div>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', margin: '0 0 0.5rem', fontWeight: 500 }}>
        Request menu (open)
      </p>
      <div style={menuPanelStyle}>
        <button style={itemStyle()}>
          <span style={iconStyle()}><EditIcon /></span> Edit request
        </button>
        <button style={itemStyle()}>
          <span style={iconStyle()}><CopyIcon /></span> Duplicate
        </button>
        <button style={itemStyle()}>
          <span style={iconStyle()}><ShareIcon /></span> Share with client
        </button>
        <div style={dividerStyle} />
        <button style={itemStyle(true)}>
          <span style={iconStyle(true)}><TrashIcon /></span> Delete
        </button>
      </div>
    </div>
  </div>
)

const MoveIcon = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="5 9 2 12 5 15" />
    <polyline points="9 5 12 2 15 5" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <line x1="12" y1="2" x2="12" y2="22" />
  </svg>
)

const ArchiveIcon = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="21 8 21 21 3 21 3 8" />
    <rect x="1" y="3" width="22" height="5" />
    <line x1="10" y1="12" x2="14" y2="12" />
  </svg>
)

/** Client context menu with label grouping */
export const ClientActions = () => (
  <div style={frame}>
    <div>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', margin: '0 0 0.5rem', fontWeight: 500 }}>
        Client menu (with label)
      </p>
      <div style={menuPanelStyle}>
        <button style={itemStyle()}>
          <span style={iconStyle()}><EditIcon /></span> Edit details
        </button>
        <button style={itemStyle()}>
          <span style={iconStyle()}><CopyIcon /></span> Duplicate client
        </button>
        <div style={dividerStyle} />
        <div style={labelStyle}>Move to</div>
        <button style={itemStyle()}>
          <span style={iconStyle()}><MoveIcon /></span> Active
          <span style={{ marginLeft: 'auto', fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
            Scale plan
          </span>
        </button>
        <button style={itemStyle()}>
          <span style={iconStyle()}><ArchiveIcon /></span> Archive
        </button>
        <div style={dividerStyle} />
        <button style={itemStyle(true)}>
          <span style={iconStyle(true)}><TrashIcon /></span> Delete client
        </button>
      </div>
    </div>
  </div>
)
