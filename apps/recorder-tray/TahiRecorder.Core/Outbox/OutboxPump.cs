using System.Collections.Concurrent;
using System.Text.Json;
using TahiRecorder.Core.Api;

namespace TahiRecorder.Core.Outbox;

public sealed class OutboxPump
{
    public const string BlockedError = "Recording needs attention. Local audio is retained.";
    private readonly FileOutboxStore store;
    private readonly IRecorderApi api;
    private readonly TimeProvider clock;
    private readonly SemaphoreSlim pumpGate = new(1, 1);
    private readonly ConcurrentDictionary<Guid, (int Failures, DateTimeOffset NextAttemptUtc)> manifestReadRetries = new();
    public event Action<Guid>? CreateSending;
    public event Action<Guid>? RecordingBlocked;
    public event Action<string>? StatusChanged;
    public bool AuthenticationRequired { get; private set; }

    public OutboxPump(FileOutboxStore store, IRecorderApi api, TimeProvider? clock = null)
    { this.store = store; this.api = api; this.clock = clock ?? TimeProvider.System; }

    public Task<bool> BlockRecordingAsync(Guid clientRef, CancellationToken cancellationToken = default) =>
        store.LockedAsync(clientRef, async () =>
        {
            try
            {
                var recording = await store.LoadUnsafeAsync(clientRef, cancellationToken);
                await HandleFailureAsync(recording, new InvalidDataException(), cancellationToken);
            }
            catch (Exception error) when (error is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
            {
                await store.MarkDamagedUnsafeAsync(clientRef, cancellationToken);
                RecordingBlocked?.Invoke(clientRef);
            }
            return true;
        }, cancellationToken);

    public async Task<bool> HasPendingAsync(CancellationToken cancellationToken = default)
    {
        var pending = false;
        foreach (var id in store.RecordingIds())
        {
            if (store.NeedsAttention(id)) { StatusChanged?.Invoke(BlockedError); continue; }
            if (ManifestReadDeferred(id)) { pending = true; continue; }
            try
            {
                pending |= (await store.ReadAsync(id, cancellationToken)).TerminalState is null;
                manifestReadRetries.TryRemove(id, out _);
            }
            catch (IOException)
            {
                DeferManifestRead(id);
                pending = true;
            }
            catch (Exception error) when (error is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
            {
                await store.LockedAsync(id, async () =>
                { await store.MarkDamagedUnsafeAsync(id, cancellationToken); return true; }, cancellationToken);
                RecordingBlocked?.Invoke(id);
                StatusChanged?.Invoke(BlockedError);
            }
        }
        return pending;
    }

    public async Task PumpOnceAsync(CancellationToken cancellationToken = default)
    {
        await pumpGate.WaitAsync(cancellationToken);
        try
        {
            if (AuthenticationRequired) return;
            foreach (var id in store.RecordingIds())
            {
                await store.LockedAsync(id, async () =>
                {
                    OutboxRecording? recording = null;
                    try
                    {
                        if (store.NeedsAttention(id)) return false;
                        if (ManifestReadDeferred(id)) return false;
                        recording = await store.LoadUnsafeAsync(id, cancellationToken);
                        manifestReadRetries.TryRemove(id, out _);
                        if (recording.TerminalState is not null || recording.NextAttemptUtc > clock.GetUtcNow()
                            || recording.NotBeforeUtc > clock.GetUtcNow()) return false;
                        var result = await AdvanceAsync(recording, cancellationToken);
                        recording.Failures = 0;
                        recording.LastError = null;
                        if (recording.TerminalState is null)
                        {
                            if (result == AdvanceResult.Progress) recording.TranscriptionPolls = 0;
                            recording.NextAttemptUtc = clock.GetUtcNow().AddSeconds(result switch
                            {
                                AdvanceResult.Progress => 1,
                                AdvanceResult.ServerFailed => Math.Min(60, Math.Pow(2, recording.ServerFailureRetries + 1)),
                                _ when recording.StopConfirmed => Math.Min(60, Math.Pow(2, Math.Min(6, ++recording.TranscriptionPolls))),
                                _ => 2
                            });
                        }
                        await store.SaveUnsafeAsync(recording, cancellationToken);
                    }
                    catch (Exception error) when (error is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
                    {
                        if (recording is null)
                        {
                            if (error is IOException)
                            {
                                DeferManifestRead(id);
                                return true;
                            }
                            await store.MarkDamagedUnsafeAsync(id, cancellationToken);
                            RecordingBlocked?.Invoke(id);
                            StatusChanged?.Invoke(BlockedError);
                        }
                        else await HandleFailureAsync(recording, error, cancellationToken);
                    }
                    return true;
                }, cancellationToken);
                if (AuthenticationRequired) break;
            }
        }
        finally { pumpGate.Release(); }
    }

    private bool ManifestReadDeferred(Guid id) => manifestReadRetries.TryGetValue(id, out var retry)
        && retry.NextAttemptUtc > clock.GetUtcNow();

    private void DeferManifestRead(Guid id)
    {
        // An unreadable manifest cannot safely be rewritten. Keep its retry state separate and leave the bytes intact.
        var now = clock.GetUtcNow();
        manifestReadRetries.AddOrUpdate(id, _ => (1, now.AddSeconds(2)), (_, retry) =>
        {
            if (retry.NextAttemptUtc > now) return retry;
            var failures = retry.Failures + 1;
            return (failures, now.AddSeconds(Math.Min(300, Math.Pow(2, Math.Min(8, failures)))));
        });
        StatusChanged?.Invoke("Upload delayed. Audio is saved for retry.");
    }

    private async Task HandleFailureAsync(OutboxRecording recording, Exception error, CancellationToken cancellationToken)
    {
        var apiError = error as RecorderApiException;
        if (apiError?.IsAuthenticationFailure == true) AuthenticationRequired = true;
        recording.Failures++;
        // Persist only fixed messages. Exception bodies can contain upload grants.
        recording.LastError = "Upload delayed. Audio is saved for retry.";
        var retryable = apiError?.IsRetryable == true || apiError?.IsAuthenticationFailure == true
            || error is HttpRequestException or OperationCanceledException or JsonException
            || error is IOException;
        var delay = apiError?.RetryAfter ?? TimeSpan.FromSeconds(Math.Min(300, Math.Pow(2, Math.Min(8, recording.Failures))));
        if (apiError?.Code == "daily_quota") delay = delay < TimeSpan.FromMinutes(15) ? TimeSpan.FromMinutes(15) : delay;
        if (apiError?.Code == "open_recording") delay = delay < TimeSpan.FromSeconds(30) ? TimeSpan.FromSeconds(30) : delay;
        if (!retryable)
        {
            recording.TerminalState = "blocked";
            recording.TerminalUtc = clock.GetUtcNow();
            recording.LastError = BlockedError;
            // The host queues its local stop before any remote recovery or stop can wait on the network.
            RecordingBlocked?.Invoke(recording.Request.ClientRef);
            await BestEffortStopAsync(recording, cancellationToken);
        }
        recording.NextAttemptUtc = clock.GetUtcNow() + (delay < TimeSpan.Zero ? TimeSpan.FromSeconds(2) : delay);
        try { await store.SaveUnsafeAsync(recording, cancellationToken); }
        catch (Exception saveError) when (saveError is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            await store.MarkDamagedUnsafeAsync(recording.Request.ClientRef, cancellationToken);
            RecordingBlocked?.Invoke(recording.Request.ClientRef);
        }
        StatusChanged?.Invoke(!retryable ? BlockedError
            : AuthenticationRequired ? "Device access ended. Pair again to resume new recordings."
            : apiError?.Code == "daily_quota" ? "Daily quota reached. Audio is saved for retry."
            : apiError?.Code == "open_recording" ? "Open recordings to resolve an earlier open recording. Local audio is saved."
            : "Upload delayed. Audio is saved for retry.");
    }

    private async Task BestEffortStopAsync(OutboxRecording recording, CancellationToken cancellationToken)
    {
        if (recording.StopConfirmed) return;
        try
        {
            if (recording.RecordingId is null)
            {
                if (!recording.CreateSent) return;
                // A lost create response can still occupy a server slot. Recover its id using the same clientRef.
                recording.RecordingId = (await api.CreateAsync(recording.Request, cancellationToken)).Id;
            }
            await api.StopAsync(recording.RecordingId, StopRequest(recording, releaseOpenSlot: true), cancellationToken);
            recording.StopConfirmed = true;
        }
        catch (Exception error) when (error is not OperationCanceledException || !cancellationToken.IsCancellationRequested) { }
    }

    private static StopRecordingRequest StopRequest(OutboxRecording recording, bool releaseOpenSlot = false)
    {
        var counts = new ExpectedChunks(recording.Chunks.Count(c => c.Metadata.Track == "mic"),
            recording.Chunks.Count(c => c.Metadata.Track == "system"));
        var duration = recording.Chunks.Count == 0 ? 0
            : Math.Max(recording.DurationMs, recording.Chunks.Max(c => c.Metadata.StartMs + c.Metadata.DurationMs));
        if (releaseOpenSlot && recording.Chunks.Count != 0)
        {
            // The server seals incomplete uploads, but each enabled track needs a positive expected count.
            // An absent track can remain missing while stoppedAt releases the open recording slot.
            counts = new ExpectedChunks(
                Math.Max(recording.Request.Tracks.Contains("mic") ? 1 : 0,
                    recording.Chunks.Where(c => c.Metadata.Track == "mic").Select(c => c.Metadata.Sequence + 1).DefaultIfEmpty().Max()),
                Math.Max(recording.Request.Tracks.Contains("system") ? 1 : 0,
                    recording.Chunks.Where(c => c.Metadata.Track == "system").Select(c => c.Metadata.Sequence + 1).DefaultIfEmpty().Max()));
        }
        return new(counts, duration);
    }

    private async Task<AdvanceResult> AdvanceAsync(OutboxRecording recording, CancellationToken cancellationToken)
    {
        var clientRef = recording.Request.ClientRef;
        if (recording.RecordingId is null)
        {
            // Persist before sending so Not this call cannot change an uncertain create.
            recording.CreateSent = true;
            await store.SaveUnsafeAsync(recording, cancellationToken);
            CreateSending?.Invoke(clientRef);
            recording.RecordingId = (await api.CreateAsync(recording.Request, cancellationToken)).Id;
            await store.SaveUnsafeAsync(recording, cancellationToken);
        }
        foreach (var chunk in recording.Chunks.OrderBy(c => c.Metadata.Sequence).ThenBy(c => c.Metadata.Track))
        {
            if (!chunk.Confirmed)
            {
                ChunkReservation reservation;
                try { reservation = await api.ReserveAsync(recording.RecordingId, chunk.Metadata, cancellationToken); }
                catch (RecorderApiException error) when (error.StatusCode == 409)
                {
                    var duplicateConfirmed = error.Code == "duplicate" && error.Uploaded;
                    if (!duplicateConfirmed)
                    {
                        var detail = await api.ReadAsync(recording.RecordingId, cancellationToken);
                        duplicateConfirmed = detail.Chunks.Any(remote => remote.Track == chunk.Metadata.Track
                            && remote.Sequence == chunk.Metadata.Sequence && remote.Uploaded);
                    }
                    if (!duplicateConfirmed) throw;
                    reservation = new ChunkReservation("", true, true);
                }
                if (!reservation.Uploaded)
                {
                    var wav = await File.ReadAllBytesAsync(store.ChunkPath(clientRef, chunk), cancellationToken);
                    try { await api.UploadAsync(reservation.UploadUrl, wav, cancellationToken); }
                    catch (RecorderApiException error) when (error.StatusCode == 409 && error.Code == "duplicate" && error.Uploaded) { }
                }
                chunk.Confirmed = true;
                await store.SaveUnsafeAsync(recording, cancellationToken);
            }
            // Durable acknowledgement precedes deletion. A crash repeats only this cleanup.
            File.Delete(store.ChunkPath(clientRef, chunk));
        }
        if (!recording.CaptureStopped) return AdvanceResult.NoProgress;
        if (!recording.StopConfirmed)
        {
            var detail = await api.StopAsync(recording.RecordingId, StopRequest(recording), cancellationToken);
            recording.StopConfirmed = true;
            if (UpdateTerminal(recording, detail)) return AdvanceResult.NoProgress;
            if (detail.Recording.State == "failed")
            { recording.ServerFailed = true; return AdvanceResult.ServerFailed; }
            await store.SaveUnsafeAsync(recording, cancellationToken);
        }
        var current = await api.ReadAsync(recording.RecordingId, cancellationToken);
        if (UpdateTerminal(recording, current)) return AdvanceResult.NoProgress;
        if (current.Recording.State == "failed")
        {
            if (!recording.ServerFailed)
            { recording.ServerFailed = true; return AdvanceResult.ServerFailed; }
        }
        if (recording.ServerFailed)
        {
            if (recording.ServerFailureRetries >= 3)
            { SetTerminal(recording, "failed"); return AdvanceResult.NoProgress; }
            recording.ServerFailureRetries++;
        }
        var transcribed = await api.TranscribeAsync(recording.RecordingId, cancellationToken);
        var readyBefore = current.Chunks.Count(c => c.State == "ready");
        var readyAfter = transcribed.Chunks.Count(c => c.State == "ready");
        var chunksProgressed = readyAfter > readyBefore;
        if (chunksProgressed) recording.ServerFailureRetries = 0;
        if (UpdateTerminal(recording, transcribed)) return AdvanceResult.NoProgress;
        if (transcribed.Recording.State == "failed")
        {
            recording.ServerFailed = true;
            if (recording.ServerFailureRetries >= 3) SetTerminal(recording, "failed");
            return chunksProgressed ? AdvanceResult.Progress : AdvanceResult.ServerFailed;
        }
        recording.ServerFailed = false;
        var progressed = chunksProgressed || transcribed.Recording.State != current.Recording.State;
        if (progressed) recording.ServerFailureRetries = 0;
        return progressed ? AdvanceResult.Progress : AdvanceResult.NoProgress;
    }

    private bool UpdateTerminal(OutboxRecording recording, RecordingDetail detail)
    {
        if (detail.Recording.State != "ready") return false;
        SetTerminal(recording, "ready");
        return true;
    }

    private void SetTerminal(OutboxRecording recording, string state)
    {
        recording.TerminalState = state;
        recording.TerminalUtc = clock.GetUtcNow();
        recording.TranscriptionPolls = 0;
        if (state == "ready") recording.ServerFailureRetries = 0;
        StatusChanged?.Invoke(state == "ready" ? "Transcript ready in recordings." : "Transcription failed. Open recordings to review.");
    }

    private enum AdvanceResult { NoProgress, Progress, ServerFailed }
}
