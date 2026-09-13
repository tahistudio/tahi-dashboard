# Design requirements: studio-calls

Group: studio-calls (audience: studio only). Routes: `/calls`.
Prepared 2026-09-13 for the Claude Design pass. Source: CLAUDE.md, STATUS.md, `docs/superpowers/plans/2026-09-13-page-catalogue.md`, `docs/superpowers/plans/2026-09-13-design-review-checklist.md`, TASKS.md, live code, and `sales-pipeline.jsx` in the Claude Design project (57bf60cf-5e6d-450f-9e2f-e25c8d12fd66).

## 1. Purpose and audiences

`/calls` is the studio's unified call log. It answers one question for Liam (and, once granted, a scoped team member): "what calls are on the books, and what is each one for." It reads `discovery_calls`, the polymorphic table every Google Calendar sync and every AI classifier writes into, and lets a human correct what the sync gets wrong: what a call is called, what type it is, and who or what it belongs to.

Audiences:
- **Liam and Staci (super admin / owner).** Full access to every call regardless of `teamMemberAccess` scoping.
- **A scoped Tahi team member** granted the `calls` feature. Sees only calls whose org (direct, or inherited through a linked deal or request) falls inside their `teamMemberAccess` scope. A call with no client at all (a lead-only or genuinely unclassified call) is visible to anyone holding any scope at all, on the theory that a pre-client call cannot leak a client's business.
- **Nobody else.** This is never a client-facing page. `lib/feature-tree.ts` registers `calls` with `appliesTo: ['team']` only; there is no client variant, no portal equivalent reachable from this route, and no case where a client org should ever see this page.

What it must never show:
- A client org, ever. `app/(dashboard)/calls/page.tsx` redirects to `/overview` unless `isAdmin` is true, and it also redirects when `isPreviewingClient` is true (the admin-as-client preview cookie), specifically so a studio preview of "what a client sees" cannot leak one client's call into another's view. The route's own comment names this explicitly.
- A scoped team member must never see the title, org name, or existence of a call belonging to a client outside their scope, even when that call reaches the client only through a linked deal or request rather than a direct `orgId`. `GET /api/admin/calls/index` resolves the deal's or request's own org and re-filters before returning rows; `PATCH /api/admin/discovery-calls/[id]` checks the call's current org AND every new link target's org before allowing a relink.
- No feature this page does not have: there is no super-admin-only sub-area inside Calls. The only privilege split is scoped-team-member versus everyone-with-access (deny by default if a member has no rule at all).

## 2. Pages, sub pages and entry points

