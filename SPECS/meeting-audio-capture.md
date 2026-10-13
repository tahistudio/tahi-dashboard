# Spec: meeting audio capture and transcription

## Phase 1, manual browser recorder (2026-10-13)

Liam authorised a manual recorder inside the studio dashboard on Windows
Chromium (Vivaldi, Chrome or Edge). This phase supersedes the companion and
calendar feasibility scope below. No calendar detection, desktop application
or meeting bot is included.

The browser asks for Entire screen with Share system audio and for microphone
permission. Video is discarded immediately. Separate MediaRecorder instances
for microphone (Liam) and system audio (Them) rotate about every 30 seconds,
so each file has a complete container header. Missing system audio requires
an explicit mic-only choice or retry. Meters, elapsed time, a visible indicator,
Stop and a beforeunload warning accompany capture.

Chunks are saved locally before upload and keyed in R2 by recording, track
and sequence. Additive migration 0113 supplies durable recording/chunk state,
unique sequences, retry text/segments and operation leases. Apply 0113 BEFORE
deployment: the suggestion sweep, rebuild, client delete/merge and ManyRequests
cleanup read meeting_recordings. The main session will apply it to production
before merging. The existing
call_transcripts columns hold one finished manual transcript. Client/call
selection is explicit. A client-only recording remains unlinked to a call,
inherits its recording's client scope and is eligible for task_suggestions.
An entirely unlinked transcript waits for a human choice. Only the existing
approve/apply path creates work.

Model and current price are recorded in Decision #071. Audio is retained until
the admin deletes the recording audio; the transcript and client-scope
tombstone remain. Read/list/link MCP actions accompany the browser capture.
Designer reads are allowed; recording linking is blocked for that profile.

Phase 1 review notes:

- P2-2: The browser tab drives transcription. Closing it stops processing until
  Retry is clicked. This is acceptable for phase 1; a queue or cron comes later.
- P2-3: Suggestions from a client-only recording (no callId) reach the dashboard
  inbox and do not send Slack DMs.
- P3-3: The microphone speaker label is hard-coded as "Liam".
- P3-4: Unlinked recordings are visible to any scoped seat, following the
  existing allow-if-any-scope rule. Revisit before the first scoped hire.
- P3-6: Abandoned recordings keep their R2 audio under the open retention
  question.

This review-fix session performs no push, deploy, production migration or
secret change. Windows system-audio capture, call accuracy, background/device behaviour
and the signed-in responsive/dark round trip must be proven before release.

## Earlier future scope

Status: scoped for a feasibility spike, not implemented. REC.0 owns this work;
LP.12 adds per-meeting controls after the capture path exists. Decision #068
is the product boundary. The research is recorded in
docs/superpowers/plans/2026-10-09-loopsii-qa-recording-ideas.md.

## What it is

A Windows companion to the dashboard detects meetings from Liam's calendar,
captures PC system audio and microphone, and produces an accurate transcript
at very low ongoing cost. Google Meet, Teams and Zoom must work, including
their desktop applications. The transcript is the main result.

## User stories

- As Liam, I want an upcoming calendar meeting to appear with its client and
  join link, so I do not have to create a separate recording entry.
- As Liam, I want to capture everyone I hear plus my own microphone, so the
  transcript includes both sides of the conversation.
- As Liam, I want to start an audio recording directly when there is no
  calendar event, then attach it to the right client or call.
- As Liam, I want to correct a transcript and review proposed requests/tasks
  through the existing approval gate.

## Scope

The first deliverable is an evaluated audio capture and transcription spike,
followed by an implementation recommendation. It must demonstrate:

1. Calendar detection using the existing Google calendar connection and call
   matching where possible. Distinguish detected, upcoming, recording,
   transcribing, ready and failed. A missing calendar read is an error, not
   proof there are no meetings.
2. Windows PC audio plus microphone capture on representative Meet, Teams and
   Zoom calls. Test headphones, device changes, muted microphones, overlapping
   speakers and stopping/restarting capture. Show a clear recording indicator
   and stop control. A device failure must not silently produce an empty call.
3. Manual start and stop for an unscheduled conversation. Keep unlinked
   transcripts available for deliberate client/call matching.
4. Accurate transcription with useful paragraphs and timestamps. Evaluate
   speaker labels rather than promising them before measurement. Keep the
   original transcript separate from any generated summary.
5. Recovery after a transcription failure without recording the meeting again.
   Retries must not create duplicate transcripts or suggestions.

## Evaluation and cost

Compare local transcription with inexpensive hosted candidates using the same
permitted sample audio. Include New Zealand speech, client and product names,
technical terms, two speakers and occasional overlap. Record word errors and
meaning-changing omissions, speaker mistakes, processing time, PC resource
use and recovery behaviour. A polished summary cannot compensate for missing
words in the transcript.

Report measured cost per recorded hour and an example monthly workload. Include
transcription, any separate speaker processing, retries, summary generation,
storage and transfer. For local processing, report download size, hardware
requirements, runtime and impact during a call. Very low cost is required, but
no spending ceiling or provider has been selected. Date and source any quoted
vendor rates when the spike is run.

## Integration and permissions

- Reuse call_transcripts, call matching and the unlinked transcript flow.
- Reuse task_suggestions and its human approve/tweak/snooze/reject path. Audio
  capture does not authorise automatic task or request edits.
- Keep capture and transcripts studio-only initially, with the same client
  scope and feature guards as calls. No public recording link.
- The native capture component needs its own implementation; the web dashboard
  alone is not the capture proof. No desktop framework or new schema selected.
- Recordings must keep client identity explicit and avoid attaching one
  client's conversation to another client by guesswork.

## Out of scope

Video, screen capture, Loom-style recordings, video sharing and a viewer for
clients. A bot joining the call is not the proposed capture workflow. Audio
upload may be a recovery/import path, but does not replace PC capture.

## Decisions still required before production capture

Local versus hosted transcription, desktop packaging, audio retention and
deletion, recording prompts versus automatic starts, and the permission/notice
flow for capture. The spike should recommend these from measured results.
Nothing in this spec schedules or starts a recording.

## Done criteria

The spike supplies reproducible audio/device results for all three meeting
platforms, accuracy and cost comparisons, failure/retry evidence and a concrete
implementation recommendation. A later build must pass the repository gates
and a signed-in Windows/dashboard round trip before REC.0 is marked complete.
