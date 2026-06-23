import { AnimatedSparkles } from 'tahi-dashboard'

const tile: React.CSSProperties = {
  width: '2.5rem',
  height: '2.5rem',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--color-brand-50)',
  color: 'var(--color-brand-dark)',
  borderRadius: 'var(--radius-leaf-sm)',
  flexShrink: 0,
}

const label: React.CSSProperties = {
  fontSize: '0.75rem',
  color: 'var(--color-text-muted)',
  marginTop: '0.375rem',
  textAlign: 'center' as const,
  fontFamily: 'Manrope, sans-serif',
}

export const IconTile = () => (
  <div style={{ display: 'flex', gap: '1.5rem', padding: '1.5rem', alignItems: 'flex-start', background: 'var(--color-bg-secondary)', borderRadius: '0.75rem' }}>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={tile}>
        <AnimatedSparkles size={20} />
      </div>
      <span style={label}>default</span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ ...tile, width: '3rem', height: '3rem', background: '#eff6ff', color: '#60a5fa' }}>
        <AnimatedSparkles size={28} color="#60a5fa" />
      </div>
      <span style={label}>AI blue</span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ ...tile, width: '3.5rem', height: '3.5rem' }}>
        <AnimatedSparkles size={32} />
      </div>
      <span style={label}>lg · 32px</span>
    </div>
  </div>
)

export const AIFeatureBadge = () => (
  <div style={{ padding: '1.25rem', background: 'var(--color-bg)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
    <button style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
      padding: '0.5rem 1rem', borderRadius: 'var(--radius-leaf-sm)',
      background: 'var(--color-brand)', border: 'none',
      color: '#fff', fontSize: '0.875rem', fontFamily: 'Manrope, sans-serif',
      cursor: 'pointer', alignSelf: 'flex-start',
    }}>
      <AnimatedSparkles size={16} color="#fff" />
      AI Wizard
    </button>
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
      padding: '0.3rem 0.625rem', borderRadius: '999px',
      background: '#eff6ff', border: '1px solid #bfdbfe',
      color: '#3b82f6', fontSize: '0.75rem', fontFamily: 'Manrope, sans-serif',
      alignSelf: 'flex-start',
    }}>
      <AnimatedSparkles size={12} color="#3b82f6" />
      AI-powered
    </div>
  </div>
)
