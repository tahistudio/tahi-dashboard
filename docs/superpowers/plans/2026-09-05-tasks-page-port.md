# Tasks Page Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `app/(dashboard)/tasks/tasks-content.tsx` with the approved Tasks prototype (Claude Design project `57bf60cf-5e6d-450f-9e2f-e25c8d12fd66`, files `tasks.jsx` / `tasks.css` / `tasks-data.jsx`), rebuilt on the shipped Requests primitives, keeping every capability the legacy page already has.

**Architecture:** The prototype is the visual and interaction spec; the repo's Requests primitives are the implementation. Three peer views (List, Board, My week) sit inside the same rail frame the Requests page uses, generalised out of `components/tahi/requests/` into `components/tahi/rail/` rather than copied. All view maths (saved views, filters, sort, quick-add parsing, week planning, level/client/request consistency, board mapping) lives in pure node-testable modules under `lib/`. The detail is a `SlideOver` opened from the list; `/tasks/[id]` keeps redirecting to `/tasks?task=<id>` so every existing deep link and notification link still lands. The API and schema stay as they are apart from one added column, and every new API capability gets a worker MCP tool.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind v4 with CSS custom properties from `app/globals.css`, SWR, Drizzle ORM on Cloudflare D1, Vitest (node environment, pure functions only, no jsdom in this repo), Playwright for the happy path.

---

## Prototype source of truth

| File | Where it is | Status |
|---|---|---|
| `tasks.jsx` | Claude Design project `57bf60cf-5e6d-450f-9e2f-e25c8d12fd66`, path `tasks.jsx`, etag `1788523143310231`, 1050 lines | **NOT in the repo.** Slice 1 Task 1 fetches it. |
| `tasks.css` | `.claude/design-drafts/tasks-final/tasks.css` (254 lines) | Local, canonical |
| `tasks-data.jsx` | `.claude/design-drafts/tasks-final/tasks-data.jsx` (150 lines) | Local, canonical |
| The Requests kit it builds on | `.claude/design-drafts/requests-final/` (`requests-kit.jsx`, `requests-data.jsx`, `requests.css`, `requests-toolbar.css`, `requests-listview.css`, `requests-board.css`, `requests-detail.css`) | Local, canonical |

Never copy the prototype's `React.createElement` code into the repo. Rebuild every screen in TSX on the repo's primitives, with `var(--color-*)` tokens, rem units, no hardcoded hex, no single-side borders, no em or en dashes.

---

## Decisions the lead has already made (do not re-litigate)

1. **Tasks are the studio's own to-do system and are never visible to clients.** The page is team-only. A task may link to a client, to a request, or to nothing. `lib/feature-tree.ts:48` already scopes `tasks` to `['team']`, and every task API is `isTahiAdmin`-gated, so the `!isAdmin` branches inside the legacy `tasks-content.tsx` are unreachable dead code and are deleted rather than ported. There is no client audience, no portal route, no `visibleTo` equivalent. The prototype's `.tsk-forbid` client block is not ported: a client never reaches the route.
2. **Reuse the Requests primitives.** `DataTable` with `expandedRowMode="rows"` and `mobileCard` for the list, `SegmentedControl` for the view switcher, `SlideOver` for the detail and the mobile filter sheet, `InlineMenuField` / `InlineDateField` / `InlineNumberField` for the detail rail rows, `TimeCard` for the time block, `KanbanBoard` (via its `columns` prop) for the board, `BulkActionBar`, `StatusChipSelect`, `Badge`, `Popover`, `Menu`, `useUserPreference`. The rail frame is **generalised** out of `components/tahi/requests/requests-rail-layout.tsx` and `requests-rail.tsx` into `components/tahi/rail/`, and `RequestsRailLayout` becomes a thin wrapper over it. No second copy of the rail.
3. **Keep the repo's tasks API and schema.** Exactly one column is added: `tasks.estimated_hours` (`real`, nullable), which backs the detail's Estimate field, the My week "Estimated" stat and the per-day hours line. Everything else already has a home: level to `tasks.type`, client to `tasks.org_id`, request to `tasks.request_id`, subtasks to `task_subtasks`, time to `time_entries`, blockedBy to `task_dependencies`. Migration `0087` is idempotent and mirrored into the runtime runner. The **three-level model is preserved and mapped onto the prototype's chips**: `client_task` = Client, `internal_client_task` = Internal, `tahi_internal` = Tahi. `POST /api/admin/tasks` stops collapsing `internal_client_task` into `client_task`.
4. **The detail is a slide-over from the list.** `/tasks/[id]` keeps its redirect to `/tasks?task=<id>` so notification links (`lib/notification-links.ts:78`) and old bookmarks keep working. The slide-over is deep-linkable both ways: opening it rewrites the URL with `history.replaceState`, and a task id not in the current lens is fetched with `GET /api/admin/tasks/{id}`.
5. **My week is the third view, in place of the prototype's Timeline.** View keys are `list`, `board`, `week`. The stored legacy `tasks.viewMode` value `my_work` migrates to `week`.
6. **Quick-add parses `@Client`, dates and `!priority`** as the prototype does, with one deliberate divergence recorded in Decision 13.
7. **Per-user preferences via `useUserPreference` under `tasks.*` keys:** `tasks.view`, `tasks.savedView`, `tasks.filters`, `tasks.sort`, `tasks.default`, `tasks.railMigrated`. The three live legacy keys (`tasks.viewMode`, `tasks.typeTab`, `tasks.statusTab`) are migrated once and then left in place.
8. **MCP parity.** Every new or newly-reachable API capability gets a tool on the worker server `workers/mcp-server/src/index.ts`. The local `mcp-server/index.ts` is dormant and must not be extended.
9. **The legacy `tasks-content.tsx` is replaced, not patched.** Every capability it has that the prototype lacks is carried across: task templates (picker in create), dependencies (now with add and remove, which the legacy page never had), the AI task wizard, bulk actions, and timers.
10. **Tests.** Vitest for every pure helper (views, quick-add parser, planner grouping, consistency rules, board mapping, rail default reader). Playwright happy path in `e2e/tasks.spec.ts` using `primePage` from `e2e/helpers.ts`.

### Consequential decisions this plan makes, so nobody has to invent them

11. **Priority scale is the repo's, not the prototype's.** `TASK_PRIORITIES = ['standard', 'high', 'urgent']` (`lib/task-priorities.ts:15`). The prototype's `medium` and `low` do not exist. The quick-add parser accepts `!medium` and `!low` as aliases for `standard` so muscle memory does not 400, and the template picker maps a template's `defaultPriority` through the same alias table. That alias table is also the fix for the live drift where a `medium` template created a task `PATCH` would then refuse to touch.
12. **Blocked means either, except on the board.** The `blocked` saved view, the rail's Blocked **count** and the Tick's dashed ring all read `status === 'blocked' || blockedByCount > 0` (what the legacy My Work hero counted). The rail prints a number and the click produces a list, so the view and the count must agree or three rows sit behind a badge saying seven. The board's Blocked column alone stays `status === 'blocked'`, because dropping a card into a column writes that column's status and a column has to mean the value it writes. Slice 4 diverges there on purpose.
13. **Quick-add level asymmetry is resolved towards Internal.** A bare client-name match produces `internal_client_task`, not `client_task`, which is the same rule the detail panel applies when you set a client on a Tahi task. A quick-added chaser is normally not client-facing. An explicit `@Client` mention follows the same rule.
14. **Scoped team members see Tahi-internal tasks.** The list route's `inArray(tasks.orgId, scopedOrgIds)` silently drops every `org_id IS NULL` row and `guardTaskAccess` 403s the same rows on the detail route. Since tasks are the studio's own list, both change to admit `org_id IS NULL`. This is a prerequisite for the surface making sense to anyone but a super admin.
15. **Promote (Create request from task) is ported with real inputs.** The prototype hardcodes `category: 'design'` and `size: 'small'`. The port asks for both in the confirm dialog and posts them. The route writes the request the same way `POST /api/admin/requests` does, including the atomic per-org request number, both the legacy `type` and the modern `size` column, and the `emitRequestCreated` event, so a promoted request is not a second-class row that automations and webhooks never see.

16. **A task with a request is not automatically Client level.** The prototype contradicted itself here: `setRequest` left an Internal task Internal while its `addTask` coercion forced every request-carrying task to Client. This port keeps the first rule and drops the second, so `setTaskRequest` and `coerceTaskLinks` in `lib/task-consistency.ts` agree. `coerceTaskLinks` only ever repairs a level that cannot be true (a Tahi task holding a client); it never overrides a level the caller stated and could have meant. The one place Client is forced is `promote`, where the task provably has a client-facing peer.

17. **A promoted request's priority is clamped.** A request's vocabulary is `standard | high`; a task's is `standard | high | urgent`. An urgent task becomes a high request rather than writing a value the requests surface cannot render, filter or PATCH.

### Deliberately not ported (stated out loud rather than left as a gap)

- **The Activity card.** There is no per-task event stream in the schema and `lib/audit.ts` does not record task edits. Building one is a table plus write-side plumbing on every mutation, which is separate work. The detail slide-over ships without it; the Time card's entry list is the only history on the panel.
- **`T.EXTRA_REQUESTS`.** Module-level mutable fixture state in the prototype. In the port a promotion is a server write and the list revalidates.
- **The teammate subtitle variant.** The prototype swapped the page subtitle between a teammate reading ("Your work, and the client tasks you can see") and an owner reading. The port has no audience switch on this surface (Decision 1), so it ships the owner line only.
- **The legacy detail's delivery-phase selector (`tasks.scheduleRowId`).** The legacy panel let a task be attached to a schedule row from the task side. The ported detail has no such row and the plan never asked for one. The column stays readable and writable through PATCH and through the schedule detail's Linked work section, which is where the link is made today. Decided by the lead 2026-09-05 after the Slice 6 review; a Links-card row is a follow-up if the schedule side proves too far away.
- **`.tsk-card-foot`, `SubPanel({cols})`, `ReqChip({onStop})`, `ListView({audience, notify})`, `TasksDetail({audience})`, `TimeCard({me})`.** Defined and never used in the prototype. Do not carry them.

---

## Vocabulary map (prototype to repo)

| Prototype | Repo | Source of truth |
|---|---|---|
| `level: 'client'` | `tasks.type = 'client_task'`, label **Client**, icon `Users` | `lib/tasks-views.ts` `TASK_LEVELS` |
| `level: 'internal'` | `tasks.type = 'internal_client_task'`, label **Internal**, icon `Lock` | same |
| `level: 'tahi'` | `tasks.type = 'tahi_internal'`, label **Tahi**, icon `Leaf` | same |
| `clientId` | `tasks.orgId` (with `orgName` from the list join) | `app/api/admin/tasks/route.ts` |
| `requestId` | `tasks.requestId` | `db/schema.ts:846` |
| `status` todo / in_progress / blocked / done | identical | `lib/status-config.ts` `TASK_STATUSES` |
| `priority` urgent / high / medium / low | `standard` / `high` / `urgent` | `lib/task-priorities.ts:15` |
| `due` (day offset int) | `tasks.dueDate` (`YYYY-MM-DD`) | `db/schema.ts:835` |
| `est` (hours) | **new** `tasks.estimatedHours` (`real`) | migration 0087 |
| `subtasks[]` | `task_subtasks` rows | `db/schema.ts:904` |
| `time[]` | `time_entries` where `task_id = ?` | `db/schema.ts:812` |
| `blockedBy[]` | `task_dependencies` (`taskId` blocked, `dependsOnTaskId` blocker) | `db/schema.ts:863` |
| `activity[]` | not ported | see above |
| `updated` ('20m', '2h') | `tasks.updatedAt` ISO string | `db/schema.ts` `...timestamps` |
| `completedAt` | `tasks.completedAt` | `db/schema.ts:836` |

---

## File structure

### Created

| Path | Responsibility |
|---|---|
| `lib/tasks-views.ts` | The pure vocabulary: `TaskRow`, three view keys, seven saved views, six filter dimensions, search, four sort keys, the `applyTaskViews` pipeline, the persisted snapshot shapes, the legacy-key migrations. No React. |
| `lib/tasks-views.test.ts` | Vitest for every predicate, comparator, validator and migration above. |
| `lib/tasks-quick-add.ts` | `parseQuickAdd(raw, clients, now)`: the `@Client` / date / `!priority` grammar. No React. |
| `lib/tasks-quick-add.test.ts` | Vitest for every rule and its precedence. |
| `lib/tasks-planner.ts` | `buildWeekGroups`, `weekSummary`, `formatHours` for the My week planner. No React. |
| `lib/tasks-planner.test.ts` | Vitest for group construction across weekdays, Sunday, and empty input. |
| `lib/task-consistency.ts` | `setTaskLevel` / `setTaskClient` / `setTaskRequest` / `coerceTaskLinks`: the level-client-request invariants. No React. |
| `lib/task-consistency.test.ts` | Vitest for all three transitions and the coercion. |
| `lib/tasks-board-items.ts` | `toTaskBoardItems(rows, ctx)`: `TaskRow[]` to `BoardItem[]`, including the priority-scale bridge. No React. |
| `lib/tasks-board-items.test.ts` | Vitest for the mapping and the bridge. |
| `components/tahi/rail/rail-controls.tsx` | The rail's shared controls, lifted out of `requests-rail.tsx`: `RailSelect`, `RailViewItem`, `RailGroupLabel`, `SaveDefaultControl`, `RailOption`, `RailFilterChip`, `buildRailChips`. |
| `components/tahi/rail/rail-layout.tsx` | The generic rail frame: 14.5rem aside, switcher / search / count row, chip strip, mobile Filters sheet, `Show {total}` footer, `Reset to default`. Takes `rail` and `railTouch` as nodes and an `itemNoun`. |
| `components/tahi/rail/sidebar-card.tsx` | `SidebarCard` + `RailHeadIcon` + `RailHeadCount` + `RAIL_ACTION_CLASS` / `RAIL_ACTION_STYLE`, extracted from `request-detail.tsx` so the tasks detail is not a fifth copy. |
| `components/tahi/inline-field.tsx` | The moved `InlineMenuField` / `InlineDateField` / `InlineNumberField` / `InlineNone` module. Zero code change; only the path moves out of `requests/`. |
| `components/tahi/tasks/task-types.ts` | The row-shaped types the leaves hand each other: `TaskSubtask`, `TaskPerson`, `TaskClientOption`, `TaskRequestOption`, `TaskDependencyRow`, `TaskTemplateOption`. Owned by Slice 1 so the four parallel Wave B leaves never import a type out of each other. |
| `components/tahi/tasks/task-chips.tsx` | `LevelChip`, `RequestChip`, `TaskTick`, `TaskStatusBadge`, `SubtaskBadge`: the small pieces all three views share. |
| `components/tahi/tasks/task-quick-add.tsx` | The quick-add input, its four live hint chips and its submit toast. |
| `components/tahi/tasks/tasks-list.tsx` | The List view leaf: `BulkActionBar` plus `DataTable` with an `expandedRowMode="rows"` subtask panel and a `mobileCard`. |
| `components/tahi/tasks/tasks-board.tsx` | The Board view leaf: `KanbanBoard` with the four task columns, per-column quick add, drag to move. |
| `components/tahi/tasks/tasks-week.tsx` | The My week planner leaf: summary strip, day cards, drag to plan. |
| `components/tahi/tasks/task-detail-panel.tsx` | The detail `SlideOver`: title, description, Waiting on, Links, Details, Subtasks, Time, footer actions, confirms. |
| `components/tahi/tasks/tasks-rail.tsx` | The Tasks rail: seven saved views with counts, six filter selects, sort, Clear filters, Save as default. |
| `components/tahi/tasks/tasks-view-switcher.tsx` | List / Board / My week over `SegmentedControl`, `ariaLabel="Tasks view"`. |
| `components/tahi/tasks/tasks-header-actions.tsx` | New task plus one overflow menu (AI: break work into tasks, New from template, Export CSV). |
| `components/tahi/tasks/use-tasks-rail-state.ts` | `useTasksRailState` + `applyStoredTaskDefault` + `migrateLegacyTaskPreferences`. |
| `components/tahi/tasks/new-task-dialog.tsx` | The create form inside a `SlideOver variant="center"`: template picker, level, client, request, title, note, priority, due, assignee, estimate, subtasks. |
| `components/tahi/__tests__/tasks-rail-default.test.ts` | Vitest for `applyStoredTaskDefault`, mirroring `requests-rail-default.test.ts`. |
| `lib/task-access.ts` | `guardTask`: one access rule for every task route. Returns `NextResponse \| null`, matching `requireAccessToOrg`. Lives in `lib/` because a route file may only export HTTP methods and config. |
| `drizzle/migrations/0087_task_estimate_and_indexes.sql` | `estimated_hours` plus the two indexes the default lens needs. |
| `app/api/admin/tasks/[id]/promote/route.ts` | `POST`: create a request from a task and link them. |
| `app/api/admin/tasks/__tests__/tasks-create.test.ts` | Vitest for the POST route's level resolution, priority validation and subtask insert. |
| `app/api/admin/tasks/__tests__/tasks-bulk.test.ts` | Vitest for the bulk route's scoping, due-date support and honest count. |
| `e2e/tasks.spec.ts` | The Playwright happy path. |

### Modified

| Path | Change |
|---|---|
| `lib/status-config.ts` | Add `TASK_STATUS_CONFIG` (the dot / bg / text / border quad the rail selects, chips and board columns need). |
| `components/tahi/due-date-chip.tsx` | `dueDateState` gains a `closedStatuses` parameter and `DueDateChip` a matching prop. Without it a `done` task with a past date renders overdue. |
| `components/tahi/time-card.tsx` | `TimeCard` takes `target: { kind: 'request' \| 'task'; id: string }` instead of `requestId`. |
| `components/tahi/requests/requests-rail.tsx` | Imports the lifted controls from `components/tahi/rail/rail-controls.tsx` and re-exports `SaveDefaultControl` and `RailOption` so existing importers are untouched. |
| `components/tahi/requests/requests-rail-layout.tsx` | `RequestsRailLayout` becomes a wrapper over `RailLayout`. Its exported props and behaviour do not change. |
| `app/(dashboard)/requests/[id]/request-detail.tsx` | Local `SidebarCard` / `RailHeadIcon` / `RailHeadCount` / `RAIL_ACTION_*` deleted in favour of the extracted module; `TimeCard` call updated; `inline-field` import path updated; `RequestTasksPanel` rows become links and the wizard revalidates the tasks key. |
| `app/(dashboard)/requests/request-list.tsx` | `inline-field` import path updated. No other change. |
| `db/schema.ts` | `tasks.estimatedHours`, `idx_tasks_assignee`, `idx_tasks_due`. |
| `app/api/admin/db/migrate/route.ts` | Append the `0087` entry to `MIGRATIONS`. |
| `app/api/admin/tasks/route.ts` | GET admits `org_id IS NULL` under scoping and selects `estimatedHours`. POST honours the three-level type, validates priority, accepts and persists `subtasks`, accepts `estimatedHours` / `requestId` / `status`, and enforces the link invariants. |
| `app/api/admin/tasks/[id]/route.ts` | `guardTaskAccess` admits internal tasks for scoped members; PATCH accepts `estimatedHours`, clears `completedAt` when leaving `done`, and imports the status list from `lib/status-config.ts`. |
| `app/api/admin/tasks/bulk/route.ts` | Access scoping, `dueDate` support, one `inArray` update, an honest `updatedCount`. |
| `app/api/admin/tasks/[id]/subtasks/route.ts`, `.../subtasks/[subId]/route.ts`, `.../dependencies/route.ts`, `.../dependencies/[depId]/route.ts`, `.../calls/route.ts`, `app/api/admin/tasks/from-template/route.ts` | Add `guardTaskAccess`; `from-template` validates `defaultPriority` through the alias table. |
| `app/api/admin/ai/task-wizard/route.ts` | Remove the `console.error`; return `estimatedHours` as a field on each draft. |
| `components/tahi/ai-task-wizard.tsx` | Send `estimatedHours` and `type` as fields instead of stringifying them into the description; revalidate the caller's SWR key on create. |
| `workers/mcp-server/src/index.ts` | Ten new task tools, corrected priority docstrings, `list_tasks` forwards `assignee` / `requestId` / `sortBy`. |
| `app/(dashboard)/tasks/tasks-content.tsx` | **Replaced wholesale.** Becomes the shell: data fetching, rail state, view routing, detail wiring. |
| `app/(dashboard)/tasks/page.tsx` | Redirect non-Tahi orgs to `/overview`; drop the `isAdmin` prop. |
| `e2e/helpers.ts` | Add the shared `shipStudioStorageState` and `expectNoHorizontalScroll` six specs currently duplicate. |
| `STATUS.md`, `TASKS.md` | Record the port and drop the stale `/tasks/[id]` GET note at `STATUS.md:55`. |

---

## Slice map, parallelism and merge order

| Wave | Slice | Owns | May run in parallel with |
|---|---|---|---|
| A | **Slice 1: Foundation** | pure `lib/tasks-*`, `lib/task-consistency`, `components/tahi/rail/*`, `components/tahi/rail/sidebar-card.tsx`, `components/tahi/inline-field.tsx`, `components/tahi/tasks/task-types.ts`, `components/tahi/tasks/task-chips.tsx`, plus the seven modified shared files | nothing |
| B | **Slice 2: API, schema, MCP** | `db/schema.ts`, `drizzle/migrations/0087_*`, `app/api/admin/db/migrate/route.ts`, `lib/task-access.ts`, `app/api/admin/tasks/**`, `app/api/admin/ai/task-wizard/route.ts`, `components/tahi/ai-task-wizard.tsx`, `workers/mcp-server/src/index.ts` | 3, 4, 5 |
| B | **Slice 3: List view leaf** | `components/tahi/tasks/tasks-list.tsx`, `components/tahi/tasks/task-quick-add.tsx`, `app/globals.css` | 2, 4, 5 |
| B | **Slice 4: Board view leaf** | `components/tahi/tasks/tasks-board.tsx`, `lib/tasks-board-items.ts` + test | 2, 3, 5 |
| B | **Slice 5: Detail slide-over and My week leaf** | `components/tahi/tasks/task-detail-panel.tsx`, `components/tahi/tasks/tasks-week.tsx`, `components/tahi/tasks/new-task-dialog.tsx` | 2, 3, 4 |
| C | **Slice 6: Rail, shell and wiring** | `components/tahi/tasks/tasks-rail.tsx`, `tasks-view-switcher.tsx`, `tasks-header-actions.tsx`, `use-tasks-rail-state.ts`, `app/(dashboard)/tasks/tasks-content.tsx`, `app/(dashboard)/tasks/page.tsx`, `components/tahi/__tests__/tasks-rail-default.test.ts` | nothing |
| D | **Slice 7: e2e, cleanup, docs** | `e2e/helpers.ts`, `e2e/tasks.spec.ts`, `STATUS.md`, `TASKS.md`, request-detail tasks-panel links | nothing |

**Merge order: 1, then 2 / 3 / 4 / 5 in any order, then 6, then 7.**

**Slice 1 also owns `app/api/admin/time-entries/route.ts` and `app/api/__tests__/admin-time-entries.test.ts`** (landed on `tasks/foundation-fix`): the task branch of `TimeCard`'s manual log posted to a route that 400'd every `org_id IS NULL` task, which Decision 14 admits as first-class, so the fix shipped with the change that reached it. Slice 2 must not touch either file.

Wave B is four implementers on four disjoint file sets. None of them import each other; each is a leaf that takes props and calls the API. Slice 6 is the only file that imports all four, which is why it waits. Slice 6 branches off `main` after all four Wave B slices have merged, and rebases if any lands late.

**No Wave B slice may import a type from another Wave B slice's file.** Every shape they share lives in `components/tahi/tasks/task-types.ts`, which Slice 1 creates (Task 1.13 Step 1). This is the rule that makes the parallelism real rather than nominal: a leaf importing `TaskPerson` from `tasks-list.tsx` cannot type-check in a worktree where Slice 3 has not merged.

Every Wave B leaf is written against the exact prop interface stated in its slice below. Slice 6 imports those interfaces verbatim. If a leaf's author wants to change a prop name, they must post the change to the lead before merging, because Slice 6 is written to these signatures.

**On the component slices (3, 4, 5) the plan states the exported interface in full and the body as a written spec, not as pasteable code.** That is deliberate for the four render-heavy leaves: the CSS values, the tokens, the ARIA and the empty-state copy are all pinned, and the arrangement of them is the implementer's. Nothing else in the plan works that way. If the lead wants literal component bodies too, say so before Wave B starts, because it changes who writes them.

---

## Ground rules for every slice

- One implementer per slice, in its own worktree, exclusive file ownership as listed. Create the worktree with `superpowers:using-git-worktrees`.
- Never `git add -A`. Stage only the files the slice lists.
- Commit messages end with the session trailer:

  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018r1i5WixrU5FNXRdwxkmG2
  ```

- Do not push. The lead reviews the diff and pushes.
- No `any`. No `console.log` or `console.error` in app code. No commented-out code. No em or en dashes anywhere, including comments and JSX text.
- CSS custom properties only. The one hardcoded-hex exception in the repo is the sidebar, which this surface does not touch.
- **Every `var(--token)` this plan names must already exist in `app/globals.css`.** Grep before you paste: a token that does not exist resolves to nothing and the rule silently disappears, which is invisible in light mode and usually ugly in dark. The radius scale is `--radius-sm | -md | -lg | -xl | -full | -badge | -button | -card | -input | -leaf | -leaf-sm | -leaf-lg | -leaf-xl`. There is no `--radius-xs`. Shadows are `--shadow-xs | -sm | -md | -lg | -ring | -brand | -leaf | -floating`.
- Every interactive element gets a hover state and a focus state (`className="tahi-focus-ring"`). Touch targets are at least 2.75rem below `md`.
- Vitest here runs in the **node** environment with no jsdom and no testing-library (`vitest.config.ts`). Every test is a pure-function test. Do not write render tests.

---

## Slice 1: Foundation (must land first, no parallelism)

Nothing renders in this slice. It creates the pure maths and lifts the shared primitives so the four Wave B slices never touch the same file.

**Files:**
- Fetch: `.claude/design-drafts/tasks-final/tasks.jsx`
- Create: `lib/tasks-views.ts`, `lib/tasks-views.test.ts`, `lib/tasks-quick-add.ts`, `lib/tasks-quick-add.test.ts`, `lib/tasks-planner.ts`, `lib/tasks-planner.test.ts`, `lib/task-consistency.ts`, `lib/task-consistency.test.ts`, `components/tahi/rail/rail-controls.tsx`, `components/tahi/rail/rail-layout.tsx`, `components/tahi/rail/sidebar-card.tsx`, `components/tahi/inline-field.tsx`, `components/tahi/tasks/task-types.ts`, `components/tahi/tasks/task-chips.tsx`
- Modify: `lib/status-config.ts`, `components/tahi/due-date-chip.tsx`, `components/tahi/time-card.tsx`, `components/tahi/requests/requests-rail.tsx`, `components/tahi/requests/requests-rail-layout.tsx`, `app/(dashboard)/requests/[id]/request-detail.tsx`, `app/(dashboard)/requests/request-list.tsx`
- Delete: `components/tahi/requests/inline-field.tsx` (moved)

### Task 1.1: Get the prototype component tree into the repo

- [ ] **Step 1: Check whether another agent already fetched it**

Run: `ls "C:/Users/Work/Projects/tahi-dashboard/.claude/design-drafts/tasks-final/"`
Expected: `tasks.css` and `tasks-data.jsx`. If `tasks.jsx` is already there at about 1050 lines, skip to Step 3.

- [ ] **Step 2: Fetch and save it**

Call `mcp__claude-design__read_file` with project id `57bf60cf-5e6d-450f-9e2f-e25c8d12fd66` and path `tasks.jsx`, then write the exact bytes to `.claude/design-drafts/tasks-final/tasks.jsx`.

- [ ] **Step 3: Verify**

Run: `wc -l "C:/Users/Work/Projects/tahi-dashboard/.claude/design-drafts/tasks-final/tasks.jsx"`
Expected: `1050` (a one-line difference from a trailing newline is fine).

- [ ] **Step 4: Commit**

```bash
git add .claude/design-drafts/tasks-final/tasks.jsx
git commit -m "chore(tasks): land the tasks.jsx prototype alongside its css and fixtures"
```

### Task 1.2: `lib/tasks-views.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/tasks-views.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  TASKS_VIEW_KEYS,
  TASK_LEVELS,
  DEFAULT_TASK_FILTERS,
  DEFAULT_TASKS_SORT,
  applyTaskViews,
  compareTasks,
  countTasksSavedViews,
  isTasksSnapshot,
  matchesTaskFilters,
  matchesTaskQuery,
  matchesTasksSavedView,
  migrateLegacyTaskStatusTab,
  migrateLegacyTaskTypeTab,
  migrateLegacyTaskViewMode,
  normaliseTasksViewKey,
  sortTasks,
  taskSortDirLabel,
  tasksSnapshotsEqual,
  type TaskRow,
  type TasksFilters,
} from './tasks-views'

const NOW = new Date(2026, 8, 5) // Saturday 5 September 2026, local

function row(over: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 't1',
    title: 'Chase the GA4 access',
    type: 'tahi_internal',
    status: 'todo',
    priority: 'standard',
    orgId: null,
    orgName: null,
    requestId: null,
    assigneeId: null,
    dueDate: null,
    completedAt: null,
    description: null,
    estimatedHours: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-04T00:00:00Z',
    subtaskCount: 0,
    subtaskDone: 0,
    blockedByCount: 0,
    ...over,
  }
}

describe('view keys', () => {
  it('has exactly list, board and week in that order', () => {
    expect(TASKS_VIEW_KEYS).toEqual(['list', 'board', 'week'])
  })

  it('migrates the legacy my_work view onto week', () => {
    expect(normaliseTasksViewKey('my_work')).toBe('week')
  })

  it('falls back to list for anything unknown', () => {
    expect(normaliseTasksViewKey('timeline')).toBe('list')
    expect(normaliseTasksViewKey(undefined)).toBe('list')
  })
})

describe('levels', () => {
  it('maps the three db types onto the three chips in order', () => {
    expect(TASK_LEVELS.map(l => l.value)).toEqual([
      'client_task', 'internal_client_task', 'tahi_internal',
    ])
    expect(TASK_LEVELS.map(l => l.label)).toEqual(['Client', 'Internal', 'Tahi'])
  })
})

describe('saved views', () => {
  it('assigned to me excludes done work', () => {
    const ctx = { assigneeId: 'tm1', now: NOW }
    expect(matchesTasksSavedView(row({ assigneeId: 'tm1' }), 'mine', ctx)).toBe(true)
    expect(matchesTasksSavedView(row({ assigneeId: 'tm1', status: 'done' }), 'mine', ctx)).toBe(false)
    expect(matchesTasksSavedView(row({ assigneeId: 'tm2' }), 'mine', ctx)).toBe(false)
  })

  it('overdue needs an open task with a past date', () => {
    const ctx = { now: NOW }
    expect(matchesTasksSavedView(row({ dueDate: '2026-09-04' }), 'overdue', ctx)).toBe(true)
    expect(matchesTasksSavedView(row({ dueDate: '2026-09-05' }), 'overdue', ctx)).toBe(false)
    expect(matchesTasksSavedView(row({ dueDate: '2026-09-04', status: 'done' }), 'overdue', ctx)).toBe(false)
  })

  it('due this week spans today through seven days out', () => {
    const ctx = { now: NOW }
    expect(matchesTasksSavedView(row({ dueDate: '2026-09-05' }), 'due_week', ctx)).toBe(true)
    expect(matchesTasksSavedView(row({ dueDate: '2026-09-12' }), 'due_week', ctx)).toBe(true)
    expect(matchesTasksSavedView(row({ dueDate: '2026-09-13' }), 'due_week', ctx)).toBe(false)
  })

  it('blocked counts a blocking dependency as well as the status', () => {
    const ctx = { now: NOW }
    expect(matchesTasksSavedView(row({ status: 'blocked' }), 'blocked', ctx)).toBe(true)
    expect(matchesTasksSavedView(row({ blockedByCount: 1 }), 'blocked', ctx)).toBe(true)
    expect(matchesTasksSavedView(row(), 'blocked', ctx)).toBe(false)
  })

  it('client-linked and internal split on the client link and the level', () => {
    const ctx = { now: NOW }
    expect(matchesTasksSavedView(row({ orgId: 'o1' }), 'client_linked', ctx)).toBe(true)
    expect(matchesTasksSavedView(row(), 'client_linked', ctx)).toBe(false)
    expect(matchesTasksSavedView(row(), 'internal', ctx)).toBe(true)
    expect(matchesTasksSavedView(row({ type: 'internal_client_task', orgId: 'o1' }), 'internal', ctx)).toBe(true)
    expect(matchesTasksSavedView(row({ type: 'client_task', orgId: 'o1' }), 'internal', ctx)).toBe(false)
  })

  it('a null key means no narrowing', () => {
    expect(matchesTasksSavedView(row(), null, { now: NOW })).toBe(true)
  })

  it('counts every view plus __all', () => {
    const counts = countTasksSavedViews(
      [row({ status: 'done' }), row({ id: 't2', orgId: 'o1', type: 'client_task' })],
      { assigneeId: 'tm1', now: NOW },
    )
    expect(counts.__all).toBe(2)
    expect(counts.done).toBe(1)
    expect(counts.client_linked).toBe(1)
  })
})

describe('filters', () => {
  const base: TasksFilters = { ...DEFAULT_TASK_FILTERS }

  it('passes everything on the defaults', () => {
    expect(matchesTaskFilters(row(), base, NOW)).toBe(true)
  })

  it('filters by status, priority and level', () => {
    expect(matchesTaskFilters(row(), { ...base, status: 'done' }, NOW)).toBe(false)
    expect(matchesTaskFilters(row(), { ...base, priority: 'urgent' }, NOW)).toBe(false)
    expect(matchesTaskFilters(row(), { ...base, level: 'tahi_internal' }, NOW)).toBe(true)
    expect(matchesTaskFilters(row(), { ...base, level: 'client_task' }, NOW)).toBe(false)
  })

  it('reads none as "has no client" and "has no assignee"', () => {
    expect(matchesTaskFilters(row(), { ...base, client: 'none' }, NOW)).toBe(true)
    expect(matchesTaskFilters(row({ orgId: 'o1' }), { ...base, client: 'none' }, NOW)).toBe(false)
    expect(matchesTaskFilters(row(), { ...base, assignee: 'none' }, NOW)).toBe(true)
    expect(matchesTaskFilters(row({ assigneeId: 'tm1' }), { ...base, assignee: 'none' }, NOW)).toBe(false)
  })

  it('buckets the due filter', () => {
    expect(matchesTaskFilters(row({ dueDate: '2026-09-04' }), { ...base, due: 'overdue' }, NOW)).toBe(true)
    expect(matchesTaskFilters(row({ dueDate: '2026-09-05' }), { ...base, due: 'today' }, NOW)).toBe(true)
    expect(matchesTaskFilters(row({ dueDate: '2026-09-11' }), { ...base, due: 'week' }, NOW)).toBe(true)
    expect(matchesTaskFilters(row({ dueDate: '2026-09-30' }), { ...base, due: 'later' }, NOW)).toBe(true)
    expect(matchesTaskFilters(row(), { ...base, due: 'none' }, NOW)).toBe(true)
  })
})

describe('search', () => {
  it('matches title, client name and description', () => {
    const r = row({ title: 'Redirect map', orgName: 'Kowtow', description: 'Check the 301s' })
    expect(matchesTaskQuery(r, 'redirect')).toBe(true)
    expect(matchesTaskQuery(r, 'kowtow')).toBe(true)
    expect(matchesTaskQuery(r, '301')).toBe(true)
    expect(matchesTaskQuery(r, 'invoice')).toBe(false)
    expect(matchesTaskQuery(r, '   ')).toBe(true)
  })
})

