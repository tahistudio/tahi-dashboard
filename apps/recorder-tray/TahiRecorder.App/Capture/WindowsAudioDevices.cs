using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;
using TahiRecorder.Core.Audio;

namespace TahiRecorder.App.Capture;

public static class WindowsAudioDevices
{
    public static IReadOnlyList<AudioEndpointSnapshot> Enumerate()
    {
        using var enumerator = new MMDeviceEnumerator();
        return Enumerate(enumerator, null, null);
    }

    internal static IReadOnlyList<AudioEndpointSnapshot> Enumerate(MMDeviceEnumerator enumerator,
        List<EndpointSessionWatch>? watches, Action? changed)
    {
        var result = new List<AudioEndpointSnapshot>();
        foreach (var flow in new[] { DataFlow.Render, DataFlow.Capture })
        {
            var communicationsId = DefaultId(enumerator, flow, Role.Communications);
            var multimediaId = DefaultId(enumerator, flow, Role.Multimedia);
            foreach (var endpoint in enumerator.EnumerateAudioEndPoints(flow, DeviceState.Active))
            {
                EndpointSessionWatch? watch = null;
                try
                {
                    watch = new EndpointSessionWatch(endpoint, changed);
                    var activeProcessIds = watch.ReadActiveProcessIds();
                    result.Add(new AudioEndpointSnapshot(endpoint.ID, endpoint.FriendlyName,
                        flow == DataFlow.Render ? AudioEndpointFlow.Render : AudioEndpointFlow.Capture,
                        endpoint.ID == communicationsId, endpoint.ID == multimediaId, activeProcessIds));
                    if (watches is not null)
                    {
                        watches.Add(watch);
                        watch = null;
                    }
                }
                catch (Exception exception) when (exception is COMException or InvalidOperationException)
                {
                    // A removed endpoint or a session that just exited will be observed on the next scan.
                }
                finally
                {
                    if (watch is not null)
                        watch.Dispose();
                    else if (watches is null || !watches.Any(item => ReferenceEquals(item.Endpoint, endpoint)))
                        endpoint.Dispose();
                }
            }
        }
        return result;
    }

    private static string? DefaultId(MMDeviceEnumerator enumerator, DataFlow flow, Role role)
    {
        try
        {
            using var endpoint = enumerator.GetDefaultAudioEndpoint(flow, role);
            return endpoint.ID;
        }
        catch (COMException) { return null; }
    }

    internal sealed class EndpointSessionWatch : IDisposable
    {
        private readonly AudioSessionManager _manager;
        private readonly SessionEvents? _events;
        private readonly List<AudioSessionControl> _sessions = [];
        private readonly AudioSessionManager.SessionCreatedDelegate? _created;
        private bool _disposed;
        internal MMDevice Endpoint { get; }

        internal EndpointSessionWatch(MMDevice endpoint, Action? changed)
        {
            Endpoint = endpoint;
            _manager = endpoint.AudioSessionManager;
            try
            {
                if (changed is not null)
                {
                    _events = new SessionEvents(changed);
                    _created = (_, _) => changed();
                    _manager.OnSessionCreated += _created;
                }
            }
            catch
            {
                try { _manager.Dispose(); }
                catch (Exception exception) { HostLog.Error("Audio session manager release failed", exception); }
                finally { GC.SuppressFinalize(_manager); }
                throw;
            }
        }

        internal IReadOnlyList<int> ReadActiveProcessIds()
        {
            var ids = new HashSet<int>();
            // Reading Count activates session notifications on the MTA observer thread.
            for (var index = 0; index < _manager.Sessions.Count; index++)
            {
                var session = _manager.Sessions[index];
                _sessions.Add(session);
                if (_events is not null)
                    session.RegisterEventClient(_events);
                if (session.State == AudioSessionState.AudioSessionStateActive)
                {
                    var id = checked((int)session.GetProcessID);
                    if (id > 0 && id != Environment.ProcessId)
                        ids.Add(id);
                }
            }
            return ids.ToArray();
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            foreach (var session in _sessions)
            {
                try { if (_events is not null) session.UnRegisterEventClient(_events); }
                catch (Exception exception) { HostLog.Error("Audio session callback release failed", exception); }
                finally
                {
                    try { session.Dispose(); }
                    catch (Exception exception) { HostLog.Error("Audio session release failed", exception); }
                }
            }
            if (_created is not null)
                _manager.OnSessionCreated -= _created;
            try { _manager.Dispose(); }
            catch (Exception exception) { HostLog.Error("Audio session manager release failed", exception); }
            finally
            {
                // NAudio's manager finalizer retries unregister if Dispose throws on a removed device.
                GC.SuppressFinalize(_manager);
                try { Endpoint.Dispose(); }
                catch (Exception exception) { HostLog.Error("Audio endpoint watch release failed", exception); }
            }
        }

