# Tahi Dashboard - Live Status

> One-page snapshot of where the platform actually is. Update weekly.
> Last updated: **2026-10-26** by Claude (Site QA tester built, not deployed; see the SQA section). Previous: **2026-10-14** by Codex (next-20 batch A reconciliation; items 1 to 7 live; REC.0 server live and Windows tray built). Older observations retain their dates. Reading order for any agent: AGENTS.md.

## Site QA tester (SQA), 2026-10-26

Built, committed on main and NOT yet deployed: /qa (admin, qa_tester
feature) QAs client websites. Sites per client, pages from sitemap.xml,
named rounds with five viewport ticks per page (XL 1920, Desktop 1440, Tablet
768, Mobile L 425, Mobile P 375), live frames through the new sandbox proxy
worker workers/qa-view, and axe accessibility, link, SEO, launch and
performance checks, issue to internal request, and a printable report.
Waits on Liam: QA_VIEW_SECRET on both workers and QA_VIEW_ORIGIN on the
dashboard, all as wrangler secrets, migration 0115 on production, then push and live smoke. Logged
flake: app/api/__tests__/t1-6-org-routes.test.ts ("GET admin/conversations
refuses a denied scoped seat ... returns 403 before business queries") failed
in 2 of 4 full parallel runs on 2026-10-26 and passes alone 3 of 3; untouched
by SQA.

## Current reconciliation, 2026-10-14

Next-20 item 1 is live at 962b184b (green deployment, 2026-10-11 10:46 UTC):
Stripe invoice/payment sync defaults to no-create and logs unlinked customers.
Items 2 to 7 are live in 6f9f2170 per Liam's batch brief: suggestion target
guards, nested access guards, billing race/parent fences, previewed Stripe
customer linking, explicit Xero contact linking and transient suggester deferral.
Their individual source/review commits are recorded under N20.1 to N20.7 in
TASKS.md. SW.1 still owns the first-run unlinked list and historical recovery;
T1.16 still needs scoped-seat isolation proof.

Decision #070's per-person MCP is live (0870fb71 dashboard, 2a01b12b worker,
0112 applied). REC.0 phases 1/1b are live (6f9f2170/729cc282), and phase 2
dashboard is live at 15de17d7, per Liam. Migrations 0113 and 0114 are applied
per the current brief. The tray app under apps/recorder-tray is built through
93ce4c62; installed Windows integration and representative real-call proof
remain. REC.0 is open, rather than treating a build as installed-call evidence.

Reconciled backlog states: IC.9 and HA.1 to HA.9 have recorded live evidence;
CT.15, CT.17, T3.8/T3.9, SW.1, FU.9, CB4/MR.6 and TP.4 are partial or
verification work. DL.3 is reported written but lacks external design-project
readback, so remains [~] before DL.4. Files expansion is FILES.1; CL.1 remains
the shipped Clerk-delete guard. The dated inventory appendix records each
contradiction and the evidence used. This documentation batch performs no
production reads/writes, commit, push, migration apply or deployment.

Contract/time repairs retain partial proof: bc7412e9 records signed-in
contracts and time; 2f81243f records 375 light/dark and 768 dark contract
cards, fitted local 1280 table and 2.75rem time controls. FU.2 still needs the
changed signing-email preview/send proof; FU.5/FU.6 retain schedule/menu/Wire
and recorded table-layout observations. LW.9/LW.27's read-only Giant Group
home rendering is proved, while A5's real-client session remains open.

## REC.0 phase 2 Windows client, prepared 2026-10-14

Liam's first real Zoom call detected and linked correctly, uploading 68 chunks
per track, but every system chunk transcribed empty. The default Communications
render endpoint was different from Zoom's playback endpoint. Mic speaker bleed
then labelled the other party as Liam. The uncommitted fix in the tray worktree
follows meeting process-tree sessions on render/capture endpoints, adds saved
manual choices and per-track silence diagnostics, and prefers runtime-gated
Windows process loopback. REC.0 remains open for installed real-call proof.
Release solution build passes with zero warnings/errors; all 256 xUnit tests
pass, zero failed/skipped. Source QA and tray UX pass after device-stop callback
races, missing-device diagnostics and keyboard/touch access to peaks were fixed.
Logs and TRX: apps/recorder-tray/.build-logs/audio-devices-*. No commit or deploy.
Own-process native loopback activation, PCM initialization, capture and disposal
also pass on Windows 11 build 26200, without saving audio or running the host.

