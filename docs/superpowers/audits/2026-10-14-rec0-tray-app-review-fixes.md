# Windows tray recorder review repairs, 2026-10-14

Started with clean git status on feat/rec0-tray-app at 8665e762. All review
repairs remain uncommitted. No dashboard code, framework target, secret,
production data, pairing, commit, push or deployment changed.

Paths in the table are relative to apps/recorder-tray.

| Finding | Implementation and test evidence |
| --- | --- |
| M1 protected data | TahiRecorder.Core/Security/RecorderDirectorySecurity.cs:20 builds the protected current-user/SYSTEM/Administrators FullControl OI/CI ACL; :66 validates ownership and existing ACEs before applying it; :106 removes descendant explicit ACEs and enables inheritance. TahiRecorder.App/AppPaths.cs:19 applies every start. TahiRecorder.Core.Tests/RecorderDirectorySecurityTests.cs:14 tests the exact ACL and unsafe variants. |
| M2 safe install | TahiRecorder.App/Security/WindowsInstallSecurity.cs:11 checks directory and executable ACLs, including generic write grants. TahiRecorder.App/Program.cs:28 gates registration. WindowsStartup.cs:23, WindowsNotifications.cs:23 and StartMenuShortcut.cs:12 repeat guards at mutation boundaries. README.md:37 requires Program Files installation and forbids running from the repo. |
| L1 poison isolation | TahiRecorder.Core/Outbox/OutboxPump.cs:84 catches per-recording exceptions; :117 writes fixed blocked error. TahiRecorder.Core.Tests/OutboxTests.cs:179 proves off-origin A is blocked and B uploads. OutboxRecovery.cs:8 isolates startup failures; OutboxRecoveryTests.cs:13 covers damaged manifest/spool A and valid B. |
| L2 single instance | TahiRecorder.App/Program.cs:22 catches mutex startup failure with a tray error; Integration/SingleInstance.cs:25 disposes failed mutex, :68 adds CurrentUserOnly to client pipe, :53 keeps listener looping after access denial. |
| L3 retention and folder | TahiRecorder.Core/Outbox/FileOutboxStore.cs:129 prunes ready/failed manifests and capture/outbox audio after seven days, preserving manifest until audio cleanup succeeds. TahiRecorder.App/AppPaths.cs:35 rotates logs after fourteen days; TrayApplicationContext.cs:301 runs retention hourly, :33 adds Local recordings (n), :657 opens the folder. |
| Info drawing package | TahiRecorder.App/TahiRecorder.App.csproj:22 explicitly references System.Drawing.Common 8.0.0. Package restore is the remaining gate blocker described below. |
| P1-1 toast actions | TahiRecorder.Core/Automation/ToastActivation.cs:7 uses ToastArguments.Parse; TrayApplicationContext.cs:121 consumes it. ToastActivationTests.cs:11 round-trips actual ToastContentBuilder button arguments and preserves pipe action=open. |
| P1-2 manual capture | TahiRecorder.Core/Automation/RecorderAutomation.cs:108 tracks meeting sessions; :176 resets stale inactivity at ManualStart. Inactivity requires a session seen during recording; a new actual session stops manual capture without calendar splitting. RecorderAutomationTests.cs:163 and :213 cover these transitions. |
| P1-3 transcription cadence | TahiRecorder.Core/Outbox/OutboxPump.cs:73 resets polls on progress and schedules one second; TrayApplicationContext.cs:432 honors it. OutboxTests.cs:201 uses a fake TimeProvider. |
| P2-1 Communications devices | TahiRecorder.App/Capture/WindowsAudioRecorder.cs:115 selects Communications capture/render; :401 ignores default changes for other roles. |
| P2-2 split guard | TahiRecorder.Core/Automation/RecorderAutomation.cs:123 prevents calendar splitting while paused or manual. RecorderAutomationTests.cs:190 covers both. |
| P2-3 nearby suppression | TahiRecorder.Core/Automation/RecorderAutomation.cs:265 suppresses calendar windows opening within fifteen minutes on the same saved session key, inclusive. RecorderAutomationTests.cs:361 exercises boundaries, restore and different sessions. |
| Early join | TahiRecorder.Core/Automation/RecorderAutomation.cs:167 waits when a calendar window opens within ten minutes, then creates linked at start minus two minutes. RecorderAutomationTests.cs:243 proves no unlinked fragment. |
| P2-4 failed retries | TahiRecorder.Core/Outbox/OutboxPump.cs:222 allows three failed-state retries with persisted counters and backoff. OutboxTests.cs:110 verifies exhaustion and recovery. |
| P2-5 portable spool | TahiRecorder.Core/Audio/DurableCaptureSpool.cs:16 owns padding/chunking/recovery; :197 recovers crashes. CaptureSpoolTests.cs:11 covers gaps, late packets, tails, exact bytes, crash recovery and damaged journals. Unused PcmTimelineBuffer.cs and redundant tests were removed. |
| P2-6 lifecycle and gap | TahiRecorder.App/TrayApplicationContext.cs:108 subscribes SystemEvents off the UI thread; :348 handles suspend/session ending, :354 flushes without manual suppression. RecorderAutomation.cs:199 exposes lifecycle stop. DurableCaptureSpool.cs:71 caps missing audio at ten seconds; WindowsAudioRecorder.cs:370 preserves the capped stop duration. |
| P2-7 small final tail | TahiRecorder.Core/Audio/DurableCaptureSpool.cs:104 retains the previous chunk, :118 folds a final tail under two seconds. CaptureSpoolTests.cs:44 checks exact header/size and server duration limits. |
| P2-8 release open slot | TahiRecorder.Core/Outbox/OutboxPump.cs:131 attempts server stop on blocking, :142 supplies enabled-track counts even before the second track uploads. OutboxTests.cs:179 enforces the real server's track rules. Recovery calls BlockRecordingAsync at :19. |
| P3 overrun age | TahiRecorder.Core/Automation/RecorderAutomation.cs:115 requires five seconds of inactivity. RecorderAutomationTests.cs:148 tests the boundary. |
| P3 settings writes | TahiRecorder.App/HostSettings.cs:33 compares persisted serialized state and skips unchanged settings writes. |
| P3 created sequence | TahiRecorder.Core/Outbox/FileOutboxStore.cs:10 persists CreatedSequence; :125 orders by it; :190 advances the durable sequence counter. OutboxTests.cs covers ordering despite changed file timestamps and restart. |
| P3 permanent conflict | TahiRecorder.Core/Api/Contracts.cs:34 makes absent/blank-code 409 terminal. OutboxTests.cs:246 covers null, empty and whitespace codes. |
| P3 damaged spool | TahiRecorder.Core/Outbox/OutboxRecovery.cs:8 retains damaged data, marks attention and lets other uploads run. TahiRecorder.App/TrayApplicationContext.cs:223 disables capture with needs attention; :479 prevents reopening pairing for that fault; :604 prioritizes attention in tray status. |
| P3 stale documentation | README.md:6, STATUS.md:10, TASKS.md:1342 and DECISIONS.md:1677 now identify committed baseline 8665e762, baseline zero warnings/passing tests, and uncommitted review repairs. Real Windows/call proof remains pending. |

