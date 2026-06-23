import { TahiWordmark } from 'tahi-dashboard'

const creamCell = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '1rem',
  padding: '1.75rem 2rem',
  background: 'var(--color-bg-cream)',
  borderRadius: '0.75rem',
}

const darkCell = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '1rem',
  padding: '1.75rem 2rem',
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

// Light surface: wordmark in dark text (default)
export const OnCream = () => (
  <div style={creamCell}>
    <span style={sectionLabel}>On cream, dark text</span>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', color: 'var(--color-text, #121A0F)' }}>
      <TahiWordmark size={20} />
      <TahiWordmark size={30} />
      <TahiWordmark size={44} />
    </div>
  </div>
)

// Dark surface: wordmark in near-white
export const OnDark = () => (
  <div style={darkCell}>
    <span style={sectionLabelDark}>On dark forest, near-white</span>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', color: 'var(--color-text-on-dark, #f3f7f2)' }}>
      <TahiWordmark size={20} />
      <TahiWordmark size={30} />
      <TahiWordmark size={44} />
    </div>
  </div>
)

// Brand green tint on cream (co-branding / tagline usage)
export const BrandGreen = () => (
  <div style={creamCell}>
    <span style={sectionLabel}>Brand green tint</span>
    <div style={{ color: 'var(--color-brand, #5A824E)' }}>
      <TahiWordmark size={36} title="Tahi — brand green" />
    </div>
  </div>
)
