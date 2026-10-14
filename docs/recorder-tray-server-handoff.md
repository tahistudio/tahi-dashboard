# Tray recorder server handoff

REC.0 phase 2 dashboard changes are prepared on feat/rec0-tray-server from
729cc282. Nothing in this worktree has been committed, applied or deployed.
Phases 1 and 1b are live per Liam's 2026-10-14 brief. Decision #072 records the
approved automatic capture choices and the successful live WAV probe.

## Ship order

First ship only these migration files, then apply 0114 through the normal
admin migration endpoint before deploying the remaining server code:

- lib/recorder-devices-migration.ts
- drizzle/migrations/0114_recorder_devices.sql
- app/api/admin/db/migrate/route.ts

The registration description is: Apply BEFORE deploying the tray recorder
server code. All statements are CREATE TABLE or CREATE INDEX IF NOT EXISTS.
The later code change includes matching db/schema.ts declarations. Main
session owns migration, deploy, production proof and security/Opus review.

## Pairing and device management

Settings > Recorder devices shows only the signed-in person's devices, with
loading, empty, error, active and revoked states. A real Clerk-session admin
can create a code for themselves with POST /api/admin/recorder-devices/pairing-code.
The response is { code, expiresAt }, valid for ten minutes, single use. Only
the code hash is stored. Neither MCP nor a recorder bearer can create codes.

The client exchanges { code, deviceName } through POST /api/public/recorder/pair.
The 201 response is { token, device: { id, name } }. The bearer is tahi_rec_
followed by 32 random bytes in base64url. Only its SHA-256 is stored. Responses
containing secrets are no-store. Five failed attempts from a Cloudflare IP
hash within fifteen minutes block further exchanges with 429. Atomic D1
consumption prevents two devices using one code.

GET /api/admin/recorder-devices returns { items }. POST
/api/admin/recorder-devices/{id}/revoke returns { success: true }. These use
ordinary admin authentication and scope rows to that person's team member.
MCP first passes the service caller's existing organisation and admin guards;
only then does its verified recorded actor select the owned rows within that
already permitted data. An actor never upgrades the caller's permissions.
Full-profile worker tools list_recorder_devices and revoke_recorder_device
provide MCP parity for those operations. Both are blocked for designers.

## Device recording protocol

Send Authorization: Bearer <token> only to the built-in HTTPS portal origin.
No ordinary dashboard or portal capability is granted by this token. Accepted
recording methods are:

- POST /api/admin/recordings, with { clientRef, title, tracks, callKind?, callId? }.
  clientRef is a persisted client UUID. A retry returns the existing recording.
  tracks contains mic and optionally system. Tray transcription uses Whisper.
- GET /api/admin/recordings and GET /api/admin/recordings/{id} for owned state,
  expected chunk counts, and each chunk's track, sequence, uploaded, state and
  error. These responses contain no transcript, segments or chunk text.
  List items use the same { recording, chunks } shape as detail, within items.
- POST /api/admin/recordings/{id}/chunks reserves chunk metadata. PUT to the
  returned uploadUrl uploads the body. On device reservations, duplicate and
  uploaded are true only after the body is stored. An existing reservation
  awaiting its body returns both false and must still be uploaded. A successful
  PUT, or PUT's 409 code duplicate with uploaded: true, confirms possession;
  only then may the client delete its local chunk.
  Device chunks must be canonical PCM s16le, mono, 16 kHz WAV with a standard
  44-byte header and MIME exactly audio/wav. Reservation size must equal
  44 + durationMs * 32; upload validates the header and sample count before R2.
- POST /api/admin/recordings/{id}/stop, with the existing expectedChunks and
  durationMs contract. Upload missing chunks and repeatedly POST
  /api/admin/recordings/{id}/transcribe until ready or failed.
- GET /api/admin/recordings/upcoming-calls returns { items } containing only id,
  kind, title, startMs, endMs and platform. A device-provided call identity is
  revalidated against this member's upcoming calls and its open window when
  creating a recording; an invalid choice becomes unlinked.
  Ordinary Clerk callers also retain their existing client access scope.

A device can access only recordings created by that device and team member.
DELETE, transcript refresh and link methods refuse recorder tokens. Device
requests are serialized under the existing recording lease. A 409 busy means
retry with backoff; never discard local audio on a timeout or a 5xx.

Membership is checked on each request through the current team row and admin
permissions. Clerk organisation membership is cached for fifteen minutes.
A definite removal revokes the token; a Clerk outage returns retryable 503
with Retry-After, preserving local audio. Thirty idle days expire a device;
last-seen writes occur at most once per five minutes. Quotas allow one open
recording and twelve hours of reserved audio per device per UTC day, across
both tracks. Reservations count before upload so concurrency cannot bypass
the limit. A 429 means retain audio and wait or resolve the open recording.

## Calendar and client limits

Upcoming calls must be scheduled, include the member's email in attendees,
and start from two minutes ago through fifteen minutes ahead. Times are
parsed instants; the raw meeting URL is never returned. Calendar sync runs
every fifteen minutes, only lead/deal/client-matched events become calls,
and the shared Google integration is Liam's calendar.

The separate tray run implements automatic unlinked capture for unknown
calls after twenty seconds of an active meeting capture session, manual
start/stop, persistent outbox, DPAPI CurrentUser storage and the visible tray
state. It must explain that muted microphone audio is recorded. DPAPI cannot
protect against malware running as Liam. The no-notice choice and its legal
exposure are recorded in Decision #072. Local build steps live in
apps/recorder-tray/README.md. No C# project is included in this server change.
