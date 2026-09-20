# Requests Alignment Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Close the gap between the ported Requests surface and the approved Claude Design prototype, fix the five defects Liam reported after his first look, then flip the super-admin gate so the team and clients get the new Requests.

**Architecture:** Four read-only audits (`docs/superpowers/audits/2026-09-03-requests-audit-{list,dialog,detail,board}.md`) are the detailed spec; this plan assigns their findings to slices, records the decisions the lead made on the open questions, and fixes file ownership. The prototype sources live under `.claude/design-drafts/requests-final/` (gitignored). Slice A lands a shared sliding `SegmentedControl` primitive first because three later slices consume it; B to E then run in parallel git worktrees on their own branches and are merged by the lead.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind v4 with CSS variables from `app/globals.css`, SWR, Drizzle on D1, Tiptap, Vitest, Playwright.

---

## Decisions (lead, 2026-09-03; do not re-litigate)

1. **One sliding segmented control.** New `components/tahi/segmented-control.tsx` with `.tahi-seg*` rules in `app/globals.css`, motion from the prototype (`transform` and `width` 360ms `cubic-bezier(.22,1,.36,1)`, none under reduced motion). Consumers this pass: the Requests view switcher, the detail Activity All / Comments toggle, the dialog size control. `SlideSeg` in `components/tahi/settings/primitives.tsx` becomes a thin wrapper over it so settings inherits the motion. The timer chip's `.tt-seg` is left alone (trusted daily driver).
2. **Chip clipping** is fixed at the source (`InlineTrigger` max-width and a growable `DetailRow` value cell), not by removing ellipsis.
3. **All / Comments on the detail page** moves into the Activity card header as the sliding control. Comments shows thread messages merged into the feed as events with a one-line excerpt, so the filter is worth having. Activity stays open by default when it has five or fewer events.
4. **Dialog** is rebuilt to the prototype's shape: audience runs off `isAdmin` alone; centred modal; body order AI card, client (team only), category tiles, title, brief (rich text), size (sliding control for team, suggestion chip for clients), priority (team: Standard / High, the repo vocabulary, no data migration) or placement (client), ideal due date with tooltip; footer note; confirmation for both audiences. Brand stays as a compact select after Client only when the client has brands. Start date and Est. hours move into a collapsed "More details" disclosure for the team audience. Intake questions stay below the brief when a form resolves. Sub-request mode stays. The AI wizard renders inside the dialog shell with a progress line, and hand-back to the form is its primary action. Rollout gate for the new dialog is `isSuperAdmin` until the flip.
5. **Expanded sub-requests** render as real `<tr>` children in the same `<tbody>` so columns align with the parent for free (`expandedRowMode: 'rows'` on `DataTable`). Mobile cards are added as an opt-in `mobileCard` render prop used by Requests only.
6. **Board**: quick-add returns, the admin POST accepts a whitelisted `status`; category chip is the icon-only tinted chip; the org tag is dropped on cards when the client avatar is shown; add an On hold column to `BOARD_COLS` and a one-line note under the board naming how many cancelled or archived requests are off-board; chip clicks feed the rail's filters, never a second filter model.
7. **Workload**: open work only, capacity constant of 5, per-person four-item preview with "+N more". No track occupancy section this pass.
8. **Deferred, not this pass**: the file proofing viewer with pinned comments (needs schema, API, MCP tool; own slice later), the timer chip migration, a bottom-sheet filter UI on mobile (keep `SlideOver`).
9. **Gate flip** happens after this pass ships and the lead smokes production as super admin and as an impersonated client: `railOn`, `newUi`, and the dialog gate all become true for everyone in one commit.

## Ground rules for every slice

