/**
 * lib/task-buckets.ts - pure time-bucketing for the "My Work" task lens.
 *
 * Both the Tasks page (My Work lens) and the teammate Overview home order the
 * signed-in member's tasks by when they are due. This module is the single
 * shared, side-effect-free implementation so those two surfaces never disagree.
 *
 * Buckets, in fixed display order:
 *   overdue   - due before today
 *   today     - due today
 *   this_week - due within the next 7 days (delta 1..7)
 *   later     - due more than 7 days out
 *   no_date   - no due date set
 *
 * All date maths runs on YYYY-MM-DD strings so it is deterministic and
 * timezone-stable (the caller passes today's local YYYY-MM-DD). No Date.now()
 * lives here, which keeps the module trivially unit-testable.
 */

export type TaskBucketId = 'overdue' | 'today' | 'this_week' | 'later' | 'no_date'

/** Fixed order the buckets render in. */
export const TASK_BUCKET_ORDER: readonly TaskBucketId[] = [
  'overdue',
  'today',
  'this_week',
  'later',
  'no_date',
] as const

export const TASK_BUCKET_LABELS: Record<TaskBucketId, string> = {
  overdue: 'Overdue',
  today: 'Today',
  this_week: 'This week',
  later: 'Later',
  no_date: 'No date',
}

export interface BucketableTask {
  dueDate: string | null
}

/** Whole-day difference (a - b) between two YYYY-MM-DD strings. */
export function dayDelta(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00')
  const db = new Date(b + 'T00:00:00')
  return Math.round((da.getTime() - db.getTime()) / 86400000)
}

/** Which bucket a task falls into, relative to `todayYmd` (local YYYY-MM-DD). */
export function bucketForTask(task: BucketableTask, todayYmd: string): TaskBucketId {
  if (!task.dueDate) return 'no_date'
  const delta = dayDelta(task.dueDate.slice(0, 10), todayYmd)
  if (delta < 0) return 'overdue'
  if (delta === 0) return 'today'
  if (delta <= 7) return 'this_week'
  return 'later'
}

/**
 * Group tasks into the fixed buckets. Dated buckets are sorted soonest-first
 * (earliest due date first); no_date preserves the input order. Empty buckets
 * are still present as empty arrays so callers can skip them explicitly.
 */
export function groupTasksByDue<T extends BucketableTask>(
  tasks: readonly T[],
  todayYmd: string,
): Record<TaskBucketId, T[]> {
  const groups: Record<TaskBucketId, T[]> = {
    overdue: [],
    today: [],
    this_week: [],
    later: [],
    no_date: [],
  }
  for (const task of tasks) {
    groups[bucketForTask(task, todayYmd)].push(task)
  }
  for (const id of TASK_BUCKET_ORDER) {
    if (id === 'no_date') continue
    groups[id].sort((a, b) => {
      const da = a.dueDate ?? ''
      const db = b.dueDate ?? ''
      return da < db ? -1 : da > db ? 1 : 0
    })
  }
  return groups
}
