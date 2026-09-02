'use client'

/**
 * <SubRequestRows> — the body of an expanded request row in the Requests
 * list. Renders one line per child of the parent request, laid out to echo
 * the parent table's columns: number and title on the left, then status,
 * assignee, and a Done / Open word on the right.
 *
 * Fetching is lazy by construction. The component only mounts when its row
 * is actually open, so the request goes out on first expand; SWR then keeps
 * the response cached, so collapsing and re-expanding costs nothing.
 *
 * Audience:
 *   'team'   → hits the admin route, shows the assignee, and offers an
 *              "Add sub-request" row.
 *   'client' → hits the org-scoped portal route, which omits assigneeId by
 *              design, so no assignee column and no add affordance.
 */

import useSWR from 'swr'
import Link from 'next/link'
import { Loader2, Plus } from 'lucide-react'
import { Avatar } from '@/components/tahi/avatar'
import { Badge } from '@/components/tahi/badge'
import { REQUEST_STATUS_LABELS, REQUEST_STATUS_TONE } from '@/lib/status-config'

export interface SubRequestListRow {
  id: string
  title: string
  status: string
  requestNumber: number | null
  assigneeId?: string | null
  assigneeName?: string | null
}

interface SubRequestRowsProps {
  /** The parent request whose children this panel lists. */
  parentId: string
  audience: 'team' | 'client'
  /** Opens the new-request dialog with this parent preset. Team only. */
  onAddSubRequest?: () => void
}

/** Grid template shared by every line in the panel, so the columns line up
 *  with each other regardless of how many children came back. */
const TEAM_COLUMNS = 'minmax(0, 1fr) 9rem 10rem 4rem'
const CLIENT_COLUMNS = 'minmax(0, 1fr) 9rem 4rem'

/** The parent row's chevron is 1.5rem wide with a 0.375rem gap after it.
 *  Indenting by the same amount puts a child's number directly under its
 *  parent's number. */
const CHEVRON_GUTTER = '1.875rem'

function firstName(name: string | null | undefined): string {
  if (!name) return ''
  return name.trim().split(/\s+/)[0] ?? ''
}

function PanelMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '0.75rem 1rem',
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-subtle)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
      }}
    >
      {children}
    </div>
  )
}

export function SubRequestRows({ parentId, audience, onAddSubRequest }: SubRequestRowsProps) {
  const isTeam = audience === 'team'
  const endpoint = isTeam
    ? `/api/admin/requests/${parentId}/sub-requests`
    : `/api/portal/requests/${parentId}/sub-requests`

  const { data, error, isLoading } = useSWR<{ subRequests?: SubRequestListRow[] }>(endpoint)
  const subRequests = data?.subRequests ?? []
  const columns = isTeam ? TEAM_COLUMNS : CLIENT_COLUMNS

  return (
    <div>
      {isLoading ? (
        <PanelMessage>
          <Loader2 size={13} className="animate-spin" aria-hidden="true" style={{ color: 'var(--color-brand)' }} />
          Loading sub-requests
        </PanelMessage>
      ) : error ? (
        <PanelMessage>Could not load sub-requests.</PanelMessage>
      ) : subRequests.length === 0 ? (
        <PanelMessage>No sub-requests yet.</PanelMessage>
      ) : (
        subRequests.map((sub, i) => {
          const done = sub.status === 'delivered'
          return (
            <div
              key={sub.id}
              style={{
                display: 'grid',
                gridTemplateColumns: columns,
                alignItems: 'center',
                gap: '0.875rem',
                padding: '0.5rem 1rem',
                minHeight: '2.5rem',
                borderBottom: i < subRequests.length - 1
                  ? '1px solid var(--color-border-subtle)'
                  : undefined,
              }}
            >
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  minWidth: 0,
                  paddingLeft: CHEVRON_GUTTER,
                }}
              >
                {sub.requestNumber != null && (
                  <span
                    data-private
                    className="font-mono"
                    style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', flexShrink: 0 }}
                  >
                    #{String(sub.requestNumber).padStart(3, '0')}
                  </span>
                )}
                <Link
                  data-private
                  href={`/requests/${sub.id}`}
                  className="tahi-focus-ring"
                  onClick={e => e.stopPropagation()}
                  style={{
                    fontSize: 'var(--text-sm)',
                    fontWeight: 500,
                    color: 'var(--color-text)',
                    textDecoration: 'none',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    borderRadius: 'var(--radius-sm)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-brand-dark)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text)' }}
                >
                  {sub.title}
                </Link>
              </span>

              <span>
                <Badge
                  tone={REQUEST_STATUS_TONE[sub.status] ?? 'neutral'}
                  variant="soft"
                  size="sm"
                  leader="dot"
                >
                  {REQUEST_STATUS_LABELS[sub.status] ?? sub.status.replace(/_/g, ' ')}
                </Badge>
              </span>

              {isTeam && (
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.375rem',
                    minWidth: 0,
                    fontSize: '0.78125rem',
                    fontWeight: 500,
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {sub.assigneeName ? (
                    <>
                      <Avatar name={sub.assigneeName} size="xs" />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {firstName(sub.assigneeName)}
                      </span>
                    </>
                  ) : (
                    <span style={{ color: 'var(--color-text-subtle)' }}>Unassigned</span>
                  )}
                </span>
              )}

              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: done ? 'var(--status-delivered-text)' : 'var(--color-text-subtle)',
                }}
              >
                {done ? 'Done' : 'Open'}
              </span>
            </div>
          )
        })
      )}

      {isTeam && onAddSubRequest && (
        <button
          type="button"
          className="tahi-focus-ring"
          onClick={e => { e.stopPropagation(); onAddSubRequest() }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
            width: '100%',
            minHeight: '2.75rem',
            padding: `0.5rem 1rem 0.5rem calc(1rem + ${CHEVRON_GUTTER})`,
            border: 'none',
            borderTop: subRequests.length > 0 ? '1px solid var(--color-border-subtle)' : undefined,
            background: 'transparent',
            fontSize: '0.75rem',
            fontWeight: 600,
            color: 'var(--color-text-subtle)',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'background-color 150ms ease, color 150ms ease',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--color-bg-tertiary)'
            e.currentTarget.style.color = 'var(--color-brand-dark)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--color-text-subtle)'
          }}
        >
          <Plus size={13} strokeWidth={2.4} aria-hidden="true" />
          Add sub-request
        </button>
      )}
    </div>
  )
}
