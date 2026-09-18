# Call notes to tasks, with an approval gate in the dashboard and Slack (scope, 2026-09-19)

Liam's ask: every call that gets transcribed (Google Meet notes, or a transcript that lands in an inbox) should turn into task suggestions: new tasks, updates to existing tasks, completions. Nothing applies until Liam approves it, in the dashboard or from a Slack message with buttons ("approve", "tonight", "this week", "tweak"). Approved updates post into the task's thread as "Tahi bot", not as Liam. The same Slack app is the door for typed or voice notes that become tasks (GI.1), and for clients it makes requests, never tasks.

## 1. What exists today (verified in the code)

- Transcripts: the Drive sync (app/api/admin/integrations/google/sync-drive-transcripts, cron every 30 minutes) reads "Notes by Gemini" docs, matches them to a discovery_calls row by time and attendees (a 20 point lead is required, otherwise it skips rather than guesses) and writes transcript, summary and outcome notes onto discovery_calls only. scheduled_calls (client kickoffs and check-ins) has no transcript columns at all.
- Extraction: POST /api/admin/discovery-calls/[id]/extract (MCP extract_call_insights) sends a transcript to Sonnet and returns suggestions plus action items (title, one line, suggested assignee), only for project-ish calls. Nothing reads the action items: no UI, no route, no task is ever created from them. This is the seed of the feature and it already refuses to invent work that was not said.
- Inbound email: app/api/webhooks/email-intake (shared secret, Resend or Cloudflare Email Worker payloads) turns a client email into a draft request or a lead. It knows nothing about transcripts.
- Slack: lib/slack-notify.ts posts with the bot token to one channel for three events. No Slack app manifest, no signing secret, no inbound route, no buttons.
- Approval patterns: the content pipeline gates a stage behind approve and reject routes; the AI wizards create synchronously with no draft table; the client review approve flow exists for requests. Notifications carry no action payload or decision state.
- Actors: messages.authorType is team_member or contact; every studio message is written as the signed-in human; audit_log already allows actorType system. Tasks have no thread: a task with a request can reach that request's thread, a task without one has nowhere to post.
- Task tooling: create_task, update_task, subtasks, bulk_update_tasks exist on the MCP; lib/task-wizard-drafts.ts only ever builds new tasks; discovery_calls.taskId links a call to at most one task.
- Voice: voice_notes attach to request messages only.

## 2. The shape

One table sits between "something was said" and "a task changed": **task_suggestions**. Every source feeds it, every approval surface reads it, and applying a suggestion is one server function. That is what makes Slack and the dashboard agree, makes "approve tonight" possible, and keeps the bot honest.

Flow: a transcript lands (Drive, inbox, Slack note, voice note) and is attached to a call or parked as unlinked notes. The suggester reads it with the client's open tasks and requests as context and writes suggestions, each with a verbatim quote. The dashboard inbox and a Slack message show the same rows. A decision (approve, tweak, snooze, reject) is recorded once, wherever it was made, and both surfaces update. Approve applies the change, posts a Tahi bot line into the task's thread with the quote and a link to the call, and writes an audit entry.

## 3. Data model

task_suggestions
- id, createdAt, decidedAt, appliedAt
- source: callKind (discovery or scheduled) and callId, or transcriptId, or slackMessageRef, or voiceNoteId
- kind: create_task, update_task, complete_task, add_subtasks, note (a thread comment only), create_request (client side, GI.1)
- targetTaskId (updates, completions, subtasks, notes), targetRequestId, orgId
- proposal (JSON): for create, the full task draft (title, description, type, orgId, requestId, assigneeId, dueDate, estimatedHours, subtasks); for update, the field diff; for note, the text
- quote (verbatim transcript lines the suggestion rests on), rationale (one sentence), confidence (0 to 1)
- status: pending, approved, applied, rejected, snoozed, expired; snoozeUntil; decidedById, decidedVia (dashboard or slack)
- dedupeKey (hash of source plus normalised title or target plus diff) with a unique index, so the same call never yields the suggestion twice and a double click cannot apply twice
- slackChannelId, slackMessageTs (so the Slack message can be updated in place when the dashboard decides)

call_transcripts
- id, callKind, callId (nullable while unlinked), source (gemini_drive, email, slack, manual), receivedAt, hash, text, summary, matchedBy, unlinkedReason
- Moves transcripts off discovery_calls so kickoffs and client check-ins carry them too; discovery_calls keeps its columns as a mirror for one release.

task_comments (the task thread)
- id, taskId, authorType (team_member, contact, bot), authorId, body, quote, sourceSuggestionId, createdAt
- A task with a requestId also mirrors the bot line into the request thread as an internal message, so the studio sees it where the work lives.

Tahi bot
- A fixed actor: authorType bot, display name "Tahi bot", its own avatar, never a real person. messages.authorType gains bot for the mirrored lines; audit_log uses actorType system with the suggestion id.

## 4. Phases and effort

