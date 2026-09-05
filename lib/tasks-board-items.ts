/**
 * lib/tasks-board-items.ts
 *
 * TaskRow -> BoardItem. Pure, so the mapping is testable without mounting a
 * board, and so the one genuinely awkward part of it is written down once:
 * KanbanBoard's priority scale is low / medium / high / urgent and a task's
 * is standard / high / urgent. `standard` reads as `medium` on a card, which
 * is the tone the studio already expects there.
 */

import type { BoardColumn, BoardItem, BoardPriority } from '@/components/tahi/kanban-board'
import { TASK_STATUSES, TASK_STATUS_CONFIG } from '@/lib/status-config'
import { taskDayKey, type TaskRow } from '@/lib/tasks-views'

/** The four columns, straight off the status vocabulary so they cannot
 *  drift from the chip, the filter or the bulk menu. */
export const TASK_BOARD_COLUMNS: readonly BoardColumn[] = TASK_STATUSES.map((s) => ({
  id: s.value,
  label: s.label,
  statusValue: s.value,
  color: TASK_STATUS_CONFIG[s.value]?.dot,
}))

/** The board's scale has a `medium` a task does not, and no `standard`. */
export function toBoardPriority(priority: string): BoardPriority {
  if (priority === 'urgent') return 'urgent'
  if (priority === 'high') return 'high'
  return 'medium'
}

export interface TaskBoardPerson {
  id: string
  name: string
  avatarUrl?: string | null
}

export interface TaskBoardContext {
  people: Readonly<Record<string, TaskBoardPerson>>
  /** requestId -> display number, for the card's top-right reference. Omit
   *  it and a linked card simply carries no reference, which is better than
   *  printing a uuid there. */
  requestNumbers?: Readonly<Record<string, number | null | undefined>>
  now: Date
}

export function toTaskBoardItems(
  rows: readonly TaskRow[],
  ctx: TaskBoardContext,
): BoardItem[] {
  const today = taskDayKey(ctx.now)

  return rows.map((row) => {
    const done = row.status === 'done'
    const dueDate = row.dueDate ? row.dueDate.slice(0, 10) : undefined
    const assignee = row.assigneeId ? ctx.people[row.assigneeId] : undefined
    const requestNumber = row.requestId ? ctx.requestNumbers?.[row.requestId] ?? null : null
    const total = row.subtaskCount ?? 0
    const blockers = row.blockedByCount ?? 0

    return {
      id: row.id,
      status: row.status,
      title: row.title,
      priority: toBoardPriority(row.priority),
      // BoardAssignee, not a string: the card draws an avatar from it.
      client: row.orgName ? { id: row.orgId ?? row.orgName, name: row.orgName } : undefined,
      // The repo prints a request as #042 everywhere it appears, so the
      // card's top-right reference reads the same as the list, the detail
      // and the timer chip.
      reference: requestNumber == null ? undefined : `#${String(requestNumber).padStart(3, '0')}`,
      dueDate,
      // Finished work needs no deadline on the card, but the date is still
      // wanted for the tooltip, so it is hidden rather than dropped.
      hideDueChip: done || undefined,
      isOverdue: !done && !!dueDate && dueDate < today,
      warning: blockers > 0
        ? `Blocked by ${blockers} ${blockers === 1 ? 'task' : 'tasks'}`
        : undefined,
      subtasks: total > 0 ? { done: row.subtaskDone ?? 0, total } : undefined,
      // BoardPerson.role is a free-form human label the tooltip prints, so
      // it is capitalised here rather than being a slug.
      people: assignee
        ? [{ id: assignee.id, name: assignee.name, role: 'Assignee', avatarUrl: assignee.avatarUrl ?? undefined }]
        : undefined,
      // No assignee means the card shows the dashed "Unassigned" placeholder
      // rather than an empty people row.
      unassigned: assignee ? undefined : true,
    }
  })
}
