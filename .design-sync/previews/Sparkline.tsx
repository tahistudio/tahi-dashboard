import { Sparkline } from 'tahi-dashboard'

const row = {
  display: 'flex',
  flexWrap: 'wrap' as const,
  gap: '1.5rem',
  padding: '1.25rem',
  background: 'var(--color-bg)',
  alignItems: 'center',
}

const metricCard = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '0.25rem',
  padding: '0.875rem 1rem',
  background: 'var(--color-bg-secondary)',
  borderRadius: 'var(--radius-md)',
  minWidth: '8rem',
}

export const KpiRow = () => (
  <div style={row}>
    <div style={metricCard}>
      <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>MRR</div>
      <div style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-text)' }}>$33.2k</div>
      <Sparkline data={[18.4, 19.2, 20.1, 21.5, 23.8, 24.6, 26.2, 25.4, 27.9, 29.1, 31.4, 33.2]} width={96} height={28} tone="positive" />
    </div>
    <div style={metricCard}>
      <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>Open requests</div>
      <div style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-text)' }}>24</div>
      <Sparkline data={[18, 22, 19, 25, 28, 24, 21, 26, 24]} width={96} height={28} tone="neutral" />
    </div>
    <div style={metricCard}>
      <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>Overdue</div>
      <div style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-text)' }}>3</div>
      <Sparkline data={[1, 2, 1, 3, 2, 4, 3, 2, 3]} width={96} height={28} tone="negative" />
    </div>
    <div style={metricCard}>
      <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>Hours logged</div>
      <div style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-text)' }}>148h</div>
      <Sparkline data={[112, 128, 136, 141, 148, 144, 152, 148]} width={96} height={28} tone="positive" />
    </div>
  </div>
)

export const ToneVariants = () => (
  <div style={{ display: 'flex', gap: '2rem', padding: '1.25rem', background: 'var(--color-bg)', alignItems: 'center' }}>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.375rem' }}>
      <Sparkline data={[4, 6, 5, 8, 9, 7, 11, 13]} width={80} height={32} tone="positive" />
      <span style={{ fontSize: '0.625rem', color: 'var(--color-text-subtle)' }}>positive</span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.375rem' }}>
      <Sparkline data={[13, 11, 9, 10, 8, 7, 6, 5]} width={80} height={32} tone="negative" />
      <span style={{ fontSize: '0.625rem', color: 'var(--color-text-subtle)' }}>negative</span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.375rem' }}>
      <Sparkline data={[7, 8, 6, 9, 8, 7, 9, 8]} width={80} height={32} tone="neutral" />
      <span style={{ fontSize: '0.625rem', color: 'var(--color-text-subtle)' }}>neutral</span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.375rem' }}>
      <Sparkline data={[4, 6, 5, 8, 9, 7, 11, 13]} width={80} height={32} tone="positive" area={false} />
      <span style={{ fontSize: '0.625rem', color: 'var(--color-text-subtle)' }}>no fill</span>
    </div>
  </div>
)

export const InlineTableRow = () => (
  <div style={{ padding: '1.25rem', background: 'var(--color-bg)', width: '36rem', maxWidth: '100%' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem', color: 'var(--color-text)' }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          <th style={{ textAlign: 'left', padding: '0.375rem 0.5rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>Client</th>
          <th style={{ textAlign: 'right', padding: '0.375rem 0.5rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>MRR</th>
          <th style={{ textAlign: 'right', padding: '0.375rem 0.5rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>Trend</th>
        </tr>
      </thead>
      <tbody>
        {[
          { name: 'Acme Corp', mrr: '$4,200', data: [3.2, 3.4, 3.8, 4.0, 4.2], tone: 'positive' as const },
          { name: 'Bright Labs', mrr: '$3,600', data: [4.2, 3.9, 3.7, 3.6, 3.6], tone: 'negative' as const },
          { name: 'Koru Digital', mrr: '$2,800', data: [2.5, 2.6, 2.7, 2.8, 2.8], tone: 'positive' as const },
          { name: 'Pounamu Media', mrr: '$1,950', data: [1.9, 1.9, 2.0, 1.95, 1.95], tone: 'neutral' as const },
        ].map(c => (
          <tr key={c.name} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
            <td style={{ padding: '0.5rem' }}>{c.name}</td>
            <td style={{ textAlign: 'right', padding: '0.5rem', fontWeight: 600 }}>{c.mrr}</td>
            <td style={{ textAlign: 'right', padding: '0.5rem' }}>
              <Sparkline data={c.data} width={60} height={22} tone={c.tone} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)
