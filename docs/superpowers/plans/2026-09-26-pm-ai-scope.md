# The product manager AI: slip checks, nudges and plans through the suggestion gate (PM.0 scope, 2026-09-26)

Liam's ask (TASKS.md "Product manager AI", 2026-09-20): an AI whose only job is to check tasks, clients and requests, nudge whoever is handling each one, help that person or the owner make updates, and plan big or far-off work early, so nothing slides quietly. Decision #067 sets the limits: it is a layer on the suggestion gate, it never edits a field itself, there is no new bot identity and no second Slack app, and no client hears anything without a human pressing a button.

This scope merges three drafts written from different angles (accountability, planning, systems and cost). Where they disagreed, the choice and the reason are in section 17. Code claims were checked in the files on main at dbcd323d; production figures were read through the worker MCP on Saturday 26 Sep 2026.

## Decisions for Liam

1. **Cadence.** Recommended: the check runs every morning at 7am NZ, before the daily brief. Each person gets at most one digest, at 8am NZ on working days. The brief carries a short studio line every day, and a fuller one on Mondays (founder items that went unanswered, overbooked people, work with no date or estimate). Plans are re-checked on Monday mornings.
2. **Tone.** Recommended: facts filled into fixed templates from the evidence, with no model-written prose, no greeting, no "just a reminder" and no emoji. For example: "Giant Group · Global components: due Wed 30 Sep, not started (0 of 8 checklist items, no time logged, 38h estimate)." The item's thread gets a Tahi bot line only when a change is applied (as #064 already requires), never when the PM merely notices something, so the thread records decisions rather than nags. The alternative, in the TASKS sketch, is a bot line on every nudge.
3. **May the PM change fields?** Recommended: never. Every change it leads to is a `task_suggestions` row. When the person pressing the button is the rightful approver of that change, the press is the approval and it applies at once: a founder on anything, or a member on their own internal task. Anything the PM proposes on its own initiative (a plan, a baseline estimate) waits in the inbox for a press. Any change the client can see on a request (due date, estimate, status) is founders only. The alternative is that every press waits in the inbox, which would make Liam approve his own reschedules twice.
4. **Which channel first.** Recommended: the home card plus one bell row per person per working day, shipped with PM.1 and live before Slack. Once CN.2 is live, the Slack DM replaces the bell. Never an email, never a channel post, never a client.
5. **Working hours and quiet times.** Recommended: Monday to Friday in Pacific/Auckland, with one push a day at 8am. Nothing is pushed at weekends, on NZ public holidays or on a person's leave (all three in settings). An escalation waits for the next morning's digest. Buttons work at any time.
6. **When a founder's own item goes unanswered.** Recommended: it goes onto the Monday studio line in the brief that both founders read, never a DM to the other founder.
7. **Chasing client hand-offs.** Decision #063 approved an automatic reminder email to the contact. It has never run, because `delivery-watch` is not scheduled. Recommended: studio mode. The PM tells the request's owner, and a person presses Send reminder. `delivery-watch` gets scheduled with only its engagement half. The alternative is auto mode (schedule it as built), where today only the email allowlist stands between the cron and Mickey Day.
8. **Hours to plan against.** Liam and Staci both carry 40 hours a week, which is the column default. Recommended: before PM.4 ships, set delivery hours on /team, meaning the hours left for client work after sales, finance and the dashboard. Until then every capacity line prints "at 40h a week".
9. **Shadow week and thresholds.** Recommended: accept the defaults in section 5, then run one week in shadow mode, where findings show on the home card and nothing is pushed. Turn the bell and DMs on after that, and tune the thresholds from the dismissal counts.

## 1. What exists today (verified in the code)

**The gate: built for calls**
- `task_suggestions` (db/schema.ts) has these columns:
  - `kind` and `proposal`
  - `quote`, which is NOT NULL and verbatim
  - `approver_type` and `approver_id`, which are stored but not enforced
  - `decided_via` (dashboard, slack or mcp)
  - `dedupe_key`, with a UNIQUE index
  - The comment on `source_kind` still reads "'call' in this phase".
- lib/task-suggestions.ts is the only writer:
  - `insertSuggestions` silently drops a create that scores at or above SIMILAR_BLOCK (0.8) against a pending one.
  - `decideSuggestion` refuses a create as `possible_duplicate`.
  - `applySuggestion` writes through lib/task-writes.ts and lib/request-writes.ts.
  - `UPDATABLE_REQUEST_FIELDS` covers status, priority, dueDate, startDate, estimatedHours, category and scopeFlagged.
  - `buildDedupeKey` hashes `sourceKind`, `transcriptId ?? ''`, the kind, one target slot and the normalised diff, using Web Crypto.
  - `botLine` always reads "Applied from the call ...".
  - `snoozePreset` does NZ day arithmetic through `Intl`.
- Every surface assumes the source is a call:
  - `countSuggestions` counts calls by `call_id`, and the overview KPI query uses `COUNT(DISTINCT COALESCE(call_id, transcript_id))`.
  - `groupSuggestionsByCall` (app/(dashboard)/tasks/suggestions-logic.ts) labels anything without a call "Unlinked notes".
- Approval is not enforced by person:
  - The dashboard decide route checks `isTahiAdmin` and org access (`guardSuggestion`) and passes the Clerk user id as the actor.
  - The Slack button handler (lib/slack/dispatch-actions.ts line 111) requires `decide_call_suggestions`, which only founders hold, so a member cannot decide even their own note rows in Slack.

**The Tahi bot and threads**
- The bot is `TAHI_BOT` (lib/tahi-bot.ts).
- `postTaskComment` (lib/task-comments.ts) writes `task_comments` with `quote` and `source_ref`. When the task has a `requestId` and an `orgId`, it mirrors the line into that request's thread.
- `postRequestBotMessage` writes an internal `messages` row. `messages` has no `source_ref` column.

**Hand-offs**
- The pointer lives in the `requests.waiting_*` columns (migration 0104). `handBackOnClientAction` (lib/request-handoff.ts) clears it.
- `nudgeStalledHandoffs` (lib/request-handoff-nudge.ts) works like this:
  - It waits `requests.handoffNudgeDays` (default 3) before the first reminder, and `MIN_DAYS_BETWEEN_NUDGES` (3) between reminders.
  - It stamps `waiting_nudged_at` before sending.
  - It sends `request_waiting_on_you` to the contact with `waitingOnYouEmailPlan`. That is an automatic client email.

