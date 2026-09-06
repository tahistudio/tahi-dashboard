# Spec coverage inventory, 2026-09-07

Read only. Generated from the tree at `f47b8805` plus the repo own written records. Nothing was run, no browser was opened.

| Headline | Value |
|---|---|
| Percent to MVP, by surface count | **70.8%** |
| Percent to a FULL platform, by surface count | **64.8%** |
| Engineer days left to MVP | 26 |
| Engineer days left to FULL | 126 |
| Surfaces counted | 64, of which 24 are MVP required |
| Route tree | 66 pages, 445 API routes, 114 tables, 42 migrations |

Status vocabulary. **LIVE**: the page exists and is wired to a real API with no obvious stub. **PARTIAL**: the page exists but stubs, TODOs or key spec behaviours are missing. **DESIGN_ONLY**: a Claude Design prototype or a plan describes it, no repo route serves it. **SPEC_ONLY**: named in a spec, nothing built.

---

## Surfaces by audience

### Client portal (11)

| ID | Surface | Status | MVP | Days left | Designed | Primary route or module |
|---|---|---|---|---|---|---|
| client-onboarding | Client invite, onboarding and provisioning | PARTIAL | yes | 2 | yes | `app/(onboarding)/onboarding/page.tsx` |
| client-home | Client portal home | LIVE | yes | 0 | yes | `app/(dashboard)/overview/page.tsx` |
| client-requests | Client requests: list, detail, new, thread, files, approve | LIVE | yes | 0 | yes | `app/(dashboard)/requests/page.tsx` |
| client-files | Client files browser and upload | LIVE | yes | 0 | yes | `app/(dashboard)/files/page.tsx` |
| client-services | Client services catalogue | PARTIAL | yes | 3 | yes | `app/(dashboard)/services/page.tsx` |
| client-invoices | Client invoices and pay | LIVE | yes | 0 | yes | `app/(dashboard)/invoices/page.tsx` |
| client-account | Client account and organisation settings | PARTIAL | yes | 1 | yes | `app/(dashboard)/settings/page.tsx` |
| client-billing | Client billing page | PARTIAL | no | 1 | no | `app/(dashboard)/billing/page.tsx` |
| client-tracks | Client tracks page | PARTIAL | no | 1 | yes | `app/(dashboard)/tracks/page.tsx` |
| client-papers | Client papers: proposals, contracts, schedules in the portal | DESIGN_ONLY | no | 5 | yes | `none, the nav entries were removed 2026-09-05` |
| files-library-v2 | Files as a shared library with folders and threads | SPEC_ONLY | no | 6 | no | no route |

### Studio, admin only (41)

