'use client'

/**
 * <TasksBoard>. The Board view: four columns from the task status
 * vocabulary, drag to move, an inline composer at the foot of every column
 * that still takes work.
 *
 * A thin arrangement of <KanbanBoard>, which already owns the horizontal
 * scroll, the proxy scrollbar, the settle animation and the 44px mobile
 * targets. Nothing about the board is re-implemented here; this file decides
 * which columns exist, what a card carries, and what a drop means.
 *
 * The Blocked column is the one place the surface reads `status ===
 * 'blocked'` alone rather than "blocked by status or by a dependency": a
 * column has to mean the value a drop into it writes, and a drop cannot
 * invent a dependency. The rail's Blocked count, its saved view and the
 * list's Tick all keep the wider reading.
 */

import * as React from 'react'
import { KanbanBoard } from '@/components/tahi/kanban-board'
import { TASK_BOARD_COLUMNS, toTaskBoardItems } from '@/lib/tasks-board-items'
import type { TaskRow } from '@/lib/tasks-views'

export interface TasksBoardProps {
  rows: readonly TaskRow[]
  people: Readonly<Record<string, { id: string; name: string; avatarUrl?: string | null }>>
  /** requestId -> display number, for a linked card's reference chip. */
  requestNumbers?: Readonly<Record<string, number | null | undefined>>
  readOnly: boolean
  /** Drag between columns. Resolve to commit, reject to snap back. */
  onMove: (taskId: string, toStatus: string) => Promise<void>
  /** The column composer. `status` is the column it was typed in, so the task
   *  is created there rather than always at todo. Reject to keep the composer
   *  open with the title still in the box. */
  onQuickAdd: (status: string, title: string) => Promise<void>
  onOpenTask: (taskId: string) => void
  /** Injected in tests; defaults to the wall clock. */
  now?: Date
}

export function TasksBoard({
  rows,
  people,
  requestNumbers,
  readOnly,
  onMove,
  onQuickAdd,
  onOpenTask,
  now,
}: TasksBoardProps): React.ReactElement {
  const items = React.useMemo(
    () => toTaskBoardItems(rows, { people, requestNumbers, now: now ?? new Date() }),
    [rows, people, requestNumbers, now],
  )

  // KanbanBoard passes a third `position` argument, the visual index inside
  // the target column. Tasks have no persisted board ordering (tasks.position
  // is a track queue field that nothing on this surface reads or writes), so
  // the index is dropped and only the status is written.
  //
  // The shell owns the optimistic row and the failure message, so a rejected
  // move is swallowed here rather than escaping as an unhandled rejection:
  // the card snaps back because the rows it renders from never changed.
  const handleMove = React.useCallback(
    (itemId: string, toStatus: string) => {
      void onMove(itemId, toStatus).catch(() => undefined)
    },
    [onMove],
  )

  return (
    <KanbanBoard
      boardId="tasks-board"
      columns={TASK_BOARD_COLUMNS}
      items={items}
      readOnly={readOnly}
      iconOnlyPriority
      onMove={readOnly ? undefined : handleMove}
      // Passed through unwrapped: the composer awaits this promise, closing
      // on resolve and staying open with the title intact on reject.
      onQuickAdd={readOnly ? undefined : onQuickAdd}
      // Done takes no new work: a plus there would name a column the create
      // path does not honour.
      canAddTo={(status) => status !== 'done'}
      quickAddHint="Enter to add"
      onItemClick={(item) => onOpenTask(item.id)}
    />
  )
}
