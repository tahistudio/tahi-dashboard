## Studio Requests - design requirements
Group: studio-requests. Audience: studio (Tahi team). Routes: /requests (list, board, workload, capacity strip, focus-ring system), /requests/[id], new request dialog, AI wizard, bulk create.
Prepared for a Claude Design pass. Read alongside docs/superpowers/plans/2026-09-13-page-catalogue.md (row `/requests`, row `/requests/[id]`) and docs/superpowers/plans/2026-09-13-design-review-checklist.md (Studio row "Requests: list, board, detail, dialog, focus, capacity, workload").

---

### 1. Purpose and audiences

Requests is the shared spine of the whole platform: it is the one surface both a Tahi team member and a client log into and see, from two different lenses over the same rows. For the studio audience (this group), the job is triage and delivery: see everything across every client in one board, find what needs picking up, move it through the pipeline, keep a thread with the client, and know who is overloaded. Three seats use it differently:

- **Admin (Tahi org, NEXT_PUBLIC_TAHI_ORG_ID)**: unrestricted. Sees every client's requests, Workload view, Export CSV, Bulk create, AI draft, the scope-flag control, the Internal-request toggle.
- **Team member with access scoping** (`teamMemberAccess`, deny-by-default target, not yet flipped live per T1.15): should see only the orgs their scope rule grants (`resolveAccessScoping` already filters `GET /api/admin/requests` server-side by org id; the nav-gating and default-deny flip are still open work, see section 4). A scoped hire must never see another client's requests in the list, the board, the workload cards, or CSV export.
- **Client org (any other Clerk org)**: routed to the exact same `/requests` route and `/requests/[id]` detail, but the audience prop narrows everything: no Workload view, no Export CSV, no Bulk create, no scope-flag or Internal-request controls, no other client's rows ever reach the client's browser (`app/api/portal/requests` is a separate, org-scoped route, never the admin one).

**What this surface must never show:**
- A client must never see another org's requests, files, messages, or people, in list, board, workload-adjacent, or detail. This is proven for the request routes in `e2e/tenancy-isolation.spec.ts` (STATUS.md "Tenancy proof").
- A client must never see an `isInternal` request or an internal-only message on a request thread. The switch that marks a request or a message internal is a one-way boundary object (`request.isInternal`, `message.isInternal`); the portal read paths filter on it and the client-side UI never renders the toggle at all for a client.
- A client must never see Workload, capacity numbers about other clients, Export CSV, Bulk create, or the AI wizard's `submitEndpoint`/`wizardEndpoint` pointed at the admin routes - the client wizard is wired to the portal endpoints only.
- Messages-hidden rule: the standalone `/messages` nav item is hidden for every client by default (TASKS.md, "Messages hidden for every client by default", shipped 27ae697f); the request detail's own thread is therefore the client's only messaging surface, and any notification that would have pointed a client at `/messages` is deliberately resolved back to the request instead (`lib/notification-links.ts`, tested).
- Super-admin-only areas: none of the Requests surface itself is gated to super_admin specifically (Liam and Staci) beyond the ordinary admin/client split; access scoping and deny-by-default are gated by `teamMemberAccess` rows and `resolvePermissions`, not by a separate super-admin tier, and the studio owner + MCP service token always bypass per the security invariant in `lib/require-feature.ts`.

---

### 2. Pages, sub pages and entry points

