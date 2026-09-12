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
