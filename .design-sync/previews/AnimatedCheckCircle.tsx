import { AnimatedCheckCircle } from 'tahi-dashboard'

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
        <AnimatedCheckCircle size={20} />
      </div>
      <span style={label}>sm · 20px</span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ ...tile, width: '3rem', height: '3rem', background: '#f0fdf4', color: '#4ade80' }}>
        <AnimatedCheckCircle size={28} color="#4ade80" />
      </div>
      <span style={label}>success</span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ ...tile, width: '3.5rem', height: '3.5rem' }}>
        <AnimatedCheckCircle size={32} />
      </div>
      <span style={label}>lg · 32px</span>
    </div>
  </div>
)

export const StatusRow = () => (
  <div style={{ padding: '1.25rem', background: 'var(--color-bg)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
    {[
      { text: 'Contract sent', done: true },
      { text: 'Onboarding call booked', done: true },
      { text: 'First request submitted', done: false },
    ].map((item) => (
      <div key={item.text} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
        <AnimatedCheckCircle
          size={18}
          color={item.done ? '#4ade80' : 'var(--color-border)'}
        />
        <span style={{
          fontSize: '0.875rem', fontFamily: 'Manrope, sans-serif',
          color: item.done ? 'var(--color-text)' : 'var(--color-text-muted)',
        }}>
          {item.text}
        </span>
      </div>
    ))}
  </div>
)
