# CN.2 build contract: the Tahi Slack app, DM first, with permission levels (2026-09-22)

Liam: "the slack bot should act in the agents and apps part, so they are direct to the user. Public things to a public channel team wide, founders only messages later. Mainly I want the slack app individual now so clients have a private 1:1 with the bot, same with team members, same with me and Staci. Different permission levels." Also: "task suggestions should have an assignee suggestion too."

Extends the live CN.1 family (docs/superpowers/plans/2026-09-19-cn1-build-contract.md, cn1b, cn1d). Everything the bot does goes through the same gate and the same writes the dashboard uses: lib/task-suggestions.ts (decideSuggestion, applySuggestion, insertSuggestions), lib/task-suggester.ts (suggestFromTranscript, buildSuggestionContext), lib/task-writes.ts, lib/request-writes.ts, lib/task-comments.ts (Tahi bot lines). The bot never writes a task or request directly.

## 1. Identity and permission levels (slice S1)

Migration 0110_slack_identities.sql plus runner entry after 0109:

```
slack_identities
  id text pk
  slack_team_id text not null
  slack_user_id text not null
  email text null
  level text not null            -- 'founder' | 'member' | 'client' | 'unknown'
  team_member_id text null
  contact_id text null
  org_id text null               -- the client's org for level client
  dm_channel_id text null        -- the app's DM channel with this user, cached
  last_seen_at text null
  created_at text not null
  updated_at text not null
unique (slack_team_id, slack_user_id); index on email
```

lib/slack/identity.ts: `resolveSlackIdentity(database, { teamId, userId, fetchProfile })` looks the row up, or calls users.info for the email and maps it: an email on team_members with the super_admin role (Liam, Staci, see lib/feature-tree.ts or the team access resolver) is founder; any other team member is member; a contacts row is client with its org; otherwise unknown. Cached in the table, refreshed when older than 7 days. `can(identity, action)` with actions: decide_call_suggestions (founder), create_task (founder, member), create_request_own_org (client), create_request_any_org (founder, member), read_own_work (member, client, founder), read_studio_numbers (founder). Every route and every handler calls can() before acting; a denied action answers with one plain sentence and never leaks what exists.

## 2. Inbound plumbing (slice S1)

- lib/slack/verify.ts: Slack signature verification (v0 HMAC SHA-256 over `v0:${timestamp}:${rawBody}` with SLACK_SIGNING_SECRET, timestamp within 5 minutes, constant-time compare, Web Crypto only).
- app/api/webhooks/slack/events/route.ts: url_verification challenge; event_callback for message.im (DMs), app_mention, file_shared (audio in a DM). Acknowledge 200 within 3 seconds: verify, dedupe on event_id in a small slack_events_seen table (id, seen_at; migration 0110 too), enqueue the work with waitUntil through getCloudflareContext().ctx, return. Ignore bot messages and message subtypes other than file_share.
- app/api/webhooks/slack/interactive/route.ts: block_actions and view_submission. Same ack pattern; the payload is form-encoded JSON in `payload`.
- lib/slack/api.ts: postMessage, updateMessage, openDm (conversations.open), usersInfo, filesInfo and a download with the bot token, viewsOpen. Typed, no any, errors surfaced as thrown Errors with the Slack error string.
- Secrets: SLACK_BOT_TOKEN (exists), SLACK_SIGNING_SECRET (new), documented in the manifest doc. lib/slack-notify.ts keeps working unchanged.
- Tests: signature accept and reject (bad secret, stale timestamp), challenge echo, dedupe, identity mapping for each level, can() matrix.

## 3. Approvals in a DM (slice S2)