- Read the relevant audit file in full before touching code; it carries file and line references for both prototype and repo.
- `components/tahi/` conventions: `'use client'`, CSS variables via `var(--color-*)`, no hardcoded hex, rem units, no single-side borders, hover and `:focus-visible` on every control (`tahi-focus-ring` family), 44px touch targets under `md`, no em or en dashes anywhere, no `any`, no `console.log`.
- Never `git add -A`. Slice A does not run git at all. Slices B to E run in their own worktree on branch `align/<slice>` and commit only the files they own with the session trailer.
- Tests: Vitest for any new pure helper; extend `e2e/requests.spec.ts` where a slice adds a stable control.
- Do not touch `app/globals.css` outside Slice A. Component-local CSS goes in the component (the kanban already has `KANBAN_CSS`).

---

### Slice A: SegmentedControl primitive (blocks B, D, E)

**Files:**
- Create: `components/tahi/segmented-control.tsx`, `components/tahi/__tests__/segmented-control.test.tsx`
- Modify: `app/globals.css` (append `.tahi-seg`, `.tahi-seg-pill`, `.tahi-seg-b`, `.tahi-seg-ic`, icon-only and fill variants, reduced motion), `components/tahi/settings/primitives.tsx` (`SlideSeg` delegates), `app/(dashboard)/design-system/design-system-content.tsx` (showcase section)

**Brief.** API: `value`, `onChange`, `options: { value, label, icon?, disabled?, title? }[]`, `ariaLabel`, `role: 'tablist' | 'radiogroup' | 'group'` (tablist gets roving tabindex plus Arrow, Home, End), `size: 'sm' | 'md'`, `fill?: boolean` (equal-width grid), `iconOnlyBelow?: 'md' | 'lg'` (label hidden below the breakpoint, name carried by `title` and `aria-label`), `className`. The pill is measured from the active button (`offsetLeft`, `offsetWidth`) in a layout effect and re-measured on value, option count, a `ResizeObserver` on the track, and font load. Active icon tints to brand. Disabled option: `aria-disabled`, faint colour, tooltip via `title`.

- [x] Write the render test first: pill follows the active option, arrow keys move selection in tablist mode, disabled option is not selectable, reduced motion class present.
- [x] Build the component and the CSS. Showcase it on the design-system page next to Button.
- [x] `SlideSeg` becomes a wrapper mapping `opts` to `options`; behaviour in settings unchanged.
- [x] `npm run type-check`, `npm run lint`, `npx vitest run components/tahi/__tests__/segmented-control.test.tsx`.

---

### Slice B: List, rail, switcher, expanded rows (audit-list A1 to A13)

**Branch:** `align/list`
**Files:** `components/tahi/requests/requests-view-switcher.tsx`, `components/tahi/requests/requests-rail-layout.tsx`, `components/tahi/requests/sub-request-rows.tsx`, `components/tahi/data-table.tsx`, `components/tahi/data-table-expand.ts`, `components/tahi/__tests__/data-table-expand.test.tsx`, `app/(dashboard)/requests/request-list.tsx` (list, header, empty and error states, `onClearAll`, subtitle; leave the board, workload, timeline and capacity mounts to Slice C), `e2e/requests.spec.ts` (list cases only)

- [x] A1 switcher on `SegmentedControl` (`role="tablist"`, `iconOnlyBelow="lg"`).
- [x] A2 `expandedRowMode: 'rows'` on `DataTable`; `SubRequestRows` returns `<tr>` children matching the parent columns; group hairline all sides, `--color-bg-secondary`, hover `--color-bg-tertiary`, keep `tahi-row-expand`.
- [x] A3 third header click clears sort (`onSortChange(null)`, `aria-sort="none"`). A4 shift-click range select with `userSelect: 'none'`. A5 filtered empty state with Clear filters. A6 `mobileCard` prop and the Requests card. A7 audience subtitle sentences. A8 clear-all resets sort. A9 Save as default reachable below `lg`. A10 header "Request", Updated right-aligned, urgent zap. A11 checkbox 2.75rem target under `md`. A12 SWR error panel with retry. A13 correct the 50-row comment and note the 500 ceiling.
- [x] Tests for A3 and A4 in the data-table test file. Type-check, lint, Vitest. Commit `feat(requests): list alignment pass` on `align/list`.

