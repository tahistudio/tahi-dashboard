# Tahi Dashboard - Live Status

> One-page snapshot of where the platform actually is. Update weekly.
> Last updated: **2026-09-12** by Claude (deploy gate gone, `completed` client status, client book reclassified, MC.4 and MC.10 decided, DL.0 unblocked). Triage snapshot below is still the 2026-08-18 audit.

## The plan (2026-08-18)

Liam's call: ship every surface a client touches first (proposals, contracts, schedules, portal), cut over from ManyRequests, then improve team/owner surfaces slowly. TASKS.md now carries five sprints: **C0 ops unblock -> C1 sell without embarrassment (deliverable money paths, ~5d) -> C2 portal truth (five blockers, ~12d) -> C3 client-facing redesign stragglers (~4d) -> C4 live QA gate.** Roughly 4-5 focused weeks to a defensible cutover.

## DEPLOY GATE - RESOLVED 2026-09-10

**Pushes to main DO auto-deploy to production now.** The `production` GitHub environment carries no protection rules any more (checked through the API on 2026-09-12: `protection_rules: []`), so the "Deploy dashboard" workflow's production job runs straight through: 4e43bd9d was pushed at 01:07 NZST on 2026-09-10 and was live at 01:14 with nobody clicking anything. The Aug 10 story (dc41442a sat behind a required reviewer for 8 days) is history. If the gate ever comes back it shows up as a run stuck on "waiting" at GitHub -> Actions -> the run -> Review deployments.

## Since the last update (2026-09-10 to 2026-09-12)

