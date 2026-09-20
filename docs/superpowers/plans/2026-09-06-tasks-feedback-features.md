# Tasks Feedback Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three things Liam asked for the day the rebuilt Tasks page landed: blockers that can be a request or a task and that also appear on the request detail, a small calendar inside My week, and task creation that matches request creation (talk to the AI, or hand it a document).

**Architecture:** Three independent features, three slices, three worktrees, disjoint file ownership. Each one extends a surface that already exists rather than inventing a fourth pattern.

- **Blockers** become one polymorphic edge table (`work_blockers`) with a shared server module, so the cycle rule, the access rule and the open-blocker rule are each written once and both surfaces read the same answer. `task_dependencies` stays on disk, frozen, for one release.
- **My week** gains a seven cell week strip folded into the summary plate it already renders, built on a new pure helper next to `buildWeekGroups`, so the shape of the strip is testable without a DOM and the component gains no props.
- **Task creation** grows the two entry points requests already has: a conversational panel inside the create dialog with a hand-back to the form, and a document mode that extracts text (or hands a PDF straight to Claude as a document block) and drafts from it. Nothing is written until a human presses Create.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind v4 with CSS custom properties from `app/globals.css`, SWR, Drizzle ORM on Cloudflare D1, the Anthropic TypeScript SDK on Claude Haiku 4.5, Vitest (node environment, pure functions only, no jsdom in this repo), Playwright for the happy paths.

---

## What Liam asked for

| Quote | Reading | Slice |
|---|---|---|
| "blockers can be requests or other tasks. i also want blockers in the requests panel too. i like that." | One blocker model across both surfaces, and the rail card he likes ported to the request detail. | **A** |
| "lets change the my week into having a nice little calendar replication in there. it looks nice now, but that would help it." | A calendar reading inside My week, additive to what is there. "It looks nice now" is a constraint: do not restructure the plate. | **B** |
| "tasks creation should be similar to requests, where i can upload a doc or like just talk to ai to make them automatically as well." | Parity with the request intake, both modes. | **C** |

**One correction to the brief, stated up front so nobody hunts for it.** The request side has **no** document upload today. `components/tahi/new-request-dialog.tsx:790` and `:2307` both read "You can add files, images, and voice notes after submitting", and neither AI route accepts a file. Document mode is net new work, not a port. What Slice C ports from the request wizard is the panel-plus-drawer split, the hand-back to the form, the progress line, and the honest failure semantics. The document half it builds.

---

## Decisions the lead has already made (do not re-litigate)

### Vocabulary and house rules

