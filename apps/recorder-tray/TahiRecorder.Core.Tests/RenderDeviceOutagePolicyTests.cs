using TahiRecorder.Core.Audio;

namespace TahiRecorder.Core.Tests;

public sealed class RenderDeviceOutagePolicyTests
{
    [Fact]
    public void PersistentMissingRenderDeviceNotifiesOnceAcrossRetries()
    {
        var policy = new RenderDeviceOutagePolicy();
        var notifications = 0;

        for (var retry = 0; retry < 12; retry++)
            if (policy.ObserveAvailability(isAvailable: false))
                notifications++;

        Assert.Equal(1, notifications);
    }

    [Fact]
    public void SuccessfulReconnectAllowsOneNotificationForTheNextOutage()
    {
        var policy = new RenderDeviceOutagePolicy();
        Assert.False(policy.ObserveAvailability(isAvailable: true));
        Assert.True(policy.ObserveAvailability(isAvailable: false));
        Assert.False(policy.ObserveAvailability(isAvailable: false));

        Assert.False(policy.ObserveAvailability(isAvailable: true));
        Assert.True(policy.ObserveAvailability(isAvailable: false));
        Assert.False(policy.ObserveAvailability(isAvailable: false));
    }

    [Fact]
    public void NewRecordingReportsItsOwnOutageEvenIfTheDeviceNeverReconnected()
    {
        var policy = new RenderDeviceOutagePolicy();
        Assert.True(policy.ObserveAvailability(isAvailable: false));
        Assert.False(policy.ObserveAvailability(isAvailable: false));

        policy.Reset();

        Assert.True(policy.ObserveAvailability(isAvailable: false));
        Assert.False(policy.ObserveAvailability(isAvailable: false));
    }

    [Fact]
    public void ConcurrentRetriesStillEmitOnlyOneNotification()
    {
        var policy = new RenderDeviceOutagePolicy();
        var notifications = 0;

        Parallel.For(0, 32, _ =>
        {
            if (policy.ObserveAvailability(isAvailable: false))
                Interlocked.Increment(ref notifications);
        });

        Assert.Equal(1, notifications);
    }
}
