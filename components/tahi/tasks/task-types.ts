/**
 * The small shared shapes the Tasks components hand each other. No React, no
 * imports beyond the view vocabulary, so any slice can depend on it.
 *
 * They live in Slice 1 on purpose. Slices 3, 4 and 5 build four leaves in
 * parallel worktrees; a type that lived in one leaf would make the other three
 * un-typecheckable until it merged.
 */

export interface TaskSubtask {
  id: string
  title: string
  completed: boolean
}

/** A team member, as every task surface needs them: avatar plus a name. */
export interface TaskPerson {
  id: string
  name: string
  avatarUrl?: string | null
}

export interface TaskClientOption {
  id: string
  name: string
}

/** A request the Links card can point a task at. */
export interface TaskRequestOption {
  id: string
  orgId: string | null
  requestNumber: number | null
  title: string
}

/** One row of `blockedBy` or `blocks` from GET .../dependencies. `depId` is
 *  the dependency row's own id, which is what DELETE takes; `taskId` is the
 *  OTHER task in the relationship. */
export interface TaskDependencyRow {
  depId: string
  taskId: string
  taskTitle: string
  taskStatus: string
}

/** A task template, as the header menu and the create dialog read it. */
export interface TaskTemplateOption {
  id: string
  name: string
  type: string
  description: string | null
  defaultPriority: string
  subtasks: string[]
  estimatedHours: number | null
  orgId: string | null
}