Phase 0, foundations (about 3 days)
- call_transcripts plus a Drive sync that writes there for any call kind, and a transcript branch in the email intake: a dedicated inbox address, sender allowlist (the transcription service and the studio), match by subject, attendees and time, park as unlinked when no match; Liam attaches unlinked notes to a call from the calls page.
- Tahi bot actor, task_comments, the Task thread section on the task detail, the mirror into the request thread.

Phase 1, suggestions and the dashboard gate (about 4 days)
- The suggester: runs after a transcript lands (cron, minutes), builds context from the org's open tasks and requests (titles, status, assignee, due, last 60 days), asks Sonnet for suggestions with quotes, and writes task_suggestions. Rules: never apply; an update must name the existing task and quote why; a completion only when the call says it is done; anything without a quote is dropped.
- The inbox: a Suggestions view on /tasks and a card on the studio home ("6 suggestions from 2 calls"). Each row: the call and client, the proposal, the quote, and four actions: Approve, Tweak (opens the task dialog prefilled, saving approves), Snooze (tonight, this week), Reject. Bulk approve on a call. Keyboard y and n.
- Apply: one server function shared by the route and Slack; creates or updates through the same code the task routes use; posts the bot line; idempotent on status.
- MCP: list_task_suggestions, decide_task_suggestion, so the same gate works from a connector.

Phase 2, the Slack app (about 4 days)
- One Slack app "Tahi": the existing bot token, plus interactivity and events, a signing secret, and two new routes: app/api/webhooks/slack/interactive (buttons) and app/api/webhooks/slack/events (direct messages, mentions, audio files). Slack wants an answer within three seconds, so the routes acknowledge first and do the work after.
- Approval messages: one Block Kit message per call to Liam's direct messages (or a channel, see decisions): a header with the call, client and count, then each suggestion with Approve, Tweak (deep link), Tonight, This week, Reject, and an Approve all at the bottom. A click records the decision, applies it, and rewrites the message in place with who decided what; a dashboard decision rewrites the message too.
- Snooze: a cron re-posts snoozed suggestions at their time (tonight 7 pm NZ, this week Friday 9 am NZ, both settings).
- Notes in: a typed direct message becomes a create_task suggestion; an audio file becomes text through Whisper on Workers AI, then the same suggestion. Liam's own notes could skip the gate (see decisions).
- Clients (GI.1): a client's WhatsApp or Slack message becomes a create_request suggestion on their organisation with them as the contact; the studio approves from the same inbox. WhatsApp itself is a later adapter.

Phase 3, keeping in sync (later, about 3 days)
- Task changes made in the dashboard post to the Slack thread where the task was approved; a weekly digest of unreviewed suggestions; rejected suggestions become negative examples for the suggester; the per-client memory (GI.4) learns from applied suggestions.

Total for phases 0 to 2: about 11 days of build, in that order. Phase 1 already pays off without Slack: the inbox alone turns every transcribed call into reviewed tasks.

## 5. Decisions (Liam, 2026-09-19)

1. Slack destination: the #founders channel (Staci and Liam). Call suggestions go there; the first founder to click decides, and the message shows who decided.
2. Typed and voice notes work like the AI request wizard: the bot replies "Here's what I understood" with the draft, and the sender approves their own. Staci's notes go to Staci, not Liam. A client using the bot gets "Is this the request?" and approves their own draft, which then lands as a normal new request for the studio. So the approver of a note is its sender; the approver of a call suggestion is either founder.
3. Source: Gemini transcripts through Google Drive, which carry the full transcript and the wrap-up. The Gmail copy carries only the wrap-up and a link to the doc, so Drive stays the source and the inbox branch is dropped from Phase 0.
4. Task threads: as proposed, bot lines mirror into the request thread when the task has one, and use the task thread otherwise.
5. Snooze: kept, minimal (tonight, this week), low priority.

Consequence for the model: task_suggestions gains approverType and approverId (a founder pair for call suggestions, the sender for notes, the contact for a client's request draft), and the Slack layer routes each suggestion to its approver: #founders for calls, a direct message for a member's own note, the client's channel for a client's draft.

## 6. Risks and how the design handles them

- Wrong call matched: the matcher keeps the 20 point lead rule and parks anything else as unlinked notes for a human to attach; nothing is suggested from a guessed match.
- Invented work: every suggestion carries a verbatim quote or it is dropped; the prompt forbids inference; rejections feed back.
- Double apply: the unique dedupeKey and a guarded status transition (pending to applied once) cover a Slack click and a dashboard click on the same row.
- Client data in Slack: approval messages name the client and the task title only, never transcript text beyond the one quote, and go to a private destination.
- Slack timeouts: acknowledge in three seconds, then work; the message is updated afterwards.
- The August style gaps: the suggester runs on a cron with an idempotent per-transcript key, so a missed run catches up on the next.

## 7. Out of scope for now

WhatsApp transport (adapter after Slack), an inbox for Staci separate from Liam, auto-applying anything, transcribing audio recordings of calls (only notes and voice notes), and the client-facing advisor (GI.4 phase 2).