**The nudge crons have never run**
- Neither `delivery-watch` nor `automation-sweep` appears among the 18 expressions in `cronToTargets` (workers/cron-trigger/src/schedule.ts). `list_crons` on production shows `lastRun: null` and no runs for either.
- `delivery-watch` pings off-track engagements to `leads.defaultLeadOwnerId` with a 23-hour dedupe, then runs `nudgeStalledHandoffs`. The MCP tool `cron_delivery_watch` can run it by hand.
- The sweep fires `request_overdue` and `client_inactive` through the rules engine. That engine withholds email and Slack actions (`UNSAFE_ACTIONS` in lib/automation-executor.ts).
- How the cron trigger runs:
  - Targets on one expression run one after another, each as a POST with a 120-second timeout (`FETCH_TIMEOUT_MS`).
  - `withCronRun` logs to `cron_runs` and rings the bell when a run fails.
  - The suggester works to `SWEEP_BUDGET_MS` (75 seconds). FU.1 is still open.

**The daily brief**
- `computeBrief` (app/api/admin/overview/brief/route.ts) uses no model. It is cached in `settings` as `overview_brief_latest` and warmed by `overview-brief` at `0 19` and `0 20` UTC.
- Its only work signal is the top three overdue requests, in the `week` section. It says nothing about tasks, hand-offs or silence.
- Its rows join the client name to the title with an em dash (lines 255, 317 and 492).
- FU.7 is open: the route exports non-route symbols.

**Capacity**
- GET /api/admin/pipeline/capacity (MCP `get_studio_capacity`) covers this week only, and it computes the week with `getDay()` on the Worker's UTC clock. On a Monday morning in NZ it therefore reads the week before.
- "Booked" means:
  - open tasks due by Sunday or already overdue;
  - plus every open request with an estimate, whatever its due date.
  - "Open" is NOT IN delivered and archived, so cancelled and on_hold requests count.
- Active members come from lib/capacity-active-members.ts: anyone on `team.inactiveMemberEmails` is excluded, and weekly capacity must be above zero.
- `nextWorkingDays` (lib/kickoff-availability.ts) knows Monday to Friday in a time zone, but no holidays.
- `estimateRequestHours` (lib/wizard-hour-estimates.ts) gives the studio's baseline hours, small or large:

  | Category | Small | Large |
  |---|---|---|
  | design | 8 | 32 |
  | development | 12 | 46 |
  | content | 6 | 18 |
  | strategy | 6 | 23 |

**Gaps in the activity trail**
- `task_subtasks` holds only (id, task_id, title, completed, created_at). The toggle route sets `completed` with no timestamp and no audit row.
- Request updates write no audit row. Only a hand-off does.
- `task.updated` audit rows store field names, not values.
- `time_entries` carries `created_at` and a date with no time of day.
- `request_steps.completed_at` exists.

**Slack (CN.2): built, not live**
- It is waiting on the manifest, `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET`.
- lib/slack/api.ts has `postMessage`, `updateMessage`, `openDm`, `usersInfo` and `viewsOpen`. It has no lookup by email, although the manifest requests `users:read.email`.
- lib/slack/action-registry.ts routes buttons by prefix (`registerBlockActionHandler`) and modals through `registerViewSubmissionHandler`.
- `slack_identities` is keyed by email and carries `team_member_id` and `dm_channel_id`. A row only exists once a person has talked to the app.
- `SlackDmEvent` (lib/slack/dispatch-dm.ts) has no `threadTs`, although dispatch.ts computes one.
- `postSuggestionsForCall` (lib/slack/mirror.ts) posts a header plus one message per suggestion to every founder's DM. It records each copy in `slack_suggestion_messages` so `rewriteEverywhere` can update them.
- `slack_events_seen` dedupes Slack's retries.

**Notifications**
- `createNotification` without an email plan only rings the bell.
- `notifyTeamMember` does nothing for a member with no Clerk login.
- `notification_preferences` has in_app, email and slack channels. Slack defaults to off, and `PREF_EVENT_TYPES` lists the events a person can mute.

**Owners and homes**
- The owner is resolved in this order:
  1. `request_participants` role `pm`;
  2. then `resolveProjectManager` (lib/studio-project-manager.ts), which tries the `studio.projectManagerId` override, then the client's own PM, then a fallback. Today it resolves to Liam.
- owner-home.tsx has `SuggestionsCard`. teammate-home.tsx reads overview/me, tasks?assignee=me and replies-waiting?scope=me.
- MCP tools live only on the worker, one file per area (workers/mcp-server/src/task-suggestion-tools.ts and its siblings).

## 2. What production shows today

**Team**
- Liam (`b3025c04`) and Staci (`ae158f66`): admins with 40h a week each.
- Nathan Day (`a9c3902e`): a contractor with 20h, no Clerk login, and on `team.inactiveMemberEmails`.
- `slack_user_id` is null for all three.

**Activity**
- There are no time entries at all.
- Every imported request shares `updated_at` 2026-09-06T21:07:30.220Z, which is the ManyRequests import stamp.

**Client side**
- #244 Giant Group "Final website copy for the built pages" has been with Mickey Day for content since 18 Sep. That is seven days, and nobody has chased it. It is due Wed 30 Sep.
- Elevate #206, #237 and #240 are in client_review with no hand-off pointer.

**Requests**
- Overdue: #226 "Design directions", Staci's, due 24 Jul and still in progress.
- Unassigned: Verandela #228 to #235, eight requests approved from the call suggestions on 19 Sep. None has an assignee, a due date or an estimate.
- Assigned and silent since mid-August or early September: Stride #252, #253 and #255 and Elevate #257 are all submitted, assigned to Liam, with no due date and no estimate.

**Tasks**
- Liam has 11 open Giant Group tasks and Staci has 3. All have estimates and due dates.
- Of Liam's 11, 10 have a checklist; "Build the audience hubs and the 12 product sub-pages" has none. No checklist item on any open task is ticked.
- No task is linked to a schedule row or to a blocker. Dependencies exist only in descriptions ("Depends on Staci's Home hero").
- "Build the content pages & CMS templates" was marked done on 20 Sep with 0 of its 8 checklist items ticked.

**Schedule**
- The client-shared Giant schedule (cef49c39) still says 12 weeks from 1 May with launch on 24 Jul. The Launch task says go-live is Thu 22 Oct.

**Capacity**
- The capacity card shows both founders at 0% booked, because nothing falls due this week.
- Liam's real month, at 40h a week (8h a day) from Mon 28 Sep, counting nothing else:

| Due | Task | Estimate | Due by then | Free by then | Short |
|---|---|---|---|---|---|
| Wed 30 Sep | Global components | 38h | 38h | 24h | 14h |
| Fri 2 Oct | Build the Home page | 16h | 54h | 40h | 14h |
| Wed 7 Oct | Audience hubs and 12 sub-pages; Finish the Contractors set | 42h + 31h | 127h | 64h | 63h |
| Mon 12 Oct | Integrations; CMS schema and content import | 23h + 27h | 177h | 88h | 89h |
| Wed 14 Oct | SEO / AEO | 15h | 192h | 104h | 88h |
| Tue 20 Oct | QA and UAT | 38h | 230h | 136h | 94h |
| Thu 22 Oct | Launch | 24h | 254h | 152h | 102h |

