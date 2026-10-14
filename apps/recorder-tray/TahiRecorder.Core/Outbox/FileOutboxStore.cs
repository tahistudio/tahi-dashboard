using System.Collections.Concurrent;
using System.Text.Json;
using TahiRecorder.Core.Api;

namespace TahiRecorder.Core.Outbox;

public sealed class OutboxRecording
{
    public required CreateRecordingRequest Request { get; set; }
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
    private readonly ConcurrentDictionary<Guid, SemaphoreSlim> locks = new();
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
            var recording = new OutboxRecording { Request = request, NotBeforeUtc = DateTimeOffset.UtcNow.AddSeconds(5) };
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

    public IEnumerable<Guid> RecordingIds() => Directory.EnumerateDirectories(DirectoryPath)
        .Select(Path.GetFileName).Where(name => Guid.TryParse(name, out _)).Select(name => Guid.Parse(name!))
        .Where(id => File.Exists(Manifest(id))).OrderBy(id => File.GetCreationTimeUtc(Manifest(id)));

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
