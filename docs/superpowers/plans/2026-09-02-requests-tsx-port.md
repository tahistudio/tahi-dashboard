# Requests TSX Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the approved Requests prototype (Claude Design project `57bf60cf`, rounds 1 to 3, verified 2026-09-02) into the live Next.js app, slice by slice, without regressing the surfaces Liam already trusts.

**Architecture:** The prototype files under the Claude Design project are the visual and interaction spec; the repo's existing primitives (`DataTable`, `FilterBar`, `BoardView`, `Popover`, `Menu`, `SlideOver`, `Badge`, `StatusChipSelect`, `BulkActionBar`, `useUserPreference`, SWR fetchers, the admin and portal APIs) are the implementation. Each slice owns a disjoint set of repo files, ships behind the existing `isAdmin` and permissions gates, persists per-user state with `useUserPreference`, and ends with the CLAUDE.md Definition of Done: type-check, lint, build, push, live smoke on the deployed URL, 375px, dark mode, with a note in the commit body.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind v4 with CSS variables from `app/globals.css`, SWR, Drizzle on D1, Vitest, Playwright for the golden path.

**Prototype source of truth (read before every slice):** `requests.jsx`, `requests-toolbar.jsx/.css`, `requests-listview.jsx/.css`, `requests-board.jsx/.css`, `requests-capacity.jsx/.css`, `requests-dialog.jsx/.css`, `requests-detail.jsx/.css`, `requests-kit.jsx`, `requests-focus.css`, `requests-data.jsx`. Fetch them with `mcp__claude-design__read_file` from project `57bf60cf-5e6d-450f-9e2f-e25c8d12fd66`. Never copy the prototype's `React.createElement` code into the repo; rebuild it in TSX on the repo's primitives.

**Decisions already made by Liam (do not re-litigate):** toolbar C (left rail) for every audience; four peer views List / Kanban / Workload / Timeline with icons; AI draft, Export CSV, Bulk create under a "..." menu; kanban is a horizontally scrolling section with a visible proxy scrollbar, never scrollbars inside columns; card people as a stacked avatar row with tooltips; subtask preview on cards; list rows expand down to sub-requests; rail filters as compact selects; header width constant across views; site-wide focus ring outside the box; client size as a suggestion; client queue placement instead of priority; capacity strip with one lane per track; delivery spine clickable; rail fields inline-editable; client Approve and Request changes at client review.

---

## Ground rules for every slice

- One Opus implementer per slice, exclusive file ownership as listed, no two slices in flight on the same file. Slices marked parallel-safe may run together.
- Never `git add -A`. Stage only the files the slice lists. Commit to main with the session trailer. Do not push until the lead has reviewed the diff; the lead pushes.
- Every new component follows `components/tahi/` conventions: `'use client'`, CSS variables via `var(--color-*)`, no hardcoded hex, rem units, no single-side borders, hover and focus states, 44px touch targets, no em or en dashes anywhere.
- Status vocabulary comes only from `lib/status-config.ts` (`REQUEST_STATUSES`, `REQUEST_STATUS_CONFIG`). Kanban columns come from `/api/admin/kanban-columns` with `BOARD_COLS` fallback.
- Admin routes keep team access scoping; portal routes stay org-scoped. Any new API capability gets a worker MCP tool (`workers/mcp-server/src/index.ts`).
- Tests: Vitest for any new pure helper (sorting, filtering, suggestion logic, timeline domain maths); Playwright happy path for the list, kanban, and new-request dialog at the end of S8.

---

### Slice 1: Land the foundation (gate: Liam confirms the uncommitted work is his and ready)

**Files (already in the working tree, uncommitted as of 2026-09-02):**
- Modify: `lib/status-config.ts`, `components/tahi/badge.tsx`, `app/globals.css`
- Create: `components/tahi/status-chip-select.tsx`, `components/tahi/bulk-action-bar.tsx`, `components/tahi/__tests__/bulk-action-bar.test.ts`, `lib/status-config.test.ts`

