# Requests - design brief

> The core product surface and the reason this dashboard replaces ManyRequests: a
> client submits a request, the team delivers it. List, board, and detail; an
> intake form on the way in; a thread and a delivery spine on the way through.
> Requests are client-visible (tasks, spec 08, are not).

> Prepend `_studio-ledger-theme.md` before this brief in Claude design.
> The app shell (spec 04) is built and live: always-dark forest rail, hairline top
> bar, Cmd/Ctrl-K palette, mobile bottom tabs, cream canvas, bare-ink page title.
> This brief designs ONLY the canvas content plus page-owned overlays, slide-overs
> and dialogs. Never re-spec the shell; reference it.

## What exists today (as built)

A large, working surface that is built but not yet daily-trusted (March QA flagged client-privacy gaps and file/voice-note bugs). This brief redesigns and hardens it. Verified against the code 2026-07-04.

- **List / board / workload** - `app/(dashboard)/requests/page.tsx` (server, auth + isAdmin) -> `request-list.tsx` (1,802 lines). A `ViewToggle` across **list** (`DataTable`), **board** (`BoardView`: kanban + timeline sub-views), and **workload** (admin-only assignment bars + capacity colours). View / sort / status-tab persisted per user (`useUserPreference`: `requests.viewMode`, `requests.sortKey`, `requests.activeTab`).
  - **FilterBar** (`components/tahi/filter-bar.tsx`): permanent Status / Category / Type select chips, a Created date-range chip, a Client-tag chip (appears only when the loaded set has org tags), and free-text search (title + org name). Status options differ by audience: admin `Active / All / Unassigned / Delivered`, client `Active / Delivered / All`.
  - **List columns as built (in order):** selection checkbox (admin) -> Title (scope-flag warning icon + zero-padded mono `#requestNumber` + title link; minWidth `18rem`) -> Client (admin only; `Avatar` xs + org name; minWidth `10rem`) -> Status (`11rem`; admin gets an **inline-editable status chip** wired to an optimistic `PUT /api/admin/requests/{id}`, clients a read-only `Badge`) -> Priority (`7rem`) -> Due (`7rem`, `DueDateChip` with overdue / due-soon states, thresholds `<0` days and `<=3` days) -> Updated (`7rem`).
  - **Board:** default 5 columns (`BOARD_COLS`: Submitted, In Review, In Progress, Client Review, Delivered) overridden by per-client custom columns from `/api/admin/kanban-columns`. Column header: `0.4375rem` colour dot + label `0.8125rem` 600 + tabular count + add-card and actions buttons. Drag between columns = status PATCH; drop card on card = confirm dialog to **nest** as a sub-request (cross-client refused client-side and server-side); drop a nested child on a column = un-nest. Read-only for clients.
  - **Bulk (admin):** change status, assign (PM / assignee / follower via role tabs), archive; **Bulk Create** fans one request across many clients by plan; AI draft via `AiRequestWizard`; CSV export.
  - **Audit finding (status-set drift):** the inline chip offers `ALL_STATUSES` including `on_hold` and `cancelled`, but `lib/status-config.ts` `REQUEST_STATUS_CONFIG` has **no entries for either**, so the chip falls back to the raw values `on_hold` / `cancelled` as labels. The bulk menu offers `archived` instead. The schema comment documents only draft/submitted/in_review/in_progress/client_review/delivered/archived. Reconcile to the canonical seven-label pipeline (below) before the redesign lands.
- **New request** - `components/tahi/new-request-dialog.tsx` (1,009 lines): admin client + brand picker; types `small_task` ("<= 1 day") / `large_task` ("Multi-day", `requiresScale`); categories development / design / content / strategy / admin / bug; priority; isInternal; start + due dates; estimated hours; track selector shown for maintain / scale plans. The **portal** path renders dynamic intake questions (text / textarea / url / select / multiselect / checkbox / file) fetched from `/api/portal/request-forms?category=` on category change.
- **Detail** - `app/(dashboard)/requests/[id]/request-detail.tsx` (2,345 lines). Two columns (`1fr / 16rem` md, `1fr / 20rem` lg, max width `68.75rem`). Header is a **card** today: meta row (mono `#num`, `StatusBadge`, High-priority pill, Scope-flagged pill, `Rev n/max` chip), title + `PeopleStack`, client / created / due meta line, then a minimal progress bar over `STATUS_FLOW` (submitted -> in_review -> in_progress -> client_review -> delivered) on a `--color-bg-secondary` strip. Main: `RequestThread` + lazy `MessageComposer`, Tiptap description, `SubRequestsPanel`, `FilesPanel`, collapsed `ActivityLog`. Right rail order as built: TimeCard (admin), DiscoveryCallsCard (admin), Actions (status chip select, scope-flag toggle, make top-level), PeoplePanel, ChecklistsPanel, Details (type, category, priority, assignee, delivery phase `scheduleRowId`, due date, estimated, delivered).
- **Composer as built:** visibility segmented control labelled **`Public` / `Internal`** (not the target labels, see Component spec), warning-tinted full border when internal, italic hint "{Client} won't see this", send button "Send (Cmd+Enter)". Placeholder admin: "Reply to client or add an internal note…"; client: "Add a comment or question…".
- **Thread as built:** chat bubbles; own messages right-aligned with a **brand-green fill**; internal messages on **hardcoded amber-50 / amber-200** (not tokens) with a Lock icon + "Internal" label. Both are Studio Ledger violations (accent scarcity; token-only) the redesign fixes. The composer footer also sits on a border-top-only hairline (single-side border, house-rule violation as built).
- **Schema** (`db/schema.ts`): `requests` (status draft/submitted/in_review/in_progress/client_review/delivered/archived; `size` small/large + legacy `type`; `category`; `assigneeId`; `parentRequestId` + `subPosition` one-level nesting same-org; `queueOrder` per-track; `revisionCount` / `maxRevisions` default 3; `scopeFlagged` + `scopeFlagReason`; `isInternal`; `formResponses` JSON; `requestNumber`; `checklists` JSON; `scheduleRowId` -> `scheduleRows`). `requestParticipants` (pm / assignee / follower, soft-delete), `requestReads` (unread), `requestSteps` (nestable checklist), `activeTimers` (one per user). `tracks` (capacity slots per `subscriptions` maintain/scale; `type` small/large; `isPriorityTrack`; `currentRequestId` = occupied; one-active-at-a-time). `conversations` (`request_thread`, visibility internal/external) + `messages` (`isInternal`). `requestForms` (name + category + orgId + questions JSON + isDefault; resolution priority org+category -> org+global -> category-global -> global default). `kanbanColumns` (orgId null = global default else per-client; label / statusValue / colour / position). **No file-comments table exists**: proofing comments (below) need a migration before build.
- **APIs:** admin `requests` (GET applies `resolveAccessScoping`), `[id]`, `[id]/messages` (@mention notifications, isInternal gating), participants, files, voice-notes, time-entries, steps, reads, nest, scope-flag, calls, sub-requests, bulk, bulk-assign, export. Portal mirror: `portal/requests` (org-scoped, blocks Tahi org), `[id]/{messages,files,steps}`, `request-forms`, `tracks`, `ai/request-wizard`. Delivery rollup in `lib/delivery-status.ts` (#148, the ManyRequests differentiator).
- **Privacy machinery in place:** client-submitted rich text is sanitised server-side at the untrusted boundary (`lib/sanitize-rich-text.ts`, allowlist) before any admin render; every portal route resolves and owner-binds the org via `getPortalAuth` (impersonation read-only). The load-bearing remainder is `isInternal` gating on every read path.

## Page purpose

Make submitting, tracking, and delivering work feel effortless and trustworthy. The client always knows where their request stands and what is next; the team always knows what is theirs, what is queued, and what is overdue; internal work is invisible to the client, always, on every read path. This is the surface both audiences share, so it is where the internal/external boundary is drawn in public.

## Why we are on this page

A retainer client's entire experience of Tahi between calls is this surface. They paid for capacity; the requests page is where that promise is either legible ("my thing is active, this other thing is next, delivery is Thursday") or opaque ("I sent it into a void"). For the team it is the daily worklist: the owner triages and fans out, the teammate moves their three requests through the pipeline and talks to the client and the team in the same thread without ever crossing the streams. Every competitor in the productized-service space wins or loses on this one feeling, and most lose it by leaking the messy middle (internal chatter, scope arguments, other clients' names) or by hiding capacity behind vague "in progress" labels.

