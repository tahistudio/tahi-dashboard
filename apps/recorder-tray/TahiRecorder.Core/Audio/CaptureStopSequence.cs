namespace TahiRecorder.Core.Audio;

public sealed record CaptureStopOutcome(bool PumpStopped, int ReleasesTimedOut);

/// <summary>
/// The order a capture stop must follow: wait for the pump (bounded), release every native source
/// (each bounded), and then always finalise the spool, whatever the devices did.
/// </summary>
public static class CaptureStopSequence
{
    public static async Task<CaptureStopOutcome> RunAsync(Task? pump, TimeSpan pumpTimeout,
        Func<IReadOnlyList<Action>> detachReleases, TimeSpan releaseTimeout, Action finalise,
        Action<string>? log = null)
    {
        ArgumentNullException.ThrowIfNull(detachReleases);
        ArgumentNullException.ThrowIfNull(finalise);
        var pumpStopped = true;
        if (pump is not null)
        {
            try { pumpStopped = await BoundedNative.TryWaitAsync(pump, pumpTimeout).ConfigureAwait(false); }
            catch (Exception) { pumpStopped = true; }
        }
        if (!pumpStopped) log?.Invoke("Capture pump did not stop in time; finishing the recording without it.");
        var timedOut = 0;
        try
        {
            foreach (var release in detachReleases())
            {
                if (BoundedNative.TryRun(release, releaseTimeout, error => log?.Invoke("Audio capture release failed: " + error.GetType().Name)))
                    continue;
                timedOut++;
                log?.Invoke("Audio capture release timed out; abandoned so the recording can finish.");
            }
        }
        finally { finalise(); }
        return new CaptureStopOutcome(pumpStopped, timedOut);
    }
}
