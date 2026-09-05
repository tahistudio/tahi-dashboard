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

/** One row of `blockedBy` or `blocks` from GET .../blockers. A blocker is now
 *  polymorphic (a task or a request at either end), so the shape lives beside
 *  the rules in lib/blockers.ts rather than being declared twice. `linkId` is
 *  the edge's own id, which is what DELETE takes; `other*` is the far end. */
export type { BlockerRow } from '@/lib/blockers'

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