| ID | Surface | Status | MVP | Days left | Designed | Primary route or module |
|---|---|---|---|---|---|---|
| studio-home | Studio home: owner and teammate | PARTIAL | yes | 1 | yes | `app/(dashboard)/overview/page.tsx` |
| studio-requests | Studio requests: list, board, timeline, detail, AI triage | LIVE | yes | 0 | yes | `app/(dashboard)/requests/page.tsx` |
| studio-tasks | Studio tasks: list, board, my week, detail | PARTIAL | yes | 3 | yes | `app/(dashboard)/tasks/page.tsx` |
| studio-clients-list | Clients list | LIVE | yes | 0 | yes | `app/(dashboard)/clients/page.tsx` |
| studio-client-detail | Client detail, nine tabs | LIVE | yes | 0 | yes | `app/(dashboard)/clients/[id]/page.tsx` |
| studio-contacts-brands | Contact and brand detail pages | LIVE | no | 0 | no | `app/(dashboard)/clients/contacts/[id]/page.tsx` |
| studio-team | Team, org chart, access scopes and hire onboarding | PARTIAL | no | 3 | yes | `app/(dashboard)/team/page.tsx` |
| studio-capacity | Capacity planning | LIVE | no | 0 | yes | `app/(dashboard)/capacity/page.tsx` |
| studio-docs | Docs hub | LIVE | no | 0 | no | `app/(dashboard)/docs/page.tsx` |
| permissions | Permissions builder and enforcement | PARTIAL | no | 5 | yes | `app/(dashboard)/permissions/page.tsx` |
| studio-settings | Studio settings, eight groups | LIVE | yes | 0 | yes | `app/(dashboard)/settings/page.tsx` |
| audit-log | Audit log viewer | LIVE | no | 0 | no | `app/(dashboard)/settings/audit/page.tsx` |
| automations | Automation rules and outgoing webhooks | PARTIAL | no | 2 | no | `app/(dashboard)/settings/automations/page.tsx` |
| crons | Scheduled jobs page and cron delivery | PARTIAL | no | 1 | no | `app/(dashboard)/settings/crons/page.tsx` |
| design-system-page | Design system catalogue | LIVE | no | 0 | no | `app/(dashboard)/design-system/page.tsx` |
| leads | Leads, AI scoring and enrichment | LIVE | no | 0 | yes | `app/(dashboard)/leads/page.tsx` |
| calls | Discovery and client calls | LIVE | no | 0 | yes | `app/(dashboard)/calls/page.tsx` |
| deals | Deals pipeline and sales kit | PARTIAL | no | 4 | yes | `app/(dashboard)/deals/page.tsx` |
| calculator | Project and contract calculator | PARTIAL | no | 3 | no | `app/(dashboard)/calculator/page.tsx` |
| sales-analytics | Sales analytics | LIVE | no | 0 | no | `app/(dashboard)/sales-analytics/page.tsx` |
| affiliates | Affiliates and referral commissions | PARTIAL | no | 6 | no | `app/(dashboard)/affiliates/page.tsx` |
| studio-invoices | Studio invoices list | PARTIAL | yes | 3 | yes | `app/(dashboard)/invoices/page.tsx` |
| studio-invoice-detail | Studio invoice detail | PARTIAL | yes | 2 | yes | `app/(dashboard)/invoices/[id]/page.tsx` |
| invoicing-rails | Stripe and Xero invoicing rails | PARTIAL | yes | 2 | no | `app/api/webhooks/stripe/route.ts` |
| studio-billing | Studio billing admin | PARTIAL | no | 1 | no | `app/(dashboard)/billing/page.tsx` |
| time | Time tracking and timers | PARTIAL | yes | 1 | yes | `app/(dashboard)/time/page.tsx` |
| financial-reports | Financial reports | LIVE | no | 0 | no | `app/(dashboard)/financial-reports/page.tsx` |
| reports | Operational reports | PARTIAL | no | 4 | no | `app/(dashboard)/reports/page.tsx` |
| studio-services | Studio services catalogue editor | PARTIAL | yes | 1 | yes | `app/(dashboard)/services/page.tsx` |
| content-studio | Content studio | PARTIAL | no | 6 | no | `app/(dashboard)/content-studio/page.tsx` |
| sitemap | Sitemap planner | LIVE | no | 0 | no | `app/(dashboard)/sitemap/page.tsx` |
| social | Social, Buffer read only | LIVE | no | 0 | no | `app/(dashboard)/social/page.tsx` |
| email-delivery | Email delivery, allowlist and templates | PARTIAL | yes | 1 | no | `lib/email-delivery.ts` |
| act-as-client | Client view, act as client and private mode | LIVE | yes | 0 | no | `app/api/admin/impersonate/route.ts` |
| manyrequests-cutover | ManyRequests reconciliation, import and cutover | PARTIAL | yes | 4 | no | `workers/mcp-server/src/index.ts manyrequests tools` |
| mcp-parity | MCP worker tool parity and auth | PARTIAL | no | 2 | no | `workers/mcp-server/src/index.ts` |
| health-scoring | Automated client health scoring | PARTIAL | no | 2 | no | `app/api/admin/health/route.ts` |
| integrations | Third party integrations | PARTIAL | no | 5 | no | `app/(dashboard)/settings/page.tsx integrations section` |
| north-star-flow | North star: discovery to onboarding to delivery automation | SPEC_ONLY | no | 12 | no | `app/api/admin/cron/auto-promote-calls/route.ts` |
| ai-wizards | AI wizards: request, task, triage, draft reply, predictive autofill | LIVE | no | 0 | yes | `app/api/admin/ai/predict-fields/route.ts` |
| billing-tiers | Retainer and billing model depth | PARTIAL | no | 5 | no | `app/api/admin/derive-billing/route.ts` |

### Both audiences, or public (12)

