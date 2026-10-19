namespace TahiRecorder.Core.Audio;

/// <summary>
/// One recorder operation at a time. Quit can force the gate when a holder never returns;
/// a stale holder that finally finishes can no longer release the gate that replaced its own.
/// </summary>
public sealed class OperationGate
{
    private readonly object _lock = new();
    private readonly TimeProvider _clock;
    private SemaphoreSlim _semaphore = new(1, 1);
    private DateTimeOffset? _heldSince;

    public OperationGate(TimeProvider? clock = null) => _clock = clock ?? TimeProvider.System;

    public sealed class Lease : IDisposable
    {
        private readonly OperationGate _gate;
        private readonly SemaphoreSlim _owner;
        private int _released;
        internal Lease(OperationGate gate, SemaphoreSlim owner) { _gate = gate; _owner = owner; }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _released, 1) != 0) return;
            lock (_gate._lock)
            {
                if (!ReferenceEquals(_gate._semaphore, _owner)) return;
                _gate._heldSince = null;
                _owner.Release();
            }
        }
    }

    public async Task<Lease> EnterAsync(CancellationToken cancellationToken = default)
    {
        while (true)
        {
            SemaphoreSlim current;
            lock (_lock) current = _semaphore;
            await current.WaitAsync(cancellationToken).ConfigureAwait(false);
            lock (_lock)
            {
                // The gate was replaced while this caller waited on the abandoned semaphore.
                if (!ReferenceEquals(current, _semaphore))
                {
                    // Wake the next queued waiter on the abandoned semaphore too.
                    try { current.Release(); } catch (SemaphoreFullException) { }
                    continue;
                }
                _heldSince = _clock.GetUtcNow();
                return new Lease(this, current);
            }
        }
    }

    public Lease? TryEnter()
    {
        lock (_lock)
        {
            if (!_semaphore.Wait(0)) return null;
            _heldSince = _clock.GetUtcNow();
            return new Lease(this, _semaphore);
        }
    }

    /// <summary>Abandons a holder older than the limit. Waiters on the old gate move to the new one.</summary>
    public bool TryBreakIfStuck(TimeSpan limit)
    {
        lock (_lock)
        {
            if (_heldSince is not { } since || _clock.GetUtcNow() - since < limit) return false;
            var abandoned = _semaphore;
            _semaphore = new SemaphoreSlim(1, 1);
            _heldSince = null;
            // Release the old semaphore so queued waiters wake, notice the swap and re-enter on the new gate.
            try { abandoned.Release(); } catch (SemaphoreFullException) { }
            return true;
        }
    }
}
