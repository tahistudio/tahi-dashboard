using System.Diagnostics;
using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;
using NAudio.Wave;
using TahiRecorder.Core.Audio;

namespace TahiRecorder.App.Capture;

/// <summary>WASAPI capture with one wall clock and a durable, silence-padded two-track spool.</summary>
public sealed class WindowsAudioRecorder : IAsyncDisposable
{
    private const int SampleRate = 16_000;
    private const int DeliverySlackMs = 250;
    private readonly string _spoolDirectory;
    private readonly object _gate = new();
    private readonly SemaphoreSlim _lifecycle = new(1, 1);
    private readonly Stopwatch _clock = new();
    private readonly Dictionary<string, CaptureChannel> _channels = [];
    private CaptureSpool? _spool;
    private CancellationTokenSource? _captureCancellation;
    private Task? _pump;
    private MMDeviceEnumerator? _enumerator;
    private EndpointNotifications? _notifications;
    private bool _running;
    private bool _disposed;
    private int _reopenMic;
    private int _reopenSystem;
    private int _persistenceFailure;
    private int _audioGapStopDurationMs = -1;

    public WindowsAudioRecorder(string spoolDirectory)
    {
        _spoolDirectory = Path.GetFullPath(spoolDirectory);
    }

    public event EventHandler<CapturedChunkEventArgs>? ChunkReady;
    public event EventHandler<CaptureErrorEventArgs>? Error;
    public int LastDurationMs { get; private set; }
    public bool HasPersistenceFailure => Volatile.Read(ref _persistenceFailure) != 0;
    public bool HasAudioGap => Volatile.Read(ref _audioGapStopDurationMs) >= 0;
    public bool LastStopCompleted { get; private set; }
    public bool IsRecording { get { lock (_gate) return _running; } }

    private sealed class CaptureChannel(string track)
    {
        public string Track { get; } = track;
        public MMDevice? Endpoint { get; set; }
        public WasapiCapture? Capture { get; set; }
        public long LastAudioEndSample { get; set; } = -1;
        public bool Closing { get; set; }
        public DateTimeOffset RetryAt { get; set; }
    }