| ID | Surface | Status | MVP | Days left | Designed | Primary route or module |
|---|---|---|---|---|---|---|
| auth | Sign in, sign up, password reset | PARTIAL | yes | 1 | no | `app/(auth)/sign-in/[[...sign-in]]/page.tsx` |
| notifications-page | Notifications page and bell | LIVE | yes | 0 | yes | `app/(dashboard)/notifications/page.tsx` |
| messages | Messages inbox, both audiences | LIVE | no | 0 | yes | `app/(dashboard)/messages/page.tsx` |
| offline-pwa | Offline page, PWA install and web push | PARTIAL | no | 2 | yes | `app/offline/page.tsx` |
| proposals | Proposals: list, editor, templates, public viewer | PARTIAL | no | 7 | yes | `app/(dashboard)/proposals/page.tsx` |
| schedules | Schedules: list, editor, templates, public viewer | PARTIAL | no | 3 | yes | `app/(dashboard)/schedules/page.tsx` |
| contracts | Contracts: list, editor, templates, signing | PARTIAL | no | 4 | yes | `app/(dashboard)/contracts/page.tsx` |
| reviews | Reviews and testimonial outreach | PARTIAL | no | 1 | no | `app/(dashboard)/reviews/page.tsx` |
| announcements | Announcements and banners | PARTIAL | no | 1 | no | `app/(dashboard)/announcements/page.tsx` |
| mobile-shell | Mobile shell, tab bar and touch targets | PARTIAL | yes | 1 | yes | `components/tahi/app-shell.tsx` |
| notifications-engine | Notification engine, SSE and digests | PARTIAL | no | 3 | no | `app/api/notifications/stream/route.ts` |
| design-consistency | Cross surface design consistency pass | DESIGN_ONLY | no | 5 | yes | no route |

---

## The two percentages, with their arithmetic

### Percent to MVP

MVP means what one friendly client plus the two person studio need to run request based retainer work end to end for a month. Client side: sign in, requests list and detail and new and comments and files, portal home, invoices view and pay, services view, notifications, account. Studio side: clients, requests, tasks, invoices with Xero and Stripe, time, settings, email allowlist, act as client. Excluded from MVP: the sales stack, ops, reports, automations, docs hub, announcements, contracts, calls, content studio, affiliates, sitemap, social.

```
By surface count
  (LIVE 10 x 1) + (PARTIAL 14 x 0.5) + (zero weight 0 x 0) = 17; 17 / 24 = 0.708 = 70.8%

By engineer days
  1 - (26 remaining / 225 scope days) = 0.884 = 88.4%
```

Status split across the 24 MVP surfaces: 14 PARTIAL, 10 LIVE. No MVP surface is unbuilt, which is the important part: every one of them exists and answers a real endpoint, and the 14 PARTIAL rows are gaps inside working surfaces rather than missing pages.

### Percent to a FULL platform

FULL means every surface named anywhere in `CLAUDE.md`, `SPECS/`, `WORKFLOWS.md` or `TASKS.md`, at the depth those documents describe.

```
By surface count
  (LIVE 23 x 1) + (PARTIAL 37 x 0.5) + (zero weight 4 x 0) = 41.5; 41.5 / 64 = 0.648 = 64.8%

By engineer days
  1 - (126 remaining / 597 scope days) = 0.789 = 78.9%
```

Status split across all 64 surfaces: 37 PARTIAL, 23 LIVE, 2 DESIGN_ONLY, 2 SPEC_ONLY.

### Assumptions behind the numbers

1. Days are one senior engineer working with AI agents. Where `TASKS.md` already carries a day figure, that figure is used unchanged.
2. The by count percentages weight every surface equally. A 20 day surface and a 2 day surface each count once, so the by count figure understates how much of the actual build is done.
3. The by days percentages divide remaining days by a scope estimate that includes a judgement call on what each LIVE surface already cost. Those scope figures are not measured, so treat the by days percentages as directional and the by count percentages as the defensible ones.
4. The deploy approval gate is assumed to stay manual. It cost eight days on one fix in August.
5. Nothing here counts live QA laps as separate work except where a task explicitly is one, for example the client lap on the mobile shell row.

---

## What FULL entails

Every surface that is not LIVE, with the behaviours that are missing. MVP blocking first. Bullets are capped at three per surface here; the JSON carries the full list.

### MVP blocking (14 surfaces, 26 days)

**ManyRequests reconciliation, import and cutover** (`manyrequests-cutover`, PARTIAL, 4d). Blocked on one operator step, then a dry run, an apply and a verification pass.
- The read-only reconciliation ran on 7 Sep (TASKS.md MC.1 done; report docs/superpowers/audits/2026-09-07-manyrequests-import-report.md)
- The idempotent importer is written but has never executed: it reads MANYREQUESTS_API_TOKEN from a dashboard worker secret that does not exist, and only Liam can set it (TASKS.md MC.3)
- Dummy org archiving and e2e fixture cleanup are unstarted

**Client services catalogue** (`client-services`, PARTIAL, 3d). Org scoping is a data leak that blocks the import, plus the designed showcase port.
- The services table has no orgId, so every client sees every catalogue row once ManyRequests services are imported (TASKS.md CT.11)
- No order path: Liam has not decided whether ordering mints a request or a Stripe checkout (TASKS.md CT.11)
- The plan ladder rule (show current plan, lower and higher, upsell only near limits) is designed but not ported (TASKS.md MC.5 and MR.7)