describe('sort', () => {
  it('always sinks done below open work', () => {
    const done = row({ id: 'a', status: 'done', dueDate: '2026-01-01' })
    const open = row({ id: 'b', dueDate: '2030-01-01' })
    expect(compareTasks(done, open, DEFAULT_TASKS_SORT)).toBeGreaterThan(0)
  })

  it('sorts undated work last when ascending by due', () => {
    const out = sortTasks([row({ id: 'a' }), row({ id: 'b', dueDate: '2026-09-09' })], DEFAULT_TASKS_SORT)
    expect(out.map(r => r.id)).toEqual(['b', 'a'])
  })

  it('ascending priority reads highest first', () => {
    const out = sortTasks(
      [row({ id: 'a', priority: 'standard' }), row({ id: 'b', priority: 'urgent' })],
      { key: 'priority', dir: 'asc' },
    )
    expect(out.map(r => r.id)).toEqual(['b', 'a'])
  })

  it('labels the direction per key', () => {
    expect(taskSortDirLabel({ key: 'due', dir: 'asc' })).toBe('Soonest first')
    expect(taskSortDirLabel({ key: 'title', dir: 'desc' })).toBe('Z to A')
    expect(taskSortDirLabel({ key: 'updated', dir: 'asc' })).toBe('Newest first')
  })

  it('never mutates the input array', () => {
    const rows = [row({ id: 'a', dueDate: '2030-01-01' }), row({ id: 'b', dueDate: '2020-01-01' })]
    sortTasks(rows, DEFAULT_TASKS_SORT)
    expect(rows.map(r => r.id)).toEqual(['a', 'b'])
  })
})

describe('applyTaskViews', () => {
  it('runs saved view, then filters, then search, then sort', () => {
    const rows = [
      row({ id: 'a', assigneeId: 'tm1', dueDate: '2026-09-10', title: 'Alpha' }),
      row({ id: 'b', assigneeId: 'tm1', dueDate: '2026-09-06', title: 'Beta' }),
      row({ id: 'c', assigneeId: 'tm2', dueDate: '2026-09-01', title: 'Gamma' }),
      row({ id: 'd', assigneeId: 'tm1', status: 'done', title: 'Delta' }),
    ]
    const out = applyTaskViews(rows, {
      savedView: 'mine',
      filters: DEFAULT_TASK_FILTERS,
      query: '',
      sort: DEFAULT_TASKS_SORT,
      assigneeId: 'tm1',
      now: NOW,
    })
    expect(out.map(r => r.id)).toEqual(['b', 'a'])
  })
})

describe('snapshots', () => {
  const snap = {
    view: 'board' as const,
    savedView: 'overdue',
    filters: DEFAULT_TASK_FILTERS,
    sort: DEFAULT_TASKS_SORT,
  }

  it('validates a good snapshot and rejects a bad one', () => {
    expect(isTasksSnapshot(snap)).toBe(true)
    expect(isTasksSnapshot({ ...snap, view: 'timeline' })).toBe(false)
    expect(isTasksSnapshot(null)).toBe(false)
  })

  it('accepts the legacy my_work view inside a stored snapshot', () => {
    expect(isTasksSnapshot({ ...snap, view: 'my_work' })).toBe(true)
  })

  it('compares every dimension', () => {
    expect(tasksSnapshotsEqual(snap, snap)).toBe(true)
    expect(tasksSnapshotsEqual(snap, { ...snap, savedView: null })).toBe(false)
    expect(tasksSnapshotsEqual(snap, { ...snap, sort: { key: 'title', dir: 'asc' } })).toBe(false)
    expect(tasksSnapshotsEqual(null, snap)).toBe(false)
  })
})

