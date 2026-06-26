# Tahi Dashboard - Full Map

The Tahi Dashboard is a custom client-services platform that replaces ManyRequests, combining ClickUp-grade task management with a full sales CRM, a finance suite, and an AI content engine. It serves two audiences from one codebase: the Tahi team (admin), who run clients, requests, billing, pipeline, capacity, and operations; and clients (portal), who submit requests, track delivery, message the team, view files, and pay invoices. Built on Next.js 15 (App Router) on Cloudflare Workers, with D1 + Drizzle, Clerk multi-org auth, Stripe, R2, and a granular permissions layer gating every surface.

## How to read this

Each page in this map is documented as a block with a consistent shape so you can scan any surface the same way:

- **What it is** - a one-line definition of the page and which audience it serves.
- **Key features** - the concrete things you can do on the page.
- **How it is used** - where it sits in a real workflow and who reaches for it.
- **Links** - the routes, sibling pages, and detail/slide-over surfaces it connects to (in backticks).
- **Under the hood** - the APIs, tables, components, and any scoping or permission notes behind it.

Every page also carries a **status** drawn from `STATUS.md`. Four buckets, four colours:

- 🟢 **Green - live and daily-trusted.** The user runs their workday on it. Regressions here are P0. (Today: Sales pipeline / deals, Financial reports, Docs Hub, Settings -> Cash reserves.)
- 🟡 **Yellow - built but not daily-trusted.** Coded, routed, and working, but not yet earned as a primary tool. (Tasks, Requests, Messages, Time, Settings toggles, Reviews, Announcements; also the near-green Proposals / Contracts / Schedules / Calculator.)
- 🟠 **Orange - partial or known bug.** Works in part, or has a flagged defect. (e.g. `/tasks/[id]` full page 405s; Stripe import dedupe/pagination; voice notes fixed but pending live verification.)
- ⚪ **White - stub or not built.** Not functional yet. (SSE notification stream, Web Push, email-to-request intake, Xero payment webhook.)

If a page clearly renders an error or its route is missing, this map downgrades it and says why. **This document reflects platform state as of `STATUS.md` dated 2026-06-10.** It is a living reference; the `CLAUDE.md` bible defines intent, `STATUS.md` is the heartbeat, and this map ties them to actual routes.

## The map at a glance

### Admin (Tahi team) sidebar

- **Workspace**
  - Overview `/overview`
  - Requests `/requests`
  - Tasks `/tasks`
  - Messages `/messages`
- **Sales** *(collapsible)*
  - Leads `/leads`
  - Calls `/calls`
  - Deals `/deals`
  - Proposals `/proposals`
  - Schedules `/schedules`
  - Contracts `/contracts`
  - Calculator `/calculator`
  - Sales analytics `/sales-analytics`
- **Clients** *(collapsible)*
  - Clients `/clients`
- **Marketing** *(collapsible)*
  - Content studio `/content-studio`
  - Sitemap `/sitemap` *(email-allowlisted: Liam + Staci)*
  - Social `/social`
  - Reviews `/reviews`
  - Announcements `/announcements`
- **Finance** *(collapsible)*
  - Invoices `/invoices`
  - Billing `/billing`
  - Time `/time`
  - Financial reports `/financial-reports`
  - Reports `/reports`
- **Operations** *(collapsible)*
  - Capacity `/capacity`
  - Team `/team`
  - Permissions `/permissions` *(requires manage-permissions; admin / super-admin only)*
- **Knowledge** *(collapsible)*
  - Docs Hub `/docs`

*Settings (`/settings`) is reached from the user card menu, not a nav group.*

### Client portal sidebar

- **Your project**
  - Overview `/overview`
  - Requests `/requests`
  - Messages `/messages`
- **Library**
  - Files `/files`
  - Services `/services`
- **Billing**
  - Invoices `/invoices`

*Mobile portal bottom tab bar: Overview | Requests | Messages | Files | More. Admin bottom bar: Overview | Requests | Tasks | Messages | More.*

### Public / unauthenticated

- Token viewers
  - Public proposal / shared viewers `/p/...`
  - Preview surfaces `/preview/...`
- Auth
  - Sign-in `/sign-in`
  - Sign-up `/sign-up`
- Review
  - Public review / case-study capture `/review/...`

## Cross-cutting systems

### Auth and roles
- Clerk handles all authentication, multi-org. **Admin** = Clerk `orgId === NEXT_PUBLIC_TAHI_ORG_ID` (the Tahi Studio org); any other org is a **client** seeing the restricted portal.
- Inside the team there are four assignable roles plus a super-admin tier: `super_admin`, `admin`, `project_manager`, `task_handler`, `viewer`.
- Auth is always checked server-side: `getServerAuth()` in server components, `getRequestAuth()` + `isTahiAdmin()` in API routes. The client is never trusted for role decisions. Admins bypass all scoping.

### Granular permissions
- A `feature_visibility` table + `FEATURE_TREE` manifest + resolver in `lib/permissions.ts` (4 levels: super-admin un-lockable, admin all-but-deny-hides, team-member role baseline, client audience-gated + per-org).
- Enforcement layers: layout-level `PermissionsProvider`, sidebar nav filtering (hides denied items), `<Gate>` wrapping cards, and hard page redirects for denied team members (e.g. `/financial-reports`, `/team`, `/billing`).
- Builder UI lives at `/permissions` (Team / Clients / Roles tabs, per-feature allow/deny/inherit). Deny by default for non-admin team members.

### Notifications
- In-app bell (notifications table) is live.
- ⚪ SSE stream `/api/notifications/stream` is a stub (Phase 11 upgrade).
- ⚪ Web Push has no service-worker handler yet (planned).

### File storage
- Cloudflare R2 behind `/api/uploads/*` (presign, confirm, proxy, serve). Voice notes and request/message attachments persist `storageKey` rows and serve via `/api/uploads/serve`.
- R2 `STORAGE` binding on Webflow Cloud flagged for live re-verification.

### Integrations
- Stripe (billing + invoice auto-gen), Xero (invoice sync / reconciliation), Airwallex (cash + transaction feed), Google (Calendar two-way sync + Meet links), Buffer (social scheduling), Slack (team alerts), Mailerlite (onboarding list), HubSpot (contact match), Rewardful (affiliate), Zapier (outgoing webhooks, Phase 4), Webflow CMS (content publish).

### MCP parity
- Per `CLAUDE.md` rule 14 and Decision #036: any API capability used in the dashboard must be mirrored as MCP tools on the worker server (`workers/mcp-server/src/index.ts`). The local stdio server is dormant and must not be extended.

### Design system
- Manrope (200-800), brand greens (`--color-brand #5A824E` and the brand-dark/light/50/100 ramp), the leaf radius (`0 16px 0 16px`) reserved for icon backgrounds, CTAs, and active states.
- Dark mode is opt-in via the user-card toggle, persisted to `localStorage` under `tahi-theme`, applied to `<html>` before hydration to avoid flash. Components use CSS var tokens, never hardcoded hex. The sidebar is exempt: always dark.

### Mobile and PWA
- All layouts responsive at 375px (iPhone SE) and 768px. The portal sidebar collapses to a fixed bottom tab bar with a "More" bottom-sheet drawer (`MobileBottomNav`). Touch targets >= 44px.
- `public/manifest.json` exists; an offline fallback page and PWA install testing are part of the mobile bar.

### Automations and crons
- Automation rule builder (trigger/action engine, `automationRules` + `automationLog`) plus scheduled workers (e.g. `delivery-watch`, reserve accrual). Cron observability is part of the operations surface; several content-engine crons are disabled by default and some D1 migrations were still pending as of 2026-06-10.

## End-to-end workflows

How the pages chain together across each recurring job the agency runs. This is the map of the journeys, not the individual screens. Status legend: 🟢 live + daily-trusted · 🟡 built, not daily-trusted · 🟠 partial / known bug · ⚪ stub / not built.

### 1. Daily ops - the morning kick

Goal: open the dashboard and in one screen see what needs attention, what is overdue, what is coming up, and which engagements are off track.

**Flow:**
1. Overview `/overview` - AI briefing + KPI cards + daily-summary digest (morning cron) land here first
2. Overview off-track widget `/overview` (`OffTrackEngagementsWidget`) -> click an engagement -> Deal detail `/deals/[id]` or Client detail `/clients/[id]`
3. Overview "Next call" card `/overview` (live-now badge + Join) -> Calls `/calls`
4. Notifications (bell / panel, fed by `/api/notifications/*`) -> deep-link to the originating Request `/requests/[id]`, Task, or Deal `/deals/[id]`
5. Pipeline-at-a-glance + weighted forecast card `/overview` -> Deals `/deals`

**Status:** 🟢 Overview hero, weighted forecast, off-track widget, and Next-call card are live and verified on prod. ⚪ The real-time SSE notification stream (`/api/notifications/stream`) is still a stub, so notifications are not yet live-push.

**Links it relies on:** off-track widget -> deal/client detail via `/api/admin/engagements/off-track`; Next-call card -> `/calls` reading `discovery_calls`; notification deep-links -> request/deal/task detail; forecast card -> `/deals`.

### 2. Lead intake & qualification

Goal: capture every inbound lead (Webflow form, manual, affiliate) and decide pursue / nurture / archive before any sales time is spent.

**Flow:**
1. Public Webflow intake (`POST /api/public/leads`, UTM + Bearer-gated) OR manual quick-add -> Leads `/leads`
2. Leads `/leads` (DataTable + FilterBar) -> Lead detail `/leads/[id]`
3. Lead detail `/leads/[id]` - AI score + reason (`leads-ai` cron) + firmographic enrichment + score-history sparkline + AI-drafted first reply
4. Auto-created "Schedule discovery call" task (48h SLA) -> Calls `/calls`

**Status:** 🟢 Leads index, detail, AI scoring, enrichment, CSV export, bulk ops, and public intake are built and in active sales use. 🟡 Affiliate-referral attribution into intake still reads from Rewardful (`/affiliates`), full native replacement pending Phase C.

**Links it relies on:** public intake -> `leads` rows; lead row -> `/leads/[id]`; AI context docs (Docs Hub) -> scoring/draft via `lib/ai-context.ts`; "Schedule discovery call" task -> `/calls`.

### 3. Discovery call

Goal: prep for the call, record what happened, and route the outcome to a deal, a nurture task, or the archive.

**Flow:**
1. Pre-call digest email (cron `/api/admin/cron/pre-call-digest`) -> Overview Next-call card `/overview` -> Calls `/calls`
2. Calls `/calls` (Upcoming / Past tabs, type filter) -> Call / Lead detail (`/calls`, `/leads/[id]`) - prep notes + attendees + lead context
3. After the call: Gemini transcript autopull (`/api/admin/cron`, Drive scan) writes transcript + summary + next steps onto the call row (manual paste/upload fallback)
4. Log signals + pick outcome on Lead detail `/leads/[id]`:
   - Promote -> Deal `/deals/[id]` (auto-promote cron seeds budget + copies discovery context)
   - Nurture -> next-touch task
   - Archive -> mark dead with reason

**Status:** 🟢 Calls index, calendar classifier/triage, two-way Google Calendar sync, transcript autopull, and auto-promote-on-positive-outcome are built and feeding the pipeline.

**Links it relies on:** pre-call digest -> Next-call card -> `/calls`; calendar sync writes `discovery_calls` so the call appears instantly; transcript autopull matches Drive docs to call rows; promote -> `/deals/[id]` via `/api/admin/cron/auto-promote-calls`.

### 4. Closing a deal - the delivery spine

Goal: turn a committed deal into a signed contract and an auto-built project, so delivery starts with zero manual setup. This is the spine that differentiates the dashboard from ManyRequests.

**Flow:**
1. Deals `/deals` -> move to verbal_commit / negotiation -> Deal detail `/deals/[id]`
2. Deal detail `/deals/[id]` -> Proposal `/proposals` (AI-draft from transcript + scope + Calculator pricing + capacity check) -> share via EmailShareModal -> client opens public proposal `/p/proposal/[token]` -> accept
3. Accept -> Contract `/contracts` (generate from proposal sections + template) -> send -> client signs at `/p/contract/[token]`
4. Sign -> Schedule `/schedules` auto-built (phases as work breakdown) -> client views published snapshot at `/p/schedule/[token]`
5. Schedule rows link to delivery work: each row -> Requests `/requests/[id]` and Tasks (via the in-viewer "Linked work" picker, `scheduleRowId`) -> delivery-status engine rolls each row up to a per-engagement health (`EngagementHealthCard` on `/deals/[id]` and `/clients/[id]`) and surfaces failures on Overview `/overview`