1. **The nouns are `request`, `sub-request`, `task`, `checklist item`.** Not subtask, not child request, not to-do. `task_subtasks` keeps its table name (renaming a live table is not this plan's business) but every string a human reads says checklist item. `TaskDependencyRow` is renamed `BlockerRow` because a dependency and a blocker were already the same thing under two names.
2. **No em dashes and no en dashes anywhere**, including comments, commit messages, JSX text, system prompts and toast copy. Commas, colons, full stops, parentheses.
3. **No `any`.** Use the real type or `unknown` plus a narrowing check. No `as` casts that skip a check, with the one existing exception: `database as ReturnType<typeof import('drizzle-orm/d1').drizzle>`, which every route in the repo already does.
4. **CSS custom properties only.** No hardcoded hex outside the sidebar. Every `var(--token)` must already exist in `app/globals.css`; grep before you paste, because a missing token resolves to nothing and disappears silently in light mode.
5. **Every pure helper gets a Vitest file, written before the implementation.** Vitest runs in the node environment with no jsdom and no testing-library. There are no render tests in this repo and this plan does not add the first one.
6. **Migrations are additive and idempotent.** `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `INSERT OR IGNORE`. Nothing is dropped, nothing is renamed, no column is removed. Every migration file is also an inline entry in the `MIGRATIONS` array of `app/api/admin/db/migrate/route.ts`, because Workers have no filesystem and a `.sql` file alone never reaches D1.
7. **MCP parity (CLAUDE.md rule 14).** Every new API capability gets a tool on `workers/mcp-server/src/index.ts`. The local `mcp-server/index.ts` is dormant and must not be extended.
8. **Nothing is pushed by an implementer.** The lead reviews each diff and pushes.

### Slice A: blockers

9. **One polymorphic table, `work_blockers`.** Columns `blocked_type`, `blocked_id`, `blocker_type`, `blocker_id`, following the `requestParticipants` precedent (`db/schema.ts:502`, `participantId` plus `participantType`). Foreign keys are impossible on a polymorphic column, and that is the entire cost of going polymorphic. It is paid deliberately: the alternative, a second `request_dependencies` table plus a third for the cross pairs, means the cycle check, the access check and the count are each written three times.
10. **`task_dependencies` is frozen, not dropped, and not dual-written.** Migration 0088 copies its rows into `work_blockers` with `INSERT OR IGNORE`. After that the old table is a read-only snapshot for one release, in case a rollback is needed. Dropping it is a follow-up for the lead, recorded in Slice D. The `/dependencies` routes survive as thin aliases over the new module so the three shipped MCP tools and any saved agent transcript keep working through the deploy window.
11. **Only one hard delete exists in the whole codebase**, `DELETE /api/admin/tasks/[id]` (`app/api/admin/tasks/[id]/route.ts:292`). Requests are soft-deleted to `archived` (`app/api/admin/requests/[id]/route.ts:318`), and `archived` is a closed status, so an archived request stops counting as a blocker on its own. That means exactly one `sweepBlockers` call site, not four. Verified by `grep -rn "delete(schema.requests)\|delete(schema.tasks)" app/ lib/`, which returns one line.
12. **Open is type-dependent, and the definition lives in one file.** A task blocker is open when its status is not in `TASK_CLOSED_STATUSES` (`['done']`). A request blocker is open when its status is not in `REQUEST_CLOSED_STATUSES` (`['delivered', 'cancelled', 'archived']`). Neither list is ever written into SQL: both list routes call the same JavaScript helper over a batch of ids, which also fixes the existing `dependsOnStatus !== 'done'` literal at `app/api/admin/tasks/route.ts:168` that already disagreed with every other reader.

    **Both lists come from `lib/status-config.ts`**, `TASK_CLOSED_STATUSES` at line 190 and `REQUEST_CLOSED_STATUSES` at line 188. `lib/requests-views.ts:69` exports the identical array under the name `CLOSED_STATUSES`, and `lib/blockers.ts` must **not** import that one: taking the two halves of one idea from two modules is the drift this decision exists to prevent, and it would also make the pure blocker module depend on the requests rail for no reason. `lib/status-config.ts` imports only `type BadgeTone`, so the node Vitest run stays clean (`lib/tasks-board-items.test.ts` already reaches it the same way).
13. **Clients never see a blocker, not even the count.** `request-detail.tsx` is one component for two audiences (`apiBase` flips at line 597). The Blocked by card is gated on `isAdmin` at render, matching `RequestTasksPanel` at line 2524, **and** the portal route never returns the data, and there is no portal blockers route. Both gates, not one. A count alone still leaks ("your request is stuck on three internal things").
14. **The request card is titled "Blocked by". The tasks card keeps "Waiting on".** The requests surface already spends "Awaiting client" (`lib/requests-views.ts:123`) and "Waiting on you" (`:132`) on `status === 'client_review'`, which is the opposite direction of causation: there the client owes the studio. Two different meanings under one phrase on one screen is worse than two phrasings of one meaning across two screens. The tasks card is not renamed because Liam has just approved it. **This is the one decision here the lead should overrule if he wants a single name; it is a two-word change at `task-detail-panel.tsx:975`, the `title="Waiting on"` on the card that opens at line 972.**
15. **A blocked request does not become a sixth spine node.** Every node in `PIPELINE_STATUSES` (`components/tahi/requests/delivery-spine.tsx:110`) is a status setter, and a blocked request is usually still `in_progress`. The spine gets an amber count chip in its header instead. `on_hold` stays the manual human stop; the blocker count is derived and coexists with any pipeline status.
16. **The board's single `warning` string is shared, not fought over.** `BoardItem.warning` is one string and `app/(dashboard)/requests/request-list.tsx:1179` already spends it on "Flagged for scope creep". One pure helper merges the two so a request that is both blocked and flagged loses neither signal.
17. **The picker searches the server.** The current one is built from already-loaded rows (`tasks-content.tsx:428`), which cannot see a paginated request or a task outside the current lens. New endpoint `GET /api/admin/blockers/search`. It does **not** reuse `GET /api/admin/search`, which checks `isTahiAdmin` only (`app/api/admin/search/route.ts:81`) and applies no team-member scoping (verified: that file contains no `resolveAccessScoping` or `getOrgScope` call at all), so a scoped teammate could see and link a client they cannot open.

    **The primitive has to move for this to work, and that is Slice A's job.** `InlineMenuField` (`components/tahi/inline-field.tsx:147`) owns its search box's `query` in local state with no way for a parent to observe it, and it re-filters `options` locally on `label` plus `keywords` (lines 180 to 183). Server-fetched candidates would therefore be invisible twice over: nothing can trigger the fetch, and anything the server matched on a title would then be filtered back out because these options carry a `node` and no `label`. Slice A adds two optional props and nothing else:

    ```ts
    /** Called on every keystroke in the search box, so a caller can fetch. */
    onQueryChange?: (query: string) => void
    /** Set when the caller has already filtered (server search). The local
     *  label/keywords pass is then skipped, because it would drop rows the
     *  server matched on a field that is not on the option. */
    serverFiltered?: boolean
    ```

    Both default to off, so the four existing call sites are untouched. `components/tahi/inline-field.tsx` and `components/tahi/__tests__/inline-field.test.ts` join Slice A's owned list. No other slice imports that module (only `task-detail-panel.tsx` and `request-detail.tsx` do, and both are Slice A files), so this creates no overlap.

    The picker's render condition also has to change. Today it is `{!readOnly && blockerOptions.length > 0 && ...}` (`task-detail-panel.tsx:1022`), which with server search would hide the picker forever, because the option list is empty until someone has typed. It becomes `{!readOnly && ...}`, and the empty state is carried by `emptyMessage`.
18. **A parent request cannot be blocked by its own sub-request, in either direction.** The parent already renders "done of total" over its children (`app/api/admin/requests/route.ts:96`). Modelling the same fact twice produces two cards that can contradict each other. Rejected at the route with a plain message.

### Slice B: My week

19. **The calendar is a seven cell week strip inside the existing summary plate, not a month grid.** My week is a week; a month grid draws four fifths of a period the plate cannot show, needs its own bucketing pass, needs a day filter that contradicts the toolbar count at `tasks-content.tsx:1063`, and breaks the view's stated promise that nothing narrows it (`tasks-week.tsx:7`). The strip costs one row inside a plate that is already there, adds paging (a precise drop target for a specific day next week, which the flat `Later` bucket cannot give), and restores the days already gone this week that `buildWeekGroups` drops by starting its loop at offset 0.
20. **The strip needs no new props, no API change and no shell change.** Everything is derived from `allRows`, which the shell already fetches unpaginated. Slice B therefore does not own `app/(dashboard)/tasks/tasks-content.tsx`, which is what makes it parallel-safe.
21. **The load bar scales to the busiest day in the visible strip**, not to an invented eight hour day. `teamMembers.weeklyCapacityHours` exists (`db/schema.ts:186`) but is not selected by `/api/admin/team-members`, and inventing a ceiling would be a lie rendered as a bar. Capacity scaling is a one column follow-up, recorded in Slice D.
22. **The strip is a drop target and a keyboard target.** The planner has no keyboard path to change a due date at all today (rows handle Enter and Space to open only, `tasks-week.tsx:310`). Seven buttons in a row with a roving tabindex is the cheapest place to fix that, and shipping a mouse-only drag surface fails Definition of Done item 5.
23. **`var(--color-brand-dark)` is not used by anything Slice B writes.** That token is defined once (`app/globals.css:21`) and never redefined inside `.dark`, so the two existing uses in `tasks-week.tsx` (lines 129 and 208) render very dark green on a near-black canvas. Slice B swaps those two for `var(--color-link)`, which is `#425F39` in light and `#93C98A` in dark. It does **not** redefine `--color-brand-dark` globally: the token is also used as a hover background (`task-quick-add.tsx:223`), so lightening it would break white-on-it text elsewhere. The wider audit is a follow-up.

### Slice C: AI and document task creation

24. **The panel-plus-drawer split is copied from `ai-request-wizard.tsx` exactly.** `AiTaskWizardPanel` (body and footer, no shell) plus `AiTaskWizard` (a `SlideOver` around the panel), mirroring lines 272 and 838 of the request wizard. The dialog mounts the panel as `view === 'ai'`; the header menu keeps mounting the drawer. Both get document mode for free.
25. **`AiTaskWizard`'s existing prop surface stays backwards-compatible.** **Two** files mount it, not one: `app/(dashboard)/requests/[id]/request-detail.tsx:2824` (`open`, `onClose`, `context`, `seed`, `mutateKeys`, `onTasksCreated`) and `app/(dashboard)/tasks/tasks-content.tsx:1021` (the same minus `seed`). Both are `dynamic(... .then(m => ({ default: m.AiTaskWizard })), { ssr: false })`, so the export name `AiTaskWizard` must survive the split. Slice A owns both files. Every new prop on the drawer is optional. Slice C must not need to edit either. `AiTaskWizardProps` is currently unexported (`ai-task-wizard.tsx:27`); exporting it is fine and breaks nothing.
26. **Honest failure semantics land before document mode, not after.** `app/api/admin/ai/task-wizard/route.ts` currently returns regex-built keyword drafts with a 200 and no flag on every failure path (lines 473 to 529), and the component renders them identically to a real answer. Adding a document path on top of that means a failed extraction quietly produces plausible tasks nobody can tell apart. Port `DEGRADED`, `AI_UNAVAILABLE` and `AI_RATE_LIMITED` from the request route (lines 61 to 77) first.
27. **A document is extracted, used, and discarded. It is not persisted.** `files.orgId` is `notNull` with a foreign key to `organisations` (`db/schema.ts:708`) and a `tahi_internal` task has no client, so there is no legal `files` row for a team-only task's brief. The alternatives are worse: forcing a client on every AI-drafted task, or a schema change this plan does not need. The draft records `Drafted from <filename>` in its note so the provenance is not lost. Attaching the source document is a follow-up that needs a nullable owner column, recorded in Slice D.
28. **Transport is JSON, not multipart.** `{ document: { filename, mimeType, dataBase64 } }` on the same POST body. Workers parse JSON for free, and the existing three-step presign flow exists to put bytes in R2, which Decision 27 says this feature does not do.
29. **Extraction scope is stated, and the refusal is explicit.** `text/plain`, `text/markdown`, `text/csv` and `application/json` are decoded to text. `application/pdf` goes to Claude as a `document` content block (base64, `media_type: application/pdf`, placed before the text block, no beta header; Haiku 4.5 is a 200K context model so the page limit is 100). `.docx` is **refused with a clear message** telling the user to export as PDF or paste the text: there is no zip reader in a Worker (`DecompressionStream` does gzip and deflate, not zip containers) and adding `mammoth` to a Workers bundle is a separate decision.
30. **Cost is bounded at the input and recorded at the output.** Four guardrails: 5 MB on the uploaded document, 40,000 characters on extracted text (with a visible truncation notice), the last 12 messages of history sent, and `max_tokens` raised from 1024 to 4096 for the drafting turn so a fifteen task `<tasks>` block cannot truncate mid-array into a silent JSON parse failure. Every call is written to `ai_cost_log` under a new `wizard` scope, so wizard spend is visible next to content spend for the first time. A rolling daily ceiling (`WIZARD_DAILY_CAP_CENTS`) returns an honest error rather than a silent downgrade.
31. **`lib/ai-cost.ts`'s Opus and Sonnet rows are corrected while Slice C is in the file.** `claude-opus-4-7` and `claude-opus-4-8` are carded at 15/75 against a real 5/25, and `claude-sonnet-5` at 3/15 against a real 2/10. `estimateCostCents` runs at insert time and the result is stored, so fixing the card changes future rows only and cannot rewrite history. This is the bug recorded in memory `bug_ai_cost_rate_card_opus_inflated.md`.
32. **The review step keeps the per-draft inline editor and gains a hand-back.** The task wizard's editor (lines 194 to 215) is better than the request wizard's and is not thrown away. What it gains is a primary "Use this draft" exit into the create form, an "I will write it myself" escape, and the four fields the current create body drops.
33. **The model picks from names, and the server resolves the ids.** Clients, requests and people go into the prompt as names; the draft comes back with names; a pure resolver maps them to ids against the lists the page already holds. A hallucinated id would file a task against the wrong client silently; a hallucinated name resolves to null and the human picks.

---

## Lead's verdicts before the build (2026-09-06)

- **Decision 14 stands.** The request card is titled "Blocked by" and the task card stays "Waiting on". The collision with "Waiting on you" on `client_review` is real, and Liam approved the task card's title yesterday.
- **Task C.7 is the lead's.** Slice C skips it; the lead adds the `ai_task_wizard` document argument to the worker MCP schema after Slice A has merged, so `workers/mcp-server/src/index.ts` is touched by one branch at a time.
- **Builds.** Slices A and C run `npm run build` once before handing over (they own route files); Slice B does not need to (no route files); the lead builds the merged tree before pushing.
- **Migration 0088** is applied to production D1 by the lead with wrangler before the deploy, as 0086 and 0087 were, and to the local QA sqlite by hand.

---

## Vocabulary map

| Concept | Wire | Where it is decided |
|---|---|---|
| blocker subject | `{ type: 'task' \| 'request', id }` | `lib/blockers.ts` `BlockerSubjectType` |
| "X is blocked by Y" | one `work_blockers` row, `blocked_*` = X, `blocker_*` = Y | `db/schema.ts` |
| the link's own id | `linkId` (was `depId`) | `lib/blockers.ts` `BlockerRow` |
| open blocker | task not in `['done']`, request not in `['delivered','cancelled','archived']` | `lib/blockers.ts` `isBlockerOpen` |
| request reference | `#042`, never `TR-0042` | `lib/blockers.ts` `requestRef`. The padding matches the two local copies (`new-task-dialog.tsx:77`, `task-detail-panel.tsx:154`); the **null branch deliberately differs**. Those two return the placeholder words `'Request'` and `'the request'` because they render inside a sentence. The shared one returns `null`, because a blocker row shows the ref or shows nothing. Do not replace the two local copies with it as a drive-by: that would silently change on-screen copy in three other places. |
| tasks rail card | **Waiting on** | `task-detail-panel.tsx` (unchanged) |
| request rail card | **Blocked by** | Decision 14 |
| week strip cell | `StripDay` | `lib/tasks-planner.ts` |
| AI draft | `TaskWizardDraft` | `lib/task-wizard-drafts.ts` |
| checklist item | `task_subtasks` row | `db/schema.ts:926` |

---

## File structure

### Created

| Path | Slice | Responsibility |
|---|---|---|
| `lib/blockers.ts` | A | The pure vocabulary: subject types, `BlockerRow`, `isBlockerOpen`, `subjectKey`, `requestRef`, `blockedWarningLabel`, `rejectObviousPair`, `isFamilyPair`, `wouldCycle` over an injected loader. No React, no drizzle. |
| `lib/blockers.test.ts` | A | Vitest for every predicate above, including a cross-type cycle and a level-batched BFS. |
| `lib/blockers-server.ts` | A | The drizzle side: `guardSubject`, `listBlockers`, `addBlocker`, `removeBlocker`, `sweepBlockers`, `openBlockerCounts`, `searchBlockerCandidates`. Lives in `lib/` because a route file may only export HTTP methods. |
| `drizzle/migrations/0088_polymorphic_blockers.sql` | A | `work_blockers` plus three indexes plus the `INSERT OR IGNORE` backfill. |
| `app/api/admin/tasks/[id]/blockers/route.ts` | A | `GET`, `POST`. |
| `app/api/admin/tasks/[id]/blockers/[linkId]/route.ts` | A | `DELETE`. |
| `app/api/admin/requests/[id]/blockers/route.ts` | A | `GET`, `POST`. |
| `app/api/admin/requests/[id]/blockers/[linkId]/route.ts` | A | `DELETE`. |
| `app/api/admin/blockers/search/route.ts` | A | `GET`: open tasks and requests the caller may actually reach. |
| `lib/task-wizard-drafts.ts` | C | Pure: `TaskWizardDraft`, `normaliseWizardPriority`, `resolveDraftClient`, `resolveDraftAssignee`, `draftToTaskFields`, `buildCreateTaskBody`. |
| `lib/task-wizard-drafts.test.ts` | C | Vitest for the priority alias table, the resolvers and both body builders. |
| `lib/ai-documents.ts` | C | Pure: `classifyDocument`, `decodeBase64Text`, `base64ByteLength`, `truncateForPrompt`, `documentIntro`, the caps. |
| `lib/ai-documents.test.ts` | C | Vitest for classification, refusal copy, decoding and truncation. |

### Modified

| Path | Slice | Change |
|---|---|---|
| `db/schema.ts` | A | `workBlockers` table plus three indexes. `uniqueIndex` is already imported (line 7). |
| `app/api/admin/db/migrate/route.ts` | A | Append the `0088` entry to `MIGRATIONS`. |
| `app/api/admin/tasks/route.ts` | A | `blockedByCount` comes from `openBlockerCounts`, counting both blocker types with the right closed set per type. The unused `dependencies` array on each row is dropped (verified: the only `dependencies` hits outside this route are the SWR key and the two fetch paths in `tasks-content.tsx`, never the field). |
| `app/api/admin/tasks/__tests__/tasks-enrichment.test.ts` | A | **Not optional and easy to miss.** This spec mocks `@/db/d1` with a `taskDependencies` key and no `workBlockers`, and drives the route with a three-item queue whose third entry is the dependency join (lines 67 to 90). Rewriting `blockedByCount` to read `work_blockers` makes `schema.workBlockers.blockedType` undefined at runtime and the queue order wrong. Add `workBlockers` and `requests` to the schema mock and re-queue for `openBlockerCounts` (links, then blocker task statuses). Keep both assertions: one open blocker counts, none counts zero. |
| `app/api/admin/tasks/[id]/route.ts` | A | `DELETE` calls `sweepBlockers` before deleting the row, in both directions. |
| `app/api/admin/tasks/[id]/dependencies/route.ts` | A | Becomes a thin alias over `lib/blockers-server.ts`, keeping the legacy response keys. |
| `app/api/admin/tasks/[id]/dependencies/[depId]/route.ts` | A | Same, for `DELETE`. |
| `app/api/admin/requests/route.ts` | A | `blockedByCount` on every row via the same helper. |
| `lib/requests-views.ts` | A | `RequestRow.blockedByCount`, `isRequestBlocked`, a team-only `blocked` saved view. |
| `lib/requests-views.test.ts` | A | Tests for the new predicate and view. |
| `lib/tasks-board-items.ts` | A | The warning string at line 76 stops hardcoding the word "task". |
| `lib/tasks-board-items.test.ts` | A | **Update, do not only extend.** Lines 111 and 116 assert the exact old strings `'Blocked by 2 tasks'` and `'Blocked by 1 task'`; both become `items`. Then add the mixed-type case. |
| `components/tahi/tasks/task-types.ts` | A | `TaskDependencyRow` (declared at line 39) becomes `BlockerRow`, re-exported from `lib/blockers.ts`. |
| `components/tahi/inline-field.tsx` | A | Two optional props on `InlineMenuField`: `onQueryChange` and `serverFiltered`. Without them the server-backed picker cannot exist (Decision 17). No other slice imports this module. |
| `components/tahi/__tests__/inline-field.test.ts` | A | Cover the two new props: a query keystroke calls back, and `serverFiltered` skips the local `label`/`keywords` pass. |
| `components/tahi/tasks/task-detail-panel.tsx` | A | The Waiting on card takes polymorphic rows and the server-backed picker. The prop being replaced is `blockedBy` (line 115), not `dependencies`. |
| `components/tahi/tasks/tasks-list.tsx` | A | Import `isTaskBlocked` instead of re-implementing it at line 150. |
| `app/(dashboard)/tasks/tasks-content.tsx` | A | SWR key, row mapping, add and remove bodies, picker search. |
| `app/(dashboard)/requests/[id]/request-detail.tsx` | A | The Blocked by rail card, admin-gated. |
| `app/(dashboard)/requests/request-list.tsx` | A | Blocked glyph on the list, merged board warning, the new saved view. |
| `components/tahi/requests/delivery-spine.tsx` | A | The amber "Blocked by N" chip in the header. |
| `workers/mcp-server/src/index.ts` | A, then C | A adds four blocker tools and keeps the three aliases. C's one edit to `ai_task_wizard` waits for A's merge (see the slice map). |
| `lib/tasks-planner.ts` | B | `buildWeekStrip`, `stripLoad`, `stripRangeLabel`, `StripDay`. |
| `lib/tasks-planner.test.ts` | B | Strip tests including the cross-check against `buildWeekGroups`. |
| `components/tahi/tasks/tasks-week.tsx` | B | The strip inside the summary plate, its drop targets, its keyboard model, the two token fixes, and the inline blocked predicate at line 288 replaced with the import. |
| `app/globals.css` | B | One media block for the strip's degradation at 375px. No other slice touches this file. |
| `app/api/admin/ai/task-wizard/route.ts` | C | Honest failures, document mode, cost recording, caps, the widened draft. |
| `components/tahi/ai-task-wizard.tsx` | C | Split into panel and drawer, document mode UI, the richer review step, the hand-back. |
| `components/tahi/tasks/new-task-dialog.tsx` | C | `view` state, the AI panel, an assist card in the form, the draft-to-form handler. |
| `lib/ai-cost.ts` | C | `wizard` added to `Scope`; the Opus and Sonnet rate rows corrected. |

### Owned by nobody in A, B or C

`e2e/**`, `STATUS.md` and `TASKS.md` are **not** owned by any building slice. Their edits are Slice D, the lead's closing pass. This is deliberate: three worktrees each appending to `STATUS.md` is three conflicts, and an e2e spec written before all three land tests a surface that does not exist yet.

---

## Slice map, parallelism and merge order

| Slice | Owns | Runs in parallel with |
|---|---|---|
| **A: Blockers across tasks and requests** | `lib/blockers.ts` (+test), `lib/blockers-server.ts`, `db/schema.ts`, `drizzle/migrations/0088_*`, `app/api/admin/db/migrate/route.ts`, `app/api/admin/blockers/**`, `app/api/admin/tasks/route.ts`, `app/api/admin/tasks/[id]/route.ts`, `app/api/admin/tasks/[id]/blockers/**`, `app/api/admin/tasks/[id]/dependencies/**`, `app/api/admin/requests/route.ts`, `app/api/admin/requests/[id]/blockers/**`, `app/api/admin/tasks/__tests__/tasks-enrichment.test.ts`, `app/api/__tests__/admin-requests-scoping.test.ts`, `lib/requests-views.ts` (+test), `lib/tasks-board-items.ts` (+test), `components/tahi/tasks/task-types.ts`, `components/tahi/inline-field.tsx` (+ `components/tahi/__tests__/inline-field.test.ts`), `components/tahi/tasks/task-detail-panel.tsx`, `components/tahi/tasks/tasks-list.tsx`, `app/(dashboard)/tasks/tasks-content.tsx`, `app/(dashboard)/requests/[id]/request-detail.tsx`, `app/(dashboard)/requests/request-list.tsx`, `components/tahi/requests/delivery-spine.tsx`, `workers/mcp-server/src/index.ts` | B, C |
| **B: My week calendar** | `lib/tasks-planner.ts` (+test), `components/tahi/tasks/tasks-week.tsx`, `app/globals.css` | A, C |
| **C: AI and document task creation** | `lib/task-wizard-drafts.ts` (+test), `lib/ai-documents.ts` (+test), `lib/ai-cost.ts`, `app/api/admin/ai/task-wizard/route.ts`, `components/tahi/ai-task-wizard.tsx`, `components/tahi/tasks/new-task-dialog.tsx` | A, B |
| **D: docs, e2e and cleanup (the lead)** | `e2e/**`, `STATUS.md`, `TASKS.md` | nothing; runs last |

**Merge order: A, B and C in any order, then D.** There is exactly **one** ordering constraint in the whole plan: **Task C.7 (the `ai_task_wizard` MCP schema edit) waits until Slice A has merged**, because `workers/mcp-server/src/index.ts` is the only file two slices need. C does all its other work first and rebases on main before C.7. If A is still open when C is otherwise done, C hands the diff to the lead with C.7 unticked and finishes it after.

**Three rules that make the parallelism real rather than nominal:**

1. **Slice C must not need to edit `app/(dashboard)/requests/[id]/request-detail.tsx` or `app/(dashboard)/tasks/tasks-content.tsx`.** `AiTaskWizard` is mounted in **both** of them (`request-detail.tsx:2824` and `tasks-content.tsx:1021`), and both belong to Slice A. That is why Decision 24 puts the AI view inside `NewTaskDialog` (which owns its own view switch, exactly as `new-request-dialog.tsx` does) and Decision 25 keeps every new drawer prop optional. If C finds itself wanting a shell change, stop and post to the lead rather than reaching into Slice A's file.
2. **Slice B must not need a new prop.** Decision 20. If the strip turns out to need shell state, the design is wrong; the fallback is the month popover in the deliberately-not-done list, not a shell edit.
3. **Slice B owns the inline blocked predicate at `tasks-week.tsx:288`** and fixes it (`import { isTaskBlocked } from '@/lib/tasks-views'`) as part of its own pass. **Slice A fixes the other two** (`tasks-list.tsx:150` and `task-detail-panel.tsx:868`) and must not touch `tasks-week.tsx`. There are three inline copies in total against the one canonical predicate at `lib/tasks-views.ts:137`, not five. Say this in both slices so neither implementer assumes the other did it.

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
- No `any`. No `console.log` or `console.error` in app code. No commented-out code. No em or en dashes anywhere.
- CSS custom properties only. The radius scale is `--radius-sm | -md | -lg | -xl | -full | -badge | -button | -card | -input | -leaf | -leaf-sm | -leaf-lg | -leaf-xl`. There is no `--radius-xs`. Shadows are `--shadow-xs | -sm | -md | -lg | -ring | -brand | -leaf | -floating`. `--color-brand-dark` has no dark-mode definition; use `--color-link` for brand-coloured text.
- Every interactive element gets a hover state and a focus state (`className="tahi-focus-ring"`). Touch targets are at least 2.75rem below `md`.
- Vitest runs in the **node** environment. Every test is a pure-function test.
- Run `npm run build`, not only `npm run type-check`, before handing over. `tsc` accepts a non-method export from a route file and `next build` rejects it.

---

## Slice A: Blockers across tasks and requests

**Files:**
- Create: `lib/blockers.ts`, `lib/blockers.test.ts`, `lib/blockers-server.ts`, `drizzle/migrations/0088_polymorphic_blockers.sql`, `app/api/admin/tasks/[id]/blockers/route.ts`, `app/api/admin/tasks/[id]/blockers/[linkId]/route.ts`, `app/api/admin/requests/[id]/blockers/route.ts`, `app/api/admin/requests/[id]/blockers/[linkId]/route.ts`, `app/api/admin/blockers/search/route.ts`
- Modify: `db/schema.ts`, `app/api/admin/db/migrate/route.ts`, `app/api/admin/tasks/route.ts`, `app/api/admin/tasks/[id]/route.ts`, `app/api/admin/tasks/[id]/dependencies/route.ts`, `app/api/admin/tasks/[id]/dependencies/[depId]/route.ts`, `app/api/admin/requests/route.ts`, `app/api/admin/tasks/__tests__/tasks-enrichment.test.ts`, `app/api/__tests__/admin-requests-scoping.test.ts`, `lib/requests-views.ts`, `lib/requests-views.test.ts`, `lib/tasks-board-items.ts`, `lib/tasks-board-items.test.ts`, `components/tahi/tasks/task-types.ts`, `components/tahi/inline-field.tsx`, `components/tahi/__tests__/inline-field.test.ts`, `components/tahi/tasks/task-detail-panel.tsx`, `components/tahi/tasks/tasks-list.tsx`, `app/(dashboard)/tasks/tasks-content.tsx`, `app/(dashboard)/requests/[id]/request-detail.tsx`, `app/(dashboard)/requests/request-list.tsx`, `components/tahi/requests/delivery-spine.tsx`, `workers/mcp-server/src/index.ts`

**Two files on that list are not obvious and are the two most likely to be missed.** `app/api/admin/tasks/__tests__/tasks-enrichment.test.ts` fails the moment `blockedByCount` stops reading `task_dependencies` (its `@/db/d1` mock has no `workBlockers` key), and `components/tahi/inline-field.tsx` has to grow two props before a server-backed picker is possible at all. Neither is touched by B or C, so neither creates an overlap.

### Task A.1: `lib/blockers.ts` and its tests

- [ ] **Step 1: Write the failing test**

Create `lib/blockers.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  BLOCKER_SUBJECT_TYPES,
  blockedWarningLabel,
  isBlockerOpen,
  isBlockerSubjectType,
  isFamilyPair,
  parseSubjectKey,
  rejectObviousPair,
  requestRef,
  subjectKey,
  wouldCycle,
  type BlockerSubject,
} from './blockers'

describe('subject types', () => {
  it('has exactly task and request', () => {
    expect(BLOCKER_SUBJECT_TYPES).toEqual(['task', 'request'])
  })

  it('narrows an unknown value', () => {
    expect(isBlockerSubjectType('task')).toBe(true)
    expect(isBlockerSubjectType('checklist_item')).toBe(false)
    expect(isBlockerSubjectType(undefined)).toBe(false)
  })

  it('round-trips a composite key', () => {
    expect(subjectKey('request', 'r1')).toBe('request:r1')
    expect(parseSubjectKey('request:r1')).toEqual({ type: 'request', id: 'r1' })
    expect(parseSubjectKey('nonsense')).toBeNull()
    expect(parseSubjectKey('note:n1')).toBeNull()
  })

  it('keeps an id containing a colon intact', () => {
    expect(parseSubjectKey('task:a:b')).toEqual({ type: 'task', id: 'a:b' })
  })
})

describe('isBlockerOpen', () => {
  it('closes a task only on done', () => {
    expect(isBlockerOpen('task', 'todo')).toBe(true)
    expect(isBlockerOpen('task', 'blocked')).toBe(true)
    expect(isBlockerOpen('task', 'done')).toBe(false)
  })

  it('closes a request on delivered, cancelled and archived', () => {
    expect(isBlockerOpen('request', 'in_progress')).toBe(true)
    expect(isBlockerOpen('request', 'on_hold')).toBe(true)
    expect(isBlockerOpen('request', 'delivered')).toBe(false)
    expect(isBlockerOpen('request', 'cancelled')).toBe(false)
    expect(isBlockerOpen('request', 'archived')).toBe(false)
  })

  it('treats a missing status as closed, because an orphan blocks nothing', () => {
    expect(isBlockerOpen('task', null)).toBe(false)
    expect(isBlockerOpen('request', null)).toBe(false)
  })
})

describe('requestRef', () => {
  it('pads to three digits', () => {
    expect(requestRef(42)).toBe('#042')
    expect(requestRef(7)).toBe('#007')
    expect(requestRef(1234)).toBe('#1234')
  })

  it('is null when the request has no number', () => {
    expect(requestRef(null)).toBeNull()
    expect(requestRef(undefined)).toBeNull()
  })
})

describe('blockedWarningLabel', () => {
  it('says nothing when there is nothing to say', () => {
    expect(blockedWarningLabel(0, false)).toBeUndefined()
  })

  it('counts items, not tasks, because a blocker can be a request', () => {
    expect(blockedWarningLabel(1, false)).toBe('Blocked by 1 item')
    expect(blockedWarningLabel(3, false)).toBe('Blocked by 3 items')
  })

  it('keeps the scope flag when both apply', () => {
    expect(blockedWarningLabel(0, true)).toBe('Flagged for scope creep')
    expect(blockedWarningLabel(2, true)).toBe('Blocked by 2 items, and flagged for scope creep')
  })
})

describe('rejectObviousPair', () => {
  const task: BlockerSubject = { type: 'task', id: 't1' }

  it('rejects a subject blocking itself', () => {
    expect(rejectObviousPair(task, { type: 'task', id: 't1' })).toBe('self')
  })

  it('allows the same id across two types, which are different rows', () => {
    expect(rejectObviousPair(task, { type: 'request', id: 't1' })).toBeNull()
  })

  it('allows an ordinary pair', () => {
    expect(rejectObviousPair(task, { type: 'request', id: 'r1' })).toBeNull()
  })
})

describe('isFamilyPair', () => {
  const parents = { r2: 'r1', r3: 'r1', r1: null }

  it('rejects a parent blocked by its own sub-request, either way round', () => {
    expect(isFamilyPair({ type: 'request', id: 'r1' }, { type: 'request', id: 'r2' }, parents)).toBe(true)
    expect(isFamilyPair({ type: 'request', id: 'r2' }, { type: 'request', id: 'r1' }, parents)).toBe(true)
  })

  it('allows two siblings, which are genuinely separate work', () => {
    expect(isFamilyPair({ type: 'request', id: 'r2' }, { type: 'request', id: 'r3' }, parents)).toBe(false)
  })

  it('never applies to tasks', () => {
    expect(isFamilyPair({ type: 'task', id: 'r1' }, { type: 'request', id: 'r2' }, parents)).toBe(false)
  })
})

describe('wouldCycle', () => {
  /** edges[key] = what that subject is already blocked by. */
  function loaderFor(edges: Record<string, BlockerSubject[]>) {
    const calls: number[] = []
    const load = async (batch: readonly BlockerSubject[]): Promise<BlockerSubject[]> => {
      calls.push(batch.length)
      return batch.flatMap(s => edges[subjectKey(s.type, s.id)] ?? [])
    }
    return { load, calls }
  }

  it('is true when the proposed blocker already waits on the subject', async () => {
    // t2 is blocked by t1. Adding "t1 blocked by t2" closes the loop.
    const { load } = loaderFor({ 'task:t2': [{ type: 'task', id: 't1' }] })
    const cycle = await wouldCycle({ type: 'task', id: 't2' }, { type: 'task', id: 't1' }, load)
    expect(cycle).toBe(true)
  })

  it('catches a loop that crosses the two surfaces', async () => {
    // request rA is blocked by task tB, which is blocked by request rA again.
    const { load } = loaderFor({
      'task:tB': [{ type: 'request', id: 'rA' }],
    })
    const cycle = await wouldCycle({ type: 'task', id: 'tB' }, { type: 'request', id: 'rA' }, load)
    expect(cycle).toBe(true)
  })

  it('is false for an unrelated pair', async () => {
    const { load } = loaderFor({ 'task:t2': [{ type: 'task', id: 't9' }] })
    expect(await wouldCycle({ type: 'task', id: 't2' }, { type: 'task', id: 't1' }, load)).toBe(false)
  })

  it('is true when the two ends are the same subject', async () => {
    const { load } = loaderFor({})
    expect(await wouldCycle({ type: 'task', id: 't1' }, { type: 'task', id: 't1' }, load)).toBe(true)
  })

  it('loads one batch per level, not one per node', async () => {
    const { load, calls } = loaderFor({
      'task:a': [{ type: 'task', id: 'b' }, { type: 'task', id: 'c' }],
      'task:b': [{ type: 'task', id: 'd' }],
      'task:c': [{ type: 'task', id: 'e' }],
    })
    await wouldCycle({ type: 'task', id: 'a' }, { type: 'task', id: 'zz' }, load)
    // level 1: [a]; level 2: [b, c]; level 3: [d, e]; level 4: [] stops.
    expect(calls).toEqual([1, 2, 2])
  })

  it('terminates on a pre-existing loop in the data', async () => {
    const { load } = loaderFor({
      'task:a': [{ type: 'task', id: 'b' }],
      'task:b': [{ type: 'task', id: 'a' }],
    })
    expect(await wouldCycle({ type: 'task', id: 'a' }, { type: 'task', id: 'zz' }, load)).toBe(false)
  })
})
```

Run: `npx vitest run lib/blockers.test.ts`
Expected: fails, `lib/blockers.ts` does not exist.

- [ ] **Step 2: Write the module**

Create `lib/blockers.ts`:

```ts
/**
 * lib/blockers.ts
 *
 * One vocabulary for "this cannot start until that finishes", across both
 * work surfaces. A blocker is a directed edge between two subjects, and a
 * subject is either a task or a request.
 *
 * Everything here is pure so it runs in the node Vitest environment. The
 * drizzle half lives in lib/blockers-server.ts, and the graph walk takes its
 * adjacency as an injected loader so the same BFS is exercised by a Map in a
 * test and by D1 in production.
 *
 * The one rule worth stating twice: a task is closed on 'done', a request is
 * closed on 'delivered', 'cancelled' or 'archived'. Two vocabularies, one
 * question ("is this still holding anything up"), and it is answered here
 * rather than in SQL so both list routes cannot drift apart.
 */

// Both closed-status lists come from status-config, not one from here and one
// from lib/requests-views (which exports the same array as CLOSED_STATUSES).
// One idea, one module, and no dependency from this pure file onto the rail.
import { REQUEST_CLOSED_STATUSES, TASK_CLOSED_STATUSES } from '@/lib/status-config'

export type BlockerSubjectType = 'task' | 'request'

export const BLOCKER_SUBJECT_TYPES: readonly BlockerSubjectType[] = ['task', 'request']

export interface BlockerSubject {
  type: BlockerSubjectType
  id: string
}

/** One row of a Waiting on / Blocked by card. `other` is always the far end
 *  of the edge from the reader's point of view, whichever direction was
 *  asked for. */
export interface BlockerRow {
  linkId: string
  otherType: BlockerSubjectType
  otherId: string
  otherTitle: string
  otherStatus: string
  /** '#042' for a request, null for a task. */
  otherRef: string | null
  otherOrgName: string | null
}

export function isBlockerSubjectType(value: unknown): value is BlockerSubjectType {
  return value === 'task' || value === 'request'
}

/** 'task:abc'. Used as the visited-set key in the graph walk and as a React
 *  key wherever both types sit in one list. */
export function subjectKey(type: BlockerSubjectType, id: string): string {
  return `${type}:${id}`
}

/** The inverse. Null for anything that is not a key this module wrote. An id
 *  may itself contain a colon, so only the FIRST colon separates. */
export function parseSubjectKey(key: string): BlockerSubject | null {
  const cut = key.indexOf(':')
  if (cut < 1) return null
  const type = key.slice(0, cut)
  const id = key.slice(cut + 1)
  if (!isBlockerSubjectType(type) || !id) return null
  return { type, id }
}

/** Is this blocker still holding anything up? A missing status means the row
 *  is gone (there are no foreign keys on a polymorphic edge), and a subject
 *  that no longer exists blocks nothing. */
export function isBlockerOpen(type: BlockerSubjectType, status: string | null | undefined): boolean {
  if (!status) return false
  return type === 'task'
    ? !TASK_CLOSED_STATUSES.includes(status)
    : !REQUEST_CLOSED_STATUSES.includes(status)
}

/** The repo's reference for a request, everywhere: #042, never TR-0042. */
export function requestRef(requestNumber: number | null | undefined): string | null {
  return requestNumber != null ? `#${String(requestNumber).padStart(3, '0')}` : null
}

