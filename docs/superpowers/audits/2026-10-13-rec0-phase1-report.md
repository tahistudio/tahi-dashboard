# REC.0 phase 1, local implementation report

Prepared 2026-10-13. This is source prepared for review, not a live release.
The initial worktree was clean. Requested branch: feat/rec0-manual-recorder.
Creating it failed because the sandbox cannot write the parent repository's
shared .git/refs. Actual branch remains worktree-agent-af1035f88ebd4b3d9.
No commit SHA exists for this work. Base HEAD is
e57279902b8ae5f000dda2d181a6146aa576c9c0. No push, deployment, production
migration, production data write or secret change was performed.

The implementation adds /calls/record with separate mic and system audio,
explicit Entire screen guidance and mic-only fallback, meters, timer, Stop,
screen-share-ended handling and beforeunload protection. Each rotating
MediaRecorder writes a standalone WebM around every 30 seconds. Completed
chunks enter a per-user IndexedDB outbox before upload and remain until
acknowledged; failures have explicit recovery actions. Browser crashes can
lose the current incomplete segment. Offline completed segments remain local.
Chunks are limited to 2 MB; delayed background rotations may extend to three
minutes, after which the upload is refused visibly and retained locally.

Server reservations enforce unique recording/track/sequence keys. R2 writes
use If-None-Match:* through the existing STORAGE binding and guarded proxy
pattern. D1 operation leases and fenced writes prevent competing retries;
late uploads compensate after audio deletion. Transcription handles one chunk
per request, saves raw text/segments and retries unsuccessful chunks without
re-running successes. Final-save failure reuses all ready text. Finished
transcripts reuse call_transcripts with source manual, external_id
recording:<id>, one stable id, timestamps and Liam/Them labels. Partial
transcripts are excluded from suggestion selection and rebuilds.

Client/call selection is explicit. A client-only transcript stays unlinked to
a call and inherits its recording's client scope. The existing suggester can
propose work for it through task_suggestions; only human approval applies
work. A finished recording's selected client is immutable, preventing a
concurrent suggestion read against an old client. It can acquire a call link
for that client; an entirely unlinked recording can receive its first client.
Delete audio requires a current administrator and retains transcript/scope
metadata. Organisation cleanup refuses retained recordings; the existing
duplicate-organisation merge moves their scope with other client data.

MCP tools list_meeting_recordings, get_meeting_recording and
link_meeting_recording use current path-safety checks. Designer reads are
allowed; recording links remain blocked for that profile. Capture remains in
the browser. Existing transcript read/link tools remain usable.