**Studio tasks: list, board, my week, detail** (`studio-tasks`, PARTIAL, 3d). One live smoke lap plus the My week week dates and multi day allocation.
- Roughly a dozen behaviours have only ever run against the local e2e harness, never on the deployed URL: bulk complete, promote to request, the timer, an AI wizard run, save as default across a reload, the CSV download, both drags, and dark mode on the board and week planner (TASKS.md T2.5)
- My week shows the open list against no real week dates and cannot span a task across multiple days; it needs a design and probably a per day allocation column (TASKS.md TP.3)
- tasks.trackId and tasks.position are orphaned, so a board drop writes status and drops the index

**Studio invoices list** (`studio-invoices`, PARTIAL, 3d). Real numbering from the settings prefix plus the designed list port.
- The invoices table has no number column at all, so the list identifies an invoice by UUID or amount (db/schema.ts invoices, app/(dashboard)/invoices/invoice-list.tsx:981, TASKS.md CT.14)
- The redesigned studio invoices module is designed and critiqued but not wired into the shell or ported (TASKS.md MR.6 and DL.3)

**Client invite, onboarding and provisioning** (`client-onboarding`, PARTIAL, 2d). Webhook plus portalRole write path plus the hardcoded lead.
- No Clerk svix webhook backfills contacts.clerkUserId, so a second seat depends on the sign-in linker (TASKS.md T1.4)
- Write path portalRole gap: a fresh owner cannot invite teammates or edit org settings until portalRole is set (TASKS.md T1.14)
- The studio lead shown to the client is hardcoded to Liam Miller (app/(onboarding)/onboarding/page.tsx:96)

**Studio invoice detail** (`studio-invoice-detail`, PARTIAL, 2d). A composition swap onto the shared primitives; the design already exists.
- Legacy pre v3 page: it never imports TahiButton, PageHeader, Badge or DataTable and hand rolls six raw buttons plus its own status colour map (app/(dashboard)/invoices/[id]/invoice-detail.tsx:73, TASKS.md T2.10)

**Stripe and Xero invoicing rails** (`invoicing-rails`, PARTIAL, 2d). One guarded export path; the channel per client and the pay links already landed.
- The hourly to invoice Xero export is unguarded: no idempotency, no billingModel filter, and a silent zero rate skip (TASKS.md CT.13 and IC.6)
- Invoice numbers are not mirrored into Xero because there are none yet (TASKS.md IC.7)

**Sign in, sign up, password reset** (`auth`, PARTIAL, 1d). One manual live pass plus the branded error and verification states.
- Forgot password has never been clicked through on the live Clerk build (TASKS.md T1.3)
- Branded error and verification states at 375px are not built (TASKS.md T1.8)

**Client account and organisation settings** (`client-account`, PARTIAL, 1d). One field on the profile route plus the write path role checks.
- isClientAdmin still falls back to contact.isPrimary because GET /api/portal/profile does not return portalRole (components/tahi/settings/settings-shell.tsx:169)
- Write path portalRole gap on brands, organisation, people and change request (TASKS.md T1.14)

**Studio home: owner and teammate** (`studio-home`, PARTIAL, 1d). Brief dedup plus one look at the teammate variant.
- The home brief card and the nav bar briefing are two surfaces that do not overlap; one source of truth is still open (TASKS.md T2.7)
- The teammate home has never been visually verified by a human (STATUS.md)

**Time tracking and timers** (`time`, PARTIAL, 1d). Unify the two routes and surface the rate.
- POST /api/admin/time never reads hourlyRate, so the rate you type on /time is silently discarded, while /api/admin/time-entries does persist it (app/(dashboard)/time/time-list.tsx:135, TASKS.md CT.12)
- There is no Rate column on the list
- Two routes do the same job and have diverged

**Studio services catalogue editor** (`studio-services`, PARTIAL, 1d). The schema change is shared with the client catalogue; the editor itself is full CRUD.
- The services table has no orgId, so per client retainer names cannot be modelled at all (db/schema.ts services, TASKS.md CT.11)

**Email delivery, allowlist and templates** (`email-delivery`, PARTIAL, 1d). One From address and the digest; the choke point and allowlist are live and verified.
- lib/contract-fully-signed-emails.ts still hardcodes its own From address instead of going through RESEND_FROM_EMAIL (TASKS.md CT.F)
- A per org digest for bulk status emails is still open (TASKS.md CT.F)
- RESEND_FROM_EMAIL needs a branded lockup and a verified sending domain, which is a Liam operator step (TASKS.md CT.4)

**Mobile shell, tab bar and touch targets** (`mobile-shell`, PARTIAL, 1d). The build work landed in TP.6 and CR.4; the lap is the gap.
- One full live client lap on production at 375px and dark has never run: submit, reply both ways with email, approve, pay link, files (TASKS.md CT.10 and T2.QA)

