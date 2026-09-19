/**
 * Local mirror of the task_suggestions shapes from the CN.1 build contract
 * (docs/superpowers/plans/2026-09-19-cn1-build-contract.md, sections 1, 2
 * and 3). Slice S1 owns the real table, routes and DecoratedSuggestion type;
 * this file exists so the Suggestions view can be built and tested against
 * the contract before S1's code lands in the same tree. The lead swaps this
 * file's import sites for S1's own export at merge, if the two drift.
 */

export type TaskSuggestionKind =
  | 'create_task'
  | 'update_task'
  | 'complete_task'
  | 'add_subtasks'
  | 'note'

export type TaskSuggestionStatus =
  | 'pending'
  | 'snoozed'
  | 'applied'
  | 'rejected'
  | 'expired'
  | 'failed'

export type TaskSuggestionCallKind = 'discovery' | 'scheduled'

export type TaskLevelValue = 'client_task' | 'internal_client_task' | 'tahi_internal'

export interface CreateTaskProposal {
  title: string
  description: string | null
  type: TaskLevelValue
  orgId: string | null
  requestId?: string | null
  assigneeId?: string | null
  assigneeName?: string | null
  dueDate?: string | null
  estimatedHours?: number | null
  priority?: string | null
  subtasks?: string[]
}

export interface UpdateTaskProposalFields {
  title?: string
  description?: string
  status?: string
  priority?: string
  dueDate?: string | null
  assigneeId?: string | null
  estimatedHours?: number | null
}

export interface UpdateTaskProposal {
  fields: UpdateTaskProposalFields
  note?: string
}

export interface CompleteTaskProposal {
  note?: string
}

export interface AddSubtasksProposal {
  subtasks: string[]
}

export interface NoteProposal {
  body: string
}

export type TaskSuggestionProposal =
  | CreateTaskProposal
  | UpdateTaskProposal
  | CompleteTaskProposal
  | AddSubtasksProposal
  | NoteProposal

/** The row shape GET /api/admin/task-suggestions returns: the table row plus
 *  the five decorations listSuggestions() adds (contract section 3). */
export interface DecoratedSuggestion {
  id: string
  orgId: string | null
  sourceKind: string
  transcriptId: string | null
  callKind: TaskSuggestionCallKind | null
  callId: string | null
  kind: TaskSuggestionKind
  targetTaskId: string | null
  proposal: TaskSuggestionProposal
  quote: string
  rationale: string | null
  confidence: number | null
  status: TaskSuggestionStatus
  snoozeUntil: string | null
  createdAt: string
  callTitle: string | null
  callScheduledAt: string | null
  orgName: string | null
  targetTaskTitle: string | null
  targetTaskStatus: string | null
}

export interface TaskSuggestionsResponse {
  items: DecoratedSuggestion[]
  counts: { pending: number; snoozed: number; calls: number }
}

export type SnoozePreset = 'tonight' | 'this_week'

export interface DecideSuggestionResponse {
  suggestion: DecoratedSuggestion
  changed: boolean
  appliedTaskId?: string
}

export interface DecideBulkResultItem {
  id: string
  changed: boolean
  status: TaskSuggestionStatus
  appliedTaskId?: string
  error?: string
}

export interface DecideBulkResponse {
  results: DecideBulkResultItem[]
}