- **`/calls`** (the only route). Reached from the sidebar "Sales" group (Leads, Calls, Deals, Proposals, Schedules, Contracts, Calculator, Sales analytics, Affiliates), from the owner-home "Today's calls" card's "Calendar" link, and by deep-linking directly. Server-gated by `requirePageFeature('calls')` after the admin/preview checks above.
- **Call details slide-over.** Not a sub-route: opening a row (click, or the DataTable's row-preview affordance) sets local component state (`previewCall`) and opens a `SlideOver`, no URL change. Closing returns to the plain list. Contains: an editable Title field, an editable "What it is for" select (the `meetingType` classifier: Discovery, Client check-in, Partnership, Triage), and a `LinkedToPanel` showing Client, Deal, Lead and Request rows, each independently changeable or removable.
  - Inside the slide-over, each `LinkedToPanel` row ("Client", "Deal", "Lead", "Request") opens its own `Popover` with a search box and a picker list; this is a sub-panel, not a separate page, and it closes back into the slide-over on pick or Cancel.
- **Row action menu** (per-row overflow, not a page): "Open Meet link" (only when a Google Meet URL exists), "Open lead" (only when the call has a lead), and up to three "Mark as Discovery / Client / Partnership" quick-reclassify actions (the row's current type is omitted from its own menu).
- **No dedicated call detail page exists at `/calls/[id]`.** Everything beyond title/type/linkage (outcome, summary, scope notes, budget, timeline, transcript, AI extraction, attendees) lives outside this route entirely, on `<DiscoveryCallsCard>` embedded on the call's parent surface (a lead, a deal, a request, a task, or a client's detail page). A user who wants to read a transcript or record what happened on the call must leave `/calls` and navigate to that parent. This is a real gap, not a design choice this pass should assume is intentional; see section 4 and section 7.
- **"Sync calendar" button** in the page header (not a page): triggers `POST /api/admin/integrations/google/sync-calendar` and shows a toast with counts, no navigation.

## 3. States and variants

- **Loading.** `DataTable` renders its built-in skeleton rows while the SWR fetch to `/api/admin/calls/index` is in flight. One line, no special empty-state copy.
- **Empty, no calls at all.** Full `EmptyState`: Calendar icon, title "No calls yet", body "Connect Google Calendar and hit Sync to pull your upcoming Meet calls. Each gets classified automatically.", CTA "Sync calendar" that fires the same sync action as the header button.
- **Empty, filtered to zero.** Inline `EmptyState` variant: title "No calls match", body "Try clearing the search or switching tabs." No CTA button (the copy tells the user what to do instead of offering one).
- **Error.** Not explicitly modelled today: a failed SWR fetch leaves `items` as an empty array via the `data?.items ?? []` fallback, so a genuine fetch failure currently renders as the empty state rather than a distinct error state. Worth a proposal (see section 4).
- **Read-only Client view.** Structurally impossible: the page redirects before rendering whenever `isPreviewingClient` is true, so there is no client-preview variant of this page to design at all, unlike Requests or Tasks which have an explicit read-only client mode.
- **Member seat versus admin seat.** Same UI, different row count and possibly a fully empty list (`scope.kind === 'none'` returns `{ items: [] }`, which renders as the "No calls yet" empty state even though calls do exist elsewhere in the system, which is indistinguishable from a genuinely empty system today). No banner explains "you're seeing fewer calls than exist" to a scoped member.
- **375px.** Not verified live. The catalogue's Pass 3 critic verdict on the design file itself (see section 6) already flags "list clips at the right edge, title truncates" at narrower widths, which is exactly the risk at 375. The live DataTable has a `mobileCard` fallback below `md` elsewhere in the codebase pattern, but this page's specific mobile behaviour has not been screenshotted or confirmed.
- **768px.** Not verified live.
- **Dark mode.** Not verified live. All styling in `calls-content.tsx` uses `var(--color-*)` tokens rather than hardcoded hex, so it should inherit dark mode correctly by construction, but this has not been eyeballed with `.dark` applied.
- **Print or public.** Not applicable; this is an internal operational tool with no client-facing or printable variant.
- **Upcoming vs Past tab.** Two named states of the one page, not sub pages: `Upcoming` (default) shows calls with `scheduledAt >= now`, sorted ascending; `Past` shows the rest, sorted descending. Each tab shows a live count. Neither tab explains the underlying 60-day window (see section 4).
- **Reclassify in flight.** Optimistic: clicking a "Mark as X" action flips the row locally before the PATCH resolves; on failure it reverts and toasts "Could not reclassify, refresh and try again," then refetches.
- **Slide-over field save in flight.** Title and "What it is for" each save independently on blur/change; a per-field spinner disables the input while saving, and a shared error banner appears inside the slide-over on failure without closing it.

## 4. Features and actions

### What works today
- Unified read of every `discovery_calls` row within a ±60-day window (the page never changes the window), classified into Discovery, Client check-in, Partnership or Triage, with a live Upcoming/Past tab split and a live search over title, lead, org and deal.
- One multiselect filter (Type) via `FilterBar`, plus per-column sort (Title, When, Status) via `DataTable`.
- "Linked to" column resolves and links to whichever parent is set, in priority order lead, deal, org, request, falling back to an italic "Unlinked, triage" label.
- "Sync calendar" button triggers a real Google Calendar pull-sync and reports created/updated counts.
- Row-level quick reclassify (Mark as Discovery/Client/Partnership) with optimistic update and toast feedback.
- "Open Meet link" and "Open lead" row actions when the respective ids exist.
- **GI.3, merged and live 2026-09-13:** the call detail slide-over now lets a user rename the call, change its "what it is for" classification, and edit every link (Client, Deal, Lead, Request) through the shared `LinkedToPanel`, with server-side validation that every new link target exists and access-scope checks on both the call's current org and every new target's org. Backed by `PATCH /api/admin/discovery-calls/[id]`, MCP `update_call`, and an audit-log entry (`discovery_call_updated`) whenever org/lead/deal/request/meetingType/title changes.
- MCP parity for the surface: `list_all_calls`, `list_calls`, `create_call`, `update_call`, `record_call_outcome`, `extract_call_insights`, `drive_sync_gemini_transcripts`, `normalize_call_times`, plus the two cron tools `cron_pre_call_digest` and `cron_auto_promote_calls`.
- `POST /api/admin/calls/normalize-times` (dry run by default) repairs any historically mis-timed `discovery_calls` row; the 2026-09-13 backfill already applied it to all 71 production rows.

### What exists but is wrong or half built
- **Manual reclassification is silently reverted by the next calendar sync.** `app/api/admin/integrations/google/sync-calendar/route.ts` recomputes `meetingType` from the event's matched parent on every poll and overwrites the row whenever the computed value differs from what is stored, with no memory of a human's manual choice. There is no `locked` column on `discovery_calls` in `db/schema.ts` today. A triage decision can be undone within minutes with no notice to the person who made it.
- **The ±60-day window is invisible.** `calls/index/route.ts` defaults `since`/`until` to now minus/plus 60 days; the page passes neither parameter and offers no date-range control, so "Past" quietly stops 60 days back and "Upcoming" 60 days out while the tab counts present the truncated set as if it were everything.
- **`GET /api/admin/calls/index`'s own doc comment is inaccurate.** It claims to read "both `discovery_calls` ... and the legacy `scheduled_calls`," but the implementation only queries `discoveryCalls`. `scheduled_calls` is a second, separate call table (client check-ins booked by hand from a client's detail page, or via MCP `create_call`); its rows are entirely invisible on `/calls`. Two parallel call tables exist; only one is surfaced here. (Catalogue reference: this pairs with T568 below, since `scheduled_calls` is exactly the table booking links attach to.)
- **`outcome` is fetched and never shown.** The index route selects it and the row type carries it, but no column, filter or badge on `/calls` renders it, so a completed call's outcome (good call / ready to promote / nurture / archive / no-show) is invisible from the index; a user has to open the parent lead/deal to see it.
- **No way to reach a transcript from this page.** There is no transcript indicator you can act on beyond a "Transcript" badge that links to nothing, and no way to read, paste, or AI-extract from a transcript without leaving `/calls` for the call's parent surface (`<DiscoveryCallsCard>`).
- **The catalogue's own Pass 3 critic verdict on the design file is FIX, not SHIP**: "list clips at the right edge, title truncates" (see section 6). Liam's separate AR.3 approval ("Leads, Calls and Deals prototypes approved by Liam as-is") predates or sits alongside this critic finding; the two are not the same signoff and should not be conflated when scoping the redesign.
- **A denied-scope team member and a genuinely empty system render identically**, both as the "No calls yet" empty state, with no "you don't have access to any calls yet" distinction.
- **A fetch failure and a genuinely empty result render identically** (see section 3); there is no dedicated error state on this page today.

