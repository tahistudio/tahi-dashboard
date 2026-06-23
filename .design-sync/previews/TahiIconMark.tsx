import { TahiIconMark } from 'tahi-dashboard'

const creamCell = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '1rem',
  padding: '1.75rem',
  background: 'var(--color-bg-cream)',
  borderRadius: '0.75rem',
}

const darkCell = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '1rem',
  padding: '1.75rem',
  background: 'var(--color-brand-deepest, #1a2d17)',
  borderRadius: '0.75rem',
}

const sectionLabel = {
  fontSize: '0.6875rem',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  fontFamily: 'Manrope, sans-serif',
  color: 'var(--color-text-muted)',
}

const sectionLabelDark = { ...sectionLabel, color: 'rgba(255,255,255,0.4)' }

const row = { display: 'flex', alignItems: 'flex-end', gap: '1.25rem' }

// on-light variant: dark "1" + deep gradient leaf, for cream/white surfaces
export const OnLight = () => (
  <div style={creamCell}>
    <span style={sectionLabel}>on-light variant, cream surface</span>
    <div style={row}>
      <TahiIconMark size={20} variant="on-light" title="Tahi icon mark small" />
      <TahiIconMark size={32} variant="on-light" title="Tahi icon mark medium" />
      <TahiIconMark size={48} variant="on-light" title="Tahi icon mark large" />
      <TahiIconMark size={64} variant="on-light" title="Tahi icon mark xlarge" />
    </div>
  </div>
)

// on-dark variant: near-white "1" + bright gradient leaf, for dark surfaces
export const OnDark = () => (
  <div style={darkCell}>
    <span style={sectionLabelDark}>on-dark variant, forest surface</span>
    <div style={row}>
      <TahiIconMark size={20} variant="on-dark" title="Tahi icon mark small on dark" />
      <TahiIconMark size={32} variant="on-dark" title="Tahi icon mark medium on dark" />
      <TahiIconMark size={48} variant="on-dark" title="Tahi icon mark large on dark" />
      <TahiIconMark size={64} variant="on-dark" title="Tahi icon mark xlarge on dark" />
    </div>
  </div>
)

// Both variants side by side — contrast comparison
export const BothVariants = () => (
  <div style={{ display: 'flex', gap: '0', borderRadius: '0.75rem', overflow: 'hidden' }}>
    <div style={{ flex: 1, padding: '1.5rem', background: 'var(--color-bg-cream)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.625rem' }}>
      <TahiIconMark size={40} variant="on-light" />
      <span style={{ ...sectionLabel, textTransform: 'none', letterSpacing: 0, fontSize: '0.75rem' }}>on-light</span>
    </div>
    <div style={{ flex: 1, padding: '1.5rem', background: 'var(--color-brand-deepest, #1a2d17)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.625rem' }}>
      <TahiIconMark size={40} variant="on-dark" />
      <span style={{ ...sectionLabelDark, textTransform: 'none', letterSpacing: 0, fontSize: '0.75rem' }}>on-dark</span>
    </div>
  </div>
)
