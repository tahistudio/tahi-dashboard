'use client'

/**
 * The client Requests tab: every request this client owns, as a list or the
 * shipped board, with the client's own kanban columns when they have them.
 *
 * Delivered work is hidden by default and counted on the toggle, so the tab
 * opens on what is live without pretending the finished work is gone.
 */

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Columns as ColumnsIcon, FileText, List as ListIcon, Plus } from 'lucide-react'
import { Badge } from '@/components/tahi/badge'
import { EmptyState } from '@/components/tahi/empty-state'
import { NewRequestDialog } from '@/components/tahi/new-request-dialog'
import { RequestCard } from '@/components/tahi/request-card'
import { SegmentedControl } from '@/components/tahi/segmented-control'
import { SkeletonList } from '@/components/tahi/skeletons'
import { TahiButton } from '@/components/tahi/tahi-button'
import type { BoardColumn, BoardItem, BoardPriority } from '@/components/tahi/board-view'
import { formatDate } from '@/lib/utils'
import { CountText, Grow, SubBar } from '../_kit/chrome'

const BoardView = dynamic(
  () => import('@/components/tahi/board-view').then(m => ({ default: m.BoardView })),
  {
    ssr: false,
    loading: () => (
      <div
        className="animate-pulse"
        style={{
          minHeight: '20rem',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--color-bg-secondary)',
        }}
      />
    ),
  }
)

export interface ClientRequestRow {
  id: string
  title: string
  status: string
  type: string
  priority: string
  dueDate?: string | null
  requestNumber?: number | null
  updatedAt: string
  createdAt: string
  /** Set on a sub-request. Only top-level rows belong on a board or a list. */
  parentRequestId?: string | null
}

export const REQUESTS_BOARD_COLUMNS: BoardColumn[] = [
  { id: 'submitted',     label: 'Submitted',     statusValue: 'submitted',     color: 'var(--status-submitted-dot)' },
  { id: 'in_review',     label: 'In review',     statusValue: 'in_review',     color: 'var(--status-in-review-dot)' },
  { id: 'in_progress',   label: 'In progress',   statusValue: 'in_progress',   color: 'var(--status-in-progress-dot)' },
  { id: 'client_review', label: 'Client review', statusValue: 'client_review', color: 'var(--status-client-review-dot)' },
  { id: 'on_hold',       label: 'On hold',       statusValue: 'on_hold',       color: 'var(--status-on-hold-dot)' },
  { id: 'delivered',     label: 'Delivered',     statusValue: 'delivered',     color: 'var(--status-delivered-dot)' },
  { id: 'cancelled',     label: 'Cancelled',     statusValue: 'cancelled',     color: 'var(--color-border-strong)' },
]

const DONE_STATUSES = ['delivered', 'completed', 'cancelled', 'archived']

const VIEW_OPTIONS = [
  { value: 'list' as const, label: 'List', icon: <ListIcon className="w-3.5 h-3.5" /> },
  { value: 'board' as const, label: 'Board', icon: <ColumnsIcon className="w-3.5 h-3.5" /> },
]

export function priorityToBoardPriority(p: string): BoardPriority | undefined {
  const v = p.toLowerCase()
  if (v === 'low' || v === 'medium' || v === 'high' || v === 'urgent') return v
  return undefined
}

export function requestsToBoardItems(requests: ClientRequestRow[]): BoardItem[] {
  return requests.map<BoardItem>(r => ({
    id: r.id,
    title: r.title,
    status: r.status,
    priority: priorityToBoardPriority(r.priority),
    tags: r.type ? [{ id: `type:${r.type}`, label: r.type }] : [],
    dueDate: r.dueDate ? formatDate(r.dueDate) : undefined,
  }))
}

