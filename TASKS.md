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

## Sprint T2.5 - Client truth and delivery (from the 2026-09-06 next-surfaces sweep)

Source: `docs/superpowers/audits/2026-09-06-next-surfaces-assessment.json` (five readers plus a ranker, verified against 2b1a05b5). Ranked by what a migrated client hits in week one, then what Liam and Staci touch daily, then effort. The standalone /messages page stays hidden: the request thread is the client channel and its gap is delivery, not UI.

- [x] CT.1 - [BE] Internal request titles leaked into client bells: `emitRequestStatusChanged` now carries `isInternal` and skips the client fan-out (a9e44f43, f7e5de41). Four tests.
- [x] CT.2 (0.5d) - [BE] Shipped 8b93ecf6 (ct/delivery): portal submit notifies every Tahi admin with the per-org number; single assign, participants and bulk-assign notify the incoming team member (never yourself, never a contact). Tests on the fake-D1 harness. Original scope: a client-submitted request notified nobody at Tahi (`app/api/portal/requests/route.ts` POST ends at dispatchDomainEvent). notifyAllAdmins with `request_created` and the per-org number. Fold in: single assign, bulk assign and participants routes notify nobody; POST /api/admin/tasks does not notify.
- [x] CT.3 (0.5d) - [FE] Shipped 8b93ecf6 (ct/home-truth). QA probe as an impersonated client with a delivered request: hero reads 0 with "Nothing waiting on you"; with a client_review request: hero 1 with the title, vital "Waiting on you 1 delivery to approve", Needs you "1 ready for your review" with Review. Pay opens the pay link, rows land on their item, queue controls always visible. Original scope: client home truth pass: `REVIEW_SET` includes `delivered` so approving makes "ready for your review" go up (client-home.tsx:223); the Pay button ignores `payUrl`; Recent requests and Recent files rows link to lists; the queue controls are 22px hover-only (overview.css:99-101).
- [x] CT.F (follow-ups) - Shipped 67f4464e (ct/delivery-followups, ct/surface-followups) plus the lead's copy and cache edits: plain-text email part, one From address through RESEND_FROM_EMAIL, bulk status moves email nobody (bell only), brand audience on both status doors, request_assigned as its own event with a settings toggle, the portal thread resolves the studio once, portal submits carry the submitter's brand, replies-waiting reads per request and links to the request, teammate and owner homes say "Client replies waiting", invoice detail and portal invoices carry an honest member state and a code, schedule share writes the first published snapshot, task notifications tightened (from-template notifies, bulk batched, self-assign parity). Left open: a per-org digest for bulk status emails; lib/contract-fully-signed-emails.ts still hardcodes its From; the duplicate request_thread rows in D1 (count query in the wave 2 report).
- [ ] CT.3b (0.25d) - [FE] Client home renders its empty-state copy ("No requests yet", "Nothing waiting on you", 0 open) while the portal fetches are still in flight, because the cards treat undefined data as empty. Found by the lead's QA probe 2026-09-06 (the home switches from the admin shell to ClientHome after mount, then fetches). Show skeletons until the first response lands.
- [x] CT.4 (2.5d) - [BE/FE] Shipped 8b93ecf6 (ct/delivery): lib/notification-email.ts, one call site through createNotifications, four events (studio reply to client, client_review and delivered to client, request_created to studio, client reply to studio), [REQ-n] subjects, unlinked contacts now reachable by email. Needs RESEND_FROM_EMAIL as a branded lockup and a verified sending domain (Liam). Not yet exercised against a real inbox. Original scope: notification email dispatcher for exactly three events: studio reply to the client on a non-internal message, `client_review` and `delivered` to the client, `request_created` to the studio; `[REQ-n]` subject prefix; real call-to-action copy. Depends on RESEND_FROM_EMAIL and the sending domain on the prod worker, migration 0081 applied, one Clerk-linked client contact. Zero email leaves the platform today for any message or status change; four finished templates have no importers.
- [x] CT.5 (0.5d) - [FE] Shipped 8b93ecf6 (ct/dead-pointers); QA probe of the owner home finds no link or card pointing at /messages. Route halves (replies-waiting, me, teammate-home) in the follow-ups run. Original scope: dead pointers at the hidden /messages: owner-home "Unread messages" card, client-detail Start DM and Messages tab, the team map in lib/notification-links.ts:90.
- [x] CT.6 (0.5d) - [FE] Shipped 8b93ecf6 (ct/invoice-seats): portalRole-aware client nav and an honest member state on the invoice list; the invoice detail and the route code field are in the follow-ups run. Original scope: non-admin client seats dead-ended on Invoices with "Failed to load invoices": portalRole-aware nav plus an honest empty state.
- [x] CT.7 (0.25d) - [BE] Shipped 8b93ecf6 (ct/project-card): published rows only, phases from the published snapshot, tested. Original scope: portal project card read draft schedules (`app/api/portal/project/route.ts:90-101`, no status filter): the old T2.4.
- [x] CT.8 (1.5d) - [BE/FE] Shipped 8b93ecf6 (ct/thread-and-reads): portal thread returns per-message files (org-scoped, non-internal only), deletedAt filtered on both sides, conversationId hydrated so no more duplicate shadow conversations (existing strays left, count query in the fix report), client mentions deferred (own slice). Original scope: finish the request thread: portal per-message attachments, soft-deleted messages filtered on both sides, the duplicate shadow conversation minted on every admin page load (request-detail.tsx:557), client mentions.
- [x] CT.9 (0.75d) - [BE/FE] Shipped 8b93ecf6 (ct/thread-and-reads): POST /api/portal/requests/[id]/reads, "Seen by" on the thread header for the studio, PATCH /api/notifications marks a request's rows read on open and the bell clears itself, unreadCount from its own query. Original scope: client read state (a portal reads route) and a bell that clears when the request is opened; unread count over more than the first 20 rows.
- [ ] CT.10 (0.75d) - [QA] One full live client lap on production at 375px and dark: submit, reply both ways with email, approve, pay link, files.
- [ ] CT.11 (3d) - [BE/FE] /services: the portal catalogue is unscoped (every client sees every client's custom retainer names and prices once ManyRequests' services are imported); scope per org, then an order path. Liam decides whether ordering mints a request or a Stripe checkout.
- [ ] CT.12 (1d) - [BE/FE] /time silently discards the hourly rate you type (`app/api/admin/time/route.ts` never reads hourlyRate; the time-entries route does); unify the two routes, show a Rate column.
- [ ] CT.13 (1.5d) - [BE] Guard the hourly-to-invoice Xero export: idempotency, billingModel filter, no silent zero-rate skip.
- [ ] CT.14 (2.5d) - [BE/FE] Invoice numbering (real `invoices.number`, prefix from settings) then the /invoices/[id] v3 lap.
- [ ] CT.15 (1d) - [FE] /reviews: the Send button sends nothing, Copy review link 404s (`/review?token=` vs `/review/[token]`); delete or fix, and the orphaned outreach routes.
- [ ] CT.16 (1d) - [Liam decision + FE] /billing in or out of the client nav; its Manage Billing popup fails silently.
- [ ] CT.17 (0.5d) - [BE] The MCP `send_message` and `create_conversation` tools post the wrong body shape and always fail; fix or delete.
- [ ] CT.18 (0.25d) - [Liam decision] Delete /tracks (linked from nowhere, HTML5-drag only; the client home's TrackBoard tells the same story with buttons).
- [ ] CT.19 (4d) - [FE] /reports triage by deletion: six sections duplicate /sales-analytics, five duplicate /financial-reports, a second commitments editor has already diverged.

Not yet (from the same sweep): the standalone /messages surface (8d), the T3 sales artifacts, the testimonial pipeline, automated health scoring (scorer exists, zero callers), the /notifications page and Slack and digests, request steps and client checklists (documented, not built), file-level proofing (ManyRequests has none either), ratings and NPS, a persisted per-request activity log.

## Invoicing channel: Stripe or Xero per client (assessment 2026-09-06)

Source: `docs/superpowers/audits/2026-09-06-invoice-channel-assessment.json`. Verdict: not handled today. The Stripe-or-Xero choice is made per invoice by a picker that resets to "Dashboard only" every time; nothing on the client says how they bill; the Xero rail pushes DRAFTs only, never captures Xero's online invoice URL, so a Xero client has nothing to click; no bank details exist anywhere to show instead.

- [x] IC.1 (0.5d) - [BE/FE] Money-path truth fixes, no schema (ebdfccd0: GET selects source + stripeHostedInvoiceUrl, shared SourceBadge, admin-only Client pay page link; PATCH accepts paidAt/sentAt normalised to UTC ISO, stamps on the paid/sent transitions, nulls paidAt only when payment is unwound, write-off keeps it, paid-with-null 400s; 15 + 4 tests; MCP update_invoice carries paidAt/sentAt/notes and drops the ignored amount). Live smoke on production 2026-09-05: GET carries source + stripeHostedInvoiceUrl; PATCH paid stamped paidAt 09:07:39Z, PATCH sent nulled it, paidAt '42' answered 400 'paidAt must be an ISO date string or null'. Was: GET /api/admin/invoices/[id] omits `source` and `stripeHostedInvoiceUrl` so the admin detail always reads Source: Manual; PATCH drops `paidAt` and `sentAt` so a hand mark-paid leaves paid_at NULL and /financial-reports (keyed on paidAt) under-reports revenue. Building now.
- [x] IC.2 (1.25d) - [BE/FE] `organisations.invoiceChannel` (stripe | xero, NULL = studio default; two channels per Liam) plus editable `paymentTerms` on the client detail Organisation details card, PATCH allowlist with 400 sentences, GET returns effectiveInvoiceChannel, settings key invoicing.defaultChannel with a Default invoicing channel select in Studio details, lib/invoice-channel.ts, MCP update_client gains both (9ec99900; migration 0089 applied to staging + prod by wrangler before the deploy). Live smoke on production 2026-09-05: /api/admin/clients 200 (28 orgs), test client PATCH xero + net_14 read back with effective xero, 'xero_bank' answered 400, settings default reads stripe. Test client left on xero / net_14 for the Xero pay-path smoke.
- [x] IC.3 (0.75d) - [FE] New Invoice defaults destination, currency AND due date (payment terms) from the client, notes 'Defaults from <client>: Xero, Net 14, USD.', amber warning on a rail override, destination chips are a SegmentedControl radiogroup with focus rings (55d75a04, lib/invoice-defaults.ts + 20 tests). Live smoke on production 2026-09-05: picking Tahi Test Client flipped the picker to Xero draft, due date to 2026-09-19 (today + net 14), currency to USD, note rendered. The 'client list shows the channel' clause is deferred to the Clients redesign port (the detail card already shows it since IC.2).
- [~] IC.4 (1.5d) - Xero pay path, split. IC.4a DONE 9b6b2c60 + d618f080: invoices.xeroOnlineInvoiceUrl (migration 0091 on both D1s), the syncs capture Xero's OnlineInvoiceUrl once an invoice is approved (cap 25 per run, rotating window, cleared when Xero stops serving it), push stays DRAFT per Liam, a dashboard mark-paid pushes back to the rail (Xero payment against invoicing.xeroPaymentAccountCode after a status re-read, Stripe paid out of band, idempotent on a real transition into paid, outcome returned and recorded), settings keys invoicing.bankDetails / xeroPaymentAccountCode / xeroEmailMode validated, admin GET carries the link, 33 tests. Live smoke 2026-09-06: PATCH paid then sent on the manual test invoice answered 200 with no pushback (no rail), as designed. IC.4b DONE 10fbd6e9 (studio side): admin invoice detail shows the Stripe and Xero pay pages and reads the pushback outcome into a persistent sentence; Studio details gains a Getting paid group (bank name, account name, account number, reference hint, Xero payment account code, Xero invoice emails as a three-way choice) with aria-describedby help; the invoice sent and overdue emails render Pay now or a How to pay block (two new preview variants: invoice-sent-bank, invoice-overdue-bank); the portal invoice projections fold Stripe hosted or Xero online links into payUrl and add howToPay (bank facts, invoice number as reference, amount, due) only for unsettled Xero-rail bills without a link, with a whole-key no-leak test; the send route honours invoicing.xeroEmailMode (dashboard, xero with a Xero-side SentToContact guard and a draft fallback, both) and reports it; 44 + 129 tests. Live smoke on production 2026-09-06 02:25 NZST: /settings?section=studio shows the full Getting paid group and help copy. The portal invoice UI (Pay now button for Xero links, the How to pay block) lands with the portal redesign port.
- [x] IC.5 (1d) - [BE] lib/xero-status.ts is the one mapper (SUBMITTED and AUTHORISED = sent, VOIDED = written_off, DELETED skipped on create and unlinked on known rows), reconcile is FORWARD-ONLY (a mapped draft or sent never demotes viewed/overdue/paid), paid_at unwinds only on IC.1's set, syncXeroPayments pages 100 at a time with a 50-page ceiling and surfaces truncation, importers and the webhook update known Xero rows by diff and skip non-Xero rows, sentAt stamped on first promotion, MCP descriptions updated (55d75a04, 43 new tests). Live proof comes from the hourly Xero cron: check the next sync-xero run's steps carry ok with no warning.
- [ ] IC.6 = CT.13 (1.5d) - [BE] Guard the hourly Xero export (idempotency, billing-model filter, currency, no silent zero-rate skip).
- [ ] IC.7 = CT.14 (2.5d) - [BE/FE] Real invoice numbers from the settings prefix (zero readers today), unique, mirrored to Xero or from it (decision), the bank reference.

Decisions only Liam can make: ANSWERED.

**Liam's answers (2026-09-06):**
- Push as DRAFT for now; add a studio setting later to flip to auto-approve once the system is trusted.
- Two channels only: `stripe` and `xero` (not three). Xero carries its own pay-now link (Xero's OnlineInvoiceUrl / the Stripe card link Xero surfaces), which is NOT tied to branding themes, so stop the currency-in-theme-name matching and read the pay link straight off the invoice.
- Invoice number: Tahi's own sequence pushed into Xero (we control it; CT.14 already wants a real number). Both would be unique; he does not mind, so use ours.
- A hand mark-paid from the dashboard pushes the payment back to the rail (mark paid in Xero, void the open Stripe invoice).
- Xero-rail email: both, behind a studio toggle (send our template with the portal link, let Xero send its PDF, or both).
- Backfill channel per client BY HAND, not by rule. Liam: most orgs in the client book are dummy, so only the handful of real clients need a value; the rest stay unset (NULL falls back to the studio default and nothing bills).
- The client sees only what they need to act: for a Xero invoice, a How to pay block (amount, due date, invoice number as reference, and the pay-now link when present). No internal channel label.


## Tasks and requests polish (Liam, 2026-09-06 evening)

- [~] TP.1 - DROPPED 2026-09-05. Liam changed his mind on the AI first-start bar ("get rid of the task suggestion field"); replaced by TP.5 predictive autofill.
- [x] TP.2 - [FE] Removed the My week rail note ("My week always shows your own open plate..."), 7ffa602a. The inert filter controls already say it.
- [ ] TP.3 - [Design first, then FE/BE] **My week: real week dates + multi-day allocation.** The planner shows the open task list against the actual dates of the week, and a long or big task or request can be placed into MULTIPLE days (spanned across the days it will take), not just dropped on one due date. Needs a design and probably a schema decision (a per-day allocation, distinct from the single due date). This extends the shipped My week strip.
- [ ] TP.4 - [Design first, then FE] **Notifications page (not urgent).** An All notifications and Past notifications page: the full history behind the bell, simple list with read state. Design in Claude Design first. Low priority.
- [x] TP.5 - [BE/FE] **Predictive autofill on request and task creation.** Liam (2026-09-05): "if a request or task entry is empty, it should auto suggest due dates if there is context enough and priorities etc." SHIPPED 07b9f42f (spec docs/superpowers/specs/2026-09-05-predictive-autofill.md): POST /api/admin/ai/predict-fields (Haiku, grounded on the client's 180-day cohort with studio fallback, 0.6 threshold, hard validation, heuristics when degraded, cost and rate caps), lib/predict/*, SuggestedField + useFieldPredictions on the admin New Request and New Task dialogs (touched tracking, operator > template > AI draft > prediction, one aria-live sentence per batch, Clear suggestions), the +7 due date prefill removed, legacy request dialog deleted, MCP predict_entry_fields, migration 0090 indexes on both D1s, 26 route tests + lib tests, e2e/requests-dialog.spec.ts (8 passed on QA). Live smoke on production 2026-09-06 01:30 NZST: a checkout-crash title for the test client returned priority high (0.9), size small (0.7), due date +3 days (0.6) with reasons in 3.5s; 'Fix it' returned thin_context with no model call.
- [x] TP.6 - [FE] **Mobile top bar declutter.** Liam (2026-09-05): "mobile nav bar top works, right now it's too crowded." SHIPPED 5dfb08cb: below md the bar is brand mark, page name (ellipsis, never wraps), search, bell, and one More button (your account and tools) that opens a bottom sheet reusing the shell's sheet chrome: Track time (inline panel, 2.75rem controls, running or paused dot on the trigger with a text label), Daily brief, Display currency, Theme, Private mode, Client view, Settings, Sign out (previously unreachable on phones for both audiences). Focus trap, overlay-stack Escape and backdrop rules (shared useBottomSheet + shouldDismissOnBackdrop), the top bar now honours Client view preview (search, tracker and brief hidden, bell flips audience), Exit preview keeps a 2.75rem target, back link in slot one on nested routes. Live smoke on production 2026-09-06 02:35 NZST at phone width: five slots, no wrap, sheet opens from the avatar.

## Client library and catalogue (Liam, 2026-09-06)

- [ ] CL.1 - [Design first, then FE/BE] **Files as a small Google Drive with threads.** Folders per client (Deliverables, Brand, References, Uploads), drag-and-drop uploads from the client, a comment thread per file (reuse the request thread composer and the messages table with a file target), versions optional. Liam: "i'd like to give them a small version of like google drive but with threads so they can upload docs for us there." Design in Claude Design alongside the Clients pages; the current /files page (list, upload, download) stays until then.
- [x] CL.2 - [FE] Client preview of /services showed the admin catalogue editor (New service, coupons, visibility toggles) because the page branched on the Clerk org alone. Fixed the same way as Files: the impersonation cookie selects the portal catalogue. Real client logins were never affected.
- [ ] CL.3 - [Design first, then FE/BE] **Services page as a showcase that upsells.** Tahi's services presented to the client (what it is, who it is for, from price, what you get), an "Ask about this" CTA that opens a pre-filled request or enquiry, plan-aware suggestions (a Maintain client sees the Scale upgrade; a project client sees a retainer), never a form to create a service. Depends on CT.11 (scope the catalogue per org before importing ManyRequests services). Liam: "we'll get to the upselling idea in a minute."

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
