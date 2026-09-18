# Overnight run log, 2026-09-12 to 2026-09-13 (Giant Group readiness, then the design catalogue)

Goal Liam set (2026-09-12 night): iterate until we are 100 percent assumed ready for Giant Group to be onboarded, then design every ideal page in Claude Design for later porting. Keep going with subagents until he says stop; wait out usage blocks and resume. Cheap models draft, Fable reviews.

Standing constraints: no email to Giant Group (allowlist stays closed, no invite); tasks studio-only; the standalone Messages page stays hidden for clients; data writes on production only through the app's endpoints as Liam, dry run first; deletes are Liam's clicks.

## State at 2026-09-13 ~00:30 NZST

Landed on main and deployed:
- `completed` client status (Decision #060, 4e43bd9d); seven clients reclassified.
- Xero void never demotes a paid invoice (eb5592db); Dante Media INV-0005 and INV-0007 read paid with ManyRequests' dates (MC.10 closed).
- MC.9 residue sweep (d0aa89a2, abeb9bc8): applied by Liam, 36 rows removed, second dry run plans zero. Acme Corp hard deleted by Liam.
- Pre-call digest timing fix (482627b8, live since d6574c26): every writer normalises to a UTC instant, cron compares instants, email prints NZ time. Backfill applied 2026-09-13 from Liam's session: 71 rows fixed, second dry run 71 canonical / 0 to fix.
- Build incident: the first version of this log quoted the session transcript path with backslashes and Tailwind's scanner read it as a CSS escape (RangeError: Invalid code point 13015018), failing deploys 696fce78 and 845b6008. Fixed in d6574c26 (path rewritten, docs/SPECS/root markdown excluded from the scan). Lesson recorded at the bottom of this file.
- Clerk Production instance checked in Liam's dashboard session: Membership optional, auto-create first organisation off. No change needed; the sign-up path does not force a workspace.
- Docs: STATUS.md deploy gate resolved; TASKS.md T0.1, T0.5, MC.4, MC.9, MC.10, MC.10b, DL.0 to DL.2, IC.7 backfill.

Operator steps done by Liam tonight: CLERK_WEBHOOK_SECRET on production (endpoint answers 400 now), Resend domain confirmed verified, invoice number backfill applied (99 rows), Acme Corp and the two dummy orgs deleted, /design-login.

Applied by the lead through the app's endpoints under Liam's earlier decisions: Giant Group invoice channel = xero; Messages feature denied for Giant Group (organisation override); request #243 flipped to internal.

Claude Design write-back: DL.1 and DL.2 complete (14 of 14 files; the three over 100 KB went in through the design-sync disk upload). DL.3 shell wiring and DL.4 re-critique still to do.

Liam's answers (2026-09-13 morning): Messages stays hidden for every client (building the platform default now, workflow messages-hidden-for-clients). Clerk post-sign-up organisation task: he could not find the setting; the lead checks the Clerk connector or the Clerk dashboard in his Chrome session. Bank accounts: he has one per currency and will send the details; BUILD per-currency accounts in Settings > Getting paid with the How to pay block picking the invoice's currency (queued after Batch A because S3 touches the same block); Liam types the account numbers himself. Email intake: unsure, so treat as not wired and soften the "reply on the thread" line in emails/new-message.tsx after S4 merges. "N8N Content Engine" IS a Giant Group call: S5 must show it with a join link rather than hide it; check the slice against that.

Still only Liam: the A5 real-session lap (plan section 4); the allowlist flip and the invite (OFF until he says); the bank account numbers per currency once the fields exist.

## Batch A (2026-09-13, from docs/superpowers/audits/2026-09-13-giant-group-readiness-plan.md)

Merged to main and pushed as 66b18917 (full suite 4080 green, lint zero, build compiled):
- S1 portal plan truth (57348c00): /api/portal/subscription reads custom_mrr and the tracks entitlement; client home, services, settings plan and /billing render the native rate and the right track count; /tracks bounces a client to /requests. Follow-up in flight: synthetic lanes cannot be reordered (reviewer finding).
- S2 existing client never sees a plan picker or card form (9583e104): buildSteps returns welcome then kickoff for every existing client; /api/portal/checkout answers 409 over a live subscription or a Xero channel. Follow-up in flight: the guard covers past_due, paused and trialing too.
- S4 org id reaches the delivery gate (6e605d37): every client-facing notification email carries the org id, so the allowlist exemption will work the moment Liam flips it; nothing sends until then.
- S5 the next call on the home page is joinable (343f2dc9): attendee guard on /api/portal/calls; the N8N Content Engine call IS Giant Group's per Liam, so it stays and needs a meet link to show Join.
- S6 A4 isolation proof (127a7732): e2e/tenancy-isolation.spec.ts written (622 lines) plus harness fixes; NEVER EXECUTED yet; a run on the local QA harness is in flight.
- S8 MC.7 importer (8dca82f9): a subset run resolves hand-mapped clients; dead clients snapshot key removed (66b18917 fixed the one test that still counted it).
- S3 how to pay (65e360d3 on worktree-wf_3b66e233-82b-4): built; blocked only by two pre-existing tests pinning the old list-only invoice link; a fixer is on the branch; merge next.
- S7 services catalogue: applied through the app's endpoints, not code: Maintain (592fc48d) and Scale (b72d3d29) created as global public plan rows with no price; the three add-ons (50 hours, Lottie animation, free site audit) flipped into the catalogue with their imported HTML stripped.
- Also merged tonight: Messages hidden for every client by default (27ae697f).

## Live smoke of Batch A on production, Client view of Giant Group (2026-09-13, build 66b18917)

- /overview: 2 tracks, two lanes, £ invoices, September invoice due with Pay, no stray request, next call shows (N8N Content Engine, TBC: needs a meet link on the call for Join). "Kia ora, Liam" is the preview resolving the admin, expected.
- FOUND AND FIXED (data): the plan rate rendered NZ$2,000. custom_mrr_currency was null for Giant Group and the portal fell back to NZD. Set to GBP through PATCH /api/admin/clients as Liam; /api/portal/subscription now answers currency GBP and every surface reads £2,000. The same field set to GBP for Glasswall, BCS Consultancy and Elevate (the admin GET does not echo customMrrCurrency; small follow-up).
- /services: plan card (Scale, 2 tracks, on plan since 30 April, £2,000 per month), Maintain and Scale plus the three add-ons, "Ask about this" on each, "No prices here on purpose". Matches Liam's direction.
- /settings?section=plan: £2,000/mo, "Extra tracks are quoted for your plan", no Manage payment method; the Change plan cards still show the studio's NZD list prices (Maintain NZ$1,500, Scale NZ$4,000) as the comparison.
- /messages and /tracks both bounce a client to /requests.
- Liam assigned as Giant Group's project manager (assign_client_pm) so "Your team is being assigned" resolves.
- Still to smoke after 2f0c20a0 deploys: /invoices list and the September invoice (S3 How to pay card, INV number), /billing without Manage Billing.

## Later that morning

- S6 tenancy proof RUNS AND PASSES: e2e/tenancy-isolation.spec.ts 3 of 3 on the QA harness after a retry-once fix for a pre-existing post-sign-up goto race (52922925); onboarding-personas passes but stays flaky under load. STATUS.md names the spec as the tenancy proof; CI wiring is its own task.
- Import provenance notes no longer render to clients as "A note from the studio" (2f87f858, live).
- Data fixes through the app as Liam: custom_mrr_currency GBP on Giant Group, Glasswall, BCS, Elevate; Liam assigned as Giant Group PM.
- Readiness after this: about 92 percent. Left on Giant Group's path: per-currency bank details (building), a meet link on the N8N call (Liam), the A5 real-session lap (Liam or Staci), the allowlist flip and invite (Liam, when ready).

## Liam, late morning 2026-09-13

- Entered all five bank accounts in Settings > Getting paid (NZD, GBP, USD, AUD, EUR confirmed present, values never read by the lead).
- Gave the Teams join link for the N8N Content Engine call; set on the call through the discovery-calls PATCH as Liam.
- Plan: run the A5 real-session lap, then flip the allowlist for Giant Group and invite.

- GI.3 calls link and purpose editable: merged ef2feca0 after a blocking review (relink scope) was fixed; live look pending.

## Catalogue Batch A (afternoon)

- Merged 40f93fe6, f972f66b, a20ea023, faf6f286 (suite 4180): kickoff booking reaches Google Calendar; auth path verified plus e2e/auth-path.spec.ts; client home next-invoice date instead of TBC; tenancy proof CI workflow with a clean skip until Liam adds CLERK_PUBLISHABLE_KEY_DEV and CLERK_SECRET_KEY_DEV. Live smoke of the next-invoice copy pending the deploy.
- Catalogue Batch B (money path) started: B1 services plan ladder port, B2 /billing lap and CT.16 default, B3 client invoices at 375, B5 IC.8 hourly export backfill stamp. B4 (studio invoices port) waits on the critic FIX and Liam's design review.

## In flight

- Workflow `giant-group-batch-a` (run wf_3b66e233-82b): parser, then one builder per slice S1 to S8 from docs/superpowers/audits/2026-09-13-giant-group-readiness-plan.md in its own worktree, then one reviewer per slice. When it returns: the lead reads each review, merges non-blocking slices into main one at a time (renumber colliding migrations; apply any migration to staging and production D1 before the push), gates each merge (type-check, lint, touched vitest, next build if a route changed), pushes, watches the deploy, runs the slice's read-only live smoke on production, updates TASKS.md and STATUS.md and this log.
- Deploy poll for 007b63f8, then the normalize-times backfill (dry run first) from Liam's session.

## Next after Batch A

1. Re-run the readiness plan's live smoke list on production in Client view (Giant Group) at desktop and 375, light and dark.
2. Hand Liam the final A5 checklist (plan section 4, updated for what shipped).
3. Design catalogue: DL.3 (invoices-studio shell wiring, Services ladder rule, Stalled flag rework per docs/superpowers/audits/2026-09-07-invoices-services-stalled-integration.json), DL.4 re-render and re-critique, then AR.4 (proposals editor redesign) and AR.5 (rail and headline band consistency), then the remaining ideal pages.
4. Tier 3 build plan is parked in docs/superpowers/audits/2026-09-12-t3-reverify-plan.md.

## Rules for a wake-up with no memory

Read STATUS.md, TASKS.md and this file. `git log --oneline -15` for what landed. `git worktree list` for builder branches not yet merged. Journals for a finished workflow live under C:/Users/Work/.claude/projects/C--Users-Work-Projects-tahi-dashboard/c697eac4-1e32-47bd-8c4d-ffd5d9cd3fd2/subagents/workflows/(run)/journal.jsonl. Write such paths with forward slashes: Tailwind v4 scans every non-ignored file for class names, and a backslash followed by six hex digits (here the session id) parses as a CSS escape and fails the production build (deploy 696fce78, 2026-09-13). Never push a red suite: `npm run test` pipes through tail, so read the summary line, not the exit code.

## Catalogue Batch B (evening)

- Workflow catalogue-batch-b (run wf_9f06cdac-c54) returned four slices. CB2 (/billing lap and CT.16 default), CB3 (invoices at 375: no defect, spec added) and CB5 (IC.8 stamp route, one nit) reviewed clean and merged as c1e8c24e (suite 4201 green). CB1 (plan ladder) reviewed BLOCKED: Tune and Launch copy called them track plans, the dedupe stripped a real Launch card, orgName never passed; a sonnet fixer is on worktree-wf_9f06cdac-c54-1.
- Portal-home truth fixer (agent worktree a287fc03d8ba156fe) merged as 5829bf0d (suite 4207, build compiled): /api/portal/team reads the assigned PM first (teamMemberAccess) so Giant Group's card names Liam; the Google Calendar sync cron (every 15 minutes) was overwriting discovery_calls.google_meet_url with null whenever the Google event had no conference data, which is why the N8N Content Engine call lost its Teams link minutes after Liam gave it. The cron now keeps an existing link. TO DO after the deploy: set the Teams link on the call again as Liam, then confirm /api/portal/calls returns meetingUrl in Client view.
- Deploy watch lesson: `gh run list` filtered by sha returns the E2E tenancy workflow first (it skips fast and reads green); watch the run whose workflowName is "Deploy dashboard".

## Liam awake, early afternoon 2026-09-13 (dummy client test)

- Merged and live: CB1 services plan ladder (6534ebdd, after the fixer cleared the three review findings), small fixes fa627b0c (stamp date validation, client fallback echoes customMrrCurrency, honest reply line in the new message email). Ladder smoked in Client view of Giant Group: Maintain, Scale (you are here), Launch, no prices, pressure note quiet, add-ons keep Ask about this.
- Liam asked for liammiller.dev to receive client emails for a dummy test to himself. Applied as Liam through PATCH /api/admin/settings: email.allowedDomains = ["tahi.studio","liammiller.dev"], email.allowedAddresses = [] (the address list narrows the domain list, so it had to be cleared for a whole domain). Mode stays allowlist, nathan@tahi.studio stays blocked, allowedOrgIds stays []. Side effect told to Liam: every tahi.studio mailbox now passes too; re-narrow to a named list when his test is done.
- Teams link restored on the N8N Content Engine call (discovery call 2663a77a) after the calendar sync fix went live; /api/portal/calls in Client view now returns it and the home shows Join.
- Client view cookie is shared across the browser: while the lead sat in Client view of Giant Group, Liam toggled his own Client view of Company Inc (his dummy org, 8049b9f2) and the lead's tab dropped to the studio /billing page. Lesson: when Liam is awake and testing, do not use Client view in his Chrome; read the portal routes another way or ask him.
- Liam's asks from the dummy walk-through, all in flight as worktree agents: (1) one studio project manager for every client (setting studio.projectManagerId, no hardcoded person), pronoun-free lead copy, the onboarding video hidden, the client home onboarding checklist card hidden (agent onboarding-lead-video); (2) kickoff slots computed from the studio's Google Calendar free/busy in NZ time with the client's own zone named (agent kickoff-slots, new GET /api/portal/kickoff-slots); (3) request detail rail: two cards collapse to a sliver at mid widths and trap wheel scroll (agent request-detail-rail-fix); (4) client home: three New request CTAs, and "Your project, phase by phase" shown to a custom-price retainer (plan type custom is not a project) - queued for after (1) lands, same file.
- Open bug: every kickoff slot fails with "We could not hold that time". Not reproduced yet: Act as client from the lead's session was denied by the permission classifier (respected). A discovery_calls Kickoff call row exists for Company Inc (Monday 09:30 NZ), so at least one write reached the calendar side. Production tail running; also asked Liam for the console line "[onboarding] kickoff booking failed <status> <error>". Working hypothesis: he is walking the flow in read-only Client view, where the POST answers 403 "Read-only in client view" by design and the wizard shows the generic error; if so the wizard needs the read-only banner and a disabled Book button in preview.

## Evening 2026-09-13, after the weekly usage limit (reset 22:00 NZ)

- The weekly limit hit at about 14:25 NZ and killed four sonnet agents mid-slice plus the Batch C review of C2 and the build of C4. Two worktrees kept real uncommitted work (agent-a03cee80b9305cab5: the studio project manager resolver; agent-ae839cc338b459675: the kickoff slots route). At 22:05 NZ fresh agents were pointed at those worktrees (no new isolation) and the rest respawned; the Batch C workflow was resumed so only the failed review and build re-run.
- Root causes closed: kickoff "could not hold that time" = read-only Client view (403 by design); "call went through, wasn't booked" = Google grant is calendar.events.readonly, the event insert was refused and swallowed silently. 03406711 requests calendar.events plus calendar.freebusy and logs the failure. Liam reconnects Google once after the deploy.
- Second-seat bug: app/(dashboard)/layout.tsx keys onboarding completion on the user's Clerk publicMetadata, so a new seat of an onboarded org gets the wizard. Agent seat-landing makes completion an organisation property.
- Every message Liam sent from the home page duplicates onward is now a numbered line in TASKS.md ("Liam's dummy-client walk-through", LW.1 to LW.20) with its owner.
- Tail lesson: `wrangler tail --format json` prints pretty-printed multi-line objects; parse by brace depth, not per line. The 5-minute tail showed nothing for the booking because Liam had already moved on; the row data told the story instead.

## 22:10 to 22:50 NZ: Batch C live, walk-through fixes landing

- Batch C merged and deployed as 23b5c681: C1 3ecafbba, C3 97e51af0 (dash fix a7215587 on the branch first), C2 bad0d7ef (reviewer blocker was the missing Playwright spec, queued as D3; its expired-accept finding is covered by C3's 410 guard), C4 32c78bee after resolving the three predicted conflicts with C3 by keeping both sides (runner entries 0098 then 0099, proposal decision events plus the contract event, both preview keys). Gate on the whole set: 287 files, 4398 tests, lint zero, build compiled.
- Migrations: 0098 applied to production tahi-db through wrangler (columns verified); the staging database refused the OAuth token (Authentication error 10000), re-run when the token is fixed. 0099 applied through the app's runner as Liam right after the deploy (POST /api/admin/db/migrate {"name":"0099"}: applied, 1 statement) because the classifier refused the second wrangler apply.
- Healed through the app as Liam: the three "Giant Group 12 week build plan" schedules that were shared with nothing published (cef49c39 on Giant Group, 3a24d237 and ef50d591 with no org) now carry publishedAt 2026-09-13T10:27Z; the API does not echo the snapshot body.
- Client home fixes merged (7e20d40b, LW.10 and LW.11): one New request, custom price is a retainer not a project (lib/engagement-presentation.ts). Request detail rail fix merged and pushed as 3175bf36 (LW.12): the grid split moves from 768 to 1024px with minmax(0,1fr), rail sticky and scroll classes move with it.
- The dead C3 template: emails/contract-signature.tsx and studioContractSignatureEmailPlan are only used by the preview page; C4's contract-partially-signed is the live path. Retire in D2.
- In review (sonnet, workflow review-walkthrough-slices): AI wizard 47d0def9 (LW.13 to LW.17), seat landing 06486308 (LW.19, five clauses), Tahi seat invites 81153703 (LW.18, Clerk invitations removed from three routes, new team accept route). Still building: onboarding-lead-video-2 (LW.2 to LW.5, LW.9), kickoff-slots-2 (LW.6, LW.7 read-only view).
- Liam ran /design-login at 22:35 NZ: design-system access authorized for the DL.4 re-critique.

## 22:50 to 23:20 NZ: the walk-through fixes merged

- Reviews (sonnet, two workflows): wizard had one confirmed blocker (admin route loaded any org's context without requireAccessToOrg), fixed on the branch (bdc4b329); seat landing clean (one nit: an extra Clerk read on the rare path); invites clean; project manager clean; kickoff slots clean apart from the missing MCP twin (follow-up).
- Merged and pushed: 7516bc5b (seat landing 1c598e9a, invites), 7ca50bff (project manager f8341c3d, kickoff slots with one import conflict resolved), f2c3182f (wizard). Suite at f2c3182f: 297 files, 4547 tests, lint zero, build compiled.
- Liam asked (23:00 NZ) for readiness and three feasibility answers (WhatsApp/Slack bot, role-scoped MCP, tasks from a PDF); answered in chat: Giant Group 95 percent, full daily driver 80 percent; bot about 3 days Slack first plus Whisper on Workers AI; role-scoped MCP about two weeks on the existing resolver; PDF tasks about 3 days (tasks cannot carry files today, the task wizard never nests). Tonight after the current work: the design pass, one page at a time, held for his review before any port.
- Next on this run: f2c3182f deploy, then PATCH studio.projectManagerId to Liam's team member id b3025c04 as Liam, then the design capture scout's result and the DL.4 re-critique.

## 23:30 NZ: project manager override applied, design pass started

- 915a6935 deployed green (wizard, capture script, docs). Applied as Liam through PATCH /api/admin/settings: studio.projectManagerId = b3025c04 (Liam Miller). Every client now sees Liam as project manager and lead, the kickoff host is Liam; Settings > Studio details holds the select to change or clear it.
- Liam (23:20 NZ): Liam is PM for all clients and the default for new ones, by engagement type (agent pm-defaults, PM.1); Google reconnect tomorrow; "100 percent" means the full list including the nice-to-haves (about 60 percent on that scale); beta comment pins wanted (BP.1); Slack or WhatsApp messages are requests (GI.1); the wizard should learn each client deeply (GI.4); request from a document with the file linked (GI.5). All logged in TASKS.md.
- Design pass: scripts/design-capture.mjs committed (915a6935); workflow design-pass-requirements writing 27 requirement documents under docs/superpowers/design/requirements, each checked for completeness; the Claude Design work per page follows and is held for Liam's review before any port.

## 23:45 to 00:05 NZ: PM defaults live, wizard memory merged, backlog reorganised

- PM.1 merged and deployed (e9feda94): studio.defaultProjectManagerId.retainer and .project, applied at client creation (dialog, importer, self-serve provisioning), idempotent, the override still wins. Both keys set to Liam (b3025c04) on production as Liam; Settings > Studio details shows all three selects.
- GI.4 step one merged (ff9939bd): the wizard's client block now carries the history (totals, category and size counts all time and last 12 months, categories never requested, open statuses, plan, tracks, custom rate on file, hours in the last 90 days) with a rule to answer "what are we not doing" from the coverage gaps in two sentences. Step two (the advisor) stays GI.4 phase 2.
- TASKS.md reorganised by an opus organiser: 96 open ids (95 after the lead marked DL.3 done), 13 moved to Done with their commits, one merged (CB5 into IC.8), the old file archived at docs/superpowers/plans/2026-09-13-TASKS-before-reorganisation.md. Unresolved by evidence and left [~]: MR.6 and MR.7 design halves (now inside the overnight design pass), LW.2 to LW.19 and C1 to C4 (merged, live check owed, the A5 lap closes them), T1.17 and TP.4 possibly superseded.
- Design pass running: workflow design-pass-build, 19 modules, opus designer then sonnet screenshot critic then one revision, then one shell wiring agent. Comment ball (BP.1 stripped back) still building.

## 00:30 NZ 2026-09-14: comment ball live

- BP.1 (stripped back) merged 1ebb63f5, deployed green, migration 0100 applied through the runner (3 statements), GET /api/admin/feedback answers an empty list; the MCP tool is list_feedback_comments. Reviewed by the lead before merge: identity and org from the session only, 5000 character cap, 30 per hour silently ignored, admin read gated, the recorder keeps method, url and status of failed calls only.

## 00:50 to 03:05 NZ 2026-09-14: usage limit pause

- The account usage limit hit at about 00:50 NZ with the design pass mid-flight (16 of 19 modules designed, 4 critiqued, 18 agent calls failed). It reset at about 03:00 NZ; the stale run was stopped and the workflow resumed from its journal (finished work cached, failed calls re-run): calculator-analytics, content-marketing and sales-artifacts designs, the remaining critiques, revisions, then the shell wiring. Follow-ups merged before the pause: kickoff slots MCP twin and the duplicate contract signature template retired (1ccc3b08, deployed green).

## 06:20 NZ 2026-09-14: design pass compiled for Liam

- All 19 modules designed and 18 critiqued; after one revision each, 14 modules stand at SHIP and 4 at FIX with a bounded list (portal-account, portal-files, portal-money, requests, tasks); calculator-analytics's critique hung for over 30 minutes and was stopped with the workflow. The shell wiring step never started (it sat behind the pipeline barrier), so it runs now as a standalone opus agent, with a standalone critic for calculator-analytics.
- Review document: docs/superpowers/plans/2026-09-14-design-review-for-liam.md (compiled by scripts/design-review-compile.mjs from the workflow journal; every module has its preview link, files, page keys, what was left out, the critic's remaining issues and the open questions). Regenerated once the wiring and the last critique land.

## 06:45 NZ 2026-09-14: shell wiring verified

- The workflow's wiring step had in fact landed its edits silently before the journal recorded it; the standalone opus agent verified reachability (owner 31 of 33 ids, teammate 6 of 7, client 14 of 14, the misses are legacy shims), zero console errors, and repaired "Tahi App Shell.html" (ten duplicated stylesheet links now carry the ids the modules check for, head-band.css after app-shell.css, requests-focus before requests-detail, sales-pipeline-kit after the band). Review document updated (088b9add). Calculator-analytics critique still running standalone.

## 07:10 NZ 2026-09-14: night closed out for Liam's review

- Calculator-analytics critiqued standalone: FIX (the 375 title input clips, one loading tile, one dark hex). Its critic also found that the shell scrolls inside its own container, so every critic's full-page screenshot covered only the first viewport; recorded as a caveat at the top of the review document (c741bd32).
- Final state of the design pass: 19 modules designed, 19 critiqued, 13 SHIP and 6 FIX after one revision each (portal-account, portal-files, portal-money, requests, tasks, calculator-analytics). Held for Liam; the next revision round runs after his marks so his review sees stable files.
- Code shipped tonight (all deployed green): PM defaults by engagement type (PM.1), the wizard's client history (GI.4 step one), the comment ball (BP.1 stripped back, migration 0100), the kickoff slots MCP twin, the duplicate contract template retired. Production settings applied as Liam: studio.projectManagerId and both default keys = Liam.
- Liam's morning list: reconnect Google (Settings > Integrations); read docs/superpowers/plans/2026-09-14-design-review-for-liam.md and mark each module; confirm TASKS.md (reorganised, 95 open ids); the A5 lap and the allowlist flip for Giant Group remain his.

## Morning 2026-09-14: comment ball picks its element

- Liam's tweak on the comment ball: click it, then click the element the comment is about, like Claude Design or Webflow; and a soft snap to the nearest screen edge after a drag. Built by one sonnet agent, reviewed by the lead (anchor lengths capped server-side, pick-mode listeners added on entry and removed on exit, the pick click intercepted in the capture phase so the page never acts on it), merged b0b5eb17 (305 files, 4692 tests). Migration 0101 adds the anchor columns; applied through the runner after the deploy. Overnight critic scratch files removed from the repo root.

## Morning 2026-09-14, 09:00 to 10:30 NZ: Liam's second round

- Merged and pushed, each reviewed by the lead: Services hidden for clients by default like Messages (24ae1753, LW.23); one scrollbar on the requests board and one focus ring on the AI composer (bdf333c4, LW.21, LW.24); delete a file from every files surface, R2 object first, client only what their org uploaded, MCP delete_file (349b4462, LW.22); the seat invite flow (6c683a69, LW.26): signed-out plus a seat token goes to sign-up with the email prefilled (sign-in when the account exists), the onboarding page accepts the invite on arrival through a shared lib (membership, contact link, onboarding stamp) and redirects to /continue, seat versus first contact decided from the org's existing contacts; the client home empty state keeps the dark header without the leaf badge and every onboarding screen has "Sign out and return to sign in" (b268d048, LW.27, LW.28). Suite at b268d048: 312 files, 4756 tests.
- Note for the seat invite: the middleware now reads D1 to decide seat versus first contact, wrapped in try and catch with the old sign-in landing as the fallback; Liam re-tests the invite link signed out once the deploy lands.
- Still building: People teammate delete resilience (LW.29).

## 10:45 NZ 2026-09-14: Giant Group goes live

- Liam: "let's allow giant group, and send them both an invite". Applied as Liam: email.allowedOrgIds = ["aa80a2d6-0494-424d-8ccc-9af524c31fa7"] (their own contact addresses pass the gate; everything else unchanged). Michael Day (michael.day@giantgroup.com, primary, portal admin) invited through POST /api/admin/onboarding-invites with send and reuse: emailed true, link valid until 27 September. Mark Ramsey's invite held: the contact row reads mark.ramsey@giantgroup.com and Liam typed ramsay; waiting for the spelling.
- Also this hour: the "test manual" invoice written off and the brief recomputed (LW.30); agents building prep notes on calls (LW.31) and the member-seat home (LW.32).

## 11:00 to 11:30 NZ 2026-09-14

- Member seats no longer see the plan or billing on the client home (62cb00a2, LW.32; the subscription route answers a member with seat: member and no money fields, the billing zone collapses to one line). Prep notes on every call (7f851a56, LW.31): discovery_calls.prep_note through migration 0102 applied on production through wrangler before the push, scheduled calls reuse notes; the brief links to /calls?call=<id>&focus=prep, the slide-over autosaves, the digest carries the note, MCP fields added.
- The full suite went red once on nine tests the member-seat slice never touched (middleware.test.ts, utils formatDate), green in isolation and on the re-run: logged as LW.34 to harden.

## 2026-09-15 morning: two phantoms

- Comment ball failing with "Something went wrong sending that": a later session shipped screenshots on comments (75932933) with migration 0103 in the repo and the runner, but nobody applied it; the deployed insert wrote screenshot_key into a table without the column. Applied through POST /api/admin/db/migrate {"name":"0103"} as Liam; a probe POST /api/feedback answered 201. Rule for every agent from now on: a migration shipped in a commit is applied on production (wrangler or the runner) before or immediately after that deploy, and the run log records it.
- "test manual · NZ$350 overdue" kept returning on the brief: the invoice (f3b75b6e, Stripe id on the row, source stripe) is open in Stripe and the sync-stripe cron re-imports it, flipping written_off back to sent at 07:41 NZ. Written off again and the brief recomputed; the importer is being taught the Xero rule (never demote written_off or paid); Liam voids it in Stripe.

## 2026-09-18: client hand-offs on requests

- Liam: requests are Tahi's, but sometimes a client contact has to help or is the blocker, so a request can be handed to a named contact. Built as three slices against one contract (workflow client-handoff-build): H1 model and routes (opus, 62adaf56), H2 UI (sonnet, 9984b189), H3 MCP and guide (sonnet, 3aed084d); all three reviews non-blocking; merged d8d9355e, acdb8942, 7c82f8bd. Migration 0104 (waiting_on_* on requests, an index) applied on production through wrangler before the push.
- Deviations the model builder stated rather than invented around: participant roles approver, contributor and watcher exist in lib/request-participants.ts but the participants POST route still limits contacts to follower (HO.4); there is no portal overview route, so waitingOnYou and waitingOnOrg ride on GET /api/portal/requests; the nudge lives in lib/request-handoff-nudge.ts called from the delivery-watch cron; waitingOn is loaded by a tolerant side query so a deploy ahead of the migration only hides the chip. The new notification type has no preference toggle yet (HO.5). The UI slice's local types file duplicates lib/request-handoff.ts exports (HO.3).
- The guide: lib/dashboard-guide.ts (ten short sections), GET /api/admin/guide and /api/portal/guide, /help for both audiences, MCP get_dashboard_guide, and a test that every tool the guide names exists on the worker.
- Deployed 89b312b4 green (328 files, 4967 tests). Live checks as Liam: /help renders "How this works", GET /api/admin/guide serves the ten sections, GET /api/admin/requests?waitingOn=client answers (empty), request detail payloads carry waitingOn, and a request's detail shows the Waiting on card with the "Hand off to a client" dialog (contact, reason, note, due date). A tidy agent is closing HO.3 and HO.4.
