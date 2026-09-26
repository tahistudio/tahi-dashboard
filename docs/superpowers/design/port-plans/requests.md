# Port plan: requests (list, board, workload, timeline, detail states, create dialog, AI wizard, bulk create)

Status: plan only, nothing built. Written 2026-09-26 for Liam's instruction "build the designs in the app following the UI/UX patterns used elsewhere; ships as ported, unchecked". Existing primitives and patterns win where the prototype differs. Docs Hub is locked and untouched by this plan.

## Sources read

- Review doc: docs/superpowers/plans/2026-09-14-design-review-for-liam.md, section "requests" (33 page keys, first pass FIX, final FIX). The one still-open critic item is detail-scope: the design file's scope banner reads with an em dash. Five questions for Liam are listed there; four of them are about the prototype itself (fixture persona, head-band.css, rewriting the 85 KB design file) and are moot in the app, see "Review doc questions" below.
- Requirements: docs/superpowers/design/requirements/studio-requests.md and client-requests.md, plus DESIGN-BRIEF-2026-09-13.md.
- Design files (read through the claude-design MCP, project 57bf60cf-5e6d-450f-9e2f-e25c8d12fd66): previews/requests-preview.html (the page key picker), requests.jsx (SCENES table, the headline band, routing of every state), requests-states.jsx (ListSkeleton, BoardSkeleton, DetailSkeleton, EmptyAll, EmptyFiltered, LoadError, DetailError, NotFound, ReadOnlyStrip, the seat-aware HeaderActions), requests-listview.jsx (priorityCell, dueCell, NoneCell, the Add sub-request row), requests-workload.jsx, requests-capacity.jsx, requests-audience.jsx, requests-extra-fixes.css, requests-wizard.jsx (Typing, Notice, ContextRow, DraftCard, DocPicker, WizardDrawer), requests-dialog.jsx header (parity notes), requests-toolbar.jsx BulkCreate and the older HeaderActions, requests-board.jsx header (the P3 drop target spec), requests-detail.jsx header. requests-detail.jsx, requests-toolbar.jsx and requests-dialog.jsx were not changed in this pass beyond what their headers say; the detail was already ported by docs/superpowers/plans/2026-09-02-requests-tsx-port.md.
- Live code: app/(dashboard)/requests/page.tsx, request-list.tsx (3165 lines), [id]/page.tsx, [id]/request-detail.tsx (5116 lines); components/tahi/requests/* (header actions, rail, rail layout, view switcher, capacity strip, client review bar, delivery spine, timeline, sub-request rows, waiting-on card, actions menu); components/tahi/new-request-dialog.tsx, ai-request-wizard.tsx, sub-requests-panel.tsx, kanban-board.tsx, board-view.tsx, kpi-strip.tsx, skeletons.tsx, empty-state.tsx, data-state.tsx, slide-over.tsx, menu.tsx, permissions-context.tsx, impersonation-banner.tsx (useImpersonation); lib/requests-views.ts, lib/portal-status.ts, lib/wizard-hour-estimates.ts; routes app/api/admin/requests (GET), app/api/admin/requests/bulk, app/api/admin/export/requests, app/api/admin/capacity, app/api/portal/capacity, app/api/admin/profile, app/api/admin/ai/request-wizard; STATUS.md (P3 board drop targets still open); the other port plans (tasks.md leaves kanban-board.tsx and the P3 fix to this plan).

## Routes and audience

Both. /requests and /requests/[id] serve the studio (admin, team member) and the client portal from the same components, narrowed by audience. The new request dialog, the AI wizard (in the dialog and as a drawer) and bulk create (studio only) hang off /requests. Page guards (requirePageFeature('requests')) and every portal route are unchanged by this plan.

## Facts from the code that shape the port

1. The list already runs on the ported rail (railOn is the constant true). The legacy FilterBar, ViewToggle and legacy bulk bar branches are dead and commented as queued for deletion.
2. A signed-in team member is treated as audience "admin" today: isAdmin comes from the Tahi org id, and the list only switches to "team_member" under impersonation. usePermissions().level does distinguish team_member, and /api/admin/profile returns the caller's teamMembers row (member.id), which is what "Assigned to me" needs.
3. Client view in read-only mode (useImpersonation().previewIsReadOnly) is refused server-side on every portal write, but the list still shows New request and hides Export CSV there. The global ImpersonationBanner already prints "Viewing X. Read-only client view."
4. GET /api/admin/export/requests does not apply team member access scoping (resolveAccessScoping); it accepts ?orgId=. POST /api/admin/requests/bulk already scopes (getOrgScope, 403 on any out of scope id, MAX_BATCH 500).
5. requests.priority is NOT NULL with default 'standard', so the design's "No priority" cannot occur; the live list prints "--" for standard and for a missing due date, client name or updated date.
6. The list fetches status=all&limit=500 and the rail counts run over the top-level rows (countSavedViews over countableRequests). The saved view keys active, triage, overdue, week and awaiting are exactly the four figures the studio band needs.
7. The board and the timeline have no loading state: on first load the board draws empty columns and the timeline says "No requests to plot." When the list read fails with nothing cached, the error banner renders above the DataTable's "No requests found", a false empty.
8. The Workload view reads /api/admin/team-members with no error branch; a failed read prints "No team members".
9. Retainer track structure (tracksMode, custom counts, currentRequestId) is only exposed per org (/api/admin/capacity?orgId= behind the capacity feature, /api/portal/capacity). No cross-client tracks read exists.
10. The AI wizard (components/tahi/ai-request-wizard.tsx) already has rendered markdown, a growing composer with a 44px send, a progress line, every draft created, the canonical hours table and admin client context server-side (the admin route loads the client's name, industry, website, brands and recent request titles). Notices render as warning bubbles in the stream, the typing dots sit in an assistant-bubble shape, and draft cards are read-only chips.
11. NewRequestDialog already has form, ai and done views and embeds the AI panel; it has no way to open straight into the ai view. It is also mounted by the tasks Suggestions inbox (Tweak), the client detail Requests tab and the client home (?new=1). ai-task-wizard.tsx imports DEGRADED_PREFIX and aiWizardProgress from ai-request-wizard.tsx.
12. The live detail scope banner reads "Scope flagged, check before continuing" (no dash), the detail rail prints "Not set" for empty fields, and the client review bar is nowrap at 44px. Nine sites in request-detail.tsx and one in waiting-on-card.tsx hardcode #ffffff on brand fills.
13. SkeletonKPIStrip is two columns at every width and would jump at 64rem; the other port plans load the band as the real KPIStrip with SkeletonBar values.

## Page key by page key: what matches and what differs

Studio list
- list: matches (PageHeader with the audience subtitle, rail with saved views and counts, four view switcher, DataTable with expand-down sub-requests and Add sub-request, shared bulk bar, mobile cards, New plus overflow header). Differs: no headline band; "--" placeholders in Priority, Due, Client and Updated.
- list-loading: DataTable skeleton matches; no band skeleton.
- list-empty: matches (leaf tile, "No requests found", admin copy with no CTA).
- list-nomatch: copy matches, but it is the same full leaf-tile EmptyState with the same Inbox icon as list-empty, so the two are not visibly distinct (acceptance item 5 on both requirement docs).
- list-error: banner matches in intent; lacks "The rows below may be out of date."; with nothing cached it also draws the false "No requests found"; the rail count reads "0 requests".
- list-readonly: differs. Live shows New request and AI draft in read-only Client view (dead writes) and hides Export CSV. Design hides every write, keeps Export CSV for the studio seat, and adds a page strip (skipped, see below).

Studio views
- board: matches (BoardView, horizontal scroll with proxy scrollbar, quick add, drag to nest with confirm, off-board note). Differs: the P3 same-column drop highlight the design now specs away.
- board-loading: not live (empty columns on first load).
- workload: team load cards, capacity 5, danger and warning tones, Unassigned lane and narrowed note match (the last two are repo additions and stay). Differs: no Track occupancy section (skipped); no error branch; #ffffff on the avatar tile.
- timeline: matches populated; loading shows a false "No requests to plot".
- teammate-list: not live for a real signed-in team member (they get the admin lens with Workload and no Assigned to me).

Detail
- detail, detail-quiet, client-detail, client-review: match (composition, spine, rail, people card honesty, client review bar, every empty panel's own copy, "Not set" placeholders).
- detail-scope: matches. The critic's still-open FIX (an em dash in the design file's banner string) does not exist in the live copy.
- detail-loading: differs in geometry and units (px, two blank boxes rather than per-read blocks).
- detail-error: no Try again and no way back.
- detail-notfound: no explanation line; the way back is a small text link under 44px.

Create
- dialog, dialog-sub, client-dialog: match (intake forms, brand picker, placement for clients, priority for staff, Save + another, More details, predictive autofill, locked parent for sub-requests).
- dialog-doc: proposal, skipped.
- wizard, client-wizard: differ in the notice (bubble), typing (bubble shape), draft cards (read-only), no context line, no Start again. The header menu offers one AI item (drawer) where the design offers two (in the form, and the drawer).
- wizard-drafts: create copy matches ("Create N requests"); drafts header and editing differ.
- wizard-offline: the notice is a warning bubble with no "Try the model again".
- wizard-drawer: matches as a SlideOver; title copy differs.
- bulk: differs. Live is one title, category, type and description across the chosen clients, a hand-rolled overlay, a native plan select, "No clients found". Design is numbered rows (title plus category each), plan chips, whole-row client toggles, a summary line and "Create N requests" where N is clients times rows.

Client lens
- client-list: capacity strip matches (one lane per track, numbered queue, stands down under any filter). The client headline band is Liam question 1 in client-requests.md and is skipped.
- client-empty: matches. client-nomatch: same fix as list-nomatch. client-board: default columns match (the per-client column set the design draws is a Liam question, skipped).

## Resolving the critic's open FIX item

detail-scope: the design file's "Scope flagged - check before continuing" string is not in the app; request-detail.tsx line 2200 already reads "Scope flagged, check before continuing". Slice detail-states keeps that copy, and every slice greps its owned files for em and en dashes before commit (two files carry them today: components/tahi/requests/request-actions-menu.tsx, one comment, and components/tahi/sub-requests-panel.tsx, two comments and one visible placeholder glyph).

## Review doc questions that the app already answers

1. "Can a request exist with no due date?" Yes: requests.dueDate is nullable. The port prints "No date" instead of "--".
2. The band skeleton token bug is inside the prototype's head-band.css; the app band is KPIStrip with token SkeletonBar values, so nothing to carry over.
3. The fixture persona (Mahana Orchards against Physitrack rows) is prototype only.
4. Rewriting requests-detail.jsx to remove its dashes: not needed; the live strings are already clean.

## Slices

Four slices with disjoint owned files. Order: create and server-board can start at once, detail-states is independent, list-surface lands last because it imports the new BulkCreateDialog and the dialog's initialView prop from slice create and relies on slice server-board for an honest team member export. No migration anywhere; one route change (export scoping), no new endpoint, no MCP change.

1. list-surface (2.5 days, backend no, migration no): app/(dashboard)/requests/request-list.tsx, components/tahi/requests/requests-header-actions.tsx, components/tahi/requests/requests-rail-layout.tsx, components/tahi/requests/requests-band.tsx (new), components/tahi/requests/requests-view-skeletons.tsx (new), lib/requests-band.ts (new), lib/__tests__/requests-band.test.ts (new), e2e/requests-list.spec.ts (only if an assertion must change).
2. detail-states (1 day, backend no, migration no): app/(dashboard)/requests/[id]/request-detail.tsx, components/tahi/requests/waiting-on-card.tsx, components/tahi/requests/request-actions-menu.tsx, components/tahi/sub-requests-panel.tsx.
3. create (2.5 days, backend no, migration no): components/tahi/new-request-dialog.tsx, components/tahi/ai-request-wizard.tsx, components/tahi/requests/bulk-create-dialog.tsx (new), lib/bulk-create-requests.ts (new), lib/__tests__/bulk-create-requests.test.ts (new), components/tahi/__tests__/ai-request-wizard.test.ts, components/tahi/__tests__/new-request-dialog.test.ts.
4. server-board (1 day, backend yes, migration no): app/api/admin/export/requests/route.ts, app/api/__tests__/admin-export-requests-scoping.test.ts (new), components/tahi/kanban-board.tsx, components/tahi/__tests__/kanban-board.test.ts.

## Slice briefs

### list-surface

Follow Claude Design requests.jsx (the headline band block inside Requests, and the body routing), requests-states.jsx (ListSkeleton, BoardSkeleton, EmptyAll, EmptyFiltered, LoadError, HeaderActions with its seat versus lens rule), requests-listview.jsx (priorityCell, dueCell, NoneCell) and requests-workload.jsx (team load only). Page keys: list, list-loading, list-empty, list-nomatch, list-error, list-readonly, board-loading, workload, timeline, teammate-list, client-list, client-empty, client-nomatch (preview: previews/requests-preview.html?page=KEY).

Land after slice create (you import BulkCreateDialog from components/tahi/requests/bulk-create-dialog.tsx and pass initialView to NewRequestDialog) and after slice server-board (the export route must be scoped before a team member is offered Export CSV). Do not stub either.

Compose from existing primitives only: PageHeader, KPIStrip plus KPICell, SkeletonBar, EmptyState (full and inline), TahiButton, Menu, Badge, DataTable, BoardView, RequestsTimeline, RequestsRailLayout, useImpersonation, usePermissions, useSWR. Do not edit kpi-strip.tsx, skeletons.tsx, empty-state.tsx, menu.tsx, rail-layout.tsx, board-view.tsx or kanban-board.tsx.

1. Seat. audience = 'team_member' when impersonating a team member, or when not impersonating a client and usePermissions().level === 'team_member'; otherwise 'admin' when isAdmin, else 'client'. For a real team member seat, read /api/admin/profile with SWR and use member.id as the assigneeId for countSavedViews and applyRequestViews (impersonation keeps impersonatedTeamMemberId). The Workload branch renders only for audience === 'admin' (today it keys off isAdmin); viewKeysFor and normaliseViewKey already drop Workload for other audiences, so a stored 'workload' falls back to List.
2. Read-only and header. readOnly = isViewerImpersonation || previewIsReadOnly. The studio seat is the server prop (isAdmin before the client lens flips it). Give RequestsHeaderActions the props seat ('studio' or 'client'), lens (the audience), readOnly, onNew, onAiInForm, onAiWizard, onExportCsv, onBulkCreate. Rules: New request is not rendered when readOnly (never a greyed button). "AI draft in the form" (opens NewRequestDialog with initialView 'ai') and "Open the AI wizard" (opens the existing AiRequestWizard drawer) are not rendered when readOnly. Export CSV renders for every studio seat, read-only included; in the client lens it downloads /api/admin/export/requests?orgId=<impersonatedOrgId> and reads "Export this client's requests" with a second muted line "Studio copy, includes internal requests" inside the Menu.Item children. Bulk create renders for a studio seat in a studio lens when not readOnly. When no item is left, render no overflow at all. Keep the Menu primitive, the TahiButton primary (tahi-btn-sm already clears 2.75rem below md) and the overflow trigger's w-11 h-11 md:w-9 md:h-9. The ?new=1 door and the tahi:shortcut 'new-request' event must not open the dialog when readOnly, and the client empty state's "Submit a request" CTA is not rendered when readOnly. Do not add a page-level read-only strip: the global impersonation banner already says it.
3. Studio headline band (admin and team_member lenses only; never the client lens, which is Liam question 1). lib/requests-band.ts exports a pure studioBandFigures(counts, loadedRowCount) that takes the output of countSavedViews(countableRequests, audience, ctx) and returns { open: counts.active, withClient: counts.awaiting, withUs: counts.active minus counts.awaiting, triage: counts.triage, overdue: counts.overdue, dueThisWeek: counts.week, atCeiling: loadedRowCount >= 500 }, so the band and the rail can never disagree. Vitest: each figure, sub-requests excluded (they are not in countableRequests), delivered and cancelled rows never overdue or due this week, the ceiling flag. components/tahi/requests/requests-band.tsx renders a section with aria-label "Requests summary" holding KPIStrip with four KPICell, no href (the band summarises; filtering stays in the rail): Open (Inbox, tone brand, sub "N with us, M with a client"), Needs triage (Flag, tone warning when above zero else neutral, sub "no one has picked these up yet" or "everything is picked up"), Overdue (AlertTriangle, tone danger when above zero else neutral, sub "past the date we gave" or "nothing is late"), Due this week (CalendarDays, tone info, sub "inside the next seven days"). When atCeiling, print each value as "N+" and add title "Counted from the first 500 requests". Values come from the audience-visible base, not the filtered rows, so the band does not move while filtering. Loading: the same KPIStrip, same labels and icons, a SkeletonBar (width 3rem, height 1.5rem) in each value and no sub. Error with nothing cached: values read "Not loaded" in var(--color-text-subtle) at the sub size, no subs. Place it between PageHeader and RequestsRailLayout so all four views share one band position and width. Avoid any band text that matches /^\d+ requests?$/ (e2e/requests-list.spec.ts reads the rail count with that pattern).
4. States.
   - Loading: keep the DataTable skeleton and the band skeleton above it. New requests-view-skeletons.tsx exports RequestsBoardSkeleton (one ghost column per boardColumns entry with its dot and label, three ghost cards, one in the last column, inside its own horizontal scroller, role="status" aria-label "Loading the board", sr-only text) and RequestsTimelineSkeleton (a header bar and six row bars, role="status" aria-label "Loading the timeline"). Render them instead of BoardView and RequestsTimeline while the first requests read is in flight (isLoading and no data). Workload keeps its own member skeleton.
   - Empty with nothing at all: keep the live EmptyState and copy.
   - Filtered to nothing: FilteredEmptyState becomes EmptyState variant="inline" with the lucide Filter icon, title "No requests match", description "Try clearing a filter or the search.", action TahiButton secondary "Clear filters" (keep the text; e2e clicks it). This makes it visibly different from the full leaf tile.
   - Error: keep ListLoadError (role alert, badge-danger tokens). With cached rows, add the line "The rows below may be out of date." With nothing cached, render the banner alone: no DataTable empty state, no board, no timeline, no workload beneath it. The retry button reads "Trying again" and is disabled while mutate runs. Add an optional countOverride prop to RequestsRailLayout that forwards to RailLayout's existing countOverride (touch nothing else in that file) and pass "Could not load" when the read failed and nothing is cached.
   - Workload: when the team-members read fails, show EmptyState variant="inline" with AlertTriangle, "Team load did not load", "The requests are fine; the team list did not come back.", action Retry (mutate). Replace '#ffffff' on the WorkloadCard avatar tile with var(--color-text-on-dark).
5. Cells. Replace every "--": Due with no date prints muted "No date"; Priority standard prints muted "Standard", low prints muted "Low", high and urgent keep the live Badge; Client with no name prints muted "No client"; a missing updated date prints "Not recorded"; formatDate returns an empty string for a missing date and callers that show a date skip it. Muted means var(--color-text-subtle) at 0.75rem.
6. Wiring from slice create: delete the inline BulkCreateDialog (and imports only it used) and render the imported one with the same onClose and onCreated(created) contract; wire onAiInForm to open NewRequestDialog with initialView="ai" (the dialog must remount or reset per open; follow the prop's doc comment).
7. Dead code: remove the branches that railOn === true makes unreachable (the FilterBar and ViewToggle row, the legacy header buttons, the legacy BulkActionBar function, the legacy status tab and sort preferences) and then the railOn constant itself. Before removing a useUserPreference call, confirm migrateLegacyRequestPreferences in requests-rail-layout.tsx reads localStorage on its own and does not need the hook. Zero type-check and lint errors after.

States to cover: loading (band plus table, board, timeline skeletons), empty (admin copy, client copy with CTA, CTA hidden when read-only), filtered empty, error with and without cached rows, read-only Client view (no New, no AI, Export only), act mode (New back, writes audited as today), team member seat (no Workload, Assigned to me counted from the profile id), populated in all four views.

375 and dark: band two per row (KPIStrip below 64rem), header exactly New plus one overflow at 44px, rail as the Filters sheet (unchanged), skeletons and board scroll inside their own scroller only, no horizontal page scroll. Dark through tokens only; check the KPICell warning and danger tints, the danger banner and the inline empty state in .dark. No hex, rem only, no em or en dashes in owned files, no new single-side borders.

Do not build: the client headline band, the page read-only strip, the Workload track occupancy cards, the "Start from a document" menu item, the client board's per-client columns, a "No priority" state, aria-controls on the view tabs.

### detail-states

Follow Claude Design requests-states.jsx (DetailSkeleton, DetailError, NotFound). Page keys: detail, detail-scope, detail-quiet, detail-loading, detail-error, detail-notfound, client-detail, client-review. The detail composition, spine, rail editors, people card, client review bar, scope banner and every empty panel's copy already match; do not restyle them.

Primitives: Card, SkeletonBar, EmptyState, TahiButton, Link. Do not edit empty-state.tsx or skeletons.tsx.

1. Skeleton (the showSkeleton branch): rebuild in rem to mirror the live page: a back link bar (7.5rem by 1rem), a header Card with two chip bars (5rem and 4rem by 1.375rem), a title bar (60 percent by 1.75rem) and a meta bar (30 percent by 0.875rem), a five segment spine row, then the page's own grid (grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20rem] gap-6) holding separate Cards per read: main column Brief (two lines), Thread (three lines), Files (two lines); rail Details (three lines) and, for a studio audience only, Actions (two lines). Each Card has a small title bar. The wrapper is role="status" with aria-label "Loading this request" and an sr-only line. It stacks under 1024px exactly as the page does.
2. Error (fetchError): EmptyState full with the AlertTriangle icon, title "Failed to load request", description "Please check your connection and refresh the page.", action a row of two TahiButtons: "Try again" (primary, calls mutateRequest, reads "Trying again" and is disabled while it runs) and "Back to requests" (secondary, a Link to /requests). Wrap in role="alert".
3. Not found (request null): EmptyState full with the Inbox icon, title "Request not found", description "It may have been deleted, or the link points somewhere you do not have access to." (a gone request and another org's request must read the same), action TahiButton "Back to requests" as a Link, 44px on touch.
4. Hex: replace every '#ffffff' in request-detail.tsx (the approve, request changes, AI, send and icon glyph sites) and in waiting-on-card.tsx with var(--color-text-on-dark). Check each on its brand fill in .dark.
5. Dashes: request-actions-menu.tsx header comment and sub-requests-panel.tsx (two comments, and the visible em dash glyph near line 71 that stands in for no assignee). Replace the glyph with a muted lucide User icon at the same 1.5rem circle with aria-label "No one assigned". sub-requests-panel.tsx also renders on the client detail Requests tab; the change is intended there too.
6. Scope banner (the critic's FIX): keep "Scope flagged, check before continuing" exactly.

States: loading, error, not found, populated for admin and client, client_review banner. 375: one column, no clipped rail, no captured wheel scroll (the LW.12 regression bar); 768: one stacked column. Dark via tokens.

Do not build: the design file's synthesised spine phases, revision history list, pinned-comment proofing viewer or any other fixture-derived extra; a revision counter write; a persisted activity log; message reactions; a request steps list; client sub-request creation.

### create

Follow Claude Design requests-wizard.jsx (Typing, Notice, ContextRow, DraftCard, the 'ask' and 'done' modes of Wizard, WizardDrawer copy), requests-extra-fixes.css items 1 to 3, requests-toolbar.jsx BulkCreate, and requests-dialog.jsx for parity only. Page keys: dialog, dialog-sub, wizard, wizard-drafts, wizard-offline, wizard-drawer, bulk, client-dialog, client-wizard.

Primitives: SlideOver (right for the drawer, center for bulk), TahiButton, Input, Select and Textarea from components/tahi/input.tsx, Avatar, Badge, EmptyState inline, SkeletonBar, SegmentedControl or chip buttons, useToast. Do not edit slide-over.tsx or input.tsx.

A. NewRequestDialog (keep every existing prop and behaviour; the tasks Suggestions Tweak flow, the client detail Requests tab and the client home ?new=1 all mount it):
- Add optional initialView?: 'form' | 'ai', default 'form'. When the dialog opens with 'ai' it starts in the ai view with a fresh aiSession; sub-request mode ignores it. Document the prop.
- Pass the chosen client's name (orgName) and largeAllowed into the AI panel's context.

B. AiRequestWizardPanel and AiRequestWizard:
- Notice: stop rendering notice messages as bubbles. Render the latest notice as a full-width strip between the message column and the drafts: role="status", badge-warning tokens, an Info icon, the text, and, when the notice came from the model being unreachable (the degraded path or DEGRADED_PREFIX text), a "Try the model again" button (44px on touch) that restarts the session. Earlier notices do not repeat as bubbles.
- Typing: replace the bubble-shaped dots with a row: a 1.75rem leaf-radius tile (var(--radius-leaf-sm), brand-50 fill, Sparkles icon), the three animated dots, and the muted word "Writing". No bubble background. Keep the sr-only live region. Typing and notice are then two distinct non-bubble states (acceptance item 8).
- Context line (admin speaker only, when context.orgId and orgName are known): under the progress line, an Avatar, "Writing for <b>Name</b>", and a muted line "Reads their industry, website, brands and recent requests". Confirm each noun against app/api/admin/ai/request-wizard/route.ts before shipping the sentence and drop any it does not load. No context line for a client.
- Drafts: the latest batch renders as editable cards; older batches stay read-only transcript cards as today. Each editable card: a "Lead" tag on the first, a title Input, a brief Textarea, a category Select limited to the four wizard categories, a size toggle "One day or less" or "Multi-day" that writes type small_task or large_task (bug_fix and new_feature map through isLargeWizardType for display), disabled with title "This plan runs a single-day track" when largeAllowed is false, and a remove button (44px on touch, aria-label "Remove draft: <title>"). The hours line is always estimateRequestHours(category, type) from lib/wizard-hour-estimates.ts, so an edit never carries a model number. Above the list: "N drafts" and the hint "Every card becomes its own request. Hours come from the studio table, not the model." When every card is removed: "Nothing left. Write it yourself, or start again." with Write it myself (only when onWriteItMyself exists) and Start again.
- Actions: add Start again beside the live Use this draft and Create N requests. Create sends the edited drafts through the unchanged buildCreateRequestBody and buildCreateSubRequestBody. Keep the client picker, the internal-only checkbox and the hand-back rules exactly as they are. The actions row stays outside the scrolling area (it already is).
- Drawer copy: title "AI wizard"; subtitle for a client "Answer a few questions and I will write the request up for you.", for the studio "Answer a few questions and I will raise the work, including the pieces that usually come with it."
- Keep DEGRADED_PREFIX, aiWizardProgress and every exported helper signature unchanged (ai-task-wizard.tsx and the existing tests import them). Extend components/tahi/__tests__/ai-request-wizard.test.ts for any new pure helper (for example a draft patch helper that recomputes hours).

C. BulkCreateDialog (new components/tahi/requests/bulk-create-dialog.tsx, props onClose and onCreated(created: number), the contract request-list.tsx uses today): SlideOver variant="center", maxWidth about 52rem, title "Bulk create requests", subtitle "Every row becomes one request for every client you pick."
- Clients column: a search Input, plan chips (All plans plus each planType present, 44px on touch), a list that scrolls inside itself (max height about 16rem) of whole-row toggles with a checkbox, Avatar, name and plan label ("No plan" when empty), and "Select all visible" that becomes "Clear these". "No clients match" when search or plan hides everyone. Loading: three row skeletons. Read error: inline message with Retry. The list is /api/admin/clients, already scoped server side.
- Requests column: numbered rows, each a title Input plus a category Select (None, design, development, content, strategy, admin, bug, the live options); Enter adds a row; a remove button per row, disabled at one row; Add row. Below the rows, the two live fields kept and applied to every row: Type (the live options small_task, large_task, bug_fix, content_update, new_feature, consultation, custom) and Description (optional).
- Footer, sticky at the bottom of the panel: a summary ("Pick at least one client", "Give at least one row a title", or "3 clients, 2 rows each"), Cancel, and primary "Create N requests" where N is selected clients times titled rows. The error line sits inline above the footer (role alert) and keeps the server's message.
- Submit: one POST /api/admin/requests/bulk per titled row with the selected orgIds, one after another. Sum created. On a failure stop, remove the rows that already succeeded, keep the failed row and the rest, and show "Created X of N. Row "title" failed: <server message>." Call onCreated(total) only when every row succeeded; otherwise stay open.
- Pure helpers in lib/bulk-create-requests.ts (summaryLine, totalToCreate, planChips, filterClients) with Vitest in lib/__tests__/bulk-create-requests.test.ts.
- Two columns from 48rem, one column below; at 375 the footer never leaves the viewport and nothing scrolls sideways (acceptance item 9).

States: form, ai mid conversation, typing, notice with retry, drafts, drafts emptied, creating, partial create failure, bulk loading, bulk no match, bulk error, bulk partial failure. 375 and dark for all; every control at least 44px on touch; tokens only (CATEGORY_STYLES and PRIORITY_STYLES already resolve through tokens, keep it so); no em or en dashes.

Do not build: Start from a document (the header item, the wizard's header button, DocPicker, the dialog-doc view), client sub-request creation, any change to intake forms, placement, predictive autofill or Save + another, any new endpoint.

### server-board

Follow Claude Design requests-board.jsx header (the P3 spec) and studio-requests.md section 1 ("A scoped hire must never see another client's requests in ... CSV export").

A. Export scoping in app/api/admin/export/requests/route.ts: after the feature gate call resolveAccessScoping(database, userId) from lib/access-scoping.ts, as app/api/admin/requests/route.ts does. null means unrestricted. An empty array returns the header row only. Otherwise add inArray(schema.requests.orgId, scopedOrgIds). A ?orgId= outside the scope answers 403 { error: 'Forbidden' }, the same answer the bulk route gives, so it is not an existence oracle. Keep the columns, the filename and csvEscape. Export nothing from route.ts but the GET handler. New app/api/__tests__/admin-export-requests-scoping.test.ts modelled on admin-requests-scoping.test.ts: 403 for a non-Tahi org, all rows for an unrestricted admin, only granted orgs for a scoped member, header only for an empty scope, 403 for an out of scope orgId. No MCP change: this adds no capability.

B. P3 in components/tahi/kanban-board.tsx: export two small pure predicates and use them. isColumnDropTarget(dragStatus, columnStatus) is false when they are equal; onColumnDragOver then neither calls preventDefault nor sets dropColumn for the dragged card's own column. isNestTarget({ dragId, cardId, dragParentId, canNest }) is false for the dragged card itself, for the dragged card's current parent, and when onNest is not provided; onCardDragOver only lights the card when it is true. Touch nothing else. Extend components/tahi/__tests__/kanban-board.test.ts for both predicates. This file is shared with the Tasks board (components/tahi/tasks/tasks-board.tsx); the tasks port plan leaves it to this slice, and the fix is wanted there too. Verify a drag inside one column on /requests Kanban and on /tasks Board lights nothing, light and dark.

## Skipped (design proposals, Design file only, or waiting on Liam)

1. Client headline band on /requests (In the studio, Waiting on you, In your queue, Delivered): client-requests.md Liam question 1. The client lens keeps the rail counts and the capacity strip.
2. Start from a document (the header menu item, the wizard header button, DocPicker, the dialog-doc page): the design marks it Proposal; no extraction route exists.
3. Workload "Track occupancy, retainer capacity" cards: need a cross-client tracks read that does not exist (tracksMode, custom counts, currentRequestId are per org today); same decision as the studio-wide /tracks board (CT.18, ops plan skipped item 1).
4. The page-level read-only strip on list-readonly: the global impersonation banner already says "Viewing X. Read-only client view."; the existing pattern wins.
5. The client board drawing that client's own kanban column override: client-requests.md Liam question 4. The client board keeps the default columns.
6. Client sub-request creation: client-requests.md Liam question 2.
7. Revision counter wiring or removal: studio-requests.md question 1, client-requests.md question 5. "Rev n/3" stays as it is.
8. Persisted per-request activity log: studio-requests.md question 2.
9. messageReactions: studio-requests.md question 3.
10. requestSteps as a client-visible step list: studio-requests.md question 4, client-requests.md question 3.
11. Fixture-derived detail extras in requests-detail.jsx (synthesised spine phases, revision history list, pinned-comment proofing viewer): Design file only.
12. The design's "No priority" cell: priority is NOT NULL with default 'standard'; the port prints a muted "Standard".
13. aria-controls between the view tabs and a tabpanel: marked a proposal in studio-requests.md and deliberately deferred in requests-view-switcher.tsx.
14. GI.1 WhatsApp or Slack to request intake: backlog, design first, not drawn.

## Questions for Liam

1. Client headline band on /requests: port it (A) or keep the capacity strip and rail counts (B)? The port keeps B.
2. Revision counter: wire it to the client's Request changes decision, or hide "Rev n/3" until it is wired?
3. Start from a document: build it (needs an extraction route) or drop the proposal?
4. Workload track occupancy: build it together with a cross-client tracks read (the CT.18 decision), or keep Workload as team load only?
5. The port hides Workload from the team_member permission level, as the requirement says. Only Liam and Staci sign in today, so nobody loses it now; right for the first hire?
6. Export CSV from read-only Client view downloads a studio copy of that client's requests, internal ones included. Keep it, or hide export in Client view?
7. Bulk create becomes rows (one request per row per client) with Type and Description shared across rows. Do you need per-row type or description?
8. Should a per-client kanban column override reach that client's own board?
9. Should clients be able to create their own sub-requests?
10. Activity log, message reactions, request steps: build or delete (the requirement docs' open questions, unchanged).

## Risks

- request-list.tsx is 3165 lines. The list slice restructures its render and deletes the dead legacy branches; run the requests e2e specs (e2e/requests-list.spec.ts reads the rail count with /^\d+ requests?$/, clicks "Clear filters" and looks for "No requests match").
- Band figures are counted from the 500-row fetch; past it they under-report, so the band marks "N+" at the ceiling.
- The P3 fix changes the Tasks board as well (intended; STATUS lists it there).
- NewRequestDialog and ai-request-wizard.tsx are shared with the tasks Suggestions inbox, the client detail Requests tab, the client home and ai-task-wizard.tsx. The new prop is optional and the exports stay stable.
- Bulk create by rows multiplies request_created notifications (one per row per client). Emails stay allowlisted to tahi.studio (memory rule), but the bell fills; the summary states the total before the click.
- The team member seat reads usePermissions(); the provider default is admin, so a page outside the provider would fall back to the admin lens. Server scoping still bounds the rows either way.
- Export in Client view includes internal requests (studio copy). Question 6.
- sub-requests-panel.tsx also renders on the client detail Requests tab (clients module).
- Slice order matters: list-surface lands after create and server-board.

## Shared files (schedule around other modules)

- components/tahi/kanban-board.tsx (edited by server-board; also the Tasks board; the tasks plan does not edit it)
- components/tahi/new-request-dialog.tsx (edited by create; also mounted by tasks Suggestions, the client detail Requests tab and the client home ?new=1)
- components/tahi/ai-request-wizard.tsx (edited by create; ai-task-wizard.tsx imports DEGRADED_PREFIX and aiWizardProgress)
- components/tahi/sub-requests-panel.tsx (edited by detail-states; also the client detail Requests tab)
- components/tahi/requests/requests-rail-layout.tsx (one optional prop added by list-surface)
- components/tahi/kpi-strip.tsx, skeletons.tsx, empty-state.tsx, data-table.tsx, slide-over.tsx, menu.tsx, tahi-button.tsx, input.tsx, callout.tsx, segmented-control.tsx, avatar.tsx, badge.tsx, confirm-dialog.tsx, board-view.tsx, rail/rail-layout.tsx (used, not edited)
- components/tahi/impersonation-banner.tsx, components/tahi/permissions-context.tsx (used, not edited)
- lib/requests-views.ts, lib/wizard-hour-estimates.ts, lib/access-scoping.ts, lib/portal-status.ts (read, not edited)
- app/api/admin/profile/route.ts, app/api/admin/requests/bulk/route.ts, app/api/admin/clients/route.ts (called, not edited)
- app/globals.css (no change)
- e2e/requests-list.spec.ts, e2e/requests-board.spec.ts, e2e/requests-dialog.spec.ts, e2e/requests-detail.spec.ts (must stay green)
