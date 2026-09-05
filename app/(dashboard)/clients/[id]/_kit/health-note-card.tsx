'use client'

/**
 * <HealthNoteCard>. The saved one-liner about why this client is where it is.
 * The Needs-you strip leads with the same note when the account is red, so
 * this is where that sentence is actually written down.
 *
 * Tinted from the semantic tokens rather than Tailwind's raw palette, so it
 * follows dark mode instead of staying pastel on a dark surface.
 */

const TONE: Record<string, { bg: string; fg: string; border: string; label: string }> = {
  red: {
    bg: 'var(--color-danger-bg)',
    fg: 'var(--color-danger)',
    border: 'var(--color-danger)',
    label: 'At risk',
  },
  amber: {
    bg: 'var(--color-warning-bg)',
    fg: 'var(--color-warning)',
    border: 'var(--color-warning)',
    label: 'Watch',
  },
  green: {
    bg: 'var(--color-brand-50)',
    fg: 'var(--color-brand-dark)',
    border: 'var(--color-brand-100)',
    label: 'Healthy',
  },
}

export function HealthNoteCard({ note, health }: { note: string; health: string | null }) {
  const tone = TONE[(health ?? '').toLowerCase()] ?? TONE.green

  return (
    <div
      style={{
        borderRadius: 'var(--radius-lg)',
        border: `1px solid ${tone.border}`,
        background: tone.bg,
        padding: '0.875rem',
      }}
    >
      <p style={{ margin: 0, fontSize: '0.8125rem', fontWeight: 600, color: tone.fg }}>
        Health note: {tone.label}
      </p>
      <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', lineHeight: 1.45, color: 'var(--color-text)' }}>
        {note}
      </p>
    </div>
  )
}