- Liam's figures leave out his requests, none of which has an estimate.
- Staci has 45h of "Design: take the remaining V1 pages to dev-ready" (0 of 9 ticked) due Fri 2 Oct, with 40h free before then.
- Labour Day (Mon 26 Oct) falls inside the Giant handover window.

The PM cannot make this month fit by moving dates. What it can do is show the gap early and put options in front of a person.

## 3. The shape

**Code decides; a model only reads words.** The PM does four things. It writes to one place of its own, and every change it leads to goes through the gate.

1. **Observe.** A deterministic check reads facts and writes rows to `pm_findings`. Each row holds the item, the person, the rule, the severity, a reason sentence, the evidence and the next steps. No model is involved.
2. **Nudge.** Findings reach people from the quietest channel up: the home card first, then one daily digest (a bell row now, a Slack DM once CN.2 is live), then a line in the brief. A finding clears itself when its condition clears.
3. **Propose.** Every change a finding leads to becomes a `task_suggestions` row (`source_kind` pm), and only the gate applies it. That covers a reschedule, a hand-off, a note, subtasks or a plan. The only thing the PM writes directly is its own findings' lifecycle.
4. **Plan.** A forward capacity model finds the gaps weeks ahead. Plans for large or far-off items arrive as a group of suggestions. Code computes the dates and hours; the model only writes milestone titles, and only when an item has no checklist.

## 4. What the PM reads

"Open" means:
- Tasks: todo, in_progress or blocked.
- Requests: submitted, in_review, in_progress, client_review or on_hold.
- Excluded: draft, delivered, archived and cancelled.

**Human touch** is the latest of the following. It is never `updated_at`, which the import and bulk writes have made meaningless.
- `messages.created_at` on the request, where the author is not the bot and the row is not deleted. The studio side (team_member) and the client side (contact) are tracked separately.
- `task_comments.created_at`, where the author is not the bot.
- `time_entries.created_at` by task or request, and any `active_timers` row.
- `request_steps.completed_at`, and the new `task_subtasks.completed_at`.
- `audit_log` rows on the item whose actor is a team member (`task.updated`, `request.handed_off`, `request.handed_back`, and the new `task.subtask_toggled`).

**Start signal**
- A task has started if any of these is true: its status is past todo, a checklist item is ticked, time has been logged, or a human commented after `created_at`.
- A request has started if any of these is true: its status is past in_review, the studio has posted a message, time has been logged, or a step is complete.

**Who owns what**
- The person is the assignee: `tasks.assignee_id` with `assignee_type` team_member, or `requests.assignee_id`.
- The owner is the escalation target. For a task linked to a request it is that request's owner. Otherwise it is the `pm` participant, then `resolveProjectManager` for the client.
- A task assigned to a contact is addressed to the owner, never to the contact.

**Other inputs**
- Blocked: `tasks.status` is blocked, or an open `work_blockers` row points at a blocker that is still open.
- Load: `estimated_hours`, the share of checklist items not done, weekly hours, `team.inactiveMemberEmails`, and the leave and holiday settings.

**Performance**
- Facts come from about eight aggregate queries (`MAX()` with `GROUP BY`), with ids chunked at 90 because D1 allows 100 bound parameters.
- Message bodies are never selected.

## 5. What counts as slipping

- Working days are Monday to Friday in Pacific/Auckland, minus `pm.publicHolidays` and the person's `pm.availability` entries.
- All day arithmetic goes through one tested helper (lib/pm/working-days.ts), built on `STUDIO_TIME_ZONE` the way `snoozePreset` is. NZ daylight saving starts Sun 27 Sep 2026, so the tests cover that switch.
- Every number below is a `settings` key, shown with its default.

| Rule | Fires when | Addressed to | Severity | Next steps |
|---|---|---|---|---|
| `waiting_on_client` | A hand-off pointer is set and `waiting_since` is older than `requests.handoffNudgeDays` (3) days, or `waiting_due_at` has passed | The request's owner, never the contact | risk once `waiting_due_at` has passed, otherwise watch | Send reminder, Take it back |
| `overdue` | `due_date` is before today in NZ | Assignee | risk | On it, Reschedule, Blocked |
| `not_started` | No start signal, and the working days from today to the due date (inclusive) are N or fewer. N is the larger of `pm.notStartedWorkingDays` (3) and one more than the days the estimate needs at the person's daily hours | Assignee | risk | On it, Reschedule, Blocked |
| `review_silent` | A request is in client_review with no hand-off pointer, and the last non-bot message is the studio's (or there is none) and older than `pm.reviewSilentWorkingDays` (5) | Owner | watch | Hand off (the existing hand-back then takes over), Mark delivered |
| `blocked_long` | Blocked for more than `pm.blockedWorkingDays` (5), counted from `work_blockers.created_at` or from the `task.updated` row that changed the status | Assignee | watch | Open the blocker |
| `quiet` | The studio holds the ball and nobody has touched it for `pm.quietWorkingDays` (5), counted from the later of the last human touch and `created_at`. "Holds the ball" means a request in submitted, in_review or in_progress with no hand-off pointer, or a task in progress | Assignee | watch | On it, Blocked, Hand off (requests) |
| `unowned` | Open with no team-member assignee, or assigned to someone on `team.inactiveMemberEmails`, for more than `pm.unownedWorkingDays` (2) | Owner | watch | Assign |

`overbooked` is a finding about a person, not an item. It comes with forward capacity in PM.4a:
- It runs earliest deadline first over the next `pm.capacityHorizonWorkingDays` (15) working days.
- For each due date, it compares the person's remaining estimate due by then (the estimate times the share of checklist items not done) with their free hours until then.
- It fires when the worst shortfall is `pm.overbookedHours` (8) or more.
- It is pushed on Mondays only, to the person and to the studio line.

The Monday studio line also carries two counts, never one finding per item:
- open items with no due date or no estimate;
- pending suggestions older than three working days.

**Rules that keep the noise down**
- **One finding per item.** When several rules match, the first in the table order wins.
- **Blocked items** are exempt from `not_started`, `review_silent` and `quiet`. `overdue` still fires, and it names the blocker.
- **Exempt items:**
  - on_hold requests are exempt from everything except `overdue`;
  - a parent request with open sub-requests is exempt, because the subs carry the work.
- **Access.** A person is only ever addressed about orgs they can see (`resolveAccessScoping`).
- **Digests group findings by client** ("8 Verandela requests unassigned since 19 Sep"). The findings themselves stay per item, so the dedupe stays exact.

