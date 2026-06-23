import { TahiStudioWordmark } from 'tahi-dashboard'

const creamCell = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '1rem',
  padding: '1.75rem 2.25rem',
  background: 'var(--color-bg-cream)',
  borderRadius: '0.75rem',
}

const darkCell = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '1rem',
  padding: '1.75rem 2.25rem',
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

// Light/cream surface, dark text — standard usage
export const OnCream = () => (
  <div style={creamCell}>
    <span style={sectionLabel}>On cream, dark text</span>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', color: 'var(--color-text, #121A0F)' }}>
      <TahiStudioWordmark height={22} />
      <TahiStudioWordmark height={32} />
      <TahiStudioWordmark height={44} />
    </div>
  </div>
)

// Dark surface, near-white — nav / letterhead on dark
export const OnDark = () => (
  <div style={darkCell}>
    <span style={sectionLabelDark}>On dark forest, near-white</span>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', color: 'var(--color-text-on-dark, #f3f7f2)' }}>
      <TahiStudioWordmark height={22} />
      <TahiStudioWordmark height={32} />
      <TahiStudioWordmark height={44} />
    </div>
  </div>
)

// Brand muted surface — subtle colouring in proposals, contracts header
export const OnBrandSurface = () => (
  <div style={{ ...creamCell, background: 'var(--color-brand-50, #f0f7ee)' }}>
    <span style={sectionLabel}>On brand-50 surface</span>
    <div style={{ color: 'var(--color-brand-dark, #425F39)' }}>
      <TahiStudioWordmark height={36} title="Tahi Studio on brand tint" />
    </div>
  </div>
)