**The single experiential throughline, which every element must serve or be cut:**

> The client always knows where their thing is; the studio never shows its workings.

Premium here is honesty rendered calmly: the request number and revision count read like ledger entries, the queue makes capacity a visible promise rather than a hidden bottleneck, and the internal/external boundary is so clearly drawn that a teammate can never mis-send and a client can never over-see.

## Personas and jobs-to-be-done

**1. The client contact (submitting).** A marketing lead at a retainer client, mid-morning, has a thing they need.
- *Mindset:* task-focused, mildly time-pressed, does not want to learn a PM tool.
- *JTBD:* "Describe what I need in a minute, in my words, and trust it landed."
- *Must see:* one obvious New-request button, a short form shaped to the kind of work (the intake form), a confirmation that it is in the queue and where.
- *Must feel:* heard. Like handing a note to a person, not filing a ticket.

**2. The client contact (tracking).** The same person three days later, checking status before their own stand-up.
- *Mindset:* scanning, slightly anxious, will screenshot the page for their boss.
- *JTBD:* "Show me where everything is and what is next, in ten seconds, without asking."
- *Must see:* their requests only, honest statuses in the seven public labels, queue position for what is waiting, due dates, the thread if they need detail.
- *Must feel:* informed and safe. Never a hint of other clients, internal notes, or scope debates.

**3. The teammate.** A designer or developer with two clients' worth of scoped access (05).
- *Mindset:* protective of focus; lives in the board and the detail thread all day.
- *JTBD:* "See what is mine, move it through the pipeline, reply to the client and mutter to the team in the same thread, and never breach privacy by accident."
- *Must see:* their scoped list/board, the composer's explicit reply-vs-note toggle, due-countdown ramps, the revision counter before they promise another round.
- *Must feel:* impossible to mis-send. The boundary does the worrying for them.

**4. The owner (Liam / Staci).** Runs triage, capacity, and the fan-out.
- *Mindset:* cross-client, interrupt-driven, wants density and reach.
- *JTBD:* "See everything across clients, balance the tracks, spot overdue and off-track, create or fan out work in seconds."
- *Must see:* all clients, workload view, track occupancy, bulk actions, quick-add, saved views for their recurring triage lenses.
- *Must feel:* in command of a calm machine. The queue is the truth; nothing is hiding.

**The tension to resolve:** the client needs warmth and radical simplicity; the owner needs density and speed; the teammate needs a boundary that cannot be fumbled. **The call:** one dataset, three compositions. The portal is a short, read-mostly story; the admin list/board is a dense ledger; and the internal/external boundary is a first-class visual object (chip + tinted panel + toggle), never a colour convention you have to remember.

## What others do (and what we take)

- **ManyRequests** - per-service intake forms (with conditional logic) auto-spawn an assignable card; interchangeable Kanban / List / Queue; timestamped proofing comments on files. We have the forms + columns; we adopt file proofing comments and the form-to-card flow.
- **Designjoy** - a pure queue: one or two requests *active* at a time, finishing auto-pulls the next; card order is "what's next". Capacity is a visible hard constraint. This is exactly our `tracks` model; we surface it explicitly.
- **Queue.dev** - client self-serve pause/unpause (banking days), one form spanning subscriptions, one-offs, and credits. A roadmap input for client control.
- **Service Provider Pro / Wayfront** - order -> payment -> delivery, splitting an order into internal tasks while the client sees order-level progress. Validates our internal/external separation.
- **Linear** - an SLA indicator that ramps from grey to red as a deadline nears; a triage inbox before workflow status; Cmd-K and `C`-to-create. We adopt the due-countdown ramp, the Submitted column as the triage lane, and quick-create.
- **Trello** - inline quick-add at the foot of a column; columns as the status mental model.
- **ClickUp / Height / Notion** - one dataset, many saved named views with per-view filters. We promote FilterBar combos to first-class saved views.
- **Asana** - subtasks and "waiting on" dependencies; we keep nesting to one level and say so.

## Experience principles

1. **Numbers lead.** `#requestNumber`, `Rev n of max`, queue position, due-countdown and capacity are set in tabular figures and lead their rows; decoration follows. If a number is not the first thing you read in a cell, the cell is wrong.
2. **The boundary is an object, not a colour.** Internal content is marked by a chip that says "Internal", a tinted panel, and a toggle that names the audience; colour alone never carries the meaning. A colour-blind teammate on a dim train must still be unable to mis-send.
3. **Capacity is honest and visible.** For retainer clients, "one active per track, next in queue" is shown in both portal and admin; the constraint is a feature, so hiding it would be a lie. A full queue is stated plainly, never disguised as progress.
4. **One dataset, many lenses.** List, board, workload and saved views are views over the same rows with the same filters; switching lenses never changes the data. A filter set worth keeping is one click from becoming a named view.
5. **Two interactions to act.** Inline status edit, quick-add, drag-to-move; the detail is one click deep, never a maze. Anything that takes three clicks today must take two in this design.
6. **The portal is a story, not a console.** Clients get reading order (what is active, what is next, what is done), not tooling order; admin affordances simply do not exist there. Absence, not disablement (contract with 05 and 09).
7. **Scarcity rules hold.** One hero figure per screen (the open count), the leaf radius only on the primary CTA and the Active-now queue marker, brand green as the only accent, status colours only when literally true, hairlines over cards.

## The client-privacy boundary (the design contract)

This is the trust-critical surface; the design must render the boundary unmistakably because the server enforces it absolutely.

- **Already hardened (design can rely on it):** client-submitted rich text (descriptions, thread messages) is sanitised server-side via `lib/sanitize-rich-text.ts` before any teammate render, so the thread renders rich text confidently; every portal route resolves and owner-binds the org via `getPortalAuth`, so a client only ever reads/writes their own org's rows; impersonation is read-only.
- **Load-bearing remainder:** `isInternal` gating (messages AND whole requests) plus `scopeFlagReason` hiding must be enforced on **every** read path (messages list, files, activity, exports, notifications, MCP tools). A Playwright e2e harness (Clerk test mode) exists to lock these flows; "tested before trusted" is the gate.
- **Design consequences:** internal messages and internal requests carry the Internal chip + tinted panel everywhere they appear (list, board, detail, activity); the composer defaults to "Reply to client" and switching to "Internal note" changes the panel, the chip, and the send-button label all at once; scope flags and reasons render only in admin surfaces and are absent (not blanked) in the portal.

## Anatomy

Six sub-surfaces on the shell's cream canvas, one shared frame:

