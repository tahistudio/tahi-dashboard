namespace TahiRecorder.Core.Api;

public record UpcomingCall(string Id, string Kind, string Title, long StartMs, long EndMs, string Platform);
public record CreateRecordingRequest(Guid ClientRef, string Title, string[] Tracks,
    string? CallKind = null, string? CallId = null, bool SeparateSpeakers = true);
public record ChunkMetadata(string Track, int Sequence, int StartMs, int DurationMs, string MimeType, int Size);
public record ExpectedChunks(int Mic, int System);
public record StopRecordingRequest(ExpectedChunks ExpectedChunks, int DurationMs);
public record DeviceIdentity(string Id, string Name);
public record PairResponse(string Token, DeviceIdentity Device);
public record RecordingState(string Id, string State, ExpectedChunks? ExpectedChunks = null, string? Error = null);
public record ChunkState(string Track, int Sequence, bool Uploaded, string State, string? Error = null);
public record RecordingDetail(RecordingState Recording, IReadOnlyList<ChunkState> Chunks);
public record ChunkReservation(string UploadUrl, bool Duplicate, bool Uploaded);

public interface IRecorderApi
{
    Task<RecordingState> CreateAsync(CreateRecordingRequest request, CancellationToken cancellationToken);
    Task<ChunkReservation> ReserveAsync(string recordingId, ChunkMetadata metadata, CancellationToken cancellationToken);
    Task UploadAsync(string uploadUrl, byte[] wav, CancellationToken cancellationToken);
    Task<RecordingDetail> StopAsync(string recordingId, StopRecordingRequest request, CancellationToken cancellationToken);
    Task<RecordingDetail> ReadAsync(string recordingId, CancellationToken cancellationToken);
    Task<RecordingDetail> TranscribeAsync(string recordingId, CancellationToken cancellationToken);
    Task<IReadOnlyList<RecordingDetail>> ListAsync(CancellationToken cancellationToken);
}

public sealed class RecorderApiException : Exception
{
    public int StatusCode { get; }
    public string? Code { get; }
    public bool Uploaded { get; }
    public TimeSpan? RetryAfter { get; }
    /// <summary>The server's error text, kept only to recognise known rejections. It is never logged or persisted.</summary>
    public string? ServerMessage { get; }
    public bool IsAuthenticationFailure => StatusCode is 401 or 403;
    public bool IsRetryable => StatusCode is 408 or 429 || StatusCode == 409 && !string.IsNullOrWhiteSpace(Code) || StatusCode >= 500;

    public RecorderApiException(int statusCode, string? code = null, bool uploaded = false,
        TimeSpan? retryAfter = null, string? serverMessage = null) : base($"Recorder request failed ({statusCode}{(code is null ? "" : ", " + code)}).")
    {
        StatusCode = statusCode;
        Code = code;
        Uploaded = uploaded;
        RetryAfter = retryAfter;
        ServerMessage = serverMessage;
    }

    /// <summary>
    /// A server without speaker separation for tray recordings answers create with 400
    /// "Tray recordings use standard transcription." Only that rejection permits a retry without it.
    /// </summary>
    public bool IsSeparateSpeakersRejection => StatusCode == 400 && (
        Mentions(ServerMessage, "separate speakers") || Mentions(ServerMessage, "separatespeakers")
        || Mentions(ServerMessage, "standard transcription") || Mentions(Code, "separate_speakers")
        || Mentions(Code, "separatespeakers") || Mentions(Code, "standard_transcription"));

    private static bool Mentions(string? value, string part) =>
        value?.Contains(part, StringComparison.OrdinalIgnoreCase) == true;
}
