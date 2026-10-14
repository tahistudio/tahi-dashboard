using System.Text.Json.Nodes;
using TahiRecorder.Core.Audio;

namespace TahiRecorder.Core.Tests;

public sealed class CaptureSpoolTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "tahi-spool-tests-" + Guid.NewGuid().ToString("N"));
    private readonly Guid _clientRef = Guid.NewGuid();

    [Fact]
    public void PadsBothTracksAgainstTheSharedClock()
    {
        using var spool = new DurableCaptureSpool(_directory, _clientRef);
        spool.AddAt("mic", 2, [1, 0, 2, 0]);
        var chunks = spool.Advance(1, complete: true);
        Assert.Equal(2, chunks.Count);
        var mic = Payload(chunks.Single(chunk => chunk.Track == "mic"));
        Assert.Equal(new byte[] { 0, 0, 0, 0, 1, 0, 2, 0 }, mic[..8]);
        Assert.All(mic.Skip(8), value => Assert.Equal(0, value));
        Assert.All(Payload(chunks.Single(chunk => chunk.Track == "system")), value => Assert.Equal(0, value));
        AssertCanonical(chunks);
    }

    [Fact]
    public void PacketCrossesChunkBoundaryAndLatePacketsCannotChangeEmittedAudio()
    {
        using var spool = new DurableCaptureSpool(_directory, _clientRef);
        AddBoth(spool, 0, Pcm(33_000, 7));
        var emitted = spool.Advance(32_000, complete: false);
        Assert.Equal(2, emitted.Count);
        spool.AddAt("mic", 0, [9, 9, 9, 9]);
        Assert.All(Payload(emitted.Single(chunk => chunk.Track == "mic")), value => Assert.Equal(7, value));
        var tail = spool.Advance(33_000, complete: true);
        Assert.All(tail, chunk => Assert.Equal(30_000, chunk.StartMs));
        Assert.All(tail, chunk => Assert.Equal(3_000, chunk.DurationMs));
        Assert.All(tail.SelectMany(Payload), value => Assert.Equal(7, value));
        AssertCanonical(emitted.Concat(tail));
    }

    [Theory]
    [InlineData(30_001)]
    [InlineData(31_000)]
    [InlineData(31_999)]
    public void FinalPartialShorterThanTwoSecondsIsFoldedIntoRetainedChunk(int durationMs)
    {
        using var spool = new DurableCaptureSpool(_directory, _clientRef);
        AddBoth(spool, 0, Pcm(durationMs, 7));
        Assert.Empty(spool.Advance(30_000, complete: false));
        var final = spool.Advance(durationMs, complete: true);
        Assert.Equal(2, final.Count);
        Assert.All(final, chunk => Assert.Equal(durationMs, chunk.DurationMs));
        Assert.All(final, chunk => Assert.Equal(0, chunk.Sequence));
        Assert.All(final.SelectMany(Payload), value => Assert.Equal(7, value));
        AssertCanonical(final);
    }

    [Fact]
    public void TwoSecondFinalPartialRemainsASeparateChunk()
    {
        using var spool = new DurableCaptureSpool(_directory, _clientRef);
        AddBoth(spool, 0, Pcm(32_000));
        var chunks = spool.Advance(32_000, complete: true);
        Assert.Equal(4, chunks.Count);
        Assert.Equal(new[] { 30_000, 2_000 }, chunks.Where(chunk => chunk.Track == "mic").Select(chunk => chunk.DurationMs));
        AssertCanonical(chunks);
    }

    [Fact]
    public void FinalPartialFoldsOnlyIntoTheUnpublishedPreviousChunk()
    {
        using var spool = new DurableCaptureSpool(_directory, _clientRef);
        AddBoth(spool, 0, Pcm(61_000));
        var published = spool.Advance(60_000, complete: false);
        Assert.Equal(2, published.Count);
        var final = spool.Advance(61_000, complete: true);
        Assert.All(final, chunk => Assert.Equal(1, chunk.Sequence));
        Assert.All(final, chunk => Assert.Equal(30_000, chunk.StartMs));
        Assert.All(final, chunk => Assert.Equal(31_000, chunk.DurationMs));
        AssertCanonical(published.Concat(final));
    }

    [Fact]
    public void RecoverySealsPcmNotYetWrittenToTheJournalAndIsRepeatable()
    {
        using (var spool = new DurableCaptureSpool(_directory, _clientRef))
        {
            AddBoth(spool, 0, Pcm(31_000, 6));
            Assert.Empty(spool.Advance(30_000, complete: false));
        }
        var capture = Assert.Single(DurableCaptureSpool.RecoverInterrupted(_directory));
        Assert.Equal(31_000, capture.DurationMs);
        Assert.Equal(2, capture.Chunks.Count);
        Assert.All(capture.Chunks, chunk => Assert.Equal(31_000, chunk.DurationMs));
        Assert.All(capture.Chunks.SelectMany(Payload), value => Assert.Equal(6, value));
        AssertCanonical(capture.Chunks);
        var again = Assert.Single(DurableCaptureSpool.RecoverInterrupted(_directory));
        Assert.Equal(capture, again with { Chunks = capture.Chunks });
        Assert.Equal(capture.Chunks, again.Chunks);
        Assert.Empty(Directory.EnumerateFiles(Path.Combine(_directory, _clientRef.ToString("D")), "*.pcm"));
    }

    [Fact]
    public void RecoveryHandlesCrashBetweenWavRenameAndJournalCommit()
    {
        using (var spool = new DurableCaptureSpool(_directory, _clientRef))
        {
            AddBoth(spool, 0, Pcm(31_000, 6));
            spool.Advance(31_000, complete: true);
        }
        var journalPath = Path.Combine(_directory, _clientRef.ToString("D"), "session.json");
        var journal = JsonNode.Parse(File.ReadAllText(journalPath))!;
        journal["Completed"] = false;
        journal["DurationMs"] = 30_000;
        journal["NextSequences"]!["mic"] = 0;
        journal["NextSequences"]!["system"] = 0;
        File.WriteAllText(journalPath, journal.ToJsonString());
        var recovered = Assert.Single(DurableCaptureSpool.RecoverInterrupted(_directory));
        Assert.Equal(31_000, recovered.DurationMs);
        Assert.Equal(2, recovered.Chunks.Count);
        Assert.All(recovered.Chunks, chunk => Assert.Equal(0, chunk.Sequence));
        AssertCanonical(recovered.Chunks);
    }

    [Fact]
    public void DamagedJournalPreservesAudioForAttention()
    {
        using (var spool = new DurableCaptureSpool(_directory, _clientRef))
            spool.AddAt("mic", 0, [1, 0]);
        var folder = Path.Combine(_directory, _clientRef.ToString("D"));
        File.WriteAllText(Path.Combine(folder, "session.json"), "{");
        Assert.Empty(DurableCaptureSpool.RecoverInterrupted(_directory));
        Assert.True(File.Exists(Path.Combine(folder, "mic-0000.pcm")));
    }

    [Fact]
    public void PaddingStopsAtTenSecondsRatherThanGrowingToTheWallClock()
    {
        using var spool = new DurableCaptureSpool(_directory, _clientRef);
        AddBoth(spool, 0, Pcm(1_000));
        var error = Assert.Throws<CaptureGapExceededException>(() => spool.Advance(3_600_000, complete: false));
        Assert.Equal(11_000, error.StopDurationMs);
        var chunks = spool.Advance(error.StopDurationMs, complete: true);
        Assert.All(chunks, chunk => Assert.Equal(11_000, chunk.DurationMs));
        AssertCanonical(chunks);
    }

    [Fact]
    public void ContinuousMicWithSilentSystemTrackRunsForSixtySeconds()
    {
        using var spool = new DurableCaptureSpool(_directory, _clientRef);
        var chunks = new List<SpoolChunk>();
        for (var second = 0; second < 60; second++)
        {
            spool.AddAt("mic", second * 16_000L, Pcm(1_000, 7));
            chunks.AddRange(spool.Advance((second + 1) * 1_000, complete: false));
        }
        chunks.AddRange(spool.Advance(60_000, complete: true));
        Assert.Equal(4, chunks.Count);
        Assert.All(chunks.Where(chunk => chunk.Track == "mic").SelectMany(Payload), value => Assert.Equal(7, value));
        Assert.All(chunks.Where(chunk => chunk.Track == "system").SelectMany(Payload), value => Assert.Equal(0, value));
        AssertCanonical(chunks);
    }

    [Fact]
    public void FirstSystemPacketAtFifteenSecondsIsAcceptedAtItsWallClockPosition()
    {
        using var spool = new DurableCaptureSpool(_directory, _clientRef);
        for (var second = 0; second < 16; second++)
        {
            spool.AddAt("mic", second * 16_000L, Pcm(1_000, 7));
            spool.Advance((second + 1) * 1_000, complete: false);
        }
        spool.AddAt("system", 15_000 * 16L, Pcm(1_000, 6));
        var chunks = spool.Advance(16_000, complete: true);
        var system = Payload(chunks.Single(chunk => chunk.Track == "system"));
        Assert.All(system.Take(15_000 * CanonicalWav.BytesPerMillisecond), value => Assert.Equal(0, value));
        Assert.All(system.Skip(15_000 * CanonicalWav.BytesPerMillisecond), value => Assert.Equal(6, value));
        AssertCanonical(chunks);
    }

    [Fact]
    public void BothTracksSilentThroughTwentySecondClockJumpEndsRecording()
    {
        using var spool = new DurableCaptureSpool(_directory, _clientRef);
        AddBoth(spool, 0, Pcm(1_000, 7));
        spool.Advance(1_000, complete: false);
        var error = Assert.Throws<CaptureGapExceededException>(() => spool.Advance(21_000, complete: false));
        Assert.Equal(11_000, error.StopDurationMs);
        var chunks = spool.Advance(error.StopDurationMs, complete: true);
        Assert.All(chunks, chunk => Assert.Equal(11_000, chunk.DurationMs));
        AssertCanonical(chunks);
    }

    [Fact]
    public void InvalidJournalDoesNotPreventAnotherCaptureFromRecovering()
    {
        var valid = Guid.NewGuid();
        foreach (var id in new[] { _clientRef, valid })
        {
            using var spool = new DurableCaptureSpool(_directory, id);
            AddBoth(spool, 0, Pcm(100));
        }
        var journalPath = Path.Combine(_directory, _clientRef.ToString("D"), "session.json");
        var journal = JsonNode.Parse(File.ReadAllText(journalPath))!;
        journal["DurationMs"] = -1;
        File.WriteAllText(journalPath, journal.ToJsonString());
        Assert.Equal(valid, Assert.Single(DurableCaptureSpool.RecoverInterrupted(_directory)).ClientRef);
        Assert.True(File.Exists(Path.Combine(_directory, _clientRef.ToString("D"), "mic-0000.pcm")));
    }

    [Fact]
    public void PacketAfterMoreThanTenSecondsOfMissingAudioIsRejected()
    {
        using var spool = new DurableCaptureSpool(_directory, _clientRef);
        AddBoth(spool, 0, Pcm(1_000));
        var error = Assert.Throws<CaptureGapExceededException>(() => spool.AddAt("mic", 11_001 * 16L, [1, 0]));
        Assert.Equal(11_000, error.StopDurationMs);
        Assert.All(spool.Advance(error.StopDurationMs, complete: true), chunk => Assert.Equal(11_000, chunk.DurationMs));
    }

    [Fact]
    public void RejectsOddSamplesAndNegativePositions()
    {
        using var spool = new DurableCaptureSpool(_directory, _clientRef);
        Assert.Throws<ArgumentException>(() => spool.AddAt("mic", 0, [1]));
        Assert.Throws<ArgumentOutOfRangeException>(() => spool.AddAt("mic", -1, [1, 0]));
    }

    private static byte[] Pcm(int durationMs, byte value = 0) => Enumerable.Repeat(value, durationMs * 32).ToArray();
    private static byte[] Payload(SpoolChunk chunk) => File.ReadAllBytes(chunk.FilePath)[CanonicalWav.HeaderSize..];
    private static void AddBoth(DurableCaptureSpool spool, long startSample, byte[] pcm)
    {
        spool.AddAt("mic", startSample, pcm);
        spool.AddAt("system", startSample, pcm);
    }
    private static void AssertCanonical(IEnumerable<SpoolChunk> chunks)
    {
        foreach (var chunk in chunks)
        {
            var bytes = File.ReadAllBytes(chunk.FilePath);
            Assert.InRange(chunk.DurationMs, 1, 180_000);
            Assert.Equal(44 + chunk.DurationMs * 32, bytes.Length);
            Assert.Equal(CanonicalWav.CreateHeader(chunk.DurationMs), bytes[..44]);
        }
    }
    public void Dispose()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
    }
}
