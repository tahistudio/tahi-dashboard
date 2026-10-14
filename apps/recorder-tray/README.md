# Tahi Recorder for Windows

REC.0 phase 2 client, from the approved revision 1 spec and Decision #072.
The server is live at `https://portal.tahi.studio` per Liam's 2026-10-14 brief.
The exact API contract is [the server handoff](../../docs/recorder-tray-server-handoff.md).
The initial Windows client is committed as `8665e762`, with first review fixes
committed as `938bd68e`, round 2 fixes as `5e77adc5` and round 3 fixes as
`6964660b`. Round 4 is the uncommitted follow-up in this worktree per Liam's
brief. No production operation was performed.

## Project layout

- `TahiRecorder.Core/`: portable .NET 8 library for calendar matching,
  automatic start/stop, saved suppression/pause, WAV/padding, token-storage
  interfaces, fixed-origin API client and durable outbox.
- `TahiRecorder.App/`: WinForms tray host targeting
  `net8.0-windows10.0.17763.0`. Pairing, single instance, native toast activation,
  startup, DPAPI CurrentUser, capture-session detection, WASAPI and crash spool.
- `TahiRecorder.Core.Tests/`: xUnit library tests, no hardware or live token.
- `TahiRecorder.sln` and `NuGet.Config`: solution and public package source.

Package versions are pinned: NAudio 2.2.1, Toolkit notifications 7.1.3,
ProtectedData 8.0.0, System.Drawing.Common 8.0.0, xUnit 2.9.2, runner 2.8.2
and Test SDK 17.11.1.
Next, TypeScript, ESLint and Vitest exclusions already exist. Nested bin/obj,
local package caches, smoke/build logs and publish output are ignored.

## Build and publish

Use Windows x64 and the .NET 8 SDK. From `apps/recorder-tray`:

```powershell
dotnet restore TahiRecorder.sln --configfile NuGet.Config
dotnet build TahiRecorder.sln -c Release --no-restore
dotnet test TahiRecorder.sln -c Release --no-build --no-restore
dotnet publish TahiRecorder.App/TahiRecorder.App.csproj -c Release -r win-x64 --self-contained -p:PublishSingleFile=false -p:IncludeNativeLibrariesForSelfExtract=false -o publish
```

The result is a publish folder containing `TahiRecorder.App.exe`, managed
assemblies and native runtime libraries. Native libraries remain beside the
executable and are never extracted to `%TEMP%`. Use an administrator shell to
create `C:/Program Files/Tahi Recorder/` and copy the entire publish folder's
contents there, preserving subdirectories.
Run the installed executable as your ordinary Windows user. Never run the
recorder from the repository. Keep the folder's standard Program Files ACLs;
other ordinary users must not have write permission. Startup and the Start menu
shortcut point to the installed executable. An unsafe executable directory
disables startup, COM and shortcut registration and shows an install message.
The install check covers the complete folder, including native libraries and
subdirectories, and refuses links or files with untrusted write permission.
Keep trimming disabled because WinForms, COM and notifications need metadata.
Distribution is local/manual. Auto-update, signing and macOS remain follow-ups.
SmartScreen or Defender may flag the unsigned executable.

If optional workload discovery fails, set
`$env:MSBuildEnableWorkloadResolver = 'false'` in the build shell.
The restored `.packages` cache supports offline build/test with `--no-restore`.
A new package version requires restore once before those offline commands.

## Pairing and credentials

1. Sign in to the portal. Open Settings > Recorder devices, choose Pair a device.
2. Launch the recorder and enter the eight-character code within ten minutes.
   The editable device name defaults to the machine name.
3. The bearer is stored only in a DPAPI CurrentUser file. No token goes into
   source, logs, manifests or startup arguments.
4. Start with Windows is enabled by default. Toggle it in the tray menu.

The microphone records even while you are muted in Zoom, Teams or Meet.
Calendar calls start automatically with an active meeting capture session.
Unknown calls also start after twenty seconds, unlinked. They can include
internal or personal calls. Liam chose no participant notice in #072.

Settings > Recorder devices revokes access remotely. Sign out this device clears
the local token after stopping capture and upload workers. It does not revoke
the server device: that capability requires an ordinary dashboard session.
New pairing creates a different device, retaining earlier audio in a separate
device directory. Old audio is never uploaded using a newly paired credential.
DPAPI protects at rest for CurrentUser, but malware running as that person can
access it. Revocation and quotas bound the compromised-PC model from #072.

## Tray and automation

States: idle, waiting, recording (red), uploading. Menu: status line, Start
recording now, Stop recording, Open recordings, Local recordings (n), Pause auto-start for 1 hour,
Start with Windows, Sign out this device, Quit. Stop always remains available
in the menu. Manual start is disabled during automatic recording.

