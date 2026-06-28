# Requests - design brief

> The core product surface and the reason this dashboard replaces ManyRequests: a
> client submits a request, the team delivers it. List, board, and detail; an
> intake form on the way in; a thread and a delivery spine on the way through.
> Requests are client-visible (tasks, spec 08, are not).

> Prepend `_studio-ledger-theme.md` before this brief in Claude design.

## What exists today (as built)

A large, working surface that is built but not yet daily-trusted (March QA flagged client-privacy gaps and file/voice-note bugs). This brief redesigns and hardens it.

- **List / board / workload** - `app/(dashboard)/requests/page.tsx` (server, auth + isAdmin) -> `request-list.tsx` (~1800 lines). A `ViewToggle` across **list** (`DataTable`), **board** (`BoardView`: kanban + timeline), and **workload** (admin-only assignment bars + capacity colours). View/sort/tab persisted per user (`useUserPreference`).
  - **FilterBar:** status / category / type chips + created-date range + client-tag chip + free-text search (title + org). Status options differ admin vs client.
  - **List columns:** scope-flag warning icon, zero-padded `#requestNumber` (mono), title link, client (admin), **inline-editable status chip** (optimistic `PUT /api/admin/requests/{id}`), priority badge, due-date chip (overdue / due-soon states), updated date.
  - **Board:** default 5 columns (`BOARD_COLS`) but maps to per-client custom columns from `/api/admin/kanban-columns`. Drag between columns = status PATCH; drop card on card = confirm dialog to **nest** as a sub-request (cross-client refused); drop nested child on a column = un-nest. Read-only for clients.
  - **Bulk (admin):** change status, assign (PM / assignee / follower), archive; **Bulk Create** fans one request across many clients by plan; AI draft via `AiRequestWizard`; CSV export.
