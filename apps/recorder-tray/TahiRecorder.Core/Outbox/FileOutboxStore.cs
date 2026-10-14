using System.Collections.Concurrent;
using System.Text.Json;
using TahiRecorder.Core.Api;

namespace TahiRecorder.Core.Outbox;

public sealed class OutboxRecording
{
    public required CreateRecordingRequest Request { get; set; }
    public long CreatedSequence { get; set; }
    public DateTimeOffset CreatedUtc { get; set; }
    public DateTimeOffset? TerminalUtc { get; set; }
    public string? RecordingId { get; set; }
    public bool CreateSent { get; set; }
    public DateTimeOffset NotBeforeUtc { get; set; }
    public bool CaptureStopped { get; set; }
    public int DurationMs { get; set; }
    public bool StopConfirmed { get; set; }
    public string? TerminalState { get; set; }
    public string? LastError { get; set; }
    public int Failures { get; set; }
    public int TranscriptionPolls { get; set; }
    public bool ServerFailed { get; set; }
    public int ServerFailureRetries { get; set; }
    public DateTimeOffset NextAttemptUtc { get; set; }
    public List<OutboxChunk> Chunks { get; set; } = [];
}

public sealed class OutboxChunk
{
    public required ChunkMetadata Metadata { get; set; }
    public required string FileName { get; set; }
    public bool Confirmed { get; set; }
}

