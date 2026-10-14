namespace TahiRecorder.Core.Api;

public record UpcomingCall(string Id, string Kind, string Title, long StartMs, long EndMs, string Platform);
public record CreateRecordingRequest(Guid ClientRef, string Title, string[] Tracks,
    string? CallKind = null, string? CallId = null);
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
    public bool IsAuthenticationFailure => StatusCode is 401 or 403;
    public bool IsRetryable => StatusCode is 408 or 409 or 429 || StatusCode >= 500;

    public RecorderApiException(int statusCode, string? code = null, bool uploaded = false,
        TimeSpan? retryAfter = null) : base($"Recorder request failed ({statusCode}{(code is null ? "" : ", " + code)}).")
    {
        StatusCode = statusCode;
        Code = code;
        Uploaded = uploaded;
        RetryAfter = retryAfter;
    }
}
