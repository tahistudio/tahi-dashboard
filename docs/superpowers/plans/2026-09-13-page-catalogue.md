# Page and Functionality Catalogue (2026-09-13)

## How to read this

This is the master list Liam asked for on 2026-09-13: every route in the app, every piece of functionality still owed, and an order to tick through them once Giant Group is onboarded. Section 2 is PAGES, split into three tables by audience (client portal, studio, public and auth), one row per route, 59 routes total, each appearing exactly once. "Current state" describes the live code (v3 = built on the current design-system primitives, partial = some primitives, legacy = bespoke markup, stub = placeholder, missing = not built). "Design and verdict" names the Claude Design file and the most recent critic verdict on record, where Pass 3 (the 23-page consistency pass, saved under `2026-09-07-proposals-consistency-design.json`) is the latest documented critic run and PASS-B supersedes it for four editor items; "no design" means no design file exists at all. "Port status" is whether that design has been brought into the real shell. "What is left" is written in the four buckets Liam named (design, port, functionality, polish). Priority is 1 client-facing daily, 2 studio daily driver, 3 sales and growth, 4 later. Effort is a rough agent-day figure for everything in the "what is left" cell, not for rebuilding the page. Section 3 is FUNCTIONALITY: capabilities that are not a page, with the surface they land on, what blocks them, and the TASKS id or audit they came from. Section 4 is the proposed order, batched so three to five agents can run in parallel worktrees without fighting over the same files; every batch carries the CLAUDE.md rule 8 gate (type-check zero errors, lint zero errors, deployed, live browser smoke of the golden path, 375px with no horizontal scroll and 44px touch targets, dark mode with no contrast regression, screenshot or note in the commit body) plus the batch-specific smoke named on its line. Section 5 lists what already landed tonight so nobody re-plans work that is finished or in flight.

---

## 2. PAGES

### 2a. Client portal (12 routes)

Routes marked "both" serve admin and client from one file and are listed here because the client half is the one that gates the Giant Group onboarding.