- [x] **Step 1:** Confirm with Liam that these files are his in-progress work and may be committed as the foundation. Do not start any other slice before this.
- [x] **Step 2:** Run `npx vitest run lib/status-config.test.ts components/tahi/__tests__/bulk-action-bar.test.ts`, `npm run type-check`, `npm run lint`. All clean.
- [x] **Step 3:** Review `status-chip-select.tsx` and `bulk-action-bar.tsx` against the prototype's `StatusEditor` and bulk bar (one primary action, an Edit menu with Status / Assign / Danger sections, confirm on Archive, a toast on every result). Note gaps for S3.
- [x] **Step 4:** Commit: `git add lib/status-config.ts lib/status-config.test.ts components/tahi/badge.tsx app/globals.css components/tahi/status-chip-select.tsx components/tahi/bulk-action-bar.tsx components/tahi/__tests__/bulk-action-bar.test.ts` then `git commit -m "feat(requests): status vocabulary, badge tokens, StatusChipSelect and BulkActionBar foundation"`.

---

### Slice 2: Rail toolbar, four views, header actions, per-user preferences

**Files:**
- Create: `components/tahi/requests/requests-rail.tsx` (saved views, filter selects, sort, Save as default), `components/tahi/requests/requests-view-switcher.tsx`, `components/tahi/requests/requests-header-actions.tsx`, `lib/requests-views.ts` (saved view definitions and predicates for team and client, sort comparators), `lib/requests-views.test.ts`
- Modify: `app/(dashboard)/requests/request-list.tsx` (replace the FilterBar row, ViewToggle, and header buttons with the rail layout; keep data fetching, DataTable, BoardView, WorkloadView wiring)

**Brief.** Rebuild the prototype's `requests-toolbar.jsx` rail: VIEWS (team: All requests, All active, Triage, Overdue, Due this week, Awaiting client, Delivered, plus Assigned to me for non-admin team members; client: All requests, In progress, Waiting on you, Delivered) with live counts; FILTERS as select controls (Status, Category, Client for admin only, Type, Created) whose menus render through the repo `Popover` or `Menu` primitive (portaled, no inner scroll, Escape closes); SORT as a select plus a direction toggle; Clear filters; Save as default. Persist with `useUserPreference`: `requests.view` ('list' | 'kanban' | 'workload' | 'timeline', migrate stored 'board' to 'kanban'), `requests.savedView`, `requests.filters` (JSON), `requests.sort` ({ key, dir }). "Save as default" writes the current snapshot to `requests.default` and the rail shows "Your default" when the live state matches. View switcher shows icon plus label on desktop, icon only with `title` on mobile: List (`Rows`), Kanban (`LayoutGrid`), Workload (`BarChart3`), Timeline (`CalendarRange`) from lucide. Header: `PageHeader` with title, count subtitle, primary New request, and one "..." `Menu` holding AI draft, Export CSV (admin), Bulk create (admin). Mobile: the rail collapses into a "Filters" `SlideOver` opened from a 44px button beside the icon-only view switcher. Header width constant across views: the kanban and timeline scroll inside the main column.