---

### Slice C: Kanban, workload, timeline, capacity (audit-board K1 to C3)

**Branch:** `align/board`
**Files:** `components/tahi/kanban-board.tsx`, `components/tahi/board-view.tsx`, `components/tahi/requests/requests-timeline.tsx`, `lib/timeline-domain.ts` and its test, `components/tahi/requests/capacity-strip.tsx`, `components/tahi/due-date-chip.tsx` (lift from `request-list.tsx`), `app/(dashboard)/requests/request-list.tsx` (only the board, workload, timeline and capacity regions: `BOARD_COLS`, `boardItems` mapping, `WorkloadView`, the capacity mount, `onAdd`, chip click routing), `app/api/admin/requests/route.ts` (whitelisted `status` on POST; `subRequestDoneCount` beside `subRequestCount`), `app/api/portal/requests/route.ts` (`subRequestDoneCount`), `workers/mcp-server/src/index.ts` (create_request gains `status` if the admin POST does), `e2e/requests.spec.ts` (kanban cases only)

- [x] K1 quick-add composer and `onAdd`; K2 empty slot copy and no disabled button; K3 due chip; K4 done count; K5 category icon chip and chip order, org tag dropped when the client avatar shows; K6 grab cursor, grip, settle; K7 Triage badge; K8 aria cleanup under `hideHeader`; K9 chip clicks route into rail filters.
- [x] W1 open-only counts; W2 capacity constant 5, clamp width, danger tone above; W3 four-item preview with "+N more".
- [x] T1 undated requests plot as a milestone on `createdAt`; T2 sort by due ascending, undated last.
- [x] C1 strip mounts as the first child of the main column, list view only, no query, filter or saved view; C2 plan chip and header tint; C3 pulse with reduced-motion fallback.
- [x] On hold column added to `BOARD_COLS`; off-board note under the board.
- [x] Type-check, lint, Vitest. Commit `feat(requests): board, workload, timeline, capacity alignment` on `align/board`.

---

### Slice D: Request detail (audit-detail D1 to D13, D6 deferred)

**Branch:** `align/detail`
**Files:** `app/(dashboard)/requests/[id]/request-detail.tsx` (newUi branch only), `components/tahi/requests/inline-field.tsx`, `components/tahi/requests/delivery-spine.tsx`, `components/tahi/request-thread.tsx`, `components/tahi/time-card.tsx`, `e2e/requests.spec.ts` (detail cases only)

- [x] D1 Activity All / Comments as `SegmentedControl` in the card header; thread messages merged into the feed as comment events with an excerpt; open by default at five or fewer events.
- [x] D2 chip clipping: `DetailRow` dd `flex: 1 1 auto; min-width: 0; display: flex; justify-content: flex-end`; `InlineTrigger` `maxWidth: calc(100% + 0.625rem)`. Verify at 375px and the 16rem rail.
- [x] D3 spine as its own bordered card between the header and the grid: 1.5rem nodes, connector track, check in completed nodes, brand ring on the current node, labels under nodes, existing API kept.
- [x] D4 Internal chip in the header meta and an Internal request switch in Actions with the note line, wired to the admin PUT; confirm the portal list and detail exclude internal requests before enabling.
- [x] D5 internal-own tint wins; amber utility classes replaced by warning tokens. D7 scope warning card above the spine. D8 sticky rail at `md` and up. D9 Brief above the thread. D10 rail order Time, Actions, Discovery calls, Details, People, Checklists. D11 off-pipeline note for draft and archived. D12 "Led by" in the sub-meta. D13 timer pause glyph.
- [x] The AI reply draft textarea keeps the `tahi-focus-ring` class already applied locally (uncommitted; the lead commits it with this slice).
- [x] Type-check, lint, Vitest. Commit `feat(requests): detail alignment pass` on `align/detail`.

---

### Slice E: New request dialog (audit-dialog D1 to D18, D7 resolved as repo vocabulary)

