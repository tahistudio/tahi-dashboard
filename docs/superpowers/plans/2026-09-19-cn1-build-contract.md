# CN.1 build contract: suggestions and the dashboard gate (2026-09-19)

Phase 1 of docs/superpowers/plans/2026-09-19-call-notes-to-tasks-scope.md. Phase 0 is live (call_transcripts, the Tahi bot, task threads). Research for this phase, with file paths, line numbers and body shapes, is in docs/superpowers/plans/2026-09-19-cn1-research.json; read it before the code.

Three slices build against this contract in parallel. Nothing here is negotiable inside a slice; a builder who finds a contradiction in the code says so in notDone instead of changing the contract.

## 1. Data

Migration 0107_task_suggestions.sql (slice S1 owns it, plus the runner entry after 0106):

```
task_suggestions
  id text pk
  org_id text null                       -- null = studio housekeeping (open to every admin, like tasks)
  source_kind text not null              -- 'call' in this phase; later 'note' | 'voice' | 'slack'
  transcript_id text null                -- call_transcripts.id
  call_kind text null                    -- 'discovery' | 'scheduled'
  call_id text null
  kind text not null                     -- 'create_task' | 'update_task' | 'complete_task' | 'add_subtasks' | 'note'
  target_task_id text null               -- required for every kind except create_task
  proposal text not null                 -- JSON, shapes in section 2
  quote text not null                    -- verbatim transcript or wrap-up lines
  rationale text null                    -- one sentence
  confidence real null                   -- 0 to 1
  status text not null default 'pending' -- 'pending' | 'snoozed' | 'applied' | 'rejected' | 'expired' | 'failed'
  snooze_until text null
  approver_type text not null default 'founders'   -- 'founders' | 'member' | 'contact'
  approver_id text null
  decided_by_id text null
  decided_via text null                  -- 'dashboard' | 'slack' | 'mcp'
  decided_at text null
  applied_at text null
  applied_task_id text null              -- the task created, or the target task
  apply_error text null
  dedupe_key text not null
  slack_channel_id text null
  slack_message_ts text null
  created_at text not null
  updated_at text not null
unique index on dedupe_key; index on (status, created_at); index on transcript_id; index on target_task_id
```

Migration 0108_call_transcripts_suggested_at.sql (slice S2 owns it, plus its runner entry after 0107): `ALTER TABLE call_transcripts ADD COLUMN suggested_at text` (the high-water mark: the suggester stamps every transcript it has looked at, including ones it skipped, so nothing is read twice). Both slices append to the MIGRATIONS array in app/api/admin/db/migrate/route.ts; the lead resolves the one-line conflict at merge.

dedupe_key = sha-256 hex (Web Crypto) of `${sourceKind}:${transcriptId}:${kind}:${targetTaskId ?? ''}:${normalisedTitleOrDiff}` where normalisedTitleOrDiff is the create title lower-cased and whitespace-collapsed, or for updates the sorted JSON of the field diff, or for notes the first 80 characters of the body. A second run over the same transcript therefore inserts nothing new.

## 2. Proposal JSON by kind

- create_task: `{ title, description, type: 'client_task' | 'internal_client_task' | 'tahi_internal', orgId: string | null, requestId?: string | null, assigneeId?: string | null, assigneeName?: string | null, dueDate?: 'YYYY-MM-DD' | null, estimatedHours?: number | null, priority?: string | null, subtasks?: string[] }`. The suggester fills assigneeName from the transcript and assigneeId only when lib/task-wizard-drafts.ts resolveByName finds exactly one team member; never a guess.
- update_task: `{ fields: { title?, description?, status?, priority?, dueDate?, assigneeId?, estimatedHours? }, note?: string }` (fields is the diff to apply through the same validation as PATCH /api/admin/tasks/[id]).
- complete_task: `{ note?: string }` (status done, completedAt now).
- add_subtasks: `{ subtasks: string[] }` (appended, deduped against existing subtask titles case-insensitively).
- note: `{ body: string }` (a thread comment only, no task change).

## 3. Server library (slice S1)