- **Client status vocabulary gained `completed`** (Decision #060, 4e43bd9d, live): a one-off project that wrapped cleanly, distinct from `churned` (a lost retainer). Teal badge, its own saved view, filter and bulk action; the MCP `list_clients` enum carries it. Applied on Liam's call: AI Friction Labs, Blank Space Inc, Fluvial, Spot Digital and ISG are `completed`; DANTE MEDIA OÜ and Racquet Club are `churned`.
- **Client book cleanup:** "test manual" (a re-created Stripe test fixture whose backdated NZ$350 invoice was driving a false "Needs you" nudge on the daily brief) and "Subscription update" (six fake paid Stripe invoices) deleted by Liam through the danger zone. Tahi Test Client stays until launch.
- **Decisions:** MC.4, Giant Group gets no emails yet, the allowlist stays closed. MC.10, both Dante Media invoices were paid, recorded as paid on the ledger (detail in TASKS.md). DL.0 unblocked: Liam ran /design-login on 2026-09-12, so the Claude Design write-back (DL.1 to DL.4) can run.
- **MC.9 residue sweep** shipped (abeb9bc8, `residue: true` on POST /api/admin/import/cleanup, dry run by default, MCP parity) and applied by Liam on production the same day: 36 orphan rows removed (tracks, checklist items, a blocker, empty request threads, unreachable notifications, the Acme Corp seed subscription, timer smoke entries, test conversations); a second dry run plans zero. Acme Corp itself: hard deleted by Liam the same day; the residue sweep still plans zero afterwards, so the last seed organisation is gone without leaving orphans.
- **Xero void no longer demotes a paid invoice** (eb5592db, live): the two Dante Media invoices paid through ManyRequests and voided in Xero read paid with their real payment dates and stay that way through the hourly sync.
- **Claude Design write-back (DL.1, DL.2) complete**: 14 of 14 files in. Eleven went through write_files and were read back line for line; the three over 100 KB (sales-artifacts.jsx, sales-artifacts.css, sales-pipeline.jsx) went in through the design-sync disk upload on 2026-09-13 and read back at their full line counts. DL.3 shell wiring and DL.4 re-critique are next.
- **Pre-call digest timing fixed** (482627b8, live): Google Calendar rows carried a +12:00 offset and the cron compared them lexicographically, so New Zealand calls fired about twelve hours late. Every writer now stores a UTC instant, the cron compares instants, the email prints NZ time; the 71 stored rows were normalised on 2026-09-13 (dry run, apply, second dry run clean).
- **Giant Group readiness Batch A is live** (66b18917, 2f0c20a0; TASKS.md "Batch A"): the portal tells a Scale client the truth about rate, currency and tracks; an existing client is never sent through a plan picker or a card form; How to pay shows when a Xero invoice has no link; client emails carry the org id to the allowlist gate; the home call is joinable; the services catalogue is populated (Maintain, Scale, three add-ons, no prices); Messages is hidden for every client; the importer handles subset runs. Smoked in Client view of Giant Group on production. Open: the A4 isolation spec has to run green on the harness (a pre-existing goto race is being fixed), import notes leaking into the client invoice (fix in flight), per-currency bank details, and the real-session lap that only Liam or Staci can do. Readiness estimate: about 92 percent, the real lap and a week of studio use are what buy the last points.
- **Catalogue Batch B, money path** (c1e8c24e, 5829bf0d; TASKS.md "Catalogue Batch B"): /billing on the v3 primitives and out of the client nav by default, Manage Billing only for a Stripe-rail client; client invoices at 375 pinned by a Playwright spec; the IC.8 stamp route so historical hours are marked invoiced before the first hourly Xero export (apply is Liam's call); the client home team card now shows the assigned project manager; the Google Calendar sync cron no longer wipes a manually pasted meeting link (root cause of the N8N call losing its Join link). The services plan ladder (CB1) is fixed on its branch and merges after re-review.
- **Build incident, fixed** (d6574c26): a report committed with a Windows path broke the production build because Tailwind v4 scans every non-ignored file for class names and read `\c697ea` as a CSS escape. globals.css now excludes docs, SPECS and the root markdown files from the scan. Write paths in reports with forward slashes.

---

## Triage snapshot (audited against code 2026-08-18; no commits since dc41442a / Aug 10)

### Tenancy proof

- **e2e/tenancy-isolation.spec.ts is the cross-organisation isolation proof** (Batch A S6, 2026-09-13): two seeded client organisations, every portal read and write tried across the boundary in both directions (requests, files, invoices, conversations, contracts, calls, every id-less route), 3 of 3 green on the local QA harness via `npm run test:e2e:tenancy`. Not yet run in CI (needs a seeded D1 and Clerk dev keys on the runner). Re-run it after any change to lib/portal-access.ts, lib/permissions.ts or a portal route.

### Trusted 100% (daily-driven and/or live-verified)

- **Sales pipeline** (daily-trusted; data real; UI is pre-v3 but honest except the nudge affordances below)
- **/financial-reports** (daily-trusted; Airwallex-first fix pending the deploy approval above)
- **Docs Hub** (locked reference pattern)
- **Requests** admin + portal (v3 lift, live-verified June; the request loop is the portal's strongest feature: intake forms, thread, AI wizard, tenancy solid)
- **Overview homes** (owner + client verified live July; teammate home never visually verified)
- **Settings rebuild** (verified locally + promoted; client-session QA of portal sections still pending)

### Ported, live smoke pending

- **Tasks (ported 2026-09-05).** Not in the trusted block above: the surface
  shipped and part of it was driven on production, but most of its writes have
  only been exercised by the e2e suite against a local harness. Three views:
  List, Board and My week, over the same rail toolbar Requests uses (aside
  "Saved views, filters and sort": an All tasks reset plus seven saved views,
  each with a count, six filter selects, sort with a direction toggle, Clear
  filters, Save as default). The detail is a slide-over; opening a row writes
  `?task=<id>` and `/tasks/<id>` still redirects to `/tasks?task=<id>`, which
  is where every task notification lands. Tasks are studio-only: a client org
  is redirected off the route, so there is no portal audience to check.
  Two behaviours that surprise a reader otherwise: **My week deliberately
  ignores the rail** (the chip strip is suppressed, the count does not move,
  and a note above Views says so), and **the saved default is browser-local**,
  inherited from the Requests rail, so it does not follow you to another
  machine. Levels read Client / Internal / Tahi; priorities are standard /
  high / urgent, with `!medium` and `!low` accepted by quick add as aliases
  for standard.
  **Verified live (2026-09-05, production, as Liam):** the page, the rail and
  the count, quick add with a client mention, a date and a priority, the row
  to slide-over with `?task=` in the URL, the level change clearing the client
  on the server, the `/tasks/<id>` redirect, the board's column composers, the
  header overflow menu.
  **Not exercised live yet:** bulk complete, promote to a request, the timer
  in the detail's Time card, an AI wizard run, Save as default across a
  reload, the CSV download, the board drag, the My week drag, and dark mode on
  the board and the week planner. The first eight are covered by
  `e2e/tasks.spec.ts` against the local harness; dark mode is a live check
  only.

### Built and impressive, but NOT client-safe yet (sprint C1)

- **Proposals**: public viewer + list are premium; but share serves LIVE rows until a separate Publish click, the Publish button permanently disappears after first use in a session, accepting a proposal notifies NOBODY (no email/notification/deal move; viewer promises "we'll be in touch within one business day"), and at 375px the package tabs clip so a phone client can't select the third package.
- **Contracts**: emailed-link signing genuinely works end to end (drawn signature, hash chain, fully-signed PDF emailed to all parties). But the signed PDF is never stored (one fire-and-forget email is the only copy), the body isn't hash-locked and stays editable after signatures, nobody is notified on partial signature, and the portal nav item silently bounces clients to /requests.
- **Schedules**: strongest client-facing document in the codebase (snapshot semantics, dwell analytics). But share-before-publish leaks live edits, a viewer's dark-mode localStorage corrupts the public document, dark slide themes render invisible text, the gantt is a 64rem pinch-scroll strip on phones, and drafts leak phase names onto the client home.
- **Deals** (internal): every traced button hits a real API (sales kit one-click proposal/schedule/contract creation, convert-to-client provisioning). Two lying affordances to remove or build: scheduled nudges are recorded as queued but never send; "auto-nudges active" toggles have no engine. Nothing closes the loop when a client accepts/signs. v3 lap still pending (board/list/filters/dialogs bespoke; 2-3 day composition swap).

### Broken or missing for clients (sprint C2 - the five blockers, all re-verified 2026-08-18)

**Update 2026-09-05:** B3, B4 and B5 shipped in the Tier 1 cutover (`docs/superpowers/plans/2026-09-05-cutover-tier1.md`) and were verified on production: portal invoice detail with a persisted pay link, the client Files page and honest nav, invites minted and emailed from the client detail with the portal admin role on the first contact, the second seat linked on sign-in, "invoice me" completing onboarding. The cron workflows also needed the Clerk public matcher opened (b8b3f366) after the URL fix. B1 and B2 were not in the 2026-09-04 ship readiness audit's blocker list; treat them as fixed earlier and re-check on the first real client. The entries below are kept as the historical record.

1. **B1 uploads identity** - clients 403 on every team-uploaded file; /api/uploads/confirm is a cross-tenant write hole (any authed user can write files rows into another org); Clerk-vs-D1 org-id split also hides client self-uploads from the portal list. (~2.5d)
2. **B2 notification identity** - inserts use domain row ids, queries use Clerk ids: clients never see team replies, team never sees client comments. Correct resolver helpers exist unused. (~1.5d)
3. **B3 portal invoice dead end** - detail page always hits the admin API (403 for clients); no pay link is ever stored; "Pay" buttons just navigate to the list. (~2.5d)
4. **B4 dead client nav** - Schedule/Contracts/Proposals nav items bounce to /requests; /files is a hardcoded "No files yet" stub (client-only page!); Book-a-call CTAs loop to /overview. Stale sub-claim: /billing now has a working client branch, it's just unlisted. (~2d)
5. **B5 onboarding not operable** - nothing in UI/MCP mints invite links; second-seat teammates never get clerkUserId backfilled (no Clerk webhook) and are stuck at the onboarding gate forever; "invoice me" 402-strands the client; the kickoff booking step discards the chosen slot. (~3.5d)

### Redesign coverage (sweep 2026-08-18)

**58 routes: 26 v3 / 20 partial / 8 legacy / 4 stub.** Client-facing laggards that matter: `/services` (legacy, zero primitives, client catalogue), `/billing` (legacy), `/invoices/[id]` (legacy detail behind a v3 list), `/files` (stub), `/p/contract` viewer (only public viewer off the deliverable kit). Client-facing partials: /messages, /tracks. (/tasks left this list on 2026-09-05: it is v3 and team-only, see "Ported, live smoke pending" above.) Better than assumed: /calls, /team, /invoices list, /affiliates, /announcements, /reviews, /sales-analytics are already v3. Biggest internal partial: /reports (10 hand-rolled tables).

---

## Known live bugs (priority order)

1. **P0 - production deploy gate: RESOLVED 2026-09-10.** The required-reviewer rule is gone and pushes to main are live in about seven minutes (see DEPLOY GATE above). T0.2 (sync-airwallex + get_bank_balances check) stays open on its own merits.
2. **P0 - `finance.yieldHoldings` stale**: yield positions grew (Xero shows Yield USD 33,956.89 / AUD 638.80 vs setting's 20,014.13 / 531.51). Confirm in Airwallex UI, update via update_settings after the deploy lands.
3. **P1 - the five portal blockers** (sprint C2 above).
4. **P1 - proposal/schedule share leaks live rows; proposal accept + contract sign are silent** (sprint C1).
5. **P2 - migrations 0081/0082 apply state unverified on prod D1** (C0.4).
6. **P3 - board drop targets**: on the Tasks board a card in the SAME column as the dragged card still lights as a drop target. Cosmetic, inside `KanbanBoard`, so it shows on the Requests board too.

### Corrections to previous STATUS claims

- **Voice notes**: the feature no longer exists in the tree (no recorder, no audio MIME in uploads/serve). The March bug + June fix are both moot; removed from the list.
- **SSE notification stream**: real now, not a stub (Phase 11 note was stale).
- **Webflow Cloud**: all "blocked on Webflow Cloud" items are stale; we're on Cloudflare direct (prod=portal.tahi.studio, staging=staging.tahi.studio).

---

## Automation & delivery (wired live 2026-07-07)

Event bus fires automations + outgoing webhooks on real domain events; announcement email fan-out honours per-user prefs; AI weaves are human-in-the-loop only. Live smoke of all of it still pending (W-QA, post-launch list).

## Stubs / not functional

- Web Push (no service worker handler)
- Email-to-Request intake (state unknown since 2026-07-07; verify)
- Scheduled deal nudges + auto-nudge engine (UI exists, engine doesn't - C1.8 removes or builds)

---

## Definition of Done (enforced)

Per `CLAUDE.md` rule 8: type-check + lint + deploy green (no approval click any more, see DEPLOY GATE) + live smoke + 375px + dark mode + commit note.

## Production-readiness exit criterion

**Client-ready cutover** (revised 2026-08-18): sprints C0-C4 complete, one full live client-session QA lap passed on prod at 375px + dark, and a real client has completed one proposal-accept and one contract-sign round-trip without a Tahi hand touching the database. Team/owner trust-crossover continues post-cutover.
