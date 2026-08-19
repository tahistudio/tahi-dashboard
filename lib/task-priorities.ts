/**
 * lib/task-priorities.ts - the single source of truth for task priority values.
 *
 * The task priority enum drifted: the UI offered a "Low" option that the
 * PATCH / bulk routes rejected with a 400 (they only accept standard/high/urgent).
 * Exporting one canonical list and importing it in both the UI (filter options,
 * priority badge) and every validation site makes that drift impossible to
 * reintroduce.
 *
 * Note: this is deliberately separate from the AI wizard draft enum
 * (low/medium/high/urgent) and the requests priority enum. Those are different
 * domains with their own mapping; do not fold them together here.
 */

export const TASK_PRIORITIES = ['standard', 'high', 'urgent'] as const

export type TaskPriority = (typeof TASK_PRIORITIES)[number]

const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  standard: 'Standard',
  high: 'High',
  urgent: 'Urgent',
}

/** True when the value is one of the canonical task priorities. */
export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === 'string' && (TASK_PRIORITIES as readonly string[]).includes(value)
}

/** Human label for a priority; falls back to the raw value for unknowns. */
export function taskPriorityLabel(value: string): string {
  return isTaskPriority(value) ? TASK_PRIORITY_LABELS[value] : value
}