lib/task-writes.ts, extracted from the routes so the routes and the apply function share one code path:
- `createTaskRecord(database, input: TaskCreateInput, actor: { actorType: 'team_member' | 'system', actorId: string | null })` performs exactly what POST /api/admin/tasks does after auth and access checks (validation, coerceTaskLinks, insert, subtasks, the task_assigned notification) and returns the row. POST /api/admin/tasks calls it; its tests stay green unchanged.
- `updateTaskRecord(database, taskId, patch: TaskPatchInput, actor)` performs what PATCH /api/admin/tasks/[id] does after guardTask (link invariants, validation, update, the task_assigned notification) and returns the row. PATCH calls it; its tests stay green unchanged.
- Both write an audit_log entry through lib/audit.ts (actions `task.created`, `task.updated`) with actorType from the actor; the routes therefore gain audit entries they did not have. Keep the existing behaviour otherwise byte for byte.

lib/task-suggestions.ts:
- `buildDedupeKey(input)` as in section 1.
- `insertSuggestions(database, rows)`: inserts, ignoring rows whose dedupe_key exists; returns { inserted, duplicates }.
- `listSuggestions(database, { status?, callId?, orgIds?: string[] | 'all', limit })` returning rows decorated with callTitle, callScheduledAt, orgName, targetTaskTitle, targetTaskStatus.
- `decideSuggestion(database, id, decision, ctx)` where decision is `{ action: 'approve', proposalOverride?: unknown } | { action: 'reject' } | { action: 'snooze', until: string }` and ctx is `{ actorId: string, via: 'dashboard' | 'slack' | 'mcp' }`. Guarded status transitions: approve and reject only from pending or snoozed; snooze only from pending or snoozed; anything else returns the current row unchanged with `changed: false`. Approve calls applySuggestion; a failed apply leaves status 'failed' with apply_error and never throws to the caller.
- `applySuggestion(database, row, ctx)`: create_task through createTaskRecord (actor system), update_task through updateTaskRecord, complete_task through updateTaskRecord with status done, add_subtasks through the subtasks insert the route uses, note through postTaskComment only. Then postTaskComment as the Tahi bot with body `Applied from the call "<callTitle>" (<date>): <one line describing the change>`, quote = the suggestion quote, sourceRef = `suggestion:<id>`; a task with a request mirrors as Phase 0 does. Then audit `task_suggestion.applied` (actorType system, metadata { suggestionId, via, decidedById }). Sets status applied, applied_at, applied_task_id.
- `snoozePreset(preset: 'tonight' | 'this_week', now)`: tonight = 19:00 Pacific/Auckland today, or tomorrow if that has passed; this_week = Friday 09:00 Pacific/Auckland, next Friday if that has passed.
- `resurfaceSnoozed(database, now)`: snoozed rows whose snooze_until has passed return to pending; returns the count.

Routes (slice S1), all admin, access scoped through the suggestion's org (null org open to every admin, as guardTask treats tasks):
- GET /api/admin/task-suggestions?status=pending|snoozed|applied|rejected&callId=&limit= (default pending, limit 100) → `{ items: DecoratedSuggestion[], counts: { pending: number, snoozed: number, calls: number } }` where calls is the number of distinct calls with a pending suggestion.
- POST /api/admin/task-suggestions/[id]/decide with body `{ action: 'approve' | 'reject' | 'snooze', proposal?: unknown, snooze?: 'tonight' | 'this_week' | { until: string } }` → `{ suggestion, changed, appliedTaskId? }`. Tweak in the UI is approve with a proposal override.
- POST /api/admin/task-suggestions/decide-bulk with `{ ids: string[], action: 'approve' | 'reject' }` → `{ results: Array<{ id, changed, status, appliedTaskId?, error? }> }`, each id decided independently, never one transaction.

## 4. The suggester (slice S2)

lib/task-suggester.ts:
- `buildSuggestionContext(database, orgId | null)` → `{ tasks: Array<{ id, title, status, assigneeName, dueDate, updatedAt }>, requests: Array<{ id, number, title, status }>, members: Array<{ id, name }> }` with tasks not done, or done in the last 14 days, updated in the last 60 days, capped at 80; requests open, capped at 40. A null org gives studio housekeeping tasks only.
- `suggestFromTranscript({ transcript, wrapUp, callTitle, callDate, context })` → `{ suggestions: SuggestionDraft[], usage, dropped: Array<{ reason, raw }> }`. Sonnet (SONNET_MODEL from lib/ai-models.ts), max_tokens 3000, a cached system prompt block. Output contract: free text then `<suggestions>[ ... ]</suggestions>` holding a JSON array of `{ kind, targetTaskId?, proposal, quote, rationale, confidence }`. Validation drops any item whose quote does not appear in the transcript or wrap-up after whitespace normalisation and case folding; any update, complete, add_subtasks or note whose targetTaskId is not in the context; any complete whose quote does not contain a completion word (done, finished, completed, shipped, live, sent, delivered); any create whose title is under 4 characters; anything beyond 12 items. Rules in the system prompt: only what was said; every item quotes the exact words; an update names the existing task from the list; a completion only when the call says it is done; never invent owners, dates or hours; the studio voice (no dashes).
- Production without ANTHROPIC_API_KEY returns an error, never a fallback; non-production may use a deterministic fallback flagged degraded, following the wizard contract.
- Cost recorded through lib/ai-cost.ts recordCost with a new scope value 'call_suggestions' added to its union.

