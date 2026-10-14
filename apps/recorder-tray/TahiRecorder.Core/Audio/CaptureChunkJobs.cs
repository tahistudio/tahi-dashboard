namespace TahiRecorder.Core.Audio;

/// <summary>Completed transfers leave the queue even when a stop observes their failure.</summary>
public sealed class CaptureChunkJobs
{
    private readonly object _gate = new();
    private readonly List<Task> _jobs = [];

    public void Add(Task job)
    {
        ArgumentNullException.ThrowIfNull(job);
        lock (_gate) _jobs.Add(job);
    }

    public async Task DrainAsync()
    {
        Task[] pending;
        lock (_gate) pending = _jobs.ToArray();
        try { await Task.WhenAll(pending).ConfigureAwait(false); }
        finally
        {
            lock (_gate) foreach (var job in pending) _jobs.Remove(job);
        }
    }
}