- **`/requests`** - the top-level page (`app/(dashboard)/requests/page.tsx`, server component, gated by `requirePageFeature('requests')`). Renders `<RequestList isAdmin={isAdmin}>` inside a Suspense boundary with a skeleton fallback. One URL, four peer views selected by state (persisted per-browser, not per-URL param beyond `?view=`): **List**, **Kanban/Board**, **Workload** (admin only), **Timeline**. Entry: sidebar nav item "Requests", or any notification/deep-link that resolves to a request (lands on `/requests` with `?request=<id>` or similar, opening the detail overlay/panel described below).
- **`/requests/[id]`** - the detail route (`app/(dashboard)/requests/[id]/page.tsx` + `request-detail.tsx`). Reached by clicking any request row/card/timeline bar, or a notification deep link. Renders the full request: thread, status engine, sub-requests, people, files, time, checklists. Not a separate page shell so much as a composed detail view that takes over the same URL space the way Tasks does with `?task=`.
- **New request dialog** - modal, opened from the primary "New request" button in the header (`RequestsHeaderActions`), or from a saved-view/empty-state CTA. Contains the standard form (client picker for admin, category, brief rich text, intake questions per category, priority for admin / queue placement for client, size, ideal due date, brand select when the client has brands, start date + estimated hours under a "More details" disclosure) plus an inline path into the **AI wizard** (see below) and "Save and create another".
- **AI wizard** - two entry points on the same conversational component (`components/tahi/ai-request-wizard.tsx`): (a) `<AiRequestWizardPanel>` embedded inside the new-request dialog itself, so the AI conversation and the manual form are one surface, opened via the header's overflow menu "AI draft" or a link inside the dialog; (b) `<AiRequestWizard>` as a standalone right-hand `SlideOver` drawer, opened from the Requests toolbar. Every draft it produces can be handed back to the form for editing, or posted directly, and every draft in a multi-draft batch is created as its own row (parent + sub-requests for admin, siblings with a shared note for the portal) rather than only the first one.
- **Bulk create dialog** - admin only, opened from the header overflow menu ("Bulk create") or a secondary in-page button. One title/category/type/description applied across a chosen set of client orgs (filterable by plan, searchable), posts once to `POST /api/admin/requests/bulk`, reports how many rows were actually written.
- **Sub-request creation** - opened from inside the detail's Sub-requests panel ("New sub-request"), client locked to the parent's org, no client picker, own title. One level of nesting only (v1 disallows grandchildren).
- **Capacity strip** - not a separate route; a card that renders above the List view, client audience only, and only when no search/filter/saved-view is active (`showCapacityStrip`), showing one lane per active track plus a numbered queue.
- **Workload view** - a peer view (not a dialog), admin/owner audience only, per-teammate load cards against a fixed capacity of 5 open requests, plus retainer track-occupancy cards.
- **Focus (keyboard focus-ring system)** - not a page or a mode; "focus" in this group's brief refers to the shared `:focus-visible` ring pattern (`requests-focus.css` in the Claude Design project, `tahi-focus-ring` class in the live app) applied consistently across every input, button, row, and card on this surface. There is no separate "Focus" view or panel to design; treat it as an accessibility/interaction-state requirement threaded through every other page in this group (see section 3, "dark mode" and "375/768" rows).

---

### 3. States and variants

One line per state per page/surface.

