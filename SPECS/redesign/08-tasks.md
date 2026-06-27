# Tasks - design brief

> The internal daily driver: how the team breaks delivery work into execution
> units, assigns them, tracks subtask progress, and gates with dependencies.
> Tasks are Tahi-internal (clients never see them; that is Requests, spec 07).
> The big missing piece is a "My Work" home; the headline bug is a dead detail page.

> Prepend `_studio-ledger-theme.md` before this brief in Claude design.

## What exists today (as built)

Built but not daily-trusted ("UX still rough"), with one hard bug to fix as part of the redesign.

- `app/(dashboard)/tasks/page.tsx` (server, gates `isAdmin`) -> `tasks-content.tsx`, a **~2700-line monolith** holding list view, board view, bulk bar, the working **detail slide-over** (`TaskDetailPanel`), and the new-task dialog. The redesign is a good moment to decompose it.
- `app/(dashboard)/tasks/[id]/task-detail.tsx` - a **full-page detail that is dead on prod**: `app/api/admin/tasks/[id]/route.ts` exports only `PATCH` (no GET/DELETE), so the page 405s. Board cards link to it (and dead-end); list rows correctly open the slide-over. The redesign must pick a canonical detail (recommend the slide-over) and either fix or reroute the page.
- **Views:** list and board only (persisted `tasks.viewMode`). No calendar, timeline, or My Work / Today.
- **Tabs:** type = All / For us / For a client (per Decision #046 the legacy three-level `type` is collapsed to two buckets via `orgId` presence); status = All / To Do / In Progress / Blocked / Done. Filters: text search, due-date range, priority. Loads all tasks and filters client-side so counts stay true.
- **Board:** 4 fixed columns, native drag -> `PATCH /api/admin/tasks/[id] {status}`. Cards show type chip, title, due chip, subtask progress bar, org avatar, priority, assignee initials, a blocked icon.
- **Bulk bar:** set status / priority / assignee.
- **Schema** (`db/schema.ts`): `tasks` (`type` client_task/internal_client_task/tahi_internal legacy; `orgId` null = for us; `status` todo/in_progress/blocked/done; `priority` standard/high/urgent; **single `assigneeId`+`assigneeType`** team_member or contact; `dueDate`; `completedAt`; `tags`; `trackId`+`position`; `requestId` link; `scheduleRowId` delivery phase). `taskSubtasks` (**flat, one level**: title + completed). `taskDependencies` (**blocks-only**, no FS/SS/FF types; surfaced as blockedByCount + warning). `taskTemplates` (name, type, category, defaultPriority, subtasks JSON, estimatedHours).
- **APIs:** `/api/admin/tasks` GET (access-scoped via `resolveAccessScoping`, joins org, batch-loads subtask counts + deps) / POST; `/tasks/bulk`; `/tasks/from-template`; `/task-templates`; `/tasks/[id]` (PATCH only - the bug); `/tasks/[id]/subtasks`; `/tasks/[id]/dependencies`; `/tasks/[id]/calls`; `/ai/task-wizard`.
- **Access:** admin bypasses; other team members scoped to granted orgs. Tasks are 100% admin-gated; **clients never see tasks** (Decisions #030/#046).
- **AI Task Wizard** (`SPECS/ai-task-wizard.md`): a conversational slide-over on Claude Haiku 4.5, brand-voice, returns `TaskDraft[]` to review/edit/confirm. Note an enum mismatch: drafts use `type: small|large` and `priority: low|medium|high|urgent`, but the DB uses the scope `type` and `priority: standard|high|urgent`.

## Page purpose

Give the team a fast, calm cockpit for execution: what is mine, what is due, what is blocked; move work through the pipeline; spin up repeatable work from templates or the AI wizard; and tie tasks to the request and the delivery phase they serve.

## Personas and jobs-to-be-done

- **Teammate (team_member).** "What is mine and due today, what is blocking me, let me knock it out." Scoped to their granted clients. This is the primary user and the primary gap.
- **Owner / PM (super_admin).** "What is in flight across the studio, who is overloaded, what is overdue or blocked, and let me draft a plan fast." Sees everything.
- **Client.** Not a user of tasks. Tasks are internal; client-facing work is Requests (07). The spec does not add client task views.

## What others do (and what we take)

- **Linear "My Issues"** - keyboard-first, near-zero chrome, assigned-to-me grouped by status/cycle; speed as a feature. The model for our My Work view and quick-add.
- **Asana "My Tasks"** - four auto-promoting buckets (Recently Assigned / Today / Upcoming / Later) and a list/board/calendar/timeline switch. We adopt the time-bucket grouping.
- **ClickUp** - deep hierarchy, full dependency types, templates with date remapping, recurring tasks. We stay shallow (task -> flat subtask) by schema but take templates + (future) recurring.
- **Motion** - AI auto-scheduling (estimate + priority -> timeblocked, reschedules on slip, warns on overcommit). A north star for pairing our AI wizard with due dates + capacity.
- **Todoist** - GTD next-actions, priority + labels, schedule by time/energy/urgency.
- **Timeless ideas** - My Tasks as the default landing; a clear "what's mine and due today"; priority paired with effort/estimate; checklists with visible progress; templates + recurring for repeatable work; an explicit blocked/waiting state; overdue surfaced loudly; keyboard-first quick-add.

## Experience principles

1. **My Work is the front door.** The default landing is "assigned to me", grouped by time (Overdue / Today / This week / Later / No date), spanning both buckets. This is the biggest change.
2. **Counts as hero.** Overdue, due-today, and blocked counts render large and bare, Studio Ledger style.
3. **Calm editorial list over heavy cards.** A hairline list is the primary view; the board is the secondary lens.
4. **One canonical detail.** The slide-over is the detail; the dead full page is fixed or rerouted to it.
5. **Keyboard-first.** Quick-add and navigation are fast; the mouse is optional.
6. **One write shape.** Manual create, template, and AI wizard all produce the same fields (no enum drift).

## The surfaces

### My Work (new, default)
Assigned-to-me, grouped Overdue / Today / This week / Later / No date, across "For us" and "For a client". Hero counts (overdue / today / blocked). Teammate view is scoped to their access orgs; owner sees all and can switch to "Everyone" or filter by assignee. Inline quick-add ("add a task, due today, assigned to me"). This is the cockpit Linear/Asana have and we lack.

### List (all tasks)
Keep the hairline list with type/status tabs, search, due-range, priority. Lead with due-countdown and subtask progress. Grouping by status, assignee, client, or due. Bulk actions.

### Board
Status columns (todo / in_progress / blocked / done), drag to move, the same card (type chip, due, subtask progress, assignee, blocked icon). Fix the card link to open the canonical detail.

### Detail (slide-over, canonical)
Title, description (Tiptap), status/priority/assignee/due, the request and delivery-phase it serves, the flat subtask checklist with progress, blocked-by chips + the unresolved-dependency warning, time logged, and the task's calls. Make the slide-over the single detail and reroute `/tasks/[id]` to it (or add the missing GET+DELETE).

### Templates + AI wizard
A template picker on create (date-remapped on apply) and the conversational AI wizard that drafts a set of tasks (optionally with subtasks, a suggested assignee/track, and dependencies) for review/edit/confirm. Unify the draft shape with the DB enums so all three creation paths write identical fields.

## Component spec, motion, accessibility

- Decompose `tasks-content.tsx` into the My Work view, list, board, detail slide-over, bulk bar, and new-task/template/wizard dialogs; preserve persisted prefs, drag-drop, and the bulk bar (regression risk noted).
- Subtask progress is a thin bar; blocked is an icon + text; priority is a small badge; due-countdown ramps tone (info -> warning -> danger), colour plus text.
- Motion: calm card moves, gentle bucket promotion, reduced-motion uses instant moves; quick-add commits on Enter.
- Accessibility: keyboard path for move-to-column and quick-add; the slide-over traps focus and is escapable; 44px targets; AA contrast; the blocked state is not colour-only.

## States and flows

- My Work empty ("You are all caught up"); overdue present (loud count).
- Create via quick-add / dialog / template / AI wizard (one write shape).
- Move status (drag or detail); complete a task (with incomplete subtasks -> confirm or auto).
- Blocked by an unresolved dependency (chip + warning; cannot silently complete).
- Scoped teammate sees only their clients' tasks (never leaks other teams).
- Loading / first-run (a new teammate with no assignments gets a guided empty My Work).

## Copy deck

- My Work groups: Overdue, Today, This week, Later, No date. Hero labels: "Overdue", "Due today", "Blocked".
- Type buckets: "For us", "For a client". Blocked: "Blocked by 2 tasks". Empty: "You are all caught up."
- Quick-add placeholder: "Add a task..." Template: "Start from a template". Wizard: "Draft tasks with AI".

## Tokens and visual reference

- Counts in large tabular figures. Hairline list rows; status via tokens; priority and blocked as quiet badges. Leaf radius on the assignee chip / primary create CTA only. Cream canvas. Brand green the only accent; danger only for overdue/blocked.

## Deliverables for Claude design

1. **My Work** (default) - time-grouped, hero counts, quick-add (teammate-scoped).
2. **All tasks list** with grouping + filters + bulk bar.
3. **Board** with the fixed card linking to the canonical detail.
4. **Detail slide-over** - subtasks, blocked-by, request + delivery-phase links, time, calls.
5. **Create flows** - quick-add, new-task dialog, template picker, AI wizard draft-review.
6. **Mobile** (375px) of My Work and the detail slide-over.
7. **Dark mode** of all of the above.
8. **State sheet:** overdue hero, blocked chip + warning, empty My Work, subtask progress, due-countdown ramp.

**Integration constraints:**
- Honor `resolveAccessScoping` in My Work and every list (never leak other teams' tasks).
- Fix the dead detail: add GET+DELETE to `/api/admin/tasks/[id]` or reroute `/tasks/[id]` to the slide-over.
- Unify the create shape: reconcile the AI wizard's `type`/`priority` enums with the DB (scope `type`, priority standard/high/urgent).
- Keep hierarchy at task -> flat subtask unless a schema change is explicitly agreed; single assignee unless agreed.
- Tokens only; reduced motion; 44px; AA. MCP parity for any new capability.

## Why this is premium

The teams that love their task tool love it for one thing: it opens to "here is your next thing" and gets out of the way. Tahi's tasks today open to a generic all-tasks board with a dead detail link, which is why they are not trusted. A My Work front door with bare overdue/today/blocked counts, a calm editorial list, a single fast detail, and create paths (manual, template, AI) that all write the same clean record turns tasks from a chore into the studio's execution engine. Restraint and speed, not features, are the premium here.

## Open decisions and risks

1. **Tasks are internal-only** (Decisions #030/#046). Any client-facing task visibility would reverse a shipped decision and needs explicit sign-off; this spec keeps tasks internal.
2. **`/tasks/[id]` is dead** (GET/DELETE missing) and board cards link to it. Must fix or reroute as part of the redesign.
3. **Single assignee** in schema; multi-assignee is a schema change, not just UI.
4. **Enum drift** between AI wizard drafts (small/large, low/medium/high/urgent) and the DB (scope type, standard/high/urgent). Unify before building create flows.
5. **Flat subtasks, blocks-only dependencies.** Deeper nesting or typed dependencies (FS/SS/FF) are schema changes to call out, not assume.
6. **The 2700-line monolith** is a regression risk; decompose carefully and keep drag-drop, bulk bar, and persisted prefs working.
7. **No recurring tasks, no calendar/timeline, no keyboard-first** today; all greenfield if specced.
