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
    private readonly SemaphoreSlim _operations = new(1, 1);
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
        var menu = new ContextMenuStrip();
        menu.Items.Add(_status);
        menu.Items.Add(_start);
        menu.Items.Add(_stop);
        menu.Items.Add(new TouchMenuItem("Open recordings", null, (_, _) => OpenRecordings()));
        menu.Items.Add(_localRecordings);
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
                _captureFault = true;
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
        _pump = new OutboxPump(_store, _api);
        var needsAttention = await OutboxRecovery.RecoverAsync(_store, spool, _lifetime.Token,
            async (id, cancellation) => await _pump.BlockRecordingAsync(id, cancellation));
        _capture = new WindowsAudioRecorder(spool);
        _capture.ChunkReady += (_, args) =>
        {
            var currentStore = _store;
            if (currentStore is null) return;
            _chunkJobs.Add(TransferChunkAsync(currentStore, args.Chunk));
        };
        _capture.Error += (_, args) => Post(async () =>
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
        _captureFault = needsAttention;
        _detail = needsAttention ? "Recorder needs attention. Check local recordings and logs. Other uploads continue." : null;
        _settings = _settings with { ActiveCaptureRef = null };
        PersistState();
        _workerCancellation = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token);
        var cancellation = _workerCancellation.Token;
        var currentPump = _pump;
        _uploadTask = Task.Run(() => UploadLoopAsync(currentPump, cancellation));
        _calendarTask = Task.Run(() => CalendarLoopAsync(cancellation));
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
        if (_exiting || !await _operations.WaitAsync(0)) return;
        try
        {
            if (DateTimeOffset.UtcNow >= _nextRetentionUtc)
            {
                await PruneLocalDataAsync();
                _nextRetentionUtc = DateTimeOffset.UtcNow.AddHours(1);
            }
            if (_paired && !_captureFault)
            {
                var failure = CaptureFailurePolicy.Evaluate(_capture?.IsRecording == true,
                    _capture?.HasAudioGap == true, _capture?.HasPersistenceFailure == true);
                if (failure == CaptureFailureAction.DisableRecorder)
                    throw new IOException("Capture cannot persist audio.");
                var meeting = _detector.Poll();
                _meetingActive = meeting.IsActive;
                _platform = meeting.Platform;
                IReadOnlyList<RecordingAction> actions;
                lock (_automationGate)
                {
                    actions = _automation.Tick(DateTimeOffset.UtcNow, meeting.IsActive, meeting.Platform,
                        Volatile.Read(ref _upcoming), meeting.Platform + ":" + meeting.ProcessId, failure);
                    PersistState();
                }
                await ApplyActionsAsync(actions);
                if (actions.Any(action => action.StopReason == RecordingStopReason.CaptureGap))
                    _detail = "Recording stopped after an audio gap longer than 10 seconds. Local audio is retained.";
                PersistState();
            }
            RefreshTray();
        }
        catch (Exception error)
        {
            HostLog.Error("Recording automation failed", error);
            _captureFault = true;
            lock (_automationGate) _automation.ManualStop(DateTimeOffset.UtcNow);
            TryPersistState();
            try { await StopCaptureAsync(_settings.ActiveCaptureRef); }
            catch (Exception stoppingError) { HostLog.Error("Interrupted audio retained for recovery", stoppingError); }
            TryPersistState();
            _detail = "Recorder needs attention. Local audio is retained.";
            RefreshTray();
        }
        finally { _operations.Release(); }
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
                try { await _capture.StartAsync(action.Plan.ClientRef.ToString("D"), _lifetime.Token); }
                catch
                {
                    try { await _capture.StopAsync(_lifetime.Token); }
                    catch (Exception error) { HostLog.Error("Interrupted startup capture retained", error); }
                    lock (_automationGate) _automation.ManualStop(DateTimeOffset.UtcNow);
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
        await _operations.WaitAsync().ConfigureAwait(false);
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
            _captureFault |= !TryPersistState();
            Post(RefreshTray);
            return true;
        }
        finally { _operations.Release(); }
    }

    private Task StopManuallyAsync(Guid? generation = null) => InOperationAsync(async () =>
    {
        IReadOnlyList<RecordingAction> actions;
        lock (_automationGate)
        {
            if (generation is not null && _automation.Current?.ClientRef != generation) return;
            actions = _automation.ManualStop(DateTimeOffset.UtcNow);
            // Persist suppression before capture or network work can be interrupted.
            if (!TryPersistState()) _captureFault = true;
        }
        await ApplyActionsAsync(actions);
        if (actions.Count == 0 && (_capture?.IsRecording == true || _settings.ActiveCaptureRef is not null))
            await StopCaptureAsync(_settings.ActiveCaptureRef);
        TryPersistState();
    });

    private async Task StopCaptureAsync(Guid? clientRef)
    {
        if (_capture is null || _store is null) return;
        // Physical capture stops before any fallible settings/outbox write.
        await _capture.StopAsync(_lifetime.Token).ConfigureAwait(false);
        _notifications.RemoveRecording();
        _pending = true;
        // Outbox draining may wait on a network operation. Show the physical stop immediately.
        Post(RefreshTray);
        await _chunkJobs.DrainAsync().ConfigureAwait(false);
        if (!_capture.LastStopCompleted && clientRef is not null)
        {
            _captureFault = true;
            throw new IOException("Capture tail remains local and must be recovered before stop.");
        }
        if (clientRef is not null && await _store.ContainsAsync(clientRef.Value, _lifetime.Token).ConfigureAwait(false))
            await _store.StopAsync(clientRef.Value, _capture.LastDurationMs, _lifetime.Token).ConfigureAwait(false);
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
            await _operations.WaitAsync(_lifetime.Token);
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
            finally { _operations.Release(); }
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
        await StopForLifecycleAsync(RecordingStopReason.Shutdown);
        await _operations.WaitAsync();
        try
        {
            await StopWorkersAsync();
            _lifetime.Cancel();
            if (_capture is not null) await _capture.DisposeAsync();
            _pairing?.Close();
            _tray.Visible = false;
            ExitThread();
        }
        catch (Exception error) { HostLog.Error("Shutdown retained interrupted capture", error); ExitThread(); }
        finally { _operations.Release(); }
    }

    private async Task InOperationAsync(Func<Task> work)
    {
        await _operations.WaitAsync();
        try { await work(); }
        catch (Exception error)
        {
            HostLog.Error("Tray action failed", error);
            if (error is IOException or UnauthorizedAccessException) _captureFault = true;
            _detail = "Action could not finish. Local audio is retained.";
            RefreshTray();
        }
        finally { _operations.Release(); }
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