Recording toasts say `Recording: <title>` and offer Stop and Not this call.
Actions carry the recording UUID, preventing old buttons from stopping a newer
call. Not this call creates unlinked only before create has been sent. The
outbox gives create a five-second grace period. After sending, use the
dashboard's existing linking controls. Devices cannot relink.

Calendar windows are start minus two minutes to end plus ten minutes. The unique
call containing now wins among overlapping windows, otherwise ambiguity stays
unlinked. Early joins wait when a calendar window opens within ten minutes,
then start linked at start minus two minutes. Another call's start splits an
automatic recording unless auto-start is paused. Calendar boundaries never
split a manual recording; late joins are allowed.
Stop occurs on manual Stop, after sixty seconds without a meeting capture
session, at the next-call boundary, at twelve hours, or at scheduled end plus
fifteen minutes after at least five seconds of inactivity. A manual recording
ignores inactivity until a meeting session has been seen during it. A new actual
meeting session ends it. Suspend, session ending and Quit flush capture without
manual suppression. Active calls may overrun scheduled end. Manual Stop
suppresses a continuously active session regardless of elapsed time.
Manual-stop suppression clears after sixty seconds of observed inactivity for
unscheduled calls. A later calendar call that starts after Stop can clear it
after five seconds of observed inactivity if its window opened after the stopped
recording began and the call is not suppressed. This permits a back-to-back call
after a late Stop in the same app. That restart qualification expires when the
target call's window closes or a new recording starts.
Process ID changes alone never clear suppression.
Until then, manual-stop suppression and the one-hour pause persist across restart.

Calendar limits from #072: fifteen-minute sync, lead/deal/client-matched events
only, Liam's shared Google integration. Unknown-call detection and manual start
cover calls outside those limits.

## Detection and capture

Detection enumerates active capture-side `IAudioSessionManager2` sessions on a
dedicated COM MTA thread. Process ancestry recognises Zoom, Teams (`ms-teams`
or `teams`, including WebView2 descendants), Chrome, Edge, Vivaldi and Firefox.
Playback and volume never trigger it. Browser microphone capture is labelled
Meet because the signal cannot distinguish sites. Other browser microphone
uses can trigger the unknown-call path. Detection retains the current process
while its capture session remains active. Key-change logs contain process names,
PIDs and UTC timestamps, no audio or credential.

Mic capture uses the default Communications capture endpoint with `WasapiCapture`.
NAudio 2.2.1 uses the default Communications render endpoint with
`WasapiLoopbackCapture` fallback here, so system audio includes all desktop
output during the call. Both formats request Windows audio-engine conversion
to 16 kHz mono s16le. One Stopwatch drives sample positions and silence padding.
Default endpoint notifications reopen capture without resetting the timeline.
Temporary reconnect errors keep recording. A silent loopback track, including a
missing render device, stays padded while the microphone delivers audio. A late
first system packet retains its wall-clock position. Only a gap with no audio
from either track or a monotonic clock jump above ten seconds ends capture at
that cap. Automatic start waits forty-five seconds after a gap; manual Start
recording remains available. Fatal persistence errors stop safely and disable
recording until the storage issue is resolved.