1. **Admin list** (`/requests`, list view): page title + actions, saved-views row, FilterBar row, bulk bar (when selecting), quick-add row, the DataTable.
2. **Admin board** (`/requests`, board view): same header stack, then the track-occupancy strip (when filtered to one retainer client) and the kanban columns; timeline sub-view behind the board's own view tab.
3. **Workload** (`/requests`, workload view, admin only): assignment table with capacity bars.
4. **Request detail** (`/requests/[id]`): bare-ink header zone, pipeline progress hairline, main column (thread + composer, description, sub-requests, files with proofing, activity), right rail (`20rem`).
5. **Client portal** (`/requests` and `/requests/[id]` for the client audience): read-only list with the queue strip, the dynamic intake slide-over, the external-only detail.
6. **The intake form builder**: canonical home **Settings > Intake & boards** (spec 09); specced here in full because this surface consumes it. The requests page links to it ("Edit intake forms"), never embeds a second editor.

## Layout and composition - desktop

Max content width `80rem`, side gutters `2rem`, vertical rhythm `1rem` between header stack rows, `1.5rem` before the content region. Page title "Requests" is bare ink (shell frame); the one hero figure is the open count beside it in ledger display style (`2.5rem`, weight 300, tabular).

### 1. Admin list

Vertical order: (1) title row: "Requests" + hero open count left, actions right (`Export CSV` secondary, `Bulk create` secondary, `AI draft` secondary, `New request` primary leaf CTA); (2) **saved-views row**; (3) FilterBar row with the ViewToggle right-aligned; (4) bulk bar, only while rows are selected; (5) the table card with the **quick-add row** pinned above the header row.

```
+------------------------------------------------------------------------------+
| Requests   14 open                [Export CSV] [Bulk create] [AI draft] [+ New request]
|                                                                              |
| ( All active ) ( Mine ) ( Unassigned ) ( Due this week ) ( Delivered ) + Save view
|                                                                              |
| [Status: Active v] [Category: All v] [Type: All v] [Created v] [Search....]  [list|board|load]
|                                                                              |
| +--------------------------------------------------------------------------+ |
| | +  Quick add - title, then Enter        [Client v]  [Due date]  Enter to add
| |--------------------------------------------------------------------------| |
| | [] | TITLE                        | CLIENT   | STATUS      | PRI | DUE | UPD |
| |--------------------------------------------------------------------------| |
| | [] | #014 Homepage hero refresh   | (o) Acme | (In Progress v) | High | Due in 2 days | 2 Jul |
| | [] | #013 Fix nav flicker  (Internal) | (o) Acme | (Submitted v)  | --  | Due 12 Aug   | 1 Jul |
| | [] | ! #011 Brand audit           | (o) Kiwi | (Client Review v)| Urgent | Overdue by 1 day | 30 Jun |
| +--------------------------------------------------------------------------+ |
+------------------------------------------------------------------------------+
```

- **Columns (exact, in order, matching the build):** checkbox `2.25rem` -> Title flexible min `18rem` (scope-flag icon `0.8125rem` when flagged, mono `#num` in `--text-xs` subtle ink, title link `--text-sm` 600 ink, quiet "Internal" chip when `isInternal`) -> Client min `10rem` (xs avatar + muted name) -> Status `11rem` (inline-editable chip) -> Priority `7rem` -> Due `7rem` (right zone, countdown chip) -> Updated `7rem` right-aligned muted. Numbers right-aligned, tabular.
- Header row: sand `--color-th-bg`, ledger-label column heads (`--text-2xs` 600 uppercase `0.08em` subtle ink). Row height `3rem`, hairline `--color-border-subtle` between rows, hover `--color-row-hover`, whole row clickable to the detail.
- **Saved-views row sits ABOVE the FilterBar** (the view is the noun, the filters are its definition). Defaults first (All active, Mine, Unassigned, Due this week, Delivered), then user-saved chips, then "+ Save view".
- Client list variant: no checkbox, no Client column, read-only status badges, no quick-add; otherwise identical bones.

### 2. Admin board

Same header stack. When the board is filtered to a single retainer client (client filter or arrival from the client detail), the **track-occupancy strip** renders between FilterBar and columns. Columns come from `kanbanColumns` (per-client override over global default); every `statusValue` maps to a real `requests.status`.

```
+------------------------------------------------------------------------------+
| TRACKS   Small track: #014 active . 2 queued   |   Large track: free          |
+------------------------------------------------------------------------------+
| o Submitted 3      | o In Review 2    | o In Progress 1   | o Client Review 2 | o Delivered 8 |
| +---------------+  | +-------------+  | +--------------+  |                   |               |
| | #016  Due 9 Aug|  | ...         |  | | #014 Due in 2d|  |                   |               |
| | Long request  |  |               |  | | Homepage hero |  |                   |               |
| | title clamps  |  |               |  | | refresh       |  |                   |               |
| | to two lines  |  |               |  | | [Active now]  |  |                   |               |
| | High . Rev 1/3|  |               |  | | (o)(o)+1      |  |                   |               |
| | [Queued #2](o)|  |               |  | +--------------+  |                   |               |
| +---------------+  |               |  |                   |                   |               |
+------------------------------------------------------------------------------+
```