### Not MVP blocking (27 surfaces, 100 days)

**North star: discovery to onboarding to delivery automation** (`north-star-flow`, SPEC_ONLY, 12d). The four step chain is blocked behind the proposals redesign and has no code.
- AI drafted proposal from a call transcript plus enrichment plus pricing logic is unbuilt
- Capacity aware timeline proposal is unbuilt
- Accept to auto generate contract is unbuilt

**Proposals: list, editor, templates, public viewer** (`proposals`, PARTIAL, 7d). Publish semantics, the accept loop, mobile tabs and a full editor redesign plus port.
- Share never snapshots, and the public GET falls back to live tables when publishedSnapshot is null, so the standard journey serves live rows (app/api/public/proposals/[token]/route.ts:55, TASKS.md T3.1)
- Accept notifies nobody: no email, no notification, no deal move, while the viewer promises a reply within one business day (app/p/proposal/[token]/proposal-viewer.tsx:1107, TASKS.md T3.3)
- The Publish button vanishes after one use in a session because section and variant patches never bump updatedAt or call mutate (app/(dashboard)/proposals/[id]/proposal-detail.tsx:448, TASKS.md T3.2)

**Affiliates and referral commissions** (`affiliates`, PARTIAL, 6d). A v3 shell over a stub; the whole data model and tracking layer is unbuilt.
- The Rewardful route is an explicit stub that always returns empty affiliates, referrals and commissions regardless of connection state (app/api/admin/integrations/rewardful/route.ts:8)
- The sync route never calls Rewardful (app/api/admin/integrations/rewardful/sync/route.ts:29) and the page Refresh button does not even call it (app/(dashboard)/affiliates/affiliates-content.tsx:76)
- Phase C wants an affiliates table, referral codes at /r/{code}, attribution on close and a small affiliate portal; none exist

**Content studio** (`content-studio`, PARTIAL, 6d). Two whole slices deferred plus unverified migrations.
- Slice 7 signal expansion (LinkedIn engagement, competitor RSS, YouTube transcripts, Webflow news) is deferred (TASKS.md content engine ops)
- Slice 8 citation tracker and quarterly refresh is deferred
- Migrations 0060 to 0063 have never been verified against production D1, and the PI live QA passes are unrun

**Files as a shared library with folders and threads** (`files-library-v2`, SPEC_ONLY, 6d). A design pass plus schema plus a new surface on top of the existing files page.
- Folders per client (Deliverables, Brand, References, Uploads) do not exist
- A comment thread per file does not exist
- Versions are optional and unbuilt

**Client papers: proposals, contracts, schedules in the portal** (`client-papers`, DESIGN_ONLY, 5d). Three client read only surfaces off the existing public viewers.
- No client branch exists on /proposals, /contracts or /schedules; the nav items were removed rather than left bouncing (components/tahi/nav-model.tsx:120)
- Designed as client papers in the Claude Design shell but never ported (TASKS.md MR.1)

**Permissions builder and enforcement** (`permissions`, PARTIAL, 5d). Deny by default, per org scoping rollout and route level feature enforcement.
- Client feature_visibility denies are nav cosmetic only; a denied feature is hidden but the route still answers, breaking the visible equals permitted invariant (TASKS.md T1.6)
- Deny by default is not flipped: a roleless member resolves to admin and a member with no team row is unrestricted (TASKS.md T1.15)
- Only 30 of 362 admin route files call a scoping helper, so a scoped member can mint public share tokens for clients they cannot see (TASKS.md T1.16)

**Third party integrations** (`integrations`, PARTIAL, 5d). Stripe, Xero, Airwallex, Google and Buffer are real; Slack, Mailerlite, Rewardful and HubSpot are not.
- Slack posts nothing: the send path is a stub comment where chat.postMessage should be (app/api/admin/integrations/slack/route.ts:149)
- Mailerlite unsubscribe is a stub that returns a message instead of calling the API (app/api/admin/integrations/mailerlite/route.ts:56)
- Rewardful is entirely stubbed, see the affiliates surface

**Retainer and billing model depth** (`billing-tiers`, PARTIAL, 5d). A schema batch plus editors on top of the working subscription model.
- customMrr and billingModel editors are unbuilt (TASKS.md T668)
- Retainer health filter, MRR forecast end date awareness and auto churn are unbuilt
- Team salary and rate fields, and time cost, revenue and margin columns, need schema batch S25