/**
 * The single `warning` string a board card has room for.
 *
 * BoardItem.warning is one slot and the requests board already spends it on
 * the scope flag, so a request that is both blocked and flagged would
 * silently lose one signal. Merging is honest and costs no primitive change.
 */
export function blockedWarningLabel(openBlockers: number, scopeFlagged: boolean): string | undefined {
  const blocked = openBlockers > 0
    ? `Blocked by ${openBlockers} item${openBlockers === 1 ? '' : 's'}`
    : null
  if (blocked && scopeFlagged) return `${blocked}, and flagged for scope creep`
  if (blocked) return blocked
  if (scopeFlagged) return 'Flagged for scope creep'
  return undefined
}

export type BlockerRejection = 'self'

/** The rejections that need no database read. The same id under two types is
 *  two different rows, so it is allowed. */
export function rejectObviousPair(
  blocked: BlockerSubject,
  blocker: BlockerSubject,
): BlockerRejection | null {
  if (blocked.type === blocker.type && blocked.id === blocker.id) return 'self'
  return null
}

/**
 * A parent request and its own sub-request.
 *
 * The parent already renders "done of total" over its children, so letting it
 * also be blocked by one of them models the same fact twice and produces two
 * cards that can disagree. Rejected in both directions. Siblings are fine:
 * two sub-requests really can wait on each other.
 */
export function isFamilyPair(
  a: BlockerSubject,
  b: BlockerSubject,
  parentOf: Readonly<Record<string, string | null>>,
): boolean {
  if (a.type !== 'request' || b.type !== 'request') return false
  return parentOf[a.id] === b.id || parentOf[b.id] === a.id
}

/**
 * Would adding "blocked is blocked by blocker" close a loop?
 *
 * Walk forward from the proposed BLOCKER through what it is already blocked
 * by. If that walk reaches the subject being blocked, the new edge completes
 * a cycle. Cross-type loops (request A waits on task B waits on request A)
 * only became reachable when the model went polymorphic, so this check is not
 * optional.
 *
 * `loadBlockers` takes a whole level and returns everything that level is
 * blocked by, so the walk costs one query per level rather than one per node.
 */
export async function wouldCycle(
  blocked: BlockerSubject,
  blocker: BlockerSubject,
  loadBlockers: (batch: readonly BlockerSubject[]) => Promise<BlockerSubject[]>,
): Promise<boolean> {
  const targetKey = subjectKey(blocked.type, blocked.id)
  const startKey = subjectKey(blocker.type, blocker.id)
  if (startKey === targetKey) return true

  const visited = new Set<string>([startKey])
  let frontier: BlockerSubject[] = [blocker]

  while (frontier.length > 0) {
    const found = await loadBlockers(frontier)
    const next: BlockerSubject[] = []
    for (const node of found) {
      const key = subjectKey(node.type, node.id)
      if (key === targetKey) return true
      if (visited.has(key)) continue
      visited.add(key)
      next.push(node)
    }
    frontier = next
  }

  return false
}
```

- [ ] **Step 3: Verify**

Run: `npx vitest run lib/blockers.test.ts`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add lib/blockers.ts lib/blockers.test.ts
git commit -m "feat(blockers): the pure blocker vocabulary shared by tasks and requests"
```

### Task A.2: Schema and migration 0088

- [ ] **Step 1: Add the table to `db/schema.ts`**

Directly after the `taskDependencies` block (which stays exactly as it is):

```ts
// ============================================================
// WORK BLOCKERS (polymorphic: task or request, both ends)
// ============================================================

/**
 * "X cannot start until Y finishes", where X and Y are each a task or a
 * request. Supersedes task_dependencies, which migration 0088 copies from and
 * then leaves frozen for one release.
 *
 * There are no foreign keys, and there cannot be: a column cannot reference
 * two tables. That is the price of the polymorphism, and it is paid on
 * purpose, because the alternative is three tables and three copies of the
 * cycle check. Two consequences follow, both handled deliberately:
 *
 *   1. Nothing cascades. The one hard delete in the codebase (DELETE
 *      /api/admin/tasks/[id]) calls sweepBlockers first. Requests are
 *      soft-deleted to 'archived', which is a closed status, so they stop
 *      counting on their own.
 *   2. A row can outlive its subject. Readers tolerate that: an orphan
 *      renders as "Deleted task" and can still be unlinked, which is exactly
 *      what the shipped Waiting on card already did.
 *
 * The unique index on all four key columns turns the old duplicate pre-read
 * into a constraint.
 */
export const workBlockers = sqliteTable('work_blockers', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  // 'task' | 'request'
  blockedType: text('blocked_type').notNull(),
  blockedId: text('blocked_id').notNull(),
  // 'task' | 'request'
  blockerType: text('blocker_type').notNull(),
  blockerId: text('blocker_id').notNull(),
  createdById: text('created_by_id'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
}, (table) => [
  index('idx_work_blockers_blocked').on(table.blockedType, table.blockedId),
  index('idx_work_blockers_blocker').on(table.blockerType, table.blockerId),
  uniqueIndex('idx_work_blockers_pair')
    .on(table.blockedType, table.blockedId, table.blockerType, table.blockerId),
])
```

`uniqueIndex` is already imported at `db/schema.ts:7`. Do not add an import.

- [ ] **Step 2: Write the migration file**

Create `drizzle/migrations/0088_polymorphic_blockers.sql`:

```sql
-- 0088: polymorphic blockers.
--
-- A blocker is now an edge between two subjects, each of which is a task or a
-- request. task_dependencies is copied in and then left alone: it is a frozen
-- snapshot for one release, not a second live table. Nothing dual-writes.
--
-- Every statement is idempotent. INSERT OR IGNORE covers both a repeated id
-- and a repeated pair, so re-running the whole file is safe.

CREATE TABLE IF NOT EXISTS work_blockers (
  id text PRIMARY KEY NOT NULL,
  blocked_type text NOT NULL,
  blocked_id text NOT NULL,
  blocker_type text NOT NULL,
  blocker_id text NOT NULL,
  created_by_id text,
  created_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_work_blockers_blocked ON work_blockers(blocked_type, blocked_id);
CREATE INDEX IF NOT EXISTS idx_work_blockers_blocker ON work_blockers(blocker_type, blocker_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_blockers_pair
  ON work_blockers(blocked_type, blocked_id, blocker_type, blocker_id);

INSERT OR IGNORE INTO work_blockers
  (id, blocked_type, blocked_id, blocker_type, blocker_id, created_by_id, created_at)
SELECT d.id, 'task', d.task_id, 'task', d.depends_on_task_id, NULL, d.created_at
FROM task_dependencies AS d;
```

- [ ] **Step 3: Mirror it into the runtime runner**

Append to the `MIGRATIONS` array in `app/api/admin/db/migrate/route.ts`, after the `0087` entry:

