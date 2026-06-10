# Delivery Spine (#148) — proposal → contract → schedule → live delivery

Status: 2026-06-10 — Slices 0-3 deployed + verified live (migration 0076 applied,
engine end-to-end tested on prod). In-viewer linking UI built: row editor
"Linked work" picker (linked-work endpoint), "Delivery phase" selectors on
request detail + task panel (schedules?includeRows=1), MCP parity tools on the
worker. Slices 4-5 remain. The differentiator over ManyRequests: link an
engagement's sales artifacts to its actual delivery so the schedule shows,
live, where delivery is, and auto-flags blocked / delayed / off-track.

See [[project_portal_readiness_arc]].

## Current state (verified 2026-06-09)

- **The deal is the natural hub.** `proposals.dealId`, `project_schedules.dealId`,
  and `contract_documents.dealId` all point to a deal (plus org/lead/proposal
  cross-links). Deal detail already surfaces proposal/contract/schedule.
- **Schedule shape:** `project_schedules` → `schedule_sections` → `schedule_rows`.
  Rows are gantt phases: `row_type` (section_header | task | gate | critical_gate),
  `owner`, `start_week`/`end_week` (1-based, relative to `schedule.effectiveDate`,
  over `numberOfWeeks`), `risk_flag`.
- **Delivery shape:** `requests` (status submitted|in_review|in_progress|client_review|on_hold|delivered, `startDate`, `dueDate`, `deliveredAt`, `scopeFlagged`) and
  `tasks` (status todo|in_progress|blocked|done, `dueDate`, `completedAt`, `requestId`, `trackId`).
- **THE GAP:** nothing links the plan (schedule rows) to delivery (requests/tasks).
  `requests`/`tasks` have `orgId` but no `scheduleRowId` and no `dealId`. So there is
  no live progress and no off-track detection today.

## Model (recommended)

1. **Link work to plan:** add nullable `scheduleRowId` to `requests` and `tasks`
   (FK → schedule_rows, ON DELETE SET NULL). One row → many work items; one work
   item → at most one row. Simple, indexable, matches "this phase is delivered by
   these requests."
2. **Per-row live status — computed, not stored**, from linked work + the planned
   calendar window (weekStart = effectiveDate + (start_week-1)*7; weekEnd =
   effectiveDate + end_week*7 - 1):
   - `done` (all linked work delivered/completed) · `blocked` (any linked request
     on_hold/scopeFlagged or task=blocked) · `delayed` (now > weekEnd and not done)
     · `at_risk` (a linked due date past/near and not done, or row risk_flag) ·
     `in_progress` · `not_started`.
   - precedence: blocked > delayed > at_risk > in_progress > done > not_started.
3. **Engagement rollup (deal-level):** overall = worst row status; % complete =
   done task-rows / total task-rows. No new top-level entity; the deal is the hub.

## Where it surfaces

- **Schedule viewer/editor:** live status chip per row + a picker to attach
  requests/tasks to a row. This is the "show on the schedule live where we are."
- **Deal detail:** Engagement health rollup (artifacts + overall status + off-track rows).
- **Later:** Overview widget "engagements off-track" + optional Slack/notify on a
  row flipping to delayed/blocked.

## Slices

- **Slice 0 — schema.** Migration: `scheduleRowId` on requests + tasks (idempotent
  ALTER). Drizzle schema + deploy + run migration. (Same deploy-then-migrate dance
  as T661.)
- **Slice 1 — linking API + UI.** Attach/detach a request or task to a row. Row
  editor gets a "linked work" picker; request/task detail gets a "schedule phase"
  selector.
- **Slice 2 — status engine.** `lib/delivery-status.ts` computes per-row +
  engagement status; API returns it with the schedule.
- **Slice 3 — schedule viewer overlay.** Live status chip per row + legend;
  off-track rows highlighted.
- **Slice 4 — deal/client rollup.** Engagement health card.
- **Slice 5 — proactive.** Overview widget + notify on delayed/blocked.

## Open decisions

- **Linking granularity:** `scheduleRowId` column (recommended, simple) vs a join
  table (a work item spanning multiple phases). Recommend the column; revisit if
  multi-phase work emerges.
- **Hub:** deal-as-hub (recommended, no new entity) vs a first-class `engagements`
  table. Deal is sufficient for now.
- **Permissions:** the status engine + linking must respect team-member access
  scoping (admins bypass). Fold in as each slice touches requests/tasks.