**Cross surface design consistency pass** (`design-consistency`, DESIGN_ONLY, 5d). A design write back blocked on a login, then a port across roughly seven modules.
- Two rules Liam set are not applied everywhere: filters in a left rail on every list page, and one headline feature card anatomy across pages (TASKS.md AR.5)
- The consistency patch is staged locally at .claude/qa/patched/ but cannot be written back to Claude Design until Liam runs /design-login (TASKS.md DL.0 and DL.2)
- The rail must be withheld or collapsible on wide table pages (Time, Team, Leads, Deals, Calls, Tracks, client Invoices) where it cost columns and clipped money

**Deals pipeline and sales kit** (`deals`, PARTIAL, 4d). Nudge engine or removal, the Stalled flag rework and the v3 lap.
- A nudge scheduled for later inserts a row that no cron ever reads, so it never sends (app/api/admin/deals/[id]/nudges/route.ts, TASKS.md T3.8)
- The Auto Nudges toggle flips a flag with zero consumer (app/(dashboard)/deals/[id]/deal-detail.tsx:822)
- Stalled is a pipeline stage and Liam wants it as a flag on any stage (TASKS.md MC.6)

**Contracts: list, editor, templates, signing** (`contracts`, PARTIAL, 4d). PDF persistence, the tamper anchor, partial signature notices and the viewer lap.
- The fully signed PDF exists only as an email attachment; there is no R2 write and no signedStorageKey column (lib/contract-fully-signed-emails.ts:170, TASKS.md T3.6)
- bodyHtml accepts any PATCH with no status guard, so a contract stays editable after signatures (app/api/admin/contracts/[id]/route.ts:90, TASKS.md T3.7)
- A partial signature notifies nobody: the email only fires when status is signed (TASKS.md T3.3)

**Operational reports** (`reports`, PARTIAL, 4d). Triage by deletion, then keep only what is not duplicated.
- The Sales pipeline tab renders six components covering the same questions as /sales-analytics (app/(dashboard)/reports/reports-content.tsx:412, TASKS.md CT.19)
- The Finance group is five sections duplicating /financial-reports
- A second commitments editor writes to the same /api/admin/commitments endpoint and has already diverged (app/(dashboard)/reports/reports-content.tsx:3017)

**Team, org chart, access scopes and hire onboarding** (`studio-team`, PARTIAL, 3d). The Clerk invite path plus killing the fake personalisation.
- A hire invited into the Tahi Clerk org resolves to no member row and currently gets full admin including financials (TASKS.md T1.17)
- The teammate invite token flow is dead: lib/onboarding-entry.ts resolveToken returns null and POST /api/admin/onboarding-invites flow team has zero callers (TASKS.md T1.20)
- /welcome hardcodes role New teammate, gear MacBook Pro 16 and buddy Liam Miller for every hire (app/(onboarding)/welcome/page.tsx:46)

**Schedules: list, editor, templates, public viewer** (`schedules`, PARTIAL, 3d). The share leak was fixed in e7d14803; what remains is theme integrity and mobile.
- The gantt is a 64rem strip, so a phone client pinch scrolls it (components/tahi/gantt-grid.tsx:122, TASKS.md T3.5)
- app/layout.tsx applies the dark class from localStorage on every route including the public viewer, which has no toggle, so a teammate dark setting bleeds into the client document (app/layout.tsx:72, TASKS.md T3.4)
- Dark slide themes render invisible text because the viewer does not consume --page-chrome-text (TASKS.md T3.4)

**Project and contract calculator** (`calculator`, PARTIAL, 3d). Save and load work; the pricing engine and calibration do not.
- The pricing dial in never happened: three input modes, per component cost visibility and calibration from past project actuals are all still spec, marked not started (WORKFLOWS.md Phase H+)
- It does not pull live cost of services, pipeline or capacity as the spec asks

**Notification engine, SSE and digests** (`notifications-engine`, PARTIAL, 3d). The identity fix and the four event emails landed; the digest and push did not.
- Weekly digest is unbuilt (TASKS.md T698 to T699)
- Web Push has no service worker handler (STATUS.md Stubs)
- Sidebar unread badges are unbuilt (TASKS.md T693)

**Offline page, PWA install and web push** (`offline-pwa`, PARTIAL, 2d). Service worker handler plus two device installs.
- Web Push has no service worker handler (STATUS.md Stubs)
- PWA install has not been tested on iOS or Android (CLAUDE.md Mobile and PWA)

**Automation rules and outgoing webhooks** (`automations`, PARTIAL, 2d). One smoke lap plus the Zapier config surface.
- The event bus and webhook delivery went live 2026-07-07 but the live smoke of automation fire, webhook delivery and announcement fan out has never run (STATUS.md, TASKS.md W-QA)
- Zapier outgoing webhooks have an engine but no config surface (TASKS.md T570)

