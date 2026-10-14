namespace TahiRecorder.Core.Audio;

/// <summary>Notify once while render capture is unavailable, until it successfully reconnects.</summary>
public sealed class RenderDeviceOutagePolicy
{
    private int _unavailable;

    public void Reset() => Interlocked.Exchange(ref _unavailable, 0);

    public bool ObserveAvailability(bool isAvailable)
    {
        if (isAvailable)
        {
            Interlocked.Exchange(ref _unavailable, 0);
            return false;
        }

        return Interlocked.Exchange(ref _unavailable, 1) == 0;
    }
}