describe('legacy migrations', () => {
  it('moves my_work onto the week view with the mine saved view', () => {
    expect(migrateLegacyTaskViewMode('my_work')).toEqual({ view: 'week', savedView: 'mine' })
    expect(migrateLegacyTaskViewMode('board')).toEqual({ view: 'board', savedView: null })
    expect(migrateLegacyTaskViewMode('nonsense')).toBeNull()
  })

  it('maps the old type tab onto a saved view', () => {
    expect(migrateLegacyTaskTypeTab('for_client')).toBe('client_linked')
    expect(migrateLegacyTaskTypeTab('for_us')).toBe('internal')
    expect(migrateLegacyTaskTypeTab('all')).toBeNull()
  })

  it('maps the old status tab onto the status filter', () => {
    expect(migrateLegacyTaskStatusTab('blocked')).toBe('blocked')
    expect(migrateLegacyTaskStatusTab('all')).toBeNull()
    expect(migrateLegacyTaskStatusTab('nonsense')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run lib/tasks-views.test.ts`
Expected: FAIL with `Failed to resolve import "./tasks-views"`.

- [ ] **Step 3: Write `lib/tasks-views.ts`**

```ts
/**
 * lib/tasks-views.ts
 *
 * The pure vocabulary behind the Tasks rail: three peer views, seven saved
 * views, six filter dimensions, four sort keys, and the shapes persisted per
 * user. Structural twin of lib/requests-views.ts, deliberately a separate
 * file rather than a shared generic: the two surfaces share a shape, not a
 * vocabulary, and one parameterised module would be worse than two readable
 * ones.
 *
 * Everything is a plain function over plain data so it runs in the node
 * Vitest environment. Dates compare as YYYY-MM-DD day keys derived from a
 * caller-supplied `now`, which keeps "overdue" free of timezone drift.
 *
 * Tasks are the studio's own list. There is no client audience here, so
 * nothing in this file branches on one.
 */

import { TASK_STATUSES } from '@/lib/status-config'

// -- Row shape ---------------------------------------------------------------

/** The subset of a task the rail reasons about. The API's enriched row is a
 *  structural superset, so it satisfies this without a cast. */
export interface TaskRow {
  id: string
  title: string
  /** client_task | internal_client_task | tahi_internal */
  type: string
  status: string
  priority: string
  orgId: string | null
  orgName: string | null
  requestId: string | null
  assigneeId: string | null
  dueDate: string | null
  completedAt: string | null
  description: string | null
  estimatedHours: number | null
  createdAt: string | null
  updatedAt: string | null
  subtaskCount?: number
  subtaskDone?: number
  blockedByCount?: number
}

// -- Levels ------------------------------------------------------------------

export type TaskLevel = 'client_task' | 'internal_client_task' | 'tahi_internal'

/** The three-level model, in the prototype's words. `hint` is both the
 *  segmented control's tooltip and the line under the Links card. */
export const TASK_LEVELS: readonly { value: TaskLevel; label: string; hint: string }[] = [
  { value: 'client_task',          label: 'Client',   hint: 'Work for a client. Can become a request.' },
  { value: 'internal_client_task', label: 'Internal', hint: 'About a client, but only the studio sees it.' },
  { value: 'tahi_internal',        label: 'Tahi',     hint: 'Studio housekeeping. No client involved.' },
]

export const TASK_LEVEL_LABELS: Record<string, string> = Object.fromEntries(
  TASK_LEVELS.map(l => [l.value, l.label] as [string, string]),
)

export const TASK_LEVEL_HINTS: Record<string, string> = Object.fromEntries(
  TASK_LEVELS.map(l => [l.value, l.hint] as [string, string]),
)

export function isTaskLevel(value: unknown): value is TaskLevel {
  return TASK_LEVELS.some(l => l.value === value)
}

/** A row whose stored type is missing or unknown still has to land on a chip.
 *  The client link is the tiebreak, matching Decision #046's reading. */
export function levelOf(row: Pick<TaskRow, 'type' | 'orgId'>): TaskLevel {
  if (isTaskLevel(row.type)) return row.type
  return row.orgId ? 'client_task' : 'tahi_internal'
}

// -- Views -------------------------------------------------------------------

export type TasksViewKey = 'list' | 'board' | 'week'

export const TASKS_VIEW_KEYS: readonly TasksViewKey[] = ['list', 'board', 'week']

/** Read a stored view key back safely. The pre-rail `tasks.viewMode` held
 *  'my_work' for what is now My week, so that value migrates rather than
 *  resetting the user. */
export function normaliseTasksViewKey(value: unknown): TasksViewKey {
  const raw = value === 'my_work' ? 'week' : value
  return (TASKS_VIEW_KEYS as readonly unknown[]).includes(raw) ? (raw as TasksViewKey) : 'list'
}

// -- Statuses that sink ------------------------------------------------------

/** A finished task has no deadline worth toning, and always sorts last. */
export const TASK_CLOSED_STATUSES: readonly string[] = ['done']

// -- Day-key helpers ---------------------------------------------------------

/** Local YYYY-MM-DD for a Date. Matches how `dueDate` is stored (a date, not
 *  an instant), so the two compare as plain strings with no timezone maths. */
export function taskDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Local YYYY-MM-DD `days` from `date`, negative for the past. */
export function taskShiftedDayKey(date: Date, days: number): string {
  return taskDayKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days))
}

function dueOf(row: TaskRow): string | null {
  return row.dueDate ? row.dueDate.slice(0, 10) : null
}

export function isTaskOverdue(row: TaskRow, now: Date): boolean {
  const d = dueOf(row)
  if (!d || TASK_CLOSED_STATUSES.includes(row.status)) return false
  return d < taskDayKey(now)
}

export function isTaskDueWithin(row: TaskRow, days: number, now: Date): boolean {
  const d = dueOf(row)
  if (!d || TASK_CLOSED_STATUSES.includes(row.status)) return false
  return d >= taskDayKey(now) && d <= taskShiftedDayKey(now, days)
}

/** Blocked in the sense the rail counts it: the status, or an open blocker.
 *  The board column and the `blocked` saved view read the status alone; this
 *  is the wider reading the count and the Tick's dashed ring use. */
export function isTaskBlocked(row: TaskRow): boolean {
  return row.status === 'blocked' || (row.blockedByCount ?? 0) > 0
}

// -- Saved views -------------------------------------------------------------

export interface TaskViewContext {
  /** The viewer's team member id, for "Assigned to me". */
  assigneeId?: string | null
  /** Injected for deterministic date predicates. Defaults to the wall clock. */
  now?: Date
}

export interface TasksSavedView {
  key: string
  label: string
  test: (row: TaskRow, ctx: TaskViewContext) => boolean
}

/** The prototype's seven, with keys spelled out so `due_week` cannot be read
 *  as the `week` VIEW key. */
export const TASKS_SAVED_VIEWS: readonly TasksSavedView[] = [
  { key: 'mine',          label: 'Assigned to me', test: (r, c) => !!c.assigneeId && r.assigneeId === c.assigneeId && r.status !== 'done' },
  { key: 'due_week',      label: 'Due this week',  test: (r, c) => isTaskDueWithin(r, 7, c.now ?? new Date()) },
  { key: 'overdue',       label: 'Overdue',        test: (r, c) => isTaskOverdue(r, c.now ?? new Date()) },
  { key: 'blocked',       label: 'Blocked',        test: r => isTaskBlocked(r) },
  { key: 'client_linked', label: 'Client-linked',  test: r => !!r.orgId },
  { key: 'internal',      label: 'Internal',       test: r => levelOf(r) !== 'client_task' },
  { key: 'done',          label: 'Done',           test: r => r.status === 'done' },
]

export function matchesTasksSavedView(
  row: TaskRow,
  key: string | null,
  ctx: TaskViewContext = {},
): boolean {
  if (!key) return true
  const view = TASKS_SAVED_VIEWS.find(v => v.key === key)
  return view ? view.test(row, ctx) : true
}

/** Live counts for the rail: one per saved view, plus `__all`. */
export function countTasksSavedViews(
  rows: readonly TaskRow[],
  ctx: TaskViewContext = {},
): Record<string, number> {
  const counts: Record<string, number> = { __all: rows.length }
  for (const view of TASKS_SAVED_VIEWS) {
    let n = 0
    for (const row of rows) if (view.test(row, ctx)) n += 1
    counts[view.key] = n
  }
  return counts
}

// -- Filters -----------------------------------------------------------------

export interface TasksFilters {
  status: string
  priority: string
  level: string
  client: string
  assignee: string
  due: string
}

export const TASK_FILTER_KEYS = ['status', 'priority', 'level', 'client', 'assignee', 'due'] as const
export type TaskFilterKey = (typeof TASK_FILTER_KEYS)[number]

export const DEFAULT_TASK_FILTERS: TasksFilters = {
  status: 'all',
  priority: 'all',
  level: 'all',
  client: 'all',
  assignee: 'all',
  due: 'any',
}

export const TASK_DIMENSION_LABELS: Record<TaskFilterKey, string> = {
  status: 'Status',
  priority: 'Priority',
  level: 'Level',
  client: 'Client',
  assignee: 'Assignee',
  due: 'Due',
}

export interface TaskFilterOption {
  value: string
  label: string
}

export const LEVEL_FILTER_OPTIONS: readonly TaskFilterOption[] = [
  { value: 'all', label: 'All levels' },
  ...TASK_LEVELS.map(l => ({ value: l.value, label: l.label })),
]

export const PRIORITY_FILTER_OPTIONS: readonly TaskFilterOption[] = [
  { value: 'all',      label: 'All priorities' },
  { value: 'urgent',   label: 'Urgent'   },
  { value: 'high',     label: 'High'     },
  { value: 'standard', label: 'Standard' },
]

export const DUE_FILTER_OPTIONS: readonly TaskFilterOption[] = [
  { value: 'any',     label: 'Any time'  },
  { value: 'overdue', label: 'Overdue'   },
  { value: 'today',   label: 'Today'     },
  { value: 'week',    label: 'This week' },
  { value: 'later',   label: 'Later'     },
  { value: 'none',    label: 'No date'   },
]

export function isTaskFilterActive(filters: TasksFilters, key: TaskFilterKey): boolean {
  return filters[key] !== DEFAULT_TASK_FILTERS[key]
}

export function activeTaskFilterKeys(filters: TasksFilters): TaskFilterKey[] {
  return TASK_FILTER_KEYS.filter(k => isTaskFilterActive(filters, k))
}

export function anyTaskFilterActive(filters: TasksFilters): boolean {
  return activeTaskFilterKeys(filters).length > 0
}

export function matchesTaskFilters(
  row: TaskRow,
  filters: TasksFilters,
  now: Date = new Date(),
): boolean {
  if (filters.status !== 'all' && row.status !== filters.status) return false
  if (filters.priority !== 'all' && row.priority !== filters.priority) return false
  if (filters.level !== 'all' && levelOf(row) !== filters.level) return false

  if (filters.client === 'none') {
    if (row.orgId) return false
  } else if (filters.client !== 'all' && (row.orgId ?? '') !== filters.client) {
    return false
  }

  if (filters.assignee === 'none') {
    if (row.assigneeId) return false
  } else if (filters.assignee !== 'all' && (row.assigneeId ?? '') !== filters.assignee) {
    return false
  }

  if (filters.due !== 'any') {
    const d = dueOf(row)
    const today = taskDayKey(now)
    // Every dated bucket reads through the same closed-status guard the
    // Overdue and Due this week SAVED VIEWS use, so the rail cannot answer
    // one question two ways: a done task with a past date is not overdue on
    // the chip either. `none` is the exception, because "no date" is true
    // whatever the status.
    const open = !TASK_CLOSED_STATUSES.includes(row.status)
    switch (filters.due) {
      case 'none':    return d === null
      case 'overdue': return isTaskOverdue(row, now)
      case 'today':   return open && d === today
      case 'week':    return isTaskDueWithin(row, 7, now)
      case 'later':   return open && d !== null && d > taskShiftedDayKey(now, 7)
      default:        return true
    }
  }

  return true
}

// -- Search ------------------------------------------------------------------

/** Title, client name and the note. The prototype also searched the request
 *  number, which the row does not carry; the request link on the row covers
 *  that case by being clickable instead. */
export function matchesTaskQuery(row: TaskRow, query: string): boolean {
  const term = query.trim().toLowerCase()
  if (!term) return true
  return `${row.title} ${row.orgName ?? ''} ${row.description ?? ''}`.toLowerCase().includes(term)
}

// -- Sort --------------------------------------------------------------------

export type TasksSortKey = 'due' | 'priority' | 'updated' | 'title'
export type TasksSortDir = 'asc' | 'desc'

export interface TasksSort {
  key: TasksSortKey
  dir: TasksSortDir
}

export const DEFAULT_TASKS_SORT: TasksSort = { key: 'due', dir: 'asc' }

export const TASK_SORT_KEYS: readonly { value: TasksSortKey; label: string }[] = [
  { value: 'due',      label: 'Due'      },
  { value: 'priority', label: 'Priority' },
  { value: 'updated',  label: 'Updated'  },
  { value: 'title',    label: 'Title'    },
]

/** Direction reads differently per key, so the toggle says what it will do.
 *  [asc, desc]. */
const TASK_SORT_DIR_LABELS: Record<TasksSortKey, readonly [string, string]> = {
  due:      ['Soonest first', 'Latest first'],
  priority: ['Highest first', 'Lowest first'],
  updated:  ['Newest first',  'Oldest first'],
  title:    ['A to Z',        'Z to A'],
}

export function taskSortKeyLabel(sort: TasksSort): string {
  return TASK_SORT_KEYS.find(k => k.value === sort.key)?.label ?? 'Due'
}

export function taskSortDirLabel(sort: TasksSort): string {
  const pair = TASK_SORT_DIR_LABELS[sort.key] ?? TASK_SORT_DIR_LABELS.due
  return sort.dir === 'desc' ? pair[1] : pair[0]
}

/** Repo scale only. Anything unknown ranks with standard rather than sinking
 *  to the bottom, so a legacy `low` row still sorts sanely. */
const TASK_PRIORITY_RANK: Record<string, number> = {
  urgent: 3, high: 2, standard: 1,
}

const NO_DUE_DATE = '9999-12-31'

function taskDueValue(row: TaskRow): string {
  return dueOf(row) ?? NO_DUE_DATE
}

function taskSortValue(row: TaskRow, key: TasksSortKey): string | number {
  if (key === 'updated') {
    // Negated so the newest timestamp is the smallest value: ascending then
    // reads as "Newest first", which is what the direction label promises.
    if (!row.updatedAt) return Number.MAX_SAFE_INTEGER
    const t = Date.parse(row.updatedAt)
    return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : -t
  }
  if (key === 'priority') {
    return -(TASK_PRIORITY_RANK[row.priority] ?? TASK_PRIORITY_RANK.standard)
  }
  if (key === 'title') return row.title.toLowerCase()
  return taskDueValue(row)
}

/** Done always sinks below open work, whatever the key or direction. Ties
 *  break on the due date. */
export function compareTasks(a: TaskRow, b: TaskRow, sort: TasksSort = DEFAULT_TASKS_SORT): number {
  const rank = (r: TaskRow) => (TASK_CLOSED_STATUSES.includes(r.status) ? 1 : 0)
  const byRank = rank(a) - rank(b)
  if (byRank !== 0) return byRank

  const va = taskSortValue(a, sort.key)
  const vb = taskSortValue(b, sort.key)
  let d = typeof va === 'string' && typeof vb === 'string'
    ? va.localeCompare(vb)
    : Number(va) - Number(vb)
  if (sort.dir === 'desc') d = -d
  if (d !== 0) return d

  return taskDueValue(a).localeCompare(taskDueValue(b))
}

/** A sorted copy. Never mutates the caller's array. */
export function sortTasks<T extends TaskRow>(rows: readonly T[], sort: TasksSort = DEFAULT_TASKS_SORT): T[] {
  return rows.slice().sort((a, b) => compareTasks(a, b, sort))
}

// -- The whole pipeline ------------------------------------------------------

export interface TasksViewState {
  savedView: string | null
  filters: TasksFilters
  query: string
  sort: TasksSort
  assigneeId?: string | null
  now?: Date
}

/** Saved view, then filters, then search, then sort. One call so the list and
 *  the board render exactly the same set. My week deliberately does not use
 *  this: it always shows your own open plate. */
export function applyTaskViews<T extends TaskRow>(rows: readonly T[], state: TasksViewState): T[] {
  const now = state.now ?? new Date()
  const ctx: TaskViewContext = { assigneeId: state.assigneeId, now }
  const kept = rows.filter(row =>
    matchesTasksSavedView(row, state.savedView, ctx)
    && matchesTaskFilters(row, state.filters, now)
    && matchesTaskQuery(row, state.query),
  )
  return sortTasks(kept, state.sort)
}

// -- Persisted shapes --------------------------------------------------------

export interface TasksSnapshot {
  view: TasksViewKey
  savedView: string | null
  filters: TasksFilters
  sort: TasksSort
}

export function isTasksFilters(value: unknown): value is TasksFilters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const o = value as Record<string, unknown>
  return TASK_FILTER_KEYS.every(k => typeof o[k] === 'string')
}

export function isTasksSort(value: unknown): value is TasksSort {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const o = value as Record<string, unknown>
  const knownKey = TASK_SORT_KEYS.some(k => k.value === o.key)
  return knownKey && (o.dir === 'asc' || o.dir === 'desc')
}

export function isTasksSnapshot(value: unknown): value is TasksSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const o = value as Record<string, unknown>
  const viewOk = o.view === 'my_work' || (TASKS_VIEW_KEYS as readonly unknown[]).includes(o.view)
  const savedOk = o.savedView === null || typeof o.savedView === 'string'
  return viewOk && savedOk && isTasksFilters(o.filters) && isTasksSort(o.sort)
}

/** True when the live state is exactly what the user saved as their default,
 *  which is what flips the rail from "Save as default" to "Your default". */
export function tasksSnapshotsEqual(a: TasksSnapshot | null, b: TasksSnapshot | null): boolean {
  if (!a || !b) return false
  if (normaliseTasksViewKey(a.view) !== normaliseTasksViewKey(b.view)) return false
  if ((a.savedView ?? null) !== (b.savedView ?? null)) return false
  for (const k of TASK_FILTER_KEYS) {
    if ((a.filters[k] ?? DEFAULT_TASK_FILTERS[k]) !== (b.filters[k] ?? DEFAULT_TASK_FILTERS[k])) return false
  }
  return a.sort.key === b.sort.key && a.sort.dir === b.sort.dir
}

// -- Migration off the pre-rail keys -----------------------------------------

/** `tasks.viewMode` held 'my_work' | 'list' | 'board'. My Work was a lens as
 *  much as a view, so it carries a saved view across with it. */
export function migrateLegacyTaskViewMode(
  mode: unknown,
): { view: TasksViewKey; savedView: string | null } | null {
  switch (mode) {
    case 'my_work': return { view: 'week',  savedView: 'mine' }
    case 'list':    return { view: 'list',  savedView: null   }
    case 'board':   return { view: 'board', savedView: null   }
    default:        return null
  }
}

/** `tasks.typeTab` held 'all' | 'for_us' | 'for_client'. The rail replaced
 *  the tabs with saved views. */
export function migrateLegacyTaskTypeTab(tab: unknown): string | null {
  switch (tab) {
    case 'for_client': return 'client_linked'
    case 'for_us':     return 'internal'
    default:           return null
  }
}

/** `tasks.statusTab` held a server status filter, which is now a rail
 *  dimension rather than a tab. Validated against the one status vocabulary
 *  rather than a fourth copy of the list. */
export function migrateLegacyTaskStatusTab(tab: unknown): string | null {
  if (typeof tab !== 'string') return null
  return TASK_STATUSES.some(s => s.value === tab) ? tab : null
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/tasks-views.test.ts`
Expected: PASS. `Test Files  1 passed (1)` and `Tests  28 passed (28)`.

- [ ] **Step 5: Commit**

```bash
git add lib/tasks-views.ts lib/tasks-views.test.ts
git commit -m "feat(tasks): pure view vocabulary for the tasks rail"
```

### Task 1.3: `lib/tasks-quick-add.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/tasks-quick-add.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseQuickAdd, type QuickAddClient } from './tasks-quick-add'

// Saturday 5 September 2026, local. getDay() === 6.
const NOW = new Date(2026, 8, 5, 12, 0, 0)

const CLIENTS: QuickAddClient[] = [
  { id: 'o1', name: 'Kowtow' },
  { id: 'o2', name: 'Allbirds' },
]

describe('priority', () => {
  it('lifts an explicit bang token out of the title', () => {
    const out = parseQuickAdd('Draft the brief !high', CLIENTS, NOW)
    expect(out.priority).toBe('high')
    expect(out.title).toBe('Draft the brief')
  })

  it('aliases the prototype scale onto the repo scale', () => {
    expect(parseQuickAdd('x !medium', CLIENTS, NOW).priority).toBe('standard')
    expect(parseQuickAdd('x !low', CLIENTS, NOW).priority).toBe('standard')
    expect(parseQuickAdd('x !urgent', CLIENTS, NOW).priority).toBe('urgent')
  })

  it('reads a bare "urgent" and removes the word', () => {
    const out = parseQuickAdd('urgent fix for the footer', CLIENTS, NOW)
    expect(out.priority).toBe('urgent')
    expect(out.title).toBe('fix for the footer')
  })

  it('leaves priority null when nothing is said', () => {
    expect(parseQuickAdd('Just a task', CLIENTS, NOW).priority).toBeNull()
  })
})

describe('dates', () => {
  it('reads today and tomorrow', () => {
    expect(parseQuickAdd('ping them today', CLIENTS, NOW).dueDate).toBe('2026-09-05')
    expect(parseQuickAdd('ping them tomorrow', CLIENTS, NOW).dueDate).toBe('2026-09-06')
    expect(parseQuickAdd('ping them tmrw', CLIENTS, NOW).dueDate).toBe('2026-09-06')
  })

  it('reads "next week" as the coming Monday', () => {
    // getDay() is 6 (Saturday), so (8 - 6) % 7 === 2 days out: Monday the 7th.
    expect(parseQuickAdd('review next week', CLIENTS, NOW).dueDate).toBe('2026-09-07')
  })

  it('reads "in N days"', () => {
    expect(parseQuickAdd('follow up in 3 days', CLIENTS, NOW).dueDate).toBe('2026-09-08')
  })

  it('reads a weekday name and never resolves it to today', () => {
    expect(parseQuickAdd('call on friday', CLIENTS, NOW).dueDate).toBe('2026-09-11')
    // Saturday from a Saturday means next Saturday, not now.
    expect(parseQuickAdd('call saturday', CLIENTS, NOW).dueDate).toBe('2026-09-12')
  })

  it('strips the date token from the title', () => {
    expect(parseQuickAdd('Send the deck tomorrow', CLIENTS, NOW).title).toBe('Send the deck')
  })

  it('leaves the date null when nothing matches', () => {
    expect(parseQuickAdd('Send the deck', CLIENTS, NOW).dueDate).toBeNull()
  })
})

describe('client', () => {
  it('strips an @mention and links the client', () => {
    const out = parseQuickAdd('Chase invoice @Kowtow', CLIENTS, NOW)
    expect(out.orgId).toBe('o1')
    expect(out.title).toBe('Chase invoice')
  })

  it('is case insensitive on the mention', () => {
    expect(parseQuickAdd('Chase @kowtow', CLIENTS, NOW).orgId).toBe('o1')
  })

  it('keeps a bare name in the title but still links', () => {
    const out = parseQuickAdd('Kowtow redirect map', CLIENTS, NOW)
    expect(out.orgId).toBe('o1')
    expect(out.title).toBe('Kowtow redirect map')
  })

  it('leaves the client null when no name appears', () => {
    expect(parseQuickAdd('Tidy the drive', CLIENTS, NOW).orgId).toBeNull()
  })
})

describe('level', () => {
  it('is tahi_internal with no client', () => {
    expect(parseQuickAdd('Tidy the drive', CLIENTS, NOW).level).toBe('tahi_internal')
  })

  it('is internal_client_task once a client is found, mention or not', () => {
    expect(parseQuickAdd('Chase @Kowtow', CLIENTS, NOW).level).toBe('internal_client_task')
    expect(parseQuickAdd('Kowtow redirect map', CLIENTS, NOW).level).toBe('internal_client_task')
  })
})

describe('title', () => {
  it('collapses whitespace and trims', () => {
    expect(parseQuickAdd('  Draft   the    brief  !high ', CLIENTS, NOW).title).toBe('Draft the brief')
  })

  it('is empty when the input is only tokens', () => {
    expect(parseQuickAdd('@Kowtow tomorrow !high', CLIENTS, NOW).title).toBe('')
  })
})

describe('everything at once', () => {
  it('parses a full line', () => {
    const out = parseQuickAdd('Send the redirect map @Kowtow friday !urgent', CLIENTS, NOW)
    expect(out).toEqual({
      title: 'Send the redirect map',
      orgId: 'o1',
      level: 'internal_client_task',
      dueDate: '2026-09-11',
      priority: 'urgent',
    })
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run lib/tasks-quick-add.test.ts`
Expected: FAIL with `Failed to resolve import "./tasks-quick-add"`.

- [ ] **Step 3: Write `lib/tasks-quick-add.ts`**

```ts
/**
 * lib/tasks-quick-add.ts
 *
 * The quick-add grammar: one line of text becomes a task. Ported from the
 * prototype's `parseQuick`, with the priority scale mapped onto the repo's
 * (standard / high / urgent) and one deliberate divergence: a client match
 * produces the Internal level, not Client. A quick-added chaser is normally
 * not client-facing, and this makes the rule agree with the detail panel,
 * where setting a client on a Tahi task also yields Internal.
 *
 * Pure and node-testable. `now` is injected so weekday maths is deterministic.
 * Order of operations is load-bearing: explicit priority, then the implicit
 * "urgent", then the date, then the client. Each rule lifts its own token out
 * of the string before the next one reads it.
 */

import type { TaskLevel } from '@/lib/tasks-views'
import type { TaskPriority } from '@/lib/task-priorities'

export interface QuickAddClient {
  id: string
  name: string
}

export interface QuickAddParse {
  /** What is left after every token has been lifted out. May be empty, in
   *  which case the caller must refuse to submit. */
  title: string
  orgId: string | null
  level: TaskLevel
  /** YYYY-MM-DD, local. */
  dueDate: string | null
  /** Null means "the user said nothing", so the caller falls back to the
   *  column default rather than writing `standard` on purpose. */
  priority: TaskPriority | null
}

/** The prototype offered four priorities. Two of them do not exist in the
 *  repo, so they alias onto standard rather than 400 on the write. */
const PRIORITY_ALIASES: Record<string, TaskPriority> = {
  urgent: 'urgent',
  high: 'high',
  standard: 'standard',
  medium: 'standard',
  normal: 'standard',
  low: 'standard',
}

const DAY_NAMES = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
] as const

/** Local YYYY-MM-DD `offset` days after `base`. Anchored on the local date
 *  parts rather than epoch maths, so a DST boundary cannot shift the day. */
function offsetToDate(base: Date, offset: number): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/** Escape a client name so a name with a dot or a plus in it cannot become a
 *  wildcard. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function parseQuickAdd(
  raw: string,
  clients: readonly QuickAddClient[],
  now: Date = new Date(),
): QuickAddParse {
  // Padded so every rule can anchor on a leading space and treat the start of
  // the string exactly like a word boundary.
  let text = ` ${raw} `

  // 1. Explicit priority.
  let priority: TaskPriority | null = null
  const bang = text.match(/\s!(urgent|high|standard|medium|normal|low)\b/i)
  if (bang) {
    priority = PRIORITY_ALIASES[bang[1].toLowerCase()]
    text = text.replace(bang[0], ' ')
  }

  // 2. Implicit "urgent", only when no bang token won.
  if (!priority) {
    const bare = text.match(/\s(urgent)\b/i)
    if (bare) {
      priority = 'urgent'
      text = text.replace(bare[0], ' ')
    }
  }

  // 3. Date. First matching rule wins and takes its token with it.
  let dueDate: string | null = null
  const todayDow = now.getDay()

  const today = text.match(/\s(today)\b/i)
  const tomorrow = text.match(/\s(tomorrow|tmrw)\b/i)
  const nextWeek = text.match(/\s(next week)\b/i)
  const inDays = text.match(/\sin (\d+) days?\b/i)
  const weekday = text.match(
    /\s(?:by |on |next )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/i,
  )

  if (today) {
    dueDate = offsetToDate(now, 0)
    text = text.replace(today[0], ' ')
  } else if (tomorrow) {
    dueDate = offsetToDate(now, 1)
    text = text.replace(tomorrow[0], ' ')
  } else if (nextWeek) {
    // The coming Monday. Never today, never zero.
    dueDate = offsetToDate(now, ((8 - todayDow) % 7) || 7)
    text = text.replace(nextWeek[0], ' ')
  } else if (inDays) {
    dueDate = offsetToDate(now, Number.parseInt(inDays[1], 10))
    text = text.replace(inDays[0], ' ')
  } else if (weekday) {
    const prefix = weekday[1].slice(0, 3).toLowerCase()
    const index = DAY_NAMES.findIndex(d => d.startsWith(prefix))
    if (index >= 0) {
      // "friday" on a Friday means next Friday, so a zero offset becomes 7.
      const delta = (index - todayDow + 7) % 7
      dueDate = offsetToDate(now, delta === 0 ? 7 : delta)
      text = text.replace(weekday[0], ' ')
    }
  }

  // 4. Client, in two passes so explicitness beats array order. An @mention
  //    anywhere in the list wins over a bare name from any other client:
  //    with clients [Design, Kowtow], "Design review @Kowtow" is a Kowtow
  //    task, not a Design one with a stray mention left in its title. Only
  //    when nothing was mentioned does a bare name count, and a bare name
  //    stays in the title, because it is usually doing real work there
  //    ("Kowtow redirect map").
  let orgId: string | null = null
  for (const client of clients) {
    const mention = text.match(new RegExp(`\\s@${escapeRegExp(client.name)}\\b`, 'i'))
    if (mention) {
      orgId = client.id
      text = text.replace(mention[0], ' ')
      break
    }
  }
  if (!orgId) {
    for (const client of clients) {
      if (new RegExp(`\\b${escapeRegExp(client.name)}\\b`, 'i').test(text)) {
        orgId = client.id
        break
      }
    }
  }

  return {
    title: text.replace(/\s+/g, ' ').trim(),
    orgId,
    level: orgId ? 'internal_client_task' : 'tahi_internal',
    dueDate,
    priority,
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/tasks-quick-add.test.ts`
Expected: PASS. `Tests  19 passed (19)`.

- [ ] **Step 5: Commit**

```bash
git add lib/tasks-quick-add.ts lib/tasks-quick-add.test.ts
git commit -m "feat(tasks): quick-add grammar for client, date and priority tokens"
```

### Task 1.4: `lib/tasks-planner.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/tasks-planner.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildWeekGroups, formatHours, weekSummary } from './tasks-planner'
import type { TaskRow } from './tasks-views'

const WEDNESDAY = new Date(2026, 8, 9, 9, 0, 0) // getDay() === 3
const SUNDAY = new Date(2026, 8, 13, 9, 0, 0)   // getDay() === 0

function row(over: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 't1',
    title: 'A task',
    type: 'tahi_internal',
    status: 'todo',
    priority: 'standard',
    orgId: null,
    orgName: null,
    requestId: null,
    assigneeId: 'tm1',
    dueDate: null,
    completedAt: null,
    description: null,
    estimatedHours: null,
    createdAt: null,
    updatedAt: null,
    ...over,
  }
}

describe('formatHours', () => {
  it('prints a bare zero', () => {
    expect(formatHours(0)).toBe('0h')
  })

  it('rounds to the nearest quarter and strips trailing zeros', () => {
    expect(formatHours(1)).toBe('1h')
    expect(formatHours(1.5)).toBe('1.5h')
    expect(formatHours(1.3)).toBe('1.25h')
    expect(formatHours(2.13)).toBe('2.25h')
  })
})

describe('buildWeekGroups', () => {
  it('drops the overdue group when nothing is overdue', () => {
    const groups = buildWeekGroups([row({ dueDate: '2026-09-09' })], WEDNESDAY)
    expect(groups.some(g => g.key === 'overdue')).toBe(false)
  })

  it('opens with overdue then today when something is late', () => {
    const groups = buildWeekGroups(
      [row({ id: 'a', dueDate: '2026-09-07' }), row({ id: 'b', dueDate: '2026-09-09' })],
      WEDNESDAY,
    )
    expect(groups[0].key).toBe('overdue')
    expect(groups[0].tasks.map(t => t.id)).toEqual(['a'])
    expect(groups[0].droppable).toBe(false)
    expect(groups[1].key).toBe('today')
    expect(groups[1].tasks.map(t => t.id)).toEqual(['b'])
  })

  it('runs a day card through the end of the week, then Later and No date', () => {
    const groups = buildWeekGroups([], WEDNESDAY)
    // Wednesday: today plus Thursday, Friday, Saturday, Sunday, then the two tails.
    expect(groups.map(g => g.key)).toEqual(['today', 'd1', 'd2', 'd3', 'd4', 'later', 'none'])
    expect(groups[1].name).toBe('Tomorrow')
    expect(groups[2].name).toBe('Friday')
  })

  it('still offers one day card on a Sunday', () => {
    const groups = buildWeekGroups([], SUNDAY)
    expect(groups.map(g => g.key)).toEqual(['today', 'd1', 'later', 'none'])
  })

  it('puts undated work in the No date group with a null drop target', () => {
    const groups = buildWeekGroups([row({ id: 'x' })], WEDNESDAY)
    const none = groups.find(g => g.key === 'none')
    expect(none?.tasks.map(t => t.id)).toEqual(['x'])
    expect(none?.dueDate).toBeNull()
    expect(none?.droppable).toBe(true)
  })

  it('gives every droppable day the date a drop would write', () => {
    const groups = buildWeekGroups([], WEDNESDAY)
    expect(groups.find(g => g.key === 'today')?.dueDate).toBe('2026-09-09')
    expect(groups.find(g => g.key === 'd1')?.dueDate).toBe('2026-09-10')
    expect(groups.find(g => g.key === 'later')?.dueDate).toBe('2026-09-14')
  })

  it('sums the estimate per group', () => {
    const groups = buildWeekGroups(
      [row({ id: 'a', dueDate: '2026-09-09', estimatedHours: 1.5 }),
       row({ id: 'b', dueDate: '2026-09-09', estimatedHours: 2 })],
      WEDNESDAY,
    )
    expect(groups.find(g => g.key === 'today')?.estimatedHours).toBe(3.5)
  })
})

describe('weekSummary', () => {
  it('counts overdue, today and the coming week and sums their estimate', () => {
    const out = weekSummary(
      [row({ id: 'a', dueDate: '2026-09-07', estimatedHours: 1 }),
       row({ id: 'b', dueDate: '2026-09-09', estimatedHours: 2 }),
       row({ id: 'c', dueDate: '2026-09-15', estimatedHours: 4 }),
       row({ id: 'd' })],
      WEDNESDAY,
    )
    expect(out).toEqual({ overdue: 1, today: 1, week: 2, estimatedHours: 6 })
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run lib/tasks-planner.test.ts`
Expected: FAIL with `Failed to resolve import "./tasks-planner"`.

- [ ] **Step 3: Write `lib/tasks-planner.ts`**

```ts
/**
 * lib/tasks-planner.ts
 *
 * My week: the day-by-day plate the third view renders. Pure and
 * node-testable; `now` is injected so the week's shape is deterministic.
 *
 * The week runs from today through Sunday, so it shrinks as the week does.
 * Sunday itself still gets one forward day rather than collapsing to nothing,
 * because a planner with only Today and Later is not a planner.
 *
 * Overdue is the one group you cannot drop into: you plan work forward, and
 * "make this late" is not a thing anyone means to do.
 */

import { taskDayKey, taskShiftedDayKey, type TaskRow } from '@/lib/tasks-views'

export interface PlannerGroup {
  /** 'overdue' | 'today' | 'd1'..'d6' | 'later' | 'none'. Stable, so React
   *  keys and drag targets do not churn. */
  key: string
  name: string
  /** The secondary line under the name. Empty for Overdue and No date. */
  date: string
  /** The YYYY-MM-DD a drop into this group writes. Null for No date, which
   *  clears the due date. Undefined only on the non-droppable Overdue group. */
  dueDate: string | null | undefined
  droppable: boolean
  tasks: TaskRow[]
  estimatedHours: number
}

const DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

function dateAt(now: Date, offset: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
}

/** "9 Sep". Built by hand so it reads the same in every locale the studio
 *  works in, and so it never differs between server and client render. */
function shortDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

function sumEstimate(rows: readonly TaskRow[]): number {
  let total = 0
  for (const r of rows) total += r.estimatedHours ?? 0
  return total
}

/** Hours in the studio's shorthand: quarter-hour granularity, no trailing
 *  zeros, always suffixed. */
export function formatHours(hours: number): string {
  if (!hours) return '0h'
  // A quarter-hour round can never leave a trailing zero of its own: 2 is
  // "2", not "2.0", so there is nothing left to strip.
  return `${Math.round(hours * 4) / 4}h`
}

/**
 * The groups the planner draws, in render order. Overdue is present only when
 * it has something in it; every other group is always present, empty or not,
 * because an empty day still has to accept a drop.
 */
export function buildWeekGroups(rows: readonly TaskRow[], now: Date): PlannerGroup[] {
  const today = taskDayKey(now)
  const todayDow = now.getDay()
  // Days left before Sunday closes the week. On Sunday itself we still offer
  // one forward day rather than nothing at all.
  const daysLeft = todayDow === 0 ? 1 : Math.max(1, 7 - todayDow)
  const lastDayKey = taskShiftedDayKey(now, daysLeft)

  const byDay = new Map<string, TaskRow[]>()
  const overdue: TaskRow[] = []
  const later: TaskRow[] = []
  const undated: TaskRow[] = []

  for (const row of rows) {
    const d = row.dueDate ? row.dueDate.slice(0, 10) : null
    if (d === null) { undated.push(row); continue }
    if (d < today) { overdue.push(row); continue }
    if (d > lastDayKey) { later.push(row); continue }
    const bucket = byDay.get(d)
    if (bucket) bucket.push(row)
    else byDay.set(d, [row])
  }

  const groups: PlannerGroup[] = []

  if (overdue.length > 0) {
    groups.push({
      key: 'overdue',
      name: 'Overdue',
      date: '',
      dueDate: undefined,
      droppable: false,
      tasks: overdue,
      estimatedHours: sumEstimate(overdue),
    })
  }

  for (let i = 0; i <= daysLeft; i += 1) {
    const d = dateAt(now, i)
    const key = i === 0 ? 'today' : `d${i}`
    const name = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : DAY_NAMES[d.getDay()]
    const dayKey = taskShiftedDayKey(now, i)
    const tasks = byDay.get(dayKey) ?? []
    groups.push({
      key,
      name,
      date: i === 0 ? `${DAY_NAMES[d.getDay()]} ${shortDate(d)}` : shortDate(d),
      dueDate: dayKey,
      droppable: true,
      tasks,
      estimatedHours: sumEstimate(tasks),
    })
  }

  groups.push({
    key: 'later',
    name: 'Later',
    date: 'after this week',
    // A drop into Later means "the day after the week ends", which is the
    // soonest date that is honestly still Later.
    dueDate: taskShiftedDayKey(now, daysLeft + 1),
    droppable: true,
    tasks: later,
    estimatedHours: sumEstimate(later),
  })

  groups.push({
    key: 'none',
    name: 'No date',
    date: '',
    dueDate: null,
    droppable: true,
    tasks: undated,
    estimatedHours: sumEstimate(undated),
  })

  return groups
}

export interface WeekSummary {
  overdue: number
  today: number
  /** Today through seven days out, inclusive. */
  week: number
  /** Summed estimate across the `week` set. */
  estimatedHours: number
}

/** The four numbers in the strip above the day cards. */
export function weekSummary(rows: readonly TaskRow[], now: Date): WeekSummary {
  const today = taskDayKey(now)
  const weekEnd = taskShiftedDayKey(now, 7)
  let overdue = 0
  let dueToday = 0
  let week = 0
  let estimatedHours = 0

  for (const row of rows) {
    const d = row.dueDate ? row.dueDate.slice(0, 10) : null
    if (d === null) continue
    if (d < today) { overdue += 1; continue }
    if (d === today) dueToday += 1
    if (d <= weekEnd) {
      week += 1
      estimatedHours += row.estimatedHours ?? 0
    }
  }

  return { overdue, today: dueToday, week, estimatedHours }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/tasks-planner.test.ts`
Expected: PASS. `Tests  10 passed (10)`.

Note for the implementer: the `weekSummary` test expects `estimatedHours: 6` because the overdue task's 1 hour is excluded (it is not in the coming week) but rows `b` (2) and `c` (4) both fall on or before the seven-day horizon.

- [ ] **Step 5: Commit**

```bash
git add lib/tasks-planner.ts lib/tasks-planner.test.ts
git commit -m "feat(tasks): week planner grouping and summary maths"
```

### Task 1.5: `lib/task-consistency.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/task-consistency.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  coerceTaskLinks,
  setTaskClient,
  setTaskLevel,
  setTaskRequest,
  type TaskLinkState,
} from './task-consistency'

const TAHI: TaskLinkState = { level: 'tahi_internal', orgId: null, requestId: null }
const CLIENT: TaskLinkState = { level: 'client_task', orgId: 'o1', requestId: 'r1' }

describe('setTaskLevel', () => {
  it('clears the client and the request when moving to Tahi', () => {
    expect(setTaskLevel(CLIENT, 'tahi_internal')).toEqual({
      level: 'tahi_internal', orgId: null, requestId: null,
    })
  })

  it('leaves the links alone moving between Client and Internal', () => {
    expect(setTaskLevel(CLIENT, 'internal_client_task')).toEqual({
      level: 'internal_client_task', orgId: 'o1', requestId: 'r1',
    })
  })

  it('is a no-op on the same level', () => {
    expect(setTaskLevel(CLIENT, 'client_task')).toBe(CLIENT)
  })
})

describe('setTaskClient', () => {
  it('clearing the client drops the request and falls back to Tahi', () => {
    expect(setTaskClient(CLIENT, null, null)).toEqual(TAHI)
  })

  it('setting a client on a Tahi task promotes it to Internal', () => {
    expect(setTaskClient(TAHI, 'o1', null)).toEqual({
      level: 'internal_client_task', orgId: 'o1', requestId: null,
    })
  })

  it('keeps a Client-level task at Client', () => {
    expect(setTaskClient(CLIENT, 'o2', 'o1')).toEqual({
      level: 'client_task', orgId: 'o2', requestId: null,
    })
  })

  it('keeps a request that still belongs to the new client', () => {
    expect(setTaskClient(CLIENT, 'o1', 'o1')).toEqual(CLIENT)
  })
})

describe('setTaskRequest', () => {
  it('unlinking touches nothing but the request', () => {
    expect(setTaskRequest(CLIENT, null)).toEqual({
      level: 'client_task', orgId: 'o1', requestId: null,
    })
  })

  it('linking a request adopts its client and promotes a Tahi task', () => {
    expect(setTaskRequest(TAHI, { id: 'r9', orgId: 'o9' })).toEqual({
      level: 'client_task', orgId: 'o9', requestId: 'r9',
    })
  })

  it('leaves an Internal task Internal', () => {
    const internal: TaskLinkState = { level: 'internal_client_task', orgId: 'o1', requestId: null }
    expect(setTaskRequest(internal, { id: 'r2', orgId: 'o1' })).toEqual({
      level: 'internal_client_task', orgId: 'o1', requestId: 'r2',
    })
  })
})

describe('coerceTaskLinks', () => {
  it('promotes a Tahi task that somehow carries a client', () => {
    expect(coerceTaskLinks({ level: 'tahi_internal', orgId: 'o1', requestId: null })).toEqual({
      level: 'internal_client_task', orgId: 'o1', requestId: null,
    })
  })

  it('promotes a Tahi task that carries a request all the way to Client', () => {
    expect(coerceTaskLinks({ level: 'tahi_internal', orgId: 'o1', requestId: 'r1' })).toEqual({
      level: 'client_task', orgId: 'o1', requestId: 'r1',
    })
  })

  // Deliberately NOT promoted. setTaskRequest leaves an Internal task
  // Internal when you link a request to it, and this coercion has to agree
  // with it or the same triple would mean two things depending on which door
  // it came through.
  it('leaves an Internal task with a request Internal', () => {
    expect(coerceTaskLinks({ level: 'internal_client_task', orgId: 'o1', requestId: 'r1' })).toEqual({
      level: 'internal_client_task', orgId: 'o1', requestId: 'r1',
    })
  })

  it('drops a request that has no client behind it', () => {
    expect(coerceTaskLinks({ level: 'tahi_internal', orgId: null, requestId: 'r1' })).toEqual(TAHI)
  })

  it('forces a client-flavoured level with no client back to Tahi', () => {
    expect(coerceTaskLinks({ level: 'client_task', orgId: null, requestId: null })).toEqual(TAHI)
  })

  it('leaves a consistent state untouched', () => {
    expect(coerceTaskLinks(CLIENT)).toEqual(CLIENT)
    expect(coerceTaskLinks(TAHI)).toEqual(TAHI)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run lib/task-consistency.test.ts`
Expected: FAIL with `Failed to resolve import "./task-consistency"`.

- [ ] **Step 3: Write `lib/task-consistency.ts`**

```ts
/**
 * lib/task-consistency.ts
 *
 * The three invariants that hold the level, the client and the request
 * together. They are the semantic core of the Tasks surface, so they live in
 * one pure module that the detail panel, the create dialog, the quick add and
 * the API route all read, rather than three near-copies of the same if-tree.
 *
 * The invariants, stated once:
 *   - A Tahi task has no client and no request.
 *   - Any task with a request has a client, and it is that request's client.
 *   - Any task with a client is Client level or Internal level.
 */

import type { TaskLevel } from '@/lib/tasks-views'

export interface TaskLinkState {
  level: TaskLevel
  orgId: string | null
  requestId: string | null
}

/**
 * Change the level. Moving to Tahi drops both links, because studio
 * housekeeping cannot carry a client. Moving between Client and Internal
 * changes nothing else: the same work can be client-facing or not.
 */
export function setTaskLevel(state: TaskLinkState, level: TaskLevel): TaskLinkState {
  if (state.level === level) return state
  if (level === 'tahi_internal') {
    return { level, orgId: null, requestId: null }
  }
  return { ...state, level }
}

/**
 * Change the client.
 *
 * `linkedRequestOrgId` is the client the currently linked request belongs to,
 * or null when nothing is linked. The caller has that to hand from the
 * request list it already loaded; passing it in keeps this module free of
 * lookups.
 */
export function setTaskClient(
  state: TaskLinkState,
  orgId: string | null,
  linkedRequestOrgId: string | null,
): TaskLinkState {
  if (!orgId) {
    // No client means no request either, and the task falls back to being
    // the studio's own unless it was already explicitly Internal or Client
    // for a reason the user is about to restate.
    return { level: 'tahi_internal', orgId: null, requestId: null }
  }

  const level: TaskLevel = state.level === 'tahi_internal' ? 'internal_client_task' : state.level
  // A request that belongs to a different client cannot survive the move.
  const requestId = state.requestId && linkedRequestOrgId === orgId ? state.requestId : null
  return { level, orgId, requestId }
}

/**
 * Change the linked request. Linking adopts the request's client, because a
 * task and its request disagreeing about the client is the one state nothing
 * downstream can render honestly.
 */
export function setTaskRequest(
  state: TaskLinkState,
  request: { id: string; orgId: string | null } | null,
): TaskLinkState {
  if (!request) return { ...state, requestId: null }
  const level: TaskLevel = state.level === 'tahi_internal' ? 'client_task' : state.level
  return { level, orgId: request.orgId, requestId: request.id }
}

/**
 * Belt and braces for every path that builds a task from parts rather than by
 * editing one: quick add, the board's column composer, templates, duplicate,
 * and the POST route. Applied last, it makes an inconsistent triple
 * impossible to persist.
 *
 * It only ever REPAIRS a level that cannot be true; it never overrides a level
 * the caller stated and could have meant. In particular an Internal task that
 * carries a request stays Internal, because setTaskRequest above leaves it
 * Internal too. The prototype's own coercion promoted it to Client while its
 * setRequest rule did not, so the same triple meant two different things
 * depending on which door it came through. One rule, stated once.
 *
 * Callers that want the "moving to Tahi clears the links" behaviour must run
 * setTaskLevel first: this function reads a client on a Tahi task as a level
 * that needs fixing, not as links that need dropping.
 */
export function coerceTaskLinks(state: TaskLinkState): TaskLinkState {
  const { orgId } = state
  let { level, requestId } = state

  // A request with no client behind it is not a link, it is a dangling id.
  if (requestId && !orgId) requestId = null

  // No client at all: only one level can be true.
  if (!orgId) return { level: 'tahi_internal', orgId: null, requestId: null }

  // A client is present, so Tahi is the one level that cannot be true. A
  // linked request makes it client-facing; a bare client does not.
  if (level === 'tahi_internal') level = requestId ? 'client_task' : 'internal_client_task'

  return { level, orgId, requestId }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/task-consistency.test.ts`
Expected: PASS. `Tests  16 passed (16)`.

- [ ] **Step 5: Commit**

```bash
git add lib/task-consistency.ts lib/task-consistency.test.ts
git commit -m "feat(tasks): level, client and request consistency rules"
```

### Task 1.6: `TASK_STATUS_CONFIG` in `lib/status-config.ts`

- [ ] **Step 1: Add the export**

Insert immediately after the `TASK_STATUSES` array (currently ending at `lib/status-config.ts:143`):

```ts
/**
 * The token quad for each task status, matching REQUEST_STATUS_CONFIG's
 * shape so the rail select, the status chip and the board column header can
 * all read one map. Reuses the request pipeline's tokens where the meaning
 * lines up (todo reads as submitted, done reads as delivered) and the shared
 * danger tokens for blocked, all of which carry a verified .dark override.
 */
export const TASK_STATUS_CONFIG: Record<string, StatusStyle> = {
  todo:        { label: 'To Do',       dot: 'var(--status-submitted-dot)',   bg: 'var(--status-submitted-bg)',   text: 'var(--status-submitted-text)',   border: 'var(--status-submitted-border)'   },
  in_progress: { label: 'In Progress', dot: 'var(--status-in-progress-dot)', bg: 'var(--status-in-progress-bg)', text: 'var(--status-in-progress-text)', border: 'var(--status-in-progress-border)' },
  blocked:     { label: 'Blocked',     dot: 'var(--badge-danger-dot)',       bg: 'var(--badge-danger-bg)',       text: 'var(--badge-danger-text)',       border: 'var(--badge-danger-border)'       },
  done:        { label: 'Done',        dot: 'var(--status-delivered-dot)',   bg: 'var(--status-delivered-bg)',   text: 'var(--status-delivered-text)',   border: 'var(--status-delivered-border)'   },
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: exit 0, no output.

- [ ] **Step 3: Commit**

```bash
git add lib/status-config.ts
git commit -m "feat(tasks): task status token quad alongside the request one"
```

### Task 1.7: Teach `dueDateState` which statuses are closed

- [ ] **Step 1: Write the failing test**

Append to `components/tahi/__tests__/due-date-chip.test.ts`:

```ts
describe('closedStatuses', () => {
  const past = '2020-01-01'
  const now = new Date('2026-09-05T09:00:00')

  it('still tones a done TASK as overdue with the default request statuses', () => {
    expect(dueDateState(past, 'done', now)).toBe('overdue')
  })

  it('drops the tone once the caller names the task closed statuses', () => {
    expect(dueDateState(past, 'done', now, TASK_CLOSED_STATUSES)).toBeNull()
  })

  it('keeps toning an open task under the same statuses', () => {
    expect(dueDateState(past, 'todo', now, TASK_CLOSED_STATUSES)).toBe('overdue')
  })
})
```

Add `TASK_CLOSED_STATUSES` to the file's existing import from `../due-date-chip`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run components/tahi/__tests__/due-date-chip.test.ts`
Expected: FAIL, `TASK_CLOSED_STATUSES is not exported`.

- [ ] **Step 3: Change `components/tahi/due-date-chip.tsx`**

Replace the module-private constant at line 27 and the `dueDateState` signature:

```ts
/** Statuses where a due date stops meaning anything, for a REQUEST. Mirrors
 *  CLOSED_STATUSES in lib/requests-views.ts. Stays the default so every
 *  existing caller keeps its behaviour with no edit. */
export const REQUEST_CLOSED_STATUSES: readonly string[] = ['delivered', 'cancelled', 'archived']

/** The same idea for a TASK, whose only finished status is `done`. Without
 *  this a done task with a past due date renders in the danger tone. */
export const TASK_CLOSED_STATUSES: readonly string[] = ['done']

export function dueDateState(
  dueDate: string | null | undefined,
  status: string,
  now: Date = new Date(),
  closedStatuses: readonly string[] = REQUEST_CLOSED_STATUSES,
): DueDateState | null {
  if (!dueDate || closedStatuses.includes(status)) return null
  const due = new Date(`${dueDate.slice(0, 10)}T23:59:59`)
  const ms = due.getTime()
  if (Number.isNaN(ms)) return null
  const days = (ms - now.getTime()) / 86_400_000
  if (days < 0) return 'overdue'
  if (days <= DUE_SOON_DAYS) return 'due-soon'
  return 'on-track'
}
```

Then add `closedStatuses?: readonly string[]` to the `DueDateChip` props interface and forward it into the `dueDateState` call inside the component.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run components/tahi/__tests__/due-date-chip.test.ts`
Expected: PASS, three more tests than before.

- [ ] **Step 5: Commit**

```bash
git add components/tahi/due-date-chip.tsx components/tahi/__tests__/due-date-chip.test.ts
git commit -m "fix(tasks): let dueDateState be told which statuses count as closed"
```

### Task 1.8: Move `inline-field.tsx` out of the requests folder

- [ ] **Step 1: Move the file**

```bash
git mv components/tahi/requests/inline-field.tsx components/tahi/inline-field.tsx
```

The test file `components/tahi/__tests__/inline-field.test.ts` is already in the right place and does not move; only its import path changes in Step 3.

- [ ] **Step 2: Update the doc header**

In `components/tahi/inline-field.tsx`, change the header's opening line to name the module generically:

```
 * Inline editors for a detail rail row: a menu field, a date field and a
 * number field. Built for the Requests detail and reused by the Tasks detail,
 * which is why they live here rather than under requests/.
```

- [ ] **Step 3: Fix every importer**

Run: `grep -rn "requests/inline-field" --include=*.ts --include=*.tsx .`
Expected before the fix: hits in `app/(dashboard)/requests/[id]/request-detail.tsx`, `app/(dashboard)/requests/request-list.tsx`, `components/tahi/__tests__/inline-field.test.ts`.

Change each `@/components/tahi/requests/inline-field` (and the test's relative `../requests/inline-field`) to `@/components/tahi/inline-field` (test: `../inline-field`).

- [ ] **Step 4: Verify**

Run: `grep -rn "requests/inline-field" --include=*.ts --include=*.tsx . ; npm run type-check ; npx vitest run components/tahi/__tests__/inline-field.test.ts`
Expected: no grep hits, type-check exit 0, tests pass.

- [ ] **Step 5: Commit**

```bash
git add -u
git add components/tahi/inline-field.tsx
git commit -m "refactor: move the inline field editors out of the requests folder"
```

### Task 1.9: Extract `SidebarCard` from `request-detail.tsx`

- [ ] **Step 1: Create `components/tahi/rail/sidebar-card.tsx`**

Move `RailHeadIcon` (`request-detail.tsx:3450`), `RailHeadCount` (`:3469`), `SidebarCard` (`:3481-3527`) and `RAIL_ACTION_CLASS` / `RAIL_ACTION_STYLE` (`:3538-3548`) verbatim into the new file, adding `'use client'` at the top and a doc header:

```
/**
 * <SidebarCard>. The boxed card every detail rail is made of: a leaf-radius
 * icon tile, an 11px uppercase title with 0.05em tracking, an optional
 * tabular count, and an action slot hard right.
 *
 * Every card is `overflow: hidden` with no escape hatch. Menus leave through
 * the portalled <Popover>, never out of the card box, which is what keeps a
 * long option list from stretching the rail.
 *
 * Extracted from app/(dashboard)/requests/[id]/request-detail.tsx so the
 * Tasks detail composes the same card instead of hand-rolling a fifth copy.
 */
```

Export `SidebarCard`, `RailHeadIcon`, `RailHeadCount`, `RAIL_ACTION_CLASS`, `RAIL_ACTION_STYLE` and the `SidebarCardProps` interface.

- [ ] **Step 2: Delete the local copies and import**

In `request-detail.tsx`, delete the four moved definitions and add:

```ts
import {
  SidebarCard,
  RAIL_ACTION_CLASS,
  RAIL_ACTION_STYLE,
} from '@/components/tahi/rail/sidebar-card'
```

- [ ] **Step 3: Verify nothing moved visually**

Run: `npm run type-check && npm run lint`
Expected: type-check exit 0; lint prints `No ESLint warnings or errors`.

- [ ] **Step 4: Commit**

```bash
git add components/tahi/rail/sidebar-card.tsx "app/(dashboard)/requests/[id]/request-detail.tsx"
git commit -m "refactor: extract SidebarCard so the tasks detail can compose it"
```

### Task 1.10: Give `TimeCard` a target instead of a request id

- [ ] **Step 1: Change the props and every request-shaped reference**

In `components/tahi/time-card.tsx`:

```ts
export interface TimeCardTarget {
  kind: 'request' | 'task'
  id: string
}

interface Props {
  target: TimeCardTarget
}

export function TimeCard({ target }: Props) {
  // The timers table already carries both columns (see ActiveTimer above), so
  // the only per-kind differences are the POST body key, the entries endpoint
  // and which id on the running timer we compare against.
  const timerKey = target.kind === 'request' ? 'requestId' : 'taskId'
  const entriesPath = target.kind === 'request'
    ? `/api/admin/requests/${target.id}/time-entries`
    : `/api/admin/time-entries?taskId=${encodeURIComponent(target.id)}`
```

Then, mechanically:
- line 123 and line 286: `fetch(apiPath(entriesPath))`. For the task kind the POST that logs time manually goes to `/api/admin/time-entries` with `{ taskId: target.id, ... }` in the body rather than to the request-scoped path. That route already accepts `taskId` (`app/api/admin/time-entries/route.ts:102-124`) and requires **exactly one** of `requestId` or `taskId`, so send one key, never both and never a null second key.
- line 146: `if (!timer || timer.isPaused || timer[timerKey] !== target.id) return`
- line 160: `body: JSON.stringify({ [timerKey]: target.id })`
- lines 310 to 311: `const onThis = timer && timer[timerKey] === target.id` and `const onOther = timer && timer[timerKey] !== target.id`
- the `useCallback` / `useEffect` dependency arrays: swap `requestId` for `target.id` and `target.kind`.

- [ ] **Step 2: Update the one existing caller**

In `request-detail.tsx`, change `<TimeCard requestId={requestId} />` to `<TimeCard target={{ kind: 'request', id: requestId }} />`.

- [ ] **Step 3: Verify**

Run: `npm run type-check && npm run lint && npx vitest run lib/timer-helpers.test.ts`
Expected: type-check exit 0, lint clean, timer tests pass.

- [ ] **Step 4: Commit**

```bash
git add components/tahi/time-card.tsx "app/(dashboard)/requests/[id]/request-detail.tsx"
git commit -m "refactor: TimeCard takes a target so a task can mount it"
```

### Task 1.11: Lift the rail controls into `components/tahi/rail/`

- [ ] **Step 1: Create `components/tahi/rail/rail-controls.tsx`**

Move these four definitions out of `components/tahi/requests/requests-rail.tsx` verbatim, renaming only where noted:

Find them by name rather than by line: this file has moved under edits since the audit and the ranges below are approximate.

| From `requests-rail.tsx` | To `rail-controls.tsx` |
|---|---|
| `RailOption` interface (declared around `:41`, currently `extends FilterOption`) | `RailOption`, now a standalone `{ value: string; label: string; dot?: string }`. Check what `FilterOption` adds before dropping the base: if any Requests option list relies on a field it contributes, keep that field on the standalone type rather than deleting it. |
| `RailSelect` (props interface around `:109`, function around `:127`) | `RailSelect`, exported |
| `ViewItem` (around `:374`) | `RailViewItem`, exported |
| `GroupLabel` (around `:440`) | `RailGroupLabel`, exported |
| `SaveDefaultControl` (around `:459`, already exported) | `SaveDefaultControl`, exported unchanged |

Add a generic chip builder and chip type:

```ts
/** One active filter, ready to render as a clearable chip. Built from the
 *  same option lists the controls use, so a chip can never disagree with the
 *  control that set it. */
export interface RailFilterChip {
  key: string
  dimension: string
  label: string
  dot?: string
}

/** Turn a filter record into chips. `dimensions` names each key and supplies
 *  its option list; `defaults` says what "not set" looks like per key. Only
 *  keys present in `dimensions` can raise a chip, so a dimension this
 *  audience does not have never shows one. */
export function buildRailChips(
  filters: Record<string, string>,
  defaults: Record<string, string>,
  dimensions: readonly { key: string; label: string; options: readonly RailOption[] }[],
): RailFilterChip[] {
  return dimensions
    .filter(d => filters[d.key] !== undefined && filters[d.key] !== defaults[d.key])
    .map(d => {
      const match = d.options.find(o => o.value === filters[d.key])
      return {
        key: d.key,
        dimension: d.label,
        label: match?.label ?? filters[d.key],
        dot: match?.dot,
      }
    })
}
```

Keep the doc header explaining the 36px trigger, the portalled `Popover`, the brand border when active, the inline clear button, the optional search box, the `touch` 44px mode, and the single-open `openKey` discipline. Keep the two comments inside `SaveDefaultControl` verbatim: they record hard-won fixes (one element across both states so focus survives the save, and an unconditional `onMouseLeave` reset).

- [ ] **Step 2: Rewire `requests-rail.tsx`**

Delete the moved definitions and add at the top:

```ts
import {
  RailSelect,
  RailViewItem,
  RailGroupLabel,
  SaveDefaultControl,
  type RailOption,
} from '@/components/tahi/rail/rail-controls'

// Re-exported so the existing importers (requests-rail-layout.tsx,
// request-list.tsx) keep working without a path change.
export { SaveDefaultControl }
export type { RailOption }
```

Replace `<ViewItem` with `<RailViewItem` and `<GroupLabel>` with `<RailGroupLabel>` at every call site. `buildFilterChips` stays where it is: it is Requests vocabulary.

- [ ] **Step 3: Verify the Requests surface is untouched**

Run: `npm run type-check && npm run lint && npx vitest run components/tahi/__tests__/requests-rail-default.test.ts`
Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add components/tahi/rail/rail-controls.tsx components/tahi/requests/requests-rail.tsx
git commit -m "refactor: lift the rail select, view item and save control into a shared module"
```

### Task 1.12: Generalise the rail frame

- [ ] **Step 1: Create `components/tahi/rail/rail-layout.tsx`**

Move the `FilterChip` component and the whole `RequestsRailLayout` render body out of `requests-rail-layout.tsx` into a new `RailLayout` with this exact interface:

```ts
export interface RailLayoutProps {
  /** The desktop rail contents. Rendered inside the 14.5rem aside. */
  rail: React.ReactNode
  /** The same rail with 44px targets, rendered inside the mobile sheet. */
  railTouch: React.ReactNode
  /** The view switcher, rendered first in the toolbar row. */
  switcher: React.ReactNode
  chips: readonly RailFilterChip[]
  onClearChip: (chip: RailFilterChip) => void
  onClearAll: () => void
  /** Put the view back to the saved default. Omitted when there is no saved
   *  default, or when the view already matches it. */
  onResetDefault?: () => void
  query: string
  onQueryChange: (next: string) => void
  searchPlaceholder: string
  /** Rows after the saved view, filters and search have been applied. */
  total: number
  /** Singular noun for the count, e.g. 'request' or 'task'. */
  itemNoun: string
  /** Plural, when it is not just `${itemNoun}s`. */
  itemNounPlural?: string
  /** Shows a quiet loading word in place of the count on the first fetch. */
  loading?: boolean
  /** Adds to the mobile Filters badge alongside the chip count, e.g. 1 when
   *  a saved view is active. */
  extraActiveCount?: number
  /** Rendered at the right of the chip row below lg, where the rail's own
   *  foot is inside the sheet. Pass <SaveDefaultControl touch />. */
  saveDefaultTouch: React.ReactNode
  children: React.ReactNode
}
```

Everything else about the frame is unchanged and must stay: the `hidden lg:block` aside at `width: 14.5rem`, the `flex-1 min-w-0` main column, the Filters button with its brand-tinted active state and count badge, the search box with its clear button, the `aria-live` count, the chip row's `flex lg:hidden` fallback when there are no chips, the `Reset to default` button, the `SlideOver` titled "Filters and sort" with `maxWidth="22rem"`, and its footer with `Clear all` on the left and `Show {total}` on the right.

Two substitutions only:
- the count string becomes `` `${total} ${total === 1 ? itemNoun : (itemNounPlural ?? `${itemNoun}s`)}` ``
- the Filters badge count becomes `chips.length + (extraActiveCount ?? 0)`

Keep the comment above the chip row verbatim, including the note that the sheet deliberately omits `SaveDefaultControl` because two controls with the same accessible name on screen at once is worse than one in a less obvious place.

- [ ] **Step 2: Reduce `RequestsRailLayout` to a wrapper**

In `requests-rail-layout.tsx`, keep every export it has today (`applyStoredRequestDefault`, `migrateLegacyRequestPreferences`, `useRequestsRailState`, `RequestsRailState`, `RequestsRailLayoutProps`, `RequestsRailLayout`) and replace only the render body:

```tsx
export function RequestsRailLayout({
  railProps,
  switcher,
  chips,
  onClearChip,
  narrowChips = [],
  onClearNarrowChip,
  onClearAll,
  onResetDefault,
  query,
  onQueryChange,
  searchPlaceholder,
  total,
  loading = false,
  children,
}: RequestsRailLayoutProps) {
  // The URL-only dimensions have no rail control, so they ride the same chip
  // row prefixed to keep the two key spaces apart.
  const allChips = React.useMemo(
    () => [
      ...chips.map(c => ({ key: c.key, dimension: c.dimension, label: c.label, dot: c.dot })),
      ...narrowChips.map(c => ({ key: `narrow-${c.key}`, dimension: c.dimension, label: c.label, dot: c.dot })),
    ],
    [chips, narrowChips],
  )

  const handleClearChip = React.useCallback((chip: RailFilterChip) => {
    if (chip.key.startsWith('narrow-')) {
      const original = narrowChips.find(c => `narrow-${c.key}` === chip.key)
      if (original) onClearNarrowChip?.(original)
      return
    }
    const original = chips.find(c => c.key === chip.key)
    if (original) onClearChip(original)
  }, [chips, narrowChips, onClearChip, onClearNarrowChip])

  return (
    <RailLayout
      rail={<RequestsRail {...railProps} />}
      railTouch={<RequestsRail {...railProps} touch />}
      switcher={switcher}
      chips={allChips}
      onClearChip={handleClearChip}
      onClearAll={onClearAll}
      onResetDefault={onResetDefault}
      query={query}
      onQueryChange={onQueryChange}
      searchPlaceholder={searchPlaceholder}
      total={total}
      itemNoun="request"
      loading={loading}
      extraActiveCount={railProps.savedView ? 1 : 0}
      saveDefaultTouch={
        <SaveDefaultControl isDefault={railProps.isDefault} onSave={railProps.onSaveDefault} touch />
      }
    >
      {children}
    </RailLayout>
  )
}
```

The wrapper needs three new imports: `RailLayout` and `type RailFilterChip` from `@/components/tahi/rail/rail-layout` and `@/components/tahi/rail/rail-controls`, and `SaveDefaultControl`, which `requests-rail.tsx` now re-exports (Task 1.11 Step 2). Delete whatever of the old render body's imports the wrapper no longer uses, or lint fails on them.

Two behaviours to check are preserved exactly, because they are easy to lose in the move:
- `activeCount` today is `chips.length + narrowChips.length + (railProps.savedView ? 1 : 0)` (`requests-rail-layout.tsx:490`). The wrapper merges `narrowChips` into `allChips`, so `RailLayout`'s `chips.length + extraActiveCount` comes to the same number. Confirm it does before merging.
- The chip row's class today is `anyChips || onResetDefault ? 'flex ...' : 'flex lg:hidden ...'` (`:616-618`). The generic version needs the same rule, or the row disappears on desktop when there is nothing in it and takes the touch Save-as-default control with it.

- [ ] **Step 3: Verify the Requests surface still behaves**

Run: `npm run type-check && npm run lint && npm run build`
Expected: type-check exit 0, lint clean, build succeeds.

Then run the existing Requests e2e as a regression gate:

Run: `npx playwright test e2e/requests-list.spec.ts --project=chromium`
Expected: all tests pass (they exercise the rail, the chips, the sheet and the count).

- [ ] **Step 4: Commit**

```bash
git add components/tahi/rail/rail-layout.tsx components/tahi/requests/requests-rail-layout.tsx
git commit -m "refactor: generalise the rail frame so tasks reuses it rather than copying it"
```

### Task 1.13: `components/tahi/tasks/task-types.ts` and `task-chips.tsx`

- [ ] **Step 1: Create `components/tahi/tasks/task-types.ts`**

The row-shaped types every Tasks component passes around. They live here, in Slice 1, rather than in whichever leaf happened to declare them first, because Slices 3, 4 and 5 run in parallel: a type exported from `tasks-list.tsx` would not exist yet in the Slice 5 worktree, and Slice 5's `task-detail-panel.tsx` and `tasks-week.tsx` both need two of them.

```ts
/**
 * The small shared shapes the Tasks components hand each other. No React, no
 * imports beyond the view vocabulary, so any slice can depend on it.
 *
 * They live in Slice 1 on purpose. Slices 3, 4 and 5 build four leaves in
 * parallel worktrees; a type that lived in one leaf would make the other three
 * un-typecheckable until it merged.
 */

export interface TaskSubtask {
  id: string
  title: string
  completed: boolean
}

/** A team member, as every task surface needs them: avatar plus a name. */
export interface TaskPerson {
  id: string
  name: string
  avatarUrl?: string | null
}

export interface TaskClientOption {
  id: string
  name: string
}

/** A request the Links card can point a task at. */
export interface TaskRequestOption {
  id: string
  orgId: string | null
  requestNumber: number | null
  title: string
}

/** One row of `blockedBy` or `blocks` from GET .../dependencies. `depId` is
 *  the dependency row's own id, which is what DELETE takes; `taskId` is the
 *  OTHER task in the relationship. */
export interface TaskDependencyRow {
  depId: string
  taskId: string
  taskTitle: string
  taskStatus: string
}

/** A task template, as the header menu and the create dialog read it. */
export interface TaskTemplateOption {
  id: string
  name: string
  type: string
  description: string | null
  defaultPriority: string
  subtasks: string[]
  estimatedHours: number | null
  orgId: string | null
}
```

Every later slice imports these from `@/components/tahi/tasks/task-types` and **must not redeclare them**. Specifically: Slice 3's `tasks-list.tsx` does not export `TaskSubtask` or `TaskPerson`, Slice 5's `task-detail-panel.tsx` does not export `TaskDependencyRow` or `TaskRequestOption`, and Slice 5's `new-task-dialog.tsx` does not export `TaskTemplateOption`. Where the slice bodies below still show those declarations inline, read them as "this is the shape, imported from `task-types`".

- [ ] **Step 2: Create `components/tahi/tasks/task-chips.tsx`**

The five pieces all three views share. Written to these exact signatures because Slices 3, 4 and 5 all import them.

```tsx
'use client'

/**
 * The small pieces every Tasks view shares: the level chip, the request chip,
 * the completion tick, the status badge and the subtask badge.
 *
 * All five come straight off the prototype's tasks.css and are sized in rem
 * against the same tokens the Requests chips use, so a row of tasks and a row
 * of requests read as one system.
 *
 * The level chip is deliberately the widest of them: it carries the client
 * avatar, and the container query on the row lets the OTHER chips give up
 * their icons first. The title never gives up width.
 */

import * as React from 'react'
import { Check, Inbox, Leaf, Lock, Users } from 'lucide-react'
import { Avatar } from '@/components/tahi/avatar'
import { Badge } from '@/components/tahi/badge'
import { TASK_STATUS_CONFIG, TASK_STATUS_LABELS, TASK_STATUS_TONE } from '@/lib/status-config'
import { TASK_LEVEL_LABELS, type TaskLevel } from '@/lib/tasks-views'

export const LEVEL_ICON: Record<TaskLevel, React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }>> = {
  client_task: Users,
  internal_client_task: Lock,
  tahi_internal: Leaf,
}

export function LevelChip({ level, clientName, compact = false }: {
  level: TaskLevel
  /** Renders a client avatar after the label. Omit for a Tahi task. */
  clientName?: string | null
  /** Board cards use the icon alone: 1.25rem tall, no label, no avatar. */
  compact?: boolean
}): React.ReactElement

export function RequestChip({ requestId, requestNumber, onOpen }: {
  requestId: string
  /** Rendered as #042 when known, otherwise the chip shows just the icon
   *  and the word Request. */
  requestNumber?: number | null
  /** Called instead of navigating, so the caller can stop the row click. */
  onOpen: (requestId: string) => void
}): React.ReactElement

export function TaskTick({ done, blocked = false, size = 'md', disabled = false, title, onToggle }: {
  done: boolean
  /** Dashed danger ring: the task is stalled and reads that way before you
   *  open it. */
  blocked?: boolean
  /** 'sm' 1.0625rem inside the subtask panel, 'md' 1.25rem on a row,
   *  'lg' 1.5rem in the detail head. */
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  /** The task title, for the accessible name. */
  title: string
  onToggle: () => void
}): React.ReactElement

export function TaskStatusBadge({ status, size = 'sm' }: {
  status: string
  size?: 'sm' | 'md'
}): React.ReactElement

export function SubtaskBadge({ done, total }: { done: number; total: number }): React.ReactElement | null
```

Implementation notes that are part of the contract:

- `LevelChip` uses `TASK_STATUS_CONFIG`-style tinting per level: `client_task` takes the `--status-in-progress-*` tokens, `internal_client_task` the `--status-in-review-*` tokens, `tahi_internal` `color-mix(in srgb, var(--color-brand-100) 70%, var(--color-bg))` on `var(--color-brand-dark)` with `color-mix(in srgb, var(--color-brand) 30%, transparent)` as the border. Height `1.375rem`, padding `0 0.5rem`, `border-radius: var(--radius-sm)`, `font: 600 0.6875rem`, `white-space: nowrap`, `flex-shrink: 0`.
- `TaskTick` renders `role="checkbox"` with `aria-checked`, `aria-label` of `Complete {title}` or `Reopen {title}`, and `title` of `Mark done` / `Reopen` / `Blocked. Complete anyway`. It always calls `event.stopPropagation()` and no-ops when `disabled`. Base: `1.25rem` circle, `1.5px solid var(--color-border)`, `background: var(--color-bg)`, `color: transparent` with a `<Check size={12} />` inside that only becomes visible through the colour change. `.on` fills `var(--color-brand)` with `var(--color-text-on-dark)`; `blocked` swaps the border to `1.5px dashed var(--color-danger)`; `:active` is `transform: scale(0.9)`. Wrap it in a 2rem hit box (2.75rem below `md`) with negative margins so the visual size stays small while the target stays legal.
- `TaskStatusBadge` is `<Badge tone={TASK_STATUS_TONE[status] ?? 'neutral'} variant="soft" size={size} leader="dot">{TASK_STATUS_LABELS[status] ?? status}</Badge>`. An unknown status renders neutral with its raw value rather than disappearing.
- `SubtaskBadge` returns `null` when `total === 0`.
- `RequestChip` links to `/requests/${requestId}` through `onOpen`, never to the requests list. The prototype's `go('requests')` was a gap, not a design.

**The signatures above are the exported contract, not the file.** Write real component bodies: TypeScript will not accept a function declaration with a return type and no body, and Slices 3, 4 and 5 render these. Every one of them needs the hover state, the focus state (`className="tahi-focus-ring"`) and the below-`md` 2.75rem target the ground rules require.

- [ ] **Step 3: Type-check and lint**

Run: `npm run type-check && npm run lint`
Expected: type-check exit 0, lint clean.

- [ ] **Step 4: Commit**

```bash
git add components/tahi/tasks/task-types.ts components/tahi/tasks/task-chips.tsx
git commit -m "feat(tasks): shared task types plus the level, request, tick, status and subtask chips"
```

### Task 1.14: Close Slice 1

- [ ] **Step 1: Full check**

Run: `npm run type-check && npm run lint && npx vitest run && npm run build`
Expected: type-check exit 0; lint clean; `Test Files` all passed; build succeeds.

- [ ] **Step 2: Hand to the lead**

Post the diff summary. The lead reviews and pushes. Wave B cannot start until this is on main.

---

## Slice 2: API, schema, migration and MCP parity (Wave B, parallel with 3, 4, 5)

**Files:**
- Create: `drizzle/migrations/0087_task_estimate_and_indexes.sql`, `lib/task-access.ts`, `app/api/admin/tasks/[id]/promote/route.ts`, `app/api/admin/tasks/__tests__/tasks-create.test.ts`, `app/api/admin/tasks/__tests__/tasks-bulk.test.ts`
- Modify: `db/schema.ts`, `app/api/admin/db/migrate/route.ts`, `app/api/admin/tasks/route.ts`, `app/api/admin/tasks/[id]/route.ts`, `app/api/admin/tasks/bulk/route.ts`, `app/api/admin/tasks/from-template/route.ts`, `app/api/admin/tasks/[id]/subtasks/route.ts`, `app/api/admin/tasks/[id]/subtasks/[subId]/route.ts`, `app/api/admin/tasks/[id]/dependencies/route.ts`, `app/api/admin/tasks/[id]/dependencies/[depId]/route.ts`, `app/api/admin/tasks/[id]/calls/route.ts`, `app/api/admin/ai/task-wizard/route.ts`, `components/tahi/ai-task-wizard.tsx`, `workers/mcp-server/src/index.ts`

### Task 2.1: Schema and migration

- [ ] **Step 1: Add the column and the two indexes to `db/schema.ts`**

In the `tasks` table (starting `db/schema.ts:819`), add after `scheduleRowId`:

```ts
  // The prototype's `est`. Backs the detail's Estimate field, the My week
  // "Estimated" stat and the per-day hours line (migration 0087).
  estimatedHours: real('estimated_hours'),
```

and add two entries to the index array at the end of the table definition:

```ts
  // ?assignee=me is the default lens for every teammate and for the
  // teammate Overview home, and the planner sorts on the due date.
  index('idx_tasks_assignee').on(table.assigneeId),
  index('idx_tasks_due').on(table.dueDate),
```

`real` is already imported at the top of `db/schema.ts` (it is used by `taskTemplates.estimatedHours`).

- [ ] **Step 2: Write the migration file**

Create `drizzle/migrations/0087_task_estimate_and_indexes.sql`:

```sql
-- Migration 0087: task estimate, plus the indexes the default lens needs
--
-- estimated_hours is the ONLY column the Tasks port adds. Every other field
-- the prototype shows already has a home: level -> type, client -> org_id,
-- request -> request_id, subtasks -> task_subtasks, time -> time_entries,
-- blockedBy -> task_dependencies.
--
-- The two indexes are not new capability, they are the cost of the surface:
-- ?assignee=me is the default lens for every teammate and for the teammate
-- Overview home, and both the list sort and the week planner read due_date.
--
-- ALTER TABLE ADD COLUMN cannot use IF NOT EXISTS in SQLite; the runtime
-- runner (app/api/admin/db/migrate) swallows the "duplicate column name"
-- error so re-running is safe. Index CREATEs are IF NOT EXISTS.
ALTER TABLE tasks ADD COLUMN estimated_hours real;
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
```

- [ ] **Step 3: Mirror it into the runtime runner**

Append to the `MIGRATIONS` array in `app/api/admin/db/migrate/route.ts`, as the new last entry, immediately after the `'0086'` entry (Portal pay link + client payment terms), which closes at the `]` that ends the array. **`0086` is already taken** by `drizzle/migrations/0086_invoice_pay_link_and_terms.sql`, which is why this migration is `0087`. Check the tail of `drizzle/migrations/` before writing the file: if anything has landed since this plan was written, take the next free number and update every mention in this task.

```ts
  {
    name: '0087',
    description: 'tasks.estimated_hours plus assignee and due-date indexes',
    statements: [
      `ALTER TABLE tasks ADD COLUMN estimated_hours real`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date)`,
    ],
  },
```

- [ ] **Step 4: Verify**

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add db/schema.ts drizzle/migrations/0087_task_estimate_and_indexes.sql app/api/admin/db/migrate/route.ts
git commit -m "feat(tasks): estimated_hours column plus assignee and due indexes"
```

- [ ] **Step 6: Apply it to staging and prod**

Call the MCP tool `run_migration` with `{ "name": "0087" }` against the worker MCP server. Expected response: `{"results":[{"name":"0087","status":"applied","statementCount":3,"skippedAlreadyExists":0}]}`. Re-running is safe and reports `skippedAlreadyExists: 3`.

Record the result in the commit body of the next commit, so it is obvious later that the column exists.

### Task 2.2: `POST /api/admin/tasks` honours the three levels and persists subtasks

- [ ] **Step 1: Write the failing test**

Create `app/api/admin/tasks/__tests__/tasks-create.test.ts`. It follows the same thenable drizzle stub pattern as the existing `tasks-enrichment.test.ts` in that folder: read that file first and reuse its mock shape rather than inventing a second one.

```ts
/**
 * POST /api/admin/tasks.
 *
 * Three things this route got wrong before the Tasks port and must not get
 * wrong again: it collapsed internal_client_task into client_task, it did not
 * validate the priority (so a template could write a value PATCH then
 * refused), and it accepted a `subtasks` array from the new-task dialog and
 * silently threw it away.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const inserted: { table: string; values: Record<string, unknown> }[] = []

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: async () => ({ orgId: 'tahi-org', userId: 'user_1' }),
  isTahiAdmin: () => true,
}))

vi.mock('@/db/d1', () => ({
  schema: { tasks: { __name: 'tasks' }, taskSubtasks: { __name: 'task_subtasks' } },
}))

vi.mock('@/lib/db', () => ({
  db: async () => ({
    insert: (table: { __name: string }) => ({
      values: async (values: Record<string, unknown> | Record<string, unknown>[]) => {
        for (const v of Array.isArray(values) ? values : [values]) {
          inserted.push({ table: table.__name, values: v })
        }
      },
    }),
  }),
}))

const { POST } = await import('../route')

function post(body: unknown): Request {
  return new Request('http://localhost/api/admin/tasks', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/admin/tasks', () => {
  beforeEach(() => { inserted.length = 0 })

  it('keeps internal_client_task rather than collapsing it', async () => {
    const res = await POST(post({ title: 'Chase GA4', type: 'internal_client_task', orgId: 'o1' }) as never)
    expect(res.status).toBe(201)
    expect(inserted[0].values.type).toBe('internal_client_task')
    expect(inserted[0].values.orgId).toBe('o1')
  })

  it('rejects a client-flavoured level with no client', async () => {
    const res = await POST(post({ title: 'x', type: 'internal_client_task' }) as never)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Client is required for a client task' })
  })

  it('drops the client and the request on a tahi_internal task', async () => {
    await POST(post({ title: 'Tidy the drive', type: 'tahi_internal', orgId: 'o1', requestId: 'r1' }) as never)
    expect(inserted[0].values.orgId).toBeNull()
    expect(inserted[0].values.requestId).toBeNull()
  })

  it('derives the level from orgId when type is omitted', async () => {
    await POST(post({ title: 'x', orgId: 'o1' }) as never)
    expect(inserted[0].values.type).toBe('client_task')
  })

  it('rejects a priority outside the repo scale', async () => {
    const res = await POST(post({ title: 'x', priority: 'medium' }) as never)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Invalid priority' })
  })

  it('accepts a valid status instead of always writing todo', async () => {
    await POST(post({ title: 'x', status: 'in_progress' }) as never)
    expect(inserted[0].values.status).toBe('in_progress')
  })

  it('rejects an unknown status', async () => {
    const res = await POST(post({ title: 'x', status: 'shipped' }) as never)
    expect(res.status).toBe(400)
  })

  it('persists the subtask titles it is handed', async () => {
    await POST(post({ title: 'x', subtasks: ['One', '  Two  ', '', '   '] }) as never)
    const subs = inserted.filter(i => i.table === 'task_subtasks')
    expect(subs.map(s => s.values.title)).toEqual(['One', 'Two'])
    expect(subs.every(s => s.values.taskId === inserted[0].values.id)).toBe(true)
  })

  it('stores the estimate', async () => {
    await POST(post({ title: 'x', estimatedHours: 2.5 }) as never)
    expect(inserted[0].values.estimatedHours).toBe(2.5)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run "app/api/admin/tasks/__tests__/tasks-create.test.ts"`
Expected: FAIL. The first failure is the collapsed type (`expected 'client_task' to be 'internal_client_task'`).

- [ ] **Step 3: Rewrite the POST handler**

Replace everything from `export async function POST` to the end of `app/api/admin/tasks/route.ts` with:

```ts
// -- POST /api/admin/tasks --------------------------------------------------
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    title?: string
    type?: string
    orgId?: string | null
    description?: string | null
    status?: string
    priority?: string
    assigneeId?: string | null
    assigneeType?: string | null
    dueDate?: string | null
    estimatedHours?: number | null
    trackId?: string | null
    position?: number | null
    requestId?: string | null
    scheduleRowId?: string | null
    subtasks?: string[]
  }

  const title = body.title?.trim()
  if (!title) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }

  // The three-level model is live again. Decision #046 collapsed the UI to a
  // binary; the Tasks port brings back Client / Internal / Tahi as the chips
  // the studio actually thinks in, so the route stops flattening the middle
  // value. `orgId` presence is still what decides when the caller says
  // nothing.
  const requestedLevel = isTaskLevel(body.type) ? body.type : null
  const level: TaskLevel = requestedLevel ?? (body.orgId ? 'client_task' : 'tahi_internal')

  if (level !== 'tahi_internal' && !body.orgId) {
    return NextResponse.json({ error: 'Client is required for a client task' }, { status: 400 })
  }

  if (body.priority !== undefined && !isTaskPriority(body.priority)) {
    return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })
  }

  const status = body.status ?? 'todo'
  if (!TASK_STATUSES.some(s => s.value === status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  // The one place a task is built from parts rather than edited, so the link
  // invariants are enforced here rather than trusted from the caller.
  //
  // setTaskLevel runs first because an explicit tahi_internal MEANS "drop the
  // links", which coerceTaskLinks on its own would read the other way round
  // (as a level to repair upwards). Starting from client_task makes the call a
  // no-op whenever that is the level asked for.
  const links = coerceTaskLinks(setTaskLevel(
    { level: 'client_task', orgId: body.orgId ?? null, requestId: body.requestId ?? null },
    level,
  ))

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const id = crypto.randomUUID()
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

  await drizzle.insert(schema.tasks).values({
    id,
    type: links.level,
    orgId: links.orgId,
    title,
    description: body.description ?? null,
    status,
    priority: body.priority ?? 'standard',
    assigneeId: body.assigneeId ?? null,
    assigneeType: body.assigneeType ?? null,
    dueDate: body.dueDate ?? null,
    estimatedHours: body.estimatedHours ?? null,
    completedAt: status === 'done' ? now : null,
    createdById: userId,
    tags: '[]',
    trackId: body.trackId ?? null,
    position: body.position ?? null,
    requestId: links.requestId,
    scheduleRowId: body.scheduleRowId || null,
    createdAt: now,
    updatedAt: now,
  })

  // The new-task dialog and the template picker both hand over titles here.
  // Before the port this key was accepted on the wire and dropped on the
  // floor, so a checklist typed at creation vanished without a word.
  const subtaskTitles = Array.isArray(body.subtasks)
    ? body.subtasks.map(t => (typeof t === 'string' ? t.trim() : '')).filter(Boolean)
    : []

  for (const subtaskTitle of subtaskTitles) {
    await drizzle.insert(schema.taskSubtasks).values({
      id: crypto.randomUUID(),
      taskId: id,
      title: subtaskTitle,
      completed: false,
      createdAt: now,
    })
  }

  return NextResponse.json({ id }, { status: 201 })
}
```

Add these imports at the top of the file:

```ts
import { isTaskPriority } from '@/lib/task-priorities'
import { TASK_STATUSES } from '@/lib/status-config'
import { isTaskLevel, type TaskLevel } from '@/lib/tasks-views'
import { coerceTaskLinks, setTaskLevel } from '@/lib/task-consistency'
```

The route also stops writing `status: 'todo'` unconditionally and stops collapsing the type, so delete the whole `resolvedType` block (currently lines 205 to 215) rather than leaving it above the new code.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run "app/api/admin/tasks/__tests__/"`
Expected: PASS, both the new create suite (9 tests) and the existing enrichment suite (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/tasks/route.ts "app/api/admin/tasks/__tests__/tasks-create.test.ts"
git commit -m "fix(tasks): POST honours the three levels, validates priority, persists subtasks"
```

### Task 2.3: The GET route stops hiding internal tasks from scoped members

- [ ] **Step 1: Change the scoping clause**

In `app/api/admin/tasks/route.ts`, replace the whole `if (scopedOrgIds !== null) { ... }` block (currently lines 53 to 59, including the `return NextResponse.json({ tasks: [] })` early return inside it, which goes away because an empty scope now still sees the studio's own tasks):

```ts
  // If scoping returned a specific set of org IDs, filter to those. Tasks
  // with no client are the STUDIO'S OWN list, so a scoped member sees them
  // too: SQL `IN` never matches NULL, and without the explicit isNull the
  // whole Tahi-internal half of this surface silently vanished for anyone
  // who is not a super admin.
  if (scopedOrgIds !== null) {
    if (scopedOrgIds.length === 0) {
      conditions.push(isNull(schema.tasks.orgId))
    } else {
      conditions.push(or(inArray(schema.tasks.orgId, scopedOrgIds), isNull(schema.tasks.orgId))!)
    }
  }
```

Add `isNull` and `or` to the `drizzle-orm` import on line 5 (currently `eq, desc, and, inArray, sql, asc`).

The same rule now has to hold in three places or the surface disagrees with itself: this list route, `guardTaskAccess` on the detail route (Step 3), and the bulk route (Task 2.5). All three read "a task with no client is the studio's own and every team member may reach it".

- [ ] **Step 2: Add `estimatedHours` to the select**

In the `.select({ ... })` block, after `scheduleRowId: schema.tasks.scheduleRowId,` add:

```ts
      estimatedHours: schema.tasks.estimatedHours,
```

- [ ] **Step 3: Match the rule on the detail route**

`app/api/admin/tasks/[id]/route.ts` already has a local `guardTaskAccess` at lines 18 to 31. **Do not change its signature.** It returns `Promise<NextResponse | null>` where `null` means allowed, and all three call sites read `const denied = await guardTaskAccess(...); if (denied) return denied`. Returning a boolean instead would invert every one of them silently. The only edit is to drop the `getOrgScope` branch, so a task with no client is allowed for any team member:

```ts
/**
 * A task with a client is guarded by that client. A task with no client is
 * the studio's own housekeeping, and every team member on this surface is in
 * the studio, so it is allowed. The list route applies exactly the same rule
 * (see the isNull clause in ../route.ts); before the port the two disagreed
 * about how they hid the same rows, one by filtering and one by 403ing.
 *
 * Returns a NextResponse to short circuit on denial, or null to proceed.
 */
async function guardTaskAccess(
  drizzle: Drizzle,
  userId: string | null,
  taskOrgId: string | null,
): Promise<NextResponse | null> {
  if (!taskOrgId) return null
  return requireAccessToOrg(drizzle, userId, taskOrgId)
}
```

`Drizzle` is the local alias already declared at line 10 (`ReturnType<typeof import('drizzle-orm/d1').drizzle>`), not `D1Database`. `requireAccessToOrg` is imported from `@/lib/require-access`, which is where it lives; `@/lib/access-scoping` only exports `resolveAccessScoping`. `getOrgScope` becomes an unused import once the branch goes: remove it from the import on line 7 or lint fails.

Task 2.6 later replaces this helper with the shared `lib/task-access.ts` version. Doing it in two passes is deliberate: this step is the behaviour change and is testable on its own, and 2.6 is the de-duplication.

- [ ] **Step 4: Verify**

Run: `npm run type-check && npx vitest run "app/api/admin/tasks/__tests__/"`
Expected: type-check exit 0, all task route tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/tasks/route.ts "app/api/admin/tasks/[id]/route.ts"
git commit -m "fix(tasks): scoped members see the studio's own tasks in list and detail alike"
```

### Task 2.4: PATCH accepts the estimate and clears `completedAt`

- [ ] **Step 1: Change `app/api/admin/tasks/[id]/route.ts`**

Add `estimatedHours?: number | null` to the PATCH body type. Replace the hardcoded status list at line 137 with the shared vocabulary:

```ts
import { TASK_STATUSES } from '@/lib/status-config'
// ...
  if (body.status !== undefined) {
    if (!TASK_STATUSES.some(s => s.value === body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    setFields.status = body.status
    // Reopening a task must take its completion stamp with it, or the list
    // keeps printing "Done 3 days ago" beside an open row.
    setFields.completedAt = body.status === 'done' ? now : null
  }
```

Add the estimate:

```ts
  if (body.estimatedHours !== undefined) {
    const hours = body.estimatedHours
    if (hours !== null && (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0)) {
      return NextResponse.json({ error: 'Invalid estimate' }, { status: 400 })
    }
    setFields.estimatedHours = hours
  }
```

- [ ] **Step 2: Verify**

Run: `npm run type-check && npm run lint`
Expected: type-check exit 0, lint clean.

- [ ] **Step 3: Commit**

```bash
git add "app/api/admin/tasks/[id]/route.ts"
git commit -m "feat(tasks): PATCH accepts an estimate and clears completedAt on reopen"
```

### Task 2.5: The bulk route grows scoping, a due date and an honest count

- [ ] **Step 1: Write the failing test**

Create `app/api/admin/tasks/__tests__/tasks-bulk.test.ts`:

```ts
/**
 * PATCH /api/admin/tasks/bulk.
 *
 * Before the Tasks port this route had no access scoping at all (CLAUDE.md
 * rule 11), issued one UPDATE per id, and returned `taskIds.length` as
 * `updatedCount` whether or not any row existed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls: { where: unknown; set: Record<string, unknown> }[] = []
let scopedOrgIds: string[] | null = null
let existingIds: string[] = []

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: async () => ({ orgId: 'tahi-org', userId: 'user_1' }),
  isTahiAdmin: () => true,
}))

vi.mock('@/lib/access-scoping', () => ({
  resolveAccessScoping: async () => scopedOrgIds,
}))

vi.mock('@/db/d1', () => ({ schema: { tasks: { id: 'id', orgId: 'org_id' } } }))

vi.mock('@/lib/db', () => ({
  db: async () => ({
    select: () => ({
      from: () => ({
        where: async () => existingIds.map(id => ({ id })),
      }),
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: async (where: unknown) => { calls.push({ where, set }) },
      }),
    }),
  }),
}))

const { PATCH } = await import('../bulk/route')

function patch(body: unknown): Request {
  return new Request('http://localhost/api/admin/tasks/bulk', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/admin/tasks/bulk', () => {
  beforeEach(() => {
    calls.length = 0
    scopedOrgIds = null
    existingIds = ['a', 'b']
  })

  it('issues exactly one update for the whole selection', async () => {
    await PATCH(patch({ taskIds: ['a', 'b'], updates: { status: 'done' } }) as never)
    expect(calls).toHaveLength(1)
  })

  it('counts the rows it could actually reach, not the ids it was given', async () => {
    existingIds = ['a']
    const res = await PATCH(patch({ taskIds: ['a', 'ghost'], updates: { status: 'done' } }) as never)
    await expect(res.json()).resolves.toEqual({ success: true, updatedCount: 1 })
  })

  it('returns zero and skips the write when scoping reaches nothing', async () => {
    scopedOrgIds = []
    existingIds = []
    const res = await PATCH(patch({ taskIds: ['a'], updates: { status: 'done' } }) as never)
    expect(calls).toHaveLength(0)
    await expect(res.json()).resolves.toEqual({ success: true, updatedCount: 0 })
  })

  it('accepts a due date, including clearing it', async () => {
    await PATCH(patch({ taskIds: ['a'], updates: { dueDate: '2026-09-09' } }) as never)
    expect(calls[0].set.dueDate).toBe('2026-09-09')
    calls.length = 0
    await PATCH(patch({ taskIds: ['a'], updates: { dueDate: null } }) as never)
    expect(calls[0].set.dueDate).toBeNull()
  })

  it('sets completedAt on done and clears it on anything else', async () => {
    await PATCH(patch({ taskIds: ['a'], updates: { status: 'done' } }) as never)
    expect(calls[0].set.completedAt).toBeTypeOf('string')
    calls.length = 0
    await PATCH(patch({ taskIds: ['a'], updates: { status: 'todo' } }) as never)
    expect(calls[0].set.completedAt).toBeNull()
  })

  it('rejects an invalid priority', async () => {
    const res = await PATCH(patch({ taskIds: ['a'], updates: { priority: 'medium' } }) as never)
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run "app/api/admin/tasks/__tests__/tasks-bulk.test.ts"`
Expected: FAIL, `expected calls to have length 1, got 2`.

- [ ] **Step 3: Rewrite `app/api/admin/tasks/bulk/route.ts`**

```ts
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, inArray, isNull, or } from 'drizzle-orm'
import { isTaskPriority } from '@/lib/task-priorities'
import { TASK_STATUSES } from '@/lib/status-config'
import { resolveAccessScoping } from '@/lib/access-scoping'

// -- PATCH /api/admin/tasks/bulk -------------------------------------------
/**
 * Bulk update: { taskIds, updates: { status?, priority?, assigneeId?, dueDate? } }.
 *
 * Scoped exactly like the list route (CLAUDE.md rule 11): a member reaches
 * the clients they are scoped to, plus the studio's own unclientted tasks.
 * The reachable ids are resolved first, so the count returned is the number
 * of rows this user actually changed rather than the number of ids they sent.
 */
export async function PATCH(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    taskIds?: string[]
    updates?: {
      status?: string
      priority?: string
      assigneeId?: string | null
      dueDate?: string | null
    }
  }

  const { taskIds, updates } = body

  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    return NextResponse.json({ error: 'taskIds must be a non-empty array' }, { status: 400 })
  }
  if (!updates || typeof updates !== 'object') {
    return NextResponse.json({ error: 'updates object is required' }, { status: 400 })
  }
  if (updates.status !== undefined && !TASK_STATUSES.some(s => s.value === updates.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }
  if (updates.priority !== undefined && !isTaskPriority(updates.priority)) {
    return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })
  }

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const setFields: Record<string, unknown> = { updatedAt: now }

  if (updates.status !== undefined) {
    setFields.status = updates.status
    setFields.completedAt = updates.status === 'done' ? now : null
  }
  if (updates.priority !== undefined) setFields.priority = updates.priority
  if (updates.assigneeId !== undefined) {
    setFields.assigneeId = updates.assigneeId || null
    setFields.assigneeType = updates.assigneeId ? 'team_member' : null
  }
  if (updates.dueDate !== undefined) setFields.dueDate = updates.dueDate || null

  if (Object.keys(setFields).length <= 1) {
    return NextResponse.json({ error: 'At least one update field is required' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const scopedOrgIds = await resolveAccessScoping(drizzle, userId)
  const scopeClause = scopedOrgIds === null
    ? undefined
    : scopedOrgIds.length === 0
      ? isNull(schema.tasks.orgId)
      : or(inArray(schema.tasks.orgId, scopedOrgIds), isNull(schema.tasks.orgId))

  // Resolve first so the response can say what actually changed. A bogus id
  // used to come back as a success, which made every bulk failure silent.
  const idClause = inArray(schema.tasks.id, taskIds)
  const reachable = await drizzle
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(scopeClause ? and(idClause, scopeClause) : idClause)

  const reachableIds = reachable.map(r => r.id)
  if (reachableIds.length === 0) {
    return NextResponse.json({ success: true, updatedCount: 0 })
  }

  await drizzle
    .update(schema.tasks)
    .set(setFields)
    .where(inArray(schema.tasks.id, reachableIds))

  return NextResponse.json({ success: true, updatedCount: reachableIds.length })
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run "app/api/admin/tasks/__tests__/tasks-bulk.test.ts"`
Expected: PASS, `Tests  6 passed (6)`.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/tasks/bulk/route.ts "app/api/admin/tasks/__tests__/tasks-bulk.test.ts"
git commit -m "fix(tasks): bulk route gains scoping, a due date, one write and an honest count"
```

### Task 2.6: Guard the child routes

- [ ] **Step 1: Add the shared guard**

The `guardTaskAccess` helper lives in `app/api/admin/tasks/[id]/route.ts` and is not exported (route files may only export HTTP methods and config, per the repo's route-exports rule). Create `lib/task-access.ts` instead:

```ts
/**
 * lib/task-access.ts
 *
 * One access rule for every task route. A task with a client is guarded by
 * that client's access rule; a task with no client is the studio's own
 * housekeeping and is allowed for every team member on this surface.
 *
 * Lives in lib/ rather than in a route file because Next.js App Router
 * routes may only export HTTP methods and config; tsc accepts more, and
 * `next build` then rejects it.
 */

import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { requireAccessToOrg } from '@/lib/require-access'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Look the task up and decide in one call, so no route has to remember to do
 * both.
 *
 * Returns a NextResponse to short circuit on (404 missing, 403 forbidden), or
 * null when the caller may proceed. That is the same contract
 * `requireAccessToOrg` already uses across the admin API, and it is the whole
 * reason this returns a response rather than a boolean: `requireAccessToOrg`
 * itself resolves to `NextResponse | null` with NULL MEANING ALLOWED, so a
 * boolean wrapper around it inverts on every denial.
 */
export async function guardTask(
  drizzle: Drizzle,
  userId: string | null,
  taskId: string,
): Promise<NextResponse | null> {
  const [task] = await drizzle
    .select({ orgId: schema.tasks.orgId })
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId))
    .limit(1)

  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  // No client means the studio's own housekeeping, which every team member on
  // this surface may reach. Same rule as the isNull clause on the list route.
  if (!task.orgId) return null
  return requireAccessToOrg(drizzle, userId, task.orgId)
}
```

- [ ] **Step 2: Call it from every child route**

In each of `app/api/admin/tasks/[id]/subtasks/route.ts`, `.../subtasks/[subId]/route.ts`, `.../dependencies/route.ts`, `.../dependencies/[depId]/route.ts`, `.../calls/route.ts`, replace the existing task-existence lookup with:

```ts
  const denied = await guardTask(drizzle, userId, id)
  if (denied) return denied
```

`userId` comes from the existing `getRequestAuth(req)` call each route already makes. For `POST .../dependencies` also run the same check against `dependsOnTaskId`, so a member cannot link a task they cannot see.

In `app/api/admin/tasks/from-template/route.ts`, guard the incoming `orgId` with `requireAccessToOrg` when one is supplied (`const denied = await requireAccessToOrg(drizzle, userId, body.orgId); if (denied) return denied`, guarded on `body.orgId` being set, because a null target makes that helper answer 404), and validate `template.defaultPriority` through the alias table before it is written:

```ts
/** Task templates carry their own six-value priority enum (none, low,
 *  medium, standard, high, urgent) while a task takes three. Mapping here is
 *  what stops a "medium" template creating a task PATCH then refuses to
 *  touch. */
const TEMPLATE_PRIORITY_ALIASES: Record<string, string> = {
  none: 'standard', low: 'standard', medium: 'standard',
  standard: 'standard', high: 'high', urgent: 'urgent',
}
const priority = TEMPLATE_PRIORITY_ALIASES[template.defaultPriority] ?? 'standard'
```

Refactor `app/api/admin/tasks/[id]/route.ts` to call `guardTask` too, deleting the local `guardTaskAccess` Task 2.3 edited. Its three call sites already read `const denied = await guardTaskAccess(...); if (denied) return denied`, and `guardTask` has the same contract, so the only changes are the import, the call, and dropping the now-redundant task lookup those handlers do before the guard.

- [ ] **Step 3: Verify**

Run: `npm run type-check && npm run lint && npm run build`
Expected: type-check exit 0, lint clean, build succeeds (the build is the check that catches a non-method export from a route file).

- [ ] **Step 4: Commit**

```bash
git add lib/task-access.ts "app/api/admin/tasks/[id]/route.ts" "app/api/admin/tasks/[id]/subtasks/route.ts" "app/api/admin/tasks/[id]/subtasks/[subId]/route.ts" "app/api/admin/tasks/[id]/dependencies/route.ts" "app/api/admin/tasks/[id]/dependencies/[depId]/route.ts" "app/api/admin/tasks/[id]/calls/route.ts" app/api/admin/tasks/from-template/route.ts
git commit -m "fix(tasks): one access rule across every task child route"
```

### Task 2.7: Promote a task into a request

- [ ] **Step 1: Create `app/api/admin/tasks/[id]/promote/route.ts`**

```ts
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, sql } from 'drizzle-orm'
import { guardTask } from '@/lib/task-access'
import { emitRequestCreated } from '@/lib/request-status-effects'

/**
 * POST /api/admin/tasks/[id]/promote
 *
 * Turn a task into client-facing work. The new request carries the task's
 * title, note, priority, assignee and due date; the task keeps living where
 * it is, now linked, so the studio's own follow-ups stay off the client's
 * thread.
 *
 * Category and size come from the caller rather than being guessed. The
 * prototype hardcoded design / small, which would have been wrong for most
 * of the work that actually gets promoted.
 *
 * The insert mirrors POST /api/admin/requests exactly, and for the same
 * reasons: the request number is assigned atomically inside the INSERT
 * (scoped per org, so each client sees a private 1, 2, 3 and never learns the
 * studio's total volume), both `type` and `size` are written because `type` is
 * the legacy column the row still carries and `size` is the one the list and
 * the board filter on, and emitRequestCreated fires so automations and
 * outgoing webhooks see a promoted request the same as any other. A raw
 * drizzle .insert() here would silently skip all four.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => ({})) as { category?: string; size?: string }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const denied = await guardTask(drizzle, userId, id)
  if (denied) return denied

  const [task] = await drizzle.select().from(schema.tasks).where(eq(schema.tasks.id, id)).limit(1)
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  if (!task.orgId) {
    return NextResponse.json({ error: 'A task with no client cannot become a request' }, { status: 400 })
  }
  if (task.requestId) {
    return NextResponse.json({ error: 'This task is already linked to a request' }, { status: 409 })
  }

  const category = body.category ?? 'design'
  // `size` is the modern column ('small' | 'large'); `type` is the legacy one
  // the row still carries ('small_task' | 'large_task'). Both get written.
  const size = body.size === 'large_task' || body.size === 'large' ? 'large' : 'small'
  const legacyType = size === 'large' ? 'large_task' : 'small_task'
  // A request's priority vocabulary is standard | high. A task may be urgent,
  // which has no request peer, so it lands as high rather than writing a value
  // the requests surface cannot render or PATCH.
  const priority = task.priority === 'standard' ? 'standard' : 'high'

  const requestId = crypto.randomUUID()
  const now = new Date().toISOString()

  await drizzle.run(sql`
    INSERT INTO requests (
      id, org_id, title, type, size, category, description, status, priority,
      assignee_id, due_date, submitted_by_id, submitted_by_type, is_internal,
      revision_count, max_revisions, request_number, created_at, updated_at
    ) VALUES (
      ${requestId},
      ${task.orgId},
      ${task.title},
      ${legacyType},
      ${size},
      ${category},
      ${task.description ?? null},
      'submitted',
      ${priority},
      ${task.assigneeId ?? null},
      ${task.dueDate ?? null},
      ${userId ?? null},
      'team_member',
      0,
      0,
      3,
      COALESCE((SELECT MAX(request_number) FROM requests WHERE org_id = ${task.orgId}), 0) + 1,
      ${now},
      ${now}
    )
  `)

  // The task becomes Client level: it now has a client-facing peer, which is
  // exactly what that level means.
  await drizzle
    .update(schema.tasks)
    .set({ requestId, type: 'client_task', updatedAt: now })
    .where(eq(schema.tasks.id, id))

  await emitRequestCreated(drizzle, {
    id: requestId,
    orgId: task.orgId,
    title: task.title,
    type: legacyType,
    category,
    priority,
    status: 'submitted',
    isInternal: false,
    source: 'admin',
  })

  return NextResponse.json({ requestId }, { status: 201 })
}
```

Two things to confirm against `app/api/admin/requests/route.ts` (lines 218 to 262) before running: the exact `emitRequestCreated` argument shape, and that `submitted_by_type` still defaults the way this insert assumes. `task.description` is already stored as plain text by this surface, so it does not need `sanitizeRichText`; if that changes, add it.

The response key is `requestId`. `TaskDetailPanel.onPromote` and the `promote_task_to_request` MCP tool both read it, so do not rename it to `id`.

- [ ] **Step 2: Verify**

Run: `npm run type-check && npm run build`
Expected: type-check exit 0, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add "app/api/admin/tasks/[id]/promote/route.ts"
git commit -m "feat(tasks): promote a task into a client-facing request"
```

### Task 2.8: The AI wizard stops stringifying structure into the description

- [ ] **Step 1: Return the estimate as a field**

In `app/api/admin/ai/task-wizard/route.ts`, add `estimatedHours?: number` to the `TaskDraft` type the route parses out of the model's `<tasks>` block and out of `handleDeterministic()`, and remove the `console.error` in the main handler's catch (the fallback already covers the failure; the log violates CLAUDE.md rule 5).

- [ ] **Step 2: Send it as a field from the wizard**

In `components/tahi/ai-task-wizard.tsx`, replace the block at lines 224 to 227 that appends category and estimate text to the description with:

```ts
      // Estimate is a column now, so it stops being prose. Category has no
      // column on a task and stays in the note, which is where the studio
      // reads it anyway.
      body: JSON.stringify({
        title: draft.title,
        description: draft.category ? `${draft.description}\n\nCategory: ${draft.category}` : draft.description,
        type: context?.orgId ? 'internal_client_task' : 'tahi_internal',
        priority: draft.priority === 'urgent' ? 'urgent' : draft.priority === 'high' ? 'high' : 'standard',
        estimatedHours: draft.estimatedHours ?? null,
        orgId: context?.orgId ?? null,
        requestId: context?.requestId ?? null,
      }),
```

- [ ] **Step 3: Let the caller revalidate**

Add an optional `mutateKeys?: string[]` prop to `AiTaskWizard`. After the create loop finishes, call `mutate(key)` for each with the SWR `useSWRConfig` mutator, then `onTasksCreated?.()`. This is what fixes the request detail's Tasks panel not refreshing.

- [ ] **Step 4: Verify**

Run: `npm run type-check && npm run lint && npx vitest run components/tahi/__tests__/ai-request-wizard.test.ts`
Expected: type-check exit 0, lint clean, the neighbouring wizard test still passes.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/ai/task-wizard/route.ts components/tahi/ai-task-wizard.tsx
git commit -m "fix(tasks): AI wizard writes the estimate as a field and revalidates its caller"
```

### Task 2.9: MCP parity

- [ ] **Step 1: Fix the three existing tool definitions**

In `workers/mcp-server/src/index.ts`, in the block starting at line 405:

- `list_tasks`: add `assignee: prop('string', "Filter by assignee: a team member id, or 'me' for the caller")`, `requestId: prop('string', 'Filter to the tasks linked to one request')` and `sortBy: prop('string', "Sort: 'position' for track order, otherwise most recently updated first")`.
- `create_task`: correct the priority line to `prop('string', 'Priority: standard, high or urgent. Default standard.')`; correct the type line to `prop('string', 'Level: client_task (client-facing), internal_client_task (about a client, studio only) or tahi_internal (no client). Auto-derived from orgId when omitted.')`; add `estimatedHours: prop('number', 'Estimate in hours')`, `requestId: prop('string', 'Request this task delivers against')`, `status: prop('string', 'Initial status: todo, in_progress, blocked or done. Default todo.')` and `subtasks: { type: 'array', items: { type: 'string' }, description: 'Subtask titles to create alongside the task' }`.
- `update_task`: correct the priority line to `prop('string', 'New priority: standard, high or urgent')`; add `title`, `orgId`, `requestId`, `estimatedHours`, `type`.

- [ ] **Step 2: Add the ten missing tools**

Insert after the `create_task_from_template` definition:

```ts
  tool('delete_task', 'Delete a task. Its subtasks and dependency links go with it.', {
    taskId: prop('string', 'Task ID'),
  }, ['taskId']),
  tool('bulk_update_tasks', 'Update many tasks at once. Only the fields you pass change.', {
    taskIds: { type: 'array', items: { type: 'string' }, description: 'Task IDs to update' },
    status: prop('string', 'New status: todo, in_progress, blocked or done'),
    priority: prop('string', 'New priority: standard, high or urgent'),
    assigneeId: prop('string', 'Team member ID, or an empty string to unassign'),
    dueDate: prop('string', 'Due date YYYY-MM-DD, or an empty string to clear it'),
  }, ['taskIds']),
  tool('list_task_dependencies', 'List what a task is blocked by and what it blocks', {
    taskId: prop('string', 'Task ID'),
  }, ['taskId']),
  tool('delete_task_subtask', 'Delete a subtask', {
    taskId: prop('string', 'Parent task ID'),
    subId: prop('string', 'Subtask ID'),
  }, ['taskId', 'subId']),
  tool('create_task_template', 'Create a task template', {
    name: prop('string', 'Template name. Becomes the task title.'),
    type: prop('string', 'Level: client_task, internal_client_task or tahi_internal'),
    category: prop('string', 'Free-text category'),
    description: prop('string', 'Template description'),
    defaultPriority: prop('string', 'none, low, medium, standard, high or urgent. Mapped down to the task scale on use.'),
    subtasks: { type: 'array', items: { type: 'string' }, description: 'Subtask titles' },
    estimatedHours: prop('number', 'Estimate in hours'),
    orgId: prop('string', 'Client organisation ID for a per-client override. Omit for a global template.'),
    defaultAssignee: prop('string', 'Free-text default assignee label'),
  }, ['name', 'type']),
  tool('update_task_template', 'Update a task template', {
    templateId: prop('string', 'Template ID'),
    name: prop('string', 'Template name'),
    type: prop('string', 'Level'),
    category: prop('string', 'Category'),
    description: prop('string', 'Description'),
    defaultPriority: prop('string', 'Default priority'),
    subtasks: { type: 'array', items: { type: 'string' }, description: 'Subtask titles' },
    estimatedHours: prop('number', 'Estimate in hours'),
    defaultAssignee: prop('string', 'Default assignee label'),
  }, ['templateId']),
  tool('delete_task_template', 'Delete a task template', {
    templateId: prop('string', 'Template ID'),
  }, ['templateId']),
  tool('promote_task_to_request', 'Turn a task into a client-facing request. The task stays, linked to it.', {
    taskId: prop('string', 'Task ID. Must have a client and no request yet.'),
    category: prop('string', 'Request category, e.g. design or development. Default design.'),
    size: prop('string', 'small_task (a day or less) or large_task. Default small_task.'),
  }, ['taskId']),
  tool('list_task_calls', 'List the calls attached to a task', {
    taskId: prop('string', 'Task ID'),
  }, ['taskId']),
  tool('create_task_call', 'Schedule a call against a task', {
    taskId: prop('string', 'Task ID'),
    title: prop('string', 'Call title'),
    scheduledAt: prop('string', 'ISO timestamp'),
    durationMinutes: prop('number', 'Duration in minutes'),
    googleMeetUrl: prop('string', 'Meeting URL'),
  }, ['taskId', 'title', 'scheduledAt']),
```

- [ ] **Step 3: Add the dispatch cases**

In the `switch` in the Tasks block (line 1654 onward):

```ts
    case 'list_tasks': {
      const p: Record<string, string> = {}
      if (s('status')) p.status = s('status')!
      if (s('type')) p.type = s('type')!
      if (s('orgId')) p.orgId = s('orgId')!
      if (s('assignee')) p.assignee = s('assignee')!
      if (s('requestId')) p.requestId = s('requestId')!
      if (s('sortBy')) p.sortBy = s('sortBy')!
      return json(await apiGet('/api/admin/tasks', token, p))
    }
    case 'delete_task':
      return json(await apiWrite(`/api/admin/tasks/${s('taskId')}`, token, 'DELETE'))
    case 'bulk_update_tasks': {
      const { taskIds, ...rest } = args
      return json(await apiWrite('/api/admin/tasks/bulk', token, 'PATCH', {
        taskIds,
        updates: rest,
      }))
    }
    case 'list_task_dependencies':
      return json(await apiGet(`/api/admin/tasks/${s('taskId')}/dependencies`, token))
    case 'delete_task_subtask':
      return json(await apiWrite(`/api/admin/tasks/${s('taskId')}/subtasks/${s('subId')}`, token, 'DELETE'))
    case 'create_task_template':
      return json(await apiWrite('/api/admin/task-templates', token, 'POST', args as Record<string, unknown>))
    case 'update_task_template': {
      const { templateId, ...body } = args
      return json(await apiWrite(`/api/admin/task-templates/${templateId}`, token, 'PATCH', body))
    }
    case 'delete_task_template':
      return json(await apiWrite(`/api/admin/task-templates/${s('templateId')}`, token, 'DELETE'))
    case 'promote_task_to_request': {
      const { taskId, ...body } = args
      return json(await apiWrite(`/api/admin/tasks/${taskId}/promote`, token, 'POST', body))
    }
    case 'list_task_calls':
      return json(await apiGet(`/api/admin/tasks/${s('taskId')}/calls`, token))
    case 'create_task_call': {
      const { taskId, ...body } = args
      return json(await apiWrite(`/api/admin/tasks/${taskId}/calls`, token, 'POST', body))
    }
```

Also add `orgId` passthrough on `list_task_templates`:

```ts
    case 'list_task_templates': {
      const p: Record<string, string> = {}
      if (s('orgId')) p.orgId = s('orgId')!
      if (s('type')) p.type = s('type')!
      return json(await apiGet('/api/admin/task-templates', token, p))
    }
```

and the matching props on its definition.

- [ ] **Step 4: Verify**

Run: `npm run type-check`
Expected: exit 0. (The root Vitest config excludes `workers/**`, so there is no test run for this file; the type-check is the gate.)

Then confirm the tool count grew by ten:

Run: `grep -c "^  tool(" workers/mcp-server/src/index.ts`
Expected: the previous count plus 10.

- [ ] **Step 5: Commit**

```bash
git add workers/mcp-server/src/index.ts
git commit -m "feat(tasks): worker MCP parity for delete, bulk, dependencies, templates, promote and calls"
```

### Task 2.10: Close Slice 2

- [ ] **Step 1: Full check**

Run: `npm run type-check && npm run lint && npx vitest run && npm run build`
Expected: all clean.

- [ ] **Step 2: Hand to the lead** with the `run_migration 0087` result quoted in the summary.

---

## Slice 3: List view leaf (Wave B, parallel with 2, 4, 5)

A pure presentation component. It fetches nothing and owns no preference. Every mutation goes out through a callback, so Slice 6 can make it optimistic in one place.

**Files:**
- Create: `components/tahi/tasks/task-quick-add.tsx`, `components/tahi/tasks/tasks-list.tsx`
- Modify: `app/globals.css` (one `@container` block, added in Task 3.2 Step 2). No other slice touches this file, so ownership stays disjoint.

### Task 3.1: `components/tahi/tasks/task-quick-add.tsx`

- [ ] **Step 1: Write the component to this exact interface**

```tsx
'use client'

/**
 * <TaskQuickAdd>. One line at the top of the list: type a task, press Enter.
 *
 * The four chips under the input are the whole point. They show what the
 * parser heard as you type, so nobody has to learn the grammar from a help
 * page: you write "chase the invoice @Kowtow friday !high" and watch Client,
 * Due, Priority and Level light up. Parsing is lib/tasks-quick-add.ts, which
 * is where the rules are tested; this file only renders what it returns.
 */

import * as React from 'react'
import { Calendar, CornerDownLeft, Plus, Users, Zap } from 'lucide-react'
import { parseQuickAdd, type QuickAddClient, type QuickAddParse } from '@/lib/tasks-quick-add'
import { LEVEL_ICON } from '@/components/tahi/tasks/task-chips'
import { TASK_LEVEL_LABELS } from '@/lib/tasks-views'
import { formatDueDateLabel } from '@/components/tahi/due-date-chip'
import { taskPriorityLabel } from '@/lib/task-priorities'

export interface TaskQuickAddProps {
  clients: readonly QuickAddClient[]
  /** Resolves when the write lands. Rejecting leaves the text in the box so
   *  the user can retry rather than retyping. */
  onAdd: (parsed: QuickAddParse) => Promise<void>
  disabled?: boolean
  /** Injected in tests; defaults to the wall clock. */
  now?: Date
}

export function TaskQuickAdd({ clients, onAdd, disabled = false, now }: TaskQuickAddProps): React.ReactElement
```

Structure and tokens, from `tasks.css:88-105`:

- Outer: `flex-direction: column`, `margin-top: 1rem`, `1px solid var(--color-border)`, `border-radius: 0.875rem`, `background: var(--color-bg)`, `box-shadow: var(--shadow-sm)`. Uses the repo's `tahi-focus-within` class so the whole box takes the brand ring when anything inside it has focus.
- Row: `min-height: 3rem` (`3.25rem` below `md`), `padding: 0 0.75rem 0 1rem`, `gap: 0.625rem`.
- Leading glyph: a `1.25rem` circle, `1.5px dashed var(--color-border)`, `color: var(--color-text-subtle)`, holding `<Plus size={12} />`. It turns `var(--color-brand)` on focus-within.
- Input: `flex: 1`, borderless, `background: transparent`, `font: 500 0.84375rem`, `outline: none`. Placeholder `Add a task, press Enter`, or `Read-only` when `disabled`.
- Submit button: rendered only when the input has content. `height: 1.875rem` (`2.25rem` below `md`), `padding: 0 0.75rem`, `border-radius: var(--radius-sm)`, brand fill, `var(--color-text-on-dark)`, `font: 600 0.75rem`, label `Add` with a `<CornerDownLeft size={11} />` at `opacity: 0.7`. Disabled at `opacity: 0.45` while the write is in flight or when the parsed title is empty.
- Hints row: `padding: 0 1rem 0.625rem 2.625rem` (`padding-left: 1rem` below `md`), `flex-wrap: wrap`, `gap: 0.375rem`.

Hint behaviour:

- Empty input renders one line at `font: 500 0.71875rem`, `color: var(--color-text-subtle)`: `Try @Kowtow, tomorrow, friday, !high. The client, the date and the priority are read as you type.` Each token is wrapped in a `<code>` at `font: 600 0.6875rem`, `color: var(--color-text-muted)`, `background: var(--color-bg-secondary)`, `1px solid var(--color-border-subtle)`, `border-radius: var(--radius-sm)`, `padding: 0 0.3125rem`. Use the first client name from `clients` in the `@` example when there is one, so the hint names a real client.
- Non-empty input renders four chips: Client, Due, Priority, Level. Each is `height: 1.375rem`, `padding: 0 0.5rem`, `1px solid var(--color-border-subtle)`, `border-radius: var(--radius-sm)`, `background: var(--color-bg-secondary)`, `font: 600 0.6875rem`, with an icon, a `<span>` key in `var(--color-text-subtle)` at weight 500, and a `<b>` value at weight 700. A chip whose value was found takes `border-color: color-mix(in srgb, var(--color-brand) 40%, transparent)`, `background: color-mix(in srgb, var(--color-brand) 8%, var(--color-bg))`, `color: var(--color-brand-dark)`.

| Chip | Icon | Value when unset | Value when found |
|---|---|---|---|
| Client | `Users` size 11 | `None` | the client name |
| Due | `Calendar` size 11 | `No date` | `formatDueDateLabel(parsed.dueDate)` |
| Priority | `Zap` size 11 | `Standard` | `taskPriorityLabel(parsed.priority)` |
| Level | `LEVEL_ICON[parsed.level]` size 11 | always found | `TASK_LEVEL_LABELS[parsed.level]` |

Keyboard: Enter submits, Escape clears the field. Submit is blocked when `parsed.title` is empty. Parsing runs in a `useMemo` on `[value, clients, now]`.

- [ ] **Step 2: Type-check and lint**

Run: `npm run type-check && npm run lint`
Expected: type-check exit 0, lint clean.

- [ ] **Step 3: Commit**

```bash
git add components/tahi/tasks/task-quick-add.tsx
git commit -m "feat(tasks): quick-add bar with live parse chips"
```

### Task 3.2: `components/tahi/tasks/tasks-list.tsx`

- [ ] **Step 1: Write the component to this exact interface**

```tsx
'use client'

/**
 * <TasksList>. The List view: the quick-add bar, the bulk bar when rows are
 * selected, and the table itself.
 *
 * Built on <DataTable> with expandedRowMode="rows", so a row's subtask panel
 * is real <tr>s in the same <tbody> and its columns line up with the parent's
 * for free. Below md the table is replaced by mobileCard, which is the one
 * layout DataTable mounts once it has measured the width.
 *
 * This component fetches nothing and stores nothing. Every mutation leaves
 * through a callback so the shell can make it optimistic in one place.
 */

import * as React from 'react'
import { DataTable, type DataTableColumn, type DataTableExpandedContext, type DataTableSort } from '@/components/tahi/data-table'
import { BulkActionBar, type BulkAction } from '@/components/tahi/bulk-action-bar'
import { StatusChipSelect } from '@/components/tahi/status-chip-select'
import { pruneExpandedIds } from '@/components/tahi/data-table-expand'
import type { TaskRow } from '@/lib/tasks-views'
import type { QuickAddParse } from '@/lib/tasks-quick-add'
// Shared shapes from Slice 1. Do NOT redeclare them here: Slice 5 imports the
// same two and cannot see this file until Wave B merges.
import type { TaskSubtask, TaskPerson } from '@/components/tahi/tasks/task-types'

export interface TasksListProps {
  rows: readonly TaskRow[]
  loading: boolean
  /** Team members by id, for the assignee cell and the bulk Assign menu. */
  people: Readonly<Record<string, TaskPerson>>
  /** Ordered list for the bulk Assign menu. */
  peopleList: readonly TaskPerson[]
  clients: readonly { id: string; name: string }[]
  readOnly: boolean

  /** Subtasks for the rows the user has expanded. The shell fetches them
   *  lazily; an id with no entry yet renders the skeleton. */
  subtasks: Readonly<Record<string, TaskSubtask[] | undefined>>
  onExpandRow: (taskId: string) => void

  onOpenTask: (taskId: string) => void
  onOpenRequest: (requestId: string) => void
  onToggleDone: (taskId: string, done: boolean) => void
  onStatusChange: (taskId: string, status: string) => Promise<void>
  onToggleSubtask: (taskId: string, subtaskId: string, completed: boolean) => void
  onAddSubtask: (taskId: string, title: string) => Promise<void>
  onQuickAdd: (parsed: QuickAddParse) => Promise<void>

  /** Bulk. `run` resolves to the shape BulkActionBar expects. */
  onBulkStatus: (ids: string[], status: string) => Promise<{ ok: number; failed?: number }>
  onBulkPriority: (ids: string[], priority: string) => Promise<{ ok: number; failed?: number }>
  onBulkAssignee: (ids: string[], assigneeId: string | null) => Promise<{ ok: number; failed?: number }>
  onBulkDueDate: (ids: string[], dueDate: string | null) => Promise<{ ok: number; failed?: number }>

  /** Empty states. `hasFilter` picks the "no matches" copy over "nothing on
   *  the list", and `onClearFilters` gives that one a way back. */
  hasFilter: boolean
  onClearFilters: () => void
  onNewTask: () => void
}

export function TasksList(props: TasksListProps): React.ReactElement
```

- [ ] **Step 2: Build the six columns**

Widths come from `tasks.css:50`, folded into the `DataTableColumn.width` values rather than left as an `!important` override (the prototype file's own comment asks for exactly this):

| # | key | header | width | sortable | content |
|---|---|---|---|---|---|
| 1 | `title` | Task | `minmax(0, 2.2fr)` | yes | expand chevron or spacer, `TaskTick`, the title, then a `.tsk-chips` group: `LevelChip`, `RequestChip` when linked, `SubtaskBadge` when there are subtasks |
| 2 | `assignee` | Assignee | `6.5rem` | no | `Avatar size="sm"` plus the first name, or `Unassigned` in `var(--color-text-subtle)` at `font: 500 0.75rem` |
| 3 | `due` | Due | `7rem` | yes | `DueDateChip` with `closedStatuses={TASK_CLOSED_STATUSES}`, or `Done {date}` when complete, or `No date` |
| 4 | `priority` | Priority | `4.5rem` | yes | `Badge tone={priorityTone(row.priority)} variant="soft" size="sm"`; `standard` renders as a muted `Standard` rather than the prototype's bare dashes, because a dash reads as missing data |
| 5 | `status` | Status | `6.5rem` | no | `StatusChipSelect` fed `TASK_STATUSES` (already `{ value, label, tone }` shaped and assignable straight in), `density="compact"`, `disabled={readOnly}`, `onChange` returning the `onStatusChange` promise so the chip spins while the write lands |

The checkbox column is `DataTable`'s own (`selectable`), not one of these.

**Column sort is uncontrolled.** Do not pass `sort` or `onSortChange`: `DataTable` sorts internally when they are omitted (`data-table.tsx:182-184`) and cycles a header asc, desc, off on its own. That is what keeps the prototype's two independent sorts, the rail's persisted one and the header's ephemeral one, both alive: the rows arrive already rail-sorted, and a header click re-sorts that array until it is switched off. The one thing that is lost while a header sort is active is the done-last rank, which lives only in `compareTasks` in `lib/tasks-views.ts`. That is the prototype's behaviour too and is not a bug to fix here. Give each sortable column a `sortValue` so the header sorts on the value rather than the rendered node: `title` on `row.title.toLowerCase()`, `due` on `row.dueDate ?? '9999-12-31'`, `priority` on the same rank `compareTasks` uses.

Row treatment:

- `onRowClick` calls `onOpenTask(row.id)`. `expandedRowMode="rows"` keeps the row click firing rather than toggling expansion (`data-table.tsx:226`), so the chevron is the only thing that expands. The tick, the status chip, the request chip and the expand chevron all `stopPropagation`.
- The title node carries `data-task-row-title` in **both** the table cell and the mobile card. `e2e/tasks.spec.ts` in Slice 7 finds a row through it, and a class name would be a worse contract.
- A done row renders its title in `var(--color-text-subtle)` with `text-decoration: line-through`, and drops the level and request chips to `opacity: 0.7`.
- The title cell is a CSS container: `container-type: inline-size; container-name: tsk-task`. Inside it, add a plain CSS block (a `<style jsx global>` is not the repo pattern; put the rule in `app/globals.css` under the existing unlayered-CSS discipline, inside `@layer components`):

```css
@container tsk-task (max-width: 21rem) {
  .tsk-chip-thin-icon { display: none; }
}
```

`RequestChip` and `SubtaskBadge` give their icons that class. The level chip never thins, because it carries the client avatar. **The title never gives up width; the chips give way first.** Do not substitute a media query: Tailwind v4 supports `@container` and the behaviour depends on the cell's width, not the viewport's.

- [ ] **Step 3: Build the expanded subtask rows**

```tsx
  expandable={(row) => (row.subtaskCount ?? 0) > 0 || !readOnly}
  expandedRowMode="rows"
  renderExpanded={(row, table) => renderSubtaskRows(row, table)}
```

`renderSubtaskRows` returns a fragment of `<tr>`s, each with `table.leadingCells` empty cells first, then one cell with `colSpan={table.colSpan}`:

- One row per subtask: a `TaskTick size="sm"`, the title (line-through and `var(--color-text-subtle)` when done), and a `2.75rem`/`1.625rem` remove button that turns `var(--color-danger)` on hover. Row height `2.5rem` (`2.75rem` below `md`), `padding-left: 5.25rem` so the subtask ticks line up under the row tick (`1rem` below `md`).
- Background `var(--color-bg-secondary)`, hairline `1px solid var(--color-border-subtle)` on all sides, `margin-top: -1px` so it overlaps the parent's bottom hairline.
- An `Add subtask` row at the foot when `!readOnly`, which swaps to an autofocused input with placeholder `Name the subtask, press Enter`. Enter commits through `onAddSubtask`, Escape and blur cancel.
- No subtasks and not adding renders `No subtasks yet.` in italic `var(--color-text-subtle)` at the same indent.
- Call `onExpandRow(row.id)` the first time a row expands so the shell can fetch. While `subtasks[row.id]` is `undefined`, render two `animate-pulse` skeleton rows.
- The whole panel is suppressed when `readOnly`.

Prune expanded ids whenever the visible set changes, using the primitive that already exists:

```tsx
  React.useEffect(() => {
    setExpanded(prev => pruneExpandedIds(prev, rows.map(r => r.id)))
  }, [rows])
```

`pruneExpandedIds` returns the same `Set` when nothing changed, which is what makes this effect safe.

- [ ] **Step 4: Build the bulk bar**

Use the shared `components/tahi/bulk-action-bar.tsx` with `itemNoun="task"`. One visible primary action, everything else in the single menu with `Menu.Label` sections. Do not regress to the legacy page's row of three dropdowns.

```tsx
  <BulkActionBar
    selectedCount={selectedIds.size}
    itemNoun="task"
    primaryAction={{
      id: 'complete',
      label: 'Complete',
      run: () => props.onBulkStatus([...selectedIds], 'done'),
      // `successMessage` is a plain string, not a formatter. The counted
      // message comes from `verb` plus itemNoun: "3 tasks marked done".
      verb: 'marked done',
    }}
    actions={[
      { id: 'status-todo',        section: 'Move to',      label: 'To Do',        run: () => props.onBulkStatus(ids, 'todo') },
      { id: 'status-in_progress', section: 'Move to',      label: 'In Progress',  run: () => props.onBulkStatus(ids, 'in_progress') },
      { id: 'status-blocked',     section: 'Move to',      label: 'Blocked',      run: () => props.onBulkStatus(ids, 'blocked') },
      { id: 'priority-urgent',    section: 'Priority',     label: 'Urgent',       run: () => props.onBulkPriority(ids, 'urgent') },
      { id: 'priority-high',      section: 'Priority',     label: 'High',         run: () => props.onBulkPriority(ids, 'high') },
      { id: 'priority-standard',  section: 'Priority',     label: 'Standard',     run: () => props.onBulkPriority(ids, 'standard') },
      { id: 'due-today',          section: 'Due',          label: 'Today',        run: () => props.onBulkDueDate(ids, todayKey) },
      { id: 'due-tomorrow',       section: 'Due',          label: 'Tomorrow',     run: () => props.onBulkDueDate(ids, tomorrowKey) },
      { id: 'due-next-week',      section: 'Due',          label: 'Next week',    run: () => props.onBulkDueDate(ids, nextWeekKey) },
      { id: 'due-clear',          section: 'Due',          label: 'Clear date',   run: () => props.onBulkDueDate(ids, null) },
      ...peopleList.map(p => ({ id: `assign-${p.id}`, section: 'Assign to', label: p.name, run: () => props.onBulkAssignee(ids, p.id) })),
      { id: 'assign-none',        section: 'Assign to',    label: 'Unassign',     run: () => props.onBulkAssignee(ids, null) },
    ]}
    onClear={() => setSelectedIds(new Set())}
  />
```

The bar renders only when `!readOnly && selectedIds.size > 0`. **Gate it on `readOnly`.** The prototype left the bulk bar live in read-only mode, which is the one write path it forgot; do not carry that bug across. Margin: `margin-top: 1rem`, `margin-bottom: 0`, between the quick-add and the table.

- [ ] **Step 5: Build the mobile card**

```tsx
  mobileCard={(row) => <TaskMobileCard row={row} ... />}
```

`display: flex`, `gap: 0.75rem`, `padding: 0.8125rem 0.875rem`, bottom hairline except on the last card. Left column is a `2.75rem` tick hit box with `padding-top: 0.875rem`. Body is a column at `gap: 0.5rem`: the title at `font: 600 0.90625rem/1.35` with `text-wrap: pretty` and **no line clamp**, then a wrapped meta row holding `LevelChip` (full, with the client avatar), `RequestChip` when linked, a `TaskStatusBadge` **only when blocked**, `DueDateChip` when dated and open, the priority badge, `SubtaskBadge`, and the assignee `Avatar` pushed right with `margin-left: auto`.

The whole card opens the detail; the tick stops propagation.

- [ ] **Step 6: Build the empty states**

`DataTable`'s `empty` prop takes one node, so branch on `hasFilter` inside it. Both use a 3.25rem square icon tile at `border-radius: var(--radius-leaf-sm)` on `var(--color-bg-secondary)` with the brand-coloured `Leaf` glyph from lucide.

| Case | Title | Body | CTA |
|---|---|---|---|
| `hasFilter` | `No tasks match` | `Try clearing a filter or the search.` | `Clear filters`, calls `onClearFilters` |
| otherwise | `Nothing on the list` | `Add the first one above, or turn a request into work.` | `New task`, calls `onNewTask`, hidden when `readOnly` |

- [ ] **Step 7: Type-check and lint**

Run: `npm run type-check && npm run lint`
Expected: type-check exit 0, lint clean.

- [ ] **Step 8: Commit**

```bash
git add components/tahi/tasks/tasks-list.tsx app/globals.css
git commit -m "feat(tasks): list view with expandable subtask rows, mobile cards and the shared bulk bar"
```

---

## Slice 4: Board view leaf (Wave B, parallel with 2, 3, 5)

**Files:**
- Create: `lib/tasks-board-items.ts`, `lib/tasks-board-items.test.ts`, `components/tahi/tasks/tasks-board.tsx`

### Task 4.1: `lib/tasks-board-items.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/tasks-board-items.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { TASK_BOARD_COLUMNS, toTaskBoardItems, toBoardPriority } from './tasks-board-items'
import type { TaskRow } from './tasks-views'

const NOW = new Date(2026, 8, 5)

function row(over: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 't1', title: 'A task', type: 'tahi_internal', status: 'todo', priority: 'standard',
    orgId: null, orgName: null, requestId: null, assigneeId: null, dueDate: null,
    completedAt: null, description: null, estimatedHours: null,
    createdAt: null, updatedAt: null, subtaskCount: 0, subtaskDone: 0, blockedByCount: 0,
    ...over,
  }
}

describe('TASK_BOARD_COLUMNS', () => {
  it('is the four task statuses in vocabulary order', () => {
    expect(TASK_BOARD_COLUMNS.map(c => c.statusValue)).toEqual([
      'todo', 'in_progress', 'blocked', 'done',
    ])
    expect(TASK_BOARD_COLUMNS.map(c => c.label)).toEqual([
      'To Do', 'In Progress', 'Blocked', 'Done',
    ])
  })
})

describe('toBoardPriority', () => {
  it('bridges the task scale onto the board scale', () => {
    expect(toBoardPriority('urgent')).toBe('urgent')
    expect(toBoardPriority('high')).toBe('high')
    expect(toBoardPriority('standard')).toBe('medium')
    expect(toBoardPriority('anything-else')).toBe('medium')
  })
})

describe('toTaskBoardItems', () => {
  const ctx = { people: { tm1: { id: 'tm1', name: 'Maya' } }, now: NOW }

  it('carries the status, title and client through', () => {
    const [item] = toTaskBoardItems([row({ orgId: 'o1', orgName: 'Kowtow' })], ctx)
    expect(item.id).toBe('t1')
    expect(item.status).toBe('todo')
    expect(item.title).toBe('A task')
    // BoardItem.client is a BoardAssignee, not a string: the card draws an
    // avatar from it.
    expect(item.client).toEqual({ id: 'o1', name: 'Kowtow' })
  })

  it('omits the client avatar on a task with no client', () => {
    const [item] = toTaskBoardItems([row()], ctx)
    expect(item.client).toBeUndefined()
  })

  it('rolls subtasks up into the progress bar', () => {
    const [item] = toTaskBoardItems([row({ subtaskCount: 4, subtaskDone: 1 })], ctx)
    expect(item.subtasks).toEqual({ done: 1, total: 4 })
  })

  it('omits the subtask rollup when there are none', () => {
    const [item] = toTaskBoardItems([row()], ctx)
    expect(item.subtasks).toBeUndefined()
  })

  it('hides the due chip on a done card but keeps the date', () => {
    const [item] = toTaskBoardItems([row({ status: 'done', dueDate: '2026-09-01' })], ctx)
    expect(item.dueDate).toBe('2026-09-01')
    expect(item.hideDueChip).toBe(true)
    expect(item.isOverdue).toBe(false)
  })

  it('marks an open past-due card overdue', () => {
    const [item] = toTaskBoardItems([row({ dueDate: '2026-09-01' })], ctx)
    expect(item.isOverdue).toBe(true)
  })

  it('warns when the card is blocked by something', () => {
    const [item] = toTaskBoardItems([row({ blockedByCount: 2 })], ctx)
    expect(item.warning).toBe('Blocked by 2 tasks')
  })

  it('names the assignee', () => {
    const [item] = toTaskBoardItems([row({ assigneeId: 'tm1' })], ctx)
    expect(item.people?.[0]).toMatchObject({ name: 'Maya', role: 'Assignee' })
    expect(item.unassigned).toBeUndefined()
  })

  it('flags an unassigned card so the card draws the placeholder', () => {
    const [item] = toTaskBoardItems([row()], ctx)
    expect(item.people).toBeUndefined()
    expect(item.unassigned).toBe(true)
  })

  it('drops the reference when there is no request number to print', () => {
    const [item] = toTaskBoardItems([row({ requestId: 'req-uuid' })], ctx)
    expect(item.reference).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run lib/tasks-board-items.test.ts`
Expected: FAIL with `Failed to resolve import "./tasks-board-items"`.

- [ ] **Step 3: Write `lib/tasks-board-items.ts`**

```ts
/**
 * lib/tasks-board-items.ts
 *
 * TaskRow -> BoardItem. Pure, so the mapping is testable without mounting a
 * board, and so the one genuinely awkward part of it is written down once:
 * KanbanBoard's priority scale is low / medium / high / urgent and a task's
 * is standard / high / urgent. `standard` reads as `medium` on a card, which
 * is the tone the studio already expects there.
 */

import type { BoardColumn, BoardItem, BoardPriority } from '@/components/tahi/kanban-board'
import { TASK_STATUSES, TASK_STATUS_CONFIG } from '@/lib/status-config'
import { taskDayKey, type TaskRow } from '@/lib/tasks-views'

/** The four columns, straight off the status vocabulary so they cannot
 *  drift from the chip, the filter or the bulk menu. */
export const TASK_BOARD_COLUMNS: readonly BoardColumn[] = TASK_STATUSES.map(s => ({
  id: s.value,
  label: s.label,
  statusValue: s.value,
  color: TASK_STATUS_CONFIG[s.value]?.dot,
}))

/** The board's scale has a `medium` a task does not, and no `standard`. */
export function toBoardPriority(priority: string): BoardPriority {
  if (priority === 'urgent') return 'urgent'
  if (priority === 'high') return 'high'
  return 'medium'
}

export interface TaskBoardContext {
  people: Readonly<Record<string, { id: string; name: string; avatarUrl?: string | null }>>
  /** requestId -> display number, for the card's top-right reference. Omit
   *  it and a linked card simply carries no reference, which is better than
   *  printing a uuid there. */
  requestNumbers?: Readonly<Record<string, number | null | undefined>>
  now: Date
}

export function toTaskBoardItems(
  rows: readonly TaskRow[],
  ctx: TaskBoardContext,
): BoardItem[] {
  const today = taskDayKey(ctx.now)

  return rows.map(row => {
    const done = row.status === 'done'
    const dueDate = row.dueDate ? row.dueDate.slice(0, 10) : undefined
    const assignee = row.assigneeId ? ctx.people[row.assigneeId] : undefined
    const requestNumber = row.requestId ? ctx.requestNumbers?.[row.requestId] ?? null : null
    const total = row.subtaskCount ?? 0
    const blockers = row.blockedByCount ?? 0

    return {
      id: row.id,
      status: row.status,
      title: row.title,
      priority: toBoardPriority(row.priority),
      // BoardAssignee, not a string: the card draws an avatar from it.
      client: row.orgName ? { id: row.orgId ?? row.orgName, name: row.orgName } : undefined,
      reference: requestNumber == null ? undefined : `TR-${requestNumber}`,
      dueDate,
      // Finished work needs no deadline on the card, but the date is still
      // wanted for the tooltip, so it is hidden rather than dropped.
      hideDueChip: done || undefined,
      isOverdue: !done && !!dueDate && dueDate < today,
      warning: blockers > 0
        ? `Blocked by ${blockers} ${blockers === 1 ? 'task' : 'tasks'}`
        : undefined,
      subtasks: total > 0 ? { done: row.subtaskDone ?? 0, total } : undefined,
      // BoardPerson.role is a free-form human label the tooltip prints, so
      // it is capitalised here rather than being a slug.
      people: assignee
        ? [{ id: assignee.id, name: assignee.name, role: 'Assignee', avatarUrl: assignee.avatarUrl ?? undefined }]
        : undefined,
      // No assignee means the card shows the dashed "Unassigned" placeholder
      // rather than an empty people row.
      unassigned: assignee ? undefined : true,
    }
  })
}
```

`BoardItem`, `BoardColumn`, `BoardAssignee`, `BoardPerson` and `BoardPriority` are all exported from `components/tahi/kanban-board.tsx` (types at lines 50 to 176). Three field shapes matter and are easy to get wrong: `client` is a `BoardAssignee` object, `people[].role` is a free-text `string` label (not a union), and `reference` is a short display string pinned top-right, so passing a raw `requestId` uuid there would print a uuid on the card. Prefer the request number when the shell has it, and drop `reference` entirely when it does not.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/tasks-board-items.test.ts`
Expected: PASS, `Tests  12 passed (12)`.

- [ ] **Step 5: Commit**

```bash
git add lib/tasks-board-items.ts lib/tasks-board-items.test.ts
git commit -m "feat(tasks): board item mapping with the priority scale bridge"
```

### Task 4.2: `components/tahi/tasks/tasks-board.tsx`

- [ ] **Step 1: Write the component to this exact interface**

```tsx
'use client'

/**
 * <TasksBoard>. The Board view: four columns from the task status
 * vocabulary, drag to move, an inline composer at the foot of every column
 * that still takes work.
 *
 * A thin arrangement of <KanbanBoard>, which already owns the horizontal
 * scroll, the proxy scrollbar, the settle animation and the 44px mobile
 * targets. Nothing about the board is re-implemented here; this file decides
 * which columns exist, what a card carries, and what a drop means.
 */

import * as React from 'react'
import { KanbanBoard } from '@/components/tahi/kanban-board'
import { TASK_BOARD_COLUMNS, toTaskBoardItems } from '@/lib/tasks-board-items'
import type { TaskRow } from '@/lib/tasks-views'

export interface TasksBoardProps {
  rows: readonly TaskRow[]
  people: Readonly<Record<string, { id: string; name: string; avatarUrl?: string | null }>>
  /** requestId -> display number, for a linked card's reference chip. */
  requestNumbers?: Readonly<Record<string, number | null | undefined>>
  readOnly: boolean
  /** Drag between columns. Resolve to commit, reject to snap back. */
  onMove: (taskId: string, toStatus: string) => Promise<void>
  /** The column composer. `status` is the column it was typed in, so the task
   *  is created there rather than always at todo. Reject to keep the composer
   *  open with the title still in the box. */
  onQuickAdd: (status: string, title: string) => Promise<void>
  onOpenTask: (taskId: string) => void
  /** Injected in tests; defaults to the wall clock. */
  now?: Date
}

export function TasksBoard({ rows, people, requestNumbers, readOnly, onMove, onQuickAdd, onOpenTask, now }: TasksBoardProps): React.ReactElement {
  const items = React.useMemo(
    () => toTaskBoardItems(rows, { people, requestNumbers, now: now ?? new Date() }),
    [rows, people, requestNumbers, now],
  )

  return (
    <KanbanBoard
      boardId="tasks-board"
      columns={TASK_BOARD_COLUMNS}
      items={items}
      readOnly={readOnly}
      iconOnlyPriority
      onMove={readOnly ? undefined : (itemId, toStatus) => { void onMove(itemId, toStatus) }}
      onQuickAdd={readOnly ? undefined : onQuickAdd}
      // Done takes no new work: a plus there would name a column the create
      // path does not honour.
      canAddTo={(status) => status !== 'done'}
      quickAddHint="Enter to add"
      onItemClick={(item) => onOpenTask(item.id)}
    />
  )
}
```

Two things to check against `components/tahi/kanban-board.tsx` before writing, because the plan cannot assert them from outside the file:

1. `onMove`'s third `position` argument. Tasks have no persisted board ordering (`tasks.position` is a track queue field and is not wired to anything), so the position is ignored and only the status is written. Say that in a comment.
2. `subtaskUrl`. Do **not** pass it. The board's lazy sub-row expansion is for nested cards; task subtasks show as the rollup bar, which `BoardItem.subtasks` already gives us. Adding both would put the same information on the card twice.

The e2e spec targets columns via `[data-board-column][data-column-status="..."]`, which `KanbanBoard` emits at line 590. Keep that contract: do not wrap the board in anything that changes the DOM around it.

- [ ] **Step 2: Type-check and lint**

Run: `npm run type-check && npm run lint`
Expected: type-check exit 0, lint clean.

- [ ] **Step 3: Commit**

```bash
git add components/tahi/tasks/tasks-board.tsx
git commit -m "feat(tasks): board view over the shared kanban primitive"
```

---

## Slice 5: Detail slide-over, create dialog and My week (Wave B, parallel with 2, 3, 4)

**Files:**
- Create: `components/tahi/tasks/task-detail-panel.tsx`, `components/tahi/tasks/new-task-dialog.tsx`, `components/tahi/tasks/tasks-week.tsx`

### Task 5.1: `components/tahi/tasks/task-detail-panel.tsx`

- [ ] **Step 1: Write the component to this exact interface**

```tsx
'use client'

/**
 * <TaskDetailPanel>. The task detail, as a right-hand <SlideOver> opened from
 * whichever view you were in. There is no separate detail page: /tasks/[id]
 * redirects here, so a notification link and a row click land in the same
 * place.
 *
 * Everything edits in place. There is no save button, because there is
 * nothing here worth staging: every field is one write, and the list
 * underneath updates as you go.
 *
 * The panel stays mounted when you follow a blocker: only `taskId` changes,
 * so the whole body remounts on its key and no stale editor state survives
 * the swap.
 */

import * as React from 'react'
import { SlideOver } from '@/components/tahi/slide-over'
import { SidebarCard, RAIL_ACTION_CLASS, RAIL_ACTION_STYLE } from '@/components/tahi/rail/sidebar-card'
import { InlineMenuField, InlineDateField, InlineNumberField, InlineNone } from '@/components/tahi/inline-field'
import { StatusChipSelect } from '@/components/tahi/status-chip-select'
import { TimeCard } from '@/components/tahi/time-card'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { Menu } from '@/components/tahi/menu'
import type { TaskRow, TaskLevel } from '@/lib/tasks-views'
// All five come from Slice 1's shared module, never from a sibling leaf.
import type {
  TaskSubtask,
  TaskPerson,
  TaskClientOption,
  TaskRequestOption,
  TaskDependencyRow,
} from '@/components/tahi/tasks/task-types'

export interface TaskDetailPanelProps {
  open: boolean
  onClose: () => void
  /** Null while the shell is still fetching a deep-linked task. */
  task: TaskRow | null
  loading: boolean
  readOnly: boolean

  clients: readonly TaskClientOption[]
  peopleList: readonly TaskPerson[]
  people: Readonly<Record<string, TaskPerson>>
  /** Every request the studio could link, unfiltered. The panel narrows it
   *  to the task's client itself. */
  requests: readonly TaskRequestOption[]

  subtasks: readonly TaskSubtask[] | undefined
  blockedBy: readonly TaskDependencyRow[] | undefined
  /** Candidates for the add-dependency picker: every other open task. */
  blockerCandidates: readonly { id: string; title: string }[]

  /** One patch per edit. The shell makes it optimistic. */
  onPatch: (taskId: string, patch: Partial<TaskRow>) => Promise<void>
  onDelete: (taskId: string) => Promise<void>
  onDuplicate: (taskId: string) => Promise<void>
  onPromote: (taskId: string, input: { category: string; size: 'small_task' | 'large_task' }) => Promise<void>

  onAddSubtask: (taskId: string, title: string) => Promise<void>
  onToggleSubtask: (taskId: string, subtaskId: string, completed: boolean) => Promise<void>
  onDeleteSubtask: (taskId: string, subtaskId: string) => Promise<void>

  onAddBlocker: (taskId: string, blockerTaskId: string) => Promise<void>
  onRemoveBlocker: (taskId: string, depId: string) => Promise<void>

  /** Follow a blocker without closing: the shell just changes the selection. */
  onOpenTask: (taskId: string) => void
  onOpenRequest: (requestId: string) => void
}

export function TaskDetailPanel(props: TaskDetailPanelProps): React.ReactElement
```

- [ ] **Step 2: Build the chrome**

`<SlideOver open onClose variant="right" maxWidth="35rem" contentKey={task?.id ?? 'none'}>`. The `contentKey` is what re-runs focus-into-panel when the body swaps for a blocker, which is the interaction the prototype gets right and must not be lost.

Header (`SlideOver` already draws the close button and the title row):
- `icon`: the level glyph for the task's level.
- `title`: `Task`, as a kicker rather than the title itself. The title is editable in the body and would fight a header copy.
- Right-hand tools: `StatusChipSelect` fed `TASK_STATUSES`, then a `Menu` (`align="end"`, `width="14.75rem"`) holding **Duplicate**, **Create request from task** (only when `canPromote`), a divider, and **Delete** in the danger tone. The menu is hidden entirely when `readOnly`.

`canPromote = !task.requestId && task.type !== 'tahi_internal' && !!task.orgId`.

- [ ] **Step 3: Build the body head**

- A `TaskTick size="lg"` with `margin-top: 0.375rem`, toggling between `done` and `todo` and patching `completedAt` with it.
- An auto-growing `<textarea>` for the title: `rows={1}`, height reset to `auto` then `scrollHeight` on every change, `font: 700 1.25rem/1.3`, `letter-spacing: -0.01em`, `padding: 0.25rem 0.375rem`, `1px solid transparent`, `border-radius: var(--radius-sm)`, `resize: none`, `overflow: hidden`. Hover paints `var(--color-bg-secondary)`; focus paints `var(--color-bg)` with a brand border and the standard `tahi-focus-within` ring. Newlines are stripped on change. Enter blurs. Done renders it `var(--color-text-subtle)` with `line-through`. It commits on blur, not on change, matching the `inline-field` rule that nothing writes on keystroke.
- A wrapped meta row at `padding-left: 2.25rem` (clearing the tick): `LevelChip` with the client avatar, `RequestChip` when linked, the priority badge, `DueDateChip` when dated and open, and, when `readOnly`, a muted `Read-only` line with an eye glyph.
- The **promoted banner**, rendered only when `task.requestId` is set and the task's level is `client_task`: `padding: 0.75rem 0.875rem`, `1px solid var(--color-brand)`, **`border-radius: var(--radius-leaf)`**, `background: color-mix(in srgb, var(--color-brand) 7%, var(--color-bg))`, `font: 500 0.78125rem/1.5`, `color: var(--color-text-muted)`. Leading tile is `1.625rem` square at `border-radius: 0 0.5rem 0 0.5rem`, brand fill, white `Inbox` glyph. Copy: `This task is linked to {number}. The request carries the client conversation, files and delivery. The task stays here for your own follow-ups.` This is the only leaf radius on the surface besides the New task button, and it is deliberate: it marks the one place work crossed a boundary. Keep it.
- A description `<textarea>`: `min-height: 5rem`, `padding: 0.625rem 0.75rem`, `1px solid var(--color-border-subtle)`, `border-radius: var(--radius-md)`, `background: var(--color-bg-secondary)`, `font: 400 0.84375rem/1.6`, `resize: vertical`. Placeholder `Add a note: what good looks like, links, who to ask.` Commits on blur.

- [ ] **Step 4: Build the five rail cards**

All five are `<SidebarCard>` from Slice 1. Order matters.

**1. Waiting on.** Rendered when `blockedBy` has at least one entry, or when `!readOnly` (so there is somewhere to add one). Head icon `AlertTriangle`, count = the number of blockers. Each row: a `TaskStatusBadge` for the blocker's status, the blocker title (`flex: 1`, ellipsised, weight 600), an `Open` button in `var(--color-brand-dark)` calling `onOpenTask(b.taskId)`, and a remove `X` calling `onRemoveBlocker(task.id, b.depId)`. Below the rows, an `Add blocker` action opening an `InlineMenuField` over `blockerCandidates` with `searchable`. **This is new capability.** The prototype's `blockedBy` was read-only fixture data and the legacy page never had add or remove either, even though `POST` and `DELETE .../dependencies` have existed all along and are reachable from MCP. The 400 the route returns on a cycle must surface as a toast reading `That would make a loop`, not be swallowed.

**2. Links.** Head icon `Link`. Three rows, all routed through `lib/task-consistency.ts` so the invariants hold:

- **Level**: a three-button segmented radiogroup (`role="radiogroup"`, each `role="radio"` with `aria-checked`), one per `TASK_LEVELS` entry, each carrying its glyph at size 12 and its `hint` as the `title`. `1.75rem` tall (`2.25rem` below `md`), `padding: 0 0.625rem`, `border-radius: var(--radius-sm)` inside a `0.1875rem`-padded `var(--color-bg-secondary)` track. Selected takes `var(--color-bg)` with `box-shadow: 0 1px 2px color-mix(in srgb, var(--color-text) 10%, transparent), inset 0 0 0 1px var(--color-border-subtle)` and a brand glyph. `onChange` calls `setTaskLevel` and patches whatever it returns.
- **Client**: `InlineMenuField` with `searchable`, options `No client` plus every client. `onChange` calls `setTaskClient(state, orgId, linkedRequestOrgId)` where `linkedRequestOrgId` comes from `requests.find(r => r.id === task.requestId)?.orgId ?? null`.
- **Request**: `InlineMenuField`, options `Not linked` plus every request **whose `orgId` matches the task's client** (all of them when the task has no client). Labels read `#042 Title`. `onChange` calls `setTaskRequest`.

Under the three rows, a hint line at `font: 500 0.71875rem/1.45`, `color: var(--color-text-subtle)`, showing `TASK_LEVEL_HINTS[level]`.

**3. Details.** Head icon `Tag`. Four rows, each a `.dr-k` label at a fixed `5.25rem` and a right-aligned value:

- **Assignee**: `InlineMenuField` over `peopleList` plus a trailing `Unassigned`. Patches `{ assigneeId, assigneeType: 'team_member' }` or `{ assigneeId: null, assigneeType: null }`.
- **Due**: `InlineDateField`, rendering a `DueDateChip` with `closedStatuses={TASK_CLOSED_STATUSES}` or an `InlineNone` reading `No date`.
- **Priority**: `InlineMenuField` over `TASK_PRIORITIES`, rendering the priority badge.
- **Estimate**: `InlineNumberField` with `min={0} step={0.25} suffix="h"`, rendering `formatHours(value)` from `lib/tasks-planner.ts` or an `InlineNone` reading `None`. A value of zero or less clears it to `null`.

All four are `readOnly` when the panel is.

**4. Subtasks.** Head icon `ListChecks`, count `done/total` (null when empty), action a plus labelled `Add subtask`, suppressed when `readOnly`. A `0.375rem` progress bar at `var(--color-bg-secondary)` filled brand with a `0.3s` width transition, plus a tabular fraction, shown only when there is at least one subtask. Rows are an 1.125rem checkbox, the label (line-through and muted when done), and a remove `X` that turns `var(--color-danger)` on hover and stops propagation. The row itself toggles. Empty renders `Break it down if it helps. Subtasks show as progress on the row.`

**5. Time.** `<TimeCard target={{ kind: 'task', id: task.id }} />` from Slice 1. Nothing else: the card already owns the running readout, the cross-tab sync, the manual log form and the entry list.

- [ ] **Step 5: Build the footer**

`SlideOver.Footer`, `flex-wrap`, `gap: 0.5rem`:

- `Create request from task` as the primary, only when `canPromote && !readOnly`, `title="Turn this into client-facing work with its own thread, files and delivery"`.
- `Open TR-xxxx` as a secondary with an external glyph, only when linked, calling `onOpenRequest`.
- A `flex: 1` spacer.
- `Delete` in the danger tone, hidden when `readOnly`.

- [ ] **Step 6: Build the two confirms**

Both use the repo's `ConfirmDialog`. Escape must cancel the confirm without also closing the panel; the repo's `overlay-stack` already gives that for free, because `ConfirmDialog` registers above the `SlideOver` and only the topmost layer handles Escape. Do not add a manual capture-phase listener.

| Confirm | Title | Body | Action |
|---|---|---|---|
| delete | `Delete this task?` | `It goes for good, along with its subtasks and its logged time.` | `Delete`, danger |
| promote | `Create a request from this task?` | `A new request opens for {client name} with this title and note. The task stays linked to it, so your own follow-ups keep living here.` | `Create request` |

The promote confirm additionally holds two controls, because the prototype guessed and this port does not: a category `InlineMenuField` (`design`, `development`, `content`, `strategy`, `admin`, `bug`, sourced from `CATEGORY_CONFIG` in `lib/status-config.ts`) defaulting to `design`, and a size radiogroup (`1 day or less` = `small_task`, `Multi-day` = `large_task`) defaulting to `small_task`. Both go into `onPromote`.

- [ ] **Step 7: Type-check and lint**

Run: `npm run type-check && npm run lint`
Expected: type-check exit 0, lint clean.

- [ ] **Step 8: Commit**

```bash
git add components/tahi/tasks/task-detail-panel.tsx
git commit -m "feat(tasks): detail slide-over with editable links, subtasks, dependencies and time"
```

### Task 5.2: `components/tahi/tasks/new-task-dialog.tsx`

- [ ] **Step 1: Write the component to this exact interface**

The header menu's "New from template" opens this dialog with a template already chosen, so the dialog takes `initialTemplateId` as well as `initialStatus` and `initialOrgId`. Without it `TasksHeaderActions.onNewFromTemplate` has nowhere to land.

```tsx
'use client'

/**
 * <NewTaskDialog>. Create a task from a template or from scratch.
 *
 * A centre-variant <SlideOver> rather than a right-hand drawer: creating is a
 * decision you finish before going back to the list, and the centre variant
 * is the repo's modal.
 *
 * The template picker is the one capability the prototype did not have and
 * the legacy page did, so it is carried across, with the priority mapped
 * through the alias table on the way in. A template's estimate and its
 * subtasks now actually land, which they never did before: the old dialog
 * dropped both.
 */

import * as React from 'react'
import { SlideOver } from '@/components/tahi/slide-over'
import type { TaskLevel } from '@/lib/tasks-views'
import type { TaskTemplateOption } from '@/components/tahi/tasks/task-types'

export interface NewTaskDraft {
  title: string
  type: TaskLevel
  orgId: string | null
  requestId: string | null
  description: string | null
  status: string
  priority: string
  assigneeId: string | null
  dueDate: string | null
  estimatedHours: number | null
  subtasks: string[]
}

export interface NewTaskDialogProps {
  open: boolean
  onClose: () => void
  /** Pre-set the status, so the board's column plus creates in that column. */
  initialStatus?: string
  /** Pre-set the client, e.g. when a client filter is active. */
  initialOrgId?: string | null
  /** Pre-apply a template, so the header menu's "New from template" opens
   *  straight into a filled form. Applied on open, then the user owns it. */
  initialTemplateId?: string | null
  clients: readonly { id: string; name: string }[]
  peopleList: readonly { id: string; name: string }[]
  requests: readonly { id: string; orgId: string | null; requestNumber: number | null; title: string }[]
  templates: readonly TaskTemplateOption[]
  /** Rejecting keeps the dialog open with the draft intact. */
  onCreate: (draft: NewTaskDraft) => Promise<void>
}

export function NewTaskDialog(props: NewTaskDialogProps): React.ReactElement
```

Fields, in order: **Template** (optional picker, applies name to title, description, priority through the alias table, level, estimate and subtask titles), **Level** (the same three-button segmented control the detail uses, driven by `lib/task-consistency.ts`), **Client** (searchable, required unless the level is Tahi), **Request** (narrowed to the client), **Title** (required, autofocused), **Note**, **Priority**, **Due**, **Assignee**, **Estimate**, **Subtasks** (an add-one-per-line list with a remove per row).

Alias table, stated here because it is used in two places and must agree with the API's:

```ts
/** Templates carry a six-value enum; a task takes three. */
const TEMPLATE_PRIORITY_ALIASES: Record<string, string> = {
  none: 'standard', low: 'standard', medium: 'standard',
  standard: 'standard', high: 'high', urgent: 'urgent',
}
```

The submitted draft passes through `coerceTaskLinks` before `onCreate`, so the dialog cannot post an inconsistent triple even if a template disagrees with the chosen client.

Submit is disabled while the title is empty or while a create is in flight. Primary button reads `Create task`.

- [ ] **Step 2: Type-check and lint**

Run: `npm run type-check && npm run lint`
Expected: type-check exit 0, lint clean.

- [ ] **Step 3: Commit**

```bash
git add components/tahi/tasks/new-task-dialog.tsx
git commit -m "feat(tasks): create dialog with a working template picker"
```

### Task 5.3: `components/tahi/tasks/tasks-week.tsx`

- [ ] **Step 1: Write the component to this exact interface**

```tsx
'use client'

/**
 * <TasksWeek>. My week: your own open plate, laid out day by day, with drag
 * to plan.
 *
 * This view deliberately IGNORES the rail. Whatever saved view, filters or
 * search are set, it always shows the tasks assigned to you that are not
 * done. It is the answer to "what am I doing this week", and a filter would
 * only ever make that answer wrong.
 *
 * All the grouping maths is lib/tasks-planner.ts, so the shape of the week is
 * tested without a DOM.
 */

import * as React from 'react'
import { buildWeekGroups, formatHours, weekSummary } from '@/lib/tasks-planner'
import type { TaskRow } from '@/lib/tasks-views'
import type { TaskPerson } from '@/components/tahi/tasks/task-types'

export interface TasksWeekProps {
  /** The caller passes the WHOLE fetched set; this component filters it to
   *  the viewer's own open work itself, so the rail cannot reach it. */
  allRows: readonly TaskRow[]
  /** The viewer's team member id. Null means nothing is assigned to them and
   *  the empty state is the honest answer. */
  meId: string | null
  people: Readonly<Record<string, TaskPerson>>
  /** Show the assignee avatar on a planned row. False for a teammate looking
   *  at their own plate, where it is noise. */
  showAssignee: boolean
  readOnly: boolean
  /** Drop onto a day. `dueDate` is null when the drop cleared the date. */
  onPlan: (taskId: string, dueDate: string | null, groupName: string) => Promise<void>
  onToggleDone: (taskId: string, done: boolean) => void
  onOpenTask: (taskId: string) => void
  onOpenRequest: (requestId: string) => void
  /** Injected in tests; defaults to the wall clock. */
  now?: Date
}

export function TasksWeek(props: TasksWeekProps): React.ReactElement
```

Layout:

- **Summary strip**: `flex-wrap`, `gap: 0.875rem`, `padding: 0.875rem 1rem`, `1px solid var(--color-border)`, `border-radius: 0.875rem`, `background: var(--color-bg)`, `box-shadow: var(--shadow-sm)`. Four stats from `weekSummary`, each a `<b>` at `font: 700 1.25rem/1.1` with `font-variant-numeric: tabular-nums` over a `<span>` at `font: 600 0.6875rem`, `letter-spacing: 0.05em`, `text-transform: uppercase`, `color: var(--color-text-subtle)`: **Overdue** (the number turns `var(--color-danger)` when non-zero), **Today**, **This week**, **Estimated** (`formatHours(summary.estimatedHours)`). Then a note pushed right at `font: 500 0.78125rem`, `color: var(--color-text-muted)` with a grip glyph: `Drag a task onto a day to plan it`, or `Read-only` when `readOnly`.
- **Groups** from `buildWeekGroups`. Overdue (when present) and Today are full width. The middle groups (`groups.slice(2, -2)`) go in a `display: grid; grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr)); gap: 0.875rem`. The two tails (Later, No date) go in a second grid of the same shape. Below `md` both grids collapse to one column.
- **Day card**: `1px solid var(--color-border)`, `border-radius: 0.875rem`, `background: var(--color-bg)`, `box-shadow: var(--shadow-sm)`, `min-height: 8rem` inside the grids. Head is `align-items: baseline`, `padding: 0.75rem 1rem 0.5rem`: the name at `font: 700 0.84375rem` (`var(--color-danger)` on Overdue, `var(--color-brand-dark)` on Today), the date at `font: 500 0.75rem` in `var(--color-text-subtle)`, then pushed right the count (`N tasks` / `1 task`) and, only when at least one task in the group has an estimate, a hours line reading `· {formatHours(group.estimatedHours)}`.
- **Planned row**: `flex-wrap`, `gap: 0.3125rem 0.625rem`, `min-height: 2.75rem` (`3rem` below `md`), `padding: 0.375rem 0.5rem 0.375rem 0.625rem`, `1px solid transparent`, `border-radius: var(--radius-md)`, `cursor: grab`. It is its own `container-type: inline-size; container-name: tsk-task`, so the same chip thinning the list uses applies here. Contents: `TaskTick` (never done in this view; `blocked` when the task is), the title, then the chips (`LevelChip compact`, `RequestChip`, priority badge, the estimate as muted text), plus the assignee avatar **only when `showAssignee`**. A trailing arrow button at `1.75rem` (`2.75rem` below `md`) is `aria-hidden` and decorative; the whole row is the click target.
- **Drop zone**: `margin: 0.125rem 0.25rem 0.25rem`, `padding: 0.75rem`, `1px dashed var(--color-border)`, `border-radius: var(--radius-md)`, centred at `font: 500 0.75rem` in `var(--color-text-subtle)`. Rendered when the group is droppable and either it is empty or a drag is in progress. Copy: while dragging, `Drop to plan for {group name lowercased}`; on the No date group, `Undated tasks land here`; otherwise `Nothing planned. Drag a task here.` A hovering drag paints the card `border-color: var(--color-brand)`, `background: color-mix(in srgb, var(--color-brand-100) 45%, var(--color-bg))`, `box-shadow: inset 0 0 0 1px var(--color-brand)`.
- **Overdue is the one group you cannot drop into.** `buildWeekGroups` already returns `droppable: false` for it; render it with no drop zone and no drop handlers.

Drag uses the same HTML5 API the board does: `dragstart` sets `effectAllowed = 'move'` and writes an empty `text/plain` payload (Firefox needs a payload), `dragover` preventDefaults, `drop` calls `onPlan(id, group.dueDate ?? null, group.name)`. Every handler is `undefined` when `readOnly`.

**Empty state**: when nothing open is assigned to the viewer, render the shared empty shell with title `A clear week` and body `Nothing open is assigned to you. Enjoy it, or pull something in from All tasks.` No CTA: there is nothing to do here, and offering one would be noise.

- [ ] **Step 2: Type-check and lint**

Run: `npm run type-check && npm run lint`
Expected: type-check exit 0, lint clean.

- [ ] **Step 3: Commit**

```bash
git add components/tahi/tasks/tasks-week.tsx
git commit -m "feat(tasks): my week planner with drag to plan"
```

---

## Slice 6: Rail, shell and wiring (Wave C, after 2, 3, 4 and 5 have merged)

**Files:**
- Create: `components/tahi/tasks/use-tasks-rail-state.ts`, `components/tahi/tasks/tasks-rail.tsx`, `components/tahi/tasks/tasks-view-switcher.tsx`, `components/tahi/tasks/tasks-header-actions.tsx`, `components/tahi/__tests__/tasks-rail-default.test.ts`
- Modify: `app/(dashboard)/tasks/tasks-content.tsx` (replaced wholesale), `app/(dashboard)/tasks/page.tsx`

### Task 6.1: `components/tahi/tasks/use-tasks-rail-state.ts`

- [ ] **Step 1: Write the failing test**

Create `components/tahi/__tests__/tasks-rail-default.test.ts`:

```ts
/**
 * applyStoredTaskDefault and migrateLegacyTaskPreferences: the two writers
 * that run during the first client render, before useUserPreference hydrates.
 *
 * The store is localStorage, so these stand a minimal `window` up before the
 * module under test is imported. What they pin down is the rule both
 * functions follow: fill only the keys the browser is missing, never
 * overwrite a choice already sitting in storage.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const PREFIX = 'tahi-pref:'
const store = new Map<string, string>()

vi.stubGlobal('window', {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k) as string : null),
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
  },
})

const { applyStoredTaskDefault, migrateLegacyTaskPreferences } =
  await import('../tasks/use-tasks-rail-state')

function write(key: string, value: unknown) {
  store.set(`${PREFIX}${key}`, JSON.stringify(value))
}
function read(key: string): unknown {
  const raw = store.get(`${PREFIX}${key}`)
  return raw === undefined ? undefined : JSON.parse(raw)
}

const SNAPSHOT = {
  view: 'board',
  savedView: 'overdue',
  filters: { status: 'all', priority: 'urgent', level: 'all', client: 'all', assignee: 'all', due: 'any' },
  sort: { key: 'due', dir: 'asc' },
}

describe('applyStoredTaskDefault', () => {
  beforeEach(() => { store.clear() })

  it('does nothing when no default has been saved', () => {
    applyStoredTaskDefault()
    expect(store.size).toBe(0)
  })

  it('does nothing when the stored default is not a valid snapshot', () => {
    write('tasks.default', { view: 'not-a-view' })
    applyStoredTaskDefault()
    expect(read('tasks.view')).toBeUndefined()
  })

  it('fills every rail key the browser is missing', () => {
    write('tasks.default', SNAPSHOT)
    applyStoredTaskDefault()
    expect(read('tasks.view')).toBe('board')
    expect(read('tasks.savedView')).toBe('overdue')
    expect(read('tasks.filters')).toEqual(SNAPSHOT.filters)
    expect(read('tasks.sort')).toEqual(SNAPSHOT.sort)
  })

  it('never overwrites a key the user has already set', () => {
    write('tasks.default', SNAPSHOT)
    write('tasks.view', 'week')
    applyStoredTaskDefault()
    expect(read('tasks.view')).toBe('week')
    expect(read('tasks.savedView')).toBe('overdue')
  })
})

describe('migrateLegacyTaskPreferences', () => {
  beforeEach(() => { store.clear() })

  it('carries my_work over as the week view with the mine saved view', () => {
    write('tasks.viewMode', 'my_work')
    migrateLegacyTaskPreferences()
    expect(read('tasks.view')).toBe('week')
    expect(read('tasks.savedView')).toBe('mine')
    expect(read('tasks.railMigrated')).toBe(true)
  })

  it('carries the old type tab over as a saved view', () => {
    write('tasks.typeTab', 'for_client')
    migrateLegacyTaskPreferences()
    expect(read('tasks.savedView')).toBe('client_linked')
  })

  it('carries the old status tab into the status filter', () => {
    write('tasks.statusTab', 'blocked')
    migrateLegacyTaskPreferences()
    expect((read('tasks.filters') as { status: string }).status).toBe('blocked')
  })

  it('runs once and never again', () => {
    write('tasks.viewMode', 'my_work')
    migrateLegacyTaskPreferences()
    store.delete(`${PREFIX}tasks.view`)
    migrateLegacyTaskPreferences()
    expect(read('tasks.view')).toBeUndefined()
  })

  it('never overwrites a key the user has already set on the new surface', () => {
    write('tasks.viewMode', 'my_work')
    write('tasks.view', 'list')
    migrateLegacyTaskPreferences()
    expect(read('tasks.view')).toBe('list')
  })

  it('leaves the legacy keys in place', () => {
    write('tasks.viewMode', 'board')
    migrateLegacyTaskPreferences()
    expect(read('tasks.viewMode')).toBe('board')
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run components/tahi/__tests__/tasks-rail-default.test.ts`
Expected: FAIL with `Failed to resolve import "../tasks/use-tasks-rail-state"`.

- [ ] **Step 3: Write `components/tahi/tasks/use-tasks-rail-state.ts`**

```ts
'use client'

/**
 * The per-user preference layer behind the Tasks rail: `tasks.view`,
 * `tasks.savedView`, `tasks.filters`, `tasks.sort` and the `tasks.default`
 * snapshot, plus a one-time migration off the pre-rail `tasks.viewMode` /
 * `tasks.typeTab` / `tasks.statusTab` keys so nobody loses the view they had.
 *
 * The namespace was already partly occupied: the legacy tasks-content.tsx
 * wrote all three of those keys through useUserPreference. They are migrated
 * rather than claimed, and they are left in place afterwards rather than
 * deleted, so a rollback still finds them.
 *
 * The Tasks surface has no URL-override layer, unlike Requests: nothing links
 * into a pre-filtered task list. If that changes, the shape to copy is
 * lib/requests-url-state.ts, not a second ad-hoc reader here.
 *
 * Known limitation, inherited knowingly: the saved default lives in
 * localStorage, so it does not follow the user to a second machine and dies
 * with a storage clear. Persisting it server-side is open work on the API
 * side for both surfaces.
 */

import * as React from 'react'
import { useUserPreference, oneOf } from '@/lib/use-user-preference'
import {
  DEFAULT_TASKS_SORT,
  DEFAULT_TASK_FILTERS,
  TASKS_VIEW_KEYS,
  TASKS_SAVED_VIEWS,
  isTasksFilters,
  isTasksSnapshot,
  isTasksSort,
  migrateLegacyTaskStatusTab,
  migrateLegacyTaskTypeTab,
  migrateLegacyTaskViewMode,
  normaliseTasksViewKey,
  tasksSnapshotsEqual,
  type TasksFilters,
  type TasksSnapshot,
  type TasksSort,
  type TasksViewKey,
} from '@/lib/tasks-views'

const PREF_PREFIX = 'tahi-pref:'
const MIGRATION_KEY = 'tasks.railMigrated'

function readPref(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(`${PREF_PREFIX}${key}`)
    return raw === null ? undefined : JSON.parse(raw)
  } catch {
    return undefined
  }
}

function writePref(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(`${PREF_PREFIX}${key}`, JSON.stringify(value))
  } catch {
    // Private mode or quota. The preference just will not persist.
  }
}

/**
 * Apply the saved default snapshot to any rail key this browser does not
 * already hold. Runs once during the first client render, after the legacy
 * migration and before `useUserPreference` hydrates, so a key the user has
 * set since always wins.
 */
export function applyStoredTaskDefault(): void {
  if (typeof window === 'undefined') return
  const stored = readPref('tasks.default')
  if (!isTasksSnapshot(stored)) return
  if (readPref('tasks.view') === undefined) writePref('tasks.view', normaliseTasksViewKey(stored.view))
  if (readPref('tasks.savedView') === undefined) writePref('tasks.savedView', stored.savedView)
  if (readPref('tasks.filters') === undefined) writePref('tasks.filters', stored.filters)
  if (readPref('tasks.sort') === undefined) writePref('tasks.sort', stored.sort)
}

/**
 * Carry the pre-rail preferences over to the new keys, once. Guarded by its
 * own flag so it never overwrites a choice the user has since made. The old
 * keys are left in place rather than deleted.
 */
export function migrateLegacyTaskPreferences(): void {
  if (typeof window === 'undefined') return
  if (readPref(MIGRATION_KEY) === true) return

  const legacyView = migrateLegacyTaskViewMode(readPref('tasks.viewMode'))
  if (legacyView) {
    if (readPref('tasks.view') === undefined) writePref('tasks.view', legacyView.view)
    if (legacyView.savedView && readPref('tasks.savedView') === undefined) {
      writePref('tasks.savedView', legacyView.savedView)
    }
  }

  const legacySaved = migrateLegacyTaskTypeTab(readPref('tasks.typeTab'))
  if (legacySaved && readPref('tasks.savedView') === undefined) {
    writePref('tasks.savedView', legacySaved)
  }

  const legacyStatus = migrateLegacyTaskStatusTab(readPref('tasks.statusTab'))
  if (legacyStatus && readPref('tasks.filters') === undefined) {
    writePref('tasks.filters', { ...DEFAULT_TASK_FILTERS, status: legacyStatus })
  }

  writePref(MIGRATION_KEY, true)
}

const isSavedViewKey = (v: unknown): v is string | null => v === null || typeof v === 'string'
const isSnapshot = (v: unknown): v is TasksSnapshot | null => v === null || isTasksSnapshot(v)

export interface TasksRailState {
  view: TasksViewKey
  setView: (next: TasksViewKey) => void
  savedView: string | null
  setSavedView: (next: string | null) => void
  filters: TasksFilters
  setFilters: (next: TasksFilters) => void
  sort: TasksSort
  setSort: (next: TasksSort) => void
  query: string
  setQuery: (next: string) => void
  /** True when the live state matches the saved default exactly. */
  isDefault: boolean
  saveDefault: () => void
  /** True once a default has been saved, so a reset has somewhere to go. */
  hasDefault: boolean
  resetToDefault: () => void
}

export function useTasksRailState(): TasksRailState {
  // Runs during the first client render, ahead of every hydration effect
  // below: the legacy keys are carried over first, then the saved default
  // fills whatever is still unset.
  React.useState(() => {
    migrateLegacyTaskPreferences()
    applyStoredTaskDefault()
    return null
  })

  const [storedView, setStoredView] = useUserPreference<TasksViewKey>(
    'tasks.view',
    'list',
    { validator: oneOf<TasksViewKey>(TASKS_VIEW_KEYS) },
  )
  const [storedSavedView, setStoredSavedView] = useUserPreference<string | null>(
    'tasks.savedView',
    null,
    { validator: isSavedViewKey },
  )
  const [storedFilters, setStoredFilters] = useUserPreference<TasksFilters>(
    'tasks.filters',
    DEFAULT_TASK_FILTERS,
    { validator: isTasksFilters },
  )
  const [storedSort, setStoredSort] = useUserPreference<TasksSort>(
    'tasks.sort',
    DEFAULT_TASKS_SORT,
    { validator: isTasksSort },
  )
  const [storedDefault, setStoredDefault] = useUserPreference<TasksSnapshot | null>(
    'tasks.default',
    null,
    { validator: isSnapshot },
  )
  const [query, setQuery] = React.useState('')

  const view = normaliseTasksViewKey(storedView)
  // A saved view key that no longer exists means All tasks, not nothing.
  const savedView = storedSavedView && TASKS_SAVED_VIEWS.some(v => v.key === storedSavedView)
    ? storedSavedView
    : null

  const isDefault = tasksSnapshotsEqual(storedDefault, { view, savedView, filters: storedFilters, sort: storedSort })

  const saveDefault = React.useCallback(() => {
    setStoredDefault({ view, savedView, filters: storedFilters, sort: storedSort })
  }, [setStoredDefault, view, savedView, storedFilters, storedSort])

  const resetToDefault = React.useCallback(() => {
    if (!storedDefault) return
    setStoredView(normaliseTasksViewKey(storedDefault.view))
    setStoredSavedView(storedDefault.savedView)
    setStoredFilters(storedDefault.filters)
    setStoredSort(storedDefault.sort)
  }, [storedDefault, setStoredView, setStoredSavedView, setStoredFilters, setStoredSort])

  return {
    view,
    setView: setStoredView,
    savedView,
    setSavedView: setStoredSavedView,
    filters: storedFilters,
    setFilters: setStoredFilters,
    sort: storedSort,
    setSort: setStoredSort,
    query,
    setQuery,
    isDefault,
    saveDefault,
    hasDefault: storedDefault !== null,
    resetToDefault,
  }
}
```

Note for the implementer: `useUserPreference`'s mount effect deliberately runs once and ignores key changes, so every key above must be a literal string. That is also why the migration and the default application run inside a `useState` initialiser (during the first render) rather than in an effect.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run components/tahi/__tests__/tasks-rail-default.test.ts`
Expected: PASS, `Tests  10 passed (10)`.

- [ ] **Step 5: Commit**

```bash
git add components/tahi/tasks/use-tasks-rail-state.ts components/tahi/__tests__/tasks-rail-default.test.ts
git commit -m "feat(tasks): rail preference state with a migration off the my-work keys"
```

### Task 6.2: `components/tahi/tasks/tasks-rail.tsx`

- [ ] **Step 1: Write the rail**

```tsx
'use client'

/**
 * <TasksRail>. The left rail on the Tasks page: seven saved views with live
 * counts, one select-style control per filter dimension, sort with a
 * direction toggle, Clear filters, and Save as default.
 *
 * The same component fills the desktop rail and the mobile Filters sheet;
 * the sheet passes `touch` so every control and every option is a 44px
 * target. Every control is RailSelect from components/tahi/rail, which is
 * the same one the Requests rail uses.
 */

import * as React from 'react'
import {
  RailSelect,
  RailViewItem,
  RailGroupLabel,
  SaveDefaultControl,
  buildRailChips,
  type RailOption,
  type RailFilterChip,
} from '@/components/tahi/rail/rail-controls'
import { TASK_STATUSES, TASK_STATUS_CONFIG } from '@/lib/status-config'
import {
  DEFAULT_TASK_FILTERS,
  DUE_FILTER_OPTIONS,
  LEVEL_FILTER_OPTIONS,
  PRIORITY_FILTER_OPTIONS,
  TASKS_SAVED_VIEWS,
  TASK_DIMENSION_LABELS,
  TASK_FILTER_KEYS,
  TASK_SORT_KEYS,
  isTaskFilterActive,
  taskSortDirLabel,
  taskSortKeyLabel,
  type TaskFilterKey,
  type TasksFilters,
  type TasksSort,
  type TasksSortKey,
} from '@/lib/tasks-views'

/** Status options carry their dot so the control, the chip and the board
 *  column header all read the same. */
const STATUS_OPTIONS: readonly RailOption[] = [
  { value: 'all', label: 'All statuses' },
  ...TASK_STATUSES.map(s => ({
    value: s.value,
    label: s.label,
    dot: TASK_STATUS_CONFIG[s.value]?.dot,
  })),
]

export interface TasksRailProps {
  savedView: string | null
  onSavedViewChange: (next: string | null) => void
  counts: Record<string, number>
  filters: TasksFilters
  onFiltersChange: (next: TasksFilters) => void
  sort: TasksSort
  onSortChange: (next: TasksSort) => void
  /** Built from the loaded rows, so a filter can only ever pick a real
   *  value. Both already carry their "No client" / "Unassigned" entry. */
  clientOptions: readonly RailOption[]
  assigneeOptions: readonly RailOption[]
  isDefault: boolean
  onSaveDefault: () => void
  /** 44px targets. Set inside the mobile sheet. */
  touch?: boolean
}

export function TasksRail(props: TasksRailProps): React.ReactElement
```

Structure, identical in shape to `RequestsRail`:

- **Views** group: `All tasks` (active when `savedView === null`, count `counts.__all`), then one `RailViewItem` per `TASKS_SAVED_VIEWS` entry with `counts[view.key]`.
- **Filters** group: one `RailSelect` per `TASK_FILTER_KEYS`, labelled from `TASK_DIMENSION_LABELS`, with `searchable` on `client` only and `searchLabel="Search clients"`. `optionsFor` is a total switch over the six keys so a new dimension cannot be added without handling it.
- **Sort** group: a `RailSelect` over `TASK_SORT_KEYS`, the direction toggle button reading `taskSortDirLabel(sort)`, and a line beneath: `Sorted by {taskSortKeyLabel(sort).toLowerCase()}. Done always sits last.`
- **Foot**: `Clear filters` (only when a dimension is active) above `SaveDefaultControl`.

Also export the chip builder the shell needs, so the chips can never disagree with the controls:

```tsx
export function buildTaskChips(
  filters: TasksFilters,
  options: { clientOptions: readonly RailOption[]; assigneeOptions: readonly RailOption[] },
): RailFilterChip[] {
  const lists: Record<TaskFilterKey, readonly RailOption[]> = {
    status: STATUS_OPTIONS,
    priority: PRIORITY_FILTER_OPTIONS,
    level: LEVEL_FILTER_OPTIONS,
    client: options.clientOptions,
    assignee: options.assigneeOptions,
    due: DUE_FILTER_OPTIONS,
  }
  return buildRailChips(
    filters as unknown as Record<string, string>,
    DEFAULT_TASK_FILTERS as unknown as Record<string, string>,
    TASK_FILTER_KEYS.map(key => ({
      key,
      label: TASK_DIMENSION_LABELS[key],
      options: lists[key],
    })),
  )
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npm run type-check && npm run lint`
Expected: type-check exit 0, lint clean.

- [ ] **Step 3: Commit**

```bash
git add components/tahi/tasks/tasks-rail.tsx
git commit -m "feat(tasks): the tasks rail over the shared rail controls"
```

### Task 6.3: `components/tahi/tasks/tasks-view-switcher.tsx`

- [ ] **Step 1: Write the file in full**

```tsx
'use client'

/**
 * <TasksViewSwitcher>. The three peer views of the Tasks surface: List,
 * Board and My week.
 *
 * A thin arrangement of the shared <SegmentedControl>: the sliding pill, the
 * brand-tinted active icon, the full WAI-ARIA tab pattern and the 2.75rem
 * touch targets all come from the primitive. This file only names the views.
 *
 * The label drops below 1024px, where the rail has already collapsed into
 * the Filters sheet and the row is at its most crowded; the name is still
 * carried by `title` and `aria-label`, so the accessible name never changes
 * with the viewport.
 */

import { useMemo } from 'react'
import { CalendarRange, LayoutGrid, Rows } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SegmentedControl, type SegmentedControlOption } from '@/components/tahi/segmented-control'
import { TASKS_VIEW_KEYS, type TasksViewKey } from '@/lib/tasks-views'

const VIEW_META: Record<TasksViewKey, { label: string; Icon: LucideIcon }> = {
  list:  { label: 'List',    Icon: Rows },
  board: { label: 'Board',   Icon: LayoutGrid },
  week:  { label: 'My week', Icon: CalendarRange },
}

export interface TasksViewSwitcherProps {
  value: TasksViewKey
  onChange: (next: TasksViewKey) => void
}

export function TasksViewSwitcher({ value, onChange }: TasksViewSwitcherProps) {
  const options = useMemo<SegmentedControlOption<TasksViewKey>[]>(
    () => TASKS_VIEW_KEYS.map(key => {
      const { label, Icon } = VIEW_META[key]
      return { value: key, label, icon: <Icon size={14} aria-hidden="true" /> }
    }),
    [],
  )

  return (
    <SegmentedControl<TasksViewKey>
      role="tablist"
      // The e2e suite finds this strip by name, so the label is part of the
      // contract, not decoration.
      ariaLabel="Tasks view"
      size="sm"
      iconOnlyBelow="lg"
      value={value}
      onChange={onChange}
      options={options}
      className="flex-shrink-0"
    />
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add components/tahi/tasks/tasks-view-switcher.tsx
git commit -m "feat(tasks): list, board and my week view switcher"
```

### Task 6.4: `components/tahi/tasks/tasks-header-actions.tsx`

- [ ] **Step 1: Write the file in full**

```tsx
'use client'

/**
 * <TasksHeaderActions>. Two controls at every width: New task stays the
 * single primary action, and everything else (AI: break work into tasks, New
 * from template, Export CSV) lives under one overflow menu. Keeps the page
 * header the same shape on a phone as on a desktop, which is what lets the
 * header hold its width across all three views.
 */

import * as React from 'react'
import { FileDown, Layers, MoreHorizontal, Plus, Sparkles } from 'lucide-react'
import { Menu } from '@/components/tahi/menu'
import { TahiButton } from '@/components/tahi/tahi-button'
import type { TaskTemplateOption } from '@/components/tahi/tasks/task-types'

export interface TasksHeaderActionsProps {
  readOnly?: boolean
  templates: readonly TaskTemplateOption[]
  onNew: () => void
  onAiWizard: () => void
  /** Opens the create dialog with the template pre-applied. */
  onNewFromTemplate: (templateId: string) => void
  onExportCsv: () => void
}

export function TasksHeaderActions({
  readOnly = false,
  templates,
  onNew,
  onAiWizard,
  onNewFromTemplate,
  onExportCsv,
}: TasksHeaderActionsProps) {
  return (
    <>
      {!readOnly && (
        <TahiButton
          variant="primary"
          size="sm"
          onClick={onNew}
          iconLeft={<Plus className="w-3.5 h-3.5" />}
        >
          <span className="hidden sm:inline">New task</span>
          <span className="sm:hidden">New</span>
        </TahiButton>
      )}

      <Menu
        align="end"
        width="15rem"
        trigger={
          <button
            type="button"
            aria-label="More task actions"
            title="More task actions"
            // 2.75rem under md, back to the header's 2.25rem square above it.
            // On a phone this is the only route to the wizard, the templates
            // and the export, so it cannot stay a 36px target.
            className="tahi-focus-ring inline-flex items-center justify-center w-11 h-11 md:w-9 md:h-9"
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-bg)',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              flexShrink: 0,
              transition: 'border-color var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--color-brand)'
              e.currentTarget.style.color = 'var(--color-text)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--color-border)'
              e.currentTarget.style.color = 'var(--color-text-muted)'
            }}
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
        }
      >
        {!readOnly && (
          <Menu.Item icon={<Sparkles size={15} aria-hidden="true" />} onClick={onAiWizard}>
            AI: break work into tasks
          </Menu.Item>
        )}
        {!readOnly && templates.length > 0 && (
          <>
            <Menu.Label>New from template</Menu.Label>
            {templates.map(t => (
              <Menu.Item
                key={t.id}
                icon={<Layers size={15} aria-hidden="true" />}
                onClick={() => onNewFromTemplate(t.id)}
              >
                {t.name}
              </Menu.Item>
            ))}
          </>
        )}
        <Menu.Divider />
        <Menu.Item icon={<FileDown size={15} aria-hidden="true" />} onClick={onExportCsv}>
          Export CSV
        </Menu.Item>
      </Menu>
    </>
  )
}
```

The prototype used a disclosure row that expanded a submenu in place. The repo's `Menu` has `Menu.Label`, which does the same job with none of the nested-focus problems, so the templates are a labelled section rather than a submenu.

Before writing, check `components/tahi/menu.tsx` for the exact `Menu.Item` prop names (`icon`, `onClick`, `tone`). If `icon` is not a prop, render the glyph inside the item's children instead.

- [ ] **Step 2: Type-check and lint**

Run: `npm run type-check && npm run lint`
Expected: type-check exit 0, lint clean.

- [ ] **Step 3: Commit**

```bash
git add components/tahi/tasks/tasks-header-actions.tsx
git commit -m "feat(tasks): header actions with one overflow menu"
```

### Task 6.5: Replace `app/(dashboard)/tasks/tasks-content.tsx`

- [ ] **Step 1: Delete the old file and write the shell**

`git rm` is wrong here (the path stays); overwrite it. The new file is roughly 450 lines and does exactly six things.

**1. Audience and write gate.** Copy the pattern from `request-list.tsx:511-528`. `useImpersonation` is exported from `@/components/tahi/impersonation-banner` (not from a hooks module), and `app-sidebar.tsx:148-150` has the same viewer test if the request-list one has drifted:

```tsx
import { useImpersonation } from '@/components/tahi/impersonation-banner'

const { isImpersonatingTeamMember, impersonatedAccessRules, impersonatedTeamMemberId } = useImpersonation()
// A viewer-scoped impersonation is a read-only lens: the PATCH and POST
// calls behind these controls land as the real super admin, so the lens has
// to hold in the UI too.
const isViewerImpersonation = isImpersonatingTeamMember
  && impersonatedAccessRules.length > 0
  && impersonatedAccessRules.every(r => r.role === 'viewer')
const readOnly = isViewerImpersonation
// The viewer's own team member id, for "Assigned to me" and for My week.
// Impersonation is the only place the browser knows which teammate this is;
// otherwise the server resolves `me` and we read it back off the rows.
const meId = impersonatedTeamMemberId ?? myTeamMemberId
```

`myTeamMemberId` comes from a single SWR call to `/api/admin/team-members?me=1` if that shape exists; otherwise fetch `/api/admin/team-members` and match on the Clerk user id the way `teammate-home.tsx` does. Read that file before writing this line and copy whichever it uses.

**2. Data.** Five SWR keys, all through `apiPath`:

| Key | Purpose |
|---|---|
| `/api/admin/tasks?status=all` | Every task, once. Filtering happens client-side through `applyTaskViews`, exactly as the Requests list does, so the counts and every view agree. |
| `/api/admin/team-members` | `people` and `peopleList` |
| `/api/admin/clients?status=active` | `clients` and the client filter options |
| `/api/admin/requests?status=all&limit=500` | The link picker's request options |
| `/api/admin/task-templates` | The header menu and the create dialog |

Plus two conditional keys driven by the selection: `/api/admin/tasks/{id}/subtasks` and `/api/admin/tasks/{id}/dependencies`, and one per expanded list row for its subtask panel. Use `useSWRConfig().mutate` to revalidate one key at a time rather than blowing the cache away.

**3. Rail state and the pipeline.**

```tsx
const rail = useTasksRailState()
const tasks = tasksData?.tasks ?? []

const counts = useMemo(
  () => countTasksSavedViews(tasks, { assigneeId: meId }),
  [tasks, meId],
)

const visible = useMemo(
  () => applyTaskViews(tasks, {
    savedView: rail.savedView,
    filters: rail.filters,
    query: rail.query,
    sort: rail.sort,
    assigneeId: meId,
  }),
  [tasks, rail.savedView, rail.filters, rail.query, rail.sort, meId],
)
```

**4. The frame.** `PageHeader` with `title="Tasks"`, `subtitle="The studio's own to-do list: emails, chasers, prep, housekeeping. Sometimes for a client, sometimes not."` and `<TasksHeaderActions>` as its children. Under it:

```tsx
<RailLayout
  rail={<TasksRail {...railProps} />}
  railTouch={<TasksRail {...railProps} touch />}
  switcher={<TasksViewSwitcher value={rail.view} onChange={rail.setView} />}
  chips={chips}
  onClearChip={(chip) => rail.setFilters({ ...rail.filters, [chip.key]: DEFAULT_TASK_FILTERS[chip.key as TaskFilterKey] })}
  onClearAll={() => { rail.setFilters({ ...DEFAULT_TASK_FILTERS }); rail.setSavedView(null); rail.setQuery('') }}
  onResetDefault={rail.hasDefault && !rail.isDefault ? rail.resetToDefault : undefined}
  query={rail.query}
  onQueryChange={rail.setQuery}
  searchPlaceholder="Search tasks or clients"
  total={rail.view === 'week' ? weekCount : visible.length}
  itemNoun="task"
  loading={loading}
  extraActiveCount={rail.savedView ? 1 : 0}
  saveDefaultTouch={<SaveDefaultControl isDefault={rail.isDefault} onSave={rail.saveDefault} touch />}
>
  {body}
</RailLayout>
```

`weekCount` is `tasks.filter(t => t.assigneeId === meId && t.status !== 'done').length`, because My week ignores the rail and the count must say what is actually on screen.

**5. View routing.**

```tsx
const body = rail.view === 'board' ? (
  <TasksBoard rows={visible} people={people} readOnly={readOnly} onMove={handleMove} onQuickAdd={handleColumnAdd} onOpenTask={selectTask} />
) : rail.view === 'week' ? (
  <TasksWeek allRows={tasks} meId={meId} people={people} showAssignee={false} readOnly={readOnly} onPlan={handlePlan} onToggleDone={handleToggleDone} onOpenTask={selectTask} onOpenRequest={openRequest} />
) : (
  <TasksList rows={visible} loading={loading} people={people} peopleList={peopleList} clients={clients} readOnly={readOnly} subtasks={subtasksByTask} onExpandRow={handleExpandRow} onOpenTask={selectTask} onOpenRequest={openRequest} onToggleDone={handleToggleDone} onStatusChange={handleStatusChange} onToggleSubtask={handleToggleSubtask} onAddSubtask={handleAddSubtask} onQuickAdd={handleQuickAdd} onBulkStatus={handleBulkStatus} onBulkPriority={handleBulkPriority} onBulkAssignee={handleBulkAssignee} onBulkDueDate={handleBulkDueDate} hasFilter={anyTaskFilterActive(rail.filters) || !!rail.savedView || !!rail.query} onClearFilters={handleClearAll} onNewTask={() => setDialogOpen(true)} />
)
```

Wrap `body` in `<div role="tabpanel" id="tasks-view-panel" tabIndex={0}>` and pass `panelId: 'tasks-view-panel'` on every `SegmentedControlOption` in `TasksViewSwitcher`. This closes the open ARIA item the Requests switcher documents at its header but could not close, because there the swapped region lives in a 3000-line page and here it is three lines away.

**6. Detail wiring.**

```tsx
const searchParams = useSearchParams()
const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() => searchParams.get('task'))

// A task the current lens does not contain still has to open: a notification
// link lands on /tasks?task=<id> whatever the reader's saved view is.
const inLens = tasks.find(t => t.id === selectedTaskId) ?? null
const { data: fallbackData } = useSWR(
  selectedTaskId && !inLens ? apiPath(`/api/admin/tasks/${selectedTaskId}`) : null,
  fetcher,
)
const selectedTask = inLens ?? fallbackData?.task ?? null

const selectTask = useCallback((id: string | null) => {
  setSelectedTaskId(id)
  // replaceState rather than router.replace: the URL has to stay shareable
  // without paying for a Next navigation on every row click.
  const url = new URL(window.location.href)
  if (id) url.searchParams.set('task', id)
  else url.searchParams.delete('task')
  window.history.replaceState(null, '', url.toString())
}, [])
```

Every mutation handler follows one shape: patch the SWR cache optimistically, fire the write, revalidate on failure and toast. Copy `moveTaskStatus` from the legacy file (it had `rollbackOnError` plus an error toast and got this right) rather than inventing a new pattern.

**7. The three header actions, all of which have a prop and none of which had an implementation before this step.**

- **New task** and **New from template** both open `<NewTaskDialog>`. Keep one dialog, driven by three pieces of state: `dialogOpen`, `dialogStatus` (set by the board's column composer, otherwise undefined) and `dialogTemplateId` (set by `onNewFromTemplate`, otherwise null). `onCreate` POSTs `/api/admin/tasks` with the whole `NewTaskDraft` including `subtasks` and `estimatedHours`, which Slice 2 taught the route to accept, then revalidates the tasks key and opens the new task in the panel.

- **AI: break work into tasks** mounts the existing wizard. It is lazy-loaded exactly as the legacy page did (`tasks-content.tsx:52-56`) so its bundle does not sit in the initial load:

```tsx
const AiTaskWizard = dynamic(
  () => import('@/components/tahi/ai-task-wizard').then(m => m.AiTaskWizard),
  { ssr: false },
)

// ...
{wizardOpen && (
  <AiTaskWizard
    open={wizardOpen}
    onClose={() => setWizardOpen(false)}
    context={{ orgId: rail.filters.client === 'all' || rail.filters.client === 'none' ? undefined : rail.filters.client }}
    mutateKeys={[apiPath('/api/admin/tasks?status=all')]}
    onTasksCreated={() => showToast('Tasks created')}
  />
)}
```

Read `components/tahi/ai-task-wizard.tsx` for its real prop names before writing this: it exports both `AiTaskWizard` and `AiTaskWizardButton`, and the legacy page mounted it at `tasks-content.tsx:757-761` with its own open state. Use whichever shape it already has rather than changing it here; Slice 2 only added `mutateKeys`.

- **Export CSV** is a client-side download of what is on screen, so it needs no route:

```tsx
const exportCsv = useCallback(() => {
  const header = ['Title', 'Level', 'Client', 'Status', 'Priority', 'Assignee', 'Due', 'Estimate']
  const lines = visible.map(t => [
    t.title,
    TASK_LEVEL_LABELS[levelOf(t)] ?? '',
    t.orgName ?? '',
    TASK_STATUS_LABELS[t.status] ?? t.status,
    taskPriorityLabel(t.priority),
    (t.assigneeId && people[t.assigneeId]?.name) || '',
    t.dueDate ?? '',
    t.estimatedHours == null ? '' : String(t.estimatedHours),
  ])
  // Quote every field and double any inner quote: a task title with a comma
  // in it is the normal case, not the edge case.
  const csv = [header, ...lines]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n')
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `tahi-tasks-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
  showToast(`Exported ${visible.length} ${visible.length === 1 ? 'task' : 'tasks'}`)
}, [visible, people, showToast])
```

It exports `visible`, not `tasks`: the menu sits above a filtered list and exporting something other than what the user is looking at is the wrong answer. The BOM is what makes Excel open a UTF-8 CSV without mangling a client name.

- [ ] **Step 2: Update `app/(dashboard)/tasks/page.tsx`**

```tsx
import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { TasksContent } from './tasks-content'

export const metadata = { title: 'Tasks - Tahi Dashboard' }

/**
 * Tasks are the studio's own list and are never client-visible: every task
 * API is isTahiAdmin-gated, and lib/feature-tree.ts scopes the `tasks`
 * feature to ['team']. A client org that reaches this route used to land on
 * a permanent empty state built out of unreachable branches; it now goes
 * somewhere it can actually use.
 */
export default async function TasksPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) redirect('/overview')
  return <TasksContent />
}
```

Leave `app/(dashboard)/tasks/[id]/page.tsx` exactly as it is, but replace its stale doc comment (it says the old page dead-ended because its API had no GET; the GET exists now) with:

```tsx
/**
 * There is exactly one canonical task detail: the slide-over on /tasks. This
 * route stays as the deep link every notification and bookmark points at
 * (lib/notification-links.ts routes `task` here), redirecting to
 * /tasks?task=<id>, which deep-opens the panel on load.
 */
```

- [ ] **Step 3: Verify**

Run: `npm run type-check && npm run lint && npm run build`
Expected: type-check exit 0, lint clean, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/tasks/tasks-content.tsx" "app/(dashboard)/tasks/page.tsx" "app/(dashboard)/tasks/[id]/page.tsx"
git commit -m "feat(tasks): replace the tasks surface with the ported rail, list, board and week"
```

### Task 6.6: Close Slice 6

- [ ] **Step 1: Full check**

Run: `npm run type-check && npm run lint && npx vitest run && npm run build`
Expected: all clean.

- [ ] **Step 2: Hand to the lead.** This is the slice the lead smoke-tests on the deployed URL before Slice 7 starts.

---

## Slice 7: e2e, cleanup and docs (Wave D, after 6)

**Files:**
- Modify: `e2e/helpers.ts`, `app/(dashboard)/requests/[id]/request-detail.tsx`, `STATUS.md`, `TASKS.md`
- Create: `e2e/tasks.spec.ts`

**Lead's note for Slice 7 (2026-09-05, after merging Slice 1):** against the local QA harness (`..	ahi-qa`, port 3179, seeded D1, ship-studio bypass) `e2e/requests-list.spec.ts` plus `e2e/requests-detail.spec.ts` give 6 passed and 11 skipped, identically before and after the Slice 1 merge, so Slice 1 regressed nothing the suite can see. But every `requests-detail.spec.ts` test skips, and the list's shift-click and expanded-row tests skip too, so those parts of the Requests surface are not covered locally. A headless probe of the same detail page shows the h1, six `dt` rows, the Activity filter tablist and the Delivery card all present, so the skip is in the harness (`openFirstRequest` / `portedDetailIsOn`), not the page. Find out why (first candidate: the `a[href^="/requests/"]` click lands somewhere the URL assertion does not expect, or the `Delivery steps` list is matched by attribute rather than implicit role) and make the detail spec run for real before adding `e2e/tasks.spec.ts` on the same helpers.

### Task 7.1: Lift the duplicated e2e scaffolding

- [ ] **Step 1: Add the shared pieces to `e2e/helpers.ts`**

```ts
import { expect, type Page } from '@playwright/test'

/**
 * The dev-only Ship Studio auth bypass, as a storageState. Six specs had
 * this block copy-pasted verbatim; it resolves to the Tahi admin org, which
 * is what every admin-surface spec needs.
 */
export const shipStudioStorageState = {
  cookies: [
    {
      name: 'tahi-ship-studio',
      value: '1',
      domain: 'localhost',
      path: '/',
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: 'Lax' as const,
    },
  ],
  origins: [],
}

/**
 * Definition-of-Done check: nothing may scroll the page sideways. Run it at
 * 375px on every surface that ships.
 */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, 'the page scrolls horizontally').toBeLessThanOrEqual(1)
}

/** True on the mobile-safari project, where tables become card lists. */
export async function isNarrow(page: Page): Promise<boolean> {
  return (await page.evaluate(() => window.innerWidth)) < 768
}
```

Leave `primePage` exactly as it is.

- [ ] **Step 2: Verify**

Run: `npx playwright test e2e/requests-list.spec.ts --project=chromium`
Expected: unchanged, all pass. (The existing specs keep their inline copies for now; this slice only adds the shared ones for the new spec to use. Converting the other six is separate work and is not in this plan.)

- [ ] **Step 3: Commit**

```bash
git add e2e/helpers.ts
git commit -m "test: share the ship-studio storage state and the horizontal-scroll check"
```

### Task 7.2: `e2e/tasks.spec.ts`

- [ ] **Step 1: Write the spec in full**

```ts
import { test, expect, type Page } from '@playwright/test'
import { primePage, shipStudioStorageState, expectNoHorizontalScroll, isNarrow } from './helpers'

/**
 * Tasks: the happy path.
 *
 * Auth is the dev-only Ship Studio bypass, which resolves to the Tahi admin
 * org, so everything here runs as an admin on both the chromium and the
 * mobile-safari (iPhone 13) projects.
 *
 * These assert on chrome, never on a particular task existing. Anything that
 * needs a row bails out early when the list is empty, so a fresh database
 * does not turn into a red suite.
 *
 * There is no super-admin gate on this surface, so unlike the Requests specs
 * there is no test.skip scaffolding here. Do not add any.
 */

test.use({ storageState: shipStudioStorageState })

function viewTabs(page: Page) {
  return page.getByRole('tablist', { name: 'Tasks view' })
}

async function gotoTasks(page: Page): Promise<void> {
  // A dev server compiling a sibling route can reset the first connection,
  // which Chromium reports as an aborted navigation. One retry keeps the
  // spec honest about the page rather than the harness.
  try {
    await page.goto('/tasks')
  } catch (err) {
    if (!String(err).includes('ERR_ABORTED')) throw err
    await page.goto('/tasks')
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Tasks', { timeout: 20_000 })
}

/** Wait for the list to settle into rows, cards, or an empty state. The
 *  shell keeps an SSE notification stream open, so networkidle never fires. */
async function listSettled(page: Page): Promise<void> {
  await page
    .locator('table, [data-mobile-cards], text=Nothing on the list')
    .first()
    .waitFor({ state: 'attached', timeout: 20_000 })
    .catch(() => {})
}

test.describe('Tasks', () => {
  // A fresh context looks like a first visit, so the product tour spotlight
  // would sit over the page and swallow every click and Tab press below.
  test.beforeEach(async ({ page }) => { await primePage(page) })

  test('the page loads with three peer views', async ({ page }) => {
    await gotoTasks(page)
    const tabs = viewTabs(page)
    await expect(tabs).toBeVisible()
    await expect(tabs.getByRole('tab')).toHaveCount(3)
    await expect(tabs.getByRole('tab', { name: 'List', exact: true })).toHaveAttribute('aria-selected', /true|false/)
    // One pill for the whole strip, not a background per button.
    await expect(tabs.locator('.tahi-seg-pill')).toHaveCount(1)
  })

  test('switching to the board shows the four task columns', async ({ page }) => {
    await gotoTasks(page)
    await viewTabs(page).getByRole('tab', { name: 'Board', exact: true }).click()
    for (const status of ['todo', 'in_progress', 'blocked', 'done']) {
      await expect(
        page.locator(`[data-board-column][data-column-status="${status}"]`),
      ).toBeVisible({ timeout: 15_000 })
    }
  })

  test('switching to my week shows the summary strip', async ({ page }) => {
    await gotoTasks(page)
    await viewTabs(page).getByRole('tab', { name: 'My week', exact: true }).click()
    // Either the strip or the clear-week empty state; both are correct
    // answers depending on what is assigned to the bypass user.
    await expect(
      page.getByText(/Overdue|A clear week/).first(),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('quick add parses the line and creates the task', async ({ page }) => {
    await gotoTasks(page)
    await listSettled(page)

    const input = page.getByPlaceholder('Add a task, press Enter')
    await expect(input).toBeVisible()

    const title = `E2E quick add ${Date.now()}`
    await input.fill(`${title} tomorrow !high`)

    // The hint chips read the line back before anything is written.
    await expect(page.getByText('High', { exact: true }).first()).toBeVisible()

    await input.press('Enter')
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 15_000 })
    // The date and the priority tokens are lifted out of the title.
    await expect(page.getByText(`${title} tomorrow`)).toHaveCount(0)
  })

  test('a row opens the detail slide-over, and Escape closes it', async ({ page }) => {
    await gotoTasks(page)
    await listSettled(page)

    const firstTitle = page.locator('[data-task-row-title]').first()
    const count = await firstTitle.count()
    test.skip(count === 0, 'No tasks in this environment to open.')

    await firstTitle.click()
    const panel = page.getByRole('dialog')
    await expect(panel).toBeVisible({ timeout: 10_000 })
    // The panel is the URL, so the link is shareable.
    await expect(page).toHaveURL(/[?&]task=/)

    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(page).not.toHaveURL(/[?&]task=/)
  })

  test('a saved view narrows the list and the count follows', async ({ page }) => {
    await gotoTasks(page)
    await listSettled(page)
    test.skip(await isNarrow(page), 'The rail is inside the Filters sheet at this width.')

    // RailLayout keeps the aside's aria-label from the Requests rail
    // ("Saved views, filters and sort"), so this locator is shared with the
    // Requests specs on purpose. If the generalisation in Slice 1 renamed it,
    // fix the label, not this test.
    const rail = page.getByRole('complementary', { name: /Saved views/i })
    await rail.getByRole('button', { name: /^Blocked/ }).click()
    // The count line is the one aria-live region on the toolbar row.
    await expect(page.getByText(/\d+ tasks?$/).first()).toBeVisible()
  })

  test('the filters sheet opens on a phone', async ({ page }) => {
    await gotoTasks(page)
    test.skip(!(await isNarrow(page)), 'Desktop shows the rail directly.')

    await page.getByRole('button', { name: 'Filters' }).click()
    await expect(page.getByRole('dialog', { name: /Filters and sort/i })).toBeVisible()
    await page.getByRole('button', { name: /^Show \d+$/ }).click()
    await expect(page.getByRole('dialog', { name: /Filters and sort/i })).toBeHidden()
  })

  test('nothing scrolls sideways at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await gotoTasks(page)
    await listSettled(page)
    await expectNoHorizontalScroll(page)

    await viewTabs(page).getByRole('tab', { name: 'Board', exact: true }).click()
    // The board scrolls INSIDE its own scroller; the page must not.
    await expectNoHorizontalScroll(page)

    await viewTabs(page).getByRole('tab', { name: 'My week', exact: true }).click()
    await expectNoHorizontalScroll(page)
  })
})
```

`[data-task-row-title]` is emitted by `TasksList` on the title node in both the table row and the mobile card (Slice 3 Task 3.2 Step 2). If it is missing, fix Slice 3 rather than weakening this locator.

`test.use({ storageState })` at module scope is the pattern the six existing specs already use, so keep it there rather than inside the `describe`.

- [ ] **Step 2: Run the spec**

Run: `npx playwright test e2e/tasks.spec.ts --project=chromium`
Expected: 8 passed (or 7 passed 1 skipped when the environment has no tasks).

Run: `npx playwright test e2e/tasks.spec.ts --project=mobile-safari`
Expected: 8 passed (or with the two width-gated skips inverted).

- [ ] **Step 3: Commit**

```bash
git add e2e/tasks.spec.ts
git commit -m "test(tasks): playwright happy path across all three views"
```

### Task 7.3: Fix the request detail's tasks panel

- [ ] **Step 1: Make the rows links and the wizard revalidate**

In `app/(dashboard)/requests/[id]/request-detail.tsx`:

- In `RequestTasksPanel` (from line 3720), wrap each row in a link to `/tasks?task=${t.id}` so the panel stops being a dead end. Keep the row's existing badge, title and priority layout; only the wrapper changes.
- Change the wizard mount at line 2819 to pass the tasks key, using the prop added in Slice 2:

```tsx
  mutateKeys={[apiPath(`/api/admin/tasks?requestId=${requestId}`)]}
```

so a task created from the wizard appears in the panel without a manual refresh.

- [ ] **Step 2: Verify**

Run: `npm run type-check && npm run lint && npx playwright test e2e/requests-detail.spec.ts --project=chromium`
Expected: all clean.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/requests/[id]/request-detail.tsx"
git commit -m "fix(requests): the tasks panel links out and refreshes after the wizard"
```

### Task 7.4: Docs

- [ ] **Step 1: Update `STATUS.md`**

Delete the stale line at `STATUS.md:55` about the `/tasks/[id]` GET handler being missing. Add the Tasks surface to the trusted list with the date, and note the two behaviours a reader will otherwise be surprised by:

```markdown
- **Tasks (ported 2026-09-05).** Three views: List, Board, My week. Rail
  toolbar shared with Requests. Detail is a slide-over; `/tasks/<id>` still
  redirects to `/tasks?task=<id>`, which is where every notification link
  lands. Tasks are studio-only: a client org is redirected off the route.
  My week deliberately ignores the rail and always shows your own open work.
```

- [ ] **Step 2: Update `TASKS.md`**

Tick the Tasks port line in the active phase block, with a note recording what shipped and what was deliberately left out (the Activity card, and the fact that `tasks.trackId` / `tasks.position` remain orphaned because nothing reorders tasks within a track).

- [ ] **Step 3: Commit**

```bash
git add STATUS.md TASKS.md
git commit -m "docs: record the tasks port and drop the stale detail-page note"
```

---

## Definition of Done

CLAUDE.md rule 8 applies in full: a task only flips to `[x]` after all seven checks, and a slice failing any of 4 to 7 stays open even if 1 to 3 pass.

### Every slice, without exception

| # | Check | Command | Expected |
|---|---|---|---|
| 1 | Type-check | `npm run type-check` | exit 0, no output |
| 2 | Lint | `npm run lint` | `No ESLint warnings or errors` |
| 3 | Unit tests | `npx vitest run` | every test file passes; no test file added by this slice is skipped |
| 4 | Build | `npm run build` | succeeds. This is the check that catches a non-method export from a route file, which `tsc` accepts and `next build` rejects. |
| 5 | Deploy | pushed to main by the lead | the Cloudflare deploy is green, and prod is released after the lead approves the GitHub environment |
| 6 | Live smoke | on the deployed URL, not localhost | see per-slice below |
| 7 | Evidence | screenshot or note in the commit body or the PR | confirms 5 and 6 |

Plus, for every slice that renders anything:

- **375px:** no horizontal scroll on the page (the board scrolls inside its own scroller), every touch target at least 2.75rem.
- **Dark mode:** the page rendered with the `.dark` class on `<html>`, no contrast regressions, no element that only reads in light mode. Everything on this surface is token-driven, so a regression here means a hardcoded value slipped in.
- **MCP parity:** if the slice added an API capability, the matching worker tool exists in `workers/mcp-server/src/index.ts` and has been called once against staging.

### Slice 1: Foundation

- Live smoke is on the **Requests** surface, because that is what this slice touches: load `/requests`, confirm the rail, a filter chip, the mobile Filters sheet, the count, Save as default and Reset to default all still work, and open a request detail to confirm the rail cards and the Time card are unchanged.
- `npx playwright test e2e/requests-list.spec.ts e2e/requests-detail.spec.ts --project=chromium` passes: this slice's whole risk is regressing Requests while generalising its primitives.
- No new MCP capability, so parity is not applicable.

**Lead's evidence (2026-09-05):** merged as d26962a7 (tasks/foundation + tasks/foundation-fix). Type-check clean, lint zero errors, 1541 unit tests green, `npm run build` green, deploy green. Playwright `requests-list` + `requests-detail` on the local QA harness: 6 passed, 11 skipped, identical to the pre-merge baseline (see the Slice 7 note). Live smoke on production as Liam: rail present, six filter selects open as portalled menus, a Status chip appears and the count follows (30 to 12) and clears, Save as default and Reset to default present; a request detail shows Delivery, Tasks, Files, Time, Actions, Discovery calls, Details, People and Checklists cards, the Time card, six Details rows with five inline editors, the activity filter and the spine. Slice 1 is DONE.

### Slice 2: API, schema, MCP

- `run_migration` with `{"name":"0087"}` returned `status: "applied"` against staging **and** prod, and the response is quoted in the commit body.
- Live smoke via MCP rather than a browser: call `create_task` with `type: 'internal_client_task'` and an `orgId`, then `get_task` and confirm the type came back as `internal_client_task` rather than `client_task`. Call `create_task` with `subtasks: ['One','Two']` and `list_task_subtasks` to confirm both landed. Call `bulk_update_tasks` with one real id and one invented one and confirm `updatedCount` is 1. Call `promote_task_to_request` on a client task and confirm the request exists and the task is linked. Delete the test rows afterwards with `delete_task`.
- MCP parity: `delete_task`, `bulk_update_tasks`, `list_task_dependencies`, `delete_task_subtask`, `create_task_template`, `update_task_template`, `delete_task_template`, `promote_task_to_request`, `list_task_calls`, `create_task_call` all present and each called once.

### Slice 3: List view leaf

- Nothing is mounted yet, so the live smoke is deferred to Slice 6 and recorded there. This slice's own gate is checks 1 to 4 plus a note in the commit body naming the exact props Slice 6 must pass.

### Slice 4: Board view leaf

- Same: checks 1 to 4, plus `npx vitest run lib/tasks-board-items.test.ts` green, plus a note naming the props.

### Slice 5: Detail, create dialog and My week

- Same: checks 1 to 4, plus a note naming the props.

### Slice 6: Rail, shell and wiring

This is the slice the surface actually ships in, so its smoke is the full one, on the deployed URL, as the Tahi admin.

- [x] `/tasks` loads with the rail, three view tabs, the search box and the count.
- [x] Quick-add `chase the deposit @<a real client> friday !high` creates a task with the client linked, Friday's date, High priority and Internal level, and the tokens are gone from the title.
- [ ] A saved view (Overdue) narrows the list and the count follows; Clear filters brings it back.
- [ ] A filter select opens as a portalled menu that is not clipped by the rail, and its chip appears and clears.
- [ ] Save as default, reload the page, and the view, saved view, filters and sort all come back. Then wander off it and confirm Reset to default returns.
- [x] A row click opens the slide-over, the URL gains `?task=`, and reloading that URL reopens it.
- [ ] In the detail: rename the title, change the level to Tahi and confirm the client and the request both clear, set a client and confirm the level becomes Internal, link a request and confirm the client adopts it, set a due date, set an estimate, add and tick a subtask, add a blocker and confirm the Waiting on card appears, remove it again.
- [ ] Start the timer, stop it, and confirm the entry lands in the Time card and on `/time`.
- [ ] Promote a client task to a request, choosing a category and a size, then follow the `Open TR-xxxx` button and confirm the request exists with the right category.
- [ ] Select three rows, Complete them from the bulk bar, and confirm the toast counts three.
- [ ] The overflow menu: run **AI: break work into tasks**, accept its drafts, and confirm they appear in the list without a manual refresh. Open **New from template** and confirm the dialog arrives with the template's title, note, priority, estimate and subtasks already filled, then create and confirm the subtasks actually landed. Run **Export CSV** with a filter active and confirm the file holds only the filtered rows and opens cleanly in Excel with a client name intact.
- [ ] Board: drag a card between two columns and reload to confirm it stuck. Use the column composer in In Progress and confirm the task is created in that column, not in To Do.
- [ ] My week: drag a task onto Thursday and confirm the due date changed. Confirm the rail's filters do not affect this view.
- [x] Deep link check: open a notification that points at a task and confirm `/tasks/<id>` still redirects and opens the panel.
- [ ] Sign in as a client org and confirm `/tasks` redirects to `/overview`.
- [ ] 375px: all three views, no horizontal scroll, the Filters sheet opens and its `Show N` closes it, every tick and row is at least 2.75rem.
- [ ] Dark mode: all three views plus the detail panel, with particular attention to the level chips (which use `color-mix` against `--color-bg`) and the promoted banner.

**Lead's evidence (2026-09-05):** merged in 280a5c8f (`tasks/shell-fix`), plus the lead's 7958afc1 (the list's Task column was 999,515px wide: `width: '100%'` on a size-contained cell; now `auto` with a 12rem floor, measured live at 790px with all five columns). Type-check, lint, 1621 unit tests and the build green; deployed 7958afc1. Local QA harness (seeded D1 with 0087 applied by hand): desktop list with all columns and chips, board with To Do / In Progress / Blocked and "Add task" composers, My week with the inert-rail note, the slide-over from a row with `?task=` in the URL, 375px with no horizontal scroll, dark mode on the list, no console errors. Production as Liam (narrow, hidden window, card layout): rail, three tabs and the count render; quick add `Lead smoke chase the deposit @SafeRec friday !high` created an Internal task on SafeRec due 2026-09-11 at High with the tokens stripped (API-verified) and the count went 6 to 7; the card opened the slide-over and the URL gained `?task=`; Level to Tahi cleared the client in the panel and on the server; `/tasks/<id>` redirected to `/tasks?task=<id>` with the panel open; Board showed "Add task" composers; the header overflow menu offered AI: break work into tasks and Export CSV (no templates exist in production, so no template section); the smoke task was deleted. Not exercised live: bulk complete, promote, timer, AI wizard run, Save as default reload, CSV download, board drag, My week drag (headless or narrow-window limits; the e2e slice covers the drags and the default). Ticked items below reflect this.

### Slice 7: e2e, cleanup, docs

- [ ] `npx playwright test e2e/tasks.spec.ts --project=chromium` and `--project=mobile-safari` both pass against the dev server.
- [ ] `npx playwright test e2e/requests-detail.spec.ts --project=chromium` still passes after the tasks-panel change.
- [ ] On the deployed URL: from a request detail, click a row in the Tasks panel and confirm it opens the task; run the AI wizard from a request and confirm the new tasks appear in the panel without a manual refresh.
- [ ] `STATUS.md` and `TASKS.md` read true to what actually shipped, including what was deliberately left out.

**Lead's evidence (2026-09-05):** merged as the e2e-fix branch; type-check, lint, 1621 unit tests and the build green. Against the fresh QA server on the merged main: `e2e/tasks.spec.ts` chromium 15 passed 1 skipped (after the lead widened two title-field waits to 30s, the dev server compiles the single-task route on first hit), mobile-safari 10 passed 6 skipped (width-gated halves, each stated); `e2e/requests-detail.spec.ts` chromium 7 passed 1 skipped (the seed's first request has no description) where every test skipped before; `e2e/requests-list.spec.ts` chromium 7 passed 2 skipped (no seeded sub-requests; the phone case). Production after the deploy of 1fee7f8a, as Liam: a task linked to a request renders in the request detail's Tasks panel as a link to `/tasks?task=<id>` (2.8rem tall, focus ring, tabbable); the smoke task was deleted afterwards. All seven slices are merged, deployed and verified; the port is DONE bar the follow-ups in the revision table.


---

## Self-review against the prototype spec

Every numbered section of the prototype spec, and where this plan covers it.

| Prototype section | Covered by |
|---|---|
| 0. Sources (tasks.jsx missing) | Task 1.1 |
| 1. Module shape, glyphs | Task 1.13 (`LEVEL_ICON`, the Leaf and Tick glyphs); the `TimerGlyph` comes free from `TimeCard`'s own `PauseGlyph` |
| 2. Fixture data model, levels, priorities, templates, helpers | Task 1.2 (`TASK_LEVELS`, filters, sort), Task 1.4 (`formatHours`, `subProgress` equivalent), Slice 2 Task 2.1 (`estimatedHours`), Slice 5 Task 5.2 (templates) |
| 3. Page shell, subtitle, client block, header actions | Slice 6 Tasks 6.4 and 6.5. The client block is replaced by a redirect (Decision 1). |
| 4. Toolbar: rail, selects, portalled menus, mobile sheet, chips, SaveDefault, SegTabs | Tasks 1.11, 1.12, 6.2, 6.3 |
| 5. Filters, saved views, sort, search, persistence | Tasks 1.2, 6.1 |
| 6. Quick add and its grammar | Tasks 1.3, 3.1 |
| 7. List view: grid, header, rows, expand panel, selection, bulk bar, tick | Task 3.2 |
| 8. Board view: columns, cards, drag, quick add, scrollbar | Tasks 4.1, 4.2 (the scrollbar comes free from `KanbanBoard`) |
| 9. My week planner | Tasks 1.4, 5.3 |
| 10. Mobile cards | Task 3.2 Step 5 |
| 11. Empty states | Task 3.2 Step 6, Task 5.3 |
| 12. TasksDetail slide-over | Task 5.1 |
| 13. Consistency rules | Task 1.5 |
| 14. `tsk-` CSS reference | Every component task quotes the values it needs; `.tsk-card-foot` is dropped as dead (stated up front) |
| 15. Reused `req-` classes | Tasks 1.11, 1.12 and the component tasks, all of which compose repo primitives rather than porting CSS |
| 16. Interaction state inventory | Ground rules (hover, focus, active, disabled on every control) plus the per-component specs |
| 17. Port notes 1 to 16 | 1: Task 1.1. 2: Task 3.2 Step 2 (widths folded in). 3: dead props dropped up front. 4: `.tsk-card-foot` dropped. 5: Task 3.2 Step 4 (bulk bar gated on readOnly). 6: Task 5.1 (dependency add and remove). 7: Task 2.7 and Task 5.1 Step 6 (category and size chosen). 8: Decision 13. 9: `DataTable` owns the column sort and the rail owns its own, so both survive; the done-last rank lives in `compareTasks` only, which is stated in Task 1.2. 10: Task 1.13 (`RequestChip` deep-links). 11: Task 5.1 Step 2 (`contentKey`). 12: `EXTRA_REQUESTS` dropped up front. 13: Task 5.1 Step 3 (leaf radius kept on the promoted banner). 14: Task 3.2 Step 2 (container query, explicitly not a media query). 15: covered by 9. 16: Task 5.3 (My week ignores the rail). |

Every defect in the repo audit, and where it is fixed.

| Audit defect | Fixed in |
|---|---|
| 1. New-task subtasks silently dropped | Task 2.2 |
| 2. POST does not validate priority | Task 2.2 |
| 3. Bulk, from-template, subtasks, dependencies and calls have no scoping | Tasks 2.5, 2.6 |
| 4. `updatedCount` is a lie | Task 2.5 |
| 5. Scoped members lose every Tahi-internal task | Task 2.3 |
| 6. Status tone drift across seven copies | Task 1.6 plus every component reading `TASK_STATUSES` / `TASK_STATUS_CONFIG` |
| 7. Dependencies read-only in the product | Task 5.1 Step 4 |
| 8. `RequestTasksPanel` never revalidates and its rows are dead ends | Tasks 2.8, 7.3 |
| 9. `tasks.trackId` / `tasks.position` orphaned | **Not fixed.** Nothing reorders tasks within a track, and inventing that is a feature, not a port. Recorded in `TASKS.md` in Task 7.4. |
| 10. `/api/admin/tasks/[id]/calls` orphaned | MCP tools added in Task 2.9 make it reachable; no UI is added, and that is stated. |
| 11. AI wizard loses structure | Task 2.8 (estimate becomes a field; category stays in the note because a task has no category column) |
| 12. No index on `assignee_id` | Task 2.1 |
| 13. `STATUS.md:55` stale | Task 7.4 |
| 14. `console.error` in the wizard route | Task 2.8 |
| 15. Non-admin code paths unreachable | Task 6.5 Step 2 (redirect) plus the wholesale replacement |

Two things the plan deliberately leaves open, so nobody thinks they were missed:

- **The saved default is browser-local.** Inherited from the Requests rail. Fixing it means persisting the snapshot server-side against a settings key, for both surfaces at once.
- **The Activity card.** Needs a per-task event table and a write on every mutation. It is the one prototype card this port does not ship.

---

## Revision, 2026-09-05: corrections against the repo

The first draft of this plan was written against the audit rather than the files. Everything below was verified in the tree at `51ef34b` and corrected in place. If you are holding a copy of the earlier version, these are the differences that matter.

| Was | Is | Why |
|---|---|---|
| Migration `0086` | Migration **`0087`** | `0086` is taken by `drizzle/migrations/0086_invoice_pay_link_and_terms.sql` and by the `name: '0086'` entry in the runtime runner. The old number would have collided with a live migration. |
| `requireAccessToOrg` imported from `@/lib/access-scoping`, returning a boolean | Imported from **`@/lib/require-access`**, returning **`NextResponse \| null` where null means allowed** | The helper does not live where the plan said and does not return what the plan said. `lib/task-access.ts` exported `checkTaskAccess` with an `ok` boolean built straight off it, which is truthy exactly when the caller is denied. It is now `guardTask`, with the repo's own short-circuit contract. |
| Task 2.3 rewrote `guardTaskAccess` to return `boolean` and said "keep the existing call sites unchanged" | Keeps `Promise<NextResponse \| null>` and only drops the `getOrgScope` branch | All three call sites read `const denied = await guardTaskAccess(...); if (denied) return denied`. A boolean would have inverted every one of them. The `D1Database` parameter type was also wrong; it is the local `Drizzle` alias. |
| `coerceTaskLinks` forced `client_task` on any task carrying a request | Only repairs a Tahi task that holds a client; an Internal task with a request stays Internal | It contradicted `setTaskRequest` in the same file, and its own Task 2.2 test (`drops the client and the request on a tahi_internal task`) was unsatisfiable against it. The POST route now runs `setTaskLevel` before `coerceTaskLinks`, which is what makes an explicit `tahi_internal` clear the links. Recorded as Decision 16. |
| The promote route built its request with `drizzle.insert(schema.requests).values({ ..., createdById })` | A `sql` INSERT mirroring `POST /api/admin/requests`, plus `emitRequestCreated` | `requests` has no `createdById` (it is `submitted_by_id`); the request number is assigned atomically per org inside the INSERT and would have been left null; the modern `size` column was never written, only the legacy `type`; and skipping the event meant automations and outgoing webhooks would never see a promoted request. Task priority is also clamped, because a request's scale has no `urgent` (Decision 17). |
| `BoardItem.client = row.orgName` | `client: { id, name }` | `BoardItem.client` is a `BoardAssignee`, not a string (`kanban-board.tsx:50`). The test asserted the string too. `people[].role` is a free-text label, and `reference` is a short display string, so a raw request uuid no longer goes into it. |
| `primaryAction.successMessage: (n) => ...` | `verb: 'marked done'` | `BulkAction.successMessage` is a `string`, not a formatter (`bulk-action-bar.tsx:73`). The counted message comes from `verb` plus `itemNoun`. |
| `var(--radius-xs)`, three places | `var(--radius-sm)` | `--radius-xs` does not exist in `app/globals.css`. A missing token drops the rule silently. |
| Slice 5 imported `TaskSubtask` / `TaskPerson` from Slice 3's `tasks-list.tsx`, and Slice 6 imported `TaskTemplateOption` from Slice 5's dialog | All shared shapes live in **`components/tahi/tasks/task-types.ts`**, created by Slice 1 | Slices 3 and 5 are declared parallel. Slice 5 could not have type-checked in its own worktree. |
| `app/globals.css` edited by Slice 3 but listed nowhere | Listed in the slice map and Slice 3's file block | Ownership has to be visible to stay disjoint. |
| `TasksHeaderActions` had `onAiWizard`, `onNewFromTemplate` and `onExportCsv` with no implementation anywhere | Slice 6 Task 6.5 point 7 implements all three; `NewTaskDialog` gains `initialTemplateId` | Three dangling props, one of which (the AI wizard) Decision 9 explicitly promised to carry across. |
| List columns marked sortable with no `sort` wiring | Stated as uncontrolled `DataTable` sort, with `sortValue` per column and the done-last caveat written down | `DataTable` sorts internally when `sort` is omitted, which is what keeps the prototype's two independent sorts. |
| Test counts: 25, 17, 11, 13, 9 | 28, 19, 10, 16, 12 | Four were miscounted; two changed because tests were added or corrected here. |
| Line references into `requests-rail.tsx` and `app/api/admin/tasks/route.ts` | Corrected, or replaced with "find it by name" | The file has moved under edits since the audit was taken. |
| `components/tahi/sidebar-card.tsx` as the extraction target | **`components/tahi/rail/sidebar-card.tsx`** | The old path already exports a different live `SidebarCard` plus `SidebarSection` that `deal-detail.tsx` imports; two components cannot share one export name in one module. Slice 5 imports from the new path. |
| Request references rendered as `TR-0042` | `#042` | The repo renders `#${String(n).padStart(3, '0')}` everywhere (list, detail, actions menu, sub-request rows, timer chip) and the chip already ships that way. |
| Decision 12: board column and saved view both `status === 'blocked'` | Saved view, rail count and Tick agree on `status === 'blocked' \|\| blockedByCount > 0`; the board column alone stays `status === 'blocked'` | The rail's number and the click's list must agree; a column must mean the status it writes. |
| Task 1.2 due filter counted done tasks as overdue while the Overdue saved view excluded them | Both read the shipped `isTaskOverdue` / `isTaskDueWithin` with the closed-status guard | The plan's own code contradicted itself; the shipped code is now quoted verbatim. |
| Task 1.3 client loop let a bare earlier name beat a later `@mention`; Task 1.4 `formatHours` had an unreachable `.replace` | Two passes (mentions first, then bare names); plain quarter-hour rounding | Quoted from the shipped code. |
| `PATCH /api/admin/tasks/[id]` body allowlist had no `type` | `tasks/api-fix` already validates `body.type` through `isTaskLevel` and re-runs the link invariants when it changes; **the lead verifies this on the merged tree with a test** | The detail panel's Level control patches `{ type, orgId, requestId }` through `lib/task-consistency` as the plan pins; without `type` on the server the links clear but the level never moves, so "change the level to Tahi" leaves a Client row with no client and "set a client" keeps `tahi_internal`. Slice 6 sends `type` in that patch and must not strip it. |
| `assigneeType` could not travel from the panel (`TaskRow` has no such field; `onPatch` is `Partial<TaskRow>`) | **The server derives it (done by the lead after the Wave B merge).** PATCH sets `assigneeType` whenever `assigneeId` is in the body and `assigneeType` is not: `team_member` when the id matches a `teamMembers` row, `contact` when it matches a `contacts` row, `null` when `assigneeId` is `null`, 400 when the id names nobody (`resolveAssigneeType` in `lib/task-access.ts`, five tests) | Reassigning a task that held `assigneeType = 'contact'` to a team member otherwise addresses the assignment notification to `{ contactId: <a teamMembers.id> }` and it reaches nobody, and clearing an assignee leaves a stale type behind a null id. Slice 6 sends `assigneeId` alone and relies on the server; it never fabricates `assigneeType`. |
| Task 5.1 Step 4 asked for a done/total fraction on the Subtasks `SidebarCard` head AND beside the progress bar | The fraction renders beside the progress bar only | `SidebarCard`'s `count` prop is a number, so a fraction cannot go in the head. The plan contradicted itself; the shipped reading stands. |

**Lead, 2026-09-05:** migration 0087 (tasks.estimated_hours, idx_tasks_assignee, idx_tasks_due) applied to production D1 with wrangler and verified (has_col 1, idx 2) ahead of the Wave B deploy.
| Task 3.2 Step 3's subtask remove button had no callback in `TasksListProps` | `TasksListProps.onRemoveSubtask?: (taskId: string, subtaskId: string) => void` (optional, landed on `tasks/list-fix`); **Slice 6 passes it**, wired to `DELETE /api/admin/tasks/[id]/subtasks/[subId]` | Otherwise the button ships dark. Removal also lives in the detail slide-over. |
| `TasksListProps.onExpandRow` fired only on expand | It also fires after a successful subtask add on a row whose count was 0 | A row that never announced itself would sit on a skeleton once its count changed. **Slice 6 must treat `onExpandRow` as idempotent** (refetching a row's subtasks twice is fine, toggling state on it is not). |
| The shared `KanbanBoard` column composer hardcodes Requests wording ("Add request", "Request title", "New request in {column}") | **Done by the lead after the Wave B merge:** `quickAddNoun?: string` on `KanbanBoardProps` (default `'request'`), threaded into the column and composer; `TasksBoard` passes `'task'` | `kanban-board.tsx` belongs to no Wave B slice. Until it lands the Tasks board's composer reads as a request composer. |
| `TasksBoardProps.people` typed inline; `TaskBoardPerson` exported from `lib/tasks-board-items.ts` | `Readonly<Record<string, TaskPerson>>` from `task-types.ts`; `TaskBoardPerson` no longer exported | Structurally identical; no consumer outside the slice. |
| `TasksWeekProps` had no way to render `#042` on a linked row | `requests?: readonly TaskRequestOption[]` (optional) | Slice 6 should pass the request options it already holds so the planner shows the reference instead of the bare word Request. |
| Known residual on the board (not fixed in Wave B) | A card in the SAME column as the dragged card still lights as a drop target inside `KanbanBoard` even though the Tasks handler ignores same-column drops | Lives in `kanban-board.tsx`; cosmetic; queued with the `quickAddNoun` change. |
| `TasksList` title column `width: '100%'` | `minWidth: '12rem'`, no width (7958afc1) | With the title cell's inline-size containment contributing nothing intrinsic, a percentage width sent the auto table layout to its 1,000,000px ceiling: the Task column measured 999,515px and the other four columns sat a screen away. Found by the lead's headless probe on the QA server after the Slice 6 merge; the list slice's fix pass had reasoned about this from the CSS specs without a browser. |
| Mobile task card (`.tsk-mc`) is a plain `div` with an `onClick` | **Follow-up for the lead or Slice 7:** give it `role="button"`, `tabIndex={0}` and Enter/Space handling, or make the title an `<a href="/tasks?task=...">` | Found on the production smoke at a narrow viewport: the card opens the panel on click but is unreachable by keyboard and announces nothing. The desktop row goes through `DataTable`'s row handler. |
| Liam's review round 1 (2026-09-06): the Level control did not slide | `fix/level-slide-fix` merged 14beaff1: every option stays pressable; Client or Internal on a clientless task is held as `pendingLevel` (the pill slides once and stays), a pointer press opens the Client picker, and picking a client folds the held level into one PATCH; a disabled active segment stays legible and keeps the tab stop in the primitive | Measured on the QA server: the pill's transform moved 328px to 166px over the 0.36s transition with Internal checked and the picker open. |
| Level chips carried a 14px client avatar Liam called too small | `fix/level-chips-vocab-fix` merged 547f4065: the chip reads "Internal / Kowtow" (client name text, ellipsed, full name in the title), no avatar; board cards keep the icon-only compact chip | Liam: "maybe we can just not have that". |
| "Subtasks" wording | "Checklist" and "checklist item" everywhere people read (detail card, list expand panel, create dialog, badge, toasts); `KanbanBoard.rollupNoun` names the rollup per board ("checklist item" on Tasks, "sub-request" on Requests, 09b5c47c); table, props and API paths unchanged | Vocabulary set by the lead: request, sub-request, task, checklist item. |
| Owner home "Pipeline ahead" had no chart | `fix/pipeline-chart-fix` merged 43399906: `lib/pipeline-stage-chart.ts` groups the forecast's `byStage` into ordered bars (count and weighted money) with tests; the bars render under the stat row (placement fixed by the lead) | Liam: "pipeline chart doesn't render"; the card had never had one. |
| The pipeline forecast counted archived deals | `app/api/admin/reports/pipeline-forecast/route.ts` excludes `closeReason = 'archived'` like the deals list (b7dbe2b8) | Found while smoking the new stage bars on production: the card read 3 open deals against the list's 2, and the weighted headline carried an archived Discovery deal worth NZ$57k upfront. After the fix the forecast reports 29 deals, NZ$2,150 weighted upfront. The old NZ$27.4k headline was that archived deal. |
| Level pill on production, measured in a hidden tab | Not measurable there: the segmented control positions its pill on requestAnimationFrame, which a hidden tab never fires; the QA server measurement (328px to 166px over 0.36s) is the evidence | Liam's window was backgrounded during the smoke. |
