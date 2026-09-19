# CN.1b build contract: suggestions become requests as well as tasks (2026-09-19)

Extends docs/superpowers/plans/2026-09-19-cn1-build-contract.md, which is live (task_suggestions, the sweep, the inbox). Liam: "these are tasks and requests, especially requests if they come from a client." The rule is the Tasks vs Requests model: requests are client-facing work, tasks run the studio. A call with a client therefore mostly yields requests, updates to existing requests, and hand-offs (the client owes something on a request); tasks are the studio's own follow-ups.

Three slices build against this in parallel. Read the CN.1 contract and docs/superpowers/plans/2026-09-19-cn1-research.json first; the request write paths are described below.

## 1. Data (slice R1)

Migration 0109_task_suggestions_requests.sql plus its runner entry after 0108:

```
ALTER TABLE task_suggestions ADD COLUMN target_request_id text
ALTER TABLE task_suggestions ADD COLUMN applied_request_id text
CREATE INDEX IF NOT EXISTS idx_task_suggestions_target_request ON task_suggestions(target_request_id)
```

db/schema.ts taskSuggestions gains targetRequestId and appliedRequestId. SuggestionKind gains `'create_request' | 'update_request' | 'request_note' | 'hand_off_request'`. DecoratedSuggestion gains targetRequestNumber, targetRequestTitle, targetRequestStatus (null when there is no target request).

## 2. Proposal JSON for the new kinds

Vocabulary comes from lib/request-vocabulary.ts (REQUEST_CATEGORIES, REQUEST_TYPES, REQUEST_PRIORITIES) and the hand-off reasons from lib/request-handoff-copy.ts. Never hard-code the lists in the suggester: read them and print them into the prompt.

- create_request: `{ title, description, category, type, priority: 'standard' | 'high', dueDate?: 'YYYY-MM-DD' | null, requesterName?: string | null, requesterContactId?: string | null }`. The org is the suggestion's org_id. requesterContactId is set only when requesterName matches exactly one contact of that org by name or email (the same "never guess" rule as resolveByName); otherwise null with the name kept for the human.
- update_request: `{ fields: { status?, priority?, dueDate?, startDate?, estimatedHours?, category?, scopeFlagged? }, note?: string }` on target_request_id, through the same validation as PATCH /api/admin/requests/[id]; a note is posted into the request thread as an internal bot message.
- request_note: `{ body: string }` on target_request_id, posted as an internal bot message in the thread. Nothing client-visible in this phase.
- hand_off_request: `{ contactName: string, contactId?: string | null, reason: 'approval' | 'content' | 'access' | 'decision' | 'file' | 'other', dueAt?: 'YYYY-MM-DD' | null, note?: string }` on target_request_id. contactId resolved like the requester; a hand-off without a resolvable contact is still suggested (the human picks the person on Tweak) but cannot be approved as is: approve returns `changed: false` with `error: 'contact_required'`.

dedupe_key: create_request on the normalised title; update_request on target plus the sorted fields diff; request_note on target plus the first 80 characters; hand_off_request on target plus the lower-cased contactName.

## 3. Server writes (slice R1)

lib/request-writes.ts, extracted from the routes so routes and the apply function share one code path, the way lib/task-writes.ts was done for tasks:
- `createRequestRecord(database, input, actor)` performs what POST /api/admin/requests does after auth (validation of clientOrgId, title, type, category, priority, dates, the intake status default, the request number, brand, the audit or notification side effects the route has today) and returns the row. POST /api/admin/requests calls it; its tests stay green.
- `updateRequestRecord(database, requestId, patch, actor)` performs what PATCH /api/admin/requests/[id] does after auth and access (the fields listed in section 2 and the status side effects the route has) and returns the row. PATCH calls it.
- `handOffRequest(database, requestId, { contactId, reason, dueAt, note }, actor)` performs what POST /api/admin/requests/[id]/handoff does (lib/request-handoff.ts may already hold most of it; if the route is inline, extract). The route calls it.
- A request thread post as the Tahi bot: reuse exactly what lib/task-comments.ts does for the mirror (an internal messages row with authorType 'bot'), factored into one helper `postRequestBotMessage(database, requestId, { body, quote?, sourceRef? })` in lib/task-comments.ts or lib/tahi-bot.ts, and used by both.

