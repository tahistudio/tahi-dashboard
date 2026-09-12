# Overnight run log, 2026-09-12 to 2026-09-13 (Giant Group readiness, then the design catalogue)

Goal Liam set (2026-09-12 night): iterate until we are 100 percent assumed ready for Giant Group to be onboarded, then design every ideal page in Claude Design for later porting. Keep going with subagents until he says stop; wait out usage blocks and resume. Cheap models draft, Fable reviews.

Standing constraints: no email to Giant Group (allowlist stays closed, no invite); tasks studio-only; the standalone Messages page stays hidden for clients; data writes on production only through the app's endpoints as Liam, dry run first; deletes are Liam's clicks.

## State at 2026-09-13 ~00:30 NZST

Landed on main and deployed:
- `completed` client status (Decision #060, 4e43bd9d); seven clients reclassified.
- Xero void never demotes a paid invoice (eb5592db); Dante Media INV-0005 and INV-0007 read paid with ManyRequests' dates (MC.10 closed).
- MC.9 residue sweep (d0aa89a2, abeb9bc8): applied by Liam, 36 rows removed, second dry run plans zero. Acme Corp hard deleted by Liam.
- Pre-call digest timing fix (482627b8): every writer normalises to a UTC instant, cron compares instants, email prints NZ time. BACKFILL OF STORED ROWS STILL TO RUN: POST /api/admin/calls/normalize-times as Liam, dry run first, then {"dryRun":false}. Deploy of 007b63f8 in progress at the time of writing.
- Docs: STATUS.md deploy gate resolved; TASKS.md T0.1, T0.5, MC.4, MC.9, MC.10, MC.10b, DL.0 to DL.2, IC.7 backfill.

Operator steps done by Liam tonight: CLERK_WEBHOOK_SECRET on production (endpoint answers 400 now), Resend domain confirmed verified, invoice number backfill applied (99 rows), Acme Corp and the two dummy orgs deleted, /design-login.

Applied by the lead through the app's endpoints under Liam's earlier decisions: Giant Group invoice channel = xero; Messages feature denied for Giant Group (organisation override); request #243 flipped to internal.

Claude Design write-back: DL.1 and DL.2 complete (14 of 14 files; the three over 100 KB went in through the design-sync disk upload). DL.3 shell wiring and DL.4 re-critique still to do.

Liam's answers (2026-09-13 morning): Messages stays hidden for every client (building the platform default now, workflow messages-hidden-for-clients). Clerk post-sign-up organisation task: he could not find the setting; the lead checks the Clerk connector or the Clerk dashboard in his Chrome session. Bank accounts: he has one per currency and will send the details; BUILD per-currency accounts in Settings > Getting paid with the How to pay block picking the invoice's currency (queued after Batch A because S3 touches the same block); Liam types the account numbers himself. Email intake: unsure, so treat as not wired and soften the "reply on the thread" line in emails/new-message.tsx after S4 merges. "N8N Content Engine" IS a Giant Group call: S5 must show it with a join link rather than hide it; check the slice against that.

Still only Liam: the A5 real-session lap (plan section 4); the allowlist flip and the invite (OFF until he says); the bank account numbers per currency once the fields exist.

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