| Route | What it is | Current state | Design and verdict | Port status | What is left | Pri | Effort |
|---|---|---|---|---|---|---|---|
| `/overview` | Both. Client welcome, KPIs, track capacity, onboarding, project card; admin studio ledger from the same route | v3 | `portal-home.jsx` SHIP (Pass 3, "strongest page in the walk"); `overview.jsx` not critic-covered | Ported, live | Functionality: CT.3b empty-state flash before fetch resolves, V1-FIX.1 dead "Message the team" CTA, T2.4 project card leaking newest draft schedule, T2.7 briefing dedup on the admin half | 1 | 1.5d |
| `/requests` | Both. List, board, workload, filters, bulk ops, new/AI/bulk dialogs; client submit and track | v3 | `requests.jsx` plus kit/board/detail/dialog/toolbar, SHIP (Pass 3), the reference for the band and rail standard | Ported, live | Polish: P3 board drop-target lights the dragged card's own column; fixture em dashes in design data only | 1 | 0.5d |
| `/requests/[id]` | Both. Thread, status engine, sub-requests, people, files, time, checklists, schedule-phase link | v3-composed detail | Covered by the `requests-*` set, no separate detail verdict | Ported, live | Functionality: request steps and client checklist writes do not exist, revision counter never persists, activity feed is synthesised client-side with no record of who changed status. QA: V1-QA.1 client-session verify of scope pill, own-name rendering, approve banner | 1 | 3d |
| `/messages` | Both. Two-pane conversations (direct, group, org channel, request thread); client variant hides internal toggle | Legacy (bespoke h1, no PageHeader) | No design file at all, and absent from the checklist's own "not designed yet" list, on both admin and client sides | Not ported | Design: whole surface. Port: T2.6 PageHeader and thread UX. Functionality: New-conversation participant shape 500s, team not auto-added to client threads, no org_channel provisioning rule, no polling or SSE, no message edit. QA: V1-QA.2 specs still assert a visible tab | 1 | 9d |
| `/invoices` | Both. Admin ledger across clients with Stripe and Xero reconcile; client sees own history | v3 | Client half `portal-money.jsx` REDO (Pass 3, Pay-now button cut in half by the rail); studio half `invoices-studio.*` FIX (MR.6) | Client half ported and live; studio design wired 2026-09-13 but unmounted | Design: fresh critic pass on the client REDO, which is still the last formal verdict on a live surface. Port: MR.6 studio list under Finance once the fixer clears two blocking bugs | 1 | 1.5d |
| `/invoices/[id]` | Both. Line items, totals, admin lifecycle actions (send, paid, void, Xero, Stripe) | v3 (ported T2.10) | Part of the `invoices-studio` set, no standalone verdict | Ported, live | Polish and QA: live pay-link round trip at 375px as a real client | 1 | 0.5d |
| `/billing` | Both. Admin read-only subscriptions and revenue; client plan card plus Stripe portal | Legacy (3 raw tables, PageHeader only) | No design file | Not ported | Design: whole surface. Port: T2.9 v3 lap. Functionality: Manage Billing popup fails silently. Decision: CT.16, whether it belongs in the client nav at all | 1 | 1.5d |
| `/services` | Both. Admin catalogue editor; client browse-only plan and service grid | Legacy, the worst page in the app (zero primitives) | `portal-money.jsx` Services half, critic verdict FIX not REDO (MR.7); plan ladder written 2026-09-13 (DL.3) | Catalogue live, ladder not ported | Port: MR.7 showcase plus the staged ladder at `.claude/qa/svclocal`. Functionality: CT.11 order path (needs Liam's request-vs-Stripe-checkout call), MC.5 plan-aware suggestion rule, CL.3 "Ask about this" upsell. Port: T2.8 v3 lap rides along | 1 | 3d |
| `/files` | Client. Intended R2 deliverable browser | Stub (EmptyState, no fetch) | `portal-files.jsx` FIX (Pass 3, no headline band, third rail idiom at 208px, flagged low priority) | Not ported | Design: CL.1 "small Google Drive with threads" (per-client folders, drag-drop, comment thread per file, optional versions) is a fresh design, not the existing file. Port and functionality: everything | 1 | 5d |
| `/notifications` | Both. Full history behind the bell, self-scoped to the caller | v3 | `portal-account.jsx` Notifications room, no named verdict, flagged in Pass 3's rail inventory as a near-miss rail | Ported, live (AR.1) | Design: TP.4 All/Past history treatment. Functionality: preferences page, rich content, sidebar badges (T682-693) | 2 | 2d |
| `/settings` | Both. Client profile, appearance, notifications; admin roughly 29 stacked sections | v3-composed shell (`SettingsShell`) | `Tahi Settings.html` and `settings-app.jsx`, not critic-covered | Ported, live | Functionality: notification preferences section, a reader for the quiet-hours value nothing consumes, Xero category overrides (needs S25), Zapier trigger config surface (T570) | 2 | 3d |
| `/tracks` | Client. Track-queue mini-kanban lanes per retainer track, drag to reorder | Legacy and orphaned, linked from nowhere | `ops.jsx` Tracks REDO (Pass 3, worst of that batch, titles break to single characters; critic says the rail does not belong here) | Not ported | Decision first: CT.18, delete it, since the client home TrackBoard already tells the story. If kept, a full redesign without the rail | 4 | 0.25d to decide, 2d if kept |

### 2b. Studio (40 routes)

| Route | What it is | Current state | Design and verdict | Port status | What is left | Pri | Effort |
|---|---|---|---|---|---|---|---|
| `/tasks` | Internal execution board: list, board, My week, subtasks, dependencies, AI wizard, templates | v3 | `tasks.jsx` SHIP (Pass 3), matches Requests exactly | Ported 2026-09-05 | Design then build: TP.3 My week real week dates and multi-day allocation. QA: live smoke of roughly 12 behaviours only ever proven in e2e (bulk complete, promote, timer, AI wizard, save-as-default, CSV, both drags) | 2 | 3d |
| `/tasks/[id]` | Deep-link shim, redirects to `/tasks?task=<id>` | v3 shim (405 bug fixed) | No design needed | Ported | Nothing | 4 | 0 |
| `/leads` | Pre-qualification inbox: AI scoring, enrichment, bulk import, promote | v3 (DataTable, SlideOver) | `sales-pipeline.jsx` FIX (Pass 3, was SHIP at Pass 2; OWNER and TOUCHED columns lost to the new rail, NEXT STEP clips mid-word) | Not ported | Design: re-critique after the rail-collapse revision, which the WRITESET re-check believes fixed it but never verified live. Port: then swap composition | 3 | 1.5d |
| `/leads/[id]` | Lead workspace: firmographics, AI briefing and score, AI first reply, promote | Mixed (Badge, Breadcrumb, DiscoveryCallsCard) | Part of the `sales-pipeline` set, no standalone verdict | Not ported | Port after the list re-critique. Polish: consistent headline card per AR.5 | 3 | 1d |
| `/calls` | Unified call log from Google Calendar plus manual entries, classify, transcript extract | v3 | `sales-pipeline.jsx` Calls FIX (Pass 3, list clips at the right edge, title truncates) | Not ported | Port after re-critique. Functionality: GI.3 link and purpose are not editable (needs call detail fields, a PATCH route and MCP `update_call`), T568 Google Calendar booking links | 2 | 2d |
| `/deals` | Daily-trusted pipeline: kanban and list, weighted forecast, close won or lost, nudges | Legacy composition (PageHeader only) | `sales-pipeline.jsx` Deals FIX (Pass 3, board lost a column, titles clip, two accent rules) | Not ported | Port: T3.11 v3 lap. Functionality: MC.6 Stalled becomes a flag on any stage, T3.8 honesty pass on nudges | 3 | 3d |
| `/deals/[id]` | Single-deal cockpit: activities, contacts, calls, engagement health, nudges, convert | Legacy composition (SidebarSection) | Same file and verdict as `/deals` | Not ported | Port: T3.11. Functionality: the nudge engine remove-or-build decision, error surfacing on send failures | 3 | 2d |
| `/proposals` | List of client proposals with package variants and public share | v3 | `sales-artifacts.jsx` proposals-list SHIP (Pass 3) | Not ported | Port: blocked on DL.1, the design file is 158KB and the project currently holds a truncated copy | 3 | 1d |
| `/proposals/[id]` | Two-pane slide builder: sections, variants, publish, share, decisions, analytics | v3-composed editor | proposals-editor FIX (Pass 3), re-checked at PASS-B. Wiring bug: every list row opens the same hardcoded document because `id` is dropped and `demo` never passed, so Declined, Withdrawn and Expired are unreachable. Also native unstyled date and select inputs, misaligned baselines, card-in-card-in-card | Not ported | Design: AR.4 says redesign before any port, this needs the most work of any editor. Port: after. Functionality: T3.1 publish-before-share, T3.2 Publish button dies after the first publish in a session | 3 | 5d |
| `/proposals/templates` | Library of reusable proposal blueprints | Partial (PageHeader only) | templates SHIP (Pass 3) | Not ported | Port only | 4 | 0.5d |
| `/schedules` | List of shareable project gantts and timelines | v3 | schedules-list SHIP (Pass 3) | Not ported | Port: blocked with the rest of DL.1 | 3 | 1d |
| `/schedules/[id]` | Section builder headlined by a Gantt, rows link to real requests and tasks | v3-composed editor | schedule-editor FIX (Pass 3, gantt gets the narrowest pane and only 6 of 14 weeks are visible), re-checked at PASS-B | Not ported | Design: pane rebalance. Port: after. Functionality: T3.1 publish-before-share, gantt is a 64rem pinch-scroll strip on phones | 3 | 3d |
| `/schedules/templates` | Reusable schedule structures, rename, delete, instantiate | Mixed (ConfirmDialog, EmptyState, no PageHeader or DataTable) | templates SHIP (Pass 3) | Not ported | Port only | 4 | 0.5d |
| `/contracts` | List of NDAs, SLAs, MSAs and SOWs with multi-signer e-sign status | v3 | contracts-list SHIP (Pass 3) | Not ported | Port: blocked with DL.1. Functionality: search reads a dead legacy `contracts` table, not `contract_documents` | 3 | 1d |
| `/contracts/[id]` | Body, Signers and Activity editor; send for signature, audit chain | v3-composed editor | contract-editor FIX (Pass 3, preview header clips "The signing pag..."), fixed inline by the librarian at PASS-B but never re-critiqued | Not ported | Port. Functionality: T3.6 signed PDF never stored to R2 so email is the only copy, T3.7 body stays editable and unhashed after signatures, revoke does not reset partially-signed state | 3 | 4d |
| `/contracts/templates` | Reusable contract bodies with `{{variable}}` slots | v3 | templates SHIP (Pass 3) | Not ported | Port only | 4 | 0.5d |
| `/calculator` | Internal pricing and scoping engine: quote target, capacity, benchmarks, draft artifacts | Partial custom composition (FeatureCard, charts) | No design file | Not ported | Design and polish only; no list markers expected. Functionality: T700-705 project calculator port | 3 | 1d |
| `/sales-analytics` | Pipeline shape and conversion charts (funnel, donut, monthly bar) | Partial (PageHeader only) | No design file | Not ported | Design. Functionality: CT.19 deletes six duplicate sections out of `/reports` into here, pipeline quality scoring (T707-715) | 3 | 1.5d |
| `/affiliates` | Affiliate and referral tracking, a thin mirror of Rewardful | v3 DataTable over stub data | No design file | Not ported | Functionality: the data underneath is a stub, N6 is the real phase. Security: no FEATURE_RESOURCE tree node at all (T1.18) | 4 | 2d |
| `/clients` | Master roster of client organisations, health and plan filters, add client | v3 | `clients.jsx` SHIP (Pass 3) | Ported 2026-09-06 | Functionality: customMrr and billingModel editors, retainer health filter, auto-churn (T668-676, needs S25) | 2 | 1.5d |
| `/clients/[id]` | 16-tab client hub: billing, profitability, contacts, calls, contracts, brands, activity | v3-composed bespoke hub | `clients-detail.jsx`, not critic-covered | Ported 2026-09-06 | Polish: the tab-consistency pass already in flight. Functionality: client LTV (T571), time cost and margin columns, MC.10b Physitrack duplicate Stripe customer | 2 | 2d |
| `/clients/brands/[id]` | Read-focused brand profile: identity, linked contacts, tagged-request count | Legacy or minimal (Breadcrumb and TahiButton only) | No design file | Not ported | Design and port, both from scratch | 4 | 1d |
| `/clients/contacts/[id]` | Canonical per-person page: org, deals, activity timeline, recent messages | Legacy or minimal (no PageHeader or DataTable) | No design file | Not ported | Design and port, both from scratch. This is the page a CRM lives or dies on | 3 | 1d |
| `/content-studio` | AI SEO engine: Health, Ideas, Drafts, Links, Schedule, Site index, Audits, Backfill | v3 | No design file | Not ported | Ops: verify migrations 0060-0063 on prod, live QA passes, Slice 7 and 8 stay deferred | 4 | 1d |
| `/content-studio/drafts/[id]/round-table` | Single draft or audit: brief, body, 23 reviewer critiques, cover, publish | v3-composed detail | No design file | Not ported | Polish only | 4 | 0.5d |
| `/sitemap` | Site-architecture planner: node tree, AI Boardroom reviewers, export | Partial (PageHeader, Card, Tiptap) | No design file, and missing from the checklist's own bookkeeping | Not ported | Design if it ever leaves the email allowlist; otherwise nothing | 4 | 0.5d |
| `/social` | Read-only mirror of Buffer activity: cadence chart, scheduled and sent posts | Legacy (Badge, LoadingSkeleton, TahiButton) | No design file | Not ported | Design and v3 lap | 4 | 1d |
| `/reviews` | Case-study and testimonial outreach: NPS, permissions, outreach status | Partial (PageHeader, custom rows) | No design file | Not ported | Functionality first, this page lies: CT.15 Send sends nothing, Copy review link 404s (`/review?token=` vs `/review/[token]`), videoUrl and caseStudyInterest never persist, no Approved Case Studies view promised by Decision #018 | 3 | 4d |
| `/announcements` | Broadcast-banner builder: audience targeting, publish, Resend fan-out | v3 | No design file | Not ported | QA: the fan-out has never been smoke-tested live (W-QA) | 3 | 0.5d |
| `/time` | Manual time ledger: rollups, by-client view, charts, CSV export | v3 | `ops.jsx` Time FIX (Pass 3, week-grid VALUE column clips money to "NZ$2,7...") | Not ported | Port after re-critique. Polish: IC.9 several controls under 44px at 375px, superseded if the week-grid redesign happens first. Functionality: IC.8 backfill stamp before the first live hourly Xero export | 2 | 2.5d |
| `/financial-reports` | Daily-trusted finance cockpit: cash and runway, MRR, AR aging, tax, take-home | v3 | No design file | Not ported | Ops: T0.3 refresh `finance.yieldHoldings` against Airwallex. Functionality: BankRunwayCard statement rows, outstanding KPI dedup, revenue per head, T600 runway verify and close | 2 | 3d |
| `/reports` | Broad analytics hub: operations, sales, finance, team on a sticky jump nav | Partial (PageHeader only) | No design file | Not ported | CT.19 triage by deletion: 6 sections duplicate `/sales-analytics`, 5 duplicate `/financial-reports`, a second commitments editor has diverged, three feature gates hide behind one static list, and no access-scoping helper is called so a scoped hire sees studio-wide MRR and aging | 3 | 4d |
| `/capacity` | Team utilisation and pipeline-capacity forecast, sales-call deal impact | Partial (PageHeader, KPI and chart composition) | `ops.jsx` Capacity SHIP (Pass 3, correctly exempt from the rail) | Not ported | Port only | 3 | 1d |
| `/team` | Team directory plus access-scoping engine (members, org chart, access rules) | v3 | `ops.jsx` Team FIX (Pass 3, person row mangled, emails truncate, role chips stack, two fewer people visible) | Not ported | Port after re-critique. Functionality: T1.17 hire onboarding path, T1.20 the teammate invite link is fully dead (`resolveToken` is a stub, `/welcome` hardcodes fake personalisation) | 2 | 3d |
| `/permissions` | Granular feature-visibility builder (Team, Clients, Roles; Inherit, Allow, Deny) | Partial, delegates to the settings team-access pane | `permissions.jsx`, not critic-covered | Ported, live | Functionality: T1.6 denies are nav-cosmetic and must 403 at the route, T1.15 deny-by-default flip, T1.18 nav gating with 6 unmapped items | 2 | 2d |
| `/docs` | Docs Hub knowledge base: categorised pages, Tiptap editor, version history | v3 | No design file | Not ported | Locked 2026-05-23, do not touch without an explicit ask. Security: T1.19 docs are unscoped on the teammate home | 4 | 0.5d |
| `/settings/audit` | Legacy URL shim to `/settings?section=audit` | Redirect stub | None needed | N/A | Nothing | 4 | 0 |
| `/settings/automations` | Legacy URL shim to `/settings?section=automations` | Redirect stub | None needed | N/A | Nothing on the shim; the Zapier config surface (T570) lands in the settings section | 4 | 0 |
| `/settings/crons` | Legacy URL shim to `/settings?section=crons` | Redirect stub | None needed | N/A | Nothing on the shim; T1.13 is workflow-side | 4 | 0 |
| `/design-system` | Hidden internal token, primitive and component gallery | v3 | It is the showcase | N/A | Keep in step with the band and rail contract once AR.5 lands | 4 | 0.5d |

### 2c. Public and auth (7 routes)

| Route | What it is | Current state | Design and verdict | Port status | What is left | Pri | Effort |
|---|---|---|---|---|---|---|---|
| `/p/proposal/[token]` | No-login token-gated proposal viewer: sections, package compare, accept, decline, ask | v3 deliverable kit | Bottom of `sales-artifacts-kit.jsx`, FIX at Pass 1 only, never re-verdicted at Pass 2 or 3; the builder claims fixes but that is a build report, not a critic pass | Not ported, live viewer is the older kit | Design: an actual critic re-check. Functionality: T3.1 share serves live rows before publish, T3.3 accept and decline are silent, T3.4 invisible dark-slide text and viewer inheriting the visitor's dashboard dark-mode localStorage, T3.5 package tabs clip at 375px so the third package is unreachable, raw `alert()` on failure, no per-document title or OG tags | 1 | 3d |
| `/p/schedule/[token]` | No-login token-gated schedule viewer: cover plus Gantt and section pages | v3 deliverable kit | Same file, same Pass 1 FIX | Not ported | Same S3 bundle as the proposal viewer plus the gantt pinch-scroll strip on phones | 1 | 2d |
| `/p/contract/[token]` | No-login read-only contract viewer with signer roster and status | v3 `ContractViewer` view mode | Same file, same Pass 1 FIX | Not ported | Port: T3.10, the only public viewer still off the shared deliverable kit | 1 | 2.5d |
| `/p/contract/[token]/sign/[signerId]` | Per-signer e-signature capture with a tamper-evident hash chain | v3 `ContractViewer` sign mode | Same file, same Pass 1 FIX | Not ported | Functionality: no notification until the last signer so partial signatures are silent, signed PDF never persisted, body unhashed, signature pad canvas misaligns on phone rotation mid-signature | 1 | Part of S4 and S5 |
| `/sign-in` | Clerk sign-in inside the branded split-pane auth shell | v3 `AuthShell` | `Tahi Auth.html` and `auth-app.jsx`, not critic-covered | Ported, live | Functionality and polish: T1.3 manual forgot-password click-through on the live Clerk build, T1.8 branded error and verification states at 375px | 1 | 1d |
| `/sign-up` | Clerk sign-up inside the same shell | v3 `AuthShell` | Same file, not critic-covered | Ported, live | Same T1.3 and T1.8 pass | 1 | 0.5d |
| `/continue` | Landing spot for a signed-in session with no active Clerk org; resolves membership and calls `setActive` | v3 `AuthShell` | Same file, not critic-covered | Ported, live | Functionality: T1.4 second-seat contacts stick at this gate because no Clerk webhook backfills them | 1 | 0.5d |

---

## 3. FUNCTIONALITY

Capabilities that are not a page. "Effort" is blank as "n/s" where no source stated one.

| Capability | Surface | Dependencies | Effort | Source |
|---|---|---|---|---|
| Wire Slack notifications to real events (new request, overdue, status change) | Cross-cutting notification layer | `lib/slack-notify.ts` exists with zero call sites; dispatcher built | 1d | next-surfaces-assessment notYet |
| Mailerlite onboarding list and later Mailerlite-based CRM | Client onboarding | None stated | n/s | N5 |
| Zapier outgoing webhook config surface | `/settings` automations | Engine shipped in Wave 2 | 1d | T570 |
| Xero category overrides | `/settings` billing, Xero sync | S25 schema batch | n/s | T667 |
| Refresh `finance.yieldHoldings` against the Airwallex UI | `/financial-reports` data | Deploy landed | 0.25d | T0.3 |
| Fire sync-airwallex and verify `get_bank_balances` matches Airwallex | Finance data | Deploy landed | 0.25d | T0.2 |
| WhatsApp and Slack chat bot that turns a client message into a request | New intake channel adapter | Design first; per-platform adapter, transcription, idempotency key, same validation as the New Request dialog | n/s | GI.1 |
| Client-scoped MCP server bound to one client's portal permissions | New MCP surface beside `workers/mcp-server` | `lib/permissions.ts`, `getPortalAuth` | n/s | GI.2 |
| Harden worker MCP `/authorize`, which mints full admin on `client_id` alone | `workers/mcp-server` | Liam reconnects the connector after redeploy | 0.5d | T1.11 |
| Rotate the committed ManyRequests API token | `workers/mcp-server` | Deprioritised until cutover | 0.25d | T1.12 |
| Fix MCP `send_message` and `create_conversation`, which post the wrong body and always fail | Worker MCP | None; or delete both | 0.5d | CT.17 |
| Verify worker MCP finance tool coverage | Worker MCP | None | 0.25d | T618 |
| Deal nudge engine: remove the promises or build the sender | `/deals` detail | Liam decision; MC.6 can ride along | 1d remove, 3.5-4d build, +2d with MC.6 | T3.8, t3-reverify S6 |
| Live smoke of automation firing, webhook delivery and announcement fan-out | Automation engine | Deployed | 0.5d | W-QA |
| Wire or delete the client health scorer (complete 5-check route, zero callers, no cron, test asserts a different rubric) | `/clients` health badge | Decide before building on it | 1d | next-surfaces-assessment notYet |
| Fix GitHub Actions crons: stale `TAHI_DASHBOARD_URL`, switch to Bearer auth | `.github/workflows` | Verify first, sync-airwallex still fires | 0.5d | T1.13 |
| Normalise daily-summary and sync-drive-transcripts cron windows to UTC instants | Cron routes | `lib/call-time.ts` built | 0.5d | T0.5 follow-ups |
| Notify Tahi on proposal accept, decline or question, and write a deal activity | `api/public/proposals/[token]/accept` | Migration 0098, `lib/notification-email.ts` | 2d | T3.3, t3-reverify S2 |
| Notify on every contract signature, not only the last | Contract sign route | Migration 0099 | Inside the 4d S4 | T3.3, T3.6 |
| Web Push: no service worker handler exists at all | Browser notifications | None stated | n/s | T694-697 |
| Weekly digest cron plus a reader for the quiet-hours value nothing consumes | `/settings` notifications and a new cron | Dispatcher built | n/s | T698-699 |
| Email-to-Request intake: verify, finish, or park | Inbound email webhook | None | 0.5d to verify | T716 |
| Per-org digest for bulk status-change emails (today bulk moves only ring the bell) | Request status notifications | Dispatcher built | n/s | CT.F |
| Route contract-signed emails through the single `RESEND_FROM_EMAIL` chokepoint | Contract emails | None | 0.25d | CT.F |
| Notification preferences page, rich content, sidebar badges | `/settings` and the bell | S23 schema | n/s | T682-693 |
| All and Past notification history behind the bell | `/notifications` | Design first | n/s | TP.4 |
| Request steps and client-visible checklist writes (UI claims they work, no writes exist) | `/requests/[id]` | None; fix the misleading comments now | n/s | next-surfaces-assessment notYet |
| Revision counter persistence, so "Rev n/3" is not permanently at zero | Request thread | Same as above | n/s | next-surfaces-assessment notYet |
| Persisted per-request activity log recording who changed what and when | Request detail activity feed | New table plus a write on every mutation | n/s | next-surfaces-assessment notYet |
| Build or delete `messageReactions` (schema exists, zero references anywhere) | Message thread | None | 0.5d to decide | next-surfaces-assessment notYet |
| My week: real week dates and multi-day allocation across days | `/tasks` | Design first | 3d | TP.3, MVP B1 |
| Fix the Kanban drop target lighting the dragged card's own column | `/requests` and `/tasks` boards | Shared `KanbanBoard` | 0.25d | STATUS P3 |
| Unhide `/messages`: participant shape, auto-add team, org_channel provisioning, polling or SSE, message edit | `/messages` | Treat as its own slice, not a polish pass | 8d | next-surfaces-assessment notYet |
| Update `mobile.spec.ts` and `portal-flow.spec.ts`, which still assert a Messages tab | e2e | None | 0.25d | V1-QA.2 |
| Services order path: ordering mints a request or a Stripe checkout | `/services` | Liam decision; CT.11 scoping half shipped on migration 0097 | Remainder of 3d | CT.11 |
| Services plan-ladder rule: show what the client has, lower and higher plans, upsell only near limits | `/services` | Staged design at `.claude/qa/svclocal` plus `svc-ladder-patch.cjs` | 2d | MC.5, MVP B2, DL.3 |
| `/billing` in or out of the client nav, plus the silently failing Manage Billing popup | `/billing` | Liam decision | 0.5d | CT.16 |
| Stamp historical `time_entries` before the first non-dry hourly Xero export, or hours already invoiced bill twice | `/time` to Xero | IC.6 and CT.13 guard shipped, not yet run live | 0.5d | IC.8 |
| Resolve Physitrack's two Stripe customer ids after the merge | `/clients` billing data | Liam judgement | 0.25d | MC.10b |
| Port the studio invoices list, detail and chase drafter under Finance | `/invoices` | MR.6 critic found 2 blocking bugs, fixer running | 1d | MR.6, MVP B3 |
| Publish-before-share, so a share link cannot serve a row mid-edit | `/proposals` and `/schedules` share and email routes | None | 2d | T3.1, T3.2, S1 |
| Portal project card reads published schedules only (currently leaks the newest draft) | Client home | S1 first | 0.5d | T2.4 |
| Public viewer integrity: dark-slide text, localStorage bleed, 375px package tabs, gantt strip, `alert()`, OG tags | `app/p/proposal`, `app/p/schedule` | None | 3d | T3.4, T3.5, S3 |
| Persist the signed contract PDF to R2, add download and admin resend | `/contracts` | R2 | Inside S4 | T3.6 |
| Contract tamper anchor: hash `bodyHtml` into the chain, block body PATCH after draft, fix revoke on partial signature | Contract routes | Migration 0099 | Inside S4 | T3.7 |
| Contract viewer onto the deliverable kit plus a rotation-safe signature pad | `app/p/contract` | S3 and S4 merged first | 2.5d | T3.10, S5 |
| Sales artifact small-fix batch: contract search reads the dead legacy table, EmailShareModal preselect, uncompressed founders image, dead `/pipeline` hrefs, em dashes, expiresAt enforcement, house-rules test | Across sales artifacts | None | 1.25d | T3.9, S7 |
| T3 QA gate: Playwright for both round trips, then one live rehearsal with real inboxes | e2e | S1 to S5 merged and deployed | 1d plus rehearsal | T3.QA, S8 |
| Testimonial pipeline for real: working Send, correct review link, videoUrl and caseStudyInterest persisted, Approved Case Studies view | `/reviews` | None | 1d to delete the lies, 3d for the pipeline | CT.15, Decision #018 |
| `/reports` triage by deletion, plus the access scoping it never calls | `/reports` | None | 4d | CT.19 |
| Retainer and billing model: customMrr and billingModel editors, health filter, MRR forecast end dates, auto-churn, salary and rate fields, margin columns | `/financial-reports`, `/clients`, `/time` | S25 schema batch | n/s | T668-676 |
| Intelligence and analytics: BankRunwayCard statement rows, outstanding KPI dedup, revenue per head, client LTV, pipeline quality | `/financial-reports`, `/sales-analytics` | None stated | n/s | T707-715 |
| Revenue features: deal to invoice generation, pipeline invoice indicators, project calculator port, Xero payment webhook receiver | `/deals`, `/invoices` | None stated | n/s | T700-705 |
| Verify and close the cash-flow runway indicator, largely shipped | `/financial-reports` | None | 0.25d | T600 |
| Deal to client LTV link | `/deals`, `/clients` | Fold into T711-T713 | n/s | T571 |
| Run the tenancy-isolation e2e proof in CI, not just locally | CI and deploy workflow | Seeded D1 fixture, Clerk dev keys on the runner | n/s | STATUS tenancy proof, T1.5 |
| Deny-by-default: flip roleless-member and no-access-row defaults from admin and unrestricted to denied | All admin routes | Preserve super_admin bypass, MCP service token, crons and webhooks | 1d with T1.18 | T1.15, MVP C2 |
| Per-org scoping batch B: deals, conversations, calls, time entries, announcements | Admin routes for those five | T1.15 first; batch A (contracts, proposals, schedules) done | n/s | T1.16 |
| Hire onboarding path: Clerk webhook writes `teamMembers.clerkUserId`, verified-email backfill, invite route, gated write routes | `/team`, dashboard layout | T1.15 | n/s | T1.17 |
| Teammate invite link: `resolveToken` is a stub and `/welcome` hardcodes fake personalisation for every hire | `/welcome` | Lower priority than T1.17, which supersedes it | n/s | T1.20 |
| Nav gating for team members: `filterNav` ignores `adminOnly`, 6 nav items unmapped in FEATURE_RESOURCE, `/affiliates` has no tree node | Sidebar | T1.15 | Inside the 1d above | T1.18 |
| Teammate home scoping: leaks studio-wide discovery calls and all docs, and preview-as-teammate resolves to admin | `/overview` teammate variant | T1.15 | n/s | T1.19 |
| Enforce `feature_visibility` at the route level, not just in the nav | All portal and admin routes | None | n/s | T1.6 |
| Portal noindex and robots, plus WAF rate rules (60/min portal, 20/min uploads) or a KV limiter | Infra and middleware | None | 0.5d | T1.7, MVP C4 |
| Decide per-route on the 19 ungated portal account and onboarding routes | Portal API routes | Needs a per-route call, not a blanket rollout | n/s | next-surfaces-assessment notYet |
| Invited-client onboarding operable: Clerk webhook backfill for second-seat contacts, "invoice me" 402 strand, kickoff booking that actually books | Onboarding flow | Clerk webhook | 1d | T1.4, MVP A2 |
| Auth flow robustness: live forgot-password click-through, branded error and verification states at 375px, design-consistency pass | Auth shell | Live Clerk build | 1d | T1.3, T1.8, MVP A3 |
| Verify migration apply state on prod D1 (0081, 0082 and everything since, plus 0012 and 0060-0063) | D1 | None | 0.5d | T0.4, T594b |
| Widen the importer's `needsOrgList` so subset runs do not refuse, and drop the dead clients snapshot key | ManyRequests importer | None | 0.5d | MC.7, MVP A1 |
| One full live client lap on production, incognito, at 375px and dark: submit, reply both ways with email, approve, pay link, files | QA | A real client org or Giant Group onboarded | 0.75d | CT.10, T2.QA, A5 |
| Allow Giant Group in the email allowlist and send the invite | Client onboarding | Liam decision, still not yet as of 2026-09-12 | n/s | MC.4 |
| Split or hand-paste `sales-artifacts.jsx` (158KB) and `sales-artifacts.css` (127KB); the project holds truncated, broken copies today | Claude Design project | Split the files or paste via the Claude Design editor | n/s | DL.1 |
| Write `sales-pipeline.jsx` (122KB merge), the last of 10 consistency-pass files still pre-write | Claude Design project | Same write ceiling | n/s | DL.2 |
| Re-render and re-critique every staged design in the real shell after the writes land | QA | DL.1 to DL.3 | n/s | DL.4 |
| Files as a small Google Drive with threads: per-client folders, drag-drop upload, a comment thread per file, optional versions | `/files` | Design first | n/s | CL.1 |
| Daily briefing dedup: the home card and the nav-bar briefing do not overlap well, pick one source of truth | `/overview` | None | 1d | T2.7, MVP B4 |
| Portal write scoping confirmed by a real client session editing People and Organisation | Portal | A real client session | n/s | T1.14 |
| `{{requestNumber}}` email variable and `[REQ-n]` subject prefix, possibly already superseded | Request emails | Re-check against CT.4 and CT.F before treating as open | 0.25d | T662 |

---

## 4. Proposed order

Standing gate on every batch, from CLAUDE.md rule 8: `npm run type-check` zero errors, `npm run lint` zero errors, pushed and deployed green, live browser smoke of the golden path on the deployed URL, 375px with no horizontal scroll and touch targets at 44px or more, the page rendered with `.dark` and no contrast regression, and a screenshot or note in the commit body. Each batch below adds the specific smoke that proves it. Items inside a batch are separate worktrees and do not share files; where a seam exists it is called out on the line.

**Batch A. The doors a Giant Group user walks through.** A1 T1.4 invited-client onboarding operable (webhook backfill, 402 strand, kickoff booking). A2 T1.3 and T1.8 auth path robustness and branded error and verification states. A3 client home honesty, CT.3b empty-state flash plus V1-FIX.1 dead CTA plus T2.4 published-schedules-only (one worktree, they all touch the portal overview surface). A4 T1.5 tenancy-isolation spec into CI (no app files).
Acceptance: standing gate, plus an incognito lap on production where a brand new second-seat contact accepts an invite, lands on `/overview`, and sees no empty-state flash and no dead CTA; the isolation spec green in the pipeline, not just locally.

**Batch B. The money path a client touches.** B1 services plan ladder port (MR.7, MC.5, the staged `.claude/qa/svclocal` files). B2 `/billing` v3 lap plus the CT.16 nav decision plus the silent Manage Billing popup. B3 fresh critic pass and fix on the client invoices REDO, specifically Pay-now at 375px. B4 MR.6 studio invoices ported under Finance. B5 IC.8 time-entry backfill stamp before the first live hourly Xero export.
Seam: B1 and B3 come out of the same `portal-money.*` design file but land on different routes; split the port by route, not by design file.
Acceptance: standing gate, plus a real client paying a real invoice from a phone-width viewport, and a dry hourly Xero export that double-bills nothing.

**Batch C. Deliverable truth, before anything is sent to Giant Group.** C1 T3.1 and T3.2 publish-before-share. C2 T3.4 and T3.5 public viewer integrity (dark text, localStorage bleed, 375px package tabs, gantt strip, `alert()`, OG tags). C3 T3.3 accept, decline and question close the loop, with migration 0098. C4 T3.6 and T3.7 contract PDF to R2 and the tamper anchor, with migration 0099.
Seam: C3 and C4 both add a migration; number them 0098 and 0099 up front so the two worktrees never collide.
Acceptance: standing gate, plus a share link that 404s until Publish is clicked, a third package selectable at 375px, an accept that puts a bell and an email in front of Liam, and a signed contract whose PDF survives in R2.

**Batch D. Close the deliverable loop and prove it.** D1 T3.10 contract viewer onto the kit plus a rotation-safe signature pad (starts after C2 and C4 merge). D2 T3.9 small-fix batch across sales artifacts. D3 T3.QA Playwright for both round trips plus one live rehearsal with real inboxes. D4 CT.15, delete the lies on `/reviews` (Send, Copy link, orphaned outreach routes).
Acceptance: standing gate, plus share to publish to view at 375px to accept to admin notified, and send to sign to PDF in both inboxes, both green in Playwright and both rehearsed live once.

**Batch E. Messages, unhidden.** E1 the New-conversation participant shape and auto-adding the team to client-initiated threads. E2 org_channel provisioning rule plus polling or SSE. E3 T2.6 PageHeader and thread UX (needs a design file first, none exists for either audience). E4 CT.17 MCP `send_message` and `create_conversation` body shapes. E5 V1-QA.2 spec updates.
Acceptance: standing gate, plus a client sending a message from a phone and a Tahi reply landing in their thread and their inbox, with the `/overview` "Message the team" CTA alive again.

**Batch F. Studio daily driver and the permission floor.** F1 TP.3 My week real dates and multi-day allocation, plus the live smoke of the roughly 12 e2e-only behaviours. F2 GI.3 call link and purpose editable (detail fields, PATCH route, MCP `update_call`). F3 T1.15 and T1.18 deny-by-default plus nav gating. F4 T1.11 worker MCP `/authorize` hardening. F5 T1.7 portal noindex and WAF rate rules.
Seam: F3 touches `nav-model.tsx`; keep T2.7 briefing dedup out of this batch for that reason.
Acceptance: standing gate, plus a roleless member seeing nothing, a scoped hire seeing only their clients, super_admin and the MCP service token and the crons all still working, and a task spanning four days on My week.

**Batch G. Studio v3 ports, design-led.** G1 DL.1, split `sales-artifacts.jsx` and `.css` under the write ceiling and repair the truncated copies. G2 DL.2, write `sales-pipeline.jsx`. G3 AR.4 proposals editor redesign in Claude Design (including the wiring bug where every row opens the same hardcoded document). G4 AR.5 left-rail and headline-card consistency rules. G5 DL.4 re-render and re-critique everything in the real shell.
Ordering inside the batch: G1 and G2 unblock the rest; G5 is the gate on all of it.
Acceptance: standing gate, plus a critic pass that returns SHIP on the eight pages Pass 3 flagged for rail truncation, verified against the real shell and not against a disk mirror.

**Batch H. Studio ports that follow the re-critique.** H1 `ops.jsx` Time, Team and Tracks port (or CT.18 delete for Tracks). H2 `sales-pipeline` Leads, Calls and Deals port, plus T3.11. H3 `sales-artifacts` list ports (proposals, contracts, schedules, all three template pages). H4 `/capacity` port. H5 `/clients/contacts/[id]` and `/clients/brands/[id]`, which have no design at all.
Acceptance: standing gate on each ported page, plus a side-by-side screenshot against the approved design at 1440px and 375px.

**Batch I. Honesty and deletion.** I1 CT.19 `/reports` triage by deletion plus the access scoping it never calls. I2 CT.15 the real testimonial pipeline. I3 T3.8 and MC.6 deals nudges, remove or build, Liam's call. I4 wire or delete the client health scorer. I5 build or delete `messageReactions`, request steps and the revision counter, whichever way the decision goes.
Acceptance: standing gate, plus a scoped hire loading `/reports` and seeing only their own clients' numbers, and no button anywhere in these four surfaces that claims something the backend does not do.

**Batch J. Files, notifications and integrations depth.** J1 CL.1 files as a small Google Drive with threads, design first. J2 notification preferences, rich content, sidebar badges, quiet hours reader, weekly digest cron. J3 Slack notification wiring plus the T570 Zapier config surface. J4 T1.16 per-org scoping batch B (deals, conversations, calls, time entries, announcements). J5 T1.13 and the daily-summary and transcript cron UTC windows.
Acceptance: standing gate, plus a client uploading and commenting on a file from a phone, and a notification arriving through every enabled channel once and only once.

Everything not in a batch (GI.1 chat bot, GI.2 client-scoped MCP, N1 to N9 north-star phases, content-engine Slice 7 and 8, `/social`, `/sitemap`, `/affiliates` real data, T668-676, T700-715) stays parked until Batch J lands.

---

## 5. Already done tonight (2026-09-13), do not re-plan

- MC.9 applied on production and the residue sweep re-run clean, so the MVP plan's Batch C3 line is stale and already satisfied.
- Acme Corp hard deleted; the residue sweep plans zero.
- Sprint T3 re-verified against today's code on 2026-09-12; the build plan is written and parked, so S1 to S8 do not need re-scoping, only executing.
- Design write-back: 11 of 14 files written. DL.3 landed the invoices-studio shell wiring under Finance, the services plan ladder, the Stalled-as-a-flag rework and the archive scratch mounts. Three files remain over the write ceiling: `sales-artifacts.jsx` (158KB), `sales-artifacts.css` (127KB), `sales-pipeline.jsx` (122KB). That is Batch G, not a new discovery.
- ManyRequests importer is live; it is blocked only on the API token env var, not on code.
- `e2e/tenancy-isolation.spec.ts` passes 3 of 3 locally across two seeded orgs; only the CI wiring is still owed (Batch A4).
- Per-org scoping batch A is done for contracts, proposals and schedules including share, publish and email. Batch B is the remaining five entities.
- Granular permissions shipped: `feature_visibility` plus the FEATURE_TREE resolver, super_admin is Liam and Staci.
- Already ported and live, do not re-port: Tasks (2026-09-05), Clients list and detail (2026-09-06), invoice detail (T2.10), notifications page (AR.1), client home (PP.2), client requests, account (PP.4 and MR.2), permissions builder, settings shell, the 19 transactional email templates (EM.1).
- `/tasks/[id]` is a redirect shim now and the old 405 bug is fixed.
- Pre-call digest UTC window fix shipped; daily-summary and sync-drive-transcripts still carry the same bug (Batch J5).
- The hourly Xero export guard (IC.6 and CT.13) shipped but has never been run live, which is exactly why IC.8 sits in Batch B.
- In flight right now in this session, do not start a second worktree on any of these: the A4 isolation runner, the invoice notes fix, the pre-call timezone review, the S1 and S2 follow-ups, and the S3 test fixer.
