# Design parity inventory: what the repo has that the prototype lacks

Date: 2026-09-03
Direction: repo to prototype. The four `2026-09-03-requests-audit-*.md` files cover the opposite
direction (prototype features the repo lacks). This file is the work list for design agents so the
Claude Design prototype reaches the same place the repo is on the app shell and the Requests surface.

Roots:

- Repo: `C:\Users\Work\Projects\tahi-dashboard`
- Prototype: `C:\Users\Work\Projects\tahi-dashboard\.claude\design-drafts\requests-final`

Paths in the table are relative to those two roots.

## Summary

The prototype is closer to parity than expected. Already present and not listed below: the filter
rail, saved views, sort, active chips, save as my default, the mobile filter sheet, the list bulk
bar with shift select and expand rows, kanban quick add and the proxy scrollbar, the whole timeline
view, the capacity strip, the delivery spine, the revision popover, the header actions menu (nest,
make top level, duplicate, archive, delete), the people card, the checklist card, the client review
bar, queue placement and the queue position confirmation, the impersonation banner, the announcement
bar, the mobile tab bar and more sheet, and the time tracker in the top bar.

Genuine gaps cluster in three places: the AI weaves, the calls card, and the intake plus branding
plumbing behind the dialog.

Two areas produced no rows. **Timeline**: `requests-board.jsx:303` matches or leads the repo
(legend, Today jump, milestone diamonds, keyboard rows, week gridlines). **Workload**: the plan's
Slice C items W1 to W3 are repo changes taken from the prototype, so the prototype leads there too.
See Open questions for the workload source file problem.

Priority key. P1: user facing feature the founder uses daily or that the lead named explicitly.
P2: visible feature. P3: nice to mirror.

## Inventory

