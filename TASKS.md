# tahi-dashboard - Active Task List

Last updated: 2026-08-18 (client-ready triage: 6-agent code audit of every client-visible surface; file reorganised around the ManyRequests cutover)

**Active block: CLIENT-READY LAUNCH - replace ManyRequests.**
Strategy (Liam, 2026-08-18): ship every surface a client touches first (proposals, contracts, schedules, the portal). Team and owner surfaces improve slowly after cutover. Stop building sideways; work the sprints below in order.

Read `STATUS.md` first: it carries the triage snapshot and the deploy-approval gotcha.
Closed items live in `TASKS-ARCHIVE.md`.

Format:
- `[ ]` open, `[x]` shipped (move to TASKS-ARCHIVE.md once verified live)
- Initials + date on claim: `- [AGENT] YYYY-MM-DD`
- Tasks only flip to `[x]` after the Definition of Done in `CLAUDE.md` rule 8

---

## Sprint C0 - Ops unblock (hours, do first)

- [ ] C0.1 - [Liam] **Approve the stuck production deploy.** Run 31355118401 (the Aug 10 bank-truth fix, commit dc41442a) has sat in GitHub's production environment approval gate for 8 days. GitHub -> Actions -> Deploy dashboard -> Review deployments -> approve. NOTE: every push to main waits on this gate; nothing "auto-deploys". Either keep approving per-push or remove the required-reviewer rule on the production environment.
- [ ] C0.2 - [QA] After the deploy lands: fire sync-airwallex (`gh workflow run "Dashboard cron triggers" -f target=sync-airwallex`), then verify `get_bank_balances` returns Airwallex wallet rows + `yield:CUR` rows matching the Airwallex UI, and honest runway.
- [ ] C0.3 - [Liam+BE] **Refresh `finance.yieldHoldings`.** Yield has grown since the setting was seeded (Xero now carries Yield USD 33,956.89 / AUD 638.80 vs the setting's 20,014.13 / 531.51). Confirm the real numbers in the Airwallex UI, then update via the `update_settings` MCP tool.
- [ ] C0.4 - [BE/Ops] Apply migrations 0081 + 0082 to prod D1 and verify apply state of everything since (list_migrations). Was blocked on TAHI_API_TOKEN rotation.

---

## Sprint C1 - Sell without embarrassment (proposal / contract / schedule money paths, ~5 days)

Audit findings 2026-08-18: the three deliverable surfaces are premium at the craft level but have defects sitting directly on the money path. Shared fixes first, then per-surface.

- [ ] C1.1 - [BE] **Publish-before-share, proposals + schedules.** Share POST writes `publishedSnapshot`; email POST rejects when no `publishedAt`; revoke clears the snapshot. Today the standard journey (Generate link -> Email) serves LIVE rows: proposals `share/route.ts:38-51` never snapshots and public GET falls through to live tables; schedules identical.
- [ ] C1.2 - [FE] **Proposal Publish button resurrection.** `hasUnpublished` compares updatedAt vs publishedAt but patchSection/patchVariant/patchProposal/moveSection/deleteSection never `mutate()`, so after the first publish the button disappears for the whole session and later edits silently never reach the client. proposal-detail.tsx:245-367,448-450.
- [ ] C1.3 - [BE] **Close the accept/sign loop.** Proposal accept/decline/question and every contract signature currently produce NO notification, email, deal activity, or stage move (the viewer promises "we'll be in touch within one business day"). Emit: notifications row (`proposal_signed` / `contract_signed` types already declared in lib/notification-links.ts, never emitted), Resend email to Liam, deal activity entry, optional auto stage bump. accept/route.ts + contracts sign route.
- [ ] C1.4 - [FE] **Deliverable kit theme integrity.** Consume `--page-chrome-text` in AccentTitle/SectionHeader/prose (fixes invisible dark-slide text in BOTH the proposal and schedule viewers); add `app/p/layout.tsx` pinning light tokens so a viewer's `tahi-theme=dark` localStorage can't corrupt the public documents (GanttGrid + risk/RACI tables consume var(--color-*)); hide the slide-theme picker options that aren't wired.
- [ ] C1.5 - [FE] **Mobile money path.** VariantTabStrip gets `overflowX:auto` (at 375px the third package tab is clipped and unreachable, proposal-viewer.tsx:871-887); gantt gets a narrow-mode card stack under 720px (fixed minWidth 64rem today, the risk register already proves the pattern); contract signature canvas re-sizes on rotation (buffer set once on mount, contract-viewer.tsx:746-760).
- [ ] C1.6 - [BE] **Contract artifact persistence.** Write the signed PDF to R2 `signedStorageKey` at full-sign time (column exists, zero writers), add a download button on the signed viewer state, and an admin "resend signed PDF" action. Today the PDF exists only inside one fire-and-forget email.
- [ ] C1.7 - [BE] **Contract tamper anchor.** Hash bodyHtml into the signature chain and block bodyHtml PATCH once status leaves draft (currently editable through sent/partially_signed while the viewer claims "locked at signature"); stop revoke from resetting a partially_signed contract to draft with signatures intact.
- [ ] C1.8 - [FE/BE] **Deals honesty.** Scheduled nudges are written with status='scheduled' and NOTHING ever sends them (timeline still logs "Nudge scheduled for..."); auto-nudge toggles exist with no engine. Remove both affordances or build the cron sender. Also: stop marking nudges 'sent' when RESEND_API_KEY is absent; surface errors in the New Deal + Nudge dialogs (currently silent catch).
- [ ] C1.9 - [FE] **Small-fix batch (single pass).** alert() -> toast in proposal viewer accept path; EmailShareModal syncs preselection when suggestions load (Send is dead until manual ticking today); compress founders-placeholder.jpg (2.5 MB -> under 200 KB) + lazy/decoding attrs; public tab titles ("Proposal · Tahi Studio", OG tags, drop the "| Tahi Dashboard" leak); em-dash metadata titles violate repo rule 6; legacy /pipeline/ hrefs -> /deals; accept validates variantId against the snapshot not live rows; enforce expiresAt (cron or check at accept); client-detail ContractsTab wired to contract_documents shape (Download column is /api/uploads/serve/undefined today); "Save as template" on contract detail 400s every time; global search reads legacy contracts table so e-sign contracts are unsearchable.
- [ ] C1.QA - [QA] Playwright: share -> publish -> view at 375px -> accept -> admin notified (proposals); send -> sign on phone viewport -> both parties get PDF (contracts). Zero coverage exists on either surface today. Then ONE live round-trip on prod with a personal email before the first real client send.

---

## Sprint C2 - Portal truth (the five audited blockers, ~12 days)

Re-verified 2026-08-18 against current code: all five still present. Two sub-claims stale (noted). Full evidence in `memory/project_portal_readiness_audit_2026_08_10.md` + the 2026-08-18 re-verify.

- [ ] C2.1 - [BE] **B1 uploads identity (~2.5d).** `/api/uploads/confirm` honours `body.orgId` from ANY authed user (cross-tenant write hole, reachable from the shipped composer) - only honour it for Tahi admins passing requireAccessToOrg. Presign keys under the OWNING org, not the uploader's Clerk org (clients 403 on every team-uploaded deliverable today). serve/proxy authorize off the files row against getPortalAuth's D1 org id (getRequestAuth returns the Clerk id: two different id spaces today, which also silently hides client self-uploads from /api/portal/files). One-off backfill/dual-read for existing keys. NOTE: the old audit's voice-note claim is stale - no voice-note code exists in the tree anymore.
- [ ] C2.2 - [BE] **B2 notification identity (~1.5d).** Six insert sites pass contacts.id / teamMembers.id / participant row ids where the bell + SSE query by Clerk userId, so clients never see team replies and the team never sees client comments. Route them through the resolvers that already exist (notifyOrgContacts, notifyMentionedPerson pattern; add notifyTeamMember), and resolve participantId -> clerkUserId inside createNotifications so future call sites can't regress.
- [ ] C2.3 - [BE/FE] **B3 portal invoice + pay (~2.5d).** Add GET /api/portal/invoices/[id] (org-scoped, exclude drafts); invoice-detail branches its SWR key on isAdmin (today it always hits /api/admin and 403s clients); add hosted_invoice_url column, persist from stripe-create + Stripe webhook; render a real Pay link with /api/portal/billing/session as fallback.
- [ ] C2.4 - [FE] **B4 nav + files (~2d).** CLIENT_NAV: remove Schedule/Contracts/Proposals or point them at real client routes (see C2.6); /files renders /api/portal/files (payload already carries name/type/uploader/url - the page is a hardcoded "No files yet" stub that admins never see); Book-a-call CTAs -> booking-widget (currently loop to /overview); add Billing to CLIENT_NAV (stale audit claim: the /billing client branch works now, it's just unlisted).
- [ ] C2.5 - [BE/FE] **B5 onboarding surface (~3.5d).** Invite-mint panel on client detail calling the existing POST /api/admin/onboarding-invites + an MCP create_client_invite tool; Clerk webhook (svix, organizationMembership.created / user.created) backfills contacts.clerkUserId (second-seat teammates are stuck at the onboarding gate forever today); portal/invites also inserts pending contact rows; "invoice me" records a billing preference and entitles instead of 402-stranding; kickoff booking step actually books the chosen slot (POST /api/portal/calls or reuse booking-widget - the slot is discarded today).
- [ ] C2.6 - [Liam decision + FE] **Portal read pages for Contracts + Schedule?** If the nav items stay: thin client pages listing the org's contracts (link to /p viewer + signed PDF) and rendering the published schedule snapshot. If not, C2.4 removes the items and Overview gets a "View your timeline" link. Decide before C2.4 lands.
- [ ] C2.7 - [BE] **Portal project card reads published schedules only.** /api/portal/project takes the newest schedule by createdAt with no status/publishedAt filter, so a half-built draft's phase names surface on the client home immediately.

---

## Sprint C3 - Client-facing redesign stragglers (~4 days)

Coverage sweep 2026-08-18: 58 routes = 26 v3 / 20 partial / 8 legacy / 4 stub. These are the legacy/stub pages a client can actually reach, plus the deals lap.

- [ ] C3.1 - [FE] **/services v3 lap.** Worst offender: 978 lines, zero design-system imports, 2 raw tables, 2 hand-rolled modals, and it's the client-facing service catalogue (PortalServicesContent).
- [ ] C3.2 - [FE] **/billing v3 lap.** Three raw tables; client-reachable (works, just legacy).
- [ ] C3.3 - [FE] **/invoices/[id] v3 lap.** Legacy detail page behind the v3 list; pairs with C2.3.
- [ ] C3.4 - [FE] **/p/contract viewer onto the deliverable kit.** The only public viewer that skipped components/tahi/deliverable (~30 inline hexes); brings contracts visually in line with proposals + schedules.
- [ ] C3.5 - [FE] **/messages + /tasks client-facing polish.** PageHeader instead of bespoke h1s; replace the three hand-rolled fixed modals in tasks with SlideOver/ConfirmDialog; both pages are client-visible partials.
- [ ] C3.6 - [FE] **Deals v3 lap (internal - can slide past cutover).** Board/list/filter/dialogs are pre-v3 bespoke while BoardView/DataTable/FilterBar/SlideOver sit unused; tokens already clean so it's a 2-3 day composition swap. Includes touch targets + drag on touch.

---

## Sprint C4 - QA gate before the first real client

- [ ] C4.1 - [QA] Un-skip portal e2e; cross-org isolation spec (was T718): seed two orgs, verify A can't fetch B across conversations/time/contracts/calls/deals/files.
- [ ] C4.2 - [QA] **Full live client-session lap on prod as a real client org.** 375px + dark mode: every nav item, file download, invoice pay, request thread round-trip, proposal accept, contract sign. This has NEVER been done (zero live client-session QA on record).
- [ ] C4.3 - [FE/BE] PWA manifest icons to install criteria + portal noindex/robots (was T663).
- [ ] C4.4 - [Ops] WAF rate rule 60 req/min /api/portal/*, 20 req/min /api/uploads/* (was T719), or KV limiter now that we're off Webflow Cloud.

---

## Post-launch backlog (team/owner side - untouched priorities, work AFTER cutover)

### Notifications overhaul remainder (was T682-T699)
C2.2 fixes identity; the rest (preferences page S23/T682-3, rich content T684-5, SSE hook T687, email dispatcher T688-690, /notifications page T691-2, sidebar badges T693, Web Push T694-697 + W-PUSH, weekly digest T698-9) stays post-launch.

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

### UIUX + QA sweeps (was T720-T734)
Now largely covered by C3/C4; keep for reference: financial health spacing, invoice dialog, client archive UI, expense dashboard, calculator premium pass, notification surfaces, time cost columns; regression specs T728-T734.

### Carry-overs
- [ ] T568 - Google Calendar booking links for scheduled calls (partially superseded by booking-widget; verify then close)
- [ ] T570 - Zapier outgoing webhooks (engine shipped in W-2; needs Zapier-facing config surface)
- [ ] T571 - Deal-to-Client LTV link (fold into T711-T713)
- [ ] T594b - Apply migration 0012 (client_costs) to prod D1 (verify - likely long done; confirm via list_migrations with C0.4)
- [ ] T600 - Cash flow runway indicator (largely shipped on /financial-reports; verify then close)
- [ ] T618 - Worker MCP finance tools (verify coverage; several shipped)
- [ ] T662 - {{requestNumber}} email variable + [REQ-n] subject prefix
- [ ] T667 - Xero category overrides (needs S25)
- [ ] T716 - Email-to-Request intake (was "in progress" 2026-07-07; verify state, finish or park)
- [ ] W-QA - Live smoke of Wave 1-4 features (automation fire, webhook delivery row, announcement email fan-out, portal Org/Brand/People persistence, AI weave drafts)
- [ ] LIT-BOOKS.UIUX / LIT-BOOKS.QA - overview BOOKS cards review + live smoke

### North-star phases (queued, unchanged)
N1 discovery workflow, N2 auto-onboarding, N3 portal tour, N4 permission roles content, N5 Mailerlite CRM, N6 affiliates, N7 schedule->tasks bridge, N8 hourly billing tracker, N9 dashboard-wide premium pass. See memory/project_phase_roadmap.md.

---

## Superseded framing (for the record)

The "trust-crossover order" (Tasks -> Requests -> Messages -> Time -> Contracts, memory/project_trust_state_2026_05.md) is superseded by the client-first strategy above: client-visible surfaces ship first, team/owner surfaces earn trust after cutover. The Aug 1 portal deadline passed; the sprints above are the honest path to cutover.
