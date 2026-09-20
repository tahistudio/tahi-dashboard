# Requests LIST surface: repo vs Claude Design prototype

Date: 2026-09-03
Scope: the Requests list surface only (rail, view switcher, list table, expanded sub-requests, bulk bar, header, mobile). The gated new UI path is `railOn` in `request-list.tsx`. The legacy path was out of scope and was not audited.
Method: read every prototype file in full first, then the repo files, then compared behaviour, structure and styling.
Result: 13 findings. Both defects Liam reported are confirmed (A1, A2). Four further prototype behaviours were lost in the port (A3, A4, A5, A7), plus one mobile gap (A6).

## Sources compared

Prototype (final round, recovered to disk under `.claude/design-drafts/requests-final/`):

- `requests-toolbar.jsx` and `requests-toolbar.css` (rail, saved views, filters, sort, view switcher, header actions, mobile sheet)
- `requests-listview.jsx` and `requests-listview.css` (table, expand-down sub-requests, bulk bar, mobile cards)
- `requests.jsx` (page composition, header)
- `requests.css` (round 1 monolith, shared classes including `.req-seg` and `.req-seg-pill`)
- `requests-focus.css` (focus ring pattern)
- `requests-kit.jsx` (shared chips, avatars, icons)

Repo:

- `app/(dashboard)/requests/request-list.tsx`
- `components/tahi/requests/requests-rail.tsx`
- `components/tahi/requests/requests-rail-layout.tsx`
- `components/tahi/requests/requests-view-switcher.tsx`
- `components/tahi/requests/requests-header-actions.tsx`
- `components/tahi/requests/sub-request-rows.tsx`
- `components/tahi/data-table.tsx`
- `components/tahi/bulk-action-bar.tsx`
- `lib/requests-views.ts`
- `components/tahi/settings/primitives.tsx` and `app/(dashboard)/settings/settings.css` (existing sliding segmented control)
- `components/tahi/timer-chip.tsx` and `app/(dashboard)/app-shell.css` (second existing sliding segmented control)

Severity key. P0 = reported by Liam. P1 = prototype behaviour lost or wrong. P2 = polish.

## Findings

