# tahi-dashboard - Active Task List

Last updated: 2026-08-18 (re-tiered to Liam's confidence order: security + auth foundation -> request platform -> sales artifacts)

**Active block: CLIENT-READY LAUNCH - replace ManyRequests.**

Liam's confidence tiers (stated 2026-08-18, supersede the earlier C1/C2/C3 ordering):
- **Tier 1 - Trust.** Design consistency; sign in / sign up / forgot password / invites completely handled and robust; impenetrable tenancy: a client can NEVER reach Tahi-internal data or another client's data; financial data visible only to admins of their own org.
- **Tier 2 - The working platform.** Once trustworthy: how easy is it for a client to make requests, contact us, see their tasks, see progress. Requests/tasks/messages polish. "Less focused on cash flow/receivables/runway, more on how this runs as a request platform for users, clients, and team members."
- **Tier 3 - Getting new clients.** Proposals, contracts, schedules money paths.

Read `STATUS.md` for the triage snapshot. Closed items live in `TASKS-ARCHIVE.md`.
Old C-sprint ids kept in parens for traceability.

Format:
- `[ ]` open, `[x]` shipped (move to TASKS-ARCHIVE.md once verified live)
- Initials + date on claim: `- [AGENT] YYYY-MM-DD`
- Tasks only flip to `[x]` after the Definition of Done in `CLAUDE.md` rule 8

---

## Sprint T0 - Ops (in flight)

- [x] T0.1 (C0.1) - Approve the stuck production deploys - Liam approved both runs 2026-08-18. Standing note: EVERY push to main waits on this manual gate.
- [ ] T0.2 (C0.2) - [QA] After deploy lands: fire sync-airwallex, verify get_bank_balances returns Airwallex wallet + yield:CUR rows matching the Airwallex UI. - [CLAUDE] 2026-08-18
- [ ] T0.3 (C0.3) - [Liam+BE] Refresh finance.yieldHoldings against the Airwallex UI (Xero suggests Yield USD 33,956.89 / AUD 638.80 vs setting's 20,014.13 / 531.51).
- [ ] T0.4 (C0.4) - [BE/Ops] Verify migration apply state on prod D1 (0081/0082 and everything since; list_migrations).

---

## Sprint T1 - Security & auth foundation (Tier 1, ~1.5 weeks)

Full auth + tenancy audit ran 2026-08-18 (423 routes). Verdict: the CLIENT-facing portal boundary is strong (38/38 portal routes scoped, no IDOR, no client-supplied-org trust, share tokens validated, resolver cannot promote a client). Breaches were unauthenticated side doors bypassing that boundary. Batch 1 fixed + committed (3 commits, 2026-08-18), pending deploy approval.

- [x] T1.1 (C2.1/B1) - [BE] **Uploads identity + cross-tenant write hole.** Fixed: files identity unified on D1 org id, serve/proxy authorize off the files row, confirm ignores non-admin body.orgId, admin override access-scoped, legacy dual-read. lib/upload-access.ts + 43 tests. - [BE] 2026-08-18
- [x] T1.2 (C2.2/B2) - [BE] **Notification identity.** Fixed: typed NotificationRecipient union resolved inside createNotifications; seven insert sites (audit found a 7th) rerouted; cron recipients tolerant-resolved so the invisible drift/summary alerts deliver again. +10 tests. - [BE] 2026-08-18
- [x] T1.9 (audit A1/B1/A5/A3/A4/A6/A9) - [BE] **Unauthenticated side doors closed.** /api/mcp POST now admin-gated (was open, proxied to admin API with the server token); leads draft-reply GET + rich health GET gated; Google OAuth state nonce (CSRF/takeover); /review allowlisted (broken funnel); authorizedParties prod-only; ended admin roles lose data scope. +15 tests. - [BE] 2026-08-18
- [x] T1.10 (audit B4) - [BE] **Portal financials gated to org admins.** invoices/subscription/billing-session/checkout now require an org admin (lib/portal-access.ts, primary-contact fallback so owners aren't locked out). Meets the "financial data only to admins of their own org" bar. - [BE] 2026-08-18
- [ ] T1.11 (audit A2) - [Liam+BE] **Worker MCP /authorize hardening (APPROVED, Liam will reconnect).** workers/mcp-server/src/index.ts:2675 auto-approves on client_id alone (not a secret) -> anyone can mint full admin. Require an authenticated Tahi session before minting a code, or drop authorization_code/none for client_credentials + secret. Deploys via mcp-worker-deploy.yml; Liam re-approves the connector once after.
- [ ] T1.12 (audit B2) - [Liam+BE] **Rotate the committed ManyRequests token - DEPRIORITISED 2026-08-18.** Liam: "a later problem tbh, since the goal here is to replace that." workers/mcp-server/src/index.ts:97 hardcodes a live token that is now in git history; treat as exposed. Revisit at ManyRequests cutover (the token dies with the platform), or sooner if the legacy data matters.

### Least-privilege for the first hire (ACTIVE 2026-08-18 - hire imminent, promoted from "defer")

Prod check before starting: Liam + Staci both hold super_admin role rows, so deny-by-default cannot lock them out. LANDMINE handled: Liam's own teamMemberAccess scope row is specific_clients (Giant Group only); he is unrestricted only because admin/super_admin role names bypass scope - that bypass must survive. Note isTahiAdmin() gates 506 admin routes on CLERK ORG MEMBERSHIP, not role, so containment needs BOTH the default flip and per-route scoping.

- [ ] T1.15 - [BE] **Deny by default.** lib/permissions.ts roleless member -> admin (the `else level='admin'`), and lib/access-scoping.ts no-team-member-row -> unrestricted. Flip both to deny, preserving: super_admin/admin role bypass, the 'api-service' MCP token, crons/webhooks, and a bootstrap fallback for an unseeded DB. - [BE] 2026-08-18 in progress
- [ ] T1.16 - [BE] **Per-org scoping rollout** (the old T717). Only 30 of 362 admin route files call a scoping helper. Batch A: contracts, proposals, schedules (incl. share/publish/email - a scoped member can currently mint public share tokens for clients they cannot see). Batch B: deals, conversations, calls, time-entries, announcements. - [BE] 2026-08-18 in progress
- [ ] T1.17 - [BE/FE] **Hire onboarding path.** CONFIRMED by audit: the only writer of teamMembers.clerkUserId is a hand-crafted PUT; no Clerk webhook, and accept-invite rejects flow:'team'. So today a hire invited to the Tahi Clerk org resolves to NO member row and gets FULL ADMIN (all financials); after T1.15 the same user is locked out of an empty dashboard. Building: verified-email backfill on the dashboard layout + POST /api/admin/team/[id]/invite (Clerk org invitation) + gate the team write routes + Linked/Not-linked column + honest invite copy + deal-sales-kit stops hardcoding Liam as contract signer. - [BE] 2026-08-18 in progress
- [ ] T1.18 - [FE/BE] **Nav gating is broken for team members** (do AFTER T1.15 lands; touches lib/permissions.ts). components/tahi/nav-model.tsx filterNav never reads item.adminOnly, so the flag is dead code on 20 nav items; FEATURE_RESOURCE has no mapping for billing/capacity/content_studio/social/reviews/announcements and /affiliates has no FEATURE_TREE node at all, so decideFeature returns true. A task_handler can SEE and OPEN Affiliates (commission payouts), Capacity (utilisation), Content studio, Social, Reviews, Announcements, Billing: those pages guard on Tahi-org membership only. Fix = honour adminOnly in filterNav + add the missing feature mappings + swap those six page guards to requirePageFeature.
- [ ] T1.19 - [FE] **Teammate home leaks + never visually verified.** teammate-home.tsx:~280 renders studio-wide discovery calls (every Tahi sales call) and ~640 renders all docs unscoped, on a page that is otherwise ~80% empty states with no explanation. Scope both, add "why is this empty" copy, then actually look at the page. Also overview-home.tsx:~100 - preview-as-teammate resolves /me routes to the signed-in admin, so Liam cannot sanity-check what the hire sees (accept ?asMember=<id> admin-only).
- [ ] T1.20 - [BE] **Teammate invite link is fully dead.** POST /api/admin/onboarding-invites supports flow:'team' but has zero callers; lib/onboarding-entry.ts resolveToken is a `return null` stub; /welcome hardcodes role "New teammate", gear "MacBook Pro 16", buddy "Liam Miller" for every hire (SPECS/redesign/03-team-onboarding.md flags these as seams). Either implement resolveToken against onboardingInvites and feed the welcome context, or drop the fake personalisation. Lower priority than T1.17 (the Clerk-invite path supersedes the token flow for hires).
- [ ] T1.13 (audit finding) - [Ops] **Fix the GH Actions crons.** Agent flagged TAHI_DASHBOARD_URL repo variable still points at the retired webflow.io host (404s), and cron paths aren't allowlisted while workflows send x-cron-secret not Bearer. VERIFY FIRST: sync-airwallex fired fine on 2026-08-18 and bank data refreshed, which contradicts a fully-broken cron path - check whether "Dashboard cron triggers" and dashboard-crons.yml differ, then fix the repo variable + switch workflows to Authorization: Bearer $TAHI_CRON_SECRET (already accepted by assertCronAuth).
- [ ] T1.14 (audit, defer to T1.4 sprint) - [BE] Write-path portalRole gap: portal brands/organisation/people/change-request use the same primary-contact-not-admin assumption; a fresh owner can't invite teammates or edit org settings until portalRole is set. Fold into onboarding work.
- [ ] T1.3 - [QA/BE] **Auth flow robustness.** Sign in / sign up / forgot password verified reachable + correct in code (audit confirmed Clerk catch-all routing, reset path not hidden, invite tokens 192-bit single-use atomic, entitlement not self-grantable, Ship Studio backdoor prod-gated). REMAINING: one manual click-through of forgot-password on the live Clerk build; branded error/verification states at 375px.
- [ ] T1.4 (C2.5/B5) - [BE/FE] **Invited-client onboarding operable** (this IS the client sign-up path): invite-mint panel on client detail + MCP create_client_invite; Clerk webhook (svix) backfills contacts.clerkUserId (second-seat teammates stuck at the gate forever today); portal/invites inserts pending contact rows; "invoice me" records preference + entitles instead of 402-stranding; kickoff booking step actually books the slot.
- [ ] T1.5 (C4.1) - [QA] **Cross-org isolation proof.** Playwright e2e: seed two orgs, verify A cannot fetch B across requests/files/conversations/invoices/contracts/calls; plus an adversarial IDOR pass over portal/public/uploads routes. Financial endpoints unreachable by clients, verified.
- [ ] T1.6 - [BE] **Permissions invariant enforcement.** Client feature_visibility denies are nav-cosmetic only; enforce at route level so denied = 403, not just hidden (memory/project_permissions_vision: visible = permitted, absent = denied).
- [ ] T1.7 (C4.3/C4.4) - [Ops/BE] Portal noindex + robots; WAF rate rules (60/min /api/portal/*, 20/min /api/uploads/*) or KV limiter.
- [ ] T1.8 - [UIUX] Design-consistency pass on the auth-adjacent path: forgot-password + error + verification states match the v3 auth shell; onboarding screens consistent.

---

## Shipped 2026-08-18 (session 2) - pushed to main + staging, live-QA'd on staging

- [x] V1 - Hide Messages entirely (nav removed both audiences, /messages redirects, code kept). Live-verified: gone from admin + client nav; /messages -> /overview. - 2026-08-18
- [x] T1.18 - Team-member nav + page gating made real (adminOnly honoured, 6 leaky features mapped + guarded). - 2026-08-18
- [x] T1.19 - Teammate-home calls feed org-scoped; docs card relabelled; duplicate super-admin email allowlists deleted (now server isSuperAdmin, live-verified Liam still sees Client view/Private mode). - 2026-08-18
- [x] T2.5 (tasks) - Tasks correctness + My Work: data-contract bugs fixed (subtasks, blocked-by, progress, timer), dead detail page revived + deep-linkable, editable Status/Priority/Due/Assignee, My Work default. Live-verified on staging (My Work empty state, All tasks list, editable slide-over, Start timer). - 2026-08-18
- [x] Requests correctness + privacy - scope-flag leak closed (detail + list + steps projections), Export CSV admin-gated, per-org numbering, client message identity, client file upload, Bulk Assign sets assigneeId, request->task requestId + Tasks panel, client Approve/Request-change on client_review (new portal PATCH whitelist). Admin side live-verified; client-portal privacy test-covered. - 2026-08-18

### Follow-ups found during live staging QA (2026-08-18)

- [ ] V1-FIX.1 - [FE] Client home "Message the team" CTA (components/tahi/overview/homes/client-home.tsx) now dead-ends since messaging is hidden - remove it or repoint to the request thread. Also audit remaining /messages links (clients/[id], settings/plan.tsx, notification-links message deep-link) - they redirect gracefully but should be cleaned for V1.
- [ ] V1-QA.1 - [QA] Live-verify the client request DETAIL as a client: scope-flag pill absent, own messages show the client's name, Approve/Request-change banner on a client_review request. Needs a client-visible (non-internal) request in an impersonated org; set one to client_review first. Row-filtering confirmed unchanged in code; this is the last unverified client-facing piece.
- [ ] V1-QA.2 - [QA] e2e specs (mobile.spec.ts, portal-flow.spec.ts) assert a Messages tab and will fail - update them for the V1 hide.

## Sprint T2 - The request platform (Tier 2, ~1.5 weeks)

- [x] T2.1 (C2.3/B3) - [BE/FE] **Portal invoice detail + real Pay.** Shipped 2026-09-05 in the Tier 1 cutover (billing slice, plan `docs/superpowers/plans/2026-09-05-cutover-tier1.md`): portal list and detail routes, hosted pay URL persisted at creation and on send, Pay now on the client page; verified live as an impersonated client. Original scope: GET /api/portal/invoices/[id]; detail page branches SWR on isAdmin (always 403s clients today); hosted_invoice_url column persisted from stripe-create + webhook; real Pay link with billing-portal session fallback.
- [x] T2.2 (C2.4/B4) - [FE] **Nav truth + files.** Shipped 2026-09-05 (client surfaces slice): dead nav removed, /files wired to the portal files API with upload, kickoff booking writes a call; client preview fixes in 0dfc06df and 35f95ac1; verified live. Original scope: CLIENT_NAV: remove or make real Schedule/Contracts/Proposals (see T2.3); /files renders /api/portal/files (hardcoded "No files yet" stub today, client-only page); Book-a-call CTAs -> booking-widget (loop to /overview today); add Billing to CLIENT_NAV.
- [x] T2.3 (C2.6) - Decided 2026-09-05 (cutover plan Decision 4): the nav items are removed for clients; contracts, proposals and schedules portal pages are Tier 3.
- [ ] T2.4 (C2.7) - [BE] Portal project card reads published schedules only (newest-draft leak today).
- [x] T2.5 (C3.5a) - [FE] **Tasks polish**, delivered as the full Tasks page port. DoD closed by the lead 2026-09-05: build green on the merged tree, deployed 7958afc1, live smoke on production as Liam (quick add with a client mention, date and priority; row to slide-over with `?task=`; level change clearing the client on the server; `/tasks/<id>` redirect; board composers; header menu). Not exercised live (covered by `e2e/tasks.spec.ts` locally): bulk complete, promote, timer, AI wizard, Save as default across a reload, CSV, board and My week drags. Delivered as (2026-09-05, plan `docs/superpowers/plans/2026-09-05-tasks-page-port.md`, slices 1-7). `tasks-content.tsx` replaced wholesale by the approved prototype rebuilt on the Requests primitives: PageHeader, three peer views (List, Board, My week) in the generalised `components/tahi/rail/` frame, every hand-rolled modal now a SlideOver or ConfirmDialog, quick add with `@Client` / date / `!priority` parsing, task templates, dependencies (add AND remove, which the legacy page never had), the AI wizard, bulk actions, timers, Export CSV. `GET /api/admin/tasks/[id]` exists and `/tasks/<id>` redirects to `/tasks?task=<id>`, so notification links and old bookmarks land on the slide-over. Migration 0087 adds `tasks.estimated_hours` plus the assignee and due indexes. Scoped team members now see `org_id IS NULL` tasks (Decision 14). Happy path in `e2e/tasks.spec.ts` on both projects.
  - **The client task view was not verified, because there is no longer one to verify** (Decision 1): tasks are the studio's own list, `lib/feature-tree.ts` scopes them to `['team']`, every task API is `isTahiAdmin`-gated, and `/tasks` now redirects a client org to `/overview`. The legacy page's `!isAdmin` branches were unreachable and were deleted rather than ported.
  - **Deliberately not ported, so nobody hunts for it:** the prototype's **Activity card** (there is no per-task event stream in the schema and `lib/audit.ts` records no task edits; building one is a table plus a write on every mutation), the **delivery-phase selector** (`tasks.scheduleRowId` stays readable and writable through PATCH and is linked from the schedule detail's Linked work section, which is where that link is made today), and the **teammate subtitle variant** (no audience switch on this surface).
  - **Still orphaned on purpose:** `tasks.trackId` and `tasks.position`. Nothing on this surface reorders a task within a track, so a board drop writes the status and drops the index. Inventing track ordering is a feature, not a port.
  - **Inherited limitation:** the saved default is browser-local, the same as the Requests rail. Making it follow the user means persisting the snapshot against a settings key, for both surfaces at once.
  - **Residuals:** a card in the same column as the dragged card still lights as a drop target inside `KanbanBoard` (cosmetic, shared with the Requests board); the subtask remove button in the list exists only when the shell passes `onRemoveSubtask`, which it does.
  - **Still open, which is why this line is `[ ]` and not `[x]`:** CLAUDE.md rule 8 checks 4 to 7. `npm run build` has not been run against the merged tree, Slice 7 is not pushed or deployed, and the plan's Slice 6 smoke list still has roughly a dozen unticked boxes: bulk complete, promote, the timer, an AI wizard run, Save as default across a reload, the CSV download, the board drag, the My week drag, the filter chip, the client-org redirect, and dark mode across all three views. `e2e/tasks.spec.ts` now covers eight of those against the local harness, which is evidence but not the live smoke the Definition of Done asks for. Flip this to `[x]` after the lead's post-merge smoke on the deployed URL.
- [ ] T2.6 (C3.5b) - [FE] **Messages polish.** PageHeader instead of bespoke h1; thread UX pass; client-visible partials brought to v3.
- [ ] T2.7 - [FE/BE] **Daily-briefing dedup** (Liam 2026-08-18): the home-page brief card and the nav-bar briefing are two surfaces that don't overlap well. One source of truth, one refresh cycle, consistent content; nav popover summarises, home card expands.
- [ ] T2.8 (C3.1) - [FE] /services v3 lap (client catalogue; worst legacy page, zero primitives).
- [ ] T2.9 (C3.2) - [FE] /billing v3 lap (3 raw tables, client-reachable).
- [ ] T2.10 (C3.3) - [FE] /invoices/[id] v3 lap (pairs with T2.1).
- [ ] T2.QA (C4.2) - [QA] **Full live client-session lap on prod** as a real client org at 375px + dark: every nav item, file download, invoice pay, request thread round-trip. Never been done.

---

## Sprint T3 - Sales artifacts (Tier 3, ~1 week)

- [ ] T3.1 (C1.1) - [BE] Publish-before-share, proposals + schedules: share POST snapshots; email POST rejects unpublished; revoke clears snapshot. (Standard journey serves LIVE rows today.)
- [ ] T3.2 (C1.2) - [FE] Proposal Publish button resurrection (mutate() after every patch/move/delete; dies after first publish today).
- [ ] T3.3 (C1.3) - [BE] Close the accept/sign loop: notifications row + Resend email to Liam + deal activity (+ optional stage bump) on proposal accept/decline/question and every contract signature. All silent today.
- [ ] T3.4 (C1.4) - [FE] Deliverable kit theme integrity: consume --page-chrome-text (invisible dark-slide text in both viewers); app/p/layout.tsx pins light tokens (viewer's dark localStorage corrupts public docs); hide unwired slide-theme options.
- [ ] T3.5 (C1.5) - [FE] Mobile money path: VariantTabStrip overflow (375px third package unreachable); gantt narrow-mode card stack; contract canvas rotation.
- [ ] T3.6 (C1.6) - [BE] Contract artifact persistence: signed PDF to R2 signedStorageKey + download button + admin resend action.
- [ ] T3.7 (C1.7) - [BE] Contract tamper anchor: hash bodyHtml into chain; block body PATCH after draft; fix revoke-resets-partially-signed.
- [ ] T3.8 (C1.8) - [FE/BE] Deals honesty: remove or implement scheduled + auto nudges; no fake 'sent' without RESEND_API_KEY; dialog error surfacing.
- [ ] T3.9 (C1.9) - [FE] Small-fix batch: alert()->toast; EmailShareModal preselect; founders image compress; public tab titles + OG; em-dash metadata; /pipeline hrefs; accept validates against snapshot; expiresAt enforcement; client-detail ContractsTab data shape; save-as-template 400; search reads contract_documents.
- [ ] T3.10 (C3.4) - [FE] /p/contract viewer onto the deliverable kit (only public viewer off-kit).
- [ ] T3.11 (C3.6) - [FE] Deals v3 lap (internal; 2-3 day composition swap; can slide).
- [ ] T3.QA (C1.QA) - [QA] Playwright: share->publish->view 375px->accept->admin notified; send->sign->PDF both inboxes. Then one live round-trip with a personal email before the first real client send.

---

## Post-launch backlog (team/owner side - work AFTER cutover)

### Notifications overhaul remainder (was T682-T699)
T1.2 fixes identity; the rest (preferences page S23/T682-3, rich content T684-5, SSE hook T687, email dispatcher T688-690, /notifications page T691-2, sidebar badges T693, Web Push T694-697 + W-PUSH, weekly digest T698-9) stays post-launch.

### Retainer & billing model (T668-T676)
customMrr/billingModel editors, retainer health filter, MRR forecast end-date awareness, auto-churn, team salary/rate fields, time cost/revenue/margin columns. Needs S25.

### Comments & messages polish (T677-T681)
Comment lock on delivered/closed (S24), message edit/delete with permissions, edited/removed indicators.

### Revenue features (T700-T705)
Deal -> invoice generation, pipeline invoice indicators, project calculator port, Xero payment webhook receiver.

### Intelligence & analytics (T707-T715)
BankRunwayCard statement rows, outstanding KPI dedup (T708), revenue per head, client LTV, pipeline quality.

### Schema batch (S23-S25)
notificationPreferences, commentsLocked, xero_category_overrides + salary columns + billingModel columns.

### Content engine ops (Phase I residue)
Verify migrations 0060-0063 applied to prod; PI-S1/S2/S5/S6.5 live QA passes; Slice 7 signal expansion, Slice 8 citation tracker (deferred).

### Carry-overs
- [ ] T568 - Google Calendar booking links for scheduled calls (verify vs booking-widget; likely close)
- [ ] T570 - Zapier outgoing webhooks (engine shipped in W-2; needs config surface)
- [ ] T571 - Deal-to-Client LTV link (fold into T711-T713)
- [ ] T594b - Verify migration 0012 applied to prod (with T0.4)
- [ ] T600 - Cash flow runway indicator (largely shipped; verify then close)
- [ ] T618 - Worker MCP finance tools (verify coverage)
- [ ] T662 - {{requestNumber}} email variable + [REQ-n] subject prefix
- [ ] T667 - Xero category overrides (needs S25)
- [ ] T716 - Email-to-Request intake (verify state since 2026-07-07; finish or park)
- [ ] W-QA - Live smoke of Wave 1-4 features (automation fire, webhook delivery, announcement fan-out, portal Org/Brand/People, AI weaves)
- [ ] LIT-BOOKS.UIUX / LIT-BOOKS.QA - overview BOOKS cards review + live smoke

### North-star phases (queued, unchanged)
N1 discovery workflow, N2 auto-onboarding, N3 portal tour, N4 permission roles content, N5 Mailerlite CRM, N6 affiliates, N7 schedule->tasks bridge, N8 hourly billing tracker, N9 dashboard-wide premium pass. See memory/project_phase_roadmap.md.

---

## Superseded framing (for the record)

- The "trust-crossover order" (memory/project_trust_state_2026_05.md) is superseded by the tiers above.
- The finance-first emphasis of earlier sprints is superseded: Liam is "less focused on cash flow / receivables / runway, more on how this runs as a request platform" (2026-08-18). Finance surfaces stay maintained but get no new investment until post-cutover.
