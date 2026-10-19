namespace TahiRecorder.Core.Audio;

/// <summary>
/// Native audio teardown (driver joins, COM releases) can block forever when a device is
/// restarting. Callers bound the wait and abandon the stuck call instead of wedging the recorder.
/// </summary>
public static class BoundedNative
{
    /// <summary>Runs the action on a dedicated background thread. False means it was abandoned still running.</summary>
    public static bool TryRun(Action action, TimeSpan timeout, Action<Exception>? failed = null)
    {
        ArgumentNullException.ThrowIfNull(action);
        using var done = new ManualResetEventSlim(false);
        var thread = new Thread(() =>
        {
            try { action(); }
            catch (Exception error) { try { failed?.Invoke(error); } catch { /* A logging failure must not escape. */ } }
            finally { try { done.Set(); } catch (ObjectDisposedException) { /* The caller already abandoned this call. */ } }
        }) { IsBackground = true, Name = "Tahi bounded native call" };
        thread.Start();
        return done.Wait(timeout);
    }

    /// <summary>
    /// Like <see cref="TryWaitAsync"/>, but a call that finishes after the deadline still gets its cleanup run
    /// (for example a start that completes late must be stopped, or it records forever).
    /// </summary>
    public static async Task<bool> TryRunWithLateCleanupAsync(Func<Task> call, TimeSpan timeout, Func<Task> lateCleanup)
    {
        ArgumentNullException.ThrowIfNull(call);
        ArgumentNullException.ThrowIfNull(lateCleanup);
        var task = call();
        if (await TryWaitAsync(task, timeout).ConfigureAwait(false)) return true;
        _ = task.ContinueWith(_ => lateCleanup(), CancellationToken.None, TaskContinuationOptions.None, TaskScheduler.Default)
            .Unwrap().ContinueWith(late => _ = late.Exception, CancellationToken.None,
                TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
        return false;
    }

    /// <summary>False means the task was still running at the deadline. A late fault is observed, never rethrown.</summary>
    public static async Task<bool> TryWaitAsync(Task task, TimeSpan timeout)
    {
        ArgumentNullException.ThrowIfNull(task);
        _ = task.ContinueWith(late => _ = late.Exception, CancellationToken.None,
            TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
        var finished = await Task.WhenAny(task, Task.Delay(timeout)).ConfigureAwait(false);
        if (!ReferenceEquals(finished, task)) return false;
        await task.ConfigureAwait(false);
        return true;
    }
}
