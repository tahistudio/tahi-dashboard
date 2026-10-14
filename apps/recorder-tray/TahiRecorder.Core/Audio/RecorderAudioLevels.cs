using System.Buffers.Binary;

namespace TahiRecorder.Core.Audio;

public sealed record AudioLevelSnapshot(bool HasRecording, float SystemPeak, float MicrophonePeak)
{
    public bool SystemAudioOk => SystemPeak > RecorderAudioLevels.SignalThreshold;
    public bool MicrophoneAudioOk => MicrophonePeak > RecorderAudioLevels.SignalThreshold;
}

/// <summary>Per-recording peaks and a monotonic silence watchdog, independent of packet delivery.</summary>
public sealed class RecorderAudioLevels
{
    public const float SignalThreshold = 0.001f;
    public static readonly TimeSpan SilenceDuration = TimeSpan.FromSeconds(60);
    private readonly object _gate = new();
    private float _systemPeak;
    private float _microphonePeak;
    private TimeSpan? _lastSystemSignal;
    private TimeSpan? _activeSince;
    private bool _warned;
    private bool _hasRecording;

    public AudioLevelSnapshot Snapshot
    {
        get { lock (_gate) return new(_hasRecording, _systemPeak, _microphonePeak); }
    }

    public void Reset()
    {
        lock (_gate)
        {
            _systemPeak = _microphonePeak = 0;
            _lastSystemSignal = _activeSince = null;
            _warned = false;
            _hasRecording = true;
        }
    }

    public void ObservePcm(string track, ReadOnlySpan<byte> pcm, TimeSpan elapsed)
    {
        if (track is not ("mic" or "system"))
            throw new ArgumentException("Unknown audio track.", nameof(track));
        var peak = 0f;
        for (var offset = 0; offset + 1 < pcm.Length; offset += 2)
        {
            var sample = BinaryPrimitives.ReadInt16LittleEndian(pcm.Slice(offset, 2));
            peak = Math.Max(peak, Math.Abs((int)sample) / 32768f);
        }
        lock (_gate)
        {
            if (track == "mic")
                _microphonePeak = Math.Max(_microphonePeak, peak);
            else
            {
                _systemPeak = Math.Max(_systemPeak, peak);
                if (peak > SignalThreshold)
                    _lastSystemSignal = elapsed;
            }
        }
    }

    public bool ShouldWarn(TimeSpan elapsed, bool meetingActive)
    {
        lock (_gate)
        {
            if (!meetingActive)
            {
                _activeSince = null;
                return false;
            }
            _activeSince ??= elapsed;
            var since = _lastSystemSignal is { } last && last > _activeSince.Value
                ? last : _activeSince.Value;
            if (!_hasRecording || _warned || elapsed - since < SilenceDuration)
                return false;
            _warned = true;
            return true;
        }
    }
}
