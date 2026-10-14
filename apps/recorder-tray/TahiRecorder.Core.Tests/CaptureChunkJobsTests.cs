using TahiRecorder.Core.Audio;

namespace TahiRecorder.Core.Tests;

public sealed class CaptureChunkJobsTests
{
    [Fact]
    public async Task FailedTransferIsReportedOnceAndDoesNotPoisonLaterStops()
    {
        var jobs = new CaptureChunkJobs();
        var error = new IOException("Spool transfer failed.");
        jobs.Add(Task.FromException(error));
        Assert.Same(error, await Assert.ThrowsAsync<IOException>(() => jobs.DrainAsync()));
        var next = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        jobs.Add(next.Task);
        var laterStop = jobs.DrainAsync();
        Assert.False(laterStop.IsCompleted);
        next.SetResult();
        await laterStop;
        await jobs.DrainAsync();
    }

    [Fact]
    public async Task FailureCleanupKeepsTransfersAddedDuringDrainForNextStop()
    {
        var jobs = new CaptureChunkJobs();
        var first = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var next = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        jobs.Add(first.Task);
        var firstStop = jobs.DrainAsync();
        jobs.Add(next.Task);
        first.SetException(new IOException("First transfer failed."));
        await Assert.ThrowsAsync<IOException>(() => firstStop);
        var nextStop = jobs.DrainAsync();
        Assert.False(nextStop.IsCompleted);
        next.SetResult();
        await nextStop;
    }
}
