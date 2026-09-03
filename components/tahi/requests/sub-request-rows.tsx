'use client'

/**
 * <SubRequestRows>. The children of an expanded request row in the Requests
 * list.
 *
 * Two shapes, one fetch:
 *
 *   variant="rows"  (default) real <tr> children rendered into the parent
 *                   table's own <tbody> through <DataTable expandedRowMode
 *                   ="rows">. The browser's column algorithm then puts a
 *                   child's status, assignee and Done word directly under
 *                   Status, Priority and Due, at every width, with no width
 *                   constants duplicated from the parent table.
 *   variant="cards" the dot list inside a mobile card, where there are no
 *                   columns to line up with.
 *
 * Fetching is lazy by construction. The component only mounts when its row is
 * actually open, so the request goes out on first expand; SWR then keeps the
 * response cached, so collapsing, re-expanding, or crossing the md breakpoint
 * into the other variant costs nothing.
 *
 * Audience:
 *   'team'   hits the admin route, shows the assignee, and offers an
 *            "Add sub-request" row.
 *   'client' hits the org-scoped portal route, which omits assigneeId by
 *            design, so no assignee column and no add affordance.
 */

import * as React from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { Loader2, Plus } from 'lucide-react'
import { Avatar } from '@/components/tahi/avatar'
import { Badge } from '@/components/tahi/badge'
import type { DataTableExpandedContext } from '@/components/tahi/data-table'
import {
  REQUEST_STATUS_CONFIG,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_TONE,
} from '@/lib/status-config'

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
  /** Table shape, from <DataTable>'s renderExpanded. Required for `rows`. */
  table?: DataTableExpandedContext
  variant?: 'rows' | 'cards'
  /** Opens the new-request dialog with this parent preset. Team only. */
  onAddSubRequest?: () => void
}

/** The parent row's chevron is 1.5rem wide with a 0.375rem gap after it.
 *  Indenting by the same amount puts a child's number directly under its
 *  parent's number. */
const CHEVRON_GUTTER = '1.875rem'

/**
 * Which of the parent's columns each piece of a child lands in. A child has
 * less to say than its parent, so it borrows the columns whose meaning is
 * closest: the assignee under Priority, and the Done word under Due. Any
 * column not named here gets an empty cell, which is what keeps Client and
 * Updated blank on a child row.
 */
const CHILD_SLOT: Record<string, 'title' | 'status' | 'assignee' | 'done'> = {
  title: 'title',
  status: 'status',
  priority: 'assignee',
  dueDate: 'done',
}

const GROUP_BG = 'var(--color-bg-secondary)'
const GROUP_HOVER = 'var(--color-bg-tertiary)'
const HAIRLINE = '1px solid var(--color-border-subtle)'

function firstName(name: string | null | undefined): string {
  if (!name) return ''
  return name.trim().split(/\s+/)[0] ?? ''
}

/** Cell padding matching the parent table's comfortable density. */
const CELL_PAD = '0.5rem 1rem'

function LoadingLine() {
  return (
    <>
      <Loader2 size={13} className="animate-spin" aria-hidden="true" style={{ color: 'var(--color-brand)' }} />
      Loading sub-requests
    </>
  )
}

// ── Rows variant ────────────────────────────────────────────────────────────

