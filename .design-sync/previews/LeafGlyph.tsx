import { LeafGlyph } from 'tahi-dashboard'

const lightCell = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.75rem',
  padding: '1.5rem 2rem',
  background: 'var(--color-bg-cream)',
  borderRadius: '0.75rem',
}

const darkCell = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.75rem',
  padding: '1.5rem 2rem',
  background: 'var(--color-brand-deepest, #1a2d17)',
  borderRadius: '0.75rem',
}

const label = {
  fontSize: '0.6875rem',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
  fontFamily: 'Manrope, sans-serif',
}

const labelDark = {
  ...label,
  color: 'rgba(255,255,255,0.45)',
}

const row = {
  display: 'flex',
  alignItems: 'center',
  gap: '1rem',
}

// Three sizes on cream background
export const Sizes = () => (
  <div style={lightCell}>
    <span style={label}>Sizes on cream</span>
    <div style={row}>
      <LeafGlyph size={12} title="Leaf glyph small" />
      <LeafGlyph size={24} title="Leaf glyph medium" />
      <LeafGlyph size={48} title="Leaf glyph large" />
      <LeafGlyph size={72} title="Leaf glyph xlarge" />
    </div>
  </div>
)

// Same sizes on dark forest background — gradient shows vibrantly
export const OnDark = () => (
  <div style={darkCell}>
    <span style={labelDark}>Sizes on dark forest</span>
    <div style={row}>
      <LeafGlyph size={12} title="Leaf glyph small" />
      <LeafGlyph size={24} title="Leaf glyph medium" />
      <LeafGlyph size={48} title="Leaf glyph large" />
      <LeafGlyph size={72} title="Leaf glyph xlarge" />
    </div>
  </div>
)

// Usage in context: chip leader dot, tagline leader, i-dot reference sizes
export const InContext = () => (
  <div style={lightCell}>
    <span style={label}>In context</span>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
        <LeafGlyph size={10} />
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontFamily: 'Manrope, sans-serif' }}>Chip leader (10px)</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <LeafGlyph size={16} />
        <span style={{ fontSize: '0.875rem', color: 'var(--color-text)', fontFamily: 'Manrope, sans-serif' }}>Tagline leader (16px)</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
        <LeafGlyph size={24} />
        <span style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-brand)', fontFamily: 'Manrope, sans-serif' }}>Section header (24px)</span>
      </div>
    </div>
  </div>
)