**First run on today's data (Monday 28 Sep)**
- Staci:
  - `overdue`: #226 Design directions (due 24 Jul).
  - `not_started`: the remaining V1 pages (45h, 0 of 9, due Fri 2 Oct). With N = 7 it has been due to fire since Thu 24 Sep.
- Liam:
  - `waiting_on_client`: #244, with Mickey Day since 18 Sep, due Wed 30 Sep.
  - `not_started`: Global components (38h, due Wed 30 Sep, N = 6), then Audience hubs from Tue 29 Sep, Home from Wed 30 Sep, and the Contractors set from Thu 1 Oct.
  - `unowned`: Verandela #228 to #235, as one grouped line.
  - `quiet`: Stride #252 and #255 and Elevate #257. #253 is exempt as a parent with an open sub.
  - `review_silent`: Elevate #206, #237 and #240. Both of the last two groups are to be confirmed by the first run, because they depend on thread reads.
- From PM.4a, `overbooked`: Liam is 89h short by Mon 12 Oct. Staci is 5h short by Fri 2 Oct, which is under the 8h threshold, so it shows on the capacity plan but is not pushed.
- The first live run marks all of this as baseline. It sends each person one line ("7 things already slipping, listed under Slipping on /tasks") instead of seven.

## 6. Who it talks to, and how

**Audience**
- The assignee comes first.
- The owner hears when the assignee is silent (section 7). The owner also hears first about anything the owner has to chase: `waiting_on_client`, `review_silent` and `unowned`.
- The founders get the studio picture in the brief.
- No client contact is ever addressed. Nothing appears on the client home or on any /api/portal route.

**Channels, quietest first**
1. **Home cards (pull only).**
   - owner-home.tsx gets a Slipping card beside `SuggestionsCard`: counts by severity, plus the top six findings studio-wide with person chips. It is fed by `kpis.pmFindings` on /api/admin/overview and hidden at zero.
   - teammate-home.tsx gets a Needs you card showing only that member's findings, with 44px buttons.
   - A Slipping view is added to the /tasks rail (`/tasks?view=slipping`).
   - The task and request details get one PM line, which shows the finding's history (found, told, acknowledged, escalated).
2. **The daily digest.** One push per person per working day.
   - Until Slack is live, it is one `notifications` row with the new event type `pm_digest`. It carries no email plan and is added to `PREF_EVENT_TYPES` so it can be muted.
   - Once CN.2 is live, it is one DM through the Tahi app instead, never both.
   - It lists up to `pm.maxDigestItems` (5) new or escalated findings with their buttons, then "and N more on your home".
   - Nothing is sent when nothing is new or escalated.
3. **The brief.** Once FU.7 moves `computeBrief` into lib/, its `week` rows are read from `pm_findings`, never recomputed. They replace today's overdue-requests source instead of duplicating it.
   - Every day there are at most three PM rows.
   - On Mondays those rows add founder items that went unanswered, overbooked people, off-track engagements (`listOffTrackEngagements`), the data-gap counts, and "at risk next month" from forward capacity.
   - The move also drops the em dashes in the brief's rows.
4. **Thread lines.** When a change the PM led to is applied, `applySuggestion` posts the Tahi bot line #064 already requires. It goes through `postTaskComment`, or `postRequestBotMessage` (always internal), with the finding's evidence as the quote. For example: "Liam rescheduled this from Wed 30 Sep to Fri 2 Oct (was not started, 0 of 8 checklist items)." Acknowledging or dismissing a finding goes on the finding's history, not in the thread.

**Tone.** Templates live in lib/pm/copy.ts:
- One sentence of facts per finding, with the client, the item, the date and the evidence.
- No greeting, no emoji, no model prose, no dashes.
- The digest header only counts: "3 slipping, 1 new since yesterday."

**Nathan** has no login and no Slack identity, and he is on the inactive list. Anything assigned to him is addressed to the owner as `unowned`, with the line "Nathan cannot be reached from the dashboard".

## 7. The escalation ladder

| Step | When | What happens |
|---|---|---|
| 0, found | The run that first sees it | The row opens and shows on the home card, the Slipping view and the item's PM line. Nothing is pushed. |
| 1, told | The next digest on a working day | The finding is listed once in the person's digest, and `notified_at` is stamped. It is not listed again unless it reaches step 2. |
| 2, escalated | `pm.escalateAfterWorkingDays` (2) after step 1 with no button pressed and no change in the facts; or an On it that ends with nothing changed | A member's or contractor's item gets one line in the owner's next digest. A founder's own item, or one whose owner is the same person, goes onto the Monday studio line instead (decision 6). `escalated_at` is stamped. |
| 3, visible | After step 2 | The finding stays on the home card, the Slipping view and the Monday line, marked "open N days". Nothing more is pushed. |

- **On it** acknowledges a finding for `pm.onItWorkingDays` (2). If nothing has changed when that runs out, the finding goes straight to step 2. On it buys time; it does not buy silence.
- **Not slipping** dismisses the finding for its current facts, with an optional one-line reason. The finding does not come back until the facts change.
- **With today's team the ladder is short.** Both people who can be reached are founders, so a finding is told once and then waits on the Monday line.

## 8. Noise budget

- **Per person:** at most one push per working day (a bell row or a DM, never both), listing at most five findings. There are no pushes at weekends, on public holidays, on a person's leave, or in shadow mode.
- **Per finding:** at most two pushes in its whole life, told and escalated, and never a second message about the same facts. A finding only comes back when its fingerprint changes (section 11).
- **Per studio:** at most three PM rows in the brief a day, and a single grouped line per client in any digest.
- **In threads:** a line only when a change is applied, one per change.
- **In words:** no push is ever written by a model.
- **Dismissals as feedback:** each run's `cron_runs` summary counts dismissals per rule. If more than half of a rule's findings are dismissed over two weeks, its threshold gets raised, through settings, with Liam's say.

## 9. Cadence

No new cron expressions are needed. The new targets are appended to existing ones, and they use the default `cron/<target>` path.

| Target | Expression | NZ time (NZDT from 27 Sep, then NZST) | Work |
|---|---|---|---|
| `pm-check` | `0 18 * * *`, after snapshot-metrics | 07:00, then 06:00 | Facts, rules, upsert and resolve. On NZ Mondays it also runs the capacity pass (PM.4a) and the re-plan pass (PM.4b). No model call in PM.1 |
| `overview-brief` | `0 19` and `0 20` (unchanged) | 08:00 and 09:00, then 07:00 and 08:00 | Reads `pm_findings` |
| `pm-digest` | Appended to `0 19` and `0 20`, after overview-brief | Sends in the first run where NZ time is 8am or later | One digest per person per NZ working day, made idempotent by `pm_digests` |