    public async Task StartAsync(string clientRef, CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
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
        _channels["mic"] = new CaptureChannel("mic");
        _channels["system"] = new CaptureChannel("system");
        LastDurationMs = 0;
        LastStopCompleted = false;
        Interlocked.Exchange(ref _persistenceFailure, 0);
        Interlocked.Exchange(ref _audioGapStopDurationMs, -1);
        _clock.Restart();
        lock (_gate) _running = true;
        try
        {
            _enumerator = new MMDeviceEnumerator();
            _notifications = new EndpointNotifications(this);
            Marshal.ThrowExceptionForHR(_enumerator.RegisterEndpointNotificationCallback(_notifications));
            OpenChannel(_channels["mic"]);
            OpenChannel(_channels["system"]);
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
        channel.Closing = false;
        channel.LastAudioEndSample = -1;
        try
        {
            var flow = channel.Track == "mic" ? DataFlow.Capture : DataFlow.Render;
            channel.Endpoint = _enumerator!.GetDefaultAudioEndpoint(flow, Role.Communications);
            var capture = channel.Track == "mic"
                ? new WasapiCapture(channel.Endpoint)
                : new WasapiLoopbackCapture(channel.Endpoint);
            channel.Capture = capture;
            // NAudio 2.2.1 sets AutoConvertPcm and SrcDefaultQuality on both capture types.
            // Windows resamples the endpoint mix format to the canonical upload format.
            capture.WaveFormat = new WaveFormat(SampleRate, 16, 1);
            capture.DataAvailable += (_, args) => OnAudio(channel, args);
            capture.RecordingStopped += (_, args) => OnCaptureStopped(channel, args);
            capture.StartRecording();
            channel.RetryAt = DateTimeOffset.MaxValue;
        }
        catch (Exception exception) when (exception is COMException or InvalidOperationException
            or ArgumentException)
        {
            CloseChannel(channel);
            channel.RetryAt = DateTimeOffset.UtcNow.AddSeconds(5);
            ReportError(channel.Track, channel.Track == "mic"
                ? "Microphone capture is unavailable. Reconnecting while preserving the recording timeline."
                : "System audio is unavailable. Recording the microphone with system silence until the output device reconnects.");
        }
    }

    private void OnAudio(CaptureChannel channel, WaveInEventArgs args)
    {
        if (args.BytesRecorded <= 0)
            return;
        try
        {
            lock (_gate)
            {
                if (!_running || _spool is null || channel.Closing || HasPersistenceFailure || HasAudioGap)
                    return;
                var byteCount = args.BytesRecorded - args.BytesRecorded % 2;
                var samples = byteCount / 2;
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

    private void OnCaptureStopped(CaptureChannel channel, StoppedEventArgs args)
    {
        if (channel.Closing || !IsRecording || args.Exception is null)
            return;
        channel.RetryAt = DateTimeOffset.UtcNow.AddSeconds(2);
        if (channel.Track == "mic")
            Interlocked.Exchange(ref _reopenMic, 1);
        else
            Interlocked.Exchange(ref _reopenSystem, 1);
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
                if (Interlocked.Exchange(ref _reopenMic, 0) != 0)
                    ReopenChannel(_channels["mic"]);
                if (Interlocked.Exchange(ref _reopenSystem, 0) != 0)
                    ReopenChannel(_channels["system"]);
                foreach (var channel in _channels.Values)
                {
                    if (channel.Capture is null && DateTimeOffset.UtcNow >= channel.RetryAt)
                        OpenChannel(channel);
                }
                IReadOnlyList<CapturedChunk> chunks;
                lock (_gate)
                {
                    var elapsedMs = checked((int)Math.Min(_clock.ElapsedMilliseconds, 43_200_000));
                    var safeMs = Math.Max(0, elapsedMs - DeliverySlackMs);
                    chunks = _spool!.Advance(safeMs, complete: false);
                }
                Publish(chunks);
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
    }

    private void ReopenChannel(CaptureChannel channel)
    {
        CloseChannel(channel);
        OpenChannel(channel);
    }

    private void CloseChannel(CaptureChannel channel)
    {
        channel.Closing = true;
        try
        {
            channel.Capture?.StopRecording();
        }
        finally
        {
            try
            {
                channel.Capture?.Dispose();
            }
            finally
            {
                channel.Capture = null;
                try { channel.Endpoint?.Dispose(); }
                finally { channel.Endpoint = null; }
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
            _captureCancellation!.Cancel();
            if (_pump is not null)
                await _pump.ConfigureAwait(false);
            await Task.Run(() =>
            {
                IReadOnlyList<CapturedChunk> chunks = [];
                try
                {
                    foreach (var channel in _channels.Values)
                    {
                        try { CloseChannel(channel); }
                        catch (COMException) { ReportError(channel.Track, "The disconnected audio device has been released."); }
                    }
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
                Publish(chunks);
            }, CancellationToken.None).ConfigureAwait(false);
        }
        finally
        {
            _captureCancellation?.Dispose();
            _captureCancellation = null;
            _pump = null;
            _lifecycle.Release();
        }
    }

    private void ReleaseEnumerator()
    {
        if (_enumerator is null)
            return;
        try
        {
            if (_notifications is not null)
                _enumerator.UnregisterEndpointNotificationCallback(_notifications);
        }
        finally
        {
            _enumerator.Dispose();
            _enumerator = null;
            _notifications = null;
            Interlocked.Exchange(ref _reopenMic, 0);
            Interlocked.Exchange(ref _reopenSystem, 0);
        }
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

    private sealed class EndpointNotifications(WindowsAudioRecorder owner) : IMMNotificationClient
    {
        public void OnDefaultDeviceChanged(DataFlow flow, Role role, string defaultDeviceId)
        {
            if (role != Role.Communications)
                return;
            if (flow is DataFlow.Capture or DataFlow.All)
                Interlocked.Exchange(ref owner._reopenMic, 1);
            if (flow is DataFlow.Render or DataFlow.All)
                Interlocked.Exchange(ref owner._reopenSystem, 1);
        }

        public void OnDeviceStateChanged(string deviceId, DeviceState newState) => Recheck();
        public void OnDeviceAdded(string deviceId) => Recheck();
        public void OnDeviceRemoved(string deviceId) => Recheck();
        public void OnPropertyValueChanged(string deviceId, PropertyKey key) { }

        private void Recheck()
        {
            Interlocked.Exchange(ref owner._reopenMic, 1);
            Interlocked.Exchange(ref owner._reopenSystem, 1);
        }
    }
}
