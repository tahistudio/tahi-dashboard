namespace TahiRecorder.Core.Audio;

/// <summary>Capture discontinuities stop a recording; only failed persistence disables new capture.</summary>
public static class CaptureFailurePolicy
{
    public static bool RequiresRecorderDisable(bool hasPersistenceFailure) => hasPersistenceFailure;
}