Liam's tray-app brief confirms the server side is live on production at main
15de17d7. Earlier server preparation notes below remain historical.
The feat/rec0-tray-app client is committed at 8665e762, with .NET 8 Core,
WinForms host and xUnit projects under apps/recorder-tray. Known-call automatic
start, twenty-second unknown-call capture, stop/split/pause rules, DPAPI,
WASAPI two-track capture, visible tray/toast controls and a durable per-device
outbox implemented. The committed baseline builds with zero warnings and tests
pass with restored packages. Review repairs add protected data/install ACLs,
working toast arguments, manual/early-join/suppression fixes, resilient polling,
per-recording recovery, Communications audio devices, portable crash spool,
ten-second gap stop, short-tail folding, retention and lifecycle flush.
The first review repairs are committed at 938bd68e. Round 2 fixes at 5e77adc5
retain silent single-track capture, reset manual suppression after a closed session, stop
blocked local capture and harden retries, retention, upgrade ACLs and folder
publishing. Round 3, committed as 6964660b, follows the failed Opus re-review of
5e77adc5. It addresses gap auto-start hold-off, later-calendar
suppression, process-key stability, bounded chunk IO failures, faulted-job cleanup,
terminal recovery, render-outage logging and startup access guidance. Round 4 is
the follow-up (committed as 93ce4c62) for late-stop back-to-back capture, expiring calendar
restart qualification, consecutive IO failure accounting, nonduplicated startup
recovery guidance and resetting the render-outage report for each recording.
No dashboard code, push, deploy, pairing, secret or production-data change was
performed in this follow-up.

Round 2 Release solution build passed with zero warnings/errors. All 152 xUnit
tests passed, zero failed/skipped, and folder publishing passed with 476 files
including native runtime libraries alongside the executable. Source QA and tray
state review passed. Verification is recorded in the running log and review report.
Round 3 Release build passed with zero warnings/errors; all 181 xUnit
tests passed, zero failed/skipped. Build/test logs and TRX are under
apps/recorder-tray/.build-logs/round3-*. Round 4 Release solution build passed
for all three projects with zero warnings/errors; all 207 xUnit tests passed,
zero failed/skipped, in one test assembly. Logs and TRX are under
apps/recorder-tray/.build-logs/round4-*. No publish or recorder launch in this
follow-up.
The main session must publish and verify Windows integration and real calls.
REC.0 stays open. Build steps and hardware/integration checks are in
apps/recorder-tray/README.md.

## REC.0 phase 2 dashboard, live per Liam 2026-10-14

Phases 1 and 1b are live per Liam's current brief, main 729cc282. The live
five-second WAV probe passed for both tracks; retain Whisper vad_filter.
The tray dashboard implementation is live at main 15de17d7 per Liam:
migration 0114 shipped alone at 97b0b0ae, server/UI at e961108f, restricted device auth/pairing, owned slim recording
APIs, quotas, upcoming calls, Settings devices and full-profile list/revoke
MCP tools. The review repair is committed at 54b14081: overlapping call windows,
member matching, empty/stale recording recovery, rolling audio quotas, pairing
limits/HMAC/audits, batched reads and Settings fixes. Decision #072 records
the fixed choices and pairing's MCP exception.
0114 is applied per Liam's current brief, as is phase 1 migration 0113.
Signed-in device UI 375/768 light/dark observations and installed tray/call
proof remain. No migration apply, deploy, secret change or C# execution is
performed in this batch. REC.0 stays open. The following
phase 1b notes are historical preparation details superseded by this live status.

## REC.0 phase 1b, prepared 2026-10-14

Liam confirmed the manual recorder is live at /calls/record on main 6f9f2170
and his first real test worked. Phase 1b on feat/rec0-phase1b adds
paragraph joining, creator/attendee/client speaker names, deterministic saved
transcript refresh and link re-rendering. The suggester reads the named text.
Optional group separation uses one Cloudflare Nova 3 system-track inference
while Whisper keeps the microphone. Off by default, about USD 0.34/hour before
retries/storage/suggestions; model research is in Decision #071. Raw audio
is durable before conversion, and retries retain completed AI results.

The PWA now has explicit 192/512 PNG icons and a Record call shortcut. Open
recorder tabs or installed app windows show deduplicated in-app prompts for
the team member's calls within two minutes; clicking opens title/call prefill.
No automatic recording or external notification. Existing scoped APIs/MCP
provide creator identity and bounded call time filters. No new migration.

Initial phase 1b is committed as 3570d4e5, with review repairs in 807adc35.
The last follow-up is committed at 729cc282 and phase 1b is live per Liam.
Real Nova accuracy/long-call latency, Windows
installation, and signed-in 375/768/dark checks remain open. Source QA/UIUX reviews pass;
headless browser launch is blocked by sandbox spawn EPERM. Gate results and
handoff notes are recorded in the run log.

The phase 1b review repairs in 807adc35 retain raw Nova JSON
in R2 before parsing and reuse it on retry; a renewed lease keeps
late inference from billing concurrently. Two failed group attempts or a
system timeline over two hours switch to Whisper, with an explicit fallback
action and completed mic results preserved. Gap, speaker, reminder, PWA and
pre-client relink findings are fixed. The two PATCH mirror failures were stale
mocks. Repair source gates passed, 10 targeted Vitest files / 245 tests.

Opus re-review passed with notes. Follow-up 729cc282 folds WAV
remainders shorter than two seconds into the previous part, preserves paid
Nova results when cache writes throw, and limits the long lease to possible
group attempts. Audio deletion removes the Nova JSON, manual Whisper fallback
is admin-only, and malformed transcription JSON returns 400. Follow-up gate
results are recorded in the run log. REC.0 stays open for phase 2.

## Next-20 items 2 to 7 hardening, live in 6f9f2170

