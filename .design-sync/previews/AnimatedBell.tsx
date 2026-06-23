import { AnimatedBell } from 'tahi-dashboard'

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
        <AnimatedBell size={20} />
      </div>
      <span style={label}>sm · 20px</span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ ...tile, width: '3rem', height: '3rem' }}>
        <AnimatedBell size={28} />
      </div>
      <span style={label}>md · 28px</span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ ...tile, width: '3.5rem', height: '3.5rem' }}>
        <AnimatedBell size={32} />
      </div>
      <span style={label}>lg · 32px</span>
    </div>
  </div>
)

export const NotificationBadge = () => (
  <div style={{ padding: '1.25rem', background: 'var(--color-bg)', display: 'flex', gap: '1rem', alignItems: 'center' }}>
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <div style={{ ...tile, width: '2.75rem', height: '2.75rem' }}>
        <AnimatedBell size={22} />
      </div>
      <span style={{
        position: 'absolute', top: '-0.25rem', right: '-0.25rem',
        background: '#f87171', color: '#fff', borderRadius: '999px',
        fontSize: '0.6rem', fontFamily: 'Manrope, sans-serif', fontWeight: 700,
        width: '1rem', height: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>3</span>
    </div>
    <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', fontFamily: 'Manrope, sans-serif' }}>
      3 unread notifications
    </div>
  </div>
)