## Verification

All 123 xUnit cases passed in Release. Root ran the suite serially after agent
work finished. The first test run identified an ACL filesystem integration
probe incompatible with the restricted Windows token and two cases compiled
before concurrent edits finished. The ACL test now exercises the pure builder
and descendant rule transformation without filesystem privileges. A later
generic-rights test fixture used an unsupported FileSystemAccessRule constructor;
it was corrected to use a real SDDL descriptor. Final run:

```text
Test run for TahiRecorder.Core.Tests.dll (.NETCoreApp,Version=v8.0)
VSTest version 17.11.1 (x64)
A total of 1 test files matched the specified pattern.
Passed! - Failed: 0, Passed: 123, Skipped: 0, Total: 123, Duration: 1 s
Exit code: 0
```

The required solution Release build is blocked. The supplied package cache
contains Drawing.Common 4.7.0 but not the newly required 8.0.0 package or its
SystemEvents 8.0.0 dependency. Sandbox NuGet access is refused at its configured
proxy. The missing package was requested from Liam through the asynchronous
input tool. No package contents or assets were fabricated, and the real
PackageReference remains pinned at 8.0.0.

```text
dotnet build TahiRecorder.sln -c Release --no-restore -m:1
error NU1101: Unable to find package System.Drawing.Common.
Failed to download package System.Drawing.Common.8.0.0.
No connection could be made because the target machine actively refused it.
Build FAILED.
3 Warning(s)
2 Error(s)
Exit code: 1
```

A supplemental ignored host-source project compiled the exact current App/Core
sources against the already cached dependencies, with only the missing new
Drawing PackageReference omitted in that scratch project. The actual project
is unchanged. This catches host compilation errors but is not the required
solution/dependency gate:

```text
HostSourceQa -> net8.0-windows10.0.17763.0/win-x64/HostSourceQa.dll
Build succeeded.
0 Warning(s)
0 Error(s)
Exit code: 0
```

Raw logs are ignored under apps/recorder-tray/.build-logs: review-build.log,
review-host-source-build.log, review-tests-final-pass.log and
review-tests-final-pass.trx. Independent QA and UIUX source reviews found and
verified repairs for cadence, lifecycle synchronization, startup poison
isolation, server stop counts and attention wording. No native app, toast,
audio hardware, suspend/session ending or real call was launched. No live
validation is claimed.

After the two new packages are restored, rerun the actual solution Release
build and full test suite with --no-restore. REC.0 remains open.
