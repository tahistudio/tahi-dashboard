# Requests Redesign: Claude Design Draft Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revise the Requests prototype in the Claude Design project "Tahi dashboard" so it reflects Liam's keep / cut / change verdicts, ready for his in-app review and a later TSX port.

**Architecture:** The prototype is a static React 18 + Babel-standalone page ("Tahi App Shell.html") that loads plain-JS files onto `window.*` globals. Task 0 splits the one large `requests-list.jsx` into per-slice files and gives every slice its own stylesheet so Tasks 1 to 5 can run in parallel without touching the same file. Each task edits its own files, uploads with etag-guarded `write_files`, renders with `render_preview`, screenshots in Chrome, and reports an `open_url` for review. Nothing in the repo changes in this plan except the plan file itself.

**Tech Stack:** Claude Design MCP tools (`mcp__claude-design__*`), Chrome MCP tools (`mcp__claude-in-chrome__*`), React 18 UMD, `React.createElement` (no JSX in the requests files), CSS custom properties from the bound "Tahi Studio DS - Components" bundle.

---

## Ground rules for every task

**Project.** Claude Design project id `57bf60cf-5e6d-450f-9e2f-e25c8d12fd66`. The requests surface is mounted inside `Tahi App Shell.html` (it sets `window.__TAHI_INITIAL = 'requests'`). `Tahi Settings.html` loads the same script list, so both HTML files must stay in sync.