**MCP worker tool parity and auth** (`mcp-parity`, PARTIAL, 2d). An auth hardening deploy Liam must re approve, plus two broken tools.
- The worker /authorize endpoint auto approves on client_id alone, which is not a secret, so anyone can mint full admin (workers/mcp-server/src/index.ts:2675, TASKS.md T1.11)
- A live ManyRequests token is hardcoded at workers/mcp-server/src/index.ts:97 and is now in git history (TASKS.md T1.12)
- send_message and create_conversation post the wrong body shape and always fail (TASKS.md CT.17)

**Automated client health scoring** (`health-scoring`, PARTIAL, 2d). A cron plus the write path; the read surfaces already render it.
- The scorer exists and reads, but nothing recomputes health on a schedule: zero callers (docs/superpowers/audits/2026-09-06-next-surfaces-assessment.json, TASKS.md:103)

**Client billing page** (`client-billing`, PARTIAL, 1d). A decision plus an error toast, or deletion.
- Manage Billing only console.errors on failure, so the popup fails silently (app/(dashboard)/billing/billing-content.tsx:110)
- Liam has not decided whether the page belongs in the client nav at all (TASKS.md CT.16)

**Client tracks page** (`client-tracks`, PARTIAL, 1d). Either delete the route or give it nav and touch parity.
- Linked from nowhere and HTML5 drag only; the client home TrackBoard already tells the same story with buttons (TASKS.md CT.18)
- Liam has to decide delete or keep

**Scheduled jobs page and cron delivery** (`crons`, PARTIAL, 1d). Repo variable plus the auth header switch, then verify one run.
- The GitHub Actions TAHI_DASHBOARD_URL repo variable still points at the retired webflow.io host and the workflows send x-cron-secret rather than Authorization Bearer (TASKS.md T1.13)

**Reviews and testimonial outreach** (`reviews`, PARTIAL, 1d). Two small fixes, or delete the page and the orphaned routes.
- The Send button only writes outreachStatus; no email and no notification ever leave (app/api/admin/reviews/route.ts:74, TASKS.md CT.15)
- Copy review link builds /review?token= while the page is app/review/[token]/page.tsx, so every copied link 404s (app/(dashboard)/reviews/reviews-content.tsx:151)
- The outreach routes are orphaned

**Studio billing admin** (`studio-billing`, PARTIAL, 1d). A v3 composition lap on a page only the studio sees.
- Legacy page: three raw tables, no shared primitives (TASKS.md T2.9)

**Announcements and banners** (`announcements`, PARTIAL, 1d). One live fan out test with the allowlist in place.
- The email fan out honours per user preferences in code but has never had a live smoke (STATUS.md, TASKS.md W-QA)

---

## Claude Design coverage

34 of 64 surfaces have a named module in the Claude Design project or in a staged directory. The rest read `unknown`: a nav label alone in the prototype shell was not treated as evidence.

| Prototype location | What it is | Surfaces it covers |
|---|---|---|
| `.claude/qa/svclocal/` | local mirror of the Claude Design project, the most current copy | studio-home, studio-requests, studio-tasks, studio-clients-list, studio-client-detail, client-home, client-files, client-invoices, plus 17 more |
| `.claude/qa/local/, .claude/qa/fix/, .claude/qa/verify/, .claude/qa/cur/` | earlier snapshots of the same mirror at different fix stages | same set, historical |
| `.claude/qa/staged/sales-artifacts.jsx` | staged three pane editor rework awaiting write back to Claude Design. Blocked by TASKS.md DL.0, the Claude Design MCP token lost its design scopes | proposals, schedules, contracts |
| `.claude/qa/patched/` | staged consistency pass, ten modules. Blocked by TASKS.md DL.0 and DL.2 | design-consistency |
| `.claude/qa/svclocal plus .claude/qa/svc-ladder-patch.cjs` | staged Services plan ladder. Blocked by TASKS.md DL.3 | client-services |
| `.claude/qa/stall/` | staged Stalled as a flag rework. Blocked by TASKS.md DL.3 | deals |
| `.claude/qa/inv/invoices_studio.jsx` | studio invoices module, designed and critiqued, not wired into the shell. Blocked by TASKS.md DL.3 and MR.6 | studio-invoices, studio-invoice-detail |
| `.claude/qa/band/, band2/, sa/, sp/` | working directories from the head band, sales artifacts and sales pipeline design passes | proposals, schedules, contracts, leads, calls, deals, design-consistency |
| `.claude/qa/bandshots/, critshots/, fixshots-A/, shots/, sashots/, svcshots/, ops-shots/, inv-shots/, edshots/, crops/` | render QA screenshots, evidence only, no design source | none, evidence only |
| `docs/superpowers/audits/2026-09-06-portal-design-results.json` | design result record for the portal modules | client-home, client-files, client-invoices, client-services, client-account |
| `docs/superpowers/audits/2026-09-06-sales-design-results.json` | design result record for the sales modules | leads, calls, deals, proposals, schedules, contracts |
| `docs/superpowers/audits/2026-09-06-studio-invoices-services-design.json` | design result record for studio invoices and the services showcase | studio-invoices, studio-invoice-detail, client-services |
| `docs/superpowers/audits/2026-09-07-proposals-consistency-design.json` | design result record for the proposals editor and the consistency rules | proposals, design-consistency |
| `docs/superpowers/audits/2026-09-06-shell-wiring.json and 2026-09-06-shell-fix-recheck.json` | shell wiring and the fix pass recheck, 20 surfaces by 4 combinations | mobile-shell, notifications-page, client-account |
| `docs/superpowers/audits/2026-09-03-design-parity-inventory.md` | repo to prototype gap list, 33 rows, P1 4 P2 13 P3 16 | studio-requests, mobile-shell |