Suggestion decisions keep the stored client immutable, permit same-client
request links, and allow only supported task fields with team-member assignees.
Task writes, including templates, validate track and schedule ownership;
explicit client/request pairs must name the same client before insertion.
Brand creation and request
and time exports enforce the caller's client scope. Delivery rollups include
pre-client deal schedules for seats with client access.

Schedule child writes are parent-fenced. Invoice deletion atomically claims a
normalised draft status. Stripe recovery pins the selected client and refuses
duplicate links. Super admins can preview and confirm a customer link from the
client Money tab. The MCP link_stripe_customer tool retains its 403 by design:
Decision #070 authorises api-service, whose admin role is not super_admin.
Recorded actors never upgrade that access.

Xero pushes require an explicitly confirmed contact link. Failed pushes show
the server reason and client Money link; an all-failed batch returns 422. The
admin Money card compares Xero names/emails with client contact emails and
confirms suggested or pasted ContactIDs. ContactIDs are trimmed, validated as
UUIDs and stored lowercase; linking and imports compare ids without case.
Changing an existing link requires explicit replacement confirmation in the
card and replace: true through the PATCH or MCP confirm_xero_contact. The
tool remains blocked for designers. Contact linking is unique across clients;
imports exclude archived clients and skip ambiguous links. Cron and public
lead secrets use the shared constant-time helper.
Transcript server, connection and full read timeout failures defer only the
affected call; 429, 529 and sweep deadlines retain batch deferral. Settings
counters exclude 429/529 and provider-wide connection/server outages. A
connection/server failure counts only when another model read in the same
sweep succeeds. Counted failures exhaust after five attempts; second-read
exhaustion keeps the first read's drafts before stamping. Counters clear on
processing or exhaustion, with the reason in the run summary. No migration.

Source regression coverage is recorded in the run log. Liam's current brief
confirms this release is live. Broader scoped-seat and reconciliation tasks
remain separate from the shipped items 2 to 7.

## Live 2026-10-12: per-person MCP connector (Decision #070)

LIVE on production 2026-10-12 (NZ): dashboard 0870fb71 (Deploy dashboard
38187345857 green), migration 0112 applied (Liam full, Staci designer, read
back through /api/admin/mcp/identity), MCP_IDENTITY_SECRET on both workers,
OAUTH_TOKEN_SIGNING_KEY and OAUTH_TOKEN_EPOCH on tahi-mcp-server, worker
2a01b12b (MCP worker deploy 38190140830 green, version fd518c44, rollback
target cf744676 is the old shared-key build). Smoke: key form 410,
client_credentials refused, unauthenticated calls 401, dashboard health green.
There never was an OAUTH_APPROVAL_KEY secret (the old form fell back to
OAUTH_CLIENT_SECRET). Waiting on Liam: reconnect and run the test checklist
(first item: the consent cookie survives the cross-site callback), then
Staci connects. Not yet seen live: the signed-in consent page at 375px and in
dark mode.

The design as built: The worker MCP consent is a Clerk sign-in at
/mcp/authorize instead of the shared approval key; every token names one team
member and their profile (team_members.mcp_profile, migration 0112). Liam is
full (unchanged behaviour), Staci is designer (reads everything, writes tasks,
time and requests, anything a client sees or receives only with her
confirmation in chat, everything else blocked by default deny in
workers/mcp-server/src/tool-profiles.ts and again on the dashboard in
lib/mcp-designer-routes.ts). MCP writes record the real person through a
signed actor header; authorisation is still the service token. New tool
hand_off_to_developer.

Cutover order used (each step verified before the next): push the dashboard
commit alone and wait for Deploy dashboard green; apply 0112 and check the
profile rows; list any active_timers rows whose user_id is api-service (they
become unreachable once timers are owned per person) and stop only those more
than 24 hours old, reporting the rest; set
OAUTH_TOKEN_SIGNING_KEY (its own value, 32+ chars) on the worker and
MCP_IDENTITY_SECRET (one value) on both the worker and the dashboard; only
then push the worker commit; bump OAUTH_TOKEN_EPOCH and delete
OAUTH_APPROVAL_KEY; Liam reconnects, then Staci. Deploying the worker ends
every existing connector session.

Staci's roughly 24 hour re-prompt: cause unknown. The old refresh path was
proven to work for form, Basic and JSON token requests, so it was not a code
bug that could be found locally. Every refresh rejection now logs a reason
code and an unanswerable identity check returns a retryable 503; diagnose any
further forced reconnect with `npx wrangler tail` on tahi-mcp-server.

Open for Liam: designer time logged through log_request_time is billable at
the client's default rate (the profile only stops her setting billable or a
rate herself).

## Work in progress, 2026-10-11

