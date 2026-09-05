import { describe, it, expect } from 'vitest'
import { TASK_BOARD_COLUMNS, toTaskBoardItems, toBoardPriority } from './tasks-board-items'
import { isTaskOverdue, type TaskRow } from './tasks-views'
import { blockedWarningLabel } from './blockers'

const NOW = new Date(2026, 8, 5)

function row(over: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 't1', title: 'A task', type: 'tahi_internal', status: 'todo', priority: 'standard',
    orgId: null, orgName: null, requestId: null, assigneeId: null, dueDate: null,
    completedAt: null, description: null, estimatedHours: null,
    createdAt: null, updatedAt: null, subtaskCount: 0, subtaskDone: 0, blockedByCount: 0,
    ...over,
  }
}

describe('TASK_BOARD_COLUMNS', () => {
  it('is the four task statuses in vocabulary order', () => {
    expect(TASK_BOARD_COLUMNS.map(c => c.statusValue)).toEqual([
      'todo', 'in_progress', 'blocked', 'done',
    ])
    expect(TASK_BOARD_COLUMNS.map(c => c.label)).toEqual([
      'To Do', 'In Progress', 'Blocked', 'Done',
    ])
  })

  it('takes every column dot from the shared status config', () => {
    expect(TASK_BOARD_COLUMNS.map(c => c.color)).toEqual([
      'var(--status-submitted-dot)',
      'var(--status-in-progress-dot)',
      'var(--badge-danger-dot)',
      'var(--status-delivered-dot)',
    ])
  })
})

describe('toBoardPriority', () => {
  it('bridges the task scale onto the board scale', () => {
    expect(toBoardPriority('urgent')).toBe('urgent')
    expect(toBoardPriority('high')).toBe('high')
    expect(toBoardPriority('standard')).toBe('medium')
    expect(toBoardPriority('anything-else')).toBe('medium')
  })
})

describe('toTaskBoardItems', () => {
  const ctx = { people: { tm1: { id: 'tm1', name: 'Maya' } }, now: NOW }

  it('carries the status, title and client through', () => {
    const [item] = toTaskBoardItems([row({ orgId: 'o1', orgName: 'Kowtow' })], ctx)
    expect(item.id).toBe('t1')
    expect(item.status).toBe('todo')
    expect(item.title).toBe('A task')
    // BoardItem.client is a BoardAssignee, not a string: the card draws an
    // avatar from it.
    expect(item.client).toEqual({ id: 'o1', name: 'Kowtow' })
  })

  it('omits the client avatar on a task with no client', () => {
    const [item] = toTaskBoardItems([row()], ctx)
    expect(item.client).toBeUndefined()
  })

  it('carries the priority across the bridge', () => {
    const [item] = toTaskBoardItems([row({ priority: 'standard' })], ctx)
    expect(item.priority).toBe('medium')
  })

  it('rolls subtasks up into the progress bar', () => {
    const [item] = toTaskBoardItems([row({ subtaskCount: 4, subtaskDone: 1 })], ctx)
    expect(item.subtasks).toEqual({ done: 1, total: 4 })
  })

  it('omits the subtask rollup when there are none', () => {
    const [item] = toTaskBoardItems([row()], ctx)
    expect(item.subtasks).toBeUndefined()
  })

  it('hides the due chip on a done card but keeps the date', () => {
    const [item] = toTaskBoardItems([row({ status: 'done', dueDate: '2026-09-01' })], ctx)
    expect(item.dueDate).toBe('2026-09-01')
    expect(item.hideDueChip).toBe(true)
    expect(item.isOverdue).toBe(false)
  })

  it('marks an open past-due card overdue', () => {
    const [item] = toTaskBoardItems([row({ dueDate: '2026-09-01' })], ctx)
    expect(item.isOverdue).toBe(true)
  })

  it('gives the same overdue answer as the shipped helper the rail reads', () => {
    const rows = [
      row({ id: 'a', dueDate: '2026-09-01' }),
      row({ id: 'b', dueDate: '2026-09-01', status: 'done' }),
      row({ id: 'c', dueDate: '2026-09-30' }),
      row({ id: 'd' }),
    ]
    expect(toTaskBoardItems(rows, ctx).map(i => i.isOverdue)).toEqual(
      rows.map(r => isTaskOverdue(r, NOW)),
    )
  })

  it('trims a stored timestamp down to the day the card compares on', () => {
    const [item] = toTaskBoardItems([row({ dueDate: '2026-09-05T09:30:00.000Z' })], ctx)
    expect(item.dueDate).toBe('2026-09-05')
    expect(item.isOverdue).toBe(false)
  })

  it('warns when the card is blocked by something', () => {
    const [item] = toTaskBoardItems([row({ blockedByCount: 2 })], ctx)
    expect(item.warning).toBe('Blocked by 2 items')
  })

  it('says item in the singular when one thing blocks the card', () => {
    const [item] = toTaskBoardItems([row({ blockedByCount: 1 })], ctx)
    expect(item.warning).toBe('Blocked by 1 item')
  })

  it('says items, not tasks, because a blocker can be a request', () => {
    // The count is type-blind by the time it reaches a card: the two blockers
    // behind this 2 may be one task and one request. Saying "2 tasks" would
    // be a claim the number cannot support, and it would disagree with the
    // requests board, which spends the same warning slot on the same idea.
    const [item] = toTaskBoardItems([row({ blockedByCount: 2 })], ctx)
    expect(item.warning).not.toContain('task')
    expect(item.warning).toBe(blockedWarningLabel(2, false))
  })

  it('leaves the warning empty when nothing is holding the card up', () => {
    expect(toTaskBoardItems([row({ blockedByCount: 0 })], ctx)[0].warning).toBeUndefined()
    expect(toTaskBoardItems([row()], ctx)[0].warning).toBeUndefined()
  })

  it('names the assignee', () => {
    const [item] = toTaskBoardItems([row({ assigneeId: 'tm1' })], ctx)
    expect(item.people?.[0]).toMatchObject({ name: 'Maya', role: 'Assignee' })
    expect(item.unassigned).toBeUndefined()
  })

  it('flags an unassigned card so the card draws the placeholder', () => {
    const [item] = toTaskBoardItems([row()], ctx)
    expect(item.people).toBeUndefined()
    expect(item.unassigned).toBe(true)
  })

  it('stays quiet about a card whose assignee is missing from the roster', () => {
    // The roster arrives on its own fetch, so an unresolved id means "not
    // known yet", not "nobody". The card draws no people row rather than
    // asserting the task is unassigned.
    const [item] = toTaskBoardItems([row({ assigneeId: 'ghost' })], ctx)
    expect(item.people).toBeUndefined()
    expect(item.unassigned).toBeUndefined()
  })

  it('prints a linked request as the padded hash reference the repo uses', () => {
    const [item] = toTaskBoardItems([row({ requestId: 'req-uuid' })], {
      ...ctx,
      requestNumbers: { 'req-uuid': 42 },
    })
    expect(item.reference).toBe('#042')
  })

  it('drops the reference when there is no request number to print', () => {
    const [item] = toTaskBoardItems([row({ requestId: 'req-uuid' })], ctx)
    expect(item.reference).toBeUndefined()
  })
})
