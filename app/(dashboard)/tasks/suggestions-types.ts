/**
 * Local mirror of the task_suggestions shapes from the CN.1 build contract
 * (docs/superpowers/plans/2026-09-19-cn1-build-contract.md, sections 1, 2
 * and 3) plus the four request kinds CN.1b adds
 * (docs/superpowers/plans/2026-09-19-cn1b-requests-contract.md, sections 1
 * and 2) plus the duplicate-guard fields CN.1d adds
 * (docs/superpowers/plans/2026-09-19-cn1d-duplicate-guard-contract.md,
 * sections 2 and 3). Slice R1 owns the real table, routes and
 * DecoratedSuggestion type, and slice D1 owns the similar decoration and the
 * possible_duplicate error; this file exists so the Suggestions view can be
 * built and tested against the contract before that code lands in the same
 * tree. The lead swaps this file's import sites for the real export at
 * merge, if the two drift.
 */

export type TaskSuggestionKind =
  | 'create_task'
  | 'update_task'
  | 'complete_task'
  | 'add_subtasks'
  | 'note'
  | 'create_request'
  | 'update_request'
  | 'request_note'
  | 'hand_off_request'

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
  /** The suggester's owner guess, resolved exactly or null (CN.2 contract
   *  section 5). suggestedAssigneeId is what Approve carries into
   *  createTaskRecord; a picker on the row may override it before Approve
   *  fires. */
  suggestedAssigneeId?: string | null
  suggestedAssigneeName?: string | null
  /** One sentence: who said they would do it, or "owns this client's
   *  work" when there was no new owner named on the call. */
  assigneeReason?: string | null
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

/** create_request (CN.1b contract section 2). requesterContactId is set only
 *  when the sweep resolved requesterName to exactly one org contact; a Tweak
 *  never edits either requester field, it edits what the request will say. */
export interface CreateRequestProposal {
  title: string
  description: string | null
  category: string
  type: string
  priority: 'standard' | 'high'
  dueDate?: string | null
  requesterName?: string | null
  requesterContactId?: string | null
  /** The suggester's owner guess, resolved exactly or null (CN.2 contract
   *  section 5). suggestedAssigneeId is what Approve carries into
   *  createRequestRecord. */
  suggestedAssigneeId?: string | null
  suggestedAssigneeName?: string | null
  assigneeReason?: string | null
}

export interface UpdateRequestProposalFields {
  status?: string
  priority?: string
  dueDate?: string | null
  startDate?: string | null
  estimatedHours?: number | null
  category?: string
  scopeFlagged?: boolean
}

export interface UpdateRequestProposal {
  fields: UpdateRequestProposalFields
  note?: string
  /** The suggester's owner guess (CN.2 contract section 5), shown on the
   *  row with the same picker create_task and create_request carry. Not
   *  wired into the write this slice makes: an update_request's own field
   *  list stays the PATCH-safe set above, so this is informational until a
   *  later slice adds it there. */
  suggestedAssigneeId?: string | null
  suggestedAssigneeName?: string | null
  assigneeReason?: string | null
}

export interface RequestNoteProposal {
  body: string
}

/** hand_off_request (CN.1b contract section 2). contactId resolved the same
 *  way requesterContactId is; a hand-off with no contactId is still shown,
 *  it just cannot be approved until the picker in the row fills it in. */
export interface HandOffRequestProposal {
  contactName: string
  contactId?: string | null
  reason: 'approval' | 'content' | 'access' | 'decision' | 'file' | 'other'
  dueAt?: string | null
  note?: string
}

export type TaskSuggestionProposal =
  | CreateTaskProposal
  | UpdateTaskProposal
  | CompleteTaskProposal
  | AddSubtasksProposal
  | NoteProposal
  | CreateRequestProposal
  | UpdateRequestProposal
  | RequestNoteProposal
  | HandOffRequestProposal

/** A close match against something that already exists, or against another
 *  pending suggestion proposing the same thing (CN.1d contract section 2).
 *  'suggestion' matches carry no number, they are not created yet. */
export interface SimilarMatch {
  kind: 'request' | 'task' | 'suggestion'
  id: string
  number: number | null
  title: string
  status: string
  score: number
}

/** The row shape GET /api/admin/task-suggestions returns: the table row plus
 *  the decorations listSuggestions() adds (CN.1 contract section 3, request
 *  target decorations added by CN.1b contract section 1, similar added by
 *  CN.1d contract section 2). */
export interface DecoratedSuggestion {
  id: string
  orgId: string | null
  sourceKind: string
  transcriptId: string | null
  callKind: TaskSuggestionCallKind | null
  callId: string | null
  kind: TaskSuggestionKind
  targetTaskId: string | null
  /** Set for update_request, request_note and hand_off_request; null for
   *  everything else, including create_request (there is no target yet). */
  targetRequestId: string | null
  /** The request created or updated once this suggestion is applied, null
   *  until then. */
  appliedRequestId: string | null
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
  targetRequestNumber: number | null
  targetRequestTitle: string | null
  targetRequestStatus: string | null
  /** Only populated for create_request and create_task rows; empty for
   *  every other kind (CN.1d contract section 2). Best match first, at
   *  most 3. */
  similar: SimilarMatch[]
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
  appliedRequestId?: string
  /** 'contact_required': a hand_off_request approved with no contactId,
   *  resolved or picked. 'possible_duplicate': approve on a create_request
   *  or create_task scored at or above SIMILAR_BLOCK against a live row and
   *  the decision did not carry force: true. changed is false alongside
   *  either. */
  error?: string
  /** Set alongside a 'possible_duplicate' error: the same shape
   *  DecoratedSuggestion.similar carries, so the row can render the same
   *  choices even if it had not already shown a warning (CN.1d contract
   *  section 5). */
  similar?: SimilarMatch[]
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