- **Weekdays come from the studio zone in code, never from the cron's day field.** `0 21 * * MON` fires on Tuesday morning in NZ, as `finance-anomaly-scan` does today. That is why the Monday passes sit inside the daily `pm-check`.
- **Wiring.** Each target is registered in:
  - `cronToTargets`;
  - the list in app/api/admin/crons/route.ts;
  - the manual options in .github/workflows/dashboard-crons.yml;
  - app/api/__tests__/cron-trigger-schedule.test.ts.
- **Budget.** `pm-check` should take under 10 seconds at today's volume (about 35 open items), well inside the 120-second cut.
- **Findings resolve during the day, not just the next morning.**
  - `updateTaskRecord`, `updateRequestRecord`, `handBackOnClientAction`, `postTaskComment` and the subtask toggle call `resolvePmFindingsFor(subject)`, best effort.
  - The list route re-checks the rows it returns (the rules are pure functions).
- **Safe restarts.** Digests are stamped before they are posted, the stamp-first rule the hand-off nudge already follows, so a run cut off partway sends nothing twice.

## 10. Buttons and the gate

**The shared actions.** lib/pm/actions.ts backs the home card, the Slack `pm:` action prefix and the MCP `act_on_pm_finding`.
- **On it and Not slipping** write the finding's own lifecycle (`acted_at`, `acted_by_id`, `acted_via`, `snooze_until` or `dismissed`).
- **Reschedule** opens a date picker: a popover on the card, or a `viewsOpen` modal in Slack submitted through `registerViewSubmissionHandler`. The pick writes an `update_task` or `update_request` suggestion: `fields {dueDate}`, `source_kind` pm, `source_ref` set to the finding id, and `quote` set to the evidence line.
  - If the person pressing is the rightful approver (decision 3), `decideSuggestion` approves the row in the same handler.
  - Otherwise the row waits in the inbox for its approver.
- **Blocked, Hand off and Assign** are links into the item with the right picker already open: the blocker picker (app/api/admin/{tasks,requests}/[id]/blockers), the hand-off dialog (app/api/admin/requests/[id]/handoff) or the assignee picker. A person finishes the job with the existing routes, and the next check resolves the finding. Hand off stays a dashboard action because `handOffRequest` emails the contact.
- **Send reminder** (`waiting_on_client` only) is a new POST route, app/api/admin/requests/[id]/handoff/remind.
  - It runs the one-row body of `nudgeStalledHandoffs`, extracted as `nudgeOneHandoff`.
  - It stamps first, respects `MIN_DAYS_BETWEEN_NUDGES`, and goes through lib/email-delivery.ts and the allowlist.
  - A person presses it; the PM never does.
- **Take it back** uses the existing hand-back route.

**Changes to the gate** (lib/task-suggestions.ts and the inbox)
- **New sources and a pointer.** `source_kind` gains pm (and pm_reply for PM.3), and a new column `task_suggestions.source_ref` holds the finding id.
  - The dedupe slot becomes `transcriptId ?? sourceRef ?? ''`.
  - Every existing row has a null `source_ref`, so every key already on production hashes exactly as it does today. CN.1b took the same care.
- **Evidence instead of a quote.** A PM row's `quote` is an evidence line built by code from the numbers. A row whose line cannot be built is dropped, the same rule as for calls.
- **Approval is enforced for PM rows.** `decideSuggestion` refuses anyone who is neither the named approver nor a founder.
  - Both actor ids are mapped to `team_members.id` through `clerk_user_id`: the Clerk id from the dashboard and the team member id from Slack.
  - Slack gains `decide_own_suggestions` and `act_on_own_findings` (founder and member).
- **A PM bot line** replaces "Applied from the call ..." on these rows.
- **Inbox and home card.**
  - `groupSuggestionsByCall` groups by transcript, then call, then `source_ref`, and labels a PM group "From the PM" or "Plan: <title>".
  - `countSuggestions` and the overview KPI query report calls and PM rows separately ("6 from 2 calls, 1 from the PM").

## 11. Data model

**Migration 0111 (PM.1), guarded with IF NOT EXISTS like 0104 to 0110, applied to tahi-db before the push**

`pm_findings`, the one table #067 sketched:
- Identity: `id`, `created_at`, `updated_at`, `first_seen_at`, `last_seen_at`.
- Subject:
  - `rule`;
  - `subject_type` (task, request, person or studio) and `subject_id`;
  - `org_id`, which is nullable and gated by `requireAccessToOrg` the way `guardSuggestion` is.
- People: `person_id` (the team member it is addressed to) and `owner_id` (the escalation target).
- Content:
  - `severity` (risk or watch);
  - `reason`, one template sentence;
  - `evidence`, a JSON copy of the values read;
  - `next_steps`, JSON action slugs.
- Dedupe: `fingerprint`, and `dedupe_key`, which is a UNIQUE sha-256 of `rule:subject_type:subject_id:fingerprint`.
- State:
  - `status` (open, acknowledged, resolved or dismissed), `snooze_until`;
  - `acted_at`, `acted_by_id`, `acted_via`, `dismiss_reason`;
  - `notified_at`, `escalated_at`, `escalated_to_id`;
  - `resolved_at`, `resolved_reason` (condition_cleared, changed, subject_closed or dismissed);
  - `suggestion_id`, `baseline`.
- Indexes: (`status`, `person_id`), (`subject_type`, `subject_id`) and (`org_id`, `status`).

The fingerprint holds only the facts that would make a finding mean something new:

| Rule | Fingerprint |
|---|---|
| `overdue`, `not_started` | due date and assignee (a status flip alone does not reopen it) |
| `quiet` | the last touch (a touch resolves it, and five more quiet days make a new slip) |
| `waiting_on_client` | contact, `waiting_since`, `waiting_due_at` |
| `review_silent` | the id of the last studio message |
| `blocked_long` | the blocker ids |
| `unowned` | the assignee |
| `overbooked` | person, ISO week, and the shortfall rounded to 8h |

- Each run upserts on `dedupe_key`: a finding that is still true only updates `last_seen_at` and `evidence`.
- When a condition clears or its fingerprint changes, the old row is resolved and the new one inserted in the same D1 batch. There is therefore one live row per rule and item, and a dismissed finding stays dismissed until its facts change.

`pm_digests`: (`id`, `team_member_id`, `sent_for` as an NZ date, `channel` bell or slack, `slack_channel_id`, `slack_ts`, `finding_ids` as JSON, `created_at`), with UNIQUE (`team_member_id`, `sent_for`). It does three jobs:
- once per person per day;
- rewriting the Slack message when a button is pressed or a finding clears;
- mapping a threaded reply back to its findings in PM.3.

Also in 0111:
- `task_suggestions.source_ref` (nullable, indexed).
- `task_subtasks.completed_at`, stamped by the toggle route along with a `task.subtask_toggled` audit row. Without it, ticking a checklist looks like silence.

