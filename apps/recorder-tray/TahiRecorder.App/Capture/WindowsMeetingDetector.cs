using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;

namespace TahiRecorder.App.Capture;

/// <summary>Only capture-side active sessions qualify, never render audio or volume.</summary>
public sealed class WindowsMeetingDetector : IDisposable
{
    private readonly ManualResetEventSlim _stopped = new(false);
    private readonly Thread _thread;
    private readonly string _logsDirectory;
    private readonly HashSet<string> _loggedNames = new(StringComparer.OrdinalIgnoreCase);
    private MeetingObservation _latest = MeetingObservation.Inactive;
    private bool _disposed;

    public WindowsMeetingDetector(string? logsDirectory = null)
    {
        _logsDirectory = logsDirectory ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TahiRecorder", "logs");
        _thread = new Thread(Observe)
        {
            IsBackground = true,
            Name = "Tahi capture-session observer"
        };
        _thread.SetApartmentState(ApartmentState.MTA);
        _thread.Start();
    }

    public MeetingObservation Poll() => Volatile.Read(ref _latest);

    private void Observe()
    {
        // IAudioSessionManager2 session notifications require a COM MTA.
        while (!_stopped.IsSet)
        {
            try
            {
                using var enumerator = new MMDeviceEnumerator();
                var processes = ProcessTree.Snapshot();
                var observations = new List<MeetingObservation>();
                foreach (var endpoint in enumerator.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active))
                {
                    using (endpoint)
                    {
                        var manager = endpoint.AudioSessionManager;
                        try
                        {
                            manager.RefreshSessions();
                            for (var index = 0; index < manager.Sessions.Count; index++)
                            {
                                using var session = manager.Sessions[index];
                                if (session.State != AudioSessionState.AudioSessionStateActive)
                                    continue;
                                var processId = checked((int)session.GetProcessID);
                                if (processes.TryGetValue(processId, out var process))
                                    LogObservedName(process.Name);
                                var platform = ProcessTree.MeetingPlatform(processId, processes);
                                if (platform is not null)
                                    observations.Add(new MeetingObservation(true, platform, processId));
                            }
                        }
                        catch (COMException)
                        {
                            // An endpoint can disappear midway through an enumeration.
                        }
                        finally
                        {
                            manager.Dispose();
                        }
                    }
                }

                var observation = observations.OrderBy(value => value.Platform == "meet" ? 1 : 0)
                    .ThenBy(value => value.ProcessId).FirstOrDefault() ?? MeetingObservation.Inactive;
                Volatile.Write(ref _latest, observation);
            }
            catch (Exception)
            {
                // Endpoint and process churn must not terminate the recorder process.
                Volatile.Write(ref _latest, MeetingObservation.Inactive);
            }
            _stopped.Wait(TimeSpan.FromSeconds(1));
        }
    }

    private void LogObservedName(string processName)
    {
        if (!_loggedNames.Add(processName))
            return;
        try
        {
            Directory.CreateDirectory(_logsDirectory);
            var path = Path.Combine(_logsDirectory, $"capture-processes-{DateTime.UtcNow:yyyy-MM-dd}.log");
            File.AppendAllText(path, $"{DateTimeOffset.UtcNow:O} capture-session process={processName}{Environment.NewLine}");
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            // A diagnostic logging failure must never change call detection.
        }
    }

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        _stopped.Set();
        _thread.Join();
        Volatile.Write(ref _latest, MeetingObservation.Inactive);
        _stopped.Dispose();
    }
}
