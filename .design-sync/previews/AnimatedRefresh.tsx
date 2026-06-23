import { AnimatedRefresh } from 'tahi-dashboard'

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
        <AnimatedRefresh size={20} />
      </div>
      <span style={label}>sm · 20px</span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ ...tile, width: '3rem', height: '3rem' }}>
        <AnimatedRefresh size={28} />
      </div>
      <span style={label}>md · 28px</span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ ...tile, width: '3.5rem', height: '3.5rem' }}>
        <AnimatedRefresh size={32} />
      </div>
      <span style={label}>lg · 32px</span>
    </div>
  </div>
)

export const SyncButton = () => (
  <div style={{ padding: '1.25rem', background: 'var(--color-bg)', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
    <button style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
      padding: '0.5rem 0.875rem', borderRadius: '0.5rem',
      background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)',
      color: 'var(--color-text)', fontSize: '0.875rem', fontFamily: 'Manrope, sans-serif',
      cursor: 'pointer',
    }}>
      <AnimatedRefresh size={15} color="var(--color-brand)" />
      Sync now
    </button>
    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontFamily: 'Manrope, sans-serif' }}>
      Last synced 3 min ago
    </span>
  </div>
)