**`/requests` (List/Kanban/Workload/Timeline)**
- Loading: `<LoadingSkeleton rows={5}>` fallback while the page's Suspense boundary resolves; row/card skeletons inside `DataTable` while `useResource` reads are in flight.
- Empty (no rows at all): leaf-icon `EmptyState`, title "No requests found", description "Requests will appear here once clients start submitting work." (admin) / "Submit your first request and the Tahi team will get started." (client), CTA "Submit a request" for clients only, no CTA for admin.
- Empty (filtered to zero): separate `FilteredEmptyState`, title "No requests match", description "Try clearing a filter or the search.", CTA "Clear filters".
- Error: each read surfaces its own error state (per CLAUDE.md's three-state rule); a failed fetch falls back to an empty array rather than a broken render (`catch { setData([]) }` pattern is the code convention here).
- Read-only Client view (impersonation/act-mode preview): `readOnly` prop on `RequestsHeaderActions` hides "New request" entirely and only shows the overflow menu if there is still something in it for a read-only admin (Export CSV); no write controls render.
- Member seat vs admin seat: a scoped team member sees the same List/Kanban/Timeline but never Workload (admin-only view key), and their row set is pre-filtered server-side to their granted orgs; the rail's client filter and any saved view not defined for their audience is silently dropped rather than shown broken.
- 375px: the header collapses to a single "New" button plus an overflow icon-button (44x44 below `md`); the rail becomes a Filters bottom sheet with 44px targets (`touch` prop threads through `RailSelect`/`RailViewItem`); List view degrades from `DataTable` columns to a card list at narrow widths so nothing clips; the view switcher drops labels and shows icons only below `lg`.
- 768px: rail may still collapse to the sheet depending on the exact breakpoint chosen by the design; view switcher labels likely still visible at this width band; verify against the actual `lg`/`md` Tailwind cutoffs used (`iconOnlyBelow="lg"` on the SegmentedControl, sheet threshold in `requests-rail-layout.tsx`).
- Dark mode: every colour on this surface must resolve through CSS tokens (`--color-*`, `--status-*-bg/dot/text`), never a hardcoded hex, so `.dark` never needs a special-case override here.
- Print/public: not applicable - Requests has no public or print variant; the client-facing "papers" (proposals/schedules/contracts) are a different group.

**`/requests/[id]` (detail)**
- Loading: skeleton state while the request, thread, participants, files, time entries and checklists resolve (multiple independent reads, each should show its own loading treatment rather than blocking the whole detail).
- Empty sub-states: no messages yet (empty thread composer prompt), no files, no checklists, no sub-requests, no blockers - each needs its own calm empty copy, not a shared generic one.
- Error: a failed PATCH must roll back optimistic state (the checklist save already does this: `saveChecklists` restores the previous value and toasts "Checklist update failed" on a non-OK response) - this pattern should be the template for every other inline edit on this page.
- Read-only Client view: People card and the "Unassigned" pill are hidden for a client unless the API actually returns people; the client instead sees the studio team pulled from `/api/portal/team`. The scope-flag control, the Internal-request toggle, and the internal-only messages never render for a client at all.
- Member seat vs admin seat: an admin sees the scope-flag banner/control and the Internal toggle; a scoped team member sees the same detail as admin (access-scoping is by org, not by field) once T1.15/T1.18 land; today access scoping already filters which requests a scoped hire can open at all.
- 375px: the rail/left-column collapse that shipped in the "dummy-client walk-through" fixes (LW series, 2026-09-13) must hold - the detail previously collapsed badly at mid widths and was fixed; treat this as the regression bar, not a fresh problem.
- 768px: two-column layout (thread-first left column, details/people/checklists right rail) should still read as two columns or gracefully stack; verify no rail content is clipped or pushed off-screen.
- Dark mode: status badges, priority tags, revision chip, scope-flag banner and the checklist rows all key off tokens (`--status-*`, `--priority-*`); confirm no bare hex survives in any of these in the design file.
- Print/public: not applicable.

**New request dialog / AI wizard / Bulk create**
- Loading: client list and category options load via SWR before the bulk-create org picker is usable; the AI wizard shows a typing indicator (not a spinner) while the model call is in flight, and a "notice" strip (not a chat bubble) when the model was never reached and a keyword/heuristic draft was used instead.
- Empty: bulk create's org list can be filtered/searched down to zero matches - needs an explicit "no clients match" state, not a blank list.
- Error: bulk create surfaces `errorMsg` inline above the actions ("Title is required", "Select at least one client", or the server's error message) rather than a toast, so the dialog itself carries the failure; the AI wizard's model-unreachable path is the "notice" message type, not a hard error.
- Read-only Client view: the dialog itself is still usable by a client for their own org (submitting a request is a client action); Bulk create and the priority field (vs a client's queue-placement field) never render for a client.
- Member seat vs admin seat: identical to admin for a scoped team member, since request creation itself is not scope-gated beyond which org the member is allowed to pick.
- 375px: the dialog must remain a full-height sheet or scrollable modal with 44px controls; the rich-text toolbar buttons and the sliding segmented size control both need touch-sized targets.
- Dark mode: rich-text editor placeholder, intake-question borders, and the AI wizard's chat bubbles all need dark tokens; check the AI wizard's category colour map (`CATEGORY_STYLES` etc.) resolves through CSS vars, not the literal hex currently hardcoded in the component's style maps.

---

### 4. Features and actions

#### `/requests` (list/board/workload/timeline)

**Works today (from the code):**
- List, Kanban and Timeline views for every audience; Workload restricted to admin (`viewKeysFor`).
- Saved views with live counts, per-dimension filters (status, category, client, type, created), sort with a direction toggle, Clear filters, Save as default (`lib/requests-views.ts`, `RequestsRail`).
- Search across title, request number and client name.
- Quick-add directly from a board column (creates a request pre-set to that status).
- Nest-by-drag: dropping a card on another card turns the dragged one into a sub-request of the target (`onNest`, matches `POST /api/admin/requests/[id]/nest`).
- Client capacity strip (one lane per active track, numbered queue, "Next up" pointer) - client audience, list view, no active filter/search/saved-view.
- Workload cards (per-teammate load against a fixed capacity of 5, plus retainer track-occupancy cards) for admin.
- Team member access scoping enforced server-side on `GET /api/admin/requests` (`resolveAccessScoping`), so a scoped hire's list is already pre-filtered even before the nav-gating work lands.
- Export CSV and Bulk create, admin only, both wired to real endpoints (`POST /api/admin/requests/bulk`).
- New request dialog and the AI wizard (both entry points), Save-as-default rail preference is browser-local (does not follow the user to another machine, same as Tasks).

**Exists but wrong or half built (STATUS/TASKS/catalogue):**
- P3 / STATUS "board drop targets": on the Kanban board, a card in the SAME column as the dragged card still lights as a drop target - cosmetic bug inside the shared `KanbanBoard`, shared with the Tasks board (0.25d fix, catalogue Section 3).
- Fixture em dashes appear in design data only (catalogue note on the `/requests` row) - a design-data hygiene issue, not a code bug; confirm the Claude Design file's sample data has no em/en dashes before shipping copy from it.
- Deny-by-default (T1.15) has not shipped yet: today "no access row" for a non-admin team member likely still defaults toward unrestricted rather than denied; this is a security-floor item that affects what a scoped hire's Requests list actually shows until T1.15/T1.18 land (Batch F in the catalogue's proposed order).

**Planned or missing (TASKS/catalogue, backlog ids named where they exist):**
- T2.7 - daily-briefing dedup between the overview home card and the nav-bar briefing; not specific to Requests but the same "Open/Overdue/Due this week" vocabulary appears on both surfaces and should read as one source of truth.
- Nav gating (T1.18) - CORRECTION: this item is stale. TASKS.md marks T1.18 shipped ("Shipped 2026-08-18 (session 2)": "Team-member nav + page gating made real (adminOnly honoured, 6 leaky features mapped + guarded)"), and `filterNav` in `components/tahi/nav-model.tsx` already honours `item.adminOnly` (`if (item.adminOnly && !isEffectiveAdmin) return false`). Not Requests-specific, but a scoped hire's access to this page's sibling surfaces is no longer blocked by dead nav-gating code; the remaining open item in this family is T1.15 (deny-by-default), not T1.18.
- *Proposal*: an `aria-controls` wire-up between the view-switcher tabs and their tabpanel, noted as an open ARIA gap in the component's own doc comment (`requests-view-switcher.tsx`) - flagged there as deliberately deferred, not a hidden bug; worth a design decision on whether to close it now.

#### `/requests/[id]` (detail)

**Works today (from the code):**
- Thread with internal/external message boundary (`isInternal` on both the request and each message), rich replies, "Seen by" read receipts for the studio (CT.9), unread-count-clearing on open.
- Status engine (Submitted → In Review → In Progress → Client Review → Delivered, plus Cancelled/Archived/On Hold), scope-flag toggle (admin only) with a reason, Internal-request toggle (admin only).
- Sub-requests panel: create, list, unlink (promote back to top-level), one level of nesting.
- People/participants (add/remove), Files, Time entries, Checklists (persisted via `PATCH` to `requests.checklists`, JSON on the row - this already writes for real; treat any backlog note that says checklist writes "don't exist" as stale unless re-verified against the current `saveChecklists` code path).
- Request steps: real `GET`/`POST` routes exist (`/api/admin/requests/[id]/steps`, org-access-guarded) building a tree via `orderIndex`; verify with the BE whether the detail UI actually renders and writes through these routes today or only reads them, since the backlog's "request steps... UI claims they work, no writes exist" note may predate this route's existence.
- Client review flow: `POST /api/portal/requests/[id]/review` with `decision: 'approve' | 'changes'`, posts the client's note to the thread, moves the status, notifies the studio team.
- Blockers (add/remove, `/blockers` routes), duplicate request, AI triage and AI draft-reply routes.
- Client-side view hides the People card/Unassigned pill unless the API returns real people, substituting the studio team from `/api/portal/team`.

**Exists but wrong or half built:**
- **Revision counter is dead**: `revisionCount`/`maxRevisions` are read and rendered ("Rev n/3", a popover explaining the allowance) on every surface that touches the request, but no route anywhere increments `revisionCount` - confirmed by code search, not just backlog claim. It is permanently stuck at whatever it was seeded at. (next-surfaces-assessment notYet, catalogue `/requests/[id]` row.)
- **Activity feed is synthesised client-side, not persisted**: `buildActivityEvents` composes the feed from whatever the client already has in memory (messages, status changes inferred from current state), so there is no durable record of who changed what and when; a page refresh or a second viewer session cannot reconstruct history that happened elsewhere. (next-surfaces-assessment notYet, catalogue `/requests/[id]` row.)
- V1-QA.1 - live-verify the client detail as an actual client: scope-flag pill absent, own messages render under the client's real name, the Approve/Request-change banner shows correctly on a `client_review` request. Marked as the last unverified client-facing piece of this surface.
- `messageReactions` table exists in the schema with zero call sites anywhere in the thread UI - a decide-or-delete item (0.5d), not currently exposed on this page at all.

**Planned or missing:**
- A real per-request activity log (new table + a write on every mutation) to replace the synthesised feed - no backlog id beyond the next-surfaces-assessment note; treat as *proposal* until a task id is assigned.
- Persisting `revisionCount` increments somewhere in the status-change or review-decision path (currently no write path at all) - same, *proposal* pending a task id, though the display contract (Rev n/3, a popover on remaining count) is already fully designed and should not be re-designed, only wired.

#### New request dialog / AI wizard / Bulk create

**Works today:**
- Full form parity documented in the Claude Design file's own comment block against the live component (`components/tahi/new-request-dialog.tsx`): intake questions per category and client, brand picker when the org has brands, sub-request mode (locked parent, no client picker), "Save and create another" with a success line, a collapsed "More details" block for start date + estimated hours, AI assist returning 2-3 editable/removable drafts with "Create all" alongside hand-back to the form.
- Predictive autofill (TP.5, shipped): due date, priority and size suggestions from a Haiku call grounded on the client's 180-day history, with heuristic fallback and a "Fix it" escape hatch; live-smoked on production.
- AI wizard: markdown rendering fixed (bold/lists only, shared `lib/chat-markdown.ts`), composer auto-grows 1-8 lines with a 44px send control, every draft in a multi-draft batch actually gets created (not just the first), timelines/estimates come from one canonical hours table the model cannot override, and client context (org name, industry, website, brands, last five requests) reaches the prompt with an access-scoping check on the admin side.
- Bulk create: real endpoint, plan filter, name search, select-all-filtered, reports the actual created count back to the page.

**Exists but wrong or half built:**
- None specifically flagged in STATUS/TASKS beyond the general AI-wizard fixes above, which are already merged (LW.13, LW.14, LW.15, LW.16, LW.17) - "Live checks by Liam pending" per STATUS, so treat these as built-but-not-yet-live-verified rather than broken.

**Planned or missing:**
- GI.1 (parked, not in the current batch order) - a WhatsApp/Slack chat bot that turns a client message into a request through the same intake validation as this dialog. *Design first per its own backlog note; do not build ahead of a design pass.*
- CLAUDE.md's "Planned Schema Additions" batch 5 (`requestForms`) already exists as `requestForms`-style intake question resolution (category/org-specific override, resolution priority most-specific-wins) - the dialog's `IntakeBlock`/intake-question rendering is the UI half of this; confirm with BE whether the schema table itself is live or still the JSON-question-list-per-category convention seen in the design file's `D.INTAKE`.

---

### 5. Data and integrations

- **Tables**: `requests` (status, category, type, priority, isInternal, scopeFlagged, scopeFlagReason, revisionCount, maxRevisions, checklists JSON, formResponses JSON), `messages` (isInternal boundary, to be migrated to the conversations model per CLAUDE.md but today lives on the request thread directly), `requestSteps` (tree via orderIndex), sub-request parent/child linkage on `requests` itself, `files`, `timeEntries`, participants/people join data, `tags`.
- **API routes** (admin): `GET/POST /api/admin/requests`, `GET/PATCH /api/admin/requests/[id]`, `.../bulk`, `.../bulk-assign`, `.../[id]/messages`, `.../[id]/files`, `.../[id]/time-entries`, `.../[id]/sub-requests` (+`/reorder`), `.../[id]/participants` (+`/[participantId]`), `.../[id]/steps` (+`/[stepId]`), `.../[id]/blockers` (+`/[linkId]`), `.../[id]/scope-flag`, `.../[id]/reads`, `.../[id]/calls`, `.../[id]/duplicate`, `.../[id]/nest`, `.../[id]/triage`, `.../[id]/draft-reply`, `.../[id]/voice-notes` (dead per STATUS: "voice notes no longer exist in the tree" - this route should be verified as removed or genuinely dormant).
- **API routes** (portal): `GET/POST /api/portal/requests`, `GET/PATCH /api/portal/requests/[id]`, `.../messages`, `.../files`, `.../reads`, `.../review`, `.../steps`, `.../sub-requests`. Every portal route resolves through `getPortalAuth`, is org-scoped, and refuses the Tahi org.
- **Third parties**: none direct on this surface. The AI wizard and predictive autofill call Claude (Haiku) through the dashboard's own AI endpoints (`ai_request_wizard`, `predict_entry_fields`), not a third-party SaaS. Notifications ride the existing dispatcher (bell + email) on request-created, assignment, bulk-assign and participant events.
- **MCP parity** (CLAUDE.md rule 14): `list_requests`, `get_request`, `create_request`, `create_sub_request`, `duplicate_request`, `nest_request`, `assign_request`, `bulk_assign_requests`, `update_request_status`, `update_request_fields`, `add_request_participant`/`remove_request_participant`, `get_request_steps`/`create_request_step`/`update_request_step`/`delete_request_step`, `get_request_messages`/`post_request_message`, `mark_request_read`, `list_request_files`, `list_request_time_entries`/`log_request_time`, `ai_request_wizard`, `ai_draft_request_reply`, `ai_triage_request`, `flag_scope_creep`/`unflag_scope_creep`, `predict_entry_fields`. Any new UI capability built for this group (a revision-counter write, a real activity log write) must get an equivalent MCP tool the same week it ships, per the MCP parity rule.
- **What must be honest**: no fake numbers anywhere on this surface - Workload's "n / 5" capacity, the capacity strip's queue position, and the headline band's Open/Overdue/Due-this-week counts must all be live counts off the same audience-visible base, not sample data. No dead buttons: every action in `RequestsHeaderActions`' overflow menu, every dialog CTA, and the revision chip's popover must map to a real write or be removed rather than left decorative (the revision counter today reads as a real allowance but is not decremented anywhere - this is exactly the kind of dishonest-looking-real control CLAUDE.md and STATUS both flag repeatedly across other surfaces, and it applies here too).

---

### 6. Design system contract

- **Primitives that apply**: `PageHeader` pattern (title + subtitle + header actions, one width across all four views), the headline band (`Band`/`BandCell`, four tiles, first one the lead, tone vocabulary `t-money/t-growth/t-time/t-danger/t-work`), the left rail (`Rail`/`RailSec`/`RailItem`/`RailField`/`RailSelect`/`RailDir`, collapsible-to-a-strip on narrow rows, pin/fold), `DataTable` for List view with a card fallback at narrow widths, `SlideOver` for the standalone AI wizard drawer, `ConfirmDialog` for destructive actions, leaf radius on primary CTAs and icon backgrounds, CSS var tokens throughout (never hardcoded hex), the shared `SegmentedControl` for the view switcher with full WAI-ARIA tab semantics (roving tabindex, arrow/Home/End navigation, 44px targets).
- **What the existing design file gets right**: the Requests set (`requests.jsx` + `requests-kit.jsx`, `requests-listview.jsx`, `requests-board.jsx`, `requests-dialog.jsx`, `requests-toolbar.jsx`, `requests-capacity.jsx`, `requests-workload.jsx`) is explicitly named in the catalogue as "the reference for the band and rail standard" and carries a Pass 3 **SHIP** verdict. It already matches the live component set closely: same four views, same audience-narrowing logic (`matchAudience`), same capacity-strip and workload-card behaviour, same dialog feature list (the file's own header comment cross-references `components/tahi/new-request-dialog.tsx` line by line and confirms parity on G1-G5 and A1). Treat this file as the ground truth for band/rail geometry on every other surface being designed, not just this one.
- **What the design must change**: (1) the P3 kanban drop-target bug (a card's own column lighting as a drop target) should be fixed in the design's board interaction spec before the fix is re-verified in code, since both share `KanbanBoard`; (2) the design file's fixture data carries em/en dashes in sample copy - strip these before any text is copied into production strings, per the hard no-dash rule; (3) the design's `requests-dialog.jsx` header comment marks its own ARIA gap (`aria-controls` between tabs and tabpanel) as deliberately open - a reviewer should either accept this as intentionally deferred or ask for it to be closed, not assume it is an oversight; (4) nothing in the design file currently represents the revision-counter-as-dead-control problem or the synthesised-activity-feed problem, because both are backend gaps, not a design defect - flag them to Liam rather than expecting a visual fix.

---

### 7. Open questions for Liam

1. Should the revision counter (`Rev n/3`) be wired to actually decrement on a real event (e.g., a client "changes requested" review decision), or should the control be removed until that's built? A or B.
2. Should the per-request activity feed become a real persisted log (new table, a write on every mutation) before or after the Messages overhaul (Batch E) lands, given both touch the same request-detail surface? A (before) or B (after).
3. Is `messageReactions` being built for real on this thread, or deleted from the schema? Yes (build) or no (delete)?
4. Should request steps (the `requestSteps` table and its guarded API routes) be exposed as a client-visible checklist-of-steps in the detail UI now that real GET/POST routes exist, or does "checklist" (the JSON column already wired) fully replace that concept? A (steps) or B (checklist only, retire steps)?
5. Is the Kanban drop-target fix (P3) in scope for this design pass, or does it stay a pure code fix with no design change needed? Yes or no?

---

### 8. Acceptance for the design review

Checks a reviewer can tick from a screenshot at 1440 and 375, light and dark:

1. All four views (List, Kanban, Workload, Timeline) share one header width and one headline band position; nothing shifts between views.
2. Workload view and the client capacity strip never appear together in the same screenshot for the same audience (Workload is admin-only, the strip is client-only).
3. Every status badge, priority tag, and the revision chip resolve through status/priority tokens, not literal colours, and read correctly in both light and dark.
4. At 375px, the header shows exactly "New" plus one overflow icon-button, the rail is not visible inline (it is a bottom sheet), and every visible control is at least 44px tall.
5. The empty state (zero requests) and the filtered-empty state (zero matches) are visually distinct and each carry the correct copy from this document, not a shared generic message.
6. The request detail at 375px does not clip the rail or collapse into a broken width - this is a regression bar from the LW.9-era fixes, not a fresh ask.
7. The scope-flag control and the Internal-request toggle are visible in the admin screenshot and absent in the client screenshot of the same request.
8. The AI wizard's typing indicator and its "model unreachable" notice strip are two visually distinct states, neither one styled as a normal chat bubble.
9. The bulk-create dialog's org list, plan filter, and error line (when present) all fit inside the modal's scroll area at 375px without the footer actions being pushed off-screen.
10. No em dash or en dash appears anywhere in sample copy across any of these screens.