- **New request** - `new-request-dialog.tsx`: admin client + brand picker; types `small_task` / `large_task` (large `requiresScale`); categories dev/design/content/strategy/admin/bug; priority; isInternal; dates; estimated hours; track selector for maintain/scale clients. The **portal** renders dynamic intake questions (text / textarea / url / select / multiselect / checkbox / file) from `/api/portal/request-forms?category=`.
- **Detail** - `app/(dashboard)/requests/[id]/request-detail.tsx` (~2000 lines). Two columns. Header: `#num` + StatusBadge + high-priority pill + scope-flagged pill + `Rev n/max`, title + `PeopleStack`, client/created/due, a minimal progress bar over `STATUS_FLOW` (submitted -> in_review -> in_progress -> client_review -> delivered). Main: `RequestThread` + lazy `MessageComposer` (**internal vs external** visibility), Tiptap description, `SubRequestsPanel`, `FilesPanel`, collapsed `ActivityLog`. Right rail: people, time (admin), discovery calls (admin), checklists, due/priority/assignee, delivery-phase selector (`scheduleRowId`).
- **Schema** (`db/schema.ts`): `requests` (status draft/submitted/in_review/in_progress/client_review/delivered/archived; `size` small/large + legacy `type`; `category`; `assigneeId`; `parentRequestId`+`subPosition` one-level nesting same-org; `queueOrder` per-track; `revisionCount`/`maxRevisions` default 3; `scopeFlagged`+reason; `isInternal`; `formResponses` JSON; `requestNumber`; `checklists` JSON; `scheduleRowId`). `requestParticipants` (pm/assignee/follower, soft-delete), `requestReads` (unread), `requestSteps` (nestable checklist), `activeTimers`. `tracks` (capacity slots per `subscriptions` maintain/scale; `currentRequestId` = occupied; one-active-at-a-time). `conversations` (`request_thread`, visibility internal/external) + `messages` (`isInternal`). `requestForms` (category + orgId + questions; resolution priority org+category -> org+global -> category-global -> global default). `kanbanColumns` (orgId null = global default else per-client; label/statusValue/colour/position).
- **APIs:** admin `requests` (GET applies `resolveAccessScoping`), `[id]`, `[id]/messages` (@mention notifications, isInternal gating), participants, files, voice-notes, time-entries, steps, reads, nest, scope-flag, calls, sub-requests, bulk, bulk-assign, export. Portal mirror: `portal/requests` (org-scoped, blocks Tahi org), `[id]/{messages,files,steps}`, `request-forms`, `ai/request-wizard`. Delivery rollup in `lib/delivery-status.ts` (#148, the ManyRequests differentiator).

## Page purpose

Make submitting, tracking, and delivering work feel effortless and trustworthy. The client always knows where their request stands and what is next; the team always knows what is theirs, what is queued, and what is overdue, with internal work kept invisible to the client.

## Personas and jobs-to-be-done

- **Client.** "Submit what I need in a minute, then see exactly where it is and what is next, and approve when asked." Sees only their org, read-only status, external messages, queue position. Never sees internal notes, tasks, scope reasons, or other clients.
- **Teammate.** "See the requests that are mine, move them through the pipeline, talk to the client and the team separately, and never breach client privacy."
- **Owner.** "See everything across clients, balance capacity, spot what is overdue or off-track, and create or fan out work fast."

## What others do (and what we take)

- **ManyRequests** - per-service intake forms (with conditional logic) auto-spawn an assignable card; interchangeable Kanban / List / Queue; timestamped proofing comments on files. We have the forms + columns; we adopt file proofing comments and the form-to-card flow.
- **Designjoy** - a pure queue: only one or two requests *active* at a time, finishing auto-pulls the next; card order is "what's next". Capacity is a visible hard constraint. This is exactly our `tracks` model; we surface it explicitly.
- **Queue.dev** - client self-serve pause/unpause (banking days), one form spanning subscriptions, one-offs, and credits. A roadmap input for client control.
- **Service Provider Pro / Wayfront** - order -> payment -> delivery, splitting an order into internal tasks while the client sees order-level progress. Validates our internal/external separation.
- **Linear** - an SLA fire-icon that ramps from grey to red as a deadline nears; a Triage inbox before workflow status; Cmd-K and `C`-to-create. We adopt due-countdown signaling, a triage/new lane, and quick-create.
- **Trello** - inline quick-add at the foot of a column; columns as the status mental model.
- **ClickUp / Height / Notion** - one dataset, many saved named views with per-view filters. We promote our FilterBar combos to first-class saved views.
- **Asana** - subtasks + "waiting on" dependencies.

## Experience principles

1. **Numbers lead.** `#requestNumber`, `Rev n/max`, queue position, due-countdown, capacity % are the heroes; lean into them, Studio Ledger style.
2. **Internal and external are visibly different and never leak.** External (client-visible) and internal messages/requests/notes are styled distinctly and enforced server-side. This is the trust-critical surface. Two things now hold that the design can rely on: client-submitted rich text (request descriptions, thread messages) is **sanitised server-side at the untrusted boundary** (`lib/sanitize-rich-text.ts`, allowlist) before it is ever rendered to a teammate, so a client can never inject script into an admin's view; and every portal route resolves and owner-binds the org via `getPortalAuth`, so a client only ever reads/writes their own org's rows. Design the thread to render rich text confidently (it is safe) while keeping the internal/external boundary unmistakable.
3. **Capacity is honest and visible.** For retainer clients, show "one active per track, next in queue" in both portal and admin. The constraint is a feature.
4. **One dataset, many saved views.** List, board, workload, and named filter presets are lenses on the same data.
5. **Two interactions to act.** Inline status edit, quick-add, drag-to-move; the detail is one click, not a maze.

## The surfaces

### List
Keep the `DataTable` + inline optimistic status chip. Add **saved named views** (codify the FilterBar combos as first-class) and a **quick-add row** at the top. Lead with the ledger numbers (#, rev, due-countdown). Client list is their org only, read-only status, no internal columns.

### Board (kanban)
Columns come from `kanbanColumns` (per-client override over the global default), each `statusValue` mapping to a real `requests.status`. Keep nest-on-drop and un-nest. For retainer clients, surface **queue position** and **track occupancy** (a lane or header chip) so "active vs queued" is obvious (the Designjoy signal). A timeline sub-view for date-based planning. Client board is read-only.

### Detail
The thread-first two-column layout is right. Formalize the **internal vs external** message styling (a clear visual boundary + an explicit toggle in the composer), file **proofing comments**, and a clean activity timeline (comments-only filter). Surface `Rev n/max` and the delivery-phase (`scheduleRowId`) prominently. Right rail holds people, time (admin), checklists, due/priority/assignee.

### Intake (the form builder)
Build the admin **form builder** for `requestForms` (question types already defined: text/textarea/url/select/multiselect/checkbox/file), with a live **resolution-priority preview** (which form a given client+category will get). The portal new-request renders the resolved form. This turns intake into a per-service, per-client tool (the ManyRequests parity piece).

## Component spec, motion, accessibility

- Reuse `DataTable`, `BoardView`, `FilterBar`, `StatusBadge`, `PeopleStack`, `RequestThread`, `MessageComposer`, `FilesPanel`; this is a reskin + hardening, not a rebuild.
- Inline status chip and drag-to-move are optimistic with reconcile; quick-add commits on Enter.
- Due-countdown chip ramps tone as the date nears (info -> warning -> danger), colour plus text, never colour alone.
- Motion: calm card moves on drag, gentle status transitions, reduced-motion disables drag animation and uses instant moves.
- Accessibility: the board is keyboard-movable (move-to-column menu as a non-drag path); the thread is a proper log; 44px targets; AA contrast; internal messages are clearly labelled, not just colour-coded.

## States and flows

- Submit (client, dynamic intake) -> appears in admin list/board.
- Move through the pipeline (drag or inline edit) -> client sees external status update.
- Internal note vs external reply (composer toggle); a client never sees internal.
- Nest / un-nest a sub-request (same-org only).
- Queue full for a track (new request enters the queue with a visible position).
- Revision count reaching max.
- Empty / loading / first-run (client with no requests gets a guided new-request CTA).
- Scope-flagged request (admin sees the flag + reason; client never sees the reason).

## Copy deck

- Status pipeline labels (per `kanbanColumns`): Submitted, In Review, In Progress, Client Review, On Hold, Delivered, Cancelled.
- Composer toggle: "Reply to client" vs "Internal note". Queue: "Next in queue", "Active now". Revision: "Revision 2 of 3".
- Client empty: "No requests yet. Tell us what you need." Due: "Due in 2 days", "Overdue by 1 day".

## Tokens and visual reference

- Numbers in tabular figures; `#requestNumber` mono. Status via `StatusBadge` tokens. Internal vs external uses a clear surface/border distinction (internal on a tinted hairline panel). Leaf radius on the primary New Request CTA and the active queue marker only. Cream canvas.

## Deliverables for Claude design

1. **Admin list** with saved views + quick-add + inline status.
2. **Admin board** with per-client columns, queue position, and track occupancy for a retainer client.
3. **Workload** view (assignment bars + capacity).
4. **Request detail** showing the internal/external thread boundary, proofing comments, rev count, delivery phase.
5. **Client portal:** the request list (read-only), the dynamic intake form, and a request detail (external only).
6. **Form builder** (admin) with resolution-priority preview.
7. **Mobile** (375px) of the client list, intake, and detail.
8. **Dark mode** of all of the above.
9. **State sheet:** due-countdown ramp, queue-full, internal vs external message, scope-flagged (admin vs client), empty/first-run.

**Integration constraints:**
- Custom column `statusValue` must map to a real `requests.status` or cards vanish; design within the known status set.
- One-level nesting only (`parentRequestId`, same-org); do not imply deeper trees.
- Reconcile the legacy `type` vs new `size` and the priority set (standard/high in detail vs urgent referenced in list) before building.
- Client privacy is load-bearing and server-enforced: internal messages (`isInternal`), internal requests, and scope reasons must never reach the portal. Two mechanisms are already in place and must be reused, not reinvented: sanitise any client-submitted rich text on write with `lib/sanitize-rich-text.ts` (every portal message/description ingestion point), and scope every portal route with `getPortalAuth` (resolved D1 org id, owner-bound, impersonation read-only). New portal write surfaces follow the same two rules.
- Reuse existing components; tokens only; honor reduced motion, 44px, AA.

## Why this is premium

The productized-service competitors win on one feeling: the client always knows where their thing is, and the studio always knows what is next, with no awkward leakage of the messy middle. Tahi can beat them by making that feeling editorial: the request number and revision count read like a ledger entry, the queue makes capacity an honest promise rather than a hidden bottleneck, and the internal/external boundary is so clearly drawn that the client trusts they are only ever seeing their own polished side. Saved views and a real intake builder turn a generic board into a tool shaped to each service. It is the difference between a Trello clone and a studio's operating system.

## Open decisions and risks

1. **Client-privacy boundary (partly hardened, still load-bearing).** Two prior gaps are now closed: client rich-text input is sanitised server-side before it reaches an admin (no stored XSS), and all portal routes scope via `getPortalAuth` (no cross-tenant reads/writes; impersonation is read-only). What remains load-bearing and must be tested before requests become daily-trusted: the `isInternal` message/request gating and scope-reason hiding must be enforced on every read path so an internal note or a scope reason can never reach the portal. There is now a Playwright e2e harness (Clerk test mode) to lock these flows down, so "tested before trusted" is a concrete, automatable gate, not a hope.
2. **Legacy `type` vs new `size`** dual columns and a **priority-set mismatch** (detail standard/high vs list urgent) need reconciling.
3. **File-upload / voice-note bugs** were flagged in March; verify before leaning on them.
4. **Custom kanban `statusValue`** must map to real statuses or cards disappear.
5. **D1 100-bind cap** on `inArray` (chunk org/id lists); keep admin vs client status-filter sets in sync as saved views are added.
