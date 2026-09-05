'use client'

/**
 * <HealthNoteCard>. The saved one-liner about why this client is where it is.
 * The Needs-you strip leads with the same note when the account is red, so
 * this is where that sentence is actually written down.
 *
 * Tinted from the --badge-* tokens, not --color-danger-bg / --color-warning-bg:
 * globals.css states those two fills are deliberately left out of `.dark`, so a
 * --color-text note body on them is unreadable on a dark canvas. The badge
 * tokens resolve for both themes.
 */

const TONE: Record<string, { bg: string; fg: string; border: string; label: string }> = {
  red: {
    bg: 'var(--badge-danger-bg)',
    fg: 'var(--badge-danger-text)',
    border: 'var(--badge-danger-border)',
    label: 'At risk',
  },
  amber: {
    bg: 'var(--badge-warning-bg)',
    fg: 'var(--badge-warning-text)',
    border: 'var(--badge-warning-border)',
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