**Migration 0112 (PM.4b):** `task_subtasks.due_date`, `estimated_hours` and `position`.

**Settings.** Read tolerantly, the way `resolveNudgeAfterDays` does, and editable through PATCH /api/admin/settings and the MCP tool `update_settings`.

| Key | Default |
|---|---|
| `pm.mode` | off, then shadow, then live |
| `pm.digestChannel` | bell (slack once CN.2 is live) |
| `pm.notStartedWorkingDays`, `pm.quietWorkingDays`, `pm.reviewSilentWorkingDays`, `pm.blockedWorkingDays`, `pm.unownedWorkingDays` | 3, 5, 5, 5, 2 |
| `pm.escalateAfterWorkingDays`, `pm.onItWorkingDays`, `pm.maxDigestItems` | 2, 2, 5 |
| `pm.overbookedHours`, `pm.capacityHorizonWorkingDays` | 8, 15 |
| `pm.planThresholdHours`, `pm.planHorizonDays` | 16, 21 |
| `pm.publicHolidays` | NZ dates through 2027 |
| `pm.availability` | list of `{ teamMemberId, from, to, hoursPerDay, note }` for leave and part weeks |
| `pm.dailyModelCentsCap` | 100 |
| `requests.handoffNudgeMode` | studio (auto is #063 as built) |

## 12. Planning ahead (PM.4)

**PM.4a: forward capacity (no model)**
- lib/pm/capacity.ts holds pure functions. For each active person and each NZ working day over the next eight weeks, it computes the free hours (weekly hours divided by five, minus holidays and leave) and lists every open item with an estimate and a due date.
- **The fit test** orders work by earliest due date: for every due date, the hours due by then must fit into the hours available from today until then. It needs no start dates (tasks have none) and explains itself in one line: "254h due by 22 Oct against 152h at 40h a week."
- **Unknowns are listed, never counted as zero.** Items with no estimate or no due date are named. Today's capacity route counts them as zero, which is part of why it reads 0%.
- **Where it shows up:**
  - GET /api/admin/capacity/plan and the MCP tool `get_capacity_plan`;
  - the `overbooked` finding;
  - the Monday "at risk next month" line.
- **`get_studio_capacity` keeps its output**, with two small fixes in P0: its week moves to the studio zone, and cancelled and on_hold requests stop counting.

**PM.4b: plans through the gate**

*When the PM plans.* An item needs a plan when it is:
- open;
- assigned to an active member;
- either estimated at `pm.planThresholdHours` (16) or more, or due more than `pm.planHorizonDays` (21) out;
- without dated milestones.

The TASKS wording ("no subtasks or schedule row") does not work on today's data: 10 of Liam's 11 tasks have checklists and none has a schedule row, so it would skip almost everything. On live data the test picks up 10 of Liam's 11 open tasks (not SEO / AEO, which is 15h due in 18 days) and 2 of Staci's 3 (not Design QA, which is 8h). It picks up no request, because no request has an estimate. On the request side PM.4 therefore starts with `needs_estimate` findings.

*A task's plan: dated milestones on its own checklist.*
- **A new kind, `plan_subtasks`.** Its proposal holds:
  - the finding id, the parent's due date, `fits`, the earliest finish and `gapHours`;
  - the basis (hours a week, start day, holidays and leave);
  - the milestones, as `[{ subtaskId | null, title, dueDate, estimatedHours, position }]`.
- **Applying it** goes through a new `applySubtaskPlan` in lib/task-writes.ts, which the subtask routes and the MCP subtask tools share.
  - Existing items are dated in place and new ones are added.
  - It never deletes, unticks or renames an item, and never moves the parent's due date.
- **A date a person typed into a title wins.** "Staging + UAT brief sent (12 Oct)" keeps 12 Oct as the human's target, and the card flags it when capacity says that date cannot be met.
- **Hours.**
  - When there is no checklist, Sonnet reads the description and proposes milestone titles and an hours split, which must add up exactly to the parent's estimate or the row is dropped.
  - An existing checklist is split evenly, and the card says so.
  - Code sets every date.
- **If it fits,** milestones are dated working back from the due date into the latest days left free after the person's earlier-due work.
- **If it does not fit,** the milestones are dated forward from the first free day, and the row records `fits: false`, the earliest finish and the gap. Separate rows in the same group are offered alongside, with none pre-selected:
  - `update_task` with the earliest finish as the new due date;
  - `update_task` with a new assignee, only when an active member has room over that period (nobody does today);
  - a note stating the gap.
- **There is never a "tell the client" option.** When the date was promised to a client, the row says a founder decides what to say, and the PM stops there.

*Worked example: "Build the audience hubs and the 12 product sub-pages"* (42h, urgent, due Wed 7 Oct, no checklist).
1. Sonnet proposes five milestones whose hours add up to 42: the hub layout; the sub-page section stack; Staci signs off the reference; populate the three hubs; populate the 12 sub-pages.
2. Code dates them. Global components and Home (54h) fill Mon 28 Sep to Tue 6 Oct. On a shared due date the higher priority goes first, so this task goes ahead of the Contractors set.
3. The card reads: "Does not fit: earliest finish Tue 13 Oct (due Wed 7 Oct); Finish the Contractors set, due the same day, moves to Mon 19 Oct. 127h due by 7 Oct against 64h at 40h a week, nothing else counted."

*A request's plan: internal tasks linked to it.*
- The plan is a set of `create_task` rows of type internal_client_task, with `request_id` set, the request's assignee, a due date and an estimate.
- It never writes request steps (the client ticks those: the #244 note asks Mickey to), never creates sub-requests (the portal shows them) and never messages a client.
- A missing request estimate is proposed as `update_request` with the `estimateRequestHours` baseline, labelled as a baseline. A founder approves it, because the portal shows estimates.

*Who approves.*
- The assignee approves the plan for their own internal task.
- The founders approve anything the client can see, and anything assigned to a contractor.

*Gate details for plans.*
- **The dedupe key.** A `plan_subtasks` branch in `normalisedTitleOrDiff` builds the key from the finding id plus a hash of the inputs: due date, estimate, assignee, checklist ids and capacity basis. With the same inputs the PM never proposes twice, including after a Reject.
- **A new version replaces the old.** A re-plan with new inputs expires the older version's pending and snoozed rows before inserting the new one. This is deliberately the opposite of CN.1c: a transcript is fixed, so a re-read is another sample to merge, but a plan depends on today's state, so an older version is simply wrong.
- **A duplicate-guard exemption.** PM `create_task` rows need one when compared with each other and with tasks under the same request. Otherwise "QA pass" in one plan would block "QA pass" in another.
- **One bot line per approved plan:** "Plan applied (proposed Mon 28 Sep at 40h a week): 5 milestones, last Tue 13 Oct."

*The Monday re-check* (inside `pm-check`):
- A milestone past its date and not ticked becomes a `milestone_missed` finding. It is nudged like any other, and nothing moves on its own.
- If the fit test now fails where it used to pass, the PM records `plan_does_not_fit` and proposes a new version.
- If nothing changed and the plan still fits, the PM does nothing: no row, no line, no message.

*Where it shows up.*
- A plan card on the task detail (components/tahi/tasks/task-detail-panel.tsx, beside the checklist) and in the request detail's side column. It carries Approve plan, Tweak and Not now, with 44px targets, checked at 375px and in dark mode through tokens.
- An inbox group with Approve plan, which posts to decide-bulk.

*What is missing to plan honestly.*
- **Real delivery hours** (decision 8).
- **Leave and holidays**, which are stored nowhere today. The settings above cover them, and calendar freeBusy can come later.
- **Actual hours.** There are no time entries, so every plan says "estimates only, no time logged". The PM cannot tell "behind" from "the estimate was wrong" until time is logged, and that is a habit, not a build.
- **Dependencies**, which live only in descriptions. The planner can report the ones it reads as a warning line; it never writes blockers.
- **A live schedule.** The shared Giant Gantt still says July, so schedule rows are ignored as a plan source until someone relinks them.
- **Checklists are not ticked.** The content pages task was closed with 0 of 8 ticked, so checklist progress is a weak signal, and the card says when it is all the PM has.

## 13. Model and cost

Rates are from lib/ai-cost.ts: `claude-sonnet-5` at $2 in and $10 out per million tokens.

| Stage | Model | When | Tokens in / out | Cost |
|---|---|---|---|---|
| PM.1 check, PM.2 digest | None (rules and templates) | Daily | 0 | 0 |
| PM.4a capacity | None | Daily, pushed Mondays | 0 | 0 |
| PM.3 reply to updates | `SONNET_MODEL` through the existing suggester, one read | Per reply | about 7k / 800 | about 2 cents |
| PM.4b milestone titles | `SONNET_MODEL`, a new small prompt, only for items with no checklist | Mondays or the card button | about 4.5k / 1k | about 2 cents |

- **Expected spend** is 5 to 25 cents a day, under $8 a month. For scale, the five CN.1b passes cost $2.70.
- **Hard cap.** Before each call, the day's `ai_cost_log` rows under a new scope `pm` (added to `Scope` in lib/ai-cost.ts) are summed against `pm.dailyModelCentsCap`. Over the cap, a reply is told "I will read this in the morning", and a plan is deferred to the next run.
- **Why Sonnet and not Haiku.** The volume is tiny, and the suggester's validation, name resolution and quote rule already exist for Sonnet. A second prompt path would cost more in upkeep than it saves.
- **FU.1 lands before any model call runs inside a cron:** a timeout capped at the time left in the budget.

## 14. MCP tools

These go on the worker only (rule 14), in a new file workers/mcp-server/src/pm-tools.ts with a parity test and honest inputSchema types (#066).

| Tool | Arguments | Slice |
|---|---|---|
| `list_pm_findings` | scope (me or studio), personId, status, severity, rule, orgId | PM.1 |
| `act_on_pm_finding` | id, action (on_it, not_slipping, reschedule), date, reason | PM.1 |
| `cron_pm_check` | dryRun | PM.1 |
| `cron_pm_digest` | dryRun | PM.1 |
| `pm_update_from_text` | subjectType, subjectId, text | PM.3 |
| `get_capacity_plan` | weeks, memberId | PM.4a |
| `propose_plan` | subjectType, subjectId, dryRun | PM.4b |

- Proposals are decided with the existing `decide_task_suggestion`. It and `list_task_suggestions` learn `source_kind` pm and the `plan_subtasks` kind.
- `get_dashboard_guide` gains a PM section.
- Access follows rules 11 and 12:
  - `scope=me` returns the caller's own findings, filtered by `resolveAccessScoping`;
  - `scope=studio` requires super_admin.

## 15. Slice plan

| Slice | Contents | Size |
|---|---|---|
| P0, prerequisites | FU.7: move `computeBrief` and its helpers to lib/overview-brief.ts and drop the em dashes in its rows. Gate the hand-off half of `delivery-watch` behind `requests.handoffNudgeMode`, then add `delivery-watch` to `cronToTargets` per decision 7. Fix the capacity route's week (studio zone) and its open set. | about 1 day |
| PM.1, the check | Migration 0111. `task_subtasks.completed_at` and the toggle audit row. lib/pm/ (`working-days`, `signals`, `rules`, `findings`, `copy`, `actions`). `cron/pm-check` and `cron/pm-digest` (bell). GET and PATCH /api/admin/pm-findings. The Slipping card, Needs you card, Slipping view and item PM line. Reschedule into the gate, with the gate changes in section 10. The Send reminder route. The brief rows. The MCP tools for PM.1. Then the shadow week and the baseline run. | about 4 days |
| PM.4a, forward capacity | lib/pm/capacity.ts, tested against the Giant month as fixture data (254h against 152h by 22 Oct; Staci 5h short by 2 Oct). The `overbooked` finding. GET /api/admin/capacity/plan. `get_capacity_plan`. The Monday "at risk next month" line. | about 1.5 days |
| PM.2, the nudge in Slack | Needs CN.2 live. The digest as one DM per person, with `users.lookupByEmail` added to lib/slack/api.ts, then `openDm` and an identity row, so nobody has to message the app first. The `pm:` action prefix, the reschedule modal, `decide_own_suggestions` and `act_on_own_findings`, message rewrites through `pm_digests`, and `pm.digestChannel` flipped to slack. | about 2.5 days |
| PM.3, replies become updates | `SlackDmEvent` gains `threadTs`. A handler registered ahead of `handleSlackDm` checks `pm_digests` for (channel, thread). A match goes to the suggester through the `draftFromNote` path, with that digest's items in focus, `source_kind` pm_reply, and the sender as approver; anything else falls through unchanged. A "Turn into updates" button on task and request threads. `pm_update_from_text`. | about 2 days |
| PM.4b, plans through the gate | Migration 0112. `applySubtaskPlan` and the `plan_subtasks` kind. The planner prompt and cost cap. `needs_estimate`. The plan version, replace and duplicate rules. The plan card and the inbox group. The Monday re-check. `propose_plan`. FU.1. | about 4 days |
| PM.5, retainer quiet | `retainer_quiet`: an active subscription with no request activity or client message in 30 days, pushed on Mondays only. It becomes the one source for that signal, with `client_inactive` and retainer-alerts reconciled so the studio is told once. | about 1 day |

- **Total:** about 16 days, built in this order: P0, PM.1, PM.4a, PM.2 (once Slack is live), PM.3, PM.4b, PM.5.
- **PM.1 and PM.4a pay off without Slack,** just as CN.1 did.
- **This re-cut moves the two request-level client rules** (`waiting_on_client`, `review_silent`) from PM.5 into PM.1, and splits PM.4 into capacity and plans.
- **Housekeeping for the lead:** TASKS.md already has a merged row called PM.1 (default project manager for new clients). Rename one of the two before these slices land.

## 16. Risks and how the design handles them

- **Work done outside the dashboard reads as "not started".** Webflow and Figma work with no time logged is the likeliest false positive, and all 14 Giant tasks are untouched in the dashboard.
  - Todo tasks only fire through the size-aware `not_started` window, never through `quiet`.
  - The evidence line shows why a finding fired.
  - On it and Not slipping are one tap each, and the shadow week measures the rate before anything is pushed.
- **Misleading activity signals.** Bulk `updated_at` stamps, untimed subtask ticks and day-grained time entries can all mislead, and so can the PM's own bot lines. Bot rows are excluded, `updated_at` is never read, and 0111 adds `completed_at`.
- **The claimed foundation is not live.** #067 names the delivery-watch and hand-off crons as live, and they have never run. Scheduling `delivery-watch` as built arms automatic client reminders that only the allowlist holds back (`email.deliveryMode` allowlist, `allowedOrgIds` empty). P0 gates that half first.
- **The first run floods, with two founders to absorb it.** The mitigations are the baseline line, the shadow week, the five-item cap, grouping by client and one line for data gaps.
- **Real overload.** Liam is about 100h short by launch. No DM fixes that; it is a planning conversation for the brief and PM.4, and the PM's job is to show it three weeks early rather than on 22 Oct.
- **Confidently wrong numbers.** Forty hours is a default, and no time is logged. Every capacity line prints its basis, unknowns are counted and named, and plans say "estimates only".
- **Duplicate surfaces.** The brief's overdue rows, `delivery_off_track`, `client_inactive`, `request_overdue` and retainer-alerts overlap with the PM. PM.1 replaces the brief's overdue source, PM.5 settles retainer quiet, and scheduling `automation-sweep` stays a separate decision.
- **Client leakage.** Request bot lines are always internal. Findings never appear on portal routes, and tasks assigned to contacts are never nudged. A guard test fails if anything under lib/pm/ imports lib/email-delivery.ts or lib/notification-email.ts, or passes an email plan, with one exception: the Send reminder route, which a person presses.
- **Dedupe key drift.** Any change to `buildDedupeKey` must keep every production key hashing the same. A test pins a call row and a note row's key before and after.
- **Slack surprises.** The app runs in Agents and Apps mode, which may show proactive DMs as new assistant threads. Check that in the first live DM pass, together with FU.8's duplicate voice events.
- **Time zones.** NZ daylight saving starts on 27 Sep, and the capacity route reads the UTC weekday today. All windows go through one tested helper on `STUDIO_TIME_ZONE`.
- **D1 limits.** Ids are chunked at 90, message bodies are never selected, and the queries are aggregates.

## 17. Where the three drafts disagreed, and what was picked

1. **Thread lines.** The systems draft (and the TASKS sketch) posted a bot line on the first nudge and on escalation; the accountability draft only when a person acts. Picked: only when a change is applied. The finding's history and the item's PM line keep the record, and nags in a request thread become noise the studio learns to skip. It is inside decision 2 so Liam can overrule it.
2. **The Slack shape.** One digest message, or a header plus one message per finding. Picked: one message. Each DM message is its own notification. PM.3 maps a reply in the digest's thread to all of its findings through `pm_digests`, and the suggester picks the target from context, as it already does for notes.
3. **Dedupe.** The candidates were a fingerprinted unique key (accountability), a nullable `open_key` (systems) and an `inputs_hash` (planning). Picked: the fingerprinted key. A dismissed or resolved finding cannot come back until its facts change, and resolving the old row in the same batch keeps one live row per item. `open_key` alone would raise a dismissed finding again on the next run. `inputs_hash` survives as the plan's dedupe material.
4. **Who approves a press.** One draft let a founder's Reschedule apply at once; one routed every request change through the founders; one let assignees approve their own internal work. Merged into one rule: the press is the approval when the presser is the rightful approver, and client-visible request fields are founders only.
5. **When the client-side rules ship.** The systems draft held hand-off and client-review rules for PM.5. Picked PM.1: #244 is the live case of work sliding with a client, and the chase has never run.
6. **What `quiet` covers.** In-progress items only (accountability), or anything gated on a due date or client-facing (systems). Picked: requests where the studio holds the ball, plus in-progress tasks. The first version misses Stride #252 and #255 and Elevate #257, which are assigned, undated and silent for weeks; leaving todo tasks to `not_started` keeps the 14 Giant tasks from all firing on day one.
7. **The `not_started` window.** 3 or 5 working days. Picked: size-aware. A 38h task due Wednesday needs flagging a week out, and a 2h task does not.
8. **The planning trigger.** "No subtasks or schedule row" (TASKS and the systems draft), or "no dated milestones" (planning). Picked the latter: the former fires on one task out of 14 today, and for the wrong reason.
9. **Request plans.** Dated request steps with a new `add_request_steps` kind (systems), or internal tasks linked to the request (planning). Picked internal tasks: steps and sub-requests are client-visible.
10. **The Monday schedule.** The systems draft's `0 21 * * MON` lands on Tuesday at 10:00 NZDT. Picked a weekday check inside the daily `pm-check`.
11. **Reaching people in Slack.** Wait for each person to DM the app first (accountability), or look them up by email (systems). Picked lookup by email: the scope is already in the manifest, and it removes a setup step that Nathan could never do.
12. **Where forward capacity lives.** In PM.1 (accountability), its own early phase (planning), or late in PM.4 (systems). Picked PM.4a, straight after PM.1: it is the biggest real risk on production and needs no model, but it should not hold up the item check.
13. **Small numbers.** On it lasts 2 working days, not 3, the same as the escalation window, so there is one number to remember. Severity has two levels, risk and watch, not three.
14. **One draft's claim was corrected against the data.** The planning draft counted all 14 open tasks as needing a plan. Two fall under both thresholds (SEO / AEO at 15h, Design QA at 8h), so the true count is 12.

## 18. Out of scope

- Any model call in the check or the digest.
- Email to anyone, apart from the Send reminder a person presses.
- Anything sent to a client or contact without a person pressing it.
- Channel posts (#founders can come later).
- Automatic field edits and automatic rebalancing between people.
- Writing request steps or sub-requests, or proposing blockers.
- Relinking or redrawing Gantt schedules.
- Calendar sync.
- Due-date history (audit metadata stores field names, not values).
- Scheduling `automation-sweep`.
- Learning from dismissals, beyond counting them (that joins CN.3's negative examples later).
