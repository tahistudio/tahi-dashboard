using TahiRecorder.Core.Api;

namespace TahiRecorder.Core.Outbox;

public sealed class OutboxPump
{
    private readonly FileOutboxStore store;
    private readonly IRecorderApi api;
    private readonly TimeProvider clock;
    private readonly SemaphoreSlim pumpGate = new(1, 1);
    public event Action<Guid>? CreateSending;
    public event Action<string>? StatusChanged;
    public bool AuthenticationRequired { get; private set; }

    public OutboxPump(FileOutboxStore store, IRecorderApi api, TimeProvider? clock = null)
    { this.store = store; this.api = api; this.clock = clock ?? TimeProvider.System; }

    public async Task<bool> HasPendingAsync(CancellationToken cancellationToken = default)
    {
        foreach (var id in store.RecordingIds())
            if ((await store.ReadAsync(id, cancellationToken)).TerminalState is null) return true;
        return false;
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
                    var recording = await store.LoadUnsafeAsync(id, cancellationToken);
                    if (recording.TerminalState is not null || recording.NextAttemptUtc > clock.GetUtcNow()
                        || recording.NotBeforeUtc > clock.GetUtcNow()) return false;
                    try
                    {
                        await AdvanceAsync(recording, cancellationToken);
                        recording.Failures = 0;
                        recording.LastError = null;
                        if (recording.TerminalState is null)
                            recording.NextAttemptUtc = clock.GetUtcNow().AddSeconds(recording.StopConfirmed
                                ? Math.Min(60, Math.Pow(2, Math.Min(6, ++recording.TranscriptionPolls))) : 2);
                        await store.SaveUnsafeAsync(recording, cancellationToken);
                    }
                    catch (Exception error) when (error is RecorderApiException or HttpRequestException or IOException
                        or System.Text.Json.JsonException || error is OperationCanceledException && !cancellationToken.IsCancellationRequested)
                    {
                        var apiError = error as RecorderApiException;
                        if (apiError?.IsAuthenticationFailure == true) AuthenticationRequired = true;
                        recording.Failures++;
                        // Never persist server bodies, upload URLs or exception strings containing grants.
                        recording.LastError = apiError is null ? "Network or local storage unavailable."
                            : $"HTTP {apiError.StatusCode}: {apiError.Code ?? "request_failed"}";
                        var delay = apiError?.RetryAfter ?? TimeSpan.FromSeconds(Math.Min(300, Math.Pow(2, Math.Min(8, recording.Failures))));
                        if (apiError?.Code == "daily_quota") delay = delay < TimeSpan.FromMinutes(15) ? TimeSpan.FromMinutes(15) : delay;
                        if (apiError?.Code == "open_recording") delay = delay < TimeSpan.FromSeconds(30) ? TimeSpan.FromSeconds(30) : delay;
                        if (apiError is { IsRetryable: false, IsAuthenticationFailure: false })
                        {
                            recording.TerminalState = "blocked";
                            StatusChanged?.Invoke("Recording needs attention. Local audio is retained.");
                        }
                        recording.NextAttemptUtc = clock.GetUtcNow() + (delay < TimeSpan.Zero ? TimeSpan.FromSeconds(2) : delay);
                        await store.SaveUnsafeAsync(recording, cancellationToken);
                        StatusChanged?.Invoke(AuthenticationRequired ? "Device access ended. Pair again to resume new recordings."
                            : apiError?.Code == "daily_quota" ? "Daily quota reached. Audio is saved for retry."
                            : apiError?.Code == "open_recording" ? "Open recordings to resolve an earlier open recording. Local audio is saved."
                            : "Upload delayed. Audio is saved for retry.");
                    }
                    return true;
                }, cancellationToken);
                if (AuthenticationRequired) break;
            }
        }
        finally { pumpGate.Release(); }
    }

    private async Task AdvanceAsync(OutboxRecording recording, CancellationToken cancellationToken)
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
                    // A transcript may have completed after a crash before the local ack.
                    // Owned reads can confirm its stored body even when reservations are closed.
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
                // Duplicate alone can mean metadata exists. Only uploaded confirms the body.
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
        if (!recording.CaptureStopped) return;
        if (!recording.StopConfirmed)
        {
            var counts = new ExpectedChunks(recording.Chunks.Count(c => c.Metadata.Track == "mic"),
                recording.Chunks.Count(c => c.Metadata.Track == "system"));
            var detail = await api.StopAsync(recording.RecordingId, new StopRecordingRequest(counts, recording.DurationMs), cancellationToken);
            recording.StopConfirmed = true;
            UpdateTerminal(recording, detail);
            await store.SaveUnsafeAsync(recording, cancellationToken);
        }
        if (recording.TerminalState is not null) return;
        var current = await api.ReadAsync(recording.RecordingId, cancellationToken);
        UpdateTerminal(recording, current);
        if (recording.TerminalState is null)
            UpdateTerminal(recording, await api.TranscribeAsync(recording.RecordingId, cancellationToken));
    }

    private void UpdateTerminal(OutboxRecording recording, RecordingDetail detail)
    {
        if (detail.Recording.State is "ready" or "failed")
        {
            recording.TerminalState = detail.Recording.State;
            StatusChanged?.Invoke(detail.Recording.State == "ready" ? "Transcript ready in recordings." : "Transcription failed. Open recordings to review.");
        }
    }
}
