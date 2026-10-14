namespace TahiRecorder.App.Capture;

public sealed record MeetingObservation(bool IsActive, string Platform, int? ProcessId)
{
    public static MeetingObservation Inactive { get; } = new(false, "unknown", null);
}

public sealed record CapturedChunk(
    Guid ClientRef,
    string Track,
    int Sequence,
    int StartMs,
    int DurationMs,
    string FilePath);

public sealed record RecoveredCapture(Guid ClientRef, int DurationMs, IReadOnlyList<CapturedChunk> Chunks);

public sealed class CapturedChunkEventArgs(CapturedChunk chunk) : EventArgs
{
    public CapturedChunk Chunk { get; } = chunk;
    public Guid ClientRef => Chunk.ClientRef;
    public string Track => Chunk.Track;
    public int Sequence => Chunk.Sequence;
    public int StartMs => Chunk.StartMs;
    public int DurationMs => Chunk.DurationMs;
    public string FilePath => Chunk.FilePath;
}

public sealed class CaptureErrorEventArgs(string track, string message, bool isFatal = false) : EventArgs
{
    public string Track { get; } = track;
    public string Message { get; } = message;
    public bool IsFatal { get; } = isFatal;
}
