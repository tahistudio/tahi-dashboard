using TahiRecorder.Core.Audio;

namespace TahiRecorder.Core.Outbox;

public static class OutboxRecovery
{
    public static async Task<bool> RecoverAsync(FileOutboxStore store, string spoolDirectory,
        CancellationToken cancellationToken = default, Func<Guid, CancellationToken, Task>? blockRecording = null,
        IReadOnlySet<Guid>? skip = null)
    {
        // Skipped sessions are live or parked: their audio is still owned by a running capture.
        var recovered = DurableCaptureSpool.RecoverInterrupted(spoolDirectory, skip).ToDictionary(item => item.ClientRef);
        var ids = store.RecordingIds().ToArray();
        var attention = Directory.Exists(spoolDirectory) && Directory.EnumerateDirectories(spoolDirectory)
            .Any(path => Guid.TryParse(Path.GetFileName(path), out var id) && !ids.Contains(id));
        foreach (var id in ids.Where(id => skip is null || !skip.Contains(id)))
        {
            try
            {
                var recording = await store.ReadAsync(id, cancellationToken).ConfigureAwait(false);
                if (store.NeedsAttention(id) || recording.TerminalState == "blocked") { attention = true; continue; }
                recovered.TryGetValue(id, out var capture);
                var captureFolder = Path.Combine(spoolDirectory, id.ToString("D"));
                if (capture is null && recording.TerminalState is "ready" or "failed"
                    && !File.Exists(Path.Combine(captureFolder, "session.json"))) continue;
                if (capture is null && Directory.Exists(captureFolder))
                    throw new InvalidDataException("Capture journal needs attention.");
                if (capture is not null)
                {
                    foreach (var chunk in capture.Chunks)
                    {
                        var wav = await File.ReadAllBytesAsync(chunk.FilePath, cancellationToken).ConfigureAwait(false);
                        await store.AddChunkAsync(id, chunk.Track, chunk.Sequence, chunk.StartMs,
                            chunk.DurationMs, wav, cancellationToken).ConfigureAwait(false);
                        File.Delete(chunk.FilePath);
                    }
                    recovered.Remove(id);
                }
                if (!recording.CaptureStopped)
                {
                    var duration = capture?.DurationMs ?? recording.Chunks.Select(chunk =>
                        chunk.Metadata.StartMs + chunk.Metadata.DurationMs).DefaultIfEmpty().Max();
                    await store.StopAsync(id, duration, cancellationToken).ConfigureAwait(false);
                }
            }
            catch (IOException)
            {
                // A temporary read failure is not proof of damaged audio. Preserve it for a later recovery attempt.
                attention = true;
            }
            catch (Exception error) when (error is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
            {
                attention = true;
                if (blockRecording is not null)
                    await blockRecording(id, cancellationToken).ConfigureAwait(false);
                // Keep damaged data intact and show a fixed needs-attention message.
                await store.LockedAsync(id, async () =>
                {
                    await store.MarkDamagedUnsafeAsync(id, cancellationToken).ConfigureAwait(false);
                    return true;
                }, cancellationToken).ConfigureAwait(false);
            }
        }
        // Orphaned audio has no safe create identity and stays local for inspection.
        return attention || recovered.Count > 0;
    }
}