Thirty-second chunks and shorter tails use MIME exactly `audio/wav`, a 44-byte
RIFF header and size `44 + durationMs * 32`. A full chunk is 960,044 bytes.
The last full chunk is retained until a tail shorter than two seconds can be
folded into it. The combined chunk remains below the server's 180-second limit.
Incremental PCM and a durable journal allow partial-chunk recovery after restart.
API surfaces were checked against
[NAudio 2.2.1 source](https://github.com/naudio/NAudio/tree/v2.2.1/NAudio.Wasapi).
Notifications use Microsoft's
[desktop toast registration](https://learn.microsoft.com/en-us/windows/win32/shell/quickstart-sending-desktop-toast).

## Outbox and troubleshooting

Under `%LOCALAPPDATA%/TahiRecorder/`:

Only the mutex-owning instance checks storage before capture begins. The root
DACL has inheritance disabled and FullControl for the current user SID, SYSTEM
and Administrators only. A current-user-owned legacy root with inherited
permissions and no explicit foreign ACEs is protected in place. Correct ACLs
are left alone; descendants are repaired only when their inheritance or explicit
rules are wrong. A wrong owner, explicit foreign ACE or link refuses recording
with the affected path and recovery steps. Local recordings (n) opens this
folder for inspection.

- `tokens/<deviceId>.dpapi`: credential encrypted for CurrentUser and bound to
  the persisted device identity, avoiding a crash mixing old and new devices.
- `settings.json`: device identity and automation state, no credential.
- `logs/`: host event types and observed process names.
- `capture/<deviceId>/<clientRef>/`: incremental PCM, journal and recovered WAV.
- `outbox/<deviceId>/<clientRef>/`: recording manifest and queued WAVs.

Create and its UUID clientRef are durable before capture starts. Operations for
one recording are serialized. Uploaded acknowledgement is persisted before
deleting WAVs. Metadata-only duplicates still upload; `uploaded: true`, a
successful PUT, or PUT `409 duplicate` with `uploaded: true` confirms possession.
Stop counts/duration and created sequence persist. Transcription progress resets
polling to about one second. Busy, errors and no progress back off. A server
failed state is retried three times before becoming final. A poison recording
is blocked with a fixed message, stops local capture and makes a best-effort
server stop, resolving an uncertain create by its idempotent clientRef first. Other
recordings continue. Missing chunk files block that recording and make a
best-effort server stop. Other chunk read IO failures back off for at most ten
consecutive IO failures before blocking. Success or any non-IO error resets that
counter, so offline time cannot exhaust it. Malformed server JSON retains audio with retry backoff.
Server failed-state retry counts reset when transcription makes progress.
Restart recovers and seals interrupted captures, then
resumes upload. Damaged spool/manifest data shows needs attention without
reopening pairing. Ready/failed recordings, their manifests and leftover audio
expire after seven days; pending/blocked audio is retained. Logs expire after
fourteen days. Log retention errors never stop startup or recording ticks.
Retention runs at startup and hourly, deleting the capture journal last and
tolerating an absent journal for an already ready or failed recording.

- Network/timeouts, `409 busy`, retryable `503`: retain audio and back off.
- `429 open_recording`: let the earlier recording finish. Known local capture
  is recovered automatically. An orphaned server row needs dashboard review.
- `429 daily_quota`: retain audio, wait at least fifteen minutes per retry.
  The server has independent rolling twelve-hour quotas for each track.
- `401`/`403`: stop capture and uploads, pair again for new recordings. Old
  device audio remains separate and retained.
- Missing toast: check notification permissions, Focus or Do Not Disturb.
  Restart from the stable exe location; use tray Stop regardless.
- Detection: inspect `logs/capture-processes-*.log` during real calls. Verify
  new Teams/WebView2 and browser process trees on the actual computer.
- Device switch: check Windows default Communications capture/render devices and
  microphone privacy settings. A silent single track remains padded. A shared
  reconnect gap above ten seconds stops the recording.
- Disk/journal/transfer errors: retain folders for recovery. Do not delete the
  outbox to fix network errors. Damaged journals need operator review.

The origin is built in, authenticated redirects are disabled, and upload URLs
must remain on the portal's recording chunks endpoint.

## Validation handoff

xUnit coverage: calendar/unknown starts, overlapping windows, late join,
back-to-back split, stop rules, manual suppression/restart, pause, Not this call;
WAV headers/length/padding/truncation/timeline; protected storage with a fake
protector; exact API JSON/origin guards; durable create/clientRef retries,
duplicate confirmation, cleanup/restart/counts/terminal states/concurrency;
429 open_recording/daily_quota, 409 busy, Retry-After and authentication failure.

The first review fixes are committed as `938bd68e`. Round 2 Release build and
complete test results with restored packages are recorded in
the running log and [the review report](../../docs/superpowers/audits/2026-10-14-rec0-tray-app-review-fixes.md).
Round 2 verification: Release solution build succeeded with zero warnings and
errors; all 152 tests passed, zero failed/skipped. Folder publishing succeeded,
with native runtime libraries beside the executable. Logs are in
`.build-logs/round2-build.log`, `round2-tests.log` and `round2-publish.log`.
Round 3 verification (`6964660b`): Release solution build succeeded with zero
warnings and errors; all 181 tests passed, zero failed/skipped. Logs are in
`.build-logs/round3-build.log`, `round3-tests.log` and `round3-tests.trx`.
Round 4 covers late-stop back-to-back capture, expiring calendar restart
qualification, consecutive IO failure accounting, nonduplicated startup recovery
guidance and a fresh system-audio outage report for each recording. Round 4
Release solution build passed for all three projects with zero warnings/errors;
all 207 xUnit tests passed, zero failed/skipped, in one test assembly. Logs are
`.build-logs/round4-build.log`, `round4-tests.log` and `round4-tests.trx`.
No folder publish or recorder launch was performed in these follow-ups.
Before distribution, verify
pairing/single instance/Windows startup/toast buttons; real
calendar and unknown Zoom/Meet/Teams calls; muted mic and both-sided transcript;
manual-stop/pause/late join/ambiguity/back-to-back behaviour; silence and default
device switching; sleep/crash/offline recovery; revocation and per-device
separation; pairing DPI, keyboard and Windows light/dark/high contrast.
The app was not launched or paired here. REC.0 stays open until real-call proof.
