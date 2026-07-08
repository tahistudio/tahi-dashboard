# Tasks - design brief

> The internal daily driver: how the team breaks delivery work into execution
> units, assigns them, tracks subtask progress, and gates with dependencies.
> Tasks are Tahi-internal (clients never see them; that is Requests, spec 07).
> The big missing piece is a "My Work" home; the headline bug is a dead detail page.

> Prepend `_studio-ledger-theme.md` before this brief in Claude design.
> The page lives inside the built-and-live app shell (spec 04): always-dark forest
> rail, hairline top bar, Cmd/Ctrl-K palette, mobile bottom tabs, cream canvas.
> This brief designs ONLY the canvas content plus the page-owned overlays
> (detail slide-over, create dialog, template step, AI wizard, confirms).
> Never re-spec the shell.

## What exists today (as built)

Built but not daily-trusted ("UX still rough"), with one hard bug to fix as part of the redesign.

- `app/(dashboard)/tasks/page.tsx` (server, gates `isAdmin`) -> `tasks-content.tsx`, a **~2700-line monolith** holding list view, board view, bulk bar, the working **detail slide-over** (`TaskDetailPanel`, `max-width: 36rem`), and the new-task dialog (itself a right slide-over, `max-width: 32.5rem`). The redesign is a good moment to decompose it.
- `app/(dashboard)/tasks/[id]/task-detail.tsx` - a **full-page detail that is dead on prod**: `app/api/admin/tasks/[id]/route.ts` exports only `PATCH` (no GET/DELETE), so the page 405s. Board cards link to it via `href={/tasks/${task.id}}` (and dead-end); list rows correctly open the slide-over. The redesign must pick a canonical detail (recommend the slide-over) and either fix or reroute the page.
- **Views:** list and board only (persisted via `useUserPreference`: `tasks.viewMode`, `tasks.typeTab`, `tasks.statusTab`). No calendar, timeline, or My Work / Today.
- **Tabs:** type = All tasks / For us / For a client (per Decision #046 the legacy three-level `type` is collapsed to two buckets via `orgId` presence; `taskBucket()` in `tasks-content.tsx` is the source of truth); status = All / To Do / In Progress / Blocked / Done. Filters: text search (title + org name), due-date range, priority. The status tab is the only server-side filter (it lives in the SWR key); everything else filters client-side so tab counts stay true.
- **Board:** 4 fixed columns (`BOARD_COLUMNS`: todo / in_progress / blocked / done), 17rem wide, native drag (`dataTransfer` carries `taskId` + `fromStatus`) -> `PATCH /api/admin/tasks/[id] {status}` then a refetch (not optimistic). Cards show type chip, title, due chip, subtask progress bar, org avatar, priority, assignee initials, a blocked icon. Column headers currently use a **3px single-side top border** (`borderTop: 3px solid`) - a house-rule violation the redesign removes.
- **Bulk bar:** set status / priority / assignee via `PATCH /api/admin/tasks/bulk` with `{ taskIds, updates }`; renders as a `--color-brand-50` strip with a single-side `borderBottom` (another house-rule violation to fix).
- **Detail slide-over sections as built:** header (title + type chip + org avatar/name), Status select / Priority badge / Due chip row, Assignee, Linked Request link, Delivery Phase `SearchableSelect` (org-scoped schedule rows, spine #148), Description (plain text render), Subtasks (optimistic toggle + inline add, `Add a subtask...`), Blocked By list (dep title + status pill), **Time Logged - a hardcoded placeholder** that always says "No time entries yet." (`timeEntries` has an `idx_time_task` index, so real data exists to wire), and **Activity - a cosmetic textarea** with no submit path ("Use @name to mention someone (coming soon)").
- **Calls:** `/api/admin/tasks/[id]/calls` + `DiscoveryCallsCard` render **only on the dead full page**; the working slide-over never shows a task's calls. The canonical detail must absorb them.
- **Schema** (`db/schema.ts`): `tasks` (`type` client_task/internal_client_task/tahi_internal legacy; `orgId` null = for us; `status` todo/in_progress/blocked/done; `priority` standard/high/urgent; **single `assigneeId` + `assigneeType`** team_member or contact; `dueDate`; `completedAt`; `createdById`; `tags` JSON; `trackId` + `position`; `requestId` link; `scheduleRowId` delivery phase). `taskSubtasks` (**flat, one level**: title + completed boolean). `taskDependencies` (**blocks-only**, no FS/SS/FF types; surfaced as `blockedByCount` + a warning). `taskTemplates` (name, type, category, description, defaultPriority, subtasks JSON of title strings, estimatedHours) - **no date offsets in the schema**.
- **APIs:** `/api/admin/tasks` GET (access-scoped via `resolveAccessScoping`, joins org, batch-loads subtask counts + deps) / POST; `/tasks/bulk` PATCH; `/tasks/from-template` POST (**sets `dueDate: null` and accepts no due-date param** - date remapping is an API addition, see below); `/task-templates`; `/tasks/[id]` (PATCH only - the bug); `/tasks/[id]/subtasks` (+ `[subId]`); `/tasks/[id]/dependencies` (+ `[depId]`); `/tasks/[id]/calls`; `/ai/task-wizard`.
- **Priority enum drift inside our own UI:** the dead detail page's `PRIORITY_OPTIONS` includes `low`, and `PriorityBadge` renders a Low badge, but PATCH validates only `['standard','high','urgent']` - selecting Low 400s. Audit-grade finding; unify on standard/high/urgent.
- **Access:** admin bypasses; other team members scoped to granted orgs (`resolveAccessScoping` on GET; `requireAccessToOrg` / `getOrgScope` on PATCH). Tasks are 100% admin-gated; **clients never see tasks** (Decisions #030/#046).
- **AI Task Wizard** (`components/tahi/ai-task-wizard.tsx`, `SPECS/ai-task-wizard.md`): a conversational slide-over on Claude Haiku 4.5, brand-voice, returns `TaskDraft[]` to review/edit/confirm. Note the enum mismatch: drafts use `type: 'small' | 'large'` and `priority: 'low' | 'medium' | 'high' | 'urgent'`, but the DB uses the scope `type` and `priority: standard | high | urgent`.
- **Status tone map as built** (`TASK_STATUS_TONE`): todo = info, in_progress = teal, blocked = danger, done = positive. The legacy `TASK_STATUS_CONFIG` maps blocked to the *in-review* tokens - inconsistent; the redesign settles on one mapping (below).

## Page purpose

Give the team a fast, calm cockpit for execution: what is mine, what is due, what is blocked; move work through the pipeline; spin up repeatable work from templates or the AI wizard; and tie tasks to the request and the delivery phase they serve. The default landing changes from "all tasks" to **My Work**: assigned-to-me, grouped by time, with the three numbers that matter rendered bare.

## Why we are on this page

A two-person studio does not open a task tool to admire a board; it opens it forty times a day to answer one question: "what is my next thing?" Today the page answers a different question ("what are all the things?") and its best affordance, the board card, links to a dead page. That is why tasks are built but not trusted. The redesign earns daily trust the only way a task tool can: it opens to your work, ordered by urgency, with zero ceremony between seeing a task and finishing it. The owner gets a second lens (Everyone) to run the studio; the teammate never needs it. Every create path (a keystroke, a form, a template, an AI draft) writes one identical, clean record, so the list is never polluted by the way a task was born.

**The single experiential throughline, which every element must serve or be cut:**

> Open, see your next thing, knock it out - the tool gets out of the way.

## Personas and jobs-to-be-done

**1. The teammate (team_member: a designer, developer, or PM).** Scoped to their granted clients. The primary user and the primary gap.
- *Mindset:* focused, mildly time-pressed, allergic to admin overhead; wants the list to be the truth so nothing lives in their head.
- *JTBD:* "Show me what is mine and due today, what is blocking me, and let me knock it out."
- *Must see:* My Work first, overdue loudly, the blocked reason on the row, a one-keystroke quick-add, subtask progress at a glance.
- *Must feel:* on top of it. The list is short, honest, and shrinks as the day goes on.

**2. The owner / PM (super_admin: Liam / Staci).** Runs delivery across every client.
- *Mindset:* context-switching; needs the studio-wide picture and the per-person picture without losing their own list.
- *JTBD:* "What is in flight across the studio, who is overloaded, what is overdue or blocked, and let me draft a plan fast."
- *Must see:* the Everyone switch, the all-tasks list with grouping by assignee/client, the board for pipeline shape, bulk actions, templates + the AI wizard for planning.
- *Must feel:* in command without drowning. One click between "my day" and "the studio".

**3. The client.** Not a user of tasks. Tasks are internal; client-facing work is Requests (07). This spec adds no client task views, and no task string ever renders in the portal.

**The tension to resolve:** the teammate needs a short personal list; the owner needs the whole map. **The call:** My Work is the shared default for both (owner included - their own work matters too), with an owner-only Me / Everyone switch and the All tasks + Board lenses one segment away. Never two different pages; one page, three lenses, one scope switch.

## What others do (and what we take)

- **Linear "My Issues"** - keyboard-first, near-zero chrome, assigned-to-me grouped by status/cycle; speed as a feature. The model for our My Work view and quick-add.
- **Asana "My Tasks"** - auto-promoting time buckets (Recently assigned / Today / Upcoming / Later) and a list/board switch. We adopt the time-bucket grouping and the promotion behaviour (a task rolls from This week into Today at midnight, calmly).
- **ClickUp** - deep hierarchy, full dependency types, templates with date remapping, recurring tasks. We stay shallow (task -> flat subtask) by schema but take templates + date remapping (and recurring as a future note).
- **Motion** - AI auto-scheduling (estimate + priority -> timeblocked, reschedules on slip, warns on overcommit). A north star for pairing our AI wizard with due dates + capacity, not in scope now.
- **Todoist** - GTD next-actions, priority + labels, quick-add grammar. We take the "quick-add defaults are smart" idea (due today, assigned to me) without inventing a syntax parser.
- **Timeless ideas** - My Tasks as the default landing; a clear "what's mine and due today"; checklists with visible progress; templates for repeatable work; an explicit blocked state; overdue surfaced loudly; keyboard-first quick-add.

## Experience principles

1. **My Work is the front door.** The default landing is assigned-to-me, grouped Overdue / Today / This week / Later / No date; consequence: a teammate never has to filter their way to their own day, and the page is useful in under a second.
2. **Counts as hero.** Overdue, Due today, and Blocked render as one bare tabular strip, Studio Ledger style; consequence: this strip is the page's single hero zone and no other outsized figure appears anywhere on the surface.
3. **Calm editorial list over heavy cards.** Hairline-separated rows on the cream canvas are the primary view; consequence: the board is a secondary lens, and no view boxes every task in a shadowed card.
4. **One canonical detail.** The slide-over is the detail everywhere (list row, board card, My Work row); consequence: the dead `/tasks/[id]` page is retired into a redirect and no second detail layout is ever designed.
5. **Keyboard-first.** Quick-add commits on Enter, the list is arrow-navigable, the board is movable without a mouse; consequence: every pointer path in this spec names its keyboard twin.
6. **One write shape.** Quick-add, dialog, template, and AI wizard all produce the same fields with the same enums; consequence: the wizard's draft enums are mapped before create, and no consumer can tell how a task was born.
7. **Status colour only when literally true.** Danger ink appears only on overdue and blocked; consequence: a healthy list is ink-on-sand with a single green accent on the CTA, and red regains its meaning.

## Anatomy

The named regions of the canvas, top to bottom (the shell above and beside them is spec 04):

1. **Page header row** - bare-ink `<h1>` "Tasks" left; right-aligned cluster: view switch (My Work / All tasks / Board), owner-only scope switch (Me / Everyone), "Draft with AI" secondary button, "+ New task" primary CTA.
2. **Hero counts strip** (My Work lens only) - three bare tabular figures: Overdue, Due today, Blocked.
3. **Quick-add row** (My Work lens only) - a single input, always visible above the groups.
4. **Work region** - one of the three lenses: the grouped My Work list, the all-tasks list with its filter bar, or the four-column board.
5. **Bulk action bar** (All tasks lens, appears on selection) - pinned above the list rows.
6. **Page-owned overlays** - detail slide-over (canonical), new-task dialog, template step, AI wizard slide-over, confirm dialogs. All portal above the canvas; none re-style the shell.

## Layout and composition - desktop

Canvas content sits on `--color-bg-cream` inside the shell's content column: max content width `72rem`, side gutters `2rem`, top padding `2rem`. The page is a single column; no sidebars within the page.

**Vertical order and measures (My Work lens):**
- Page header row: `<h1>` at `1.5rem` 600 ink; the right cluster is a `0.5rem`-gapped row. `1.5rem` below to the hero strip.
- Hero strip: three figure blocks in a row, `3rem` gap between blocks. Figure: `2.25rem`, weight 300, `letter-spacing -0.02em`, `font-variant-numeric: tabular-nums`. Ledger label directly under each figure. A full-width hairline (`--color-border-subtle`) closes the strip, `1.5rem` below it.
- Quick-add row: full width, height `2.75rem`, `1rem` below to the first group.
- Groups in fixed order: Overdue, Today, This week, Later, No date. Empty groups are skipped entirely (never an empty header). Group header height `2rem`; rows `3.25rem` tall with hairline separators (`--color-border-subtle`); `1.5rem` gap between groups.
- Row grid, left to right: checkbox `1.125rem` | title (flex, truncates) | org chip (auto) | due chip (auto, right cluster) | subtask micro-bar `4.5rem` + fraction | blocked indicator (auto) | assignee avatar `1.25rem` (Everyone scope only). The right-hand meta cluster is right-aligned with `0.75rem` gaps and never wraps; the title truncates first.

```
+------------------------------------------------------------------------------+
| SHELL (spec 04): dark rail 240px | hairline top bar (breadcrumb, search...)  |
+------------------------------------------------------------------------------+
|  cream canvas, max 72rem, gutters 2rem                                       |
|                                                                              |
|  Tasks                [My Work | All tasks | Board] [Me|Everyone]            |
|                                     [Draft with AI] [+ New task]  <- leaf CTA|
|                                                                              |
|   4            2            1                                                |
|   OVERDUE      DUE TODAY    BLOCKED          <- hero strip, tabular, bare    |
|  ----------------------------------------------------------------- hairline |
|  [ +  Add a task...                                              ]           |
|                                                                              |
|  OVERDUE . 4                                                                 |
|  [ ] Fix nav contrast on mobile   (For Physitrack) [3d overdue] ==-- 1/3 (av)|
|  ------------------------------------------------------------------         |
|  [ ] Send May invoice summary     (For us)         [1d overdue]          (av)|
|                                                                              |
|  TODAY . 2                                                                   |
|  [ ] Homepage hero revisions      (For Kwan & Co)  [Due today] =--- 0/4  (av)|
|  ------------------------------------------------------------------         |
|  [ ] Draft case study outline     (For us)         [Due today] (!) Blocked by 1
|                                                                              |
|  THIS WEEK . 3   ...   LATER . 5   ...   NO DATE . 2                         |
+------------------------------------------------------------------------------+
        ^ detail slide-over (36rem) portals over the right edge on row click
```

**All tasks lens:** the hero strip and quick-add are replaced by the filter bar (type tabs + status tabs on one row; search, due-range, priority, group-by on a second row), then the list. Selection checkboxes appear on hover/focus at the row's left edge; the bulk bar mounts between filter bar and list when 1+ selected. Grouping (Status / Assignee / Client / Due date / None) reuses the same ledger group headers as My Work.

**Board lens:** four fixed columns, `17rem` wide, `0.75rem` gap, horizontal scroll if the canvas is narrower than `71rem`. Column = ledger-label header (label + count) on a flat `--color-bg` surface with a full hairline border (no coloured top edge), cards stacked below with `0.5rem` gap. Cards open the detail slide-over.

## Layout and composition - mobile

375px reference, inside the shell's mobile frame (condensed top bar + bottom tabs, spec 04). Gutters `1rem`. The view switch condenses to a segmented control full-width under the title; the scope switch (owner) sits inside a filters sheet.

**Stacking order (My Work):** title row -> view switch -> hero strip -> quick-add -> groups. What changes:
- Hero strip: three figures across, figure size drops to `1.5rem`, labels `0.625rem`; the strip stays one row (it fits at 375px).
- Rows: `3.5rem` tall (>=44px touch), the subtask micro-bar is dropped and only the `1/3` fraction remains; org chip truncates to the org's first word + ellipsis at 320px; checkbox target padded to `2.75rem` square.
- The detail slide-over becomes a full-screen sheet (100vw) with a sticky header and a back/close control >=44px.
- Board: columns stay `17rem` and swipe horizontally with scroll-snap; a column dot indicator sits under the switch. Drag is replaced by the card's "Move to" action (long-press or the card menu) because touch drag across snap-scroll is unreliable.
- Quick-add keeps focus after commit so multiple adds are one flow; the on-screen keyboard never occludes the input (input scrolls into view).

```
+---------------------------+
| (mark)  Tasks        (Q)  |  <- shell top bar
+---------------------------+
| [My Work | All | Board]   |
|                           |
|  4        2        1      |
|  OVERDUE  DUE TDY  BLOCKED|
| ------------------------- |
| [ + Add a task...       ] |
|                           |
| OVERDUE . 4               |
| [ ] Fix nav contrast      |
|     For Physitrack        |
|     [3d overdue]  1/3     |
| ------------------------- |
| [ ] Send May invoice      |
|     For us  [1d overdue]  |
|                           |
| TODAY . 2  ...            |
+---------------------------+
| (o)  (o)  [o]  (o)  (=)   |  <- shell bottom tabs
+---------------------------+
```

## Component spec

All tokens are the Studio Ledger CSS variables; no hardcoded hex anywhere on this page.

**View switch (My Work / All tasks / Board)**
- Purpose: the three lenses on one dataset; persisted to `tasks.viewMode` (extended to `'my_work' | 'list' | 'board'`, default `my_work`).
- Anatomy: segmented control, height `2.25rem`; segments `0.8125rem` 500, padding `0 0.875rem`; container `--color-bg-secondary` fill, full hairline `--color-border`, `--radius-md`.
- Tokens: active segment `--color-bg` fill + `--color-text` ink + hairline `--color-border-strong`; inactive `--color-text-muted`.
- States: rest; hover (inactive segment ink lifts to `--color-text`); focus-visible 2px `--color-brand-dark` ring; active as above. Keyboard: arrow keys move between segments (roving tabindex, `role="tablist"`).

**Scope switch (Me / Everyone) - owner only**
- Purpose: flip My Work between "assigned to me" and the whole studio; sits immediately right of the view switch, top right.
- Anatomy: the same segmented control at `2.25rem`, two segments. Hidden entirely for non-owner roles (server-resolved; absent, never disabled).
- States: as the view switch. In Everyone scope, rows gain the `1.25rem` assignee avatar and groups can be subgrouped later (out of scope now).

**Hero counts strip**
- Purpose: the page's one hero zone; answers "how urgent is my day" before a single row is read.
- Anatomy per block: figure (`2.25rem`, weight 300, `-0.02em`, tabular-nums) above a ledger label (`--text-2xs` 600, uppercase, `0.08em`, `--color-text-subtle`). Blocks left-aligned in a row, `3rem` gaps; a full-width `--color-border-subtle` hairline closes the strip.
- Tokens: figure ink `--color-text` by default. Overdue and Blocked figures switch to `--color-danger` **only when nonzero**; Due today never takes a status colour. A zero renders in `--color-text-subtle`.
- States: loading (three `2.25rem x 3rem` pulse skeletons); values animate via a 300ms count-settle fade on data change (no ticker); reduced motion swaps values instantly.

**Quick-add row**
- Purpose: zero-ceremony capture; the Linear-grade keystroke path.
- Anatomy: full-width row, height `2.75rem`; a plus icon `1rem` in `--color-text-subtle` at left inset `0.875rem`; input text `0.875rem`; placeholder "Add a task..."; a right-aligned ghost hint "due today - assigned to you" in `--text-2xs` `--color-text-subtle` (hidden below 640px).
- Tokens: rest = transparent fill + full hairline `--color-border` + `--radius-md`; focus = `--color-bg` fill, `--color-brand` border, 2px `--color-brand-100` ring.
- Behaviour: Enter commits `POST /api/admin/tasks` with `{ title, orgId: null, priority: 'standard', dueDate: today, assigneeId: me, assigneeType: 'team_member' }`; the row inserts optimistically at the foot of Today with a 200ms fade-in; input clears and keeps focus. Esc clears the draft text. Empty Enter does nothing.
- States: rest, hover (border lifts to `--color-border-strong`), focus, committing (plus icon swaps to a `1rem` spinner), error (toast "That did not save. Try again." and the typed title is restored to the input, never lost).

**Group section header**
- Purpose: the time buckets (and the All-tasks group-by headers) in ledger voice.
- Anatomy: label + middle dot + count on one `2rem` line: "OVERDUE . 4". Label `--text-2xs` 600 uppercase `0.08em` `--color-text-subtle`; count same style in `--color-text-muted`, tabular.
- Tokens: the Overdue label alone renders in `--color-danger` when its count is nonzero (the only tinted header). No fills, no borders; whitespace and the row hairlines do the separation.
- States: static; a group whose count reaches zero fades out over 200ms and its space collapses (instant under reduced motion).

**My Work row**
- Purpose: one task, one line, finishable in place.
- Anatomy, in order: (1) completion checkbox `1.125rem`, `--radius-sm`, hairline `--color-border-strong`; (2) title `--text-base` (0.875rem) 500 `--color-text`, truncating; (3) org chip when `orgId` set: "For Physitrack" in `--text-2xs` 600 on `--color-bg-secondary` + hairline `--color-border-subtle`, `--radius-sm`, padding `0.125rem 0.5rem` ("For us" tasks show no chip in My Work - the absence is the signal); (4) due chip (tone ramp below); (5) subtask micro-bar `4.5rem x 0.25rem`, track `--color-border-subtle`, fill `--color-brand` (or `--color-success` at 100%), with fraction "1/3" in `--text-2xs` `--color-text-subtle` tabular; rendered only when subtasks exist; (6) blocked indicator: git-branch icon `0.75rem` + "Blocked by 2" in `--text-xs` 500 `--color-danger`; (7) assignee avatar `1.25rem` circle (Everyone scope only, tooltip = name). Row height `3.25rem`; hairline `--color-border-subtle` between rows.
- Due chip tone ramp (text + tint, never colour alone): overdue = "3d overdue" on `--color-danger-bg` in `--color-danger` with a `0.625rem` alert icon; due today = "Due today" on `--color-warning-bg` in `--color-warning` ink-safe text token; due in 1-3 days = "Due in 2d" bare in `--color-text-muted` with a `0.625rem` calendar icon; later = "12 Jul" bare `--color-text-muted`; no date = omitted.
- States: rest; hover `--color-bg-secondary` full-row wash; focus-visible 2px inset `--color-brand-dark` ring on the row (the row is a button opening the slide-over); checkbox checked = brand fill + white check, title takes `line-through` + `--color-text-subtle`, then the row fades out over 400ms and the hero figures update (instant under reduced motion; an "Undo" toast covers slips); loading = pulse skeleton rows at `3.25rem`; blocked rows are never auto-suppressed.
- Keyboard: Up/Down move row focus, Enter opens the slide-over, Space toggles the checkbox.

**All-tasks filter bar**
- Purpose: slice the full dataset; owner's planning surface.
- Anatomy, row 1: type tabs (All tasks / For us / For a client) each with a tabular count badge; status tabs (All / To Do / In Progress / Blocked / Done) right-aligned. Row 2: search input `16rem` (placeholder "Search tasks or clients..."), due-range picker, priority select (All priorities / Standard / High / Urgent), group-by select (Group by: Status / Assignee / Client / Due date / None).
- Tokens: active tab = `--color-brand-50` fill + `--color-brand-dark` ink + hairline `--color-brand` border, `--radius-md`; inactive = transparent + `--color-text-muted`; count badge = pill, active `--color-brand` on white text, inactive `--color-bg-secondary` + `--color-text-subtle`. Inputs per theme (white fill, `--color-border`, focus brand ring).
- States: each control has rest/hover/focus; tab counts always reflect the full dataset, not the current slice (preserve the as-built behaviour); filters persist per user (`tasks.typeTab`, `tasks.statusTab`).

**All-tasks list row**
- As the My Work row, plus: a selection checkbox in a `2rem` leading gutter (visible on hover/focus and whenever any selection exists), a status badge (To Do = quiet neutral chip; In Progress = `--color-info-bg`/info ink; Blocked = `--color-danger-bg`/danger; Done = `--color-success-bg`/success), and a priority badge (Standard renders nothing; High = warning-tinted chip "High"; Urgent = danger-tinted chip "Urgent"). "For us" rows here DO show the "For us" chip (the list mixes buckets, so the label earns its place).

**Bulk action bar**
- Purpose: mass edits without leaving the list.
- Anatomy: full-width bar, height `2.75rem`, mounted between filter bar and rows: "3 selected" (`0.8125rem` 600 `--color-brand-dark`), then three menu buttons (Change status / Change priority / Assign), a spacer, "Clear" ghost button.
- Tokens: `--color-brand-50` fill, full hairline `--color-brand-100` border (all sides), `--radius-md`. Menus are portaled popovers on `--color-bg` with `--shadow-floating`, hairline border, `--radius-md`; items `2.25rem` tall with hover `--color-bg-secondary` and focus ring.
- States: rest; busy (menu buttons disabled + `1rem` spinner beside the count); success (toast "Updated 3 tasks", selection clears); the bar unmounts with a 150ms fade when selection empties. Esc closes an open menu, then clears selection.

**Board column**
- Purpose: pipeline shape at a glance.
- Anatomy: header row `2.5rem` (status dot `0.5rem` + ledger label + tabular count pill), then the card stack. Column surface `--color-bg-secondary`, full hairline `--color-border`, `--radius-lg`; **no coloured top edge** (the as-built 3px top border is removed per house rules) - the status dot + label carry identity.
- States: rest; drag-over = border lifts to `--color-brand` + a `2px` dashed insertion line where the card will land; empty = centred "No tasks" in `--text-xs` `--color-text-subtle` inside a full dashed hairline box.

**Board card**
- Purpose: one task in the pipeline; opens the canonical slide-over (never `/tasks/[id]`).
- Anatomy: `--color-bg` surface, full hairline `--color-border`, `--radius-md`, padding `0.75rem`; line 1 title `0.8125rem` 500 (2-line clamp); line 2 org chip or "For us" chip + priority badge; line 3 due chip + subtask micro-bar + blocked indicator + assignee avatar `1.25rem` right-aligned.
- States: rest; hover (border `--color-border-strong` + cursor grab); dragging (source dims to 50%, a ghost follows the pointer); focus-visible ring; keyboard path: the card is a button - Enter opens the slide-over, Shift+ArrowLeft / Shift+ArrowRight moves it one column (announced via `aria-live` "Moved to In Progress"), matching the drag PATCH exactly.

**Detail slide-over (the ONE canonical detail)**
- Purpose: read + edit everything about a task without losing list context.
- Frame: right-anchored panel `36rem` wide (100vw full-screen sheet on mobile), `--color-bg` surface, `--shadow-floating`, no border radius on the attached edge; dimmed backdrop `rgba(0,0,0,0.4)`. `role="dialog" aria-modal="true"`, focus-trapped, Esc closes, focus returns to the opening row/card.
- Section order, top to bottom:
  1. **Header** (sticky): title `1.125rem` 600 (click to edit inline, Enter saves, Esc reverts); under it the bucket line ("For Physitrack" with `1.25rem` org avatar, or "For us"); a close button `2.25rem` top right; an overflow menu (Delete task) beside it.
  2. **Controls row:** four labelled fields in a grid (Status select / Priority select / Assignee picker / Due date picker), labels in ledger micro-style, inputs per theme. Every change PATCHes immediately with optimistic UI + toast.
  3. **Description:** Tiptap-rendered rich text; empty = "No description yet." in italic `--color-text-subtle`; click to edit for admins.
  4. **Links:** "Linked request" (a quiet chip linking to `/requests/[id]`, showing the request title and its pipeline status chip using the canonical labels: Submitted, In Review, In Progress, Client Review, On Hold, Delivered, Cancelled) and "Delivery phase" (the org-scoped `SearchableSelect` of schedule rows; placeholder "Not linked"; hidden when the task has no org and no phases exist).
  5. **Subtasks:** ledger label "Subtasks (2/5)" + the micro-bar full-width (`0.25rem`), then the checklist: rows `2.5rem`, circle-check icon `1rem`, title `0.8125rem` (completed = line-through + subtle ink), optimistic toggle; inline add input "Add a subtask..." + Enter.
  6. **Blocked by:** chips per dependency (`--color-bg-secondary` fill, hairline, git-branch icon, dep title + its status badge, an x-remove for admins). When any dependency is not done, a warning line renders above the chips: alert icon + "2 blocking tasks are not done yet." in `--text-xs` `--color-danger` on `--color-danger-bg`, full hairline, `--radius-sm`. Empty = "No dependencies."
  7. **Time logged:** real `timeEntries` for this task (wire the existing `idx_time_task` data; the as-built placeholder goes): total hours as "6.5h logged" in tabular 600, then up to five entries (date, member, hours) with "View all in Time" linking to `/time?task=[id]`. Empty = "No time logged yet."
  8. **Calls:** the task's linked calls from `/api/admin/tasks/[id]/calls` (absorbing the `DiscoveryCallsCard` from the dead page): row per call (title, date, a "Notes" link). Empty = "No calls linked."
- States: loading (section skeletons under a real header), saving (control-level spinners, never a full-panel block), error (field-level toast + revert), delete confirm (dialog below).
- Completing with open subtasks (checkbox in list, or Status -> Done): confirm dialog "Finish this task?" / "3 subtasks are still open. Mark the task done anyway?" [Mark done] [Keep working]. Completing while blocked: "This task is blocked by 1 task that is not done. Mark it done anyway?" - completion is never silent past a live dependency.

**New task dialog**
- Purpose: the full-fidelity create path.
- Frame: right slide-over `32.5rem` (keep the as-built frame), same dialog semantics as the detail.
- Anatomy, top to bottom: heading "New task"; "Start from a template" select (loads name/description/priority/subtasks into the form on pick; links "Manage templates" -> Settings > Intake & boards > Task templates, the canonical home per spec 09 - this dialog never edits templates); Title input (required, autofocus); "For" toggle (For us / For a client) - picking "For a client" reveals the required Client searchable select; Description textarea; Priority select (Standard / High / Urgent); Due date; Assignee select; Subtasks list-builder (input + Enter to append, x to remove). Footer: [Cancel] ghost + [Create task] primary leaf CTA.
- Writes the one canonical shape: `{ title, type: derived from orgId, orgId, description, priority, assigneeId, assigneeType, dueDate, subtasks[] }`.
- States: rest; submitting (CTA spinner + "Creating..."); inline error under the offending field ("Choose a client for this task."); network error banner (quiet danger, `role="alert"`).

**Template picker step (date remapping)**
- When a template is chosen, an anchor row appears under the select: "Due date" picker + helper "The task takes this due date; estimated hours come from the template." Applying calls the from-template path with the chosen `dueDate` - **note: `/api/admin/tasks/from-template` must gain a `dueDate` param (it hardcodes null today)**. Because `taskTemplates` carries no per-subtask offsets, remapping v1 is anchor-date only; per-subtask offsets are a schema addition (open decision).
- Empty templates state: "No templates yet." + "Create templates in Settings to reuse repeatable work." + link "Manage templates".

**AI wizard draft review**
- Frame: the existing conversational slide-over (`components/tahi/ai-task-wizard.tsx`); this spec restyles the review list, not the chat.
- Each draft card: title (editable), description (2-line clamp, expandable), category chip, priority select, estimated hours, due date, assignee select, [Remove]. Footer: "Create 4 tasks" primary CTA + "Keep refining" ghost.
- **Enum mapping is mandatory before create:** draft `priority` low/medium -> `standard`, high -> `high`, urgent -> `urgent`; draft `type` small/large maps to nothing in the DB - the review step asks For us / For a client + client once for the batch, and the write uses the same canonical shape as the dialog. No wizard-flavoured fields ever reach the API.

**Empty states**
- My Work, all caught up: leaf-radius icon wrapper (`--radius-leaf-sm`, `--color-brand-50` fill, check icon in `--color-brand-dark`), title "You are all caught up.", line "Nothing assigned to you is due. Add a task or check the studio board.", CTA "+ New task".
- My Work, new teammate (no grants, fail-closed): same wrapper with a leaf icon, title "Nothing assigned to you yet.", line "When work is assigned to you it lands here, grouped by when it is due." No CTA that would 403; nothing about other people's tasks leaks.
- All tasks, none exist: title "No tasks yet.", line "Create the first task, start from a template, or draft a set with AI.", CTA "+ New task".
- Filtered to nothing: "Nothing matches these filters." + ghost "Clear filters".

## Motion and dynamism

All motion uses `--ease-out cubic-bezier(.22,1,.36,1)`; nothing springs or bounces; every animation triggered by hover plays to completion and never reverses mid-way.

- Lens switch (My Work / All / Board): content cross-fade 150ms; no slide.
- Row complete: check fills 110ms; strike-through + ink fade 200ms; row collapse 400ms; hero figures re-settle 300ms. Undo toast 5s.
- Quick-add commit: new row fades in + 4px rise, 200ms.
- Group promotion (This week -> Today at day rollover): the row fades out of one group and into the other, 200ms each, staggered 80ms.
- Board drag: ghost follows at full speed; drop settles 200ms; source column count and destination count update with a 300ms figure fade. Keyboard move animates the same settle.
- Slide-over: panel translates in from the right 240ms + backdrop fade 150ms; close reverses (a close animation reversing is fine; only hover-triggered animations must not reverse).
- Bulk bar: mounts with a 150ms fade + 4px rise; unmounts with a 150ms fade.
- Skeletons: pulse at 1.2s.
- `prefers-reduced-motion: reduce`: all of the above become instant state changes (rows appear/disappear, panel appears, figures swap); nothing is lost functionally and skeleton pulses become static blocks.

## Accessibility (WCAG 2.2 AA)

- **Landmarks + structure:** the canvas content is inside the shell's `<main>`; `<h1>` "Tasks"; each group header is an `<h2>` with the count in the accessible name ("Overdue, 4 tasks"); the hero strip is a `<dl>` (label/value pairs) so screen readers get "Overdue: 4".
- **Names:** every icon-only control (close, overflow, checkbox, remove-dependency) has an `aria-label`; the completion checkbox's name is "Mark [title] done"; the row button's name is the title plus due state ("Fix nav contrast, 3 days overdue, blocked by 1").
- **Focus:** visible 2px `--color-brand-dark` focus ring on every interactive element (inset ring on full-bleed rows); the slide-over and dialogs trap focus, close on Esc, and return focus to their trigger; no `outline: none` without a `:focus-visible` substitute.
- **Focus order:** header cluster -> hero strip (skipped, non-interactive) -> quick-add -> rows in visual order -> (overlays when open). On lens switch, focus moves to the first row or the empty-state heading.
- **Keyboard paths:** quick-add Enter/Esc; list Up/Down/Enter/Space; board card Enter to open, Shift+Arrow to move column with an `aria-live="polite"` announcement; bulk menus are arrow-navigable with Esc-to-close-then-clear; segmented controls are `role="tablist"` with arrow-key roving.
- **Contrast:** figures and titles in `--color-text` on cream clear AA comfortably; `--color-text-subtle` is AA on sand for the micro-labels (per theme); danger text on `--color-danger-bg` must use the dark danger ink token, never `#f87171` on white for body-size text; verify the warning chip ink on `--color-warning-bg` hits 4.5:1 and darken the text token if it misses.
- **Not colour alone:** overdue = tint + icon + "3d overdue" text; blocked = icon + "Blocked by N" text; done = strike-through + check, not just green.
- **Targets:** >=44px on all mobile touch targets (rows, checkboxes via padding, segmented controls, sheet close); >=24px floor on desktop (the `1.125rem` checkbox sits in a >=24px hit area).
- **Announcements:** optimistic saves announce via `aria-live="polite"` ("Status updated"); errors via `role="alert"`; the dependency warning is text in-flow, not a toast that vanishes.
- **Reduced motion** per the Motion section; **forced-colors:** chips and badges keep hairline borders so they survive tint-stripping; focus rings use system colours.

## States and flows

- **My Work default:** teammate lands on Me scope; owner lands on Me with the Everyone switch visible. Overdue present = danger figures + tinted group header. All clear = the caught-up empty state under a zeroed (subtle-ink) hero strip.
- **Create x4, one write shape:** quick-add (Enter, defaults due today + me); dialog (full form); template (anchor due date, subtasks copied); AI wizard (drafts mapped to canonical enums, batch create). All four land in the same lists identically.
- **Complete:** checkbox or Status -> Done; with open subtasks -> confirm; while blocked -> confirm; sets `completedAt`; hero figures update; Undo toast.
- **Move status:** board drag, keyboard Shift+Arrow, detail Status select, bulk bar - all the same `PATCH {status}`.
- **Blocked:** dependency chips + the unresolved warning in the detail; "Blocked by N" on rows; the Blocked hero figure; never silently completable.
- **Scoped teammate:** `resolveAccessScoping` filters every fetch; a teammate sees only granted orgs' tasks + own for-us tasks; a teammate with no grants sees the guided empty state (fail-closed, per spec 05), never the studio's work.
- **Dead route retired:** `/tasks/[id]` 301-redirects to `/tasks?task=[id]`, which opens the slide-over on load (deep-linkable detail); board cards stop linking to the page entirely.
- **Loading:** hero skeletons + row skeletons; the shell renders instantly around them. **Error:** a quiet inline retry ("Could not load tasks." + [Try again]), never a blank canvas.
- **Bulk:** select -> bar mounts -> menu action -> busy -> toast -> selection clears.
- **Owner Everyone scope:** avatars appear on rows; grouping by assignee available in All tasks; the hero strip re-computes to studio-wide counts with the label unchanged.
- **Dark mode:** the same composition on the dark canvas tokens (`--color-bg-dark` family); chips and hairlines flip via tokens; the hero figures stay bare ink (`--color-text-dark`).

## Copy deck

Calm, plain NZ voice. Hyphens only, no em or en dashes. Sentence case everywhere except ledger micro-labels, which are styled uppercase in CSS.

- Page title: `Tasks`
- View switch: `My Work` / `All tasks` / `Board`
- Scope switch: `Me` / `Everyone`
- Header buttons: `Draft with AI` / `New task`
- Hero labels: `Overdue` / `Due today` / `Blocked`
- Group headers: `Overdue` / `Today` / `This week` / `Later` / `No date`
- Quick-add placeholder: `Add a task...` - ghost hint: `due today - assigned to you`
- Org chip: `For {Client}` - bucket label: `For us`
- Due chips: `{N}d overdue` / `Due today` / `Due in {N}d` / `{12 Jul}`
- Blocked row text: `Blocked by {N}`
- Status labels: `To Do` / `In Progress` / `Blocked` / `Done`
- Priority labels: `Standard` / `High` / `Urgent`
- Type tabs: `All tasks` / `For us` / `For a client`
- Filter bar: search placeholder `Search tasks or clients...`; `Due` range; `All priorities`; `Group by` with `Status` / `Assignee` / `Client` / `Due date` / `None`
- Bulk bar: `{N} selected` / `Change status` / `Change priority` / `Assign` / `Clear`
- Board empty column: `No tasks`
- Detail field labels: `Status` / `Priority` / `Assignee` / `Due date` / `Description` / `Linked request` / `Delivery phase` / `Subtasks ({done}/{total})` / `Blocked by` / `Time logged` / `Calls`
- Detail empties: `No description yet.` / `Not linked` / `No dependencies.` / `No time logged yet.` / `No calls linked.`
- Detail links: `View request` / `View all in Time`
- Dependency warning: `{N} blocking task{s} {is/are} not done yet.`
- Subtask add placeholder: `Add a subtask...`
- Overflow menu: `Delete task`
- Confirm - open subtasks: title `Finish this task?` body `{N} subtasks are still open. Mark the task done anyway?` buttons `Mark done` / `Keep working`
- Confirm - blocked: body `This task is blocked by {N} task{s} that {is/are} not done. Mark it done anyway?` buttons `Mark done` / `Keep working`
- Confirm - delete: title `Delete this task?` body `This removes the task and its subtasks. This cannot be undone.` buttons `Delete task` / `Cancel`
- New task dialog: heading `New task`; labels `Start from a template` / `Title` / `For` / `Client` / `Description` / `Priority` / `Due date` / `Assignee` / `Subtasks`; toggle `For us` / `For a client`; CTA `Create task`; `Cancel`; error `Choose a client for this task.`
- Template picker: anchor label `Due date`; helper `The task takes this due date; estimated hours come from the template.`; link `Manage templates`; empty `No templates yet.` + `Create templates in Settings to reuse repeatable work.`
- AI wizard review: heading `Review drafts`; scope prompt `Who is this work for?`; CTA `Create {N} tasks`; `Keep refining`; per-draft `Remove`
- Empty states: `You are all caught up.` + `Nothing assigned to you is due. Add a task or check the studio board.`; `Nothing assigned to you yet.` + `When work is assigned to you it lands here, grouped by when it is due.`; `No tasks yet.` + `Create the first task, start from a template, or draft a set with AI.`; `Nothing matches these filters.` + `Clear filters`
- Load error: `Could not load tasks.` + `Try again`
- Toasts: `Task added` / `Task done` + `Undo` / `Status updated` / `Priority updated` / `Assignee updated` / `Due date updated` / `Updated {N} tasks` / `Task deleted` / `Linked to {phase}` / `Unlinked from schedule` / `That did not save. Try again.`
- Tooltips: `Mark done` (checkbox) / `Blocked - waiting on other tasks` (indicator) / `{Assignee name}` (avatar) / `Move with Shift + arrow keys` (board card focus hint)
- Live announcements: `Moved to {column}` / `Status updated` / `Task added to Today`

## Tokens and visual reference

| Where | Token / value |
|---|---|
| Canvas | `--color-bg-cream` (shell-owned, never hardcoded) |
| Hero figure | `2.25rem` / 300 / `-0.02em` / tabular-nums / `--color-text`; danger figures `--color-danger` only when nonzero; zeros `--color-text-subtle` |
| Ledger labels (hero, groups, detail fields) | `--text-2xs` 600 uppercase `0.08em` `--color-text-subtle` |
| Row title | `--text-base` (0.875rem) 500 `--color-text` |
| Row height / hairline | `3.25rem` (3.5rem mobile) / `--color-border-subtle` |
| Row hover / focus | `--color-bg-secondary` wash / 2px inset `--color-brand-dark` ring |
| Org chip | `--color-bg-secondary` + `--color-border-subtle` + `--text-2xs` 600, `--radius-sm` |
| Due chip - overdue | `--color-danger-bg` fill + danger ink + alert icon |
| Due chip - due today | `--color-warning-bg` fill + AA warning ink |
| Due chip - later | bare `--color-text-muted` text |
| Subtask micro-bar | `4.5rem x 0.25rem`; track `--color-border-subtle`; fill `--color-brand` (100% = `--color-success`) |
| Blocked indicator | git-branch `0.75rem` + `--text-xs` 500 `--color-danger` |
| Status badges | To Do neutral / In Progress `--color-info-bg` / Blocked `--color-danger-bg` / Done `--color-success-bg`, all with hairline + text |
| Priority badges | Standard = nothing; High warning tint; Urgent danger tint |
| Segmented controls | `--color-bg-secondary` container, active `--color-bg` + `--color-border-strong` |
| Quick-add | hairline `--color-border`, `--radius-md`; focus `--color-brand` border + 2px `--color-brand-100` ring |
| Bulk bar | `--color-brand-50` fill + `--color-brand-100` full border, `--radius-md` |
| Board column / card | `--color-bg-secondary` + `--color-border` `--radius-lg` / `--color-bg` + `--color-border` `--radius-md`; no coloured top edges |
| Slide-over | `36rem`, `--color-bg`, `--shadow-floating`, backdrop `rgba(0,0,0,0.4)` |
| Primary CTA (`New task`, `Create task`) | `--color-brand-dark` fill, white text, `--radius-leaf-sm`, hover `--color-brand-deep` |
| Leaf radius budget | primary CTA + empty-state icon wrapper only; avatars are circles; chips are `--radius-sm` |
| Motion | 110-400ms, `--ease-out cubic-bezier(.22,1,.36,1)`, full reduced-motion fallback |
| Font | Manrope; figures 300 tabular; labels 600 uppercase; body 400-500 |
| Dark mode | same composition on `--color-bg-dark` family tokens; hairlines `--color-border-dark` |

## Deliverables for Claude design

1. **My Work - desktop (teammate, Me scope):** hero strip with a nonzero Overdue, all five groups populated, quick-add at rest, one blocked row, one row with subtask progress.
2. **My Work - desktop (owner, Everyone scope):** assignee avatars on rows, studio-wide counts, the scope switch active.
3. **All tasks list:** filter bar (type + status tabs with counts, search, due range, priority, group-by), grouped by Status, three rows selected with the bulk bar mounted and the status menu open.
4. **Board:** four columns, a card mid-drag with the insertion line visible, one empty column, a keyboard-focused card showing its focus ring.
5. **Detail slide-over:** full section order (header, controls, description, linked request + delivery phase, subtasks with progress, blocked-by chips + unresolved warning, time logged with entries, calls), plus the delete overflow open.
6. **Create flows:** quick-add focused with typed text; the new-task dialog (For a client state, client chosen, three subtasks added); the template picker step with the due-date anchor; the AI wizard draft-review with four drafts and the batch scope prompt.
7. **Confirm dialogs:** finish-with-open-subtasks and finish-while-blocked.
8. **Mobile (375px):** My Work (hero strip + quick-add + groups) and the detail as a full-screen sheet.
9. **Dark mode:** My Work desktop and the detail slide-over on dark tokens.
10. **State sheet:** hero strip zeroed vs danger; due-chip ramp (overdue / today / 2d / date); caught-up empty; new-teammate empty; filtered-empty; load error; row complete mid-animation; Undo toast.

**Integration constraints:**
- Honour `resolveAccessScoping` in My Work and every list (never leak other teams' tasks). The 2026-06 security audit confirmed `resolveAccessScoping` currently fails OPEN for a Tahi-org user with no `teamMembers` row (they see everything). Spec 05 flips this to deny-by-default; build My Work assuming scoping is authoritative and fail-closed, so a teammate with no grant sees the guided empty state, never the whole studio's tasks. **My Work must not ship before that lands.**
- Fix the dead detail: redirect `/tasks/[id]` to `/tasks?task=[id]` (slide-over deep link) and repoint board cards; alternatively add GET+DELETE to `/api/admin/tasks/[id]` - either way there is exactly one detail surface.
- Unify the create shape across quick-add / dialog / template / wizard: `{ title, orgId, description, priority: standard|high|urgent, assigneeId, assigneeType, dueDate, subtasks[] }` with legacy `type` derived from `orgId`. Map the wizard's draft enums before create; purge `low` from every priority UI.
- Add the `dueDate` param to `/api/admin/tasks/from-template` (it hardcodes null today); wire real `timeEntries` into the detail's Time logged; surface `/tasks/[id]/calls` in the slide-over.
- Task templates are edited ONLY in Settings > Intake & boards > Task templates (spec 09); this page links there ("Manage templates") and never embeds an editor.
- Keep hierarchy at task -> flat subtask and a single assignee unless a schema change is explicitly agreed; blocks-only dependencies stay.
- Decompose `tasks-content.tsx` (~2700 lines) into my-work / list / board / detail / bulk-bar / create modules; preserve persisted prefs (`tasks.viewMode`, `tasks.typeTab`, `tasks.statusTab`), drag-drop, and bulk PATCH behaviour; guard with the existing Playwright + Vitest harnesses.
- Tokens only (no hardcoded hex); no single-side borders anywhere (remove the board's 3px top edge and the bulk bar's borderBottom); leaf radius per the budget above; 44px touch targets; visible hover + focus on everything; AA contrast; full `prefers-reduced-motion` support. MCP parity for any new capability (worker server only).

## Why this is premium

The teams that love their task tool love it for one thing: it opens to "here is your next thing" and gets out of the way. Tahi's tasks today open to a generic all-tasks board with a dead detail link, which is why they are not trusted. A My Work front door with three bare tabular figures, a hairline list that shrinks as the day goes on, one fast canonical detail, and four create paths that all write the same clean record turns tasks from a chore into the studio's execution engine. The restraint is the craft: danger ink only where something is genuinely late or stuck, one leaf on the one button that creates work, ledger labels instead of chrome, and motion that settles instead of celebrating. Speed and honesty, not features, are the premium here.

## Open decisions and risks

1. **Tasks are internal-only** (Decisions #030/#046). Any client-facing task visibility would reverse a shipped decision and needs explicit sign-off; this spec keeps tasks internal.
2. **`/tasks/[id]` is dead** (GET/DELETE missing) and board cards link to it. Must fix or reroute as part of the redesign; this spec picks the redirect-to-slide-over path, which also needs a DELETE route for the overflow menu's Delete task.
3. **Single assignee** in schema; multi-assignee is a schema change, not just UI.
4. **Enum drift** between AI wizard drafts (small/large, low/medium/high/urgent) and the DB (scope type, standard/high/urgent). Unify before building create flows. Deepened finding: the drift already leaks into shipped UI - the dead detail page offers a `Low` priority option the PATCH route rejects with a 400.
5. **Flat subtasks, blocks-only dependencies.** Deeper nesting or typed dependencies (FS/SS/FF) are schema changes to call out, not assume. Likewise `taskTemplates` has no per-subtask date offsets, so template date remapping v1 is anchor-date only; offsets are a schema addition to agree separately.
6. **The 2700-line monolith** is a regression risk; decompose carefully and keep drag-drop, bulk bar, and persisted prefs working. The repo now has a Playwright e2e harness (Clerk test mode) plus a broad Vitest suite, so the decomposition can be guarded by tests rather than eyeballed.
7. **Access scoping fails open today** (audit-confirmed): a Tahi-org user with no `teamMembers` row sees all tasks. My Work must not ship until scoping is authoritative (deny-by-default, per spec 05), or it becomes a studio-wide leak under the banner "your work".
8. **No recurring tasks, no calendar/timeline** today; all greenfield if specced later. My Work's time buckets are the interim answer to "when".
9. **The detail's Time logged and Activity are cosmetic today** (hardcoded empty placeholder; a comment box with no submit path). This spec wires Time logged to real `timeEntries` and drops the comment box until a real activity/comments model exists (building it is out of scope here and likely rides on the mentions table, S19).
10. **From-template API gap:** no `dueDate` (or assignee-notification) parity with the dialog path; the one-write-shape principle requires the API addition before the template step ships.
11. **Quick-add defaults** (due today, assigned to me) assume the session user maps to a `teamMembers` row; a super admin without one needs a defined fallback (assign to the owner's member record, or leave unassigned) - decide during build.