        private sealed class SessionEvents(Action changed) : IAudioSessionEventsHandler
        {
            public void OnStateChanged(AudioSessionState state) => changed();
            public void OnSessionDisconnected(AudioSessionDisconnectReason reason) => changed();
            public void OnVolumeChanged(float volume, bool isMuted) { }
            public void OnDisplayNameChanged(string displayName) { }
            public void OnIconPathChanged(string iconPath) { }
            public void OnChannelVolumeChanged(uint channelCount, nint newVolumes, uint channelIndex) { }
            public void OnGroupingParamChanged(ref Guid groupingId) { }
        }
    }
}

/// <summary>Session subscriptions live on one MTA, with a one-second poll covering notification races.</summary>
internal sealed class WindowsAudioDeviceObserver : IDisposable
{
    private readonly AutoResetEvent _changed = new(false);
    private readonly ManualResetEvent _stop = new(false);
    private readonly ManualResetEventSlim _ready = new(false);
    private readonly Thread _thread;
    private IReadOnlyList<AudioEndpointSnapshot> _snapshot = Array.Empty<AudioEndpointSnapshot>();
    private readonly Action _selectionChanged;
    private volatile bool _disposing;

    internal WindowsAudioDeviceObserver(Action selectionChanged)
    {
        _selectionChanged = selectionChanged;
        _thread = new Thread(Observe) { IsBackground = true, Name = "Tahi audio device observer" };
        _thread.SetApartmentState(ApartmentState.MTA);
        _thread.Start();
        _ready.Wait(TimeSpan.FromSeconds(3));
    }

    internal IReadOnlyList<AudioEndpointSnapshot> Snapshot => Volatile.Read(ref _snapshot);

    private void Observe()
    {
        try
        {
            while (!_stop.WaitOne(0))
            {
                MMDeviceEnumerator? enumerator = null;
                var notifications = new EndpointEvents(SignalChanged);
                var registered = false;
                var watches = new List<WindowsAudioDevices.EndpointSessionWatch>();
                try
                {
                    enumerator = new MMDeviceEnumerator();
                    registered = enumerator.RegisterEndpointNotificationCallback(notifications) >= 0;
                    while (!_stop.WaitOne(0))
                    {
                        DisposeWatches(watches);
                        try
                        {
                            Volatile.Write(ref _snapshot,
                                WindowsAudioDevices.Enumerate(enumerator, watches, SignalChanged));
                            _selectionChanged();
                        }
                        catch (Exception exception)
                        {
                            // Keep the last usable snapshot while Windows finishes device churn.
                            HostLog.Error("Audio endpoint scan will retry", exception);
                        }
                        finally { _ready.Set(); }
                        if (WaitHandle.WaitAny([_stop, _changed], TimeSpan.FromSeconds(1)) == 0)
                            break;
                    }
                }
                catch (Exception exception)
                {
                    // Native setup and notification failures must never escape a background thread.
                    HostLog.Error("Audio endpoint observer will reconnect", exception);
                }
                finally
                {
                    DisposeWatches(watches);
                    if (registered)
                    {
                        try { enumerator!.UnregisterEndpointNotificationCallback(notifications); }
                        catch (Exception exception) { HostLog.Error("Audio notification release failed", exception); }
                    }
                    try { enumerator?.Dispose(); }
                    catch (Exception exception) { HostLog.Error("Audio enumerator release failed", exception); }
                    _ready.Set();
                }
                _stop.WaitOne(TimeSpan.FromSeconds(1));
            }
        }
        catch (Exception exception)
        {
            HostLog.Error("Audio endpoint observer stopped", exception);
        }
        finally { _ready.Set(); }
    }

    private static void DisposeWatches(List<WindowsAudioDevices.EndpointSessionWatch> watches)
    {
        foreach (var watch in watches)
            try { watch.Dispose(); }
            catch (Exception exception) { HostLog.Error("Audio session watch release failed", exception); }
        watches.Clear();
    }

    private void SignalChanged()
    {
        if (_disposing) return;
        try { _changed.Set(); }
        catch (ObjectDisposedException) { /* Windows can finish an in-flight callback after unregister. */ }
    }

    public void Dispose()
    {
        _disposing = true;
        _stop.Set();
        _thread.Join();
        _ready.Dispose();
        _changed.Dispose();
        _stop.Dispose();
    }

    private sealed class EndpointEvents(Action changed) : IMMNotificationClient
    {
        public void OnDefaultDeviceChanged(DataFlow flow, Role role, string defaultDeviceId) => changed();
        public void OnDeviceStateChanged(string deviceId, DeviceState newState) => changed();
        public void OnDeviceAdded(string deviceId) => changed();
        public void OnDeviceRemoved(string deviceId) => changed();
        public void OnPropertyValueChanged(string deviceId, PropertyKey key) => changed();
    }
}