lib/task-suggestions.ts: applySuggestion handles the four kinds (create through createRequestRecord with actor system; update through updateRequestRecord plus the note; note through the bot post; hand off through handOffRequest), then posts the bot line `Applied from the call "<title>" (<date>): <one line>` with the quote into the request thread, writes the audit entry, sets applied_request_id. decideSuggestion returns `changed: false, error: 'contact_required'` for a hand-off with no contactId. listSuggestions decorates the target request. The routes keep their shapes.

Cutover route (R1): POST /api/admin/task-suggestions/rebuild with `{ transcriptIds?: string[], all?: boolean }` (admin, Tahi org only): sets pending and snoozed rows for those transcripts (or every transcript when all) to status 'expired' with decided_by_id the caller and decided_via 'dashboard', clears call_transcripts.suggested_at for them, and returns `{ expired, transcripts }`. The next sweep re-reads them with the new kinds. MCP tool `rebuild_task_suggestions` mirrors it.

## 4. The suggester (slice R2)

- Context gains the org's contacts `{ id, name, email }` (capped at 40) and, for each open request, its number, title, status and whether it is waiting on someone. Requests in the context carry ids; the model names an existing request by id.
- The prompt states the rule: client-facing work the client asked for or agreed to on the call becomes create_request (or update_request when an existing request from the list covers it); something the client owes on an existing request becomes hand_off_request naming the person; the studio's own follow-ups (research, admin, internal ops, things the client will never see) become tasks; never both for one item; every item quotes the exact words. The category, type, priority and reason lists are printed from the vocabulary modules.
- Validation drops: a create_request without a title of at least 4 characters or with a category, type or priority outside the lists; an update_request, request_note or hand_off_request whose target id is not an open request in the context; a hand_off_request without a reason from the list; anything without a verbatim quote (as today). Name resolution for requesterName and contactName to ids happens in the sweep against the context contacts, exact match on name or email, case folded; ambiguity leaves the id null.
- The cron route accepts `?limit=` (default 5, max 20) so a manual cutover pass can cover all eight calls at once; the GitHub cron keeps the default.
- Tests: the prompt lists the vocabulary; a client deliverable becomes create_request with the org; an item naming an open request becomes update_request; a client-owed item becomes hand_off_request with the contact resolved from the context; an internal follow-up stays create_task; drops for bad category and unknown target; the limit parameter.

## 5. The inbox (slice R3)

- Chips: New request, Update request, Request note, Hand off, beside the task chips. Summaries: title and category for create_request; the fields diff for update_request; the body for request_note; "Waiting on <name>: <reason>" for hand_off_request. Rows with a target request show "#<number> <title>" and link to the request.
- Tweak on create_request opens the New Request dialog (components/tahi/new-request-dialog.tsx) prefilled through a new `initialDraft` prop (org, title, description, category, type, priority, due date), and its save calls decide with the edited proposal; Tweak on update_request and hand_off_request opens the inline editor (fields, or contact picker from the org's contacts plus reason and date); Tweak on request_note edits the body.
- A hand-off row with no contact shows the picker inline before Approve is enabled.
- Types mirror in app/(dashboard)/tasks/suggestions-types.ts updated; the MCP tool descriptions for list_task_suggestions and decide_task_suggestion list the new kinds; lib/dashboard-guide.ts says suggestions can be requests, request updates, hand-offs and tasks.
- Tests: summaries per new kind; the Tweak round trip for create_request; the hand-off gating; the parity test for the descriptions.

## 6. Cutover (the lead, after the deploy)

Apply 0109 on production before the push. Then POST rebuild with all, run the sweep with limit 20, check the inbox: every client deliverable is a request on the right org, hand-offs name the contact, the studio follow-ups are tasks. Approvals stay with Liam.