- **Column header anatomy (in order):** colour dot `0.4375rem` (the column's `colour` or its status dot token) -> label `0.8125rem` 600 ink -> count `0.6875rem` 600 subtle tabular -> spacer -> quick-add "+" `1.375rem` icon button -> column actions menu.
- **Card anatomy (top to bottom):** white surface, hairline `--color-border`, radius `--radius-lg`, padding `0.625rem 0.75rem`, internal gap `0.375rem`. Row 1: mono `#num` (`--text-2xs`, subtle) left, due-countdown chip right. Row 2: title `--text-sm` 600 ink, **2-line clamp**. Row 3 (foot): priority badge (only High or Urgent), `Rev n/3` quiet chip when `revisionCount > 0`, sub-request indicator (branch glyph + count) when nested children exist, then a right-aligned `PeopleStack` of `1.25rem` avatars (max 3 + `+n` overflow). Retainer cards add exactly one queue marker: `Active now` (leaf-radius `--radius-leaf-sm`, `--color-brand-100` fill, `--color-brand-dark` ink; the one leaf on this screen besides the CTA) or `Queued #2` (quiet secondary chip).
- Drag: card lifts (shadow `--shadow-floating`), target column shows a `2px` dashed `--color-brand` drop slot; drop on a card (not a gap) opens the **nest confirm dialog**: title "Make this a sub-request?", body `Make "A" a sub-request of "B"? Only works when both belong to the same client.`, confirm "Make sub-request", cancel "Cancel". Cross-client drops are refused before the dialog opens. Dropping a nested child on a column un-nests it.
- Client board: read-only (no drag, no quick-add, no column menu); their columns are the per-client set.

### 3. Workload (admin only)

Keep the built table, reskinned: header row (ledger labels `Team member | Assigned | Capacity`), one row per member `3.25rem` tall: `2rem` circle avatar + name (`--text-sm` 500) + role (`--text-xs` subtle), assigned count centred `5rem` column (tabular, 600), capacity bar flexible (track `0.5rem` tall, `--color-bg-tertiary`; fill `--color-brand` to 75%, `--color-warning` to 100%, `--color-danger` above; the percentage as text beside the bar so colour never stands alone). Final `Unassigned` row on `--color-bg-secondary` with a warning-toned count. Clicking a row filters the list view to that assignee (a saved-view seed).

### 4. Request detail

Two columns: main flexible, **right rail `20rem`**, gutter `1.5rem`, max width `68.75rem`. The header sheds its card: bare ink on cream (shell rule: titles never sit in cards).

```
+------------------------------------------------------------------------------+
| Requests / #014 Homepage hero refresh                     (breadcrumb, shell) |
|                                                                              |
| #014  (In Progress)  (High priority)  (Scope flagged)  (Rev 1 of 3)          |
| Homepage hero refresh                                     (o)(o)(o) +2       |
| Acme Ltd . Created 12 Jun . Due in 2 days                                    |
| ==== ==== ====------ ---------- ----------                                   |
| Submitted In Review In Progress Client Review Delivered                      |
|                                                                              |
| +--------------------------- main -----------------+  +----- rail 20rem ----+|
| | THREAD  12  (2 new)                              |  | ACTIONS             ||
| |  (o) Staci . 2h ago                              |  |  Status (chip v)    ||
| |      Here's the first pass, two options...       |  |  Flag scope creep   ||
| |  .............................................   |  | PEOPLE              ||
| |  +-------------------------------------------+   |  |  PM / Assignees /   ||
| |  | INTERNAL  (o) Liam . 1h ago               |   |  |  Followers          ||
| |  | Hold option B until the invoice clears.   |   |  | TIME  (timer, log)  ||
| |  +-------------------------------------------+   |  | CHECKLISTS          ||
| |  (o) Jordan (Acme) . 20m ago                     |  | CALLS               ||
| |      Option A please - can we see it mobile?     |  | DETAILS             ||
| |---------------------------------------------------|  |  Type / Category /  ||
| | [ Reply to client | Internal note ]               |  |  Priority / Assignee||
| | [ composer ......................... ] [Send]     |  |  Delivery phase /   ||
| +---------------------------------------------------+  |  Due / Estimated    ||
| | DESCRIPTION | SUB-REQUESTS | FILES + proofing | ACTIVITY (collapsed)      ||
+------------------------------------------------------------------------------+
```

- **Header order (exact, top to bottom):** breadcrumb (shell top bar; includes the parent for sub-requests) -> meta row: mono `#num`, `StatusBadge`, High-priority pill (only when high/urgent), Scope-flagged pill (admin only), `Rev n of 3` chip -> title `1.5rem` 700 ink + right-aligned `PeopleStack` -> meta line (`--text-xs` muted): org (admin only), "Created {date}", due-countdown -> **pipeline progress**: five equal segments over `STATUS_FLOW`, `3px` bars, done + current in `--color-brand`, labels `--text-2xs` (current one 600 brand-dark). On Hold and Cancelled are not steps: they render as the status chip's state, and the progress bar freezes at the last linear stage with a quiet "(on hold)" suffix on the current label.
- **Main column order:** Thread (first, with count + "n new" chips), composer at its foot, then Description (sanitised rich text), Sub-requests, Files (with proofing), Activity (collapsed, comments-only filter available).
- **Right rail order (redesigned):** 1 Actions (status chip, scope-flag toggle, make top-level for sub-requests) - state first; 2 People (PM / Assignees / Followers) - who owns it; 3 Time (admin: live timer + manual log + recent entries); 4 Checklists; 5 Calls (admin); 6 Details (Type, Category, Priority, Assignee, Delivery phase, Due date, Estimated, Delivered) - reference last. Each rail section: ledger label heading, hairline-bordered white card, `1rem` padding.
- Portal detail: same bones, external-only proof: no Actions, Time or Calls; People shows the team's public stack; the meta row never shows the scope pill; the thread contains external messages only; the composer has no toggle.

### 5. Client portal (list, intake, detail)

- **List:** title "Requests" + their open count, primary "New request" leaf CTA, the queue strip for retainer clients ("Your tracks" version of the occupancy strip), the read-only table (columns: Title with `#num`, Status badge, Priority, Due, Updated), FilterBar with the client status options.
- **Intake (the dynamic form):** a **slide-over** from the right, `30rem` wide, full height (full-screen sheet on mobile). Order: heading "New request", category selector first (it resolves the form), then the resolved form's questions in author order, then Title (always), rich-text Details, optional due date, submit. All seven question types render (spec below). Submitting shows the queue confirmation state.
- **Detail:** the external-only proof described above.

### 6. The intake form builder

**Canonical home: Settings > Intake & boards (spec 09).** The kanban-columns editor lives there too. This surface links to it (list overflow menu: "Edit intake forms", board column menu: "Edit columns"); it never embeds a duplicate editor. The builder itself (specced here, rendered inside the 09 settings frame as a focused slide-over editor):

- **Header:** form name input, category select (or "All categories"), client select (default "All clients"), "Default form" toggle.
- **Left pane (questions, `24rem`):** drag-reorderable rows, each `3rem`: grip, type icon, label (inline editable), Required toggle, delete. "+ Add question" opens a type picker (the seven types).
- **Right pane (live preview):** renders the exact portal slide-over form as the client will see it, updating live.
- **Resolution-priority preview (the trust piece):** a bar above the preview with two selects, "Client" + "Category", and a result line: `Acme Ltd + Design will get: Design brief v2 (client override)`. The parenthetical names which rule won: (client + category), (client default), (category default), (global default).

## Layout and composition - mobile

375px reference. The shell provides bottom tabs; content stacks in one column with `1rem` gutters, touch targets `>=44px` (min `2.75rem`).

- **List (both audiences):** the table collapses to stacked row cards (`3.5rem`+): line 1 mono `#num` + status chip right; line 2 title (1-line clamp); line 3 client (admin) + due chip. Saved-views row and FilterBar become horizontally scrollable chip rows (no wrap, edge-fade). Quick-add collapses into the "+" primary button (opens the dialog).
- **Board:** columns become full-width, one at a time, horizontal scroll with snap; a column pager dot row sits under the occupancy strip. Drag is replaced by the card's "Move to..." menu (also the keyboard path on desktop).
- **Detail:** stacks: header (bare ink), pipeline bar, thread, composer (sticky above the tab bar), then the rail sections as full-width cards in the same order, Details collapsed by default.
- **Intake:** the slide-over becomes a full-screen sheet; inputs `>=2.75rem`, `1rem` font (prevents iOS zoom).

```
+---------------------------+
| (mark)  Requests    (Q)   |  <- shell condensed top bar
+---------------------------+
| 3 open                    |
| (All active)(Mine)(Due..> |
| [Status v][Search......]  |
| +-----------------------+ |
| | #014     (In Progress)| |
| | Homepage hero refresh | |
| | Acme . Due in 2 days  | |
| +-----------------------+ |
| | #013     (Submitted)  | |
| | Fix nav flicker       | |
| | Acme . Due 12 Aug     | |
| +-----------------------+ |
|                    [ + ]  |  <- leaf FAB = New request
+---------------------------+
| (o) (o) [o] (o) (=)       |  <- shell bottom tabs
+---------------------------+
```

## Component spec

Reuse `DataTable`, `BoardView`/`KanbanBoard`, `FilterBar`, `StatusBadge`, `Badge`, `PeopleStack`, `RequestThread`, `MessageComposer`, `FilesPanel`, `SubRequestsPanel`, `PeoplePanel`; this is a reskin + hardening, not a rebuild.

**Saved-views row**
- Purpose: promote FilterBar combos to first-class named lenses.
- Anatomy: horizontal row, `2rem` tall chips, gap `0.5rem`: default chips, user chips, then "+ Save view" quiet text button. Each user chip has an overflow menu (Rename, Update with current filters, Delete). A chip = pill (`--radius-full`), `--text-xs` 600, `0.375rem 0.75rem` padding.
- Tokens: active chip white `--color-bg` fill + `--color-border-strong` hairline + ink text; inactive transparent + `--color-text-muted`, hover `--color-bg-secondary`.
- States: rest / hover / focus-visible ring / active / a "modified" dot on the active chip when current filters differ from the saved definition (with "Update" in its menu). Empty: only defaults + "+ Save view". Saving opens a one-field name dialog.

**Quick-add row (admin list)**
- Purpose: capture a request in one breath.
- Anatomy: `2.75rem` row pinned above the table header: "+" icon `1rem`, title input (flexible, placeholder "Quick add - title, then Enter"), client SearchableSelect `10rem`, optional due date `7rem`, hint text "Enter to add" (`--text-2xs` subtle).
- Tokens: `--color-bg-secondary` fill, hairline `--color-border-subtle` all sides, inputs borderless until focus (brand ring).
- States: rest / focused / submitting (row dims, spinner replaces hint) / success (optimistic row inserts at top with a `200ms` fade, input clears, focus stays for the next one) / error (toast "Could not create request", input retains text). Commits `POST /api/admin/requests` with size small, category development, priority standard, status submitted. Esc clears.

**Inline status chip (list + rail)**
- Purpose: one-click pipeline moves without leaving the row.
- Anatomy: `Badge` (dot + label + chevron `0.75rem`), `--radius-sm`, opens a portal-mounted menu of the seven public statuses, each with its dot + label.
- Tokens: the `--status-{value}-bg/text/border/dot` variable set; menu on `--color-bg` + `--shadow-floating`.
- States: rest / hover (border lifts to `--color-border-strong`) / focus-visible / open / saving (chip shows the new value optimistically; reconcile reverts on failure with toast "Could not update status") / read-only (client: no chevron, no menu).

**Due-countdown chip**
- Purpose: deadline honesty at a glance, colour + text, never colour alone.
- Anatomy: calendar glyph `0.625rem` + text `--text-xs` 500; overdue adds a warning triangle.
- Ramp: on-track (> 3 days): quiet muted text "Due 12 Aug", no fill. Due-soon (<= 3 days): `--color-due-soon-bg` fill, `--color-due-soon-text`, "Due in 2 days" / "Due tomorrow" / "Due today". Overdue: `--color-overdue-bg` / `--color-overdue-text`, "Overdue by 1 day" / "Overdue by n days". Delivered/cancelled rows: no chip.

**Board column + card** - as specced in Layout. Additional states: empty column ("No requests" `--text-xs` subtle, centred); drag-over (dashed brand slot); count updates optimistically; keyboard path = card focus + "Move to..." menu (`m` shortcut).

**Track-occupancy strip (retainer clients)**
- Purpose: make the Designjoy constraint visible and calm.
- Anatomy: full-width hairline-bordered bar, `2.75rem`, ledger label "TRACKS" left, then one segment per track: track name ("Small track" / "Large track"), then either `#014 active` (mono number + Active-now leaf marker) or "free" (muted), then ". n queued" when a queue exists. Portal variant is labelled "Your tracks".
- Tokens: `--color-bg` surface, `--color-border` hairline all sides, ledger labels `--text-2xs` 600 uppercase subtle.
- States: all free / one active / active + queued / hidden (non-retainer client or multi-client view).

**Queue badges (cards + portal rows)** - `Active now`: leaf-radius `--radius-leaf-sm`, `--color-brand-100` fill, `--color-brand-dark` ink, 600 (the rare leaf). `Queued #2`: `--color-bg-secondary` fill, `--color-border-subtle` hairline, muted ink, tabular number.

**Thread message (the ledger log)**
- Purpose: correspondence that reads like a record, not a chat skin.
- Anatomy (external): `1.75rem` circle avatar, then author name `--text-sm` 600 ink + role suffix for clients ("Jordan (Acme)") + timestamp `--text-2xs` subtle + "(edited)" when edited; body below in `--text-base` ink, rich text; hairline `--color-border-subtle` between messages; NO bubbles, NO brand fill, own messages are not right-aligned (the log is chronological and neutral).
- Anatomy (internal): the whole message wraps in a panel: `--color-bg-secondary` fill, **full hairline `--color-border` on all sides** (never a left-border accent, house rule), `--radius-md`, `0.75rem` padding, with an `INTERNAL` ledger chip (uppercase `--text-2xs` 600, `--color-bg-tertiary` fill, subtle border) leading the meta row. Uses surface + chip, not amber, not warning colour (internal is not a warning).
- States: unread (a small brand dot before the author name until read), edited, deleted ("Message removed" muted italic), reaction row (existing `messageReactions`), attachment chips under the body, voice-note player row when present.

**Message composer**
- Purpose: reply and annotate without ever mis-sending.
- Anatomy (admin): top row = audience segmented control, two options: **"Reply to client"** (eye icon) and **"Internal note"** (lock icon), `role="radiogroup"`, each `>=2rem` tall; when internal, an inline hint "{Client} won't see this" and the whole composer surface tints `--color-bg-secondary` with `--color-border-strong` hairline (all sides); the send button label changes with the audience. Below: Tiptap editor (min `4.5rem`), @mention support, attachment button + drag-drop overlay ("Drop files to attach"), voice-note button, then footer: attachment chips left, send button right ("Send to client" / "Add internal note", primary fill, Cmd/Ctrl+Enter).
- Anatomy (client): no toggle; placeholder "Add a comment or question..."; send button "Send".
- Tokens: white surface, `--color-border` hairline, `--radius-lg`; focus = brand border + `2px` `--color-brand-100` ring; internal tint per above.
- States: rest / focused / internal / uploading (chip spinners) / sending ("Sending..." + disabled, `aria-busy`) / error (inline "Could not send. Your message is still here." + retained content) / empty-disabled send.

**File row + proofing comments**
- Purpose: feedback anchored to the artefact (the ManyRequests adopt).
- Anatomy: file row (`3rem`: type icon in a `--radius-leaf-sm` wrapper, filename 500 ink, size + uploader `--text-2xs` subtle, actions: preview, download, delete admin-only). Expanding opens the proof panel: preview left (image with numbered pin markers `1.25rem` circles at x/y; video/audio with timestamped markers), comment list right (each: pin number, author, timestamp or timecode, body, Resolve). "Add comment" places a pin (click the image / mark the timecode) then focuses a small composer. Proof comments respect the same internal/external toggle and chips as the thread.
- States: no comments ("No comments on this file yet."), unresolved count chip on the file row ("2 open comments"), resolved (pin turns quiet), portal variant shows external comments only. **Requires a new `fileComments` table (migration first, see risks).**

**AI draft wizard (entry point only)**
- Purpose: draft one or many requests from a loose brief (existing `AiRequestWizard`, lazily loaded; both audiences, endpoint differs).
- Anatomy on this surface: the "AI draft" secondary button (sparkle icon) in the title-row actions; the wizard itself is a modal owned by its component and keeps its current internals; on completion the list revalidates and a toast confirms.
- States: hidden for viewer-role impersonation (as built); loading (deferred chunk spinner in the button); done (toast `{n} requests drafted`).

**CSV export**
- Purpose: the requests ledger, portable.
- Anatomy: "Export CSV" secondary button (download icon) hitting `/api/admin/export/requests`; exports the current canonical columns, statuses as the public labels, dates ISO.
- States: rest / busy (button spinner, disabled) / failure toast `Export failed. Try again.`; the export must apply the same access scoping and must never include internal message bodies or scope reasons (column-level privacy, same contract as the portal).

**Bulk action bar (admin list)**
- Purpose: act on a selection without leaving the table.
- Anatomy: a `2.75rem` strip that appears above the table when `selectedIds > 0`: count text "{n} selected" (`--text-sm` 600 `--color-brand-dark`), then three controls: "Change status" (menu of the seven statuses + Archive), "Assign" (menu with a PM / Assignee / Follower role tab row, then the team list), "Archive" (secondary, confirm dialog), then a right-aligned "Clear" text button.
- Tokens: `--color-brand-50` fill, hairline `--color-border` all sides (replace the built border-bottom-only), `--radius-md`; menus on `--color-bg` + `--shadow-floating`.
- States: rest / a busy spinner on the active control while the batch PATCH runs / done (bar dismisses, toast "{n} requests updated") / partial failure (toast "Some requests could not be updated." + selection retained).

**Sub-requests panel (detail main column)**
- Purpose: one level of nested work under a parent, same org only.
- Anatomy: ledger label "SUB-REQUESTS" + count, then hairline-separated rows `2.75rem`: drag grip (reorder writes `subPosition`), mono `#num`, title link, status chip (read-only here), due chip; footer "+ New sub-request" quiet button (admin) opening `NewRequestDialog` with the client locked to the parent's org.
- States: empty (admin: "No sub-requests yet." + the button; client: panel hidden when empty), reordering (row lifts), child rows never show a nested panel of their own (one level, by design).

**Activity log (detail, collapsed by default)**
- Purpose: the audit trail without the noise.
- Anatomy: a collapsed disclosure row "Activity" + count + chevron; expanded: a flat list, each entry `2.5rem`: `0.375rem` event dot, actor name 500, verb phrase muted ("moved to In Progress", "uploaded homepage-v2.png", "logged 1.5h"), timestamp `--text-2xs` subtle right-aligned; a "Comments only" filter chip at the top.
- States: collapsed / expanded / filtered / empty ("Nothing yet.").

**Checklists (rail card)**
- Purpose: lightweight done-ness inside a request without spawning tasks.
- Anatomy: per checklist: title row (`--text-sm` 600 + "{done}/{total}" tabular counter + delete, admin) then item rows `2.25rem`: checkbox `1.125rem`, label `--text-sm` (struck + muted when done); footer inline "Add item" input committing on Enter; card footer "+ Add checklist" (admin).
- States: empty (admin-only "Add a checklist" affordance; hidden for clients when empty), checking is optimistic with reconcile, counter animates its tick.

**Board timeline sub-view**
- Purpose: date-based planning over the same items (behind the board's own Kanban / Timeline tabs).
- Anatomy: one row per request; items with `startDate` render as bars from start to due, coloured by their status column's dot colour; items with only a due date render a milestone diamond at the due date; a labelled today line; overdue-and-unfinished bars override to `--color-danger` (literally true). Date ticks in ledger micro-labels.
- States: read-only for clients; hover reveals a card summary popover (also focus-reachable); empty ("No dated requests yet.").

**Right-rail sections** - each: ledger-label heading, white card, hairline all sides, `--radius-lg`, `1rem` padding, `1rem` gap between sections. Details rows: label `--text-xs` subtle `4.5rem` fixed, value `--text-sm` ink; admin-editable values use `SearchableSelect` size sm. Scope-flag toggle: secondary button; when flagged it shows "Scope flagged" with danger tint (literally true) and the reason renders below it in `--text-xs` muted, admin only. Time card: live timer readout in tabular mono (`--text-lg`), start/pause/stop controls `>=2rem`, recent entries as hairline rows.

**Intake question renderers (all seven)**
- `text`: label above (ledger label + red asterisk when required), input `2.75rem`, white fill, `--color-border-strong` hairline, `--radius-md`, brand focus ring.
- `textarea`: as text, `6rem` min height, auto-grow.
- `url`: as text + link glyph left; validates on blur ("Enter a full link, like https://...").
- `select`: SearchableSelect, single; placeholder "Choose one".
- `multiselect`: checkbox-chip group (each option a `2.25rem` toggle chip; selected = brand-50 fill + brand-dark ink + border-strong).
- `checkbox`: single `44px` row: box `1.125rem` + label; whole row toggles.
- `file`: dropzone `6rem`, dashed `--color-border-strong` hairline, "Drop a file or browse"; uploads via the R2 presign flow; chip list below.
- Shared states: required error ("This one's needed.") inline under the field, `aria-invalid` + `aria-describedby`; disabled while submitting.

**Form builder** - per Layout section 6. States: unsaved-changes dot on the editor title + confirm on close; preview error when a question has no label ("Every question needs a label."); delete question confirm; resolution preview updates live as name/category/client change.

## Motion and dynamism

All motion uses `--ease-out cubic-bezier(.22,1,.36,1)`; nothing springs or bounces.

- **Inline status change / quick-add insert:** optimistic paint, new row fades in `200ms`; failure reverts with an instant swap + toast.
- **Drag (board):** lift = shadow + `1.02` scale over `110ms`; drop settles `200ms`; the column count ticks with a `150ms` fade. Hover-triggered card affordances play to completion, never reverse mid-way.
- **Saved-view switch / view toggle:** content cross-fades `150ms`; no slide.
- **Slide-over (intake, form builder):** panel slides in from the right `240ms`, backdrop fades `150ms`; close reverses.
- **Composer audience toggle:** surface tint + chip cross-fade `150ms`; the send-button label swaps instantly (state clarity beats choreography).
- **Pipeline progress bar:** segment fill animates `300ms` on status change.
- **Thread:** new incoming message fades in `200ms`; the "n new" chip pulses once (`300ms`), never loops.
- **Reduced motion:** `prefers-reduced-motion: reduce` disables drag animation (instant moves), all fades/slides become instant state changes, the pulse is dropped; drag itself still works, and the "Move to..." menu is always available.

## Accessibility (WCAG 2.2 AA)

- **Landmarks + names:** the page is the shell's `<main>`; the table has `aria-label="Requests"`; the board is a labelled region per column (`role="group"`, `aria-label="In Progress, 3 requests"`); the thread is `role="log"` with `aria-live="polite"` for incoming messages; the intake slide-over and form builder are `role="dialog" aria-modal="true"` with focus trap + Esc + focus return.
- **Keyboard paths:** every drag has a non-drag path: card focus + Enter opens, `m` (and the card menu) opens "Move to column"; quick-add commits on Enter, clears on Esc; the inline status chip is a real button + menu (arrow keys, Esc); saved-view chips are toggle buttons in a `role="tablist"`-like row with arrow-key movement.
- **The boundary is not colour:** internal messages carry the text chip "INTERNAL" and the panel; the composer toggle is a named radiogroup; the send button re-states the audience. Screen readers hear the audience twice before send.
- **Contrast:** status chip text uses the `--status-*-text` on `--status-*-bg` pairs (audit each at 4.5:1); due-soon/overdue chip pairs likewise; muted ink `--color-text-muted` on cream passes; `--color-text-subtle` reserved for `--text-2xs` labels at 600 weight. Focus rings `2px` `--color-brand-dark` on cream, `>=3:1`.
- **Targets:** `>=44px` on all mobile controls (row cards, chips get padded hitboxes, composer toggle, FAB); `>=24px` floor on desktop (pin markers get a `1.5rem` hitbox).
- **Errors + status changes:** inline errors name the fix and wire `aria-describedby`; optimistic failures announce via the toast's `role="status"`; "n new" unread counts are text, not colour.
- **Reduced motion** per the Motion section; **forced-colors:** chips keep borders so they survive tint-stripping; the pipeline bar's current step is also bolded text.

## States and flows

- Submit (client, dynamic intake) -> confirmation with queue position -> appears in admin list/board (Submitted column = the triage lane).
- Move through the pipeline (drag, "Move to..." menu, or inline chip) -> client sees the external status update; Delivered sets `deliveredAt`.
- Internal note vs client reply (composer toggle): the note renders with the Internal panel + chip for the team and **never exists** in the portal.
- Internal request (`isInternal`): appears with the Internal chip in admin surfaces; absent from the portal entirely.
- Nest / un-nest a sub-request (same-org only; one level; cross-client refused with the server's error surfaced in the dialog).
- Queue full for a track: new request enters the queue with a visible position; the strip shows "n queued"; finishing the active request promotes the next.
- Revision count reaching max: `Rev 3 of 3` chip gains warning tint + "limit reached" tooltip; admin sees a nudge to flag scope.
- Scope-flagged: admin sees pill + reason (rail); the portal shows nothing at all.
- Saved view lifecycle: save / rename / update / delete; "modified" dot when live filters drift from the saved definition.
- Loading (skeleton rows / skeleton columns), error ("Could not load requests." + Retry), empty and first-run (below), search-no-results ("Nothing matches your filters." + "Clear filters").
- Impersonation (owner viewing as client): portal composition, writes disabled with the shell tooltip.

## Copy deck

Calm plain NZ voice. Hyphens only.

- **Statuses (canonical seven, everywhere):** `Submitted`, `In Review`, `In Progress`, `Client Review`, `On Hold`, `Delivered`, `Cancelled`. (Plus `Draft` and `Archived` as admin-only edge labels.)
- **Priorities:** `Urgent`, `High`, `Standard` (Standard renders as "--", no badge).
- **Due ramp:** `Due 12 Aug` / `Due in 2 days` / `Due tomorrow` / `Due today` / `Overdue by 1 day` / `Overdue by 4 days`.
- **Queue:** strip label `Tracks` (portal: `Your tracks`); `Small track` / `Large track`; `#014 active` / `free` / `2 queued`; card markers `Active now` / `Queued #2`; portal confirmation `You're #2 in the queue. We'll start as soon as a track is free.`
- **Revisions:** `Rev 1 of 3`; at limit `Rev 3 of 3` + tooltip `Revision limit reached. Extra rounds may be out of scope.`
- **Scope (admin only):** toggle `Flag scope creep` / flagged `Scope flagged`; reason dialog title `Flag scope creep`, field label `Why is this out of scope?`, confirm `Flag it`, cancel `Cancel`. Client-facing: nothing, ever.
- **Composer:** toggle `Reply to client` / `Internal note`; internal hint `{Client} won't see this`; send `Send to client` / `Add internal note` / (portal) `Send`; sending `Sending...`; error `Could not send. Your message is still here.`; placeholders (admin) `Reply to {Client}, or switch to an internal note...`, (client) `Add a comment or question...`; drop overlay `Drop files to attach`.
- **Thread:** empty `No messages yet. Start the conversation below.`; unread chip `2 new`; edited `(edited)`; removed `Message removed`.
- **Internal chips:** message/request chip `Internal`; list tooltip `Internal - not visible to the client`.
- **List / views:** title `Requests`; hero `{n} open`; default views `All active`, `Mine`, `Unassigned`, `Due this week`, `Delivered`; `+ Save view`; save dialog `Name this view` / `Save`; chip menu `Rename`, `Update with current filters`, `Delete`; quick-add placeholder `Quick add - title, then Enter`, hint `Enter to add`; buttons `New request`, `Bulk create`, `AI draft`, `Export CSV`; search `Search requests`.
- **Board:** nest dialog title `Make this a sub-request?`, body `Make "{A}" a sub-request of "{B}"? Only works when both belong to the same client.`, confirm `Make sub-request`; move menu `Move to...`; empty column `No requests`; move error toast `Could not move request`.
- **Bulk bar:** `{n} selected`; `Change status`; `Assign` (tabs `PM`, `Assignee`, `Follower`); `Archive`; `Clear`; archive confirm `Archive {n} requests? They'll leave the active views.` / `Archive`; toasts `{n} requests updated` / `Some requests could not be updated.`
- **Sub-requests:** heading `Sub-requests`; `+ New sub-request`; empty `No sub-requests yet.`
- **Activity:** disclosure `Activity`; filter `Comments only`; verbs `moved to {Status}`, `uploaded {filename}`, `logged {n}h`, `flagged scope`, `added {name}`; empty `Nothing yet.`
- **Checklists:** `Add a checklist` / `+ Add checklist`; item placeholder `Add item`; counter `{done}/{total}`.
- **Timeline:** view tabs `Kanban` / `Timeline`; empty `No dated requests yet.`
- **AI / export:** button `AI draft`; toast `{n} requests drafted`; button `Export CSV`; error toast `Export failed. Try again.`
- **Workload:** headers `Team member`, `Assigned`, `Capacity`; `Unassigned`; empty `No team members yet.`
- **Detail:** main-column headings `Thread`, `Description`, `Sub-requests`, `Files`, `Activity`; rail headings `Actions`, `People`, `Time`, `Checklists`, `Calls`, `Details`; detail rows `Type`, `Category`, `Priority`, `Assignee`, `Delivery phase`, `Due date`, `Estimated`, `Delivered`; `Make top-level`; on-hold suffix `(on hold)`; not-found `Request not found` / `Back to requests`.
- **Files / proofing:** `Drop a file or browse`; `No comments on this file yet.`; `2 open comments`; `Add comment`; `Resolve`; delete confirm `Delete this file? This can't be undone.` / `Delete`.
- **Intake:** heading `New request`; category label `What kind of work is this?`; title label `Give it a name`; details label `Tell us what you need`; submit `Submit request`; submitting `Submitting...`; required error `This one's needed.`; url error `Enter a full link, like https://...`; success heading `Got it.`; success body `Your request is in. We'll pick it up from here.`
- **Empty / first-run:** admin list `No requests found` / `Requests will appear here once clients start submitting work.`; client first-run `No requests yet. Tell us what you need.` + CTA `Submit a request`; filters `Nothing matches your filters.` + `Clear filters`; load error `Could not load requests.` + `Retry`.
- **Form builder:** `Intake forms` (home: Settings > Intake & boards); `+ New form`; `Add question`; `Required`; preview label `Client preview`; resolution preview `{Client} + {Category} will get: {Form name} ({rule})` with rules `client + category override`, `client default`, `category default`, `global default`; unlabelled-question error `Every question needs a label.`; links from this surface `Edit intake forms`, `Edit columns`.

## Tokens and visual reference

| Where | Token / value |
|---|---|
| Canvas | `--color-bg-cream` (never hardcoded) |
| Hero open count | ledger display `2.5rem` weight 300, tabular, `--color-text` |
| Table / cards / rail surfaces | `--color-bg`, hairline `--color-border` (all sides), radius `--radius-lg` |
| Table header row | `--color-th-bg`, ledger labels `--text-2xs` 600 uppercase `0.08em` `--color-text-subtle` |
| Row hover / hairlines | `--color-row-hover` / `--color-border-subtle` |
| Request number | mono, `--text-xs` (list) / `--text-2xs` (cards), `--color-text-subtle`, zero-padded `#014` |
| Status chips | `--status-{submitted,in-review,in-progress,client-review,on-hold,delivered,cancelled}-{dot,bg,text,border}` (add the missing on-hold + cancelled sets) |
| Due chips | quiet: `--color-text-muted`; due-soon: `--color-due-soon-bg/text`; overdue: `--color-overdue-bg/text` |
| Priority badges | Urgent danger-tint, High warning-tint, via `Badge` `priorityTone` |
| Internal panel + chip | panel `--color-bg-secondary` + `--color-border` all sides, `--radius-md`; chip `--color-bg-tertiary` + `--color-border-subtle`, uppercase `--text-2xs` 600 |
| Composer (internal state) | surface `--color-bg-secondary`, border `--color-border-strong` all sides |
| Queue Active-now marker | `--radius-leaf-sm`, `--color-brand-100` fill, `--color-brand-dark` ink (a rare leaf) |
| Queued chip | `--color-bg-secondary` + `--color-border-subtle`, tabular number |
| Primary CTA (New request) | brand fill, white text, `--radius-leaf-sm`, hover `--color-brand-dark` |
| Focus rings | `2px` `--color-brand-dark` on cream; `--color-brand` on white surfaces |
| Capacity bars | fill `--color-brand` / `--color-warning` (>75%) / `--color-danger` (>100%), track `--color-bg-tertiary` |
| Pipeline progress | segments `3px`, done/current `--color-brand`, rest `--color-border` |
| Drag states | lift `--shadow-floating`; drop slot `2px` dashed `--color-brand` |
| Motion | `110-300ms`, `--ease-out cubic-bezier(.22,1,.36,1)`, full reduced-motion fallback |
| Font | Manrope; titles `--text-sm` 600 in rows, `1.5rem` 700 detail h1; all numbers tabular |
| Leaf budget per screen | primary CTA + Active-now marker (list/board); primary CTA + file-icon wrappers (detail). No other leaves |

## Deliverables for Claude design

1. **Admin list - desktop:** hero count, saved-views row, FilterBar, quick-add row, full table with an open inline status menu on one row and one Internal-chipped row.
2. **Admin list - bulk state:** rows selected, bulk bar (Change status / Assign with role tabs / Archive).
3. **Admin board - retainer client:** occupancy strip, per-client columns, full card anatomy, Active-now + Queued #2 markers, one card mid-drag with the drop slot, plus the nest confirm dialog.
4. **Workload view.**
5. **Request detail - admin:** bare-ink header + pipeline bar, ledger-log thread with an internal message panel, composer in both toggle states (client-reply and internal-note), right rail in the specced order, files panel with an expanded proofing preview (pins + comments).
6. **Client portal list:** Your-tracks strip, read-only table, first-run empty state.
7. **Portal intake slide-over:** all seven question types rendered, one required error shown, and the success/queue-confirmation state.
8. **Portal request detail:** external-only proof (no internal anything, no scope, no admin rail sections).
9. **Form builder** (inside the Settings frame): question list + live preview + resolution-priority preview.
10. **Mobile (375px):** client list, intake sheet, portal detail with sticky composer; admin board single-column with pager.
11. **Dark mode:** admin list + detail + portal list on the dark tokens.
12. **State sheet:** due ramp (all five strings), queue full, rev-limit chip, scope-flagged (admin) vs the same request in the portal, internal vs external message side by side, saved-view modified dot, loading skeletons, filters-empty, load error.

**Integration constraints (so output drops into the codebase):**
- Reuse `DataTable`, `BoardView`/`KanbanBoard`, `FilterBar`, `StatusBadge`, `Badge`, `PeopleStack`, `RequestThread`, `MessageComposer`, `FilesPanel`, `SubRequestsPanel`, `PeoplePanel`; tokens only, no hardcoded hex (replace the thread's amber internals and brand-fill bubbles with the specced token treatment).
- Custom column `statusValue` must map to a real `requests.status` or cards vanish; design within the canonical status set and add the missing `--status-on-hold-*` / `--status-cancelled-*` token sets + `REQUEST_STATUS_CONFIG` entries.
- One-level nesting only (`parentRequestId`, same-org); never imply deeper trees.
- Reconcile legacy `type` vs `size` and the priority set (list urgent/high/standard vs detail standard/high) before build; design assumes Urgent / High / Standard.
- Client privacy is load-bearing and server-enforced: sanitise client rich text on write with `lib/sanitize-rich-text.ts` at every portal ingestion point; scope every portal route with `getPortalAuth`; `isInternal` gating on every read path; scope reasons never serialised to the portal. New portal write surfaces follow the same rules.
- Proofing comments require a new `fileComments` table + APIs (migration first, `IF NOT EXISTS`); do not build the UI before the schema (CLAUDE.md rule).
- The form builder and kanban-column editor live in Settings > Intake & boards (09); this surface links to them and never embeds duplicate editors.
- Board keyboard path ("Move to..." menu) ships with drag, not after; honour reduced motion, 44px touch, AA contrast; no single-side borders anywhere (fix the composer footer's border-top while reskinning).
- D1 100-bind cap on `inArray` (chunk org/id lists); keep admin vs client status-filter sets in sync as saved views land.

## Why this is premium

The productized-service competitors win on one feeling: the client always knows where their thing is, and the studio always knows what is next, with no awkward leakage of the messy middle. Tahi beats them by making that feeling editorial. The request number, revision counter and queue position read like entries in a ledger rather than gamified chrome; the track strip turns capacity into an honest promise instead of a hidden bottleneck; and the internal/external boundary is drawn as a physical object (a chip, a tinted panel, a toggle that renames the send button) so the client trusts they are seeing their whole polished side and the teammate physically cannot mis-send. Saved views and a real per-client intake builder turn a generic board into a tool shaped to each service, and the de-bubbled correspondence log makes the thread feel like a studio's records rather than a chat app wearing a suit. It is the difference between a Trello clone and a studio's operating system.

## Open decisions and risks

1. **Client-privacy boundary (partly hardened, still load-bearing).** Two prior gaps are now closed: client rich-text input is sanitised server-side before it reaches an admin (no stored XSS), and all portal routes scope via `getPortalAuth` (no cross-tenant reads/writes; impersonation is read-only). What remains load-bearing and must be tested before requests become daily-trusted: the `isInternal` message/request gating and scope-reason hiding must be enforced on every read path so an internal note or a scope reason can never reach the portal. There is now a Playwright e2e harness (Clerk test mode) to lock these flows down, so "tested before trusted" is a concrete, automatable gate, not a hope.
2. **Legacy `type` vs new `size`** dual columns and a **priority-set mismatch** (detail standard/high vs list urgent) need reconciling.
3. **File-upload / voice-note bugs** were flagged in March; verify before leaning on them (the proofing panel leans hard).
4. **Custom kanban `statusValue`** must map to real statuses or cards disappear.
5. **D1 100-bind cap** on `inArray` (chunk org/id lists); keep admin vs client status-filter sets in sync as saved views are added.
6. **Status-set drift (confirmed in code):** the inline chip offers `on_hold` / `cancelled` with no `REQUEST_STATUS_CONFIG` entries (labels fall back to raw values), the bulk menu offers `archived` instead, and the schema comment omits both. Decide the canonical set (this brief assumes the seven public labels + Draft/Archived admin-side), add tokens + config, and migrate stray rows.
7. **Thread de-bubbling.** Replacing brand-filled own-message bubbles with a neutral ledger log changes how ownership reads; confirm with Liam before build (it is the single most visible change on the busiest screen).
8. **Saved-views persistence + sharing.** Per-user via the `useUserPreference` store is the cheap path; decide whether owner-authored views can be published studio-wide (a different storage shape) before the API is set.
9. **Quick-add defaults** (size small, category development, priority standard) risk mis-filed rows; consider a per-user default category or a required client+category pair before enabling for high-volume triage.
10. **Proofing comments are net-new schema.** No `fileComments` table exists today; migration (with `IF NOT EXISTS`, reviewed against prod) plus admin/portal APIs with `isInternal` gating must land before the proof panel UI.
11. **Track data plumbing.** The occupancy strip needs `tracks` + queue order joined into the requests payloads (admin and portal); today the portal has `/api/portal/tracks` but the board payload does not carry queue position; confirm the shape before design handoff hardens it.
