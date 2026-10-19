using System.Text.Json;
using TahiRecorder.Core.Api;
using TahiRecorder.Core.Audio;
using TahiRecorder.Core.Outbox;

namespace TahiRecorder.Core.Tests;

/// <summary>
/// The 2026-10-19 incident: a meeting ended while a device was switching, the native stop never returned,
/// and the session was left with a partial chunk, an unfinished journal and no outbox stop.
/// The fixtures copy the shapes of the real session.json and recording.json, not their contents.
/// </summary>
public sealed class WedgedSessionRecoveryTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "tahi-wedged-" + Guid.NewGuid().ToString("N"));
    private readonly Guid _stuck = Guid.Parse("ca9831d7-bb6e-4829-8c87-f5c64a834174");
    private const int ConfirmedChunksPerTrack = 119;
    private const int MicTailBytes = 405_566;
    private const int SystemTailBytes = 417_692;

    private string Capture => Path.Combine(_root, "capture");
    private string CaptureFolder => Path.Combine(Capture, _stuck.ToString("D"));

    [Fact]
    public async Task StartupFinalisesTheStuckSessionAndSendsStop()
    {
        var store = await StuckStoreAsync();

        var needsAttention = await OutboxRecovery.RecoverAsync(store, Capture);

        Assert.False(needsAttention);
        var recovered = await store.ReadAsync(_stuck);
        Assert.True(recovered.CaptureStopped);
        Assert.False(recovered.StopConfirmed);
        Assert.Equal((ConfirmedChunksPerTrack + 1) * 2, recovered.Chunks.Count);
        foreach (var track in new[] { "mic", "system" })
        {
            var tail = recovered.Chunks.Single(chunk => chunk.Metadata.Track == track && chunk.Metadata.Sequence == ConfirmedChunksPerTrack);
            Assert.False(tail.Confirmed);
            Assert.Equal(ConfirmedChunksPerTrack * 30_000, tail.Metadata.StartMs);
            Assert.Equal(3_583_052 - ConfirmedChunksPerTrack * 30_000, tail.Metadata.DurationMs);
            Assert.Equal(44 + tail.Metadata.DurationMs * 32, new FileInfo(Path.Combine(store.DirectoryPath,
                _stuck.ToString("D"), tail.FileName)).Length);
        }
        Assert.Equal(3_583_052, recovered.DurationMs);
        Assert.True(JsonDocument.Parse(File.ReadAllText(Path.Combine(CaptureFolder, "session.json")))
            .RootElement.GetProperty("Completed").GetBoolean());
        Assert.Empty(Directory.GetFiles(CaptureFolder, "*.pcm"));
        Assert.Empty(Directory.GetFiles(CaptureFolder, "*.wav"));

        var api = new RecordingApi();
        await new OutboxPump(store, api).PumpOnceAsync();

        var stop = Assert.IsType<StopRecordingRequest>(api.Stopped);
        Assert.Equal(new ExpectedChunks(ConfirmedChunksPerTrack + 1, ConfirmedChunksPerTrack + 1), stop.ExpectedChunks);
        Assert.Equal(3_583_052, stop.DurationMs);
        Assert.Equal(2, api.Uploads);
        Assert.True((await store.ReadAsync(_stuck)).StopConfirmed);
    }

    [Fact]
    public async Task RecoveryIsRepeatableAfterAnInterruptedStartup()
    {
        var store = await StuckStoreAsync();
        Assert.False(await OutboxRecovery.RecoverAsync(store, Capture));
        Assert.False(await OutboxRecovery.RecoverAsync(store, Capture));
        var recovered = await store.ReadAsync(_stuck);
        Assert.True(recovered.CaptureStopped);
        Assert.Equal((ConfirmedChunksPerTrack + 1) * 2, recovered.Chunks.Count);
    }

    [Fact]
    public async Task OtherFinishedRecordingsDoNotRaiseAttentionOrBlockTheStuckSession()
    {
        var store = await StuckStoreAsync();
        var finished = Guid.NewGuid();
        var recording = await store.CreateAsync(new(finished, "Earlier call", ["mic", "system"]));
        recording.CaptureStopped = true;
        recording.StopConfirmed = true;
        recording.TerminalState = "ready";
        await WriteManifestAsync(store, finished, recording);
        using (var spool = new DurableCaptureSpool(Capture, finished))
            spool.Advance(0, complete: true);

        Assert.False(await OutboxRecovery.RecoverAsync(store, Capture));
        Assert.True((await store.ReadAsync(_stuck)).CaptureStopped);
    }

    [Fact]
    public async Task RecoveryNeverTouchesASkippedLiveOrParkedSession()
    {
        var store = await StuckStoreAsync();
        var journalBefore = File.ReadAllText(Path.Combine(CaptureFolder, "session.json"));
        // A live pcm held open for writing, as a running capture holds it.
        using var live = new FileStream(Path.Combine(CaptureFolder, "mic-0119.pcm"), FileMode.Open,
            FileAccess.ReadWrite, FileShare.Read);
        var blocked = new List<Guid>();

        var attention = await OutboxRecovery.RecoverAsync(store, Capture,
            blockRecording: (id, _) => { blocked.Add(id); return Task.CompletedTask; },
            skip: new HashSet<Guid> { _stuck });

        Assert.False(attention);
        Assert.Empty(blocked);
        Assert.False(File.Exists(Path.Combine(store.DirectoryPath, _stuck.ToString("D"), "needs-attention.json")));
        Assert.Equal(journalBefore, File.ReadAllText(Path.Combine(CaptureFolder, "session.json")));
        Assert.False((await store.ReadAsync(_stuck)).CaptureStopped);
        Assert.Equal(2, Directory.GetFiles(CaptureFolder, "*.pcm").Length);
    }

    [Fact]
    public async Task StaleActiveRefOfAFailedStartDoesNotExcludeItFromRecovery()
    {
        var store = await StuckStoreAsync();
        // Only live or parked sessions are skipped; an unrelated id leaves the stuck session recoverable.
        Assert.False(await OutboxRecovery.RecoverAsync(store, Capture, skip: new HashSet<Guid> { Guid.NewGuid() }));
        Assert.True((await store.ReadAsync(_stuck)).CaptureStopped);
    }

    private async Task<FileOutboxStore> StuckStoreAsync()
    {
        var store = new FileOutboxStore(Path.Combine(_root, "outbox"));
        var recording = await store.CreateAsync(new(_stuck, "Meeting call", ["mic", "system"]));
        recording.CreateSent = true;
        recording.RecordingId = "server-recording";
        recording.NotBeforeUtc = DateTimeOffset.UtcNow.AddMinutes(-5);
        foreach (var track in new[] { "mic", "system" })
            for (var sequence = 0; sequence < ConfirmedChunksPerTrack; sequence++)
                recording.Chunks.Add(new OutboxChunk
                {
                    Metadata = new ChunkMetadata(track, sequence, sequence * 30_000, 30_000, "audio/wav", 44 + 30_000 * 32),
                    FileName = $"{track}-{sequence:D4}.wav",
                    Confirmed = true
                });
        await WriteManifestAsync(store, _stuck, recording);

        Directory.CreateDirectory(CaptureFolder);
        await File.WriteAllTextAsync(Path.Combine(CaptureFolder, "session.json"),
            $$$"""{"ClientRef":"{{{_stuck:D}}}","DurationMs":3582395,"Completed":false,"NextSequences":{"mic":119,"system":119},"AudioEndSamples":{"mic":57321983,"system":57320846}}""");
        await File.WriteAllBytesAsync(Path.Combine(CaptureFolder, "mic-0119.pcm"), Tone(MicTailBytes, 3));
        await File.WriteAllBytesAsync(Path.Combine(CaptureFolder, "system-0119.pcm"), Tone(SystemTailBytes, 5));
        return store;
    }

    private static byte[] Tone(int length, byte value)
    {
        var bytes = new byte[length];
        Array.Fill(bytes, value);
        return bytes;
    }

    private static Task WriteManifestAsync(FileOutboxStore store, Guid id, OutboxRecording recording) =>
        FileOutboxStore.AtomicWriteAsync(Path.Combine(store.DirectoryPath, id.ToString("D"), "recording.json"),
            JsonSerializer.SerializeToUtf8Bytes(recording, new JsonSerializerOptions(JsonSerializerDefaults.Web)), default);

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    private sealed class RecordingApi : IRecorderApi
    {
        public StopRecordingRequest? Stopped { get; private set; }
        public int Uploads { get; private set; }
        public Task<RecordingState> CreateAsync(CreateRecordingRequest request, CancellationToken ct) =>
            throw new InvalidOperationException("The server recording already exists.");
        public Task<ChunkReservation> ReserveAsync(string id, ChunkMetadata metadata, CancellationToken ct) =>
            Task.FromResult(new ChunkReservation("/api/admin/recordings/server/chunks", false, false));
        public Task UploadAsync(string url, byte[] wav, CancellationToken ct) { Uploads++; return Task.CompletedTask; }
        public Task<RecordingDetail> StopAsync(string id, StopRecordingRequest request, CancellationToken ct)
        {
            Stopped = request;
            return Task.FromResult(new RecordingDetail(new("server", "transcribing"), []));
        }
        public Task<RecordingDetail> ReadAsync(string id, CancellationToken ct) =>
            Task.FromResult(new RecordingDetail(new("server", "transcribing"), []));
        public Task<RecordingDetail> TranscribeAsync(string id, CancellationToken ct) =>
            Task.FromResult(new RecordingDetail(new("server", "transcribing"), []));
        public Task<IReadOnlyList<RecordingDetail>> ListAsync(CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<RecordingDetail>>([]);
    }
}
