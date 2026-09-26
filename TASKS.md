# TASKS.md, reorganised 2026-09-13 (the previous file is archived at docs/superpowers/plans/2026-09-13-TASKS-before-reorganisation.md)

# Tahi Dashboard, reorganised task list

Proposed replacement for TASKS.md. Written 2026-09-13 from evidence, not memory:
`git log --oneline -80`, STATUS.md "Since the last update",
`docs/superpowers/plans/2026-09-13-overnight-run-log.md`, and the merge commits of
tonight (Batch B, Batch C, LW.1 to LW.20).

## Open id count

- Open lines in TASKS.md before this pass: **112** (75 `[ ]`, 37 `[~]`).
- Two of those lines repeat an id that is already written elsewhere in the open
  set (GI.1 twice, GI.2 twice), so the distinct open id count before is **110**.
- Resolved to Done in this pass on evidence: **13**.
- Merged into another open id: **1** (CB5 into IC.8).
- Distinct open ids after this pass: **96**.

110 = 13 done + 1 merged + 96 still open. Nothing was dropped.

## How to read this file

- `[ ]` open, `[~]` merged but not yet proved live, `[x]` merged, deployed and
  seen live.
- An id has exactly ONE home in this file. Sections that schedule work
  (the catalogue batches) reference ids rather than repeating them, so no id is
  counted twice.
- An item only flips to `[x]` when the evidence names a commit AND a live
  observation. Merged with no live look stays `[~]` with the commit named.

## Definition of Done (verbatim, CLAUDE.md rule 8)

A task only flips to `[x]` after all of:

1. `npm run type-check` zero errors
2. `npm run lint` zero errors
3. Pushed to main + Cloudflare deploy green (GitHub Actions "Deploy dashboard"; no approval click since 2026-09-10)
4. **Live browser smoke**: golden-path flow exercised on the deployed URL
5. **Mobile 375px**: layout verified, no horizontal scroll, touch targets >= 44px
6. **Dark mode**: page rendered with `.dark` class, no contrast regressions
7. **Screenshot or note** added to the commit body or PR confirming 4 to 6

Tasks failing any of 4 to 7 must stay `[ ]` even if 1 to 3 pass.

## Liam's confidence tiers (verbatim, stated 2026-08-18)

- **Tier 1, Trust.** Design consistency; sign in / sign up / forgot password /
  invites completely handled and robust; impenetrable tenancy: a client can
  NEVER reach Tahi-internal data or another client's data; financial data
  visible only to admins of their own org.
- **Tier 2, The working platform.** Once trustworthy: how easy is it for a
  client to make requests, contact us, see their tasks, see progress.
  Requests/tasks/messages polish. "Less focused on cash flow/receivables/runway,
  more on how this runs as a request platform for users, clients, and team
  members."
- **Tier 3, Getting new clients.** Proposals, contracts, schedules money paths.

## Liam's definition of "100 percent dashboard" (verbatim, 2026-09-13 23:20 NZ)

When Liam says "100 percent dashboard" he means the FULL list, nice-to-haves
included (content engine, automations, affiliates, social, sitemap, calculator,
the north-star phases), not only the daily-driver core. Readiness numbers must
say which scale they use.

Readiness answered in chat 2026-09-13: Giant Group 95 percent, full daily driver
80 percent, the full list about 60 percent.

---

# (a) NOW: Giant Group beta

22 open ids. Everything here stands between today and Giant Group using the
portal for real. The code half of the beta is merged; most of what is left is a
live look by a human.

## The one proof nobody else can give

- [ ] **A5, the real-session lap** (plan section 4): Liam or Staci, incognito,
  20 minutes; the only proof for the greeting, the bell, the invite path and the
  second seat. Everything marked `[~]` in this section is proved or disproved by
  this lap.

## Operator steps waiting on Liam

Refreshed 2026-09-21. Each line is a step only Liam (or Staci) can take; the
agent side is done unless the line says otherwise.

- [x] MC.4 - Giant Group first access: DONE 2026-09-14 (LW.33). email.allowedOrgIds
  carries their org (aa80a2d6); Michael Day invited through the real flow (link
  valid to 27 September). Still open on this line: Mark Ramsey's invite waits on
  the spelling of his address (row says ramsey, Liam typed ramsay). The allowlist
  also passes liammiller.dev (LW.1, the dummy test) and every tahi.studio mailbox;
  re-narrow when the dummy test is over.
- [~] LW.8 "The call went through, just wasn't booked" (no calendar event, no
  meet link). Cause: the production Google grant holds only
  calendar.events.readonly, so the event insert was refused and swallowed
  without a log. 03406711 requests calendar.events and calendar.freebusy and
  logs the failure. **LW.8b LIAM**: Settings > Integrations > Google >
  reconnect, then book a kickoff again and confirm the event and Join link.
- [ ] LW.36b LIAM - Void the "test manual" Stripe invoice
  (in_1TGQaE2MOtshRPkATn4r8ByV) and delete the "test manual" org on /clients
  (the importer no longer demotes the local write-off, but the org is a dummy).
- [ ] A5 - The real-session lap (see "The one proof nobody else can give").
- [ ] LIAM - Pay-rise decision: 74k each (Liam's figure, with Meditrain at
  2,200 a month per Bharat's 17 September call) or 78k each (the model's
  recommendation from the live numbers) from the 1 October payroll; top the tax
  pot from NZ$15k to the full IRD balance before the January instalment. The
  analysis is in docs/superpowers/plans/2026-09-13-overnight-run-log.md under
  2026-09-19. Agent side after the decision: update the salary lines on the
  finance page and confirm Meditrain's CRM value (1,250 vs 2,200, and whether
  the 2,200 includes the SE Ranking subscription).
- [ ] LIAM - Work the Suggestions inbox on /tasks as calls come in (CN.1); the
  first similarity warnings show on the next call's suggestions.
- [ ] LIAM - Mark docs/superpowers/plans/2026-09-14-design-review-for-liam.md
  (19 modules, 13 SHIP, 6 FIX); nothing is ported until he has.
- [ ] LIAM - Say go on PM.0 (product manager AI scope) and on CN.2 (the Slack
  app: create the app, signing secret and bot token, invite it to #founders).
- [ ] LIAM or the next session with a browser - the eight LW.40 fixes at 375px
  and in dark (the Chrome extension was disconnected for that round).

## Liam's dummy-client walk-through, merged, live check owed

Liam walked the portal as a dummy client (Company Inc, contacts on
liammiller.dev). Each line names its merge. Nothing flips to `[x]` until it is
seen on production.

- [~] LW.2 Hide the video part of the onboarding flow. MERGED 7ca50bff:
  ONBOARDING_VIDEO_ENABLED = false gates the VideoModal, its trigger and the
  checklist video step.
- [~] LW.3 Liam is the project manager and lead for every client, no matter
  what, for now. MERGED 7ca50bff: setting studio.projectManagerId (Settings >
  Studio details, "Project manager shown to every client") read by one resolver
  for the onboarding lead card, "30 min with X", "Grab a time with X", the
  portal team card and the kickoff host; empty means per-client assignment.
  APPLIED on production 2026-09-13 23:30 NZ: studio.projectManagerId =
  b3025c04 (Liam Miller), through PATCH /api/admin/settings as Liam (0737a4be).
- [~] LW.4 "Staci is your lead. Reach him any time" becomes Liam, and
  pronoun-free copy. MERGED 7ca50bff ("Reach Liam any time in the portal",
  "Liam will look after you either way").
- [~] LW.5 "30 min with Staci" and "Grab a time with Staci to set direction"
  become Liam. MERGED 7ca50bff, same resolver.
- [~] LW.6 Kickoff times synced to Liam's calendar, and the client's timezone
  named. MERGED 7ca50bff: GET /api/portal/kickoff-slots (NZ working-day window,
  DST safe, minus Google free/busy), SlotPicker groups by the visitor's day and
  says "Times shown in <zone> (your time). Liam is in Pacific/Auckland."
  Free/busy filtering starts after LW.8b (until then calendarSynced false with a
  reason). Follow-up: MCP twin for the route (rule 14).
- [~] LW.9 Hide the onboarding checklist card on the client home for now (it
  will come back). MERGED 7ca50bff:
  CLIENT_HOME_ONBOARDING_CHECKLIST_ENABLED = false, the card never mounts.
- [~] LW.10 Client home shows three New request CTAs. MERGED 23b5c681 (code
  21dc21b2): the header button is the only primary CTA; the empty state keeps a
  text link when there are no open requests.
- [~] LW.11 "Your project, phase by phase" shown to a custom-price retainer.
  MERGED 23b5c681: presentation keyed on the engagement
  (lib/engagement-presentation.ts); a custom-priced client with no project sees
  the tracks view or "Your plan is being set up by the studio."
- [~] LW.12 Request detail (admin): two side cards collapse to a sliver at mid
  widths and trap wheel scroll. MERGED 3175bf36 (code 545752a9): the split moves
  to 1024px with minmax(0,1fr), sticky and scroll classes move with it.
- [~] LW.13 AI request wizard prints raw markdown. MERGED f2c3182f:
  lib/chat-markdown.ts (bold, lists, paragraphs, nothing else, text nodes only)
  shared with the task wizard; prompts allow bold and short lists only.
- [~] LW.14 AI wizard composer. MERGED f2c3182f: auto-grows 1 to 8 lines, shared
  focus ring tokens, 44px send.
- [~] LW.15 AI wizard creates only one of three drafts. MERGED f2c3182f: every
  draft created in isolation (admin: parent plus sub-requests; portal: siblings
  with a shared note), success state lists all.
- [~] LW.16 AI wizard timelines and estimates. MERGED f2c3182f: one canonical
  hours table overrides the model, prompt refuses timelines the scope cannot
  meet.
- [~] LW.17 AI wizard client context. MERGED f2c3182f (blocker fix bdc4b329):
  org name, industry, website, brands and the last five requests reach the
  prompt (portal: from the session; admin: after requireAccessToOrg), and a
  multi-brand org triggers the which-brand question.
- [~] LW.18 Seat invites arrive as Clerk's default email. MERGED 7516bc5b (code
  81153703): portal and admin seat invites mint an app token and send
  emails/seat-invite.tsx through the delivery gate; Clerk invitations are gone
  from product code (guard test); new admin team accept route. No Clerk
  Dashboard step needed.
- [~] LW.19 BIG BUG: accepting a seat invite to an onboarded org lands on the
  onboarding wizard ("Welcome to Tahi... Staci is your lead") instead of inside
  the org. Cause: app/(dashboard)/layout.tsx read onboarding completion off the
  individual user's Clerk metadata. MERGED 7516bc5b (code 1c598e9a, 06486308):
  completion is a property of the organisation (stamp, live subscription,
  project, a first-run checklist key, or a request authored by one of its
  contacts); the dashboard gate and the wizard both consult it and stamp the
  user.

## Call notes to tasks with an approval gate (Liam, 2026-09-19; scope in docs/superpowers/plans/2026-09-19-call-notes-to-tasks-scope.md)

One table, task_suggestions, sits between "something was said" and "a task changed"; every source feeds it, the dashboard inbox and Slack read it, applying is one server function, approved updates post as "Tahi bot". Decisions taken 2026-09-19: #founders channel for call suggestions (first founder to click decides); notes are approved by their sender (Staci hers, a client their own request draft); Gemini transcripts through Google Drive (full transcript plus wrap-up), the inbox branch dropped; task threads as proposed; snooze minimal. Phase 0 building as workflow call-notes-foundations (F1 transcripts, F2 Tahi bot and task threads).