| ID | Area | Repo feature | Prototype status | Suggested prototype treatment | Pri |
|---|---|---|---|---|---|
| S1 | Shell | AI daily briefing popover in the top bar: cached brief, Urgent today / This week / While you slept, per row tone dot and destination, unread dot, Refresh (`components/tahi/briefing-trigger.tsx`) | Absent. `app-shell.jsx:290` TopBar carries search, tracker, bell and currency only | Add a sparkle button between the tracker and the bell in `app-shell.jsx` TopBar, opening a Popover shaped like the notification one: three labelled row groups, a tone dot per row, a Refresh action in the footer, and an unread dot on the trigger | P1 |
| S2 | Shell | Command palette searches live entities across 13 types (requests, tasks, clients, brands, contacts, deals, invoices, contracts, proposals, schedules, docs, calls, services) with a Suggestions group and a loading row (`components/tahi/search-palette.tsx`) | Partial. `app-shell.jsx:334` CommandPalette indexes pages, clients, settings and actions from a static array | Extend `buildIndex` in `app-shell.jsx` with Requests, Tasks, Deals, Invoices and Docs groups sourced from `requests-data.jsx`, add a Suggestions group label above results, and a spinner row while a query is in flight | P2 |
| S3 | Shell | Notification bell reads real notifications over an SSE stream, marks all read, and deep links per entity type (`components/tahi/notification-bell.tsx`, `lib/notification-links.ts`) | Partial. `app-shell.jsx:657` renders a fixed four row list; Mark all as read is inert | Wire the mark all button to clear the unread dots in local state and drop the count to zero, so the affordance reads as real rather than decorative | P3 |
| S4 | Shell | Client portal brand tint: per org portal name, logo and primary colour override the rail wordmark and the brand CSS variables for client sessions only (`app/(dashboard)/layout.tsx`, `components/tahi/app-sidebar.tsx`) | Absent | Add a Tweaks toggle "Client branding" that, in the client audience, swaps the rail wordmark for a logo tile plus name and overrides `--brand` and `--brand-strong` on `.ash` | P2 |
| S5 | Shell | Permission resolved navigation: features hidden per subject, workspace module toggles, super admin bypass (`lib/permissions.ts` resolved in the dashboard layout) | Partial. A `PENDING` set and a `denied` forbidden page exist, but every nav item always renders | Drive `navFor` from a feature map so a denied item is absent from the rail rather than a 403 on click. This is the visible equals permitted invariant the founder stated | P2 |
| S6 | Shell | Global keyboard shortcuts: N for new request, C for new client, / to focus search, suppressed while typing (`components/tahi/keyboard-shortcuts.tsx`) | Absent. Only Cmd+K is bound, in the App effect | Extend the existing App key handler with N, C and /, guarded on input, textarea, select and contentEditable. Add a hint line in the palette footer | P3 |
| S7 | Shell | Product tour: targeted spotlight steps for admin and client on first visit (`components/tahi/product-tour.tsx`) | Absent | Optional. A single spotlight component driven by a `data-tour` attribute, plus a Tweaks toggle to replay it | P3 |
| S8 | Shell | Skip to content link before the shell (`components/tahi/skip-to-content.tsx`) | Absent | Add a visually hidden anchor as the first child of `shell` in `app-shell.jsx`, revealed on focus, targeting the page region | P3 |
| S9 | Shell | Timer chip persists an active timer across reloads, supports resume and editing an entry, and targets a real request or task (`components/tahi/timer-chip.tsx`) | Partial. `app-shell.jsx:71` TimeTracker is category, search, start, pause, stop, all in memory | Add an Edit action to the running readout that opens a small elapsed field. No persistence needed in a prototype, but the control should exist so the repo has something to match | P3 |
| L1 | List | Bulk create: a real multi row dialog that creates requests across clients in one submit (`app/(dashboard)/requests/request-list.tsx:1896`) | Partial. `requests-toolbar.jsx:461` menu item calls `onNew`, which opens the single request dialog | Give the menu item its own dialog: a client column, repeatable title rows with a category picker each, add row and remove row controls, one Create for all with a count in the button | P2 |
| L2 | List | Export CSV downloads from an admin only route, hidden for client audiences | Partial. `requests-toolbar.jsx:459` raises a toast | Keep the toast, but name the row count in it so the affordance reads as a real export | P3 |
| L3 | List | Client tag filter dimension, options built from each org's free form tags, inserted only when tags exist (`request-list.tsx` filterDefs) | Absent. `DIMS` in `requests-toolbar.jsx` has status, category, client, type and created | Add a sixth dimension "Client tag" to `DIMS`, staff audiences only, with three or four fixture tags in `requests-data.jsx` | P3 |
| L4 | List | Created filter is a true from and to date range picker | Partial. Preset buckets only (Any time, 7, 30, 90 days) | Keep the buckets and append a "Custom range" row that reveals two date inputs inside the same menu | P3 |
| L5 | List | View, filter and sort preferences persist per user server side, so they follow the founder across devices (`lib/use-user-preference.ts`) | Partial. `readLS` and `writeDefault` use localStorage | No visual change. Add a comment above `writeDefault` naming the server backed model so nobody designs a second one | P3 |
| L6 | List | An Archived destination: bulk archive moves requests out of the pipeline and the list can show them again | Partial. Bulk archive exists in `requests-listview.jsx:129`, but no saved view surfaces archived work | Add an "Archived" entry to `SAVED_VIEWS` in `requests-toolbar.jsx`, last in the list, so archived requests have somewhere to be found | P3 |
| L7 | List | Add sub request from an expanded row opens the full dialog with the parent and its client locked (`request-list.tsx` subRequestParent) | Partial. `requests-listview.jsx:153` shows an Add sub-request button that raises a "coming soon" toast | Point that button at the dialog in sub request mode (see G3) so the two entry points agree | P3 |
| K1 | Kanban | Per client custom columns: label, status value, colour and position, configured in settings (`app/api/admin/kanban-columns`, `components/tahi/settings/sections/kanban.tsx`) | Absent. `requests-board.jsx:158` BoardView iterates the hardcoded `D.PIPELINE` | Give `BoardView` a `columns` prop defaulting to the pipeline, and add a Tweaks preset that renders a client with renamed and recoloured columns so the design is proven | P2 |
| K2 | Kanban | Drag a card onto another card to nest it, confirmed through a dialog, same client only (`request-list.tsx` handleBoardNest) | Absent. `drop(status)` handles column drops only | Add a card over card drop target with a brand ring and a "Nest under" label, firing the existing `Confirm` component with the nest copy already written in the repo | P2 |
| K3 | Kanban | Column overflow actions via `columnActions` on the kanban primitive (`components/tahi/kanban-board.tsx`) | Absent. `req-col-head` carries a dot, label, count and add button | Add a dots button at the right of the column header opening a two item menu (Rename, Set colour), inert but present | P3 |
| D1 | Detail | AI triage banner, admin only: suggested assignee, priority and track, each with its own Apply chip, a one line reason, dismissible, never mutates on its own (`app/(dashboard)/requests/[id]/request-detail.tsx:1227`) | Absent | New dismissible bordered card between the header and the delivery spine in `requests-detail.jsx`, brand tinted, with a sparkle icon, one reason line, and inline chips reading "Assignee: Maya" plus an Apply link | P1 |
| D2 | Detail | AI draft reply above the composer: generates a pending draft into an editable textarea, then Post to thread, Regenerate and Dismiss. The AI never posts (`request-detail.tsx:1386`) | Absent | Add an "AI: draft reply" button above `Composer` in `requests-detail.jsx`. On click swap in a brand bordered block with a Pending badge, a textarea seeded from a fixture, and the three actions | P1 |
| D3 | Detail | Discovery calls lifecycle: inline schedule form with date, time, duration and meeting URL; each past call expands to transcript, summary, outcome, scope, budget and timeline; an AI Extract button fills those from the transcript; create a task from a call (`components/tahi/discovery-calls.tsx`) | Partial. `requests-detail.jsx:578` CallsCard lists canned calls and one Schedule call button that appends a fixed row | Expand CallsCard into three states: a collapsed list, an inline schedule form (title, date, time, duration, meeting URL), and an expandable past call row holding a transcript textarea, an Extract button and an outcome badge | P1 |
| D4 | Detail | Tasks spawned from this request, admin only, mirroring the sub requests panel, with the AI task wizard linking new tasks back (`request-detail.tsx:2770` RequestTasksPanel) | Absent | New `Block` under Sub-requests titled Tasks with the same row shape (number, title, status badge, assignee) and a header action reading "AI: break into tasks" | P2 |
| D5 | Detail | Files really upload, download and delete against R2, with drag and drop onto the panel and per row actions (`request-detail.tsx:3214` FilesPanel, `FileActions`) | Partial. `requests-detail.jsx` attaches canned rows from `ATTACH_POOL`; rows open the proof viewer or toast | Add a drop zone state to the Files block and per row Download and Delete buttons with a delete confirm. Keep the proof viewer, which the repo does not have and which is deferred by plan decision 8 | P2 |
| D6 | Detail | The checklist renders for clients too, read only, with editing gated on admin (`request-detail.tsx:1806`, `ChecklistsPanel` takes `isAdmin`) | Partial. `requests-detail.jsx` gates ChecklistCard behind `team` so clients never see it | Render ChecklistCard for the client audience with checkboxes disabled, the add row hidden, and the progress bar intact | P3 |
| D7 | Detail | Composer has a formatting toolbar (bold, italic, bullet list, ordered list, code, link) plus Cmd or Ctrl and Enter to send (`components/tahi/message-composer.tsx`) | Partial. `requests-detail.jsx:365` Composer has mentions, attach, internal toggle and send | Add a toolbar row above the composer textarea with the six formatting buttons and a keyboard hint next to Send | P3 |
| G1 | Dialog | Intake form questions resolve per category and per client and render in the form, portal side (`app/api/portal/request-forms`, `new-request-dialog.tsx` intakeQuestions) | Absent | Add a questions block directly below the brief for the client audience, driven by a small per category fixture in `requests-data.jsx`, supporting text, textarea, url, select and checkbox question types | P2 |
| G2 | Dialog | Brand picker: an optional brand select under Client, shown only when the chosen client has brands (`new-request-dialog.tsx` brandOptions) | Absent | Compact select immediately under the Client field, rendered only when the fixture client has a brands array. Plan decision 4 already calls for this shape | P2 |
| G3 | Dialog | Sub request mode: parent locked, client locked to the parent's org, client picker hidden, explanatory notice at the top (`new-request-dialog.tsx` parentRequestId and forceOrgId) | Absent | Add an `initialView` variant to `Dialog` in `requests-dialog.jsx` that shows the locked parent notice, hides the client picker, and titles itself New sub-request | P2 |
| G4 | Dialog | Save and create another: creates, shows a success line, then returns to an emptied form with the client retained (`new-request-dialog.tsx` createAnother) | Absent. The confirmation screen offers Done only | Add a secondary button beside Create request in the footer, and a success line above the emptied form on return | P3 |
| G5 | Dialog | Start date and estimated hours for the team audience | Absent | Put both inside the collapsed "More details" disclosure that plan decision 4 already specifies for the team audience | P3 |
| A1 | AI | The request wizard is model backed and can return several drafts at once, each with category, type, priority and estimated hours, all created in one submit (`components/tahi/ai-request-wizard.tsx`) | Partial. `requests-dialog.jsx:84` AiAssist is a scripted per category interview producing one draft. Hand back to the form is already the primary action, which matches plan decision 4 | After the final answer, render a list of two or three draft cards with category and size chips, each removable and editable in place, plus a "Create all" action beside the existing hand back | P2 |
| Pt1 | Portal | Sub requests are visible to clients: the portal has its own sub requests route and the panel renders for both audiences (`app/api/portal/requests/[id]/sub-requests`, `SubRequestsPanel` with `alwaysShow={isAdmin}`) | Absent. `requests-detail.jsx` gates the SubRequests block behind `team`, so a client never sees the breakdown of their own request | Render the SubRequests block for the client audience when the request has children, read only, with the Add action hidden | P2 |