**Local scratch copies.** Current sources are downloaded to `C:\Users\Work\Projects\tahi-dashboard\.claude\design-drafts\requests\` (gitignored). Read them there for context, but the source of truth is the Claude Design project. Always `read_file` the project copy you are about to change and carry its `etag` into `write_files` as `if_match`. Never write without `if_match`.

**Write token.** The lead mints a project-scoped `plan_token` with `finalize_plan(scope: "project")` and passes it in your prompt. Pass it verbatim to every `write_files` / `copy_files` call.

**Code style in the prototype.** The requests files use `React.createElement`, an IIFE per file, and expose on `window`. Match that. No JSX in `requests-*.jsx`. Use the icon set in `window.RQ.Icon` (defined in `requests-kit.jsx`); add new icon paths only in the file you own. Colours and spacing come from CSS variables already used in `requests.css` (`--brand`, `--text`, `--text-muted`, `--text-faint`, `--border`, `--border-subtle`, `--bg`, `--bg-secondary`, `--bg-tertiary`, `--status-*`, `--cat-*`, `--color-danger`). No new hex values except where the file already hardcodes one.

**Design rules (Studio Ledger, non-negotiable).**
- Hairlines over cards. Borders are all sides or none. Never a single-side border.
- Brand green is the only accent. Status colours signal status only.
- Manrope only. Leaf radius (`0 10px 0 10px`, `0 16px 0 16px`) only on primary CTAs, avatar tiles, feature callouts.
- Touch targets at least 44px on mobile. No hover-only affordances; anything revealed on hover must also be reachable on tap or focus.
- Hover animations play to completion and never reverse mid-way.
- New copy uses plain punctuation. No em dashes or en dashes in anything you write (existing copy may keep them).
- Every audience works: owner, teammate, client. Every device works: desktop and mobile. Both are switchable from the prototype's Tweaks panel (bottom right, "Tweaks" pill).

**Verify loop (run after every upload).**
1. `render_preview(project_id, "Tahi App Shell.html")`, take `serve_url`.
2. Chrome: `tabs_context_mcp(createIfEmpty: true)`, `navigate` to `serve_url`, `computer wait 6`, then `computer screenshot` at the default viewport. Use `read_console_messages` with pattern `Error|error|Uncaught` and confirm there are none from your files.
3. Drive the state you changed (open Tweaks, switch audience or device, open the dialog, and so on) and screenshot each state with `save_to_disk: true`.
4. Close the tab with `tabs_close_mcp` when done. Re-use one tab; do not open several.
5. Report: `open_url` (the `claude.ai/design/...` link only; never the `serve_url`), saved screenshot paths, and a checklist of the brief's asks with "landed" or "not landed" next to each.

**Liam's comments (the brief, verbatim where it matters).**
- Board cards: "I do like the way these cards look, they have the scroll across which we don't want (inside the actual individual boards). we can also show subtasks better, and who owns / what client better. but this is nice with the urgent, and what not. i think the repo does sub tasks better."
- Client capacity strip: "This is good, but could look a little more visual to show that it's an active tasks etc."
- AI assist screen: "perfect."
- Queue placement options: "this is perfect. but needs text alignment better"
- Client size control: "This for client is nice, but it should be also maybe detected either by ai or by us? so just make sure it reads like a suggestion"
- View tabs and filters row: "I think on both repo and design, we do filters/ switching poorly. this could be redesigned."
- List rows: "needs select and select all like repo." and "I like these cards on the table"
- New-request dialog: "truly love all of this. it's really good."
- In chat: keep the repo's board card hover animation, the timeline sub-view, quick status change, and table sorting. Remember individual preferences for filters and board view. Put Export CSV and Bulk Create into a small "..." dropdown. Add the repo's AI draft button to the design.

---

## File structure after Task 0

| File | Owner | Exposes |
|---|---|---|
| `requests-data.jsx` | nobody (frozen) | `window.TahiRequestsData` |
| `requests-kit.jsx` | Task 2 only | `window.RQ` |
| `requests-audience.jsx` | nobody (frozen) | `window.TahiReqList.matchAudience`, `TEAMMATE_CLIENTS`, `CLIENT_ORG` |
| `requests-toolbar.jsx` | Task 1 | `window.TahiReqList.Toolbar`, `SAVED_VIEWS` |
| `requests-listview.jsx` | Task 2 | `window.TahiReqList.ListView` |
| `requests-board.jsx` | Task 3 | `window.TahiReqList.BoardView` |
| `requests-workload.jsx` | nobody (frozen) | `window.TahiReqList.WorkloadView` |
| `requests-capacity.jsx` | Task 4 | `window.TahiReqList.CapacityStrip` |
| `requests-detail.jsx` | nobody (frozen) | `window.TahiReqDetail` |
| `requests-dialog.jsx` | Task 5 | `window.TahiReqDialog` |
| `requests.jsx` | Task 1 | `window.TahiRequests` |
| `requests.css` | nobody (frozen after Task 0) | base styles |
| `requests-toolbar.css` | Task 1 | overrides + new toolbar styles |
| `requests-listview.css` | Task 2 | selection, sort headers, bulk bar |
| `requests-board.css` | Task 3 | board layout, cards, timeline |
| `requests-capacity.css` | Task 4 | capacity strip |
| `requests-dialog.css` | Task 5 | placement alignment, suggestion row |
| `Tahi App Shell.html`, `Tahi Settings.html` | Task 0 only | script + link tags |
| `archive/requests-2026-07/*` | lead | untouched originals |

Each `TahiReqList` file registers with `window.TahiReqList = Object.assign(window.TahiReqList || {}, { ... })` so load order between slice files does not matter, as long as `requests-data.jsx` and `requests-kit.jsx` load first and `requests.jsx` loads last.

---

### Task 0: Split the prototype into per-slice files (model: sonnet)

**Files:**
- Read: `requests-list.jsx`, `requests.css`, `Tahi App Shell.html`, `Tahi Settings.html`
- Create: `requests-audience.jsx`, `requests-toolbar.jsx`, `requests-listview.jsx`, `requests-board.jsx`, `requests-workload.jsx`, `requests-capacity.jsx`, `requests-toolbar.css`, `requests-listview.css`, `requests-board.css`, `requests-capacity.css`, `requests-dialog.css`
- Modify: `Tahi App Shell.html`, `Tahi Settings.html`
- Delete: nothing (leave `requests-list.jsx` in place but remove it from both HTML files so it stops loading)

- [x] **Step 1: Baseline screenshots**

Run the verify loop on the current `Tahi App Shell.html` before changing anything. Capture owner list view, owner board view, client list view (Tweaks: Audience Client). Save all three to disk. These are the "before" images; the split must render identically.

- [x] **Step 2: Create `requests-audience.jsx`**

Move `TEAMMATE_CLIENTS`, `CLIENT_ORG`, and `matchAudience` out of `requests-list.jsx` into this file:

```js
/* Requests — audience visibility helpers. Exposes on window.TahiReqList. */
(function(){
  const TEAMMATE_CLIENTS = ['physitrack','kowtow','allbirds','sharesies'];
  const CLIENT_ORG = 'physitrack';
  function matchAudience(r, audience, me){
    if(audience==='client') return r.clientId===CLIENT_ORG && r.status!=='draft';
    if(audience==='teammate') return TEAMMATE_CLIENTS.includes(r.clientId);
    return true;
  }
  window.TahiReqList = Object.assign(window.TahiReqList || {}, { matchAudience, TEAMMATE_CLIENTS, CLIENT_ORG });
})();
```

- [x] **Step 3: Create `requests-toolbar.jsx`**

Move `useOutside`, `SegTabs`, `FilterPopover`, `FilterChip`, `SAVED_VIEWS`, and `Toolbar` verbatim from `requests-list.jsx`. Wrap in an IIFE that starts with the same destructuring the original file used:

```js
(function(){
  const { useState, useRef, useEffect, useLayoutEffect } = React;
  const D = window.TahiRequestsData;
  const { Icon } = window.RQ;
  // ...moved functions, unchanged...
  window.TahiReqList = Object.assign(window.TahiReqList || {}, { Toolbar, SAVED_VIEWS });
})();
```

- [x] **Step 4: Create `requests-listview.jsx`**

Move `ListView`, `MobileCard`, `EmptyState` verbatim. Destructure from `window.RQ` exactly what they use: `Icon, Avatar, StatusEditor, StatusBadge, CatChip, PriorityTag, DueChip`. Register `{ ListView }`.

- [x] **Step 5: Create `requests-board.jsx`**

Move `makeGhost`, `BoardView`, `BoardCard`, `QuickAdd` verbatim. Destructure `Icon, Avatar, MiniProgress, SubBadge, CatChip, PriorityTag, DueChip`. Register `{ BoardView }`.

- [x] **Step 6: Create `requests-workload.jsx`**

Move `WorkloadView`, `TrackCard` verbatim. Destructure `Icon, Avatar, StatusBadge, DueChip, PlanChip`. Register `{ WorkloadView }`.

- [x] **Step 7: Create `requests-capacity.jsx`**

Move `CapacityStrip` verbatim. It reads `CLIENT_ORG` from `window.TahiReqList.CLIENT_ORG` (read it inside the function body, not at file top, so load order does not matter). Destructure `Icon, StatusBadge, DueChip, PlanChip`. Register `{ CapacityStrip }`.

- [x] **Step 8: Create the five empty stylesheets**

Each file contains exactly one comment line, for example `/* requests-toolbar.css — Task 1 overrides. Loads after requests.css. */`.

- [x] **Step 9: Update both HTML files**

In `Tahi App Shell.html` and `Tahi Settings.html`, after the existing `<link rel="stylesheet" href="requests.css">` add, in this order:

```html
<link rel="stylesheet" href="requests-toolbar.css">
<link rel="stylesheet" href="requests-listview.css">
<link rel="stylesheet" href="requests-board.css">
<link rel="stylesheet" href="requests-capacity.css">
<link rel="stylesheet" href="requests-dialog.css">
```

Replace the single line `<script type="text/babel" data-presets="react" src="requests-list.jsx"></script>` with:

```html
<script type="text/babel" data-presets="react" src="requests-audience.jsx"></script>
<script type="text/babel" data-presets="react" src="requests-toolbar.jsx"></script>
<script type="text/babel" data-presets="react" src="requests-listview.jsx"></script>
<script type="text/babel" data-presets="react" src="requests-board.jsx"></script>
<script type="text/babel" data-presets="react" src="requests-workload.jsx"></script>
<script type="text/babel" data-presets="react" src="requests-capacity.jsx"></script>
```

Keep `requests-data.jsx` and `requests-kit.jsx` before these, and `requests-detail.jsx`, `requests-dialog.jsx`, `requests.jsx`, `app-mount.jsx` after, exactly as they are now.

- [x] **Step 10: Upload**

`list_files(project_id, depth: -1)` to get current etags. `write_files` all new files with `if_match: "0"` and the two HTML files with their listed etags. Pass the `plan_token`.

- [x] **Step 11: Verify identical render**

Run the verify loop. Compare the three "after" screenshots with the "before" set: same layout, same rows, same board columns, no console errors, `window.TahiReqList` has keys `Toolbar, SAVED_VIEWS, ListView, BoardView, WorkloadView, CapacityStrip, matchAudience, TEAMMATE_CLIENTS, CLIENT_ORG` (check with `javascript_tool`: `Object.keys(window.TahiReqList).sort()`). Also load `Tahi Settings.html` once and confirm it renders with no console errors.

- [x] **Step 12: Report**

Report the `open_url`, the before and after screenshot paths, and the key list. Do not proceed to any design change.

---

### Task 1: Toolbar, view switching, filters, header actions (model: opus)

**Files:**
- Modify: `requests-toolbar.jsx`, `requests.jsx`, `requests-toolbar.css`
- Read for reference: `requests-data.jsx`, `requests-kit.jsx`, `requests.css`, the repo files `components/tahi/filter-bar.tsx`, `components/tahi/view-toggle.tsx`, `app/(dashboard)/requests/request-list.tsx` lines 780 to 900 (current toolbar), `components/tahi/data-table.tsx` lines 220 to 260 (sort state shape)

**Brief.** Liam's verdict is that filters and view switching are done poorly in both the repo and the design. This task explores that space. Produce three variants in place, switchable from a prototype-only strip at the top of the requests page (`.req-proto-strip`, small, muted, labelled "Prototype: toolbar A / B / C", hidden in the client audience only if it would confuse; keep it for owner and teammate). Persist the chosen variant in `localStorage` key `tahi.req.toolbarVariant`.

Every variant must carry the same job list:
1. View switcher: List, Board, Workload (Workload owner only). When Board is active, a secondary Kanban / Timeline sub-switch appears (Task 3 renders Timeline; expose `boardView` state as `'kanban' | 'timeline'` on the toolbar props and pass it through `requests.jsx` to `BoardView` as `sub`).
2. Saved views from `SAVED_VIEWS` (All active, Triage, Assigned to me for teammates, Overdue, Due this week, Awaiting client, Delivered).
3. Filters: Status, Category, Client (owner only), Type (small / large), Created date range (any / 7 days / 30 days / 90 days). Filters must be readable at a glance when active (show the active values, not just a count).
4. Sort: Due, Updated, Priority, Client, with direction. Store as `{ key, dir }` and pass to `requests.jsx`, which applies it in the `filtered` memo (replace the current fixed due-date sort).
5. Free-text search.
6. A result count.
7. A "Save as my default" affordance that visualises per-user persistence: when the current view, filters, and sort differ from the saved default, show a quiet "Save as default" link; when they match, show "Your default". Persist to `localStorage` key `tahi.req.default`. This is a prototype stand-in for the repo's `useUserPreference`.
8. Mobile: the same jobs collapse into a single "View and filters" sheet that opens from a 44px button. Chips must wrap, never scroll horizontally.

Variant guidance (mix by-the-book with novel, as the hifi-design skill asks):
- A: Linear-style. One row: view switcher left, saved views as text tabs with counts, a single "Filter" button that opens a popover with all dimensions, sort in the same popover, search right.
- B: Notion-style chip builder. Row 1: view switcher and search. Row 2: active filter chips inline (`Status: In progress ×`), an "+ Filter" chip, a sort chip, saved views as a dropdown on the left of row 2.
- C: Sidebar rail. A slim left rail (owner and teammate only) listing saved views vertically with counts, above a compact filter stack; the table takes the rest. On mobile the rail becomes the sheet.

Header actions (in `requests.jsx`): keep "New request" primary. Add a secondary "AI draft" button (sparkle icon from `RQ.Icon` name `wand` or add `sparkles`) that opens the existing dialog straight into its AI view (add an `initialView` prop to `Dialog` in your call and read it in `requests-dialog.jsx` only via `props.initialView || 'form'`; Task 5 owns that file, so coordinate by keeping the change to that one default line and telling the lead). Add a "..." overflow button (`RQ.Icon` name `more`) that opens a `req-menu` with "Export CSV" and "Bulk create"; owner and teammate only, never client. The overflow menu closes on outside click and Escape.

- [x] **Step 1: Read the current files and the repo references listed above.** Note the exact `Toolbar` props signature in `requests.jsx` so the new toolbar stays drop-in compatible plus the new `sort`, `setSort`, `boardView`, `setBoardView` props.
- [x] **Step 2: Implement the shared state and the prototype strip** in `requests-toolbar.jsx`. Export `Toolbar` with the extended props and a `useToolbarVariant()` hook.
- [x] **Step 3: Implement variant A.** Upload. Verify loop: owner desktop, owner mobile, client desktop. Screenshot each.
- [x] **Step 4: Implement variant B.** Upload. Verify loop, same states.
- [x] **Step 5: Implement variant C.** Upload. Verify loop, same states.
- [x] **Step 6: Wire sort and board sub-view through `requests.jsx`.** The `filtered` memo sorts by `sort.key` and `sort.dir`; default `{ key: 'due', dir: 'asc' }`. `BoardView` receives `sub={boardView}`, and `boardView` is persisted to `localStorage` key `tahi.req.boardView` (Task 3 reads that key as its fallback). Add the AI draft button and the "..." overflow menu to `req-head-actions`. Upload. Verify loop: open the overflow, open AI draft, screenshot both.
- [x] **Step 7: Save-as-default.** Implement the persistence affordance. Verify by changing a filter, reloading, confirming "Your default" state is restored. Screenshot.
- [x] **Step 8: Report** with the `open_url`, all screenshot paths, and one paragraph per variant on what it optimises for and what it costs, so Liam can pick.

---

### Task 2: List selection, sortable headers, bulk bar (model: sonnet)

**Files:**
- Modify: `requests-listview.jsx`, `requests-kit.jsx`, `requests-listview.css`
- Read for reference: repo `components/tahi/bulk-action-bar.tsx` (uncommitted, in the working tree), `components/tahi/data-table.tsx` lines 340 to 400, `app/(dashboard)/requests/request-list.tsx` lines 630 to 760

**Brief.** Keep the row treatment Liam likes. Add what the repo has and the design lacks.

1. Add a `Checkbox` primitive to `requests-kit.jsx` (owner and teammate only). 18px box, 1px `--border` all sides, brand fill when checked, check icon from `RQ.Icon`, 44px hit area on mobile via padding. Export it on `window.RQ`.
2. Header row gets a select-all checkbox. Rows get a checkbox in a new first column. Clicking a checkbox never opens the row. Shift-click selects a range (nice to have, do it if under 20 lines).
3. Sortable headers for Request, Client, Status, Priority, Due, Updated: a button with `aria-sort`, a small chevron that only shows on the active column, click cycles asc, desc, none. Sorting is local state inside `ListView` for this prototype (Task 1 owns the toolbar-level sort; if the toolbar passes a `sort` prop, prefer it, otherwise fall back to local).
4. When one or more rows are selected, a bulk bar appears above the table: "N selected", one primary action "Mark delivered", an "Edit" button opening a `req-menu` with labelled sections Status (the five pipeline statuses), Assign (Liam, Staci, Maya, Sam), Danger (Archive, which opens a confirm dialog: title "Archive N requests?", body "They move out of the pipeline. You can restore them from the Archived filter.", buttons Cancel and Archive), and a Clear link. Full hairline border on the bar, all four sides, `--bg` background, no shadow. Actions in the prototype only update local state and fire the existing `RQ` toast.
5. Client audience: no checkboxes, no bulk bar, headers still sortable.
6. Mobile cards: no checkboxes, add a long-press-free alternative: a "Select" toggle in the toolbar area is out of scope; simply omit selection on mobile and say so in the report.

- [x] **Step 1: Read the files above.**
- [x] **Step 2: Add `Checkbox` to `requests-kit.jsx`.** Upload with `if_match`. Verify it renders by temporarily logging `typeof window.RQ.Checkbox` via `javascript_tool`.
- [x] **Step 3: Add selection column, select-all, and the bulk bar** to `requests-listview.jsx` and styles to `requests-listview.css`. Upload. Verify loop: select two rows, open Edit menu, open the Archive confirm, screenshot each.
- [x] **Step 4: Add sortable headers.** Upload. Verify loop: click Due twice, screenshot ascending and descending.
- [x] **Step 5: Client audience and mobile checks.** Tweaks: Client, then Device Mobile. Screenshot both. Confirm no checkboxes for clients.
- [x] **Step 6: Report.**

---

### Task 3: Board without horizontal scroll, clearer cards, repo hover, timeline (model: opus)

**Files:**
- Modify: `requests-board.jsx`, `requests-board.css`
- Read for reference: repo `components/tahi/kanban-board.tsx` lines 630 to 700 (card hover lift and drag tilt), `components/tahi/board-view.tsx` lines 740 to 900 (`BoardTimeline`), `requests-data.jsx` (`subCount`, `subDone`, `prog`, `created`, `due`)

**Brief.**
1. No horizontal scroll. Desktop: five columns share the width with CSS grid `grid-template-columns: repeat(5, minmax(0, 1fr))`. Between 900px and 1200px: two rows, three columns then two. Below 900px and on mobile: one column at a time with a segmented column picker (Submitted, In review, In progress, Client review, Delivered) above the cards, 44px tall. Cards never clip; long titles wrap to two lines then ellipsise.
2. Card content, top to bottom: category chip and priority icon and scope warning on one line with the number right-aligned (keep); title; client line (avatar plus client name in `--text-muted`, owner audience only); owner line (assignee avatar plus first name, or "Unassigned" in `--text-faint`); subtasks as the repo does them: a thin progress bar with "2 of 3 subtasks" label when `subCount` is set; footer: due chip. Remove the percent progress row unless the request has no subtasks, in which case keep `MiniProgress` for the in-flight statuses.
3. Hover: mirror the repo. On mouse enter raise `box-shadow` from `var(--shadow-xs)` to `var(--shadow-md)` and translate up 1px over 150ms; on leave return over 150ms. While dragging, `rotate(-1.5deg)` and `--shadow-md`. Keep the existing tilted drag ghost.
4. Timeline sub-view. `BoardView` receives `sub` (`'kanban' | 'timeline'`, default `'kanban'`). Timeline: one row per request, sorted by due; a left label column (number, title, client avatar); a bar from `created` to `due` on a day axis spanning from the earliest `created` minus 2 days to the latest `due` plus 3 days; bar colour is the status dot token; a vertical "Today" hairline; overdue bars get a `--color-danger` outline. Rows are clickable and open the request. Mobile: horizontal scroll is allowed inside the timeline only, with the label column sticky.
5. Client audience: read-only, no quick-add, no drag, and the client line is hidden (they only see their own).

- [x] **Step 1: Read the files above and the current `BoardView`.**
- [x] **Step 2: Grid layout and column picker.** Upload. Verify loop at desktop, then resize the Chrome window to 1000px wide with `resize_window`, then Tweaks Mobile. Screenshot all three. Confirm `document.querySelector('.req-board').scrollWidth <= clientWidth` via `javascript_tool`.
- [x] **Step 3: Card content and hover.** Upload. Verify loop: hover a card and screenshot mid-hover with `computer hover` then `screenshot`.
- [x] **Step 4: Timeline.** `BoardView` resolves its sub-view as `props.sub || localStorage.getItem('tahi.req.boardView') || 'kanban'`. Task 1 owns `requests.jsx` and will pass the real `sub` prop and write the same localStorage key, so the fallback is what you use to verify now. Upload. In Chrome run `localStorage.setItem('tahi.req.boardView','timeline')` with `javascript_tool`, reload, switch to Board, screenshot desktop and mobile. Then set it back to `'kanban'`.
- [x] **Step 5: Client audience check.** Tweaks Client, Board. Screenshot.
- [x] **Step 6: Report.**

---

### Task 4: Client capacity strip, more visual (model: sonnet)

**Files:**
- Modify: `requests-capacity.jsx`, `requests-capacity.css`
- Read for reference: `requests.css` sections `.req-capacity`, `.req-track-slot`, `.req-slot-queue`; repo `components/tahi/track-meter.tsx` and `components/tahi/track-queue-view.tsx` for the existing track visual language

**Brief.** Liam: "could look a little more visual to show that it's an active task". Keep the hairline card. Inside it:
1. One lane per active track (the client in the prototype has 2 tracks, so two lanes). Lane header: "Track 1" and "Track 2" in the ledger label style (12px, 600, uppercase, 0.08em tracking, `--text-faint`).
2. The in-progress request in a lane renders as a wide tile: pulsing live dot (existing `.sl-live`), title, assignee avatar with first name, a thin progress bar using `prog`, and the due chip. The tile background is `--bg-secondary`, not brand.
3. An empty lane reads "Open. Next in queue pulls in." with a dashed 1px `--border` outline, all four sides.
4. Queue below the lanes: numbered positions as small circles, title, due chip; first queued item gets the label "Next up".
5. Mobile: lanes stack; nothing scrolls horizontally.
6. Copy stays calm and second person: "Your Scale plan", "2 active tracks. One request builds per track, the next pulls in automatically."

- [x] **Step 1: Read the files above.**
- [x] **Step 2: Implement lanes and tiles.** Upload. Verify loop: Tweaks Client, List view, desktop. Screenshot.
- [x] **Step 3: Mobile.** Tweaks Mobile. Screenshot. Confirm no horizontal scroll via `javascript_tool` on `.req-capacity`.
- [x] **Step 4: Report.**

---

### Task 5: Dialog polish, placement alignment, size as a suggestion (model: sonnet)

**Files:**
- Modify: `requests-dialog.jsx`, `requests-dialog.css`
- Read for reference: `requests.css` sections `.req-place`, `.req-place-opt`, `.req-slideseg`, `.req-field-note`

**Brief.**
1. Placement options ("Add to my queue", "Bump to the top", "Replace what's in progress"): align the icon tile, the text block, and the check so all three sit on one vertical centre; the two text lines share a left edge; the check sits at a fixed right inset. Match the padding of the category tiles above.
2. Size becomes a suggestion for the client audience. Replace the segmented control with a row: label "Size", a chip reading "Suggested: 1 day or less" (or "Suggested: multi-day"), helper text "We'll confirm the size when we review it.", and a quiet "Change" link that reveals the existing segmented control below. Suggestion logic for the prototype: multi-day when the brief has more than 60 words or the category is development or strategy, else 1 day or less. When the brief came from AI assist, the chip reads "Suggested by AI assist". Clients on a plan with no large track never see the multi-day suggestion; they see "1 day or less" and the helper "Your plan runs a single-day track."
3. Team audience keeps the segmented control, and gains the same suggestion as a hint line under it: "Suggested: multi-day, based on the brief."
4. Support `initialView` on `Dialog`: `const [view,setView] = useState(props.initialView || 'form');` so Task 1's AI draft button can open the AI screen directly.
5. Copy uses plain punctuation.

- [x] **Step 1: Read the files above.**
- [x] **Step 2: Placement alignment.** Upload. Verify loop: Tweaks Client, open New request, scroll to placement, `zoom` on the three options, screenshot.
- [x] **Step 3: Suggestion row.** Upload. Verify: client dialog with empty brief, then paste a 70-word brief, screenshot both; then owner dialog, screenshot the hint line.
- [x] **Step 4: `initialView`.** Change the state initialiser to `useState(props.initialView || 'form')` where `Dialog` destructures its props (add `initialView` to the destructured list). Upload. Verify: the default dialog still opens on the form with no console errors. Task 1 exercises the `'ai'` path.
- [x] **Step 5: Report.**

---

## Review gate (lead, after each task)

1. Open the `open_url` in Chrome, walk the states the task reported, compare against the brief bullets above.
2. Check the three house rules that agents most often miss: single-side borders, hover-only affordances, horizontal scroll.
3. Push a short summary to the project chat with `put_conversation` so Liam sees it beside the design.
4. Hand Liam the `open_url` and a two-line summary. He reviews in the app with pinned comments; queued comments (`list_comments queued_for_claude: true`) become the next iteration.

## Deferred: needs Liam's call before any code

**Timer "no client, general time" option.** The design's time tracker offers "None, general requests time". The repo's TimerChip cannot start without a request, task, or client, and `time_entries.org_id` is `NOT NULL`, so general time has nowhere to be logged today. Two ways to fix it:
- Add one internal "Tahi Studio" organisation row and log general time against it. No schema change, but it puts a non-client org in the clients list.
- Make `time_entries.org_id` nullable with a table-rebuild migration and teach the time reports to group "Internal" time. Schema change on real data.

Recommendation: the internal org row, hidden from client-facing lists by a flag. Not started.

**Per-user persistence for filters and board sub-view.** Repo work at port time: extend `useUserPreference` keys `requests.viewMode`, `requests.sortKey`, `requests.activeTab` with `requests.filters`, `requests.boardView`, `requests.savedView`. Not a design task.

---

## Round 2 (2026-09-02, after Liam's review of round 1)

Verdicts: toolbar C for every audience; AI draft under the "..." menu; four peer views List / Kanban / Workload / Timeline with icons; kanban back to a horizontally scrolling section (fixed columns, no scrollbars inside columns); card people as a stacked avatar row with hover and focus tooltips; timeline mirrors the repo BoardTimeline (legend, Today jump, auto-centre, milestone diamonds, overdue red); detail page: clickable delivery spine, inline-editable rail fields, composer focus ring moved outside the box.

- [x] r2-toolbar (opus): `requests-toolbar.jsx`, `requests.jsx`, `requests-toolbar.css`. Verified.
- [x] r2-board (opus): `requests-board.jsx`, `requests-board.css`, exports `TimelineView`. Verified.
- [x] r2-detail (opus): `requests-detail.jsx`, new `requests-detail.css` injected from the JSX (HTML pages frozen). Verified.

Open for Liam: kanban vertical scroll inside the board vs the page; timeline re-centres on filter change; Checklist card shown on every request.

---

## Round 3 (2026-09-02, after Liam's review of round 2)

Verdicts: visible grabbable kanban scrollbar; subtask preview on kanban cards; list rows expand down to sub-requests; site-wide focus ring; rail filters as selects; constant header width; detail page completeness audit; pause icon.

- [x] r3-board (opus): proxy scrollbar (`.req-boardbar*`, renamed after a `.req-rail` collision with the detail rail), card subtask preview, `SUBS` seeds appended to `requests-data.jsx`. Verified.
- [x] r3-list (sonnet): expand-down rows, Expand all, mobile expand. Verified.
- [x] r3-toolbar (opus): select controls in the rail, menus portalled to `.ash` (token host), constant header. Verified.
- [x] r3-detail (opus): capability audit vs live page, header actions menu, Delivery phase, Discovery calls, Internal toggle, revisions, composer attach/mention, empty states, client approve pair, mobile stacking, pause icon. Verified.
- [x] r3-kit (sonnet): `requests-focus.css` injected from `requests-kit.jsx`. Verified on quick-add.

Lesson: prototype CSS is one global namespace; slices must prefix new classes (`req-boardbar`, `rqt-`, `rqd-`) and never reuse names from `requests.css`.
Open nit: client "Request changes" button wraps to two lines.