- [x] **Step 1:** Write `lib/requests-views.ts` with tests for each saved-view predicate and each sort comparator (including the `updated` relative-time comparator over ISO timestamps, which the repo has instead of the prototype's labels).
- [x] **Step 2:** Build the three components against the prototype's structure and the repo's tokens.
- [x] **Step 3:** Rewire `request-list.tsx`, removing `ADMIN_STATUS_OPTIONS`, `CLIENT_STATUS_OPTIONS`, and the old `ViewToggle` usage. Keep `useUserPreference('requests.sortKey'|'requests.activeTab')` readers migrating into the new keys once, then delete the old keys.
- [x] **Step 4:** Type-check, lint, Vitest, build. Commit `feat(requests): rail toolbar, four views, header menu, per-user defaults`.
- [x] **Step 5:** Lead review, push, live smoke: owner and a client login, all four views, one saved view, one filter, sort, Save as default then reload, 375px sheet, dark mode.

---

### Slice 3: List view: expand-down sub-requests, shared bulk bar (parallel-safe with S4 and S5 after S2)

**Files:**
- Modify: `app/(dashboard)/requests/request-list.tsx` (the DataTable columns and the local `BulkActionBar` function only), `components/tahi/data-table.tsx` (add an optional `renderExpanded(row)` and `expandable(row)` API plus an Expand all header control, keeping every existing consumer unchanged)
- Test: `components/tahi/__tests__/data-table-expand.test.tsx` (render test: expandable row toggles, Expand all toggles all)

**Brief.** From `requests-listview.jsx`: a 24px chevron before the request number on rows that have sub-requests (`subRequestCount > 0`, add that count to the list API payload if absent: `app/api/admin/requests/route.ts` and the portal equivalent, counting `parentRequestId` matches), spacer on rows without; an expanded panel row spanning all columns, `--color-bg-secondary`, hairline all sides, overlapping the parent's bottom hairline with `margin-top:-1px`, listing sub-requests fetched lazily from `/api/admin/requests/{id}/sub-requests` (portal: the org-scoped equivalent) with number, title, `Badge` status, assignee avatar, Done or Open; an "Add sub-request" row for team audiences opening `NewRequestDialog` with `parentRequestId` preset; Expand all beside select-all. Replace the local `BulkActionBar` function with the shared `components/tahi/bulk-action-bar.tsx`, wiring Status, Assign (PM / assignee / follower), Archive with confirm, and Clear to the existing `/api/admin/requests/bulk` and `/bulk-assign` endpoints. Selection off for clients.

- [x] **Step 1:** DataTable expandable API with the render test.
- [x] **Step 2:** API counts and the lazy sub-request fetch.
- [x] **Step 3:** Wire the list and the shared bulk bar; delete the old local bar.
- [x] **Step 4:** Checks, commit `feat(requests): expandable sub-request rows and shared bulk bar`, lead review, push, smoke.

---

### Slice 4: Kanban: horizontal scroll with proxy scrollbar, people stack, subtask preview (parallel-safe with S3 and S5 after S2)

**Files:**
- Create: `components/tahi/board-scrollbar.tsx` (proxy scrollbar: track, thumb, arrows, pointer drag, keyboard, sync with a scroller ref; reusable by any horizontal scroller)
- Modify: `components/tahi/board-view.tsx` (kanban sub-view only: mount the scrollbar above the columns, cards get the people stack and the subtask preview, hover shadow set to the lighter value per Liam's last comment), `components/tahi/kanban-board.tsx` if the card renderer lives there
- Test: `components/tahi/__tests__/board-scrollbar.test.tsx` (thumb width from client and scroll width, arrow disabled at ends)

**Brief.** From `requests-board.jsx`: fixed 264px columns in one non-wrapping row inside the scroller; columns never scroll horizontally; the page scrolls vertically; proxy scrollbar 12px track with a 44px minimum thumb, click-to-page, 28px arrow buttons scrolling one column with smooth behaviour, hidden when everything fits; mobile `scroll-snap-type: x mandatory`. Card: category chip, priority, scope warning, number; title; one people row with the client avatar left (admin only) and the PM, assignee, followers stacked right, three visible then "+N", each with a `Tooltip` naming person and role, tooltips on focus too; subtask bar with a chevron that expands an inline list of sub-requests (lazy fetch as in S3, cached per card) with status dot, title, assignee; due chip; delivered cards show no due chip. Hover: lift 1px, shadow `var(--shadow-sm)`, 150ms symmetric. Keep drag-to-move, drag-to-nest confirm, quick-add, custom columns.

- [x] **Step 1:** Scrollbar component with tests.
- [x] **Step 2:** Card and column changes.
- [x] **Step 3:** Checks, commit `feat(requests): kanban proxy scrollbar, people stack, subtask preview`, lead review, push, smoke including a drag between columns and 375px snap.

---

### Slice 5: Timeline as a top-level view (parallel-safe with S3 and S4 after S2)

**Files:**
- Create: `components/tahi/requests/requests-timeline.tsx` (extract and extend `BoardTimeline` from `board-view.tsx`), `lib/timeline-domain.ts` and `lib/timeline-domain.test.ts` (domain from earliest start minus 14 days to latest due plus 21 days, tick generation, today ratio)
- Modify: `components/tahi/board-view.tsx` (import the extracted timeline for its own `timeline` sub-view so nothing else regresses), `app/(dashboard)/requests/request-list.tsx` (route `view === 'timeline'` to the new component)

**Brief.** Keep every repo timeline feature (legend per column plus Overdue, Today button with calendar icon, auto-scroll to 30%, bars for items with a start date and milestone diamonds otherwise, overdue red with ring, sticky labels, infinite buffer) and add from the prototype: a 260px label column with number, title, and client avatar; delivered never overdue; rows keyboard focusable and clickable to the request; mobile label column 170px with two-line titles.

- [x] **Step 1:** Domain helpers with tests.
- [x] **Step 2:** Extraction, then the additions.
- [x] **Step 3:** Checks, commit `feat(requests): timeline as a peer view`, lead review, push, smoke.

---

### Slice 6: Request detail: clickable spine, inline rail editors, header actions, client approval

**Files:**
- Modify: `app/(dashboard)/requests/[id]/request-detail.tsx` (header meta row, progress strip, right rail Details and People, the client review banner), `components/tahi/people-panel.tsx`, `components/tahi/time-card.tsx` (pause icon check), `components/tahi/message-composer.tsx` (ring on the container via `:focus-within`)
- Create: `components/tahi/requests/delivery-spine.tsx`, `components/tahi/requests/request-actions-menu.tsx`, `components/tahi/requests/client-review-bar.tsx`
- API: reuse `PUT /api/admin/requests/{id}` for field edits; `POST /api/admin/requests/{id}/nest` for Nest and Make top-level; add `POST /api/admin/requests/{id}/duplicate` if absent with a worker MCP tool `duplicate_request`; portal: `POST /api/portal/requests/{id}/review` with `{ decision: 'approve' | 'changes', note }` moving status to delivered or in_progress and posting a message, with a worker MCP mirror only if an admin equivalent exists

**Brief.** From `requests-detail.jsx` rounds 2 and 3: the status strip becomes a `DeliverySpine` whose steps are buttons for team audiences (optimistic `PUT`, toast, hint line); Details rows Category, Priority, Assignee, Due, Estimated, Delivery phase edit in place with a visible chevron using `Menu`, a native date input, and a number input; People add and remove; Checklist add step (existing steps API); header "..." `Menu` with Nest under another request (searchable picker), Make top-level, Duplicate, Archive, Delete (confirm dialogs); Rev chip opens a revision history popover; composer attach and mention; empty states for Files and Sub-requests; Activity expanded when five or fewer events; client review bar with Approve and Request changes (button labels on one line); mobile: rail under main with Time and Actions first.

- [x] **Step 1:** Spine, actions menu, client review bar components.
- [x] **Step 2:** Rail editors and People changes.
- [x] **Step 3:** APIs and MCP parity.
- [x] **Step 4:** Checks, commit `feat(requests): editable detail rail, delivery spine, header actions, client review`, lead review, push, smoke as admin and as a client on a client_review request.

---

### Slice 7: New request dialog and portal capacity strip

**Files:**
- Modify: `components/tahi/new-request-dialog.tsx` (AI assist entry that opens `AiRequestWizard`, size suggestion for clients with Change link, team hint line, client queue placement options, placement alignment), `components/tahi/track-queue-view.tsx` or a new `components/tahi/requests/capacity-strip.tsx` for the portal list header
- Create: `lib/request-size-suggestion.ts` and `.test.ts` (multi-day when the brief exceeds 60 words or category is development or strategy, never when the plan has no large track)
- API: `POST /api/portal/requests` accepts `placement: 'queue' | 'top' | 'replace'` and maps it to priority and queue position (existing track queue reorder endpoint)

**Brief.** Match `requests-dialog.jsx` rounds 1 and 2 and `requests-capacity.jsx`: lanes per track with a live tile (dot, title, assignee, progress, due), empty-lane placeholder, numbered queue with Next up.

- [x] Steps as above, commit `feat(requests): dialog suggestion and placement, portal capacity lanes`, lead review, push, smoke as a client.

---

### Slice 8: Focus ring, polish, Playwright

**Files:**
- Modify: `app/globals.css` (`.tahi-focus-ring` becomes the two-layer outside ring `0 0 0 2px var(--color-bg), 0 0 0 4px var(--color-brand)` for `:focus-visible`, plus `:focus-within` on wrapper classes used by the composer, search fields, quick-add), `tests/e2e/requests.spec.ts`

- [x] Apply the ring, audit every Requests control for it at 375px and in dark mode.
- [x] Playwright: sign in as admin, open Requests, switch all four views, create a request, expand a row, drag a kanban card, open a detail and move the spine.
- [x] Commit `chore(requests): focus ring and e2e`, lead review, push.

---

## Order and parallelism

S1 (gate) → S2 → { S3, S4, S5 in parallel } → S6 → S7 → S8. S6 and S7 can overlap if S6 stays out of `new-request-dialog.tsx`.

## Definition of Done per slice (CLAUDE.md rule 8)

type-check, lint, build, push, live smoke on the deployed URL, 375px with no horizontal page scroll and 44px targets, dark mode, and a note of 4 to 6 in the commit body. Prod deploys straight from main now that the environment review gate is off, so the smoke happens on portal.tahi.studio; treat every push as live.