Counts: P1 4, P2 13, P3 16. Total 33.

## Do not mirror

- **Impersonation and private mode plumbing** (`components/tahi/impersonation-banner.tsx`,
  `private-mode-context.tsx`). The prototype already fakes both at the shell level through Tweaks,
  which is all a design surface needs.
- **The SSE notification stream** (`app/api/notifications/stream`). Transport detail with no visual
  surface beyond the bell, which S3 already covers.
- **Team login backfill, onboarding gate and permission resolution in the layout**
  (`lib/team-link-server.ts`, the Clerk onboarding check). Server only, nothing renders.
- **The legacy non rail path in `request-list.tsx`.** The gate flip in plan decision 9 deletes it,
  so mirroring it would design a surface that is on its way out.
- **The local stdio MCP server** (`mcp-server/index.ts`). Dormant by decision, worker only.
- **Portal capacity queue reorder** (`app/api/portal/capacity/reorder`). The route exists but only
  the admin tracks page consumes it, so it is not part of the Requests surface today.
- **The proof viewer with pinned comments.** This runs the other way: the prototype has it, the repo
  does not, and plan decision 8 defers it. It should stay in the prototype untouched, not be treated
  as drift.

## Open questions

1. **The recovered prototype set is incomplete and the HTML is a round stale.**
   `Tahi App Shell.html` loads `requests-workload.jsx`, `overview-kit.jsx`, `overview.css` and
   `settings.css`, none of which are on disk. It does not link `requests-detail.css` or
   `requests-focus.css`, which are. The workload view therefore exists in the prototype but its
   source was not recovered, and no design agent can edit it until someone re-exports. This is why
   the Workload area produced no rows.
2. **`requests-list.jsx` in the round 1 folder is a load order hazard.** It assigns
   `window.TahiReqList = { ... }` wholesale at line 336, while every final round file uses
   `Object.assign`. If it ever loads after the split files it wipes `Toolbar`, `ListView`,
   `BoardView` and `CapacityStrip`. Worth deleting or renaming before agents start editing.
3. **Does the founder want intake questions in the prototype at all?** G1 is portal side and only
   visible to a client audience with a form configured. If the answer is no, G1 and the client half
   of the dialog work drop out.
4. **Custom kanban columns (K1) need a fixture decision.** Per client column overrides only read as
   real if the prototype ships a second client whose board looks different. Someone has to pick that
   client and its column set.
