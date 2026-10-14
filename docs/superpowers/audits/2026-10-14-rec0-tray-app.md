# REC.0 Windows tray app handoff, 2026-10-14

Started clean on feat/rec0-tray-app at main 15de17d7. The server side is live per
Liam's brief. Sources read: CLAUDE.md, STATUS.md, TASKS.md, run log, #072,
approved revision 1 spec at C:/Users/Work/.codex-briefs/rec0-tray-spec.md,
docs/recorder-tray-server-handoff.md and apps/recorder-tray/README.md.

All client files are uncommitted. No shared git metadata was written, and no
commit, push, deployment, migration, pairing or real capture was performed.
Dashboard source is unchanged. The recorder directory already had the Next,
TypeScript, lint and Vitest exclusions and nested bin/obj ignores.

## Implementation against the spec

| Section | Implementation |
| --- | --- |
| Structure | Core net8.0, App net8.0-windows10.0.17763.0, xUnit tests, solution and pinned packages. Single self-contained win-x64 publish configuration. |
| Tray | Exact menu and idle/waiting/red recording/uploading icons. Stop always available. Single instance and same-user named pipe. Default Run key. AUMID, shortcut, COM toast buttons and generation guards. |
| Pairing | Eight-character code, machine-name default, muted-mic explanation, keyboard/touch/DPI layout. Per-device DPAPI CurrentUser behind injected interfaces. |
| Call detection | Capture-side IAudioSessionManager2 on MTA, Zoom/Teams/WebView2/browser process ancestry. Process names and timestamps only in logs. No playback-level trigger. |
| Automation | Calendar windows and conservative overlap choice, late joins, twenty seconds on one observed process, back-to-back splits, inactive/manual/overrun/twelve-hour stops, saved suppression and one-hour pause. No notice. |
| Capture | WASAPI mic, approved default-render loopback fallback for NAudio 2.2.1, Windows engine resampling, shared Stopwatch and silence padding. Default endpoint reconnection. |
| WAV | PCM s16le mono 16 kHz, canonical 44-byte header, audio/wav, exact 44 + durationMs * 32 bytes. Thirty-second chunks and padded tails. |
| Outbox | Durable create/clientRef, incremental crash spool, device isolation, per-recording serialization, acknowledgment before deletion, reservation/PUT/read confirmation, stop counts, transcription backoff and restart recovery. |
| API | Built-in HTTPS origin, no bearer redirects, exact contract shapes, callId and callKind together, 429 codes and 409 handling, fail-closed revocation. |

Independent QA and UIUX source reviews pass after the final repairs.

## Authored xUnit tests (70 cases, not executed here)

| File | Cases | Coverage |
| --- | --- | --- |
| RecorderAutomationTests.cs | 27 | Calendar/unknown starts, continuous twenty seconds, process switches, playback exclusion, late joins, overlaps, ambiguity, future/same-start boundaries, inactivity, overrun, twelve-hour cap, manual-stop persistence, pause and Not this call timing. |
| CanonicalWavTests.cs | 7 | Every header field, exact length, byte order, padding, truncation, streaming writer, invalid duration, shared timeline, partial packets and late packets. |
| ProtectedTokenStoreTests.cs | 4 | Injected protector, no plaintext storage, atomic replacement, clear, blank input and protection failure preserves prior credential. |
| OutboxTests.cs | 17 | Durable create/ref restart, reservation and PUT duplicates, 429 open_recording/daily_quota, 409 busy, 503/Retry-After, revoked access, counts, empty/failed/ready states, transcription restart, Not this call arbitration, concurrent pumps and uploaded-read reconciliation. |
| RecorderApiTests.cs | 15 | Pair/create JSON, call identity pairing, portal-origin/path guards, WAV MIME, PUT duplicate confirmation, codes/Retry-After, redirect rejection and upcoming milliseconds fields. |

## Actual verification

SDK 8.0.426 and WindowsDesktop runtime are installed. Initial workload discovery
threw an installer initializer exception. MSBuildEnableWorkloadResolver=false
removed that optional discovery dependency. NuGet's user config was unreadable
in the sandbox; local CLI home, APPDATA and LOCALAPPDATA let the next restore
attempt reach the package source without changing SDK or user configuration.

```text
Core restore: exit 0.
Core Release build: exit 0, Build succeeded, 0 Warning(s), 0 Error(s).
Supplemental rebuilt package-free smoke: exit 0, 35 checks passed.
Solution restore: NU1301, unable to load https://api.nuget.org/v3/index.json.
Windows App build --no-restore: exit 1, NU1301, 0 warnings, 1 error.
xUnit test --no-restore: exit 1, NETSDK1004, test project assets missing.
```

The supplemental harness invokes the real Core library without packages, not
a replacement xUnit runner. It checked automation, WAV/timeline, protected
storage and outbox retry/restart/confirmation/quota behavior, including review
regressions. It lives only under ignored apps/recorder-tray/.build-logs/core-smoke.
Raw latest logs are core-build.log, app-build.log and xunit-attempt.log in that
ignored directory's parent. No executable or actual xUnit pass is claimed.

QA also ran the dashboard baseline: type-check passed; lint failed when
Next/OpenNext's Wrangler proxy could not spawn (EPERM). No dashboard code
was changed to address that environmental failure.

## Main-session steps and limits

Run restore/build/test/publish from apps/recorder-tray/README.md with NuGet
access. Verify pairing, startup, second instance, toasts and Stop; real
Zoom/Meet/Teams calendar and unknown calls; muted mic, both-sided transcript
and links; overlap/late join/split/pause; default device/Bluetooth/silence;
sleep/crash/offline recovery; revocation and re-pair isolation; narrow window,
DPI, Windows light/dark/high contrast UI.

NAudio 2.2.1's fallback records all default-render desktop playback during a
call. Browser mic capture is labelled Meet and cannot prove the meeting site.
An orphaned server recording without local metadata requires dashboard
resolution, since slim device reads omit its audio duration. The app retains
audio and gives actionable Open recordings status while retrying. Damaged
journals and failed old-device spools remain for operator recovery. These
Windows/hardware/live checks are not claimed. REC.0 stays open.
