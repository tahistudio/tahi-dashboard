# CN.3 build contract: keeping in sync (2026-09-26)

TASKS.md CN.3: "dashboard task changes post to the Slack thread, a weekly digest of unreviewed suggestions, rejections as negative examples, GI.4 learns from applied suggestions." Scope doc: docs/superpowers/plans/2026-09-19-call-notes-to-tasks-scope.md, Phase 3. Builds on the live CN.1 family (2026-09-19-cn1-build-contract.md, cn1b, cn1c, cn1d) and the CN.2 Slack app (2026-09-22-cn2-slack-app-contract.md, 2026-09-22-slack-app-manifest.md).

STATUS (2026-09-26, reconciled with the build). Built as four slices and integrated on branch cn3-integration in the order N, S, G, D. Where the build departed from the first draft of this contract, the text below now says what was built and why; the main ones are the client copy policy (section 2), a call with no client seeing no rejections (section 7), the portal wizard naming only call-sourced rows (section 8), three more writers and one more field (sections 1 and 11b), and the digest route logging its own cron_runs row (section 11b). Migration 0111 must be applied on tahi-db before the push.

## 0. Where things stand, and the rules every slice keeps

What exists and what this contract relies on (verified in the code on main at dbcd323d):

- Call suggestions are posted by the sweep (lib/task-suggester.ts runSuggestionSweep, deliverToSlack) as one top-level message per suggestion in EACH founder's DM (lib/slack/mirror.ts postSuggestionsForCall). Every copy is recorded in slack_suggestion_messages (suggestion_id, channel_id, ts). A decision on any surface rewrites every copy in place to "Approved by Liam, 09:41" (mirrorSuggestionDecision, called from decideSuggestion in lib/task-suggestions.ts). So "the Slack thread where the task was approved" is concretely: the thread under a recorded card, thread_ts = that card's ts, in that channel.
- Note cards (a typed or voice DM from a founder, member or client) are posted by lib/slack/dispatch-dm.ts postCards into the sender's own DM. They are NOT recorded in slack_suggestion_messages at post time; a copy is only recorded when a founder clicks it. (CN.3 changes this: a founder's or member's note card is recorded at post time, a client's card never is. Sections 1 and 2.)
- CN.2 gap found while reading: lib/slack/dispatch-actions.ts refuses every click unless the clicker is a founder (can(identity, 'decide_call_suggestions')). A member pressing Approve on their own note card, and a client pressing Approve on their own "Is this the request?" card, both get the denial line, although the CN.2 contract says the sender approves their own note. CN.3 fixes this (section 6) because the digest would otherwise nag people about cards they cannot press.
- applySuggestion stamps applied_task_id on every applied task kind (create, update, complete, subtasks, note) and applied_request_id on every applied request kind. So "the item a suggestion touched" is always applied_task_id or applied_request_id on an applied row. Neither column is indexed yet.
- Task writes go through lib/task-writes.ts (createTaskRecord, updateTaskRecord) from POST and PATCH /api/admin/tasks; the bulk route and the promote route write the table directly. Request writes go through lib/request-writes.ts (createRequestRecord, updateRequestRecord, handOffRequest) from the admin routes, but the bulk route, the admin DELETE (archive) and three portal routes (review, approval, hand back) write the table directly.
- The GI.4 step one block lives in lib/ai-request-org-context.ts (CLIENT ON FILE and CLIENT HISTORY), read by both request wizard routes (admin and portal).
- workers/cron-trigger/src/schedule.ts maps UTC cron strings to dashboard targets; the worker redeploys itself on push through .github/workflows/cron-trigger-deploy.yml.
- Production has no SLACK_BOT_TOKEN yet (Liam's setup step in TASKS.md). lib/slack/api.ts slackBotToken() returns null.

Rules for every slice:

1. SLACK NOT CONFIGURED IS THE NORMAL CASE TODAY. Every Slack entry point checks slackBotToken() (or the helper named in its section) FIRST and returns before reading or writing anything. A test in each slice proves it with a database double that throws on any call. The two learning features (sections 7 and 8) do not depend on Slack and go live the moment they deploy.
2. Slack is never the reason anything else fails. Every Slack call is wrapped; a failed post is logged in the return value, never thrown into a route, a writer or a cron.
3. No em or en dashes anywhere (strings, comments, JSX, Slack text). No `any`. No console.log in production code (the existing console.error in lib/slack/defer.ts is the one accepted log). Plain sentences in the studio's voice.
4. Tables another slice's migration creates are read and written with raw SQL (drizzle `sql` template, `drizzle.run` and `drizzle.all`), exactly as lib/slack/mirror.ts did for slack_suggestion_messages in CN.2, so every worktree compiles on its own. A missing table reads as "nothing on file" and fails closed (no post), never as an error.
5. `npm run type-check` and `npm run lint` clean, and the vitest files named in the slice green, before the slice is handed back. Builders commit on their own branch; they do not push, merge, deploy, or run a migration against tahi-db.

## 1. What posts to Slack, and where (slice S)

A dashboard change to a task or request that came from an applied suggestion posts ONE threaded reply under that suggestion's card, in each DM that holds a copy and is allowed to hear it (section 2). Nothing else posts. CN.3 never opens a new DM for a change and never posts to a person's DM outside an existing card thread: nudging people in their own DM is PM.2's job, and the bell already tells an assignee they were handed something.

Which item: tasks by applied_task_id, requests by applied_request_id, on rows with status 'applied'. When several applied suggestions touched the same item, each channel gets the line once, in the thread of the most recently applied suggestion that has a copy in that channel (the highest card ts in that channel). Threads whose suggestion was applied more than 120 days ago get nothing (THREAD_HORIZON_DAYS).

Which changes (state, never conversation):

- Task: status (including done and reopen), assignee, due date, priority, title, deleted, and being turned into a client request (promote).
- Request: status (including delivered, cancelled, archived), assignee, due date, priority, a hand-off to a client contact (waiting on), the studio taking that hand-off back, the client approving or asking for changes in the portal, the client handing it back.
- Not posted: comments and messages on either thread, description edits, subtasks, tags, positions, estimates, schedule links, files, and (decided at integration) sub-requests and nesting. Comments stay out because a reply typed in Slack would never come back to the dashboard, and a thread that exists in two places is worse than one that exists in one (see question 3). A sub-request is to a request what a subtask is to a task, and nesting is a position in a tree, so both follow the subtask and position rule.

Which writers queue a line (all behind workSyncArmed(), section 4): lib/task-writes.ts updateTaskRecord (PATCH /api/admin/tasks/[id], MCP update_task), DELETE /api/admin/tasks/[id] (MCP delete_task), PATCH /api/admin/tasks/bulk (MCP bulk_update_tasks), POST /api/admin/tasks/[id]/promote (MCP promote_task_to_request), lib/request-writes.ts updateRequestRecord and handOffRequest (PATCH /api/admin/requests/[id] and POST handoff, so MCP update_request_status, assign_request, update_request_fields and hand_off_request), DELETE /api/admin/requests/[id] (archive, MCP delete_request), PATCH /api/admin/requests/bulk, POST /api/admin/requests/bulk-assign (MCP bulk_assign_requests), DELETE /api/admin/requests/[id]/handoff (MCP hand_back_request), and the portal's PATCH /api/portal/requests/[id] (approve the delivery), POST review and POST handback. The nest and sub-request routes do not, on purpose (above).

Which actors:

- A signed-in studio person through the dashboard routes, and the MCP service user (labelled "Claude").
- A client in the portal (approve, ask for changes, hand back), or the studio acting as that client (labelled "Liam as Tim").
- Never 'system' writes: the suggestion apply itself (its card is already rewritten to "Approved by ..."), automations, crons.

The line (plain mrkdwn, one line, no buttons), for example:

    Staci marked it done and set the due date to Fri 3 Oct · 14:02 · <https://portal.tahi.studio/requests/abc|Open #231>

Actor label: team member first name; "Claude" for SERVICE_USER_ID; a client's first name plus " at " plus the org name; "Liam as Tim" when acting; "Someone" when nothing resolves. Phrases: task status to done "marked it done", from done "reopened it as In progress", otherwise "moved it to <label>" (TASK_STATUS_LABELS); request status delivered "marked it delivered", archived "archived it", cancelled "cancelled it", otherwise "moved it to <label>" (REQUEST_STATUS_LABELS); assignee "assigned it to Liam", to the actor "took it on", cleared "unassigned it"; due date "set the due date to Fri 3 Oct" (the stored YYYY-MM-DD read as a calendar date, no zone shift) or "cleared the due date"; priority "set the priority to high"; title "renamed it to "New title"" (clipped to 80); a promote "turned it into request #232" ("turned it into a client request" when the number cannot be read); a hand-off "handed it to Tim Lyons, waiting on approval" (handoffReasonShortLabel); the studio taking it back "took it back from Tim Lyons" ("from the client" when the name cannot be read); portal review "approved it" or "asked for changes"; portal approval of a delivery "approved the delivery"; portal hand back "sent it back to the studio"; task delete "deleted it" (no link, the task is gone). A hand-off to the same person for the same reason posts nothing, like any other change that moves nothing. Several fields join as "A, B and C". Time is studioClock (NZ, 24 hour). The link is publicUrl('/tasks/<id>') labelled "Open task" or publicUrl('/requests/<id>') labelled "Open #<number>".

The decided card gets a link too (slice D): once a suggestion is approved, its rewritten card reads "Approved by Liam, 09:41 · Open #231" (or "Open task"), so the thread's parent message points at the thing its replies talk about.

Note cards become threads as well: a founder's or member's note card is recorded in slack_suggestion_messages at post time, so a note approved in the dashboard (or in Slack) gets a thread the same way a call card does. A client's card is never recorded (section 2), so it never becomes a thread.

## 2. Who sees what

| Level | Thread lines | Digest |
|---|---|---|
| founder | Their copy of every call card (approver_type 'founders') gets lines for studio and client changes on the item. Their own note cards too. Never a line about their own change. | The studio digest (section 5). |
| member | Their own note cards only (approver_type 'member', approver_id their team member id), and only while their slack_identities level is still member or founder AND lib/access-scoping resolveAccessScoping for their Clerk user still reaches the item's CURRENT client (an item with no client needs some access, the requireAccessToOrgOrPreClient rule). Never a line about their own change. | A personal digest of their own notes waiting 24 hours or more, filtered by the same access rule. |
| client | Nothing in CN.3 (see question 1). Their card is never recorded as a copy, so it is never a thread. It changes only when they press it (the client copy policy below). | Nothing. No Slack message to a client that a client did not trigger. |
| unknown | Nothing. | Nothing. |

### The client copy policy (decided at integration)

A client's Slack DM only ever shows text written for the client: their own words, their own request's number and current title, and fixed client wording. Never a studio-internal title, who snoozed something, an apply error, a Tweak link, a duplicate candidate, a suggested owner or a task.

How: client copies are never recorded in slack_suggestion_messages, anywhere.

- The card. lib/slack/dispatch-dm.ts posts a client's draft through blocks.ts clientDraftMessage: their client's name, the kind, the summary of their own ask, their words as the quote, and two buttons, Approve and Reject. No Tweak (not their page), no Tonight or This week (a snoozed card could never come back to them, below), no suggested owner, no duplicate line. It is not recorded.
- The press. lib/slack/dispatch-actions.ts sends a client's press down its own path. Approve (with force, section 6) and Reject only; Tonight, This week, attach and approve anyway answer the denial line and decide nothing; an Approve on a draft the studio has since re-pointed (its kind is no longer create_request, after a dashboard attach) answers the denial line too, because the card no longer says what the Approve would do. Nothing is recorded, nothing studio side is re-rendered, and the one Slack write is the card they pressed, rewritten in place by mirror.ts rewriteClientCard through blocks.ts clientDecidedMessage: "Approved by Tim, 09:41 · Open #231" (the link only to a request that reads back as not internal and at the row's own client), "Rejected by Tim, 09:41", or on a failed apply "Could not file this request just now. The studio can see it on their side." The name is only ever the client's own: a row the studio had already decided rewrites to "Approved, 09:41" or "Not filed, 09:41", and the reply is "That one was already decided."
- The fences. mirrorSuggestionDecision (the decided line, called by every decision on every surface), repostSuggestion (a snooze coming back) and rewriteSuggestionMessage (the duplicate answer and an attach) refuse a contact row before reading anything, and their row types require approverType so a caller cannot leave it out. work-sync reads only founders and member cards as threads, in its SQL and again in its audience check. The digest never addresses a client identity and names client drafts only as a count.

