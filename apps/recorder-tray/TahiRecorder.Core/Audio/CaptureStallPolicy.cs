namespace TahiRecorder.Core.Audio;

/// <summary>Safety net for a capture that is nominally recording but has stopped making progress.</summary>
public static class CaptureStallPolicy
{
    public static readonly TimeSpan MaximumWithoutPump = TimeSpan.FromSeconds(30);

    // Missing audio is already stopped by the spool's ten second padding limit, which needs a live pump.
    // This catches the pump itself dying or hanging, which that limit cannot see.
    public static bool IsStalled(bool isCapturing, TimeSpan sinceLastPump) =>
        isCapturing && sinceLastPump >= MaximumWithoutPump;
}
