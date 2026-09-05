'use client'

/** The client Requests tab: every request for this client as a list or a
 *  board, plus the new-request dialog pre-scoped to them. */

import { useState } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Columns as ColumnsIcon, FileText, List as ListIcon, Plus } from 'lucide-react'
import { EmptyState } from '@/components/tahi/empty-state'
import { NewRequestDialog } from '@/components/tahi/new-request-dialog'
import { RequestCard } from '@/components/tahi/request-card'
import { SkeletonList } from '@/components/tahi/skeletons'
import { TahiButton } from '@/components/tahi/tahi-button'
import { ViewToggle } from '@/components/tahi/view-toggle'
import type { BoardColumn, BoardItem, BoardPriority } from '@/components/tahi/board-view'
import { formatDate } from '@/lib/utils'
import type { Request } from '../_kit/types'

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

// ── Requests tab (full list) ───────────────────────────────────────────────────

export const REQUESTS_BOARD_COLUMNS: BoardColumn[] = [
  { id: 'submitted',     label: 'Submitted',     statusValue: 'submitted',     color: '#3B82F6' },
  { id: 'in_review',     label: 'In review',     statusValue: 'in_review',     color: '#8B5CF6' },
  { id: 'in_progress',   label: 'In progress',   statusValue: 'in_progress',   color: '#5A824E' },
  { id: 'client_review', label: 'Client review', statusValue: 'client_review', color: '#EC4899' },
  { id: 'on_hold',       label: 'On hold',       statusValue: 'on_hold',       color: '#F59E0B' },
  { id: 'delivered',     label: 'Delivered',     statusValue: 'delivered',     color: '#22C55E' },
  { id: 'cancelled',     label: 'Cancelled',     statusValue: 'cancelled',     color: '#9CA3AF' },
]

export function priorityToBoardPriority(p: string): BoardPriority | undefined {
  const v = p.toLowerCase()
  if (v === 'low' || v === 'medium' || v === 'high' || v === 'urgent') return v
  return undefined
}

export function requestsToBoardItems(requests: Request[]): BoardItem[] {
  return requests.map<BoardItem>(r => ({
    id: r.id,
    title: r.title,
    status: r.status,
    priority: priorityToBoardPriority(r.priority),
    tags: r.type ? [{ id: `type:${r.type}`, label: r.type }] : [],
    dueDate: r.updatedAt ? formatDate(r.updatedAt) : undefined,
  }))
}

export function RequestsTab({ clientId }: { clientId: string }) {
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [view, setView] = useState<'list' | 'board'>('list')

  const { data, isLoading: loading, mutate: load } = useSWR<{ requests: Request[] }>(
    `/api/admin/requests?clientId=${clientId}&status=all`,
  )
  const requests = data?.requests ?? []

  if (loading) return <SkeletonList rows={3} />

  const boardItems = requestsToBoardItems(requests)

  return (
    <>
    <NewRequestDialog
      open={dialogOpen}
      onClose={() => { setDialogOpen(false); void load() }}
      isAdmin={true}
      defaultOrgId={clientId}
    />
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="font-semibold text-[var(--color-text)]">All requests</h2>
        <div className="flex items-center gap-2">
          <ViewToggle
            value={view}
            onChange={setView}
            size="sm"
            options={[
              { value: 'list',  icon: ListIcon,    label: 'List view'  },
              { value: 'board', icon: ColumnsIcon, label: 'Board view' },
            ]}
          />
          <TahiButton variant="primary" size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            New request
          </TahiButton>
        </div>
      </div>

      {requests.length === 0 ? (
        <EmptyState
          variant="inline"
          icon={<FileText className="w-8 h-8" />}
          title="No requests for this client yet"
        />
      ) : view === 'board' ? (
        <BoardView
          columns={REQUESTS_BOARD_COLUMNS}
          items={boardItems}
          views={['kanban']}
          defaultView="kanban"
          searchPlaceholder="Search requests…"
          newLabel="New request"
          onNew={() => setDialogOpen(true)}
          onItemClick={(item) => router.push(`/requests/${item.id}`)}
          readOnly
        />
      ) : (
        <div className="flex flex-col gap-2">
          {requests.map(req => (
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
