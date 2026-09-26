# Port plan: ops (Time, Team, Capacity, Tracks, Permissions)

Status: plan only, nothing built. Written 2026-09-26 for Liam's instruction "build the designs in the app following the UI/UX patterns used elsewhere; ships as ported, unchecked". Existing primitives and patterns win where the prototype differs. Docs Hub is locked and untouched by this plan.

## Sources read

- Review doc: docs/superpowers/plans/2026-09-14-design-review-for-liam.md, section "ops" (51 page keys, final critic verdict SHIP, first pass FIX; the two measured FIX items were both in permissions.css and are resolved in the fifth pass, so there are no still-open critic FIX items for this module).
- Requirements: docs/superpowers/design/requirements/studio-ops-team.md (capacity, team, permissions, tracks), studio-finance.md (the /time sections), client-tracks-schedule.md (the client tracks viewer), and DESIGN-BRIEF-2026-09-13.md.
- Design files (read through the claude-design MCP, project 57bf60cf-5e6d-450f-9e2f-e25c8d12fd66): previews/ops-preview.html (page key table), ops.jsx (Time), ops-team.jsx (Team, Capacity), ops-tracks.jsx (studio Tracks board and client TracksClient), permissions.jsx (TeamAccessPane), ops-kit.jsx (GridCell, EntryRow, ExportRow, LoadRow, Outlook, ScopeEditor, Drawer, Confirm, Note, RoStrip), ops-data.jsx (fixture shapes, ACCESS_ROLE, NOT_ENFORCED, SEAT), ops-fixes.css header and TIME/TEAM sections, permissions.css header and state rules. ops.css was not read line by line; the fix sheet documents every geometry the critic measured.
- Live code: app/(dashboard)/{time,team,capacity,tracks,permissions}, components/tahi/settings/team-access/*, components/tahi/org-chart.tsx, components/tahi/rail/*, kpi-strip.tsx, data-table.tsx, data-state.tsx, callout.tsx, permissions-context.tsx, and the API routes these pages call (admin/time, admin/time/[id], admin/billing/xero-export, admin/capacity/*, admin/team*, admin/team-members, admin/permissions/*, admin/clients).

## Routes and audience

Studio only. /time, /team, /capacity, /tracks, /permissions (the permissions pane also renders inside Settings > Team & access). Every page.tsx already redirects clients and Client-view previews server side; nothing in this plan changes a guard.

## Facts from the code that change what the design can honestly say

1. The client scope on /team is enforced. lib/access-scoping.ts resolveAccessScoping reads teamMemberAccess (scopeType, planType, orgIds) for every non-admin team member, so the design's line "Saved on the older team access record. Only the account role below is read by anything today" is wrong about the scope. What is true: the scope decides which clients' data a person can reach; pages are gated by the permission role plus feature overrides in the permission panel.
2. /team's Access slide-over and /permissions' Data scope write the same record through the same route (PUT /api/admin/team/[id]/access, gated on the settings.permissions feature). The permission pane sends role = the member's permission role name, so a scope save there overwrites the access role picked on /team. The "two systems" are one scope record with two editors plus a second role axis.
3. Access role on teamMemberAccess: project_manager is read (notify-request-team, onboarding lead, org channel, default PM). task_handler and viewer are read by nothing. trackType is only read by the client-side View as simulation (impersonation-banner), never by the server.
4. teamMembers.role (Admin or Member on /team) is not a permission grant once roles are seeded (access-scoping.ts says so). The design's "Workspace seat: reaches settings, billing, the team roster and the permission panel" would be false.
5. /api/admin/time/[id] has DELETE only; there is no PATCH anywhere for a time entry. GET /api/admin/time pages at 50 rows and does not return source, startedAt, endedAt, invoiceId or invoicedAt. The CSV export already honours orgId, teamMemberId, dateFrom, dateTo.
6. POST /api/admin/billing/xero-export exists (dry run by default, month YYYY-MM, feature gate billing, per-client refusals with reasons, idempotent via invoice_id). Nothing in the dashboard calls it; the MCP does. It has no per-client selection.
7. /api/admin/team-members returns no weeklyCapacityHours, so the live Capacity per-person list shows 40h for everybody (the fallback). The start-date total uses weeklyCapacityHours with the same 40h fallback.
8. There is no studio default hourly rate setting; a rate comes from the entry, then organisations.defaultHourlyRate (PATCH /api/admin/clients/[id] writes it), else the export refuses the client.
9. There is no per-person commitment, leave record or cross-client track endpoint.

## Page key by page key: what matches and what differs

### Time (ops.jsx Time)

- time (week grid): not live. Live /time is a DataTable of entries plus three SummaryCards, a FeatureCard, a bar chart and a donut, a bespoke h1 header, a FilterBar and a DateRangePicker. Port: PageHeader, KPIStrip (Logged this week, Billable, Unpriced, Worth), rate warning Callout, RailLayout with a Week grid / Entries / Rates switcher, a per-client week grid that scrolls inside its own card.
- time-entries: live has the entries table; differs in grouping, source label (Tracked or Typed in), value per row, no-rate marker, and no Edit action (live row actions are Open request and Delete only).
- time-rates: not live anywhere on /time. Per-client rates exist only on the client detail page.
- time-day (one day drawer): not live.
- time-log: live LogTimeSlideOver matches in purpose. Differs: request picker is unscoped live (design scopes it to the chosen client), no duration or start and end toggle, no live value readout, billable is a bare checkbox.
- time-edit: not live (no PATCH route).
- time-xero: not live on this page (route exists, no UI).
- time-delete: live ConfirmDialog matches; copy differs.
- time-nomatch: live has "No matches"; matches in intent.
- time-loading: live has DataTable skeleton; the KPI row renders zeros while loading.
- time-empty: live has "No time entries yet" with Log time; matches in intent.
- time-error: live has plain centred text plus Retry (the pattern the brief calls inconsistent); differs.

### Team (ops-team.jsx Team)

- team: live PageHeader, KPIStrip, DataTable, FilterBar, self-link banner, no-login banner, Linked or Not linked column, skills capped at two, row actions Edit, Send login invite, Manage access, View as, Remove. Differs: design adds a per-person "Can see" line, a No access yet count, a Feature permissions link, a rail, a legend explaining the two meanings of access, and drops the donut and the FeatureCard.
- team-chart: live OrgChart (tree, departments, planned roles, Add planned role). Differs: member click is a dead control live (pushes ?member= that nothing reads); design opens the person's record.
- team-access: live AccessPanel (role, scope, plan, specific clients, track type, all as native selects). Differs: plain words scope editor, "Right now" sentence, not enforced markers, honest note that pages are gated elsewhere.
- team-edit, team-invite, team-remove: live Edit, Add member (with invite checkbox) and Remove confirm match in function; copy and layout differ.
- team-nomatch, team-empty: live has both through the DataTable empty slot.
- team-loading: live DataTable skeleton; KPI strip hidden while loading.
- team-error: not live. A failed /api/admin/team read renders "No team members yet" (false empty).

### Capacity (ops-team.jsx Capacity)

- capacity: live PageHeader, KPIStrip, utilisation bar, pipeline impact grid, monthly table, Recharts 8-week line chart (flat), per-member bars (all 40h, see fact 7), Sales Call Helper. Design: person-by-person load rows, 8-week column outlook with a ceiling line, "Can we take this on", "What the pipeline would add" deal list, no rail (correct live and in design).
- capacity-answer: live calculator matches in function (same start-date endpoint); answer copy differs.
- capacity-person: not live.
- capacity-loading: live skeleton; matches in intent.
- capacity-empty: not live (a studio with no roster renders zeros).
- capacity-error: live EmptyState with Retry; matches, but a partial failure (start-date fails, others succeed) renders zeros instead of an error.

### Tracks (ops-tracks.jsx)

- tracks-today: this is the live behaviour and it already matches almost exactly (explainer card, Go to clients). Only the title ("Your tracks" is wrong for the studio) and copy differ.
- tracks, tracks-client, tracks-attention, tracks-loading, tracks-empty, tracks-error: the studio-wide board, marked in the design itself as "Proposal, waiting on a decision" (CT.18). Not built.
- portal-tracks, portal-tracks-loading, portal-tracks-empty, portal-tracks-error: the client viewer. No live route serves it (/tracks redirects clients), and the richer client home TrackBoard is Liam question 6. Not built.

### Permissions (permissions.jsx TeamAccessPane)

- permissions, permissions-clients, permissions-roles, permissions-features, permissions-copy, permissions-history: the live pane already matches the structure (three tabs, search, master detail with mobile push, role select, data scope control, feature overrides slide-over with Inherit, Allow, Deny and reasons, parent lock, roles matrix with locked super admin column, change history, copy access, preview as). Live is richer on Clients (contacts nested under each org).
- permissions-nomatch: live shows a bare "No team members match." line with hardcoded 13px type; design has a proper small empty state with Clear the search.
- permissions-loading: live has a list skeleton only; design skeletons list and detail.
- permissions-error: not live. A failed subjects read renders empty lists (false empty); matrix and history have no error branch.
- permissions-empty, permissions-empty-clients, permissions-empty-history: the bespoke fresh-workspace states are Liam question 5; history already has an empty line live.
- Copy dialog "nobody to copy from": not live.
- Super admin "cannot be locked out" strip: live shows a locked note; design restyles it as an honesty strip.
- 44px removes and search clear at hand size (permissions.css fifth pass): not live (settings.css has 2px padded 13px glyphs).

## Slices

Four slices with disjoint owned files. Slice 1 is the only one that touches the MCP worker. All four ship behind the existing page guards, no flags.

### Slice 1: time (3.5 days, backend yes, migration no)

Owned files: app/(dashboard)/time/time-list.tsx, app/(dashboard)/time/page.tsx, components/tahi/time/* (new folder: week-grid.tsx, time-day-list.tsx, time-entry-row.tsx, log-time-slideover.tsx, day-slideover.tsx, xero-export-slideover.tsx, rates-view.tsx, time-rail.tsx), lib/time-week.ts, lib/__tests__/time-week.test.ts, app/api/admin/time/route.ts, app/api/admin/time/[id]/route.ts, app/api/__tests__/admin-time-patch.test.ts, workers/mcp-server/src/index.ts (one new tool only).

Each slice's full build brief is under "Slice briefs" below.

### Slice 2: team (2 days, backend no, migration no)

Owned files: app/(dashboard)/team/team-content.tsx, app/(dashboard)/team/page.tsx, components/tahi/team/* (new folder: member-slideovers.tsx, client-scope-slideover.tsx, team-rail.tsx, person-card.tsx), components/tahi/org-chart.tsx.

### Slice 3: capacity-tracks (2 days, backend yes, migration no)

Owned files: app/(dashboard)/capacity/capacity-content.tsx, components/tahi/capacity/* (new folder: load-row.tsx, outlook.tsx, person-slideover.tsx, can-we-take-it.tsx), lib/capacity-outlook.ts, lib/__tests__/capacity-outlook.test.ts, app/api/admin/team-members/route.ts, app/(dashboard)/tracks/tracks-content.tsx.

### Slice 4: permissions-states (1.5 days, backend no, migration no)

Owned files: components/tahi/settings/team-access/pane.tsx, roles-matrix.tsx, change-history.tsx, copy-dialog.tsx, subject-detail.tsx, feature-slideover.tsx, team-access-states.tsx (new), team-access.css (new), app/(dashboard)/permissions/page.tsx. Slice 2 imports scopeLine and RoleChip from this folder read-only; slice 4 must not change either signature.

## Slice briefs

### time

Follow Claude Design ops.jsx function Time plus LogTime and XeroDrawer, ops-kit.jsx GridCell, EntryRow, ExportRow, WeekNav, and the TIME section of ops-fixes.css. Page keys: time, time-entries, time-rates, time-day, time-log, time-edit, time-xero, time-delete, time-nomatch, time-loading, time-empty, time-error (preview: previews/ops-preview.html?page=KEY).

Backend first:
1. app/api/admin/time/route.ts GET: add source, startedAt, endedAt, taskId, invoiceId, invoicedAt to the select (additive, nothing removed). Keep the 50 row page; the client pages through (page=2, 3 ...) until a page returns fewer than limit rows. Do not change POST.
2. app/api/admin/time/[id]/route.ts: add PATCH. Same gate as DELETE (isTahiAdmin, then requireAccessToOrg on the entry's org and on a new orgId if it changes), plus requireFeature(auth, 'time'). Accepts hours, date, notes, billable, hourlyRate (null allowed and meaning "no rate"), requestId (null allowed; must belong to the entry's org), teamMemberId. Refuse with 409 and a plain message when invoiceId or invoicedAt is set ("Already on an invoice. Change it on the invoice instead."). Write an auditLog row like the other time writes. Validate with the helpers in lib/time-entries.ts (read them first; do not change their behaviour for other callers). No export other than the HTTP verbs from route.ts (memory rule: next build rejects non-route exports).
3. Vitest: app/api/__tests__/admin-time-patch.test.ts covering 403 non-admin, 404 missing, 409 invoiced, request from another org refused, null rate stored as null, happy path.
4. MCP parity (CLAUDE.md rule 14): add an update_time_entry tool to workers/mcp-server/src/index.ts that calls the new PATCH. Touch nothing else in that file.

UI, composed from existing primitives only: PageHeader, KPIStrip plus KPICell, Callout, RailLayout plus rail-controls (RailViewItem, RailGroupLabel), SegmentedControl for the Week grid / Entries / Rates switcher, DataTable with mobileCard for Entries, SlideOver for every drawer, ConfirmDialog, EmptyState, DataState, TahiButton, Badge, Avatar (inside a leaf-radius wrapper), SearchableSelect, Input, useToast, useDisplayCurrency for every money figure.
- Header: title "Time", subtitle "Every hour logged, priced, and ready for Xero." Actions: Export CSV (secondary; downloads /api/admin/export/time with the current week's dateFrom and dateTo plus the person and client filters, and the button title says exactly what it will contain), Export to Xero (secondary; only rendered when useFeature('billing') is true, because the route is gated on billing), Log time (primary).
- KPIStrip, four cells computed from the loaded week: Logged this week (hours, sub is the week label), Billable (hours, sub "N% of the week"), Unpriced (billable hours whose entry hourlyRate is null; danger tone when above zero; clicking switches to Rates), Worth (sum of hours times the entry's own hourlyRate over billable entries, via useDisplayCurrency). While loading, render the strip with skeleton values, never zeros.
- Rate warning Callout (warning tone) when Unpriced is above zero, naming the clients, action "Set the rates".
- Week scope: a WeekNav-style control (previous week, the week label "Mon 21 Sep to Sun 27 Sep", next week, This week) in the RailLayout trailing slot. Weeks run Monday to Sunday in NZ time. lib/time-week.ts holds the pure helpers (week bounds from a date, week label, buildWeekGrid(entries) returning rows per client with seven day cells, day totals, per-client total, billable and value, and a formatter that shows sub six minute work as "under 0.1h" rather than 0h). Unit test every helper.
- Rail (RailLayout, rail and railTouch): Person (Everyone plus each team member), Client (Everyone plus clients present in the week), Billable (All, Billable, Not billable). Search box through RailLayout query. On the Rates tab render without the rail.
- Week grid (desktop): a table with its own horizontal scroller inside a Card, grid template minmax(10.5rem,1.4fr) repeat(7,minmax(3rem,1fr)) minmax(4.75rem,auto) minmax(6.5rem,auto), min width 53rem, so Hours and Value can never be the columns that clip (the old Time FIX). Each cell is a button: a filled cell opens the day SlideOver for that client and day, an empty cell opens Log time prefilled with that client and date. Fill intensity is a token tint (color-mix of --color-brand into --color-bg), numbers stay in --color-text. Today's column is marked. Footer row carries day totals. A client with no rate shows "No rate, set one" (44px target) that jumps to Rates. One legend line under the grid.
- Phone (below md): replace the grid with a day list (seven day groups, today pill, each entry as a card row, an empty day is a 44px "Nothing logged. Add a block." button). No horizontal scroll at 375.
- Entries tab: DataTable (Date, Person, Client, Request link, Hours, Rate, Value, Billable, Source "Tracked" when source is live_timer or "Typed in", Notes) with mobileCard mirroring EntryRow. Row actions: Open request, Edit (disabled with the reason when invoiced), Delete.
- Rates tab: list of clients from /api/admin/clients (name, plan, billable hours this week, a rate input, state Badge: Priced, No rate, Not saved yet). Edits are a draft; a sticky save bar appears ("N rates changed. Nothing is charged differently until you save.") with Discard and Save rates; save sends PATCH /api/admin/clients/[id] { defaultHourlyRate } per changed client and reports each failure by name. State plainly that hours already logged keep the rate they were logged at (true: rates live on the entry). No studio default row.
- Log time and Edit time: one SlideOver. Fields: Client (SearchableSelect), Who worked, Against (requests fetched with /api/admin/requests?orgId=CLIENT so the picker is scoped to the client; when none, say it saves as studio time), a How long / Start and end SegmentedControl (hours and minutes, or two time inputs where past midnight is allowed; compute hours client side and send hours; send startedAt and endedAt only if POST accepts them, check validateTimeEntryDraft first), Date, a Billable switch with hint, Rate for this entry (placeholder shows the client's default; blank means the server falls back), a live readout "1h 30m, worth NZ$270" or "worth nothing until this client has a rate", a warning Callout when billable with no rate, Notes. Edit prefills, shows whether the block came off a timer or was typed in, and saves through the new PATCH.
- Day SlideOver: the day's entries for that client with Edit and Delete, a no-rate Callout, footer Close and Add to this day.
- Export to Xero SlideOver: month select (default last full month, the route's own default). On open, POST { month, dryRun: true } and render one row per planned invoice (client, hours, amount, Ready) and one per refusal with its reason mapped to plain words (missing_rate "No rate", billing_model_not_hourly "Covered by plan", already_exported "Already exported", billing_model_not_set "Billing model not set", currency_mismatch and unsupported_currency "Currency problem", no_billable_hours, invalid_hours, unknown_org), using the route's own message. A no-rate refusal offers "Set the rates". Footer: "N drafts, total" and a primary "Create N drafts" that is a deliberate second click, then POST { month, dryRun: false } and shows the result rows (created, synced, xero_failed with its reason). Also show the note "Run this twice and nothing doubles" (true: invoice_id idempotency). Every client with a ready plan is included; there is no per-client picking (the route has no filter).
- Delete: ConfirmDialog "Delete 2h on Physitrack?"; when the entry is invoiced, say the invoice keeps its lines. Do not claim the entry leaves a draft invoice.
- Revalidate the week when a timer stops: subscribe with lib/timer-events (subscribeToTimerChanges) and call mutate.
- URL: keep the tab and week in search params (?tab=week|entries|rates&week=YYYY-MM-DD) so reload keeps place.

States to cover: loading (skeleton strip plus SkeletonTable, rail present, count shows loading), empty week (EmptyState with a clock icon, "No hours this week", "Start the timer from any request or task, or log a block by hand. Both land here.", CTA Log time), filtered to nothing (small EmptyState "Nothing matches that", Clear the filter), error (EmptyState-pattern error with an alert icon, "This week did not load", Retry; RailLayout countOverride "Could not load"; never the empty copy), populated; Rates loading, error and no clients; Xero preview loading, preview error, nothing to export, applied result; write errors as toasts plus inline messages.

375 and dark: no horizontal page scroll (the grid and DataTable scroll inside their card only), every control at least 44px tall on touch (h-11, the rail sheet from RailLayout does this; this closes IC.9), the switcher and search at 44px. Dark through tokens only; check the grid tint and the Unpriced danger tone in .dark. No hardcoded hex (the live file has #ffffff on the active tab and SummaryCard icons; remove both), rem units, no em or en dashes, no single-side borders.

Do not build: the on-page running timer card (Liam question; timers stay in the top-nav TimerChip), a studio default rate, per-client checkboxes in the Xero drawer, the IC.8 stamp-invoiced control, a By client tab (the week grid replaces it), the charts and FeatureCard of the live page (the design drops them; flagged for Liam), the Client view read-only strip (the route redirects previews).

### team

Follow Claude Design ops-team.jsx Team, AccessDrawer, InviteDrawer, PersonDrawer, OrgChart, and the TEAM section of ops-fixes.css. Page keys: team, team-chart, team-access, team-edit, team-invite, team-remove, team-nomatch, team-loading, team-empty, team-error.

Keep every live capability: add member with optional login invite, edit, send login invite, access scope, View as (the existing client-side setTeamMemberImpersonation simulation), remove, self-link Add me, no-login banner, org chart with planned roles.

UI from existing primitives: PageHeader, KPIStrip, Callout, RailLayout, DataTable with mobileCard, SlideOver, ConfirmDialog, EmptyState, DataState, Badge, Avatar in a leaf wrapper, TahiButton, usePermissions (canManagePermissions) and useFeature('settings.permissions').
- Header: title "Team", subtitle "Who is in the studio, what they can reach, and who is still waiting on a login." Actions: Feature permissions (secondary link to /permissions, only when canManagePermissions), Invite someone (primary; opens the live Add member flow; disabled with a visible reason when the caller cannot manage, because POST /api/admin/team requires manage permissions).
- Data: /api/admin/team for the roster. When canManagePermissions is true also read /api/admin/permissions/subjects and join by member id to get the permission role and scope; compute the "Can see" sentence with the exported scopeLine(member, orgs.length, orgs) from components/tahi/settings/team-access/subject-detail.tsx and the chip with RoleChip from shared.tsx (import only, do not edit those files). When the caller cannot read subjects, omit the Can see column and the No access yet cell rather than guessing.
- KPIStrip: People (sub "N on contract"), Weekly capacity (sum, sub average each; a null capacity counts as 40h and says so, matching the start-date endpoint), Waiting on a login (clerkUserId null, warning tone), No access yet (members whose scopeLine reads "No role: sees nothing" or "Sees no clients", danger tone; only when subjects loaded). Drop the donut and the FeatureCard.
- Callouts: self-link (info, "You are not on the roster", action Add me, live handler) and no-login (warning, names the people, action "Show them" which sets the rail filter to No login yet).
- Rail: Type (Everyone, Employees, On contract) and Login (Any, Signed in, No login yet), plus search (name, email, title, skill). Do not filter on the legacy Admin or Member role; it grants nothing.
- Members: DataTable columns Person (avatar, name, Contractor badge, title, email with ellipsis inside a min-width 0 cell so nothing clips), Can see (scope sentence plus the permission role chip; danger tone with a ban icon when it is nothing), Week ("32h a week", no bar), Login (Badge "Signed in" or "No login"; there is no invited timestamp in the data, so no "Invited 3 days ago"), Skills (two plus "and N more"). Row actions: Edit, Client scope, Send login invite (only without a login), View as, Remove (absent for super admins rather than disabled). mobileCard renders the design's two-band person row with every action reachable at 44px (no hover-only controls).
- Legend Section under the table, rewritten to be true: "Client scope, on this page" says it decides which clients' data the person can reach, is enforced for every non-admin, and is the same record the permission panel's Data scope edits, so a change in either place shows in both. "Feature permissions, in the panel" says the role and overrides decide which pages open. Access role cards: Runs the account (read today: notifications and project manager), Does the work and Reads only (each with "not enforced yet").
- Client scope SlideOver (replaces the live AccessPanel, same PUT /api/admin/team/[id]/access): an info Callout "This panel sets which clients, not which pages" with an Open the permission panel link; a "Right now" sentence; a plain words scope editor with radios Nothing (saved as specific_clients with no clients, which the server resolves to no access), Only the clients I pick (checkbox list from /api/admin/clients with a find box above five clients and the empty warning above the list), Everyone on a plan (plan chips), Every client; an access role radio group with the not enforced markers; Track type kept (live behaviour) and marked "not enforced yet, only the View as preview reads it"; a note that saving the scope in the permission panel resets the access role to the person's permission role. Save disabled when nothing changed or a named scope has nobody picked. Disabled with a reason when useFeature('settings.permissions') is false.
- Edit person SlideOver: live fields (name, email, title, weekly capacity with hint "the number Capacity divides by", skills, contractor). Keep the live Role select but relabel it "Roster label" with the hint "Does not grant access. Page access comes from the role in Feature permissions."
- Invite (Add member) SlideOver: live fields plus the live invite checkbox; closing note "The roster and the login are two saves" (true: the live flow creates the row, then invites).
- Remove: ConfirmDialog. Keep the live consequence copy unless you verify in app/api/admin/team/[id]/route.ts and the time_entries foreign key what happens to logged hours; do not claim "hours keep their name" unverified.
- Org chart tab: keep components/tahi/org-chart.tsx (the live tree wins over the design's two-level list). Fix the dead click: team-content.tsx reads the member search param that OrgChart already pushes and opens the Edit SlideOver for that member, then clears the param. In org-chart.tsx: every expand, collapse, filter and Add planned role control at least 44px on touch, rem units, tokens only (check department colours in .dark), no horizontal scroll at 375 and 768.
- URL: ?view=members|chart so reload keeps the tab.
- Member versus admin seat: a team member with the team feature but without manage permissions sees the same page with write actions disabled and one sentence saying why, instead of 403 toasts.

States: loading (skeleton KPI strip and table), empty ("Just the two of you so far" is fixture copy; use "No team members yet" with Invite someone), filtered to nothing (small EmptyState, Clear the search), error (EmptyState-pattern error with Retry; fixes the live false empty), subjects read failing on its own (hide the Can see column and say "Access could not be read" once, do not show everyone as having no access), populated.

375 and dark: no horizontal page scroll, 44px targets, dark via tokens, no hardcoded hex, rem only, remove the live em dash placeholders in team-content.tsx (the Title, Capacity and Skills cells print an em dash character when empty; use a muted "Not set").

Do not build: the Workspace seat radio (it would claim teamMembers.role gates settings and billing, which is false), retiring the Access slide-over (Liam question 3), an "Invited N days ago" state, a /team/[id] page, the design's own simplified org chart.

### capacity-tracks

Follow Claude Design ops-team.jsx Capacity and ops-kit.jsx LoadRow, LoadBar, Outlook; for /tracks only the tracks-today state of ops-tracks.jsx Tracks. Page keys: capacity, capacity-answer, capacity-person, capacity-loading, capacity-empty, capacity-error, tracks-today.

Backend: app/api/admin/team-members/route.ts adds weeklyCapacityHours and isContractor to its select (additive; eight other surfaces read this route and ignore unknown fields).

Capacity UI from existing primitives: PageHeader, KPIStrip, Callout, Card sections, SlideOver, EmptyState, DataState, TahiButton, Input, Badge, Avatar in a leaf wrapper, useDisplayCurrency. No rail (the critic's verdict and live agree).
- Header: title "Capacity", subtitle "Who is booked, who is free, and what the pipeline would do to both." Action: Refresh (live).
- Data: the live bundle (start-date with 1h, forecast, team-members) plus this week's entries from GET /api/admin/time?dateFrom=MONDAY&dateTo=SUNDAY, paged until a short page.
- KPIStrip: Studio capacity (sum of weekly capacity, sub "this week, across N people"), Committed (committed hours from subscriptions, the live number, labelled as retainer commitments), Available (live), Utilisation (live thresholds; danger over 90, warning over 70).
- This week, person by person: one LoadRow per member (avatar, name, Contractor badge, title, a bar with billable and non-billable logged hours against their weekly capacity, "Nh of 40h", and a flag only when logged exceeds capacity). Label it "Logged so far this week"; do not show "Room to spare" mid-week and do not call it booked (there is no per-person commitment data). A null capacity reads "Not set, counted as 40h". Row button opens the person SlideOver (their entries this week, split billable and studio time).
- The next eight weeks: a column plot built with tokens (the design's CSS columns, or Recharts BarChart stacked plus a ReferenceLine if simpler). Per week: committed (flat from subscriptions), plus weighted pipeline counted from the week each deal is expected to close (deals with no close date counted from now), against the studio ceiling; the slice above the ceiling in the danger token; every figure printed under its column, never hover only. Put the maths in lib/capacity-outlook.ts with Vitest tests. No leave notes (there is no leave data).
- Can we take this on: hours per week input plus Check (POST start-date with that number, the live call). Answer: "Yes, from the week of 5 Oct" plus the new utilisation, or "Not in the next 12 weeks" (the endpoint's horizon), or an inline error when the call fails (live swallows it silently).
- What the pipeline would add: the forecast deals (title linking to /deals/[id], probability bar, hours a week, value and weighted value); empty line when there are no open deals.

Tracks (tracks-content.tsx studio branch only): PageHeader title "Tracks" (live says "Your tracks"), subtitle "Track queues are managed on the client that owns them.", EmptyState with the Layers icon, "Manage tracks from a client", "Open a client to see and reorder their track queue. There is nothing studio wide to show here yet.", CTA Go to clients at 44px. Leave the unreachable client branch and page.tsx untouched (CT.18 decides its fate).

States: loading (strip plus row skeletons), empty (nobody on the roster: EmptyState gauge icon "Nobody to measure yet", CTA Go to Team), error (EmptyState-pattern error with Retry, and treat a failed start-date read as an error instead of rendering zeros), per-card partial failure (forecast failed: the pipeline cards say so; time read failed: the person rows say so), populated.

375 and dark: KPIs two per row, outlook columns stay readable (scroll inside their card if needed, never the page), 44px on the hours input and Check, tokens only, rem only.

Do not build: booked equals logged plus committed per person, per-week varying commitments, the leave note, the "Move some work" action, the studio-wide track board, the client tracks viewer.

### permissions-states

Follow Claude Design permissions.jsx (PaneEmpty, PaneError, PaneSkeleton, CopyDialog empty, SubjectDetail super admin strip) and permissions.css (the pa-page frame, pa-empty, pa-honest, and the 44px removes). Page keys: permissions, permissions-clients, permissions-roles, permissions-features, permissions-copy, permissions-history, permissions-nomatch, permissions-loading, permissions-error.

The live pane already matches the structure; this slice adds the missing states and the hand-sized targets. It must not change any write path or the scopeLine or RoleChip signatures (slice team imports them).
- New team-access-states.tsx: PaneEmpty (leaf icon tile, title, body, optional CTA; small variant), PaneError (alert tile, "Team and access did not load", "Nothing was changed and nothing was lost. Until this list comes back, every rule already saved is still the rule the server is enforcing.", Try again), PaneSkeleton (list plus detail skeleton, animate-pulse). Use EmptyState internals or tokens; no hex.
- New team-access.css imported by pane.tsx after settings.css: the pa-* rules ported from permissions.css with the app's token names, danger through the existing settings.css --danger token, and overrides that make .ta-search-x and the .ta-multichip remove button 1.5rem on a pointer and 2.75rem on touch, plus the tri-state buttons at 2.75rem on touch. Do not edit settings.css (the settings module owns it).
- pane.tsx: show PaneSkeleton on first load; PaneError when the subjects read fails (today it renders empty lists); search with no match becomes a small PaneEmpty with Clear the search (replacing the hardcoded 13px line); keep the live lists for an unsearched workspace (the fresh-workspace states are Liam question 5).
- roles-matrix.tsx: error branch with Try again; search with no match ("No feature matches that", hint to try a group name such as Finance or Operations).
- change-history.tsx: error branch; restyle the live empty line with PaneEmpty keeping the live meaning.
- copy-dialog.tsx: when there is nobody else of that kind to copy from, show the small PaneEmpty and a single Close.
- subject-detail.tsx: super admin shows the honesty strip "A super admin cannot be locked out. Role, scope and overrides are read only here on purpose." in place of the plain note; fix the stale header comment that says a member with no role sees every client (scopeLine already says the opposite).
- feature-slideover.tsx: tri-state reachable at 44px on touch, reason input at 44px.
- app/(dashboard)/permissions/page.tsx: convert the px padding to rem (for example 2rem clamp(1.125rem, 2.4vw, 1.875rem) 4.5rem) and keep max width.

States: loading, error, nomatch on each tab, populated, copy dialog empty; 375 push panel with a working Back at 44px; dark via tokens.

Do not build: the fresh-workspace "No hires yet" and "No client organisations yet" states and the "Nothing is granted by default" strip (Liam questions 2 and 5), the client-deny "A deny hides it, not yet a lock" strip (Liam question 7), the design's fixture subjects and its own role list (live reads the real catalogue).

## Skipped (design proposals, Design file only, or waiting on Liam)

1. Studio-wide cross-client /tracks board and its states (tracks, tracks-client, tracks-attention, tracks-loading, tracks-empty, tracks-error): the design labels it "Proposal, waiting on a decision" (CT.18) and it needs a cross-client endpoint that does not exist. Live keeps the explainer.
2. Client "Your tracks" viewer (portal-tracks and its three states): no live route serves it and the four-lane client board is Liam question 6.
3. On-page running timer card on /time: studio-finance open question 3. The top-nav TimerChip stays the only timer.
4. Studio default hourly rate row in Rates: no setting exists and adding one changes how the Xero export resolves rates.
5. Per-client pick checkboxes in the Xero export drawer: the route exports every ready client and has no filter.
6. Capacity "booked" per person, per-week varying commitments and the leave annotation: no per-person commitment or leave data.
7. Workspace seat radio in the client scope drawer: teamMembers.role grants nothing once roles are seeded, so the drawn claim is false.
8. Retiring /team's Access slide-over in favour of /permissions: Liam question 3; both editors stay, with honest copy.
9. Permissions fresh-workspace empty states and the "Nothing is granted by default" strip: Liam questions 2 and 5.
10. Client feature deny "not yet a lock" strip: Liam question 7.
11. Invited N days ago login state on /team: no invite timestamp is stored.
12. Seeding a capacity resource row for project_manager: Liam question 4; no change.

## Questions for Liam

1. /tracks: delete (CT.18) or build the studio-wide board? It needs a new cross-client endpoint.
2. Is T1.15 done? The code reads as deny by default; TASKS.md still has it open.
3. Retire /team's Access slide-over, or keep both editors? The port keeps both and says they edit the same scope record.
4. Should capacity stay unseeded (explicit allow only), or should project_manager get a seeded row?
5. Does /permissions need the bespoke fresh-workspace empty states?
6. Should the client home TrackBoard gain Waiting on you, Delivered 30 days and turnaround?
7. Should the "a client deny is not yet a route lock" marker show in the ported pane until T1.6 lands?
8. /time running timer: a card on the page, or the top nav only? The port leaves it in the top nav.
9. The /time port replaces the any-range date picker, the hours-by-member chart and the billable donut with the week-at-a-time grid the design draws. Is a month or custom range view still needed?
10. Do you want a studio default hourly rate, used when a client has none (a setting plus a change to the export)?
11. Should the Xero export let you pick which clients to raise drafts for (a small route change)?
12. Capacity can only show hours logged so far this week per person, because nobody's commitments or leave are recorded. Is that enough, or do you want per-person allocation and leave captured?
13. The roster's Admin or Member label no longer grants anything. Keep it as a label, or remove it from the form?

## Risks

- Invoiced entries: the new PATCH must refuse edits to anything with invoice_id or invoiced_at, or the export's idempotency and the books drift apart. DELETE today has no such guard; say so in the confirm copy rather than extending scope silently.
- The Xero apply raises real draft invoices in Xero. Keep the dry run first, the create as a separate click, and the route's own messages on screen. Memory rule: nothing publishes unattended.
- GET /api/admin/time pages at 50; the week grid and capacity must page through or totals are silently short.
- Money currency: the live code says entry rates are studio base currency while the export builds lines in the client's currency. Use the same useDisplayCurrency formatting the live RateCell uses and do not relabel currency until confirmed.
- Design copy is wrong in two places the code contradicts (client scope "not read by anything", workspace seat "reaches settings"). Builders must use the corrected copy in this plan.
- /permissions writes the access role as the permission role name on every scope save, so a /team access role choice can be silently reset. The drawer states this; fixing it is out of scope.
- Team remove: teamMembers is hard deleted and time_entries references it without cascade; verify before promising hours keep their name.
- The permissions pane also renders in Settings; slice 4 changes appear there too (intended).
- Dropping the live /time charts and date range picker removes views some may use (question 9).
- MCP worker file is shared; slice 1 adds one tool only.

## Shared files (schedule around other modules)

- workers/mcp-server/src/index.ts (slice time adds update_time_entry)
- app/api/admin/team-members/route.ts (additive fields; read by requests, tasks, clients, deals, leads)
- components/tahi/settings/team-access/* (owned by slice permissions-states; the settings module port must not edit them)
- app/(dashboard)/settings/settings.css (read by the pane; not edited here; the settings module owns it)
- components/tahi/settings/primitives.tsx (SlideSeg, Toasts; used, not edited)
- components/tahi/rail/rail-layout.tsx, rail-controls.tsx, kpi-strip.tsx, data-table.tsx, data-state.tsx, slide-over.tsx, empty-state.tsx, callout.tsx, page-header.tsx, confirm-dialog.tsx, segmented-control.tsx, searchable-select.tsx (used, not edited)
- lib/time-entries.ts, lib/timer-events.ts (read, not edited unless the PATCH needs a shared validator; coordinate with anything touching timers)
- components/tahi/impersonation-banner.tsx (View as, used not edited)
- app/globals.css (no change planned)
