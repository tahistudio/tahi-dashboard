# Port plan: sales-pipeline (Leads, Calls, Deals)

Status: plan only, nothing built. Written 2026-09-26 for Liam's instruction "build the designs in the app following the UI/UX patterns used elsewhere; ships as ported, unchecked". Existing primitives and patterns win where the prototype differs. Docs Hub is locked and untouched by this plan. No migration anywhere in this plan.

## Sources read

- Review doc: docs/superpowers/plans/2026-09-14-design-review-for-liam.md, section "sales-pipeline" (51 page keys, first pass FIX, final critic verdict SHIP). There are no "still open" critic FIX items for this module. The designer's own left-out items (the Leads bulk bar scrolling sideways at 375, the lead and call tables scrolling sideways at 768 with no cue) and five questions are resolved or carried below.
- Requirements: docs/superpowers/design/requirements/studio-leads.md, studio-deals.md, studio-calls.md (the Calls pages are drawn in this module, not in ops), and DESIGN-BRIEF-2026-09-13.md.
- Design files, read through the claude-design MCP from project 57bf60cf-5e6d-450f-9e2f-e25c8d12fd66: previews/sales-pipeline-preview.html (the page key table), sales-pipeline.jsx (now only a loader), sales-pipeline-kit.jsx (Pop, Menu, Picker, SlideOver, Modal, EmptyState, ErrorState, ScopeNote, StatBand, StatBandBlank, EdgeScroll, Th, Timeline), sales-pipeline-leads.jsx (Leads, LeadRow, LeadCard, BulkBar, LeadDrawer, ReplyDraft, ImportPanel, ToolPanel, LeadDetail), sales-pipeline-calls.jsx (Calls, UpNext, CallRow, CallCard, LinkedToPanel, CallPeek, ScheduleCall, CallDetail), sales-pipeline-deals.jsx (Deals, Board, DealCard, DealList, DealPeek, CloseDialog, StallDialog, NewDeal, DealDetail, NudgeDialog, LogActivity), sales-pipeline-kit.css in full, and the vocabulary head of sales-pipeline-data.jsx (sources, lead statuses, score bands, call types, outcomes, stages). sales-pipeline.css (the 75 KB base sheet) was not read line by line; the kit sheet documents every geometry the critic measured.
- Live code: app/(dashboard)/leads (page.tsx, leads-content.tsx, [id]/page.tsx, [id]/lead-page-content.tsx), app/(dashboard)/calls (page.tsx, calls-content.tsx, unlinked-call-notes.tsx), app/(dashboard)/deals (page.tsx, deals-content.tsx, [id]/page.tsx, [id]/deal-detail.tsx), the reference compositions app/(dashboard)/clients/client-list.tsx with _list/clients-rail.tsx and app/(dashboard)/requests/[id]/request-detail.tsx, and the primitives components/tahi/rail/*, kpi-strip.tsx, data-table.tsx, bulk-action-bar.tsx, data-state.tsx, board-scrollbar.tsx, prompt-dialog.tsx, menu.tsx, tahi-button.tsx, sidebar-card.tsx. API routes read only for their data: admin/leads (GET, [id], bulk-actions, rescore-all, triage-pipeline, backfill-fields, bulk-import), admin/calls/index, admin/discovery-calls/[id], admin/cron/pre-call-digest, admin/integrations/google/sync-drive-transcripts, admin/deals (GET, [id]/nudges), admin/pipeline/stages, db/schema.ts (leads, deals, pipeline_stages, discovery_calls), lib/pipeline-math.ts.

## Routes and audience

Studio only. /leads, /leads/[id], /calls, /deals, /deals/[id]. Every page.tsx already redirects clients and Client-view previews server side and calls requirePageFeature; nothing in this plan changes a guard. The design's /calls/[id] full call page does not exist live and is not built (see skipped).

## Facts from the code that change what the design can honestly say

1. Leads have no access scoping. GET /api/admin/leads is gated on the leads feature only and returns every lead, promoted or not. The design's leads-scoped banner ("anything already promoted follows its client's access rule") would be false.
2. Leads have no next step column. A lead "Next step" (label and date) would need a migration; the requirement leaves it to Liam (studio-leads Q5).
3. POST /api/admin/leads/rescore-all has no dry run. It scores up to 25 leads a call and says to re-call until scored is 0. triage-pipeline is a dry run unless ?dryRun=false. backfill-fields dry runs with ?dryRun=1 and says to loop until updated is 0.
4. POST /api/admin/leads/bulk-actions supports archive (with payload.reason), rescore (queues for the cron, does not score inline), assign_owner, set_status and delete, and refuses delete unless payload.confirm is the string DELETE.
5. The live bulk import is already the full paste, map, dry run preview, import flow. Only the chrome differs from the design.
6. Lead promote redirects to /deals?deal=ID, and /deals never reads the deal param, so the promote lands on the board with nothing opened.
7. GET /api/admin/calls/index returns no attendees, no summary, no digest-sent flag and no total for a scoped caller. It reads a fixed window of 60 days back and 60 days ahead. The pre-call digest cron sends 25 to 35 minutes before any scheduled discovery call and records a call_digest_sent activity; the index does not expose it.
8. The live call types are six (discovery, client, partnership, mentoring, other, unclassified; lib/calls.ts). The design draws four.
9. discovery_calls has no locked column. Since 2026-09-19 the calendar sync already keeps a hand-set type when the call has no parent link.
10. GET /api/admin/deals is capped at 100 a page (default 50; the page asks for 100), returns no total, excludes archived deals unconditionally, and does not select nextActionLabel or nextActionDueAt. It does accept page=N.
11. Stalled is a live pipeline stage (isClosedLost 1). Moving a deal to Won or Lost on the board asks for a won source or a lost reason; moving it from the detail page's stage select does not ask for either.
12. The deal detail's Auto Nudges button renders the BellOff icon in both states; nothing in the codebase sends an automatic nudge or sends a scheduled one.
13. GET /api/admin/pipeline/stages returns historicalProbability and dealsSampled per stage; lib/pipeline-math effectiveProbability prefers the historical figure.
14. Live files carry em and en dashes (about 50 across the five files, including placeholder cells printing an em dash, the lost-reason descriptions, the tighten-range dialog and two metadata titles), fallback hex inside var() on the deal detail, and single-side borders on the deals loading skeleton. All of these go in the port.

## Page key by page key: what matches and what differs

### Leads list (sales-pipeline-leads.jsx Leads)

- leads (ready): live has a bespoke h1 block instead of PageHeader, no summary band, a flat FilterBar (status, source, search), a DataTable with Lead, Status (inline edit chip), AI score, Site, Source, Estimate, Owner, Updated, no selection, row actions Quick view, Edit, Promote, Delete. Design: PageHeader with Studio tools, Bulk import and New lead; a four tile band (Warm 60 and up, New this week, Gone quiet, Promoted); a rail with Views (Working set, All leads, one per status, with counts), Filters (Owner, Score, Source) and Sort; a selectable table with Lead, Score (number plus four segment meter), Status, Source, Next step, Owner, Touched (tone by age); a row menu with AI briefing, Open lead, Schedule a call, Promote, Archive with a reason, Delete. Port the composition; keep Estimate instead of Next step.
- leads-loading: live shows the DataTable skeleton only. Differs.
- leads-empty: live matches in intent ("No leads yet" with New lead). Design adds a secondary Bulk import action.
- leads-filtered: live says "No matches" with no way out. Design adds Clear filters and a cue that promoted and archived leads are hidden by the default view.
- leads-error: not live (a failed read renders as no leads). Design blanks the band, drops the counts and shows a retry card.
- leads-selection: not live (the table is not selectable, the bulk API is unreachable).
- leads-briefing: live Quick view is a slide-over with the full lead body including calls and activity. Design's peek is briefing first: score dial, band, reason, enriched time and token spend, Re-run AI, suggested-fields banner, Briefing, Discovery questions, Company signals, Sources, footer Open full lead and Promote. Differs in order and emphasis.
- leads-import: live matches in function (paste, map with auto detect, default source, skip duplicates, dry run preview, import). Chrome and copy differ.
- leads-tools: not live (no entry point to rescore-all, triage-pipeline or backfill-fields).
- leads-promote: live ConfirmDialog matches in function; copy differs; the redirect lands on the wrong place (fact 6).
- leads-scoped: not live and not built (fact 1).

### Lead workspace (LeadDetail)

- lead (ready): live has Breadcrumb, a bespoke header with native select quick pickers, a 2fr/1fr grid of hand-rolled PageCards: AI briefing, AI first reply, Discovery call, Activity, Timeline in the main column and Person, Company, Source, Brief in the side. Design: back link, hero (avatar, name, company, role, touched, status and owner menus, score chip with sparkline), actions Edit, Re-run AI, Promote to deal, More; the request-detail composition with rail cards. Matches in content; differs in composition and pickers.
- lead-edit: live edit in place matches in function.
- lead-reply: live AI first reply (draft, edit subject and body, send, regenerate, dismiss, token spend) matches in function and is richer than the design's stub.
- lead-unenriched: live hides the AI card entirely; design keeps the card with a "Not researched yet" empty state and Run AI.
- lead-loading: live prints "Loading lead...". Differs.
- lead-error: live prints "Lead not found." for both a 404 and a failed read. Differs.

### Calls list (sales-pipeline-calls.jsx Calls)

- calls (ready): live has PageHeader with Sync calendar, the Unlinked call notes section, hand-rolled Upcoming and Past tabs with counts, a FilterBar (Type and search), a DataTable with a mobile card, row actions (Open Meet link, Open lead, Mark as each other type) and the call details slide-over. Design adds an Up next card, a four tile band (Upcoming, Needs triage, No outcome yet, Calls on record naming the window), a triage banner with Show them, a rail (Views by type with counts, Filters, a note on what is in the list), and an Outcome column on Past.
- calls-past: live never shows the outcome it already fetches. Differs.
- calls-details and calls-details-set: live slide-over matches the design's shape (title, what it is for, the four link rows through LinkedToPanel, per field saves, error banner that keeps the panel open) and adds the Prep note the design lacks. Design adds a lock switch (not built) and a read-only "What came out of it" card.
- calls-schedule: not built (studio-calls Q5).
- calls-loading: live DataTable skeleton; band and counts missing. Differs.
- calls-empty: live matches (No calls yet, Sync calendar).
- calls-filtered: live has "No calls match" without Clear filters. Differs.
- calls-error: not live (false empty). Differs.
- calls-scoped: not built (proposal; the API returns no total).
- call, call-extract, call-no-transcript, call-unlinked, call-loading, call-error: the full call page. Not live and not built (studio-calls Q1). Outcome, transcript, extraction and action items stay where they are today, in DiscoveryCallsCard on the call's lead, deal, request, task or client page.

### Deals board and list (sales-pipeline-deals.jsx Deals)

- deals (board): live titles the page "Sales Pipeline" with a hand-rolled New Deal button, a five cell KPIStrip, a toolbar (search, ViewToggle, a Filters toggle that opens a panel), every stage as a column including Stalled, Won and Lost, a scroller with the scrollbar hidden, cards that link through the /pipeline redirect, no card menu. Design: PageHeader "Deals" with the view switch and New deal; four tile band; rail filters; count naming deals and stages; column headers with count, value, odds (actual or set) and a weighted meter; cards with value and confidence dot, touched stamp, title, company and source, next action chip, owner, expected close, a menu with Open deal and Move to (every stage); an edge affordance on the sideways scroll.
- deals-list: live ListView paginated at 10 with a persisted sort key. Design: Deal (next action sub line), Company, Stage pill, Value, Odds, Owner, Expected close, Touched, row menu; phone cards.
- deals-stalled: not built (MC.6).
- deals-capped: not live (fact 10). Built as a banner that appears only when a full page of 100 comes back.
- deals-peek: not built (studio-deals Q4).
- deals-new: live NewDealDialog is richer (company search, exchange rates, ranges) and wins; restyle only.
- deals-loading: live bespoke column skeleton with a single-side top border. Differs.
- deals-empty: live shows "No deals" inside every column on the board and a separate card on the list. Design: one EmptyState with New deal and Go to leads. Differs.
- deals-filtered: not modelled live (renders the no-deals state). Differs.
- deals-error: not live (false empty). Differs.
- deals-scoped: not built (proposal).

### Deal cockpit (DealDetail)

- deal (ready): live has a back link, a 2/3 plus 1/3 grid, the title plus StageProgress, DiscoveryCallsCard, Activity timeline, Notes, AssociatedRequests in the main column, and in the side DealSalesKit, EngagementHealthCard (gated) and one outer card of sections (Stage select, Next action, Convert to client, Value, Owner, Company, Client Lifetime Value, Lead source, Days in stage, Expected close, Engagement, Auto Nudges in Stalled, Capacity impact, Contacts, Dates, Danger zone). Design: hero (org tile, title, company, stage pill, value, weighted value; Nudge, Book a call, New document or Convert to client), main (Stage card with clickable stage pills and odds, Won and Lost actions, next action inline; Value card; Calls; Activity with Nudge and Log activity; Requests from this company), rail (Sales kit, Nudges, Delivery health, Contacts, Details, Client lifetime value, Danger zone). Every live capability is present in the design except Engagement, Capacity impact, Notes and Auto Nudges, which the port keeps as their own cards.
- deal-stalled: not built (MC.6); the live Stalled stage behaviour stays.
- deal-nudge: live NudgeDialog (templates, recipients, send now or schedule) matches in function; the design's copy is honest about the saved option and the port adopts the copy only.
- deal-stall: not built.
- deal-close: board only live (fact 11); the port adds it to the detail.
- deal-loading: live skeleton matches in intent; realign to the new grid.
- deal-error: live "Deal not found." covers a 404 only. Differs.

## Critic FIX items and designer left-outs, resolved in the slices

The critic's final verdict is SHIP with nothing still open. The review's residue is resolved by the app's own primitives:
- Leads bulk bar at 375 (five actions scrolling sideways): the port uses BulkActionBar, which keeps one primary action and collapses the rest into one Edit menu, which is the designer's "collapse into one Actions menu" option. Slice leads.
- Lead and call tables at 768 scrolling sideways with no cue: below 768 (md) both tables render DataTable mobileCard rows; at 768 and up the table scrolls inside its own Card like every other list page. The tablet sidebar question stays with Liam. Slices leads and calls.
- Live figures beside a failed read (the systemic first pass finding): every error state renders the KPIStrip with "--" values and "Not available" sub lines, RailLayout countOverride "Could not load", view counts null. Slices leads, calls, deals-board.
- Board "lost a column" (Pass 3): the deals board gets BoardScrollbar above the scroller and the count names the stage total. Slice deals-board.
- NEXT STEP clipping and Owner and Touched loss (Pass 3): Next step is not built; Owner and Touched are fixed-width DataTable columns and the table scrolls rather than dropping them. Slice leads.
- Row menu clipped at the table's right edge (Pass 3 Calls): the app's DataTable rowActions and Menu already portal; nothing to port.

## Slices

Four slices with disjoint owned files. Order: leads, calls and deals-board can run in parallel; deal-detail starts after deals-board has merged, because it imports the shared close dialog that deals-board creates (read only). No slice adds a route, a migration or an MCP tool. One slice (deals-board) adds two fields to an existing GET select.

### Slice 1: leads (4 days, backend no, migration no)

Owned files: app/(dashboard)/leads/page.tsx, app/(dashboard)/leads/leads-content.tsx, app/(dashboard)/leads/[id]/page.tsx, app/(dashboard)/leads/[id]/lead-page-content.tsx, app/(dashboard)/leads/_kit/* (new: lead-types.ts, lead-vocab.ts, lead-briefing.tsx, leads-rail.tsx, lead-mobile-card.tsx, lead-quick-view.tsx, lead-form.tsx, bulk-import-panel.tsx, studio-tools.tsx), lib/lead-list.ts (new), lib/__tests__/lead-list.test.ts (new).

### Slice 2: calls (2 days, backend no, migration no)

Owned files: app/(dashboard)/calls/page.tsx, app/(dashboard)/calls/calls-content.tsx, app/(dashboard)/calls/unlinked-call-notes.tsx, app/(dashboard)/calls/_kit/* (new: calls-rail.tsx, call-detail-slideover.tsx, call-mobile-card.tsx, up-next-card.tsx), lib/calls-index.ts (new), lib/__tests__/calls-index.test.ts (new).

### Slice 3: deals-board (3 days, backend yes, migration no)

Owned files: app/(dashboard)/deals/page.tsx, app/(dashboard)/deals/deals-content.tsx, app/(dashboard)/deals/_board/* (new: deal-types.ts, deals-rail.tsx, deal-board.tsx, deal-card.tsx, deal-list.tsx, deal-mobile-card.tsx, new-deal-dialog.tsx), components/tahi/deals/deal-close-dialog.tsx (new), lib/deals-board.ts (new), lib/__tests__/deals-board.test.ts (new), app/api/admin/deals/route.ts (GET select only, additive).

### Slice 4: deal-detail (3.5 days, backend no, migration no)

Owned files: app/(dashboard)/deals/[id]/page.tsx, app/(dashboard)/deals/[id]/deal-detail.tsx, app/(dashboard)/deals/[id]/_kit/* (new: deal-detail-types.ts, deal-hero.tsx, stage-card.tsx, value-card.tsx, activity-card.tsx, nudges-card.tsx, nudge-dialog.tsx, details-card.tsx, engagement-card.tsx, danger-card.tsx, deal-detail-states.tsx). Imports components/tahi/deals/deal-close-dialog.tsx from slice 3 read only.

## Slice briefs

### leads

Follow Claude Design sales-pipeline-leads.jsx (Leads, LeadRow, LeadCard, BulkBar, LeadDrawer, ImportPanel, ToolPanel, LeadDetail) and sales-pipeline-kit.css sections 4 to 6. Page keys: leads, leads-loading, leads-empty, leads-filtered, leads-error, leads-selection, leads-briefing, leads-import, leads-tools, leads-promote, lead, lead-edit, lead-reply, lead-unenriched, lead-loading, lead-error (preview: previews/sales-pipeline-preview.html?page=KEY, add &theme=dark and &device=phone).

Reference compositions to copy, not reinvent: app/(dashboard)/clients/client-list.tsx and _list/clients-rail.tsx (PageHeader, RailLayout with rail and railTouch, DataTable with selectable, mobileCard and rowActions, BulkActionBar, the hard error and stale error branches), components/tahi/tasks/tasks-rail.tsx, app/(dashboard)/requests/[id]/request-detail.tsx (Breadcrumb, hero, grid lg:grid-cols-[minmax(0,1fr)_20rem], SidebarCard from components/tahi/rail/sidebar-card.tsx, InlineMenuField from components/tahi/inline-field.tsx). Primitives: PageHeader, KPIStrip plus KPICell, SkeletonKPIStrip, SkeletonTable, SkeletonCard, RailLayout, RailViewItem, RailSelect, RailGroupLabel, buildRailChips, DataTable, Card, EmptyState, BulkActionBar, SlideOver, ConfirmDialog, PromptDialog, Menu, TahiButton (primary carries the leaf radius), Badge, Avatar, Input, Callout, useToast, DiscoveryCallsCard (shared, do not edit), Breadcrumb.

Refactor first, behaviour second. Move LeadForm, BulkImportPanel, the Lead and related types, STATUSES, SOURCES and the briefing renderers (BriefingSummary, SignalRow, SourcesToggle, QuestionGroup, the workspace's BriefingBody, SignalsList, NumberedList, ScoreHistorySparkline) out of the two page files into app/(dashboard)/leads/_kit so the quick view and the workspace render the AI briefing from one component (requirement acceptance 4). Keep every live behaviour: the ?lead=ID deep link opening edit, the re-enrich prompt after a website or company change with Don't ask again, apply suggested fields, promote a call to a deal, owner and status quick pickers on the workspace, the AI first reply loop, the activity composer with Cmd or Ctrl plus Enter.

Pure helpers in lib/lead-list.ts with Vitest tests: matchesLeadFilters(lead, filters), leadBandCounts(leads, now), touchedTone(iso, now) returning 'fresh' under 3 days, 'ageing' under 10, 'stale' beyond (mapped to brand, warning and danger tokens in the UI), scoreBand(score) with the existing 80, 60, 40 cutoffs.

List (/leads):
- PageHeader title "Leads", subtitle "Everything that has raised a hand, scored and briefed before you pick up the phone." Actions: a Studio tools Menu (ghost trigger with a sparkle icon), Bulk import (secondary), New lead (primary). All at least 2.75rem tall on touch.
- KPIStrip desktopCols 4, computed from the loaded set: Warm, 60 and up (open leads, meaning new, qualifying or nurturing, with aiScore at least 60; sub "of N open leads"), New this week (created in the last 7 days; sub "N not scored yet" or "All scored"), Gone quiet (qualifying and untouched for 7 days; danger tone when above zero; sub "Qualifying, nothing in 7 days"), Promoted (status promoted; sub "N in the last 30 days" from promotedAt). No money claim on the Promoted tile: the list read carries no deal values. If the read returns 1000 rows (the route default limit) add one line under the strip saying the figures cover the 1000 loaded.
- Rail (rail and railTouch): Views as RailViewItem rows with counts from the loaded set: Working set (new, qualifying, nurturing; the default), All leads, then one per status. Filters as RailSelect: Owner (Any owner plus team members from /api/admin/team-members), Score (Any, 80 and up, 60 and up, 40 and up), Source (Any plus the live SOURCES list). Sort: RailSelect Last touched, AI score, Estimate, Company, Name, with a direction control as the tasks rail does it. Chips through buildRailChips. Search through RailLayout query (name, email, company, brief), itemNoun "lead".
- A quiet cue under the toolbar when promoted or archived leads are hidden by the view: "N promoted or archived leads are hidden by this view." with a Show them button (sets All leads).
- DataTable selectable with selectedIds and onSelectionChange, defaultSort Touched descending, columns: Lead (avatar, name, company and email sub line, data-private, ellipsis inside a min-width 0 cell), AI score (number plus the four segment meter drawn with tokens; unscored reads "Not scored" in subtle text, never a dash), Status (the live edit chip, optimistic PATCH then revalidate), Source (label), Estimate (live formatMoney), Owner (avatar plus first name, "Unassigned" when none), Touched (relative time coloured by touchedTone). No Site column: the website becomes a row action. Row click keeps navigating to /leads/[id]; onRowPreview opens the quick view.
- Row actions: AI briefing (quick view), Open lead, Edit, Open website (only when set), Schedule a call (navigates to /leads/[id]#calls; give the DiscoveryCallsCard wrapper id="calls" in the workspace), Promote to deal (hidden once promoted), Archive with a reason (PromptDialog, then PATCH status archived plus archiveReason; the reason is optional), Delete (ConfirmDialog).
- mobileCard below md (lead-mobile-card.tsx): avatar, name, company, score chip, status and source badges, owner, touched, a Select checkbox inside a 2.75rem label, and an AI briefing button. The whole card opens the lead. No hover-only affordance.
- BulkActionBar when anything is selected, itemNoun "lead". Primary action Re-score (POST bulk-actions rescore; successMessage "N leads queued for a re-score. The daily AI run scores them."). Edit menu sections: Owner (one item per team member, assign_owner), Status (one per status, set_status), Danger: Archive (confirm, sends reason "Bulk archived") and Delete. Delete must stay a typed confirmation: open a PromptDialog that asks the user to type DELETE, and only then POST with payload.confirm set to what they typed; cancelling shows no toast. If BulkActionBar cannot express that without a false toast, render Delete as a separate danger button beside the bar. Clear the selection and revalidate after every action. Respect the 500 id cap (split larger selections into batches of 500).
- Studio tools (studio-tools.tsx), one SlideOver or centred dialog per tool, dry run first wherever the route has one:
  - Re-score every lead: explain that it re-runs the cheap scoring model over every lead that is not archived or promoted and that there is no preview for this one. Start runs POST /api/admin/leads/rescore-all in a loop until scored is 0, showing "N scored so far" and the latest samples, with a Stop button and a hard cap of 60 calls. Report errors by lead.
  - Find deals that should be leads: POST /api/admin/leads/triage-pipeline (dry run by default) and list every candidate with its reason (in the Lead stage, or Stalled with no proposal and no contract). Only then offer "Move N deals back to leads" as a danger button behind a ConfirmDialog saying the deal rows are deleted and organisations kept, which calls ?dryRun=false.
  - Backfill company fields: POST ?dryRun=1 and show scanned, would update, skipped and the sample diffs; then "Write N rows" loops the real call until updated is 0.
- New lead and Edit: keep the live SlideOver and LeadForm; restyle only.
- Bulk import: keep the live panel, its API contract and its phases; restyle to the design's layout (a summary line "N rows parsed, N columns found, N errors", the mapping grid, the preview table, the note "Every imported lead lands as New and unscored. The daily AI run scores them overnight."). The 2,000 row cap copy stays.
- Quick view (lead-quick-view.tsx), the design's LeadDrawer order: score (a ring or the score chip at size lg) with band label and reason, "Enriched X ago" or "Never enriched" and the real token count, Re-run AI, the suggested-fields banner with Apply all (live applySuggestions), Briefing (Snapshot, Why they might fit, Watch-outs, falling back to prose for legacy summaries), Discovery call questions (the always ask template plus the AI questions), Company signals with each claim's source link or a no-source marker, Sources toggle. Footer: Open full lead, Edit, Delete, Promote to deal (primary). The calls card and the activity list move to the full page only (one click away). No Draft reply in the quick view (Liam question).
- Promote: keep the ConfirmDialog; copy "A prospect organisation for COMPANY, a contact and a deal in the first stage. The lead flips to Promoted and keeps its briefing." On success navigate to /deals/DEALID (not /deals?deal=), in both the list and the workspace and in promoteCallToDeal.

Workspace (/leads/[id]):
- Breadcrumb Leads, then the name. Hero: leaf-radius avatar, name (data-private), company, job title, "Touched X ago"; status and owner as InlineMenuField style pickers (not native selects), always editable; the score chip with the live sparkline. Actions: Edit, Run AI or Re-run AI (with Researching state), Promote to deal (primary, hidden once promoted), a More menu with Schedule a call (scrolls to #calls), Archive with a reason, Delete. Below lg the actions become Promote plus the More menu (which also carries Edit and Run AI).
- Grid lg:grid-cols-[minmax(0,1fr)_20rem]. Main: AI briefing card (reason, the three blocks, Company signals, Sources as chips, sub line "Enriched X ago, N tokens spent"; when not enriched an inline EmptyState "Not researched yet" with Run AI), AI first reply card (only with an email; live loop unchanged), Discovery call card (always ask plus AI questions, or the note that questions appear after the AI runs), DiscoveryCallsCard (id calls), Activity card (composer plus the timeline; empty "Nothing logged yet"). Rail (SidebarCard): Person, Company (every 0047 firmographic field in view and edit), Source and estimate (source, detail, affiliate code, estimate, archived reason), Brief, and a Promoted card with Open deal when promotedDealId is set.
- Enrich and save errors as a danger Callout under the hero.

States: list loading (SkeletonKPIStrip plus SkeletonTable, RailLayout loading, rail counts null), empty (EmptyState with the leaf icon, "No leads yet", "Capture the first one by hand, or let the Webflow form and your referrals fill this in.", CTA New lead, secondary Bulk import), filtered to nothing (inline EmptyState "No leads match", Clear filters), error (make the SWR fetcher throw on a non-ok response; KPIStrip values "--" with sub "Not available", countOverride "Could not load", counts null, a Card with an inline EmptyState "Your leads did not load", "Nothing has changed, so a retry is safe.", Try again; when rows are already in hand keep them and show the stale banner as Clients does), populated, selection, each tool's running, dry run result, applied and failed states. Workspace loading (SkeletonCard blocks in the same grid), not found (a 404 read shows "This lead is not here" with Back to leads), error (any other failure shows Try again), unenriched, edit, reply draft.

375 and dark: no horizontal page scroll (the table only scrolls inside its Card at md and up; below md cards), every control at least 2.75rem on touch, the rail sheet from RailLayout. Tokens only (the score meter, the touched tones and the status badges must change under .dark), rem units, no single-side borders, no hardcoded hex. Remove every em and en dash in both files, including placeholder cells and the metadata titles ("Leads - Tahi Dashboard", "Lead - Tahi Dashboard").

Do not build: a Next step column or card, a leads scoped banner, Draft reply inside the quick view, a merged source vocabulary, a Paste a sample button, Schedule a call as a modal on the list, changes to DiscoveryCallsCard or any API route.

### calls

Follow Claude Design sales-pipeline-calls.jsx (Calls, UpNext, CallRow, CallCard, LinkedToPanel, CallPeek) and sales-pipeline-kit.css sections 1, 3 and 6. Page keys: calls, calls-past, calls-details, calls-details-set, calls-loading, calls-empty, calls-filtered, calls-error.

Primitives: PageHeader, KPIStrip plus KPICell, SkeletonKPIStrip, SkeletonTable, RailLayout, RailViewItem, RailSelect, RailGroupLabel, buildRailChips, SegmentedControl (the Upcoming and Past switch as the RailLayout switcher, as Clients does its view switcher), DataTable with mobileCard, onRowPreview and rowActions, Card, EmptyState, Callout, SlideOver, LinkedToPanel (shared, do not edit), Menu, TahiButton, Badge, useToast, useFeature. Vocabulary from lib/calls.ts (MEETING_TYPES, MEETING_TYPE_META; read only).

Pure helpers in lib/calls-index.ts with Vitest tests: splitByNow(rows, now) using real Date comparison (the index comment explains why), callBandCounts(rows, now), matchesCallFilters(row, filters), nextUpcoming(rows, now).

- Move CallDetailSlideOver and CallMobileCard out of calls-content.tsx into _kit unchanged in behaviour (per field saves, the prep note with its 4,000 character cap, the ?call=ID&focus=prep deep link, the error banner that keeps the panel open).
- PageHeader title "Calls", subtitle "Every discovery, check-in and partnership call from your calendar, with what came out of it." Actions: a Sync Menu (secondary trigger) with Calendar (the live sync; toast the real created and updated counts) and, only when useFeature('settings.integrations') is true (the route is gated on it), Gemini transcripts (POST /api/admin/integrations/google/sync-drive-transcripts; read the route for its response and toast the real matched and parked counts; revalidate the index and the unlinked notes).
- Up next card (up-next-card.tsx) for the soonest upcoming call that is not cancelled: "Up next" or "Starting soon" within 35 minutes, title, when, duration, what it is linked to, Join (primary, only when googleMeetUrl), Call details (opens the slide-over). When the call has a leadId, fetch /api/admin/leads/LEADID once and, if the lead is enriched, show a "Before the call" block (score, the fit and watch-out lines from the briefing, the first three questions). Hide the block silently on any failure or when not enriched. No digest pill and no email-me button (fact 7). Not rendered while loading, on error, or when nothing is upcoming.
- KPIStrip desktopCols 4 from the loaded index: Upcoming (sub "Next: TITLE" or "Nothing booked"), Needs triage (meetingType unclassified or null; danger tone above zero; sub "We could not place them from the calendar"), No outcome yet (past calls not cancelled and without an outcome; warning tone above zero), Calls on record (sub "The last 60 days and the next 60"). The window is named here, which is the honest fix for the invisible 60 days.
- Triage Callout (warning) when Needs triage is above zero: "N calls need triage. We could not match them to a lead, deal or client." with Show them (sets the Type filter to Needs triage).
- Keep UnlinkedCallNotes where it is (it renders nothing on a normal day); give it a token, rem and 44px pass only.
- Rail: Views, one RailViewItem per live meeting type plus "Every kind", counts for the current tab. Filters: Outcome (Past tab only: Any, Not captured, each outcome from the live vocabulary). A short note under the rail: "Calendar calls from the last 60 days and the next 60. Check-ins booked by hand on a client page are not folded in yet." Search through RailLayout (title, lead, deal, client, request), itemNoun "call".
- DataTable columns: Call (type icon tile, title, type badge, a non-interactive Transcript badge whose title says the transcript is read on the lead, deal or client page), When (date and time, relative, duration), Linked to (lead, then deal, then client, then request, linking to its page; "Unlinked, needs triage" in warning text), Prep on Upcoming ("Prep note" badge or "No prep note" subtle) or Outcome on Past (the outcome badge or "Not captured" in warning text), Status. Row actions: Call details, Open Meet link, Open lead, Open deal, Open client (whichever exist), then the live Mark as actions for every type except the current one.
- Slide-over additions: a read-only "What came out of it" section (the outcome badge, or "It has not happened yet" or "Nothing captured yet") and one note with a link: "The outcome, transcript and AI extraction are recorded on the LEAD or DEAL or CLIENT page." linking to that parent, or "Link this call to a lead, deal or client to record what came out of it." when unlinked.
- mobileCard below md: the live CallMobileCard restyled to the design's CallCard (type tile, title, when, type and outcome badges, linked-to line, Open details), every target 2.75rem.

States: loading (SkeletonKPIStrip, SkeletonTable, rail counts null, tab counts hidden), empty (EmptyState phone icon "No calls yet", the live copy, CTA Sync calendar), filtered to nothing (inline EmptyState "No calls match", "Try the other tab or clear the search.", Clear filters), error (fetcher throws on non-ok; KPIStrip blanked, countOverride "Could not load", no triage banner, no Up next, error card with Try again), populated, slide-over saving and failed per field, sync running and failed.

375 and dark: no horizontal page scroll, 44px targets including the tab switch and the Sync menu items, tokens only (the type tiles and the triage callout in .dark), no hardcoded hex, rem only, remove the em dashes in toasts and the "Unlinked, triage" label.

Do not build: the full /calls/[id] page, the lock switch or lock pin, a date range control, Schedule call, the pre-call digest pill or send button, a delete action (a synced call would come back on the next sync), folding scheduled_calls in, the scoped banner.

### deals-board

Follow Claude Design sales-pipeline-deals.jsx (Deals, Board, DealCard, DealList, CloseDialog, NewDeal) and sales-pipeline-kit.css sections 2, 4, 5 and 6. Page keys: deals, deals-list, deals-capped, deals-new, deals-loading, deals-empty, deals-filtered, deals-error.

Primitives: PageHeader, KPIStrip plus KPICell, SkeletonKPIStrip, SkeletonTable, RailLayout, RailSelect, RailGroupLabel, buildRailChips, ViewToggle or SegmentedControl as the RailLayout switcher, BoardScrollbar, DataTable (optional for the list) or the live ListView restyled, Pagination and usePagination (keep the list at 10 a page), Card, EmptyState, Callout, Menu, TahiButton, Badge, Avatar, Input, useDisplayCurrency, useUserPreference (keep pipeline.viewMode and pipeline.sortKey), lib/pipeline-math (calculatePipelineTotals, effectiveProbability, formatDealValue, formatDealValueSplit, rangeConfidenceLevel), lib/chart-colors (stageColour, sourceBadge).

Backend (additive only): in app/api/admin/deals/route.ts GET, add nextActionLabel and nextActionDueAt to the select. Nothing removed, nothing renamed, no new query parameter. Overview, reports, the calculator and the MCP list_deals tool read this route and ignore unknown fields; confirm by searching for consumers. If an API test covers this route, extend it.

Refactor first: move NewDealDialog, the Deal and stage types, the card, the board and the list out of deals-content.tsx into app/(dashboard)/deals/_board. Move DealCloseDialog with LOST_REASON_OPTIONS and WON_SOURCE_OPTIONS into components/tahi/deals/deal-close-dialog.tsx and export them (slice deal-detail imports it); strip the em dashes from the reason descriptions. Keep the ?new=1&orgId= deep link (the clients module relies on it).

Pure helpers in lib/deals-board.ts with Vitest tests: matchesDealFilters, dealValueLabel (wrapping the pipeline-math formatters), isPageFull(rowsReturned, limit), mergePages.

- PageHeader title "Deals" (not "Sales Pipeline"), subtitle "The pipeline, weighted on how these stages have actually converted." Action: New deal (TahiButton primary). The board and list switch sits in the RailLayout switcher slot.
- KPIStrip desktopCols 4, all through useDisplayCurrency: Total pipeline (sub "NZ$X upfront plus 12 months of retainer", using DEFAULT_FORECAST_HORIZON_MONTHS rather than a hardcoded 12), Weighted forecast (sub "N% of the pipeline, by how each stage has converted"), Pipeline MRR (sub "Retainer inside open deals"), Open deals (sub "N in view", plus "N parked in Stalled" when the Stalled stage holds any). Upfront folds into the first sub line.
- Rail: Filters as RailSelect Owner (Any plus team) and Source (Any plus the live SOURCE_LABELS), and a Value range group with two Input fields (From, To) at rail width. Sort (list only): Last touched, Value, Expected close, Title, Stage. Chips via buildRailChips including the value bounds. Search via RailLayout (title and company), itemNoun "deal". Count override on the board: "N deals across M stages".
- Capped banner: when the deals read returns a full page of 100, show an info Callout "Showing the first 100 deals. The figures above cover those 100, not the whole pipeline." with Load the rest, which fetches page=2, 3 and so on until a short page, merges them, and recomputes every figure. Never show it otherwise.
- Board (deal-board.tsx): keep every live stage as a column (dropping a card on Won or Lost is how the board closes a deal). Wrap the scroller with BoardScrollbar (scrollerRef, data-board-column on each column, signature from the deal count) and remove scrollbar-hide. Column header: stage dot, name, count, the column's value, and the odds from effectiveProbability labelled "actual" when historicalProbability is set (tooltip: "N% of deals that reached STAGE have been won, across M deals") or "set" otherwise (tooltip names the settings value), and a thin weighted meter. Empty column: "Nothing in STAGE" in subtle text. Drag and drop, the optimistic move with revert, and the close dialog on a closed column all stay as live.
- Card (deal-card.tsx): value label with the live confidence dot, the live touched stamp (title "Last change of any kind, not time in stage"), title (a link to /deals/ID, two lines then ellipsis), company and source badge, the next action with a DueDateChip when nextActionLabel is set, owner avatar, expected close. A Menu (2.75rem target on touch) with Open deal and a Move to section listing every stage; a closed stage routes through the close dialog. Keep the live Bell or BellOff glyph only for deals in the Stalled stage, with the correct icon per state.
- List (deal-list.tsx): Deal (title plus the next action sub line), Company, Stage (pill with the stage dot), Value, Odds (hidden below lg), Owner, Expected close (date plus relative), Touched, row Menu (Open deal, Move to). Every link goes to /deals/ID, not /pipeline/ID.
- Below md the page forces the list and renders deal-mobile-card.tsx (title, company, value that truncates rather than pushing the card wide, stage pill, source, owner, next action chip); the whole card opens the deal.
- New deal: the live NewDealDialog restyled; keep its fields, company search, exchange rates and range.

States: loading (SkeletonKPIStrip plus a board skeleton of token blocks with full borders only, or SkeletonTable on the list), empty (one EmptyState in a Card: trend icon, "No deals yet", "Promote a lead, or create a deal by hand. The board draws the stages set up in settings.", CTA New deal, secondary Go to leads; replaces the per column "No deals" and the list's own card), filtered to nothing (inline EmptyState "No deals match", Clear filters), error (fetcher throws when the deals read fails; a failed stages read still falls back to the live default stages; KPIStrip blanked, countOverride "Could not load", error card "The pipeline did not load. No figure above can be trusted. Nothing has changed." with Try again), capped, populated, drag in flight, close dialog submitting.

375 and dark: no horizontal page scroll (the board only scrolls inside itself and is replaced by the list below md), 44px targets including the card menu and the switcher, tokens only (stage colours are data and may stay raw; everything else through var(--color-*), no var() fallback hex), no single-side borders (the live skeleton and column tops use a 3px top border; replace with a dot or a full border), rem only, no dashes.

Do not build: Stalled as a flag, Mark stalled, Unstall, the Stall dialog, the Stalled and Active saved views, Include archived, the DealPeek quick look, the scoped banner, hiding empty Won and Lost columns.

### deal-detail

Follow Claude Design sales-pipeline-deals.jsx DealDetail, NudgeDialog, LogActivity and CloseDialog. Page keys: deal, deal-nudge, deal-close, deal-loading, deal-error. Starts after deals-board has merged; imports DealCloseDialog and the option lists from components/tahi/deals/deal-close-dialog.tsx and does not edit that file.

deal-detail.tsx is about 3,400 lines. Extract, do not rewrite: move the live sub components (StageProgress, StageSelector with its tighten-range guard, NextActionEditor, ValueBreakdown, ValueTrendline, EngagementEditor, ContactLinker, OrgSelector, OwnerSelector, SourceSelector, EditableDate, EditableNumber, NotesSection, NudgeDialog, ActivityFormDialog, AssociatedRequests, ConvertToClientCard) into app/(dashboard)/deals/[id]/_kit files, keeping their data flow, and then recompose. Write a parity checklist in the commit body of every live control and confirm each one still works.

Primitives: Breadcrumb, SidebarCard from components/tahi/rail/sidebar-card.tsx (the request detail rail card; the old SidebarCard plus SidebarSection pair stops being used on this page), Card, TahiButton, Menu, Badge, Avatar, Callout, EmptyState, SkeletonCard, SkeletonList, ConfirmDialog, useToast, Gate, DealSalesKit, EngagementHealthCard and DiscoveryCallsCard (all shared, used as is), DueDateChip, useDisplayCurrency.

- Breadcrumb Deals, then the title. Hero (deal-hero.tsx): leaf-radius company tile, title (data-private), company link, stage pill, the value label and "Weighted X" through effectiveProbability. Actions: Nudge (secondary; disabled with the reason "Link a contact first" when there are no contacts), Book a call (ghost; scrolls to the DiscoveryCallsCard wrapper id="calls", where scheduling already lives), and when the deal is closed won a primary Convert to client that runs the live convert handler (the live plan-type validation and error surfacing unchanged). No New document menu in the hero: the Sales kit card is the one place for it.
- Grid lg:grid-cols-[minmax(0,1fr)_20rem], rail stacks under lg.
- Main column:
  - Stage card (stage-card.tsx): the open stages as clickable pills with odds (the stage's historicalProbability labelled actual when present, else probability labelled set; do not call a set figure actual), the current one marked aria-current, scrolling inside the card on a phone. Clicking a pill runs the live handleChange with the tighten-range guard. Actions Won and Lost open DealCloseDialog and PATCH stageId (the won stage, or the lost stage that is not Stalled), status, and wonSource or lostReason, exactly as the board does. When a Stalled stage exists, a ghost "Park in Stalled" keeps the live ability to move there. The next action editor (live NextActionEditor) sits inside this card with the note "One line and one date. It is what the board card shows."
  - Value card (value-card.tsx): the live ValueBreakdown and ValueTrendline, with the live value change reasons, restyled into the design's value grid (Upfront, Monthly, Starts, twelve month total). Keep the live trendline; do not draw the design's fixed estimate history.
  - Calls: DiscoveryCallsCard with id="calls".
  - Activity card (activity-card.tsx): the live timeline with the per row delete confirm, actions Nudge and Log activity (live ActivityFormDialog).
  - Notes card (live NotesSection).
  - Requests from this company (live AssociatedRequests, its own skeleton and empty "Work raised for this company shows up here once the deal is won.").
- Rail (SidebarCard each): Sales kit (DealSalesKit), Nudges (nudges-card.tsx, new, reads GET /api/admin/deals/ID/nudges: subject, recipients, "Sent X ago" for sent, "Saved, not sent" with the date for draft or scheduled, "Failed" for failed; empty "No nudges yet"; when any saved ones exist, the note "A saved nudge waits on the deal. Nothing sends it on its own yet."), Delivery health (Gate feature deals.engagement_health around EngagementHealthCard), Contacts (live ContactLinker; empty "No contacts linked. A deal without a contact cannot be nudged."), Details (details-card.tsx: company via OrgSelector, owner via OwnerSelector, source via SourceSelector, expected close via EditableDate, days in stage, last touched, created, and the live Dates rows), Engagement (engagement-card.tsx: live EngagementEditor plus the Capacity impact read-out), Client lifetime value (only when ltv.total is above zero), Auto nudges (only in the Stalled stage; live behaviour and copy, with the icon fixed to Bell when active and BellOff when paused), Danger zone (danger-card.tsx: the live two step archive).
- Nudge dialog (nudge-dialog.tsx): the live dialog (templates from /api/admin/nudge-templates, recipients from contacts, subject, body, send now or the second option) restyled. Relabel the second option "Save it for later" with the helper "A draft on the deal. Nothing sends it automatically." and its date field "Date to note on the deal". Keep the live POST contract. Surface send failures (409 blocked, 500) inline with the server message, and when the mailer withheld addresses say which were delivered.

States: loading (SkeletonCard hero, SkeletonCard plus SkeletonList in main, SkeletonCard in the rail, same grid), not found (make the fetcher distinguish 404: "This deal is not here. It may have been archived." with Back to deals), error (any other failure: EmptyState-pattern error with Try again; never the not found copy), populated, close dialog submitting, nudge sending and failed, archive confirming.

375 and dark: no horizontal page scroll (the stage pills scroll inside their card), 44px targets (stage pills, card actions, selectors, the archive pair), tokens only, remove the var() fallback hex (#f0f7ee, #fef2f2, #f87171), the en dash in the tighten-range copy and every em dash, rem only, no single-side borders. Metadata title "Deal - Tahi Dashboard".

Do not build: the stall bar, Mark stalled, Unstall, the Stall dialog, a Send it button on saved nudges, the hero New document menu, a scheduled nudge sender, removal or rewording of the Auto nudges toggle beyond the icon fix, edits to DealSalesKit, EngagementHealthCard, DiscoveryCallsCard or any API route.

## Skipped (design elements not built; live behaviour kept)

- Lead Next step column and Next step card (studio-leads Q5; needs a column).
- Draft reply from the list quick view (studio-leads Q4; stays on the full page).
- Leads scoped-seat banner (fact 1: the copy would be false).
- One merged source list for leads and deals (the design's data file merges them; the live lists stay).
- Bulk import "Paste a sample" (fixture data).
- The full call page /calls/[id]: call, call-extract, call-no-transcript, call-unlinked, call-loading, call-error (studio-calls Q1).
- Lock this classification switch and the row lock pin (studio-calls Q2; needs a column).
- Date range control in the Calls rail (studio-calls Q3; the window is named in copy instead).
- Schedule call on /calls (studio-calls Q5).
- Folding scheduled_calls into /calls (studio-calls Q4).
- Pre-call digest "Emailed" pill, "Email me the digest" button and the "Digest 30 min before" prep column (no data or endpoint behind them).
- Delete call from the Calls row menu and slide-over (a synced call returns on the next sync; not in the requirement).
- Scoped-seat "You are seeing N of M" banners on Calls and Deals (proposal; no total in the API).
- Stalled as a flag (MC.6): Mark stalled, Unstall, the Stall dialog, Stalled and Active views, dimmed stalled cards, the stall bar.
- DealPeek quick look (studio-deals Q4).
- Include archived deals view (studio-deals Q5).
- Send it on a saved nudge, and any scheduled nudge sender (T3.8, studio-deals Q2).
- Removing or rewording the Auto Nudges toggle (studio-deals Q3); only the icon is fixed.
- Deal hero New document menu (duplicates the Sales kit card; the shared DealSalesKit is not edited).

## Questions for Liam

1. Studio tools and bulk selection on Leads (studio-leads Q1 and Q2): the plan reads "build the designs" as yes to both, with dry runs kept wherever the route has one and a typed DELETE for bulk delete. Confirm, or hold them.
2. Leads and Calls use the DataTable phone cards below 768 (the pattern Clients already uses). studio-leads Q3 marked a card fallback as a proposal. Keep the cards?
3. On a failed read the summary band keeps its box and reads "--" and "Not available" on every tile. Keep that, or hide the band on an error?
4. At 768 the lead and call tables scroll sideways inside their card. Auto-collapse the sidebar at tablet, or fold the tables to cards at 768 too?
5. Deals capped at 100: the plan shows a banner only when a full page comes back, with Load the rest (studio-deals Q6, option B plus an opt-in load). Or raise the cap or paginate server side?
6. The deal page will now ask for the won source or lost reason when a deal is closed from the detail, as the board already does. Confirm.
7. Nudges saved for later keep their live behaviour (recorded, never sent) with honest copy. Build the sender, or remove the option (T3.8)?
8. Still open and unchanged by this port: MC.6 stalled as a flag, deal quick look, include archived, Auto Nudges, the full call page versus the slide-over, the classification lock, a Calls date range, folding scheduled_calls, Schedule call on /calls, a lead next step, Draft reply from the quick view.

## Risks

- deal-detail.tsx is about 3,400 lines and leads-content.tsx about 2,200. The extraction can drop behaviour (the tighten-range guard, value change reasons, engagement and capacity maths, activity delete, notes autosave, the convert plan-type validation, the ?lead= deep link, the re-enrich prompt and its suppression, promote a call to a deal). Extract first, recompose second, and write a parity checklist.
- The Re-score every lead tool has no dry run and spends Haiku tokens on every open lead; the loop needs a stop button and a hard cap.
- Moving deals back to leads deletes deal rows; it must stay dry run first plus a confirm, never one button.
- Bulk delete must keep the typed DELETE; BulkActionBar's click confirm alone would weaken the server's guard.
- Load the rest changes every KPI once more pages arrive; totals must be recomputed from the merged set.
- The additive select on GET /api/admin/deals is read by overview, reports, the calculator and the MCP worker; extra fields should be harmless, but check each consumer.
- The Up next card's lead fetch is one more request per page view; failure must hide the block quietly.
- Stage colours are raw data; check the stage pills, column dots and meters for contrast in .dark.
- Promote now lands on /deals/ID; anything else that linked to /deals?deal= should be checked.
- The clients module relies on /deals?new=1&orgId=; it must keep working.
- Scheduled nudges will still say "Nudge scheduled for" on the timeline (the activity title is written by the API, which this port does not touch).

## Shared files (read only in this plan unless named in a slice)

components/tahi/rail/rail-layout.tsx, components/tahi/rail/rail-controls.tsx, components/tahi/rail/sidebar-card.tsx, components/tahi/kpi-strip.tsx, components/tahi/skeletons.tsx, components/tahi/data-table.tsx, components/tahi/bulk-action-bar.tsx, components/tahi/empty-state.tsx, components/tahi/data-state.tsx, components/tahi/callout.tsx, components/tahi/slide-over.tsx, components/tahi/confirm-dialog.tsx, components/tahi/prompt-dialog.tsx, components/tahi/menu.tsx, components/tahi/segmented-control.tsx, components/tahi/view-toggle.tsx, components/tahi/board-scrollbar.tsx, components/tahi/pagination.tsx, components/tahi/breadcrumb.tsx, components/tahi/inline-field.tsx, components/tahi/due-date-chip.tsx, components/tahi/discovery-calls.tsx, components/tahi/linked-to-panel.tsx, components/tahi/deal-sales-kit.tsx, components/tahi/engagement-health-card.tsx, components/tahi/tahi-button.tsx, lib/pipeline-math.ts, lib/calls.ts, lib/chart-colors.ts, lib/use-user-preference.ts, app/globals.css, next.config.ts (the /pipeline redirect). Written by this plan and read by other modules: app/api/admin/deals/route.ts (slice deals-board, additive), app/(dashboard)/deals/deals-content.tsx (the clients module depends on ?new=1&orgId=), components/tahi/deals/deal-close-dialog.tsx (new, slice deals-board, consumed by slice deal-detail).
