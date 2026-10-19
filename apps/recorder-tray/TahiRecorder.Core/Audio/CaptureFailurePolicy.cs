namespace TahiRecorder.Core.Audio;

/// <summary>Capture discontinuities stop a recording; only failed persistence disables new capture.</summary>
public static class CaptureFailurePolicy
{
    public static CaptureFailureAction Evaluate(bool isCapturing, bool hasAudioGap, bool hasPersistenceFailure,
        bool isStalled = false)
    {
        if (hasPersistenceFailure) return CaptureFailureAction.DisableRecorder;
        return isCapturing && (hasAudioGap || isStalled) ? CaptureFailureAction.StopForAudioGap : CaptureFailureAction.None;
    }
}

public enum CaptureFailureAction { None, StopForAudioGap, DisableRecorder }