**Branch:** `align/dialog`
**Files:** `components/tahi/new-request-dialog.tsx`, `components/tahi/ai-request-wizard.tsx`, `components/tahi/slide-over.tsx` (add `variant="center"` with the four modal behaviours, entry motion, blur backdrop, reduced motion), `components/tahi/rich-brief.tsx` (new, Tiptap: bold, italic, bullets, link; HTML out), `lib/request-size-suggestion.ts` (only if needed), `e2e/requests.spec.ts` (dialog cases only)

- [x] D1 audience off `isAdmin`; `isSuperAdmin` only as the rollout gate. D2 centred modal via `SlideOver variant="center"`; D13 comes with it. D3 and D8 body reorder and strip per decision 4. D4 category tile grid on `--cat-*` tokens, `role="radiogroup"`. D5 size as `SegmentedControl` (team) with the disabled large option and tooltip when the plan has no large track. D6 `RichBrief`; confirm the detail page and portal render HTML descriptions safely (the thread already renders Tiptap HTML). D9 footer note. D10 "Ideal due date" with a focusable info tooltip. D11 client brief required. D12 team confirmation with Go to request and Done. D14 AI draft chip. D15 wizard inside the shell, progress line, hand-back primary. D16 header copy. D17 due default plus seven, min tomorrow. D18 centred confirmation; keep the repo's plan sentence.
- [x] Type-check, lint, Vitest. Commit `feat(requests): dialog rebuilt to the prototype` on `align/dialog`.

---

### Integration and flip (lead)

- [x] Merge `align/list`, `align/board`, `align/detail`, `align/dialog` into main in that order; resolve `request-list.tsx` and `e2e/requests.spec.ts` overlaps.
- [x] Spec and code-quality review per slice against the audits; fixes applied in the main tree.
- [x] `npm run type-check`, `npm run lint`, `npx vitest run`, `npm run build`, push, wait for Deploy dashboard, live smoke as super admin (list, four views, expand, dialog, detail) and as an impersonated client.
- [x] Gate flip commit: `railOn`, `newUi`, dialog gate to true. Smoke again as a normal admin path and as a client. Update memory and this plan.

---

## Shipped 2026-09-03

- Slices A to E merged (ff5f341), technical audit fixes merged (0f034d3), gate flipped for every audience (51ef34b). All deployed to production and smoked as super admin and as an impersonated client (Giant Group, scale plan).
- Checks at the flip: type-check, worker type-check, lint zero errors, 1101 unit tests, build, 53 of 54 Requests e2e (one harness navigation abort, passed on rerun).

## Follow-ups (not done in this pass)

1. Delete the legacy branches behind `railOn`, `newUi` and `NEW_DIALOG_FOR_EVERYONE` (all three are now constants).
2. Portal POST: stamp the caller's single linked brand (I5 portal half) and verify large-track entitlement before accepting `large_task` (I11 second half).
3. Worker MCP: `create_request` gains `brandId` now that the admin POST accepts it; portal tools do not exist on the worker at all (placement, review) and need a decision.
4. File proofing viewer with pinned comments (prototype only): schema, API, MCP tool, UI.
5. `request-list.tsx` uses `useSearchParams` without a Suspense boundary, so Next bails to client rendering and ships a hidden `#S:0` copy of the admin SSR markup; wrap the search-param reader in Suspense.
6. Timer chip migration onto `SegmentedControl`; the `.segx` rules in settings.css are still live for the tuple `Seg`.
7. Claude Design parity work list: `docs/superpowers/audits/2026-09-03-design-parity-inventory.md` (P1: AI briefing in the top bar, AI triage banner, AI reply draft, Discovery calls schedule form). Needs the claude-design MCP connection.
8. Minor audit items deferred by the fix branches: M9 (regenerate overwrites an edited reply without confirmation), M6, M15 (Cancelled column drift between BOARD_COLS and the API defaults), M22 header trigger sizing, portal halves of I16 and M3, I21 durable assignee mirror, the em dash in the overview brief's urgentContractText.
