# Tahi Dashboard - Live Status

> One-page snapshot of where the platform actually is. Update weekly.
> Last updated: **2026-09-21** by Claude (handoff sync: the 2026-09-13 to 2026-09-20 week written up, known bugs and operator steps refreshed). Triage snapshot below is still the 2026-08-18 audit. Reading order for any agent: AGENTS.md.

## The plan (2026-08-18)

Liam's call: ship every surface a client touches first (proposals, contracts, schedules, portal), cut over from ManyRequests, then improve team/owner surfaces slowly. TASKS.md now carries five sprints: **C0 ops unblock -> C1 sell without embarrassment (deliverable money paths, ~5d) -> C2 portal truth (five blockers, ~12d) -> C3 client-facing redesign stragglers (~4d) -> C4 live QA gate.** Roughly 4-5 focused weeks to a defensible cutover.

## DEPLOY GATE - RESOLVED 2026-09-10

**Pushes to main DO auto-deploy to production now.** The `production` GitHub environment carries no protection rules any more (checked through the API on 2026-09-12: `protection_rules: []`), so the "Deploy dashboard" workflow's production job runs straight through: 4e43bd9d was pushed at 01:07 NZST on 2026-09-10 and was live at 01:14 with nobody clicking anything. The Aug 10 story (dc41442a sat behind a required reviewer for 8 days) is history. If the gate ever comes back it shows up as a run stuck on "waiting" at GitHub -> Actions -> the run -> Review deployments.

## Since the last update (2026-09-13 to 2026-09-20)

Full detail with commit ids is in docs/superpowers/plans/2026-09-13-overnight-run-log.md (dated entries) and the TASKS.md sections named in brackets.

