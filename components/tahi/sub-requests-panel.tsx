'use client'

/**
 * <SubRequestsPanel> — the "this parent has N sub-requests" block rendered
 * inside a request's detail page. Lives in the main content column, right
 * below the Description card.
 *
 * Shows :
 *   - Header : "SUB-REQUESTS  N of M done"
 *   - Each child as a single row : status dot + title (link) + assignee avatar + size badge + status badge
 *   - "+ New sub-request" inline quick-add form
 *
 * Only renders when `subRequests.length > 0` OR when caller explicitly
 * passes `alwaysShow` (useful during initial wiring of a parent).
 */

import React from 'react'
import Link from 'next/link'
import { Layers, Plus } from 'lucide-react'
import { Card } from '@/components/tahi/card'
import { Badge, statusTone } from '@/components/tahi/badge'
import { TahiButton } from '@/components/tahi/tahi-button'
import { getInitials } from '@/lib/utils'

export interface SubRequestRow {
  id: string
  title: string
  status: string
  size: 'small' | 'large' | string | null
  assigneeId: string | null
  assigneeName: string | null
  dueDate: string | null
  requestNumber: number | null
  subPosition: number | null
}

interface SubRequestsPanelProps {
  parentRequestId: string
  subRequests: SubRequestRow[]
  /** Render the panel even with zero children (so users see the "+ New" affordance). */
  alwaysShow?: boolean
  /** Called after a new sub-request is created so the parent detail page can reload. */
  onCreated?: () => void
  /** Whether the current user can create sub-requests. Defaults to true. */
  canCreate?: boolean
  /** Raised when the user clicks the "New sub-request" button. The detail
   *  page listens for this and opens the full <NewRequestDialog> with
   *  parentRequestId pre-filled, so sub-request creation has the same
   *  rich form as top-level creation. */
  onRequestNew?: () => void
  /** Copy shown in place of the list when there are no children yet. Opt-in
   *  so panels that already read fine as a bare header keep doing so. */
  emptyMessage?: string
}

function Initials({ name }: { name: string | null }) {
  if (!name) return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '1.5rem',
        height: '1.5rem',
        borderRadius: '9999px',
        background: 'var(--color-bg-tertiary)',
        color: 'var(--color-text-subtle)',
        fontSize: '0.625rem',
      }}
    >—</span>
  )
  const initials = getInitials(name)
  return (
    <span
      aria-label={name}
      title={name}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '1.5rem',
        height: '1.5rem',
        borderRadius: '9999px',
        background: 'var(--color-brand-50)',
        color: 'var(--color-brand)',
        fontSize: '0.625rem',
        fontWeight: 600,
      }}
    >{initials}</span>
  )
}

export function SubRequestsPanel({
  subRequests,
  alwaysShow = false,
  canCreate = true,
  onRequestNew,
  emptyMessage,
}: SubRequestsPanelProps) {
  const doneCount = subRequests.filter(s => s.status === 'delivered').length
  const total = subRequests.length

  if (total === 0 && !alwaysShow && !canCreate) return null

  return (
    <Card padding="none">
      {/* The prototype's `.req-block-head`: an icon slot, a 13.5px/700 title in
          full text colour, the count beside it, and the action hard right. The
          "N of M done" line stays, because a parent's progress is the reason
          this block exists. */}
      <div
        className="flex items-center"
        style={{
          padding: '0.8125rem 1rem',
          borderBottom: '1px solid var(--color-border-subtle)',
          gap: '0.5625rem',
        }}
      >
        <span
          aria-hidden="true"
          className="inline-flex flex-shrink-0"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <Layers size={16} />
        </span>
        <h3
          style={{
            fontSize: '0.84375rem',
            fontWeight: 700,
            color: 'var(--color-text)',
            margin: 0,
          }}
        >
          Sub-requests
        </h3>
        {total > 0 && (
          <span
            className="tabular-nums"
            style={{ fontSize: '0.71875rem', fontWeight: 600, color: 'var(--color-text-subtle)' }}
          >
            {doneCount}/{total} done
          </span>
        )}
        {canCreate && onRequestNew && (
          <span style={{ marginLeft: 'auto', display: 'inline-flex' }}>
            <TahiButton variant="secondary" size="sm" onClick={onRequestNew} iconLeft={<Plus size={13} />}>
              New sub-request
            </TahiButton>
          </span>
        )}
      </div>

      {/* Empty state — only when the caller asked for one. */}
      {total === 0 && emptyMessage && (
        <p
          style={{
            margin: 0,
            padding: '1.125rem 1rem',
            fontSize: '0.8125rem',
            fontWeight: 500,
            lineHeight: 1.55,
            color: 'var(--color-text-subtle)',
            textAlign: 'center',
          }}
        >
          {emptyMessage}
        </p>
      )}

      {/* List of children */}
      {total > 0 && (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: '0.9375rem 1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          {subRequests.map(sub => (
            <li
              key={sub.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.625rem',
                padding: '0.5625rem 0.6875rem',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-bg-secondary)',
                transition: 'border-color 140ms ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-brand)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border-subtle)' }}
            >
              {/* Status dot via Badge dot */}
              <Badge
                tone={statusTone(sub.status)}
                size="sm"
                variant="soft"
                dot
              >
                {sub.status.replace(/_/g, ' ')}
              </Badge>

              <Link
                href={`/requests/${sub.id}`}
                title={sub.title}
                className="tahi-focus-ring flex items-center min-h-11 md:min-h-0"
                style={{
                  flex: 1,
                  minWidth: 0,
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.8125rem',
                  fontWeight: 500,
                  color: 'var(--color-text)',
                  textDecoration: 'none',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  transition: 'color 140ms ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-link)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text)' }}
              >
                {sub.requestNumber && (
                  <span
                    className="tabular-nums flex-shrink-0"
                    style={{ color: 'var(--color-text-subtle)', marginRight: '0.5rem', fontWeight: 600 }}
                  >
                    #{String(sub.requestNumber).padStart(3, '0')}
                  </span>
                )}
                <span className="truncate">{sub.title}</span>
              </Link>

              {sub.size && (
                <Badge tone="neutral" size="sm">
                  {String(sub.size).toUpperCase().slice(0, 1)}
                </Badge>
              )}

              <Initials name={sub.assigneeName} />
            </li>
          ))}
        </ul>
      )}

    </Card>
  )
}