Historical phase 1 preparation (now live per Liam on 2026-10-14): REC.0
was committed as 1608f4c6 on feat/rec0-manual-recorder, then
reviewed by Opus. Review fixes are in 989e31db (re-reviewed, PASS with notes). The
build adds a manual Windows
Chromium mic/system recorder at /calls/record, durable chunk uploads,
Whisper turbo transcription, explicit transcript linking and read/link MCP
parity. Phase 1 is now live at 6f9f2170 and 0113 is applied per Liam's current
brief. The earlier review worktree wrote and registered 0113 but did not apply
it; that preparation note is superseded by the main session's confirmation.
This documentation batch performs no commit, push, deploy, migration apply
or secret change.
The standard test/build runners previously hit subprocess spawn EPERM.
Local checks and browser-proof gaps are recorded in
docs/superpowers/audits/2026-10-13-rec0-phase1-report.md. REC.0 stays open.

Repair source 2f81243f and integration a14d0dea deployed at release
511c7d5f; the final invoice action repair is live at 58433694. Dashboard
38099534777, MCP 38098768463 and cron worker 38098768460
passed. Public health is green: root 307 to sign-in, sign-in 200 and signed-out
overview the branded HTML 404. All 423 Vitest files / 7,532 tests, type-check,
lint and production build passed. Migration 0111 was applied before the push,
with a fresh backup/rehearsal preserving all 121 existing tables/data and
indexes. Its eight named objects and column constraints are verified.

Signed-in production QA works in the Codex browser as Liam. The invoice list
reads all 120 invoices, exports 120 CSV rows and paginates beyond the old
50-row cap. Live 375/768 dark cards and the 1280 fitted seven-column table
pass. The paid-month filter includes the recovered Lingorama payment. Client
home passes 375 light/dark and 768 dark in the Giant Group read-only lens;
actions stay disabled and the onboarding checklist stays hidden. Requests
list/board and create/cancel, and client search/create/cancel, pass live.
Both module ports remain partial and ported, unchecked. CN.3 Slack proof
still depends on CN.2 setup. The tenancy CI suite skipped for missing dev
Clerk keys; its green workflow is not isolation proof.

The live recovery preview identified a production Stripe test-mode key.
Liam replaced it with the correct live key. A fresh preview matched the paid
invoice and no duplicates; the app imported WEBL8VAA-0002 for Lingorama,
USD 1,000, with one line item, correct customer mapping and an audit entry.
No email or Stripe write occurred. Broader historical reconciliation remains.
The post-deploy recovery preview still matches the existing paid invoice,
confirming the corrected live key survived deployment; no second apply ran.

Live QA found a paid invoice still offering Delete despite the API's draft-only
guard. The one-file repair passed independent review and a fresh full gate;
paid and draft detail checks pass live at 375/768 in dark mode after 58433694.
No invoice was deleted. The changed signing email preview
also remains pending: its endpoint has no UI action, so Liam was given the
two-variant console command. Vivaldi is Liam's main browser; it is not currently
connected to Codex. TASKS.md and the run log keep the remaining evidence.

## The plan (2026-08-18)

Liam's call: ship every surface a client touches first (proposals, contracts, schedules, portal), cut over from ManyRequests, then improve team/owner surfaces slowly. TASKS.md now carries five sprints: **C0 ops unblock -> C1 sell without embarrassment (deliverable money paths, ~5d) -> C2 portal truth (five blockers, ~12d) -> C3 client-facing redesign stragglers (~4d) -> C4 live QA gate.** Roughly 4-5 focused weeks to a defensible cutover.

## Next work, triaged 2026-10-10, refreshed 2026-10-14

See docs/superpowers/plans/2026-10-10-dashboard-task-triage.md for readiness,
source evidence and dependencies. Remaining order: SW.1 historical Stripe
reconciliation/unlinked customers; scoped-seat isolation (T1.6/T1.16); FU.1
scheduled duration/drain proof (FU.7 is done); expired-link/signing-email
preview and responsive/dark residue; authenticated e2e/browser cleanup and
shared live laps; honest-action/MCP adapter proof; CN.2/CN.3 Slack DM/digest
proof and bounded invoice/client ports. REC.0 needs installed Windows tray
integration and real-call proof; WQA.0 remains scope only.

MCP consent hardening, roleless deny, core hire linking and most named entity
scoping are already implemented. They need verification, not the old rebuild
briefs. CN.3 was integrated in a14d0dea and deployed at 511c7d5f after 0111
was applied on 2026-10-11; Slack DM proof still depends on CN.2.
The nineteen design ports may proceed as "ported, unchecked"
under Liam's 2026-09-26 instruction, with the review boxes kept empty.

Live cron SELECTs on 2026-10-10 show calendar, transcript and suggestion jobs
succeeding. Calendar read sync does not prove calendar write permission, and
successful bank sync does not prove the manually maintained yield is current.
No feature was built or production data changed during the triage.

## DEPLOY GATE - RESOLVED 2026-09-10

**Pushes to main DO auto-deploy to production now.** The `production` GitHub environment carries no protection rules any more (checked through the API on 2026-09-12: `protection_rules: []`), so the "Deploy dashboard" workflow's production job runs straight through: 4e43bd9d was pushed at 01:07 NZST on 2026-09-10 and was live at 01:14 with nobody clicking anything. The Aug 10 story (dc41442a sat behind a required reviewer for 8 days) is history. If the gate ever comes back it shows up as a run stuck on "waiting" at GitHub -> Actions -> the run -> Review deployments.

## Since the last update (2026-09-21 to 2026-09-26)