Cron route POST /api/admin/crons/suggest-from-transcripts wrapped in withCronRun('suggest-from-transcripts'):
- Picks call_transcripts with suggested_at null, call_id not null, received in the last 30 days, oldest first, at most 5 per run.
- The gate: the linked call must have an org (discovery_calls.org_id or scheduled_calls.org_id) or meeting_type 'client'; other calls are stamped suggested_at with nothing written and counted as skipped with the reason.
- For each eligible transcript: build the context for that org, call the suggester, insert through insertSuggestions with approver_type 'founders', stamp suggested_at. Then resurfaceSnoozed. Summary `{ looked, eligible, skipped: Array<{ transcriptId, reason }>, inserted, duplicates, dropped, resurfaced, costCents }`.
- .github/workflows/dashboard-crons.yml gains the job every 30 minutes, following the drive sync job exactly (same secret header). Also an MCP tool `cron_suggest_from_transcripts` following the existing cron_* tools.

## 5. The inbox (slice S3)

- /tasks gains a fourth view key 'suggestions' (label "Suggestions", inert rail like 'week'). Rows grouped by call (call title, client, date, count) with per row: kind chip (New task, Update, Complete, Subtasks, Note), the proposal rendered plainly (title and description for create; the field diff for update; the subtasks list; the note), the quote as a quiet blockquote, confidence as a small muted percentage when under 0.7, and four actions: Approve, Tweak, Snooze (a menu: Tonight, This week), Reject. Tweak on a create opens NewTaskDialog prefilled through a new `initialDraft?: TaskFields` prop (applied in the open effect the way initialTemplateId is) and its save calls decide with the edited proposal; Tweak on other kinds opens a small inline editor for the fields or the note. A per call "Approve all" button uses decide-bulk. Keyboard: with a row focused, y approves and n rejects; j and k move focus; the rows are buttons or have tabindex so this works without a mouse. Empty state: leaf icon, "No suggestions waiting", one line explaining they arrive after transcribed calls. Optimistic removal with rollback on error; toasts name the task created ("Task created: <title>") with an Open link.
- GET /api/admin/overview gains `kpis.taskSuggestions: { pending, calls }` behind the same conditional inclusion the other kpis use, and the owner home gets a card "N suggestions from M calls" that links to /tasks?view=suggestions (bypassing ctx.go with a Link if go cannot take a query), hidden when pending is 0.
- MCP (workers/mcp-server): `list_task_suggestions { status?, call_id?, limit? }` and `decide_task_suggestion { id, action, snooze?, proposal? }` as pure mappings in workers/mcp-server/src/task-suggestion-tools.ts with app/api/__tests__/mcp-task-suggestion-tool-parity.test.ts, copied from the task-comment-tools pattern; the tools are registered in index.ts. lib/dashboard-guide.ts gains a "Suggestions from calls" concept and lists the two tools (the guide test checks tool names exist, so tools first).

## 6. Tests every slice must leave green

S1: task-writes extraction (POST and PATCH route tests unchanged and green, plus audit entries asserted); dedupe key stability; insertSuggestions ignores duplicates; decideSuggestion transitions (approve from pending applies, approve from applied is a no-op, snooze then approve, reject); applySuggestion per kind with the bot line and mirror asserted; a failed apply records apply_error; route auth and org scoping; bulk decides independently.
S2: context builder caps and windows; validation drops (missing quote, unknown target, completion without a completion word, over 12); the tags parser on a reply with prose around the JSON; the cron gate (no org and not client → skipped and stamped), high-water mark stamped even on failure, resurfaceSnoozed, cost recorded with the new scope.
S3: the view key wiring; the row renders each kind; y and n call decide; Tweak passes the edited proposal; the overview key; parity test for the two tools; the guide test.

## 7. Out of this phase

Slack (Phase 2), notes and voice (Phase 2), any auto apply, the negative-example feedback loop (Phase 3).