| ID | Sev | Prototype ref | Repo ref | What differs | Proposed fix |
|---|---|---|---|---|---|
| A1 | P0 | `requests-toolbar.jsx:174-184`, `requests.css:27-34` | `requests-view-switcher.tsx:40-102` | No sliding pill. The prototype absolutely positions `.req-seg-pill`, measures the active tab with `useLayoutEffect`, and glides it on `transform` and `width` over 360ms with a `prefers-reduced-motion` opt-out. The repo just flips each button's `background`. Also lost: the active tab's icon tinting to brand (`requests.css:33`). | The repo already ships this exact pattern three times: `SlideSeg` (`components/tahi/settings/primitives.tsx:362`, which already supports `role="tablist"`, `optRole="tab"`, an icon slot and a brand active icon), `.segx` and `.segx-ind` (`settings.css:257-264`, including the reduced-motion rule), and `.tt-seg` (`app-shell.css:499`). Extract `components/tahi/segmented-control.tsx` from `SlideSeg`, move the `.segx*` rules from `settings.css` into `globals.css` so the class is available off the settings bundle, re-export from settings for compatibility, and rebuild the switcher on it. Keep the existing roving tabindex and arrow, Home and End keys. Remeasure on value change, tab count and window `resize`, so the icon-only mode below `lg` repositions correctly at the breakpoint. `.tt-seg` cannot be reused directly: its `width: calc((100% - 6px) / 3)` hardcodes three equal-width tabs, and the switcher has four of unequal width. |
| A2 | P0 | `requests-listview.jsx:131`, `:133-147` | `sub-request-rows.tsx:46-47` | The prototype's sub-rows reuse the parent's exact grid template string (`const cols`), so a child's status, assignee and done word sit directly under Status, Priority and Due. The repo builds an independent grid (`TEAM_COLUMNS = 'minmax(0, 1fr) 9rem 10rem 4rem'`) inside a full-width `colSpan` cell, so nothing lines up with the table above it. This is the main reason the panel reads as weaker than the prototype. | Add an `expandedRowMode: 'rows'` option to `DataTable` that lets `renderExpanded` return `<tr>` elements rendered into the same `<tbody>` instead of wrapping them in a `colSpan` cell. The browser's own column algorithm then aligns children to parents for free, at every width, with no duplicated width constants. Style the run of child rows with `background: var(--color-bg-secondary)` and a `1px solid var(--color-border-subtle)` hairline on all four sides of the group, keeping the existing `tahi-row-expand` animation. Add a row hover of `var(--color-bg-tertiary)`, which the panel currently lacks entirely. |
| A3 | P1 | `requests-listview.jsx:40-47` (`nextSortDir`) | `data-table.tsx:270-280` | Header sort cycles ascending to descending forever. The prototype's third click clears the column sort and hands ordering back to the page. In the repo, one header click permanently overrides the rail's Sort control until a reload, so the rail's Sort select becomes a dead input with no visible reason. | Return `null` on the third click and call `onSortChange?.(null)` when sort is controlled. Widen `DataTableSort` to nullable. Set `aria-sort="none"` on the cleared column. |
| A4 | P1 | `requests-listview.jsx:104-113` (`toggleRow` with `lastIndexRef`) | `data-table.tsx:1051-1069` (`SelectCheckbox`) | Shift-click range selection is gone. `SelectCheckbox`'s `onChange: () => void` carries no event, so no modifier key is reachable from the call site. Selecting twenty rows for a bulk status move is now twenty clicks. | Widen to `onChange: (e: React.MouseEvent) => void`, hold a `lastToggledIndex` ref in `DataTable`, select or deselect the inclusive span on shift, clear the browser text selection with `window.getSelection()?.removeAllRanges()`, and set `userSelect: 'none'` on selectable rows to match `requests-listview.css` `.req-tr.req-row`. |
| A5 | P1 | `requests-listview.jsx:264-269` (`EmptyState`) | `request-list.tsx:2238-2253` | One empty state serves two different situations. With 200 requests loaded and a filter hiding all of them, the page still reads "No requests found" and "Requests will appear here once clients start submitting work", and offers no way back. The prototype's list empty was specifically the filtered case: "No requests match" and "Try clearing a filter or the search." | When `requests.length > 0 && visible.length === 0`, render "No requests match" with "Try clearing a filter or the search" and a secondary Clear filters button calling the same reset the rail's `onClearAll` uses. Keep the current copy for the genuine zero-data case. |
| A6 | P1 | `requests-listview.jsx:234-262` (`MobileCard`), `requests-listview.css` `.req-mc-*` and `.rq-expand-btn-mobile` | `data-table.tsx:380` (`h-scroll` only) | No mobile card layout. The prototype swaps to a card list based on container width via `ResizeObserver`, not just viewport, and each card carries a 2.75rem expand button plus a coloured dot list of children. The repo horizontally scrolls a six-column table at 375px, which contradicts the 375px requirement in `CLAUDE.md`. | Add `mobileCard?: (row: Row) => React.ReactNode` to `DataTable`, rendered instead of the table below `md`. Give Requests a card of number plus status badge on the top line, then the title, then client avatar, category and due, with a 2.75rem chevron and the child dot list. This is a `DataTable`-wide change, so see open question 2. |
| A7 | P1 | `requests.jsx:104-107` (the three audience `sub` sentences) | `request-list.tsx:1197-1199` and `requests-rail-layout.tsx:405` | The audience sentence in the page subtitle is gone, replaced by the request count, which the rail row then prints again a few rem below. Two counts, no orientation sentence. The prototype's three sentences were "Every request across your clients: submit, triage, and deliver." for admin, "Your clients' requests: what's yours and what's queued." for a teammate, and "Everything you've asked us for, and where each piece stands." for a client. | Restore the three audience sentences as the `PageHeader` subtitle and leave the count to the rail row, which already carries `aria-live="polite"`. |
| A8 | P2 | `requests-toolbar.jsx:394` | `request-list.tsx:1369` (`onClearAll`) | The mobile sheet's "Clear all" resets filters and saved view but not sort. The prototype also resets sort to its default. | Add `rail.setSort({ ...DEFAULT_REQUEST_SORT })` to `onClearAll`. |
| A9 | P2 | `requests-toolbar.jsx:411-415`, `requests-toolbar.css:139-150` | `requests-rail-layout.tsx:420-440` | Mobile uses a side `SlideOver` rather than the prototype's bottom sheet, and Save as default exists only inside it, so a phone user cannot save their view without opening the filter sheet first. The prototype kept count, chips and Save as default on a summary row outside the sheet. | Keep `SlideOver`, which is the sanctioned repo primitive, and do not rebuild a bottom sheet. Surface `SaveDefaultControl` in the chips row below `lg` so the affordance is reachable without opening the sheet. |
| A10 | P2 | `requests-listview.jsx:171` and `:176`, plus the urgent zap in the title cell | `request-list.tsx:957` and `:1067` | Three small drifts in the table header and title cell. The header reads "Title" where the prototype reads "Request". "Updated" is left-aligned where the prototype right-aligns it (`align: 'right'`). The leading zap icon for urgent priority is gone; only the scope-flag `AlertTriangle` survived. | Rename the header to Request, add `align: 'right'` to the `updatedAt` column, and put a `Zap` before the number when priority is urgent. The zap is optional given the repo also renders a dedicated Priority column, which the prototype did too. |
| A11 | P2 | `requests-listview.css` `.rq-checkbox` (32px target around an 18px box) | `data-table.tsx:1064-1078` | The select checkbox button is 1.125rem with no larger tap area, well under the 44px minimum in `CLAUDE.md`. The prototype wrapped its 18px visual in a 32px target with a negative margin. | Keep the 1.125rem visual and add padding plus a matching negative margin to reach 2.75rem below `md`. |
| A12 | P2 | none, repo gap | `request-list.tsx:409` | SWR `error` is never destructured on the main list fetch, so a failed request renders the empty state and reads as "you have no requests" rather than "this did not load". | Destructure `error` from the `useSWR` call and render a small retry panel above the table when it is set. Note that `SubRequestRows` already does this correctly at `sub-request-rows.tsx:93-94`, so the pattern exists. |
| A13 | P2 | none, repo gap | `request-list.tsx:398-400` vs `app/api/admin/requests/route.ts:26-27` | The comment claims "the admin GET silently caps at 50 rows (server-side limit; the page param is unused here)". That is not true: the route honours `limit` up to 500, and the rail already asks for 500. The real constraint is a hard ceiling of 500 with no pagination, past which saved-view counts silently under-report. The portal route behaves identically (`app/api/portal/requests/route.ts:26-27`). | Correct the comment and record the 500 ceiling where `railCounts` is built, so the next person reading it knows the counts are exact only below 500 rows. |

