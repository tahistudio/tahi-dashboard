# Spec: REC.0 phase 2, Windows tray recorder (revision 1)

Status: approved by Liam on 2026-10-14. Revised after an Opus spec review that FAILED the first draft on R1 to R16, all now folded in. Builds on phase 1 (manual browser recorder, Decision #071) and phase 1b (paragraphs, speaker naming, reminder). Codex builds it; Opus and security reviewers check it.

## What it is
A Windows tray app that records Liam's calls automatically. It captures system audio and the microphone directly, with no screen-share prompt, and uploads through the phase 1 recording pipeline. Transcripts, speaker naming, linking and task suggestions all work unchanged.

## Liam's decisions (fixed)
- **Auto-start, easy to stop:** it starts when a calendar call is in its window AND the meeting app is in a call. The tray icon shows that it's recording, and a toast offers Stop.
- **No recording notice.** Record in DECISIONS #072 that Liam accepted the exposure: New Zealand law allows a party to record, but some clients' jurisdictions require all-party consent, and GDPR requires transparency.
- **Transcription stays on Cloudflare Workers AI** (about USD 0.06 per two-track hour). No new subscriptions.

## Build order (each step reviewed before the next)
- **Step 0, WAV probe.** Send one real 30-second WAV chunk (the format below) through the existing chunk and transcribe routes, against local dev with the AI binding or a staging deploy. Record the result in DECISIONS #072. If Whisper rejects WAV, fall back to Opus-in-Ogg encoding (`audio/ogg`, already accepted by the route) and note it.
- **Step 1, migration 0114, shipped alone.** The main session pushes it and applies it on production before any code that reads it. (0113 was verified live on production on 2026-10-14.)
- **Step 2, dashboard server and UI:** device auth, pairing, upcoming calls, the Settings UI, and MCP tools.
- **Step 3, the tray app.**

## Migration 0114 (every statement CREATE ... IF NOT EXISTS; no ALTER)
- `recorder_devices`:
  - columns: id PK, team_member_id, name, token_hash UNIQUE, created_at, last_seen_at, membership_checked_at, revoked_at, revoked_reason
  - index on team_member_id
- `recorder_pairing_codes`:
  - columns: code_hash PK, team_member_id, created_by_user_id, expires_at, used_at, used_by_device_id
  - index on team_member_id
- `recorder_pairing_attempts` (rate limiting):
  - columns: id PK, ip_hash, attempted_at, succeeded
  - index on (ip_hash, attempted_at)
- `recorder_recordings` (side table; a row means source = tray):
  - columns: recording_id PK (references meeting_recordings), device_id, team_member_id, client_ref, call_id, created_at
  - constraint: UNIQUE(device_id, client_ref)
  - indexes on team_member_id and device_id
- Register '0114' in app/api/admin/db/migrate/route.ts with an "apply BEFORE deploying" description. Add DECISIONS #072.

## Device auth (R1, R2: security-critical)
- **Don't touch getRequestAuth.** A new lib/recorder-device-auth.ts exports getRecorderDeviceAuth(req). It's called only when getRequestAuth returns no userId and the Bearer value starts with the fixed prefix `tahi_rec_`. Keep the Bearer scheme so the middleware's existing Bearer bypass for /api/* applies.
- **Explicit per-handler opt-in.** withRecordingContext takes `{ device: 'create' | 'chunk' | 'stop' | 'transcribe' | 'read' }`. Without the opt-in, a device identity gets 401. In particular, DELETE /recordings/[id] and POST /recordings/[id]/link must reject device tokens.
- **Returned identity:** `{ userId: member.clerkUserId, orgId: TAHI_ORG, sessionId: null, recorderDevice: { id, teamMemberId } }`. That way requireFeature('calls'), the org scoping and attributedUserId all work unchanged.
- **Checks on every request:**
  - the token hash matches a device that isn't revoked;
  - the team_members row exists and has a clerk_user_id;
  - `resolvePermissions(...).isAdmin` is true;
  - Clerk membership through isClerkUserInTahiOrg (lib/mcp-profile-server.ts), cached on the device row and re-checked when membership_checked_at is more than 15 minutes old. A Clerk outage returns a retryable 503 and the tray keeps its audio. A definite "no" revokes the device.
- **Expiry:** the token expires after 30 days with no use. Write last_seen_at at most once every 5 minutes.
- **Route-walk test** (in the style of app/api/__tests__/mcp-designer-routes.test.ts): a device token gets 401 on every route and method except the allowlist.
- **Quotas:** at most one open recording per device, and at most 12 hours of reserved microphone audio per device over a rolling 24 hours (system audio does not count). Return 429 beyond those.

## Pairing (R6)
- **Settings > Recorder devices** (a new section): only a Clerk-session admin can click "Pair a device", and only for themselves. A device token or MCP cannot create a code. Document this exception to MCP parity (CLAUDE.md rule 14) in DECISIONS #072.
- **The code:** 8 characters from a 32-symbol alphabet with no ambiguous characters, valid for 10 minutes. Only its SHA-256 is stored.
- **Exchange:** POST /api/public/recorder/pair (/api/public is already public in middleware). It takes `{ code, deviceName }`.
  - Rate limit through recorder_pairing_attempts: 5 failures per IP hash per 15 minutes, then 429.
  - It consumes the code atomically with `UPDATE ... SET used_at=?, used_by_device_id=? WHERE code_hash=? AND used_at IS NULL AND expires_at > ? RETURNING`.
  - It returns `tahi_rec_` + 32 random bytes in base64url, and stores only its SHA-256.
- **Settings device list:** name, last seen and created date, with Revoke. All states (loading, empty, error) at 375px, 768px and desktop, in light and dark mode. Use rem units, CSS var tokens and 44px targets.
- **MCP:** list_recorder_devices and revoke_recorder_device on the worker, both blocked for the designer profile, with path ids validated.

## Recording APIs for the device (R3, R5, R7, R15)
- **Create** takes a client UUID `clientRef`. It's idempotent through recorder_recordings UNIQUE(device_id, client_ref): a retry returns the same recording.
- **callId** without callKind returns 400. With both supplied, callId is accepted only if it's in this member's upcoming-calls list and the call's window is open now. Otherwise the recording is created unlinked.
- **Device reads are owned and slim.** A device only sees recordings it created (recorder_recordings.team_member_id is the device's member). It gets state, expected chunk counts and, per chunk, uploaded/state/error. It never gets transcript text or chunk text.
- **Transcription:** the tray loops the existing per-chunk transcribe call until the recording is ready or failed, with backoff, and resumes after a restart.
- **Serialisation:** all calls for one recording are serialised. A 409 "busy" (lease) means retry. A duplicate chunk, or `uploaded: true`, counts as confirmed, so the local file can be deleted.

## Upcoming calls endpoint (R14)
- **GET /api/admin/recordings/upcoming-calls**, device opt-in 'read'.
- **Sources:** discovery_calls and scheduled_calls, the same tables /api/admin/calls/index reads.
- **Filter:** status scheduled, and a match to this member through their attendee email (case-insensitive), their connected Google account email in attendees with account ownership proved by the member email or recorded connecting member, or their call creator identity; return calls with window [start - 2 minutes, end + 10 minutes] overlapping [now, now + 15 minutes]. The exact condition is startMs - 120_000 <= nowMs + 900_000 && endMs + 600_000 >= nowMs. Create links only while the window is open now. Compare start and end as parsed instants, not as text.
- **Returns only:** id, kind, title, startMs, endMs and platform (zoom, meet, teams or unknown, derived from the URL). Never return the raw meeting URL.
- **Known limits, which go in the spec and in DECISIONS #072:**
  - Calendar sync runs every 15 minutes.
  - Only events matched to a lead, deal or client become calls.
  - The single Google integration is Liam's calendar.
  
  Calls outside those limits don't auto-start; "Start recording now" covers them.

## Tray app (apps/recorder-tray/)
- **Stack:** C# on .NET 8 (net8.0-windows10.0.17763.0), a WinForms NotifyIcon tray app, published as a single self-contained exe (win-x64). Use a single-instance mutex, plus an AUMID and a Start menu shortcut so toasts with buttons work.
- **Host:** the token is used only against https://portal.tahi.studio (built-in constant, HTTPS only). It's stored with DPAPI CurrentUser. Document the compromised-PC model: DPAPI doesn't stop malware running as Liam, and revocation plus quotas bound the damage.
- **Chunk format (R9):** PCM s16le, mono, 16,000 Hz, a standard 44-byte RIFF header, MIME exactly `audio/wav`. That's 960,044 bytes per 30 seconds.
  - Mic: WasapiCapture on the default capture device.
  - System: prefer NAudio process loopback for the meeting process tree. If the installed NAudio version doesn't support it, fall back to WasapiLoopbackCapture on the default render device.
  - Resample to the format above.
- **Wall clock (R10):** both tracks run on one shared Stopwatch. Loopback delivers nothing during silence, so fill gaps with silence to keep the tracks aligned. Handle device changes (IMMNotificationClient, such as a Bluetooth headset connecting) by reopening the capture without losing chunks.
- **Outbox:** %LOCALAPPDATA%\TahiRecorder\outbox. The create step is queued too. A local chunk is deleted only after the server confirms it. The outbox survives sleep, network loss and crashes.

### Call detection (R13)
The primary signal is an active capture-side audio session (IAudioSessionManager2 on the capture endpoint) owned by the meeting process tree: Zoom, Teams (the ms-teams.exe tree, including its child and WebView2 processes), or a browser (chrome, msedge, vivaldi, firefox).
- Meeting apps usually keep the mic stream open while muted. Music never opens it.
- Playback alone never starts a recording.
- "Inactive" means the capture session closed, never a low audio level.
- Log the observed process names on the first real calls, so the detection list can be checked rather than assumed.

### Auto-start and stop (R11, R12)
- **Liam's decision, 2026-10-14: also auto-record calls the calendar doesn't know about.** When a meeting capture session (as defined above) has been active for 20 seconds and no call's window is open, start an UNLINKED recording automatically. The toast reads "Recording: Zoom call" (or Teams or Meet call) and offers Stop. Liam links it to a client afterwards. The same stop rules apply. Record this in DECISIONS #072. It will also capture internal and personal calls.
- **Start** when a call's window is open (from 2 minutes before its start until 10 minutes after its end) AND a meeting capture session is active.
  - If more than one call's window is open, pick the call whose [start, end] contains now. If that's still ambiguous, record unlinked.
  - Never guess.
- **Back-to-back calls:** when another call's start arrives during a recording, stop the current recording and start a new one linked to the new call, with a toast.
- **Stop** when:
  - the meeting capture session has been closed for 60 seconds;
  - Liam clicks Stop;
  - the next call starts;
  - 12 hours have passed in total; or
  - 15 minutes have passed after the scheduled end AND no meeting session is active.
  
  After stopping, upload the rest and loop transcription.
- Never auto-restart a call that Liam stopped by hand.
- **Tray icon states:** idle, waiting, recording (red) and uploading. Stop is always in the tray menu, so it doesn't depend on the toast (Focus or Do Not Disturb can hide toasts).
- **Recording toast:** "Recording: <title>" with Stop and "Not this call". "Not this call" keeps recording and is honoured only before its create request is sent, by creating unlinked. After create is sent, Liam relinks in the dashboard under its existing linking rules.
- **Tray menu:**
  - a status line
  - Start recording now (disabled during an automatic recording)
  - Stop recording
  - Open recordings
  - Pause auto-start for 1 hour
  - Start with Windows (on by default)
  - Sign out this device
  - Quit
- **Mute behaviour:** the mic records even while Liam is muted in the meeting app. Document this in the first-run window.

## Repo hygiene
apps/recorder-tray is excluded from the Next build, tsconfig, lint and vitest globs, and its bin/obj output is gitignored. Add a README with build steps: `dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true`. For now the exe is built locally and handed to Liam by hand.

## Follow-ups (not in this phase)
- Auto-update.
- Code signing. Expect SmartScreen and Defender to flag the unsigned exe.
- macOS.
- Whisper initial_prompt with client and product names.
- Speaker separation beyond phase 1b.

## Done when
- Step 0 has proved WAV (or the fallback is chosen).
- 0114 is shipped and applied first.
- The dashboard gates pass, and security and Opus reviews pass.
- The Settings device UI is checked at 375px and 768px, in dark mode.
- The exe pairs, sits in the tray and starts with Windows.
- On a real calendar Zoom or Meet call, it auto-starts, shows its state, stops when the call ends, and the transcript appears linked to the call with both sides.
- Revoking the device stops its uploads.