export function RequestsTab({
  clientId,
  orgName,
  writeDisabled,
}: {
  clientId: string
  orgName: string
  writeDisabled: boolean
}) {
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [view, setView] = useState<'list' | 'board'>('list')
  const [showDone, setShowDone] = useState(false)

  const { data, isLoading: loading, mutate: load } = useSWR<{ requests: ClientRequestRow[] }>(
    `/api/admin/requests?clientId=${clientId}&status=all`,
  )
  // ?status=all returns sub-requests next to their parents. The shipped
  // /requests kit filters them out before it builds either view, and this tab
  // has to match, or a parent and each of its children read as separate
  // top-level cards.
  const requests = useMemo(
    () => (data?.requests ?? []).filter(r => !r.parentRequestId),
    [data],
  )

  // This client's own board columns when settings gave them any; the studio
  // default otherwise. Same route and same fallback the /requests board uses.
  const { data: kanbanData } = useSWR<{
    columns: Array<{ statusValue: string; colour: string | null; label: string; position: number }>
    /** The route sets this when it fell back to the studio-wide set. */
    inherited?: boolean
  }>(`/api/admin/kanban-columns?orgId=${clientId}`)

  // Inherited columns are the studio default, not this client's own board. The
  // route says which it handed back, so the badge only claims a bespoke board
  // when there really is one.
  const custom = kanbanData ? kanbanData.inherited === false && kanbanData.columns.length > 0 : false
  const columns = useMemo<BoardColumn[]>(() => {
    const cols = kanbanData?.columns
    if (cols && cols.length > 0) {
      return [...cols]
        .sort((a, b) => a.position - b.position)
        .map(c => ({
          id: c.statusValue,
          label: c.label,
          statusValue: c.statusValue,
          color: c.colour ?? `var(--status-${c.statusValue.replace(/_/g, '-')}-dot)`,
        }))
    }
    return REQUESTS_BOARD_COLUMNS
  }, [kanbanData])

  const doneCount = requests.filter(r => DONE_STATUSES.includes(r.status)).length
  const visible = showDone ? requests : requests.filter(r => !DONE_STATUSES.includes(r.status))

  return (
    <>
      <NewRequestDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); void load() }}
        isAdmin
        defaultOrgId={clientId}
      />

      <div className="flex flex-col" style={{ gap: '0.75rem' }}>
        <SubBar>
          <SegmentedControl
            role="tablist"
            ariaLabel="Requests view"
            value={view}
            onChange={setView}
            options={VIEW_OPTIONS}
            size="sm"
          />
          <CountText>{visible.length} {visible.length === 1 ? 'request' : 'requests'}</CountText>
          {custom && view === 'board' && (
            <Badge tone="brand" size="sm">{orgName} columns</Badge>
          )}
          <Grow />
          <label
            className="tahi-focus-ring flex items-center"
            style={{
              gap: '0.4375rem',
              minHeight: '2.75rem',
              padding: '0 0.5rem',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.75rem',
              fontWeight: 600,
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={showDone}
              onChange={e => setShowDone(e.target.checked)}
              style={{ accentColor: 'var(--color-brand)', width: '0.875rem', height: '0.875rem' }}
            />
            Show delivered{doneCount > 0 ? ` (${doneCount})` : ''}
          </label>
          <TahiButton
            variant="primary"
            size="sm"
            onClick={() => setDialogOpen(true)}
            disabled={writeDisabled}
            iconLeft={<Plus className="w-3.5 h-3.5" />}
          >
            New request
          </TahiButton>
        </SubBar>

        {loading ? (
          <SkeletonList rows={4} />
        ) : visible.length === 0 ? (
          <EmptyState
            variant="inline"
            icon={<FileText className="w-8 h-8" />}
            title={requests.length === 0 ? `No requests for ${orgName} yet` : 'Nothing live right now'}
            description={requests.length === 0
              ? 'Everything this client asks for lands here first.'
              : `All ${doneCount} of their requests are delivered. Tick Show delivered to see them.`}
            ctaLabel={writeDisabled ? undefined : 'New request'}
            onCtaClick={writeDisabled ? undefined : () => setDialogOpen(true)}
          />
        ) : view === 'board' ? (
          <BoardView
            columns={columns}
            items={requestsToBoardItems(visible)}
            views={['kanban']}
            defaultView="kanban"
            searchPlaceholder="Search requests"
            newLabel="New request"
            onNew={() => setDialogOpen(true)}
            onItemClick={item => router.push(`/requests/${item.id}`)}
            readOnly
          />
        ) : (
          <div className="flex flex-col" style={{ gap: '0.5rem' }}>
            {visible.map(req => (
              <RequestCard
                key={req.id}
                id={req.id}
                title={req.title}
                status={req.status}
                type={req.type}
                priority={req.priority}
                updatedAt={req.updatedAt}
                createdAt={req.createdAt}
              />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