## Nothing lost

Confirmed present and faithful to the prototype, one line each.

- Saved view keys and labels match exactly for both team and client sets (`lib/requests-views.ts:118-133` against `requests-toolbar.jsx:142-155`).
- Counts run over all loaded rows rather than the filtered set, so the rail keeps reporting the backlog behind each view while you are inside one (`request-list.tsx:435-438`).
- Every filter dimension, its default value, the admin-only client picker, the searchable client menu, the per-control clear button and the brand border when a filter is set (`requests-rail.tsx`).
- The sort control plus its direction toggle, using the prototype's exact direction wording (Soonest first, Newest first, Highest first, A to Z).
- Save as default and the "Your default" resting state on the same snapshot shape, and the repo persists to real per-user preferences with a one-time migration off the pre-rail keys rather than raw localStorage.
- Clear filters in the rail foot, shown only when a filter is active.
- The page header's single primary New request plus a "..." overflow holding AI draft, Export CSV and Bulk create, with the same divider placement (`requests-header-actions.tsx`).
- Expand all and Collapse all beside the header checkbox, the 1.5rem chevron, the gutter spacer on rows that cannot expand, the panel hairline on all four sides with `margin-top: -1rem/16` to sit on the parent rule, and the expand animation (`data-table.tsx:399-417` and `:838-855`).
- Open panels are pruned down to the rows still on screen whenever a filter, saved view, search or sort changes the set (`request-list.tsx:521-526`).
- The bulk bar is a superset of the prototype: Mark delivered as the primary, an Edit menu with Status and Assign sections and a Danger Archive behind a confirm, plus three assign roles, toasts and partial-failure counts the prototype did not have.
- The Add sub-request row, team only, opening the full dialog with parent and client locked (`request-list.tsx:1229-1245`).
- The admin and portal split for the panel fetch, with `is_internal` filtered consistently between the count and the rows, so a client can never see an expandable row whose panel then comes back empty (`app/api/portal/requests/route.ts:85-91` against `app/api/portal/requests/[id]/sub-requests/route.ts:68-71`).
- The `Popover` used by the rail's filter menus flips above the trigger and repositions on scroll, which is better than the prototype, whose portaled menu simply closed on any scroll.
- The panel entrance animation is covered by the global `prefers-reduced-motion` block at `globals.css:1556`, matching the prototype's per-animation opt-outs.

Repo additions the prototype never had, worth keeping: loading and error states inside the sub-request panel, an `aria-live` count, roving tabindex with arrow, Home and End on the view switcher, the sort hint sentence under the direction toggle, real preference persistence with legacy migration, and `--radius` and colour tokens throughout rather than the prototype's raw pixel values.

## Open questions for the lead

1. Should the segmented control be extracted repo-wide, which also lets `SlideSeg` in settings, `.tt-seg` in the timer chip and the board's sub-view strip converge on one primitive, or do you want a local pill built inside `RequestsViewSwitcher` only? Extraction means moving `.segx*` out of `settings.css` into `globals.css`, which touches settings and team access.
2. Is a mobile card mode on `DataTable` (A6) in scope for this pass, or does the requests list keep horizontal scroll at 375px for now? This affects every list page in the app, not just Requests.
3. For A2, is changing `DataTable` to emit real `<tr>` children acceptable, or would you rather approximate alignment by passing the parent column widths down into the panel? The `<tr>` route is correct and self-maintaining; the width-map route is smaller but will drift the moment a column width changes.