- lib/slack/blocks.ts: `suggestionMessage(suggestion)` renders one Block Kit message: header line with the client and the call, the kind chip in words (New request, Update request, Hand off, New task, Note), the proposal summary (reuse the pure summariser in app/(dashboard)/tasks/suggestions-logic.ts by moving its pure parts into lib/suggestion-summary.ts so both sides share it), the quote as a quote block, the suggested assignee line, and buttons: Approve, Tweak (link to /tasks?view=suggestions&focus=<id>), Tonight, This week, Reject. Action ids `sugg:<action>:<id>`. A decided message rewrites in place to a single line "Approved by Liam, 09:41" (or Rejected, Snoozed until) with no buttons.
- Delivery: when the sweep inserts suggestions for a call (lib/task-suggester.ts runSuggestionSweep) it posts each founder identity a DM per call: one header message then one message per suggestion, and stores slack_channel_id and slack_message_ts on the row (both founders get their own copy; the row keeps the first, and lib/slack/mirror.ts keeps a small slack_suggestion_messages table (suggestion_id, channel_id, ts) so every copy can be rewritten; migration 0110). Posting failures never fail the sweep.
- Decision sync: decideSuggestion (any surface) calls a hook that rewrites every Slack copy; the interactive route calls decideSuggestion with via 'slack' and the founder's team_member_id. The possible_duplicate answer from CN.1d renders as "Looks like #226 Design directions" with Use #226 instead and Approve anyway in the same message.
- Snooze re-post: the existing resurfaceSnoozed step re-posts a resurfaced row to the same DMs.
- Tests: block rendering per kind, action id parsing, the interactive route mapping a click to decideSuggestion with the right actor, the rewrite after a dashboard decision, the mirror table.

## 4. Notes in, and voice (slice S3)

- A DM from a founder or member that is not a button click becomes a note: lib/slack/notes.ts `draftFromNote({ text, identity })` calls the suggester with the note as the transcript, `sourceKind 'note'`, the sender as approver (approver_type 'member', approver_id the team member), org resolved when the text names a client from the roster exactly (resolveByName rule, never a guess); the bot replies "Here's what I understood" with the same suggestion message from section 3 so the sender approves their own. A client's DM becomes a create_request draft on their own org with them as requester, the reply "Is this the request?", and approval lands it as a normal request through the gate (approver_type 'contact').
- Voice: a file_shared audio in the DM is downloaded with the bot token and transcribed with Workers AI `@cf/openai/whisper` through an `AI` binding added to wrangler.json (both envs); the text then follows the note path with the transcript stored on the suggestion's quote. If the binding is missing the bot says voice notes are not enabled yet.
- Guard rails: one note yields at most 3 suggestions; anything without a usable quote (the note text itself is the source) is dropped; the reply to an unknown user is the single sentence from section 1.
- Tests: note to draft with the right approver and org, the client path, the voice path with a mocked binding, the unknown user line.

## 5. Assignee suggestions (slice A1)

- Proposal shapes gain `suggestedAssigneeName`, `suggestedAssigneeId` (resolved exactly or null) and `assigneeReason` (one sentence: who said they would do it on the call, or "owns this client's work" from the request's or track's current assignee) on create_task, create_request and update_request. The prompt asks for it; the context already carries members and, for requests, the current assignee per open request (add it).
- The inbox row shows "Suggested: Staci, said she would send the headers" with a picker; Tweak keeps it; approve passes assigneeId into createTaskRecord and createRequestRecord (requests have assigneeId in PATCH already; add it to create if missing). Slack blocks show the same line.
- Tests: prompt mentions the field; resolution exact or null; the row renders the line; approve carries the id.

## 6. Manifest and setup (the lead writes, Liam applies)

docs/superpowers/plans/2026-09-22-slack-app-manifest.md: the app manifest JSON (name Tahi, bot user, App Home with the messages tab on, scopes chat:write, im:history, im:read, im:write, users:read, users:read.email, files:read, app_mentions:read, channels:history for later; events message.im, app_mention, file_shared; interactivity URL and events URL on portal.tahi.studio) and the two secrets to set.

## 6b. Agent mode (the existing app has assistant:write)

The app runs in Agents and Apps mode, so the 1:1 is the assistant pane, not a plain DM. S1's events route also accepts assistant_thread_started (reply with a welcome line for the identity level and set suggested prompts through assistant.threads.setSuggestedPrompts) and assistant_thread_context_changed (ignore, ack). While a note or voice file is being read, set assistant.threads.setStatus "Reading your note" and clear it when the draft posts. lib/slack/api.ts gains setStatus and setSuggestedPrompts. The lead adds this at merge if the slices did not see it.

## 7. Out of this phase

Channels (team wide and founders only), the PM nudges (PM.2), distributing the app to client workspaces (Slack Connect guests in the Tahi workspace for now), and anything the bot could do without a human pressing a button.
