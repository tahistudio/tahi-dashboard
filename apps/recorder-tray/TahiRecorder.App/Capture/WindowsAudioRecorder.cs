using System.Diagnostics;
using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using TahiRecorder.Core.Audio;

namespace TahiRecorder.App.Capture;

/// <summary>WASAPI capture with one wall clock and a durable, silence-padded two-track spool.</summary>
public sealed class WindowsAudioRecorder : IAsyncDisposable
{
    private const int SampleRate = 16_000;
    private const int DeliverySlackMs = 250;
    private static readonly TimeSpan NativeReleaseTimeout = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan PumpStopTimeout = TimeSpan.FromSeconds(5);
    private readonly string _spoolDirectory;
    private readonly object _gate = new();
    private readonly SemaphoreSlim _lifecycle = new(1, 1);
    private readonly Stopwatch _clock = new();
    private readonly Dictionary<string, CaptureChannel> _channels = [];
    private readonly RenderDeviceOutagePolicy _renderOutage = new();
    private readonly RecorderAudioLevels _levels = new();
    private readonly HashSet<int> _failedProcessLoopbacks = [];
    private CaptureSpool? _spool;
    private CancellationTokenSource? _captureCancellation;
    private Task? _pump;
    private MMDeviceEnumerator? _enumerator;
    private WindowsAudioDeviceObserver? _deviceObserver;
    private MeetingObservation _meeting = MeetingObservation.Inactive;
    private MeetingObservation _meetingSource = MeetingObservation.Inactive;
    private AudioDevicePreferences _preferences = new();
    private Guid _clientRef;
    private int _selectionDirty;
    private bool _running;
    private bool _stopping;
    private bool _disposed;
    private int _reopenMic;
    private int _reopenSystem;
    private int _persistenceFailure;
    private int _audioGapStopDurationMs = -1;
    private long _lastPumpTimestamp = Stopwatch.GetTimestamp();

    public WindowsAudioRecorder(string spoolDirectory)
    {
        _spoolDirectory = Path.GetFullPath(spoolDirectory);
    }

    public event EventHandler<CapturedChunkEventArgs>? ChunkReady;
    public event EventHandler<CaptureErrorEventArgs>? Error;
    public event EventHandler<SilentSystemAudioEventArgs>? SilentSystemAudio;
    public AudioLevelSnapshot AudioLevels { get { lock (_gate) return _levels.Snapshot; } }
    public int LastDurationMs { get; private set; }
    public bool HasPersistenceFailure => Volatile.Read(ref _persistenceFailure) != 0;
    public bool HasAudioGap => Volatile.Read(ref _audioGapStopDurationMs) >= 0;
    public bool LastStopCompleted { get; private set; }
    public bool IsRecording { get { lock (_gate) return _running; } }
    /// <summary>True when a pump outlived a stop. The host must replace this recorder rather than reuse it.</summary>
    public bool IsPoisoned { get; private set; }
    public TimeSpan SinceLastPump => Stopwatch.GetElapsedTime(Interlocked.Read(ref _lastPumpTimestamp));

    private sealed class CaptureChannel(string track)
    {
        public string Track { get; } = track;
        public MMDevice? Endpoint { get; set; }
        public IWaveIn? Capture { get; set; }
        public CaptureSourceSelection? Source { get; set; }
        public AudioEndpointSelection? EndpointSelection { get; set; }
        public volatile bool Available;
        public long LastAudioEndSample { get; set; } = -1;
        public volatile bool Closing;
        public DateTimeOffset RetryAt { get; set; }
    }

    public void UpdateAudioContext(MeetingObservation observation, AudioDevicePreferences preferences)
    {
        lock (_gate)
        {
            _meeting = observation;
            if (observation.IsActive)
                _meetingSource = observation;
            _preferences = preferences;
        }
        Interlocked.Exchange(ref _selectionDirty, 1);
    }