### What is planned or missing
- **T568**, Google Calendar booking links for scheduled calls: verify against `booking-widget`, likely already close to done, not yet closed out.
- **Catalogue functionality note**: "GI.3 link and purpose are not editable" is listed in the catalogue as still outstanding, but TASKS.md and STATUS.md both record GI.3 as merged and live as of 2026-09-13 (`ef2feca0`). The catalogue is stale on this specific point; treat GI.3 as done and do not re-scope it.
- **Design re-critique after Pass 3's FIX**, per the catalogue: "Port after re-critique," meaning a fresh design pass is expected here before the design gets ported into the live codebase, not the other way around.
- **Proposal**: an explicit lock affordance on classification (matching the design file's `Switch` "Lock this classification," described but not built) so a manual reclassify survives the next sync. This closes the "silently reverted" bug above; flagging as a proposal because TASKS.md does not carry it as a numbered item today.
- **Proposal**: surface the `scheduled_calls` legacy table on `/calls` too, or explicitly document that it is out of scope here and only reachable from a client's own Calls tab, so the doc-comment inaccuracy above gets resolved one way or the other rather than left silently wrong.
- **Proposal**: a distinct error state (retry affordance) separate from the empty state, so a fetch failure is not mistaken for "no calls."

## 5. Data and integrations

- **Primary table**: `discovery_calls` (polymorphic: `leadId`, `dealId`, `requestId`, `taskId`, `orgId`, any combination, at least one expected). Columns relevant to this page: `title`, `scheduledAt`, `durationMinutes`, `status`, `meetingType`, `outcome`, `transcript` (capped at 250,000 characters at the API layer), `googleMeetUrl`, `googleCalendarEventId`, `attendees` (JSON).
- **Secondary/legacy table**: `scheduled_calls`, read and written by `/api/admin/calls` (GET/POST) and `/api/admin/calls/[id]` (PATCH), consumed by the client-detail page and MCP `list_calls`/`create_call`, NOT surfaced on `/calls` today (see section 4).
- **APIs this page depends on**: `GET /api/admin/calls/index` (the list), `PATCH /api/admin/discovery-calls/[id]` (title, meetingType, and every link field, with per-field validation and audit logging), `POST /api/admin/integrations/google/sync-calendar` (the Sync button). `GET /api/admin/discovery-calls/upcoming` powers the owner-home widget that links here but is not called by this page itself.
- **Third parties**: Google Calendar (two-way: pull-sync classifies and writes rows; a manual "Schedule call" elsewhere in the app can push an event back). Google Drive/Gemini transcript sync exists (`sync-drive-transcripts`, cron-only, MCP `drive_sync_gemini_transcripts`) but has no button anywhere in the UI, including this page.
- **Must be honest**: the Sync button's toast must reflect real created/updated counts, never placeholder numbers; the ±60-day window must not be presented as "everything" once a date-range control exists; the "Transcript" badge must not render as clickable/actionable unless a real destination exists (today it is decorative, which is itself a smaller honesty gap, see section 4); no call count or classification badge should be shown to a scoped member that includes calls outside their access scope.
- **Access scoping**: `scopedOrgIds` (`lib/access-scope.ts`) and `requireAccessToOrgOrPreClient` (`lib/require-access.ts`) gate every read and write on this surface. A lead has no org (pre-client) and a null-org deal is treated the same, both following "visible/editable if the caller holds any scope at all."
- **Audit**: `logAudit` writes a `discovery_call_updated` row (before/after) whenever org/lead/deal/request/meetingType/title changes via the slide-over.

## 6. Design system contract

**Primitives the live page already uses** (and any redesign should keep or deliberately supersede, not silently drop): `PageHeader` (title + subtitle + one action), `Card` (table wrapper), `Badge` (type and status chips, `soft` variant), `DataTable` (sortable columns, row preview, row actions via overflow), `EmptyState` (full and inline variants), `FilterBar` (multiselect + search), `SlideOver` (the call detail), `LinkedToPanel` (the shared org/deal/lead/request/proposal linkage editor also used by proposals, schedules and contracts), `TahiButton`, `Popover` (inside `LinkedToPanel`'s per-row picker). All styling already routes through CSS var tokens, so dark mode should be free by construction if the redesign keeps doing the same.

**What the existing design file (`sales-pipeline.jsx`, the `Calls` and `CallDetail` exports) gets right:**
- A left rail with saved Views (by call type) and Filters (Outcome, Date range), matching the AR.5 rule ("filters in a left rail on every list page") that the live page does not yet follow (it uses a flat `FilterBar` instead).
- A `StatBand` header row (Upcoming count with a "Next: <title>" sub-line, Needs-triage count, No-outcome-yet count, Calls-on-record count with the actual window named, e.g. "last and next 60 days") which would directly fix the invisible-window problem in section 4.
- An "Up next" hero card above the table for the soonest call, with a Join button, an Open call button, and a "Digest sent/Email me the digest" affordance, plus a pre-call digest preview panel (fit, watch-outs, top 3 discovery questions) when the call is lead-linked.
- A triage banner ("N calls need triage... we could not match them to a lead, deal or client from the attendees") with a one-click "Show them" filter shortcut, again naming the honesty gap the live page has today.
- A full `CallDetail` page (not a slide-over) with a hero (title, when, duration, type, outcome, Join/Reschedule/Delete), an editable Outcome card (chips for outcome, Summary, Next step, Scope notes, Budget range, Timeline, a Save-with-dirty-state footer that explains "saving with an outcome will mark this call completed"), an AI-extract-from-transcript banner and suggestion-apply flow, an Action-items-to-tasks panel, a Transcript card (upload, paste, or "look in Drive," collapsible, with an honest character-count caveat), a Classification card with a `Switch` to lock the type against the next sync, a "Linked to" card (lead and deal only, with an explicit "not attached to anything" empty state and a "Link to a lead or deal" CTA), and an Attendees card.
- `ScheduleCall` modal (title, when, duration, meeting link, "Attach to" a lead/deal/client/nothing-yet) which the live page has no equivalent of at all (there is no "Schedule call" button on `/calls` today).

**What the design must change before it can be trusted as the target:**
- **Critic verdict is FIX, not SHIP** (catalogue, Pass 3): the list "clips at the right edge" and the title "truncates." This must be fixed and re-critiqued before port; do not port the file as-is.
- **The `CallDetail` in the design is a full page reached via `onBack`/`go`, not a slide-over**, while the live product (GI.3, shipped without design input, per the checklist's "Not designed yet" list explicitly naming "the studio Calls detail... cannot change what a call is linked to or what it is for") uses a lightweight slide-over with only Title, "What it is for," and `LinkedToPanel`. These are two different shapes solving overlapping problems. This pass must decide, explicitly, whether the target is the design file's full page (richer: outcome capture, transcript, AI extract, lock, action items) or an extended version of the shipped slide-over, rather than silently keeping both. See section 7.
- **The design's "Linked to" card only supports Lead and Deal**, no Client (org) row and no Request row, while the shipped `LinkedToPanel` (used today in the slide-over) supports Client, Deal, Lead and Request for calls. If the design file's `CallDetail` becomes the target, its "Linked to" card needs updating to match the four-row shape already live, not the other way around.
- **No design coverage exists for the reclassify-reverted-by-sync bug**, beyond the `Switch` "Lock this classification" control, which is present but was never connected to a real column or a real bug story in the file's own commentary; the redesign should treat this as a first-class problem to solve, not a decorative toggle.
- **No design coverage of scoped-member states**: neither an explicit "you have limited access" empty state nor a distinction between "no calls exist" and "you can't see any of them."

## 7. Open questions for Liam

- Should the target for the call detail be the design file's full `CallDetail` page (outcome capture, transcript, AI extract, action items, lock, hero with Join/Reschedule/Delete), replacing the current slide-over entirely? Or should the current slide-over stay the permanent shape and only grow the fields it is missing (outcome, transcript link-out) without becoming a full page? (A or B)
- Should the "Lock this classification" control be built now, in the same pass that fixes reclassify-reverted-by-sync, or is a simpler fix (sync never overwrites a `meetingType` that a human has touched, no explicit lock toggle) enough? (A: build the lock control / B: silent never-overwrite-a-human-edit rule)
- Should `/calls` gain a visible date-range control (as in the design's rail) so the ±60-day window stops being invisible, or is a smaller fix (just state the window in the empty/tab copy) enough for now? (A: full rail with date range / B: just name the window in copy)
- Should `scheduled_calls` (the legacy client-check-in table) be folded into `/calls` so the index is genuinely unified, or should the doc-comment simply be corrected to say `/calls` only reads `discovery_calls` and `scheduled_calls` stays a client-detail-only surface? (A: unify the two tables on this page / B: fix the doc comment, keep them separate)
- Is a "Schedule call" entry point wanted on `/calls` itself (as in the design's modal), or does call creation stay exclusively inside a lead/deal/client/request's own Calls card? (A or B)

## 8. Acceptance for the design review

- At 1440 and at 375, the Title column never clips or truncates unreadably, and the table (or its mobile-card equivalent) never overflows the viewport horizontally.
- The window the list is drawing from (today: 60 days each way) is named somewhere on the page, not left implicit.
- Every state in section 3 (loading, empty-no-calls, empty-filtered, and an explicit error state distinct from empty) is present and visually distinguishable at both breakpoints.
- The call detail surface (slide-over or full page, per whatever section 7 resolves to) shows Title, classification, and all four link rows (Client, Deal, Lead, Request) with working Change/Remove affordances, matching what GI.3 already shipped, not a regression to lead/deal only.
- Dark mode (`.dark` class applied) shows no contrast regressions on badges, the type tiles, the triage banner, and the slide-over/detail surface.
- Reclassifying a call (via row action or detail) gives immediate visible feedback (optimistic row update or a save spinner) and a clear failure state if the save fails.
- If the reviewer's build includes the lock-against-sync control from section 6/7, it is visually distinct from the classification chips themselves and its hint text explains what it does in one line.
- No placeholder or decorative element reads as clickable when it is not (the "Transcript" badge problem from section 4 must not recur in the new design).
- Every touch target in the redesigned list and detail is at least 44px tall at 375px, matching CLAUDE.md's mobile rule.
