using System.Diagnostics;
using Microsoft.Win32;
using TahiRecorder.App.Capture;
using TahiRecorder.App.Integration;
using TahiRecorder.Core.Api;
using TahiRecorder.Core.Audio;
using TahiRecorder.Core.Automation;
using TahiRecorder.Core.Outbox;

namespace TahiRecorder.App;

internal sealed class TrayApplicationContext : ApplicationContext
{
    private readonly Control _dispatcher = new();
    private readonly NotifyIcon _tray;
    private readonly TrayIcons _icons = new();
    private readonly WindowsNotifications _notifications;
    private readonly HostSettingsStore _settingsStore = new();
    private readonly SelectedDeviceTokenStore _tokens = new();
    private readonly RecorderApiClient _api;
    private readonly WindowsMeetingDetector _detector = new();
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 1000 };
    private static readonly TimeSpan StaleParkedLimit = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan CaptureCallLimit = TimeSpan.FromSeconds(45);
    private static readonly TimeSpan HealInterval = TimeSpan.FromSeconds(30);
    private readonly OperationGate _operations = new();
    private readonly List<ParkedCapture> _parked = [];
    private readonly object _automationGate = new();
    private readonly CaptureChunkJobs _chunkJobs = new();
    private readonly CancellationTokenSource _lifetime = new();
    private readonly TouchMenuItem _status = new("Idle") { Enabled = false };
    private readonly TouchMenuItem _start = new("Start recording now");
    private readonly TouchMenuItem _stop = new("Stop recording");
    private readonly TouchMenuItem _pause = new("Pause auto-start for 1 hour");
    private readonly TouchMenuItem _windows = new("Start with Windows");
    private readonly TouchMenuItem _signOut = new("Sign out this device");
    private readonly TouchMenuItem _localRecordings = new("Local recordings (0)");
    private readonly TouchMenuItem _audioDevices = new("Audio devices");
    private readonly TouchMenuItem _automaticAudioDevices = new("Automatic (follow meeting app)");
    private readonly TouchMenuItem _callAudioDevices = new("Call audio");
    private readonly TouchMenuItem _microphoneDevices = new("Microphone");
    private readonly TouchMenuItem _lastRecording = new("Last recording: system audio level unknown");
    private DateTimeOffset _nextRetentionUtc;
    private HostSettings _settings = new();
    private RecorderAutomation _automation = new();
    private FileOutboxStore? _store;
    private OutboxPump? _pump;
    private WindowsAudioRecorder? _capture;
    private CancellationTokenSource? _workerCancellation;
    private Task? _uploadTask;
    private Task? _calendarTask;
    private PairingForm? _pairing;
    private IReadOnlyList<UpcomingCall> _upcoming = Array.Empty<UpcomingCall>();
    private bool _paired;
    private bool _pending;
    private bool _exiting;
    private bool _captureFault;
    private bool _healDue;
    private DateTimeOffset _nextHealUtc;
    private string? _spoolDirectory;
    private bool _accessEnded;
    private string? _detail;
    private bool _meetingActive;
    private string _platform = "unknown";

    internal TrayApplicationContext(WindowsNotifications notifications)
    {
        _notifications = notifications;
        _api = new RecorderApiClient(_tokens);
        _dispatcher.CreateControl();
        _ = _dispatcher.Handle;
        var menu = new ContextMenuStrip { ShowItemToolTips = true };
        menu.Items.Add(_status);
        menu.Items.Add(_start);
        menu.Items.Add(_stop);
        menu.Items.Add(new TouchMenuItem("Open recordings", null, (_, _) => OpenRecordings()));
        menu.Items.Add(_localRecordings);
        menu.Items.Add(_audioDevices);
        menu.Items.Add(_lastRecording);
        menu.Items.Add(_pause);
        menu.Items.Add(_windows);
        menu.Items.Add(_signOut);
        menu.Items.Add(new TouchMenuItem("Quit", null, async (_, _) => await ShutdownAsync()));
        foreach (var item in menu.Items.OfType<ToolStripMenuItem>())
            item.Padding = new Padding(8, 12, 8, 12);
        _tray = new NotifyIcon
        {
            Icon = _icons[TrayState.Idle], Text = "Tahi Recorder: idle", Visible = true, ContextMenuStrip = menu
        };
        _tray.DoubleClick += (_, _) => { if (_paired) OpenRecordings(); else ShowPairing(); };
        _start.Click += async (_, _) => await InOperationAsync(async () =>
        {
            if (!_paired || _captureFault || _exiting) return;
            IReadOnlyList<RecordingAction> actions;
            lock (_automationGate) actions = _automation.ManualStart(DateTimeOffset.UtcNow, _platform);
            await ApplyActionsAsync(actions);
        });
        _stop.Click += async (_, _) => await StopManuallyAsync();
        _pause.Click += async (_, _) => await InOperationAsync(async () =>
        {
            lock (_automationGate)
            {
                _automation.PauseAutoStartForOneHour(DateTimeOffset.UtcNow);
            }
            if (!TryPersistState())
            {
                MarkFault();
                lock (_automationGate) _automation.ManualStop(DateTimeOffset.UtcNow);
                await StopCaptureAsync(_settings.ActiveCaptureRef);
            }
            RefreshTray();
        });
        _windows.Click += (_, _) =>
        {
            try { WindowsStartup.SetEnabled(!WindowsStartup.Enabled); }
            catch (Exception error) { HostLog.Error("Windows startup setting failed", error); _detail = "Could not change Windows startup."; }
            RefreshTray();
        };
        _signOut.Click += async (_, _) => await SignOutAsync();
        _localRecordings.Click += (_, _) => OpenLocalRecordings();
        _lastRecording.Click += (_, _) =>
        {
            RefreshAudioLevels();
            MessageBox.Show(_lastRecording.ToolTipText, "Last recording audio levels",
                MessageBoxButtons.OK, MessageBoxIcon.Information);
        };
        _audioDevices.DropDownItems.Add(_automaticAudioDevices);
        _audioDevices.DropDownItems.Add(_callAudioDevices);
        _audioDevices.DropDownItems.Add(_microphoneDevices);
        _automaticAudioDevices.Click += async (_, _) => await SetAudioDevicesAsync(settings => settings with
        {
            AudioDevices = new AudioDevicePreferences(), RenderEndpointName = null, CaptureEndpointName = null
        });
        _audioDevices.DropDownOpening += (_, _) => RefreshAudioDevices();
        foreach (var item in _audioDevices.DropDownItems.OfType<ToolStripMenuItem>())
            item.Padding = new Padding(8, 12, 8, 12);
        menu.Opening += (_, _) => RefreshLocalRecordings();
        // SystemEvents remembers the subscribing synchronization context. Subscribe
        // off the UI thread so suspend can wait for disk flush while the UI stays free.
        Task.Run(() =>
        {
            SystemEvents.PowerModeChanged += OnPowerModeChanged;
            SystemEvents.SessionEnding += OnSessionEnding;
        }).GetAwaiter().GetResult();
        _timer.Tick += async (_, _) => await TickAsync();
        _dispatcher.BeginInvoke(new Action(async () => await InitializeAsync()));
    }

    internal void DispatchActivation(string argument) => Post(async () =>
    {
        var values = ToastActivation.Parse(argument);
        if (!values.TryGetValue("action", out var action)) return;
        if (action == "open")
        {
            if (_paired) OpenRecordings(); else ShowPairing();
            return;
        }
        if (!values.TryGetValue("clientRef", out var identity) || !Guid.TryParse(identity, out var generation)) return;
        // A toast from an earlier recording must never stop or change a later call.
        lock (_automationGate) if (_automation.Current?.ClientRef != generation) return;
        if (action == "stop") await StopManuallyAsync(generation);
        else if (action == "unlinked") await InOperationAsync(async () =>
        {
            lock (_automationGate) if (_automation.Current?.ClientRef != generation) return;
            if (_store is not null && await _store.SetUnlinkedAsync(generation, _lifetime.Token))
            {
                lock (_automationGate) { _automation.NotThisCall(); PersistState(); }
                _detail = "Recording unlinked. Link it in the dashboard after the call.";
            }
            else
            {
                _detail = "Create already sent. Relink this recording in the dashboard.";
                Post(() => MessageBox.Show("This recording has already been created. Open recordings from the tray menu and relink it in the dashboard.",
                    "Tahi Recorder", MessageBoxButtons.OK, MessageBoxIcon.Information));
            }
            RefreshTray();
        });
    });

    private async Task InitializeAsync()
    {
        try
        {
            _settings = _settingsStore.Load();
            _automation = new RecorderAutomation(_settings.Automation);
            _tokens.SelectDevice(_settings.DeviceId);
            var token = await _tokens.LoadAsync(_lifetime.Token);
            if (token is not null && _settings.DeviceId is not null)
                await ConfigureDeviceAsync(_settings.DeviceId);
            else ShowPairing();
        }
        catch (Exception error)
        {
            HostLog.Error("Recorder initialization failed", error);
            _paired = false;
            _captureFault = true;
            // A damaged local spool is an attention error, not lost credentials.
            _detail = "Recorder needs attention. Local audio is retained. Check the local recording folder and logs.";
        }
        _timer.Start();
        RefreshTray();
    }

    private async Task ConfigureDeviceAsync(string deviceId)
    {
        Volatile.Write(ref _upcoming, Array.Empty<UpcomingCall>());
        _meetingActive = false;
        _platform = "unknown";
        _pending = false;
        _store = new FileOutboxStore(AppPaths.Outbox(deviceId));
        var spool = AppPaths.Capture(deviceId);
        _spoolDirectory = spool;
        _pump = new OutboxPump(_store, _api);
        // An incomplete session from an earlier run is finalised and stopped here, before any new capture.
        var needsAttention = await OutboxRecovery.RecoverAsync(_store, spool, _lifetime.Token,
            async (id, cancellation) => await _pump.BlockRecordingAsync(id, cancellation));
        _capture = CreateCapture();
        _pump.CreateSending += clientRef =>
        {
            lock (_automationGate)
            {
                if (_automation.Current?.ClientRef == clientRef)
                {
                    _automation.MarkCreateSent();
                    PersistState();
                }
            }
        };
        _pump.StatusChanged += status => Post(() => { _detail = status; RefreshTray(); });
        _pump.RecordingBlocked += clientRef => Post(async () =>
        {
            if (await StopForLifecycleAsync(RecordingStopReason.RecordingBlocked, clientRef))
            {
                _detail = OutboxPump.BlockedError;
                RefreshTray();
            }
        });
        _paired = true;
        _accessEnded = false;
        // Old damaged audio never blocks new meetings: every recording uses its own capture folder.
        _captureFault = false;
        _healDue = false;
        _detail = needsAttention ? "Recorder needs attention. Check local recordings and logs. Other uploads continue." : null;
        _settings = _settings with { ActiveCaptureRef = null };
        PersistState();
        _workerCancellation = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token);
        var cancellation = _workerCancellation.Token;
        var currentPump = _pump;
        _uploadTask = Task.Run(() => UploadLoopAsync(currentPump, cancellation));
        _calendarTask = Task.Run(() => CalendarLoopAsync(cancellation));
    }

    private WindowsAudioRecorder CreateCapture()
    {
        var capture = new WindowsAudioRecorder(_spoolDirectory!);
        capture.ChunkReady += (_, args) =>
        {
            var currentStore = _store;
            if (currentStore is null) return;
            _chunkJobs.Add(TransferChunkAsync(currentStore, args.Chunk));
        };
        capture.Error += (_, args) => Post(async () =>
        {
            HostLog.Write($"Capture reported an error on {args.Track}.");
            if (!args.IsFatal)
            {
                _detail = "Audio device changed or unavailable. Capture is reconnecting.";
                RefreshTray();
                return;
            }
            // Polling and device callbacks share the Core capture failure decision.
            await TickAsync();
        });
        capture.SilentSystemAudio += (_, args) =>
        {
            Post(() =>
            {
                if (!ReferenceEquals(_capture, capture) || !capture.IsRecording) return;
                RecordingPlan? plan;
                lock (_automationGate) plan = _automation.Current;
                if (plan is not null && plan.ClientRef == args.ClientRef) _notifications.SilentSystemAudio(plan);
                RefreshTray();
            });
        };
        return capture;
    }

    private sealed record ParkedCapture(WindowsAudioRecorder Recorder, Guid? ClientRef, DateTimeOffset Since, Task Done);

    /// <summary>
    /// A native device call that never returns must not own the recorder. The stuck recorder is parked,
    /// a fresh one takes over for the next meeting, and the parked session is finalised once it lets go
    /// (or by startup recovery). Mutations are locked because this runs off the UI thread.
    /// </summary>
    private void AbandonCapture(WindowsAudioRecorder stuck, Task done, bool backOffAutoStart)
    {
        lock (_automationGate)
        {
            if (_parked.All(item => !ReferenceEquals(item.Recorder, stuck)))
                _parked.Add(new ParkedCapture(stuck, _settings.ActiveCaptureRef ?? _automation.Current?.ClientRef,
                    DateTimeOffset.UtcNow, done));
            if (ReferenceEquals(_capture, stuck) && _spoolDirectory is not null)
                _capture = CreateCapture();
            _automation.StopForLifecycle(RecordingStopReason.Shutdown);
            // A wedged device must not create a new parked recorder and server recording on every retry.
            if (backOffAutoStart) _automation.DelayAutoStart(DateTimeOffset.UtcNow, RecorderAutomation.AbandonedStartDelay);
            _settings = _settings with { ActiveCaptureRef = null };
            _healDue = true;
            _nextHealUtc = DateTimeOffset.UtcNow;
            _detail = "A recording could not be closed cleanly. Recovery will retry.";
        }
        _notifications.RemoveRecording();
        TryPersistState();
        Post(RefreshTray);
    }

    /// <summary>A bounded native call. A start that finishes late is stopped, or it would record forever.</summary>
    private async Task BoundedCaptureAsync(WindowsAudioRecorder capture, string name, Func<Task> call)
    {
        var done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var finished = await BoundedNative.TryRunWithLateCleanupAsync(call, CaptureCallLimit, async () =>
        {
            // The parked session is only released once the call, and any stop it needs, has fully finished.
            // A late stop that also hangs keeps the session parked until that stop finally returns.
            try
            {
                if (name == "start")
                {
                    var stop = capture.StopAsync(CancellationToken.None);
                    if (!await BoundedNative.TryWaitAsync(stop, CaptureCallLimit))
                    {
                        _ = stop.ContinueWith(_ => done.TrySetResult(), CancellationToken.None,
                            TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
                        return;
                    }
                }
            }
            catch (Exception error) { HostLog.Error("Late start cleanup failed", error); }
            done.TrySetResult();
        }).ConfigureAwait(false);
        if (finished) return;
        HostLog.Write($"Capture {name} did not finish in time; recorder abandoned.");
        AbandonCapture(capture, done.Task, backOffAutoStart: name == "start");
        throw new TimeoutException($"Capture {name} timed out.");
    }

    /// <summary>Latches the fault and guarantees a recovery pass will clear it once the disk is writable.</summary>
    private void MarkFault()
    {
        _captureFault = true;
        ScheduleHeal();
    }

    private void ScheduleHeal()
    {
        if (_healDue) return;
        _healDue = true;
        _nextHealUtc = DateTimeOffset.UtcNow + HealInterval;
    }

    /// <summary>Retries recovery until the disk is writable. Sessions still owned by a running capture are skipped.</summary>
    private async Task HealAsync()
    {
        if (_store is null || _capture is not { } current || _spoolDirectory is null) return;
        HashSet<Guid> skip;
        // Query the recorder outside the lock: it has its own lock.
        var recording = current.IsRecording;
        lock (_automationGate)
        {
            _parked.RemoveAll(item => item.Done.IsCompleted);
            if (_automation.Current is not null || recording) return;
            if (_parked.Any(item => DateTimeOffset.UtcNow - item.Since > StaleParkedLimit))
                _detail = "Restart Tahi Recorder to finish the earlier recording.";
            // A parked session with an unknown identity cannot be excluded safely, so wait for it.
            if (_parked.Any(item => item.ClientRef is null)) return;
            skip = _parked.Select(item => item.ClientRef!.Value).ToHashSet();
        }
        try
        {
            var probe = Path.Combine(_spoolDirectory, ".write-check");
            await FileOutboxStore.AtomicWriteAsync(probe, [0], _lifetime.Token);
            File.Delete(probe);
            try { await _chunkJobs.DrainAsync(); }
            catch (Exception error) { HostLog.Error("Chunk transfer retained for recovery", error); }
            // Re-check immediately before recovery: it must never touch a live session.
            var recordingNow = current.IsRecording;
            lock (_automationGate)
            {
                if (_automation.Current is not null || recordingNow || !ReferenceEquals(_capture, current)) return;
            }
            var needsAttention = await OutboxRecovery.RecoverAsync(_store, _spoolDirectory, _lifetime.Token,
                async (id, cancellation) => await _pump!.BlockRecordingAsync(id, cancellation), skip);
            try { await current.DisposeAsync(); }
            catch (Exception error) { HostLog.Error("Previous recorder release failed", error); }
            lock (_automationGate)
            {
                _capture = CreateCapture();
                _captureFault = false;
                _healDue = _parked.Count > 0;
                if (!_parked.Any(item => DateTimeOffset.UtcNow - item.Since > StaleParkedLimit))
                    _detail = needsAttention ? "Recorder needs attention. Check local recordings and logs. Other uploads continue." : null;
            }
            HostLog.Write("Recorder recovered after a failed capture.");
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            HostLog.Error("Recorder recovery will retry", error);
        }
    }

    private async Task TransferChunkAsync(FileOutboxStore store, CapturedChunk chunk)
    {
        try
        {
            var wav = await File.ReadAllBytesAsync(chunk.FilePath, _lifetime.Token);
            await store.AddChunkAsync(chunk.ClientRef, chunk.Track, chunk.Sequence,
                chunk.StartMs, chunk.DurationMs, wav, _lifetime.Token);
            File.Delete(chunk.FilePath);
        }
        catch (Exception error)
        {
            HostLog.Error("Capture chunk transfer failed; spool retained", error);
            throw;
        }
    }

    private async Task TickAsync()
    {
        if (_exiting) return;
        var lease = _operations.TryEnter();
        var startedWith = _capture;
        if (lease is null)
        {
            return;
        }
        try
        {
            if (_paired && _healDue && DateTimeOffset.UtcNow >= _nextHealUtc)
            {
                _nextHealUtc = DateTimeOffset.UtcNow + HealInterval;
                await HealAsync();
            }
            if (DateTimeOffset.UtcNow >= _nextRetentionUtc)
            {
                await PruneLocalDataAsync();
                _nextRetentionUtc = DateTimeOffset.UtcNow.AddHours(1);
            }
            if (_paired && !_captureFault)
            {
                var capturing = _capture?.IsRecording == true;
                // Safety net: a capture that is "recording" but has stopped producing audio is finalised.
                var stalled = capturing && CaptureStallPolicy.IsStalled(true, _capture!.SinceLastPump);
                var failure = CaptureFailurePolicy.Evaluate(capturing,
                    _capture?.HasAudioGap == true, _capture?.HasPersistenceFailure == true, stalled);
                if (failure == CaptureFailureAction.DisableRecorder)
                    throw new IOException("Capture cannot persist audio.");
                var meeting = _detector.Poll();
                _meetingActive = meeting.IsActive;
                _platform = meeting.Platform;
                _capture?.UpdateAudioContext(meeting, _settings.AudioDevices ?? new AudioDevicePreferences());
                IReadOnlyList<RecordingAction> actions;
                lock (_automationGate)
                {
                    actions = _automation.Tick(DateTimeOffset.UtcNow, meeting.IsActive, meeting.Platform,
                        Volatile.Read(ref _upcoming), meeting.Platform + ":" + meeting.ProcessId, failure);
                    PersistState();
                }
                await ApplyActionsAsync(actions);
                if (actions.Any(action => action.StopReason == RecordingStopReason.CaptureGap))
                    _detail = stalled ? "Recording stopped because capture stopped making progress. Local audio is retained."
                        : "Recording stopped after an audio gap longer than 10 seconds. Local audio is retained.";
                PersistState();
            }
            RefreshTray();
        }
        catch (Exception error)
        {
            HostLog.Error("Recording automation failed", error);
            // Only a failing disk disables capture, and even that is retried by HealAsync.
            if (error is IOException or UnauthorizedAccessException) MarkFault();
            else ScheduleHeal();
            lock (_automationGate) _automation.ManualStop(DateTimeOffset.UtcNow);
            TryPersistState();
            // Only act on the recorder this tick started with; a replacement belongs to a newer session.
            try { if (ReferenceEquals(_capture, startedWith)) await StopCaptureAsync(_settings.ActiveCaptureRef); }
            catch (Exception stoppingError) { HostLog.Error("Interrupted audio retained for recovery", stoppingError); }
            TryPersistState();
            _detail = "Recorder needs attention. Local audio is retained.";
            RefreshTray();
        }
        finally { lease.Dispose(); }
    }

    private async Task PruneLocalDataAsync()
    {
        var root = Path.Combine(AppPaths.Root, "outbox");
        foreach (var folder in Directory.EnumerateDirectories(root))
        {
            var device = Path.GetFileName(folder);
            if (!Guid.TryParse(device, out _)) continue;
            var store = _store?.DirectoryPath.Equals(folder, StringComparison.OrdinalIgnoreCase) == true
                ? _store : new FileOutboxStore(folder);
            await store.PruneTerminalAsync(DateTimeOffset.UtcNow, _lifetime.Token, AppPaths.Capture(device));
        }
        HostLog.Prune();
        RefreshLocalRecordings();
    }

    private async Task ApplyActionsAsync(IReadOnlyList<RecordingAction> actions)
    {
        foreach (var action in actions)
        {
            if (_store is null || _capture is null) return;
            if (action.Kind == RecordingActionKind.Stop)
            {
                await StopCaptureAsync(action.Plan.ClientRef);
            }
            else
            {
                await _store.CreateAsync(new CreateRecordingRequest(action.Plan.ClientRef, action.Plan.Title,
                    ["mic", "system"], action.Plan.Call?.Kind, action.Plan.Call?.Id), _lifetime.Token);
                _settings = _settings with { ActiveCaptureRef = action.Plan.ClientRef };
                PersistState();
                _notifications.Recording(action.Plan);
                var starting = _capture;
                try
                {
                    starting.UpdateAudioContext(_detector.Poll(), _settings.AudioDevices ?? new AudioDevicePreferences());
                    await BoundedCaptureAsync(starting, "start",
                        () => starting.StartAsync(action.Plan.ClientRef.ToString("D"), _lifetime.Token));
                }
                catch
                {
                    try
                    {
                        if (ReferenceEquals(_capture, starting))
                            await BoundedCaptureAsync(starting, "stop", () => starting.StopAsync(_lifetime.Token));
                    }
                    catch (Exception error) { HostLog.Error("Interrupted startup capture retained", error); }
                    lock (_automationGate) _automation.ManualStop(DateTimeOffset.UtcNow);
                    if (ReferenceEquals(_capture, starting))
                    {
                        // Seal the failed session so a stale active ref never excludes it from recovery.
                        // Audio already on disk is left to recovery, which seals with the real duration.
                        if (HasSpooledAudio(action.Plan.ClientRef))
                            ScheduleHeal();
                        else
                        {
                            try { await _store.StopAsync(action.Plan.ClientRef, 0, _lifetime.Token); }
                            catch (Exception error) { HostLog.Error("Failed start could not be sealed", error); }
                        }
                        lock (_automationGate) _settings = _settings with { ActiveCaptureRef = null };
                    }
                    TryPersistState();
                    _notifications.RemoveRecording();
                    throw;
                }
                _detail = null;
            }
        }
        RefreshTray();
    }

    private void OnPowerModeChanged(object sender, PowerModeChangedEventArgs args)
    {
        if (args.Mode == PowerModes.Suspend) StopForSystemEvent(RecordingStopReason.SystemSuspend);
    }

    private void OnSessionEnding(object sender, SessionEndingEventArgs args) =>
        StopForSystemEvent(RecordingStopReason.SessionEnding);

    private void StopForSystemEvent(RecordingStopReason reason)
    {
        try { StopForLifecycleAsync(reason).GetAwaiter().GetResult(); }
        catch (Exception error) { HostLog.Error("System event retained interrupted capture", error); }
    }

    private async Task<bool> StopForLifecycleAsync(RecordingStopReason reason, Guid? expectedClientRef = null)
    {
        var lease = await _operations.EnterAsync().ConfigureAwait(false);
        try
        {
            Guid? clientRef;
            lock (_automationGate)
            {
                clientRef = _automation.Current?.ClientRef ?? _settings.ActiveCaptureRef;
                if (expectedClientRef is not null && clientRef != expectedClientRef) return false;
                if (reason == RecordingStopReason.RecordingBlocked)
                    _automation.StopForBlockedRecording(DateTimeOffset.UtcNow);
                else
                    _automation.StopForLifecycle(reason);
            }
            if (reason == RecordingStopReason.RecordingBlocked) _detail = OutboxPump.BlockedError;
            await StopCaptureAsync(clientRef).ConfigureAwait(false);
            if (!TryPersistState()) MarkFault();
            Post(RefreshTray);
            return true;
        }
        finally { lease.Dispose(); }
    }

    private Task StopManuallyAsync(Guid? generation = null) => InOperationAsync(async () =>
    {
        IReadOnlyList<RecordingAction> actions;
        lock (_automationGate)
        {
            if (generation is not null && _automation.Current?.ClientRef != generation) return;
            actions = _automation.ManualStop(DateTimeOffset.UtcNow);
            // Persist suppression before capture or network work can be interrupted.
            if (!TryPersistState()) MarkFault();
        }
        await ApplyActionsAsync(actions);
        if (actions.Count == 0 && (_capture?.IsRecording == true || _settings.ActiveCaptureRef is not null))
            await StopCaptureAsync(_settings.ActiveCaptureRef);
        TryPersistState();
    });

    private async Task StopCaptureAsync(Guid? clientRef)
    {
        var capture = _capture;
        if (capture is null || _store is null) return;
        // Physical capture stops before any fallible settings/outbox write. A stuck stop is abandoned, not awaited forever.
        await BoundedCaptureAsync(capture, "stop", () => capture.StopAsync(_lifetime.Token)).ConfigureAwait(false);
        if (capture.IsPoisoned && ReferenceEquals(_capture, capture) && _spoolDirectory is not null)
        {
            // Its pump outlived the stop, so it is never reused. It cannot start new sources (the stopping flag),
            // and it is disposed in the background with a time limit.
            lock (_automationGate) _capture = CreateCapture();
            _ = BoundedNative.TryWaitAsync(capture.DisposeAsync().AsTask(), CaptureCallLimit);
        }
        var levels = capture.AudioLevels;
        if (levels.HasRecording)
        {
            lock (_automationGate) _settings = _settings with { LastAudioLevels = levels };
        }
        _notifications.RemoveRecording();
        _pending = true;
        // Outbox draining may wait on a network operation. Show the physical stop immediately.
        Post(RefreshTray);
        await _chunkJobs.DrainAsync().ConfigureAwait(false);
        if (!capture.LastStopCompleted && clientRef is not null)
        {
            _healDue = true;
            throw new IOException("Capture tail remains local and must be recovered before stop.");
        }
        if (clientRef is not null && await _store.ContainsAsync(clientRef.Value, _lifetime.Token).ConfigureAwait(false))
            await _store.StopAsync(clientRef.Value, capture.LastDurationMs, _lifetime.Token).ConfigureAwait(false);
        _settings = _settings with { ActiveCaptureRef = null };
        PersistState();
    }

    private async Task UploadLoopAsync(OutboxPump pump, CancellationToken cancellation)
    {
        while (!cancellation.IsCancellationRequested)
        {
            try
            {
                await pump.PumpOnceAsync(cancellation);
                var pending = await pump.HasPendingAsync(cancellation);
                Post(() => { _pending = pending; RefreshTray(); });
                if (pump.AuthenticationRequired)
                {
                    Post(HandleAccessEndedAsync);
                    return;
                }
                await Task.Delay(TimeSpan.FromSeconds(1), cancellation);
            }
            catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { return; }
            catch (Exception error)
            {
                HostLog.Error("Outbox upload delayed", error);
                Post(() => { _detail = "Upload delayed. Audio is saved for retry."; RefreshTray(); });
                try { await Task.Delay(TimeSpan.FromSeconds(10), cancellation); }
                catch (OperationCanceledException) { return; }
            }
        }
    }

    private async Task CalendarLoopAsync(CancellationToken cancellation)
    {
        while (!cancellation.IsCancellationRequested)
        {
            try
            {
                var calls = await _api.UpcomingCallsAsync(cancellation);
                Volatile.Write(ref _upcoming, calls);
            }
            catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { return; }
            catch (RecorderApiException error) when (error.IsAuthenticationFailure)
            {
                Post(HandleAccessEndedAsync);
                return;
            }
            catch (Exception error) { HostLog.Error("Upcoming calls refresh delayed", error); }
            try { await Task.Delay(TimeSpan.FromSeconds(30), cancellation); }
            catch (OperationCanceledException) { return; }
        }
    }

    private async Task HandleAccessEndedAsync()
    {
        if (_accessEnded || _exiting) return;
        _accessEnded = true;
        _paired = false;
        await StopForLifecycleAsync(RecordingStopReason.Shutdown);
        await StopWorkersAsync();
        Volatile.Write(ref _upcoming, Array.Empty<UpcomingCall>());
        _detail = "Device access ended. Pair again for new recordings. Previous audio is retained.";
        RefreshTray();
        ShowPairing();
    }

    private void ShowPairing()
    {
        if (_exiting || _captureFault) return;
        if (_pairing is { IsDisposed: false }) { _pairing.Activate(); return; }
        _pairing = new PairingForm(_api, async response =>
        {
            var lease = await _operations.EnterAsync(_lifetime.Token);
            try
            {
                await StopWorkersAsync();
                if (_capture is not null) { await _capture.StopAsync(_lifetime.Token); await _capture.DisposeAsync(); _capture = null; }
                // Old jobs capture their old store. Drain them before selecting a new device.
                try { await _chunkJobs.DrainAsync(); }
                catch (Exception error) { HostLog.Error("Previous device capture files retained for recovery", error); }
                await _tokens.SaveForDeviceAsync(response.Device.Id, response.Token, _lifetime.Token);
                lock (_automationGate)
                {
                    var nextSettings = _settings with
                    {
                        DeviceId = response.Device.Id, DeviceName = response.Device.Name,
                        ActiveCaptureRef = null, Automation = _automation.ExportState()
                    };
                    _settingsStore.Save(nextSettings);
                    _settings = nextSettings;
                }
                _tokens.SelectDevice(response.Device.Id);
                await ConfigureDeviceAsync(response.Device.Id);
                RefreshTray();
            }
            finally { lease.Dispose(); }
        });
        _pairing.Show();
    }

    private async Task SignOutAsync()
    {
        _paired = false;
        await StopManuallyAsync();
        await InOperationAsync(async () =>
        {
            await StopWorkersAsync();
            if (_capture is not null) await _capture.StopAsync(_lifetime.Token);
            await _tokens.ClearAsync(_lifetime.Token);
            _detail = "Signed out. Existing local audio is retained for the previous device.";
            RefreshTray();
            ShowPairing();
        });
    }

    private async Task StopWorkersAsync()
    {
        _workerCancellation?.Cancel();
        var tasks = new[] { _uploadTask, _calendarTask }.OfType<Task>().ToArray();
        try { await Task.WhenAll(tasks); }
        catch (OperationCanceledException) { }
        _workerCancellation?.Dispose();
        _workerCancellation = null;
        _uploadTask = _calendarTask = null;
    }

    private async Task ShutdownAsync()
    {
        if (_exiting) return;
        _exiting = true;
        _timer.Stop();
        // Quit must work even when a native device call is hung: give the flush a bound, then force the gate.
        try
        {
            if (!await BoundedNative.TryWaitAsync(StopForLifecycleAsync(RecordingStopReason.Shutdown), CaptureCallLimit))
            {
                HostLog.Write("Shutdown flush timed out; interrupted audio stays local for recovery.");
                _operations.TryBreakIfStuck(TimeSpan.Zero);
            }
        }
        catch (Exception error)
        {
            // A failed flush must not stop Quit: the audio is retained and startup recovery finishes it.
            HostLog.Error("Shutdown flush failed; interrupted audio stays local for recovery", error);
            _operations.TryBreakIfStuck(TimeSpan.Zero);
        }
        var lease = await _operations.EnterAsync();
        try
        {
            await StopWorkersAsync();
            _lifetime.Cancel();
            if (_capture is not null)
                await BoundedNative.TryWaitAsync(_capture.DisposeAsync().AsTask(), CaptureCallLimit);
            _pairing?.Close();
            _tray.Visible = false;
            ExitThread();
        }
        catch (Exception error) { HostLog.Error("Shutdown retained interrupted capture", error); ExitThread(); }
        finally { lease.Dispose(); }
    }

    private bool HasSpooledAudio(Guid clientRef)
    {
        if (_spoolDirectory is null) return false;
        try
        {
            var folder = Path.Combine(_spoolDirectory, clientRef.ToString("D"));
            return Directory.Exists(folder)
                && (Directory.EnumerateFiles(folder, "*.pcm").Any() || Directory.EnumerateFiles(folder, "*.wav").Any());
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return true; }
    }

    private async Task InOperationAsync(Func<Task> work)
    {
        var lease = await _operations.EnterAsync();
        try { await work(); }
        catch (Exception error)
        {
            HostLog.Error("Tray action failed", error);
            if (error is IOException or UnauthorizedAccessException) _captureFault = true;
            ScheduleHeal();
            _detail = "Action could not finish. Local audio is retained.";
            RefreshTray();
        }
        finally { lease.Dispose(); }
    }

    private void PersistState()
    {
        lock (_automationGate)
        {
            _settings = _settings with { Automation = _automation.ExportState() };
            _settingsStore.Save(_settings);
        }
    }

    private bool TryPersistState()
    {
        try { PersistState(); return true; }
        catch (Exception error)
        {
            HostLog.Error("Recorder settings could not be saved", error);
            _detail = "Settings could not be saved. Check disk space and folder access.";
            return false;
        }
    }

    private void RefreshTray()
    {
        RecordingPlan? current;
        bool paused;
        lock (_automationGate) { current = _automation.Current; paused = _automation.IsPaused(DateTimeOffset.UtcNow); }
        var waiting = _paired && !paused && (_meetingActive || Volatile.Read(ref _upcoming).Count > 0);
        var state = current is not null ? TrayState.Recording : !_paired ? TrayState.Idle
            : _pending ? TrayState.Uploading : waiting ? TrayState.Waiting : TrayState.Idle;
        var label = _captureFault ? "Recorder needs attention. Local audio is retained."
            : current is not null ? "Recording: " + current.Title
            : !_paired ? "Idle: device needs pairing" : paused ? $"Idle: auto-start paused until {_automation.PausedUntil?.ToLocalTime():t}"
            : state == TrayState.Uploading ? "Uploading: audio saved locally"
            : state == TrayState.Waiting ? "Waiting: watching for a meeting capture session" : "Idle";
        if (_detail is not null) label += ". " + _detail;
        _status.Text = label.Length > 72 ? label[..69] + "..." : label;
        _status.ToolTipText = label;
        var tooltip = "Tahi Recorder: " + (_captureFault ? "needs attention" : state.ToString().ToLowerInvariant());
        _tray.Text = tooltip[..Math.Min(tooltip.Length, 63)];
        _tray.Icon = _icons[state];
        _start.Enabled = _paired && !_captureFault && current?.IsAutomatic != true && !_exiting;
        _stop.Enabled = true;
        _pause.Enabled = _paired && !_exiting;
        _signOut.Enabled = _settings.DeviceId is not null && !_exiting;
        _windows.Checked = WindowsStartup.Enabled;
        _audioDevices.Enabled = !_exiting;
        RefreshAudioLevels();
    }

    private Task SetAudioDevicesAsync(Func<HostSettings, HostSettings> change) =>
        InOperationAsync(() =>
        {
            var previous = _settings;
            lock (_automationGate)
            {
                _settings = change(_settings);
                if (!TryPersistState())
                {
                    _settings = previous;
                    RefreshTray();
                    return Task.CompletedTask;
                }
            }
            _capture?.UpdateAudioContext(_detector.Poll(), _settings.AudioDevices ?? new AudioDevicePreferences());
            _detail = "Audio device choice saved.";
            RefreshTray();
            return Task.CompletedTask;
        });

    private void RefreshAudioDevices()
    {
        var preferences = _settings.AudioDevices ?? new AudioDevicePreferences();
        _automaticAudioDevices.Checked = preferences.RenderEndpointId is null && preferences.CaptureEndpointId is null;
        try
        {
            var endpoints = WindowsAudioDevices.Enumerate();
            PopulateAudioDeviceMenu(_callAudioDevices, endpoints.Where(endpoint => endpoint.Flow == AudioEndpointFlow.Render),
                preferences.RenderEndpointId, _settings.RenderEndpointName, render: true);
            PopulateAudioDeviceMenu(_microphoneDevices, endpoints.Where(endpoint => endpoint.Flow == AudioEndpointFlow.Capture),
                preferences.CaptureEndpointId, _settings.CaptureEndpointName, render: false);
        }
        catch (Exception error)
        {
            HostLog.Error("Audio device menu refresh failed", error);
            PopulateAudioDeviceMenu(_callAudioDevices, [], preferences.RenderEndpointId, _settings.RenderEndpointName, render: true);
            PopulateAudioDeviceMenu(_microphoneDevices, [], preferences.CaptureEndpointId, _settings.CaptureEndpointName, render: false);
        }
    }

    private void PopulateAudioDeviceMenu(TouchMenuItem menu, IEnumerable<AudioEndpointSnapshot> endpoints,
        string? selectedId, string? selectedName, bool render)
    {
        foreach (var item in menu.DropDownItems.OfType<ToolStripItem>().ToArray()) item.Dispose();
        menu.DropDownItems.Clear();
        var automatic = new TouchMenuItem("Automatic (follow meeting app)") { Checked = selectedId is null };
        automatic.Click += async (_, _) => await SelectAudioDeviceAsync(render, null, null);
        menu.DropDownItems.Add(automatic);
        var devices = endpoints.OrderBy(endpoint => endpoint.Name, StringComparer.OrdinalIgnoreCase).ToArray();
        foreach (var device in devices)
        {
            var item = new TouchMenuItem(device.Name.Replace("&", "&&"))
            {
                Checked = string.Equals(selectedId, device.Id, StringComparison.Ordinal),
                ToolTipText = device.Name
            };
            item.Click += async (_, _) => await SelectAudioDeviceAsync(render, device.Id, device.Name);
            menu.DropDownItems.Add(item);
        }
        if (selectedId is not null && devices.All(device => !string.Equals(device.Id, selectedId, StringComparison.Ordinal)))
        {
            menu.DropDownItems.Add(new TouchMenuItem((selectedName ?? "Selected device").Replace("&", "&&") + " (disconnected)")
            {
                Checked = true,
                Enabled = false,
                ToolTipText = "Reconnect this device, choose another, or select Automatic. This track stays silent while the selected device is unavailable."
            });
        }
        if (devices.Length == 0)
            menu.DropDownItems.Add(new TouchMenuItem("No active devices") { Enabled = false });
        foreach (var item in menu.DropDownItems.OfType<ToolStripMenuItem>())
            item.Padding = new Padding(8, 12, 8, 12);
    }

    private Task SelectAudioDeviceAsync(bool render, string? endpointId, string? endpointName) =>
        SetAudioDevicesAsync(settings =>
        {
            var preferences = settings.AudioDevices ?? new AudioDevicePreferences();
            return render
                ? settings with { AudioDevices = preferences with { RenderEndpointId = endpointId }, RenderEndpointName = endpointName }
                : settings with { AudioDevices = preferences with { CaptureEndpointId = endpointId }, CaptureEndpointName = endpointName };
        });

    private void RefreshAudioLevels()
    {
        var captured = _capture?.AudioLevels;
        var levels = captured?.HasRecording == true ? captured : _settings.LastAudioLevels;
        _lastRecording.Text = levels?.HasRecording != true ? "Last recording: system audio level unknown"
            : "Last recording: system audio level " + (levels.SystemAudioOk ? "OK" : "silent");
        _lastRecording.ToolTipText = levels?.HasRecording != true ? "Record a call to measure both audio tracks."
            : $"System peak: {levels.SystemPeak:P2}. Microphone peak: {levels.MicrophonePeak:P2}. Microphone level: {(levels.MicrophoneAudioOk ? "OK" : "silent")}.";
    }

    private void OpenRecordings()
    {
        try { Process.Start(new ProcessStartInfo(RecorderApiClient.PortalOrigin + "/calls/record") { UseShellExecute = true }); }
        catch (Exception error) { HostLog.Error("Recordings page launch failed", error); }
    }

    private void Post(Action action)
    {
        if (_dispatcher.IsDisposed) return;
        try { _dispatcher.BeginInvoke(action); }
        catch (InvalidOperationException) { }
    }

    private void Post(Func<Task> action) => Post(new Action(async () =>
    {
        try { await action(); }
        catch (Exception error)
        {
            HostLog.Error("Background tray action failed", error);
            _detail = "Recorder needs attention. Local audio is retained.";
            RefreshTray();
        }
    }));

    private void RefreshLocalRecordings()
    {
        try
        {
            var outbox = Path.Combine(AppPaths.Root, "outbox");
            var count = Directory.EnumerateFiles(outbox, "recording.json", SearchOption.AllDirectories).Count();
            _localRecordings.Text = $"Local recordings ({count})";
        }
        catch (Exception error) { HostLog.Error("Local recording count unavailable", error); }
    }

    private void OpenLocalRecordings()
    {
        try { Process.Start(new ProcessStartInfo(AppPaths.Root) { UseShellExecute = true }); }
        catch (Exception error) { HostLog.Error("Local recording folder launch failed", error); }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            SystemEvents.PowerModeChanged -= OnPowerModeChanged;
            SystemEvents.SessionEnding -= OnSessionEnding;
            _lifetime.Cancel();
            _timer.Dispose();
            _tray.ContextMenuStrip?.Dispose();
            _tray.Dispose();
            _icons.Dispose();
            _detector.Dispose();
            _api.Dispose();
            _dispatcher.Dispose();
            _lifetime.Dispose();
        }
        base.Dispose(disposing);
    }
}

internal sealed class TouchMenuItem(string text, Image? image = null, EventHandler? clicked = null)
    : ToolStripMenuItem(text, image, clicked)
{
    public override Size GetPreferredSize(Size constrainingSize)
    {
        var preferred = base.GetPreferredSize(constrainingSize);
        var dpi = Owner?.DeviceDpi ?? 96;
        preferred.Height = Math.Max(preferred.Height, (44 * dpi + 95) / 96);
        return preferred;
    }
}