```ts
  {
    name: '0088',
    description: 'Polymorphic blockers. work_blockers replaces task_dependencies with an edge whose two ends are each a task or a request, so a request can be blocked by a task and vice versa. Backfills every existing task-to-task dependency with INSERT OR IGNORE and leaves task_dependencies in place, frozen, for one release. No foreign keys are possible on a polymorphic column, so DELETE /api/admin/tasks/[id] sweeps both directions explicitly; requests are soft-deleted to archived, which is already a closed status. Additive and idempotent; re-running is safe.',
    statements: [
      `CREATE TABLE IF NOT EXISTS work_blockers (
        id text PRIMARY KEY NOT NULL,
        blocked_type text NOT NULL,
        blocked_id text NOT NULL,
        blocker_type text NOT NULL,
        blocker_id text NOT NULL,
        created_by_id text,
        created_at text NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_work_blockers_blocked ON work_blockers(blocked_type, blocked_id)`,
      `CREATE INDEX IF NOT EXISTS idx_work_blockers_blocker ON work_blockers(blocker_type, blocker_id)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_work_blockers_pair ON work_blockers(blocked_type, blocked_id, blocker_type, blocker_id)`,
      `INSERT OR IGNORE INTO work_blockers (id, blocked_type, blocked_id, blocker_type, blocker_id, created_by_id, created_at)
       SELECT d.id, 'task', d.task_id, 'task', d.depends_on_task_id, NULL, d.created_at FROM task_dependencies AS d`,
    ],
  },
```

**One caveat on the backfill, verified against the runner.** `task_dependencies` is created by `drizzle/migrations/0004_orange_sumo.sql` and is **not** in the runtime `MIGRATIONS` array, so a D1 that was only ever built by the runner would not have it. The runner swallows exactly two error strings, `duplicate column name` and `already exists` (`app/api/admin/db/migrate/route.ts:2051`), so a missing table raises `no such table: task_dependencies` and the migration reports `status: "error"`. That is survivable but has to be understood rather than discovered: keep the `INSERT OR IGNORE ... SELECT` as the **last** statement in the array (it already is), so the table and all three indexes have landed before it runs, and a re-run after the table exists finishes the backfill with no duplicates. Prod and staging both have `task_dependencies` today, because the shipped Waiting on card reads it, so the expected result there is a clean `applied`.

- [ ] **Step 4: Verify and commit**

Run: `npm run type-check`
Expected: exit 0.

```bash
git add db/schema.ts drizzle/migrations/0088_polymorphic_blockers.sql app/api/admin/db/migrate/route.ts
git commit -m "feat(blockers): work_blockers table and migration 0088"
```

### Task A.3: `lib/blockers-server.ts`

- [ ] **Step 1: Write the module**

Create `lib/blockers-server.ts`:

```ts
/**
 * lib/blockers-server.ts
 *
 * Everything about blockers that needs the database. The rules live next
 * door in lib/blockers.ts, which is pure and tested; this file is the D1
 * plumbing plus the two access systems it has to satisfy at once.
 *
 * Access is the whole reason this is one module rather than two route
 * helpers. A task is guarded by `guardTask` (client-less studio tasks are
 * allowed for every team member); a request is guarded by
 * `requireAccessToOrg` on its owning client. A blocker link touches one of
 * each, and BOTH ends must be guarded on every write, or linking something
 * you can see to something you cannot leaks the far end's title straight back
 * through the card.
 *
 * Lives in lib/ rather than in a route file because Next.js App Router routes
 * may only export HTTP methods and config.
 */

import { NextResponse } from 'next/server'
import { and, eq, inArray, isNull, like, or, sql } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { guardTask } from '@/lib/task-access'
import { requireAccessToOrg } from '@/lib/require-access'
import { resolveAccessScoping } from '@/lib/access-scoping'
import {
  isBlockerOpen,
  isFamilyPair,
  rejectObviousPair,
  requestRef,
  subjectKey,
  wouldCycle,
  type BlockerRow,
  type BlockerSubject,
  type BlockerSubjectType,
} from '@/lib/blockers'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// ── Access ───────────────────────────────────────────────────────────────────

/** The one guard for either kind of subject. Returns a NextResponse to short
 *  circuit on, or null when the caller may proceed, which is the contract
 *  `requireAccessToOrg` and `guardTask` already use. */
export async function guardSubject(
  drizzle: Drizzle,
  userId: string | null,
  subject: BlockerSubject,
): Promise<NextResponse | null> {
  if (subject.type === 'task') return guardTask(drizzle, userId, subject.id)

  const [request] = await drizzle
    .select({ orgId: schema.requests.orgId })
    .from(schema.requests)
    .where(eq(schema.requests.id, subject.id))
    .limit(1)

  if (!request) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  return requireAccessToOrg(drizzle, userId, request.orgId)
}

// ── Reads ────────────────────────────────────────────────────────────────────

interface SubjectRef {
  linkId: string
  type: BlockerSubjectType
  id: string
}

interface SubjectFacts {
  title: string
  status: string
  ref: string | null
  orgName: string | null
}

/** Two queries at most, whatever the mix of types. Order is preserved. */
async function hydrateSubjects(drizzle: Drizzle, refs: readonly SubjectRef[]): Promise<BlockerRow[]> {
  const taskIds = refs.filter(r => r.type === 'task').map(r => r.id)
  const requestIds = refs.filter(r => r.type === 'request').map(r => r.id)
  const facts = new Map<string, SubjectFacts>()

  if (taskIds.length > 0) {
    const rows = await drizzle
      .select({
        id: schema.tasks.id,
        title: schema.tasks.title,
        status: schema.tasks.status,
        orgName: schema.organisations.name,
      })
      .from(schema.tasks)
      .leftJoin(schema.organisations, eq(schema.tasks.orgId, schema.organisations.id))
      .where(inArray(schema.tasks.id, taskIds))
    for (const row of rows) {
      facts.set(subjectKey('task', row.id), {
        title: row.title,
        status: row.status,
        ref: null,
        orgName: row.orgName ?? null,
      })
    }
  }

  if (requestIds.length > 0) {
    const rows = await drizzle
      .select({
        id: schema.requests.id,
        title: schema.requests.title,
        status: schema.requests.status,
        requestNumber: schema.requests.requestNumber,
        orgName: schema.organisations.name,
      })
      .from(schema.requests)
      .leftJoin(schema.organisations, eq(schema.requests.orgId, schema.organisations.id))
      .where(inArray(schema.requests.id, requestIds))
    for (const row of rows) {
      facts.set(subjectKey('request', row.id), {
        title: row.title,
        status: row.status,
        ref: requestRef(row.requestNumber),
        orgName: row.orgName ?? null,
      })
    }
  }

  // An orphan still renders and can still be unlinked. Hiding it would leave
  // a count nobody can explain and a row nobody can remove.
  return refs.map(ref => {
    const found = facts.get(subjectKey(ref.type, ref.id))
    return {
      linkId: ref.linkId,
      otherType: ref.type,
      otherId: ref.id,
      otherTitle: found?.title ?? (ref.type === 'request' ? 'Deleted request' : 'Deleted task'),
      otherStatus: found?.status ?? 'unknown',
      otherRef: found?.ref ?? null,
      otherOrgName: found?.orgName ?? null,
    }
  })
}

export interface BlockerLists {
  /** What this subject is waiting on. */
  blockedBy: BlockerRow[]
  /** What is waiting on this subject. */
  blocks: BlockerRow[]
}

export async function listBlockers(drizzle: Drizzle, subject: BlockerSubject): Promise<BlockerLists> {
  const blockedByLinks = await drizzle
    .select({
      id: schema.workBlockers.id,
      type: schema.workBlockers.blockerType,
      subjectId: schema.workBlockers.blockerId,
    })
    .from(schema.workBlockers)
    .where(and(
      eq(schema.workBlockers.blockedType, subject.type),
      eq(schema.workBlockers.blockedId, subject.id),
    ))

  const blocksLinks = await drizzle
    .select({
      id: schema.workBlockers.id,
      type: schema.workBlockers.blockedType,
      subjectId: schema.workBlockers.blockedId,
    })
    .from(schema.workBlockers)
    .where(and(
      eq(schema.workBlockers.blockerType, subject.type),
      eq(schema.workBlockers.blockerId, subject.id),
    ))

  const toRefs = (rows: Array<{ id: string; type: string; subjectId: string }>): SubjectRef[] =>
    rows
      .filter(r => r.type === 'task' || r.type === 'request')
      .map(r => ({ linkId: r.id, type: r.type as BlockerSubjectType, id: r.subjectId }))

  return {
    blockedBy: await hydrateSubjects(drizzle, toRefs(blockedByLinks)),
    blocks: await hydrateSubjects(drizzle, toRefs(blocksLinks)),
  }
}

/**
 * Open blocker counts for a batch of subjects of one type.
 *
 * Both list routes call this rather than writing a correlated subquery,
 * because the closed-status vocabulary differs per type and putting either
 * list into SQL is how the old `dependsOnStatus !== 'done'` literal drifted
 * away from every other reader in the first place.
 */
export async function openBlockerCounts(
  drizzle: Drizzle,
  type: BlockerSubjectType,
  ids: readonly string[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  if (ids.length === 0) return counts

  const links = await drizzle
    .select({
      blockedId: schema.workBlockers.blockedId,
      blockerType: schema.workBlockers.blockerType,
      blockerId: schema.workBlockers.blockerId,
    })
    .from(schema.workBlockers)
    .where(and(
      eq(schema.workBlockers.blockedType, type),
      inArray(schema.workBlockers.blockedId, [...ids]),
    ))

  if (links.length === 0) return counts

  const statuses = new Map<string, string>()
  const blockerTaskIds = links.filter(l => l.blockerType === 'task').map(l => l.blockerId)
  const blockerRequestIds = links.filter(l => l.blockerType === 'request').map(l => l.blockerId)

  if (blockerTaskIds.length > 0) {
    const rows = await drizzle
      .select({ id: schema.tasks.id, status: schema.tasks.status })
      .from(schema.tasks)
      .where(inArray(schema.tasks.id, blockerTaskIds))
    for (const row of rows) statuses.set(subjectKey('task', row.id), row.status)
  }
  if (blockerRequestIds.length > 0) {
    const rows = await drizzle
      .select({ id: schema.requests.id, status: schema.requests.status })
      .from(schema.requests)
      .where(inArray(schema.requests.id, blockerRequestIds))
    for (const row of rows) statuses.set(subjectKey('request', row.id), row.status)
  }

  for (const link of links) {
    if (link.blockerType !== 'task' && link.blockerType !== 'request') continue
    const blockerType = link.blockerType as BlockerSubjectType
    const status = statuses.get(subjectKey(blockerType, link.blockerId)) ?? null
    if (!isBlockerOpen(blockerType, status)) continue
    counts[link.blockedId] = (counts[link.blockedId] ?? 0) + 1
  }

  return counts
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Add "blocked is blocked by blocker". Returns the response to send, so both
 * surfaces answer identically and neither route re-states a rule.
 *
 * Order matters: cheap pure rejections, then both access guards, then the two
 * reads (family pair, cycle), then the insert. Nothing that costs a query
 * runs before the caller has proved it may see both ends.
 */
export async function addBlocker(
  drizzle: Drizzle,
  userId: string | null,
  blocked: BlockerSubject,
  blocker: BlockerSubject,
): Promise<NextResponse> {
  if (rejectObviousPair(blocked, blocker) === 'self') {
    return NextResponse.json({ error: 'Something cannot wait on itself' }, { status: 400 })
  }

  const blockedDenied = await guardSubject(drizzle, userId, blocked)
  if (blockedDenied) return blockedDenied
  const blockerDenied = await guardSubject(drizzle, userId, blocker)
  if (blockerDenied) return blockerDenied

  if (blocked.type === 'request' && blocker.type === 'request') {
    const rows = await drizzle
      .select({ id: schema.requests.id, parentRequestId: schema.requests.parentRequestId })
      .from(schema.requests)
      .where(inArray(schema.requests.id, [blocked.id, blocker.id]))
    const parentOf: Record<string, string | null> = {}
    for (const row of rows) parentOf[row.id] = row.parentRequestId ?? null
    if (isFamilyPair(blocked, blocker, parentOf)) {
      return NextResponse.json(
        { error: 'A request and its own sub-request already track each other. Use the sub-request list instead.' },
        { status: 400 },
      )
    }
  }

  const loadBlockers = async (batch: readonly BlockerSubject[]): Promise<BlockerSubject[]> => {
    const conditions = batch.map(s => and(
      eq(schema.workBlockers.blockedType, s.type),
      eq(schema.workBlockers.blockedId, s.id),
    ))
    const rows = await drizzle
      .select({
        type: schema.workBlockers.blockerType,
        id: schema.workBlockers.blockerId,
      })
      .from(schema.workBlockers)
      .where(conditions.length === 1 ? conditions[0] : or(...conditions))
    return rows
      .filter(r => r.type === 'task' || r.type === 'request')
      .map(r => ({ type: r.type as BlockerSubjectType, id: r.id }))
  }

  if (await wouldCycle(blocked, blocker, loadBlockers)) {
    return NextResponse.json({ error: 'That would make a loop' }, { status: 400 })
  }

  const [existing] = await drizzle
    .select({ id: schema.workBlockers.id })
    .from(schema.workBlockers)
    .where(and(
      eq(schema.workBlockers.blockedType, blocked.type),
      eq(schema.workBlockers.blockedId, blocked.id),
      eq(schema.workBlockers.blockerType, blocker.type),
      eq(schema.workBlockers.blockerId, blocker.id),
    ))
    .limit(1)
  if (existing) {
    return NextResponse.json({ error: 'That link already exists' }, { status: 409 })
  }

  const id = crypto.randomUUID()
  await drizzle.insert(schema.workBlockers).values({
    id,
    blockedType: blocked.type,
    blockedId: blocked.id,
    blockerType: blocker.type,
    blockerId: blocker.id,
    createdById: userId ?? null,
    createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  })

  return NextResponse.json({ id }, { status: 201 })
}

/** Remove one link, having proved it belongs to the subject that asked. */
export async function removeBlocker(
  drizzle: Drizzle,
  userId: string | null,
  blocked: BlockerSubject,
  linkId: string,
): Promise<NextResponse> {
  const denied = await guardSubject(drizzle, userId, blocked)
  if (denied) return denied

  const [link] = await drizzle
    .select({ id: schema.workBlockers.id })
    .from(schema.workBlockers)
    .where(and(
      eq(schema.workBlockers.id, linkId),
      eq(schema.workBlockers.blockedType, blocked.type),
      eq(schema.workBlockers.blockedId, blocked.id),
    ))
    .limit(1)

  if (!link) return NextResponse.json({ error: 'Blocker not found' }, { status: 404 })

  await drizzle.delete(schema.workBlockers).where(eq(schema.workBlockers.id, linkId))
  return NextResponse.json({ success: true })
}

/**
 * Delete every edge touching a subject, in both directions.
 *
 * There is exactly one caller: DELETE /api/admin/tasks/[id], the only hard
 * delete in the codebase. Requests are soft-deleted to 'archived', which
 * isBlockerOpen already treats as closed, so they need no sweep. If a hard
 * delete is ever added for requests, it calls this too.
 */
export async function sweepBlockers(drizzle: Drizzle, subject: BlockerSubject): Promise<void> {
  await drizzle.delete(schema.workBlockers).where(and(
    eq(schema.workBlockers.blockedType, subject.type),
    eq(schema.workBlockers.blockedId, subject.id),
  ))
  await drizzle.delete(schema.workBlockers).where(and(
    eq(schema.workBlockers.blockerType, subject.type),
    eq(schema.workBlockers.blockerId, subject.id),
  ))
}

// ── Picker search ────────────────────────────────────────────────────────────

export interface BlockerCandidate {
  type: BlockerSubjectType
  id: string
  label: string
  ref: string | null
  status: string
  orgName: string | null
}

/**
 * Open tasks and requests the caller may actually reach.
 *
 * Deliberately NOT GET /api/admin/search, which gates on isTahiAdmin only and
 * applies no team-member scoping, so a scoped teammate would be offered
 * clients they cannot open. Closed subjects are excluded: a finished thing
 * cannot hold anything up, and offering it would create a link that is
 * already satisfied at birth.
 */
export async function searchBlockerCandidates(
  drizzle: Drizzle,
  userId: string | null,
  query: string,
  exclude: BlockerSubject | null,
  perType = 8,
): Promise<BlockerCandidate[]> {
  const trimmed = query.trim()
  if (!trimmed) return []
  const pattern = `%${trimmed.toLowerCase()}%`
  const scopedOrgIds = await resolveAccessScoping(drizzle, userId)

  // Tasks. A client-less task is the studio's own list, which every team
  // member on this surface may reach, matching the tasks list route.
  const taskConditions = [
    sql`lower(${schema.tasks.title}) LIKE ${pattern}`,
    sql`${schema.tasks.status} NOT IN ('done')`,
  ]
  if (scopedOrgIds !== null) {
    taskConditions.push(
      scopedOrgIds.length === 0
        ? isNull(schema.tasks.orgId)
        : or(inArray(schema.tasks.orgId, scopedOrgIds), isNull(schema.tasks.orgId))!,
    )
  }
  if (exclude?.type === 'task') {
    taskConditions.push(sql`${schema.tasks.id} <> ${exclude.id}`)
  }

  const taskRows = await drizzle
    .select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      status: schema.tasks.status,
      orgName: schema.organisations.name,
    })
    .from(schema.tasks)
    .leftJoin(schema.organisations, eq(schema.tasks.orgId, schema.organisations.id))
    .where(and(...taskConditions))
    .limit(perType)

  // Requests. No null-org case: every request has a client.
  const numeric = Number.parseInt(trimmed.replace(/^#/, ''), 10)
  const requestMatch = Number.isFinite(numeric)
    ? or(
        sql`lower(${schema.requests.title}) LIKE ${pattern}`,
        eq(schema.requests.requestNumber, numeric),
      )!
    : sql`lower(${schema.requests.title}) LIKE ${pattern}`

  const requestConditions = [
    requestMatch,
    sql`${schema.requests.status} NOT IN ('delivered', 'cancelled', 'archived')`,
  ]
  if (scopedOrgIds !== null) {
    if (scopedOrgIds.length === 0) return mapTasks(taskRows)
    requestConditions.push(inArray(schema.requests.orgId, scopedOrgIds))
  }
  if (exclude?.type === 'request') {
    requestConditions.push(sql`${schema.requests.id} <> ${exclude.id}`)
  }

  const requestRows = await drizzle
    .select({
      id: schema.requests.id,
      title: schema.requests.title,
      status: schema.requests.status,
      requestNumber: schema.requests.requestNumber,
      orgName: schema.organisations.name,
    })
    .from(schema.requests)
    .leftJoin(schema.organisations, eq(schema.requests.orgId, schema.organisations.id))
    .where(and(...requestConditions))
    .limit(perType)

  return [
    ...mapTasks(taskRows),
    ...requestRows.map((row): BlockerCandidate => ({
      type: 'request',
      id: row.id,
      label: row.title,
      ref: requestRef(row.requestNumber),
      status: row.status,
      orgName: row.orgName ?? null,
    })),
  ]
}

function mapTasks(
  rows: Array<{ id: string; title: string; status: string; orgName: string | null }>,
): BlockerCandidate[] {
  return rows.map(row => ({
    type: 'task',
    id: row.id,
    label: row.title,
    ref: null,
    status: row.status,
    orgName: row.orgName ?? null,
  }))
}
```

Note the `like` import is unused if you keep the `sql` template form; drop whichever of `like` or `sql` you do not use so lint stays clean.

- [ ] **Step 2: Verify and commit**

Run: `npm run type-check && npm run lint`
Expected: exit 0, lint clean.

```bash
git add lib/blockers-server.ts
git commit -m "feat(blockers): the server module both surfaces share"
```

### Task A.4: The four blocker routes and the two aliases

- [ ] **Step 1: Write `app/api/admin/tasks/[id]/blockers/route.ts`**

```ts
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isBlockerSubjectType } from '@/lib/blockers'
import { addBlocker, guardSubject, listBlockers } from '@/lib/blockers-server'

type Params = { params: Promise<{ id: string }> }

// ── GET /api/admin/tasks/[id]/blockers ─────────────────────────────────────
// Both directions: what this task waits on, and what waits on it.
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const subject = { type: 'task' as const, id }
  const denied = await guardSubject(drizzle, userId, subject)
  if (denied) return denied

  return NextResponse.json(await listBlockers(drizzle, subject))
}

// ── POST /api/admin/tasks/[id]/blockers ────────────────────────────────────
export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { blockerType?: string; blockerId?: string }

  if (!isBlockerSubjectType(body.blockerType)) {
    return NextResponse.json({ error: 'blockerType must be task or request' }, { status: 400 })
  }
  if (!body.blockerId?.trim()) {
    return NextResponse.json({ error: 'blockerId is required' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  return addBlocker(
    drizzle,
    userId,
    { type: 'task', id },
    { type: body.blockerType, id: body.blockerId },
  )
}
```

- [ ] **Step 2: Write `app/api/admin/tasks/[id]/blockers/[linkId]/route.ts`**

```ts
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { removeBlocker } from '@/lib/blockers-server'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> },
) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, linkId } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  return removeBlocker(drizzle, userId, { type: 'task', id }, linkId)
}
```

- [ ] **Step 3: Write the two request twins**

`app/api/admin/requests/[id]/blockers/route.ts` and `.../blockers/[linkId]/route.ts` are the same two files with `'task'` replaced by `'request'` throughout. Do not add a portal twin: Decision 13. There is no `app/api/portal/.../blockers` route in this plan and there must not be one in the diff.

**Add the request pair to the scoping suite while you are here.** `app/api/__tests__/admin-requests-scoping.test.ts` already sweeps every per-request sub-route (`steps`, `messages`, `time-entries`, `files`, `calls`, `voice-notes`, at lines 571 to 576) and asserts each one 403s for a teammate scoped away from the owning client. A new sub-route that is not in that table is a scoping hole nobody notices. Add `blockers GET` and `blockers POST` to the same array. This file is on Slice A's owned list for that reason and no other.

- [ ] **Step 4: Rewrite the two dependency routes as aliases**

Replace the body of `app/api/admin/tasks/[id]/dependencies/route.ts` with:

```ts
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { BlockerRow } from '@/lib/blockers'
import { addBlocker, guardSubject, listBlockers } from '@/lib/blockers-server'

/**
 * Legacy alias over the polymorphic blocker routes.
 *
 * Kept for one release so the three shipped MCP tools (add_task_dependency,
 * remove_task_dependency, list_task_dependencies) and any saved agent
 * transcript keep working through the deploy window. It writes to
 * work_blockers like everything else; task_dependencies is frozen.
 *
 * The response keeps the old field names AND adds the new ones, so an old
 * reader is unbroken and a new one does not need a second shape. A blocker
 * that is a request appears here too, with `type: 'request'`: hiding it would
 * make this endpoint disagree with the count on the list route.
 */
type Params = { params: Promise<{ id: string }> }

function legacyShape(rows: readonly BlockerRow[]) {
  return rows.map(row => ({
    depId: row.linkId,
    taskId: row.otherId,
    taskTitle: row.otherTitle,
    taskStatus: row.otherStatus,
    type: row.otherType,
    ref: row.otherRef,
  }))
}

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const subject = { type: 'task' as const, id }
  const denied = await guardSubject(drizzle, userId, subject)
  if (denied) return denied

  const lists = await listBlockers(drizzle, subject)
  return NextResponse.json({
    blockedBy: legacyShape(lists.blockedBy),
    blocks: legacyShape(lists.blocks),
  })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { dependsOnTaskId?: string }
  if (!body.dependsOnTaskId?.trim()) {
    return NextResponse.json({ error: 'dependsOnTaskId is required' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  return addBlocker(
    drizzle,
    userId,
    { type: 'task', id },
    { type: 'task', id: body.dependsOnTaskId },
  )
}
```

`app/api/admin/tasks/[id]/dependencies/[depId]/route.ts` becomes a four line call to `removeBlocker` with the same auth preamble. The private `detectCycle` helper is deleted with the old body; `wouldCycle` replaces it.

- [ ] **Step 5: Write `app/api/admin/blockers/search/route.ts`**

```ts
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isBlockerSubjectType } from '@/lib/blockers'
import { searchBlockerCandidates } from '@/lib/blockers-server'

// ── GET /api/admin/blockers/search?q=&excludeType=&excludeId= ───────────────
// Open tasks and requests the caller may actually reach, for the blocker
// picker. Access-scoped the same way the tasks and requests lists are, which
// is why this exists rather than reusing /api/admin/search.
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const q = url.searchParams.get('q') ?? ''
  const excludeType = url.searchParams.get('excludeType')
  const excludeId = url.searchParams.get('excludeId')

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const exclude = isBlockerSubjectType(excludeType) && excludeId
    ? { type: excludeType, id: excludeId }
    : null

  return NextResponse.json({
    candidates: await searchBlockerCandidates(drizzle, userId, q, exclude),
  })
}
```

- [ ] **Step 6: Verify and commit**

Run: `npm run type-check && npm run lint && npm run build`
Expected: all clean. The build matters here: five new route files, and `next build` is the only check that rejects a non-method export.

```bash
git add "app/api/admin/tasks/[id]/blockers" "app/api/admin/requests/[id]/blockers" "app/api/admin/tasks/[id]/dependencies" app/api/admin/blockers
git commit -m "feat(blockers): routes for both surfaces, with the dependency routes kept as aliases"
```

### Task A.5: Counts, sweeps and the two view modules

- [ ] **Step 1: `app/api/admin/tasks/route.ts`**

Replace the dependency enrichment block (the `depRows` query and the loop that fills `dependenciesByTask` and `blockedByCounts`) with a single call:

```ts
import { openBlockerCounts } from '@/lib/blockers-server'
// ...
const blockedByCounts = await openBlockerCounts(drizzle, 'task', taskIds)
```

Delete `dependenciesByTask` and stop attaching `dependencies` to each row: a repo-wide grep finds no reader for it, and shipping an unread array on every task is a lie about what the shape means. `blockedByCount` stays, and now counts request blockers too, with the right closed set per type.

- [ ] **Step 2: `app/api/admin/requests/route.ts`**

After the participants pass, add the same call over the returned ids and attach `blockedByCount` to each row. Do **not** write a correlated subquery: the closed-status lists differ per blocker type and neither belongs in SQL.

- [ ] **Step 3: `app/api/admin/tasks/[id]/route.ts`**

In `DELETE`, before `drizzle.delete(schema.tasks)`:

```ts
// No foreign keys on a polymorphic edge, so nothing cascades. This is the
// only hard delete in the codebase; requests archive instead, and archived is
// already a closed status.
await sweepBlockers(drizzle, { type: 'task', id })
```

Update the stale comment on the next line: subtasks still cascade, dependency rows no longer do.

- [ ] **Step 4: `lib/requests-views.ts` and its test**

Add to `RequestRow`:

```ts
  /** Open blockers, counted by the list route. Absent on rows fetched by an
   *  older caller, which reads as not blocked. */
  blockedByCount?: number
```

Add the predicate and the view, mirroring `isTaskBlocked`:

```ts
/** Blocked in the sense the rail reads it. A request has no `blocked` status
 *  of its own (`on_hold` is a human decision, not a derived one), so unlike
 *  the tasks predicate this is only ever the count. */
export function isRequestBlocked(row: RequestRow): boolean {
  return (row.blockedByCount ?? 0) > 0
}
```

and, in `TEAM_SAVED_VIEWS` only, between `overdue` and `week`:

```ts
  { key: 'blocked',   label: 'Blocked',         test: r => isRequestBlocked(r) },
```

Not in `CLIENT_SAVED_VIEWS`: Decision 13.

Tests to add to `lib/requests-views.test.ts`: an absent count reads as not blocked; a count of one is blocked; the `blocked` key is present in the team list and absent from the client list; `savedViewsFor('client')` never returns it.

- [ ] **Step 5: `lib/tasks-board-items.ts` and its test**

Replace the hardcoded `Blocked by N task(s)` with `blockedWarningLabel(row.blockedByCount ?? 0, false)` from `lib/blockers.ts`. Add a test that a count of two produces "Blocked by 2 items", so the tasks board and the requests board say the same thing about the same idea.

- [ ] **Step 6: Verify and commit**

Run: `npx vitest run && npm run type-check && npm run lint`
Expected: all pass.

```bash
git add app/api/admin/tasks app/api/admin/requests/route.ts lib/requests-views.ts lib/requests-views.test.ts lib/tasks-board-items.ts lib/tasks-board-items.test.ts
git commit -m "feat(blockers): open blocker counts on both list routes, one sweep, one predicate"
```

### Task A.6: The tasks side reads polymorphic blockers

- [ ] **Step 1: `components/tahi/tasks/task-types.ts`**

Delete `TaskDependencyRow` and re-export the shared shape:

```ts
export type { BlockerRow } from '@/lib/blockers'
```

Every importer of `TaskDependencyRow` moves to `BlockerRow`. There are two: `task-detail-panel.tsx` and `tasks-content.tsx`.

- [ ] **Step 2: `components/tahi/tasks/task-detail-panel.tsx`, the Waiting on card**

Card title is unchanged (Decision 14). What changes inside it:

- **Props.** The prop that changes is **`blockedBy`**, declared at line 115 as `readonly TaskDependencyRow[] | undefined`. It becomes `readonly BlockerRow[] | undefined` and keeps its name, so the shell's SWR memo at `tasks-content.tsx:411` maps to the same key. The local alias at line 775 (`const blockers = blockedBy ?? []`) is unchanged. `blockerCandidates` (line 117) is **deleted**; in its place `onSearchBlockers: (query: string) => Promise<BlockerCandidate[]>`. `onAddBlocker` (line 143) becomes `(taskId: string, blocker: { type: BlockerSubjectType; id: string }) => Promise<void>`. `onRemoveBlocker` (line 144) takes `(taskId: string, linkId: string)`, renaming its second parameter from `depId`.
- **Rows.** Same layout as today: status badge, ellipsised title, Open, X. Three changes. A request row shows its `otherRef` (`#042`) in `var(--color-text-subtle)` at `0.71875rem` before the title, and carries the same `RequestChip`-style leading glyph the Links card uses, so the two kinds are distinguishable at a glance without a legend. Open routes to `/requests/<id>` for a request and calls `onOpenTask(id)` for a task.

  **The status badge must branch on the row's type.** `TaskStatusBadge` (`components/tahi/tasks/task-chips.tsx:306`) falls back to `TASK_STATUS_LABELS[status] ?? status` with a `neutral` tone, so feeding it a request status paints a grey pill reading the raw `client_review`. A request row renders the shape `components/tahi/requests/sub-request-rows.tsx:191` already uses:

  ```tsx
  <Badge tone={REQUEST_STATUS_TONE[row.otherStatus] ?? 'neutral'} variant="soft" size="sm" leader="dot">
    {REQUEST_STATUS_LABELS[row.otherStatus] ?? row.otherStatus}
  </Badge>
  ```

  Both maps are exported from `lib/status-config.ts` (lines 160 and 169). An orphan comes back with `otherStatus: 'unknown'`, which falls through to `neutral` and the literal word, which is the honest answer.
- **Picker.** Still `InlineMenuField`, and still no new primitive, but it needs the two props Decision 17 adds. Wire it as: `searchable`, `serverFiltered`, `onQueryChange={q => scheduleSearch(q)}` debounced at 250ms, `options` from the state `onSearchBlockers` fills, and `emptyMessage` switching between `Type to search tasks and requests` (empty query), `Searching...` (in flight) and `Nothing open matches that` (empty result). `searchPlaceholder` becomes `Search tasks and requests`. **Drop the `blockerOptions.length > 0` render guard at line 1022**, or the picker never appears: the list is empty until someone types. Each option's `node` is a type glyph plus, for a request, `#042 Title`, plus the client name in `var(--color-text-subtle)` when there is one. `keywords` still carries the title, the ref and the client name, so the component degrades sensibly if `serverFiltered` is ever turned off.
- **Error copy.** The route now returns the exact strings a human should read ("That would make a loop", "That link already exists", the family-pair sentence), so the panel stops string-matching for circular / loop / cycle and just surfaces `error` from the response. Delete the string match.
- **Empty line.** Unchanged: "Nothing is holding this up."

- [ ] **Step 3: `components/tahi/tasks/tasks-list.tsx`**

Line 150 re-implements the blocked predicate inline. Replace it with `isTaskBlocked` imported from `@/lib/tasks-views`. Do not touch `tasks-week.tsx`, which Slice B owns and which fixes its own copy.

- [ ] **Step 4: `app/(dashboard)/tasks/tasks-content.tsx`**

- SWR key becomes `/api/admin/tasks/{id}/blockers`; the response is `{ blockedBy, blocks }` in the new shape, so the mapping that invented `'Untitled task'` goes away (the server now names an orphan honestly).
- Delete `blockerCandidates`. Add `handleSearchBlockers`, a plain `fetch` of `/api/admin/blockers/search?q=&excludeType=task&excludeId=<taskId>` returning `candidates`.
- `handleAddBlocker` posts `{ blockerType, blockerId }`; `handleRemoveBlocker` deletes `.../blockers/<linkId>`. Both keep the existing `mutateDeps()` then `mutateTasks()` revalidation, because the count on the row and the list in the card must not disagree.
- On a non-OK response, toast the `error` string from the body rather than a generic message.

- [ ] **Step 5: Verify and commit**

Run: `npm run type-check && npm run lint && npx vitest run`

```bash
git add components/tahi/tasks/task-types.ts components/tahi/tasks/task-detail-panel.tsx components/tahi/tasks/tasks-list.tsx "app/(dashboard)/tasks/tasks-content.tsx"
git commit -m "feat(blockers): the tasks Waiting on card takes requests as well as tasks"
```

### Task A.7: The requests side gets blockers

- [ ] **Step 1: The Blocked by card on `app/(dashboard)/requests/[id]/request-detail.tsx`**

A `SidebarCard` composed from `components/tahi/rail/sidebar-card.tsx`, which was extracted from this very file, so this is a re-use and not a fifth copy.

- **Placement.** In the sticky rail column at line 2572, directly under the `TimeCard` and above the Actions card. A blocker is a reason the work is not moving, so it belongs beside the time and the status, not below the checklists.
- **Gate.** `{isAdmin && ...}`, matching `RequestTasksPanel` at line 2524. Writable only when `canWrite` (line 539), so an impersonating viewer sees the card read-only. The portal route returns no blocker data at all, so even a bypassed render has nothing to show.
- **Head.** `title="Blocked by"`, `icon={<AlertTriangle size={14} />}`, `count` = the number of open blockers. `SidebarCard` takes exactly `title`, `icon`, `count`, `action`, `bodyPadding` and `children`, and the file already imports it from `@/components/tahi/rail/sidebar-card` (line 52), not from the unrelated `components/tahi/sidebar-card.tsx` the deal detail uses.
- **Body.** The tasks card's row shape exactly: status badge, ref (for a request blocker) plus ellipsised title, an Open button, and an X to unlink. A task blocker's Open goes to `/tasks?task=<id>`, the deep link the tasks slide-over already answers. A request blocker's Open goes to `/requests/<id>`.
- **Empty.** `Nothing is holding this up.` Identical copy to the tasks card, because it is the identical statement.
- **Add.** The same `InlineMenuField` picker, calling `/api/admin/blockers/search?excludeType=request&excludeId=<requestId>`. Rendered only when `canWrite`.
- **Data.** Its own SWR key, `request-blockers:<id>`, over `/api/admin/requests/<id>/blockers`. Do not fold it into the detail route's payload: the card revalidates on its own writes and the detail payload is already large.
- **Tokens.** Verified against `app/globals.css`, because two of the obvious names are traps. **`--color-warning-text` does not exist at all**, and `--color-warning-bg` is deliberately not overridden in `.dark` (the comment at lines 1486 to 1492 says so out loud, and names the replacement). Use the **`--badge-warning-*`** family for anything amber that carries text: `--badge-warning-bg`, `--badge-warning-text`, `--badge-warning-border`, all three of which do resolve for dark (lines 1430 to 1432). `--color-warning` (`#fb923c`) is fine as a bare icon ink on the card surface, which is how `kanban-board.tsx:1243` already spends it. `--color-text-subtle` for the ref. No `--color-danger` (this slice does not compute overdue) and no `--color-brand-dark`.

- [ ] **Step 2: The list and board on `app/(dashboard)/requests/request-list.tsx`**

- **List glyph.** Beside the existing `scopeFlagged` glyph in both places it appears (the mobile card head at line 393 and the table Title cell at line 1334), add a blocked glyph when `isRequestBlocked(row)`, with `aria-label={"Blocked by " + n + " items"}` and a `title` carrying the same string. **It must not be `AlertTriangle`**: that is exactly what `scopeFlagged` already renders, in `var(--color-danger)`, at both sites. Use `PauseCircle` in `var(--color-warning)`. Two distinct glyphs in two distinct inks, because they mean different things and a single icon for both is a lie.
- **Board.** The `warning` field at line 1179 becomes `blockedWarningLabel(r.blockedByCount ?? 0, !!r.scopeFlagged)` from `lib/blockers.ts`. Both signals survive.
- **Saved view.** Nothing to do beyond the `lib/requests-views.ts` change: `countSavedViews` at line 701 picks the new view up automatically, and the client list never receives it.

- [ ] **Step 3: The spine chip on `components/tahi/requests/delivery-spine.tsx`**

- New optional prop `blockedByCount?: number`, alongside the existing `eta?: string | null` (line 132). When it is above zero, render a chip in the header row beside the `eta` slot (rendered at lines 185 to 194): text `Blocked by {n}`, `background: var(--badge-warning-bg)`, `color: var(--badge-warning-text)`, `border: 1px solid var(--badge-warning-border)`, `border-radius: var(--radius-badge)`, `font: 600 0.6875rem`, and an `AlertTriangle` at 11px. **Do not use `--color-warning-bg` and `--color-warning-text`**: the second does not exist, and the first is documented in `app/globals.css:1486` as deliberately not dark-mode overridden, with `--badge-warning-*` named as the replacement. Simplest of all: `<Badge tone="warning" variant="soft" size="sm">`, which resolves the same three tokens.
- **Not a node.** Do not add a sixth step. Every entry in `PIPELINE_STATUSES` (line 110) is a status setter, and a blocked request is usually still `in_progress`.
- The prop is passed from `request-detail.tsx` from the same SWR data the card reads.

- [ ] **Step 4: Verify and commit**

Run: `npm run type-check && npm run lint && npm run build`

```bash
git add "app/(dashboard)/requests/[id]/request-detail.tsx" "app/(dashboard)/requests/request-list.tsx" components/tahi/requests/delivery-spine.tsx
git commit -m "feat(blockers): Blocked by on the request detail, list, board and spine"
```

### Task A.8: MCP parity

- [ ] **Step 1: Four new tools in `workers/mcp-server/src/index.ts`**

Beside the existing dependency trio (around line 514):

```ts
  tool('list_blockers', 'List what a task or request is blocked by, and what is waiting on it', {
    subjectType: prop('string', "'task' or 'request'"),
    subjectId: prop('string', 'The task or request ID'),
  }, ['subjectType', 'subjectId']),
  tool('add_blocker', 'Say that a task or request cannot start until another task or request finishes', {
    subjectType: prop('string', "'task' or 'request': the thing that is blocked"),
    subjectId: prop('string', 'ID of the thing that is blocked'),
    blockerType: prop('string', "'task' or 'request': the thing it waits on"),
    blockerId: prop('string', 'ID of the thing it waits on'),
  }, ['subjectType', 'subjectId', 'blockerType', 'blockerId']),
  tool('remove_blocker', 'Remove one blocker link', {
    subjectType: prop('string', "'task' or 'request'"),
    subjectId: prop('string', 'The blocked task or request ID'),
    linkId: prop('string', 'The link ID from list_blockers'),
  }, ['subjectType', 'subjectId', 'linkId']),
  tool('search_blocker_candidates', 'Search open tasks and requests that could be used as a blocker', {
    q: prop('string', 'Title text, or a request number like 042'),
    excludeType: prop('string', "'task' or 'request' to leave out of the results"),
    excludeId: prop('string', 'ID to leave out of the results'),
  }, ['q']),
```

Dispatch maps the type to its plural path segment (`task` to `tasks`, `request` to `requests`) and proxies the admin routes, exactly as the existing dependency cases do.

- [ ] **Step 2: Keep and correct the three old tools**

`add_task_dependency`, `remove_task_dependency` and `list_task_dependencies` stay, proxying the alias routes. Add one sentence to each description: "Legacy. Prefer add_blocker / remove_blocker / list_blockers, which also accept a request."

Correct `delete_task`'s description (line 527). It currently promises that dependency links go with the task; that is now true because the route sweeps them, not because SQLite cascades, and the wording should not imply a foreign key that does not exist. New text: "Delete a task. Its checklist items cascade and its blocker links are swept."

- [ ] **Step 3: Verify and commit**

Run: `npm run type-check && npm run lint`

```bash
git add workers/mcp-server/src/index.ts
git commit -m "feat(blockers): worker MCP tools for the polymorphic blocker model"
```

### Task A.9: Close Slice A

- [ ] **Step 1: Full check**

Run: `npm run type-check && npm run lint && npx vitest run && npm run build`
Expected: type-check exit 0; lint clean; every test file passes; build succeeds.

- [ ] **Step 2: Hand to the lead**

Post the diff summary, and state explicitly: the migration has not been applied yet, the lead applies `0088` with `run_migration` against staging and prod after the deploy, and Slice C's MCP task is unblocked by this merge.

---

## Slice B: My week calendar

**Files:**
- Modify: `lib/tasks-planner.ts`, `lib/tasks-planner.test.ts`, `components/tahi/tasks/tasks-week.tsx`, `app/globals.css`

Nothing outside these four files. If the strip appears to need a prop, the design is wrong; stop and post to the lead.

### Task B.1: `buildWeekStrip` and friends

- [ ] **Step 1: Write the failing tests**

Append to `lib/tasks-planner.test.ts`, reusing the existing `WEDNESDAY` (line 5), `SUNDAY` (line 6) and `row()` (line 8) fixtures at the top of that file.

**Extend the existing import, do not add a second one.** Line 2 already reads `import { buildWeekGroups, formatHours, weekSummary } from './tasks-planner'`; add the three new names to it. Drop `type StripDay` unless a test actually annotates with it, or `no-unused-vars` fires. The import block below is written out in full for readability; it replaces line 2 rather than sitting under it.

```ts
import {
  buildWeekGroups,
  buildWeekStrip,
  stripLoad,
  stripRangeLabel,
  type StripDay,
} from './tasks-planner'

function taskOn(dueDate: string | null, estimatedHours: number | null = null): TaskRow {
  return row({ dueDate, estimatedHours })
}

describe('buildWeekStrip', () => {
  it('always returns seven cells, whatever day it is', () => {
    expect(buildWeekStrip([], WEDNESDAY)).toHaveLength(7)
    expect(buildWeekStrip([], SUNDAY)).toHaveLength(7)
  })

  it('starts on Monday every time, so the strip does not slide under you', () => {
    for (const now of [WEDNESDAY, SUNDAY]) {
      const strip = buildWeekStrip([], now)
      expect(strip[0].name).toBe('Monday')
      expect(strip[6].name).toBe('Sunday')
      expect(strip.map(d => d.letter)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S'])
    }
  })

  it('marks exactly one cell as today, and only inside the current week', () => {
    const thisWeek = buildWeekStrip([], WEDNESDAY)
    expect(thisWeek.filter(d => d.isToday)).toHaveLength(1)
    expect(buildWeekStrip([], WEDNESDAY, 1).some(d => d.isToday)).toBe(false)
    expect(buildWeekStrip([], WEDNESDAY, -1).some(d => d.isToday)).toBe(false)
  })

  it('refuses a drop on a day that has already gone', () => {
    const strip = buildWeekStrip([], WEDNESDAY)
    const past = strip.filter(d => d.isPast)
    expect(past.length).toBeGreaterThan(0)
    expect(past.every(d => !d.droppable)).toBe(true)
    expect(strip.filter(d => !d.isPast).every(d => d.droppable)).toBe(true)
  })

  it('counts a task on its own day and nowhere else', () => {
    const strip = buildWeekStrip([taskOn('2026-09-10', 3)], WEDNESDAY)
    const thursday = strip.find(d => d.dayKey === '2026-09-10')!
    expect(thursday.count).toBe(1)
    expect(thursday.estimatedHours).toBe(3)
    expect(strip.filter(d => d.count > 0)).toHaveLength(1)
  })

  it('ignores undated work and anything outside the shown week', () => {
    const strip = buildWeekStrip(
      [taskOn(null), taskOn('2026-10-01'), taskOn('2025-01-01')],
      WEDNESDAY,
    )
    expect(strip.every(d => d.count === 0)).toBe(true)
  })

  it('agrees with buildWeekGroups on every day they both cover', () => {
    const rows = [
      taskOn('2026-09-09', 2), taskOn('2026-09-10', 1.5),
      taskOn('2026-09-10'), taskOn('2026-09-13', 4),
    ]
    const strip = buildWeekStrip(rows, WEDNESDAY)
    const groups = buildWeekGroups(rows, WEDNESDAY)
    for (const group of groups) {
      if (!group.dueDate) continue
      const cell = strip.find(d => d.dayKey === group.dueDate)
      if (!cell) continue
      expect(cell.count).toBe(group.tasks.length)
      expect(cell.estimatedHours).toBeCloseTo(group.estimatedHours, 5)
    }
  })

  it('splits the flat Overdue bucket back out per day', () => {
    const rows = [taskOn('2026-09-07'), taskOn('2026-09-08'), taskOn('2026-09-08')]
    const strip = buildWeekStrip(rows, WEDNESDAY)
    expect(strip.find(d => d.dayKey === '2026-09-07')!.count).toBe(1)
    expect(strip.find(d => d.dayKey === '2026-09-08')!.count).toBe(2)
  })

  it('pages a whole week at a time and writes the dates that page would plan', () => {
    const here = buildWeekStrip([], WEDNESDAY)
    const next = buildWeekStrip([], WEDNESDAY, 1)
    expect(next[0].dayKey).toBe(shiftKey(here[0].dayKey, 7))
    expect(next.every(d => d.droppable)).toBe(true)
  })
})

describe('stripLoad', () => {
  it('scales to the busiest day rather than an invented day length', () => {
    const days = buildWeekStrip(
      [taskOn('2026-09-09', 2), taskOn('2026-09-10', 4)],
      WEDNESDAY,
    )
    const light = days.find(d => d.dayKey === '2026-09-09')!
    const heavy = days.find(d => d.dayKey === '2026-09-10')!
    expect(stripLoad(heavy, days)).toBe(1)
    expect(stripLoad(light, days)).toBeCloseTo(0.5, 5)
  })

  it('falls back to counts when nothing carries an estimate', () => {
    const days = buildWeekStrip([taskOn('2026-09-09'), taskOn('2026-09-10'), taskOn('2026-09-10')], WEDNESDAY)
    expect(stripLoad(days.find(d => d.dayKey === '2026-09-10')!, days)).toBe(1)
    expect(stripLoad(days.find(d => d.dayKey === '2026-09-09')!, days)).toBeCloseTo(0.5, 5)
  })

  it('is zero on an empty week rather than dividing by nothing', () => {
    const days = buildWeekStrip([], WEDNESDAY)
    expect(stripLoad(days[0], days)).toBe(0)
  })
})

describe('stripRangeLabel', () => {
  it('names one month once', () => {
    expect(stripRangeLabel(buildWeekStrip([], WEDNESDAY))).toBe('7 to 13 Sep')
  })

  it('names both months when the week crosses one', () => {
    const label = stripRangeLabel(buildWeekStrip([], new Date(2026, 8, 30)))
    expect(label).toBe('28 Sep to 4 Oct')
  })
})
```

Add the small `shiftKey` helper the paging test uses next to the fixtures, built from `taskShiftedDayKey` so it cannot drift from production date maths.

Run: `npx vitest run lib/tasks-planner.test.ts`
Expected: fails, the four new exports do not exist.

- [ ] **Step 2: Write the helpers in `lib/tasks-planner.ts`**

Append, below `weekSummary`:

```ts
/** One cell of the week strip. */
export interface StripDay {
  /** Namespaced so it can never collide with a PlannerGroup key in the
   *  component's single drag-over state. */
  key: string
  dayKey: string
  /** 'M', 'T', 'W'... the header letter. Two of them repeat, which is what a
   *  calendar does. */
  letter: string
  dayOfMonth: number
  name: string
  /** 'Monday 8 Sep'. The aria-label and the title attribute. */
  label: string
  count: number
  estimatedHours: number
  isToday: boolean
  isPast: boolean
  /** You plan work forward. A day that has gone takes no drops, the same rule
   *  buildWeekGroups states for Overdue. */
  droppable: boolean
}

/** Monday of the week containing `now`, shifted by whole weeks. */
function weekStart(now: Date, weekOffset: number): Date {
  const dow = now.getDay()
  // getDay is 0 for Sunday, and the studio's week ends on Sunday, so Sunday
  // belongs to the week that started six days earlier, not the next one.
  const backToMonday = dow === 0 ? 6 : dow - 1
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - backToMonday + weekOffset * 7)
}

/**
 * The seven cells above the day cards.
 *
 * Three things buildWeekGroups cannot give the strip, which is why this is a
 * second pass over the same rows rather than a projection of the first:
 * the days already gone this week (that loop starts at offset 0), a per day
 * split of the flat Overdue bucket, and a weekday letter plus day number per
 * cell. The cross-check test asserts the two agree wherever they overlap.
 */
export function buildWeekStrip(
  rows: readonly TaskRow[],
  now: Date,
  weekOffset = 0,
): StripDay[] {
  const start = weekStart(now, weekOffset)
  const todayKey = taskDayKey(now)

  const byDay = new Map<string, TaskRow[]>()
  for (const row of rows) {
    const d = row.dueDate ? row.dueDate.slice(0, 10) : null
    if (d === null) continue
    const bucket = byDay.get(d)
    if (bucket) bucket.push(row)
    else byDay.set(d, [row])
  }

  const days: StripDay[] = []
  for (let i = 0; i < 7; i += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    const dayKey = taskDayKey(date)
    const name = DAY_NAMES[date.getDay()]
    const tasks = byDay.get(dayKey) ?? []
    const isPast = dayKey < todayKey
    days.push({
      key: `strip:${dayKey}`,
      dayKey,
      letter: name.charAt(0),
      dayOfMonth: date.getDate(),
      name,
      label: `${name} ${shortDate(date)}`,
      count: tasks.length,
      estimatedHours: sumEstimate(tasks),
      isToday: dayKey === todayKey,
      isPast,
      droppable: !isPast,
    })
  }

  return days
}

/**
 * Relative load, 0 to 1, for the bar under a cell.
 *
 * Scaled to the busiest day in the strip, not to an invented eight hour day:
 * teamMembers.weeklyCapacityHours exists but is not on the wire, and a made
 * up ceiling would be a lie rendered as a bar. Hours when anything carries an
 * estimate, counts otherwise, so a week with no estimates still shows shape.
 */
export function stripLoad(day: StripDay, days: readonly StripDay[]): number {
  const maxHours = days.reduce((max, d) => Math.max(max, d.estimatedHours), 0)
  if (maxHours > 0) return day.estimatedHours / maxHours
  const maxCount = days.reduce((max, d) => Math.max(max, d.count), 0)
  if (maxCount > 0) return day.count / maxCount
  return 0
}

/** '7 to 13 Sep', or '28 Sep to 4 Oct' when the week crosses a month. */
export function stripRangeLabel(days: readonly StripDay[]): string {
  if (days.length === 0) return ''
  const first = days[0]
  const last = days[days.length - 1]
  const firstMonth = first.dayKey.slice(5, 7)
  const lastMonth = last.dayKey.slice(5, 7)
  const monthOf = (dayKey: string): string => MONTHS[Number(dayKey.slice(5, 7)) - 1]
  if (firstMonth === lastMonth) {
    return `${first.dayOfMonth} to ${last.dayOfMonth} ${monthOf(last.dayKey)}`
  }
  return `${first.dayOfMonth} ${monthOf(first.dayKey)} to ${last.dayOfMonth} ${monthOf(last.dayKey)}`
}
```

- [ ] **Step 3: Verify and commit**

Run: `npx vitest run lib/tasks-planner.test.ts`
Expected: all pass, including the cross-check.

```bash
git add lib/tasks-planner.ts lib/tasks-planner.test.ts
git commit -m "feat(tasks): the week strip maths, cross-checked against the planner groups"
```

### Task B.2: The strip inside `tasks-week.tsx`

- [ ] **Step 1: Render it inside the plate that is already there**

No new props. `weekOffset` is local state initialised to 0.

**Where.** The summary plate (`.tskw-sum`, currently one flex row of four stats plus a hint) becomes two rows inside the same bordered card: row one is exactly what ships today, row two is the strip. Same border, same radius, same shadow, one internal divider of `1px solid var(--color-border-subtle)` above the strip. The page gains one row, not one card. That is what "it looks nice now" buys.

**Strip head.** A single line above the seven cells: a left chevron button, `stripRangeLabel(days)` at `font: 600 0.75rem` in `var(--color-text-muted)`, a right chevron, and, when `weekOffset !== 0`, a text button reading `This week` that returns to 0. Chevrons are `1.75rem` square at `md` and above, `2.75rem` below. All three get `className="tahi-focus-ring"`.

**Cells.** `display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.25rem`. Each cell is a `<button type="button">`, `min-height: 2.75rem`, `border-radius: var(--radius-md)`, `border: 1px solid transparent`, `background: transparent`, stacked centre-aligned:

1. the weekday letter, `font: 600 0.625rem`, `letter-spacing: 0.06em`, `text-transform: uppercase`, `color: var(--color-text-subtle)`;
2. the day number, `font: 700 0.8125rem`, `font-variant-numeric: tabular-nums`, `color: var(--color-text)`;
3. a load bar: a `0.1875rem` tall track in `var(--color-border-subtle)` at `border-radius: var(--radius-full)`, filled to `stripLoad(day, days) * 100%` in `var(--color-brand-100)` (translucent in dark, so it reads on both canvases). No bar when the load is 0;
4. the count, `font: 500 0.6875rem` tabular in `var(--color-text-subtle)`, reading `{count}` alone. Hidden when the count is 0.

**States.**
- Today: the day number sits in a filled chip, `background: var(--color-brand)`, `color: var(--color-bg)`, `border-radius: var(--radius-full)`, `min-width: 1.5rem`. Never `--color-brand-dark`.
- Past: the whole cell at `opacity: 0.55`, `cursor: default`, no drop handlers, and `aria-disabled="true"` rather than `disabled` so it stays reachable by the roving tabindex and can still be read out.
- Hover and focus on a droppable cell: `background: var(--color-bg-secondary)`, `border-color: var(--color-border)`.
- Drag over: `border-color: var(--color-brand)`, `background: color-mix(in srgb, var(--color-brand-100) 45%, var(--color-bg))`. The same treatment the day cards already use, so the two read as one system.

**Accessible name.** `aria-label={`${day.label}, ${day.count} ${day.count === 1 ? 'task' : 'tasks'}`}`, plus `title={day.label}`.

- [ ] **Step 2: Drag**

Reuse the existing `dragId` state and the existing `onPlan` callback. Two implementation notes that are not optional:

- **Give the strip its own drag-over state**, or namespace the key. `overKey` at line 232 is a single string shared with the day cards; `StripDay.key` is already prefixed `strip:` for exactly this reason, so reusing `overKey` is safe as long as the day cards keep using the group key. Verify by dragging over a cell and confirming the matching day card does not also light up.
- **Keep the guarded `dragleave`** (the pattern at lines 378 to 382 that ignores leaves into descendants), or the outline strobes.

On drop: `onPlan(taskId, day.dayKey, day.label)`. The third argument only feeds the toast, so "Planned for Tuesday 15 Sep" needs no signature change. After a drop into the current week, scroll the matching day card into view with `block: 'nearest'` and flash a `var(--shadow-ring)` for 600ms, skipped under `prefers-reduced-motion`.

Paging forward and dropping is the capability the strip adds: today the `Later` bucket flattens every future date to `daysLeft + 1`, so there is no way to plan a specific day next week from the planner at all.

- [ ] **Step 3: Keyboard**

The strip is `role="group"` with `aria-label="Week"`. Roving tabindex: one cell has `tabIndex={0}` (today when visible, otherwise the first cell), the rest `tabIndex={-1}`.

| Key | Action |
|---|---|
| Left / Right | move focus one cell, clamped at the ends |
| Home / End | first / last cell |
| PageUp / PageDown | page the strip one week back / forward, keeping the focused weekday |
| Enter / Space | move focus to that day's card in the plate below, `scrollIntoView({ block: 'nearest' })` |

Then the piece the planner has never had: on a focused task row, `Alt+ArrowRight` and `Alt+ArrowLeft` move its due date by one day and `Alt+ArrowUp` clears it, each calling the same `onPlan`. That is the keyboard equivalent of the drag, it costs one handler, and without it the whole planner stays mouse only.

- [ ] **Step 4: 375px**

Seven cells across 375px, less the plate's padding, leaves roughly 44px each, which is exactly the floor with no margin. Degrade in this order inside one `@media (max-width: 26.5rem)` block in `app/globals.css`:

1. hide the count line;
2. shrink the day number to `0.75rem`;
3. if it still overflows in the browser, the fallback is a `scroll-snap-type: x mandatory` strip, the pattern `components/tahi/kanban-board.tsx:321` already uses inside its own `@media (max-width: 47.9375rem)` block.

This must be checked in a real browser at 375px before the slice is called done. Guessing here is how a 44px target becomes a 41px one.

- [ ] **Step 5: The two token fixes**

`tasks-week.tsx:129` (`.tskw-day.is-today .tskw-day-name`) and `:208` (the drop-zone copy) both use `var(--color-brand-dark)`, which has no dark-mode definition and renders very dark green on a near-black canvas. Replace both with `var(--color-link)`. Do not redefine `--color-brand-dark` in `globals.css`: it is also used as a hover background elsewhere on this surface, and lightening it would break white text sitting on it. The wider audit is Slice D's follow-up note.

- [ ] **Step 6: The inline predicate**

Line 288 re-implements `isTaskBlocked`. Replace it with the import from `@/lib/tasks-views`. Slice A fixes the other two (`tasks-list.tsx:150` and `task-detail-panel.tsx:868`) and does not touch this file. Three inline copies, one canonical predicate at `lib/tasks-views.ts:137`.

- [ ] **Step 7: Verify and commit**

Run: `npm run type-check && npm run lint && npx vitest run`

```bash
git add components/tahi/tasks/tasks-week.tsx app/globals.css
git commit -m "feat(tasks): a week strip inside My week, with drag, keyboard and paging"
```

### Task B.3: Close Slice B

- [ ] **Step 1: Full check**

Run: `npm run type-check && npm run lint && npx vitest run && npm run build`

- [ ] **Step 2: Hand to the lead** with a note naming the 375px degradation actually used and whether the scroll-snap fallback was needed.

---

## Slice C: AI and document driven task creation

**Files:**
- Create: `lib/task-wizard-drafts.ts`, `lib/task-wizard-drafts.test.ts`, `lib/ai-documents.ts`, `lib/ai-documents.test.ts`
- Modify: `lib/ai-cost.ts`, `app/api/admin/ai/task-wizard/route.ts`, `components/tahi/ai-task-wizard.tsx`, `components/tahi/tasks/new-task-dialog.tsx`

**Two hard boundaries.** Slice C must not edit `app/(dashboard)/tasks/tasks-content.tsx` or `app/(dashboard)/requests/[id]/request-detail.tsx`. Every new prop on `AiTaskWizard` is optional, and the AI view lives inside `NewTaskDialog`, which owns its own view state exactly as `new-request-dialog.tsx` does.

### Task C.1: `lib/ai-documents.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/ai-documents.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_TEXT_CAP,
  base64ByteLength,
  classifyDocument,
  decodeBase64Text,
  documentIntro,
  truncateForPrompt,
} from './ai-documents'

