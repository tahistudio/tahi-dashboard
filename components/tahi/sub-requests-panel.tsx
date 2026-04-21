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
import { Plus } from 'lucide-react'
import { Card } from '@/components/tahi/card'
import { Badge, statusTone } from '@/components/tahi/badge'
import { TahiButton } from '@/components/tahi/tahi-button'

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
  const initials = name
    .split(' ')
    .map(s => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
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
}: SubRequestsPanelProps) {
  const doneCount = subRequests.filter(s => s.status === 'delivered').length
  const total = subRequests.length

  if (total === 0 && !alwaysShow && !canCreate) return null

  return (
    <Card padding="none">
      <div
        style={{
          padding: 'var(--space-4) var(--space-5)',
          borderBottom: total > 0 ? '1px solid var(--color-border-subtle)' : undefined,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
        }}
      >
        <div>
          <h3
            style={{
              fontSize: 'var(--text-md)',
              fontWeight: 600,
              color: 'var(--color-text)',
              margin: 0,
            }}
          >
            Sub-requests
          </h3>
          {total > 0 && (
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 'var(--space-0-5) 0 0' }}>
              {doneCount} of {total} done
            </p>
          )}
        </div>
        {canCreate && onRequestNew && (
          <TahiButton variant="secondary" size="sm" onClick={onRequestNew} iconLeft={<Plus size={13} />}>
            New sub-request
          </TahiButton>
        )}
      </div>

      {/* List of children */}
      {total > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {subRequests.map((sub, i) => (
            <li
              key={sub.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-3) var(--space-5)',
                borderBottom: i < total - 1 ? '1px solid var(--color-border-subtle)' : undefined,
                transition: 'background 150ms ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
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
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 'var(--text-sm)',
                  fontWeight: 500,
                  color: 'var(--color-text)',
                  textDecoration: 'none',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-brand)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text)' }}
              >
                {sub.requestNumber && (
                  <span style={{ color: 'var(--color-text-subtle)', marginRight: 'var(--space-2)', fontWeight: 400 }}>
                    #{String(sub.requestNumber).padStart(3, '0')}
                  </span>
                )}
                {sub.title}
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
