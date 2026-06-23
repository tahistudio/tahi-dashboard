import { AnimatedTrash } from 'tahi-dashboard'

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
        <AnimatedTrash size={20} />
      </div>
      <span style={label}>default</span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ ...tile, width: '3rem', height: '3rem', background: '#fef2f2', color: '#f87171' }}>
        <AnimatedTrash size={28} color="#f87171" />
      </div>
      <span style={label}>danger</span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ ...tile, width: '3.5rem', height: '3.5rem' }}>
        <AnimatedTrash size={32} />
      </div>
      <span style={label}>lg · 32px</span>
    </div>
  </div>
)

export const DeleteAction = () => (
  <div style={{ padding: '1.25rem', background: 'var(--color-bg)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0.75rem 1rem', borderRadius: '0.5rem',
      background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)',
    }}>
      <div>
        <div style={{ fontSize: '0.875rem', color: 'var(--color-text)', fontFamily: 'Manrope, sans-serif', fontWeight: 600 }}>
          Homepage redesign
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontFamily: 'Manrope, sans-serif' }}>
          Acme Co · 3 files
        </div>
      </div>
      <button style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
        padding: '0.375rem 0.75rem', borderRadius: '0.375rem',
        background: '#fef2f2', border: '1px solid #fecaca',
        color: '#f87171', fontSize: '0.8rem', fontFamily: 'Manrope, sans-serif',
        cursor: 'pointer',
      }}>
        <AnimatedTrash size={13} color="#f87171" />
        Delete
      </button>
    </div>
  </div>
)