    public async Task StartAsync(string clientRef, CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (IsPoisoned)
            throw new InvalidOperationException("This recorder must be replaced after a stuck stop.");
        if (!Guid.TryParseExact(clientRef, "D", out var parsedClientRef))
            throw new ArgumentException("Recording client reference must be a UUID.", nameof(clientRef));
        await _lifecycle.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_running)
                throw new InvalidOperationException("A recording is already active.");
            await Task.Run(() => StartCore(parsedClientRef), cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _lifecycle.Release();
        }
    }

    private void StartCore(Guid clientRef)
    {
        _spool = new CaptureSpool(_spoolDirectory, clientRef);
        _clientRef = clientRef;
        _channels["mic"] = new CaptureChannel("mic");
        _channels["system"] = new CaptureChannel("system");
        LastDurationMs = 0;
        LastStopCompleted = false;
        _renderOutage.Reset();
        lock (_gate)
        {
            _levels.Reset();
            if (!_meeting.IsActive)
                _meetingSource = MeetingObservation.Inactive;
        }
        lock (_failedProcessLoopbacks) _failedProcessLoopbacks.Clear();
        Interlocked.Exchange(ref _persistenceFailure, 0);
        Interlocked.Exchange(ref _audioGapStopDurationMs, -1);
        _clock.Restart();
        Interlocked.Exchange(ref _lastPumpTimestamp, Stopwatch.GetTimestamp());
        lock (_gate)
        {
            _running = true;
            _stopping = false;
            _levels.ShouldWarn(TimeSpan.Zero, _meeting.IsActive);
        }
        try
        {
            _enumerator = new MMDeviceEnumerator();
            _deviceObserver = new WindowsAudioDeviceObserver(() => Interlocked.Exchange(ref _selectionDirty, 1));
            ReselectChannels();
            _captureCancellation = new CancellationTokenSource();
            _pump = Task.Run(() => PumpAsync(_captureCancellation.Token));
        }
        catch
        {
            lock (_gate) _running = false;
            foreach (var channel in _channels.Values)
                CloseChannel(channel);
            _clock.Stop();
            ReleaseEnumerator();
            _spool.Dispose();
            _spool = null;
            _channels.Clear();
            throw;
        }
    }

    private void OpenChannel(CaptureChannel channel)
    {
        lock (_gate)
        {
            channel.Closing = false;
            channel.LastAudioEndSample = -1;
        }
        try
        {
            IWaveIn capture;
            if (channel.Source?.ProcessLoopbackId is { } processId)
                capture = new WindowsProcessLoopbackCapture(processId);
            else
            {
                if (channel.Source?.EndpointId is not { } endpointId)
                    throw new InvalidOperationException("The selected audio endpoint is unavailable.");
                channel.Endpoint = _enumerator!.GetDevice(endpointId);
                capture = channel.Track == "mic"
                    ? new WasapiCapture(channel.Endpoint)
                    : new WasapiLoopbackCapture(channel.Endpoint);
            }
            bool stopping;
            lock (_gate)
            {
                stopping = _stopping;
                if (!stopping) channel.Capture = capture;
            }
            if (stopping)
            {
                // A pump that outlived the stop must not start a source nobody will release.
                var lateEndpoint = channel.Endpoint;
                channel.Endpoint = null;
                if (!BoundedNative.TryRun(() => ReleaseNative(capture, lateEndpoint), NativeReleaseTimeout,
                        error => HostLog.Error("Late audio capture release failed", error)))
                    HostLog.Write($"Late audio capture release timed out on {channel.Track}; abandoned.");
                return;
            }
            // NAudio 2.2.1 sets AutoConvertPcm and SrcDefaultQuality on both capture types.
            // Windows resamples the endpoint mix format to the canonical upload format.
            capture.WaveFormat = new WaveFormat(SampleRate, 16, 1);
            capture.DataAvailable += (_, args) => OnAudio(channel, capture, args);
            capture.RecordingStopped += (_, args) => OnCaptureStopped(channel, capture, args);
            lock (_gate)
            {
                channel.Available = true;
                channel.RetryAt = DateTimeOffset.MaxValue;
            }
            capture.StartRecording();
            LogSelection(channel, unavailable: !channel.Available);
            lock (_gate)
                if (channel.Track == "system" && channel.Available)
                    _renderOutage.ObserveAvailability(isAvailable: true);
        }
        catch (Exception exception) when (exception is COMException or InvalidOperationException
            or ArgumentException or NotSupportedException or TimeoutException or DllNotFoundException
            or EntryPointNotFoundException
            // Process loopback activation can surface any HRESULT; fall back rather than stop.
            || (channel.Source?.ProcessLoopbackId is not null && exception is not OutOfMemoryException))
        {
            CloseChannel(channel);
            if (channel.Source?.ProcessLoopbackId is { } processId)
            {
                lock (_failedProcessLoopbacks) _failedProcessLoopbacks.Add(processId);
                HostLog.Error("Meeting process loopback unavailable; selecting endpoint loopback", exception);
                ReselectChannel(channel, _deviceObserver!.Snapshot);
                return;
            }
            LogSelection(channel, unavailable: true);
            channel.RetryAt = DateTimeOffset.UtcNow.AddSeconds(5);
            if (channel.Track == "mic" || _renderOutage.ObserveAvailability(isAvailable: false))
                ReportError(channel.Track, channel.Track == "mic"
                    ? "Microphone capture is unavailable. Reconnecting while preserving the recording timeline."
                    : "System audio is unavailable. Recording the microphone with system silence until the output device reconnects.");
        }
    }

    private void ReselectChannels()
    {
        if (_deviceObserver is null)
            return;
        foreach (var channel in _channels.Values)
            ReselectChannel(channel, _deviceObserver.Snapshot);
    }

    private void ReselectChannel(CaptureChannel channel, IReadOnlyList<AudioEndpointSnapshot> endpoints)
    {
        MeetingObservation meeting;
        AudioDevicePreferences preferences;
        lock (_gate) { meeting = _meetingSource; preferences = _preferences; }
        var flow = channel.Track == "mic" ? AudioEndpointFlow.Capture : AudioEndpointFlow.Render;
        var processIds = meeting.ProcessTreeIds.Count > 0 ? meeting.ProcessTreeIds
            : meeting.ProcessId is { } id ? new[] { id } : Array.Empty<int>();
        var overrideId = channel.Track == "mic" ? preferences.CaptureEndpointId : preferences.RenderEndpointId;
        // A working device is not restarted when meeting activity flaps or ends; that churn races the stop.
        var retainCurrent = channel.EndpointSelection?.Reason is AudioEndpointSelector.MeetingSessionReason
            or AudioEndpointSelector.RetainedReason;
        var selection = AudioEndpointSelector.Select(flow, endpoints, processIds, overrideId,
            channel.EndpointSelection?.EndpointId, retainCurrent);
        var rootId = meeting.ProcessTreeRootId ?? meeting.ProcessId;
        bool processFailed;
        lock (_failedProcessLoopbacks) processFailed = rootId is { } root && _failedProcessLoopbacks.Contains(root);
        var useProcessLoopback = channel.Track == "system" && overrideId is null
            && WindowsProcessLoopbackCapture.IsSupported && rootId is > 0
            && !processFailed;
        var source = useProcessLoopback ? new CaptureSourceSelection(null, rootId)
            : new CaptureSourceSelection(selection.EndpointId);
        channel.EndpointSelection = selection;
        if (channel.Source == source && !channel.Available && DateTimeOffset.UtcNow < channel.RetryAt)
            return;
        if (source.EndpointId is null && source.ProcessLoopbackId is null)
        {
            var firstUnavailableSelection = channel.Source is null || channel.Source != source
                || channel.Available;
            if (channel.Capture is not null)
                CloseChannel(channel);
            lock (_gate) channel.Source = source;
            channel.RetryAt = DateTimeOffset.UtcNow.AddSeconds(5);
            if (firstUnavailableSelection)
            {
                LogSelection(channel, unavailable: true);
                if (channel.Track == "mic" || _renderOutage.ObserveAvailability(isAvailable: false))
                    ReportError(channel.Track, channel.Track == "mic"
                        ? "Microphone capture is unavailable. Reconnecting while preserving the recording timeline."
                        : "System audio is unavailable. Recording the microphone with system silence until the output device reconnects.");
            }
            return;
        }
        if (!CaptureSwitchDecision.ShouldSwitch(channel.Source, source, channel.Available))
            return;
        // Source changes leave Stopwatch, per-track peaks, spool and chunk sequence intact.
        CloseChannel(channel);
        lock (_gate) channel.Source = source;
        OpenChannel(channel);
    }

    private static void LogSelection(CaptureChannel channel, bool unavailable = false)
    {
        var selection = channel.EndpointSelection;
        var name = selection?.Name ?? "Unavailable";
        var reason = selection?.Reason ?? "No active endpoint";
        // Endpoint friendly names only, never raw audio, device credentials or server responses.
        name = name.Replace('\r', ' ').Replace('\n', ' ');
        var source = channel.Source?.ProcessLoopbackId is { } processId
            ? $"meeting process tree pid={processId}; render endpoint={name}; endpoint reason={reason}"
            : $"endpoint={name}; reason={reason}";
        HostLog.Write($"Audio selection track={channel.Track}; source={source}; available={!unavailable}.");
    }

    private void OnAudio(CaptureChannel channel, IWaveIn source, WaveInEventArgs args)
    {
        if (args.BytesRecorded <= 0)
            return;
        try
        {
            lock (_gate)
            {
                if (!_running || _spool is null || channel.Closing || !ReferenceEquals(channel.Capture, source)
                    || HasPersistenceFailure || HasAudioGap)
                    return;
                var byteCount = args.BytesRecorded - args.BytesRecorded % 2;
                var samples = byteCount / 2;
                _levels.ObservePcm(channel.Track, args.Buffer.AsSpan(0, byteCount), _clock.Elapsed);
                var nowSample = _clock.ElapsedTicks * SampleRate / Stopwatch.Frequency;
                var startSample = Math.Max(0, nowSample - samples);
                // Small callback scheduling jitter does not open a false gap in a live stream.
                // Large gaps, including loopback silence and reconnects, keep their wall-clock position.
                if (channel.LastAudioEndSample >= 0 && startSample - channel.LastAudioEndSample < SampleRate / 4)
                    startSample = channel.LastAudioEndSample;
                _spool.AddAt(channel.Track, startSample, args.Buffer.AsSpan(0, byteCount));
                channel.LastAudioEndSample = startSample + samples;
            }
        }
        catch (CaptureGapExceededException exception)
        {
            ReportAudioGap(exception);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            ReportPersistenceFailure(channel.Track,
                "Audio could not be saved locally. Recording is stopping. Check disk space and folder access.");
        }
    }

    private void OnCaptureStopped(CaptureChannel channel, IWaveIn source, StoppedEventArgs args)
    {
        bool report;
        lock (_gate)
        {
            if (channel.Closing || !_running || !ReferenceEquals(channel.Capture, source))
                return;
            channel.Available = false;
            channel.RetryAt = DateTimeOffset.UtcNow.AddSeconds(2);
            if (channel.Track == "mic")
                Interlocked.Exchange(ref _reopenMic, 1);
            else
            {
                if (channel.Source?.ProcessLoopbackId is { } processId)
                    lock (_failedProcessLoopbacks) _failedProcessLoopbacks.Add(processId);
                Interlocked.Exchange(ref _reopenSystem, 1);
            }
            report = channel.Track == "mic" || _renderOutage.ObserveAvailability(isAvailable: false);
        }
        if (report)
            ReportError(channel.Track, "The audio device disconnected. Reconnecting without resetting the recording timeline.");
    }

    private async Task PumpAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(100));
        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken).ConfigureAwait(false))
            {
                if (HasPersistenceFailure || HasAudioGap)
                    return;
                Interlocked.Exchange(ref _lastPumpTimestamp, Stopwatch.GetTimestamp());
                var retry = _channels.Values.Any(channel => !channel.Available
                    && DateTimeOffset.UtcNow >= channel.RetryAt);
                var dirty = Interlocked.Exchange(ref _selectionDirty, 0) != 0;
                var micFailed = Interlocked.Exchange(ref _reopenMic, 0) != 0;
                var systemFailed = Interlocked.Exchange(ref _reopenSystem, 0) != 0;
                if (dirty || retry || micFailed || systemFailed)
                    ReselectChannels();
                // A device switch can outlast a stop. Never touch the spool after StopAsync finished it.
                cancellationToken.ThrowIfCancellationRequested();
                IReadOnlyList<CapturedChunk> chunks;
                bool warn;
                lock (_gate)
                {
                    var elapsedMs = checked((int)Math.Min(_clock.ElapsedMilliseconds, 43_200_000));
                    var safeMs = Math.Max(0, elapsedMs - DeliverySlackMs);
                    chunks = _spool!.Advance(safeMs, complete: false);
                    warn = _levels.ShouldWarn(_clock.Elapsed, _meeting.IsActive);
                }
                Publish(chunks);
                if (warn)
                {
                    HostLog.Write("System track has been silent for 60 active meeting seconds.");
                    try { SilentSystemAudio?.Invoke(this, new SilentSystemAudioEventArgs(_clientRef)); }
                    catch { /* Tray delivery failures must not stop durable capture. */ }
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (CaptureGapExceededException exception)
        {
            ReportAudioGap(exception);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            ReportPersistenceFailure("all",
                "Recording persistence failed. Recording is stopping and saved audio is preserved. Check disk space.");
        }
        catch (Exception exception)
        {
            // The stop path finalises the spool even when the pump died, so only record why.
            HostLog.Error("Capture pump stopped unexpectedly", exception);
        }
    }

    private void CloseChannel(CaptureChannel channel)
    {
        var release = DetachChannel(channel);
        if (release is null)
            return;
        // A restarting device can block the driver join forever. Abandon it rather than wedge the stop.
        var released = BoundedNative.TryRun(release, NativeReleaseTimeout,
            error => HostLog.Error("Audio capture release failed", error));
        if (!released)
            HostLog.Write($"Audio capture release timed out on {channel.Track}; abandoned so the recording can finish.");
    }

    private Action? DetachChannel(CaptureChannel channel)
    {
        IWaveIn? capture;
        MMDevice? endpoint;
        lock (_gate)
        {
            channel.Closing = true;
            channel.Available = false;
            // Detaching first means a source that never finishes stopping can no longer write audio.
            capture = channel.Capture;
            endpoint = channel.Endpoint;
            channel.Capture = null;
            channel.Endpoint = null;
        }
        return capture is null && endpoint is null ? null : () => ReleaseNative(capture, endpoint);
    }

    private static void ReleaseNative(IWaveIn? capture, MMDevice? endpoint)
    {
        try
        {
            capture?.StopRecording();
        }
        catch (Exception exception) when (exception is COMException or InvalidOperationException)
        {
            HostLog.Error("Audio capture stop released a disconnected source", exception);
        }
        finally
        {
            try
            {
                capture?.Dispose();
            }
            catch (Exception exception) when (exception is COMException or InvalidOperationException)
            {
                HostLog.Error("Audio capture dispose released a disconnected source", exception);
            }
            finally
            {
                try { endpoint?.Dispose(); }
                catch (Exception exception) when (exception is COMException or InvalidOperationException)
                {
                    HostLog.Error("Audio endpoint release failed", exception);
                }
            }
        }
    }

    public async Task StopAsync(CancellationToken cancellationToken = default)
    {
        await _lifecycle.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (!_running)
                return;
            lock (_gate) _stopping = true;
            _captureCancellation!.Cancel();
            IReadOnlyList<CapturedChunk> chunks = [];
            var outcome = await Task.Run(() => CaptureStopSequence.RunAsync(_pump, PumpStopTimeout,
                () => _channels.Values.Select(DetachChannel).OfType<Action>().ToList(), NativeReleaseTimeout,
                () => chunks = FinaliseStop(), HostLog.Write), CancellationToken.None).ConfigureAwait(false);
            // A pump that outlived the stop could reopen a source on the next session, so the host replaces this recorder.
            if (!outcome.PumpStopped) IsPoisoned = true;
            Publish(chunks);
        }
        finally
        {
            _captureCancellation?.Dispose();
            _captureCancellation = null;
            _pump = null;
            _lifecycle.Release();
        }
    }

    private IReadOnlyList<CapturedChunk> FinaliseStop()
    {
        IReadOnlyList<CapturedChunk> chunks = [];
        try
        {
            lock (_gate)
            {
                _clock.Stop();
                LastDurationMs = CaptureEndDurationMs();
                try
                {
                    chunks = _spool!.Advance(LastDurationMs, complete: true);
                }
                catch (CaptureGapExceededException exception)
                {
                    ReportAudioGap(exception);
                    LastDurationMs = CaptureEndDurationMs();
                    chunks = _spool!.Advance(LastDurationMs, complete: true);
                }
                LastStopCompleted = true;
            }
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            ReportPersistenceFailure("all",
                "The recording tail is saved for recovery. Check disk space before restarting the recorder.");
        }
        finally
        {
            lock (_gate)
            {
                _clock.Stop();
                LastDurationMs = CaptureEndDurationMs();
                _running = false;
                Interlocked.Exchange(ref _audioGapStopDurationMs, -1);
                try { _spool?.Dispose(); }
                catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
                {
                    LastStopCompleted = false;
                    ReportPersistenceFailure("all", "Saved audio needs recovery after disk access is restored.");
                }
                finally { _spool = null; }
            }
            try { ReleaseEnumerator(); }
            catch (COMException) { /* A removed endpoint has no remaining capture resources. */ }
            finally { _channels.Clear(); }
        }
        return chunks;
    }

    private void ReleaseEnumerator()
    {
        var observer = _deviceObserver;
        var enumerator = _enumerator;
        _enumerator = null;
        _deviceObserver = null;
        Interlocked.Exchange(ref _reopenMic, 0);
        Interlocked.Exchange(ref _reopenSystem, 0);
        // The observer joins a COM thread that can hang while a device restarts.
        var released = BoundedNative.TryRun(() =>
        {
            try { observer?.Dispose(); }
            finally { enumerator?.Dispose(); }
        }, NativeReleaseTimeout, error => HostLog.Error("Audio device observer release failed", error));
        if (!released)
            HostLog.Write("Audio device observer release timed out; abandoned so the recording can finish.");
    }

    private void Publish(IEnumerable<CapturedChunk> chunks)
    {
        foreach (var chunk in chunks)
        {
            // A failing subscriber leaves the durable WAV available to restart recovery.
            try { ChunkReady?.Invoke(this, new CapturedChunkEventArgs(chunk)); }
            catch { ReportError(chunk.Track, "A saved chunk is waiting for outbox recovery."); }
        }
    }

    private void ReportError(string track, string message)
    {
        try { Error?.Invoke(this, new CaptureErrorEventArgs(track, message)); }
        catch { /* Host notification failures must not escape native capture callbacks. */ }
    }

    private void ReportPersistenceFailure(string track, string message)
    {
        if (Interlocked.Exchange(ref _persistenceFailure, 1) != 0)
            return;
        try { Error?.Invoke(this, new CaptureErrorEventArgs(track, message, isFatal: true)); }
        catch { /* The host can also inspect HasPersistenceFailure when polling recorder state. */ }
    }

    private int CaptureEndDurationMs() => HasAudioGap ? Volatile.Read(ref _audioGapStopDurationMs)
        : checked((int)Math.Min(_clock.ElapsedMilliseconds, DurableCaptureSpool.MaximumDurationMs));

    private void ReportAudioGap(CaptureGapExceededException exception)
    {
        if (Interlocked.CompareExchange(ref _audioGapStopDurationMs, exception.StopDurationMs, -1) != -1)
            return;
        try
        {
            Error?.Invoke(this, new CaptureErrorEventArgs("all",
                "Capture stopped after an audio gap longer than 10 seconds. Saved audio is preserved.", isFatal: true));
        }
        catch { /* The host can also inspect HasAudioGap when polling recorder state. */ }
    }

    public static IReadOnlyList<RecoveredCapture> RecoverInterrupted(string spoolDirectory) =>
        CaptureSpool.RecoverInterrupted(Path.GetFullPath(spoolDirectory));

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
            return;
        await StopAsync().ConfigureAwait(false);
        _disposed = true;
        _lifecycle.Dispose();
    }

}
