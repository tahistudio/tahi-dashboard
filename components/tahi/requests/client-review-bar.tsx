'use client'

/**
 * <ClientReviewBar>. The one place a client can move a request.
 *
 * Shown only while a request sits in client review and the viewer is a
 * client. Approve closes the request; Request changes hands it back to the
 * studio and drops the client into the composer with a seeded line so they
 * can say what needs adjusting.
 *
 * Both button labels stay on one line at every width; the action group wraps
 * as a block under the copy on narrow screens instead of stacking mid-label.
 */

import { Check, CheckCircle2, Loader2, RefreshCw } from 'lucide-react'

interface ClientReviewBarProps {
  onApprove: () => void
  onRequestChanges: () => void
  /** True while the approve call is in flight. */
  busy?: boolean
  /** Disables both actions, e.g. in read-only client view. */
  disabled?: boolean
}

export function ClientReviewBar({
  onApprove,
  onRequestChanges,
  busy = false,
  disabled = false,
}: ClientReviewBarProps) {
  const locked = busy || disabled

  return (
    <div
      role="region"
      aria-label="Review this delivery"
      style={{
        border: '1px solid var(--color-brand)',
        background: 'var(--color-brand-50)',
        borderRadius: 'var(--radius-leaf, 0 16px 0 16px)',
        padding: '1rem 1.125rem',
      }}
    >
      <div className="flex items-start flex-wrap" style={{ gap: '0.75rem' }}>
        <span
          className="flex items-center justify-center flex-shrink-0"
          aria-hidden="true"
          style={{
            width: '1.75rem',
            height: '1.75rem',
            borderRadius: '0 0.5rem 0 0.5rem',
            background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-dark))',
            // --color-text-on-dark resolves to the same value in both themes,
            // which is what ink on a brand fill needs, so the house rule
            // against hardcoded hex holds here too.
            color: 'var(--color-text-on-dark)',
          }}
        >
          <CheckCircle2 size={14} />
        </span>

        <div className="flex-1" style={{ minWidth: '12rem' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-brand-dark)', margin: 0 }}>
            Ready for your review
          </p>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', margin: '0.1875rem 0 0', lineHeight: 1.5 }}>
            Approve to close this request, or ask for a change and tell us what needs adjusting.
          </p>
        </div>

        <div className="flex items-center" style={{ gap: '0.5rem', flexWrap: 'nowrap' }}>
          <button
            type="button"
            onClick={onApprove}
            disabled={locked}
            className="tahi-focus-ring inline-flex items-center min-h-11 md:min-h-9"
            style={{
              gap: '0.375rem',
              padding: '0.4375rem 0.875rem',
              fontSize: '0.8125rem',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              borderRadius: 'var(--radius-button)',
              border: 'none',
              background: locked ? 'var(--color-bg-tertiary)' : 'var(--color-brand)',
              color: locked ? 'var(--color-text-subtle)' : 'var(--color-text-on-dark)',
              cursor: locked ? 'not-allowed' : 'pointer',
              transition: 'background-color 150ms ease',
            }}
            onMouseEnter={e => { if (!locked) e.currentTarget.style.background = 'var(--color-brand-dark)' }}
            onMouseLeave={e => { if (!locked) e.currentTarget.style.background = 'var(--color-brand)' }}
          >
            {busy
              ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              : <Check size={14} aria-hidden="true" />}
            {busy ? 'Approving…' : 'Approve'}
          </button>

          <button
            type="button"
            onClick={onRequestChanges}
            disabled={locked}
            className="tahi-focus-ring inline-flex items-center min-h-11 md:min-h-9"
            style={{
              gap: '0.375rem',
              padding: '0.4375rem 0.875rem',
              fontSize: '0.8125rem',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              borderRadius: 'var(--radius-button)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
              color: 'var(--color-text-muted)',
              cursor: locked ? 'not-allowed' : 'pointer',
              opacity: locked ? 0.6 : 1,
              transition: 'border-color 150ms ease, color 150ms ease',
            }}
            onMouseEnter={e => {
              if (locked) return
              e.currentTarget.style.borderColor = 'var(--color-brand)'
              e.currentTarget.style.color = 'var(--color-brand-dark)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--color-border)'
              e.currentTarget.style.color = 'var(--color-text-muted)'
            }}
          >
            <RefreshCw size={14} aria-hidden="true" />
            Request changes
          </button>
        </div>
      </div>
    </div>
  )
}