Detail with commit ids is in TASKS.md (CN.1c, CN.2, LW.34, LW.40, LW.43, D3, and "Follow-ups from the 2026-09-26 batch").

- **Crons fire from a Cloudflare Worker** (LW.43, 2026-09-22): workers/cron-trigger replaced the GitHub schedules, which dropped most runs. **But the call-notes suggester never reached its handler from 22 to 26 September**: it lives under /api/admin/crons/ (plural), the worker sends only x-cron-secret, and the path was missing from the middleware's public list, so Clerk answered every run with a 404. Fixed and deployed 33f61601 on 2026-09-26; the 05:13 UTC run read the missed call and filed a suggestion. middleware.test.ts now walks every cron-trigger target through the middleware, so a new schedule entry cannot ship without its public line.
- **The Slack app (CN.2) is deployed** (b06b0d91, migration 0110) and waits only on Liam's manifest, reinstall and the two secrets. Its three loose ends shipped 2026-09-26: a channel mention answers with a pointer to a DM and never creates a note, a modal submit is acknowledged cleanly, and slack_events_seen is swept daily after seven days.
- **Suggestions (CN.1c) deployed ed2d4385**: a re-read adds to what is waiting instead of replacing it (only an explicit replace expires rows), and every call is read twice, the second read shown the first and asked for what it missed. The sweep has a 75 s budget under the worker's 120 s cut, about one call per half-hour run; calls that do not fit wait unstamped for the next run.
- **CN.3, keeping in sync (current state updated 2026-10-14)**: integrated a14d0dea and deployed 511c7d5f on 2026-10-11 after migration 0111 was applied and verified. Slack thread lines, weekly digest, same-client rejection examples and wizard learning are deployed. The earlier cn3-ready preparation instruction is complete; CN.2 setup and live DM/digest proof remain. Contract: docs/superpowers/plans/2026-09-26-cn3-sync-contract.md.
- **Tests (LW.34)**: the three files that failed only under a full parallel run were fixed at the root; 387 files green.
- **Phone and dark (LW.40 round two, ed2d4385)**: the morning's live pass at 375 found five of the eight fixes good and three not: the brief's Refresh and Nudge buttons at 26px, the Wire ticker with no hanging indent, and the contracts list as a sideways desktop table with its row menu 900px off screen. All three are fixed and deployed (44px targets, the Wire indent, mobile contract cards, 44px row menus on every DataTable, a dark danger ink token). **Not yet seen live**: the extension disconnected after the deploy.
- **Contract truth (ed2d4385)**: a contract past its expiry now shows its expired state before any signature pad (it used to let the client draw and then refuse); the viewer's fine print says what the link really does; a contract marked signed by hand (the Lingorama SoW) no longer reads "Fully signed, 0 of 2 signed" with today's date invented as the signing date; the admin preview pill and audit trail hold at 375; the signed PDF is stored even when no email goes; public links no longer flash dark. Not yet seen live.
- **Deliverable specs (D3)**: e2e/sales-publish.spec.ts and e2e/public-viewers.spec.ts green on the QA harness (proposal share to accept to studio notified, contract send to two signatures to stored PDF, revoke, expiry, 375 and dark). The live rehearsal with real inboxes is still owed.
- **Financial snapshots**: August cash cannot be honestly rebuilt because yield was held and past yield amounts are not stored. Insert-only single-month fill preserves earlier backfills. "vs Jul (no Aug MRR)" was the September observation, superseded in October by the actual prior snapshot month from mrrDeltaBasisMonth; the dynamic label already exists. Next-20 item 12 retains the October check. Airwallex sync records finance.yieldFirstHeldAt to prevent fabricated historic cash.

### Operator steps waiting on Liam (2026-09-26)

- Slack: apply docs/superpowers/plans/2026-09-22-slack-app-manifest.md to the existing Tahi Dashboard app, reinstall, set SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET, then DM it once (a voice note too: confirm one recording gives one card).
- Reconnect Chrome's Claude extension (or look yourself) so the ed2d4385 phone and dark pass can run; the list is in TASKS.md under LIAM.
- Optional: set finance.yieldFirstHeldAt to the date of the first transfer into Airwallex yield (YYYY-MM-DD) if you want months before it rebuilt.
- Everything in the 2026-09-21 list below that is not ticked: Google reconnect, Mark Ramsey's address, the "test manual" invoice, the real-session lap, the pay-rise decision (1 October payroll), the design review, PM.0.

## Since the last update (2026-09-13 to 2026-09-20)

Full detail with commit ids is in docs/superpowers/plans/2026-09-13-overnight-run-log.md (dated entries) and the TASKS.md sections named in brackets.

