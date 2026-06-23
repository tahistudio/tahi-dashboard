import { LeafIcon } from 'tahi-dashboard'

const frame = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
  padding: '1.5rem',
  background: 'var(--color-bg-cream)',
  borderRadius: '0.75rem',
}

const darkFrame = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
  padding: '1.5rem',
  background: 'var(--color-brand-deepest, #1a2d17)',
  borderRadius: '0.75rem',
}

const row = { display: 'flex', alignItems: 'center', gap: '0.75rem' }

const label = {
  fontSize: '0.6875rem',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
  fontFamily: 'Manrope, sans-serif',
}

const labelDark = { ...label, color: 'rgba(255,255,255,0.45)' }

// currentColor means the icon inherits from its container's color
// Show it tinted to brand, muted, and danger colour
export const Tinted = () => (
  <div style={frame}>
    <span style={label}>currentColor tints</span>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{ ...row, color: 'var(--color-brand)' }}>
        <LeafIcon size={16} title="Brand tint" />
        <span style={{ fontSize: '0.875rem', fontFamily: 'Manrope, sans-serif', color: 'var(--color-brand)' }}>Brand green</span>
      </div>
      <div style={{ ...row, color: 'var(--color-text-muted)' }}>
        <LeafIcon size={16} title="Muted tint" />
        <span style={{ fontSize: '0.875rem', fontFamily: 'Manrope, sans-serif', color: 'var(--color-text-muted)' }}>Muted text</span>
      </div>
      <div style={{ ...row, color: 'var(--color-danger, #f87171)' }}>
        <LeafIcon size={16} title="Danger tint" />
        <span style={{ fontSize: '0.875rem', fontFamily: 'Manrope, sans-serif', color: 'var(--color-danger, #f87171)' }}>Danger</span>
      </div>
      <div style={{ ...row, color: 'var(--color-warning, #fb923c)' }}>
        <LeafIcon size={16} title="Warning tint" />
        <span style={{ fontSize: '0.875rem', fontFamily: 'Manrope, sans-serif', color: 'var(--color-warning, #fb923c)' }}>Warning</span>
      </div>
    </div>
  </div>
)

// Sizes 8-32 on cream
export const Sizes = () => (
  <div style={frame}>
    <span style={label}>Sizes (brand colour)</span>
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1rem', color: 'var(--color-brand)' }}>
      <LeafIcon size={8} title="8px" />
      <LeafIcon size={12} title="12px" />
      <LeafIcon size={16} title="16px" />
      <LeafIcon size={24} title="24px" />
      <LeafIcon size={32} title="32px" />
    </div>
  </div>
)

// On dark, white tint
export const OnDark = () => (
  <div style={darkFrame}>
    <span style={labelDark}>White tint on dark</span>
    <div style={{ ...row, color: 'rgba(255,255,255,0.9)' }}>
      <LeafIcon size={14} />
      <LeafIcon size={20} />
      <LeafIcon size={28} />
    </div>
  </div>
)
