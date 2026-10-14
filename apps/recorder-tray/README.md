# Tahi Recorder for Windows

REC.0 phase 2 client, from the approved revision 1 spec and Decision #072.
The server is live at `https://portal.tahi.studio` per Liam's 2026-10-14 brief.
The exact API contract is [the server handoff](../../docs/recorder-tray-server-handoff.md).
This worktree's changes remain uncommitted. No production operation was performed.

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
ProtectedData 8.0.0, xUnit 2.9.2, runner 2.8.2 and Test SDK 17.11.1.
Next, TypeScript, ESLint and Vitest exclusions already exist. Nested bin/obj,
local package caches, smoke/build logs and publish output are ignored.

## Build and publish

Use Windows x64 and the .NET 8 SDK. From `apps/recorder-tray`:

```powershell
dotnet restore TahiRecorder.sln --configfile NuGet.Config
dotnet build TahiRecorder.sln -c Release --no-restore
dotnet test TahiRecorder.Core.Tests/TahiRecorder.Core.Tests.csproj -c Release --no-restore
dotnet publish TahiRecorder.App/TahiRecorder.App.csproj -c Release -r win-x64 --self-contained -p:PublishSingleFile=true -o publish
```

The result is `publish/TahiRecorder.App.exe`. Put it in a stable location before
launching. Startup and the Start menu shortcut point to that executable.
Keep trimming disabled because WinForms, COM and notifications need metadata.
Distribution is local/manual. Auto-update, signing and macOS remain follow-ups.
SmartScreen or Defender may flag the unsigned executable.

If optional workload discovery fails, set
`$env:MSBuildEnableWorkloadResolver = 'false'` in the build shell.
The main session must run restore, build, test and publish with package access
before distributing the executable.

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
recording now, Stop recording, Open recordings, Pause auto-start for 1 hour,
Start with Windows, Sign out this device, Quit. Stop always remains available
in the menu. Manual start is disabled during automatic recording.

Recording toasts say `Recording: <title>` and offer Stop and Not this call.
Actions carry the recording UUID, preventing old buttons from stopping a newer
call. Not this call creates unlinked only before create has been sent. The
outbox gives create a five-second grace period. After sending, use the
dashboard's existing linking controls. Devices cannot relink.

Calendar windows are start minus two minutes to end plus ten minutes. The unique
call containing now wins among overlapping windows, otherwise ambiguity stays
unlinked. Another call's start splits the recording; late joins are allowed.
Stop occurs on manual Stop, after sixty seconds without a meeting capture
session, at the next-call boundary, at twelve hours, or at scheduled end plus
fifteen minutes with no active session. Active calls may overrun scheduled end.
Manual-stop suppression and the one-hour pause persist across restart.

Calendar limits from #072: fifteen-minute sync, lead/deal/client-matched events
only, Liam's shared Google integration. Unknown-call detection and manual start
cover calls outside those limits.

## Detection and capture

Detection enumerates active capture-side `IAudioSessionManager2` sessions on a
dedicated COM MTA thread. Process ancestry recognises Zoom, Teams (`ms-teams`
or `teams`, including WebView2 descendants), Chrome, Edge, Vivaldi and Firefox.
Playback and volume never trigger it. Browser microphone capture is labelled
Meet because the signal cannot distinguish sites. Other browser microphone
uses can trigger the unknown-call path. Logs contain observed process names
and UTC timestamps, no audio or credential.

Mic capture uses `WasapiCapture`. NAudio 2.2.1 uses the approved default-render
`WasapiLoopbackCapture` fallback here, so system audio includes all desktop
output during the call. Both formats request Windows audio-engine conversion
to 16 kHz mono s16le. One Stopwatch drives sample positions and silence padding.
Default endpoint notifications reopen capture without resetting the timeline.
Temporary reconnect errors keep recording; fatal persistence errors stop safely.

Thirty-second chunks and shorter tails use MIME exactly `audio/wav`, a 44-byte
RIFF header and size `44 + durationMs * 32`. A full chunk is 960,044 bytes.
Incremental PCM and a durable journal allow partial-chunk recovery after restart.
API surfaces were checked against
[NAudio 2.2.1 source](https://github.com/naudio/NAudio/tree/v2.2.1/NAudio.Wasapi).
Notifications use Microsoft's
[desktop toast registration](https://learn.microsoft.com/en-us/windows/win32/shell/quickstart-sending-desktop-toast).

## Outbox and troubleshooting

Under `%LOCALAPPDATA%/TahiRecorder/`:

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
Stop counts/duration persist. Transcription repeats with backoff until ready
or failed. Restart recovers and seals interrupted captures, then resumes upload.

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
- Device switch: check Windows default capture/render devices and microphone
  privacy settings. Bluetooth reconnect gaps are padded with silence.
- Disk/journal/transfer errors: retain folders for recovery. Do not delete the
  outbox to fix network errors. Damaged journals need operator review.

The origin is built in, authenticated redirects are disabled, and upload URLs
must remain on the portal's recording chunks endpoint.

## Validation handoff

xUnit coverage (70 authored cases): calendar/unknown starts, overlapping windows, late join,
back-to-back split, stop rules, manual suppression/restart, pause, Not this call;
WAV headers/length/padding/truncation/timeline; protected storage with a fake
protector; exact API JSON/origin guards; durable create/clientRef retries,
duplicate confirmation, cleanup/restart/counts/terminal states/concurrency;
429 open_recording/daily_quota, 409 busy, Retry-After and authentication failure.

Sandbox results:

```text
Core restore: exit 0
Core Release build: Build succeeded. 0 Warning(s), 0 Error(s).
Supplemental package-free Core smoke: 35 checks passed, exit 0 (not xUnit).
Solution restore: NU1301, unable to load https://api.nuget.org/v3/index.json.
Solution build: NU1301 and NETSDK1004, missing test project assets.
dotnet test --no-restore: NETSDK1004, missing test project assets, exit 1.
```

No executable or xUnit pass is claimed. After the main session runs the build
commands, verify pairing/single instance/Windows startup/toast buttons; real
calendar and unknown Zoom/Meet/Teams calls; muted mic and both-sided transcript;
manual-stop/pause/late join/ambiguity/back-to-back behaviour; silence and default
device switching; sleep/crash/offline recovery; revocation and per-device
separation; pairing DPI, keyboard and Windows light/dark/high contrast.
The app was not launched or paired here. REC.0 stays open until real-call proof.