- **Giant Group is live on the portal** (2026-09-14, LW.33): their org is on the email allowlist, Michael Day was invited through the real flow (link valid to 27 September), Mark Ramsey's invite waits on the spelling of his address. The first real hand-off went through the MCP on 2026-09-18: request #244 to Mickey Day, due 30 September. Their two shared proposals are the only ones on the home's Proposals live card.
- **Liam's second walk-through round** (2026-09-14, LW.21 to LW.36): one scrollbar on the requests board; delete a file from every files surface with MCP delete_file; Services hidden for clients the way Messages is; one focus ring on the AI composer; the seat invite flow fixed end to end (signed out plus a token goes to sign-up with the email prefilled, acceptance runs on arrival, seat versus first contact decided from the org's contacts); the client home empty state keeps the dark header; "Sign out and return to sign in" on every onboarding step; People delete resilient to a missing Clerk membership; member seats never see plan or billing; prep notes on every call (migration 0102); the "test manual" phantom invoice written off and the Stripe importer taught never to demote written_off or paid; the comment ball picks its element and snaps to an edge (0101) and stores screenshots (0103, applied 2026-09-15 after the insert had failed for a day). Google Calendar: the production grant was read-only, so kickoff bookings never reached the calendar; scopes widened, Liam reconnects once (LW.8b).
- **Client hand-offs on requests** (2026-09-18, HO.1 to HO.4, Decision #063): named contact/reason/note/date, Waiting on cards and automatic hand-back on approve/upload/reply are built (0104 applied). Reminder support is built but NOT scheduled: delivery-watch and automation-sweep are absent from workers/cron-trigger, so no three-day automatic email has run. Liam decides reminder policy before enabling it. MCP hand_off_request, hand_back_request, list_requests_waiting_on_clients and get_dashboard_guide; /help renders for both audiences.
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
- **Claude Design write-back (DL.1, DL.2) complete**: 14 of 14 files in. Eleven went through write_files and were read back line for line; the three over 100 KB (sales-artifacts.jsx, sales-artifacts.css, sales-pipeline.jsx) went in through the design-sync disk upload on 2026-09-13 and read back at their full line counts. DL.3 is reported written by the lead's 2026-09-13 catalogue/run-log update, but external project listing/readback is not recorded. It remains [~] for that proof before DL.4 re-critique; this batch cannot inspect the design project.
- **Pre-call digest timing fixed** (482627b8, live): Google Calendar rows carried a +12:00 offset and the cron compared them lexicographically, so New Zealand calls fired about twelve hours late. Every writer now stores a UTC instant, the cron compares instants, the email prints NZ time; the 71 stored rows were normalised on 2026-09-13 (dry run, apply, second dry run clean).
- **Giant Group readiness Batch A is live** (66b18917, 2f0c20a0; TASKS.md "Batch A"): the portal tells a Scale client the truth about rate, currency and tracks; an existing client is never sent through a plan picker or a card form; How to pay shows when a Xero invoice has no link; client emails carry the org id to the allowlist gate; the home call is joinable; the services catalogue is populated (Maintain, Scale, three add-ons, no prices); Messages is hidden for every client; the importer handles subset runs. Smoked in Client view of Giant Group on production. Open: the A4 isolation spec has to run green on the harness (a pre-existing goto race is being fixed), import notes leaking into the client invoice (fix in flight), per-currency bank details, and the real-session lap that only Liam or Staci can do. Readiness estimate: about 92 percent, the real lap and a week of studio use are what buy the last points.
- **Overnight design pass, 2026-09-14** (docs/superpowers/plans/2026-09-14-design-review-for-liam.md): 27 requirement documents written from the code and the backlog, then 19 design modules built in Claude Design by opus designers and screenshot-critiqued at 1440 and 375 in light and dark, one revision each. 14 modules stand at SHIP, 4 at FIX with a bounded list (portal-account, portal-files, portal-money, requests, tasks), calculator-analytics awaiting its critique. Every module is reachable in the app shell for its audience with zero console errors. Nothing is ported; Liam reviews first.
- **Late evening 2026-09-13 to 00:30 NZ**: default project manager for new clients by engagement type (PM.1, e9feda94; both defaults and the override read Liam on production), the request wizard knows each client's history and coverage gaps (GI.4 step one, ff9939bd), the beta comment ball (BP.1 stripped back, 1ebb63f5: a draggable floating button on every dashboard and onboarding page, a comment panel, page context and recent errors stored, read through the MCP tool list_feedback_comments; migration 0100), the backlog reorganised (TASKS.md, 95 open ids, old file archived). The overnight design pass (19 modules in Claude Design, requirements under docs/superpowers/design) is held for Liam's 8am review.
- **Liam's dummy-client walk-through, nineteen fixes in one evening** (23b5c681 to f2c3182f, 2026-09-13; TASKS.md "Liam's dummy-client walk-through" LW.1 to LW.20): one studio project manager for every client (setting), pronoun-free lead copy, onboarding video and the home checklist card hidden for now, kickoff slots from the studio calendar with the client's timezone named and an honest read-only view, one New request on the client home and no project language for a custom-priced retainer, the request detail rail that collapsed at mid widths, the AI wizard (rendered replies, growing composer, every draft created, honest timelines, client context with team access scoping), seat invites in Tahi's own email with Clerk invitations removed, and a new seat of an onboarded organisation landing in the portal instead of the wizard. Root causes closed: the Google grant was read-only so kickoff events never reached the calendar (scopes widened, Liam reconnects once), and the dashboard gate keyed onboarding completion on the individual user. Live checks by Liam pending.
- **Catalogue Batch C, deliverable truth** (3ecafbba to the C4 merge, 2026-09-13 evening; TASKS.md "Catalogue Batch C"): share links tell the truth (snapshot on first share, 404 after revoke, publish re-arms), public viewers work in dark and at 375, accept freezes the amounts and refuses expired documents with the studio told of every accept, decline and question, contracts notify on every signature with the signed PDF in R2 and a body hash anchor. Migrations 0098 (applied) and 0099 (runner after deploy). Playwright coverage for both round trips is still owed (D3).
- **Catalogue Batch B, money path** (c1e8c24e, 5829bf0d; TASKS.md "Catalogue Batch B"): /billing on the v3 primitives and out of the client nav by default, Manage Billing only for a Stripe-rail client; client invoices at 375 pinned by a Playwright spec; the IC.8 stamp route so historical hours are marked invoiced before the first hourly Xero export (apply is Liam's call); the client home team card now shows the assigned project manager; the Google Calendar sync cron no longer wipes a manually pasted meeting link (root cause of the N8N call losing its Join link). The services plan ladder (CB1) is fixed on its branch and merges after re-review.
- **Build incident, fixed** (d6574c26): a report committed with a Windows path broke the production build because Tailwind v4 scans every non-ignored file for class names and read `\c697ea` as a CSS escape. globals.css now excludes docs, SPECS and the root markdown files from the scan. Write paths in reports with forward slashes.

---

## Triage snapshot (historical 2026-08-18 audit, corrections through 2026-10-14)

The original August blockers below are historical findings. Current deployed
behavior and remaining proof are recorded here and in TASKS.md; the old
"no commits since August" heading did not describe the October platform.

### Tenancy proof

- **e2e/tenancy-isolation.spec.ts is the cross-organisation isolation proof** (Batch A S6, 2026-09-13): two seeded client organisations, every portal read and write tried across the boundary in both directions (requests, files, invoices, conversations, contracts, calls, every id-less route), 3 of 3 green on the local QA harness via `npm run test:e2e:tenancy`. Not yet run in CI (needs a seeded D1 and Clerk dev keys on the runner). Re-run it after any change to lib/portal-access.ts, lib/permissions.ts or a portal route.

### Trusted 100% (daily-driven and/or live-verified)

- **Sales pipeline** (daily-trusted; data real; UI is pre-v3; manual-only nudges after 2f81243f)
- **/financial-reports** (daily-trusted; Airwallex-first cash source deployed; yield freshness remains LW.42)
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

### Deliverable fixes shipped, shared round-trip proof remains

- **Proposals**: C1 3ecafbba snapshots on share and re-arms Publish; C2 bad0d7ef repairs phone tabs/public themes; C3 97e51af0 notifies the studio on accept, decline and question, with accepted amounts frozen. T3.1 to T3.4 and D3 retain shared live round-trip proof.
- **Contracts**: C4 32c78bee persists signed PDFs in R2, notifies on signatures and anchors/locks the body. Migration 0099 is applied; 2f81243f adds deadline/send guards. The duplicate signature template was removed in be6d7365. T3.6/T3.7/D3 live signing/PDF proof, FU.3 countersign policy and the T3.10 viewer/rotation port remain.
- **Schedules**: C1/C2 shipped snapshot sharing and phone gantt/public theme repairs. Verification of the deliverable round trips remains; the August share/theme bugs are not current rebuild tasks.
- **Deals** (internal): 2f81243f rejects scheduled nudges with 409, removes automatic-follow-up claims and reports held recipients. Manual nudge proof remains T3.8. Acceptance/signature notifications are shipped; v3 composition and the Stalled flag remain separate work.

### Historical portal blockers (C2 shipped, real-session proof remains)

**Update 2026-09-05:** B3, B4 and B5 shipped in the Tier 1 cutover (`docs/superpowers/plans/2026-09-05-cutover-tier1.md`) and were verified on production: portal invoice detail with a persisted pay link, the client Files page and honest nav, invites minted and emailed from the client detail with the portal admin role on the first contact, the second seat linked on sign-in, "invoice me" completing onboarding. The cron workflows also needed the Clerk public matcher opened (b8b3f366) after the URL fix. B1 and B2 were not in the 2026-09-04 ship readiness audit's blocker list; treat them as fixed earlier and re-check on the first real client. The entries below are kept as the historical record.

1. **B1 uploads identity**: confirm resolves the authenticated client's owner and ignores a client-supplied target org; portal files reads the resolved org. The old cross-org confirmation claim is superseded. A5/CT.10 retain real-client round-trip proof.
2. **B2 notification identity**: recipient resolution and notification routing shipped; the real-session bell/reply proof remains A5. The August unused-helper claim is superseded.
3. **B3 portal invoices**: the 2026-09-05 Tier 1 cutover shipped portal detail, persisted pay links and truthful pay actions, verified on production. Full client payment lap remains T2.QA.
4. **B4 client nav/files**: the Tier 1 cutover shipped Files and honest nav; Messages and Services are hidden by default, with per-org overrides. Shared document links and scoped portal APIs provide document access; named Contracts/Proposals/Schedules nav entries remain removed. Current mobile nav is Overview, Requests, Files and More (Notifications, How this works, Settings).
5. **B5 onboarding**: the Tier 1 cutover shipped app invites, second-seat linking and invoice-me completion. LW.18/LW.19 move invites into Tahi mail and gate completion by organisation. A5 real-seat proof and LW.8b Google reconnect/kickoff booking remain open.

### Redesign coverage (sweep 2026-08-18)

**58 routes: 26 v3 / 20 partial / 8 legacy / 4 stub.** Client-facing laggards that matter: `/services` (legacy, zero primitives, client catalogue), `/billing` (legacy), `/invoices/[id]` (legacy detail behind a v3 list), `/files` (stub), `/p/contract` viewer (only public viewer off the deliverable kit). Client-facing partials: /messages, /tracks. (/tasks left this list on 2026-09-05: it is v3 and team-only, see "Ported, live smoke pending" above.) Better than assumed: /calls, /team, /invoices list, /affiliates, /announcements, /reviews, /sales-analytics are already v3. Biggest internal partial: /reports (10 hand-rolled tables).

---

## Known live bugs (priority order)

**Reconciliation follow-up, 2026-10-11 (SW.1):** Lingorama's paid invoice and
customer mapping are recovered through the app as Liam. Broader historical
invoice/subscription reconciliation remains, with identity and duplicate checks.
See TASKS.md and docs/superpowers/plans/2026-10-10-stripe-webhook-investigation.md.
The production Stripe test-mode key was corrected by Liam after the first
preview returned 404. The repeated preview and recovery succeeded. Wrangler
access and browser sign-in now work.

**Verification before adding a scoped teammate (T1.16):** the search and
nested feature/client guards are deployed in 2f81243f and a14d0dea; next-20
item 3 adds the reviewed nested-route repairs, live in 6f9f2170. Real SQLite
tests cover denied/scoped identities, current permissions and empty scope.
The remaining live isolation lap needs controlled scoped/denied seats; Liam's
super-admin smoke alone cannot prove those refusals.

**Resolved 2026-10-10 (SW.0, tracking commit b361968f):** Liam authorised
applying the existing live endpoint secret from his PC. Wrangler updated
STRIPE_WEBHOOK_SECRET on production worker tahi-dashboard. The real ignored
invoice.payment_succeeded retry returned HTTP 200 at 22:53:17 NZDT and Stripe
shows Delivered, Recovered. Public health probes passed; signed-in /overview
loaded its real data. No billing data writes or application code changes.

Older items refreshed 2026-09-26, kept below with their state.

1. **P1 - deployed, not yet seen live:** the three LW.40 fixes that failed the 2026-09-26 morning pass and the contract truth fixes (ed2d4385); the list is in TASKS.md under LIAM. The real-session lap (A5: greeting, bell, invite path, second seat) is Liam's or Staci's and has not happened.
2. **P1 - `finance.yieldHoldings` freshness (LW.42, T0.3):** Airwallex is cash truth. The 2026-09-22 USD 20,014 setting versus USD 25,100 in Airwallex was updated by hand as Liam; older August Xero/setting figures are historical. No current balance was re-read in this batch. A successful 2026-10-09 sync wrote two yield rows but does not prove their amount is current. T0.2 owns the live UI/API comparison; LW.42 owns an automated yield source or age warning (next-20 item 11).
3. **P2 - FU.1 verification:** 2f81243f caps each read at remaining budget; the hanging-read implementation defect is repaired and deployed. Transient-failure and outage-safe deferral is live in 6f9f2170. Watch scheduled durations and queue draining; the zero-eligible-call triage run is not timeout-path proof.
4. **P2 - the hand-off nudge (HO.1) has never run, nor has the automation sweep:** delivery-watch and automation-sweep are not in the workers/cron-trigger schedule (list_crons shows no run ever). The built three-day nudge remains unscheduled. Scheduling delivery-watch as built would email Giant Group's contact automatically (their org is on the allowlist); the PM scope (decision 7) recommends the studio presses Send reminder instead. Liam decides before either is scheduled.
5. **P3 - August 2026 cash remains unavailable:** month-end cash cannot be honestly rebuilt because yield was held. HA.3's MRR label already follows the actual prior snapshot month, rather than hard-coded July. Next-20 item 12 still checks the October September-basis rendering/snapshot. HA.1 to HA.9 have recorded September live evidence (1a7ef35b); those dated figures are not current balance claims.
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

Scheduled and automatic deal nudges are unavailable by design after the
2f81243f honesty repair, not an exposed stub. T3.8 retains manual action proof.

---

## Definition of Done (enforced)

Per `CLAUDE.md` rule 8: type-check + lint + deploy green (no approval click any more, see DEPLOY GATE) + live smoke + 375px + dark mode + commit note.

## Production-readiness exit criterion

**Client-ready cutover** (revised 2026-08-18): sprints C0-C4 complete, one full live client-session QA lap passed on prod at 375px + dark, and a real client has completed one proposal-accept and one contract-sign round-trip without a Tahi hand touching the database. Team/owner trust-crossover continues post-cutover.
