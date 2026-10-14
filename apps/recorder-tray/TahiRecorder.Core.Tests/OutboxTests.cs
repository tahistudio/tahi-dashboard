using System.Text.Json;
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
    public async Task TransientChunkReadFailurePreservesAudioAndRetriesAfterBackoff()
    {
        var (store, id) = await QueuedAsync();
        var path = Path.Combine(directory, id.ToString("D"), "mic-0000.wav");
        var pump = new OutboxPump(store, api, clock);
        var blocked = new List<Guid>();
        pump.RecordingBlocked += blocked.Add;
        using (var lockedAudio = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None))
        {
            await pump.PumpOnceAsync();
            var delayed = await store.ReadAsync(id);
            Assert.Null(delayed.TerminalState);
            Assert.False(delayed.Chunks.Single().Confirmed);
            Assert.Equal(clock.GetUtcNow().AddSeconds(2), delayed.NextAttemptUtc);
            await pump.PumpOnceAsync();
            Assert.Equal(0, api.Uploads);
        }
        Assert.Empty(blocked);
        Assert.Equal(0, api.Stops);
        Assert.True(File.Exists(path));
        clock.Advance(TimeSpan.FromSeconds(2));
        await pump.PumpOnceAsync();
        Assert.True((await store.ReadAsync(id)).Chunks.Single().Confirmed);
        Assert.Equal(1, api.Uploads);
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(false, true)]
    [InlineData(true, false)]
    [InlineData(true, true)]
    public async Task MissingChunkFileOrDirectoryBlocksAndAttemptsServerStop(bool missingDirectory, bool stopFails)
    {
        var (store, id) = await QueuedAsync(includeSystem: true);
        var folder = Path.Combine(directory, id.ToString("D"));
        var path = Path.Combine(folder, "mic-0000.wav");
        var relocated = Path.Combine(directory, "relocated-audio");
        if (missingDirectory)
        {
            // Remove the containing directory after its manifest was read, so the actual chunk read fails.
            api.Reserving = () => Directory.Move(folder, relocated);
            api.Stopping = () => Directory.Move(relocated, folder);
        }
        else File.Delete(path);
        if (stopFails) api.StopError = new HttpRequestException();
        var pump = new OutboxPump(store, api, clock);
        var blocked = new List<Guid>();
        pump.RecordingBlocked += blocked.Add;
        try
        {
            await pump.PumpOnceAsync();
            var item = await store.ReadAsync(id);
            Assert.Equal("blocked", item.TerminalState);
            Assert.Equal(OutboxPump.BlockedError, item.LastError);
            Assert.Equal(clock.GetUtcNow(), item.TerminalUtc);
            Assert.False(item.Chunks.Single().Confirmed);
            Assert.Equal(!stopFails, item.StopConfirmed);
            Assert.Equal(id, Assert.Single(blocked));
            Assert.Single(api.Created);
            Assert.Equal(0, api.Uploads);
            Assert.Equal(1, api.Stops);
            Assert.Equal(new ExpectedChunks(1, 1), api.Stopped!.ExpectedChunks);
            Assert.Equal(100, api.Stopped.DurationMs);
            Assert.Equal(missingDirectory, File.Exists(path));
            clock.Advance(TimeSpan.FromHours(1));
            await new OutboxPump(Store, api, clock).PumpOnceAsync();
            Assert.Equal(1, api.Stops);
            Assert.Equal(0, api.Uploads);
        }
        finally
        {
            if (Directory.Exists(relocated)) Directory.Move(relocated, folder);
        }
    }

    [Fact]
    public async Task RepeatedChunkReadFailuresBlockOnTenthAttemptAcrossRestartAndRetainAudio()
    {
        var (store, id) = await QueuedAsync();
        var path = Path.Combine(directory, id.ToString("D"), "mic-0000.wav");
        var blocked = new List<Guid>();
        using (var lockedAudio = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None))
        {
            for (var attempt = 1; attempt <= 10; attempt++)
            {
                var pump = new OutboxPump(Store, api, clock);
                pump.RecordingBlocked += blocked.Add;
                await pump.PumpOnceAsync();
                var item = await store.ReadAsync(id);
                Assert.Equal(attempt, item.Failures);
                Assert.Equal(attempt, item.ConsecutiveIoFailures);
                Assert.False(item.Chunks.Single().Confirmed);
                if (attempt < 10)
                {
                    Assert.Null(item.TerminalState);
                    Assert.Empty(blocked);
                    Assert.Equal(0, api.Stops);
                    clock.Advance(item.NextAttemptUtc - clock.GetUtcNow());
                }
                else
                {
                    Assert.Equal("blocked", item.TerminalState);
                    Assert.Equal(OutboxPump.BlockedError, item.LastError);
                    Assert.True(item.StopConfirmed);
                }
            }
        }
        Assert.Equal(id, Assert.Single(blocked));
        Assert.Equal(1, api.Stops);
        Assert.Equal(new ExpectedChunks(1, 0), api.Stopped!.ExpectedChunks);
        Assert.Equal(100, api.Stopped.DurationMs);
        Assert.Equal(0, api.Uploads);
        Assert.True(File.Exists(path));
        clock.Advance(TimeSpan.FromHours(1));
        await new OutboxPump(Store, api, clock).PumpOnceAsync();
        Assert.Equal(1, api.Stops);
        Assert.Equal(0, api.Uploads);
        Assert.True(File.Exists(path));
    }

    [Fact]
    public async Task OfflineRetriesDoNotConsumeChunkIoFailureBudget()
    {
        var (store, id) = await QueuedAsync();
        api.ReserveError = new HttpRequestException();
        for (var attempt = 1; attempt <= 12; attempt++)
        {
            await new OutboxPump(Store, api, clock).PumpOnceAsync();
            var offline = await store.ReadAsync(id);
            Assert.Null(offline.TerminalState);
            Assert.Equal(attempt, offline.Failures);
            Assert.Equal(0, offline.ConsecutiveIoFailures);
            clock.Advance(offline.NextAttemptUtc - clock.GetUtcNow());
        }

        api.ReserveError = null;
        var path = Path.Combine(directory, id.ToString("D"), "mic-0000.wav");
        using (var lockedAudio = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None))
        {
            await new OutboxPump(Store, api, clock).PumpOnceAsync();
            var delayed = await store.ReadAsync(id);
            Assert.Null(delayed.TerminalState);
            Assert.Equal(13, delayed.Failures);
            Assert.Equal(1, delayed.ConsecutiveIoFailures);
            Assert.False(delayed.Chunks.Single().Confirmed);
            clock.Advance(delayed.NextAttemptUtc - clock.GetUtcNow());
        }

        await new OutboxPump(Store, api, clock).PumpOnceAsync();
        Assert.True((await store.ReadAsync(id)).Chunks.Single().Confirmed);
        Assert.Equal(0, api.Stops);
    }

    [Theory]
    [InlineData("network")]
    [InlineData("api")]
    [InlineData("timeout")]
    [InlineData("json")]
    public async Task NonIoFailureResetsConsecutiveIoBudgetAcrossRestart(string failure)
    {
        var (store, id) = await QueuedAsync();
        var path = Path.Combine(directory, id.ToString("D"), "mic-0000.wav");
        using var lockedAudio = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None);
        for (var attempt = 1; attempt <= 9; attempt++)
        {
            await new OutboxPump(Store, api, clock).PumpOnceAsync();
            var delayed = await store.ReadAsync(id);
            Assert.Null(delayed.TerminalState);
            Assert.Equal(attempt, delayed.ConsecutiveIoFailures);
            clock.Advance(delayed.NextAttemptUtc - clock.GetUtcNow());
        }

        api.ReserveError = failure switch
        {
            "network" => new HttpRequestException(),
            "api" => new RecorderApiException(503, "membership_unavailable"),
            "timeout" => new OperationCanceledException(),
            _ => new JsonException()
        };
        await new OutboxPump(Store, api, clock).PumpOnceAsync();
        var interrupted = await store.ReadAsync(id);
        Assert.Null(interrupted.TerminalState);
        Assert.Equal(10, interrupted.Failures);
        Assert.Equal(0, interrupted.ConsecutiveIoFailures);
        clock.Advance(interrupted.NextAttemptUtc - clock.GetUtcNow());
        api.ReserveError = null;

        for (var attempt = 1; attempt <= 10; attempt++)
        {
            await new OutboxPump(Store, api, clock).PumpOnceAsync();
            var delayed = await store.ReadAsync(id);
            Assert.Equal(attempt, delayed.ConsecutiveIoFailures);
            Assert.Equal(attempt < 10 ? null : "blocked", delayed.TerminalState);
            clock.Advance(delayed.NextAttemptUtc - clock.GetUtcNow());
        }
        Assert.Equal(1, api.Stops);
        Assert.True(File.Exists(path));
    }

    [Fact]
    public async Task SuccessfulPumpResetsConsecutiveIoBudgetBeforeNextChunk()
    {
        var (store, id) = await QueuedAsync();
        var path = Path.Combine(directory, id.ToString("D"), "mic-0000.wav");
        using (var lockedAudio = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None))
        {
            for (var attempt = 1; attempt <= 9; attempt++)
            {
                await new OutboxPump(Store, api, clock).PumpOnceAsync();
                var delayed = await store.ReadAsync(id);
                Assert.Equal(attempt, delayed.ConsecutiveIoFailures);
                clock.Advance(delayed.NextAttemptUtc - clock.GetUtcNow());
            }
        }

        await new OutboxPump(Store, api, clock).PumpOnceAsync();
        var uploaded = await store.ReadAsync(id);
        Assert.True(uploaded.Chunks.Single().Confirmed);
        Assert.Equal(0, uploaded.Failures);
        Assert.Equal(0, uploaded.ConsecutiveIoFailures);
        await store.AddChunkAsync(id, "mic", 1, 100, 100, CanonicalWav.Write([], 100));
        clock.Advance(uploaded.NextAttemptUtc - clock.GetUtcNow());

        var nextPath = Path.Combine(directory, id.ToString("D"), "mic-0001.wav");
        using var nextLockedAudio = new FileStream(nextPath, FileMode.Open, FileAccess.Read, FileShare.None);
        for (var attempt = 1; attempt <= 9; attempt++)
        {
            await new OutboxPump(Store, api, clock).PumpOnceAsync();
            var delayed = await store.ReadAsync(id);
            Assert.Null(delayed.TerminalState);
            Assert.Equal(attempt, delayed.ConsecutiveIoFailures);
            clock.Advance(delayed.NextAttemptUtc - clock.GetUtcNow());
        }
        Assert.Equal(0, api.Stops);
        Assert.Equal(1, api.Uploads);
        Assert.True(File.Exists(nextPath));
    }

    [Fact]
    public async Task TransientManifestReadFailureDefersOnlyThatRecordingAndDoesNotMarkDamaged()
    {
        var (store, id) = await QueuedAsync();
        var second = Guid.NewGuid();
        await store.CreateAsync(new(second, "Second", ["mic"]));
        await store.AddChunkAsync(second, "mic", 0, 0, 100, CanonicalWav.Write([], 100));
        var path = Path.Combine(directory, id.ToString("D"), "recording.json");
        var pump = new OutboxPump(store, api, clock);
        var blocked = new List<Guid>();
        pump.RecordingBlocked += blocked.Add;
        using (var lockedManifest = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None))
        {
            Assert.True(await pump.HasPendingAsync());
            await pump.PumpOnceAsync();
            Assert.Equal(second, Assert.Single(api.Created).ClientRef);
            Assert.False(File.Exists(Path.Combine(directory, id.ToString("D"), "needs-attention.json")));
        }
        await pump.PumpOnceAsync();
        Assert.Single(api.Created);
        clock.Advance(TimeSpan.FromSeconds(2));
        await pump.PumpOnceAsync();
        Assert.Contains(api.Created, request => request.ClientRef == id);
        Assert.True((await store.ReadAsync(id)).Chunks.Single().Confirmed);
        Assert.Empty(blocked);
    }

    [Fact]
    public async Task TransientApiJsonFailurePreservesAudioAndRetriesAfterBackoff()
    {
        var (store, id) = await QueuedAsync();
        api.CreateError = new JsonException();
        var pump = new OutboxPump(store, api, clock);
        var blocked = new List<Guid>();
        pump.RecordingBlocked += blocked.Add;
        await pump.PumpOnceAsync();
        var delayed = await store.ReadAsync(id);
        Assert.Null(delayed.TerminalState);
        Assert.Equal(clock.GetUtcNow().AddSeconds(2), delayed.NextAttemptUtc);
        Assert.True(File.Exists(Path.Combine(directory, id.ToString("D"), "mic-0000.wav")));
        await pump.PumpOnceAsync();
        Assert.Single(api.Created);
        api.CreateError = null;
        clock.Advance(TimeSpan.FromSeconds(2));
        await pump.PumpOnceAsync();
        Assert.Equal(2, api.Created.Count);
        Assert.True((await store.ReadAsync(id)).Chunks.Single().Confirmed);
        Assert.Empty(blocked);
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
    public async Task FailedIsRetriedThreeTimesAndEmptyStopUsesZeroCounts()
    {
        var store = Store;
        var id = Guid.NewGuid();
        await store.CreateAsync(new(id, "Empty", ["mic", "system"]));
        await store.StopAsync(id, 100);
        api.StopState = "failed";
        api.TranscribeState = "failed";
        var pump = new OutboxPump(store, api, clock);
        await pump.PumpOnceAsync();
        Assert.Equal(new ExpectedChunks(0, 0), api.Stopped!.ExpectedChunks);
        Assert.Equal(0, api.Stopped.DurationMs);
        Assert.Null((await store.ReadAsync(id)).TerminalState);
        for (var retry = 0; retry < 3; retry++)
        {
            clock.Advance(TimeSpan.FromMinutes(1));
            await new OutboxPump(Store, api, clock).PumpOnceAsync();
        }
        Assert.Equal("failed", (await store.ReadAsync(id)).TerminalState);
        Assert.Equal(3, api.Transcribes);
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

    [Fact]
    public async Task PoisonUploadIsBlockedAndNextRecordingStillUploads()
    {
        var (store, poison) = await QueuedAsync(includeSystem: true);
        var second = Guid.NewGuid();
        await store.CreateAsync(new(second, "Second", ["mic", "system"]));
        await store.AddChunkAsync(second, "mic", 0, 0, 100, CanonicalWav.Write([], 100));
        api.PoisonClientRef = poison;
        var pump = new OutboxPump(store, api, clock);
        var blockedIds = new List<Guid>();
        pump.RecordingBlocked += id =>
        {
            Assert.Equal(0, api.Stops);
            blockedIds.Add(id);
        };
        await pump.PumpOnceAsync();
        var blocked = await store.ReadAsync(poison);
        Assert.Equal(new[] { poison }, blockedIds);
        Assert.Equal("blocked", blocked.TerminalState);
        Assert.Equal(OutboxPump.BlockedError, blocked.LastError);
        Assert.False(blocked.Chunks.Single().Confirmed);
        Assert.True((await store.ReadAsync(second)).Chunks.Single().Confirmed);
        Assert.Equal(2, api.Created.Count);
        Assert.Equal(1, api.Stops);
        Assert.True(blocked.StopConfirmed);
        Assert.Equal(new ExpectedChunks(1, 1), api.Stopped!.ExpectedChunks);
        Assert.Equal(100, api.Stopped.DurationMs);
        Assert.True(File.Exists(Path.Combine(directory, poison.ToString("D"), "mic-0000.wav")));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task BlockingUncertainCreateRecoversIdAndAttemptsStop(bool stopFails)
    {
        var (store, id) = await QueuedAsync(includeSystem: true);
        api.CreateError = new HttpRequestException();
        var pump = new OutboxPump(store, api, clock);
        await pump.PumpOnceAsync();
        Assert.Null((await store.ReadAsync(id)).RecordingId);
        var notified = false;
        pump.RecordingBlocked += blockedId =>
        {
            Assert.Equal(id, blockedId);
            Assert.Single(api.Created);
            notified = true;
        };
        api.CreateError = null;
        if (stopFails) api.StopError = new HttpRequestException();
        await pump.BlockRecordingAsync(id);
        var blocked = await store.ReadAsync(id);
        Assert.True(notified);
        Assert.Equal("blocked", blocked.TerminalState);
        Assert.Equal(id.ToString("N"), blocked.RecordingId);
        Assert.Equal(!stopFails, blocked.StopConfirmed);
        Assert.Equal(2, api.Created.Count);
        Assert.All(api.Created, request => Assert.Equal(id, request.ClientRef));
        Assert.Equal(1, api.Stops);
        Assert.Equal(new ExpectedChunks(1, 1), api.Stopped!.ExpectedChunks);
        Assert.True(File.Exists(Path.Combine(directory, id.ToString("D"), "mic-0000.wav")));
    }

    [Fact]
    public async Task ProgressResetsPollsAndSchedulesAnotherCallAfterOneSecond()
    {
        var (store, id) = await QueuedAsync();
        await store.StopAsync(id, 100);
        var pump = new OutboxPump(store, api, clock);
        await pump.PumpOnceAsync();
        Assert.Equal(1, (await store.ReadAsync(id)).TranscriptionPolls);
        api.TranscribeChunks = [new("mic", 0, true, "ready")];
        clock.Advance(TimeSpan.FromSeconds(2));
        await pump.PumpOnceAsync();
        var progressed = await store.ReadAsync(id);
        Assert.Equal(0, progressed.TranscriptionPolls);
        Assert.Equal(clock.GetUtcNow().AddSeconds(1), progressed.NextAttemptUtc);
        await pump.PumpOnceAsync();
        Assert.Equal(2, api.Transcribes);
        api.ReadChunks = api.TranscribeChunks;
        clock.Advance(TimeSpan.FromSeconds(1));
        await pump.PumpOnceAsync();
        Assert.Equal(3, api.Transcribes);
        Assert.Equal(1, (await store.ReadAsync(id)).TranscriptionPolls);
    }

    [Fact]
    public async Task FailedServerStateCanRecoverOnRetry()
    {
        var (store, id) = await QueuedAsync();
        await store.StopAsync(id, 100);
        api.TranscribeState = "failed";
        var pump = new OutboxPump(store, api, clock);
        await pump.PumpOnceAsync();
        var failed = await store.ReadAsync(id);
        Assert.Null(failed.TerminalState);
        Assert.True(failed.NextAttemptUtc > clock.GetUtcNow());
        api.StopState = "failed";
        api.TranscribeState = "ready";
        clock.Advance(TimeSpan.FromMinutes(1));
        await pump.PumpOnceAsync();
        Assert.Equal("ready", (await store.ReadAsync(id)).TerminalState);
        Assert.Equal(2, api.Transcribes);
    }

    [Fact]
    public async Task SuccessfulTranscribeProgressResetsServerFailureRetries()
    {
        var (store, id) = await QueuedAsync();
        await store.StopAsync(id, 100);
        api.TranscribeState = "failed";
        var pump = new OutboxPump(store, api, clock);
        await pump.PumpOnceAsync();
        clock.Advance(TimeSpan.FromMinutes(1));
        await pump.PumpOnceAsync();
        Assert.Equal(1, (await store.ReadAsync(id)).ServerFailureRetries);
        api.TranscribeState = "transcribing";
        api.TranscribeChunks = [new("mic", 0, true, "ready")];
        clock.Advance(TimeSpan.FromMinutes(1));
        await pump.PumpOnceAsync();
        var progressed = await store.ReadAsync(id);
        Assert.False(progressed.ServerFailed);
        Assert.Equal(0, progressed.ServerFailureRetries);
        api.ReadChunks = api.TranscribeChunks;
        api.TranscribeState = "failed";
        for (var retry = 0; retry < 3; retry++)
        {
            clock.Advance(TimeSpan.FromMinutes(1));
            await pump.PumpOnceAsync();
        }
        var retrying = await store.ReadAsync(id);
        Assert.Null(retrying.TerminalState);
        Assert.Equal(2, retrying.ServerFailureRetries);
    }

    [Fact]
    public async Task ReadyChunkProgressResetsRetriesEvenWhenAggregateStateRemainsFailed()
    {
        var (store, id) = await QueuedAsync();
        await store.StopAsync(id, 100);
        api.TranscribeState = "failed";
        var pump = new OutboxPump(store, api, clock);
        await pump.PumpOnceAsync();
        for (var retry = 0; retry < 2; retry++)
        {
            clock.Advance(TimeSpan.FromMinutes(1));
            await pump.PumpOnceAsync();
        }
        Assert.Equal(2, (await store.ReadAsync(id)).ServerFailureRetries);
        api.TranscribeChunks = [new("mic", 0, true, "ready")];
        clock.Advance(TimeSpan.FromMinutes(1));
        await pump.PumpOnceAsync();
        var progressed = await store.ReadAsync(id);
        Assert.True(progressed.ServerFailed);
        Assert.Null(progressed.TerminalState);
        Assert.Equal(0, progressed.ServerFailureRetries);
        Assert.Equal(clock.GetUtcNow().AddSeconds(1), progressed.NextAttemptUtc);
        api.ReadChunks = api.TranscribeChunks;
        for (var retry = 0; retry < 3; retry++)
        {
            clock.Advance(TimeSpan.FromMinutes(1));
            await pump.PumpOnceAsync();
        }
        Assert.Equal("failed", (await store.ReadAsync(id)).TerminalState);
        Assert.Equal(7, api.Transcribes);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    public async Task PermanentConflictWithoutCodeIsBlocked(string? code)
    {
        var (store, id) = await QueuedAsync();
        api.CreateError = new RecorderApiException(409, code);
        await new OutboxPump(store, api, clock).PumpOnceAsync();
        Assert.Equal("blocked", (await store.ReadAsync(id)).TerminalState);
        Assert.Equal(OutboxPump.BlockedError, (await store.ReadAsync(id)).LastError);
    }

    [Fact]
    public async Task CreatedSequenceSurvivesRestartAndFileTimestampChanges()
    {
        var (store, first) = await QueuedAsync();
        var second = Guid.NewGuid();
        await Store.CreateAsync(new(second, "Second", ["mic"]));
        File.SetCreationTimeUtc(Path.Combine(directory, first.ToString("D"), "recording.json"), DateTime.UtcNow.AddDays(1));
        Assert.Equal(new[] { first, second }, Store.RecordingIds());
        Assert.True((await store.ReadAsync(first)).CreatedSequence < (await Store.ReadAsync(second)).CreatedSequence);
        Assert.Equal(2, Store.LocalRecordingCount);
    }

    [Fact]
    public async Task SevenDayRetentionPrunesOnlyReadyOrFailedAudio()
    {
        var (store, completed) = await QueuedAsync();
        await store.StopAsync(completed, 100);
        api.StopState = "ready";
        await new OutboxPump(store, api, clock).PumpOnceAsync();
        var audio = Path.Combine(directory, completed.ToString("D"), "mic-leftover.wav");
        await File.WriteAllBytesAsync(audio, [1, 2]);
        var captureDirectory = Path.Combine(directory, "capture");
        var captureAudio = Path.Combine(captureDirectory, completed.ToString("D"), "mic.pcm");
        Directory.CreateDirectory(Path.GetDirectoryName(captureAudio)!);
        await File.WriteAllBytesAsync(captureAudio, [1, 2]);
        var pending = Guid.NewGuid();
        await store.CreateAsync(new(pending, "Pending", ["mic"]));
        Assert.Empty(await store.PruneTerminalAsync(clock.GetUtcNow().AddDays(6)));
        Assert.Equal(new[] { completed }, await store.PruneTerminalAsync(clock.GetUtcNow().AddDays(7), captureDirectory: captureDirectory));
        Assert.False(File.Exists(audio));
        Assert.False(File.Exists(captureAudio));
        Assert.Equal(new[] { pending }, store.RecordingIds());
    }

    [Fact]
    public async Task InterruptedPruneRetainsCaptureJournalUntilAudioIsDeleted()
    {
        var (store, id) = await QueuedAsync();
        await store.StopAsync(id, 100);
        api.StopState = "ready";
        await new OutboxPump(store, api, clock).PumpOnceAsync();
        var captureDirectory = Path.Combine(directory, "capture");
        var captureFolder = Path.Combine(captureDirectory, id.ToString("D"));
        Directory.CreateDirectory(captureFolder);
        var journal = Path.Combine(captureFolder, "session.json");
        var audio = Path.Combine(captureFolder, "mic-0000.pcm");
        await File.WriteAllTextAsync(journal, "{}");
        await File.WriteAllBytesAsync(audio, [1, 2]);
        using (var lockedAudio = new FileStream(audio, FileMode.Open, FileAccess.Read, FileShare.None))
        {
            Assert.Empty(await store.PruneTerminalAsync(clock.GetUtcNow().AddDays(7), captureDirectory: captureDirectory));
            Assert.True(File.Exists(journal));
            Assert.True(await store.ContainsAsync(id));
        }
        Assert.Equal(new[] { id }, await store.PruneTerminalAsync(clock.GetUtcNow().AddDays(7), captureDirectory: captureDirectory));
        Assert.False(Directory.Exists(captureFolder));
    }

    [Theory]
    [InlineData("{")]
    [InlineData("[]")]
    [InlineData("{\"createdSequence\":\"invalid\"}")]
    public async Task DamagedManifestNeedsAttentionAndDoesNotTriggerAuthentication(string content)
    {
        var (store, id) = await QueuedAsync();
        await File.WriteAllTextAsync(Path.Combine(directory, id.ToString("D"), "recording.json"), content);
        var pump = new OutboxPump(store, api, clock);
        var statuses = new List<string>();
        pump.StatusChanged += statuses.Add;
        Assert.False(await pump.HasPendingAsync());
        Assert.False(pump.AuthenticationRequired);
        Assert.Contains(OutboxPump.BlockedError, statuses);
        Assert.True(File.Exists(Path.Combine(directory, id.ToString("D"), "needs-attention.json")));
        await pump.PumpOnceAsync();
        Assert.Empty(api.Created);
    }

    private async Task<(FileOutboxStore, Guid)> QueuedAsync(bool includeSystem = false)
    {
        var store = Store;
        var id = Guid.NewGuid();
        await store.CreateAsync(new(id, "Call", includeSystem ? ["mic", "system"] : ["mic"]));
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
        public Exception? StopError { get; set; }
        public Action? Reserving { get; set; }
        public Action? Stopping { get; set; }
        public Guid? PoisonClientRef { get; set; }
        public IReadOnlyList<ChunkState> ReadChunks { get; set; } = [];
        public IReadOnlyList<ChunkState> TranscribeChunks { get; set; } = [];
        public ChunkReservation Reservation { get; set; } = new("/api/admin/recordings/server/chunks", false, false);
        public int Uploads { get; private set; }
        public int Stops { get; private set; }
        public int Transcribes { get; private set; }
        public string StopState { get; set; } = "transcribing";
        public string TranscribeState { get; set; } = "transcribing";
        public StopRecordingRequest? Stopped { get; private set; }
        public Task<RecordingState> CreateAsync(CreateRecordingRequest request, CancellationToken ct)
        { Created.Add(request); if (CreateError is not null) throw CreateError; return Task.FromResult(new RecordingState(request.ClientRef.ToString("N"), "recording")); }
        public Task<ChunkReservation> ReserveAsync(string id, ChunkMetadata metadata, CancellationToken ct)
        {
            Reserving?.Invoke();
            if (ReserveError is not null) throw ReserveError;
            return Task.FromResult(id == PoisonClientRef?.ToString("N")
                ? new ChunkReservation("https://off-origin.invalid/upload", false, false) : Reservation);
        }
        public Task UploadAsync(string url, byte[] wav, CancellationToken ct)
        {
            Uploads++;
            if (url.StartsWith("https://off-origin.invalid", StringComparison.Ordinal)) throw new InvalidOperationException("Off-origin upload rejected.");
            if (UploadError is not null) throw UploadError;
            return Task.CompletedTask;
        }
        public Task<RecordingDetail> StopAsync(string id, StopRecordingRequest request, CancellationToken ct)
        {
            Stops++;
            Stopped = request;
            Stopping?.Invoke();
            if (StopError is not null) throw StopError;
            var enabledTracks = Created.Find(item => item.ClientRef.ToString("N") == id)?.Tracks ?? [];
            if (request.ExpectedChunks.Mic + request.ExpectedChunks.System > 0
                && (request.ExpectedChunks.Mic < 1 || enabledTracks.Contains("system") && request.ExpectedChunks.System < 1))
                throw new RecorderApiException(400);
            return Task.FromResult(Detail(StopState));
        }
        public Task<RecordingDetail> ReadAsync(string id, CancellationToken ct) => Task.FromResult(new RecordingDetail(new("server", StopState), ReadChunks));
        public Task<RecordingDetail> TranscribeAsync(string id, CancellationToken ct)
        { Transcribes++; return Task.FromResult(new RecordingDetail(new("server", TranscribeState), TranscribeChunks)); }
        public Task<IReadOnlyList<RecordingDetail>> ListAsync(CancellationToken ct) => Task.FromResult<IReadOnlyList<RecordingDetail>>([]);
        private static RecordingDetail Detail(string state) => new(new("server", state), []);
    }
}