Why this one rather than recording client copies and rendering contact rows through a client-safe path everywhere: the smaller surface. With no client channel on the copies table, every reader of that table (today's four and any later one) is safe by construction; the other way needs a client path in the repost, the undecided rewrite, the decided line and the thread lines, and leaves a table that one careless future reader could leak through.

What it costs, on purpose: a studio decision on a client's draft (reject, snooze, approve from the dashboard) does not change the client's card, which keeps its buttons until the client presses one and is told it was already decided; and a client cannot snooze their own draft. Both come back naturally if client threads are built (question 1).

Tests: lib/slack/__tests__/client-dm-safety.test.ts runs the real press handler, mirror and renderers against a database with a client copy on file and checks every Slack call into the client's DM on every path (approve, failed approve, reject, refused snooze, second press, the decide hook, the repost, the undecided re-render); the work-sync and digest tests cover the thread lines and the digest.

"Never a line about their own change": the actor's team member id maps to slack_identities.team_member_id; a thread whose channel equals that identity's dm_channel_id is skipped. When the channel cannot be tied to anyone (dm_channel_id not cached) the line posts; erring toward a redundant line beats a silent one. The MCP service user maps to nobody, so a change made through Claude posts to both founders.

Content limits: a thread line carries names, labels, dates, the item title (only when renamed) and the link. Never a quote, a description, a message body or a transcript line. The digest carries the kind, the one-line summary (lib/suggestion-summary summariseProposal), the client name and an age. Never a quote.

## 3. Dedupe and rate limits

- Only real changes: a writer compares the value before and after and sends only fields that moved. A double-clicked PATCH writes the same value twice and the second sends nothing.
- Claim before post: every new line inserts a slack_work_posts row first (INSERT OR IGNORE on a unique dedupe_key: sha-256 over channel, thread, entity, actor key, the canonical change list, and the minute), confirms by re-reading the key that its own id won, then posts, then stores the reply's ts. A failed post deletes its claim. Two concurrent requests for the same change post once.
- Coalescing: the same actor changing the same item again within 10 minutes (COALESCE_WINDOW_MS) in the same thread does not post a second line; the previous line is rewritten in place (chat.update) with the merged changes, latest value per field, and the row's changes and updated_at are refreshed. Three quick edits read as one line.
- Per thread cap: at most 12 lines in any rolling 24 hours (THREAD_DAILY_CAP). The 12th slot is used for "More changes since then. The dashboard has the rest: Open #231" and the thread is then quiet until the window rolls.
- Per batch cap: one queued batch (a bulk edit) posts at most 20 lines (BATCH_POST_CAP); the rest are counted as skipped in the result.
- Slack's own limits (chat.postMessage about one a second per channel) are far above this volume; posts go out sequentially within a batch.
- Kill switch: settings key slack.workSync.enabled = 'false' stops all lines (absent means on). Read once per batch, only when the token is set.

## 4. When Slack is not configured

| Entry point | Without SLACK_BOT_TOKEN |
|---|---|
| Writers (task, request, bulk, portal) | workSyncArmed() is false: no before-read, no queue, no reads, no writes. Behaviour identical to today. |
| syncWorkChanges (engine) | Returns { posted: 0, reason: 'slack_not_configured' } before touching the database. |
| Digest cron | Returns { ran: false, reason: 'slack_not_configured' } with no reads or writes and logs the run as skipped. dry_run still computes and returns every message (reads only), which is how the digest is checked on production before Slack is set up. |
| Card rewrite link (slice D) | mirrorSuggestionDecision already returns 0 without a token; unchanged. |
| A client's card rewrite | rewriteClientCard returns false without a token, before any read. |
| Sender approvals (slice D) | Unreachable without Slack; no behaviour change. |
| Negative examples, GI.4 | Independent of Slack; live on deploy. |

No bell or email fallback for the digest: the studio home card and the Suggestions view already show the same queue, and a weekly bell duplicating them is noise.

## 5. The weekly digest (slice D)

When: Monday between 08:00 and 09:59 in Pacific/Auckland (STUDIO_TIME_ZONE), once per NZ ISO week per recipient. Cloudflare crons are UTC, so the target rides two existing Sunday slots, first in each list: '30 19 * * SUN' (08:30 Monday in NZDT, 07:30 in NZST, outside the window) and '0 20 * * SUN' (09:00 NZDT, already sent that week; 08:00 NZST, sends). Both cron strings already exist in wrangler.jsonc, so only schedule.ts changes. The first live run is Monday 28 September 2026 (NZDT started the day before); its week key is 2026-W40.

Who: every founder identity (slack_identities level founder whose team member still holds an active super_admin role) gets the studio digest; every member identity with at least one of their own notes pending for 24 hours or more gets the personal digest. Clients and unknown identities get nothing.

Content of the studio digest (one message, no approve buttons: the cards already exist and one approval surface per suggestion is enough):

- Header: "Monday digest · 14 suggestions waiting".
- By client: "Verandela 8 (oldest 12 days) · Elevate 4 · Studio 2" (approver_type founders, status pending; "Studio" for rows with no client).
- The five oldest waiting: "New request: Footer LinkedIn tag · Verandela · 12 days · Review" where Review links to /tasks?view=suggestions&focus=<id> (suggestionTweakUrl).
- Context lines, each only when non-zero: "3 snoozed, next back Fri 09:00"; "2 client drafts not confirmed by the client yet" (approver_type contact, pending); "2 approvals did not apply in the last 14 days" (status failed); "Last week: 9 approved, 4 rejected" (founders rows decided in the previous 7 days); "Your notes waiting: 2" with up to five of them.
- One button: "Open the inbox" linking to /tasks?view=suggestions.
- Silence when nothing is waiting, no own notes are waiting and nothing failed: a digest of zeros teaches people to ignore it.

The personal digest is the "Your notes waiting" part alone, with the same links.

Idempotency: a claim row in slack_digests (unique week_key plus slack_user_id) inserted before posting; a failed post deletes the claim so the second Sunday slot retries. force=1 bypasses the NZ window but never the weekly claim. dry_run=1 posts nothing, writes nothing and returns every recipient's text and blocks. Kill switch: settings key slack.digest.enabled = 'false'. The digest opens a DM with conversations.open when an identity has no cached dm_channel_id and stores the channel back on slack_identities when the column is null.

The day and hour are two constants (DIGEST_WEEKDAY, DIGEST_WINDOW_START_HOUR); moving the digest to Friday afternoon is a one-line change plus a slot.

## 6. Sender approvals (a CN.2 loose end, slice D)

Who may press a suggestion button in Slack, decided per row rather than per level:

- approver_type 'founders': a founder.
- approver_type 'member': that member (identity.teamMemberId equals approver_id, level member or founder), or any founder (the dashboard lets any admin decide any row; Slack stays in step).
- approver_type 'contact': that contact only (identity.level client, identity.contactId equals approver_id, identity.orgId equals the row's org_id).
- Everything else: the denial line.

A studio press also passes the dashboard's access scoping (guardSuggestion's rule): the presser's Clerk user is resolved through resolveAccessScoping, and a row at a client they cannot reach answers the denial line; a row with no client is open, a founder holding super_admin is unrestricted, and a lookup that fails is a refusal.

A contact's Approve is sent to the gate with force true: the client's DM IS the request (CN.2 section 4), the studio triages duplicates on its own side, and the duplicate answer must never be shown to a client because its match list includes the studio's internal task titles. A contact may press Approve and Reject only: attach, approve anyway, Tonight and This week get the denial line, and so does an Approve on a row whose kind is no longer create_request. A missing row answers "That suggestion is not there any more" to a studio person and the denial line to anyone else, so a client learns nothing about what exists. The decider id recorded is the team member id for studio people and the contact id for a client. A client's press is never recorded as a copy and rewrites only the pressed card, in client wording (section 2); the studio's decided line (mirror actorName) names team members only.

## 7. Rejections as negative examples (slice N)

What the suggester is shown: a REJECTED BEFORE block in the user message, after CONTACTS and before WRAP UP, so it sits inside the cached notes block and the second read reuses it at the cache price.

Which rows: status 'rejected' (never 'expired': a rebuild's expiry is not a person saying no), approver_type 'founders' (call suggestions; a member's rejected note is a private change of mind), decided in the last 120 days, from the SAME client (org_id equal to the transcript's org). Never another client's row: a title or quote from one client in another client's prompt could come back as a proposal on the wrong client, and a request title is client visible once approved. Most recent first, at most 8 after removing repeats (same folded summary), from a scan of 30.

A call with no client is shown NO rejections (built; the first draft said null matches null). A founders suggestion with no org is not studio housekeeping: scheduled calls always carry an org and Slack notes are never founders rows, so a null org means some client's discovery call whose client was never worked out, and the repair pass only mends pending rows. Matching null to null would put one unidentified client's rejected title and quote into another unidentified client's prompt, which is the cross-client leak this section forbids. loadRejectedExamples returns [] before any query when the org is null, and the pure selectRejectedExamples returns [] for a null or empty org whatever it is handed.

Which fields per example: decided date, kind, the one-line summary (summariseProposal, clipped to 140), the quote (clipped to 160) and, when present, the reject reason (clipped to 120). No description, no rationale, no confidence.

Budget: the block is capped at 2,000 characters (oldest examples dropped first), about 500 input tokens, about 0.15 cents a read at Sonnet 5 rates and a tenth of that on the second read.

The rule (added to SUGGESTER_SYSTEM_PROMPT as rule 8): "REJECTED BEFORE, when present, lists items a person already turned down for this client. Do not propose any of them again, reworded or not, and be slow to propose anything of the same shape. Only when this call clearly asks for the same thing again, in its own words, propose it and say so in the rationale."

Reject reasons: task_suggestions gains reject_reason (text, nullable, at most 200 characters after trimming). The decide route (body.reason, read on a reject only) and the MCP decide_task_suggestion (reason, forwarded on a reject only and only when it has words in it) accept an optional reason on a reject. A reject carrying a reason on a row that is already rejected records the reason and nothing else (changed false, reasonRecorded true, no Slack rewrite), which is what a one-tap reason row after Reject in the inbox would call (question 2). The decide response carries reasonRecorded on every answer (true only when this call stored a reason). Slack Reject stays one tap with no reason.

Where the examples reach the model: the scheduled sweep and the rebuild (both go through runSuggestionSweep). Notes from Slack (lib/slack/notes.ts) do not get them: a note is one person's direct ask, not a call being read for everything said.

## 8. GI.4 learns from applied suggestions (slice G)

The request wizard's client memory gains a FROM RECENT CALLS block, after CLIENT HISTORY, built from applied suggestions for the org in the last 180 days, most recent first, at most 8, capped at 1,400 characters.

Two audiences, because the portal wizard talks to the client:

- client (the portal wizard, and the default): only rows read off a call (source_kind 'call', in the query and again in the pure selector; built at integration, because every client line says "from the call" and a request filed from somebody's Slack DM was never agreed on one), and of those only create_request, update_request and hand_off_request rows whose applied request belongs to this org, is not internal and is not archived. Each line names the request by its number and CURRENT title (what the client sees in the portal) and the call date: "#231 Footer LinkedIn tag, filed from the call on 2026-09-18" (updated: "updated after the call on ..."; hand-off: "waiting on you since the call on ..."). No quotes, no tasks, no request notes (those are internal thread lines).
- studio (the admin wizard): every applied kind, with the task or request title, the kind in words, the call date and the quote clipped to 120. A row filed from a Slack note is kept (it is still agreed and filed) and marked fromNote, so its line reads "(new request, Slack note)" rather than claiming a call.

The call date is call_transcripts.received_at through the row's transcript_id (date only), or omitted.

The rule, appended to CLIENT_HISTORY_PROMPT_RULES (both wizards read it): "If FROM RECENT CALLS lists something that matches what is being asked, it was already agreed on a call and filed: name it by its number and do not draft it again. If the ask adds to it, draft only the addition."

Only applied rows count: a pending suggestion is not agreed yet, and a rejected one is the suggester's lesson (section 7), not the wizard's. The existing CLIENT ON FILE block already lists recent request titles org wide in the portal wizard; this block follows the same org-wide rule and adds nothing more sensitive than what the portal request list shows.

## 9. Migration 0111 (slice N writes it; the lead applies it on tahi-db BEFORE the push)

Runner entry '0111' in app/api/admin/db/migrate/route.ts after '0110', mirrored in drizzle/migrations/0111_cn3_sync.sql, Drizzle entries in db/schema.ts:

```
ALTER TABLE task_suggestions ADD COLUMN reject_reason text;
CREATE INDEX IF NOT EXISTS idx_task_suggestions_applied_task ON task_suggestions(applied_task_id);
CREATE INDEX IF NOT EXISTS idx_task_suggestions_applied_request ON task_suggestions(applied_request_id);
CREATE INDEX IF NOT EXISTS idx_task_suggestions_org_status ON task_suggestions(org_id, status, decided_at);

CREATE TABLE IF NOT EXISTS slack_work_posts (
  id text PRIMARY KEY,
  dedupe_key text NOT NULL,
  entity_type text NOT NULL,        -- 'task' | 'request'
  entity_id text NOT NULL,
  suggestion_id text NOT NULL,      -- the card the thread hangs off
  channel_id text NOT NULL,
  thread_ts text NOT NULL,
  ts text,                          -- the posted reply; null while claimed
  actor_key text NOT NULL,          -- 'tm:<teamMemberId>' | 'contact:<contactId>' | 'acting:<teamMemberId>:<contactId>' | 'acting:<teamMemberId>' | 'service' | 'unknown' | 'cap'
  changes text NOT NULL,            -- JSON array of { field, from, to, phrase }
  posted_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_work_posts_dedupe ON slack_work_posts(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_slack_work_posts_thread ON slack_work_posts(channel_id, thread_ts, posted_at);

CREATE TABLE IF NOT EXISTS slack_digests (
  id text PRIMARY KEY,
  week_key text NOT NULL,           -- '2026-W40', the NZ ISO week
  slack_user_id text NOT NULL,
  channel_id text,
  ts text,
  summary text,                     -- JSON counts
  created_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_digests_week_user ON slack_digests(week_key, slack_user_id);
```

The two acting keys are the studio standing in a client's seat ("Liam as Tim"), kept apart from the client's own 'contact:' key so the two never coalesce into one line under one name; the second is the acting case whose contact could not be resolved.

Additive. The ALTER is re-run safe through the runner's duplicate-column catch (the 0109 precedent). Apply BEFORE deploying: once db/schema.ts carries reject_reason, every full-row select of task_suggestions names the column. No sweep job for the two new tables: at this volume they stay small for years; revisit past 10,000 rows.

## 10. MCP and the guide (slice D)

- cron_suggestion_digest: POST /api/admin/cron/suggestion-digest with dry_run and force in the query, each sent only when the argument is literally true.
- decide_task_suggestion gains reason (forwarded only on a reject, only a non-empty string); the answer carries reasonRecorded.
- The sync lines and the GI.4 block are side effects of existing capabilities; no new tools. The tools whose routes queue a line are listed in section 1.
- lib/dashboard-guide.ts: what posts to Slack threads and when, the Monday digest, what a client's own card shows and that it only changes when they press it, that rejections teach the suggester and applied suggestions teach the request wizard, and the two tool changes.

## 11. Slices and file ownership (disjoint)

| Slice | Model | Owns |
|---|---|---|
| S, dashboard changes into Slack threads | opus | lib/slack/work-sync.ts (new), lib/slack/__tests__/work-sync.test.ts (new), lib/task-writes.ts, lib/request-writes.ts, app/api/admin/tasks/[id]/route.ts, app/api/admin/tasks/bulk/route.ts, app/api/admin/requests/[id]/route.ts, app/api/admin/requests/bulk/route.ts, app/api/portal/requests/[id]/route.ts, app/api/portal/requests/[id]/review/route.ts, app/api/portal/requests/[id]/handback/route.ts, lib/slack/dispatch-dm.ts, lib/slack/__tests__/dispatch-dm.test.ts, lib/__tests__/task-writes.test.ts, and any other existing test that exercises those source files and is not listed for another slice |
| N, rejections as negative examples, reject reasons, migration 0111 | opus | app/api/admin/db/migrate/route.ts, drizzle/migrations/0111_cn3_sync.sql (new), db/schema.ts, lib/task-suggestions.ts, lib/task-suggester.ts, app/api/admin/task-suggestions/[id]/decide/route.ts, lib/task-suggester.test.ts, lib/__tests__/task-suggestions.test.ts, lib/__tests__/task-suggestions-slack-hook.test.ts, lib/__tests__/sweep-slack-delivery.test.ts, app/api/admin/task-suggestions/__tests__/task-suggestions-routes.test.ts |
| G, GI.4 learns from applied suggestions | sonnet | lib/ai-request-org-context.ts, lib/ai-request-org-context.test.ts, app/api/admin/ai/request-wizard/route.ts, app/api/portal/ai/request-wizard/route.ts, app/api/__tests__/ai-request-wizard-routes.test.ts |
| D, the digest, sender approvals, decided-card link, MCP and guide | opus | lib/slack/digest.ts (new), lib/slack/__tests__/digest.test.ts (new), app/api/admin/cron/suggestion-digest/route.ts (new), app/api/__tests__/cron-suggestion-digest.test.ts (new), workers/cron-trigger/src/schedule.ts, app/api/__tests__/cron-trigger-schedule.test.ts, app/api/admin/crons/route.ts, app/api/__tests__/admin-crons-list.test.ts, lib/slack/dispatch-actions.ts, lib/slack/mirror.ts, lib/slack/blocks.ts, lib/__tests__/slack-dispatch-actions.test.ts, lib/__tests__/slack-mirror.test.ts, lib/__tests__/slack-blocks.test.ts, workers/mcp-server/src/index.ts, workers/mcp-server/src/task-suggestion-tools.ts, app/api/__tests__/mcp-task-suggestion-tool-parity.test.ts, lib/dashboard-guide.ts |

S's writer changes must be invisible while SLACK_BOT_TOKEN is unset (the test environment), so no existing writer or route test should need more than a mock of lib/slack/work-sync; if one does, S edits it unless it is on another slice's list, in which case S reports it instead.

At integration the lead also edited across these lines: lib/slack/mirror.ts, blocks.ts, dispatch-actions.ts, dispatch-dm.ts and work-sync.ts (the client copy policy, section 2, and the 'promoted' field), the decide route (reasonRecorded), db/schema.ts and the 0111 SQL file (the actor_key comment only), lib/ai-request-org-context.ts (call-sourced rows for the client), the middleware comment, the bulk-assign, handoff DELETE and promote routes (section 1), the guide and the decide_task_suggestion description.

Shared pieces and who owns them: the database shape (section 9) is slice N's; S and D code against the column names above with raw SQL. The work-sync API is S's alone (every caller is in S). The existing exports of lib/slack/blocks.ts and lib/slack/mirror.ts (escapeSlackText, suggestionTweakUrl, studioClock, studioWhen, recordSuggestionMessage and the rest) keep their names and signatures: D extends them, S only imports them. Nobody but N edits lib/task-suggestions.ts; the call to mirrorSuggestionDecision inside decideSuggestion stays exactly as it is (it already hands over a row carrying kind, applied_task_id and applied_request_id, which D's link reads). Nobody but S edits lib/request-writes.ts and lib/task-writes.ts, and S keeps their exported signatures unchanged, because lib/task-suggestions.ts calls them.

## 11b. Signatures

Slice S, lib/slack/work-sync.ts (callers are all inside S):

```ts
export type WorkEntityType = 'task' | 'request'
// 'promoted' (added at integration): a task turned into a client request; to is "#232", or null
export type WorkField = 'status' | 'assignee' | 'dueDate' | 'priority' | 'title' | 'promoted' | 'waitingOn' | 'deleted'
export interface WorkFieldChange {
  field: WorkField
  from?: string | null        // undefined when the caller did not read it
  to: string | null           // assignee: a team member id; waitingOn: the contact's name
  phrase?: string             // caller-written verb phrase that replaces the default ("approved the delivery")
}
export type WorkActor =
  | { type: 'studio'; clerkUserId: string | null }   // SERVICE_USER_ID renders as "Claude"
  | { type: 'client'; contactId: string | null; clerkUserId: string | null; actingAsTeamMemberId?: string | null }
  | { type: 'system' }
export interface WorkChange { entityType: WorkEntityType; entityId: string; actor: WorkActor; changes: WorkFieldChange[]; at?: string }
export interface WorkSyncResult { posted: number; rewritten: number; skipped: number; reason?: 'slack_not_configured' | 'disabled' | 'nothing_to_sync' }
export const THREAD_HORIZON_DAYS = 120
export const COALESCE_WINDOW_MS = 600_000
export const THREAD_DAILY_CAP = 12
export const BATCH_POST_CAP = 20
export const WORK_SYNC_SETTING_KEY = 'slack.workSync.enabled'
export function workSyncArmed(): boolean
export function diffWorkFields(before: Partial<Record<WorkField, string | null>>, after: Partial<Record<WorkField, string | null>>): WorkFieldChange[]
export function renderWorkLine(input: WorkLineInput): string
export async function queueWorkSync(drizzle: Drizzle, changes: readonly WorkChange[]): Promise<void>   // never throws; defers through deferSlackWork
export async function syncWorkChanges(drizzle: Drizzle, changes: readonly WorkChange[], deps?: WorkSyncDeps): Promise<WorkSyncResult>   // never throws
```

Slice N, lib/task-suggestions.ts and lib/task-suggester.ts:

```ts
// task-suggestions.ts
export type DecisionInput =
  | { action: 'approve'; proposalOverride?: unknown; force?: boolean }
  | { action: 'reject'; reason?: string | null }
  | { action: 'snooze'; until: string }
  | { action: 'attach'; target: AttachTarget }
export const MAX_REJECT_REASON_CHARS = 200
export function normaliseRejectReason(raw: unknown): string | null
// SuggestionRow gains rejectReason: string | null; DecisionResult gains reasonRecorded?: boolean

// task-suggester.ts
export interface RejectedExample { kind: string; summary: string; quote: string; reason: string | null; decidedOn: string }
// SuggestionContext gains rejected?: RejectedExample[]
export const REJECTED_EXAMPLE_LIMIT = 8
export const REJECTED_WINDOW_DAYS = 120
export const REJECTED_BLOCK_MAX_CHARS = 2000
export const REJECTED_SCAN_LIMIT = 30
export function selectRejectedExamples(rows: readonly RejectedSuggestionRow[], orgId: string | null, at: Date): RejectedExample[]   // [] for a null org
export async function loadRejectedExamples(database: Drizzle, orgId: string | null, at: Date): Promise<RejectedExample[]>   // [] for a null org, before any query
export function formatRejectedBlock(examples: readonly RejectedExample[]): string
```

Decide route body: `{ action: 'reject', reason?: string }`; reason is ignored on every other action. The response adds `reasonRecorded: boolean` beside suggestion, changed, appliedTaskId, appliedRequestId, error and similar.

Slice G, lib/ai-request-org-context.ts:

```ts
export type OrgContextAudience = 'client' | 'studio'
// fromNote (added at integration): studio audience only, a row filed from a Slack note
export interface CallAgreement { kind: string; requestNumber: number | null; title: string; callDate: string | null; appliedOn: string; quote: string | null; fromNote?: true }
// CallAgreementRow (the loader's joined row) carries sourceKind: 'call' | 'note' | null
export function selectCallAgreements(rows: readonly CallAgreementRow[], orgId: string, audience: OrgContextAudience): CallAgreement[]
export const CALL_AGREEMENT_LIMIT = 8
export const CALL_AGREEMENT_WINDOW_DAYS = 180
export const CALL_BLOCK_MAX_CHARS = 1400
export function formatCallAgreements(items: readonly CallAgreement[], audience: OrgContextAudience): string
export async function loadCallAgreements(drizzle: Drizzle, orgId: string, audience: OrgContextAudience, at?: Date): Promise<CallAgreement[]>
export async function loadRequestOrgContext(drizzle: Drizzle, orgId: string, options?: { audience?: OrgContextAudience }): Promise<string>   // default audience 'client'
```

Slice D, lib/slack/digest.ts and lib/slack/dispatch-actions.ts:

```ts
// digest.ts
export const DIGEST_WEEKDAY = 1              // Monday, NZ
export const DIGEST_WINDOW_START_HOUR = 8     // inclusive, NZ
export const DIGEST_WINDOW_END_HOUR = 10      // exclusive, NZ
export const DIGEST_ITEM_LIMIT = 5
export const DIGEST_MEMBER_MIN_AGE_HOURS = 24
export function nzDigestSlot(at: Date): { inWindow: boolean; weekKey: string; localDate: string }
export async function runSuggestionDigest(database: Drizzle, options?: { at?: Date; force?: boolean; dryRun?: boolean; deps?: DigestDeps }): Promise<DigestRunSummary>

// dispatch-actions.ts
export function canDecideSuggestion(
  identity: Pick<SlackIdentity, 'level' | 'teamMemberId' | 'contactId' | 'orgId'> | null,
  row: { approverType: string; approverId: string | null; orgId: string | null },
): boolean
```

The digest route is POST /api/admin/cron/suggestion-digest, query force=1 and dry_run=1. Built without withCronRun, which logs every run as success: the route checks the cron secret or an admin session through assertCronAuth and logs its own cron_runs row through logCronRun, 'success' for a run that reached the recipients, 'skipped' (with the reason in the summary) for one that stopped early (slack_not_configured, disabled, outside_window), 'error' for a throw; a dry run writes no cron_runs row at all, because its summary carries every recipient's message. middleware.ts lists it in isPublicRoute, because workers/cron-trigger sends only x-cron-secret.

The client copy policy (section 2), added at integration:

```ts
// blocks.ts
export interface ClientDraftInput { id: string; kind: string; proposal: unknown; quote: string; orgName?: string | null }
export function clientDraftMessage(input: ClientDraftInput): SlackMessagePayload   // Approve and Reject only
export interface ClientDecidedInput { outcome: SuggestionOutcome; ownName: string | null; at: string | null; link?: { url: string; label: string } | null }
export const CLIENT_CARD_FAILED_LINE: string
export function clientDecidedLine(input: ClientDecidedInput): string | null        // null for snoozed and expired
export function clientDecidedMessage(input: ClientDecidedInput): SlackMessagePayload | null

// mirror.ts
export async function rewriteClientCard(
  drizzle: Drizzle,
  card: { channelId: string | null; ts: string | null },   // the pressed message, from the press payload
  row: DecidedSuggestionRow,                              // contact rows only; never recorded; never throws
): Promise<boolean>
// DecidedSuggestionRow.approverType is REQUIRED (it is the fence), and gains approverId? and orgId?
export async function rewriteSuggestionMessage(drizzle: Drizzle, row: SuggestionMessageInput & { approverType: string }, options?: { duplicate?: boolean }): Promise<number>   // 0 for a contact row
export async function repostSuggestion(drizzle: Drizzle, row: SuggestionMessageInput & { approverType: string }): Promise<number>   // 0 for a contact row
// mirrorSuggestionDecision(drizzle, row) returns 0 for a contact row, before any read
```

## 12. Merge order and the lead's work

1. Merge N first (it carries the migration and the schema), then G, S and D in any order. S and D keep their raw SQL after the merge (the mirror.ts precedent). Done on cn3-integration in the order N, S, G, D, with no conflicts; the integration commits on top carry the client copy policy and the review follow-ups.
2. Apply 0111 on tahi-db before the push (run_migration or POST /api/admin/db/migrate as Liam), then push; the dashboard deploy and the cron-trigger deploy both run from the push.
3. Live checks available without Slack: cron_suggestion_digest with dry_run true as Liam shows the Monday message for each founder; the Monday cron_runs row reads skipped slack_not_configured; the admin wizard for Verandela answers "what did we agree on the last call" from #228 to #235; the portal wizard as the dummy client shows no task titles and no quotes; decide_task_suggestion reject with a reason stores it; the next sweep's ai_cost_log rows show the slightly larger input on clients with rejections. 375px and dark are unaffected (no UI in CN.3).
4. Once Liam has set the Slack secrets: approve a call card in Slack; change that request's status through Claude (MCP) and see one line in both founders' threads; change it again within ten minutes and see the same line rewritten; change it as Staci in the dashboard and see the line in Liam's thread and not in Staci's; promote a task that came from a card and see "turned it into request #N"; hand a request to a contact and take it back and see both lines; have a member press Approve on their own note card; run the digest with force true. The client card, with the dummy client only (no real client until Liam says so): DM the bot as the dummy client and see a card with Approve and Reject and nothing else; press Approve and see only that card become "Approved by <name>, HH:MM · Open #N"; have a founder reject another of the dummy client's drafts in the dashboard and see nothing change in the dummy client's DM.
5. TASKS.md and STATUS.md updates, and the AGENTS.md mirror of any new working rule, are the lead's.

## 13. Out of scope, and later

- Client thread lines (question 1), reject reason chips in the inbox (question 2), comments into Slack (question 3).
- A studio decision on a client's draft reaching the client's card, and a client snoozing their own draft. Both need a recorded client copy and a client-safe rewrite on every path (section 2 says why CN.3 does neither); both belong with client threads.
- Sub-requests and nesting in the thread (section 1).
- Lines on pending suggestions whose target changed ("this task was marked done on the dashboard" under an unapproved complete_task card): useful, but it doubles the thread rules; a follow-up once S is live.
- Keeping the model's original proposal when Tweak changes it, as a second learning signal (today the override replaces it).
- Replies typed into a card thread in Slack still reach the note path (CN.2 behaviour); a thread reply of "thanks" gets the "could not find anything to file" line. Worth a follow-up to ignore short replies inside card threads.
- PM.2 person DMs and nudges.

## 14. Questions for Liam

Decided 2026-09-26: the three recommendations stand. Client threads in Slack are not built in CN.3; reject reasons ship server side only and the inbox chip row is a later FE item; dashboard comments do not post to Slack.

1. Client threads: when a client confirms their own request in the Slack DM ("Is this the request?"), should the studio's later moves on that request reply in that thread in the portal's wording (started, ready for your review, delivered)? Recommendation: yes eventually, but off until client messaging is verified, the same rule as client emails; CN.3 does not build it (about half a day later).
2. Reject reasons in the inbox: after Reject on /tasks, show one optional row of one-tap reasons (Not said on the call, Already have it, Wrong kind, Not worth doing, Wrong client) that the suggester then reads? The server side ships in CN.3 either way and works from Claude now. Recommendation: yes, optional and skippable, dashboard only; Slack Reject stays one tap.
3. Comments: should a comment written on a task or request thread in the dashboard also post into the Slack thread? Recommendation: no, because a reply typed in Slack would not come back, so the conversation would split in two; CN.3 posts state changes only.