/** A run of cells that spans the whole table, for loading / error / empty. */
function MessageRow({
  table,
  children,
}: {
  table: DataTableExpandedContext
  children: React.ReactNode
}) {
  return (
    <tr style={{ background: GROUP_BG, animation: 'tahi-row-expand 180ms ease-out' }}>
      <td
        colSpan={table.colSpan}
        style={{
          padding: '0.75rem 1rem',
          borderLeft: HAIRLINE,
          borderRight: HAIRLINE,
          borderBottom: HAIRLINE,
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-subtle)',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>{children}</span>
      </td>
    </tr>
  )
}

/**
 * One child as a real table row. The group draws a hairline down both sides
 * and along the bottom; its top edge is the parent row's own rule, which is
 * still painted underneath it, so the run reads as one closed box.
 */
function ChildRow({
  sub,
  table,
  audience,
}: {
  sub: SubRequestListRow
  table: DataTableExpandedContext
  audience: 'team' | 'client'
}) {
  const [hover, setHover] = React.useState(false)
  const done = sub.status === 'delivered'
  const lastCell = table.leadingCells + table.columnKeys.length + table.trailingCells - 1

  const cells: React.ReactNode[] = []
  for (let i = 0; i < table.leadingCells; i++) {
    cells.push(<CellShell key={`lead-${i}`} index={cells.length} lastIndex={lastCell} />)
  }
  for (const key of table.columnKeys) {
    const slot = CHILD_SLOT[key]
    cells.push(
      <CellShell key={key} index={cells.length} lastIndex={lastCell}>
        {slot === 'title' ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0, paddingLeft: CHEVRON_GUTTER }}>
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
        ) : slot === 'status' ? (
          <Badge tone={REQUEST_STATUS_TONE[sub.status] ?? 'neutral'} variant="soft" size="sm" leader="dot">
            {REQUEST_STATUS_LABELS[sub.status] ?? sub.status.replace(/_/g, ' ')}
          </Badge>
        ) : slot === 'assignee' && audience === 'team' ? (
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
        ) : slot === 'done' ? (
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              color: done ? 'var(--status-delivered-text)' : 'var(--color-text-subtle)',
            }}
          >
            {done ? 'Done' : 'Open'}
          </span>
        ) : null}
      </CellShell>,
    )
  }
  for (let i = 0; i < table.trailingCells; i++) {
    cells.push(<CellShell key={`trail-${i}`} index={cells.length} lastIndex={lastCell} />)
  }

  return (
    <tr
      style={{
        background: hover ? GROUP_HOVER : GROUP_BG,
        transition: 'background-color 120ms ease',
        animation: 'tahi-row-expand 180ms ease-out',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {cells}
    </tr>
  )
}

/** One cell of a child row, carrying its share of the group's outline. The
 *  bottom rule doubles as the separator between children and as the group's
 *  closing edge, so every cell paints one. */
function CellShell({
  index,
  lastIndex,
  children,
}: {
  index: number
  lastIndex: number
  children?: React.ReactNode
}) {
  return (
    <td
      style={{
        padding: CELL_PAD,
        verticalAlign: 'middle',
        whiteSpace: 'nowrap',
        borderLeft: index === 0 ? HAIRLINE : undefined,
        borderRight: index === lastIndex ? HAIRLINE : undefined,
        borderBottom: HAIRLINE,
      }}
    >
      {children ?? null}
    </td>
  )
}

/** The team-only "Add sub-request" line, closing the group. */
function AddRow({
  table,
  onAdd,
}: {
  table: DataTableExpandedContext
  onAdd: () => void
}) {
  return (
    <tr style={{ background: GROUP_BG, animation: 'tahi-row-expand 180ms ease-out' }}>
      <td
        colSpan={table.colSpan}
        style={{ padding: 0, borderLeft: HAIRLINE, borderRight: HAIRLINE, borderBottom: HAIRLINE }}
      >
        <button
          type="button"
          className="tahi-focus-ring"
          onClick={e => { e.stopPropagation(); onAdd() }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
            width: '100%',
            minHeight: '2.75rem',
            padding: `0.5rem 1rem 0.5rem calc(1rem + ${CHEVRON_GUTTER})`,
            border: 'none',
            background: 'transparent',
            fontSize: '0.75rem',
            fontWeight: 600,
            color: 'var(--color-text-subtle)',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'background-color 150ms ease, color 150ms ease',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = GROUP_HOVER
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
      </td>
    </tr>
  )
}

// ── Cards variant ───────────────────────────────────────────────────────────

function CardMessage({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-subtle)',
      }}
    >
      {children}
    </span>
  )
}

function SubRequestDots({
  subRequests,
  isLoading,
  error,
}: {
  subRequests: SubRequestListRow[]
  isLoading: boolean
  error: unknown
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.375rem',
        marginTop: '0.125rem',
        paddingTop: '0.5625rem',
        borderTop: HAIRLINE,
        animation: 'tahi-row-expand 180ms ease-out',
      }}
    >
      {isLoading ? (
        <CardMessage><LoadingLine /></CardMessage>
      ) : error ? (
        <CardMessage>Could not load sub-requests.</CardMessage>
      ) : subRequests.length === 0 ? (
        <CardMessage>No sub-requests yet.</CardMessage>
      ) : (
        subRequests.map(sub => (
          <span key={sub.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
            <span
              aria-hidden="true"
              style={{
                width: '0.4375rem',
                height: '0.4375rem',
                flex: 'none',
                borderRadius: 'var(--radius-full)',
                background: REQUEST_STATUS_CONFIG[sub.status]?.dot ?? 'var(--color-text-subtle)',
              }}
            />
            <span
              data-private
              style={{
                fontSize: '0.78125rem',
                fontWeight: 500,
                color: 'var(--color-text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {sub.title}
            </span>
          </span>
        ))
      )}
    </div>
  )
}

// ── Component ───────────────────────────────────────────────────────────────

export function SubRequestRows({
  parentId,
  audience,
  table,
  variant = 'rows',
  onAddSubRequest,
}: SubRequestRowsProps) {
  const isTeam = audience === 'team'
  const endpoint = isTeam
    ? `/api/admin/requests/${parentId}/sub-requests`
    : `/api/portal/requests/${parentId}/sub-requests`

  const { data, error, isLoading } = useSWR<{ subRequests?: SubRequestListRow[] }>(endpoint)
  const subRequests = React.useMemo(() => data?.subRequests ?? [], [data])

  if (variant === 'cards') {
    return <SubRequestDots subRequests={subRequests} isLoading={isLoading} error={error} />
  }

  // Rows mode without a table shape would emit cells with nothing to line up
  // against, so it renders nothing rather than a broken row.
  if (!table) return null

  const showAdd = isTeam && !!onAddSubRequest

  if (isLoading || error || subRequests.length === 0) {
    return (
      <>
        <MessageRow table={table}>
          {isLoading ? <LoadingLine /> : error ? 'Could not load sub-requests.' : 'No sub-requests yet.'}
        </MessageRow>
        {showAdd && onAddSubRequest && <AddRow table={table} onAdd={onAddSubRequest} />}
      </>
    )
  }

  return (
    <>
      {subRequests.map(sub => (
        <ChildRow key={sub.id} sub={sub} table={table} audience={audience} />
      ))}
      {showAdd && onAddSubRequest && <AddRow table={table} onAdd={onAddSubRequest} />}
    </>
  )
}
