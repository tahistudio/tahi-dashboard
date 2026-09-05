# Tahi Dashboard - Live Status

> One-page snapshot of where the platform actually is. Update weekly.
> Last updated: **2026-09-05** by Claude (Tasks page port: the surface, its docs and its e2e). Triage snapshot below is still the 2026-08-18 audit.

## The plan (2026-08-18)

Liam's call: ship every surface a client touches first (proposals, contracts, schedules, portal), cut over from ManyRequests, then improve team/owner surfaces slowly. TASKS.md now carries five sprints: **C0 ops unblock -> C1 sell without embarrassment (deliverable money paths, ~5d) -> C2 portal truth (five blockers, ~12d) -> C3 client-facing redesign stragglers (~4d) -> C4 live QA gate.** Roughly 4-5 focused weeks to a defensible cutover.

## DEPLOY GATE - read this before assuming anything is live

**Pushes to main do NOT auto-deploy.** The "Deploy dashboard" workflow's production job waits on a GitHub environment approval (required reviewer: tahistudio). The Aug 10 bank-truth fix (dc41442a) sat in that gate for 8 days while prod kept serving the old code - `get_bank_balances` was still reading Xero's ledger the whole time. Approve deploys at GitHub -> Actions -> the run -> Review deployments, or remove the required-reviewer rule on the production environment. Until dc41442a is approved + sync-airwallex fires, do not trust cash/runway numbers from the MCP tools.

---

## Triage snapshot (audited against code 2026-08-18; no commits since dc41442a / Aug 10)

### Trusted 100% (daily-driven and/or live-verified)

- **Sales pipeline** (daily-trusted; data real; UI is pre-v3 but honest except the nudge affordances below)
- **/financial-reports** (daily-trusted; Airwallex-first fix pending the deploy approval above)
- **Docs Hub** (locked reference pattern)
- **Requests** admin + portal (v3 lift, live-verified June; the request loop is the portal's strongest feature: intake forms, thread, AI wizard, tenancy solid)
- **Overview homes** (owner + client verified live July; teammate home never visually verified)
- **Settings rebuild** (verified locally + promoted; client-session QA of portal sections still pending)
- **Tasks (ported 2026-09-05).** Three views: List, Board and My week, over the
  same rail toolbar Requests uses (aside "Saved views, filters and sort": eight
  saved views with counts, six filter selects, sort with a direction toggle,
  Clear filters, Save as default). The detail is a slide-over; opening a row
  writes `?task=<id>` and `/tasks/<id>` still redirects to `/tasks?task=<id>`,
  which is where every task notification lands. Tasks are studio-only: a client
  org is redirected off the route, so there is no portal audience to check.
  Two behaviours that surprise a reader otherwise: **My week deliberately
  ignores the rail** (the chip strip is suppressed, the count does not move,
  and a note above Views says so), and **the saved default is browser-local**,
  inherited from the Requests rail, so it does not follow you to another
  machine. Levels read Client / Internal / Tahi; priorities are standard /
  high / urgent, with `!medium` and `!low` accepted by quick add as aliases
  for standard. Export CSV writes the rows on screen: rail-filtered on List,
  the planner's own on My week.

### Built and impressive, but NOT client-safe yet (sprint C1)

- **Proposals**: public viewer + list are premium; but share serves LIVE rows until a separate Publish click, the Publish button permanently disappears after first use in a session, accepting a proposal notifies NOBODY (no email/notification/deal move; viewer promises "we'll be in touch within one business day"), and at 375px the package tabs clip so a phone client can't select the third package.
- **Contracts**: emailed-link signing genuinely works end to end (drawn signature, hash chain, fully-signed PDF emailed to all parties). But the signed PDF is never stored (one fire-and-forget email is the only copy), the body isn't hash-locked and stays editable after signatures, nobody is notified on partial signature, and the portal nav item silently bounces clients to /requests.
- **Schedules**: strongest client-facing document in the codebase (snapshot semantics, dwell analytics). But share-before-publish leaks live edits, a viewer's dark-mode localStorage corrupts the public document, dark slide themes render invisible text, the gantt is a 64rem pinch-scroll strip on phones, and drafts leak phase names onto the client home.
- **Deals** (internal): every traced button hits a real API (sales kit one-click proposal/schedule/contract creation, convert-to-client provisioning). Two lying affordances to remove or build: scheduled nudges are recorded as queued but never send; "auto-nudges active" toggles have no engine. Nothing closes the loop when a client accepts/signs. v3 lap still pending (board/list/filters/dialogs bespoke; 2-3 day composition swap).

### Broken or missing for clients (sprint C2 - the five blockers, all re-verified 2026-08-18)

1. **B1 uploads identity** - clients 403 on every team-uploaded file; /api/uploads/confirm is a cross-tenant write hole (any authed user can write files rows into another org); Clerk-vs-D1 org-id split also hides client self-uploads from the portal list. (~2.5d)
2. **B2 notification identity** - inserts use domain row ids, queries use Clerk ids: clients never see team replies, team never sees client comments. Correct resolver helpers exist unused. (~1.5d)
3. **B3 portal invoice dead end** - detail page always hits the admin API (403 for clients); no pay link is ever stored; "Pay" buttons just navigate to the list. (~2.5d)
4. **B4 dead client nav** - Schedule/Contracts/Proposals nav items bounce to /requests; /files is a hardcoded "No files yet" stub (client-only page!); Book-a-call CTAs loop to /overview. Stale sub-claim: /billing now has a working client branch, it's just unlisted. (~2d)
5. **B5 onboarding not operable** - nothing in UI/MCP mints invite links; second-seat teammates never get clerkUserId backfilled (no Clerk webhook) and are stuck at the onboarding gate forever; "invoice me" 402-strands the client; the kickoff booking step discards the chosen slot. (~3.5d)

### Redesign coverage (sweep 2026-08-18)

**58 routes: 26 v3 / 20 partial / 8 legacy / 4 stub.** Client-facing laggards that matter: `/services` (legacy, zero primitives, client catalogue), `/billing` (legacy), `/invoices/[id]` (legacy detail behind a v3 list), `/files` (stub), `/p/contract` viewer (only public viewer off the deliverable kit). Client-facing partials: /messages, /tracks. (/tasks left this list on 2026-09-05: it is v3 and team-only, see the trusted block above.) Better than assumed: /calls, /team, /invoices list, /affiliates, /announcements, /reviews, /sales-analytics are already v3. Biggest internal partial: /reports (10 hand-rolled tables).

---

## Known live bugs (priority order)

1. **P0 - production deploy gate**: dc41442a not deployed; every future push waits on manual approval (see DEPLOY GATE above).
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

Per `CLAUDE.md` rule 8: type-check + lint + deploy green (NOW INCLUDING the manual approval click) + live smoke + 375px + dark mode + commit note.

## Production-readiness exit criterion

**Client-ready cutover** (revised 2026-08-18): sprints C0-C4 complete, one full live client-session QA lap passed on prod at 375px + dark, and a real client has completed one proposal-accept and one contract-sign round-trip without a Tahi hand touching the database. Team/owner trust-crossover continues post-cutover.
