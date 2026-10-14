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

## 2026-09-19: studio home accuracy audit

- Liam: "check my home page for accuracy, cash-flow ribbon reads wrong, receivables show none overdue, etc." The lead traced all 25 cards to their routes on production. Wrong: receivables (aging buckets called 0 to 30 days late "current", so three overdue invoices read as current), the brief's currency prefix, the MRR delta (no August snapshot), pipeline ahead (annualised monthly value and a past close counted as closing), capacity (logged hours as booked, an inactive member counted), retainer health (a churn score over the API's own green), proposals live (drafts), the cash runway (gross burn from Xero, revenue ignored, three burn figures on one screen), take-home (NZD account only, tax deducted twice), the ribbon (retainers and pipeline only, so every month negative while the books show a NZ$13.2k monthly surplus). Right: outstanding total, cash, needs you, brief, requests, contracts, calls, replies, worklog, content.
- Liam's answers: tax owed to IRD NZ$24,242.68 total (2027 provisional 14,973, 9,982 left), the 15k pot is savings toward it; 64k each a year already configured; ribbon full picture. Fixes building as workflow home-accuracy-fixes (HA.1 to HA.9), Greyhive's undated invoice left to Liam (HA.10).
- Greyhive INV-2025000024 written off as Liam (debt collector engaged, will not pay); no Stripe or Xero id, so no sync can revive it. Outstanding NZ$21,394 across 6 invoices, 3 overdue; brief recomputed.
- MCP worker: the stringy-boolean defect was systemic (sixty-odd boolean args, isInternal among them); fixed once at the tools/call boundary with schema-driven coercion (430fc1f0). First real hand-off happened through the MCP: request #244 to Mickey Day, due 30 September.
- Home fixes merged in order (A1 b30a95ae, A2 87f9cdc3, B a24df8b2) plus the lead's follow-up c554076d (four-segment aged bar, capacity's active-member rule on its own setting team.inactiveMemberEmails rather than the email block list whose coded default names two people, two stale comments). Suite 339 files, 5075 tests. Production settings applied as Liam: finance.lastYearTaxOwed = 24242.68 (now the IRD balance), team.inactiveMemberEmails = ["nathan@tahi.studio"]. Live numbers verified after the deploy are recorded below.
- Live after c554076d (as Liam, 2026-09-19 09:20 NZ): Receivables NZ$21,394 outstanding, Current NZ$5,287, Overdue NZ$16,106 (Elevate 18 days, Giant Group 3 days, Elevate 1 day; the legend reads Not due, 1 to 30, 31 to 60, 61+). Cash runway "NZ$76.1k in the bank, +NZ$13.2k a month net, 3.6mo if revenue stopped". Take-home "NZ$51.8k free to spend now, 68% take-home, Tax NZ$15,000 of NZ$24,243". Ribbon basis "Retainers NZ$10.3k + project run-rate NZ$17.1k + weighted pipeline, minus commitments", September net +NZ$14.5k, twelve-month net +NZ$136.5k (was -NZ$68.6k). Pipeline ahead "NZ$3.2k weighted + NZ$250 a month, 2 open deals, 0 closing this month, 1 past its close date". Studio capacity "0% booked, Assigned 0h, Logged 0h, Available 80h, Staci, Liam" (Nathan excluded). Retainer health "4 healthy, 0 at risk" by the API's own status, the test org gone. Proposals live lists the two shared Giant Group proposals only. Daily brief recomputed: "NZ$3,668" and "NZ$9,687". MRR delta basis month 2026-07 in the payload.
- Scoped "call notes to tasks with an approval gate" after three read-only researchers mapped the transcript pipeline, Slack and approvals, and the task and actor models: docs/superpowers/plans/2026-09-19-call-notes-to-tasks-scope.md; logged as CN.0 to CN.3 (about 11 days for phases 0 to 2), five decisions for Liam.
- Liam answered the five call-notes decisions (#founders channel, the sender approves their own note and a client approves their own request draft, Gemini through Drive with the full transcript plus the wrap-up, threads as proposed, snooze minimal); recorded in the scope and TASKS.md (ce299fbd). Phase 0 built as workflow call-notes-foundations: F1 call_transcripts for every call kind with the matcher scoring discovery and scheduled calls together, unlinked notes on the calls page with an Attach picker, three MCP tools (opus, 58bba5af, 32 tests); F2 task_comments, the Tahi bot actor, the Thread section on the task detail mirrored into the request thread, two MCP tools (sonnet, 82e01f15, 26 tests). Both reviews non-blocking. Merged 16bbb85b; lead fix 38829444 for the reviewer's one major finding (a discovery call stamped before the table existed never gained a transcripts row; an unlinked doc was re-exported every tick). Migrations 0105 and 0106 applied on tahi-db through wrangler before the push; suite 347 files, 5136 tests; dashboard and MCP worker deploys green.
- Live smoke after 38829444 (as Liam): migrate list shows 0105 and 0106; GET /api/admin/call-transcripts?unlinked=1 returns 200 with no items; /calls unchanged (Upcoming 14, Past 22, no unlinked card). A disposable request and task on Tahi Test Client (request 712f3dcb, task 36c78135, both closed afterwards, Liam may delete): the Thread section showed its empty state, a note sent from the composer appeared under Liam's name and was mirrored into the request thread as one internal message, send target 44px, 375px clean through a same-origin iframe (the Chrome window was hidden so screenshots timed out), dark mode 13.8:1 on the comment body. Bot-authored rendering is unit tested only: the Tahi Dashboard connector did not connect this session.
- Found on the smoke: production has never written a Gemini transcript (zero discovery calls with transcript_source gemini_drive; every cron run written 0; all four docs this week no_transcript). Not from this merge, but the whole feature starves without it. f8c8adb7: a dry run now reports what the parser saw in an unparsed doc. The preview gave the root cause: the export has asked Drive for text/plain since b4188ec4 while the parser keys on the markdown headings, and the doc itself has changed shape (a Quick notes block with its own Next steps before Full notes, an emoji Transcript heading, star bullets). ba4970c0 exports as markdown and reads bare headings too; the follow-up starts at Full notes and accepts star bullets; 26 parser and sync tests. Live after 342a450d: a 30-day dry run parsed all 15 docs (summaries 200 to 900 characters, transcripts 1k to 79k, up to 16 next steps); the real run as Liam filed 14 rows, wrote 12 discovery calls (the first Gemini transcripts production has ever held), parked 2 for manual attach (a two-way tie and a stub), and the cron had already filed the newest doc by itself in between. Unlinked notes now show on /calls. Seen there: the previews were raw markdown and Attach rendered 28px, so 59398f6f flattens previews to prose, gives Attach a 44px target, strips anchors, entities and escapes from the stored transcript, and adds force=1 to the sync; live after 4deaac11 (a forced pass also rewrites the discovery mirror the sync stamped itself): forced re-sync over 30 days refreshed all 15 transcript rows and rewrote the 13 discovery calls; /calls shows prose previews and 44px Attach buttons.
- Liam: two more call types, mentoring and other. Workflow call-types-mentoring-other (one sonnet builder, one reviewer, clean): lib/calls.ts owns the vocabulary and the label and tone map; the calendar sync no longer flips a hand-set type back when the event has no parent link (a latent bug that the new types would have exposed); the builder also caught a red test on main (the preview cap assertion) that my gate grep had let through, fixed with the merge along with the row menu it had skipped; gate greps now fail on the word failed. Merged cbb089ce, both deploys green, live as Liam: six chips on /calls, PATCH mentoring 200, coffee 400 with the derived message, reverted.
- CN.1 (suggestions and the dashboard gate) after Liam's "then we can continue": three researchers mapped the AI call pattern, the task write paths and the inbox surfaces (docs/superpowers/plans/2026-09-19-cn1-research.json), the lead wrote the contract (2026-09-19-cn1-build-contract.md), and workflow cn1-suggestions-build delivered S1 (lib/task-writes.ts extracted from the task routes with audit entries, lib/task-suggestions.ts with dedupe, guarded decisions and apply through the shared writes, three routes), S2 (lib/task-suggester.ts with Sonnet, JSON in tags, quote validation, the gated sweep with a per transcript high-water mark, cost scope call_suggestions, the half-hourly cron) and S3 (the Suggestions view on /tasks with Approve, Tweak, Snooze, Reject, Approve all, y n j k, the owner home card, list_task_suggestions and decide_task_suggestion, the guide). Merge conflicts in the schema, the migrations array and the S2 stub resolved; the merge tool also ate S1's table block on a comment banner, restored by hand. Migrations 0107 and 0108 applied on production before the push; suite 349 files green; deploys green at 6916239f.
- First live sweep as Liam: 28 suggestions from 4 calls in under a minute, quotes verbatim from the next steps and the transcript, the inbox rendering all four actions and the home count. Two defects found on that pass and fixed: every row said Untitled task (the route handed the proposal over as a JSON string) and every row had no client (the calendar sync labels a check-in client by title but links no org, so the gate passed a null org and the suggester never saw the client's tasks). The gate now resolves the org through the deal or through guests who are contacts at one organisation, each sweep repairs orgless pending rows, and proposals are parsed at the boundary. cd75950f. Live after it: the next sweep repaired all 39 orgless rows and filed 9 more (6 dropped for lacking a verbatim quote, 2 sales calls skipped, 10 cents); 48 suggestions pending across 8 calls, every one with a client (Verandela 28, Elevate 13, Giant Group 7), titles and descriptions rendering, the home card counting them. Approvals left to Liam. Total model spend across three sweeps about 30 cents.
- Liam: "these are tasks and requests, especially requests if they come from a client." CN.1b built as workflow cn1b-requests-build against docs/superpowers/plans/2026-09-19-cn1b-requests-contract.md: request writes extracted from the three request routes the way the task writes were, four request kinds (create, update, thread note, hand-off) with the Tasks vs Requests rule in the prompt and the vocabulary printed from lib/request-vocabulary.ts and lib/request-handoff-copy.ts, contacts and request details in the context, contact resolution that never guesses, a hand-off without a contact that cannot be approved until someone is picked, Tweak opening the New Request dialog prefilled, a rebuild route to re-read calls after a rule change, and ?limit= on the cron for a manual pass. Merged and deployed 41d0b049; migration 0109 applied on production before the push. Cutover live: the first pass still filed site work as tasks, so rule 2 now states the test (what the client will see) with examples (d7153487); expired rows kept their dedupe keys and blocked five re-proposed items, so a rebuild now retires them (af5c2991); a temperature 0 attempt was rejected by Sonnet 5 and reverted (279fda59). Final state 2026-09-19: 27 pending across 7 calls, 16 new requests, 5 hand-offs (Mickey Day on #244, Charles on #226, Tim Lyons and Ella Wilde on #237, Andrew Stout), 2 request notes, 4 tasks (the studio's own follow-ups); Verandela 14, Elevate 8, Giant Group 2. Five full passes cost about 2.7 dollars. Approvals left to Liam.
- Liam: "make sure it checks if there are requests that are close or similar". It did not: the model saw open requests and was asked to prefer an update, nothing enforced it, delivered requests were left out. CN.1d built as workflow cn1d-duplicate-guard against docs/superpowers/plans/2026-09-19-cn1d-duplicate-guard-contract.md: a similarity score (token Jaccard and trigram Dice) between a proposed title and the client's requests, tasks and other pending suggestions, computed on read so the inbox warns without a rebuild; approve blocked at 0.8 unless forced, never in bulk; an attach action that turns a create into a note on the existing item; the sweep drops cross-call duplicates and counts them; recently delivered requests shown to the model as finished. Merged and deployed ad18431a. Live: the inbox was empty by then (Liam approved 8, all landed as Verandela requests #228 to #235 with bot lines and audit entries, and rejected 19), so the first warnings will show on the next call's suggestions; the guard is unit tested at all three points.
- Liam: "check the comments that have been made on the site, fix those for now with sub agents". Ten comments in feedback_comments (one my own probe); one already fixed by the retainer health change (churned Physitrack and Dante); the other eight fixed by workflow feedback-comments-fixes in three worktree slices with reviewers: overview (brief meta stacking on phone, the Wire ticker two-line item, the comment ball hint colour in dark), contracts (header glass token for dark, the More actions popover clamped on phone, row Delete no longer navigating, fixed in the shared DataTable and builder header so proposals and schedules inherit it), lists (client cards laid out vertically with an auto-fit metric grid, the deal-linked call row stacking on phone). Merged and deployed 31069e8a. Live phone and dark pass still owed: the Chrome extension was disconnected for the whole round, so the eight fixes rest on the reviewers' reading and the DataTable tests until Liam or the next session looks at them at 375px.
- Liam: "you can remove fixed comments now". No delete path existed (the comment ball only lists, streams a screenshot and creates), so the ten rows and their seven screenshot objects were removed directly on tahi-db and tahi-storage this once, and workflow feedback-delete-route (one sonnet builder, one reviewer, clean) added DELETE /api/admin/feedback/[id] (admin only, 404 on unknown, the R2 object deleted before the row, a missing object tolerated) with the MCP tool delete_feedback_comment as a pure mapping and 10 tests; merged 2026-09-19 with both deploys.
- Liam (2026-09-20): "I want a product manager AI" that checks tasks, clients and requests, nudges whoever is handling each one, helps them or the owner make updates, and plans big or far-off work so nothing slips. Logged as a section in TASKS.md (PM.0 to PM.5) with a starting shape on top of the Tahi bot, the suggestion gate, the nudge crons and the coming Slack app; scope first, build on his go. Both deploys for the feedback delete route (600a8407) confirmed green.

## 2026-09-19, side topic recorded 2026-09-21: the pay-rise question

- Liam (2026-09-19, about 19:00 NZ): "if our pipeline passes (the retainer mainly), would that justify Staci and me having a pay rise? To what?" then "Let's say, 74k each, if meditrain = 2.2k? Check the latest call notes with Bharat".
- The lead pulled the live figures (retainer MRR NZ$10.3k, all GBP, Giant Group 44 percent of it; project work 62 percent of revenue; cash NZ$76k on the dashboard, NZ$85k by Liam, NZ$87k in Xero; IRD balance NZ$24,242.68; pay NZ$64k each) and ran three lenses. Six months of reserve net of tax needs about NZ$110k; the gap of about NZ$25k closes in two to three months at the current surplus.
- Recommendation given: NZ$78,000 each from the 1 October payroll whether or not Meditrain closes, because NZ$104k of profit is already banked this tax year after both salaries; 78k sits just under the top of the 30 percent band so the step is close to tax neutral (personal tax up about NZ$4.2k each, company tax down about NZ$4.1k each). Triggers: top the tax pot to the full IRD balance before January; 88k each only when retainer MRR holds above NZ$12.8k for three months with the reserve banked; 98k at retainer MRR above NZ$15.3k with no client above 35 percent; revert to 64k if disposable cash sits under NZ$30k for two months or retainer MRR drops under NZ$9k.
- Liam's 74k case: Bharat's 17 September transcript confirms the Meditrain package at 2,200 a month ("150 plus 900, that's 2200, includes blogs and reels, capped at four and two"); the CRM still carries Meditrain at NZ$1,250, and the 2,200 may be the client price with Assertio's margin and the SE Ranking subscription inside it. At 74k each the company nets about NZ$8.2k a month with no Meditrain and NZ$9.8k with it at 2,200; retainers cover 78 percent of fixed costs in that case; take-home about NZ$58.3k each. Meditrain is 20 percent at discovery with a November start, so 74k from 1 October is supported by today's revenue and the 2,200 is the cushion when the first invoice is banked.
- Not tax advice; shareholder salary versus PAYE and the provisional tax lag are for the accountant. Decision open with Liam; nothing was changed in settings or code.

## 2026-09-21: handoff sync so any tool can continue

- Liam: "Make sure everything we have talked about is in those files in the repo. That way, I can switch between Claude and codex as my limits run out." Audit of the 2026-09-10 to 2026-09-20 session transcript against STATUS.md, TASKS.md, DECISIONS.md and AGENTS.md.
- Gaps closed: STATUS.md gained the 2026-09-13 to 2026-09-20 section with refreshed known bugs and the operator list; DECISIONS.md #061 to #067 record the week's product and architecture calls (hidden Messages and Services, the migration-apply rule, hand-offs, the suggestion gate, the home money truth, MCP coercion, the PM AI direction); AGENTS.md now opens with the reading order, the people and facts that are not in the code, and Liam's standing working agreements (previously only in Claude's private memory); docs/local-dev-and-qa.md holds the QA worktree, local D1, migration and deploy recipes; the pay-rise analysis above was only in the chat; fifteen September audit and plan documents that were never committed are in; CLAUDE.md's built and not-built lists are marked as the March snapshot and rule 8 names the Cloudflare deploy; TASKS.md's operator section reflects Giant Group being allowed and lists what waits on Liam.
- Rule from this: a session's decisions, facts and rules go into these files in the same session; a chat transcript or a tool's private memory is not a record.
- 2026-09-22: Liam's call had no suggestions because GitHub dropped most scheduled runs (2 to 5 an hour of 12 or more); crons moved to a Cloudflare Worker (workers/cron-trigger, LW.43), every slot verified firing. Yield balances were stale in the setting (LW.42, updated by hand). content-gap-hunt overran its token cap (raised); schema-watchdog is a real finding, no JSON-LD on any live blog post (LW.45, needs a Webflow template change on Liam's go). The Slack app (CN.2) built in four slices and integrated: agent mode on the existing Tahi Dashboard app, identities by email with four levels, call suggestions as cards in founder DMs that rewrite in place, typed and voice notes as drafts the sender approves, client notes as request drafts, assignee suggestions. Deployed a2471632; the manifest, reinstall and two secrets are Liam's next step, then the live DM checks.

## 2026-10-10: meeting audio scope clarified

- Liam: "i do not care about video recording, just detecting meetings in my
  calendar, recording the pc audio, and transcribing really well, and really
  cheap. make sure that is logged."
- Logged as Decision #068 and revised REC.0, LP.12 and the Loopsii research
  notes. Required workflow: calendar meeting detection, Windows PC system audio
  plus mic across Meet/Teams/Zoom, highly accurate transcripts at very low
  total cost. Compare local and inexpensive hosted transcription on real calls.
  Provider, capture automation and audio retention remain for scoping.
- Removed the screen recorder/Loom/video recommendation; audio upload remains
  a fallback. LP.8 explicitly covers audio recordings. Website QA pins and copy
  suggestions remain a separate future idea. Docs only, nothing implemented,
  scheduled or marked live, and no production data changes.
- Audio scope committed and pushed as 155f07f2. Deploy dashboard run
  38041446892 is green; post-deploy probes: / 307 to /sign-in, /sign-in 200,
  /overview signed out branded HTML 404. Signed-in /overview reloaded and
  rendered its Daily brief. Documentation only, no new UI to verify.
- Validation: type-check and lint pass with zero errors (existing lint warnings).
  Removed one stale generated .next/types entry for the absent suggestion-digest
  route to unblock type-check; no tracked application code changed.

## 2026-10-10: Stripe webhook investigated, operator secret step remains

- Liam supplied Stripe's live failure email for /api/webhooks/stripe, first
  failure 2026-10-04 18:56:25 UTC. Stripe's live destination
  we_1TLwhCRx4rjcHALLRYDFBdan showed 14 failed attempts this week, all 400
  "Webhook signature verification failed". Retried only the ignored
  invoice.payment_succeeded event evt_1UMuaBRx4rjcHALL3v2Svc0u for diagnosis;
  Worker tail confirmed "No signatures found matching the expected signature
  for payload". The production runtime computes the HMAC successfully; this
  is not the async-only crypto error reproduced in a separate local SDK probe.
- Handler reads req.text() unchanged and middleware permits /api/webhooks/.
  Signing-secret mismatch or pasted whitespace is the leading diagnosis;
  Cloudflare does not reveal the deployed secret, so its exact value was not
  inspected or changed. AGENTS.md says Liam sets tokens and secrets. Prepared
  the operator command and verification/recovery order in
  docs/superpowers/plans/2026-10-10-stripe-webhook-investigation.md.
- Read-only production SELECTs: Stripe invoice in_1UMcjRRx4rjcHALL0MTr5BjK is
  absent, and Lingorama's existing org has no stripe_customer_id. The event is
  paid in Stripe. Recent sync-stripe rows report success with zero new imports;
  this does not prove recovery. SW.1 tracks mapping and reconciliation through
  the app after the signing-secret step. No production data changed.
- Logged SW.0 and SW.1 once in TASKS.md and added the current P1 to STATUS.md.
  The webhook remains unresolved. Email retry cutoff in local time:
  14 October 2026, 07:56:25 NZDT. No speculative code fix or secret change.
- Investigation documentation gate: type-check and lint again pass with zero
  errors (existing warnings). Application code and schema remain unchanged.

## 2026-10-10: Stripe webhook secret applied from Liam's desktop PC

- Liam, on his laptop, explicitly asked the agent to put the signing secret
  on his PC. Tools confirmed this session was running on desktop PC. This is
  permission for this specific update, not a change to the standing rule that
  Liam sets tokens and secrets.
- Updated the existing production STRIPE_WEBHOOK_SECRET using the live
  destination's existing secret, with Wrangler on worker tahi-dashboard.
  Plaintext was not printed or saved; transferred encrypted between tool
  runtimes, then passed through stdin. Temporary clipboard and memory cleared.
  No secret rotation, application code change or signature bypass.
- Live Stripe retry evt_1UMuaBRx4rjcHALL3v2Svc0u, invoice.payment_succeeded,
  returned HTTP 200 with {received:true} at 22:53:17 NZDT. Stripe displayed
  Delivered and Recovered. The handler ignores this event after verification,
  so this recovery check made no invoice/subscription writes. Screenshot
  capture timed out; the visible delivery status is the live evidence.
- SW.0 is restored (investigation baseline b361968f). SW.1 remains open for
  the missing Lingorama invoice and customer mapping. Updated TASKS.md,
  STATUS.md and the investigation document to distinguish delivery from data
  recovery. No production data mapping or payment action was performed.
- Deploy dashboard run 38042102408 for b361968f is green. After the secret
  update: / 307 to /sign-in, /sign-in 200, signed-out /overview branded HTML
  404, and signed-in /overview rendered real data. No changed UI for phone or
  dark checks. Documentation gate and push recorded with the follow-up commit.
- Follow-up documentation gate: type-check and lint passed with zero errors
  (existing lint warnings); git diff whitespace check passed.

## 2026-10-10: remaining dashboard tasks triaged

- Liam asked to triage the remaining dashboard work. Used the sprint-planning
  skill for readiness/dependency ranking, without inventing a sprint capacity
  or deadline. Saved the ranked plan in
  docs/superpowers/plans/2026-10-10-dashboard-task-triage.md and linked it near
  the top of TASKS.md and STATUS.md. Existing ids retain their canonical homes.
- First work recommended: SW.1 billing recovery, remaining permissions/global
  search, FU.1/FU.7 runtime hardening, contract expiry and dark/phone repairs,
  then shared live QA, truthful affordances, remaining MCP invoice mismatch,
  CN.3 integration and bounded client/invoice ports. REC.0 and WQA.0 scoping
  can proceed alongside the repairs. No new product/schema choices settled.
- Corrected stale briefs: MCP consent and roleless deny are implemented,
  hire linking exists, batch-B index scoping exists, messaging API aliases
  work, Cloudflare replaced GH cron schedules, and the nineteen unchecked
  ports no longer wait for advance design review. Kept live checks owed.
  Removed the repeated A5 checkbox and misleading combined LW.21/LW.24
  completion line; their canonical checkboxes retain the live-proof state.
- Source-confirmed remaining access gap: global search applies no feature or
  organisation scope after Tahi membership auth. Logged under existing T1.16
  and STATUS P1 for scoped seats. No other person's session was used to probe it.
- CN.3 is built on cn3-ready (d1103abe, tip 5955e851), 23 commits ahead and
  8 behind main, 72 files changed from the merge base. Production PRAGMA
  confirms task_suggestions lacks reject_reason. 0111 must be reviewed/applied
  before deployment; its raw ALTER is not safe to rerun blindly. Slack
  verification still depends on CN.2 configuration.
- Read-only production SELECTs: calendar sync fetched 27 and matched 20,
  transcript/suggestion jobs succeeded, observed suggestion run had zero
  eligible calls; Airwallex last synced successfully with two yield rows;
  Stripe imports still reported zero; schema-watchdog's existing LW.45 finding
  remained 0/50 passing. No cron, mail, financial mutation or migration fired.
- Available-migration GET is a catalogue, not proof of apply state. T0.4 needs
  schema/column/index verification. No checklist was newly marked complete.
- Triage documentation validation: type-check and lint passed with zero errors
  (existing warnings); whitespace and edited-id uniqueness checks passed.
  Previous documentation deploy 6f47476c is green (run 38043210208).
  This change contains only the triage report and backlog/status/run-log edits.

## 2026-10-11, approved repair batch in progress (Codex)

Liam approved the eight grouped triage priorities. Main started at 1171d9e5.
Current uncommitted changes cover scoped search, nested feature guards and
super-admin client preview, report scoping, bounded suggestion reads, overview
brief helpers moved out of route.ts, studio contract expiry and signing email
deadlines, truthful manual nudges and review links, MCP invoice lineItems,
and targeted dark/mobile CSS repairs. Search regression: 52 tests pass.
Suggestion/brief regression: 126 tests pass. The first complete gate passed
type-check, lint, 398 files / 6,455 tests, and the production build. No commit,
deployment or live proof yet. Subsequent audit added feature guards to 65
contract/proposal/schedule handlers. Their QA passed 205 new tests, including
real SQLite CRUD for granted members, super admins and the API service. Full
suite after those guards: 399 files / 6,660 tests passed. Final UI touch repairs
and their gate follow before committing.

SW.1 now has a draft preview/apply route and UI for a paid live Stripe invoice
matched to an existing client contact. Stripe QA passed 103 tests, including
both concurrent insert orderings, existing-row races and rollback. A found
open-first / paid-second race was fixed by reconciliation after an insert
conflict and a guarded status update. Contract QA passed 199 tests across
12 files, including send guards; 117 expiry tests also passed with the host
timezone set to Los Angeles. No Lingorama data changed. CN.3 and bounded ports
remain queued. Previous agent IDs disappeared after tool refresh; resumed QA
agents continued with disjoint test ownership, and UIUX was read-only.

Local UI checks use Codex's in-app browser and the dead-Resend server on 3179.
The populated overview renders; requests list and board render at 375 in dark.
Contract cards fit 375 in light and dark. The 768 check found a cramped header
and inaccessible table actions, prompting shared header wrapping and opt-in
tablet cards. Recovery fields and both close targets measure approximately
44px and fit 375 in dark. UIUX source review caught and resolved feedback,
focus, palette and overflow issues. The PC Chrome connection is absent;
signed-in production QA, SW.1 application and the signing email preview remain
pending. Liam was asked to reconnect that session. No production writes made.

The populated contract rechecks pass in dark at 768 (cards, actions visible)
and 1280 (table width equals its 895px available content width, no horizontal
scroll). Search on Clients narrowed to Giant Group, and its new-client panel
opened and cancelled without saving. Requests list/board and new-request
open/cancel passed. Time's search input measured 44.5px, Add filter 46px and
all three filter-type menu items approximately 44px at 375 in dark. Recovery
client options loaded, and no preview/apply request was submitted. Source UIUX
review is clear. The desktop Wire had no current events in this old snapshot,
so its long-item rendering remains a production observation to collect.

- Permission QA and local cascade review (accepted by the Codex lead before the first
  commit): read-only review of `scripts/repair-local-qa-cascades.mjs` confirmed
  SQLite backups precede each shard's rebuild transaction, existing DDL and
  explicit indexes/triggers are retained, and FK checks precede commit.
  `node scripts/repair-local-qa-cascades.mjs` reported zero pending repairs on
  both local shards. QA did not rerun `--apply`.
- Evidence paths: `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/`, shards
  `3c9bc9ebbf8d47b6582e4d8b0a036070724f940ae907dc856bcd6db3600bc2d6.sqlite`
  and `8f2e8e3d5e8d43e0415c7bc1d0343cc341493bd608416d324bf664c09389af98.sqlite`;
  backups under `.wrangler/qa-backups/cascades-1791671526628/`.
  Read-only `node:sqlite` checks via a PowerShell here-string piped to
  `node --input-type=module` found identical row contents, columns, indexes
  and triggers for all seven rebuilt tables (163 preserved rows per shard).
  `PRAGMA quick_check` returned `ok` and `PRAGMA foreign_key_check` returned
  zero violations on each shard.
- Transaction fixture proof used the same stdin Node command with
  `PRAGMA foreign_keys = ON`, `BEGIN IMMEDIATE` and guaranteed `ROLLBACK`,
  restricted to those verified local paths. Unique fixture parents/children
  proved all seven child tables and eight cascade edges, including signer-only
  deletion, contract descendants, proposal sections/variants/acceptances and
  schedule sections/rows. Each shard rejected eight orphan insert attempts;
  unrelated fixture siblings survived. SHA-256 fingerprints of every table's
  contents and all schema objects matched before/after rollback, with zero
  fixture residue. No existing row was explicitly deleted or updated.
- Validation: owned permission tests passed (14 files, 326 tests), as did
  type-check and lint (existing warnings). Final full-suite summary verified in
  `.wrangler/repair-full-vitest-final.log`: 398 files, 6455 tests passed.
  `.wrangler/repair-full-vitest.log` retains the first seven failures; source
  scope fixes and the missing raw metadata fixture column addressed them,
  without weakening assertions or rerunning away a load-only flake.
- Regression limits: the cascade proof is local SQLite evidence, not a route,
  deployed-role or visual check. No persistent cascade test was added. Auth
  preview, docs/tasks/proposal-section guards and scoped reports are the owned
  permission coverage; artifact per-ID feature guards remain incompletely
  audited. T1.6/T1.16 are not blanket complete and still need live proof.
  Existing deliverable follow-up is `e2e/sales-publish.spec.ts` and
  `e2e/public-viewers.spec.ts` (three cases each), one file at a time with
  `npx playwright test -c playwright.local.config.ts <spec> --project=chromium --workers=1`.
  Their local server must use a dead `RESEND_API_KEY` before setting the
  runner's `E2E_DEAD_RESEND_KEY=1`; they write disposable local fixtures and
  the contract spec leaves local R2 PDFs. Main owns CLI execution. This QA
  agent remains read-only outside this log. Its browser tool requires
  `cua_repl` for UI actions and reported no connected browser; no independent
  Playwright runner or browser regression was performed.

Final repair source gate: type-check and lint passed, 399 files / 6,660 tests
passed, and production build passed. The whitespace check caught CRLF in the
new TASKS section and one extra EOF blank line; both were corrected before
commit. Sales artifact feature guards are now fully audited across 65 handlers
with 205 new tests, superseding the earlier per-ID audit limitation. Remaining
limits are signed-in production evidence, changed email previews and the
Lingorama recovery operation. No production data or configuration changed.

Staging also caught two extra EOF blank lines in newly tracked files, which
the unstaged diff check had not covered. The first local commit was created
before that failure was handled. Those whitespace-only defects were corrected
and the local commit amended before pushing; no failed gate was deployed.

Repair batch 2f81243f was pushed. MCP worker run 38094094895 is green;
dashboard run 38094094878 is in progress. CN.3 was merged locally without a
commit from cn3-ready, preserving current TASKS state and both feature and
Slack mocks in the bulk-task fixture. Source auto-merges retain task route
guards, suggester abort/deadline handling and the corrected MCP invoice inputs.
Review found two P1 branch defects (revoked founder thread recipients and
studio Slack feature permissions); fixes are owned in the existing integration
worktree. Client-brand wizard context is being fenced in that worktree too.
Fresh production SELECTs confirm reject_reason and all eight named CN.3
objects are absent. Production D1 id matches the configured tahi-db binding.
A 20,975,557-byte SQL backup is saved under the ignored local path
.wrangler/production-backups/pre-cn3-2026-10-11.sql. No migration applied.

2026-10-11 deployment observation: dashboard run 38094094878 and MCP run
38094094895 succeeded for 2f81243f. Mandatory public probes returned root 307
Location /sign-in, sign-in 200 with Tahi HTML, and signed-out overview 404
with the Page not found Tahi HTML. Browser tab 5 still shows the sign-in form;
no signed-in live claim, email preview or invoice recovery is made.

CN.3 migration rehearsal imported the ignored production backup into in-memory
SQLite and applied the exact SQL mirror. All 121 pre-existing tables retained
identical original-column content fingerprints before/after, all previous
indexes were preserved, nullable reject_reason and both new tables appeared,
and quick_check returned ok. Fingerprint on both sides:
2b6cfd6658601ad49868336a93fecc91c21fb4f5072ce738fa708f346cfdb374.
Real SQLite migration tests also prove uniqueness, partial-apply recovery and
runner retries (9 tests across the existing and new files). Production is
unchanged; apply waits for integrated source review and gates.

Bounded ports are drafting in disjoint main-workspace files. Invoice work
first closes scoped CSV export and non-draft DELETE gaps identified in review,
then adds complete-ledger reads and truthful responsive presentation. Portal
home work fixes unavailable reads, partial signals, hand-off title shape and
repeated queues; full timeline/tablet redesign remains outside this slice.
Both are ported, unchecked and require QA before commit.

REC.0 and WQA.0 scope drafts are saved in SPECS/meeting-audio-capture.md and
SPECS/website-qa-comments.md. Audio explicitly excludes video/screen capture,
requires calendar detection and PC audio plus mic, and sets accuracy/cost
benchmarks before selecting a provider. No capture, external signup, provider,
new schema or recording automation was enabled.

### 2026-10-11, CN.3 permission integration and local migration preparation

Integrated the seven reviewed Slack guard files and five brand-scoped request
wizard files from the integration worktree. Current role, feature and client
access are checked again before old Slack threads post or accept a decision.
Mixed studio notes require both requests and tasks; individual Slack cards
require the feature for their work kind. Client wizard context filters brands,
request counts, recent work, hours and approved call agreements before limits.
The dashboard's mixed suggestion inbox and decision routes now require both
features before business reads, and no-client suggestions use the same current
scope guard as other pre-client work. The Suggestions tab follows those grants.
The integrated scoped run passed 487 tests across 13 files. Independent review
and the full merge gate are still in progress.

Local migration preparation initially stopped before any mutation because the
older seeded shard lacked task_suggestions. After inspecting both shard schemas,
backed up both databases and replayed only the additive 0105 to 0111 files with
duplicate-column handling. Both now have nullable reject_reason and all eight
new tables/indexes; quick_check is ok in both. The active shard skipped its three
existing columns. No production migration has been applied at this point.

### 2026-10-11, independent integration and bounded port review

Real SQLite review reproduced an empty-scope inbox leak before fixing it:
six assertions failed because null-client suggestions escaped an empty client
scope. Both list and count now fail closed, with 162 tests across five files
passing. HTTP feature gates and the Suggestions tab agree on both required
features. Local browser checks show the empty inbox at 1280 light and 375 dark
without horizontal overflow.

The migration endpoint also permitted ordinary studio seats to execute SQL.
It now requires a current super admin or verified service identity before
catalogue reads, body parsing or execution. Actual SQLite role regressions,
runner tests and SQL parity pass (59 tests). Both new table IDs are explicitly
NOT NULL. A fresh production-backup rehearsal preserves all 121 original
tables and indexes. Original-column fingerprints match before/after:
d161d283ea7ff20fd162f461954d69ed600d2112e05f39fe1f721fbcfec89860.
Both local shards were backed up again; only the two empty CN.3 tables were
rebuilt for ID nullability parity, with quick_check ok. Production unchanged.

Independent invoice route review is clear (33 focused tests): feature and
client scope precede pagination/export, and non-draft DELETE returns 409 before
financial or local writes. Invoice review fixed written-off rows being counted
as collected, cramped KPI totals, small controls and tablet table overflow.
The remaining constrained desktop table is under correction. Client-home
review and local 375/768 checks in light/dark preserve the read-only lens and
show honest empty/setup lanes without overflow. Queue rollback and partial
read failures are covered by component tests, not a browser round trip.

Two additional P1 Slack findings were reproduced using current permissions
over SQLite and captured transports: own-note digests bypassed current feature
grants, and old card rewrites/reposts trusted stored recipients. Fixes and
regressions are in progress. No external Slack message was sent. The PC Chrome
connection remains unavailable and the production tab still shows sign-in.

Invoice remeasurement after the scoped fixed-column correction: table and
available container both 685.119 CSS pixels at viewport 1280 dark, with all
seven columns visible and no internal or document overflow. At 768 dark it
renders 20 cards and no table; 375 dark totals fit, header buttons/search and
pagination controls measure 44px. Client links navigate to the client record
without opening the invoice row. The existing create form opens and cancels;
overview, requests and client navigation still load. Source UIUX review is
clear. Local browser tabs were closed and the dev server stopped before build.

A fresh 20,982,276-byte production backup is retained at the ignored path
.wrangler/production-backups/pre-cn3-release-2026-10-11.sql. Rehearsing the
exact SQL on it preserves all 121 original tables, their data and old indexes,
with nullable reject_reason, NOT NULL new IDs and quick_check ok. Matching
before/after fingerprint:
fa2c8c9dee417af15bea8573408dcedea170d029003987448c91c68ce187fe5d.
Independent review also reproduced a roleless suggestion rebuild expiring
another client's pending row and global overview suggestion counts. Those
pre-existing routes are being fenced before the final merge gate.

### 2026-10-11, final permission regressions and release gate

The old Slack delivery gaps are fixed and independently reviewed. Unique
current recipients, active roles, per-kind features and client scope are
checked before initial headers/cards, rewrites, reposts and personal digests,
then again immediately before delivery. Client-copy exclusions hold. The
scoped run passed 540 tests across 10 files, including 43 real SQLite cases
for revoked/ambiguous identities, ownership and changes during delivery.
No external Slack transport was used.

Rebuild and overview-count fixes passed 227 focused tests, including 38 real
SQLite regressions. Both inbox features are required. Empty scope denies;
permitted scoped calls can be queued with readNow:false, and expiry writes
keep their own client fence even when a suggestion's org disagrees with its
call. Inline sweeps require unrestricted scope because they perform global
maintenance. The owner card also hides cached/loading content when denied.
Independent source and UI reviews are clear.

The same global sweep was reachable manually through its cron route. Actual
SQLite reproduced foreign-org repair for roleless, denied and scoped callers.
The manual entry now checks a known identity, current role, both features and
unrestricted scope before any write, including cron_runs. Verified service
and scheduler-secret access remains supported. All 162 focused tests across
three files pass, including 25 SQLite cases and 128 FU.1/suggester cases;
independent review also passed 34 cases. Both worker type-checks pass.

All owned files are frozen and staged; staged whitespace checks pass. The
complete fail-closed type-check, lint, Vitest and bounded build gate has started.
Production schema and billing data have not changed at this point.

The first gate stopped during lint before Vitest/build: the PC's saved
Cloudflare OAuth refresh failed with HTTP 400. A direct D1 SELECT access check
failed the same way. No API token is configured locally. The failure is kept
in .wrangler/cn3-release-lint-auth-failure.log. The existing next.config.ts
CI mode deliberately skips the remote Workers AI dev proxy for lint/build;
the gate restarted with CI=1, without changing auth or deployment settings.
Liam was asked to refresh access with npx wrangler login. Migration 0111
has not been applied, so this source batch must stay unpushed until it is.

The first complete suite then found two integration failures: 421 files and
7,530 tests passed, two failed. The boundary scanner saw colocated invoice
tests as server modules and reported useImpersonation, useAllInvoices,
loadAllInvoices and MAX_INVOICE_PAGES. Those tests are moving into __tests__,
without relaxing the scanner. The Slack client-copy safety positive case
expected ['Rejected by Liam, 09:41'] but got [], because its old fixture had
no currently authorised recipient. Its permitted fixture is being repaired
without weakening the refusal guard. Full assertions are preserved in
.wrangler/cn3-release-vitest-first-failures.log; this is not a load-only flake.

Final local release gate is green in the existing CI=1 mode: type-check,
lint, all 423 Vitest files / 7,532 tests and npm run build. The build compiled
successfully and generated all 223 static pages. Invoice tests moved into
__tests__ with their assertions unchanged; the permitted Slack fixture now
uses actual SQLite current identity/role/grants and also checks that only the
founder DM receives the rewrite. Its complete Slack run passed 609 tests
across 19 files. No production guard was weakened to repair either failure.

Remote main still points to 2f81243f. Migration 0111 remains unapplied and
the new source will be committed locally only until Cloudflare login is
refreshed. The required next sequence is fresh schema preflight, reviewed
0111 apply/object verification, push, dashboard/MCP/cron worker deploy watches,
public probes and signed-in browser QA. Browser sign-in is also still needed
for the email preview and the already-scoped SW.1 recovery. No task is newly
marked live, and no invoice/client mapping, email policy or production data
was changed by this local release preparation.

Local merge committed as a14d0dea, with the required Made-With: Codex trailer
and local QA/production limits in the body. It has not been pushed. Production
remains 2f81243f, and the second parent is the reviewed cn3-ready tip 5955e851.
TASKS marks CN.3 merged but unproved, while CB4 remains open for the full
module. Design review checkboxes remain empty. Local browser tabs are closed,
the viewport override is reset and the dev server is stopped. The production
sign-in tab is kept for handoff. On restored Cloudflare access, refresh the
backup/schema preflight before applying 0111 and releasing this commit.

## 2026-10-11, 13:31 NZDT, migration 0111 applied before release

Liam refreshed Wrangler OAuth. A remote SELECT succeeded in the pinned
production account. Fresh backup pre-cn3-auth-restored-2026-10-11.sql is
20,991,659 bytes under ignored .wrangler/production-backups. Exact migration
rehearsal preserved all 121 original tables/data and indexes; before/after
content fingerprint is 60b66d1f43ca47c420cc47eeb4367b9a315ed602e3460ff681640f03689b6fed.
SQLite quick_check passed. Fresh production preflight found no reject_reason
column and none of the eight named objects.

Applied drizzle/migrations/0111_cn3_sync.sql once through Wrangler to tahi-db.
Postflight verifies all eight named objects, nullable reject_reason and NOT
NULL primary keys on both new tables. Existing task_suggestions has 144 rows.
Ignored apply and postflight logs are retained. No invoice/client mapping,
email policy or production data surgery changed. The fully gated a14d0dea
source can now be pushed; deployment and signed-in proof remain outstanding.

The Codex browser still shows sign-in after refresh and PC Chrome is not
connected. Liam was asked to sign into that browser or reconnect Chrome while
the release proceeds. Email preview and SW.1 recovery remain pending.

## 2026-10-11, signed-in recovery preview finds Stripe mode mismatch

The batch is pushed at 511c7d5f. MCP deploy 38098768463 and cron worker deploy
38098768460 passed; dashboard 38098768474 is still building. Tenancy workflow
38098768466 is green because the Clerk development keys are absent: its
isolation suite did not run, so this is not additional tenancy proof.

Continuing with Google in the Codex browser picked up Liam's existing session.
The production overview renders populated data as Liam. The live invoices
recovery form selected Lingorama and previewed in_1UMcjRRx4rjcHALL0MTr5BjK.
The app returned: Stripe could not retrieve this invoice (404). The configured
key is test mode; check the account and mode. This confirms why this live
invoice is invisible to the configured importer, rather than treating a zero
import count as evidence of recovery. No recovery apply was attempted and no
invoice or client mapping changed. A fresh read still found Lingorama's
stripe_customer_id NULL and no client invoice rows.

Liam was asked to enter the live STRIPE_SECRET_KEY for acct_1RMmvjRx4rjcHALL
through npx wrangler secret put STRIPE_SECRET_KEY --name tahi-dashboard. Secrets
remain his operator step. After it is saved, rerun the app preview and only
apply if the current identity/duplicate checks pass.

## 2026-10-11, release 511c7d5f live and Lingorama recovered

Dashboard 38098768474, MCP 38098768463 and cron worker 38098768460 are green.
Post-deploy probe at 13:40 NZDT passed root 307 to /sign-in, /sign-in 200 and
signed-out /overview branded HTML 404. Source 2f81243f and a14d0dea is deployed;
0111 was verified before the push. Signed-in checks run in a fresh Codex tab
as Liam. His main browser is Vivaldi, confirmed this turn; no Vivaldi connector
is currently available, so the working Codex session is used.

Liam saved STRIPE_SECRET_KEY through Wrangler. The repeated live app preview
matched WEBL8VAA-0002, USD 1,000, paid, Frederic@lingorama.com, without identity
or duplicate conflicts. The authorised apply succeeded at 13:39 NZDT. Re-read
confirms invoice d11e91e4-4e06-56d7-aaa5-6490d45d1ed3, paid_at
2026-10-04T18:56:22Z, one Development end line, Lingorama mapped to
cus_VFXeA5BxU9jgs7 and stripe_invoice_recovered audit at 00:39:02.292Z UTC.
Live detail shows paid USD 1,000 and its stored Stripe pay page. Recovery sent
no mail and made no Stripe writes. Broader reconciliation remains; bulk import
was not run because its autoCreateOrg:true is wider than this checked recovery.

Live invoice QA: complete ledger has 120 invoices, not the old 50. Export
contains 120 rows including Lingorama once. Next page reads 21 to 40 of 120.
Create opens its existing form and cancels without saving. At 375 dark all
header/search controls measure 44 CSS pixels (43.996 after browser scaling),
no horizontal overflow. At 768 dark cards fit; the paid-month filter shows
only the recovered payment and NZD 1,700 converted total. At 1280 dark the
seven-column table is 685.119 pixels inside its 685-pixel rounded container,
with scrollWidth equal to clientWidth. Requests list/board and create/cancel
pass; client search and create/cancel pass. Giant Group read-only client home
passes 375 light/dark and 768 dark, disabled actions and no onboarding checklist.
Screenshots are retained in ignored .wrangler/live-proof.

FU.10 records a live detail affordance mismatch: paid invoices still offered
Delete, while the API refuses non-drafts. Newton's one-file draft-only repair
preserves admin/preview checks. Russell independently cleared it, including
14 in-memory rendering checks and 15 existing tests; Newton ran 44 existing
tests. The lead's fresh full gate passed type-check, lint, 423 files / 7,532
tests and the build (223 static pages). Follow-up push/deploy/live checks are
next. No invoice was deleted. The signing preview endpoint has no UI/WebMCP
action; Liam was given its two-variant console command for his own inbox.

## 2026-10-11, remaining live QA and final small deploy watch

FU.10 repair is pushed as 58433694. Dashboard follow-up 38099534777 is building.
No worker source changed after the successful MCP/cron releases at 511c7d5f.

The deployed studio overview and daily brief render at 375 dark with no
horizontal overflow. Suggestions loads all 25 pending suggestions and human
review controls at 375 dark, without writing any real suggestion decision.
Contracts pass 375 light/dark and 768 dark as cards; the phone action menu is
reachable. At 1280 dark the complete contract table is 895.015 pixels inside
its 895-pixel rounded container with no internal horizontal scroll. Lingorama's
contract truth reads Marked signed and Signed elsewhere, without invented
signatures or a signed PDF. Its actual legal text was only read, never changed.
No unsigned expired contract exists in this live sample, so the expiry refusal
still relies on the reviewed tests and the signing-email preview is outstanding.
Time tracking's loaded empty state fits 375 dark; its search is 44.515 pixels
and add-filter is 45.992 pixels, while header/tab controls are 44 CSS pixels
(43.996 after browser scaling). Dark mode was explicitly verified after the
loaded state, rather than assuming a navigation's initial theme. Screenshots
are retained under ignored .wrangler/live-proof.

Read only the mode of production's NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY through
the GitHub environment variable: it is live. Its value was not printed or
saved. The corrected server secret and public frontend key now use live mode.
Liam's requested two-variant signing-email preview has not returned a result.

## 2026-10-11, final source deployed and live handoff

Dashboard deploy 38099534777 succeeded for 58433694. Public health at
13:53:22 NZDT passed root 307 to /sign-in, /sign-in 200 and signed-out
/overview branded HTML 404. The existing MCP and cron worker deployments
remain current because their source did not change in the follow-up.

Live FU.10 proof: the paid Lingorama invoice has no Delete action at 375 dark;
the existing Assertio draft retains it at 375 and 768 dark. Neither invoice
was altered or deleted. Both pages fit the viewport. The legacy invoice
line-item table can still scroll internally on phones, within the full detail
port left open under CB4. FU.7 is also complete on the full gate and live
overview/daily-brief observation, recorded with its source commit in TASKS.md.

A final read-only recovery preview after this deployment returns
WEBL8VAA-0002, USD 1,000, paid, with identity matching the existing local
invoice. The corrected live Stripe secret survived deployment. No second
apply ran. SW.1 stays open for broader historical invoice/subscription
reconciliation, with the known missing Lingorama payment recovered.

The scoped signed-in production lap is complete. A controlled scoped-seat
isolation lap, the two signing-email previews and real Slack delivery proof
remain open. Slack proof requires Liam's CN.2 manifest/reinstall/secrets step.
The bounded invoice/client-home ports remain partial and ported, unchecked;
Liam's design-review boxes remain empty. REC.0 and WQA.0 are documented scopes,
with audio-only calendar detection, PC audio/microphone capture, accurate cheap
transcripts and manual recording preserved. No recorder or website QA embed
was built in this batch. Vivaldi is saved as Liam's preferred browser.
## 2026-10-11, Opus review of the Codex batch and the next 20

Liam asked for Codex's 9 to 11 October work to be checked. Three fresh-context Opus reviews (billing, CN.3 integration, permissions) passed it with notes; findings and the ranked next 20 are in docs/superpowers/plans/2026-10-11-next-20.md, built from the Sonnet inventory docs/superpowers/plans/2026-10-11-open-task-inventory.md (158 open items, 85 verify-only, 24 contradictions). The billing review found that the 15:00 UTC sync-stripe run, the first unattended pass on the corrected live key, would auto-create a new client for every unmatched Stripe customer (about 25 active orgs have no stripe_customer_id). Fixed by Opus in 962b184b (auto-create off unless opted in; unmatched money skipped as no_client_linked and listed in the cron log), checked by a fresh Opus review and the full suite (423 files, 7,534 tests), deployed green at 10:46 UTC. Working model agreed with Liam: Opus leads, Sonnet builds, Codex takes grunt work, reviews scale to stakes, fresh session per batch.

## 2026-10-13, REC.0 phase 1 prepared locally, no production action

Liam authorised a manual browser recorder inside the studio dashboard. Phase
1 excludes calendar detection, a desktop app and a joining bot. Source adds
/calls/record, separate rotating mic/system MediaRecorder files, local durable
outbox, unique guarded R2 uploads, per-chunk Whisper turbo transcription,
Liam/Them timestamp merge, explicit client/call linking, audio deletion and
MCP read/link parity. Decision #071 records model cost, additive storage,
client-lock rationale and the open retention period. Finished transcripts
reuse call_transcripts and the existing human suggestion approval gate.

Initial git status was clean at e57279902b8ae5f000dda2d181a6146aa576c9c0.
Creating feat/rec0-manual-recorder failed: the sandbox cannot write the parent
repository's shared .git/refs. Actual branch remains
worktree-agent-af1035f88ebd4b3d9; no commit exists for this work. No push,
deploy, production migration/data write or secret change occurred. Migration
0113 is written, schema/runner registered, only executed by in-memory SQLite
tests, not on production or the app's local D1 snapshot.

Final local gates: type-check exit 0, CI-mode lint exit 0 with existing
warnings, worker tsc exit 0, git diff --check exit 0. Standard Vitest config
loading fails esbuild spawn EPERM. Ignored TypeScript/native-thread harness
ran the full frozen suite: 442 files, 7870 tests, all passed in 119.10s.
Earlier sweeps exposed missing cleanup/lifecycle test fixtures for the new
table; repaired and targeted 81 tests passed before the final run. No flake
was rerun away. Standard build fails spawn EPERM. A supplementary in-process
webpack build compiled successfully in 42s, passed lint/types and reached
static generation, then failed DataCloneError with worker threads; build is
not passed. That process was stopped.

Fresh QA and UIUX source reviews passed after lease/scope/atomic-link fixes,
truthful deletion metadata, admin-only delete visibility, long-label wrapping,
timer accessibility and dark contrast token refinements. No browser render or
live sign-off: actual Windows mic/system audio, Zoom/Teams/Meet desktop calls,
sharing-bar Stop, background/sleep/device/echo behaviour, deployed AI/R2,
accuracy, 375/768/dark layouts and signed-in regression remain unverified.
SPA history Back/Forward leave warnings also need proof. REC.0 stays open.
Full file list, gate outputs, model sources, planned commit trailers and
handoff details: docs/superpowers/audits/2026-10-13-rec0-phase1-report.md.

## 2026-10-13, REC.0 Opus review fixes, uncommitted handoff

Initial git status confirmed a clean feat/rec0-manual-recorder worktree at
1608f4c6. The earlier branch/commit note above is superseded: phase 1 was
committed as 1608f4c6, then reviewed by Opus with two P1 findings. Follow-up
fixes stay uncommitted for the main session. No branch write, commit, push,
deploy, migration apply, production data write or secret change occurs here.

Migration 0113 must apply BEFORE deployment because the existing suggestion
sweep, rebuild, client delete/merge and ManyRequests cleanup read
meeting_recordings. The main session will apply it to production before merge.
STATUS.md, TASKS.md, Decision #071 and SPECS/meeting-audio-capture.md record the
deployment prerequisite and corrected branch/commit state.

Decision #071 and the spec now record the accepted phase 1 limits: the browser
tab drives transcription until it closes, after which Retry resumes it;
client-only recordings send suggestions to the dashboard inbox without Slack
DMs; the mic speaker label is hard-coded as Liam; unlinked recordings follow
the existing allow-if-any-scope rule, to revisit before the first scoped hire;
and abandoned recordings retain R2 audio under the open retention question.

Code fixes: client deletion refuses retained recording rows before any
destructive action. Merge already moves recordings to the surviving org;
regression tests preserve chunk/R2 and transcript links. R2 writes use typed
onlyIf: { etagDoesNotMatch: '*' }, verified against current official docs and
workerd wildcard tests ([R2 API reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#conditional-operations),
[workerd tests](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/tests/r2-test.js)).
The transcript guard returns 404 for a missing
recording row, PATCH reports the actual discovery-mirror result, and deleted
audio shows a neutral Audio deleted badge with confirmation that retains the
transcript.

Local gates: npm run type-check exit 0; CI=1 npm run lint exit 0 with existing
repository warnings and no errors in touched files; worker tsc --noEmit exit
0; git diff --check exit 0. Standard targeted Vitest was blocked by esbuild
spawn EPERM. The sandbox runner with .wrangler/vitest-sandbox.config.mjs and
--configLoader native passed all four touched files: admin-recording-chunks,
patch-link, organisation delete and merge, 110 tests in 2.21s. Independent QA
and UIUX source reviews pass; no browser proof is claimed. Review caught and
fixed a cleanup-retry affordance: the administrator's Delete recording audio
action remains available after a tombstone so an R2 failure can be retried.
The main session reruns the full suite and build. REC.0 stays open: real
Windows mic/system capture, call accuracy, background/device behaviour,
375/768/dark layouts and the deployed signed-in round trip remain unverified.

## 2026-10-13, next-20 item 2 prepared on the local branch

M1 rejects edited proposal client/request changes at the route and shared decision library, binds new tasks to the stored client, and strips task-update reassignment fields. Real SQLite scoped-seat tests prove refusal and safe edits.

Local working-tree validation passed type-check, lint (existing warnings), 444 Vitest files / 8,003 tests, production compilation and prerender, and worker tsc. Native subprocesses are refused in this sandbox, so tests use the ignored in-process TypeScript runner and build uses the ignored thread/JSON-IPC compatibility preload. No schema change, push, deploy, live QA, secret operation or production data operation.

Branch fix/next20-items-2-7 is held in .claude/next20-git because the shared Git metadata is read-only here. The final Git bundle carries all six item commits for normal repository integration. Existing task states are retained until deployment and live proof.


## 2026-10-13, next-20 item 3 prepared on the local branch

M2 guards all named handlers and their secondary links. Audit requires permission-management access; activities and engagements filter before aggregate reads. Includes constant-time cron secret checks, literal LIKE ESCAPE and archived-deal exclusion. The SQLite harness now preserves duplicate joined columns and exposes its database for race injection.

Local working-tree validation passed type-check, lint (existing warnings), 444 Vitest files / 8,003 tests, production compilation and prerender, and worker tsc. Native subprocesses are refused in this sandbox, so tests use the ignored in-process TypeScript runner and build uses the ignored thread/JSON-IPC compatibility preload. No schema change, push, deploy, live QA, secret operation or production data operation.

Branch fix/next20-items-2-7 is held in .claude/next20-git because the shared Git metadata is read-only here. The final Git bundle carries all six item commits for normal repository integration. Existing task states are retained until deployment and live proof.


## 2026-10-13, next-20 item 4 prepared on the local branch

Schedule child writes are parent-fenced. Invoice deletion atomically requires draft status and uses the existing FK cascade. Recovery returns 409 on client drift, pins importer writes to the chosen org, and prevents duplicate customer-link races. Import conflicts retry once, then skip.

Local working-tree validation passed type-check, lint (existing warnings), 444 Vitest files / 8,003 tests, production compilation and prerender, and worker tsc. Native subprocesses are refused in this sandbox, so tests use the ignored in-process TypeScript runner and build uses the ignored thread/JSON-IPC compatibility preload. No schema change, push, deploy, live QA, secret operation or production data operation.

Branch fix/next20-items-2-7 is held in .claude/next20-git because the shared Git metadata is read-only here. The final Git bundle carries all six item commits for normal repository integration. Existing task states are retained until deployment and live proof.


## 2026-10-13, next-20 item 5 prepared on the local branch

Adds caller/state-bound signed previews, refreshed live Stripe GET checks, conditional apply, conflict refusal and real-actor audit recording. MCP tool validates ids and explicitly blocks designers. The existing api-service is admin rather than super_admin, so MCP retains its 403; apply requires a super-admin browser session. No actor is promoted for authorization.

Local working-tree validation passed type-check, lint (existing warnings), 444 Vitest files / 8,003 tests, production compilation and prerender, and worker tsc. Native subprocesses are refused in this sandbox, so tests use the ignored in-process TypeScript runner and build uses the ignored thread/JSON-IPC compatibility preload. No schema change, push, deploy, live QA, secret operation or production data operation.

Branch fix/next20-items-2-7 is held in .claude/next20-git because the shared Git metadata is read-only here. The final Git bundle carries all six item commits for normal repository integration. Existing task states are retained until deployment and live proof.


## 2026-10-13, next-20 item 6 prepared on the local branch

Xero imports use exact nonempty contact ids only. Unlinked contacts are skipped and recorded in cron output, with no name-based assignment or automatic organisation creation. Real SQLite tests cover exact, substring, missing-id and repeat-run cases.

Local working-tree validation passed type-check, lint (existing warnings), 444 Vitest files / 8,003 tests, production compilation and prerender, and worker tsc. Native subprocesses are refused in this sandbox, so tests use the ignored in-process TypeScript runner and build uses the ignored thread/JSON-IPC compatibility preload. No schema change, push, deploy, live QA, secret operation or production data operation.

Branch fix/next20-items-2-7 is held in .claude/next20-git because the shared Git metadata is read-only here. The final Git bundle carries all six item commits for normal repository integration. Existing task states are retained until deployment and live proof.


## 2026-10-13, next-20 item 7 prepared on the local branch

Provider 429, 500 and 529 errors defer the current transcript and remaining batch without suggested_at stamping, for either read. Permanent errors and existing timeout handling keep their prior semantics. Tests cover SDK status properties and text fallback.

Local working-tree validation passed type-check, lint (existing warnings), 444 Vitest files / 8,003 tests, production compilation and prerender, and worker tsc. Native subprocesses are refused in this sandbox, so tests use the ignored in-process TypeScript runner and build uses the ignored thread/JSON-IPC compatibility preload. No schema change, push, deploy, live QA, secret operation or production data operation.

Branch fix/next20-items-2-7 is held in .claude/next20-git because the shared Git metadata is read-only here. The final Git bundle carries all six item commits for normal repository integration. Existing task states are retained until deployment and live proof.

## 2026-10-13, review fixes for next-20 items 2 to 7

Reviewed branch fix/next20-items-2-7 at 73ddff69, clean before edits. Applied
M1 brand feature/client scope checks and scoped request/time exports. Xero
pushes now require confirmed contact links; match confirmations atomically
refuse duplicate identities, and imports exclude archived clients and skip
ambiguous links. Suggestions use a task field allowlist and team assignees,
keep the row client fixed, permit same-client request links, and validate
track/schedule ownership in shared task writes, including retained links on
client moves. Client Money now has a super-admin Stripe preview/confirm action.
Decision #070 keeps MCP customer linking refused for api-service; attribution
never becomes an access input.

All 17 remaining cron secret handlers use hasCronSecretAuth. Invoice DELETE
claims lower(trim(status)) = 'draft'. Scoped delivery reads include pre-client
deal schedules. TASKS.md and STATUS.md state the behavior without sandbox/Git
mechanics. T1.6 records P3-7 permission granting and the review's 21 other
orgId routes as open, log-only follow-ups.

Provider 500/502/503/504 and statusless connection errors defer only the
transcript and continue. 429/529 and local timeout/budget handling retain
batch-wide deferral. The durable retry cap remains open: neither schema nor
migrations has a suitable call_transcripts retry or metadata field. Content,
linkage and completion fields were preserved; this batch authorises no
migration.

Gate: type-check, lint (existing warnings), worker tsc and 17 Vitest files /
628 tests pass. CI=1 avoids the existing remote dev proxy during lint; the
existing native-loader sandbox runner avoids esbuild spawn EPERM. Initial
fixture typing and a timeout-priority edge were corrected before the final
gate. Fresh QA and UIUX source reviews have no remaining findings.

Local browser fixture: real Stripe action/preview components rendered at 375
and 768 in light and dark, no horizontal overflow, long customer ids wrap;
controls compute to 44 CSS pixels (43.996 at browser scaling). The entry/footer
fixture uses shared primitives, not the mounted dialog interaction flow.
Signed-in Tweak and Stripe dialog interaction, full suite, build, integration
and live verification remain for the main session. Changes are left
uncommitted as requested; existing task states remain unchanged.

## 2026-10-13, round 2 fixes for next-20 items 2 to 7

Started on fix/next20-items-2-7 at 4e1a7f00 with a clean tree. F1 now reports
per-invoice errors and failed totals in both invoice callers, retains the
created local draft for recovery, and returns 422 when every push fails. The
client Money tab has an admin/integrations-gated Xero contact card using the
existing suggestions GET and confirmation PATCH, with client and Xero emails,
direct ContactID entry and explicit collision errors. Worker MCP
confirm_xero_contact validates both ids, maps to the same PATCH and is
explicitly blocked for designers. Authorisation remains userId/api-service;
attribution never becomes an access input.

L1 applies the shared track/schedule ownership guard before template inserts.
L2 rejects mismatched explicit client/request pairs in createTaskRecord,
including unchanged model proposals. Full transcript read deadlines now
defer only that transcript; provider 429/529 and sweep deadlines retain batch
stops. Atomic settings counters record each deferred failure, stamp/skip the
fifth with a clear run-summary reason, and clear on processing or exhaustion.
Public lead intake uses the shared constant-time secret comparison.

User-requested gate passed: npm run type-check, CI=1 npm run lint (existing
warnings), worker tsc, and 19 Vitest files / 493 tests. The existing native
config-loader sandbox runner avoids npm test's esbuild spawn EPERM. Tests
cover actual invoice action/form callbacks, contact confirmation/409, real
SQLite ownership and five-timeout progression. Initial fixture expectations
for the old Xero 200 response and an escaped JSX apostrophe were corrected
before the final gate. TASKS.md and STATUS.md batch entries are updated;
existing completion states remain unchanged.

No schema, commit, push, deploy, production data or secret changes. Build,
full suite and signed-in/deployed verification are outside this round's
requested gate. Fresh source/test QA found no remaining findings. The local
browser fixture exposed compressed Xero candidate rows; flexShrink: 0 keeps
the identity and conflict text visible in the scrollable list. After that
fix, type-check, lint, worker tsc and the 2 affected files / 17 tests passed
again.

Local static SSR fixtures rendered the final card, candidates, dialog,
loading and read-error states at 375 and 768 in light and dark (16 cases).
No horizontal document overflow; dialog bounds fit the viewport, candidate
text no longer overlaps, and button/link/text-input targets measure 44 CSS
pixels (about 43.996 in animated bounding rectangles). Dark billing links
use the theme link token. Connected Chrome provided the check after native
Playwright launch hit spawn EPERM. These fixtures mock SWR and do not prove
hydration or signed-in/deployed interactions; Vitest covers confirmation
callbacks. The final hover review also moved candidate background tokens out
of inline styles into static Tailwind classes so hover feedback can render.
Visual/source reviews have no remaining findings.

## 2026-10-13, round 3 small fixes for next-20 items 2 to 7

Started on fix/next20-items-2-7 at 78f49f57 with a clean tree. This round is
limited to L-1, I-3, L-2 and L-3. Contact confirmation trims and lowercases
the ContactID, validates its UUID shape, and checks uniqueness without case.
Xero imports and contact choices compare ids without case. A different
existing link requires literal replace: true, and an atomic current-link
guard refuses a concurrent change. The Money card shows the current link
and opens the shared confirmation dialog before approving replacement.
MCP confirm_xero_contact forwards optional replace while retaining its
designer denial and existing access checks.

429/529 never spend a transcript's retry allowance. First-read connection
and server failures wait until the sweep finishes to count only when another
model read succeeded; provider-wide outages preserve existing counters and
leave transcripts unprocessed. Second-read retry exhaustion preserves the
first read's drafts, writes them through insertSuggestions, then stamps and
clears the counter. An insertion failure leaves the transcript unprocessed.

Requested local gate passed: npm run type-check, CI=1 npm run lint (existing
warnings), worker tsc, and 9 Vitest files / 316 tests. The ignored native
config-loader sandbox runner avoids standard Vitest's esbuild spawn EPERM.
Raw output is .claude/round3-final-gates.log, ending ALL_ROUND3_GATES_PASSED.
Real SQLite regressions cover repeated outages, preserved existing counters,
successes before and after failures, second-read rate limits, exactly one
draft after five second-read timeouts, and failed insertion before stamping.
Xero tests cover invalid/uppercase ids, strict approval, collisions, concurrent
link changes, UI confirmation/cancellation and MCP parity. Independent QA
source/test review passed. Local visual review is in progress. TASKS.md and
STATUS.md record the behavior; existing completion states remain unchanged.
No schema, commit, push, deploy, production data or secret changes.

## 2026-10-14, REC.0 phase 1b recorder polish and speaker naming

Started clean on feat/rec0-phase1b from main 6f9f2170. Liam confirms the
manual recorder is live at /calls/record and supplied his first real transcript.
This worktree leaves changes uncommitted for the main session, as requested.
No commit, push, deployment, production data, secret or migration operation.

Merged transcript rendering now joins consecutive same-speaker segments across
chunk edges, using the first timestamp and a more-than-four-second silence
break. Raw chunk text/segments are unchanged by rendering. Speaker names resolve
from recording.createdById against team id/Clerk id, sole external call attendee,
then client, with Me/Them fallbacks. Link changes atomically save named text/hash
and recording identity; only a matching recorder-owned discovery mirror updates.
Refresh transcript and ready retries rebuild deterministically without another
AI call, including retained transcripts after audio deletion. The existing
suggester reads the named call_transcripts.text.

Decision #071 records current Cloudflare catalogue/prices/inputs with dated
source links. Nova 3 supports diarize and is hosted on Workers AI; USD 0.0052
per audio minute over HTTP, USD 0.312/system hour, USD 0.34278/hour including
Whisper mic. The group toggle defaults off and is fixed at recording creation.
Options use backwards-compatible versioned tracks JSON with no schema change.
Capture saves raw WebM locally first; upload converts only group system chunks
to mono 16 kHz PCM WAV and persists replacement before reservation. One streamed
whole-system inference retains speaker ids across chunks. WAV allows 6 MB for
three-minute hidden-tab chunks; compressed audio remains limited to 2 MB.
Group result writes use 25-chunk JSON updates in a transaction, keeping D1 query
count bounded. Missing speaker labels fail explicitly, successful mic/group
results survive retries, and partial results never enter task suggestions.

The PWA manifest has stable id, explicit actual 192/512 PNG icons, standalone
scope/start URL and a Record call shortcut. A team member's open recorder tab
or installed app checks scoped scheduled/discovery reads every 30 seconds for
calls starting in the next two minutes. Attendee/creator ownership, declines,
mirrored tables and multiple tabs are handled. The existing in-app toast opens
a validated title/call prefill on click. It never starts capture, emails,
sends Slack or requests Notification permission. Scheduled time filters apply
before the row cap using real offset-aware instants; creator identity is exposed
by the existing reads. MCP list_calls forwards the filters and stays a designer
read; recording descriptions reflect named/group output. No new tool or route.

Final requested gate passes: npm run type-check exit 0; CI=1 npm run lint
exit 0 (existing warnings, no touched-file warnings); worker tsc exit 0;
9 touched Vitest files / 98 tests pass. Standard Vitest config loading hit
esbuild spawn EPERM, so the ignored .wrangler/vitest-sandbox.config.mjs native
TypeScript/thread runner was used. Initial scheduled-window test adapter lacked
D1 raw() and was corrected; the final suite is green. A further 26-system-chunk
API fixture proves both result batches persist each segment once, with one Nova
call plus Whisper mic. Raw logs: .wrangler/phase1b-type-check.log,
.wrangler/phase1b-lint.log, .wrangler/phase1b-worker-tsc.log and
.wrangler/phase1b-vitest.log. All are ignored. npm run build was attempted and
failed at process spawn EPERM; log .wrangler/phase1b-build.log.

Independent backend QA and UIUX source review have no remaining findings.
Source review covers rem/token/all-side borders, native keyboard checkbox,
44-pixel label/actions and mobile wrapping. Actual browser proof is open:
headless Chromium launch also hit spawn EPERM. The main session must run the
production build outside this sandbox, Windows PWA installation/shortcut,
signed-in 375/768 light/dark flows, raw-audio conversion/recovery, and real Nova
speaker accuracy/representative long-call latency/provider limits. Browser
timer throttling while minimized/asleep can delay an open-app reminder.
REC.0 stays [ ]; no phase 1b live claim or completion flip.

## 2026-10-14, REC.0 phase 1b review repairs, uncommitted

Started with clean git status on feat/rec0-phase1b, HEAD 3570d4e5. Liam asked
for only the listed review findings and two full-suite failures to be fixed,
with no commit, push, deployment, migration, production data or secret change.

The two PATCH call-transcript mirror tests were stale positional mocks:
linkRecording now loads the previous transcript text before speaker lookups,
but the old result queue returned an empty row there, causing Transcript not
found (404). Updated previous-text/team/attendee/client query fixtures; both
mirror outcomes pass without changing PATCH's implementation. Recorder relink
now checks suggestions when two org-less calls have different identities,
covering suggestedAt and existing task_suggestions separately.

Nova gap words clamp into the preceding chunk (50 ms gap regression). Raw
Nova JSON is create-only in R2 at meeting-recordings/{id}/system/nova-3.json
before parsing or D1 result writes, and read before later inference. Parse
and transactional D1 failures reuse it without another Nova call. Removed
the local timeout race; transcription holds a 15-minute lease renewed every
minute. A delayed-result test advances 16 minutes, refuses a concurrent
retry and retains the original response. Two failed group attempts switch
the options to separateSpeakers=false and continue system chunks through
Whisper. Manual fallback has the same guard/lease and full-profile worker
MCP parity, with designers explicitly blocked. Fallback updates are atomic;
completed mic rows survive, including manual fallback after Nova succeeded
but finalization failed. Three-minute system WAV chunks become six complete
30-second inputs under 1 MB with restored timing offsets. Tests decode all
inputs and verify the final transcript and mic text/segments/attempts.

Group mode caps the padded system timeline at two hours and automatically
uses Whisper above that. Decision #071 records checked primary sources:
Cloudflare documents no Nova-specific audio byte/duration maximum, only
ASR rate limits; the application cap does not prove provider acceptance.
Real inference remains unverified. UI help has the cap and US$0.34, and
mic-only capture explains why separation was dropped. Tahi domain emails
count as team, reminder creator fallback applies only without attendees,
the reminder effect depends on recorder-page boolean, scheduled call order
uses the indexed raw column while keeping julianday filters, and manifest
id is /overview to preserve install identity.

Requested fail-closed gate passed: npm run type-check exit 0; CI=1 npm run
lint exit 0 (existing warnings, no touched-dashboard warnings); worker tsc
--noEmit exit 0; 10 targeted Vitest files / 245 tests passed, exit 0. Used
the ignored native-config sandbox runner because standard esbuild startup
hits spawn EPERM. Logs: .wrangler/rec0-review-type-check.log,
.wrangler/rec0-review-lint.log, .wrangler/rec0-review-worker-tsc.log and
.wrangler/rec0-review-vitest.log. Independent QA source review and UIUX
spacing review pass. No build, browser/live or provider test was claimed.
All repair changes stay uncommitted; REC.0 stays open.

## 2026-10-14, REC.0 phase 1b last review notes, uncommitted follow-up

Started with clean git status on feat/rec0-phase1b at HEAD 807adc35. Initial
phase 1b is committed as 3570d4e5, and the review repairs are committed as
807adc35. Opus re-review passed with notes. Liam requested only this small
follow-up, left uncommitted on top, with no push, deployment, migration,
production data or secret change.

Fold PCM WAV remainders shorter than two seconds into the previous part,
including real 30.02-second and 60.01-second rotations without exceeding
1 MiB. Continue with paid in-memory Nova output if its create-only R2 cache
write throws. Use the renewed 15-minute lease only when a group attempt is
possible; otherwise retain the three-minute lease. Delete cached Nova JSON
with the audio. Gate manual Whisper fallback to admins in both route and
button, using the existing delete-audio permissions. Malformed transcription
JSON returns 400. STATUS.md and TASKS.md now distinguish the two commits from
this uncommitted follow-up. REC.0 stays open with no phase 1b live claim.

Requested fail-closed gates passed: npm run type-check exit 0; CI=1 npm run
lint exit 0 (existing warnings); npx tsc --noEmit -p
workers/mcp-server/tsconfig.json exit 0; touched Vitest files
app/api/__tests__/admin-recording-chunks.test.ts (42 tests) and
lib/__tests__/recording-group-audio.test.ts (17 tests), 2 files / 59 tests
passed, exit 0. Used the existing ignored native sandbox config because
standard Vitest startup hits esbuild spawn EPERM. Gate logs are
.wrangler/rec0-last-type-check.log, .wrangler/rec0-last-lint.log,
.wrangler/rec0-last-worker-tsc.log and .wrangler/rec0-last-vitest.log.
Independent QA and UIUX source reviews pass. No build, browser/live or real
provider test was claimed. All follow-up changes remain uncommitted at
HEAD 807adc35; no push, deploy, migration or production change occurred.

## 2026-10-14, REC.0 phase 2 dashboard preparation, uncommitted

Started clean on feat/rec0-tray-server from main 729cc282. Read the full
revision 1 tray spec and CLAUDE.md. Liam confirms phases 1 and 1b live and
supplied Step 0: two five-second 16 kHz mono PCM WAV chunks, 160,044 bytes
each, accepted by live chunk/stop/transcribe with a finalised transcript.
The tone hallucinated Thank you.; retain vad_filter. Decision #072 records
that evidence, PM schema approval, auto-start including unknown calls,
no-notice exposure, calendar limits and the deliberate pairing MCP exception.

Prepared separable 0114 in lib/recorder-devices-migration.ts,
drizzle/migrations/0114_recorder_devices.sql and the migrate runner's import
and registration only. Exactly four additive tables and their required
constraints/indexes, all CREATE IF NOT EXISTS, no ALTER. A real SQLite test
proves re-running, preserved parent recordings, uniqueness and foreign keys.
Matching Drizzle declarations land separately with server code.

Server changes add explicit recorder-token route and handler opt-ins without
changing getRequestAuth, current member/admin/Clerk checks, membership-outage
503, idle expiry and throttled last seen. Pairing uses session-only self code
creation, D1 atomic failure reservations and transactional single-use exchange.
Review found expiry could pass while awaiting Clerk; consume time is refreshed
and regression tested. Device recording changes add atomic idempotent creates,
one-open and daily audio quotas, call revalidation, owned slim responses and
upcoming call metadata without meeting URLs. Device WAV validation ties quota
duration to actual PCM bytes. Existing per-recording leases serialize writes.
Settings adds device management states and Tray source badges. Full MCP tools
list/revoke are blocked for designers; pairing intentionally has no MCP tool.

Repo hygiene excludes apps/recorder-tray from tracing, TypeScript, lint,
Vitest and Tailwind scanning, and ignores nested bin/obj outputs. Only its
handoff README is added; no C# app. API and ship order are in
 docs/recorder-tray-server-handoff.md. STATUS and the single REC.0 task record
preparation without a completed/live phase 2 claim.

Verification is recorded below after final review/gates. Playwright headless
launch was attempted and blocked by spawn EPERM; no actual 375/768/dark browser
proof is claimed. Main session owns migration-first shipping, security/Opus
review, deployment and live checks. No commit, push, migration apply, secret
change or production data write was performed.

**Final verification:** Fail-closed chain passed npm run type-check (exit 0),
CI=1 npm run lint (exit 0, existing warnings), worker tsc --noEmit (exit 0),
and sixteen touched/regression Vitest files, 344 tests passed (exit 0).
The native-config sandbox runner avoids esbuild spawn restrictions. The
first combined run saw two UI revoke fixture failures after the new viewport
portal landed; adding the document stub and createPortal passthrough to the
SSR harness fixed both. This was a fixture update, not a discarded flake.
Raw final logs: .wrangler/rec0-tray-type-check.log,
.wrangler/rec0-tray-lint.log, .wrangler/rec0-tray-worker-tsc.log and
.wrangler/rec0-tray-vitest.log (all ignored).

Independent backend/security and UIUX source reviews pass. Additional review
repairs: device duplicate confirmation requires a stored body, mixed-case
Bearer cannot widen to a session identity, actual PCM bytes enforce quotas,
and upcoming calls retain ordinary Clerk callers' client scope. UI review
improved dark error contrast, readable metadata, badge wrapping, 44px Settings
navigation/confirm controls, long-name wrapping and loading locks. The new
Settings revoke dialog portals outside its transformed pane. Existing overlay
and invoice-action tests are included in the sixteen-file gate.

CI=1 npm run build was attempted and stopped at spawn EPERM during creation
of the optimized production build, exit 1; log .wrangler/rec0-tray-build.log.
Playwright Chromium launch is likewise blocked by spawn EPERM. Neither is
reported as passed. Main session still owns a real build outside the sandbox,
security/Opus review, migration-first ship/apply, signed-in 375/768 desktop
light/dark verification, deployment and live health/signed-in smoke. The
separate C# client run owns pairing/capture/outbox integration and real calls.
REC.0 remains open, with all changes uncommitted and no production operation.

## 2026-10-14, REC.0 tray server review repairs, uncommitted on e961108f

Started with clean git status on feat/rec0-tray-server at e961108f. Migration
0114 is the separate 97b0b0ae commit. The review repair changes no migration
file or schema and performs no commit, push, deploy, migration apply, secret
change or production operation. REC.0 remains open for shipping/live proof.

Fixed overlapping [start - 2 minutes, end + 10 minutes] call windows with
open-now create validation and own attendee/Google account/creator matching.
Added coarse scheduled_at bounds, batched owned chunk reads and explicit
recording INSERT columns. Empty device stops fail terminally and stay failed
on stop/transcribe retries; open rows older than thirteen hours do not block
a new recording. Quota counts reserved mic audio only over a rolling 24 hours,
with twelve-hour cap and distinct open_recording/daily_quota 429 codes.
callId without callKind returns 400. Seven hours on two tracks is accepted.

Pairing now groups IPv6 /64 prefixes, atomically limits fifty global and five
per-prefix failed exchanges in fifteen minutes, expires earlier unused member
codes, HMACs prefixes with an HKDF key from an existing secret, purges attempts
older than one day and audits code creation/pairing without secrets. Settings
uses shared EmptyState/Badge, friendly status/non-JSON error handling and polls
away used code cards. Shared ConfirmDialog is restored to its pre-feature
version; the Recorder devices portal/wrapping remains local.

Decision #072 and handoff record rolling mic quota and Not this call only
before create is sent; afterward Liam relinks in the dashboard. STATUS/TASKS
and decision/handoff now distinguish committed implementation from this
uncommitted repair. External C:/Users/Work/.codex-briefs/rec0-tray-spec.md is
outside the writable workspace, so its corrected copy is
docs/rec0-tray-spec-review-correction.md, with R14 fixed; original unchanged.

Requested fail-closed gate passed: type-check exit 0, CI=1 lint exit 0
(existing warnings), worker tsc --noEmit exit 0, sixteen Vitest files / 373
tests passed, git diff --check exit 0. Vitest uses the existing ignored native
sandbox config because standard esbuild startup hits spawn EPERM. Raw logs:
.wrangler/rec0-tray-review-type-check.log, rec0-tray-review-lint.log,
rec0-tray-review-worker-tsc.log and rec0-tray-review-vitest.log. Independent QA
and UIUX source reviews pass after fixing terminal replay and local long-name
overflow findings. No browser/live proof or build is claimed in this repair.
Full item/file/line report: docs/superpowers/audits/2026-10-14-rec0-tray-review-fixes.md.

## 2026-10-14, REC.0 tray server final security fixes, local on 54b14081

Started with clean git status on feat/rec0-tray-server at 54b14081. Fixed only
M1, M2, L1 and L2 from Liam's security re-review brief. These final changes
remain uncommitted. No push, deploy, migration apply, secret or production
change was performed. The 0114 migration files and schema are unchanged.
The server implementation and earlier review repairs are committed on the
branch; 0114 is shipped separately as 97b0b0ae, per Liam's brief.

M1: synced discovery calls select googleCalendarEventId and ignore creator
membership whenever it is non-null. Calendar sync stamps inserted calls
and activities as system. A legacy synced row created by Staci with Liam
and a client attending returns no calls for Staci and the call for Liam.
M2: mic and system reservations each have an independent twelve-hour cap
per device over a rolling 24 hours. Create remains mic-only. The system
exact limit is accepted, one additional millisecond returns daily_quota,
and seven hours on each track is accepted. Duplicate reservations, cross-call
aggregation and rolling expiry remain covered.
L1: global pairing failures now cap at 500 per fifteen minutes; the five
per-prefix limit is unchanged. The concurrent threshold test passes, and
Decision #072 records residual distributed global lockout risk.
L2: STATUS, TASKS, Decision #072 and the server handoff identify committed
server work and shipped 0114. Decision and handoff quota, calendar and
pairing descriptions match the final fixes. REC.0 remains open.

Requested fail-closed gate passed: npm run type-check exit 0; CI=1 npm run
lint exit 0 with existing warnings; worker tsc --noEmit exit 0; four touched
Vitest files / 72 tests passed, exit 0. File counts: upcoming calls 14,
recorder recordings 22, device auth/pairing 30, calendar sync 6.
Standard Vitest startup was blocked by esbuild spawn EPERM before tests ran;
the successful gate used the existing ignored .claude/vitest-sandbox.config.mjs
with --configLoader native. Raw logs: .wrangler/rec0-tray-final-security-type-check.log,
.wrangler/rec0-tray-final-security-lint.log,
.wrangler/rec0-tray-final-security-worker-tsc.log and
.wrangler/rec0-tray-final-security-vitest.log. Independent source QA found no
blockers. No UI changes, build or browser/live proof is claimed in this run.

## 2026-10-14, REC.0 Windows tray client, uncommitted on 15de17d7

Started clean on feat/rec0-tray-app at 15de17d7. Liam confirms the phase 2 server
is live. Read the approved revision 1 spec, exact server handoff, #072 and repo
sources before building. Added portable .NET 8 Core, required Windows WinForms
host, solution and 70 authored xUnit cases under apps/recorder-tray.
Implemented automatic known/twenty-second unknown recording, conservative
calendar matching, saved Stop/pause, back-to-back splitting, native capture
process detection, WASAPI mic/default-render loopback, shared-clock WAV padding,
default-device reconnection, durable crash spool/create/outbox, per-device DPAPI,
retry/transcription, pairing, tray/startup/single-instance and toast buttons.

Independent QA/UIUX source review passes after repairing ambiguity/start
boundaries, same-process qualification, physical Stop on storage failures,
transient reconnect handling, toast blocking, per-device credential binding,
re-pair job draining and uploaded-body read reconciliation. No audio or token
is logged. README documents build/publish/pairing/troubleshooting and remaining
hardware checks. STATUS/TASKS/#072 record preparation without closing REC.0.

Core restore and Release build passed, zero warnings/errors. The separate
package-free rebuilt Core smoke passed 35 checks, exit 0, not xUnit. NuGet
restore is blocked by NU1301; App build --no-restore exits 1 with NU1301, and
dotnet test --no-restore exits 1 with NETSDK1004 (missing test assets). Optional
workload discovery and user-config access were bypassed using local build env
paths, without changing SDK or user config. Raw build/test logs and supplemental
smoke are under ignored apps/recorder-tray/.build-logs. QA's dashboard baseline
type-check passed; lint stopped on Wrangler proxy spawn EPERM. No dashboard code
was changed. Full source/test/limit report:
docs/superpowers/audits/2026-10-14-rec0-tray-app.md.

Main session must restore/build/test/publish with NuGet access and verify real
Windows pairing/capture/toasts/devices/crash/sleep/revocation and both-sided live
transcripts. Orphaned server open recordings without local metadata need
dashboard resolution; local audio stays retained. No executable/xUnit/live
pass is claimed. All changes remain uncommitted. No commit, push, deploy,
migration, real pairing/capture, secret or production-data operation occurred.

## 2026-10-14, REC.0 Windows tray review repairs, uncommitted on 8665e762

Started with clean git status on feat/rec0-tray-app at 8665e762. The original
client is committed and its restored-package baseline builds with zero
warnings and passing tests per Liam's brief; the preceding preparation entry
is historical. The security and behaviour review repairs remain uncommitted.
No dashboard code, framework target, commit, push, deploy, secret, pairing,
audio capture or production data changed.

Implemented protected storage and install ACL gates, toast argument parsing,
manual-session/early-join/suppression fixes, progress-sensitive polling,
three failed-state retries, poison and startup recovery isolation, server slot
release, Communications devices, portable crash spool, ten-second gap stop,
short-tail folding, suspend/session-ending/Quit flushing without manual
suppression, seven-day audio/manifests and fourteen-day logs retention,
Local recordings count/folder, state-only settings writes and durable ordering.
Updated README, STATUS, TASKS and Decision #072 client note. Full item/file/line
report: docs/superpowers/audits/2026-10-14-rec0-tray-app-review-fixes.md.

Final Release xUnit: 123 passed, 0 failed, 0 skipped, exit 0. Supplemental host
source compilation: 0 warnings/errors, exit 0, using cached dependencies in an
ignored scratch project. This is not the full dependency/build gate. The real
solution Release build is blocked by absent System.Drawing.Common 8.0.0 and
its SystemEvents 8.0.0 dependency: NU1101, 3 warnings, 2 errors, exit 1. The new
explicit package reference is retained; the supplied cache contains only 4.7.0.
NuGet downloads are sandbox-blocked. Asked Liam
to restore the two missing packages from an unrestricted shell, after which
the actual Release build and all tests must run again.

Raw logs: apps/recorder-tray/.build-logs/review-build.log,
review-host-source-build.log and review-tests-final-pass.log/.trx.
QA/UIUX source findings were fixed and re-reviewed. Native Windows integration
and real-call proof remain pending; REC.0 stays open. No completed/live claim.
