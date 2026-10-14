using TahiRecorder.Core.Api;
using TahiRecorder.Core.Audio;
using TahiRecorder.Core.Outbox;
using Xunit;

namespace TahiRecorder.Core.Tests;

public sealed class OutboxTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "TahiRecorderTests", Guid.NewGuid().ToString("N"));
    private readonly FakeClock clock = new();
    private readonly FakeApi api = new();
    private FileOutboxStore Store => new(directory);

    [Fact]
    public async Task CreateRetryRetainsClientRefAcrossRestart()
    {
        var (store, id) = await QueuedAsync();
        api.CreateError = new HttpRequestException();
        await new OutboxPump(store, api, clock).PumpOnceAsync();
        var first = await store.ReadAsync(id);
        Assert.True(first.CreateSent);
        Assert.Null(first.RecordingId);
        Assert.NotEmpty(Directory.GetFiles(Path.Combine(directory, id.ToString("D")), "*.wav"));
        api.CreateError = null;
        clock.Advance(TimeSpan.FromMinutes(1));
        await new OutboxPump(Store, api, clock).PumpOnceAsync();
        Assert.All(api.Created, request => Assert.Equal(id, request.ClientRef));
        Assert.Equal(2, api.Created.Count);
    }

    [Theory]
    [InlineData(false, false, 1)]
    [InlineData(true, false, 1)]
    [InlineData(true, true, 0)]
    public async Task ReservationOnlyConfirmsWhenUploaded(bool duplicate, bool uploaded, int uploads)
    {
        var (store, id) = await QueuedAsync();
        api.Reservation = new("/api/admin/recordings/server/chunks", duplicate, uploaded);
        await new OutboxPump(store, api, clock).PumpOnceAsync();
        Assert.Equal(uploads, api.Uploads);
        Assert.True((await store.ReadAsync(id)).Chunks.Single().Confirmed);
        Assert.Empty(Directory.GetFiles(Path.Combine(directory, id.ToString("D")), "*.wav"));
    }

    [Theory]
    [InlineData(true, true)]
    [InlineData(false, false)]
    public async Task PutDuplicateRequiresUploadedTrue(bool uploaded, bool confirmed)
    {
        var (store, id) = await QueuedAsync();
        api.UploadError = new RecorderApiException(409, "duplicate", uploaded);
        await new OutboxPump(store, api, clock).PumpOnceAsync();
        Assert.Equal(confirmed, (await store.ReadAsync(id)).Chunks.Single().Confirmed);
        Assert.Equal(!confirmed, File.Exists(Path.Combine(directory, id.ToString("D"), "mic-0000.wav")));
    }

    [Theory]
    [InlineData(429, "open_recording", 30)]
    [InlineData(429, "daily_quota", 900)]
    [InlineData(409, "busy", 2)]
    [InlineData(503, "membership_unavailable", 2)]
    public async Task RetryCodesPreserveAudioAndScheduleBackoff(int status, string code, int minimumSeconds)
    {
        var (store, id) = await QueuedAsync();
        api.CreateError = new RecorderApiException(status, code);
        await new OutboxPump(store, api, clock).PumpOnceAsync();
        var item = await store.ReadAsync(id);
        Assert.Null(item.TerminalState);
        Assert.True(item.NextAttemptUtc >= clock.GetUtcNow().AddSeconds(minimumSeconds));
        Assert.True(File.Exists(Path.Combine(directory, id.ToString("D"), "mic-0000.wav")));
    }

    [Fact]
    public async Task RetryAfterIsRespectedAndAuthenticationFailsClosed()
    {
        var (store, id) = await QueuedAsync();
        api.CreateError = new RecorderApiException(503, retryAfter: TimeSpan.FromMinutes(7));
        var pump = new OutboxPump(store, api, clock);
        await pump.PumpOnceAsync();
        Assert.Equal(clock.GetUtcNow().AddMinutes(7), (await store.ReadAsync(id)).NextAttemptUtc);
        api.CreateError = new RecorderApiException(401);
        clock.Advance(TimeSpan.FromMinutes(8));
        await pump.PumpOnceAsync();
        Assert.True(pump.AuthenticationRequired);
        clock.Advance(TimeSpan.FromHours(1));
        await pump.PumpOnceAsync();
        Assert.Equal(2, api.Created.Count);
    }

    [Fact]
    public async Task StopCountsAndTranscriptionResumeUntilReady()
    {
        var (store, id) = await QueuedAsync();
        await store.StopAsync(id, 100);
        var pump = new OutboxPump(store, api, clock);
        await pump.PumpOnceAsync();
        Assert.Equal(new ExpectedChunks(1, 0), api.Stopped!.ExpectedChunks);
        Assert.Equal(100, api.Stopped.DurationMs);
        Assert.Null((await store.ReadAsync(id)).TerminalState);
        api.TranscribeState = "ready";
        clock.Advance(TimeSpan.FromMinutes(1));
        await new OutboxPump(Store, api, clock).PumpOnceAsync();
        Assert.Equal("ready", (await store.ReadAsync(id)).TerminalState);
        Assert.Equal(1, api.Stops);
        Assert.Equal(2, api.Transcribes);
    }

    [Fact]
    public async Task FailedIsTerminalAndEmptyStopUsesZeroCounts()
    {
        var store = Store;
        var id = Guid.NewGuid();
        await store.CreateAsync(new(id, "Empty", ["mic", "system"]));
        await store.StopAsync(id, 100);
        api.StopState = "failed";
        await new OutboxPump(store, api, clock).PumpOnceAsync();
        Assert.Equal(new ExpectedChunks(0, 0), api.Stopped!.ExpectedChunks);
        Assert.Equal(0, api.Stopped.DurationMs);
        Assert.Equal("failed", (await store.ReadAsync(id)).TerminalState);
        Assert.Equal(0, api.Transcribes);
    }

    [Fact]
    public async Task ReservationConflictCanReconcileUploadedBodyFromOwnedRead()
    {
        var (store, id) = await QueuedAsync();
        api.ReserveError = new RecorderApiException(409);
        api.ReadChunks = [new("mic", 0, true, "ready")];
        await new OutboxPump(store, api, clock).PumpOnceAsync();
        Assert.True((await store.ReadAsync(id)).Chunks.Single().Confirmed);
        Assert.Equal(0, api.Uploads);
        Assert.Empty(Directory.GetFiles(Path.Combine(directory, id.ToString("D")), "*.wav"));
    }

    [Fact]
    public async Task ReservationBusyWithUnuploadedReadRetainsTheLocalBody()
    {
        var (store, id) = await QueuedAsync();
        api.ReserveError = new RecorderApiException(409, "busy");
        api.ReadChunks = [new("mic", 0, false, "reserved")];
        await new OutboxPump(store, api, clock).PumpOnceAsync();
        Assert.False((await store.ReadAsync(id)).Chunks.Single().Confirmed);
        Assert.Equal(0, api.Uploads);
        Assert.True(File.Exists(Path.Combine(directory, id.ToString("D"), "mic-0000.wav")));
    }

    [Fact]
    public async Task NotThisCallIsAllowedOnlyBeforeSend()
    {
        var store = Store;
        var id = Guid.NewGuid();
        await store.CreateAsync(new(id, "Call", ["mic"], "scheduled", "call1"));
        Assert.True(await store.SetUnlinkedAsync(id));
        Assert.Null((await store.ReadAsync(id)).Request.CallId);
        api.CreateError = new HttpRequestException();
        await new OutboxPump(store, api, clock).PumpOnceAsync();
        Assert.False(await store.SetUnlinkedAsync(id));
    }

    [Fact]
    public async Task ConcurrentPumpsSerializeOneRecording()
    {
        var (store, _) = await QueuedAsync();
        await Task.WhenAll(new OutboxPump(store, api, clock).PumpOnceAsync(), new OutboxPump(store, api, clock).PumpOnceAsync());
        Assert.Single(api.Created);
        Assert.Equal(1, api.Uploads);
    }

    private async Task<(FileOutboxStore, Guid)> QueuedAsync()
    {
        var store = Store;
        var id = Guid.NewGuid();
        await store.CreateAsync(new(id, "Call", ["mic", "system"]));
        await store.AddChunkAsync(id, "mic", 0, 0, 100, CanonicalWav.Write([], 100));
        return (store, id);
    }

    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }

    private sealed class FakeClock : TimeProvider
    {
        private DateTimeOffset now = DateTimeOffset.UtcNow.AddHours(1);
        public override DateTimeOffset GetUtcNow() => now;
        public void Advance(TimeSpan time) => now += time;
    }

    private sealed class FakeApi : IRecorderApi
    {
        public List<CreateRecordingRequest> Created { get; } = [];
        public Exception? CreateError { get; set; }
        public Exception? UploadError { get; set; }
        public Exception? ReserveError { get; set; }
        public IReadOnlyList<ChunkState> ReadChunks { get; set; } = [];
        public ChunkReservation Reservation { get; set; } = new("/api/admin/recordings/server/chunks", false, false);
        public int Uploads { get; private set; }
        public int Stops { get; private set; }
        public int Transcribes { get; private set; }
        public string StopState { get; set; } = "transcribing";
        public string TranscribeState { get; set; } = "transcribing";
        public StopRecordingRequest? Stopped { get; private set; }
        public Task<RecordingState> CreateAsync(CreateRecordingRequest request, CancellationToken ct)
        { Created.Add(request); if (CreateError is not null) throw CreateError; return Task.FromResult(new RecordingState("server", "recording")); }
        public Task<ChunkReservation> ReserveAsync(string id, ChunkMetadata metadata, CancellationToken ct)
        { if (ReserveError is not null) throw ReserveError; return Task.FromResult(Reservation); }
        public Task UploadAsync(string url, byte[] wav, CancellationToken ct)
        { Uploads++; if (UploadError is not null) throw UploadError; return Task.CompletedTask; }
        public Task<RecordingDetail> StopAsync(string id, StopRecordingRequest request, CancellationToken ct)
        { Stops++; Stopped = request; return Task.FromResult(Detail(StopState)); }
        public Task<RecordingDetail> ReadAsync(string id, CancellationToken ct) => Task.FromResult(new RecordingDetail(new("server", StopState), ReadChunks));
        public Task<RecordingDetail> TranscribeAsync(string id, CancellationToken ct)
        { Transcribes++; return Task.FromResult(Detail(TranscribeState)); }
        public Task<IReadOnlyList<RecordingDetail>> ListAsync(CancellationToken ct) => Task.FromResult<IReadOnlyList<RecordingDetail>>([]);
        private static RecordingDetail Detail(string state) => new(new("server", state), []);
    }
}