- **Giant Group is live on the portal** (2026-09-14, LW.33): their org is on the email allowlist, Michael Day was invited through the real flow (link valid to 27 September), Mark Ramsey's invite waits on the spelling of his address. The first real hand-off went through the MCP on 2026-09-18: request #244 to Mickey Day, due 30 September. Their two shared proposals are the only ones on the home's Proposals live card.
- **Liam's second walk-through round** (2026-09-14, LW.21 to LW.36): one scrollbar on the requests board; delete a file from every files surface with MCP delete_file; Services hidden for clients the way Messages is; one focus ring on the AI composer; the seat invite flow fixed end to end (signed out plus a token goes to sign-up with the email prefilled, acceptance runs on arrival, seat versus first contact decided from the org's contacts); the client home empty state keeps the dark header; "Sign out and return to sign in" on every onboarding step; People delete resilient to a missing Clerk membership; member seats never see plan or billing; prep notes on every call (migration 0102); the "test manual" phantom invoice written off and the Stripe importer taught never to demote written_off or paid; the comment ball picks its element and snaps to an edge (0101) and stores screenshots (0103, applied 2026-09-15 after the insert had failed for a day). Google Calendar: the production grant was read-only, so kickoff bookings never reached the calendar; scopes widened, Liam reconnects once (LW.8b).
- **Client hand-offs on requests** (2026-09-18, HO.1 to HO.4, Decision #063): a request can be handed to a named client contact with a reason, note and date (migration 0104); the contact sees Waiting on you in the portal, the studio sees a chip, a rail view and a Waiting on card, the request hands itself back on approve, upload or reply, a nudge email goes out after three days, and a contact without a seat is invited in the same email. MCP hand_off_request, hand_back_request, list_requests_waiting_on_clients and get_dashboard_guide; /help renders the ten-section guide for both audiences.
- **MCP worker hardened** (LW.37, LW.38, Decision #066): connector arguments arrive as strings, so create_task lost subtasks and every boolean flag misread; coerceArgs now normalises every call against the tool's inputSchema at the tools/call boundary. New tools show up in a connector only in a fresh session.
- **Studio home accuracy** (2026-09-19, HA.1 to HA.10, Decision #065): every card was traced to its route on production; nine were wrong and are fixed and verified live (receivables aging buckets, the brief's currency prefix, the MRR delta basis month, pipeline ahead on the forecast's basis, capacity by assigned work and active members, retainer health by the API's own status, proposals live without drafts, one cash position for the money cards, the cash-flow ribbon on the full picture). Settings applied as Liam: finance.lastYearTaxOwed 24242.68 (the IRD balance), team.inactiveMemberEmails nathan@tahi.studio. Greyhive INV-2025000024 written off (a debt collector is engaged). Live after c554076d: outstanding NZ$21,394 across 6 invoices with NZ$16,106 overdue; cash NZ$76.1k, +NZ$13.2k a month net, 3.6 months if revenue stopped; take-home NZ$51.8k free; September net +NZ$14.5k, twelve months +NZ$136.5k.
- **Pay-rise question** (2026-09-19, decision open): Liam asked whether the pipeline retainer justifies a rise for Staci and him. The model from the live numbers recommends NZ$78k each from the 1 October payroll on today's revenue (nearly tax neutral inside the 30 percent band), with NZ$74k each also comfortable, with or without Meditrain; Bharat's 17 September transcript confirms the Meditrain package at 2,200 a month, which the CRM still carries as 1,250 and which may include the SE Ranking subscription. Conditions and revert rules are in the run log under 2026-09-19. Liam decides; nothing was changed in settings or code.
- **Call notes to tasks with an approval gate** (2026-09-19, scope docs/superpowers/plans/2026-09-19-call-notes-to-tasks-scope.md, Decision #064). Live: CN.0 (call_transcripts for every call kind, the Tahi bot actor, task threads mirrored into the request thread; migrations 0105, 0106); CN.0b (the Gemini Drive export had never parsed since it shipped because it asked for text/plain while the parser read markdown; fixed, 15 docs parsed, 12 discovery calls carry their first real transcripts, 2 parked for manual attach on /calls); CN.1 (the Sonnet suggester over transcripts, the Suggestions inbox on /tasks with Approve, Tweak, Snooze, Reject, Approve all and the y n j k keys, the owner home card, MCP list_task_suggestions and decide_task_suggestion, the half-hourly cron; migrations 0107, 0108); CN.1b (suggestions become requests, hand-offs and request notes as well as tasks, with the Tasks vs Requests rule stated as "what the client will see"; migration 0109); CN.1d (similarity guard: Looks like #226, Use #226 instead, approve blocked at 0.8 unless forced, cross-call dedupe, delivered requests shown to the model). Liam's first pass: 8 approved (Verandela requests #228 to #235) and 19 rejected. Model spend over five passes about 3 dollars. Open: CN.1c (a rebuild should union passes, not replace them; Sonnet 5 rejects a temperature parameter), CN.2 (the Slack app), CN.3 (keeping in sync).
- **Calls:** two more meeting types, mentoring and other (LW.39); lib/calls.ts owns the vocabulary; the calendar sync keeps a hand-set type.
- **Feedback comments round** (LW.40, LW.41): the nine comments Liam left through the comment ball are fixed and deployed (brief meta stacking on phone, the Wire ticker, the comment hint in dark, contract header glass in dark, the More actions popover on phone, row Delete no longer navigating in the shared DataTable, vertical client cards, the deal-linked call row on phone). The live phone and dark pass is still owed (the Chrome extension was disconnected). DELETE /api/admin/feedback/[id] and MCP delete_feedback_comment exist now; the fixed rows were removed.
- **Product manager AI** logged as PM.0 to PM.5 (2026-09-20, Decision #067): scope first, on Liam's go; it rides on the suggestion gate, the Tahi bot, the nudge crons and the coming Slack app.
- **Design pass held for review:** 19 Claude Design modules (13 SHIP, 6 FIX) and the 27 requirement documents under docs/superpowers/design; nothing ported. Liam marks docs/superpowers/plans/2026-09-14-design-review-for-liam.md first.
- **Migrations 0100 to 0109 are all applied on production** (0100 comment ball, 0101 anchors, 0102 prep notes, 0103 screenshots, 0104 hand-offs, 0105 transcripts, 0106 task comments, 0107 suggestions, 0108 suggested_at, 0109 request suggestion kinds). Rule since 0103 (Decision #062): a migration is applied before or right after the deploy that ships it, and the run log says so.

### Operator steps waiting on Liam (2026-09-21)

- Reconnect Google under Settings > Integrations, then book a kickoff and confirm the calendar event and Join link (LW.8b).
- Confirm the spelling of Mark Ramsey's address so his Giant Group invite can go.
- Void the "test manual" Stripe invoice (in_1TGQaE2MOtshRPkATn4r8ByV) and delete the "test manual" org from /clients.
- Work the Suggestions inbox on /tasks as calls come in; the first similarity warnings show on the next call's suggestions.
- The real-session lap (A5): Liam or Staci in incognito for 20 minutes; the only proof for the greeting, the bell, the invite path and the second seat.
- The pay-rise decision (74k or 78k each from 1 October) and topping the tax pot from NZ$15k to the full IRD balance before the January instalment.
- Mark the 2026-09-14 design review; say go on PM.0 (product manager AI scope) and on CN.2 (the Slack app needs an app with a signing secret and a bot token in #founders).
- Look at the eight LW.40 fixes at 375px and in dark, or let the next session with a browser do it.

## Since the last update (2026-09-10 to 2026-09-12)

- **Client status vocabulary gained `completed`** (Decision #060, 4e43bd9d, live): a one-off project that wrapped cleanly, distinct from `churned` (a lost retainer). Teal badge, its own saved view, filter and bulk action; the MCP `list_clients` enum carries it. Applied on Liam's call: AI Friction Labs, Blank Space Inc, Fluvial, Spot Digital and ISG are `completed`; DANTE MEDIA OÜ and Racquet Club are `churned`.
- **Client book cleanup:** "test manual" (a re-created Stripe test fixture whose backdated NZ$350 invoice was driving a false "Needs you" nudge on the daily brief) and "Subscription update" (six fake paid Stripe invoices) deleted by Liam through the danger zone. Tahi Test Client stays until launch.
- **Decisions:** MC.4, Giant Group gets no emails yet, the allowlist stays closed. MC.10, both Dante Media invoices were paid, recorded as paid on the ledger (detail in TASKS.md). DL.0 unblocked: Liam ran /design-login on 2026-09-12, so the Claude Design write-back (DL.1 to DL.4) can run.
- **MC.9 residue sweep** shipped (abeb9bc8, `residue: true` on POST /api/admin/import/cleanup, dry run by default, MCP parity) and applied by Liam on production the same day: 36 orphan rows removed (tracks, checklist items, a blocker, empty request threads, unreachable notifications, the Acme Corp seed subscription, timer smoke entries, test conversations); a second dry run plans zero. Acme Corp itself: hard deleted by Liam the same day; the residue sweep still plans zero afterwards, so the last seed organisation is gone without leaving orphans.
- **Xero void no longer demotes a paid invoice** (eb5592db, live): the two Dante Media invoices paid through ManyRequests and voided in Xero read paid with their real payment dates and stay that way through the hourly sync.
- **Claude Design write-back (DL.1, DL.2) complete**: 14 of 14 files in. Eleven went through write_files and were read back line for line; the three over 100 KB (sales-artifacts.jsx, sales-artifacts.css, sales-pipeline.jsx) went in through the design-sync disk upload on 2026-09-13 and read back at their full line counts. DL.3 shell wiring and DL.4 re-critique are next.
- **Pre-call digest timing fixed** (482627b8, live): Google Calendar rows carried a +12:00 offset and the cron compared them lexicographically, so New Zealand calls fired about twelve hours late. Every writer now stores a UTC instant, the cron compares instants, the email prints NZ time; the 71 stored rows were normalised on 2026-09-13 (dry run, apply, second dry run clean).
- **Giant Group readiness Batch A is live** (66b18917, 2f0c20a0; TASKS.md "Batch A"): the portal tells a Scale client the truth about rate, currency and tracks; an existing client is never sent through a plan picker or a card form; How to pay shows when a Xero invoice has no link; client emails carry the org id to the allowlist gate; the home call is joinable; the services catalogue is populated (Maintain, Scale, three add-ons, no prices); Messages is hidden for every client; the importer handles subset runs. Smoked in Client view of Giant Group on production. Open: the A4 isolation spec has to run green on the harness (a pre-existing goto race is being fixed), import notes leaking into the client invoice (fix in flight), per-currency bank details, and the real-session lap that only Liam or Staci can do. Readiness estimate: about 92 percent, the real lap and a week of studio use are what buy the last points.
- **Overnight design pass, 2026-09-14** (docs/superpowers/plans/2026-09-14-design-review-for-liam.md): 27 requirement documents written from the code and the backlog, then 19 design modules built in Claude Design by opus designers and screenshot-critiqued at 1440 and 375 in light and dark, one revision each. 14 modules stand at SHIP, 4 at FIX with a bounded list (portal-account, portal-files, portal-money, requests, tasks), calculator-analytics awaiting its critique. Every module is reachable in the app shell for its audience with zero console errors. Nothing is ported; Liam reviews first.
- **Late evening 2026-09-13 to 00:30 NZ**: default project manager for new clients by engagement type (PM.1, e9feda94; both defaults and the override read Liam on production), the request wizard knows each client's history and coverage gaps (GI.4 step one, ff9939bd), the beta comment ball (BP.1 stripped back, 1ebb63f5: a draggable floating button on every dashboard and onboarding page, a comment panel, page context and recent errors stored, read through the MCP tool list_feedback_comments; migration 0100), the backlog reorganised (TASKS.md, 95 open ids, old file archived). The overnight design pass (19 modules in Claude Design, requirements under docs/superpowers/design) is held for Liam's 8am review.
- **Liam's dummy-client walk-through, nineteen fixes in one evening** (23b5c681 to f2c3182f, 2026-09-13; TASKS.md "Liam's dummy-client walk-through" LW.1 to LW.20): one studio project manager for every client (setting), pronoun-free lead copy, onboarding video and the home checklist card hidden for now, kickoff slots from the studio calendar with the client's timezone named and an honest read-only view, one New request on the client home and no project language for a custom-priced retainer, the request detail rail that collapsed at mid widths, the AI wizard (rendered replies, growing composer, every draft created, honest timelines, client context with team access scoping), seat invites in Tahi's own email with Clerk invitations removed, and a new seat of an onboarded organisation landing in the portal instead of the wizard. Root causes closed: the Google grant was read-only so kickoff events never reached the calendar (scopes widened, Liam reconnects once), and the dashboard gate keyed onboarding completion on the individual user. Live checks by Liam pending.
- **Catalogue Batch C, deliverable truth** (3ecafbba to the C4 merge, 2026-09-13 evening; TASKS.md "Catalogue Batch C"): share links tell the truth (snapshot on first share, 404 after revoke, publish re-arms), public viewers work in dark and at 375, accept freezes the amounts and refuses expired documents with the studio told of every accept, decline and question, contracts notify on every signature with the signed PDF in R2 and a body hash anchor. Migrations 0098 (applied) and 0099 (runner after deploy). Playwright coverage for both round trips is still owed (D3).
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

Refreshed 2026-09-21. The older items are kept at the bottom with their state.

1. **P1 - never seen live at 375px or in dark:** the eight LW.40 comment-ball fixes (overview brief meta, the Wire ticker, contracts header and More menu, client cards, the deal-linked call row) rest on reviewers' reading and the DataTable tests. The real-session lap (A5: greeting, bell, invite path, second seat) is Liam's or Staci's and has not happened.
2. **P1 - `finance.yieldHoldings` may be stale** (last noted 2026-08-18: Xero showed Yield USD 33,956.89 / AUD 638.80 vs the setting's 20,014.13 / 531.51; not re-checked since). Confirm in the Airwallex UI and update through update_settings; the home cash figure (NZ$76.1k on 17 Sep) depends on it, and Liam quoted NZ$85k on 2026-09-19.
3. **P2 - CN.1c:** a rebuild of call suggestions replaces the previous pass instead of merging it, so sampling variance can drop items a human never saw (Sonnet 5 rejects a temperature parameter).
4. **P2 - flaky under a full parallel vitest run** (LW.34): middleware.test.ts, utils formatDate, server-client-boundary; all green alone. The gate retries a failed file in isolation before calling the suite red.
5. **P2 - the August financial snapshot is missing** (the monthly cron did not fire); the MRR delta reads against July until September's snapshot lands. The writer is idempotent; what is owed is a manual write of the August row or a cron re-run.
6. **P3 - HO.5:** request_waiting_on_you has no notification preference toggle (bell and email on, cannot be muted); add when a client asks.
7. **P3 - board drop targets**: on the Tasks board a card in the SAME column as the dragged card still lights as a drop target. Cosmetic, inside `KanbanBoard`, so it shows on the Requests board too.
8. **Older items, for the record:** the production deploy gate is RESOLVED (2026-09-10); T0.2 (sync-airwallex plus a get_bank_balances check) stays open on its own merits; migrations 0081/0082 apply state on prod D1 (C0.4) was never re-verified; the five portal blockers (C2) shipped 2026-09-05; the proposal and schedule share leaks and the silent accept and sign (C1) were closed by Catalogue Batch C on 2026-09-13.

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