Model choice: @cf/openai/whisper-large-v3-turbo, base64 input, timed segments,
English transcription, VAD, no previous-text conditioning. Price checked
2026-10-13: USD 0.000513/audio minute, USD 0.03078/track hour,
USD 0.06156/hour of a two-track call before retries, R2 and suggestions.
The general pricing table rounds to USD 0.0005/minute; Decision #071 records
the model-page price and neuron reconciliation. Sources:
[model](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/),
[pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/),
[input tutorial](https://developers.cloudflare.com/workers-ai/guides/tutorials/build-a-workers-ai-whisper-with-chunking/).

Migration 0113_meeting_recordings.sql adds meeting_recordings and
meeting_recording_chunks, including unique sequence and transcript indexes.
Every table/index statement uses IF NOT EXISTS. It is mirrored in the migrate
runner and schema. Existing transcript columns are unchanged. PM and QA
reviewed the addition. Only in-memory SQLite test databases executed it;
production and the local application D1 snapshot were not migrated. Apply it
before a future deployment after the remaining validation is complete.

Final local validation: Type-check and CI-mode lint pass with existing
repository warnings; worker tsc and git diff --check pass. Standard Vitest
config loading fails with esbuild spawn EPERM. An ignored
.wrangler/vitest-sandbox.config.mjs uses TypeScript transpilation and worker
threads to run the same suite. Final output: Test Files 442 passed (442),
Tests 7870 passed (7870), duration 119.10 seconds. Standard npm run build fails
with spawn EPERM.
A supplementary Next build using in-process webpack and worker threads
compiled successfully, passed lint/types and reached page generation, then
failed with DataCloneError because a function could not be cloned into a
thread. That is not a completed build gate. The process was stopped.

```text
npm run type-check: exit 0
CI=1 npm run lint: exit 0, existing repository warnings
npm run test -- --run: blocked at config loading, spawn EPERM
npm run test -- --run --config .wrangler/vitest-sandbox.config.mjs --configLoader native:
  Test Files 442 passed (442)
  Tests 7870 passed (7870)
CI=1 npm run build: blocked, spawn EPERM
node node_modules/typescript/bin/tsc --noEmit -p workers/mcp-server/tsconfig.json: exit 0
git diff --check: exit 0
```

npm ci initially failed at lifecycle subprocess spawn. npm ci --ignore-scripts
then installed 1008 packages, audited 1009 and reported zero vulnerabilities.
The ignored harness/build logs remain in .wrangler/rec0-*.log. The final
supplementary suite ran after source was frozen; later edits only record its
results. Build completion and standard runner proof remain outstanding.

QA and UIUX approved source after reviewing scope/leases/retries, honest
deletion metadata, responsive wrapping, 2.75rem controls, accessible timer
announcements and dark contrast tokens. No source issue was waived to make
the checks pass. Early full-suite failures exposed missing lifecycle table
fixtures and were fixed; one early sweep overlapped source edits and used an
outdated transform, so it is not the final validation result.

Not verified: real Windows browser mic/system capture, Zoom/Teams/Meet desktop
audio, actual browser Stop sharing, headphones/echo/device changes,
background/sleep behaviour, deployed R2/Workers AI, transcription accuracy,
375px/768px rendered layouts, dark rendered UI, and signed-in overview,
requests/client regression. Headless tests cannot prove the real system-audio
permission and capture flow. Beforeunload and anchor leave protection are
implemented; SPA browser Back/Forward warnings are not verified and should
be exercised before release. Remote speakers all share the label Them; there
is no individual remote-speaker diarisation or echo removal.

Open questions: choose an automatic audio retention period after real-call
validation; audio remains in R2 until explicit admin deletion for now. Decide
whether a later correction workflow should permit changing the selected
client after suggestion processing. Calendar detection, a desktop app and a
call-joining bot are outside this phase. REC.0 remains open.

Changed files:

```text
DECISIONS.md
SPECS/meeting-audio-capture.md
STATUS.md
TASKS.md
app/(dashboard)/calls/calls-content.tsx
app/(dashboard)/calls/record/call-recorder-content.tsx
app/(dashboard)/calls/record/page.tsx
app/api/__tests__/admin-recording-chunks.test.ts
app/api/__tests__/cron-suggest-from-transcripts-sqlite.test.ts
app/api/__tests__/mcp-meeting-recordings.test.ts
app/api/admin/call-transcripts/[id]/route.ts
app/api/admin/call-transcripts/route.ts
app/api/admin/db/migrate/route.ts
app/api/admin/recordings/[id]/chunks/route.ts
app/api/admin/recordings/[id]/link/route.ts
app/api/admin/recordings/[id]/route.ts
app/api/admin/recordings/[id]/stop/route.ts
app/api/admin/recordings/[id]/transcribe/route.ts
app/api/admin/recordings/route.ts
app/api/admin/task-suggestions/__tests__/suggestion-release-guards-sqlite.test.ts
app/api/admin/task-suggestions/rebuild/route.ts
db/schema.ts
docs/superpowers/audits/2026-10-13-rec0-phase1-report.md
docs/superpowers/plans/2026-09-13-overnight-run-log.md
drizzle/migrations/0113_meeting_recordings.sql
lib/__tests__/browser-call-recorder.test.ts
lib/__tests__/recording-outbox.test.ts
lib/browser-call-recorder.ts
lib/call-transcripts.ts
lib/import/manyrequests/__tests__/cleanup.test.ts
lib/import/manyrequests/cleanup.ts
lib/meeting-recordings-migration.ts
lib/meeting-recordings-server.ts
lib/meeting-recordings-types.ts
lib/meeting-recordings.test.ts
lib/meeting-recordings.ts
lib/org-lifecycle/__tests__/schema-double.ts
lib/recording-outbox.ts
lib/recording-transcript-client.test.ts
lib/recording-transcript-client.ts
lib/task-suggester.test.ts
lib/task-suggester.ts
workers/mcp-server/src/index.ts
workers/mcp-server/src/tool-profiles.ts
```

The ignored patch artifact .wrangler/rec0-manual-recorder.patch contains
the tracked edits and all new source files, based on HEAD. After creating the
requested branch and passing the standard gates outside this sandbox, use
this commit body (no commit was created here):

```text
Add manual call audio recording to the studio dashboard

Preserve both sides of Windows calls with separate durable audio chunks,
recoverable transcription and explicit client or call linking. Reuse the
existing transcript and human suggestion approval flow. Migration 0113 is
written but not applied. Real Windows capture and rendered mobile/dark QA
remain unverified; see the REC.0 phase 1 report for gate limitations.

Made-With: Codex
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BrUHqp3aXCB1hS8xDgkzZm
```
