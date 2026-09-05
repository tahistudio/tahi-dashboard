'use client'

/**
 * The server-page footer under the clients table.
 *
 * The shared <Pagination> primitive needs a total row count to work out how
 * many pages there are, and GET /api/admin/clients does not return one: it
 * pages at 50 and says nothing about what is behind that. So this bar states
 * only what is true, which is the page you are on, how many rows came back,
 * and whether a full page arrived (the one honest signal that there is more).
 *
 * Replace this with the shared primitive the day the endpoint returns a count.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react'

export function ClientsPageBar({
  page,
  shown,
  pageSize,
  hasNext,
  scopeNote,
  onPageChange,
}: {
  page: number
  /** Rows on screen after the rail has had its say. */
  shown: number
  pageSize: number
  /** True when the API returned a full page, so there is probably another. */
  hasNext: boolean
  /** What the narrowing on screen actually covers, when it is not the whole
   *  roster. Status and plan are pushed to the server; health, tag and tracks
   *  can only ever narrow the page that came back. */
  scopeNote?: string | null
  onPageChange: (next: number) => void
}) {
  const canPrev = page > 1
  if (!canPrev && !hasNext) {
    return (
      <p style={{ margin: 0, fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
        {shown} {shown === 1 ? 'client' : 'clients'} in this view.
        {scopeNote ? ` ${scopeNote}` : ''}
      </p>
    )
  }

  return (
    <div
      className="flex flex-col sm:flex-row sm:items-center"
      style={{
        gap: '0.75rem',
        padding: '0.625rem 0.875rem',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-bg-secondary)',
      }}
    >
      <p style={{ margin: 0, flex: 1, fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>
        Page <span style={{ fontWeight: 700, color: 'var(--color-text)' }}>{page}</span>
        {', '}
        <span style={{ fontWeight: 700, color: 'var(--color-text)' }}>{shown}</span>
        {' '}{shown === 1 ? 'client' : 'clients'} in this view. The list loads {pageSize} at a time.
        {scopeNote ? ` ${scopeNote}` : ''}
      </p>
      <div className="flex items-center" style={{ gap: '0.375rem' }}>
        <PageButton
          label="Previous page"
          disabled={!canPrev}
          onClick={() => onPageChange(page - 1)}
          icon={<ChevronLeft size={15} aria-hidden="true" />}
        />
        <PageButton
          label="Next page"
          disabled={!hasNext}
          onClick={() => onPageChange(page + 1)}
          icon={<ChevronRight size={15} aria-hidden="true" />}
        />
      </div>
    </div>
  )
}

function PageButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="tahi-focus-ring inline-flex items-center justify-center h-11 w-11 md:h-8 md:w-8"
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-bg)',
        color: disabled ? 'var(--color-text-subtle)' : 'var(--color-text-muted)',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'border-color var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out)',
      }}
      onMouseEnter={e => {
        if (disabled) return
        e.currentTarget.style.borderColor = 'var(--color-brand)'
        e.currentTarget.style.color = 'var(--color-brand-dark)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.color = disabled ? 'var(--color-text-subtle)' : 'var(--color-text-muted)'
      }}
    >
      {icon}
    </button>
  )
}