describe('classifyDocument', () => {
  it('reads plain text families as text', () => {
    expect(classifyDocument('brief.txt', 'text/plain').kind).toBe('text')
    expect(classifyDocument('brief.md', 'text/markdown').kind).toBe('text')
    expect(classifyDocument('rows.csv', 'text/csv').kind).toBe('text')
    expect(classifyDocument('export.json', 'application/json').kind).toBe('text')
  })

  it('trusts the extension when the browser sends nothing useful', () => {
    expect(classifyDocument('brief.md', '').kind).toBe('text')
    expect(classifyDocument('brief.md', 'application/octet-stream').kind).toBe('text')
  })

  it('routes a pdf to the document block path', () => {
    expect(classifyDocument('scope.pdf', 'application/pdf').kind).toBe('pdf')
  })

  it('refuses docx by name, with the way out in the message', () => {
    const result = classifyDocument(
      'scope.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    expect(result.kind).toBe('unsupported')
    expect(result.reason).toContain('PDF')
  })

  it('refuses anything else without pretending to know what it is', () => {
    const result = classifyDocument('shot.png', 'image/png')
    expect(result.kind).toBe('unsupported')
    expect(result.reason).toBeTruthy()
  })
})

describe('base64ByteLength', () => {
  it('measures the decoded size, not the encoded one', () => {
    expect(base64ByteLength(btoa('hello'))).toBe(5)
    expect(base64ByteLength(btoa('hi'))).toBe(2)
    expect(base64ByteLength('')).toBe(0)
  })

  it('has a cap a 5 MB file passes and a 6 MB file does not', () => {
    expect(DOCUMENT_MAX_BYTES).toBe(5 * 1024 * 1024)
  })
})

describe('decodeBase64Text', () => {
  it('round-trips utf-8, including the characters a brief actually contains', () => {
    const source = 'Kia ora. Colour, organise, centre. 50% off.'
    expect(decodeBase64Text(btoa(unescape(encodeURIComponent(source))))).toBe(source)
  })
})

describe('truncateForPrompt', () => {
  it('leaves a short document alone', () => {
    expect(truncateForPrompt('short')).toEqual({ text: 'short', truncated: false })
  })

  it('cuts at the cap and says so', () => {
    const long = 'x'.repeat(DOCUMENT_TEXT_CAP + 100)
    const result = truncateForPrompt(long)
    expect(result.text).toHaveLength(DOCUMENT_TEXT_CAP)
    expect(result.truncated).toBe(true)
  })
})

describe('documentIntro', () => {
  it('names the file so the model can cite it', () => {
    expect(documentIntro('scope.pdf', false)).toContain('scope.pdf')
  })

  it('says out loud when the model is only seeing part of it', () => {
    expect(documentIntro('scope.txt', true)).toContain('first part')
  })
})
```

- [ ] **Step 2: Write the module**

Create `lib/ai-documents.ts`:

```ts
/**
 * lib/ai-documents.ts
 *
 * Turning an uploaded brief into something Claude can read, inside a Worker.
 *
 * Scope is stated rather than discovered: text families are decoded here, a
 * PDF is handed to Claude as a document content block (it reads the file
 * itself), and .docx is refused with the way out in the message. There is no
 * zip reader in a Worker (DecompressionStream does gzip and deflate, not zip
 * containers) and no PDF text extractor in this repo, so anything else would
 * be a silent failure dressed as an answer.
 *
 * Nothing here persists. files.orgId is NOT NULL and a studio task has no
 * client, so an uploaded brief has no legal home in the files table; it is
 * read, used, and dropped, and the draft records which file it came from.
 */

/** 5 MB of actual file. Bigger than any brief the studio has ever been sent,
 *  small enough that a base64 body stays comfortable in a Worker. */
export const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024

/** Characters of extracted text handed to the model. Roughly ten thousand
 *  tokens, which is a long brief and a bounded bill. */
export const DOCUMENT_TEXT_CAP = 40_000

export type DocumentKind = 'text' | 'pdf' | 'unsupported'

export interface DocumentClassification {
  kind: DocumentKind
  /** Shown to the person verbatim when the kind is unsupported. */
  reason?: string
}

const TEXT_MIME = ['text/plain', 'text/markdown', 'text/csv', 'application/json']
const TEXT_EXT = ['.txt', '.md', '.markdown', '.csv', '.json', '.log']

function extensionOf(filename: string): string {
  const cut = filename.lastIndexOf('.')
  return cut === -1 ? '' : filename.slice(cut).toLowerCase()
}

/** Mime first, extension second. A browser drag often sends
 *  application/octet-stream for a .md, and refusing that would be silly. */
export function classifyDocument(filename: string, mimeType: string): DocumentClassification {
  const mime = (mimeType || '').toLowerCase().split(';')[0].trim()
  const ext = extensionOf(filename)

  if (mime === 'application/pdf' || ext === '.pdf') return { kind: 'pdf' }
  if (TEXT_MIME.includes(mime) || mime.startsWith('text/')) return { kind: 'text' }
  if (TEXT_EXT.includes(ext)) return { kind: 'text' }

  if (ext === '.docx' || ext === '.doc' || mime.includes('wordprocessingml')) {
    return {
      kind: 'unsupported',
      reason: 'Word files cannot be read here yet. Export it as a PDF, or paste the text straight into the chat.',
    }
  }

  return {
    kind: 'unsupported',
    reason: 'That file type cannot be read here. Text, Markdown, CSV and PDF work, or paste the text into the chat.',
  }
}

/** Decoded size in bytes, without decoding the whole thing. */
export function base64ByteLength(dataBase64: string): number {
  const clean = dataBase64.replace(/[\r\n]/g, '')
  if (clean.length === 0) return 0
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  return Math.floor((clean.length * 3) / 4) - padding
}

/** Base64 to a UTF-8 string. `atob` and TextDecoder are both in the Workers
 *  runtime and in node, so this needs no polyfill and no Buffer. */
export function decodeBase64Text(dataBase64: string): string {
  const binary = atob(dataBase64.replace(/[\r\n]/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

export function truncateForPrompt(
  text: string,
  cap: number = DOCUMENT_TEXT_CAP,
): { text: string; truncated: boolean } {
  if (text.length <= cap) return { text, truncated: false }
  return { text: text.slice(0, cap), truncated: true }
}

/** The line above the extracted text, so the model knows what it is looking
 *  at and, when the file was long, that it is not looking at all of it. */
export function documentIntro(filename: string, truncated: boolean): string {
  const base = `The following is the content of an uploaded document called "${filename}".`
  return truncated
    ? `${base} Only the first part of it is included here, so say so if the work looks incomplete.`
    : base
}
```

- [ ] **Step 3: Verify and commit**

Run: `npx vitest run lib/ai-documents.test.ts`

```bash
git add lib/ai-documents.ts lib/ai-documents.test.ts
git commit -m "feat(tasks): document classification and extraction for the AI wizard"
```

### Task C.2: `lib/task-wizard-drafts.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/task-wizard-drafts.test.ts` covering:

- `normaliseWizardPriority` maps `low` and `medium` and `none` to `standard`, passes `high` and `urgent` through, and falls back to `standard` for anything unknown. This is the same alias table `TEMPLATE_PRIORITY_ALIASES` (`new-task-dialog.tsx:71`) already uses for templates, and it is the fix for the live drift where the wizard's four value scale (`PRIORITY_OPTIONS` at `ai-task-wizard.tsx:80`, `['low','medium','high','urgent']`) met the task's three value one (`TASK_PRIORITIES` at `lib/task-priorities.ts:15`, `['standard','high','urgent']`).
- `resolveDraftClient('Safe Recruitment', clients)` matches case-insensitively and on a unique prefix, returns null on an ambiguous prefix rather than guessing, and returns null on no match.
- `resolveDraftAssignee` behaves the same over people.
- `draftToTaskFields` produces `type: 'tahi_internal'` with no client, `internal_client_task` with a client and no explicit level, and never `client_task` unless the draft said so, which is Decision 13 and 16 of the port plan carried forward.
- `buildCreateTaskBody` sends `estimatedHours`, `dueDate`, `assigneeId`, `requestId`, `status` and `subtasks` as real fields, and does **not** append `Category: x` to the description. The category goes in the note as a readable line only when the model set one, because `tasks` has no category column.
- A draft with an empty title is rejected by `buildCreateTaskBody` returning null, so an empty task cannot be filed by pressing a button twice.

- [ ] **Step 2: Write the module**

```ts
/**
 * lib/task-wizard-drafts.ts
 *
 * The pure half of AI task creation: the priority alias table, the two name
 * resolvers, and the two body builders (one for the create form, one for the
 * API).
 *
 * It lives in lib/ rather than being exported from the component the way the
 * request wizard's helpers are, so the tests never import a 'use client'
 * module. Structural typing means the dialog's NewTaskDraft satisfies
 * TaskFields without either file importing the other.
 */

import { TASK_PRIORITIES } from '@/lib/task-priorities'
import type { TaskLevel } from '@/lib/tasks-views'

export interface TaskWizardDraft {
  id: string
  title: string
  description: string
  /** Free text from the model. There is no category column on tasks, so this
   *  survives as a line in the note or not at all. */
  category: string | null
  priority: string
  estimatedHours: number | null
  dueDate: string | null
  /** Names, not ids. The model never sees an id, so it can never invent one
   *  that happens to exist. */
  clientName: string | null
  assigneeName: string | null
  requestRef: string | null
  checklist: string[]
}

/** The wizard's old four value scale, and every synonym a model reaches for,
 *  mapped onto the repo's three. */
const PRIORITY_ALIASES: Record<string, string> = {
  none: 'standard', low: 'standard', medium: 'standard', normal: 'standard',
  standard: 'standard', high: 'high', urgent: 'urgent', critical: 'urgent',
}

export function normaliseWizardPriority(raw: unknown): string {
  const key = typeof raw === 'string' ? raw.toLowerCase().trim() : ''
  const mapped = PRIORITY_ALIASES[key]
  if (mapped) return mapped
  return (TASK_PRIORITIES as readonly string[]).includes(key) ? key : 'standard'
}

export interface NamedOption { id: string; name: string }

/** Case-insensitive exact match, then a unique prefix. An ambiguous prefix
 *  returns null on purpose: filing against the wrong client silently is worse
 *  than making the human pick. */
export function resolveByName(name: string | null, options: readonly NamedOption[]): string | null {
  if (!name) return null
  const needle = name.trim().toLowerCase()
  if (!needle) return null
  const exact = options.filter(o => o.name.trim().toLowerCase() === needle)
  if (exact.length === 1) return exact[0].id
  const prefix = options.filter(o => o.name.trim().toLowerCase().startsWith(needle))
  return prefix.length === 1 ? prefix[0].id : null
}

export const resolveDraftClient = resolveByName
export const resolveDraftAssignee = resolveByName

export interface DraftContext {
  clients: readonly NamedOption[]
  people: readonly NamedOption[]
  requests: readonly { id: string; requestNumber: number | null }[]
  /** Set when the wizard was opened from a place that already knows. */
  orgId?: string | null
  requestId?: string | null
  /** Set only when the operator chose one. Otherwise the level is derived. */
  level?: TaskLevel | null
}

export interface TaskFields {
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

/**
 * A draft plus what the page knows, resolved into the exact shape the create
 * form takes.
 *
 * The level rule is the one the detail panel already applies: a task that
 * gains a client becomes Internal, not Client. An AI-drafted chaser is
 * normally studio work about a client, not something the client will read.
 */
export function draftToTaskFields(draft: TaskWizardDraft, ctx: DraftContext): TaskFields | null {
  const title = draft.title.trim()
  if (!title) return null

  const orgId = ctx.orgId ?? resolveDraftClient(draft.clientName, ctx.clients)
  const requestId = ctx.requestId ?? resolveRequestRef(draft.requestRef, ctx.requests)
  const level: TaskLevel = ctx.level ?? (orgId ? 'internal_client_task' : 'tahi_internal')

  const noteLines: string[] = []
  if (draft.description.trim()) noteLines.push(draft.description.trim())
  if (draft.category) noteLines.push(`Category: ${draft.category}`)

  return {
    title,
    type: level,
    orgId,
    requestId,
    description: noteLines.length > 0 ? noteLines.join('\n\n') : null,
    status: 'todo',
    priority: normaliseWizardPriority(draft.priority),
    assigneeId: resolveDraftAssignee(draft.assigneeName, ctx.people),
    dueDate: draft.dueDate,
    estimatedHours: draft.estimatedHours,
    subtasks: draft.checklist.filter(c => c.trim().length > 0),
  }
}

/** '#042' or '42' onto a request id. */
export function resolveRequestRef(
  ref: string | null,
  requests: readonly { id: string; requestNumber: number | null }[],
): string | null {
  if (!ref) return null
  const n = Number.parseInt(ref.replace(/^#/, ''), 10)
  if (!Number.isFinite(n)) return null
  const match = requests.filter(r => r.requestNumber === n)
  return match.length === 1 ? match[0].id : null
}

/** The POST body. Identical fields to the create form, because the create
 *  route already accepts every one of them; the old wizard simply never sent
 *  them and stringified two of them into the description instead. */
export function buildCreateTaskBody(
  draft: TaskWizardDraft,
  ctx: DraftContext,
): Record<string, unknown> | null {
  const fields = draftToTaskFields(draft, ctx)
  if (!fields) return null
  return {
    title: fields.title,
    type: fields.type,
    orgId: fields.orgId,
    requestId: fields.requestId,
    description: fields.description,
    status: fields.status,
    priority: fields.priority,
    assigneeId: fields.assigneeId,
    dueDate: fields.dueDate,
    estimatedHours: fields.estimatedHours,
    subtasks: fields.subtasks,
  }
}
```

- [ ] **Step 3: Verify and commit**

Run: `npx vitest run lib/task-wizard-drafts.test.ts`

```bash
git add lib/task-wizard-drafts.ts lib/task-wizard-drafts.test.ts
git commit -m "feat(tasks): the pure draft resolvers the AI wizard files through"
```

### Task C.3: The route, honest failures first

- [ ] **Step 1: Port the failure semantics**

In `app/api/admin/ai/task-wizard/route.ts`, add the three payloads from the request route verbatim (its lines 61 to 77) and replace every silent fallback:

```ts
const DEGRADED = { degraded: true, reason: 'ai_unavailable' } as const

const AI_UNAVAILABLE = {
  error: 'The AI assistant could not be reached. Try again shortly, or write the tasks yourself.',
  reason: 'ai_unavailable',
} as const

const AI_RATE_LIMITED = {
  error: 'The AI assistant is busy right now. Wait a moment and send that again.',
  reason: 'ai_rate_limited',
} as const
```

- No `ANTHROPIC_API_KEY` in production returns `AI_UNAVAILABLE` with a 503. In development it returns the keyword draft spread with `DEGRADED`, which the panel paints as a notice.
- Empty model text returns `AI_UNAVAILABLE` with a 502.
- A 429 returns `AI_RATE_LIMITED` with a 429.
- Any other error returns `AI_UNAVAILABLE` with a 502.

The `handleDeterministic` keyword builder stays, but it is now reachable only in development and only flagged.

- [ ] **Step 2: Raise the output cap and bound the input**

```ts
/** 1024 truncated a fifteen task <tasks> block mid-array, JSON.parse threw,
 *  and the catch quietly degraded to a keyword draft: the wizard failed worst
 *  exactly when it was most useful. */
const MAX_OUTPUT_TOKENS = 4096

/** The model does not need the whole conversation to draft, and an unbounded
 *  history is an unbounded bill. */
const MAX_HISTORY_MESSAGES = 12
```

`messages.slice(-MAX_HISTORY_MESSAGES)` goes to the model; the full array is still validated.

- [ ] **Step 3: Accept a document**

Widen the body and the message shape:

```ts
interface WizardDocument {
  filename: string
  mimeType: string
  /** Base64, no data: prefix. JSON rather than multipart: a Worker parses
   *  JSON for free, and this file is never persisted (files.orgId is NOT
   *  NULL and a studio task has no client). */
  dataBase64: string
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}
```

Handling, in order:

```ts
if (body.document) {
  const { filename, mimeType, dataBase64 } = body.document
  if (base64ByteLength(dataBase64) > DOCUMENT_MAX_BYTES) {
    return NextResponse.json(
      { error: 'That file is larger than 5 MB. Send a smaller export, or paste the text.' },
      { status: 413 },
    )
  }
  const classified = classifyDocument(filename, mimeType)
  if (classified.kind === 'unsupported') {
    return NextResponse.json({ error: classified.reason }, { status: 415 })
  }
  // ...build the content blocks
}
```

For `text`: decode, truncate, and send one user message whose content is `documentIntro(filename, truncated) + '\n\n' + text`, followed by the operator's own instruction as the next block.

For `pdf`: send content blocks with the **document block first and the text block second**, which is what the Anthropic API expects:

```ts
const content: AnthropicContentBlock[] = [
  { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: dataBase64 } },
  { type: 'text', text: `${documentIntro(filename, false)}\n\n${instruction}` },
]
```

No beta header is needed for base64 PDF. Haiku 4.5 is a 200K context model, so the page ceiling is 100; say so in the size-refusal copy rather than letting a 300 page PDF fail obscurely.

- [ ] **Step 4: Record the cost**

After a successful call, read the usage the SDK already returns and write one row:

```ts
interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>
  usage?: { input_tokens?: number; output_tokens?: number }
}

// ...
const database = await db()
await recordCost(database, {
  scope: 'wizard',
  scopeId: context?.orgId ?? null,
  stage: body.document ? 'task_wizard_document' : 'task_wizard',
  provider: 'anthropic',
  model: HAIKU_MODEL,
  inputTokens: usage?.input_tokens ?? 0,
  outputTokens: usage?.output_tokens ?? 0,
  note: body.document ? body.document.filename : null,
})
```

A failed `recordCost` must never fail the wizard: wrap it so a logging problem cannot swallow a good draft.

Before the call, check the rolling day:

```ts
/** A soft daily ceiling on wizard spend. Not a per call cap: a cap that
 *  stops a conversation halfway is worse than a bounded input. This one is
 *  a circuit breaker for a runaway loop, and it says so out loud. */
const WIZARD_DAILY_CAP_CENTS = 500
```

Sum `ai_cost_log` where `scope = 'wizard'` and `created_at >= <start of today, ISO>`; over the cap, return a 429 with `The AI assistant has hit today's spend ceiling. It resets at midnight, or raise WIZARD_DAILY_CAP_CENTS.` One indexed query (`idx_ai_cost_log_created` exists).

- [ ] **Step 5: Widen the draft**

`parseTasksFromResponse` now returns `TaskWizardDraft`: `category` stays free text, `priority` goes through `normaliseWizardPriority`, and four new optional fields are parsed if present (`dueDate` as `YYYY-MM-DD` only, `clientName`, `assigneeName`, `requestRef`, `checklist` as a string array capped at 12 entries). The `type: 'small' | 'large'` field is dropped: it was the requests vocabulary on a task and nothing consumed it.

The system prompt gains a short block listing the clients, people and open request refs the caller passed in `context`, and the instruction that it must answer with **names** from those lists or omit the field. Never ids.

- [ ] **Step 6: Verify and commit**

Run: `npm run type-check && npm run lint && npm run build`

```bash
git add app/api/admin/ai/task-wizard/route.ts lib/ai-cost.ts
git commit -m "feat(tasks): honest failures, document input and cost recording on the task wizard route"
```

Note that `lib/ai-cost.ts` in this commit carries two changes: `wizard` added to the `Scope` union, and the Opus and Sonnet rate rows corrected per Decision 31.

### Task C.4: `components/tahi/ai-task-wizard.tsx`, split and grow

- [ ] **Step 1: Split into panel and drawer**

Mirror `ai-request-wizard.tsx` lines 272 and 838 exactly:

```tsx
export interface AiTaskWizardPanelProps {
  onTasksCreated?: () => void
  context?: { orgId?: string; trackType?: string; requestId?: string; level?: TaskLevel }
  seed?: string
  mutateKeys?: string[]
  /** The lists the model chooses names from and the resolvers map back. */
  clients?: readonly NamedOption[]
  people?: readonly NamedOption[]
  requests?: readonly { id: string; requestNumber: number | null; title: string }[]
  /** Hand one draft back to a create form instead of filing it. When this is
   *  set it becomes the primary action, exactly as it is on the request side. */
  onDraftToForm?: (fields: TaskFields) => void
  /** The escape hatch beside it. */
  onWriteItMyself?: () => void
}

export function AiTaskWizardPanel(props: AiTaskWizardPanelProps): React.ReactElement

export interface AiTaskWizardProps extends AiTaskWizardPanelProps {
  open: boolean
  onClose: () => void
}

export function AiTaskWizard({ open, onClose, ...panel }: AiTaskWizardProps): React.ReactElement
```

Every new prop is optional, so both mount sites compile untouched: `request-detail.tsx:2824` and `tasks-content.tsx:1021`. That is a hard requirement, not a nicety: Slice A owns both files. Keep the `AiTaskWizard` export name, because both sites reach it through `dynamic(...).then(m => ({ default: m.AiTaskWizard }))` and a rename fails at runtime, not at compile time.

- [ ] **Step 2: Document mode in the composer**

One composer, two ways in, no mode switch to learn:

- A paperclip button sits inside the composer row, `2.75rem` tall on phone, with `aria-label="Attach a brief"`. It opens a hidden `<input type="file" accept=".txt,.md,.csv,.json,.pdf,text/plain,text/markdown,text/csv,application/json,application/pdf">`.
- A drop zone covers the whole message list while a file is dragged over the panel: `border: 1px dashed var(--color-brand)`, `background: color-mix(in srgb, var(--color-brand-100) 45%, var(--color-bg))`, centred copy `Drop a brief here. Text, Markdown, CSV or PDF.`
- Once a file is chosen it renders as a chip above the composer: file glyph, name, size, and an X. The send button's label becomes `Draft tasks from this`. The user can still type an instruction alongside it, and the placeholder becomes `Anything to add? For example: only the design work.`
- The file is read with `FileReader.readAsDataURL` and the `data:...;base64,` prefix stripped before it goes on the body.
- Client-side, refuse before the round trip: run `classifyDocument` and `DOCUMENT_MAX_BYTES` from `lib/ai-documents.ts` in the browser too and show the same sentence the server would, so an unreadable file costs nothing.

- [ ] **Step 3: Honest rendering of a degraded answer**

Copy the request panel's treatment: a `notice: true` message renders as a warning strip with `DEGRADED_PREFIX`-style copy, not as an assistant bubble. A non-OK response surfaces `error` from the body verbatim, because the route now writes sentences meant for a human.

Add the progress line and the typing indicator from the request panel (`aiWizardProgress`, `.tahi-ai-typing`). They are already written; import rather than re-implement, or copy the twenty lines of CSS if the export is not reachable.

- [ ] **Step 4: The review step**

Keep the per-draft inline editor and extend it to the fields that now exist: title, note, priority (three values now, not four), estimate, due date, client, assignee, and the checklist as a list of removable chips with an add row. Category stays a free text chip.

Two exits, matching the request wizard:

- When `onDraftToForm` is set, `Use this draft` is the primary button on the first card and a smaller `Use` sits on each subsequent card. It calls `draftToTaskFields(draft, ctx)` and hands the result over. Nothing is written.
- Otherwise `Create tasks` files them all, one POST per draft through `buildCreateTaskBody`, then revalidates every key in `mutateKeys`.

The invariant does not move: **nothing is written until a human presses a button.**

- [ ] **Step 5: Verify and commit**

Run: `npm run type-check && npm run lint && npm run build`

```bash
git add components/tahi/ai-task-wizard.tsx
git commit -m "feat(tasks): the AI task wizard splits into a panel, takes a document, and hands drafts back"
```

### Task C.5: `NewTaskDialog` gains the AI view

- [ ] **Step 1: The view switch**

`NewTaskDialog` gains `view: 'form' | 'ai'` local state, defaulting to `'form'`, exactly as `new-request-dialog.tsx` does. When `view === 'ai'` the dialog body is `<AiTaskWizardPanel>` with `onDraftToForm={handleDraftToForm}` and `onWriteItMyself={() => setView('form')}`, and the dialog title becomes `Draft tasks with AI` (the request side words the same idea as `Build with AI`, `new-request-dialog.tsx:639`).

**Pass `contentKey={view}` to the `SlideOver`.** This is not optional and the current call (`new-task-dialog.tsx:321` to `329`) does not have it. The prop exists precisely for this case: `slide-over.tsx:88` to `95` says a centred dialog that swaps its whole body leaves focus on the unmounted control's `<body>` unless something names the current body, and `new-request-dialog.tsx:1091` passes `contentKey={view}` for exactly that reason, with the comment attached. Without it, pressing `Draft with AI` drops keyboard focus out of the dialog and Definition of Done item 6 fails on the first tab press.

- [ ] **Step 2: The way in**

Inside the form, above the title field, an assist card mirroring `AiAssistCard` (`new-request-dialog.tsx:1109`): a leaf-radius icon tile, the line `Not sure how to break this up? Describe it, or drop in a brief.`, and a button reading `Draft with AI` that sets `view='ai'`. It carries the whole document capability with it, because the panel owns both modes.

- [ ] **Step 3: The hand-back**

```tsx
const handleDraftToForm = (fields: TaskFields) => {
  // Exactly the fields the form already owns, so nothing here has to know
  // what the wizard is. Then get out of the way: the human reviews and
  // presses Create, the same as every other route into this dialog.
  setTitle(fields.title)
  // ...level, client, request, note, priority, due, assignee, estimate, checklist
  setView('form')
  toast('Draft ready. Review it below.')
}
```

The wizard's `context` is built from what the dialog already holds: the selected client, the selected request, the current level, plus the `clients`, `peopleList` and `requests` props it is already given. No new prop on `NewTaskDialogProps` except `defaultView?: 'form' | 'ai'`, which is optional and which nothing has to pass.

- [ ] **Step 4: Verify and commit**

Run: `npm run type-check && npm run lint && npm run build`

```bash
git add components/tahi/tasks/new-task-dialog.tsx
git commit -m "feat(tasks): draft with AI from inside the create dialog, with a hand-back to the form"
```

### Task C.6: Close Slice C (except the MCP task)

- [ ] **Step 1: Full check**

Run: `npm run type-check && npm run lint && npx vitest run && npm run build`

- [ ] **Step 2: Confirm the boundaries held**

Run: `git diff --name-only main`
Expected: exactly the eight files this slice owns. If `tasks-content.tsx` or `request-detail.tsx` appears, stop and post to the lead.

### Task C.7: MCP parity (waits for Slice A to merge)

- [ ] **Step 1: Rebase**

Run: `git fetch && git rebase origin/main`
Expected: Slice A's four blocker tools are present in `workers/mcp-server/src/index.ts`. If they are not, Slice A has not merged; stop here and hand the rest of the diff over with this task unticked.

- [ ] **Step 2: Widen `ai_task_wizard`**

At the existing declaration (around line 1445), add the fields the route now accepts:

```ts
  tool('ai_task_wizard', 'Draft tasks from a conversation, or from the text of a brief. Returns drafts for review; it never creates anything. Use create_task to file one.', {
    messages: { type: 'array', items: { type: 'object' }, description: 'Conversation so far: {role, content}' },
    context: { type: 'object', description: 'Optional: orgId, trackType, requestId, level' },
    documentText: prop('string', 'Plain text of a brief to draft from. Paste the text; binary uploads go through the dashboard.'),
  }, ['messages']),
```

`documentText` rather than a base64 document: an agent can already read a file and paste its text, and shipping a base64 upload path through MCP is a second transport for no gain. The route accepts `documentText` as a pre-extracted alternative to `document`, skipping classification and going straight to `truncateForPrompt`.

- [ ] **Step 3: Verify and commit**

Run: `npm run type-check && npm run lint`

```bash
git add workers/mcp-server/src/index.ts
git commit -m "feat(tasks): MCP parity for the widened AI task wizard"
```

---

## Slice D: docs, e2e and cleanup (the lead, after A, B and C)

**Files:** `e2e/**`, `STATUS.md`, `TASKS.md`

This slice exists so no building slice ever touches a file three worktrees would fight over. It runs once, on merged main.

### Task D.1: e2e

- [ ] Extend `e2e/tasks.spec.ts` with three cases, using `primePage` from `e2e/helpers.ts` and avoiding `networkidle` per the QA worktree recipe:
  1. open a task, add a blocker that is a **request** through the picker, confirm the Waiting on card shows the `#042` ref, then remove it;
  2. on a request detail, confirm the Blocked by card is present as an admin and confirm the spine chip appears when the count is above zero;
  3. My week: click a strip cell and confirm focus lands on the matching day card; page forward and back and confirm the range label changes and returns.
- [ ] Add one case to `e2e/requests-detail.spec.ts` asserting the Blocked by card is **absent** for a client audience. This is the leak test, and it is the most important line in this slice.
- [ ] Run: `npx playwright test e2e/tasks.spec.ts e2e/requests-detail.spec.ts --project=chromium` and `--project=mobile-safari`.

### Task D.2: Docs

- [ ] `STATUS.md`: record blockers, the week strip and AI task creation as shipped, with what is not done (the frozen `task_dependencies` table, the unattached source document, the `--color-brand-dark` audit).
- [ ] `TASKS.md`: tick the three items and open the four follow-ups below.
- [ ] Apply migration `0088` with `run_migration` against staging and prod, and quote the result.

### Task D.3: The follow-ups this plan deliberately leaves open

1. **Drop `task_dependencies`.** One release after 0088, once nothing has read it. A migration that drops a table is not additive, so it needs its own decision and its own backup.
2. **Retire the `/dependencies` alias routes and the three legacy MCP tools**, at the same time.
3. **Attach the source document to the tasks it produced.** Needs a nullable owner on `files` (or a `taskId` column), which is a schema decision this plan did not need to make.
4. **`--color-brand-dark` has no dark-mode definition** and is used in eight places across the tasks surface. Slice B fixed its own two. The right fix is probably a second token for brand-coloured text rather than redefining the existing one, because it is also used as a hover background.
5. **Capacity-scaled load bars.** `teamMembers.weeklyCapacityHours` exists but `/api/admin/team-members` does not select it. One column on the wire and one optional field on `TaskPerson`.

---

## Definition of Done

CLAUDE.md rule 8 applies in full: a task only flips to `[x]` after all seven checks, and a slice failing any of 4 to 7 stays open even if 1 to 3 pass.

### Every slice, without exception

| # | Check | Command | Expected |
|---|---|---|---|
| 1 | Type-check | `npm run type-check` | exit 0, no output |
| 2 | Lint | `npm run lint` | `No ESLint warnings or errors` |
| 3 | Unit tests | `npx vitest run` | every test file passes; no test added by this slice is skipped |
| 4 | Build | `npm run build` | succeeds. The only check that rejects a non-method export from a route file. |
| 5 | Deploy | pushed to main by the lead | Cloudflare deploy green, prod released after the lead approves the GitHub environment |
| 6 | Live smoke | on the deployed URL, not localhost | see per-slice below |
| 7 | Evidence | screenshot or note in the commit body or PR | confirms 5 and 6 |

Plus, for every slice that renders anything:

- **375px:** no horizontal scroll, every touch target at least 2.75rem.
- **Dark mode:** rendered with `.dark` on `<html>`, no contrast regressions, nothing that only reads in light mode. Everything here is token-driven, so a regression means a hardcoded value slipped in.
- **MCP parity:** the matching worker tool exists and has been called once against staging.

### Slice A: Blockers

- `run_migration` with `{"name":"0088"}` returns `status: "applied"` against staging **and** prod, quoted in the commit body. Then `list_blockers` on a task that had a `task_dependencies` row returns that row, proving the backfill landed.
- MCP smoke: `add_blocker` with `subjectType: 'request'` and `blockerType: 'task'`; `list_blockers` on both ends and confirm the edge appears as `blockedBy` on one and `blocks` on the other; `add_blocker` the reverse pair and confirm the 400 says "That would make a loop"; `add_blocker` the same pair twice and confirm the 409; `search_blocker_candidates` with a request number and confirm the `#042` ref comes back. Delete the test rows.
- Live smoke as the Tahi admin on the deployed URL:
  - [ ] On a task, add a **request** as a blocker. The Waiting on card shows `#042` plus the title, the count on the row goes up, and the board card reads "Blocked by 1 item".
  - [ ] On a request detail, the **Blocked by** card is present, adds a **task** blocker, and its Open button lands on `/tasks?task=<id>` with the panel open.
  - [ ] The spine shows the amber chip and does **not** grow a sixth node.
  - [ ] The requests list shows the blocked glyph beside a blocked row, distinct from the scope-flag glyph, and a row that is both shows one merged warning on the board.
  - [ ] The team rail has a **Blocked** saved view whose count matches the list it produces.
  - [ ] Delete a task that is a blocker and confirm the far end's count drops rather than sticking at a number nothing explains.
  - [ ] **The leak check, twice.** Sign in as a client org, open a request that is blocked, and confirm there is no Blocked by card, no chip, and no count anywhere on the page. Then call the portal detail endpoint directly and confirm the payload contains no blocker field at all.
  - [ ] 375px and dark mode on the request detail rail and the tasks Waiting on card.

**Lead's evidence (2026-09-06):** merged 068f9157 (`feat/blockers-fix`); type-check, worker tsc, lint, 1778 unit tests and the build green; migration 0088 applied to production D1 with wrangler statement by statement (the multi-statement import endpoint refused the token) and verified: table present, the one legacy `task_dependencies` row backfilled; applied to the local QA sqlite by hand. QA server probe: a task blocked by a request shows the Waiting on card with the count, the request status badge, the title, Open and the remove control, and Add blocker; the request detail shows the Blocked by card with its empty state and Add blocker for the admin. The rail cards had been shrinking inside the slide-over since the port (the Waiting on rows and the Level control were clipped); fixed by the lead in 3989763d (`SidebarCard` flexShrink 0) and re-measured. Dark mode and 375px probed after the card fix: the Waiting on card shows its row, the Open link and the remove control with the title ellipsed, and Add blocker at full width on a phone; nothing scrolls sideways. Production smoke as Liam after the deploy of 3989763d, through the dashboard API the tools call: create a task, add a request as its blocker (201), list shows the edge with the request's status and org, the reverse pair is refused with "That would make a loop" (400), the same pair again is a 409, the candidate search finds a request by title, the request side lists the task under blocks, the portal detail payload for that request contains no blocker field (leak check clean), deleting the task sweeps the edge from the request side. Worker deployed with 292 tools.

### Slice B: My week

- [ ] `/tasks` My week shows the strip inside the summary plate, seven cells, today filled, past days muted.
- [ ] Drag a task onto Thursday's cell: the due date changes, the toast names the day, and the matching day card scrolls into view.
- [ ] Page forward, drop onto a specific day next week, and confirm the date written is that day and not the flat "after this week" date the Later bucket used to write.
- [ ] Keyboard: tab to the strip, arrow across, Home and End, PageUp and PageDown, Enter moves focus to the day card. Then `Alt+ArrowRight` on a focused task row moves its due date by a day.
- [ ] The rail's filters still do not affect this view.
- [ ] 375px: seven cells, no horizontal scroll, every cell at least 2.75rem tall, and the documented degradation actually applied.
- [ ] Dark mode: the strip, the today chip, the load bar, and the two lines that used to be `--color-brand-dark`.

**Lead's evidence (2026-09-06):** merged fa3aff88 (`feat/week-strip-fix`). QA server probe with two tasks assigned to Liam: the strip renders inside the summary plate (31 Aug to 6 Sep, seven 66px cells, today filled with its count, previous and next week arrows), the summary strip reads 0 overdue, 2 today, 2 this week, 2h; the day cards list the fixtures; no horizontal scroll at 1380. The strip toast keeps the weekday's capital (lead, 7763293e). Dark mode probed: the strip, today's filled chip, the load bar and the day cards all read on the dark canvas. 375px probed: the summary plate stacks, the strip keeps seven cells inside the width with no horizontal scroll, the arrows and the range label sit above it. Drag and keyboard are the e2e slice's to prove.

### Slice C: AI and document task creation

- [ ] From the tasks header, open the create dialog, press **Draft with AI**, describe two pieces of work, and confirm the panel asks a follow-up before drafting.
- [ ] Press **Use this draft** and confirm the form arrives filled: title, note, level, client, priority, due date, estimate and checklist items, with nothing written yet.
- [ ] Press Create and confirm the checklist items actually landed as `task_subtasks`, which the old wizard silently dropped.
- [ ] Upload a `.md` brief and confirm tasks are drafted from its content, with the filename visible on the chip.
- [ ] Upload a PDF and confirm the same. Upload a `.docx` and confirm the refusal sentence names PDF as the way out and that no request was sent.
- [ ] Upload a file over 5 MB and confirm it is refused before the round trip.
- [ ] Confirm one `ai_cost_log` row per call under scope `wizard`, with a non-zero token count.
- [ ] With `ANTHROPIC_API_KEY` unset in a preview, confirm a 503 with the honest sentence rather than a keyword draft dressed as an answer.
- [ ] Run the wizard from a **request detail** ("break into tasks") and confirm it still works unchanged, since Slice C must not have edited that file.
- [ ] 375px: the composer, the paperclip at 2.75rem, the file chip, the draft cards, the editor rows.
- [ ] Dark mode: the drop zone, the file chip, the degraded notice strip, the draft cards.
- [ ] MCP: `ai_task_wizard` with `documentText` returns drafts; `create_task` files one with `subtasks` and confirms them with `list_task_subtasks`.

**Lead's evidence (2026-09-06):** merged 97a08a15 (`feat/ai-task-create-fix`). QA server probe: the create dialog offers Draft with AI ("Not sure how to break this up? Describe it, or drop in a brief."), the AI view mounts (lazy chunk) with the AI assist progress, the greeting, the paperclip, the composer and the Enter hint, and "I will write it myself". Task C.7 done by the lead (7763293e): `ai_task_wizard` takes `documentText`, `requestId` and `level`. The request wizard's leading assistant turn is dropped before the Messages API call (same commit). Production smoke as Liam through the route: a .docx upload is refused with 415 and "Word files cannot be read here yet. Export it as a PDF, or paste the text straight into the chat." before any model call; a real turn with two pieces of work plus documentText returned 200 with done false and a clarifying reply that names both pieces (honest conversation, no keyword draft). One ai_cost_log row under scope wizard landed for that call (queried on production D1 right after: scope wizard n 1, alongside site_index 173, draft 163, sitemap 20, backfill 8).

---

## Deliberately not done, stated so nobody thinks it was missed

- **A month grid inside My week.** Decision 19. If it is wanted later, the shape is a popover behind a month button on the strip's right end, reusing a `buildMonthCells` helper written the same way `buildWeekStrip` was, so the default surface stays a week and the month is opt in. That also gives the private `MonthGrid` in `date-range-picker.tsx` a second home worth extracting for.
- **A portal view of blockers.** Decision 13. Not a gap: a deliberate refusal. If a client should ever see that their request is waiting on something, the honest design is a studio-written note on the request, not a list of internal task titles.
- **A "blocked" status on requests.** `on_hold` already exists and means a human decided to stop. The blocker count is derived and coexists with any status. Adding a status would make the two disagree the first time someone set one without the other.
- **Persisting the uploaded brief.** Decision 27, and follow-up 3.
- **`.docx` support.** Decision 29. Refused loudly with the way out, rather than half-read.
- **A per-call AI spend cap.** Decision 30. Bounded inputs and a daily circuit breaker instead, because a cap that stops a conversation halfway teaches people not to use the feature.
- **Blocker links from the schedule spine or from a checklist item.** A checklist item is not a subject; it has no status of its own worth waiting on. If it needs one, it wanted to be a task.

---

## Revision log

| Date | Change |
|---|---|
| 2026-09-06 | Written. Three slices, one ordering constraint (C.7 waits for A), `e2e/**`, `STATUS.md` and `TASKS.md` reserved for Slice D. |

## Revision

Verified against the repo at `b7dbe2b8`. Every file the plan names was opened; every line reference, exported name, table and column name, helper contract and primitive prop list was checked. Migration `0088` is confirmed as the next free number in both `drizzle/migrations/` (highest is `0087_task_estimate_and_indexes.sql`) and the runtime `MIGRATIONS` array (highest entry `name: '0087'` at `app/api/admin/db/migrate/route.ts:2015`). The helper contracts hold as written: `requireAccessToOrg(database, userId, targetOrgId)` resolves `NextResponse | null` with null meaning allowed (`lib/require-access.ts:36`), `guardTask(drizzle, userId, taskId)` the same (`lib/task-access.ts:38`), `resolveAccessScoping(database, userId)` returns `string[] | null` (`lib/access-scoping.ts:31`), `recordCost(database, input)` takes exactly the field set the plan writes (`lib/ai-cost.ts:79`), and `SidebarCard` takes exactly `title`, `icon`, `count`, `action`, `bodyPadding`, `children`. The single-hard-delete claim, the no-document-path-on-the-request-side correction, the `ai-cost` Opus and Sonnet rate errors, the missing `.dark` definition for `--color-brand-dark`, and the `dependsOnStatus !== 'done'` literal at `tasks/route.ts:168` all check out exactly as stated.

| # | What changed | Why |
|---|---|---|
| 1 | Ownership: `components/tahi/inline-field.tsx` and `components/tahi/__tests__/inline-field.test.ts` added to Slice A, with two new optional props (`onQueryChange`, `serverFiltered`) specified in Decision 17 and in Task A.6. | **The plan as written was not implementable.** `InlineMenuField` holds its search `query` in local state with no callback out (`inline-field.tsx:172`), and re-filters `options` on `label`/`keywords` (lines 180 to 183). A server-fed picker could neither be triggered nor display its results. No other slice imports the module, so this adds no overlap. |
| 2 | Task A.6: the picker's `blockerOptions.length > 0` render guard (`task-detail-panel.tsx:1022`) must be dropped. | With server search the option list is empty until someone types, so the guard would hide the picker permanently. |
| 3 | Ownership: `app/api/admin/tasks/__tests__/tasks-enrichment.test.ts` added to Slice A, with what to change. | It mocks `@/db/d1` with a `taskDependencies` key and no `workBlockers`, and drives the route with an ordered three-result queue whose third entry is the dependency join. Moving `blockedByCount` to `openBlockerCounts` breaks it at runtime. It was owned by nobody. |
| 4 | Ownership: `app/api/__tests__/admin-requests-scoping.test.ts` added to Slice A, with the two cases to add. | That suite sweeps every per-request sub-route for the scoped-teammate 403 (lines 571 to 576). A new sub-route absent from it is an unwatched scoping hole. |
| 5 | Task A.7 Step 3 and the Tokens bullet: `--color-warning-bg` / `--color-warning-text` replaced with the `--badge-warning-*` family (or `<Badge tone="warning">`). | `--color-warning-text` **does not exist** in `app/globals.css`, so it would have resolved to nothing. `--color-warning-bg` is documented at line 1486 as deliberately not overridden in `.dark`, naming `--badge-warning-*` as the replacement. The amber chip would have failed the dark-mode gate. |
| 6 | Task A.6 Step 2: the blocker row's status badge must branch on type, using `REQUEST_STATUS_TONE` / `REQUEST_STATUS_LABELS` (`lib/status-config.ts:160, 169`) for a request, per `sub-request-rows.tsx:191`. | `TaskStatusBadge` falls back to `TASK_STATUS_LABELS[status] ?? status` with a `neutral` tone (`task-chips.tsx:306`), so a request blocker would have rendered a grey pill reading the raw `client_review`. |
| 7 | Task C.5 Step 1: `contentKey={view}` added to the `NewTaskDialog` `SlideOver`. | The primitive documents this exact case (`slide-over.tsx:88` to `95`) and `new-request-dialog.tsx:1091` already does it. Without it, switching to the AI view drops keyboard focus onto `<body>`. |
| 8 | Task A.6 Step 2: the prop being replaced is **`blockedBy`** (`task-detail-panel.tsx:115`), not `dependencies`. `onRemoveBlocker`'s second parameter renames from `depId` to `linkId`. | The plan named a prop that does not exist. |
| 9 | Decision 12 and the `lib/blockers.ts` import: both closed-status lists now come from `lib/status-config.ts` (`REQUEST_CLOSED_STATUSES` at 188, `TASK_CLOSED_STATUSES` at 190), not one from there and one from `lib/requests-views.ts:69`. | The plan's own decision is "the definition lives in one file" while drawing the two halves from two. It also removes a needless dependency from the pure blocker module onto the requests rail. |
| 10 | Parallelism rule 3 and Task B.6: "the other four call sites" corrected to **two** (`tasks-list.tsx:150`, `task-detail-panel.tsx:868`), against one canonical predicate at `lib/tasks-views.ts:137`. | There are three inline copies in the repo, not five. An implementer hunting four would have gone looking in files nobody owns. |
| 11 | Parallelism rule 1, Decision 25 and Task C.4: `AiTaskWizard` is mounted in **two** files, `request-detail.tsx:2824` **and** `tasks-content.tsx:1021`. Added the note that the export name must survive the split because both use `dynamic(...).then(m => ({ default: m.AiTaskWizard }))`, which fails at runtime rather than at compile time. | The plan named only one mount site. Both belong to Slice A, so the invariant survives, but the reasoning was incomplete and a renamed export would have passed type-check and broken the page. |
| 12 | Task A.7 Step 2: the blocked list glyph must **not** be `AlertTriangle`. Specified `PauseCircle` in `var(--color-warning)`. | `scopeFlagged` already renders `AlertTriangle` in `var(--color-danger)` at both sites (lines 393 and 1334), so the plan's own "two distinct glyphs" rule contradicted its own suggestion. |
| 13 | `lib/tasks-board-items.test.ts` row: changed from "cover the mixed-type label" to "update lines 111 and 116". | Those two lines assert the exact strings `'Blocked by 2 tasks'` and `'Blocked by 1 task'`. Adding a case without changing them leaves two failing tests. |
| 14 | Task A.2: added the backfill caveat. `task_dependencies` exists only in `drizzle/migrations/0004_orange_sumo.sql` and not in the runtime `MIGRATIONS` array, and the runner swallows only `duplicate column name` and `already exists` (`migrate/route.ts:2051`). | On a D1 built purely by the runner, the `INSERT OR IGNORE ... SELECT` raises `no such table` and the migration reports `error`. Keeping it last makes that survivable and re-runnable, but it has to be understood rather than discovered mid-deploy. |
| 15 | Task B.1 Step 1: extend the existing import at `lib/tasks-planner.test.ts:2` rather than adding a second import block, and drop the unused `type StripDay`. | Two imports of one module plus an unused type binding are two avoidable lint findings in a plan whose Definition of Done requires a clean lint. |
| 16 | Vocabulary map: noted that the shared `requestRef`'s null branch **deliberately differs** from the two local copies, which return `'Request'` (`new-task-dialog.tsx:77`) and `'the request'` (`task-detail-panel.tsx:154`). | The plan said "matching `new-task-dialog.tsx:77`", which is true of the padding and false of the fallback. An implementer tidying up would have silently changed on-screen copy in three places. |
| 17 | Line references corrected: `requests-views.ts:133` to `:132`; `search/route.ts:80` to `:81`; `delivery-spine.tsx:126` to `:110` (twice, and the eta slot to lines 185 to 194); `request-detail.tsx` `apiBase` 596 to 597; `RequestTasksPanel` 2517 to 2524 (twice); `task-detail-panel.tsx:862` to `:975`; `tasks-week.tsx:6` to `:7`; `kanban-board.tsx:315` to `:321`; `new-task-dialog.tsx:70` to `:71`; `new-request-dialog.tsx:1107` to `:1109`. | Each was off by between one and nine lines. Individually trivial, collectively the difference between a plan an implementer trusts and one they re-derive. |
| 18 | Slice map: "Task C.8" corrected to "Task C.7". | The one ordering constraint in the plan pointed at a task number that does not exist. The task itself is headed C.7. |
| 19 | Decision 17: added the verified fact that `app/api/admin/search/route.ts` contains no `resolveAccessScoping` or `getOrgScope` call at all. | The plan asserted the scoping gap; this records the grep that proves it, so the new endpoint's existence is not re-litigated. |

**Nothing was found wrong with the three load-bearing structural choices.** The polymorphic table follows the `requestParticipants` precedent as claimed; the disjoint file ownership holds once items 1, 3 and 4 above are folded in; and the single ordering constraint is real, because `workers/mcp-server/src/index.ts` is still the only file two slices need.

**One decision left standing for the lead.** Decision 14 keeps two card titles ("Blocked by" on requests, "Waiting on" on tasks). The reasoning is sound and the collision with "Waiting on you" at `requests-views.ts:132` is real. If he wants one name, it is a two-word edit at `task-detail-panel.tsx:975`.
| The task detail's rail cards shrank inside the slide-over | `SidebarCard` sets `flexShrink: 0` (lead, after the merge) | The slide-over body is a flex column with overflow auto and the card has overflow hidden, so once the column overflowed every card shrank and clipped: the Waiting on card showed its header and count with no rows, and the Level control was cut in half. Present since the port; found by the lead's headless probe of the blockers card. |
