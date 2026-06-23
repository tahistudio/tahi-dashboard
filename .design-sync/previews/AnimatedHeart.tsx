import { AnimatedHeart } from 'tahi-dashboard'

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
        <AnimatedHeart size={20} />
      </div>
      <span style={label}>default</span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ ...tile, width: '3rem', height: '3rem', background: '#fef2f2', color: '#f87171' }}>
        <AnimatedHeart size={28} color="#f87171" />
      </div>
      <span style={label}>rose tint</span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ ...tile, width: '3.5rem', height: '3.5rem' }}>
        <AnimatedHeart size={32} />
      </div>
      <span style={label}>lg · 32px</span>
    </div>
  </div>
)

export const FeedbackRow = () => (
  <div style={{ padding: '1.25rem', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: '0.875rem', fontFamily: 'Manrope, sans-serif', color: 'var(--color-text)', fontWeight: 600 }}>
        Tahi Studio review
      </div>
      <div style={{ fontSize: '0.75rem', fontFamily: 'Manrope, sans-serif', color: 'var(--color-text-muted)', marginTop: '0.125rem' }}>
        Acme Co marked your work as outstanding
      </div>
    </div>
    <button style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
      padding: '0.375rem 0.75rem', borderRadius: '999px',
      background: '#fef2f2', border: '1px solid #fecaca',
      color: '#f87171', fontSize: '0.8rem', fontFamily: 'Manrope, sans-serif',
      cursor: 'pointer',
    }}>
      <AnimatedHeart size={14} color="#f87171" />
      Liked
    </button>
  </div>
)
