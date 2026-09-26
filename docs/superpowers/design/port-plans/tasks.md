# Port plan: tasks (/tasks, List, Board, My week, detail, create, AI wizard)

Status: plan only, nothing built. Written 2026-09-26 for Liam's instruction "build the designs in the app following the UI/UX patterns used elsewhere; ships as ported, unchecked". Existing primitives and patterns win where the prototype differs. Docs Hub is locked and untouched by this plan. Every commit from this plan is recorded in the tasks section of docs/superpowers/plans/2026-09-14-design-review-for-liam.md with the box left empty.

## Sources read

- Review doc: docs/superpowers/plans/2026-09-14-design-review-for-liam.md, section "tasks" (26 page keys, final critic verdict FIX, first pass FIX). Still open after the revision: the rail's saved view counts print a confident 0 while the page is loading (list-loading at 1440 light, 1440 dark and 375; board-loading; week-loading). Four questions for Liam plus one lead note about head-band.css.
- Requirements: docs/superpowers/design/requirements/studio-tasks.md and docs/superpowers/design/DESIGN-BRIEF-2026-09-13.md.
- Design files, read through the claude-design MCP (project 57bf60cf-5e6d-450f-9e2f-e25c8d12fd66): previews/tasks-preview.html, tasks.jsx (page keys and the page shell, band, error gate), tasks-kit.jsx (rail, sheet, toolbar, railCount, header actions, quick add, empty, error and skeleton states), tasks-views.jsx (List, Board, the TP.3 My week planner), tasks-detail.jsx (detail sheet, blocker picker, promote, New task dialog, AI wizard), tasks-fixes.css, and the top of tasks-data.jsx (levels, statuses, templates, date helpers). tasks.css was not read line by line; the app keeps its own components and tokens.
- Live code: app/(dashboard)/tasks/page.tsx, [id]/page.tsx, tasks-content.tsx; components/tahi/tasks/* (tasks-rail, tasks-view-switcher, tasks-header-actions, tasks-list, tasks-board, tasks-week, task-detail-panel, task-chips, task-quick-add, new-task-dialog, tasks-suggestions header); components/tahi/ai-task-wizard.tsx; components/tahi/rail/rail-layout.tsx and rail-controls.tsx; kpi-strip.tsx, skeletons.tsx, empty-state.tsx, data-state.tsx, menu.tsx; lib/tasks-views.ts, lib/tasks-board-items.ts, lib/task-wizard-drafts.ts; the routes app/api/admin/tasks/[id] (DELETE), app/api/admin/tasks/[id]/promote, app/api/admin/ai/task-wizard; db/schema.ts (timeEntries, taskSubtasks, taskComments); lib/swr-fetcher.ts; STATUS.md and e2e/tasks.spec.ts for what is proven.

## Routes and audience

Studio only. /tasks (List, Board, My week, and the live Suggestions view the design does not draw) and /tasks/[id] (a redirect shim to /tasks?task=id, no UI). page.tsx already redirects clients and Client view previews to /overview server side and gates on requirePageFeature('tasks'); nothing in this plan changes a guard or an API route.

## Facts from the code that change what the design can honestly say

1. The live surface already is the port of this design's earlier pass (T2.5, 2026-09-05). PageHeader, RailLayout rail and Filters sheet, view switcher, quick add with parse chips, DataTable with expand-down checklists, BulkActionBar, KanbanBoard, the My week planner, the detail SlideOver with the Level, Client, Request consistency model, blockers, checklist, TimeCard, promote, the New task dialog with its AI view, templates, Export CSV and the read-only lens are all live. The work left is the band, the honesty states the critic asked for, a few dark mode token defects, two copy lies and the wizard's name honesty.
2. Live has things the design omits and must keep: the Suggestions view (fourth tab), the task Thread (comments) card in the detail panel, bulk Priority and Unassign, the template picker and field predictions inside the New task form, "That task is no longer here." for a deleted deep link.
3. The live Requests page has no headline band. Where a live page carries the design's band it is KPIStrip plus KPICell (team, capacity, deals, reports), and the sibling port plans (portal-account, portal-files, ops) port the band that way. The head-band.css dark placeholder question is moot in the app because nothing reads a prototype token.
4. Task priorities are standard, high, urgent in the repo (the design draws urgent, high, medium, low). The repo scale wins.
5. Deleting a task does not delete its logged time. time_entries.task_id has no foreign key, so entries survive with a dangling task id; checklist items, comments and dependency rows cascade, blocker links are swept by the route. Both the live confirm ("along with its checklist and its logged time") and the design's copy are false.
6. The AI wizard route passes the model's own estimatedHours straight through on the model path; the canonical per category estimate only applies on the keyword fallback path. The design's fine print "Estimates come back from the studio rate card, not from the model" is false today.
7. The tasks header opens the standalone AiTaskWizard without clients, people or requests (tasks-content.tsx passes only context, mutateKeys, onTasksCreated), so every name a draft carries resolves to nothing unless the rail was narrowed to one client. The draft cards still print the model's raw clientName and assigneeName as chips, so the card claims an assignee the created task will not have.
8. SWR errors are available (lib/swr-fetcher.ts throws ApiError) but tasks-content.tsx never reads the error. A failed /api/admin/tasks read renders "Nothing on the list" with zeros in the rail: a false empty. A failed /api/admin/profile read makes meId null, so "Assigned to me" reads 0 and My week says "A clear week".
9. RailLayout already supports what the honesty fixes need without an edit: `countOverride` (label plus the sheet's Close instead of "Show 0") and an opt-in search box (no onQueryChange, no box). RailViewItem already takes `count: null` (withheld) and `disabled` (aria-disabled, dimmed). RailSelect has no disabled prop; a native `<fieldset disabled>` around the selects disables every button inside without touching the shared file.
10. --color-brand-dark has no .dark override (about 2.2:1 on the dark card). The tasks components use it as text in seven places; --color-link (plain surfaces) and --color-brand-on-tint (on a brand tint) are the dark-safe tokens the rest of the app moved to.

## Page key by page key: what matches and what differs

- list: matches (header, overflow menu, rail, switcher, search, count, quick add with parse chips, table with Task, Assignee, Due, Priority, Status, expand-down checklists, bulk bar). Differs: no headline band. Slice shell.
- list-loading: live draws the list skeleton and "Loading", but every rail count prints 0 (the critic's open FIX, same defect live) and the Filters sheet button reads "Show 0". No band skeleton. Slice shell.
- list-empty: matches ("Nothing on the list", New task CTA hidden when read-only).
- list-filtered: matches ("No tasks match", Clear filters).
- list-error: not live. A failed read is a false empty with zero counts and Export CSV exporting nothing as "Exported 0 tasks". Slice shell.
- board: matches (KanbanBoard, four columns off the status vocabulary, composers except Done, nest read as move, read-only kills drag). Card content differs slightly (design: level icon chip and client avatar; live: client, #042 reference, blocker warning, people, rollup). Live wins. Differs: band. Slice shell.
- board-loading: live 4 pane pulse skeleton matches; rail zeros as above. Slice shell.
- week: the design is the TP.3 multi-day planner (per-day allocations, bars with drag handles, hours per day against a 6h capacity, "Planned in another week"). Live is the single due date planner with the week strip and week paging. Skipped: Liam question 1 and it needs somewhere to store per-day allocations (a migration). Live keeps its planner.
- week-loading: live 3 pane skeleton matches; rail zeros and live (not inert) rail controls. Slice shell.
- week-empty: matches ("A clear week"). New honest branches for a viewer not on the roster and a failed profile read. Slice shell.
- detail: matches, plus the live Thread card. The delete confirm copy is false (fact 5). Slice detail-dark.
- detail-linked: the leaf banner matches (client_task with a request only); its bold #042 uses --color-brand-dark (dark contrast). Slice detail-dark.
- detail-blockers: matches (server searched picker, server sentences for loop and duplicate).
- detail-level: matches (pendingLevel holds the pill, caption, opens the client picker).
- detail-loading: live prints plain "Loading this task…"; design draws a skeleton. Slice detail-dark.
- detail-delete: ConfirmDialog matches; copy fix. Slice detail-dark.
- promote: matches (category plus size, centred SlideOver); design adds one explanatory line. Slice detail-dark.
- new-task, new-task-ai, template: live is richer (template picker in the form, field predictions, AI assist card, Use this draft hand-off). No work; the design's "Pre-filled from the template" banner is covered by the live picker showing the chosen template.
- wizard: live drawer matches the transcript, markdown bubbles, composer, brief upload and edit in place. Differs: no per-draft include or drop, raw model names printed as chips even when they match nobody (fact 7), no line saying which client the drafts start on. Slices shell (hand the rosters over) and wizard.
- readonly, readonly-detail: match (no New task, AI or templates; Export CSV survives; no selection; Read-only chip). The design's sentence inside the overflow menu is not built (Menu.Label is an uppercase group label, not a sentence slot).
- no-access: matches today's behaviour (no message; Tahi internal rows only).
- no-access-proposal: skipped (proposal, Liam question 2).
- client: skipped. The live server redirect to /overview wins over the design's interstitial panel.

## Slices

Three slices with disjoint owned files, all frontend only, no backend, no migration, no flags. They can run in parallel; slice wizard reads the rosters slice shell starts passing, but works (honestly) without them.

### Slice shell (1.5 days, backend no, migration no)

Owned files: app/(dashboard)/tasks/tasks-content.tsx, components/tahi/tasks/tasks-rail.tsx, components/tahi/tasks/tasks-header-actions.tsx, components/tahi/tasks/tasks-band.tsx (new), components/tahi/tasks/tasks-load-error.tsx (new).

### Slice detail-dark (1 day, backend no, migration no)

Owned files: components/tahi/tasks/task-detail-panel.tsx, components/tahi/tasks/task-chips.tsx, components/tahi/tasks/task-quick-add.tsx, components/tahi/tasks/tasks-list.tsx, components/tahi/tasks/tasks-suggestions.tsx, components/tahi/tasks/tasks-week.tsx (dark tokens only, and only if the live check finds a defect).

### Slice wizard (1 day, backend no, migration no)

Owned files: components/tahi/ai-task-wizard.tsx, lib/task-wizard-drafts.ts, lib/task-wizard-drafts.test.ts.

## Slice briefs

### shell

Follow Claude Design tasks.jsx (the band block and the `errored` gate), tasks-kit.jsx (Rail, Sheet, Toolbar, railCount, ErrorState, the inert rail) and page keys list, list-loading, list-error, board, board-loading, week, week-loading, week-empty, readonly (preview: previews/tasks-preview.html?page=KEY). Build from existing primitives only: PageHeader, KPIStrip plus KPICell (components/tahi/kpi-strip.tsx), SkeletonBar (components/tahi/skeletons.tsx), EmptyState, TahiButton, RailLayout, RailViewItem, RailSelect, SaveDefaultControl, Menu. Do not edit rail-layout.tsx, rail-controls.tsx, kpi-strip.tsx or any other shared primitive.

1. Headline band (new components/tahi/tasks/tasks-band.tsx, rendered in tasks-content.tsx between PageHeader and RailLayout, outside the tabpanel so the e2e `viewPanel` scoping is unaffected). A `<section aria-label="Your tasks at a glance">` holding KPIStrip with four KPICell children, no href (the band is read only; filtering stays in the rail). Figures come straight from the existing `countTasksSavedViews` result so the band and the rail can never disagree:
   - Assigned to me: counts.mine, icon User, tone brand; sub "open on your name" when above zero, "nothing on your name" at zero, and "you are not on the team roster" when the profile loaded with no member and no teammate is being impersonated.
   - Due this week: counts.due_week, icon CalendarDays, tone info; sub "inside the next seven days".
   - Overdue: counts.overdue, icon AlertTriangle, tone danger above zero else neutral; sub "past the date we set" or "nothing is late".
   - Blocked: counts.blocked, icon Flag, tone warning above zero else neutral; sub "waiting on something else" or "nothing is stuck". This is the wide reading (status or an open blocker), the same number the rail's Blocked view shows, not the board column.
   - Loading (booting): the same KPIStrip, same four labels and icons, value and sub drawn as SkeletonBar (value 3rem by 1.5rem, sub 60% by 0.75rem) inside an `animate-pulse` wrapper with aria-hidden, so nothing moves when the figures land. Do not use SkeletonKPIStrip (it is 2 columns at every width and would jump to 4).
   - Error (tasks read failed with no data): same labels, value a muted `Not loaded` (0.875rem, 600, --color-text-subtle), no sub. Assigned to me alone also reads Not loaded when only the profile read failed.
   - Shown on all four views; it counts the whole loaded list, not the filtered one.
2. Honest counts (resolves the critic's open FIX on list-loading, board-loading and week-loading). tasks-content.tsx reads `error` from the tasks and profile SWR calls. `errored = !!tasksError && !tasksData`; `meKnown = !!impersonatedTeamMemberId || (!profileLoading && !profileError)`. Pass the rail `counts={booting || errored ? null : { ...counts, mine: meKnown ? counts.mine : null }}`. In tasks-rail.tsx change the prop to `counts: Readonly<Record<string, number | null>> | null` and hand RailViewItem `count={counts ? counts[key] ?? 0 : null}` (All tasks reads counts.__all). RailLayout: `countOverride={booting ? 'Loading' : errored ? 'Could not load' : (rail.view === 'week' && !meKnown ? 'Could not load' : undefined)}`, so the sheet's primary reads Close instead of "Show 0" while nothing is known.
3. Error state (new components/tahi/tasks/tasks-load-error.tsx): EmptyState full variant with an AlertTriangle icon, title "That list did not load", description "Nothing has changed on your side. The counts above are held back until it loads.", action TahiButton secondary "Try again" with RefreshCw, min height 2.75rem, calling `mutateTasks()`. It replaces the List, Board and My week bodies when `errored` (no quick add, no table); Suggestions keeps its own body because it reads its own route. While `errored`, Export CSV is disabled (Menu.Item `disabled`), so it cannot report "Exported 0 tasks"; add an `exportDisabled` prop to TasksHeaderActions.
4. My week identity states, in tasks-content.tsx before rendering TasksWeek: when the profile read failed (and no impersonation), render the same load error with title "Your week did not load", description "We could not tell which team member you are, so there is no plate to draw. Nothing has changed.", Try again calling the profile mutate. When the profile loaded with no member and no impersonation, render EmptyState (Leaf icon) "You are not on the team roster", "My week draws the tasks assigned to you. Add yourself on Team and your plate shows up here.", action a secondary TahiButton linking to /team. Otherwise TasksWeek as today.
5. Inert rail while My week or Suggestions is on screen (acceptance 5; the design disables every rail control and Liam asked for no note). Add `inert?: boolean` to TasksRail: every RailViewItem gets `disabled`; wrap the Filters and Sort groups and the foot (Clear filters, SaveDefaultControl) in `<fieldset disabled={inert}>` with `border:0; padding:0; margin:0; min-width:0` and opacity 0.45 when inert; reset `openKey` to null when inert turns on; put `aria-disabled` on the root. Remove the dead `note` prop and its paragraph (unused since TP.2). In tasks-content.tsx pass `inert={railInert}` to both rails and pass `onQueryChange={railInert ? undefined : rail.setQuery}` so RailLayout draws no search box while nothing reads it (its documented opt-in contract).
6. Hand the rosters to the standalone wizard: `<AiTaskWizard ... clients={clients} people={peopleList} requests={requestOptions} />` (fact 7). No other wizard change here.
7. Keep everything else in tasks-content.tsx as it is: the fetch keys, booting, the optimistic writes, PATCHABLE_KEYS, CSV, deep link fallback, TasksViewSkeleton, Suggestions.

States to cover: loading (band skeleton, rail counts withheld, "Loading", sheet button Close), empty (band real zeros, "Nothing on the list"), filtered to nothing, error (band Not loaded, rail counts withheld, "Could not load", error block, Export disabled), populated; My week loading, empty, not on roster, profile error; read-only (unchanged). 375: the band is 2 by 2, no horizontal scroll, Try again and the roster CTA at least 44px, Filters sheet controls inert and dimmed in My week. Dark: band icons use KPICell tones only; check the danger and warning tints on the dark card. No hardcoded hex, rem units, no em or en dashes, no single-side borders.

Run e2e/tasks.spec.ts locally: the band sits outside the tabpanel, but confirm no text assertion now double matches (for example "Overdue" in the band and the rail), and that nothing types into search while My week is on screen.

Do not build: the design's own band component or head-band.css, a band that filters on click, the "Counting" wording (RailLayout says Loading), a sentence in the read-only overflow menu, the client interstitial panel, the no-access proposal banner, any change to the view switcher (Suggestions stays).

### detail-dark

Follow Claude Design tasks-detail.jsx TasksDetail (loading branch, delete confirm, the promoted banner), PromoteDialog (the note line), tasks-kit.jsx QuickAdd (the read-only placeholder) and page keys detail, detail-linked, detail-loading, detail-delete, promote, board and week at ?theme=dark.

1. Delete confirm (task-detail-panel.tsx): description becomes "It goes for good, along with its checklist and its thread. Hours logged against it stay in Time." (fact 5). Do not say time is deleted.
2. Detail loading: replace the plain text branch with a `role="status" aria-busy="true"` block inside SlideOver.Body: an `animate-pulse` stack of SkeletonBar (title 70% by 1.25rem, meta 45% by 0.875rem, a 5rem block, a 3rem block, gaps 0.75rem) and a visible line "Loading this task" in --color-text-subtle. Keep "That task is no longer here." exactly as live for a settled missing task.
3. Promote dialog: under the size control add one muted line (0.75rem, --color-text-subtle): "Size files it as small or large work, the same choice as on a new request. The estimate on this task carries across unchanged." (the route copies estimatedHours onto the request).
4. Dark mode token fixes (fact 10), text only, no layout change:
   - task-chips.tsx LEVEL_TINT tahi_internal text: --color-brand-on-tint (it sits on the brand-100 tint). RequestChip hover colour: --color-link. SubtaskBadge complete colour: --color-link.
   - task-detail-panel.tsx `.tskd-open` colour: --color-link; the promoted banner's bold reference: --color-link.
   - task-quick-add.tsx found hint text: --color-brand-on-tint (it sits on an 8% brand mix). Leave the submit button's hover background alone (white text on brand-dark reads in both themes).
   - tasks-list.tsx subtask add hover colour: --color-link.
   - tasks-suggestions.tsx kind pill text on --color-brand-50: --color-brand-on-tint; drop the hex fallbacks in `var(--color-warning-bg, #fff7ed)` and `var(--color-danger-bg, #fef2f2)` (both tokens exist in light and dark).
5. Quick add read-only placeholder: "This seat can read tasks but not add them" instead of "Read-only".
6. Live dark check of Board and My week (never exercised live per STATUS.md): status dots, priority badges, due chips, the dashed blocked tick, the week strip, the planned day cards. Fix only token defects in tasks-week.tsx. Anything wrong inside KanbanBoard is a shared component shared with Requests: log it in TASKS.md with a screenshot, do not edit kanban-board.tsx here.

States: detail loading, missing, populated, linked banner, delete confirm, promote; read-only detail unchanged. 375: the detail SlideOver is full width, every new control at least 44px (none added beyond copy). Dark: every swapped token checked on the dark card at 4.5:1 for text. No hardcoded hex, rem only, no dashes.

Do not build: the Activity or history card (Liam question 3), the "Planned" row and "N days planned" chip (TP.3), a delivery phase or schedule row selector (deliberately dropped, requirement section 4), a promote row action on List or Board (Liam question 4), the design's four value priority scale, removal of the Thread card, the fix for the same-column drop highlight inside KanbanBoard (STATUS P3, shared file).

### wizard

Follow Claude Design tasks-detail.jsx WizardBody, DraftCard and AiWizardDrawer, page keys wizard and new-task-ai. The live AiTaskWizardPanel stays the component; this slice adds three things to it.

1. Pure helper in lib/task-wizard-drafts.ts: `describeDraftLinks(draft, ctx)` returning, for client, assignee and request, either the matched option (id plus canonical name) or the unmatched raw name, using the existing resolveByName and resolveRequestRef and honouring ctx.orgId and ctx.requestId overrides exactly as draftToTaskFields does (so the card can never disagree with what is created). Vitest in lib/task-wizard-drafts.test.ts: exact match, unique prefix, ambiguous prefix (unmatched), context override, empty name, request ref with and without #.
2. Honest draft cards (TaskCard in ai-task-wizard.tsx): print the matched client and assignee by their canonical roster names. When the draft names someone who matches nobody, show a warning chip ("No client match", "Unassigned", "No request match") in the badge warning tokens (--badge-warning-bg, --badge-warning-text, --badge-warning-border, as the brief error already uses) and one `role="note"` line under the chips: "The draft names Maya, which matches nobody on the team, so it lands unassigned rather than guessing." (same shape for a client and a request). Edit in place keeps working; the chips recompute from the edited names.
3. Pick which drafts to create (standalone drawer only, that is when `onDraftToForm` is absent): each card gets an include checkbox (a real checkbox or `role="checkbox"` button, 44px hit area on touch, 2rem on desktop) and a remove control (X, aria-label "Drop this draft"). Hold the excluded and dropped ids in state, reset when a new batch arrives. The create button reads "Create task" or "Create N tasks" for the included count, is disabled at zero, and creates only the included drafts, one POST each as today. The embedded New task view keeps its live "Use this draft" and per-card Use (it fills one form).
4. Context line: when context.orgId resolves to a client in `clients`, show one quiet line at the top of the transcript: "Drafting for Kowtow. Every draft starts on this client." Nothing when it does not resolve.

States: sending, drafts, unmatched names, all excluded (button disabled with the reason in its title), create failure (live message kept), brief errors (live). 375: the drawer is full width, checkbox and X at 44px, no horizontal scroll. Dark: warning chips and the note checked on the dark card. No hardcoded hex, rem only, no dashes.

Shared file note: ai-task-wizard.tsx also serves the request detail's "break into tasks" drawer, which passes context.orgId but no people. After this slice that drawer will show "Unassigned" warnings where it used to show raw names; that is the truth (the assignee never landed), and passing the rosters there belongs to the requests module.

Do not build: the "Estimates come back from the studio rate card" fine print (false on the model path, fact 6), the "Haiku" model chip, a change to the route or the prompt, the design's own drawer chrome (SlideOver stays).

## Skipped (design proposals, Design file only, or waiting on Liam)

1. TP.3 multi-day My week planner (tasks-views.jsx WeekView: bars across days, start and end handles, per-day hours, hours per day capacity, "Planned in another week", the row menu) plus its echoes: the "N days" chip on list rows, the detail "Planned" row and "N days planned" chip. Liam question 1, and per-day allocations need storage the schema does not have. Live keeps the single due date planner.
2. no-access-proposal banner for a scoped seat with no access rules: flagged PROPOSAL on screen, Liam question 2. Live stays silent.
3. Task Activity or history card: Liam question 3; needs a table and a write on every mutation.
4. Create request from task as a List or Board row action: Liam question 4. Detail panel only, as live.
5. The client interstitial ("Tasks is the studio's own list", Go to Requests): the live server redirect wins.
6. The design's priority scale (urgent, high, medium, low) and its local bulk bar (Complete, Assign, Set due, Move to): the repo's standard, high, urgent scale and the shared BulkActionBar (which also does Priority and Unassign) win.
7. The read-only sentence inside the header overflow menu: no sentence slot in the shared Menu.
8. The wizard's rate card fine print and the Haiku chip.
9. head-band.css dark placeholder fix and the scoped rule in tasks-fixes.css: prototype only, moot in the app.

## Questions for Liam

1. TP.3: confirm option A (one due date that follows the last planned day, plus separate per-day allocations) or B (the due date becomes a range). Either way it needs a migration, so it is not in this port.
2. Scoped seat with zero access rules: ship the no-access banner (yes) or leave /tasks silent (no)?
3. Task Activity or history card: wanted at all (a new table plus a write on every mutation)?
4. Create request from task: detail panel only (A), or also a row action on List and Board (B)?
5. Deleting a task leaves its time entries with a dangling task id. Is "hours stay in Time" what you want, or should delete refuse, detach or remove them? The port only fixes the confirm copy to say they stay.
6. The AI task wizard keeps the model's own hour estimates on the model path; the requirement doc says canonical estimates override them. Should the route override (a small backend change), or is the model's number fine and the doc wrong?

## Risks

- Hiding the search box in My week and Suggestions reflows the toolbar row when switching views; an e2e step that types into search on those views would fail (none found; line 151 searches in List).
- The band adds about 12rem of height at 375 (2 by 2) above the list; the quick add moves down. Acceptable per the design, worth a look in the live pass.
- keepPreviousData: a failed revalidation with data on screen keeps the stale list and shows no error; only a first read failure takes the error branch. That is intended.
- `<fieldset disabled>` inside the rail: confirm RailSelect's popover cannot be opened by keyboard while inert and that focus does not land in a disabled group when switching views.
- Slice wizard edits a component the request detail also mounts; the new unmatched warnings will appear there too (honest, but visible).
- Dark mode on the Board and My week has never been checked live; defects inside KanbanBoard are out of this module's files and get logged, not fixed.
- The Blocked tile uses the wide reading; someone comparing it with the Board's Blocked column (status only) will see different numbers. Both are documented readings; the tile's sub line says "waiting on something else".

## Shared files (schedule around other modules)

- components/tahi/ai-task-wizard.tsx (edited by slice wizard; also mounted by app/(dashboard)/requests/[id]/request-detail.tsx and the New task dialog)
- components/tahi/rail/rail-layout.tsx, components/tahi/rail/rail-controls.tsx (used, not edited)
- components/tahi/kpi-strip.tsx, components/tahi/skeletons.tsx, components/tahi/empty-state.tsx, components/tahi/menu.tsx, components/tahi/slide-over.tsx, components/tahi/confirm-dialog.tsx, components/tahi/tahi-button.tsx (used, not edited)
- components/tahi/kanban-board.tsx (shared with Requests; not edited; the P3 same-column highlight stays)
- components/tahi/time-card.tsx, components/tahi/bulk-action-bar.tsx, components/tahi/data-table.tsx, components/tahi/segmented-control.tsx (used, not edited)
- lib/tasks-views.ts, lib/tasks-planner.ts, lib/task-consistency.ts (read, not edited)
- app/globals.css (no change; the fixes use existing tokens)
- docs/superpowers/plans/2026-09-14-design-review-for-liam.md (each slice appends its commit to the tasks section; box stays empty)
- e2e/tasks.spec.ts (run, adjust only if a selector breaks)