Designed but not yet in the repo, which is the largest single pocket of finished design sitting idle: the sales artifacts editor rework, the consistency pass, the Services plan ladder, the Stalled as a flag rework and the studio invoices module. All five are staged locally and all five are blocked on the same thing, `TASKS.md DL.0`, which needs Liam to run `/design-login`.

---

## Test and quality coverage

| Measure | Count |
|---|---|
| Vitest files (worktrees excluded) | 195 |
| Playwright specs | 12 |

Vitest sits mostly on the API and library layers: 72 in `app/api/__tests__`, 60 in `lib/__tests__`, 30 in `lib colocated`, 16 in `components/tahi/__tests__`, 6 in `app/api/admin/tasks/__tests__`, 5 in `lib/predict/__tests__`, 2 in `app/(dashboard)/clients/_list/__tests__`, 4 in `other`.

**Critical flows with end to end coverage:** Requests: list, board, detail and dialog, five specs. Tasks: happy path plus eight behaviours that have no live smoke. Client portal flow, portal-flow.spec.ts. Admin flow, admin-flow.spec.ts. Mobile, mobile.spec.ts. Onboarding personas, onboarding-personas.spec.ts. Settings smoke.

**Critical flows with no end to end coverage:**
- Cross org isolation proof, seeded two orgs plus an adversarial IDOR pass (TASKS.md T1.5, open)
- Proposal share to publish to view at 375 to accept to admin notified (TASKS.md T3.QA, open)
- Contract send to sign to PDF in both inboxes (TASKS.md T3.QA, open)
- Invoice pay round trip on both the Stripe and the Xero rail
- Messages for both audiences
- Email delivery through the allowlist

**Stale specs to re verify:** e2e/mobile.spec.ts and e2e/portal-flow.spec.ts assert a Messages tab from the period when Messages was hidden (TASKS.md V1-QA.2). Messages is live again since AR.2, so re verify rather than assume failure.

---

## Caveats

- This is a static read of the tree at f47b8805 plus the written records the repo keeps. Nothing was run and no browser was opened, so every LIVE claim means wired to a real endpoint with no stub in the code, not verified in a browser.
- TASKS.md and STATUS.md disagree in places because STATUS.md was last updated 2026-09-05 and roughly fifteen items shipped after it. Where they conflict this inventory follows the code and the newer TASKS.md entries. Example: the schedules share leak was fixed in e7d14803 but STATUS.md still lists it as open.
- Day estimates are the repo own figures where TASKS.md carries one. They assume the deploy approval gate stays manual, which historically cost eight days on one fix.
- Percent by days treats the scope estimate of a LIVE surface as sunk work. Those scope figures are judgement, not measured, so the by days percentages are directional only. The by count percentages are the more defensible number.
- Two production blockers sit outside any surface row: the manual GitHub environment approval on every deploy (STATUS.md DEPLOY GATE) and the stale finance.yieldHoldings setting.
- The MCP worker /authorize hole (TASKS.md T1.11) lets anyone holding the client id mint full admin. It is marked mvp_required false only because the given MVP definition does not name it. Treat it as a launch blocker.
- Three LIVE surfaces have no written spec and are flagged MISSING_SPEC inside their missing list: contact and brand detail, capacity, and sitemap. None is MVP required.
- designed_in_claude_design is true only where a named module exists in the local mirror at .claude/qa/svclocal or in a staged directory. A nav label alone in the prototype shell was not treated as evidence, which is why calculator, affiliates, docs and content studio read false.
- The percentage denominators count surfaces, not effort. A LIVE 20 day surface and a LIVE 2 day surface each count once.