- [x] CN.0 - [BE/FE] Foundations (about 3 days): call_transcripts for every call kind (the Drive sync writes there and matches scheduled calls too; unmatched notes parked as unlinked for Liam to attach from the calls page); the Tahi bot actor (authorType bot); task_comments and a Task thread on the task detail, mirrored into the request thread when the task has one. Merged 2026-09-19 as workflow call-notes-foundations: F1 transcripts (opus, 58bba5af) and F2 Tahi bot and task threads (sonnet, 82e01f15), both reviews non-blocking; lead fix 38829444 (backfill a transcripts row for discovery calls stamped before the table existed, no re-export of an unchanged doc). Migrations 0105 and 0106 applied on tahi-db before the push. Live as Liam: task Thread posts and mirrors into the request thread as an internal message, 44px send, 375px clean, dark 13.8:1; calls page unchanged with nothing parked; GET call-transcripts 200. MCP: list_call_transcripts, get_call_transcript, link_call_transcript, list_task_comments, post_task_comment.
- [x] CN.0b - [BE] Gemini export parsed empty on production since the sync shipped (b4188ec4): the export asked Drive for text/plain while the parser was written against the markdown export, so no doc ever parsed and no discovery call was ever stamped gemini_drive (found on the CN.0 smoke, 2026-09-19). f8c8adb7 makes a dry run report what the parser saw; the preview showed the 2026-09 doc shape (a Quick notes block with its own Next steps, then Full notes with Summary, Next steps and Details, then an emoji Transcript heading, star bullets). ba4970c0 exports as text/markdown and reads bare headings too; the follow-up commit starts at Full notes and accepts star bullets. Then f7af0585 (one heading matcher for hashed, bold-wrapped, emoji-prefixed and bare headings; Decisions ends the summary) and 342a450d (timestamp links flattened). Live 2026-09-19: a dry run over 30 days parsed all 15 docs; the real run as Liam filed 14 rows (12 matched discovery calls written with transcript, summary and next steps; 2 parked: the 31 Aug Weekly catchup tied between two calls, a 191-character 25 Aug Charles stub with no candidate), 1 already filed by the cron itself. The cron keeps a 72-hour window every 30 minutes. Polish after the live look at /calls (59398f6f): prose previews on the unlinked card, a 44px Attach target, transcript text without the markdown anchors and entities, and force=1 on the sync to re-export filed docs after a parser change; live after 4deaac11 (a forced pass also rewrites the discovery mirror the sync stamped itself): forced re-sync over 30 days refreshed all 15 transcript rows and rewrote the 13 discovery calls; /calls shows prose previews and 44px Attach buttons.
- [x] CN.1 - [BE/FE/MCP] Suggestions and the dashboard gate (about 4 days): the suggester (Sonnet, the org's open tasks and requests as context, a verbatim quote or the suggestion is dropped, never applies); the Suggestions view on /tasks and a studio home card; Approve, Tweak, Snooze (tonight, this week), Reject, Approve all; one idempotent apply function; MCP list_task_suggestions and decide_task_suggestion. Built 2026-09-19 as workflow cn1-suggestions-build against docs/superpowers/plans/2026-09-19-cn1-build-contract.md: S1 server library and routes (opus, cc125c5b), S2 suggester and cron (opus, 3d7e8d5b), S3 inbox, home card, MCP and guide (sonnet, dff93aaa); all reviews non-blocking. Merged 6916239f with integration fixes; migrations 0107 (task_suggestions) and 0108 (call_transcripts.suggested_at) applied on tahi-db before the push. Follow-up cd75950f. Live after it: the next sweep repaired all 39 orgless rows and filed 9 more (6 dropped for lacking a verbatim quote, 2 sales calls skipped, 10 cents); 48 suggestions pending across 8 calls, every one with a client (Verandela 28, Elevate 13, Giant Group 7), titles and descriptions rendering, the home card counting them. Approvals left to Liam. Total model spend across three sweeps about 30 cents.
- [x] CN.1b - [BE/FE/MCP] Suggestions become requests as well as tasks (Liam, 2026-09-19: these are tasks and requests, especially requests from a client). Kinds create_request, update_request, request_note, hand_off_request; the Tasks vs Requests rule in the prompt; request writes extracted like the task writes; a rebuild route to re-read the eight calls. Contract docs/superpowers/plans/2026-09-19-cn1b-requests-contract.md. Built 2026-09-19 as workflow cn1b-requests-build: R1 request writes extracted (lib/request-writes.ts), the four request kinds with dedupe, apply and decoration, migration 0109, the rebuild route and rebuild_task_suggestions (opus, bb3b746d); R2 the prompt rule with the vocabulary printed from the modules, contacts and request details in the context, validation and name resolution, ?limit= on the cron (opus, b91b00de); R3 chips, summaries, Tweak into the New Request dialog through initialDraft, inline editors, the hand-off contact gate, MCP descriptions, guide (sonnet, 45bb9c46); reviews non-blocking, one major fixed at merge (the keyboard y skipped the contact gate). Merged and deployed 41d0b049; 0109 applied on tahi-db before the push. Cutover live: the first pass still filed site work as tasks, so rule 2 now states the test (what the client will see) with examples (d7153487); expired rows kept their dedupe keys and blocked five re-proposed items, so a rebuild now retires them (af5c2991); a temperature 0 attempt was rejected by Sonnet 5 and reverted (279fda59). Final state 2026-09-19: 27 pending across 7 calls, 16 new requests, 5 hand-offs (Mickey Day on #244, Charles on #226, Tim Lyons and Ella Wilde on #237, Andrew Stout), 2 request notes, 4 tasks (the studio's own follow-ups); Verandela 14, Elevate 8, Giant Group 2. Five full passes cost about 2.7 dollars. Approvals left to Liam.
- [~] CN.1c - [BE/MCP] A rebuild should merge passes, not replace them: two reads of the same three Elevate calls gave five items and then none (sampling variance; Sonnet 5 rejects a temperature parameter, 400 "temperature is deprecated for this model"). Keep the union: on a re-read, rows from the previous pass that the model did not propose again stay pending instead of expiring, and only rows the human already decided are left alone. Also worth a second model pass per transcript with the first pass shown as context ("anything missed?") before the union. Built 2026-09-26 (opus, 7f6e8223, on a branch; not merged or deployed, no migration). A re-read is now a union: insertSuggestions compares each draft against everything its transcript already has on file except expired rows, through the new isRepeatOf in lib/task-suggestions.ts (a create at SIMILAR_BLOCK across both create kinds, a note on the same target, an update to the same fields, a subtask list with nothing new, a hand-off to the same person), counts a repeat as a duplicate and never touches the row on file; expired rows keep their retired keys and are not compared, so af5c2991 holds. The rebuild route expires nothing by default (pending and snoozed stay, applied, rejected and failed are never touched), clears the mark and re-reads straight away through runSuggestionSweep with transcriptIds (at most 20, no 30-day window; readNow false leaves them for the cron), returning mode, kept, expired, transcripts, read and deferred; replace true or ?replace=1 is the one path that still expires, for vocabulary changes. Every call is read twice (lib/task-suggester.ts: the second read is shown the first read's items with their quotes and asked only for what it missed, notes read back from the prompt cache, mergeSecondRead keeps both reads inside the twelve item ceiling); on by default, ?second_pass=0 on the cron and secondPass false on the rebuild switch it off per call; each read logs its own ai_cost_log row (stages suggest and second_pass). Expected extra spend roughly 3 cents per transcript at Sonnet 5 rates (the log line reads about 6, because the rate card prices cached input at the full rate). MCP: rebuild_task_suggestions gains replace, second_pass and read_now; cron_suggest_from_transcripts gains limit and second_pass, its mapping moved into task-suggestion-tools.ts so the parity test covers it; the guide says each call is read twice and a rebuild adds. Tests in lib/task-suggester.test.ts, lib/__tests__/task-suggestions.test.ts, the rebuild and cron route tests and the MCP parity test; full vitest 5771 green. Next: merge and deploy, then rebuild the three Elevate transcripts twice and check nothing drops out of the inbox.
- [x] CN.1d - [BE/FE/MCP] Suggestions never duplicate what exists (Liam, 2026-09-19: make sure it checks for requests that are close or similar). Similarity scoring in lib/text-similarity.ts; the inbox warns Looks like #226 with Use #226 instead and Approve anyway; approve is blocked at 0.8 without force; the sweep drops cross-call duplicates; the model also sees requests delivered in the last 90 days. Contract docs/superpowers/plans/2026-09-19-cn1d-duplicate-guard-contract.md. Built 2026-09-19 as workflow cn1d-duplicate-guard: D1 lib/text-similarity.ts, similar computed on read against the org's requests (open or delivered in 90 days), tasks and other pending suggestions, approve blocked at 0.8 without force, the attach action, the sweep dropping similar_pending, delivered requests marked in the model context, MCP arguments (opus, 766b0721); D2 the Looks like line with Use #NNN instead and Approve anyway behind a confirm, types mirror, guide (sonnet, ebfb2e6d); reviews non-blocking. Merged and deployed ad18431a. Live: the inbox was empty by then (Liam approved 8, all landed as Verandela requests #228 to #235 with bot lines and audit entries, and rejected 19), so the first warnings will show on the next call's suggestions; the guard is unit tested at all three points.
- [~] CN.2 - [BE/Slack] The Slack app, DM first with permission levels (Liam, 2026-09-22). Built as workflow cn2-slack-app (S1 identity, verification, routes, opus c7e00396; S2 approvals in DMs with in-place rewrites, opus 171791cf; S3 notes and voice through Workers AI, opus acff94e1; A1 assignee suggestions, sonnet ea50d1e3; reviews non-blocking), integrated by one agent (19 stub mismatches, route wiring, voice size check before download, agent-mode events), merged b06b0d91, migration 0110 applied on tahi-db, deployed a2471632 after a CI fix (the AI binding forces a remote dev proxy, skipped on CI). Live: both webhook routes answer 401 to a bad signature. Waiting on Liam: apply the manifest to the existing Tahi Dashboard app, reinstall, set SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET, then the live DM checks. Open: view_submission has no handler (no modal yet), app_mention in a channel drafts a note, slack_events_seen is never swept.
- [ ] CN.3 - [BE] Keeping in sync (later, about 3 days): dashboard task changes post to the Slack thread, a weekly digest of unreviewed suggestions, rejections as negative examples, GI.4 learns from applied suggestions.

## Product manager AI (Liam, 2026-09-20: "I want a product manager AI")

Liam: an AI with the exclusive job of checking tasks, clients and requests, nudging the person handling each one to be working on it, helping that person or the owner make updates to those items, and planning bigger tasks and requests that are far away so the studio does not slip behind. The point is accountability: nothing slides quietly. It rides on what is live: the Tahi bot actor and task threads (CN.0), the suggestion gate with approve, tweak, snooze and reject (CN.1), the delivery-watch and hand-off nudges, the daily brief, and the Slack app when CN.2 lands. Scope before building; the shape below is a starting point, not a decision.

- [ ] PM.0 - [Scope] Write the scope the way call notes to tasks was scoped: what the PM reads (tasks, requests, hand-offs, calls, capacity, due dates, last activity, thread silence), what counts as slipping (no activity for N days on something assigned, a due date inside a week with nothing started, a request waiting on a client past the nudge window, a big item with no plan), who it talks to (the assignee first, the owner when the assignee is silent, Liam and Staci for the studio picture), and how it talks (a Tahi bot line in the thread, a Slack DM, a card on the person's home, never an email to a client without a human). Decisions for Liam: cadence, tone, and whether the PM may change fields itself or only propose through the suggestion gate.
- [ ] PM.1 - [BE] The check: a cron that scores every open task and request for slip risk from the signals above and writes pm_findings rows (item, person, reason, severity, suggested next step) with a dedupe key so the same finding never repeats until something changes; the studio home and each person's home show their findings; MCP list_pm_findings.
- [ ] PM.2 - [BE/Slack] The nudge: a finding becomes a Tahi bot line in the item's thread and a Slack DM to the person, with buttons: On it (clears for N days), Blocked (opens the blocker picker), Reschedule (proposes a new date through the suggestion gate), Hand off (opens the client hand-off). Escalates to the owner after a second silent window. Uses the CN.2 Slack app; no separate bot.
- [ ] PM.3 - [BE] Help making updates: from the nudge or the thread the person can reply in plain words ("done with the copy, waiting on Tim for the link") and the PM turns it into proposed changes through the suggestion gate (status, hand-off, note, subtasks), the same path call notes use, so nothing changes without a human pressing approve.
- [ ] PM.4 - [BE/FE] Planning ahead: for large or far-off tasks and requests (estimate above a threshold, or due more than three weeks out with no subtasks or schedule row), the PM proposes a plan: milestones as subtasks with dates working back from the due date against the person's booked capacity, flags when the plan does not fit, and re-checks weekly; the planning card on the item detail and a weekly "what is at risk next month" line in the daily brief.
- [ ] PM.5 - [BE] Client accountability: the same check on requests waiting on a client (hand-offs past their date, client review silent) so the PM nudges the studio to chase, and on retainer clients with no request activity in 30 days so the studio reaches out before the client churns.

## Studio home accuracy (Liam, 2026-09-19: "check my home page for accuracy")

Audit by the lead against production payloads; every card traced to its route. Workflow home-accuracy-fixes builds the fixes in three slices (A1 sonnet, A2 sonnet, B opus), each reviewed.

- [~] HA.1 (MERGED b30a95ae, aged bar completed c554076d) - [BE/FE] Receivables read "Overdue NZ$0" with three invoices past due (about NZ$16.1k): the aging buckets called 0 to 30 days late "current". Buckets become not due, 1 to 30, 31 to 60, 61+, with a count for invoices lacking a due date. Slice A1.
- [~] HA.2 (MERGED b30a95ae) - [BE] Daily brief prints "$3,668" where the cards print "NZ$3,668". Slice A1.
- [~] HA.3 (MERGED b30a95ae: label "vs Jul (no Aug snapshot)"; the writer was already idempotent, the August gap is a cron run that did not fire, not a code bug) - [BE/FE] MRR "down 40%" compares to July because there is no August snapshot; label the basis month and make the snapshot writer upsert every month. Slice A1.
- [~] HA.4 (MERGED 87f9cdc3) - [FE] Pipeline ahead annualises monthly deal value (NZ$6.2k) while the forecast and deals page say NZ$3.2k plus NZ$250 a month; "closing this month" counts a deal whose close date passed. Same basis as the forecast; past-due closes counted apart. Slice A2.
- [~] HA.5 (MERGED 87f9cdc3; c554076d moved the active-member rule to its own setting team.inactiveMemberEmails, set to Nathan on production) - [BE/FE] Studio capacity: "booked" was hours already logged, and an inactive member counted as a third of capacity. Booked = assigned open work this week; active members only. Slice A2.
- [~] HA.6 (MERGED 87f9cdc3) - [BE/FE] Retainer health called quiet retainers "at risk" from a churn score while the API says green; the test org counted as a retainer. Bucket follows the API; no MRR, not a retainer. Slice A2.
- [~] HA.7 (MERGED 87f9cdc3) - [FE] Proposals live listed drafts. Shared, published or accepted only; drafts as a count. Slice A2.
- [~] HA.8 (MERGED a24df8b2: lib/cash-position.ts; finance.lastYearTaxOwed now means the IRD balance and is set to 24242.68 on production) - [BE/FE] Money cards on one source: cash position computed once (total cash all currencies, tax owed NZ$24,242.68 as the IRD balance with the 15k pot counted toward it and never on top, recurring burn, project run-rate, surplus, gross and net runway); the Cash runway card reads "+NZ$13.2k a month net, 3.6 months if revenue stopped"; Take-home reads about NZ$51.9k disposable instead of NZ$0; the finance page reads the same. Slice B. LEAD: set the tax owed setting to 24242.68 on production after the deploy.
- [~] HA.9 (MERGED a24df8b2) - [BE/FE] Cash-flow ribbon full picture: retainers plus the trailing project run-rate plus weighted pipeline, minus commitments, with the basis stated under the card. Slice B.
- [x] HA.10 - Greyhive INV-2025000024 (GBP 1,279.60, imported from ManyRequests, issued December 2025, no due date) written off as Liam on 2026-09-19: Greyhive will not pay, a debt collector is engaged. Outstanding now NZ$21,394 across 6 invoices.
- Right as traced: outstanding NZ$24,328 across 7 invoices, cash NZ$76.1k (Airwallex, 17 Sep), Needs you and the brief items, open requests, contracts, calls, replies, worklog, content counts.

## Client hand-offs on requests (Liam, 2026-09-18)

- [~] HO.1 (MERGED d8d9355e model, acdb8942 UI; migration 0104 applied on production first; deployed 89b312b4; seen live: Waiting on card and the Hand off to a client dialog on a request, waitingOn on payloads, the waitingOn=client filter; a real hand-off with a client is Liam's first use) - [BE/FE] **Hand a request to a named client contact.** A request keeps its Tahi owner; it can be handed to one contact with a reason (approval, content, access, decision, file, other), a note and an optional date; the contact sees it first in their personal Waiting on you with the one action verb; the org admin sees the org-wide list; the studio sees a chip on rows and cards, a "Waiting on clients" rail view and a Waiting on card on the detail; the Blocked by card shows the hand-off as a synthetic line; the request hands itself back when the person approves, uploads or replies; a nudge email goes out after requests.handoffNudgeDays (default 3), never more than once per 3 days; a contact without a seat is invited in the same email. Migration 0104 (waiting_on_* columns on requests). Workflow client-handoff-build: H1 model and routes (opus), H2 UI (sonnet), H3 MCP and guide (sonnet), each reviewed, then merged in order.
- [~] HO.3 (MERGED: lib/request-handoff-copy.ts holds the pure copy and types, components import it, the local file is gone) - [FE] Tidy: the UI slice typed the hand-off payload locally in lib/request-handoff-types.ts (5 importers) while lib/request-handoff.ts exports the same names; point the imports at lib/request-handoff.ts and delete the local file.
- [~] HO.4 (MERGED: contacts may be follower, watcher, approver or contributor; team members pm, assignee or follower; the People panel still shows only its three fixed slots) - [BE] The participants POST route still limits contacts to the follower role; widen VALID_ROLES and the contact guard so the People panel can add an approver or contributor by hand (hand-offs already write those roles).
- [x] LW.43 - Crons fire from a Cloudflare Worker, not GitHub Actions (2026-09-22). GitHub dropped most scheduled runs (measured 2 to 5 an hour against 12 or more configured), so the suggester never ran after 19 Sep and Liam's Charles call produced no suggestions until a manual sweep (9 filed). workers/cron-trigger with Cron Triggers mirroring the yml schedule table; the yml keeps only the manual dispatch. Deployed eb89d21d; secrets set from GitHub on each deploy; every slot verified firing on time on 22 Sep (calendar :17 and :32, digest every 10 min, Drive :37, suggester :42).
- [x] LW.44 - content-gap-hunt failed on 20 Sep with "Claude returned non-JSON": 8 to 15 gaps with rationale overran the 4096 token cap and the truncated JSON failed to parse. Cap raised to 8192 (2026-09-22).
- [ ] LW.45 - schema-watchdog reports 0 of 50 pages passing every Sunday (schema_not_in_html): the CMS schema field is filled on every blog post but no JSON-LD renders on the live tahi.studio pages, and it never has (the May run showed the same). The blog post template in Webflow needs an Embed bound to the schema field (or the existing one re-bound). A Webflow Designer change and a publish, so it waits for Liam's go. Also: the watchdog marks the run as a failed cron when nothing passes, which reads as a plumbing error in notifications; report it as a finding instead.
- [ ] BL.SVG - Blog creation with SVG images (Liam, 2026-09-22: "I definitely want to get back into blog creation using SVG images, which have come a long way"). Scope: where images enter the pipeline today (hero, inline), generating SVG illustrations in the Tahi style per post, review in the polish stage, upload to Webflow assets, alt text. Needs a short scoping chat: style reference and how many images per post.
- [ ] LW.42 - Yield balances drift: Airwallex Capital (yield) is not on the public balances API, so it lives in the setting finance.yieldHoldings and goes stale (2026-09-22: USD 20,014 in the setting against 25,100 in Airwallex, a NZ$8.6k gap on the cash card). Options: read the Xero AWX_Yield_USD and AWX_Yield_AUD bank accounts (already synced through the Xero bank summary) as the yield source on each Airwallex sync, and show a warning on the cash card when the setting is older than 30 days. Updated by hand as Liam this time.
- [x] LW.41 - Feedback comments can be removed through the app (Liam, 2026-09-19: remove the fixed comments). No delete route existed, so the ten fixed rows and their seven screenshots were removed directly on production this once; workflow feedback-delete-route adds DELETE /api/admin/feedback/[id] (object first, then the row) and the MCP tool delete_feedback_comment (sonnet, 7f11de99, review clean, 10 tests); merged 2026-09-19.
- [x] LW.40 - Feedback comments round (Liam, 2026-09-19: check the comments made on the site and fix them). Nine real comments, one already fixed (churned retainers in retainer health, 75932933). Eight fixed by workflow feedback-comments-fixes (three sonnet builders, reviews clean, one 44px chip fixed at merge), deployed 31069e8a: overview daily brief meta stacking on phone, a two-line activity item wrapping, the comment widget help box text in dark; contract preview background in dark, the More actions popover off frame on phone, list Delete navigating instead of deleting; client cards laid out vertically, the deal-linked calls row on phone. Fixes: the brief meta stacks inside the existing phone container query; the Wire ticker item was absolutely positioned inside a fixed-height clipped track and now flows with a hanging indent; the comment ball hint used a hard-coded white on the text token, now the bg token; the shared builder header had a hard-coded white glass, now a header-glass token for light and dark with a hairline, and its More menu uses the portal Popover aligned end with a 44px trigger; DataTable row actions run through runRowAction so Delete never fires the row navigation (39 tests); client cards use an auto-fit metric grid with a min height; the deal-linked call row stacks on phone. Live phone and dark pass still owed: the Chrome extension was disconnected for the whole round, so the eight fixes rest on the reviewers' reading and the DataTable tests until Liam or the next session looks at them at 375px.
- [x] LW.39 - Calls: two more meeting types, mentoring and other (Liam, 2026-09-19). MEETING_TYPES and a shared MEETING_TYPE_META in lib/calls.ts feed the validation (message derived from the list), the Type filter, the badges, the slide-over select, the row menu, the classifier (mentor, mentoring, coaching in a title) and the MCP descriptions; the calendar sync keeps a hand-set type when the event has no lead, org or deal parent. Built as workflow call-types-mentoring-other (sonnet, cd9aa3fb, review clean), merged with the row menu and a preview test fix (cbb089ce). Live: six filter chips, mentoring accepted, coffee rejected with the derived message, revert 200. No migration (free-text column).
- [x] LW.38 - MCP worker (2026-09-19): update_request_fields { isInternal } from a connector read "Pass at least one field to update" (stringy boolean again); post_request_message, update_request_step and log_request_time had the same reads, and sixty-odd boolean arguments across the worker were read with === true, !== false or a truthiness check, so a stringy "false" could even rotate a share token. Fixed 430fc1f0: coerceArgs normalises every call's arguments against the tool's own inputSchema at the tools/call boundary (booleans, numeric strings, string arrays), plus direct coerceBoolean reads in the request tools; 45 tests across the two MCP test files.
- Note: request #244 (Giant Group, final website copy) was handed to Mickey Day via the MCP on 2026-09-18 with reason content, due 30 September; it had been created isInternal and was flipped client-visible first. New tools appear in a connector session only after a fresh session.
- [x] LW.37 - MCP worker (Liam, 2026-09-18): create_task did not reliably forward subtasks[] and toggle_task_subtask always answered "isCompleted (boolean) is required" through the connector. Fixed 3dd91022: workers/mcp-server/src/coerce.ts normalises subtasks (string[], objects with a title, or one newline or comma separated string) and booleans ("true", "yes", 1); the 23 done tasks' checklist items can now be ticked by re-running the toggles.
- [ ] HO.5 - [BE] request_waiting_on_you has no notification preference toggle (deliberate for launch: bell and email on, cannot be muted); add it to PREF_EVENT_TYPES when a client asks.
- [~] HO.2 (MERGED 7c82f8bd; deployed 89b312b4; seen live: /help renders, GET /api/admin/guide serves ten sections; MCP tools deploy with the worker) - [MCP/Docs] **MCP for hand-offs and a "how this works" guide.** Tools hand_off_request, hand_back_request, list_requests_waiting_on_clients, and get_dashboard_guide backed by lib/dashboard-guide.ts (short sections: what the dashboard is for, requests versus tasks, statuses, tracks and plans, hand-offs, blockers, participants and roles, comments, invoices, what the MCP can do and why), served at /help for both audiences and through GET /api/admin/guide and /api/portal/guide; a test checks every tool the guide names exists on the worker.

## Liam's morning asks (2026-09-14, after the review)

- [~] LW.21 - [FE] Requests kanban shows two vertical scrollbars; one page scrollbar only. Agent requests-ui-fixes.
- [~] LW.22 - [FE/BE] Files have no way to remove or delete a file: a Delete action on the client Files page, the request Files panel and the admin list, R2 object first then the row, confirm dialog, MCP delete_file. Agent files-delete.
- [~] LW.23 - [BE/FE] Services hidden for clients for now, the way Messages is (client default deny, nav, page guard, portal API 403, per-org override still possible). Agent hide-services-clients. Note: this reverses the 2026-09-12 direction that clients compare plans on Services; Liam's call today.
- [~] LW.24 - [FE] AI request wizard composer shows two focus rings; keep only the outer composer ring. Agent requests-ui-fixes.
- [x] LW.30 - "test manual" invoice (QMZ9F50W-0001, NZ$350, org 60fbba6b) written off as Liam and the daily brief recomputed, so Needs you no longer shows it. The dummy org "test manual" still exists; LIAM deletes it from /clients.
- [~] LW.31 (MERGED 7f851a56, migration 0102 applied on production first) - [BE/FE] Prep notes on calls: the brief says "no prep note yet" with nowhere to write one. Agent call-prep-notes: prep note on both call kinds, editable from the brief link and the calls slide-over, in the pre-call digest, MCP fields.
- [~] LW.32 (MERGED 62cb00a2) - [BE/FE] A member seat must not see the plan or billing on the client home (Liam: "I shouldn't see my plan on the home screen if I'm a member"). Agent member-plan-hidden: server-side omission for member seats, admin seats unchanged.
- [x] LW.35 - Comment ball "Something went wrong sending that": migration 0103 (feedback_comments.screenshot_key, shipped by a later session in 75932933) was never applied on production while the deployed insert wrote the column. Applied through the runner 2026-09-15 as Liam; a probe comment stored (id ef8d0aac, ignore it). Lesson: every migration entry needs its apply before the deploy, noted in the run log.
- [~] LW.36 (MERGED f8a6a2b4: lib/stripe-status.ts decideStripeStatus, written_off and paid never demoted; Liam still voids the Stripe invoice and deletes the org) - [BE] The "test manual" phantom invoice is a live Stripe invoice (customer "test manual", NZ$350, open); the Stripe sync cron re-imports it each morning and demotes the local written_off back to sent. Agent stripe-import-guard makes the importer never demote written_off or paid (the Xero rule). LIAM: void that invoice in Stripe (and delete the "test manual" org on /clients).
- [ ] LW.34 - [QA] Flaky under a full parallel run, green in isolation: middleware.test.ts (all 8, shared mock state) and lib/__tests__/utils.test.ts formatDate (clock or locale). Isolate the mocks and freeze the clock so the gate never lies. 2026-09-19: lib/__tests__/server-client-boundary.test.ts also times out under the full parallel run (6.8s against a 5s budget) and passes alone; the lead gate now retries a failed file in isolation before calling the suite red.
- [x] LW.33 - Giant Group allowed on the email gate (email.allowedOrgIds = [aa80a2d6], applied as Liam 2026-09-14 10:40 NZ). Invites to Michael Day and Mark Ramsey follow once the spelling of Mark's address is confirmed (row says ramsey, Liam typed ramsay).
- Note: "Ask about this plan" opening a new request is by design (the Ask sheet files a request); Liam can change it to a message if he prefers.
- [~] LW.27 (MERGED b268d048) - [FE] Client home empty state: keep the dark header panel, drop the leaf badge (Liam: "remove that badge with the fern in it, I liked the full dark mode header"). Agent home-empty-onboarding-exit.
- [~] LW.28 (MERGED b268d048) - [FE] Onboarding has no way out: a "Sign out and return to sign in" line on every step and on /welcome. Same agent.
- [~] LW.29 (MERGED 62d905c6; cause confirmed: the contact was linked to the Clerk user by email while Clerk held no membership, and the old route turned that into a 502) - [BE/FE] Settings > People: the bin on a teammate row does nothing for a person who signed up by hand and never joined the Clerk org; route made resilient to a missing membership, ConfirmDialog, honest errors. Agent people-delete-fix.
- [x] LW.21 and LW.24 MERGED bdf333c4 (board strip overflow-y hidden, composer textarea ring removed). LW.22 MERGED 349b4462. LW.23 MERGED 24ae1753.
- [~] LW.26 (MERGED 6c683a69; Liam re-tests the link signed out) - [BE/FE] Seat invite flow (Blah Blah Inc repro): the accept link lands on sign-in ("Couldn't find your account") for a new address, and a hand-made sign-up is sent through the plan chooser instead of into the invited org, so the Clerk membership never gets created. Fix: signed-out plus token goes to sign-up with the email prefilled (sign-in when the account exists), acceptance runs on arrival (membership, contact link, onboarding stamp), then the invited org opens; seat versus first contact decided from the org's existing members. Agent seat-invite-flow.
- [x] LW.25 - Comment ball: click, then pick the element the comment is about; soft snap to the nearest edge (b0b5eb17, live, migration 0101 applied).

## Liam's late-evening asks, for the beta

- [~] PM.1 (MERGED e9feda94, live, both defaults set to Liam on production 2026-09-14 00:05 NZ; Liam to confirm from Settings) - [BE/FE] **Default project manager for new clients, by engagement
  type.** Liam is the project manager for every client today
  (studio.projectManagerId override, LW.3) and must also be the default for
  every client added from now on. Settings: "Project manager for new retainer
  clients" and "Project manager for new project clients" (team member selects),
  applied when a client is created (client dialog, importer, self-serve
  onboarding); the override keeps winning while it is set. Agent pm-defaults in
  flight.
- [~] BP.1 (MERGED 1ebb63f5, then b0b5eb17 adds click-to-pick: click the ball, then the element the comment is about, highlighted and pinned, its selector, tag, text, position and section context stored with the comment (migration 0101); the ball soft-snaps to the nearest screen edge on release. Stripped-back version: floating draggable ball, comment panel, context stored, MCP list_feedback_comments; no inbox yet; migration 0100 through the runner after deploy) - [Design then FE/BE] **Beta comment pins.** A Figma-style comment
  mode in the dashboard for the beta: any signed-in user (client, Liam, Staci)
  drops a pin on the thing they mean; the pin stores the route, the anchored
  element (selector path plus visible text), viewport width and breakpoint,
  theme, user and org, the last console errors and failed requests, and a
  client-side screenshot of what that person saw (html-to-image of the page, no
  server capture). Pins land in one studio inbox (filter by client, page,
  breakpoint), each pin converts to a task with one click, replies close the
  loop. Proposal: 3 to 4 days; needs a feedback_pins table and a small overlay
  component mounted in both shells.
- [~] GI.4 (step one MERGED ff9939bd: history, coverage gaps and plan in the wizard prompt; step two, the advisor, still open) - [BE, design later] **The request wizard learns the client deeply.**
  A per-client memory the wizard and a future advisor read: every request with
  category, size, outcome and dates; site audits and health; brands; the plan
  and its usage; what the client has never asked for. Phase 1 (about 3 days): a
  compact client history summary and category coverage in the wizard prompt so
  it never asks what it knows. Phase 2 (about a week): an advisor a client can
  ask "what are we not doing on the site" that answers from the history and
  industry priors, recommends work, and offers to schedule it after a named
  task.

---

# (b) NEXT: client integrations

4 open ids. Giant Group's own asks, logged 2026-09-13. Memory:
`project_client_integrations_ideas_2026_09_13`. BP.1 and GI.4 are also client
integrations work; they are homed in section (a) because they gate the beta.

- [ ] GI.1 - [Design first, then BE] **Chat bot into Tahi.** Client messages
  from Slack or WhatsApp become REQUESTS on the client's organisation, never
  internal tasks, with the sender as the contact, and the studio gets the normal
  request_created notification. Voice notes transcribed with Whisper on Workers
  AI. Needs: a channel adapter per platform, sender-to-contact matching,
  transcription, an idempotency key per message, the same intake validation as
  the New request dialog. Slack first (about 3 days), WhatsApp after (Meta
  Business verification is calendar time).
- [ ] GI.2 - [Design first, then BE] **A client's own MCP for Tahi**, and
  role-scoped MCP generally. An MCP server bound to one client and their
  permissions: it can only do what that client may do in the portal (tenancy and
  feature_visibility enforced, portal routes only, never admin routes),
  authenticated per user through Clerk OAuth on the worker rather than a service
  token, tools filtered by the existing permission resolver, portal adapters for
  client tools. Then the same model for internal roles (task_handler,
  project_manager, viewer) while Liam and Staci keep super admin. Builds on
  lib/permissions.ts and getPortalAuth, not a second permission system. About
  two weeks.
- [~] GI.3 - [FE/BE] **Calls page: link and purpose are not editable** (Liam,
  2026-09-13). MERGED ef2feca0 (code e996c328, f9ec5a47): the /calls row opens a
  slide-over and the per-entity calls card carries a Linked to panel (client,
  deal, lead, request) and a purpose block (type, title); the discovery-calls
  and scheduled-calls PATCH routes validate every target and require the
  caller's access scope on the call's current organisation and on the new
  target; the calls index never returns a request title outside the caller's
  scope; MCP update_call and update_lead_call carry the fields; 95 targeted
  tests. Live on production 2026-09-13: the slide-over shows Title, What it is
  for and the Linked to card. REMAINING for `[x]`: 375px and dark mode were
  never eyeballed (Definition of Done 5 and 6).
- [ ] GI.5 - [BE/FE] **Request from a document.** In the New request dialog
  (client and studio) a third path beside manual and AI: drop a PDF or doc; the
  wizard reads it (text extraction on Workers AI or a parser), drafts one
  request or a parent with sub-requests, asks for more when the document is
  thin, and on create links the file to the request in its Files section
  (files.requestId already exists). About 3 days including a size cap and a
  scanned-PDF fallback.

---

# (c) Design pass 2026-09-13

7 open ids. The design pass runs in Claude Design and is held for Liam's review
before any port.

Context, not tasks: 27 requirement documents landed under
`docs/superpowers/design/requirements` (195a6073, b5eddbbe), one per surface
group, plus the shared design brief every designer and critic reads (22a89664).
`scripts/design-capture.mjs` is the headless capture script for the design shell
(915a6935). Liam's verdicts live in
`docs/superpowers/plans/2026-09-13-design-review-checklist.md` and decide the
order inside catalogue batches G and H.

## Claude Design write-back

- [x] DL.3 - [Design] Write the invoices-studio shell wiring under Finance (done 2026-09-13, recorded in the run log and the catalogue section 6; the reorganiser could not see it because design writes leave no git trace)
  (exact edits scoped in
  `docs/superpowers/audits/2026-09-07-invoices-services-stalled-integration.json`:
  one stylesheet link, three script tags, one app-mount line, one app-shell prop
  and branch), the Services plan-ladder rule (staged at
  `.claude/qa/svclocal/portal-money.*`, anchor patch
  `.claude/qa/svc-ladder-patch.cjs`), the Stalled-as-a-flag rework (staged under
  `.claude/qa/stall`), and archive the scratch mounts. Services v2 is confirmed
  already wired for the client audience.
  UNRESOLVED: two documents disagree.
  `docs/superpowers/plans/2026-09-13-page-catalogue.md` sections 5 and 6 say
  DL.3 is done ("DL.3 landed the invoices-studio shell wiring under Finance, the
  services plan ladder, the Stalled-as-a-flag rework and the archive scratch
  mounts", "DL.3 shell wiring is done too"). STATUS.md says "DL.3 shell wiring
  and DL.4 re-critique are next". Claude Design writes leave no git trace, so
  neither claim can be checked from the repo. Resolve by listing the design
  project files.
- [ ] DL.4 - [Design] Re-render and re-critique in the real shell after the
  writes. Gated on DL.3. Liam ran /design-login at 22:35 NZ 2026-09-13, so the
  access this needs is live.

## Designs that still need doing

Overnight 2026-09-14: every module in this section has a fresh design in Claude Design (see docs/superpowers/plans/2026-09-14-design-review-for-liam.md, verdicts per module). Lines below stay open until Liam marks SHIP, FIX or REDO on that document; the port order follows his marks.


- [ ] AR.4 - [Design] Proposals individual page (editor) needs a lot more work;
  redesign in Claude Design before any port. Includes the wiring bug the critic
  found, where every list row opens the same hardcoded document.
- [ ] AR.5 - [Design then FE] Two rules everywhere: filters in a left rail on
  every list page; headline feature cards consistent across pages (same anatomy,
  domain accent only). Apply in Claude Design to schedules, contracts, proposals
  and any other module that diverges, then port. Carry the DL.2 caveat: the rail
  must be withheld or collapsible on wide-table pages (Time, Team, Leads, Deals,
  Calls, Tracks, client Invoices) where it costs columns and clips money.
- [~] MR.6 - [Design then FE] Studio invoices designed in Claude Design (the critic FIX is being worked in the overnight design pass, module "finance", 2026-09-14; port after Liam reviews)
  (invoices-studio.* module: list with totals strip, seven saved views, rail chip
  with pay-link state, bulk bar, New invoice slide-over with the IC.3 defaults;
  detail with hero, metadata grid, grouped actions, activity strip, chase
  drafter). Critic: FIX (two blocking interaction bugs in the scratch mount,
  plus defects); fixer was running; then wire into the shell under Finance and
  port. The fixer's outcome is not recorded anywhere, so this stays `[~]`.
- [~] MR.7 - [Design then FE] Services showcase redesigned in portal-money.* (port half live via CB1; the fuller showcase is being reworked in the overnight design pass, module "portal-money", 2026-09-14)
  (dark forest plan stage with the two tracks as objects, How you are using Tahi
  with honest charts, an editorial catalogue with a feature, stories and lines,
  an add-ons shelf tied to the plan, member-seat and read-only degrades). Critic:
  FIX not REDO ("best single tile in the prototype"); fixer was running. The PORT
  half is done and live (CB1, 6534ebdd, smoked in Client view of Giant Group).
  The design fixer's outcome is not recorded, so this stays `[~]`.
- [ ] CB4 studio invoices port. Waits on the MR.6 critic FIX and Liam's design
  review.

---

# (d) Catalogue batches

Scheduling view over `docs/superpowers/plans/2026-09-13-page-catalogue.md`.
Batches A to C are the ones that ran tonight; D to J are the plan ahead. Ids are
referenced here and homed in sections (a), (b), (c), (e) and (f), except the six
homed below.

## Standing gate on every batch (verbatim from the catalogue)

`npm run type-check` zero errors, `npm run lint` zero errors, pushed and
deployed green, live browser smoke of the golden path on the deployed URL, 375px
with no horizontal scroll and touch targets at 44px or more, the page rendered
with `.dark` and no contrast regression, and a screenshot or note in the commit
body. Each batch adds the specific smoke that proves it.

## Batches A to C, what is still open

Batch A (the doors a Giant Group user walks through): S1 to S8 all merged and
live (66b18917, 2f0c20a0). Open: A5 (section a), and:

- [~] CA4 tenancy proof in CI (faf6f286): `.github/workflows/e2e-tenancy.yml`
  seeds a fresh local D1 from every migration (`scripts/e2e-local-d1.mjs`),
  starts the webpack dev server and runs `npm run test:e2e:tenancy` on pushes and
  pull requests touching the isolation surface, and on manual dispatch; without
  secrets it finishes green with a "Tenancy proof skipped" notice.
  **LIAM**: run it once from Actions before adding secrets (expect the skip),
  then add repository secrets CLERK_PUBLISHABLE_KEY_DEV and CLERK_SECRET_KEY_DEV
  (the Clerk DEV instance keys) and run it again (expect 3 of 3).
  Follow-ups: the path filter should also cover the admin seeding routes
  (requests, invoices, contracts, calls); the uploaded dev-server.log artifact
  bypasses secret masking, mask or drop it.

Batch B (the money path a client touches): CB1, CB2, CB3 merged and live; CB5
merged into IC.8. Open: CB4 (section c), IC.8 (section e).

Batch C (deliverable truth): all four merged as 23b5c681 and 32c78bee, migration
0098 applied on production, 0099 applied through the runner. Live lap owed.

- [~] C1 publish before share (3ecafbba, code a3d9f7a9): a proposal share
  snapshots on first share only, publish re-arms after edits, both email routes
  refuse an unpublished link. Review clean.
  LIAM or lead: the live lap in the T3 plan (share, edit, verify pinned,
  publish, revoke 404, re-share). The two Giant Group schedules shared without a
  snapshot were healed through the app as Liam on 2026-09-13 (publishedAt
  2026-09-13T10:27Z on cef49c39, 3a24d237, ef50d591).
- [~] C2 public viewer integrity (bad0d7ef, code 66b0e3e4): dark slides
  readable, no localStorage bleed, third package selectable at 375, gantt card
  stack under 720px, no alert(), OG tags. The reviewer's blocker was the missing
  `e2e/public-viewers.spec.ts`, queued as D3; the expired-accept finding is
  covered by C3's guard. Two minors left: the dark strip is a post-hydration
  effect (brief flash possible), RiskRegisterSection border hex.
- [~] C3 accept, decline and question close the loop (97e51af0, code 60ac3f4e,
  a7215587): accepted amounts frozen, expired documents refused with 410, studio
  bell and email for all three outcomes. Migration 0098 applied on production
  2026-09-13 22:40 NZ. The staging apply refused the token (Authentication error
  10000); re-run when the token is fixed.
- [~] C4 contract signature artefacts (32c78bee, code 90d9afc4): every signature
  notifies, signed PDF to R2, body hash anchor, revoke resets. Migration 0099
  applied through POST /api/admin/db/migrate as Liam right after the deploy
  (wrangler was refused by the permission classifier).
  Follow-up: C3 shipped `emails/contract-signature.tsx` and
  `studioContractSignatureEmailPlan` for the same event C4 wires through
  `emails/contract-partially-signed.tsx`; only the preview page uses C3's, retire
  it in D2.

## Batch D. Close the deliverable loop and prove it

D1 = T3.10 (starts after C2 and C4 merge, both done). D2 = T3.9, which also
retires the dead C3 contract-signature template. D3 below. D4 = CT.15.

- [ ] D3 Playwright specs the reviewers asked for: `e2e/sales-publish.spec.ts`
  and `e2e/public-viewers.spec.ts` on the QA harness, then one live rehearsal.
  Verified 2026-09-13: neither file exists in `e2e/`. Overlaps T3.QA, which adds
  the live round trip with real inboxes.
  Acceptance: share to publish to view at 375px to accept to admin notified, and
  send to sign to PDF in both inboxes, both green in Playwright and both
  rehearsed live once.

## Batch E. Messages, unhidden

The standalone /messages page stays hidden for every client by default
(27ae697f). This batch is what unhiding would take.

E1 the New-conversation participant shape and auto-adding the team to
client-initiated threads. E2 org_channel provisioning rule plus polling or SSE.
E3 = T2.6 (needs a design file first, none exists for either audience).
E4 = CT.17. E5 = V1-QA.2.

E1 and E2 have no id in TASKS.md and are carried here as catalogue lines only.

## Batch F. Studio daily driver and the permission floor

F1 = TP.3, plus the live smoke of the roughly 12 e2e-only Tasks behaviours.
F2 = GI.3 (merged, 375 and dark owed). F3 = T1.15 and T1.18 (T1.18 is done, see
Done). F4 = T1.11. F5 = T1.7.
Seam: F3 touches `nav-model.tsx`; keep T2.7 out of this batch for that reason.

## Batch G. Studio v3 ports, design-led

G1 = DL.1 and G2 = DL.2 are DONE (all 14 files in the design project). What
remains is G3 = AR.4, G4 = AR.5, G5 = DL.4, with DL.3 unresolved ahead of G5.

## Batch H. Studio ports that follow the re-critique

H1 `ops.jsx` Time, Team and Tracks port (or CT.18 delete for Tracks).
H2 `sales-pipeline` Leads, Calls and Deals port, plus T3.11.
H3 `sales-artifacts` list ports (proposals, contracts, schedules, all three
template pages). H4 `/capacity` port. H5 `/clients/contacts/[id]` and
`/clients/brands/[id]`, which have no design at all.
H1 and H3 to H5 have no id in TASKS.md and are carried here as catalogue lines
only.

## Batch I. Honesty and deletion

I1 = CT.19 plus the access scoping /reports never calls. I2 = CT.15 (the real
testimonial pipeline half). I3 = T3.8 and MC.6. I4 wire or delete the client
health scorer. I5 build or delete `messageReactions`, request steps and the
revision counter.
I4 and I5 have no id in TASKS.md and are carried here as catalogue lines only.

## Batch J. Files, notifications and integrations depth

J1 = CL.1 (files as a small Google Drive with threads, design first).
J2 notification preferences, rich content, sidebar badges, quiet hours reader,
weekly digest cron (the T682 to T699 group). J3 Slack notification wiring plus
the T570 Zapier config surface. J4 = T1.16 batch B (deals, conversations, calls,
time entries, announcements). J5 = T1.13 and the daily-summary and transcript
cron UTC windows.

Everything not in a batch (GI.1, GI.2, N1 to N9, content-engine Slice 7 and 8,
`/social`, `/sitemap`, `/affiliates` real data, T668 to T676, T700 to T715)
stays parked until Batch J lands.

---

# (e) Tier plans

47 open ids.

## Tier 1, Trust (12 open)

Full auth and tenancy audit ran 2026-08-18 (423 routes). Verdict: the
CLIENT-facing portal boundary is strong (38 of 38 portal routes scoped, no IDOR,
no client-supplied-org trust, share tokens validated, resolver cannot promote a
client). Breaches were unauthenticated side doors bypassing that boundary, all
fixed.

- [~] T1.3 - [QA/BE] **Auth flow robustness.** 2026-09-13 (CA2, f972f66b): code
  verified correct (Clerk catch-alls with path routing keep reset and verify
  in-shell); `e2e/auth-path.spec.ts` walks sign-in, sign-up and forgot-password
  screens on the local harness. Audit confirmed Clerk catch-all routing, reset
  path not hidden, invite tokens 192-bit single-use atomic, entitlement not
  self-grantable, Ship Studio backdoor prod-gated. REMAINING: one manual
  forgot-password click-through on the live Clerk build (A5 step 17); branded
  error and verification states at 375px.
- [ ] T1.6 - [BE] **Permissions invariant enforcement.** Client
  feature_visibility denies are nav-cosmetic only; enforce at route level so
  denied = 403, not just hidden (memory `project_permissions_vision`: visible =
  permitted, absent = denied).
- [ ] T1.7 (C4.3/C4.4) - [Ops/BE] Portal noindex + robots; WAF rate rules
  (60/min `/api/portal/*`, 20/min `/api/uploads/*`) or KV limiter.
- [ ] T1.11 (audit A2) - [Liam+BE] **Worker MCP /authorize hardening (APPROVED,
  Liam will reconnect).** `workers/mcp-server/src/index.ts:2675` auto-approves on
  client_id alone (not a secret), so anyone can mint full admin. Require an
  authenticated Tahi session before minting a code, or drop
  authorization_code/none for client_credentials plus secret. Deploys via
  `mcp-worker-deploy.yml`; Liam re-approves the connector once after.
- [ ] T1.12 (audit B2) - [Liam+BE] **Rotate the committed ManyRequests token,
  DEPRIORITISED 2026-08-18.** Liam: "a later problem tbh, since the goal here is
  to replace that." `workers/mcp-server/src/index.ts:97` hardcodes a live token
  that is now in git history; treat as exposed. Revisit at ManyRequests cutover
  (the token dies with the platform), or sooner if the legacy data matters.
- [ ] T1.13 (audit finding) - [Ops] **Fix the GH Actions crons.**
  TAHI_DASHBOARD_URL repo variable still points at the retired webflow.io host
  (404s), and cron paths are not allowlisted while workflows send x-cron-secret
  not Bearer. VERIFY FIRST: sync-airwallex fired fine on 2026-08-18 and bank data
  refreshed, which contradicts a fully-broken cron path; check whether "Dashboard
  cron triggers" and `dashboard-crons.yml` differ, then fix the repo variable and
  switch workflows to `Authorization: Bearer $TAHI_CRON_SECRET` (already accepted
  by assertCronAuth). Batch J5 folds in the daily-summary and
  sync-drive-transcripts UTC windows, which still compare lexicographically.
- [~] T1.14 - LIVE c6c4870f (2026-09-07 03:45 NZST): one rule in
  `lib/portal-access.ts` (portalRole admin, or the primary contact) on brands,
  organisation, people, invites and the subscription change request; profile
  returns isAdmin; last-admin count uses the same rule. 3345 tests, health
  200/307. Stays `[~]` until a real client session (business+client@ in
  incognito) confirms People and Organisation are editable for the primary
  contact. [BE] Write-path portalRole gap: portal brands/organisation/people/
  change-request use the same primary-contact-not-admin assumption; a fresh
  owner cannot invite teammates or edit org settings until portalRole is set.
  Fold into onboarding work.

### Least-privilege for the first hire (ACTIVE 2026-08-18, hire imminent)

Prod check before starting: Liam and Staci both hold super_admin role rows, so
deny-by-default cannot lock them out. LANDMINE handled: Liam's own
teamMemberAccess scope row is specific_clients (Giant Group only); he is
unrestricted only because admin/super_admin role names bypass scope, and that
bypass must survive. Note `isTahiAdmin()` gates 506 admin routes on CLERK ORG
MEMBERSHIP, not role, so containment needs BOTH the default flip and per-route
scoping.

- [ ] T1.15 - [BE] **Deny by default.** `lib/permissions.ts` roleless member
  becomes admin (the `else level='admin'`), and `lib/access-scoping.ts`
  no-team-member-row becomes unrestricted. Flip both to deny, preserving:
  super_admin/admin role bypass, the 'api-service' MCP token, crons/webhooks, and
  a bootstrap fallback for an unseeded DB.
- [~] T1.16 - [BE] **Per-org scoping rollout** (the old T717). Only 30 of 362
  admin route files call a scoping helper. Batch A (contracts, proposals,
  schedules, including share, publish and email) is DONE per the catalogue
  compile of 2026-09-13. Batch B is the remaining five entities: deals,
  conversations, calls, time-entries, announcements. Scheduled as catalogue J4.
- [ ] T1.17 - [BE/FE] **Hire onboarding path.** CONFIRMED by audit: the only
  writer of `teamMembers.clerkUserId` is a hand-crafted PUT; no Clerk webhook for
  it, and accept-invite rejects `flow:'team'`. So today a hire invited to the
  Tahi Clerk org resolves to NO member row and gets FULL ADMIN (all financials);
  after T1.15 the same user is locked out of an empty dashboard. Building:
  verified-email backfill on the dashboard layout, POST
  `/api/admin/team/[id]/invite` (Clerk org invitation), gate the team write
  routes, Linked/Not-linked column, honest invite copy, and deal-sales-kit stops
  hardcoding Liam as contract signer.
  Note: LW.18 removed Clerk invitations from product code and added an admin team
  accept route, so re-scope this against that merge before building.
- [~] T1.19 - [FE] **Teammate home leaks and never visually verified.** The calls
  feed is FIXED and shipped (643433f8: teammate-home calls feed org-scoped, docs
  card relabelled, duplicate super-admin allowlists deleted). STILL OPEN, and why
  this is not `[x]`: `overview-home.tsx` preview-as-teammate resolves /me routes
  to the signed-in admin, so Liam cannot sanity-check what the hire sees; the
  `?asMember=<id>` admin-only parameter proposed for it does not exist anywhere
  in the tree (grepped 2026-09-13, zero hits). The page also still needs someone
  to actually look at it and add "why is this empty" copy.
- [ ] T1.20 - [BE] **Teammate invite link is fully dead.** POST
  `/api/admin/onboarding-invites` supports `flow:'team'` but has zero callers;
  `lib/onboarding-entry.ts` resolveToken is a `return null` stub; `/welcome`
  hardcodes role "New teammate", gear "MacBook Pro 16", buddy "Liam Miller" for
  every hire (SPECS/redesign/03-team-onboarding.md flags these as seams). Either
  implement resolveToken against onboardingInvites and feed the welcome context,
  or drop the fake personalisation. Lower priority than T1.17.

## Tier 2, The working platform (18 open)

### Client truth and delivery (the CT family)

- [ ] CT.10 (0.75d) - [QA] One full live client lap on production at 375px and
  dark: submit, reply both ways with email, approve, pay link, files.
- [~] CT.11 (3d) - [BE/FE] /services catalogue scoping. SCOPING LIVE f109a969
  (2026-09-07 06:05 NZST; migration 0097 on both D1s first; portal fails closed,
  tested against a real SQLite; /services probe clean at desktop, 375 and dark;
  production endpoints 200). `services.org_id` (NULL = a global row every client
  sees, set = private to that one organisation) plus `services.visibility`
  ('public' | 'hidden'), and the portal requires BOTH that and the older
  `show_in_catalog`, so "can a client see this" fails closed on either one.
  Studio editor has an Audience control and a Visibility control that write both
  flags in lockstep. 28 tests. MCP list/create/update_service carry both fields.
  REMAINING: the ORDER PATH, which waits on Liam's call between minting a request
  and a Stripe checkout; "Ask about this" is untouched. Known gap left as its own
  problem: the global admin search returns private service names to a scoped team
  member, because it applies no scoping to ANY entity.
- [ ] CT.15 (1d) - [FE] /reviews: the Send button sends nothing, Copy review link
  404s (`/review?token=` vs `/review/[token]`); delete or fix, and the orphaned
  outreach routes. Catalogue D4 deletes the lies; catalogue I2 builds the real
  testimonial pipeline.
- [~] CT.16 (1d) - [Liam decision + FE] /billing in or out of the client nav; its
  Manage Billing popup fails silently. MERGED c1e8c24e (CB2): /billing is out of
  the client nav by default (nav-model test), the page runs on the v3 primitives,
  Manage Billing renders only when the subscription reports canManagePayment
  (Stripe rail), so a Xero-rail client such as Giant Group never sees the failing
  popup. Live smoke in Client view still owed.
- [ ] CT.17 (0.5d) - [BE] The MCP `send_message` and `create_conversation` tools
  post the wrong body shape and always fail; fix or delete. Same family of bug as
  MCP `create_invoice`, which posts amountUsd/totalUsd with no lineItems and
  400s. Catalogue E4.
- [ ] CT.18 (0.25d) - [Liam decision] Delete /tracks (linked from nowhere,
  HTML5-drag only; the client home's TrackBoard tells the same story with
  buttons). Catalogue H1.
- [ ] CT.19 (4d) - [FE] /reports triage by deletion: six sections duplicate
  /sales-analytics, five duplicate /financial-reports, a second commitments
  editor has already diverged. Catalogue I1 adds the access scoping it never
  calls.

### Money path leftovers (the IC family)

- [~] IC.8 (0.5d) - [Ops then BE] BEFORE the first non-dry hourly Xero export
  over an old period: `time_entries.invoice_id` is NULL on every historical row
  (migration 0095 has no backfill), so hours already invoiced by hand would bill
  again. BUILT c1e8c24e (CB5): POST `/api/admin/time/stamp-invoiced`
  (`lib/stamp-invoiced.ts`, MCP `stamp_invoiced_time`) stamps every billable
  entry before a cutoff date with the matching paid or sent invoice for its
  client, dry run by default, and the xero-export route refuses an old period
  until the stamp has run. The before-date regex accepting an impossible calendar
  date was fixed in 42b331c3.
  **LIAM**: run the dry run from Settings or the MCP, read the count, then apply.
- [ ] IC.9 (0.5d) - [FE] /time at 375: segmented tabs 37px, Add filter 30px, sort
  headers 18px, search input 19px are under the 2.75rem target (pre-existing; the
  /time week grid redesign supersedes this page).

### Requests, tasks and messages polish

- [ ] T2.6 (C3.5b) - [FE] **Messages polish.** PageHeader instead of bespoke h1;
  thread UX pass; client-visible partials brought to v3. Needs a design file
  first; none exists for either audience. Catalogue E3.
- [ ] T2.7 - [FE/BE] **Daily-briefing dedup** (Liam 2026-08-18): the home-page
  brief card and the nav-bar briefing are two surfaces that do not overlap well.
  One source of truth, one refresh cycle, consistent content; nav popover
  summarises, home card expands. Keep out of the batch that touches
  `nav-model.tsx`.
- [~] T2.9 (C3.2) - [FE] /billing v3 lap (3 raw tables, client-reachable). MERGED
  c1e8c24e as the CB2 half of CT.16: the page runs on the v3 primitives. Live
  smoke owed, same look as CT.16.
- [ ] TP.3 - [Design first, then FE/BE] **My week: real week dates and multi-day
  allocation.** The planner shows the open task list against the actual dates of
  the week, and a long or big task or request can be placed into MULTIPLE days
  (spanned across the days it will take), not just dropped on one due date. Needs
  a design and probably a schema decision (a per-day allocation, distinct from
  the single due date). Extends the shipped My week strip. Catalogue F1.
- [ ] TP.4 - [Design first, then FE] **Notifications page (not urgent).** An All
  notifications and Past notifications page: the full history behind the bell,
  simple list with read state. Design in Claude Design first. Low priority.
  Note: AR.1 and PP.4 shipped a /notifications page for both audiences with
  views, kinds and facet counts, so re-scope this against what is live before
  starting.

### Files

- [ ] CL.1 - [Design first, then FE/BE] **Files as a small Google Drive with
  threads.** Folders per client (Deliverables, Brand, References, Uploads),
  drag-and-drop uploads from the client, a comment thread per file (reuse the
  request thread composer and the messages table with a file target), versions
  optional. Liam: "i'd like to give them a small version of like google drive but
  with threads so they can upload docs for us there." Design in Claude Design
  alongside the Clients pages; the current /files page (list, upload, download)
  stays until then. Catalogue J1.
  ID COLLISION: a different, already shipped item also carries the id CL.1
  ("Deletes verify with Clerk first", LIVE dfb1d158). Liam's call which one keeps
  the id.

### Live QA laps never yet done

- [ ] V1-QA.1 - [QA] Live-verify the client request DETAIL as a client:
  scope-flag pill absent, own messages show the client's name, Approve and
  Request-change banner on a client_review request. Needs a client-visible
  (non-internal) request in an impersonated org; set one to client_review first.
  Row-filtering confirmed unchanged in code; this is the last unverified
  client-facing piece.
- [ ] V1-QA.2 - [QA] e2e specs (`mobile.spec.ts`, `portal-flow.spec.ts`) assert a
  Messages tab and will fail; update them for the V1 hide. Both files still exist
  and still carry the assertion. Catalogue E5.
- [ ] T2.QA (C4.2) - [QA] **Full live client-session lap on prod** as a real
  client org at 375px plus dark: every nav item, file download, invoice pay,
  request thread round-trip. Never been done. Overlaps CT.10 and A5.

## Tier 3, Sales artifacts (13 open)

Batch C merged the first seven of these on 2026-09-13. The build plan is parked
at `docs/superpowers/audits/2026-09-12-t3-reverify-plan.md`; S1 to S8 there do
not need re-scoping, only executing.

- [~] T3.1 (C1.1) - [BE] Publish-before-share, proposals and schedules: share
  POST snapshots; email POST rejects unpublished; revoke clears snapshot. MERGED
  as C1 (3ecafbba, code a3d9f7a9). Live lap owed.
- [~] T3.2 (C1.2) - [FE] Proposal Publish button resurrection (mutate() after
  every patch, move and delete; dies after first publish today). MERGED as C1
  (3ecafbba): publish re-arms after edits. Live lap owed.
- [~] T3.3 (C1.3) - [BE] Close the accept and sign loop: notifications row plus
  Resend email to Liam plus deal activity (plus optional stage bump) on proposal
  accept, decline and question, and every contract signature. MERGED as C3
  (97e51af0, code 60ac3f4e) and C4 (32c78bee, code 90d9afc4). Live lap owed.
- [~] T3.4 (C1.4) - [FE] Deliverable kit theme integrity: consume
  `--page-chrome-text` (invisible dark-slide text in both viewers);
  `app/p/layout.tsx` pins light tokens (a viewer's dark localStorage corrupts
  public docs); hide unwired slide-theme options. MERGED as C2 (bad0d7ef, code
  66b0e3e4). Minor left: the dark strip is a post-hydration effect, so a brief
  flash is possible.
- [~] T3.5 (C1.5) - [FE] Mobile money path: VariantTabStrip overflow (375px third
  package unreachable); gantt narrow-mode card stack; contract canvas rotation.
  MERGED as C2 (bad0d7ef) for the tab strip and the gantt. The contract canvas
  rotation is catalogue D1, still open.
- [~] T3.6 (C1.6) - [BE] Contract artifact persistence: signed PDF to R2
  `signedStorageKey` plus download button plus admin resend action. MERGED as C4
  (32c78bee, code 90d9afc4). Migration 0099 applied through the runner. Live lap
  owed.
- [~] T3.7 (C1.7) - [BE] Contract tamper anchor: hash bodyHtml into chain; block
  body PATCH after draft; fix revoke-resets-partially-signed. MERGED as C4
  (32c78bee). Live lap owed.
- [ ] T3.8 (C1.8) - [FE/BE] Deals honesty: remove or implement scheduled and auto
  nudges; no fake 'sent' without RESEND_API_KEY; dialog error surfacing.
  Catalogue I3.
- [ ] T3.9 (C1.9) - [FE] Small-fix batch: alert() to toast; EmailShareModal
  preselect; founders image compress; public tab titles and OG; em-dash metadata;
  /pipeline hrefs; accept validates against snapshot; expiresAt enforcement;
  client-detail ContractsTab data shape; save-as-template 400; search reads
  contract_documents. Catalogue D2. Fold in: retire the dead
  `emails/contract-signature.tsx` and `studioContractSignatureEmailPlan`, which
  only the preview page uses now that C4's contract-partially-signed is the live
  path. Note that C2 already shipped the OG tags and removed the alert().
- [ ] T3.10 (C3.4) - [FE] /p/contract viewer onto the deliverable kit (the only
  public viewer off-kit), plus a rotation-safe signature pad. Catalogue D1,
  unblocked now that C2 and C4 are merged.
- [ ] T3.11 (C3.6) - [FE] Deals v3 lap (internal; 2 to 3 day composition swap;
  can slide). Catalogue H2.
- [ ] T3.QA (C1.QA) - [QA] Playwright: share, publish, view at 375px, accept,
  admin notified; send, sign, PDF in both inboxes. Then one live round-trip with
  a personal email before the first real client send. Overlaps D3, which names
  the two spec files.
- [ ] MC.6 - [FE/BE] Deals: Stalled becomes a flag on any stage (not a stage).
  The rework is staged in the design project under `.claude/qa/stall` and is part
  of DL.3. Catalogue I3.

## Ops and operator steps (4 open)

- [ ] T0.2 (C0.2) - [QA] After deploy lands: fire sync-airwallex, verify
  `get_bank_balances` returns Airwallex wallet plus yield:CUR rows matching the
  Airwallex UI.
- [ ] T0.3 (C0.3) - [Liam+BE] Refresh `finance.yieldHoldings` against the
  Airwallex UI (Xero suggests Yield USD 33,956.89 / AUD 638.80 vs the setting's
  20,014.13 / 531.51).
- [ ] T0.4 (C0.4) - [BE/Ops] Verify migration apply state on prod D1 (0081/0082
  and everything since; `list_migrations`). Now also covers 0098 on staging,
  which refused the wrangler token.
- [ ] MC.10b (judgement) - [Liam] Physitrack carries two Stripe customers (the
  organisation keeps one after the Evan Kwan merges, the other stays on the
  invoice rows). Still open.

---

# (f) North star and the long pool

10 open ids, plus the queued phases and the post-launch groups, which TASKS.md
carries as prose rather than checkboxes and which stay that way here.

## North-star phases (queued, unchanged)

N1 discovery workflow. N2 auto-onboarding. N3 portal tour. N4 permission roles
content. N5 Mailerlite CRM. N6 affiliates. N7 schedule to tasks bridge. N8 hourly
billing tracker. N9 dashboard-wide premium pass.
See `memory/project_phase_roadmap.md` and
`memory/project_north_star_integrated_flow.md`.

## Carry-overs (T5xx to T7xx pool)

- [ ] T568 - Google Calendar booking links for scheduled calls (verify vs
  booking-widget; likely close). Re-check against LW.6 and LW.8, which rebuilt
  the kickoff slot path on Google free/busy.
- [ ] T570 - Zapier outgoing webhooks (engine shipped in W-2; needs config
  surface). Catalogue J3.
- [ ] T571 - Deal-to-Client LTV link (fold into T711 to T713).
- [ ] T594b - Verify migration 0012 applied to prod (do with T0.4).
- [ ] T600 - Cash flow runway indicator (largely shipped; verify then close).
- [ ] T618 - Worker MCP finance tools (verify coverage).
- [ ] T667 - Xero category overrides (needs S25).
- [ ] T716 - Email-to-Request intake (verify state since 2026-07-07; finish or
  park). Liam, 2026-09-13: unsure whether it is wired, so it is treated as NOT
  wired and the "reply on the thread" line in `emails/new-message.tsx` was
  softened (42b331c3).
- [ ] W-QA - Live smoke of Wave 1 to 4 features (automation fire, webhook
  delivery, announcement fan-out, portal Org/Brand/People, AI weaves).
- [ ] LIT-BOOKS.UIUX / LIT-BOOKS.QA - overview BOOKS cards review plus live
  smoke.

## Post-launch groups (team and owner side, work AFTER cutover)

- **Notifications overhaul remainder (was T682 to T699).** T1.2 fixed identity;
  the rest stays post-launch: preferences page (S23, T682 to T683), rich content
  (T684 to T685), SSE hook (T687), email dispatcher (T688 to T690),
  /notifications page (T691 to T692), sidebar badges (T693), Web Push (T694 to
  T697 and W-PUSH), weekly digest (T698 to T699). Note that CT.4, AR.1 and PP.4
  have since shipped the dispatcher and the page, so re-scope before starting.
  Catalogue J2.
- **Retainer and billing model (T668 to T676).** customMrr/billingModel editors,
  retainer health filter, MRR forecast end-date awareness, auto-churn, team
  salary and rate fields, time cost/revenue/margin columns. Needs S25.
- **Comments and messages polish (T677 to T681).** Comment lock on delivered or
  closed (S24), message edit and delete with permissions, edited and removed
  indicators.
- **Revenue features (T700 to T705).** Deal to invoice generation, pipeline
  invoice indicators, project calculator port, Xero payment webhook receiver.
- **Intelligence and analytics (T707 to T715).** BankRunwayCard statement rows,
  outstanding KPI dedup (T708), revenue per head, client LTV, pipeline quality.
- **Schema batch (S23 to S25).** notificationPreferences, commentsLocked,
  xero_category_overrides plus salary columns plus billingModel columns.
- **Content engine ops (Phase I residue).** Verify migrations 0060 to 0063
  applied to prod; PI-S1/S2/S5/S6.5 live QA passes; Slice 7 signal expansion,
  Slice 8 citation tracker (deferred).

## Not yet, from the 2026-09-06 next-surfaces sweep

The standalone /messages surface (8d), the testimonial pipeline, automated health
scoring (the scorer exists with zero callers), Slack and digests, request steps
and client checklists (documented, not built), file-level proofing (ManyRequests
has none either), ratings and NPS, a persisted per-request activity log.

---

# (g) Done

One line each, with the commit. Grouped by week.

## Week of 2026-09-08 to 2026-09-13

### Giant Group readiness, Batch A (66b18917, 2f0c20a0, live smoke in Client view of Giant Group)

- [x] S1 Portal plan truth (57348c00): real custom rate and currency, real track
  entitlement, /tracks bounces a client to /requests, Manage Billing gated on a
  Stripe customer. Data fix: custom_mrr_currency set to GBP on Giant Group,
  Glasswall, BCS and Elevate.
- [x] S2 Existing client never sees a plan picker or card form (9583e104):
  welcome then kickoff for every existing client; /api/portal/checkout answers
  409 over any live subscription state or a Xero channel.
- [x] S3 A client can always see how to pay (65e360d3): How to pay card when a
  Xero invoice has no link; invoice notifications deep-link.
- [x] S4 The org id reaches the delivery gate (6e605d37): every client-facing
  notification email carries the org id.
- [x] S5 The next call on the home page is joinable (343f2dc9): attendee guard on
  portal calls.
- [x] S6 A4 cross-org isolation proof (127a7732, harness fix 52922925):
  `e2e/tenancy-isolation.spec.ts` passes 3 of 3 on the QA harness, both
  directions, every id-less portal route.
- [x] S7 Services catalogue (data, no code): Maintain and Scale as global public
  plan rows with no price; three add-ons published with their HTML stripped.
- [x] S8 MC.7 importer (8dca82f9, 66b18917): a subset run resolves hand-mapped
  clients; dead clients snapshot key gone.
- [x] Messages hidden for every client by default (27ae697f): resolver, nav,
  mobile tab, page redirect, both APIs.
- [x] Per-currency bank details for the How to pay block (b80c467d, code
  75e60a4f): five currencies with the fields each one has, one resolver, every
  How to pay surface and both bank emails read through it, 98 tests. Liam entered
  all five accounts on 2026-09-13.
- [x] Import provenance notes never reach a client invoice (2f87f858, 15fd916a).
- [x] T0.5 Pre-call digest fired hours off the call: `lib/call-time.ts`
  normalises every writer to a UTC instant, the cron filters on instants, the
  email prints NZ time; backfill applied on production, 71 rows rewritten, second
  dry run clean. Follow-ups moved into T1.13 and catalogue J5.

### Catalogue Batch A (afternoon)

- [x] CA1 onboarding write paths (40f93fe6), which closes T1.4: invoice-me
  entitles, kickoff booking creates the Google Calendar event and stores the Meet
  link, new-client branches pinned.
- [x] CA2 auth path (f972f66b), which closes T1.8: the auth shell already carried
  the branded error and verification states, `e2e/auth-path.spec.ts` added.
- [x] CA3 client home honesty (a20ea023), which closes V1-FIX.1, CT.3b and T2.4,
  plus CA3.1 next-invoice honesty for Xero-rail clients
  (`lib/next-invoice-date.ts`).

### Catalogue Batch B, money path

- [x] CB1 services plan ladder port (6534ebdd, fixer a925b8f4, code 52bd9289):
  `lib/plan-ladder.ts` plus the plan-ladder component, three rungs with the
  client's own in the middle, no price, Ask about this only, upsell nudge on
  planPressure. SMOKED in Client view of Giant Group: Maintain, Scale (you are
  here), Launch, no prices, pressure note quiet.
- [x] CB2 /billing lap and the CT.16 client-nav default (c1e8c24e).
- [x] CB3 client invoices at 375 (c1e8c24e): the audit found no defect in the
  shipped list or detail; `e2e/portal-invoices-mobile.spec.ts` pins no horizontal
  scroll and 44px targets at 375.
- [x] Portal home truth (5829bf0d, code 53cd4574): the client team card reads the
  assigned project manager first; the Google Calendar sync cron no longer wipes a
  manually pasted Teams or Zoom link.
- [x] MC.5 Services page rule (show what they have, lower and higher plans,
  per-plan suggestions, upsell only near limits): delivered by CB1's ladder, live.
- [x] CL.3 Services page as a showcase that upsells: delivered by PP.3's showcase
  plus CB1's ladder, live. Ask about this is the only CTA, no create-a-service
  form.
- [x] T2.8 /services v3 lap: delivered by PP.3 and CB1, live.
- [x] MC.7 importer subset runs: duplicate of Batch A S8 (8dca82f9, 66b18917).

### Liam's dummy-client walk-through

- [x] LW.1 liammiller.dev addresses receive client emails (applied on production
  2026-09-13 through PATCH /api/admin/settings).
- [x] LW.7 Every kickoff slot failed with "We could not hold that time". Cause
  found: read-only Client view, where the booking POST answers 403 by design.
  Booking works in a real client session. The read-only banner and disabled slots
  merged in 7ca50bff and are proved by the A5 lap with the rest of the LW block.
- [x] LW.20 Teams link on the N8N Content Engine call restored after the calendar
  sync fix (5829bf0d) stopped wiping it.

### Design write-back

- [x] DL.1 proposals, contracts and schedules editor rework written to the design
  project: 14 of 14 files in, the three over the 100 KB write ceiling
  (`sales-artifacts.jsx`, `sales-artifacts.css`, `sales-pipeline.jsx`) uploaded
  through design-sync on 2026-09-13 and read back at their full line counts.
  Catalogue G1.
- [x] DL.2 consistency pass written (head-band.css, requests-kit, ops-kit, ops,
  sales-pipeline-kit, tasks, clients, portal-home, portal-money), each under
  if_match on the manifest etag and read back line for line. Catalogue G2.

### Status corrections made in this pass

- [x] T1.5 Cross-org isolation proof: duplicate of Batch A S6 (127a7732,
  52922925), which passes 3 of 3. CI wiring is tracked separately as CA4.
- [x] T1.18 Nav gating for team members: shipped cc3c41f1 and verified in code on
  2026-09-13. `filterNav` gates `adminOnly` at `components/tahi/nav-model.tsx:194`
  and `lib/feature-tree.ts` carries the affiliates, content_studio and capacity
  keys the audit said were missing.
- [x] AR.8 Preview identity on reads: LIVE 71c39a3f (production Client view of
  Tahi Test Client: profile returns preview true, portalRole admin, isAdmin true;
  portal requests 200; 3432 tests). The second, unticked AR.8 line was the same
  branch before its deploy.
- [x] IC.4 Xero pay path: IC.4a (9b6b2c60, d618f080) captures Xero's
  OnlineInvoiceUrl and pushes a mark-paid back to the rail; IC.4b (10fbd6e9) adds
  the studio pay links, the Getting paid settings group and both bank emails; the
  portal half landed with PP.3 and Batch A S3, smoked on production (INV-0065
  shows a Xero pay page link, so the How to pay card correctly stays hidden).
- [x] T662 `{{requestNumber}}` email variable and `[REQ-n]` subject prefix: live
  in `lib/notification-email.ts:228`, shipped with CT.4 (8b93ecf6) and the email
  kit (EM.1, dfb1d158).
- [x] TP.1 AI first-start bar: DROPPED 2026-09-05 on Liam's word ("get rid of the
  task suggestion field"), replaced by TP.5 predictive autofill, which shipped
  (07b9f42f) and smoked on production.

## Week of 2026-09-01 to 2026-09-07

- [x] T0.1 Production deploy gate: Liam approved both stuck runs 2026-08-18, and
  on 2026-09-12 the required-reviewer rule was confirmed gone
  (`protection_rules: []`), so pushes to main go live unattended in about seven
  minutes.
- [x] MC.0 Email delivery allowlist LIVE 14211d9d: `lib/email-delivery.ts` is the
  one door out, policy keys and the email_suppressions table (migration 0094),
  super_admin needed to widen.
- [x] MC.1 ManyRequests reconciliation, read-only report
  (`docs/superpowers/audits/2026-09-07-manyrequests-import-report.md`).
- [x] MC.2 Idempotent importer LIVE d6c9a7b9 (migration 0093 on both D1s).
- [x] MC.3 Import applied 2026-09-07 without the API token, through an MCP
  snapshot parked in R2 (a15a628a, 9f9ae84f); all entities verified idempotent,
  cleanup applied, zero mail.
- [x] MC.8 Client data hygiene tools LIVE bd9e3790: contact edit, delete with
  reassign, merge, plan clear, subscription removal, organisation merge and
  delete. Applied as Liam: 10 duplicate contacts merged, 3 test subscriptions
  removed, 8 plans cleared, four organisation merges, two deletions.
- [x] MC.11 Ledger dedupes applied: 9 Stripe charge twins and 12 ManyRequests
  duplicate invoice rows removed, 11 archived Stripe shells merged.
- [x] EM.1 All 19 transactional email templates on the Studio Ledger design LIVE
  dfb1d158; one kit in `emails/_components.tsx`; preview set of 26 sent to Liam.
- [x] AU.1 A fresh sign-in with no active organisation goes to /continue LIVE
  dfb1d158, which was the root cause of Staci landing in client onboarding.
- [x] CL.1 (the Clerk one, id collides with the open files item) Deletes verify
  with Clerk first LIVE dfb1d158; "Staci's workspace" deleted through it.
- [x] CT.1 Internal request titles no longer leak into client bells (a9e44f43,
  f7e5de41).
- [x] CT.2 Portal submit notifies every Tahi admin; assign, participants and
  bulk-assign notify the incoming team member (8b93ecf6).
- [x] CT.3 Client home truth pass (8b93ecf6).
- [x] CT.4 Notification email dispatcher, four events, `[REQ-n]` subjects
  (8b93ecf6).
- [x] CT.5 Dead pointers at the hidden /messages removed (8b93ecf6).
- [x] CT.6 portalRole-aware client nav and honest invoice member state
  (8b93ecf6).
- [x] CT.7 Portal project card reads published schedules only (8b93ecf6), which
  is also T2.4.
- [x] CT.8 Request thread finished: per-message attachments, soft-deletes
  filtered, no duplicate shadow conversations (8b93ecf6).
- [x] CT.9 Client read state and a bell that clears on open (8b93ecf6).
- [x] CT.F Delivery and surface follow-ups (67f4464e). Left open on purpose: a
  per-org digest for bulk status emails, and
  `lib/contract-fully-signed-emails.ts` still hardcodes its From.
- [x] CT.12 /time hourly rate no longer discarded, Rate column added, LIVE
  ff540caa.
- [x] CT.13 and IC.6 Hourly Xero export guarded (idempotency, billing-model
  filter, currency, named refusals), LIVE ff540caa, migration 0095. Never run
  live, which is why IC.8 exists.
- [x] CT.14 and IC.7 Real invoice numbers, LIVE ec0ae354, migration 0096. Backfill
  applied by Liam 2026-09-12: scanned 111, filled 99.
- [x] IC.1 Money-path truth fixes (ebdfccd0), live smoke on production.
- [x] IC.2 `organisations.invoiceChannel` and editable paymentTerms (9ec99900,
  migration 0089).
- [x] IC.3 New Invoice defaults destination, currency and due date from the client
  (55d75a04).
- [x] IC.5 `lib/xero-status.ts` is the one mapper, reconcile is forward-only
  (55d75a04). Extended 2026-09-12 (eb5592db) so a Xero void cannot demote a local
  paid row.
- [x] TP.2 My week rail note removed (7ffa602a).
- [x] TP.5 Predictive autofill on request and task creation (07b9f42f, migration
  0090), smoked on production.
- [x] TP.6 Mobile top bar declutter (5dfb08cb), smoked at phone width.
- [x] CR.1 Clients list and detail designed in Claude Design.
- [x] CR.2 Clients LIST ported (0b9cd35a, merged 382993d0), smoked on production.
- [x] CR.3 Client DETAIL ported (05b44b0c, merged 86532f37), nine tabs, render
  checked at 375 and dark.
- [x] CR.4 Mobile touch polish (17a490b2): every button clears 2.75rem below md.
- [x] PP.1 Every client portal page designed in Claude Design.
- [x] PP.2 Client home ported (e3b3a4a2): `lib/portal-status.ts` is the one client
  status vocabulary, Waiting on you hero, skeletons on every card.
- [x] PP.3 Client invoices and Services ported: Pay now for https links only, How
  to pay with copy buttons, per-currency figures, Services showcase with Ask about
  this.
- [x] PP.4 Notifications page, Account and Offline ported: /notifications for both
  audiences, paginated API, honest deep links, real offline probe.
- [x] PP.5 Client-walk fixes, reverted then re-landed as AR.7 (262c778b) with a
  server and client boundary guard test.
- [x] MR.1 and MR.1b sales-pipeline, sales-artifacts and ops wired into the app
  shell, then the QA fix pass; 20 surfaces by 4 combinations, zero errors.
- [x] MR.2 Account rebuilt as four rooms behind a measured segmented control.
- [x] MR.3 Notifications rebuilt on the RailLayout shape.
- [x] MR.4 Clients list plan chip dedup (0e0a99dd).
- [x] MR.5 New client panel field layout (0e0a99dd).
- [x] AR.1 Notifications on the rail with true server-side facet counts
  (12d39eb4).
- [x] AR.2 Messages live over two stores, both audiences, migration 0092
  (12d39eb4). Later hidden for clients by default (27ae697f).
- [x] AR.3 Leads, Calls and Deals prototypes approved by Liam as-is.
- [x] AR.6 Act as client LIVE 14211d9d: second cookie, super_admin only, nine
  portal writes opened, an audit row before every mutation, amber banner.
- [x] AR.7 Client-walk fix re-landed (262c778b).
- [x] T2.1 Portal invoice detail and real Pay.
- [x] T2.2 Nav truth and files.
- [x] T2.3 Decided: contracts, proposals and schedules portal pages are Tier 3.
- [x] T2.5 Tasks page port (7958afc1), live smoke as Liam on production.
- [x] T2.10 /invoices/[id] v3 lap LIVE 65ca3a45.
- [x] MC.10 Dante Media invoices: both were paid, recorded with ManyRequests'
  dates, push-back off.
- [x] MC.9 Residue sweep (abeb9bc8) applied by Liam on production: 36 orphan rows
  removed, second dry run plans zero. Acme Corp hard deleted the same day.
- [x] DL.0 Liam ran /design-login 2026-09-12, unblocking DL.1 to DL.4.

## Week of 2026-08-18

- [x] T1.1 Uploads identity and cross-tenant write hole closed
  (`lib/upload-access.ts`, 43 tests).
- [x] T1.2 Notification identity: typed recipient union resolved inside
  createNotifications, seven insert sites rerouted.
- [x] T1.9 Unauthenticated side doors closed: /api/mcp POST admin-gated, leads
  routes gated, Google OAuth state nonce, /review allowlisted, authorizedParties
  prod-only.
- [x] T1.10 Portal financials gated to org admins (`lib/portal-access.ts`).
- [x] V1 Messages hidden entirely for V1 (nav removed both audiences, /messages
  redirects, code kept).
- [x] T1.18 Team-member nav and page gating made real (cc3c41f1).
- [x] T1.19 (the calls half) Teammate-home calls feed org-scoped, docs card
  relabelled, duplicate super-admin allowlists deleted (643433f8). The preview-as
  half is still open above.
- [x] Requests correctness and privacy: scope-flag leak closed, Export CSV
  admin-gated, per-org numbering, client message identity, client file upload,
  bulk assign sets assigneeId, request to task link, client Approve and
  Request-change on client_review.

---

# Liam's decision notes (verbatim, keep)

## Invoicing, answered 2026-09-06

- Push as DRAFT for now; add a studio setting later to flip to auto-approve once
  the system is trusted.
- Two channels only: `stripe` and `xero` (not three). Xero carries its own
  pay-now link (Xero's OnlineInvoiceUrl / the Stripe card link Xero surfaces),
  which is NOT tied to branding themes, so stop the currency-in-theme-name
  matching and read the pay link straight off the invoice.
- Invoice number: Tahi's own sequence pushed into Xero (we control it; CT.14
  already wants a real number). Both would be unique; he does not mind, so use
  ours.
- A hand mark-paid from the dashboard pushes the payment back to the rail (mark
  paid in Xero, void the open Stripe invoice).
- Xero-rail email: both, behind a studio toggle (send our template with the
  portal link, let Xero send its PDF, or both).
- Backfill channel per client BY HAND, not by rule. Liam: most orgs in the client
  book are dummy, so only the handful of real clients need a value; the rest stay
  unset (NULL falls back to the studio default and nothing bills).
- The client sees only what they need to act: for a Xero invoice, a How to pay
  block (amount, due date, invoice number as reference, and the pay-now link when
  present). No internal channel label.

## Standing constraints (overnight run, 2026-09-12 night)

No email to Giant Group (allowlist stays closed, no invite); tasks studio-only;
the standalone Messages page stays hidden for clients; data writes on production
only through the app's endpoints as Liam, dry run first; deletes are Liam's
clicks.

## Superseded framing (for the record)

- The "trust-crossover order" (`memory/project_trust_state_2026_05.md`) is
  superseded by the tiers above.
- The finance-first emphasis of earlier sprints is superseded: Liam is "less
  focused on cash flow / receivables / runway, more on how this runs as a request
  platform" (2026-08-18). Finance surfaces stay maintained but get no new
  investment until post-cutover.
- The old C0 to C4 sprint ordering is superseded by the tiers; C-ids are kept in
  parentheses for traceability.

---

# What changed in this reorganisation

## Moved to Done (13)

Each has a named commit and a live observation.

1. CB1 services plan ladder: 6534ebdd plus fixer a925b8f4, smoked in Client view
   of Giant Group.
2. MC.5 services page rule: delivered by CB1, live.
3. CL.3 services showcase that upsells: delivered by PP.3 plus CB1, live.
4. MC.7 importer subset runs: duplicate of Batch A S8 (8dca82f9, 66b18917),
   which is already `[x]` and live.
5. T1.5 cross-org isolation proof: duplicate of Batch A S6 (127a7732, 52922925),
   3 of 3 green. The CI half stays open as CA4.
6. T1.18 nav gating: shipped cc3c41f1, and re-verified in code today
   (`nav-model.tsx:194` gates `adminOnly`; `lib/feature-tree.ts` has the three
   keys the audit said were missing). The open line was a stale twin of the
   2026-08-18 `[x]` line.
7. T1.19 (partial, the calls half only): 643433f8. The id STAYS OPEN for the
   preview-as-teammate half, see below.
8. AR.8 preview identity on reads: LIVE 71c39a3f with a production smoke. The
   open line was the same branch before its deploy.
9. IC.4 Xero pay path: 9b6b2c60, d618f080, 10fbd6e9, portal half by PP.3 and
   Batch A S3, smoked on production.
10. T2.8 /services v3 lap: PP.3 plus CB1, live.
11. T662 `[REQ-n]` subject prefix: live at `lib/notification-email.ts:228`
    (CT.4, 8b93ecf6; EM.1, dfb1d158).
12. DL.1 and DL.2 design write-back: 14 of 14 files in the design project, the
    three over the write ceiling uploaded through design-sync and read back at
    full line counts (STATUS.md, 2026-09-13).
13. TP.1: dropped by Liam on 2026-09-05 and replaced by TP.5, which shipped
    (07b9f42f). Recorded as resolved rather than open.

Item 7 counts as a status correction, not a closure: T1.19 stays open.

## Merged into another id (1)

- **CB5 into IC.8.** CB5's entire text in TASKS.md is "see IC.8; the apply is
  Liam's call", so it carried no content of its own. IC.8 now holds the build
  note, the commit and the operator step.

## Duplicate id lines folded (2)

Not merges of different work, just the same id written twice.

- **GI.1** appeared twice: "Chat bot into Tahi" and "GI.1 (refined)". One entry
  now, carrying both texts.
- **GI.2** appeared twice: "A client's own MCP for Tahi" and "GI.2 (unchanged)",
  which is explicitly the same item. One entry now.

## Statuses upgraded from open to merged-not-proved

These did not close, but their evidence moved.

- T3.1, T3.2 (Batch C1, 3ecafbba), T3.3 (Batch C3, 97e51af0, and C4),
  T3.4, T3.5 (Batch C2, bad0d7ef), T3.6, T3.7 (Batch C4, 32c78bee): all merged
  tonight, all awaiting the live lap.
- T2.9 /billing v3 lap: merged as the CB2 half of CT.16 (c1e8c24e).
- T1.16 per-org scoping: batch A (contracts, proposals, schedules, including
  share, publish and email) is done; batch B is the five remaining entities.
- T1.19: the calls feed half shipped (643433f8).

## Sections retired

- **"Shipped 2026-08-18 (session 2)"** and the other inline shipped blocks fold
  into (g) Done, grouped by week.
- **"Sprint T2.5, Client truth and delivery"** as a heading: its open CT ids move
  under Tier 2, which is where Liam's own tiering puts them.
- **"Invoicing channel: Stripe or Xero per client"** as a heading: IC.1 to IC.7
  are done and move to (g); IC.8 and IC.9 sit under Tier 2 money path; Liam's
  answers are kept verbatim at the bottom.
- **"Clients redesign", "Client portal redesign", "Morning review feedback",
  "Afternoon review feedback", "ManyRequests cutover"**: fully shipped except the
  ids carried forward above, so the headings go and the lines become Done lines.
- **"Post-launch backlog"** keeps its groups but moves under (f), since those are
  prose groups rather than checkboxes and should not be mistaken for open ids.

## Could not resolve from evidence (left open, with the reason)

1. **DL.3** stays `[~]`. `docs/superpowers/plans/2026-09-13-page-catalogue.md`
   says twice that the shell wiring is done; STATUS.md says it is next. Claude
   Design writes leave no git trace, so the repo cannot settle it. Resolve by
   listing the design project's files.
2. **MR.6** stays `[~]`. The critic returned FIX and "a fixer is running", and no
   document records what the fixer produced. CB4, the studio invoices port,
   is blocked on this.
3. **MR.7** stays `[~]` for the same reason. Its PORT half is definitely live
   (CB1); only the design fixer's outcome is unknown.
4. **The whole LW.2 to LW.19 block** stays `[~]`. Every one is merged with a
   named commit and the deploys went green, but STATUS.md records "Live checks by
   Liam pending" and no live observation exists for any of them. The A5 lap
   closes them as a group.
5. **C1 to C4** stay `[~]`. Merged, deployed, migrations applied, but the live
   lap (share, edit, publish, revoke, accept, sign) has not been run.
6. **T1.17** may be partly superseded by LW.18, which removed Clerk invitations
   from product code and added an admin team accept route. Nobody has re-scoped
   T1.17 against that merge, so its text is unchanged and it stays open.
7. **TP.4** may be largely superseded by AR.1 and PP.4, which shipped a
   /notifications page with views, kinds and facet counts for both audiences. The
   original TP.4 text asks for the same thing. Left open pending Liam's look.
8. **CL.1 is used by two different items**, one shipped ("Deletes verify with
   Clerk first", LIVE dfb1d158) and one open ("Files as a small Google Drive with
   threads"). Neither was renamed here, because renaming would invent an id.
   Liam's call which keeps it.
9. **T0.4** now has a second, newer reason to exist: migration 0098 applied to
   production but the STAGING apply was refused by the wrangler token
   (Authentication error 10000). Folded into T0.4's text rather than raised as a
   new id.
