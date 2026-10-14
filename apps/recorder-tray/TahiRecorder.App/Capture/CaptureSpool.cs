using TahiRecorder.Core.Audio;

namespace TahiRecorder.App.Capture;

/// <summary>Adapts the portable durable spool to the Windows capture event contract.</summary>
internal sealed class CaptureSpool(string spoolDirectory, Guid clientRef) : IDisposable
{
    private readonly DurableCaptureSpool _spool = new(spoolDirectory, clientRef);

    public void AddAt(string track, long startSample, ReadOnlySpan<byte> pcm) => _spool.AddAt(track, startSample, pcm);

    public IReadOnlyList<CapturedChunk> Advance(int durationMs, bool complete) =>
        _spool.Advance(durationMs, complete).Select(ToCapturedChunk).ToList();

    public static IReadOnlyList<RecoveredCapture> RecoverInterrupted(string spoolDirectory) =>
        DurableCaptureSpool.RecoverInterrupted(spoolDirectory)
            .Select(capture => new RecoveredCapture(capture.ClientRef, capture.DurationMs,
                capture.Chunks.Select(ToCapturedChunk).ToList())).ToList();

    private static CapturedChunk ToCapturedChunk(SpoolChunk chunk) =>
        new(chunk.ClientRef, chunk.Track, chunk.Sequence, chunk.StartMs, chunk.DurationMs, chunk.FilePath);

    public void Dispose() => _spool.Dispose();
}