**Status:** 🟡 Proposals / Contracts / Schedules are built and premium (near-green, not yet daily-trusted). 🟢 The delivery spine (slices 0-5) is live and verified: schedule-row -> request/task linking, the `lib/delivery-status.ts` engine, `EngagementHealthCard`, the off-track widget, and the `delivery-watch` cron all work on prod. 🟡 The full AI Discovery -> Proposal -> Contract -> auto-create-tasks auto-chain (Phase G #148 c/d) is blocked on the proposal visual overhaul; the discovery -> deal half is shipped.

**Links it relies on:** deal -> proposal -> contract -> schedule share via EmailShareModal + public `/p/*` token viewers; **schedule row -> request/task** via the linked-work picker (`/api/admin/schedules/[id]/linked-work`, shared `lib/schedule-phases.ts`); **rollup** schedule rows -> `EngagementHealthCard` via `/api/admin/engagements/delivery-status`; off-track -> Overview via `/api/admin/engagements/off-track`.

### 5. Onboarding a new client

Goal: convert a closed-won deal into a live client with portal access, billing, and a kickoff scheduled.

**Flow:**
1. Deal detail `/deals/[id]` (closed-won) -> convert to client -> Clients `/clients` -> Client detail `/clients/[id]` (org + first contact created)
2. Client detail `/clients/[id]` - set plan, Tracks `/tracks`, Subscription + Billing tab (recurring-billing setup folded into the client detail per Phase H)
3. Welcome email (Resend) + Mailerlite add + HubSpot contact match/create via Integrations (Settings `/settings` -> Integrations)
4. Portal invite (Clerk org) -> client lands in the portal Overview `/overview` (client view)
5. Kickoff call -> Calls `/calls`

**Status:** 🟡 Clients index + detail are built; billing now lives inside the client detail (Phase H). 🟠 Mailerlite / HubSpot / welcome-email automation on convert is partially wired (integrations exist; auto-fire on onboarding not fully proven). ⚪ A dedicated onboarding-checklist surface is not yet built.

**Links it relies on:** deal convert -> `/clients/[id]`; client detail -> `/tracks` + Billing tab; integrations panel in `/settings`; portal invite -> client-view `/overview`; kickoff -> `/calls`.

### 6. Running a project - PM and the client portal side

Goal: know what is in flight, blocked, and due; move work to delivered. Admin drives it; the client sees only their slice.

**Admin flow:**
1. Overview `/overview` (KPIs, today's focus, off-track) -> Requests `/requests`
2. Requests `/requests` - triage list + kanban (custom per-client columns) + filters -> Request detail `/requests/[id]` (assign, prioritise, status, "Delivery phase" selector)
3. Request detail `/requests/[id]` -> Tasks (three-level + AI wizard) -> Time `/time` (log hours) -> Messages `/messages` (thread per request/org)
4. Schedules `/schedules` Gantt - delivery health banner + status dots roll up the linked requests/tasks -> deliver -> mark complete

**Client portal flow:**
1. Client Overview `/overview` (client view) -> Requests `/requests` (portal, scoped to their org via `/api/portal/*`)
2. Submit a request via the per-category/per-client intake form -> track status on the kanban -> Messages `/messages` + file uploads via Files `/files`

**Status:** 🟡 Requests (admin + portal) lapped onto v3 and verified live, but flagged client-privacy and file/voice history; the portal track-view leak is now closed (`isInternal=false` filter). 🟡 Tasks, Time, Messages are built but not daily-trusted (Tasks UX rough). 🟠 `/tasks/[id]` full page is dead on prod (GET handler missing -> 405); the task slide-over is the only working task detail. 🟠 Voice notes fixed 2026-06-09, pending live verification. 🟢 The Schedules Gantt delivery-health rollup is live.

**Links it relies on:** Overview -> `/requests`; request detail "Delivery phase" -> schedule row (spine); request -> tasks -> `/time`; request/org -> `/messages` + `/files`; portal queries scoped by `orgId` via `/api/portal/*`; Gantt health -> linked requests/tasks.

### 7. Billing & getting paid

Goal: decide what to bill, raise it, send it, and watch it land in the finance picture.

**Flow:**
1. Decide what to bill - Client detail `/clients/[id]` Billing tab (retainer) OR Time `/time` rollup (hourly) OR Deal/project value
2. Invoices `/invoices` - operational ledger across Stripe + Xero + Airwallex; generate / send invoice
3. Track status (sent -> viewed -> paid -> overdue) on `/invoices`; retainer invoices auto-generated via Stripe/Xero
4. Reconcile -> Financial reports `/financial-reports` - AR aging, MRR, cash hero, Needs-attention card surfaces overdue invoices

**Status:** 🟢 Financial reports `/financial-reports` is live and daily-trusted (Phase H). 🟡 Invoices ledger is built. 🟠 Stripe import can duplicate `in_*`/`ch_*` rows and historically capped pagination at 100 (now fixed per recent notes). ⚪ Xero payment webhook receiver is not built - reconciliation relies on the daily sync cron, not live webhooks.

**Links it relies on:** client Billing tab + `/time` -> `/invoices`; multi-source IDs reconcile Stripe/Xero/Airwallex rows; `/invoices` overdue -> Financial reports Needs-attention card; daily 06:00 NZT sync cron feeds `/financial-reports`.

### 8. Content engine

Goal: drive Tahi traffic from ~1k to 10k+/mo via agent-driven research, drafting, QA, schema-rich publish, and internal linking - all reviewed in one place.

**Flow:**
1. Monday ideation cron (08:00 UK, full signal mix) -> Content Studio Ideas tab `/content-studio`
2. Triage 6-8 ideas (yes/no/maybe) `/content-studio` -> accepted ideas -> hourly drafting cron
3. Multi-agent draft (Researcher -> Brand Voice Writer -> Sales + Readability reviewers -> EIC Opus score 0-100) -> Drafts tab `/content-studio/drafts`
4. EIC score + SVG cover (5 templates, flag-to-Staci) -> single Liam sign-off `/content-studio`
5. Publish/schedule (Now / Custom / Auto Mon-Wed-Fri 09:00 UK, 14-day cooldown) -> Webflow CMS + IndexNow ping + GSC submit-URL
6. Internal-link engine Links tab `/content-studio` -> approve per-post link patches -> Webflow patch; Health tab `/content-studio/audits` + `/content-studio/site-index` track indexing; citation tracker + GSC-decay refresh flag (deferred Slice 8)

**Status:** ⚪ -> 🟡 Slices 0-6.5 shipped as code (Health, Ideas, Drafts, JSON-LD, covers, publish/schedule, link engine, 57-post backfill `/content-studio/backfill`). Treat as Built but new. Caveats: several D1 migrations (0060-0063) were still pending and several crons are disabled by default - must be enabled and migrated before the engine runs unattended. Slices 7-9 (signal expansion, citation tracker, LinkedIn auto-post) deferred.

**Links it relies on:** Ideas -> Drafts -> publish chain inside `/content-studio` tabs; AI context docs (Docs Hub) -> Brand Voice Writer via `lib/ai-context.ts`; publish -> Webflow CMS + IndexNow + GSC; link engine -> Webflow patch; Health/site-index -> GSC + sitemap.

### 9. Reviews & testimonials outreach

Goal: ask happy clients for a review at the right moment and turn responses into published case studies.

**Flow:**
1. Trigger (engagement milestone / manual) -> Reviews pipeline `/reviews` (outreach status: not_sent -> asked -> in_progress -> completed; defer / never-ask honoured)
2. Reviews `/reviews` -> client receives a public review link -> client submits at `/review/[token]`
3. Submission -> case-study pipeline `/reviews` -> published case study

**Status:** 🟡 Reviews & case-study pipeline is built and routed (public `/review/[token]` viewer exists) but not yet daily-trusted.

**Links it relies on:** Reviews pipeline -> public `/review/[token]` link; submission -> case-study record; outreach-status fields drive deferral / never-ask.

### 10. Team & access management

Goal: add a team member, give them a role, scope them to the right clients/plans, and watch their utilisation.

**Flow:**
1. Team `/team` - add member (Clerk + `teamMembers` row)
2. Assign role (super_admin / admin / project_manager / task_handler / viewer) -> Permissions builder `/permissions` (Team / Clients / Roles tabs)
3. Scope to clients or plans via access rules (`teamMemberAccess`); deny-by-default, admins bypass -> `feature_visibility` per-feature allow/deny/inherit
4. Enforcement flows everywhere: sidebar nav filter + `<Gate>` cards + page guards (`/financial-reports`, `/team`, `/billing` redirect denied members)
5. Review utilisation / hours -> Time `/time` + Reports `/reports` (-> `/sales-analytics`, operations rollups)

**Status:** 🟢 Granular permissions (the capstone) is built and validated live: `FEATURE_TREE` + `lib/permissions.ts` resolver + builder UI at `/permissions` + sidebar/Gate/page-guard enforcement. 🟡 Utilisation reporting (`/reports`, `/time` rollups) is built but not daily-trusted.

**Links it relies on:** `/team` add -> `/permissions` role assignment; permissions resolver -> sidebar + `<Gate>` + page redirects via `PermissionsProvider`; access scope -> every admin `/api/admin/*` query; utilisation -> `/time` + `/reports`.

## Lifecycle build order

The roadmap is lifecycle-driven: each phase compounds on data captured by the previous one, so order matters (building Proposals before Lead intake means proposals start with no upstream context). From `WORKFLOWS.md`:

- **Phase A - Sales CRM foundation:** Lead intake -> Discovery call -> Calls log -> Pipeline polish. **Shipped** (leads, calls, calendar sync, auto-promote all live; pipeline daily-trusted).
- **Phase B - CRM depth:** Gmail sync + email tracking, AI deal scoring, contact enrichment. **Partly shipped** (AI scoring + firmographic enrichment live; Gmail thread sync **next**).
- **Phase C - Affiliate program:** native `affiliates` tables + `/r/{code}` attribution + portal, replacing Rewardful. **Next / not built** (`/affiliates` still reads Rewardful).
- **Phase D - Marketing email CRM (Mailerlite replacement):** **Deferred** (low urgency, 4 campaigns/year).
- **Phase E - Productisation:** Proposals / Schedules / Contracts / Onboarding / Requests-Tasks-Messages-Time / Invoicing polish + the delivery spine. **Mostly built; spine shipped + verified**; the AI Discovery->Proposal->Contract->Tasks auto-chain (#148 c/d) is blocked on the proposal visual overhaul.
- **Phase F - Messaging & social (Buffer, Beeper unified inbox, LinkedIn/cold-email tracking):** **Deferred** until the CRM is the daily driver (Buffer surfaced in Settings is the only piece shipped).
- **Phase G - Sales conversion levers:** AI first-reply, pre-call digest, affiliate-reactivation, daily-summary, forecast card all **shipped**; the big Discovery->Proposal->Contract->Tasks pipeline (#148) **pending**.
- **Phase H - Finance overhaul:** `/financial-reports`, reserves, recurring outflows, calendar two-way sync. **Shipped + daily-trusted.**
- **Phase H+ - Calculator dial-in:** **Not started** (needs Liam's pricing intuition in the room; built + premium but not calibrated).
- **Phase I - Content Engine (`/content-studio`):** Slices 0-6.5 **shipped as code** (powerful but new - pending D1 migrations 0060-0063 and several crons disabled by default); Slices 7-9 (signal expansion, citation tracker, LinkedIn auto-post) **deferred**.

The production-readiness exit criterion is not "all phases done" but trust-crossover: the user running their full workday inside the dashboard. Daily-trusted today: Sales pipeline, Financial reports, Docs Hub, Settings -> Cash reserves. The delivery spine and granular permissions are the most recent additions pushing Requests/Tasks toward daily trust.

## Workspace - Overview & Messages

The home cockpit and the conversation surface, plus the notification system that rides on top of both. Each renders an admin and a client variant from the same route, branching on `isAdmin` (Clerk `orgId === NEXT_PUBLIC_TAHI_ORG_ID`).

### Overview (Admin) - `/overview`
`Audience: Admin` · `Status: 🟢 Live and daily-trusted`

**What it is.** The admin "studio cockpit": a typographic ledger masthead (MRR + vitals + a daily Studio Note) followed by a permission-gated bento of zoned cards covering work, pipeline, clients, books and growth.

**Key features**
- `LedgerMasthead`: MRR rendered bare on the canvas as the brand-green signature figure, with permission-filtered vitals beside it (MRR + runway, outstanding AR, active clients, open requests / in progress).
- The Studio Note: one generated sentence per day ("While you slept: X cleared, N client replies, M shipped") with a context link to chase the oldest overdue invoice or move open requests forward. (This replaced the old `ai-briefing-card`, which is no longer mounted.)
- `NeedsYou` act-now queue (off-track engagements + upcoming calls + oldest overdue invoice) and `TheWire`, a single-item-at-a-time live ticker of cross-dashboard events.
- Zoned card grid, each card behind a `<Gate feature>`: Work (`InTheStudio` recent requests + `TodayRail`), Ahead (`PipelineAhead`, `StudioCapacity`, `HotLeads`, `ProposalsLive`), Clients (`RetainerHealth`, `ContractsCard`), Books (`TakeHomeGauges`, `CashRunway`, `CashFlowRibbon`, `ReceivablesTide`), Growth (`ContentEngine`, `SocialCadence`), plus `TimeTracker` and `WorldClock`.
- Graceful degradation: a `NothingEnabledCard` fallback when every feature is denied, and a `GettingStarted` checklist when there are zero clients.

**How it is used / workflows**
- Morning triage: read the Studio Note, clear the NeedsYou queue, scan The Wire.
- Jump-off point to every operational area via the card links.

**Links**
- → `/invoices` (chase overdue AR from Studio Note / `ReceivablesTide`), `/requests` (from `InTheStudio` rows and open-request nudge), `/deals`, `/clients`, `/financial-reports`, `/content-studio`, `/settings` (when nothing enabled)
- ← reached FROM the sidebar top item (default landing page after sign-in)

**Under the hood** - APIs: `/api/admin/overview`, `/api/admin/overview/wire`, `/api/admin/engagements/off-track`, `/api/admin/ai/briefing` (cached, 12h freshness; cron-refreshed); Tables: `requests`, `invoices`, `subscriptions`, `exchangeRates`, `settings`; Components: `OverviewSwitcher`, `AdminOverview`, `LedgerMasthead`, `NeedsYou`, `TheWire`, `Zone`

### Overview (Client portal) - `/overview`
`Audience: Client` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** The same route rendering `ClientOverview` for non-Tahi orgs: a welcome greeting, three KPI tiles, plan/track capacity, onboarding, and the client's recent requests.

**Key features**
- Three `StatCard` tiles: Open Requests, Awaiting Review (highlighted "Action needed" when > 0), Invoices Due (placeholder `--`).
- `TrackCapacityCard`: live plan summary (maintain/scale, Priority badge), occupied vs available small/large track slots, queue list, and plan-aware upsell prompts.
- "Awaiting review" alert banner, `OnboardingChecklist` (5 steps, Loom video, localStorage-dismissable), `ScheduleCallWidget` + `BookingWidget` (Google Calendar embed), and a `ReviewOutreachBanner` (yes / defer / no).
- "Your Requests" list (most recent 6) with loading and empty states.

**How it is used / workflows**
- Client login landing: see what needs review, submit a new request, complete onboarding, book a call.

**Links**
- → `/requests` (and `/requests?new=1`, `/requests?status=client_review`), `/requests/[id]`, `/invoices`
- ← reached FROM portal sidebar / bottom tab bar (default landing)

**Under the hood** - APIs: `/api/portal/requests`, `/api/portal/capacity`, `/api/portal/onboarding`, `/api/portal/settings/booking`, `/api/portal/review-outreach`; Tables: `requests`, `subscriptions`, `tracks`, `organisations`, `caseStudySubmissions`; Components: `ClientOverview`, `TrackCapacityCard`, `OnboardingChecklist`, `BookingWidget`

### Notification surface (rides on Overview + every page)
`Audience: Admin & Client` · `Status: 🟠 Partial (polling-backed SSE)`

**What it is.** A bell in the top nav (`NotificationBell` in `AppTopNav`) showing the 20 most recent notifications with an unread badge, plus a `ProductTour` first-run overlay mounted in the dashboard layout.

**Key features**
- Dropdown panel lists notifications with relative timestamps, mark-one-read on click, and mark-all-read.
- Real-time updates via `EventSource` to `/api/notifications/stream`. Note: STATUS calls the stream a stub, but the code is a real implementation that polls D1 every ~5s and pushes new rows (with keep-alive and signal-based teardown). No Web Push / service worker, so background push is genuinely absent.
- `ProductTour` is `isAdmin`-aware and runs once per user.

**Under the hood** - APIs: `/api/notifications` (GET list + PATCH read), `/api/notifications/stream` (SSE); Tables: `notifications`; Components: `NotificationBell`, `AnimatedBell`, `ProductTour`, `AppTopNav`

### Messages - `/messages`
`Audience: Admin` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** A two-pane conversation workspace (list + thread) over the full conversation model: direct, group, org-channel and request-thread types, each either internal (Tahi-only) or external (client-visible).

**Key features**
- Left pane: searchable conversation list with `FilterBar` chips for Type (Direct / Group / Channel / Thread) and Visibility (External / Internal); per-row type icon, last-message preview, unread badge, and an "Internal" lock badge.
- Right pane: `MessageThread` of `MessageBubble`s with author role styling, edited markers, removed-message and voice-note states, and a mobile back button.
- `Composer` supports Tiptap-HTML messages, an internal/external visibility toggle (admin only), and voice notes via the R2 presign → PUT → confirm → send flow.
- Admins can delete (soft-delete) any message; deleted messages render "This message has been removed."
- "New conversation" `SlideOver`: pick type, name a group/channel, add participants (team members + client orgs via `SearchableSelect`), and set visibility.

**How it is used / workflows**
- Run client and internal threads in one place; flip a thread internal to keep notes off the client's view; drop a voice note when typing is slow.

**Links**
- → opens conversations and (for request threads) relates back to `/requests/[id]`; pulls participants from `/api/admin/team` and `/api/admin/clients`
- ← reached FROM the sidebar Messages item; conversations are also created from request detail threads

**Under the hood** - APIs: `/api/admin/conversations` (+ `/[id]/messages` GET/POST/PATCH), `/api/uploads/presign` + `/api/uploads/confirm` (voice notes); Tables: `conversations`, `conversationParticipants`, `messages`, `voiceNotes`; Components: `MessagesContent`, `MessageThread`, `MessageBubble`, `Composer`, `NewConversationForm`

### Messages (Client portal) - `/messages`
`Audience: Client` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** The same route scoped to the client's org: conversations with the Tahi team only, with internal threads and admin-only controls hidden.

**Key features**
- Same two-pane shell, but no Visibility filter, no internal toggle, and no delete action.
- "New conversation" is simplified to a single optional first-message textarea that opens a `direct` thread with the team.
- Reads/writes go to the portal endpoints, which scope every query to the authenticated `orgId`; client never sees internal-visibility conversations.

**How it is used / workflows**
- Client messages the Tahi team, sends voice notes, and tracks replies.

**Links**
- → conversation threads; tied to the client's requests where a thread is a request thread
- ← reached FROM portal sidebar / bottom tab bar

**Under the hood** - APIs: `/api/portal/conversations` (+ `/[id]/messages`), `/api/uploads/*`; Tables: `conversations`, `conversationParticipants`, `messages`, `voiceNotes`; Components: `MessagesContent` (client branch), `MessageThread`, `Composer`

## Workspace - Requests & Tasks

The delivery core of Tahi. Two surfaces split by audience visibility: **Requests** are client-visible work items (clients submit and track them), while **Tasks** are always Tahi-internal execution units that clients never see (Decision #046). The only task distinction is "for a client" (`orgId` set) vs "for us" (`orgId` null).

### Requests (list / board / workload) - `/requests`
`Audience: Admin|Client` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** The master work-item index. Admins see all requests across clients; clients see only their own (portal-scoped). Three view modes plus rich filtering, bulk ops, and two creation paths (manual dialog + AI wizard).

**Key features**
- Three views via `ViewToggle`: **List** (`DataTable`), **Board** (`BoardView` with kanban + timeline sub-views), **Workload** (admin-only, per-team-member assignment bars + unassigned bucket).
- `FilterBar` with permanent Status / Category / Type select chips, a created-date range chip, a client-tag chip (built from the union of owning-org tags), plus free-text search over title + client name. Status chip folds in the old Active/All/Unassigned/Delivered tabs; admin vs client see different status option sets.
- List columns: scope-flag warning icon, zero-padded `#requestNumber`, title link, client (admin only), inline editable **status chip** (optimistic `PUT`), priority badge, due-date chip (overdue/due-soon states), updated.
- Board: drag a card between columns to change status; columns come from per-client **custom kanban columns** (`/api/admin/kanban-columns`) falling back to a default 5-column set; dropping card A onto card B opens a confirm dialog to **nest** A as a sub-request of B (cross-client drops refused before the dialog); dropping a nested child on a column un-nests it.
- Bulk actions (admin, when rows selected): change status, assign people (PM / assignee / follower role tabs), archive - via `/api/admin/requests/bulk` + `/bulk-assign`.
- **New Request** dialog, **Bulk Create** dialog (one request fanned out across many selected clients, filterable by plan), **AI draft** wizard (`AiRequestWizard`), CSV export (`/api/admin/export/requests`).
- Per-user persisted preferences (view mode, sort key, active tab) via `useUserPreference`.
- Impersonation-gated: when impersonating a client the page renders the client view; a viewer-role team member impersonation hides New / AI / create buttons.

**How it is used / workflows**
- Triage incoming work: filter to Unassigned, bulk-assign a PM/assignee.
- Run the board as the day-to-day kanban, dragging cards through the pipeline; group related work by nesting into sub-requests.
- Spin up the same request for many clients at once (Bulk Create) or draft one from a prompt (AI).

**Links**
- → **Request detail** (`/requests/[id]`) on row/card click (passes `id`).
- → New/edit dialogs pass `defaultOrgId` from `?client=`.
- ← Reached FROM the sidebar Workspace nav; deep-linked with `?new=1` (auto-open dialog) and the `tahi:shortcut` keyboard event.
- ↔ Portal equivalent calls `/api/portal/requests` and `/api/portal/ai/request-wizard` (covered in Portal area).

**Under the hood** - APIs: `/api/admin/requests` (GET/POST), `/api/admin/requests/bulk`, `/api/admin/requests/bulk-assign`, `/api/admin/kanban-columns`, `/api/admin/ai/request-wizard`, `/api/admin/team-members`; Tables: `requests`, `kanbanColumns`, `organisations`, `conversationParticipants`; Components: `RequestList`, `BoardView`, `DataTable`, `FilterBar`, `NewRequestDialog`, `AiRequestWizard`, `BulkCreateDialog`.

### Request detail - `/requests/[id]`
`Audience: Admin|Client` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** The full work-item workspace: a thread-first layout with the message conversation on the left and a stacked rail (status engine, time, people, checklists, details, schedule link) on the right. Renders a restricted client variant under impersonation/portal.

**Key features**
- **Status engine**: linear `STATUS_FLOW` (submitted → in_review → in_progress → client_review → delivered) with inline advancement; archived/draft handled separately.
- **Message thread** (`RequestThread` + lazy `MessageComposer`) with internal-vs-external visibility, read receipts (`/reads`).
- **Sub-requests / nesting** panel (`SubRequestsPanel`): list, reorder, create children, "make top-level" for a child.
- **People** panel (`PeoplePanel`): PM / assignee / follower participants, add/remove.
- **Files** (R2 uploads via `/files`), **voice notes** (`/voice-notes`), **time entries** (`TimeCard` + `/time-entries`), **discovery/scheduled calls** (`DiscoveryCallsCard` + `/calls`).
- **Checklists**: multiple named checklists with items, optimistic save into the request `checklists` JSON column.
- **Scope flag** (`/scope-flag`): flag a request as out-of-scope with a reason (warning icon surfaces in the list).
- **Delivery-phase linking**: link the request to a schedule phase row (`scheduleRowId` via `fetchSchedulePhaseOptions`).
- Editable priority, dates, assignee, breadcrumb back to parent request; `ErrorBoundary` wrapper.

**How it is used / workflows**
- Day-to-day delivery thread between team and client, advancing status as work moves.
- Log time, attach deliverable files, manage participants, break large work into sub-requests, flag scope creep, and tie the request to a schedule phase.

**Links**
- → Parent request via breadcrumb; → child sub-requests; → linked **schedule phase** (Schedules area).
- ← Reached FROM `/requests` list and board.

**Under the hood** - APIs: `/api/admin/requests/[id]` (GET/PATCH/DELETE), `/[id]/messages`, `/[id]/participants`, `/[id]/files`, `/[id]/voice-notes`, `/[id]/time-entries`, `/[id]/sub-requests`, `/[id]/nest`, `/[id]/scope-flag`, `/[id]/steps`, `/[id]/reads`, `/[id]/calls`; Tables: `requests`, `messages`, `conversationParticipants`, `files`, `voiceNotes`, `timeEntries`, `scheduledCalls`; Components: `RequestDetail`, `RequestThread`, `SubRequestsPanel`, `PeoplePanel`, `TimeCard`, `DiscoveryCallsCard`, `ChecklistsPanel`.

### Tasks - `/tasks`
`Audience: Admin` · `Status: 🟡 Built, working, not daily-trusted (UX rough)`

**What it is.** The internal execution board. Tasks are Tahi-only; the legacy three-level `type` (`client_task` / `internal_client_task` / `tahi_internal`) is collapsed in the UI to two buckets - **For a client** (orgId set) vs **For us** (orgId null) - driven by `taskBucket()`.

**Key features**
- Type tabs (All / For us / For a client) + status tabs (All / To Do / In Progress / Blocked / Done); search, date-range filter, list and board (`TaskBoardView`) views via `ViewToggle`.
- **Slide-over detail panel** (`TaskDetailPanel`) - the working detail surface: opens on list-row click (`setSelectedTaskId`), shows subtasks, dependencies, assignee, edits.
- **Subtasks** with progress bars; **dependencies** with a "blocked by unresolved dependencies" warning; `blockedByCount` surfaced on cards.
- **AI Task Wizard** (`AiTaskWizard`) and **task templates** (create tasks from a template with predefined subtasks).
- **Bulk action bar** (`TaskBulkActionBar`): set status / priority / assignee (incl. unassign) across selected tasks.
- Board cards show org/bucket, due-date chips, priority badges, subtask completion ratio; board drag changes status (`PATCH /api/admin/tasks/[id]`).
- AI wizards run on Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) via `@anthropic-ai/sdk`.

**How it is used / workflows**
- Break delivery work into internal tasks (often linked to a request via `requestId` or a schedule phase via `scheduleRowId`), assign, track subtask progress, and gate work with dependencies.
- Spin up repeatable task sets from templates or draft a task plan with AI.

**Links**
- → **Task detail** (`/tasks/[id]`) - board cards link here (currently broken, see below); list rows open the slide-over instead.
- → Linked **request** (`requestId`) and **schedule phase** (`scheduleRowId`).
- ← Reached FROM the sidebar Workspace nav.

**Under the hood** - APIs: `/api/admin/tasks` (GET/POST), `/api/admin/tasks/bulk`, `/api/admin/tasks/from-template`, `/api/admin/task-templates`, `/api/admin/tasks/[id]/subtasks`, `/[id]/dependencies`, `/[id]/calls`, `/api/admin/ai/task-wizard`; Tables: `tasks`, `taskSubtasks`, `taskTemplates`(/`task_templates`); Components: `TasksContent`, `TaskBoardView`, `TaskDetailPanel`, `TaskBulkActionBar`, `AiTaskWizard`.

### Task detail (full page) - `/tasks/[id]`
`Audience: Admin` · `Status: 🟠 Partial / known bug - full page is dead on prod`

**What it is.** Intended standalone task workspace (`TaskDetail`), but it is non-functional because its data layer is missing on the server.

**Key features (intended, code present in `task-detail.tsx`)**
- Fetches the task (`GET /api/admin/tasks/[id]`), subtasks, dependencies, time entries, and team members; edits via `PATCH`; delete via `DELETE`.
- Subtask add/toggle, dependency display, assignee editing, time entries display.

**Confirmed bug.** `app/api/admin/tasks/[id]/route.ts` **only exports `PATCH`** - there is no `GET` and no `DELETE`. So `task-detail.tsx` line 280 (`fetch(.../tasks/${taskId})`, GET) and line 446 (`method: 'DELETE'`) both hit a **405 Method Not Allowed**, leaving the full page unable to load or delete. The **slide-over `TaskDetailPanel`** on `/tasks` is the only working task-detail surface (it reads subtasks/dependencies via their own sub-routes and edits via `PATCH`, which does exist). Note board cards still link here, so clicking a board card lands on the dead page; fix is to add a `GET` (and `DELETE`) handler to the route.

**Links**
- ← Reached FROM `/tasks` board cards (`href="/tasks/[id]"`) - currently a broken destination.

**Under the hood** - APIs: `/api/admin/tasks/[id]` (PATCH only - **GET/DELETE missing**), `/[id]/subtasks`, `/[id]/dependencies`, `/api/admin/time-entries`; Tables: `tasks`, `taskSubtasks`; Components: `TaskDetail`.

Note: request **intake forms** (`/api/admin/forms` GET/POST + `/api/admin/forms/resolve` for the most-specific form per category/client, feeding `requests.formResponses`) back the New Request dialog's dynamic questions but have no dedicated page in this scope (managed under Settings).

## Sales CRM - Leads, Calls, Deals

The top of the sales funnel: prospects land in Leads, get a discovery Call, then get promoted into the Deals pipeline. All four surfaces are admin-only (`orgId === NEXT_PUBLIC_TAHI_ORG_ID`); non-admins hard-redirect to `/overview`.

### Leads - `/leads`
`Audience: Admin` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** The pre-qualification inbox. New prospects (Webflow form, referral, manual, etc.) land here, get AI-scored and AI-researched, then are promoted to a deal once they have a discovery call.

**Key features**
- `DataTable` with firmographic columns: Lead (avatar + company/email), editable Status chip (new / qualifying / nurturing / promoted / archived), AI score badge (tone by 0-100 band), website link-out, Source, Estimate (money), Owner avatar, Updated relative time.
- `FilterBar` with non-removable Status + Source multiselects (defaults to new/qualifying/nurturing) plus free-text search across name/company/email/brief.
- New-lead and Bulk-import slide-overs; bulk import previews a pasted CSV before writing (caps at 50 rows/call).
- Row actions: Quick view (slide-over), Edit, Promote to deal, Delete; row click navigates to the full detail page.
- Quick-view `SlideOver` shows an AI briefing section: run/re-run enrichment, AI score + reason, auto-fill suggestion banner (apply AI-found fields the lead is missing), "always ask" + "for this lead" discovery questions, embedded `DiscoveryCallsCard`, and an activity timeline.
- Promote confirm creates org + contact + deal and flips status to `promoted`; re-enrich confirm fires after edits that change website/company.

**How it is used / workflows**
- Triage inbound prospects, run AI research before a discovery call, then promote the qualified ones into the pipeline.

**Links**
- → `/leads/[id]` (row click, full detail) · → `/deals?deal=ID` (after promote, lands on the new deal)
- ← reached FROM sidebar Sales group; ← lands here via `?lead=ID` (auto-opens edit slide-over)

**Under the hood** - APIs: `/api/admin/leads` (GET list / POST create), `/api/admin/leads/[id]` (PATCH/DELETE), `/api/admin/leads/[id]/enrich`, `/api/admin/leads/[id]/promote`, `/api/admin/leads/bulk-import`, `/api/admin/leads/bulk-actions`; Tables: `leads`, `activities`, `aiReplyDrafts`; Components: `LeadsContent`, `DataTable`, `FilterBar`, `SlideOver`, `DiscoveryCallsCard`

### Lead detail - `/leads/[id]`
`Audience: Admin` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** The full-page lead workspace: AI briefing + score, firmographics, an AI-drafted first reply, enrichment, and promote-to-deal.

**Key features**
- `Breadcrumb` back to Leads; status badge with score tone bands.
- Firmographics (migration 0047): industry, employee count, revenue band, monthly visits, lead type, LinkedIn (company + personal), tech stack, CMS, country, year founded - all editable inline (numbers parsed, tech stack comma-split).
- AI briefing card (`aiSummary`), AI score + reason, sources, discovery questions; Run/Re-run enrichment.
- AI-drafted first reply: generate a draft via `/draft-reply`, edit subject/body, and send (via Resend) directly from the page.
- Promote-to-deal confirm; embedded `DiscoveryCallsCard` and lead activity timeline.

**How it is used / workflows**
- Open a scored lead, read the AI briefing, fire off the AI first-reply, log/extract the discovery call, then promote.

**Links**
- → `/deals?deal=ID` / `/deals/[id]` (after promote) · → back to `/leads`
- ← reached FROM `/leads` row click and the `/calls` "Open lead" action

**Under the hood** - APIs: `/api/admin/leads/[id]`, `/api/admin/leads/[id]/draft-reply` (Claude `claude-sonnet-4-6`), `/api/admin/leads/[id]/enrich` (full=`claude-sonnet-4-6`, score=`claude-haiku-4-5`), `/api/admin/leads/[id]/promote`, `/api/admin/leads/[id]/calls`; Tables: `leads`, `aiReplyDrafts`, `discoveryCalls`, `activities`; Components: `LeadPageContent`, `DiscoveryCallsCard`, `ConfirmDialog`

*Supporting lead APIs:* `/api/admin/leads/rescore-all` (batch re-score, `claude-haiku-4-5`), `/api/admin/leads/triage-pipeline` (flag deals missing proposals/contracts/contacts), `/api/admin/leads/backfill-fields`, `/api/admin/ai-reply-drafts`, `/api/admin/nudge-templates`, `/api/public/leads` (public Webflow intake - POST, source defaults to `webflow`, assigns default owner), `/api/admin/cron/leads-ai` (scheduled enrich + score, `claude-haiku-4-5`).

### Calls - `/calls`
`Audience: Admin` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** A unified log of every call pulled from Google Calendar + manual entries, classified into buckets (discovery / client check-in / partnership / triage), with Upcoming/Past tabs.

**Key features**
- `DataTable` reading `/api/admin/calls/index` (backed by `discovery_calls`): Title with a type chip + transcript badge, When (datetime + relative + duration), Linked-to (lead/deal/org link or "Unlinked - triage"), Status badge.
- Upcoming / Past tabs with live counts; Type `FilterBar` multiselect; search across title/lead/deal/org.
- "Sync calendar" button triggers two-way Google Calendar sync (idempotent on `google_calendar_event_id`, auto-matches by attendee email or lead website domain).
- Row actions: Open Meet link, Open lead, and inline reclassify (Mark as Discovery / Client / Partnership) with optimistic update + toast.
- Transcript upload + AI extract (on `discovery_calls`) pulls scope/budget/timeline into the call record; positive-outcome calls can auto-promote to a deal.

**How it is used / workflows**
- Sync the calendar, glance at upcoming calls + pre-call digest, run the call, paste the transcript to extract deal signals, reclassify if mis-bucketed.

**Links**
- → `/leads/[id]`, `/deals/[id]`, `/clients/[id]` (Linked-to column) · → Google Meet links
- ← reached FROM sidebar Sales group; ← also surfaced on client detail + overview

**Under the hood** - APIs: `/api/admin/calls/index`, `/api/admin/discovery-calls/[id]` (PATCH reclassify), `/api/admin/discovery-calls/[id]/extract` (`claude-sonnet-4-6`), `/api/admin/integrations/google/sync-calendar`, `/api/admin/cron/pre-call-digest` (Resend), `/api/admin/cron/auto-promote-calls`; Tables: `discoveryCalls`, `leads`, `deals`, `contacts`; Components: `CallsContent`, `DataTable`, `FilterBar`, `PageHeader`

### Deals (Sales Pipeline) - `/deals`
`Audience: Admin` · `Status: 🟢 Live and daily-trusted`

**What it is.** The daily-trusted sales pipeline: drag-and-drop kanban + list of deals through configurable stages, with weighted forecast KPIs and nudge automation.

**Key features**
- KPI strip: Pipeline MRR, Upfront, Total Pipeline (upfront + monthly × horizon), Weighted Forecast (× stage probability), Open Deals - all routed through `lib/pipeline-math` (Decision #040) and converted to the user's display currency.
- Kanban board with drag-to-stage (optimistic move + revert on failure); dropping onto Won/Lost opens a close dialog capturing won-source or lost-reason (price/competitor/timing/scope/no_response/not_a_fit/other) and stamps `closed_at`.
- List view with sort (updated / value / expected close / title) and `Pagination`.
- Filter panel: owner, source, min/max value; search by title/org.
- Deal cards show split value ("$10k + $2k/mo"), range-confidence dot, last-touched freshness color, source badge, owner avatar, expected close, days-in-stage, and an auto-nudge bell on Stalled deals.
- New Deal dialog (openable via `?new=1&orgId=`); stage probabilities show historical win-rate when available.

**How it is used / workflows**
- Liam's daily driver: drag deals across stages, close won/lost with reasons, watch weighted forecast, spot stale deals.

**Links**
- → `/deals/[id]` (card / row click; `/pipeline/*` 301-redirects here via `next.config.ts`)
- ← reached FROM sidebar Sales group; ← `/leads` promote and `?new=1` deep-links

**Under the hood** - APIs: `/api/admin/deals?limit=100`, `/api/admin/deals/[id]` (PATCH stage/close), `/api/admin/pipeline/stages`, `/api/admin/pipeline/capacity`, `/api/admin/pipeline/seed`, `/api/admin/team`; Tables: `deals`, `pipelineStages`, `dealContacts`, `organisations`; Components: `DealsContent`, `KanbanView`, `DealCard`, `DealCloseDialog`, `NewDealDialog`, `KPIStrip`, `ViewToggle`

### Deal detail - `/deals/[id]`
`Audience: Admin` · `Status: 🟢 Live and daily-trusted`

**What it is.** The single-deal cockpit: activities timeline, contacts, calls, engagement health, sales kit, nudges, and convert-to-client on win.

**Key features**
- Activities timeline (typed icons incl. `nudge_sent`, `auto_nudges_toggled`) with delete; value-change history derived from activity metadata (migration 0017).
- Embedded `DiscoveryCallsCard`, `DealSalesKit`, and `EngagementHealthCard` (deal engagement scoring).
- Send Nudge dialog (logs `dealNudges`, can email via Resend with a configurable signature) and a per-deal Auto-Nudges pause toggle shown only in the Stalled stage.
- Contacts panel (add existing contacts to the deal) and owner/stage sidebar.
- Convert-to-Client card appears once the deal is Closed Won - provisions the org as an active client.

**How it is used / workflows**
- Work a single deal: review activity, log/extract calls, nudge stalled prospects, then convert to a client on win.

**Links**
- → `/clients/[id]` (after convert-to-client) · → linked calls/contacts · → back to `/deals`
- ← reached FROM `/deals` board/list, `/calls` Linked-to, and `/leads` promote

**Under the hood** - APIs: `/api/admin/deals/[id]` (+ `/activities`, `/calls`, `/contacts`, `/convert-to-client`, `/nudges`), `/api/admin/activities/[id]` (DELETE); Tables: `deals`, `dealContacts`, `dealNudges`, `activities`, `pipelineStages`, `organisations`; Components: `DealDetail`, `EngagementHealthCard`, `DealSalesKit`, `DiscoveryCallsCard`, `NudgeDialog`, `ConvertToClientCard`, `SidebarSection`

## Sales CRM - Proposals, Schedules, Contracts, Calculator & Analytics

The closing half of the sales suite. Everything here chains into one revenue spine: a **Deal** spawns a **Proposal** (via the Calculator or by hand), the client **accepts** a package, that converts into a **Contract** to e-sign, and a **Schedule** + linked **Requests/Tasks** become the delivery plan. Each artefact has the same shape: an admin list, a slide/section builder at `[id]`, a saved-template library, a public `/p/...` viewer for the client, and an internal `/preview/...` render with no dashboard chrome.

### Proposals - `/proposals`
`Audience: Admin` · `Status: 🟡 Built, near-green (not yet daily-trusted)`

**What it is.** The list of every client proposal: premium 16:9 multi-section decks with 1-3 priced package variants and public share links.

**Key features**
- `DataTable` with sortable Name / Status / Org / Deal / Updated columns; inline Org link → `/clients/[id]` and Deal link → `/pipeline/[id]`
- Permanent `FilterBar` status multiselect chip (draft, shared, accepted, declined, withdrawn, expired) plus free-text search across title/org/deal/preparedFor
- "New proposal" `SlideOver`: start blank (seeds one default section) or instantiate from a saved template
- Row actions: Open, Open public viewer (new tab to `/p/proposal/[token]`), Delete (`ConfirmDialog`)

**How it is used / workflows**
- Triage outstanding proposals by status, jump into one to edit, or fire the public link to a prospect

**Links**
- → `/proposals/[id]` (open editor), `/proposals/templates` (template library), `/clients/[id]`, `/pipeline/[id]`, `/p/proposal/[token]`
- ← reached FROM the Sales nav group; also created from `/calculator` (Draft proposal) and deal detail

**Under the hood** - APIs: `/api/admin/proposals` (GET/POST), `/api/admin/proposals/templates`, `/api/admin/proposals/[id]` (DELETE); Tables: `proposals`, `proposalVariants`, `proposalSections`; Components: `ProposalsContent`, `DataTable`, `FilterBar`

### Proposal editor - `/proposals/[id]`
`Audience: Admin` · `Status: 🟡 Built, near-green`

**What it is.** A two-pane slide builder: a live auto-saving editor on the left, a slide navigator + settings rail on the right. The cover is slide 1, sections follow, packages and analytics hang off the rail.

**Key features**
- Cover editor: eyebrow, title, prepared-for/by, effective + expiry dates (cover locked to brand-glass theme)
- ~16 section types in a grouped "Add slide" picker: overview, value_anchor (the math), process, retainer_offer (10% lifetime), case_study, testimonial_stack (carousel), founders, partner_badges, faq, terms, differentiators, guarantee, about, scope_shared, custom text - structured types get typed field editors (`TypedSectionFields`), others fall back to Tiptap/HTML
- Section reorder (move up/down, optimistic swap), delete, per-section theme mode
- Package **variants**: name, tagline, one-off + monthly amount, currency, scope HTML, pricing notes, CTA label, featured flag, optional linked timeline schedule
- **Draft/Publish model**: edits auto-save live but the public viewer reads a `publishedSnapshot`; an "Unpublished" pill + Publish button push the latest version
- **Share**: mint/revoke public token (copies link), email share via `EmailShareModal` (pulls org contacts), Preview button → `/preview/proposal/[id]`
- **Decisions** panel (client accept/decline/question responses) and **Analytics** panel (`ShareAnalyticsCard`: views + per-section dwell)
- `LinkedToPanel` ties the proposal to an org + deal; "Save as template"; delete proposal
- Save indicator ("Saved 3s ago")

**How it is used / workflows**
- Build deck → add/price packages → link to deal+org → Publish → Share link or email → watch Decisions/Analytics → client acceptance flips status

**Links**
- → `/preview/proposal/[id]`, `/p/proposal/[token]`, `/clients/[id]`, `/pipeline/[id]`; variants can reference a schedule (timelineScheduleId)
- ← `/proposals` list; `/calculator` draft; deal detail

**Under the hood** - APIs: `/api/admin/proposals/[id]` (GET/PATCH), `/sections`(+`/[sectionId]`), `/variants`(+`/[variantId]`), `/publish`, `/share`, `/email`, `/preview-data`; Tables: `proposals`, `proposalSections`, `proposalVariants`, `proposalAcceptances`; Components: `ProposalDetail`, `TypedSectionFields`, `ShareAnalyticsCard`, `EmailShareModal`, `LinkedToPanel`

### Proposal templates - `/proposals/templates`
`Audience: Admin` · `Status: 🟡 Built`

**What it is.** Library of reusable proposal blueprints saved from any proposal, instantiated in one click on the next deal.

**Key features**
- Table of templates (name, description, created); Preview, Rename (`PromptDialog`/PATCH), Delete
- "Create from template" POSTs to `/api/admin/proposals` with `templateId` and routes into the new editor

**Links**
- → `/proposals/[id]` (newly created); ← `/proposals` ("Templates" button)

**Under the hood** - APIs: `/api/admin/proposals/templates` (GET/POST), `/templates/[id]` (PATCH/DELETE); Tables: `proposalTemplates`; Components: `TemplatesContent`

### Proposal public viewer - `/p/proposal/[token]`
`Audience: Public` · `Status: 🟡 Built`

**What it is.** The no-auth client-facing proposal: a paginated agency document with a dark cover hero and page-by-page sections, ending in the package decision.

**Key features**
- Renders the published snapshot through `ProposalSectionBlock` (one renderer per section type), brand-green accent words via `{{...}}` title syntax
- Accept / Decline / Ask-a-question flow per variant → POST `/accept` (captures name/email/role/comment); rejects if revoked or already decided
- View + per-section dwell tracking (`useShareViewTracking`, `useSectionDwellTracking`) feeding the admin analytics heatmap

**Links**
- → POST acceptance (can trigger downstream contract); ← shared from `/proposals/[id]`

**Under the hood** - APIs: `/api/public/proposals/[token]` (GET), `/accept` (POST), `/api/public/views`, `/api/public/section-views`; Tables: `proposals` (publishedSnapshot), `proposalAcceptances`, `shareViews`, `shareSectionViews`; Components: `ProposalViewer`, `CoverPage`, `PageChrome`

### Proposal internal preview - `/preview/proposal/[id]`
`Audience: Admin` · `Status: 🟡 Built`

**What it is.** Admin-only render of the proposal viewer mounted outside the dashboard layout (no sidebar crop), reading **live** state rather than the published snapshot. Noindex.

**Under the hood** - uses `ProposalViewer` with `previewProposalId`; reads `/api/admin/proposals/[id]/preview-data`; redirects non-Tahi orgs.

### Schedules - `/schedules`
`Audience: Admin` · `Status: 🟡 Built, near-green`

**What it is.** List of shareable project gantts/timelines - the delivery plan you hand a client.

**Key features**
- `DataTable`: Name, Status (draft/shared/sent/signed/completed/archived), Org, Deal, Target launch date; status multiselect filter + search
- `NewScheduleDialog` (blank or from template); row actions Preview, Open public viewer, Delete

**Links**
- → `/schedules/[id]`, `/schedules/templates`, `/clients/[id]`, `/pipeline/[id]`, `/p/schedule/[token]`
- ← Sales nav; `/calculator` (Draft schedule); proposal variant timelines

**Under the hood** - APIs: `/api/admin/schedules` (GET/POST), `/templates`, `/[id]` (DELETE); Tables: `projectSchedules`, `scheduleSections`, `scheduleRows`; Components: `SchedulesContent`, `NewScheduleDialog`

### Schedule editor - `/schedules/[id]`
`Audience: Admin` · `Status: 🟡 Built, near-green (the delivery spine)`

**What it is.** Section-based builder where the headline section is a **Gantt timeline** of weekly rows (phases/tasks/gates) with owners, plus a delivery spine that links each row to real Requests and Tasks for live status.

**Key features**
- Section types: gantt timeline, risk register, and others; reorder, cover meta editor, weeks/target-launch
- `GanttGrid` rows with `RowType` (phase/task/gate) and `RowOwner` (tahi/client/joint/tahi_parallel); `RowEditor` slide-over to edit row, `GanttLegend`
- **Linked work** per row: attach/detach existing requests & tasks (sets `scheduleRowId` on those records via PATCH to `/api/admin/requests|tasks/[id]`)
- **Delivery status**: live per-row status dots + engagement rollup computed from linked requests'/tasks' statuses (`computeEngagementStatus`)
- Draft/Publish snapshot model; share/unshare token; email share; Preview → `/preview/schedule/[id]`; `ShareAnalyticsCard` analytics; `LinkedToPanel` (org/deal)

**How it is used / workflows**
- Lay out phases on the gantt → set owners → link each phase to its delivery requests/tasks → publish/share → row dots reflect real delivery progress as work moves

**Links**
- → `/preview/schedule/[id]`, `/p/schedule/[token]`, linked `/requests/[id]` and `/tasks` items, `/clients/[id]`, `/pipeline/[id]`
- ← `/schedules`; `/calculator` draft; proposal variant `timelineScheduleId`

**Under the hood** - APIs: `/api/admin/schedules/[id]` (GET/PATCH), `/sections`(+`/reorder`,`/[sectionId]`), `/rows`(+`/reorder`,`/[rowId]`), `/linked-work`, `/delivery-status`, `/publish`, `/share`, `/email`, `/preview-data`; Tables: `projectSchedules`, `scheduleSections`, `scheduleRows`, `requests`, `tasks`; Components: `ScheduleDetail`, `GanttGrid`, `GanttLegend`, `LinkedWorkSection`, `RowEditor`, `LinkedToPanel`; lib: `delivery-status`

### Schedule templates - `/schedules/templates`
`Audience: Admin` · `Status: 🟡 Built`

**What it is.** Reusable schedule structures; rename/delete and instantiate into a new schedule.

**Under the hood** - APIs: `/api/admin/schedules/templates` (GET), `/templates/[id]` (PATCH/DELETE); Tables: `scheduleTemplates`; Components: `TemplatesContent`

### Schedule public viewer - `/p/schedule/[token]`
`Audience: Public` · `Status: 🟡 Built`

**What it is.** Client-facing read of the published schedule (gantt + sections) as a paginated document; noindex.

**Under the hood** - APIs: `/api/public/schedules/[token]`, `/api/public/views`, `/api/public/section-views`; Components: `ScheduleViewer`, deliverable primitives (`gantt-grid`)

### Schedule internal preview - `/preview/schedule/[id]`
`Audience: Admin` · `Status: 🟡 Built`

**What it is.** Chrome-free admin render of the live schedule; same `ScheduleViewer`, noindex, non-Tahi orgs redirected.

### Contracts - `/contracts`
`Audience: Admin` · `Status: 🟡 Built, near-green`

**What it is.** List of legal documents (NDA, SLA, MSA, SOW, MOU, other) with multi-signer e-sign status.

**Key features**
- `DataTable` with **two** permanent filter chips (status + type) plus search; status set: draft, sent, partially_signed, signed, expired, cancelled
- Create `SlideOver` (org, type, template, name); Tiptap body; Org link, Delete
- Row link to org → `/clients/[id]`, open public viewer → `/p/contract/[token]`

**Links**
- → `/contracts/[id]`, `/contracts/templates`, `/clients/[id]`, `/p/contract/[token]`
- ← Sales nav; `/calculator` (Draft contract); proposal acceptance flow

**Under the hood** - APIs: `/api/admin/contracts` (GET/POST), `/templates`, `/[id]`; Tables: `contractDocuments`, `contractSigners`, `contractSignatures`; Components: `ContractsContent`, `DataTable`, `FilterBar`

### Contract editor - `/contracts/[id]`
`Audience: Admin` · `Status: 🟡 Built, near-green`

**What it is.** Three-view editor (Body / Signers / Activity) with a right rail for sending and tracking signatures. Signed/cancelled/expired states lock the body to read-only so the signature chain can't be edited under signers' feet.

**Key features**
- Tiptap contract body; type/status/expiry meta; `LinkedToPanel` (org + deal + originating proposal)
- **Signers** management (name, email, order, status pending/signed/skipped) with per-signer signing URLs derived from the share token
- **Send for signature**: mints share token, flips draft → sent, sets sentAt, returns each signer's `/p/contract/[token]/sign/[signerId]` path
- Email pending signers (`EmailShareModal`); revoke (back to draft, clears token, cancels pending)
- **Activity** view = tamper-evident signature audit chain; Preview → `/preview/contract/[id]`

**How it is used / workflows**
- Draft body → add signers → Send → signers e-sign in order → final signature flips contract to signed and fires fully-signed emails

**Links**
- → `/p/contract/[token]/sign/[signerId]`, `/preview/contract/[id]`, `/clients/[id]`, `/pipeline/[id]`, originating proposal
- ← `/contracts`; calculator draft

**Under the hood** - APIs: `/api/admin/contracts/[id]` (GET/PATCH), `/signers`(+`/[signerId]`), `/send`, `/email`, `/preview-data`; Tables: `contractDocuments`, `contractSigners`, `contractSignatures`; Components: `ContractDetail`, `TiptapDocEditor`, `LinkedToPanel`, `EmailShareModal`

### Contract templates - `/contracts/templates`
`Audience: Admin` · `Status: 🟡 Built`

**What it is.** Reusable contract bodies using `{{variable}}` slots filled at create time; create/rename/delete.

**Under the hood** - APIs: `/api/admin/contracts/templates` (GET/POST/PATCH), `/templates/[id]` (DELETE); Tables: `contractTemplates`; Components: `TemplatesContent`

### Contract public viewer - `/p/contract/[token]`
`Audience: Public` · `Status: 🟡 Built`

**What it is.** Client-facing read of the contract document (view mode); noindex.

**Under the hood** - APIs: `/api/public/contracts/[token]`; Components: `ContractViewer` (mode `view`)

### Contract signing - `/p/contract/[token]/sign/[signerId]`
`Audience: Public` · `Status: 🟡 Built`

**What it is.** The per-signer e-signature flow (`ContractViewer` in `mode="sign"`).

**Key features**
- Captures a drawn signature data URL and records it with a **tamper-evident hash chain** (`chainHash = sha256(prevChainHash || signerId || signatureDataUrl || timestamp)`)
- When the last pending signer completes, status flips to `signed` and fully-signed notification emails fire

**Links**
- ← signing link emailed/sent from `/contracts/[id]`

**Under the hood** - APIs: `/api/public/contracts/[token]/sign/[signerId]` (POST); Tables: `contractSignatures`, `contractSigners`, `contractDocuments`; lib: `contract-fully-signed-emails`

### Contract internal preview - `/preview/contract/[id]`
`Audience: Admin` · `Status: 🟡 Built`

**What it is.** Chrome-free admin render of the contract; noindex.

### Project calculator - `/calculator`
`Audience: Admin` · `Status: 🟡 Built, near-green (premium, closest to crossing into daily-trusted)`

**What it is.** Internal pricing/scoping engine. Left pane is the input form; right rail is a live recommendation (target price, margin, capacity check, benchmarks). Saved calcs can pre-fill a proposal, schedule, or contract.

**Key features**
- Scope inputs across four categories (Webflow, Engineering, Design, Strategy): hours, delivery mode (ourselves/contractor), contractor rate, plus tool licence cost
- Project type (project / retainer / project+retainer), timeline (start, duration weeks, target launch - auto-derived), retainer plan (maintain/scale, monthly hours, months), client factors (currency, complexity multiplier, relationship, returning)
- Live server compute (`compute()`, debounced 400ms): **Quote target** with floor/target/stretch range + target margin %, cost-vs-margin `DonutChart`
- **Capacity** check against booked pipeline hours (under/over capacity warning, required vs available hours this quarter)
- **Benchmarks**: median value for similar deals over 24 months, your-price-vs-median
- Save/auto-save with history per deal/org (`isActive` flag); **Draft from this calc** → one-click create Proposal / Schedule / Contract pre-filled (3 seeded variants for proposals) and back-linked

**How it is used / workflows**
- Open from a deal (?dealId) → tune scope/hours/retainer → read target + capacity + benchmark → Save → Draft proposal/schedule/contract to start the artefact chain

**Links**
- → `/proposals/[id]`, `/schedules/[id]`, `/contracts/[id]` (drafted artefacts, back-linked via `linkedArtefactRef`)
- ← opened with `?dealId`/`?orgId` from deal detail; Sales nav

**Under the hood** - APIs: `/api/admin/calculator` (GET/POST/PATCH/DELETE), `/calculator/draft` (POST); Tables: `projectCalculations`, `proposals`+`proposalVariants`, `projectSchedules`, `contractDocuments`, `deals`; Components: `CalculatorContent`, `DraftActions`, `DonutChart`, `FeatureCard`; lib: `calculator/compute`, `calculator/types`

### Sales analytics - `/sales-analytics`
`Audience: Admin` · `Status: 🟡 Built, working - pipeline shape only; deeper proposal/schedule/contract performance is a Phase 8 placeholder`

**What it is.** Visual read of pipeline shape, conversion and momentum. The page itself derives charts in-browser from the live deals + stages; the richer per-artefact analytics endpoints feed the broader `/reports` surface.

**Key features**
- Hero `FeatureCard` tiles: pipeline snapshot + next-to-close
- KPI cells: total pipeline value, won value, **close rate** (won/lost), open count
- `FunnelChart` of deals by stage; `DonutChart` (e.g. open vs won/lost mix); `MultiBarChart` of closed-won value by month grouped by source (last 6 months)
- Explicit "coming in Phase 8" note listing close-rate-by-source and other deeper cuts

**How it is used / workflows**
- Quick weekly pulse on pipeline health and conversion before deeper drilldown in `/reports`

**Links**
- → `/pipeline` / deal detail (via deal references); ← Sales/Reports nav
- Related deeper analytics endpoints (consumed by `/reports` and the overview pipeline tile, not this page directly): `/api/admin/reports/sales`, `/close-rates`, `/pipeline-forecast` (weighted-by-stage-probability forecast), `/response-time`

**Under the hood** - APIs (this page): `/api/admin/deals?limit=100`, `/api/admin/pipeline/stages`; deeper: `/api/admin/reports/{sales,close-rates,pipeline-forecast,response-time}`; Tables: `deals`, `pipelineStages`, `dealStageTransitions`; Components: `SalesAnalyticsContent`, `FunnelChart`, `DonutChart`, `MultiBarChart`, `FeatureCard`

Note: `/api/admin/reports/response-time` currently returns partly randomised average-response minutes (placeholder logic) - treat that metric as not yet real.

I have enough to document all four pages comprehensively.

## Clients

The CRM-meets-account-management surface: a filtered client roster, plus a deep per-client hub where billing, profitability, contacts, calls, contracts and onboarding all converge. People (contacts) and brands each get their own canonical detail pages.

### Clients list - `/clients`
`Audience: Admin` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** The master roster of client organisations (active, paused, churned, archived). Prospects are deliberately excluded here and live in the sales pipeline instead.

**Key features**
- `DataTable` with sortable columns: Client (avatar + industry + website), Status, Plan, Health (coloured dot), Open request count, and Last activity (relative time).
- `FilterBar` with two permanent multiselect chips: Status (active/paused/churned/archived) and Plan (maintain/scale/tune/launch/hourly/custom), plus a debounced name/website search.
- Status filter is URL-backed (`?status=`, `?q=`) so views are shareable; archived rows are fetched via a separate API call and merged when "archived" is part of a wider selection.
- "Add client" `SlideOver` form: name, website, industry dropdown, plan, and an optional primary contact (name + email) who gets an invite on save.
- Row click and a row action both open the client detail; keyboard shortcut `tahi:shortcut` "new-client" opens the create form.
- Honours impersonated team-member access scoping (all_clients / plan_type / specific_clients); viewer-impersonation hides the Add button.

**How it is used / workflows**
- Daily: scan health + open-request load across the book of business, jump into a client.
- Onboard a new client: Add client -> creates org, optional primary contact, and (for maintain/scale) auto-provisions a subscription + tracks + default kanban columns, then routes to the detail page.

**Links**
- → {Client detail} (`/clients/[id]`, on row click / Add)
- → {Sales pipeline} (mentioned: prospects live there, not here)
- ← reached FROM the sidebar Clients nav group

**Under the hood** - APIs: `/api/admin/clients` (GET list with status/search/open-request counts, POST create + provision); Tables: `organisations`, `contacts`, `subscriptions`, `tracks`, `kanbanColumns`, `requests`; Components: `ClientList`, `DataTable`, `FilterBar`, `SlideOver`, `NewClientForm`

### Client detail - `/clients/[id]`
`Audience: Admin` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** The central per-client hub: a 16-tab workspace covering everything from billing and profitability to contacts, calls, contracts, brands and activity. Loads one composite payload (`org`, `contacts`, `subscription`, `tracks`, `recentRequests`).

**Key features**
- Header actions: View as Client (impersonation -> `/overview`), send Welcome Email, New Deal, Refresh, and Archive/Unarchive. Header shows health dot, status + plan badges, website, and a `TrackMeter`.
- Tabs: Overview, Requests, Track Queue, Files, Invoices, Contracts, Contacts, Calls, Messages, Brands, Deals, Time, Activities (CRM), Revenue, Profitability, Activity.
- Overview tab: signal tiles, `OrgDetailsCard` (inline edit of name/website/industry/status, health status + note, billing model, custom MRR + currency, default hourly rate, preferred currency, retainer start/end dates), `EngagementHealthCard` (gated `clients.engagement_health`), request-mix chart, contacts card, subscription card (add-on toggles, billing interval editor), brands card, tags card, internal notes.
- Billing auto-derivation: `OrgDetailsCard` can re-derive billing model + retainer dates from signals, with per-field "re-enable auto" controls (billingModel / retainerDates / customMrr) that clear manual overrides.
- PM assignment: a project-manager selector backed by the `teamMemberAccess` rules (project_manager role scoped to this org).
- Contacts tab: add/edit contacts, set primary, and "start DM" which spins up a direct external conversation and jumps to Messages.
- Track Queue tab: auto/custom/off override of small/large track counts (upsell logic). Profitability tab: gross-margin metrics with manual client costs. Revenue tab: invoiced/paid/outstanding/LTV/billable-hours KPIs. Calls tab: `DiscoveryCallsCard` for scheduled calls. Contracts tab: per-client contract tracking.

**How it is used / workflows**
- Onboarding fans out from here: send Welcome Email (Resend to primary contact), MailerLite group add and HubSpot/Xero contact match are available via the integrations APIs, and maintain/scale plan selection provisions subscription + tracks; onboarding step state + Loom are stored on the org (`onboardingState`, `onboardingLoomUrl`) and surfaced to the client portal.
- Recurring: review engagement health, adjust billing/retainer terms, assign a PM, log costs and check margin, schedule calls, attach contracts.

**Links**
- → {Overview} (View as Client impersonation), {Sales pipeline} (`/pipeline?new=1&orgId=` New Deal), {Messages} (start DM), {Brand detail} (`/clients/brands/[id]`), {Contact detail} (`/clients/contacts/[id]`), {Requests} (recent requests), {Invoices}, {Contracts}, {Calls}
- ← reached FROM {Clients list} and anywhere an org is linked (contact/brand breadcrumbs)

**Under the hood** - APIs: `/api/admin/clients/[id]` (GET composite + PATCH), `/api/admin/clients/[id]/pm`, `/api/admin/clients/[id]/auto-derive`, `/api/admin/clients/[id]/profitability`, `/api/admin/clients/[id]/costs`, `/api/admin/clients/[id]/welcome-email`, `/api/admin/clients/[id]/calls`, `/api/admin/subscriptions/[id]/change-cycle`; Tables: `organisations`, `contacts`, `subscriptions`, `tracks`, `clientCosts`, `invoices`, `timeEntries`, `scheduledCalls`, `contracts`, `teamMemberAccess`; Components: `ClientDetail`, `OverviewTab`, `OrgDetailsCard`, `SubscriptionCard`, `ProfitabilityTab`, `DiscoveryCallsCard`, `EngagementHealthCard`

### Brand detail - `/clients/brands/[id]`
`Audience: Admin` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** A read-focused profile for a single brand owned by a client org (one org can have multiple brands), surfacing brand identity, linked contacts and tagged request volume.

**Key features**
- Brand header: logo (with graceful fallback to a colour swatch), name, primary-colour chip, website link.
- Brand metadata: primary colour, website, notes, and a tagged-request count.
- Linked contacts list (avatar, primary badge, role) each clicking through to the contact detail.
- Tagged-requests summary block (count only, with empty state).

**How it is used / workflows**
- Reference a brand's visual identity and see which contacts and how many requests are associated.

**Links**
- → {Client detail} (`/clients/[id]`, breadcrumb + org link), {Contact detail} (`/clients/contacts/[id]`, per linked contact)
- ← reached FROM {Client detail} Brands tab / overview brands card

**Under the hood** - APIs: `/api/admin/brands/[id]` (GET single brand with org, contacts, requestCount), `/api/admin/brands` (list/create); Tables: `brands`, `organisations`, `contacts`, `requests`; Components: `BrandDetail`

### Contact detail - `/clients/contacts/[id]`
`Audience: Admin` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** The canonical per-person identity page: one contact, their org, their deals, their activity history and their messages all in one place (the people model where one person can hold many roles).

**Key features**
- Contact header: name, primary badge, role, email (mailto), and last-login timestamp.
- Org card linking to the parent client (status + plan + website).
- Linked Deals section (via the `dealContacts` junction) with stage, value (native + NZD), and per-deal contact role.
- Activity Timeline (calls, emails, meetings, notes) with the ability to log a new activity (`POST /api/admin/activities`).
- Recent Messages list, each linking back to its source request.

**How it is used / workflows**
- See a single person's full relationship: which deals they touch, what's been logged against them, and their recent communications. Log a new activity inline.

**Links**
- → {Client detail} (`/clients/[id]`, breadcrumb + org card), {Requests} (`/requests/[id]` from a message), Deals (linked deals)
- ← reached FROM {Client detail} contacts, {Brand detail} linked contacts, pipeline/deal contact references

**Under the hood** - APIs: `/api/admin/contacts/[id]` (GET contact + org + deals + activities + messages), `/api/admin/activities` (POST log activity); Tables: `contacts`, `organisations`, `deals`, `dealContacts`, `pipelineStages`, `activities`, `messages`; Components: `ContactDetail`, `ActivityTimeline`

I have enough to write the comprehensive output.

## Marketing - Content Studio & Sitemap

Tahi's in-house AI SEO content engine (Phase I): a multi-tab studio that audits indexing health, generates and drafts blog/glossary posts through a multi-agent round-table, manages internal links, and publishes to Webflow - plus an internal sitemap planner. Powerful but new: several D1 migrations were still pending at last status, and most content crons are registered-but-disabled (run manually via `/settings/crons` with `?force=1`), so treat the whole area as Built, not yet daily-trusted.

### Content studio - `/content-studio`
`Audience: Admin` · `Status: 🟡 Built, working, not daily-trusted (new; crons off, migrations pending)`

**What it is.** A single tabbed surface that runs Tahi's blog engine end to end: indexing Health, AI Ideas, a multi-agent Drafts pipeline, internal Links, publishing Schedule, the Site index, post Audits and content Backfill. Admin-only (non-admins redirect to `/overview`).

**Key features**
- Eight state-driven tabs (`?tab=` deep-linkable): Health, Backfill, Ideas, Drafts, Links, Schedule, Site index, Audits.
- Top **AI spend strip** showing today/week/month/all-time cost in cents, broken down by provider (`/api/admin/content/spend`, `aiCostLog`).
- **Health tab:** pulls every sitemap URL (~201) and checks Google Search Console index status; KPI strip (Indexed / Not indexed / Partial-Neutral / Unknown), sortable `DataTable` (URL, type, status, coverage, last-checked, page-fetch), batched "Scan now" that loops on `continueFromIndex` to dodge worker timeouts, plus a structured 412 diagnostic when GSC isn't connected. Embeds a `BackfillCard` at the bottom.
- **Ideas tab:** weekly AI-generated topic ideas mapped to 8 topical clusters (seedable cluster map, multi-select colour chips), per-idea cards with target keyword / recommended word count / brand (Tahi vs Staci) / source signal; approve/reject, a "New idea" manual drawer with duplicate detection (against existing ideas + published posts), a per-idea notes drawer (Liam opinion + targeted questions), "Run ideation now" and a one-click "Round table" that spawns a draft and navigates to its detail page.
- **Drafts tab:** the multi-agent pipeline grouped into 7 buckets (researching, drafting, reviewing, finalising, queued, ready, failed) with soft 6s polling while in-flight, content-score badges + score breakdown bars, a draft detail drawer, discard (returns idea to Approved), and retry/re-draft.
- **Links tab:** internal-link suggestion engine grouped by target URL with before/after diff + confidence badge; scan, apply (stages a patch in Webflow, 409 if source drifted), reject.
- **Schedule tab:** ready/scheduled/published counts, ready-draft cards with Publish-now / auto-slot / custom-date, and a combined history table merging scheduled-pending drafts with `publishHistory`.
- **Site index, Audits, Backfill** rendered from sibling components (see below).

**How it is used / workflows**
- Weekly: run ideation → review/approve ideas → kick a round-table → watch drafts → schedule/publish to Webflow.
- Ongoing SEO hygiene: scan Health for dropped/never-indexed URLs; run Links to add inbound internal links; Backfill legacy posts missing schema/FAQ.

**Links**
- → `/content-studio/drafts/[id]/round-table` (idea round-table launch and every draft "Review"/"View")
- → `/settings` and `/settings/crons` (GSC/Google Workspace + Webflow connection, manual cron runs, auto-backfill toggles)
- ← reached FROM the sidebar (Marketing/Content group) and from `?tab=` notification deep-links

**Under the hood** - APIs: `/api/admin/content/health(+/scan)`, `/api/admin/content/ideas(+/[id], /manual, /[id]/round-table)`, `/api/admin/content/drafts`, `/api/admin/content/links/suggestions(+/scan, /[id]/apply)`, `/api/admin/content/schedule`, `/api/admin/content/spend`, `/api/admin/content/clusters(+/seed)`; Tables: `blogHealth`, `contentIdeas`, `contentClusters`, `contentDrafts`, `linkSuggestions`, `publishHistory`, `aiCostLog`; Components: `ContentStudioContent`, `HealthTab`, `IdeasTab`, `DraftsTab`, `LinksTab`, `ScheduleTab`, `SpendStrip`, `BackfillCard`

### Round table (draft detail) - `/content-studio/drafts/[id]/round-table`
`Audience: Admin` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** The full readable detail page for one draft (or audit): the brief, body, 23-reviewer critiques across revision tabs, the EIC/Opus content score, cover image, schema, and every publish/repair control.

**Key features**
- Pipeline view via `/drafts/[id]/pipeline`: working title, status badge, content score with tone, revision tabs each carrying all 23 reviewer critiques (pass/fail verdicts, per-reviewer scores).
- Stage controls: `advance` (steps=3), `pause`/`resume`, `approve-brief`/`reject-brief`, `force-approve`, `restart` (wipes all pipeline outputs back to queued), `restructure` (re-split fields, strip fabricated links, re-run 200-link gate + schema validation).
- Improvement + edit tooling: `audits/[id]/improve` (apply audit improvements), `suggest-edits`, conflict resolution panel (`conflicts/[id]` - side with reviewer A / B / editor), `repair-schema`.
- Cover generation: `set-cover`, `regenerate-cover` (FLUX image or SVG generator).
- Publishing: `publish` with modes draft / now / auto (next Mon/Wed/Fri 09:00 UK) / custom; `send-to-staci`; copy body as Markdown or HTML.
- Surfaces missing-env warnings (e.g. `ANTHROPIC_API_KEY` flagged critical for every drafting + reviewer call), and a failed-score recovery path when sign-off score is below threshold.

**How it is used / workflows**
- Drive a single post: approve brief → advance through researcher/writer/reviewers → read critiques → resolve conflicts → fix score → regenerate cover → publish or hand to Staci.

**Links**
- ← reached FROM `/content-studio` Ideas (round-table launch), Drafts cards, and Audits (newly created audit opens here)
- → Webflow (publish target), `/settings` (Anthropic/Webflow keys)

**Under the hood** - APIs: `/api/admin/content/drafts/[id]/pipeline`, `/advance`, `/publish`, `/force-approve`, `/restart`, `/regenerate-cover`, `/repair-schema`, `/api/admin/content/conflicts/[id]`; Tables: `contentDrafts`, `draftReviews`, `draftRevisions`, `draftVariants`, `editorOverrides`; Components: `RoundTableDetail`

### Site index (tab) - `/content-studio` → Site index
`Audience: Admin` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** A live inventory of every URL on tahi.studio, each with a Haiku one-line summary and an embedding, used as context for the writer's internal-linking, glossary auto-link, related-posts and backlink discovery.

**Key features**
- Lists indexed URLs with filters/chips; "Sync now" triggers the `site-index-sync` cron to refresh summaries/embeddings.

**Under the hood** - APIs: `/api/admin/content/site-index`, `/api/admin/cron/site-index-sync`; Tables: `siteIndex`; Components: `SiteIndexContent`

### Audits (tab) - `/content-studio` → Audits
`Audience: Admin` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** Runs the 23-reviewer round-table retroactively against an existing published post: synthesises a brief, scores the post, lands at `audited` with score + critiques. Nothing in Webflow is changed (~$1.50/audit).

**Key features**
- Enter a slug or full blog URL → "Run audit"; creates an audit that opens the round-table detail page to watch reviewers run; list of past audits with status + score tones.

**Links**
- → `/content-studio/drafts/[id]/round-table` (newly created audit opens there)

**Under the hood** - APIs: `/api/admin/content/audits` (GET/POST), `/api/admin/content/audits/[id]/improve`; Tables: `contentDrafts`, `draftReviews`; Components: `AuditsContent`

### Backfill (tab) - `/content-studio` → Backfill
`Audience: Admin` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** A coverage scoreboard + orchestrator that fills gaps (schema, FAQ, internal links, body rewrites) on existing blog posts and glossary terms, with single-item, bulk, and auto (weekly cron) modes.

**Key features**
- `coverage-audit` scoreboard with per-item health score and "missing" pills; single backfill for a glossary term or post; bulk backfill across one/both types; glossary term generation + publish + per-term audit/upgrade; backfill-settings (default tier schema/audit/full) and an auto-backfill toggle that drives the `content-auto-backfill` cron.

**Under the hood** - APIs: `/api/admin/content/coverage-audit`, `/api/admin/content/bulk-backfill`, `/api/admin/content/posts/[id]/backfill`, `/api/admin/content/glossary/[id]/backfill`, `/glossary/generate`, `/glossary/publish`, `/api/admin/content/backfill-settings`; Tables: `blogBackfillLog`, `postScorecards`, `settings`; Components: `BackfillContent`, `BackfillCard`

### Content crons - `/api/admin/cron/*`
`Audience: Admin (cron secret)` · `Status: 🟠 Built but disabled-by-default / migrations pending`

**What it is.** The background engine behind the studio: registered in wrangler crons but mostly disabled, gated on `settings` flags and a `TAHI_CRON_SECRET`/`CRON_SECRET`. Liam runs them manually from `/settings/crons` (Run now / `?force=1`).

**Key features**
- `ideation` (weekly idea slate; skips if Google Workspace not connected), `draft-approved-ideas` (auto-draft approved ideas), `publish-scheduled` (push scheduled drafts to Webflow), `link-engine-scan` (internal-link suggestions), `content-gap-hunt`, `content-auto-backfill` (flag-gated `content.autoBackfillEnabled` / `autoRewriteBody`), `round-table-advance`, `schema-watchdog`, `indexing-reverser` (pings IndexNow via `INDEXNOW_KEY`), `site-index-sync`, `backlink-process`, `post-scorecard-sync` (GA4 + GSC scorecards; needs Google connected).
- Publishing path (`drafts/[id]/publish`) resolves Webflow Authors/Categories collection refs, computes next slot from `publishHistory`, writes a history row, and best-effort pings IndexNow for "now" publishes.

**Under the hood** - APIs: all `/api/admin/cron/*` content jobs + `/api/admin/content/drafts/[id]/publish`; Tables: `settings`, `publishHistory`, `backlinkQueue`, `postScorecards`, `siteIndex`, `aiCostLog`; External: Webflow CMS, IndexNow, Google Search Console / GA4

### Sitemap - `/sitemap`
`Audience: Admin (email-allowlisted)` · `Status: 🟡 Built / internal tool`

**What it is.** A long-lived site-architecture planner for Liam and Staci: a node tree on the left, an auto-saving node editor on the right, with an AI "Boardroom" of 6 site-level reviewers. Hard-gated server-side - anyone off the allowlist gets a 404 (not 403) via `assertSitemapPageAccess()`.

**Key features**
- Hierarchical sitemap node tree (add child, duplicate, delete, expand/collapse, descendant counts); node detail editor that auto-saves patches on blur with live status badges.
- AI machinery gated to the owner (`business@tahi.studio`; Staci can view/edit docs but not run AI): per-node review and "review all", plus a "Boardroom" run of all 6 site-level reviewers (brand voice, etc.) against the whole sitemap (~$0.30, 30-60s) with apply-suggestion actions.
- Export the sitemap (`/api/admin/sitemap/export`); seed current site nodes.

**How it is used / workflows**
- Plan/restructure site architecture, run AI reviewers for brand-voice/SEO critique, apply suggestions, export for reference.

**Links**
- ← reached FROM direct URL only (hidden, 404-gated; not in standard nav for non-allowlisted users)
- → Content studio site index (shared notion of live URLs; conceptual, not a hard link)

**Under the hood** - APIs: `/api/admin/sitemap/nodes(+/[id], /[id]/duplicate, /[id]/review)`, `/api/admin/sitemap/review-site`, `/seed-current`, `/export`; Tables: `sitemapNodes`, `sitemapNodeReviews`; Components: `SitemapContent`, `Tree`, `TreeRow`, `NodeDetail`; Guard: `lib/sitemap-auth.ts`

## Marketing - Social, Reviews & Announcements

The marketing surface covers outbound social (Buffer mirror), the inbound review/testimonial/case-study pipeline (admin + public + portal), and broadcast announcements (admin builder + client banner). All three admin pages sit under the `social` / `reviews` / `announcements` feature keys in `lib/feature-tree.ts` (team-only nav).

### Social - `/social`
`Audience: Admin` · `Status: 🟡 Built, not daily-trusted`

**What it is.** A read-only, high-level mirror of Liam's personal social activity pulled live from Buffer's GraphQL API. It is explicitly not a composer or scheduler; for composing and per-post analytics it links out to Buffer.

**Key features**
- KPI strip: connected channel count, posts in last 30 days, scheduled-queue size, and a computed cadence (posts/day with "consistent / building / getting started" labels).
- Connected channels card (service + display name, with a "paused" badge when a channel's queue is paused).
- 30-day posting cadence bar chart built client-side from sent posts (`useMemo` histogram, hover tooltips).
- Scheduled queue preview (next 5 upcoming posts) and recent sent posts (latest 10, 4-line clamp).
- Refresh button (re-fetches status + posts) and "Open Buffer" deep link to `publish.buffer.com`.
- Graceful states for not-configured (missing `BUFFER_API_KEY`) and connected-but-no-channels.
- Note in UI: Buffer's API does not expose per-post engagement (likes/comments/shares), so none is shown.

**How it is used / workflows**
- At-a-glance check that the founder's social cadence is being kept up; spot gaps in the cadence chart, then jump to Buffer to compose.
- A separate bulk-upload workflow ("I have 31 LinkedIn posts to schedule") is served by the `schedule-posts` API (queue / spread / daily modes), though the page itself does not expose a compose UI.

**Links**
- → out to `publish.buffer.com` (compose, analytics, channel settings)
- ← reached FROM the Marketing nav group (`/social`)

**Under the hood** - APIs: `/api/admin/integrations/buffer/status`, `/api/admin/integrations/buffer/posts` (`?status=sent|scheduled&count=N&service=`), `/api/admin/integrations/buffer/schedule-posts` (bulk POST, rate-limited 100 mutations/15min), `/api/admin/integrations/buffer/debug`; Tables: none (proxies Buffer GraphQL); Components: `SocialContent`, `SectionCard`, `KpiCard`, `PostRow`

### Reviews & testimonials - `/reviews`
`Audience: Admin` · `Status: 🟡 Built, not daily-trusted`

**What it is.** The case-study and testimonial outreach pipeline. One row per client org, joined to its `caseStudySubmissions` record, tracking outreach state, NPS, testimonials, permissions and Clutch reviews.

**Key features**
- Stats strip: total clients, reviews completed, net NPS (with average), marketing-permission count, video-testimonial count (promoter/detractor math done client-side).
- Filter tabs by `outreachStatus`: All / Not sent / Asked / In progress / Completed / Declined / Deferred, plus name search.
- Per-row: org name + plan/project, NPS score with promoter/passive/detractor label, content indicators (written testimonial / video / Clutch), status badge.
- Quick actions: "mark as asked" (Send icon) and copy a tokenised review link (`/review?token=...`) to the clipboard.
- Expandable detail: review details (NPS, submitted date, follow-up `nextAskAt`, `neverAsk` opt-out flag), permissions granted (website / logo / case study), feedback highlights (loved most / to improve), full written testimonial, video testimonial link, Clutch review link.
- Inline status-change badges (`not_sent`/`asked`/`deferred`/`declined`/`in_progress`/`completed`); choosing "deferred" auto-sets `nextAskAt` to +7 days; "declined" sets `neverAsk=1` server-side.
- "Generate draft" on completed submissions calls the case-study draft endpoint - currently a placeholder template, not live Claude output (route TODO: "Wire to Claude API").

**How it is used / workflows**
- Pick a client to ask for a review, mark "asked" and send the tokenised link; chase deferred clients after their `nextAskAt`; on completion, generate a case-study draft.
- Bulk-trigger outreach for all active orgs older than N days (default 90) that lack a submission via the `outreach` endpoint, skipping `neverAsk` orgs.

**Links**
- → out to the public review form `/review/[token]` (passes the submission token; link is copied from the row)
- → out to `clutch.co` (Clutch review prompt) and external video URLs (Loom/YouTube/Vimeo)
- ← reached FROM the Marketing nav group (`/reviews`); the portal nudge at `/api/portal/review-outreach` surfaces the same "asked" state to clients

**Under the hood** - APIs: `/api/admin/reviews` (GET list join, POST status/`nextAskAt`/`neverAsk`), `/api/admin/reviews/outreach` (bulk trigger), `/api/admin/case-studies/draft` (placeholder draft); Tables: `caseStudySubmissions`, `caseStudies`, `organisations`, `contacts`; Components: `ReviewsContent`, `StatCard`, `PermissionRow`, `ContentTag`

### Public review form - `/review/[token]`
`Audience: Public` · `Status: 🟡 Built, not daily-trusted`

**What it is.** The unauthenticated, token-gated form a client follows from the outreach email to leave their review. No Clerk login required; the submission token is the auth.

**Key features**
- Multi-step wizard (`Step` state machine): NPS → testimonial → video → case-study interest → permissions → done, with a step progress bar ("Step X of N").
- Captures `npsScore`, written testimonial, video URL, case-study interest, plus logo and marketing permissions.
- Token lifecycle handling: loading, invalid/expired token (`410`), and already-submitted (`409` → "Already submitted") states.
- Submitting marks the submission `completed` server-side.

**How it is used / workflows**
- Client clicks the email link, walks the wizard, submits; the admin `/reviews` row then shows the captured NPS, testimonial and permissions.

**Links**
- ← reached FROM the outreach email and the copied link in `/reviews`; the email "yes/defer/no" CTAs route through `/api/public/review/respond` (yes → `in_progress` then redirect here; defer → `nextAskAt` +7d; no → `neverAsk=1`)

**Under the hood** - APIs: `/api/public/review` (GET validate token + org info, POST submit), `/api/public/review/respond` (email CTA handler/redirect); Tables: `caseStudySubmissions`, `organisations`; Components: `ReviewForm` (`review-form.tsx`)

### Announcements - `/announcements`
`Audience: Admin` · `Status: 🟡 Built, not daily-trusted`

**What it is.** A broadcast-banner builder. Admins compose announcements targeted at all clients, a plan type, or a specific org list, optionally publishing immediately and emailing recipients.

**Key features**
- `DataTable` of announcements (title, type, audience, status, created), sortable, default sort newest-first.
- `FilterBar` multiselect by status (draft/active/expired - derived from `publishedAt`/`expiresAt`), type (info/warning/success/maintenance), and audience; plus title/body search.
- "New announcement" slide-over: title, body, type, audience (`all` / `plan_type` / `org`), plan selector (maintain/scale/tune/launch) when targeting by plan, optional expiry date, and "publish immediately" checkbox.
- View slide-over showing the full body, type/status/audience badges and target value, plus published/expires dates.
- Refresh action.

**How it is used / workflows**
- Draft an announcement, target an audience, publish (now or later); use the `[id]/send` endpoint to publish and fan out emails via Resend to the resolved contact list (all contacts / plan-matched / specific orgs).
- Clients see published, non-expired announcements as a dismissible banner scoped to their org/plan.

**Links**
- → drives the client-side `announcement-banner.tsx` banner (rendered in portal surfaces; demoed in `/design-system`)
- ← reached FROM the Marketing nav group (`/announcements`)

**Under the hood** - APIs: `/api/admin/announcements` (GET list `?active=`, POST create), `/api/admin/announcements/[id]/send` (publish + Resend email fan-out), `/api/portal/announcements` (GET, target-filtered by org plan / org-id), `/api/portal/announcements/[id]/dismiss`; Tables: `announcements`, `announcementDismissals`, `contacts`, `organisations`; Components: `AnnouncementsContent`, `CreateAnnouncementSlideOver`, `AnnouncementBanner`

Caveat: the client `AnnouncementBanner` currently persists dismissals to `localStorage` (`tahi-dismissed-announcements`) rather than calling the `/api/portal/announcements/[id]/dismiss` endpoint, so the server-side `announcementDismissals` table is not written from the banner UI. The case-study "Generate draft" produces a placeholder template (Claude wiring is a TODO), so treat AI drafting as 🟠 stub within an otherwise built pipeline.

## Finance

The finance suite spans an operational invoice ledger, recurring billing, time tracking, and two reporting surfaces (one daily-trusted finance cockpit, one broad reports hub). All admin pages gate on `orgId === NEXT_PUBLIC_TAHI_ORG_ID`; clients see scoped portal variants of Invoices and Billing only.

### Invoices - `/invoices`
`Audience: Admin|Client` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** The operational invoice ledger. Admins see every invoice across all clients reconciled from Manual, Stripe, and Xero sources; clients see only their own invoice history.

**Key features**
- `DataTable` of invoices with sortable Client / Amount / Status / Source / Due / Created columns; row click opens the detail page.
- `FilterBar` with persistent multiselect Status chips (draft, sent, viewed, overdue, paid, written_off) and (admin-only) Source chips (manual, teal Xero, purple Stripe), plus free-text search over client name + invoice ID and an inline due-date range.
- Effective-status computation: a `sent` invoice past its due date renders as `overdue` client-side.
- Create-invoice slide-over with a destination toggle (Dashboard only / Xero draft / Stripe link), client search, multi-line items, currency (NZD/USD/AUD/GBP/EUR), due date, notes. On submit it POSTs locally then optionally calls Xero sync or Stripe create; pre-flights that the client has an email contact before allowing Stripe (and copies the Stripe pay URL to clipboard).
- Header actions (admin): Export CSV, Import from Stripe (reports imported/updated/skipped), Create invoice.
- Amounts show native currency with a display-currency equivalent via the global currency switcher.

**How it is used / workflows**
- Create an invoice and push it to Stripe (get a payment link) or Xero (draft) without leaving the dashboard.
- Periodically pull paid/new invoices from Stripe via Import; reconcile and chase overdue invoices using the Status filter.

**Links**
- → links OUT to `/invoices/[id]` (row click, after create) and `/clients/[id]` (Client column link)
- ← reached FROM sidebar Finance nav; `/billing` admin view ("View all" + recent invoices)

**Under the hood** - APIs: `/api/admin/invoices` (GET list / POST create), `/api/admin/invoices/stripe-create`, `/api/admin/invoices/xero-sync`, `/api/admin/integrations/stripe/import-invoices`, `/api/admin/export/invoices`, `/api/portal/invoices`; Tables: `invoices`, `invoiceItems`, `organisations`, `contacts`; Components: `InvoiceList`, `CreateInvoiceSlideOver`, `DataTable`, `FilterBar`

### Invoice detail - `/invoices/[id]`
`Audience: Admin|Client` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** A single invoice view with line items, totals (subtotal, GST/tax, discount), metadata, and admin lifecycle actions.

**Key features**
- Header card: client, large total (with display-currency equivalent), status pill; metadata grid (invoice ID, created, due date with overdue highlight, sent/paid dates, Stripe ID, Xero ID, source).
- Line-items table and totals block; tax shown as stored or implied (GST 15% label for NZD), discount line when present.
- Admin action row (state-aware): Send to Client (draft→sent), Mark as Paid, Revert to Draft, Void Invoice (also voids in Xero if linked), Sync to Xero, Create Stripe Link (surfaces real Stripe errors, copies pay URL), Copy Payment Link, Delete Invoice.
- Status patches stamp `paidAt` / `sentAt` timestamps.

**How it is used / workflows**
- Drive an invoice through its lifecycle (draft → sent → paid / written off), and reconnect it to Stripe/Xero as needed.

**Links**
- → links OUT to `/invoices` (back/breadcrumb), `/clients/[id]` indirectly
- ← reached FROM `/invoices` list, `/billing`

**Under the hood** - APIs: `/api/admin/invoices/[id]` (GET/PATCH/DELETE), `/api/admin/invoices/xero-sync`, `/api/admin/invoices/stripe-create`, `/api/admin/integrations/stripe/provision`, `/api/admin/invoices/[id]/send-email` (Resend email to primary contact); Tables: `invoices`, `invoiceItems`; Components: `InvoiceDetail`, `MetaField`, `ActionButton`, `Breadcrumb`

### Billing - `/billing`
`Audience: Admin|Client` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** A subscriptions and billing overview. For clients it is a self-serve plan + invoice + Stripe-portal view; for admins it is a read-only subscriptions and revenue summary. (The page is gated by `requirePageFeature('billing')`; deeper billing setup lives on the client detail page, not here.)

**Key features**
- Client view: Current Plan card (plan label, status, billing interval, renewal date, cycle total, included add-ons with savings), "Manage Billing" button opening the Stripe customer portal in a new tab, and an Invoice History table.
- Admin view: KPI cards (active subscriptions, total clients, recent invoices, outstanding), "Clients by Billing Interval" (monthly/quarterly/annual) tiles, Active Subscriptions table (client, plan, status, interval, priority, next billing), and a Recent Invoices table with a "View all" link.

**How it is used / workflows**
- Client: review plan, jump to Stripe to update card/cancel, scan invoice history.
- Admin: glance at the subscription book, interval mix, and outstanding balance.

**Links**
- → links OUT to `/invoices` (admin "View all"); client view opens external Stripe billing portal
- ← reached FROM sidebar Finance nav

**Under the hood** - APIs: `/api/portal/invoices`, `/api/portal/subscription`, `/api/portal/billing/session` (Stripe portal session), `/api/admin/subscriptions`, `/api/admin/invoices`; related admin: `/api/admin/derive-billing`, `/api/admin/billing/financial-health`, `/api/admin/billing/monthly-email`, `/api/admin/billing/xero-export`; Tables: `subscriptions`, `invoices`, `organisations`; Components: `BillingContent`, `AdminBillingView`, `BillingKPI`, `InvoiceStatusBadge`

### Time tracking - `/time`
`Audience: Admin` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** A manual time-logging ledger with rollups and analytics. Admin-only (non-admins are redirected to `/requests`). Live per-request timers are exposed via the timers API but driven from the request detail surface, not this page.

**Key features**
- Summary cards: total hours, billable hours, entry count.
- Insight row (driven by the filtered set): "this view" hero tile (top contributor + billable %), Hours-by-team-member bar chart (top 8), and a billable-vs-non-billable donut.
- Two view tabs: Entries (`DataTable` of date/member/client/request/hours/billable/notes with row actions Open request + Delete) and By client (expandable per-client groups with totals).
- `FilterBar` (billable select, client + member multiselect) plus search and a date-range picker.
- Log-time slide-over: client, team member, optional request, hours, hourly rate, date, billable toggle, notes.
- Export CSV.

**How it is used / workflows**
- Log hours against a client/request, then review utilisation by member or by client; export for billing/reporting.

**Links**
- → links OUT to `/requests/[id]` (request column / row action)
- ← reached FROM sidebar Finance nav; time rollups feed `/reports` utilisation

**Under the hood** - APIs: `/api/admin/time` (GET/POST), `/api/admin/time/[id]` (DELETE), `/api/admin/timers` (+`/[id]`, `/ping` - live timer start/stop/keepalive), `/api/admin/export/time`, `/api/admin/requests/[id]/time-entries`; Tables: `timeEntries`, `requests`, `organisations`, `teamMembers`; Components: `TimeList`, `LogTimeSlideOver`, `ByClientView`, `DataTable`, `BarChart`, `DonutChart`

### Financial reports - `/financial-reports`
`Audience: Admin` · `Status: 🟢 Live and daily-trusted`

**What it is.** The finance cockpit Liam opens to make hire, spend, and tax decisions. A single long, section-jumped dashboard reconciling Stripe, Xero, and Airwallex, with everything respecting the global currency switcher. Gated by `requirePageFeature('financial_reports')`.

**Key features**
- Hero band: cash + dual runway card (total cash, reserve donut with %, gross vs net-burn runway, bank-sync freshness chip + inline "Sync bank") and a revenue card (MRR, ARR, YTD, new MRR this month, retainer count, revenue sparkline).
- "Needs your attention" watchlist: overdue AR, stalled sales engine (no deals 60d), unreserved tax, high client concentration, stale bank balances - each jumps to its section.
- Cash section: bank balances table (native + display equivalent, source chips, reserved total) and reserve pots with accrual progress; AI anomalies card.
- Revenue section: quarterly target vs actual/projection (editable), YoY card, monthly revenue history.
- MRR section: per-client MRR breakdown table (native × FX = NZD, share bars) and client-concentration donut with top-3 risk hint.
- Sales section: sales velocity (30/60/90d), pipeline funnel + open pipeline, recent paid invoices and signed deals, AR aging buckets.
- Outflows section: recurring outflows CRUD, cost-mix donut + essential/discretionary split, forex exposure.
- Tax section: GST/corp-tax owed YTD vs reserve coverage; Take-home section (Liam/Staci progress vs targets, editable); Planning section: reserve target editor, spend-impact what-if, productivity (revenue/hour, cash conversion, time-to-pay, win-rate by source).
- Header actions: Sync bank (Airwallex), Recompute MRR (backfill), Reload.

**How it is used / workflows**
- Daily: open, check cash/runway and the watchlist, sync bank if stale, decide on spend/hires.
- Maintain recurring outflows and reserve/tax targets; recompute MRR after client changes.

**Links**
- → links OUT to `/clients` (edit per-client MRR), internal section anchors (cash/revenue/mrr/sales/outflows/tax/takehome/planning)
- ← reached FROM sidebar Finance nav; overlaps with `/reports` Finance group

**Under the hood** - APIs: `/api/admin/financial-reports/summary` (the big aggregate) + `/anomalies`, `/backfill-mrr`, `/subscriptions-audit`; `/api/admin/integrations/airwallex/sync`, `/api/admin/reserves`, `/api/admin/commitments`, `/api/admin/exchange-rates`; Tables: `invoices`, `subscriptions`, `organisations`, `deals`, `timeEntries`, `reserves`/`commitments`, `exchangeRates`, `airwallex_balances`; Components: `FinancialReportsContent`, `HeroCashCard`, `HeroRevenueCard`, `NeedsAttentionCard`, `RecurringOutflowsCard`, `DonutChart`, `LineChart`, `DataTable`

### Reports - `/reports`
`Audience: Admin` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** The broad analytics hub: operations, sales, finance, and team reports on one sticky-jump-nav page (admin-only; non-admins redirect to `/requests`). Recharts-based; respects the display-currency switcher.

**Key features**
- `SectionTabs` jump nav grouped Operations / Sales / Finance / Team (Overview, Response Time, Pipeline, Retainer Health, Financial Health, Fixed Costs, Cash Flow, Xero P&L (past), Client Margin, Team Utilisation).
- Overview KPI strip (clients, open requests, billable hours, outstanding) + Requests-by-status pie, monthly request volume bar, delivery-time trend, subscriptions by plan type.
- Financial Health: MRR / invoiced / paid / outstanding KPIs, weighted pipeline forecast bar, expandable invoice-aging buckets with per-invoice drilldown.
- Response Time per team member (with CSV export), Sales Pipeline (pipeline value, weighted forecast, win rate, avg deal size, deal-count-by-stage), Sales Funnel / close rates, Stage Velocity, Sales Cycle Length, Close Rate + Source Breakdown.
- Retainer Health monitor, Commitments / Fixed Costs (CRUD with cadence + auto-detect), Cash-Flow Forecast, Team Utilisation, Xero expenses / P&L trend, Client Profitability scorecard.

**How it is used / workflows**
- Periodic deep-dives across throughput, sales conversion, AR aging, retainer health, and client margins; export specific tables to CSV.

**Links**
- → links OUT to many internal anchors; overlaps the finance cockpit; deal data shares stage colours with the Sales pipeline board
- ← reached FROM sidebar Reports nav

**Under the hood** - APIs: `/api/admin/reports/overview`, `/sales`, `/close-rates`, `/pipeline-forecast`, `/retainer-health`, `/retainer-alerts`, `/response-time`, `/utilization`, `/cash-flow-forecast`, `/client-profitability`, `/invoice-aging`, `/expenses`, `/bank-balances`, `/ai-cost`, `/billing-summary`; plus `/api/admin/billing/financial-health`, `/api/admin/commitments`, `/api/admin/exchange-rates`; Tables: `requests`, `invoices`, `subscriptions`, `deals`, `timeEntries`, `commitments`, `exchangeRates`; Components: `ReportsContent`, `FinancialHealthSection`, `SalesPipelineSection`, `CommitmentsSection`, `CashFlowForecastSection`, `SectionTabs`, `KPIStrip`

Relevant files (all absolute): `/Users/liammillerdev/ShipStudio/tahi-dashboard/app/(dashboard)/invoices/{page.tsx,invoice-list.tsx,[id]/invoice-detail.tsx}`, `/Users/liammillerdev/ShipStudio/tahi-dashboard/app/(dashboard)/billing/billing-content.tsx`, `/Users/liammillerdev/ShipStudio/tahi-dashboard/app/(dashboard)/time/time-list.tsx`, `/Users/liammillerdev/ShipStudio/tahi-dashboard/app/(dashboard)/financial-reports/financial-reports-content.tsx`, `/Users/liammillerdev/ShipStudio/tahi-dashboard/app/(dashboard)/reports/reports-content.tsx`.

## Operations, Knowledge & Settings

The admin backbone for running the studio: who has capacity, who can see what, where the team knowledge lives, and every dial that configures the dashboard.

### Capacity - `/capacity`
`Audience: Admin` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** A team-utilisation and pipeline-forecast dashboard that answers "do we have room to take on this deal, and when could it start?". Admin-only (non-admins redirect to `/overview`).

**Key features**
- KPI strip: Total team capacity, Committed (from subscriptions), Utilisation %, Available hrs/wk - utilisation tile turns warning/danger above 70/90%.
- Team-utilisation bar overlaying committed hours plus a weighted-pipeline ghost segment.
- Pipeline Capacity Impact: Weighted / Worst case (deals >50% probability) / Best case (all deals close) hour tiles, plus a per-month deal forecast table.
- Capacity Timeline: an 8-week Recharts line chart (total vs committed vs committed+pipeline).
- Per-member capacity bars (weekly hours).
- Sales Call Helper: a deal-impact calculator - enter hrs/wk for a prospective deal and it returns the earliest start date, weeks out, and resulting utilisation.

**How it is used / workflows**
- On a sales call, type the deal's weekly hours into the Deal Impact Calculator to quote a realistic start date.
- Weekly capacity review: read utilisation vs available before committing new work.

**Links**
- ← reached FROM sidebar (Operations group)
- → conceptually feeds the Sales pipeline (`/deals`) capacity picture; pulls forecast from open deals

**Under the hood** - APIs: `/api/admin/capacity/start-date` (POST), `/api/admin/capacity/forecast`, `/api/admin/team-members`; Tables: `teamMembers`, `subscriptions`, `tracks`, `deals`; Components: `CapacityContent`, `KPIStrip`, `PageHeader`, Recharts `LineChart`

### Tracks - `/tracks`
`Audience: Client` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** The client-portal track-queue view: every request bucketed into per-track mini-kanban lanes (Up next / In progress / Review / Delivered). For admins this page is just an explainer that points them to manage tracks per client.

**Key features**
- Per-track lanes with drag-to-reorder; cross-track moves are type-validated server-side (a `large_task` can never land in a small track).
- Three capacity modes: `auto` (real small/large tracks), `custom` (synthetic track shells), and `off` (one unified board).
- Ghost-track upsells: shows locked tracks a higher plan would unlock (auto mode + retainer plan only), linking to `/billing`.
- Empty/loading states; refresh action.
- Admin view renders an `EmptyState` directing to `/clients` (track queues are managed from a client's detail page, not here).

**How it is used / workflows**
- Client reorders what they want worked on next; the queue ordering drives delivery priority.
- Admin manages the actual queue per client from the client detail page.

**Links**
- → `/requests` (lane cards open the request; `basePath="/requests"`)
- → `/billing` (ghost-track upgrade CTA, no-tracks CTA)
- → `/clients` (admin explainer CTA)
- ← reached FROM sidebar / client portal nav

**Under the hood** - APIs: `/api/portal/capacity`, `/api/portal/capacity/reorder` (PUT); admin equivalents `/api/admin/tracks/[trackId]`(+`/reorder`), `/api/admin/clients/[id]/tracks`; Tables: `tracks`, `requests`, `subscriptions`; Components: `TracksContent`, `TrackQueueView`, `bucketTracks`/`bucketUnified` (`lib/track-lanes`), `getUpgradeGhostTracks` (`lib/plan-utils`)

### Team - `/team`
`Audience: Admin` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** The team-member directory plus access-scoping engine. Admin-org only; gated additionally by `requirePageFeature('team')`.

**Key features**
- Two tabs: **Members** (DataTable) and **Org chart** (`OrgChart` component).
- KPI strip (headcount, weekly capacity, avg per person, contractors) + a discipline-mix donut derived from job titles + a "team this week" feature card.
- Add/Edit member SlideOver: name, email, title, role (admin/member), comma-separated skills, weekly capacity hours, contractor flag.
- "Add me" self-link banner when the logged-in Clerk user has no team-member record.
- Row actions: Edit, Manage access, **View as** (impersonation), Remove (confirm dialog, cascades access rules).
- **Access rules SlideOver** - the scoping core: access role (`project_manager` / `task_handler` / `viewer`), client scope (`all_clients` / `plan_type` / `specific_clients`), plan type picker (maintain/scale/tune/launch/hourly), specific-client checklist, and track type (all/small/large).
- FilterBar pinned role filter + search across name/email/title.

**How it is used / workflows**
- Onboard a teammate, then open Manage access to grant a scoped slice of clients (deny-by-default for non-admins).
- "View as" to QA exactly what a scoped member sees, landing on `/overview`.

**Links**
- → `/overview` (View-as impersonation lands here)
- → `/clients` (access panel loads org list)
- ← reached FROM sidebar and from `/settings` (Team section "Go to Team Management")
- ↔ closely related to `/permissions` (this page handles data-scoping access rules; permissions handles feature visibility)

**Under the hood** - APIs: `/api/admin/team`(+`/[id]`, `/[id]/access`, `/org-chart`), `/api/admin/team-members`, `/api/admin/clients`; Tables: `teamMembers`, `teamMemberAccess`, `teamMemberAccessOrgs`; Components: `TeamContent`, `OrgChart`, `AccessPanel`, `DataTable`, `setTeamMemberImpersonation`

### Permissions - `/permissions`
`Audience: Admin` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** The granular feature-visibility builder - "admins can toggle everything for anyone". Admin+ only (`requirePageManage()` redirects non-managers).

**Key features**
- Three tabs: **Team members**, **Clients**, **Roles**.
- Team tab: assign a level role per member via a `SearchableSelect` (super_admin/admin/project_manager/task_handler/viewer, or "No role = default admin"), optimistic with toast.
- Per-subject **Configure features** SlideOver walking the `FEATURE_TREE`: each feature/sub-feature gets a three-way control **Inherit | Allow | Deny** plus an optional free-text reason. Denying a parent hides its children.
- Audience-aware: Team/Role panels show `team` features; Client panel shows client-portal features only.
- Auto-saves each change; `inherit` clears the override back to the level default.

**How it is used / workflows**
- Assign a role to set a member's baseline, then override individual features allow/deny with a documented reason.
- Lock down a specific client's portal surfaces, or set role-wide defaults that apply to everyone in that role.

**Links**
- ↔ pairs with `/team` (Team does data scoping; Permissions does feature visibility)
- ← reached FROM sidebar (admin-only nav)

**Under the hood** - APIs: `/api/admin/permissions/subjects`, `/api/admin/permissions/feature-visibility` (GET/PUT), `/api/admin/permissions/assign-role` (POST), `/api/admin/permissions/me`; Tables: `featureVisibility`, `roles`, `teamMemberRoles`; Components: `PermissionsBuilder`, `FeaturePanel`, `ThreeWayControl`, `FEATURE_TREE` (`lib/feature-tree`), permission resolution in `lib/permissions`

### Docs Hub - `/docs`
`Audience: Admin` · `Status: 🟢 Live and daily-trusted`

**What it is.** The team knowledge base - every operating doc, brand note, and process in one searchable place, with a Notion-grade editor and version history. Admin-org only.

**Key features**
- FilterBar (multiselect Categories chip: Brand/Services/Sales/Operations/Team/Product) + full-text search across title and body.
- DataTable of pages (title, category chips, relative updated time), sortable.
- View/edit SlideOver (56rem) with a lazy-loaded Tiptap editor (`TiptapDocEditor`); markdown/HTML auto-detected and rendered.
- Multi-category tagging stored as a comma-separated list (legacy single-value rows stay valid).
- **Version history**: History toggle lists saved versions, each viewable; "Current" badge on the latest.
- New-page and delete (with confirm) flows; deep-link auto-open via `?doc=<id>`.

**How it is used / workflows**
- Write/maintain SOPs and brand/sales docs; reference them during work.
- Certain docs are wired into AI surfaces as context (see Settings → AI context docs).

**Links**
- ← reached FROM Settings → AI context docs (which references doc IDs) and the sidebar
- → deep-linked from AI surfaces via `?doc=<id>`

**Under the hood** - APIs: `/api/admin/docs`(+`/[id]`, `/import`, `/seed`); Tables: `docPages`, `docVersions`; Components: `DocsContent`, `TiptapDocEditor`, `DataTable`, `FilterBar`, `SlideOver`, `renderMarkdown`/`looksLikeHtml` (`lib/markdown`)

### Settings - `/settings`
`Audience: Admin|Client` · `Status: 🟡 Built, working, not daily-trusted` (Cash reserves sub-section is 🟢)

**What it is.** The master config page. Clients see a slim view (profile + appearance + email notifications); admins see ~20 stacked sections covering integrations, automation config, catalogues, and AI wiring.

**Key features (admin)**
- **Appearance**: dark-mode toggle persisted to `localStorage` (`tahi-theme`).
- **Integrations** status grid: Stripe, Xero (Custom Connection), Slack, MailerLite, HubSpot (marked Built-in / disabled).
- **Notifications**: email + Slack toggles (saved to `settings`).
- **Cash reserves** (🟢 daily-trusted): full CRUD of reserve pots that drive disposable-cash math on `/financial-reports`.
- **Branding** and **Modules** toggles; **Request Forms** builder (per-category/per-client intake forms with question types text/textarea/url/select/multiselect/checkbox/file); **Webhooks** (outgoing endpoints CRUD); **Kanban Columns** (global + per-client column overrides); **Task Templates** CRUD.
- **Pipeline Defaults** (default deal owner, nudge signature HTML), **Pipeline Stages** editor, **Lead AI & automations**.
- **Scheduled jobs** link card → `/settings/crons`; **AI context docs** (maps Docs Hub pages to AI prompts, e.g. Services + Pricing doc); **Google Workspace** (Calendar + Drive OAuth, GA4 discover, calendar sync), **Buffer** (personal social), **AI cost** dashboard, **Content-engine signals** (Phase I), **Google Calendar booking** link, plus Team/Billing/Account info cards.
- **Client view**: editable profile (name, role; email read-only) + dark mode + email notifications.

**How it is used / workflows**
- Connect/verify integrations, tune pipeline defaults, edit intake forms and kanban defaults, manage cash reserves, wire AI context docs.

**Links**
- → `/team` (Team section), `/settings/crons` (scheduled jobs), `/settings/automations`, `/settings/audit`
- ← `/affiliates` deep-links here to add a Rewardful key; Docs Hub pages are referenced by AI context section
- → `/financial-reports` (reserves feed its disposable-cash math)

**Under the hood** - APIs: `/api/admin/settings`, `/api/admin/reserves`(+`/[id]`), `/api/admin/forms`(+`/[id]`), `/api/admin/webhooks`, `/api/admin/kanban-columns`(+`/[id]`), `/api/admin/task-templates`, `/api/admin/integrations/{status,google/*,buffer/*}`, `/api/admin/pipeline/stages`, `/api/admin/reports/ai-cost`, `/api/portal/profile`; Tables: `settings`, `requestForms`, `kanbanColumns`, `integrations`, `cashReserves`; Components: `SettingsContent` + many section sub-components (`ReservesSection`, `FormsSection`, `WebhooksSection`, `KanbanColumnsSection`, `AiContextDocsSection`, `ContentEngineSignalsSection`, `GoogleIntegrationSection`, `BufferIntegrationSection`)

> Note: `/api/admin/services`(+`/coupons`) and `/api/admin/views` exist for the catalogue/saved-views features but are not rendered as sections on this Settings page (the AI-context section only *references* a Services + Pricing doc id).

### Settings · Audit Log - `/settings/audit`
`Audience: Admin` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** A read-only viewer over the immutable action log of admin activity across the dashboard.

**Key features**
- Filters: action (created/updated/deleted/login/impersonated/status_changed), entity type (request/client/invoice/task/team_member/conversation/contract/automation), date-from/date-to.
- Table: timestamp, actor (truncated id + type), colour-coded action badge, entity, entity id, metadata summary.
- Simple page-based pagination (50/page).

**How it is used / workflows**
- Investigate who changed what / when; review impersonation and deletion events.

**Links**
- ← reached FROM `/settings` (back-arrow to Settings)

**Under the hood** - APIs: `/api/admin/audit`; Tables: `auditLog`; Components: `AuditLogContent`, `ActionBadge`

### Settings · Automations - `/settings/automations`
`Audience: Admin` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** The trigger/action automation rule builder.

**Key features**
- Rule list with active/disabled chip, trigger + action chips, and execution count / last-executed.
- Create-rule form: name, trigger (request_created, request_status_changed, request_overdue, invoice_overdue, client_inactive, client_onboarded), and one-or-more actions (assign_request, change_status, send_notification, send_email, post_slack, create_task).
- Per-rule enable/disable toggle and delete.

**How it is used / workflows**
- Build "when X happens, do Y" rules (e.g. notify team on new request, post to Slack on status change).

**Links**
- ← reached FROM `/settings` (back-arrow)
- → fires Slack/email/notification side-effects; logged to `/api/admin/automations/log`

**Under the hood** - APIs: `/api/admin/automations`(+`/[id]`, `/log`); Tables: `automationRules`, `automationLog`; Components: `AutomationsContent`, `CreateRuleForm`

### Settings · Scheduled Jobs (Crons) - `/settings/crons`
`Audience: Admin` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** Observability and manual control for every background cron job.

**Key features**
- Per-cron card: label, schedule badge, last-run status chip (success/error/skipped) with relative time + duration, description, and inline error block.
- **Run now** button to fire a cron manually (POSTs the cron's endpoint), refreshing after ~800ms.
- Collapsible "Recent runs (last 10)" history with status, time, duration, and summary.

**How it is used / workflows**
- Verify a cron's last run, debug failures, or trigger one on demand (relevant given several content-engine crons ship disabled by default).

**Links**
- ← reached FROM `/settings` (Scheduled jobs link card, plus back-arrow)
- → POSTs each cron's own endpoint (e.g. affiliate reactivation, content-engine jobs)

**Under the hood** - APIs: `/api/admin/crons` (lists registry + history); Tables: `cronRuns`; Components: `CronsContent`, `PageHeader`, `Badge`

### Affiliates - `/affiliates`
`Audience: Admin` · `Status: 🟠 Partial / known gap`

**What it is.** An affiliate-tracking list view currently reading from Rewardful; a native referral/attribution/payout replacement is planned (Phase C). Admin-only.

**Key features**
- Connect-Rewardful empty state linking to `/settings` when no API key is configured.
- Summary tiles: Affiliates, Referrals, Commissions counts + "last synced" label.
- DataTable: affiliate name/email, state badge (active/pending/disabled), visitors, leads, conversions, commissions (NZD); search + state FilterBar.
- Types are loose because the endpoint currently returns connection status with mostly empty arrays until the rebuild populates richer data.

**How it is used / workflows**
- Glance at affiliate performance once Rewardful is connected and synced.

**Links**
- → `/settings` (connect Rewardful / add API key)
- ← reached FROM sidebar (admin nav)

**Under the hood** - APIs: `/api/admin/integrations/rewardful`(+`/sync`), `/api/admin/cron/affiliate-reactivation`; Tables: `integrations` (Rewardful config); Components: `AffiliatesContent`, `DataTable`, `FilterBar`, `StatTile`

### Design System - `/design-system`
`Audience: Admin` · `Status: 🟡 Built (internal reference, hidden route)`

**What it is.** The canonical token + primitive showcase - "when a page disagrees with this surface, the page is wrong." Hidden (no sidebar link), admin-only.

**Key features**
- Sticky TOC across nine sections: Colours, Typography, Spacing, Radii, Shadows, Motion, Iconography, Brand, Components.
- Live swatches for brand/neutral/semantic/status palettes; Manrope type ladders (display + dashboard UI); spacing scale; the leaf-radius family; shadow + motion token previews.
- Iconography: ~70 static Lucide icons + 9 animated icons (each with its production "home"); the brand leaf glyph and wordmarks.
- Components gallery sub-nav rendering every primitive in its real states: Button, Avatar, Badge, Card, FeatureCard, KPICard, Tooltip, Menu, Toast, Charts, DataTable, Callout, Stepper, Progress, File list, Composer, Message bubble/thread, Kanban board, Board view.

**How it is used / workflows**
- Reference when building/reviewing UI to keep tokens and primitives consistent; copy token names.

**Links**
- ← reachable only by direct URL (no nav entry); admins redirected to `/overview` if non-admin

**Under the hood** - APIs: none (static showcase); Components: `DesignSystemContent` importing the full `components/tahi/*` primitive set + `tahi-glyphs`, `animated-icons`

Relevant files (all absolute):
`/Users/liammillerdev/ShipStudio/tahi-dashboard/app/(dashboard)/capacity/{page,capacity-content}.tsx`, `/tracks/{page,tracks-content}.tsx`, `/team/{page,team-content}.tsx`, `/permissions/{page,permissions-content}.tsx`, `/docs/{page,docs-content}.tsx`, `/settings/{page,settings-content}.tsx`, `/settings/audit/{page,audit-log-content}.tsx`, `/settings/automations/{page,automations-content}.tsx`, `/settings/crons/{page,crons-content}.tsx`, `/affiliates/{page,affiliates-content}.tsx`, `/design-system/{page,design-system-content}.tsx`.

I have enough to write the documentation now.

## Client Portal

What a client organisation sees. The portal reuses the same `app/(dashboard)` routes as admin but renders client views gated on `orgId !== NEXT_PUBLIC_TAHI_ORG_ID`, calls `/api/portal/*` (every route re-checks `getPortalAuth` and rejects the Tahi org), and scopes all data to the signed-in `orgId`. Navigation collapses to a bottom tab bar on mobile via `components/tahi/mobile-bottom-nav.tsx`. Two hard privacy rules run throughout: requests are client-visible but internal messages/items are filtered out, and tasks are never exposed to the portal.

### Portal Overview - `/overview`
`Audience: Client` · `Status: 🟡 Built, not daily-trusted`

**What it is.** The client's home screen: a greeting, request KPIs, retainer capacity, onboarding, call booking, and a recent-requests feed. Selected by `OverviewPage` when `isAdmin` is false, rendering `ClientOverview`.

**Key features**
- Greeting with first name + org name ("{orgName} (Tahi Studio workspace)") and a primary "New Request" CTA linking to `/requests?new=1`.
- Three `StatCard`s: Open Requests, Awaiting Review (highlighted amber when > 0), Invoices Due (hardcoded `--` placeholder, not wired).
- `TrackCapacityCard` showing retainer track usage (small/large) with upsell prompts.
- Amber "{n} requests waiting for your review" alert linking to `/requests?status=client_review`.
- `OnboardingChecklist` wrapper (steps + Loom video), `ScheduleCallWidget`, `BookingWidget` (Google Calendar embed), and `ReviewOutreachBanner` (testimonial ask).
- "Your Requests" `SectionCard` (first 6 active requests) with loading/empty/populated states; empty state CTA to submit first request.

**How it is used / workflows**
- Daily check-in: see what is awaiting client review, jump in to approve.
- Onboarding: new clients work the checklist + watch the Loom.
- Book a call or submit a new request.

**Links**
- → `/requests`, `/requests?new=1`, `/requests?status=client_review`, `/invoices` (KPIs and alerts)
- ← reached FROM sidebar / mobile bottom nav (home)

**Under the hood** - APIs: `/api/portal/requests?status=active`, `/api/portal/capacity`, `/api/portal/onboarding`, `/api/portal/settings/booking`, `/api/portal/review-outreach`; Tables: `requests`, `tracks`, `subscriptions`, `organisations`; Components: `ClientOverview`, `TrackCapacityCard`, `OnboardingChecklist`, `BookingWidget`, `ReviewOutreachBanner`, `ScheduleCallWidget`

### Portal Requests - `/requests`
`Audience: Client` · `Status: 🟡 Built, not daily-trusted`

**What it is.** The client's request workspace: a list/board of their org's requests with a guided intake dialog for submitting new ones. Shared `RequestList` component, branched on `isAdmin`.

**Key features**
- Fetches from `/api/portal/requests` (admin uses `/api/admin/requests`); status filter tabs and search.
- Read-only `StatusBadgeCell` for clients (no inline status editing); due-date chips with overdue/due-soon states.
- Custom Kanban columns are admin-only (fetch of `/api/admin/kanban-columns` is skipped for clients), so clients fall back to the default board columns.
- `NewRequestDialog` (opened by `?new=1`) loads a resolved intake form per category via `/api/portal/request-forms?category=...` and submits answers as `formResponses` JSON; AI-assisted drafting via `AiRequestWizard` (`/api/portal/ai/request-wizard`).

**How it is used / workflows**
- Submit a request: pick category, fill the resolved intake form (or use the AI wizard), submit.
- Track in-flight work via tabs/board; open a request to review deliverables.

**Links**
- → `/requests/[id]` (open a request)
- ← reached FROM Overview ("Your Requests", New Request CTA), sidebar / bottom nav

**Under the hood** - APIs: `/api/portal/requests` (GET/POST), `/api/portal/request-forms`, `/api/portal/ai/request-wizard`; Tables: `requests`, `requestForms`; Components: `RequestList`, `NewRequestDialog`, `AiRequestWizard`

### Portal Request Detail - `/requests/[id]`
`Audience: Client` · `Status: 🟡 Built, not daily-trusted`

**What it is.** A single request's full view: status/steps, the message thread, and attached files, scoped to the client's org. Shared `RequestDetail` component with `apiBase` switched to `/api/portal`.

**Key features**
- Loads request, files, and messages from `/api/portal/requests/[id]`, `/[id]/files`, `/[id]/messages`; the `[id]` route enforces `eq(requests.orgId, orgId)` and rejects the Tahi org (404 on cross-org).
- Privacy split: clients only see non-internal messages (route comment "client only sees non-internal"); internal notes are filtered server-side. Tasks and time cards are admin-only (`isAdmin &&` gated): `TimeCard`, `DiscoveryCallsCard`, sub-requests creation, due-date editing are all hidden from clients.
- `RequestThread` message view + composer (`canBeInternal={isAdmin}` so clients can't post internal notes; placeholder "Add a comment or question…").
- File attachment list (clients view/download; create is admin-only). Request steps/phase progress are read-only for clients.

**How it is used / workflows**
- Review a deliverable, approve or ask for changes via the thread, download files.

**Links**
- → file download/proxy; ← reached FROM `/requests` list/board and Overview

**Under the hood** - APIs: `/api/portal/requests/[id]` (+ `/files`, `/messages`, `/steps`); Tables: `requests`, `messages`, `files`, `voiceNotes`; Components: `RequestDetail`, `RequestThread`, `RequestSteps`, `FileAttachmentList`

### Portal Messages - `/messages`
`Audience: Client` · `Status: 🟡 Built, not daily-trusted`

**What it is.** The client's conversation inbox, restricted to external (client-visible) conversations only. Shared `MessagesContent`, branched to `/api/portal/conversations`.

**Key features**
- Conversation list fetched from `/api/portal/conversations`; the route returns only conversations where the contact participates OR org-scoped channels with `visibility = 'external'`, then double-filters `c.visibility === 'external'` and last-message preview is external-only.
- Per-conversation message pane via `/api/portal/conversations/[id]/messages` (GET/POST); file attachments uploaded through `/api/uploads/presign` + `/confirm`.
- Internal-only conversation actions (e.g. admin internal-note posting) are gated behind `isAdmin` and unavailable to clients.

**How it is used / workflows**
- Message the Tahi team and read replies in external threads tied to the org or specific requests.

**Links**
- ← reached FROM sidebar / bottom nav; related request threads surface from `/requests/[id]`

**Under the hood** - APIs: `/api/portal/conversations` (+ `/[id]/messages`), `/api/uploads/presign`, `/api/uploads/confirm`; Tables: `conversations`, `conversationParticipants`, `messages`, `contacts`; Components: `MessagesContent`, `MessageThread`, `MessageComposer`, `MessageBubble`

### Files - `/files`
`Audience: Client` · `Status: ⚪ Stub / not built`

**What it is.** Intended client file browser for deliverables stored in R2; admins are redirected to `/requests`.

**Key features**
- Renders a static header ("Deliverables and files shared by the Tahi team.") and a single `EmptyState` ("No files yet"). No data fetch, no R2 listing - currently a placeholder. Real file access today happens inside `/requests/[id]`.

**How it is used / workflows**
- Not functional yet; clients get/download files from request detail instead.

**Links**
- ← reached FROM sidebar / bottom nav; admins → redirected to `/requests`

**Under the hood** - APIs: none wired (intended `/api/portal/requests/[id]/files`); Tables: `files`; Components: `FilesPage`, `EmptyState`, `Card`

### Services - `/services`
`Audience: Client` · `Status: 🟡 Built, not daily-trusted`

**What it is.** A browse-only service catalogue. `ServicesPage` renders `PortalServicesContent` for clients (admins get `AdminServicesContent`).

**Key features**
- Fetches `/api/portal/services` and renders a responsive grid of service cards: name, description, category chip, formatted price, and recurring (`/ month` or `/ year`) vs one-time indicator.
- Loading skeletons and a leaf-icon empty state. Note: this is browse-only - there is no order/checkout button in the portal view despite the catalogue framing.

**How it is used / workflows**
- Client browses available services and add-ons; ordering is handled out-of-band (e.g. via a request or messaging the team).

**Links**
- ← reached FROM sidebar / bottom nav

**Under the hood** - APIs: `/api/portal/services` (GET); Tables: `services`/catalogue settings; Components: `PortalServicesContent`

### Portal Invoices - `/invoices`
`Audience: Client` · `Status: 🟡 Built, not daily-trusted`

**What it is.** The client's invoice history and outstanding balances. Shared `InvoiceList` component (`isAdmin` false), subtitle "Your invoice history and outstanding payments."

**Key features**
- Fetches `/api/portal/invoices` (scoped to org, rejects the Tahi org); status filter and search ("Search invoices").
- Admin-only controls (create invoice, Stripe/Xero import, destination selector) are hidden from clients.
- Currency display formatting; list rows link to detail.

**How it is used / workflows**
- Review invoices, see what is outstanding, open one to view/pay.

**Links**
- → `/invoices/[id]`; ← reached FROM Overview ("Invoices Due" KPI), sidebar / bottom nav

**Under the hood** - APIs: `/api/portal/invoices` (GET); Tables: `invoices`, `invoiceItems`, `organisations`; Components: `InvoiceList`

### Portal Invoice Detail - `/invoices/[id]`
`Audience: Client` · `Status: 🟡 Built, not daily-trusted`

**What it is.** A single invoice view with line items and a Stripe pay path. Shared `InvoiceDetail` (`isAdmin` false).

**Key features**
- Renders invoice header, line items, totals; private meta fields (Stripe ID, source) and Stripe/Xero provisioning actions are `isAdmin`-gated and hidden from clients.
- Client payment is routed through the Stripe customer billing portal session (`GET /api/portal/billing/session`), which looks up the org's `stripeCustomerId` and returns a `billingPortal.sessions.create` URL (503 if Stripe unconfigured, 404 if no customer linked).

**How it is used / workflows**
- Open invoice → pay via Stripe billing portal.

**Links**
- → Stripe billing portal (external) via `/api/portal/billing/session`; ← reached FROM `/invoices` list

**Under the hood** - APIs: `/api/portal/billing/session` (GET); Tables: `invoices`, `invoiceItems`, `organisations`; Components: `InvoiceDetail`

### Portal Billing - `/billing`
`Audience: Client` · `Status: 🟡 Built, not daily-trusted`

**What it is.** The retainer/billing surface; `BillingContent` is shared, with `isAdmin` driving admin feature-gating (admins pass `requirePageFeature('billing')`).

**Key features**
- Client view of subscription/retainer billing; entry point for the Stripe customer portal (`/api/portal/billing/session`, which returns to `/billing`).
- Subscription/plan data via `/api/portal/subscription`.

**How it is used / workflows**
- Manage retainer/payment method via Stripe portal; view plan.

**Links**
- → Stripe billing portal (external); ← reached FROM sidebar / bottom nav

**Under the hood** - APIs: `/api/portal/billing/session`, `/api/portal/subscription`; Tables: `subscriptions`, `organisations`; Components: `BillingContent`

### Onboarding, Capacity & Booking widgets (Overview-embedded)
`Audience: Client` · `Status: 🟡 Built, not daily-trusted`

**What it is.** Supporting client surfaces that live inside the Overview rather than standalone routes.

**Key features**
- `OnboardingChecklist`: step list with completion toggles and an embedded Loom (URL normalised to `loom.com/embed/...`); GET/PATCH `/api/portal/onboarding` reads/writes `organisations.onboardingState` + `onboardingLoomUrl`.
- `TrackCapacityCard`: retainer track usage for small/large tracks with plan-aware upsells (e.g. "Upgrade to Scale"); backed by `/api/portal/capacity` and `/api/portal/tracks`, with client-side queue reordering via `/api/portal/capacity/reorder` and `/api/portal/tracks/[trackId]/reorder`.
- `BookingWidget`: loads a calendar URL from `/api/portal/settings/booking` and embeds it (iframe with external-link fallback) so clients can book calls.

**How it is used / workflows**
- Complete onboarding steps; monitor/reorder the retainer work queue; book a call.

**Links**
- ← embedded in `/overview`; booking relates to `/calls` (admin-side scheduled calls)

**Under the hood** - APIs: `/api/portal/onboarding`, `/api/portal/capacity` (+ `/reorder`), `/api/portal/tracks` (+ `/[trackId]/reorder`), `/api/portal/settings/booking`; Tables: `organisations`, `tracks`, `subscriptions`, `settings`; Components: `OnboardingChecklist`, `TrackCapacityCard`, `BookingWidget`

**Cross-cutting note (privacy & scoping).** Every `/api/portal/*` route resolves the user via `getPortalAuth`, rejects `orgId === NEXT_PUBLIC_TAHI_ORG_ID`, and filters by the caller's `orgId`. The requests-vs-tasks split is enforced: requests are client-visible (with internal messages stripped), tasks are never surfaced to the portal. Relevant files: `app/api/portal/requests/[id]/route.ts` (internal-message filter), `app/api/portal/conversations/route.ts` (external-only), `app/api/portal/invoices/route.ts` (org scoping + Tahi-org 403).

I have enough detail across all pages and shared infra. Let me write the documentation.

## Public, Auth & Shared Infrastructure

The unauthenticated and cross-cutting surfaces of the dashboard: the root redirect, Clerk auth shell, PWA offline fallback, token-gated public deliverable viewers (proposals, schedules, contracts, reviews), admin previews of those deliverables, plus the shared plumbing every authed surface relies on (file uploads, notifications, Stripe webhook, MCP, public lead intake, share analytics).

### Root entry - `app/page.tsx` + `app/layout.tsx`
`Audience: Public` · `Status: 🟢 Live and daily-trusted`

**What it is.** The root route is a pure server redirect; the root layout is the global HTML shell that wraps every page in the app (auth, dashboard, public alike).

**Key features**
- `RootPage` calls `getServerAuth()`: signed-out users go to `/sign-in`, signed-in users go to `/overview` (the real home, which lives under the `(dashboard)` group so it inherits sidebar + topnav chrome).
- Root layout wraps everything in `ClerkProvider`, sets PWA metadata (`manifest.json`, apple-touch icons, theme colour `#5A824E`, `appleWebApp` capable).
- Three inline boot scripts run before paint: dark-mode class from `localStorage['tahi-theme']`, sidebar collapsed state from `localStorage['tahi-sidebar']` (set as `data-sidebar` on `<html>`), and service-worker registration of `/sw.js`.
- Metadata template `%s | Tahi Dashboard`, viewport locked to `maximumScale: 1`.

**How it is used / workflows**
- Every visit hits `/`, which bounces to the correct home based on session.
- The boot scripts prevent dark-mode flash and persist UI chrome state across reloads.

**Links**
- → `/sign-in` (unauthenticated), `/overview` (authenticated)
- ← entry point for the whole app

**Under the hood** - APIs: none (server redirect); Tables: none; Components: `ClerkProvider`, `getServerAuth`

### Sign in / Sign up - `app/(auth)/sign-in/[[...sign-in]]` + `app/(auth)/sign-up/[[...sign-up]]`
`Audience: Public` · `Status: 🟢 Live and daily-trusted`

**What it is.** Clerk-backed authentication mounted inside a custom premium split-pane shell, used by both Tahi team and clients (role is resolved later from Clerk org).

**Key features**
- `AuthShell` renders a 45/55 desktop split: left `BrandPanel` (brand gradient, `TahiStudioWordmark`, marketing headline, three leaf-bulleted value props, oversized decorative `LeafGlyph`, "Designed in Aotearoa" footer); right panel centres the Clerk widget.
- Mobile collapses the brand panel to a compact centred wordmark band via an inline media query at `56rem`.
- `tahiClerkAppearance` strips Clerk's own card/header/footer and re-themes inputs, primary CTA (leaf radius, brand green), social buttons, and divider to Tahi tokens for dark-mode safety.
- Sign-in copy: "Welcome back" + footer link to create an account; sign-up: "Create your account" + footer link to sign in. Catch-all `[[...]]` routes let Clerk handle sub-steps (verify, reset, SSO).

**How it is used / workflows**
- Daily login for the team and clients; Clerk decides which org the user lands in, the dashboard then gates by `orgId === NEXT_PUBLIC_TAHI_ORG_ID`.

**Links**
- → `/sign-up` ↔ `/sign-in` (cross-linked footers); post-auth Clerk redirects into `/` → `/overview`
- ← `app/page.tsx` redirect for signed-out users

**Under the hood** - APIs: Clerk-hosted; Components: `AuthShell`, `tahiClerkAppearance`, `ClerkSignIn`/`ClerkSignUp` (`clerk-mount`), `LeafGlyph`, `TahiStudioWordmark`

### Offline fallback - `app/offline/page.tsx`
`Audience: Public` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** Static PWA offline page served by the service worker when the device has no connection.

**Key features**
- Centred leaf-radius brand-gradient icon (struck-through wifi SVG), "You are offline" heading, instruction copy. Pure design tokens, no data fetching.

**How it is used / workflows**
- Shown by `/sw.js` (registered in root layout) as the navigation fallback when offline.

**Links**
- ← service worker `/sw.js` fallback (registered in `app/layout.tsx`)

**Under the hood** - APIs: none; Tables: none; Components: inline only

### Public proposal viewer - `app/p/proposal/[token]`
`Audience: Public` · `Status: 🟡 Built, working, not daily-trusted (Proposals near-green)`

**What it is.** A no-login, token-gated, paginated proposal "document" a prospect opens from an emailed link to read scope, compare pricing variants, and accept / decline / ask a question.

**Key features**
- `ProposalViewer` renders a dark `CoverPage` hero, then data-driven sections (each wrapped in `PageChrome` with section number, name, project label, and per-section `themeMode` light/dark/feature) dispatched through `section-blocks.tsx` (overview, about, terms, testimonial, value anchor, process, FAQ, guarantee, retainer offer, founders, partner badges, etc.).
- Variants picker: `VariantTabStrip` with sliding indicator, `VariantCompareTable` (side-by-side feature matrix), per-variant scope checklist, `AnimatedPriceCell` (count-up one-off + monthly money), CTA buttons.
- Decision modal collects name/email/role/comment for three actions: Accept (locks to chosen variant), Decline (whole proposal), or Ask a question (non-locking - shows a thank-you banner, keeps Accept/Decline live).
- Post-accept "What happens next" timeline page; closing CTA when no variants; already-decided banner on return visits.
- Anonymous analytics: `useShareViewTracking` (session view) and `useSectionDwellTracking` (per-section dwell heatmap), both keyed on the share token.
- Reads the **published snapshot** when present so unpublished admin edits don't leak; identity-of-record fields (status, decidedAt, coverTheme) stay live.

**How it is used / workflows**
- Prospect opens emailed link → reads sections → compares packages → accepts a variant (or asks a question) → lands on the next-steps timeline.

**Links**
- → `POST /api/public/proposals/[token]/accept` (records decision), variants may reference a `timelineScheduleId` (separate schedule link)
- ← shared by the admin Proposals area; analytics flow back to the admin ShareAnalyticsCard

**Under the hood** - APIs: `/api/public/proposals/[token]` (GET), `/api/public/proposals/[token]/accept` (POST), `/api/public/views`, `/api/public/section-views`; Tables: `proposals`, `proposalSections`, `proposalVariants`, `proposalAcceptances`, `organisations`; Components: `ProposalViewer`, `ProposalSectionBlock`, `CoverPage`, `PageChrome`

### Public schedule viewer - `app/p/schedule/[token]`
`Audience: Public` · `Status: 🟡 Built, working, not daily-trusted (Schedules near-green)`

**What it is.** No-login token-gated project schedule the client opens to see timeline, phases, and a Gantt of weeks/owners.

**Key features**
- `ScheduleViewer` renders cover + sectioned pages in the same `PageChrome` rhythm as proposals; `gantt`-type sections render rows (label, owner, start/end week, risk flag); other section types render their own blocks.
- Reads published snapshot when present (post-migration 0054), otherwise falls back to live `scheduleSections` + `scheduleRows`.
- Same anonymous share-view + section-dwell analytics as the proposal viewer.

**How it is used / workflows**
- Client opens emailed schedule link to track the build timeline; admins preview the same component before sending.

**Links**
- → `/api/public/views` + `/api/public/section-views` (analytics)
- ← shared by admin Schedules area; referenced from a proposal variant's `timelineScheduleId`

**Under the hood** - APIs: `/api/public/schedules/[token]` (GET); Tables: `projectSchedules`, `scheduleSections`, `scheduleRows`, `organisations`; Components: `ScheduleViewer`, `PageChrome`

### Public contract viewer + e-signature - `app/p/contract/[token]` and `app/p/contract/[token]/sign/[signerId]`
`Audience: Public` · `Status: 🟡 Built, working, not daily-trusted (Contracts near-green)`

**What it is.** Two modes of the same `ContractViewer`: a read-only contract view at `/p/contract/[token]`, and a per-signer e-signature flow at `.../sign/[signerId]`.

**Key features**
- Read mode shows the contract body HTML, signer roster (role, name, email, status, signedAt), and rendered signature images of those who already signed.
- Sign mode lets the named signer draw/submit a signature (data URL), validated server-side (`data:image/`, max ~200KB).
- Tamper-evident hash chain: each signature's `chainHash = sha256(prevChainHash | signerId | sigDataUrl | timestamp)`; when the last pending signer signs, contract flips to `signed` and a `finalHash` anchors the chain.
- On full signing, the route fires `sendFullySignedContractEmails` via `ctx.waitUntil` (signed-PDF render + multi-recipient send) without blocking the signer's response.
- Audit capture per signature: hashed IP (salted SHA-256), country, user agent. Expired/cancelled contracts return 410; already-signed returns 409.

**How it is used / workflows**
- Client receives contract link → reviews → each signer opens their personal sign link → draws signature → final signer triggers the fully-signed email to all parties.

**Links**
- → `POST /api/public/contracts/[token]/sign/[signerId]` (records signature + advances status)
- ← shared by the admin Contracts area; `/preview/contract/[id]` previews the same viewer

**Under the hood** - APIs: `/api/public/contracts/[token]` (GET), `/api/public/contracts/[token]/sign/[signerId]` (POST); Tables: `contractDocuments`, `contractSigners`, `contractSignatures`; Components: `ContractViewer`, `sendFullySignedContractEmails`

### Public review form - `app/review/[token]`
`Audience: Public` · `Status: 🟡 Built, working, not daily-trusted (Reviews pipeline)`

**What it is.** Token-gated, no-login form where a client leaves a testimonial / NPS as part of the case-study outreach pipeline.

**Key features**
- `ReviewForm` validates the token, shows org + project context, and collects NPS (0 - 10), written testimonial, "loved most"/"improve" free-text, and logo/marketing permission consents.
- Token guards: 404 invalid, 410 expired (`tokenExpiresAt`), 409 already completed (`outreachStatus === 'completed'`).
- Submitting flips the submission to `outreachStatus: 'completed'`, `status: 'pending'` for admin moderation into a published case study.
- Companion `GET /api/public/review/respond?token=&answer=yes|defer|no` handles the email CTA buttons: `yes` → in_progress + redirect to the form, `defer` → sets `nextAskAt` +7 days, `no` → sets `neverAsk`.

**How it is used / workflows**
- Outreach email asks "leave a review?" → client clicks yes/defer/no → on yes lands here → submits testimonial → enters admin moderation queue.

**Links**
- → `/api/public/review` (GET validate + POST submit), `/api/public/review/respond` (email CTA)
- ← Reviews & case-study admin pipeline (sends the outreach email + token)

**Under the hood** - APIs: `/api/public/review` (GET/POST), `/api/public/review/respond` (GET); Tables: `caseStudySubmissions`, `organisations`; Components: `ReviewForm`

### Admin deliverable previews - `app/preview/proposal/[id]`, `app/preview/schedule/[id]`, `app/preview/contract/[id]`
`Audience: Admin` · `Status: 🟡 Built, working, not daily-trusted`

**What it is.** Authenticated, chrome-free previews letting the Tahi team see exactly what a prospect/client will see, including unpublished draft state, before sending the public link.

**Key features**
- Each page runs `getServerAuth()` and redirects non-admins (`orgId !== NEXT_PUBLIC_TAHI_ORG_ID`) to `/requests`; mounted **outside** the `(dashboard)` group so the sidebar doesn't crop the full-bleed deliverable.
- They reuse the exact public viewer components in preview mode (`previewProposalId` / `previewScheduleId` / `previewContractId`), which disables accept/decline/sign and renders a fixed "Admin preview, live unpublished state" pill.
- Proposal/schedule previews fetch live unpublished data via `/api/admin/.../preview-data`; preview disables analytics so admin views don't pollute the heatmap.

**How it is used / workflows**
- Admin edits a deliverable → opens preview to QA the live (possibly unpublished) state → publishes → shares the `/p/...` token link.

**Links**
- → mirror of `/p/proposal/[token]`, `/p/schedule/[token]`, `/p/contract/[token]`
- ← reached from the admin Proposals / Schedules / Contracts editors

**Under the hood** - APIs: `/api/admin/proposals/[id]/preview-data` (and schedule/contract equivalents); Components: `ProposalViewer`, `ScheduleViewer`, `ContractViewer` in preview mode

---

### Shared: File uploads (R2) - `/api/uploads/*`
`Audience: Admin + Client` · `Status: 🟢 Live and daily-trusted`

**What it is.** The R2-backed file pipeline behind every attachment in requests, messages and the file browser.

**Key features**
- `presign` (POST): authed; builds a scoped key `orgId/requestId?/timestamp-filename` and returns a same-origin proxy `uploadUrl` (basePath-aware for the `/dashboard` mount) - because the R2 Workers binding has no native presigned PUT.
- `proxy` (PUT): buffers the browser upload and writes to the `STORAGE` binding using the key+token from presign.
- `confirm` (POST): records `files` metadata, resolving uploader to a `teamMembers` or `contacts` id and the owning org (admins may pass `orgId` on behalf of a client).
- `serve` (GET): streams a file from R2 with org-scoping (`requireAccessToOrg`); `?download=1` forces attachment. Rejects `anon`/legacy keys. `[fileId]` route handles delete/metadata.

**Under the hood** - APIs: `/api/uploads/presign|proxy|confirm|serve|[fileId]`; Tables: `files`; Libs: `getCloudflareContext().env.STORAGE`, `requireAccessToOrg`

### Shared: Notifications + SSE - `/api/notifications` (+ `/stream`)
`Audience: Admin + Client` · `Status: 🟡 list GREEN-ish; ⚪ /stream is a polling stub`

**What it is.** In-app notification feed for team and clients, plus a real-time stream endpoint.

**Key features**
- `GET /api/notifications`: 20 most recent for the authed user + `unreadCount`. `PATCH`: mark one (`{id}`) or all (`{all:true}`) read.
- `GET /api/notifications/stream`: SSE endpoint - but it is **not true push**; it polls D1 every 5s for unread rows newer than connect time and emits them, with keep-alive pings and leak-safe interval teardown on `req.signal` abort. Treat as a stub per STATUS.

**Under the hood** - APIs: `/api/notifications`, `/api/notifications/stream`; Tables: `notifications`

### Shared: Stripe webhook - `/api/webhooks/stripe`
`Audience: Public (Stripe-signed)` · `Status: 🟡 Built, working (import dedupe fixed per recent notes)`

**What it is.** Signature-verified Stripe event receiver that keeps invoices and subscriptions in sync and re-derives each org's billing model.

**Key features**
- Verifies `stripe-signature` against `STRIPE_WEBHOOK_SECRET`; lazy Stripe singleton, `force-dynamic`.
- Handles `invoice.paid` (self-heals by importing unknown invoices via `importStripeInvoice` with `autoCreateOrg:false`, then forces `paid`), `invoice.payment_failed` (→ overdue), and `customer.subscription.created/updated/deleted` (status mapping + period dates).
- After money-moving events, calls `applyBillingDerivation` (wrapped to never throw) so an org flips project↔retainer / extends `retainerStartDate`.
- Note: there is no Xero payment webhook receiver (white/stub elsewhere).

**Under the hood** - APIs: `/api/webhooks/stripe`; Tables: `invoices`, `subscriptions`, `organisations`; Libs: `importStripeInvoice`, `applyBillingDerivation`

### Shared: MCP server endpoint - `/api/mcp`
`Audience: Admin (Bearer token)` · `Status: 🟡 Built, working - read-only, partial parity`

**What it is.** A JSON-RPC 2.0 MCP HTTP transport exposing dashboard data to Claude via a custom connector (the worker-side server per CLAUDE rule 14; the stdio server is dormant).

**Key features**
- Implements `initialize`, `tools/list`, `tools/call`. Seven **read-only** tools: `get_overview_stats`, `list_clients`, `get_client_detail`, `list_requests`, `get_billing_summary`, `get_capacity`, `get_reports`.
- Each tool proxies to the corresponding `/api/admin/*` route with a `Bearer ${TAHI_API_TOKEN}` header against `NEXT_PUBLIC_APP_URL`. `GET /api/mcp` returns server info + tool catalogue.
- Caveat re rule 14: this exposes only a read subset; write/mutation parity with the dashboard is not implemented here.

**Under the hood** - APIs: `/api/mcp` (proxies `/api/admin/overview|clients|clients/[id]|requests|billing/summary|capacity|reports`); Env: `TAHI_API_TOKEN`, `NEXT_PUBLIC_APP_URL`

### Shared: Public lead intake - `/api/public/leads`
`Audience: Public (Bearer secret)` · `Status: 🟢 Live and daily-trusted (feeds the CRM)`

**What it is.** The Webflow/external form receiver that creates CRM leads with UTM attribution.

**Key features**
- Requires `Authorization: Bearer ${PUBLIC_LEAD_SECRET}`; `name` required; `force-dynamic`.
- Folds UTM fields (`utm_source/medium/campaign/term/content`) + referer into a structured `sourceDetail` string; source defaults to `webflow` (or the UTM source).
- Resolves default owner from `settings['leads.defaultLeadOwnerId']`, runs canonical `lookupOrCreatePerson` (dedup by email/phone), inserts the `leads` row, and stamps a `lead_created` activity (`createdById: 'system'`).

**Under the hood** - APIs: `/api/public/leads` (POST); Tables: `leads`, `activities`, `settings`, `teamMembers`, people store; Libs: `lookupOrCreatePerson`

### Shared: Deliverable share analytics - `/api/public/views` (+`/[id]`) and `/api/public/section-views`
`Audience: Public (token-validated)` · `Status: 🟡 Built, working`

**What it is.** Anonymous engagement tracking written by the public proposal/schedule/contract viewers.

**Key features**
- `POST /api/public/views`: validates the `shareToken` maps to a still-shared resource (and matches `resourceId`) before recording a `shareViewEvents` row (session id, hashed IP, CF country, UA, referrer, initial pages). Returns a `viewId` the client heartbeats into `PATCH /api/public/views/[id]` to accrue duration.
- `POST /api/public/section-views`: batches per-section dwell events (capped 50/POST, `dwellMs` clamped to 10 min) with the same token validation, powering the admin per-slide engagement heatmap.
- All writes salt-hash the IP; token validation deliberately collapses "not found" vs "wrong resource" to avoid existence leaks.

**Under the hood** - APIs: `/api/public/views`, `/api/public/views/[id]`, `/api/public/section-views`; Tables: `shareViewEvents`, section-dwell store, `projectSchedules`/`proposals`/`contractDocuments` (token validation)