/// <summary>One manifest per recording, with atomic replacement and one shared lock.</summary>
public sealed class FileOutboxStore
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> sequenceLocks = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<Guid, SemaphoreSlim> locks = new();
    private readonly ConcurrentDictionary<Guid, byte> damagedRecordings = new();
    public string DirectoryPath { get; }

    public FileOutboxStore(string directory)
    {
        DirectoryPath = Path.GetFullPath(directory);
        Directory.CreateDirectory(DirectoryPath);
    }

    public async Task<OutboxRecording> CreateAsync(CreateRecordingRequest request, CancellationToken cancellationToken = default)
    {
        return await LockedAsync(request.ClientRef, async () =>
        {
            if (File.Exists(Manifest(request.ClientRef))) return await LoadUnsafeAsync(request.ClientRef, cancellationToken);
            var createdUtc = DateTimeOffset.UtcNow;
            var recording = new OutboxRecording { Request = request, CreatedSequence = await NextSequenceAsync(cancellationToken),
                CreatedUtc = createdUtc, NotBeforeUtc = createdUtc.AddSeconds(5) };
            await SaveUnsafeAsync(recording, cancellationToken);
            return recording;
        }, cancellationToken);
    }

    public Task<bool> ContainsAsync(Guid clientRef, CancellationToken cancellationToken = default) =>
        Task.FromResult(File.Exists(Manifest(clientRef)));

    public Task<OutboxRecording> ReadAsync(Guid clientRef, CancellationToken cancellationToken = default) =>
        LockedAsync(clientRef, () => LoadUnsafeAsync(clientRef, cancellationToken), cancellationToken);

    public async Task AddChunkAsync(Guid clientRef, string track, int sequence, int startMs,
        int durationMs, byte[] wav, CancellationToken cancellationToken = default)
    {
        if (track is not ("mic" or "system") || sequence < 0 || sequence > 1500 || startMs < 0 || durationMs <= 0
            || durationMs > 180000 || (long)startMs + durationMs > 43200000 || wav.Length != 44 + durationMs * 32)
            throw new ArgumentException("Invalid canonical chunk.");
        await LockedAsync(clientRef, async () =>
        {
            var recording = await LoadUnsafeAsync(clientRef, cancellationToken);
            var existing = recording.Chunks.Find(c => c.Metadata.Track == track && c.Metadata.Sequence == sequence);
            var metadata = new ChunkMetadata(track, sequence, startMs, durationMs, "audio/wav", wav.Length);
            if (existing is not null)
            {
                if (existing.Metadata != metadata) throw new InvalidDataException("Recovered chunk metadata conflicts.");
                if (!existing.Confirmed && !File.Exists(ChunkPath(clientRef, existing)))
                    await AtomicWriteAsync(ChunkPath(clientRef, existing), wav, cancellationToken);
                return true;
            }
            if (recording.CaptureStopped) throw new InvalidOperationException("Recording capture is already sealed.");
            var chunk = new OutboxChunk { Metadata = metadata, FileName = $"{track}-{sequence:D4}.wav" };
            await AtomicWriteAsync(ChunkPath(clientRef, chunk), wav, cancellationToken);
            recording.Chunks.Add(chunk);
            await SaveUnsafeAsync(recording, cancellationToken);
            return true;
        }, cancellationToken);
    }

    public async Task StopAsync(Guid clientRef, int durationMs, CancellationToken cancellationToken = default)
    {
        if (durationMs is < 0 or > 43200000) throw new ArgumentOutOfRangeException(nameof(durationMs));
        await LockedAsync(clientRef, async () =>
        {
            var recording = await LoadUnsafeAsync(clientRef, cancellationToken);
            recording.CaptureStopped = true;
            recording.DurationMs = recording.Chunks.Count == 0 ? 0 : Math.Max(durationMs,
                recording.Chunks.Max(c => c.Metadata.StartMs + c.Metadata.DurationMs));
            await SaveUnsafeAsync(recording, cancellationToken);
            return true;
        }, cancellationToken);
    }

    public Task<bool> SetUnlinkedAsync(Guid clientRef, CancellationToken cancellationToken = default) =>
        LockedAsync(clientRef, async () =>
        {
            var recording = await LoadUnsafeAsync(clientRef, cancellationToken);
            if (recording.CreateSent) return false;
            recording.Request = recording.Request with { CallId = null, CallKind = null };
            await SaveUnsafeAsync(recording, cancellationToken);
            return true;
        }, cancellationToken);

    public int LocalRecordingCount => RecordingIds().Count();

    public IEnumerable<Guid> RecordingIds() => Directory.EnumerateDirectories(DirectoryPath)
        .Select(Path.GetFileName).Where(name => Guid.TryParse(name, out _)).Select(name => Guid.Parse(name!))
        .Where(id => File.Exists(Manifest(id))).OrderBy(CreatedSequenceForOrdering)
        .ThenBy(id => File.GetCreationTimeUtc(Manifest(id))).ThenBy(id => id);

    /// <summary>Only completed server recordings expire. Blocked and pending audio is retained.</summary>
    public async Task<IReadOnlyList<Guid>> PruneTerminalAsync(DateTimeOffset now, CancellationToken cancellationToken = default,
        string? captureDirectory = null)
    {
        var removed = new List<Guid>();
        foreach (var id in RecordingIds().ToArray())
        {
            await LockedAsync(id, async () =>
            {
                try
                {
                    var recording = await LoadUnsafeAsync(id, cancellationToken);
                    if (recording.TerminalState is not ("ready" or "failed")) return false;
                    var terminalUtc = recording.TerminalUtc ?? File.GetLastWriteTimeUtc(Manifest(id));
                    if (terminalUtc > now.AddDays(-7)) return false;
                    if (captureDirectory is not null)
                    {
                        var captureRoot = Path.GetFullPath(captureDirectory);
                        var captureFolder = Path.GetFullPath(Path.Combine(captureRoot, id.ToString("D")));
                        if (!captureFolder.StartsWith(Path.TrimEndingDirectorySeparator(captureRoot) + Path.DirectorySeparatorChar,
                            StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Invalid capture retention path.");
                        // Keep the manifest until both locations are clean, so interruption is retryable.
                        if (Directory.Exists(captureFolder)) Directory.Delete(captureFolder, true);
                    }
                    Directory.Delete(Folder(id), true);
                    removed.Add(id);
                }
                catch (Exception error) when (error is not OperationCanceledException || !cancellationToken.IsCancellationRequested) { }
                return true;
            }, cancellationToken);
        }
        return removed;
    }

    internal bool NeedsAttention(Guid id) => damagedRecordings.ContainsKey(id)
        || File.Exists(Path.Combine(Folder(id), "needs-attention.json"));

    internal async Task MarkDamagedUnsafeAsync(Guid id, CancellationToken cancellationToken)
    {
        damagedRecordings.TryAdd(id, 0);
        try
        {
            await AtomicWriteAsync(Path.Combine(Folder(id), "needs-attention.json"),
                JsonSerializer.SerializeToUtf8Bytes(new { error = OutboxPump.BlockedError }, Json), cancellationToken);
        }
        catch (Exception error) when (error is not OperationCanceledException || !cancellationToken.IsCancellationRequested) { }
    }

    private long CreatedSequenceForOrdering(Guid id)
    {
        try
        {
            using var document = JsonDocument.Parse(File.ReadAllBytes(Manifest(id)));
            if (document.RootElement.TryGetProperty("createdSequence", out var sequence) && sequence.TryGetInt64(out var value))
                return value;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or InvalidOperationException) { }
        return 0;
    }

    private async Task<long> NextSequenceAsync(CancellationToken cancellationToken)
    {
        var gate = sequenceLocks.GetOrAdd(DirectoryPath, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);
        try
        {
            var path = Path.Combine(DirectoryPath, "created-sequence.json");
            var sequence = File.Exists(path)
                ? JsonSerializer.Deserialize<long>(await File.ReadAllBytesAsync(path, cancellationToken), Json)
                : RecordingIds().Select(CreatedSequenceForOrdering).DefaultIfEmpty().Max();
            sequence = checked(sequence + 1);
            await AtomicWriteAsync(path, JsonSerializer.SerializeToUtf8Bytes(sequence, Json), cancellationToken);
            return sequence;
        }
        finally { gate.Release(); }
    }

    internal string ChunkPath(Guid clientRef, OutboxChunk chunk)
    {
        if (chunk.FileName != $"{chunk.Metadata.Track}-{chunk.Metadata.Sequence:D4}.wav")
            throw new InvalidDataException("Invalid outbox chunk path.");
        return Path.Combine(Folder(clientRef), chunk.FileName);
    }
    internal async Task<T> LockedAsync<T>(Guid clientRef, Func<Task<T>> work, CancellationToken cancellationToken)
    {
        var gate = locks.GetOrAdd(clientRef, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);
        try { return await work(); } finally { gate.Release(); }
    }
    internal async Task<OutboxRecording> LoadUnsafeAsync(Guid clientRef, CancellationToken cancellationToken)
    {
        var bytes = await File.ReadAllBytesAsync(Manifest(clientRef), cancellationToken);
        var recording = JsonSerializer.Deserialize<OutboxRecording>(bytes, Json) ?? throw new InvalidDataException("Empty outbox manifest.");
        if (recording.Request.ClientRef != clientRef) throw new InvalidDataException("Outbox identity mismatch.");
        if (recording.CreatedSequence == 0)
        {
            recording.CreatedUtc = File.GetCreationTimeUtc(Manifest(clientRef));
            if (recording.TerminalState is "ready" or "failed" && recording.TerminalUtc is null)
                recording.TerminalUtc = File.GetLastWriteTimeUtc(Manifest(clientRef));
            recording.CreatedSequence = await NextSequenceAsync(cancellationToken);
            await SaveUnsafeAsync(recording, cancellationToken);
        }
        return recording;
    }
    internal Task SaveUnsafeAsync(OutboxRecording recording, CancellationToken cancellationToken) =>
        AtomicWriteAsync(Manifest(recording.Request.ClientRef), JsonSerializer.SerializeToUtf8Bytes(recording, Json), cancellationToken);
    private string Folder(Guid id) => Path.Combine(DirectoryPath, id.ToString("D"));
    private string Manifest(Guid id) => Path.Combine(Folder(id), "recording.json");

    public static async Task AtomicWriteAsync(string path, byte[] bytes, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = path + ".tmp";
        using (var stream = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None,
                   4096, FileOptions.WriteThrough | FileOptions.Asynchronous))
        {
            await stream.WriteAsync(bytes, cancellationToken);
            await stream.FlushAsync(cancellationToken);
            stream.Flush(true);
        }
        File.Move(temporary, path, true);
    }
}
