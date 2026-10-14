using System.Buffers.Binary;
using System.Text;
using TahiRecorder.Core.Audio;

namespace TahiRecorder.Core.Tests;

public sealed class CanonicalWavTests
{
    [Fact]
    public void ThirtySecondsHasExactCanonicalByteLayout()
    {
        var wav = CanonicalWav.Write([], 30_000);
        Assert.Equal(960_044, wav.Length);
        Assert.Equal("RIFF", Encoding.ASCII.GetString(wav, 0, 4));
        Assert.Equal(960_036u, BinaryPrimitives.ReadUInt32LittleEndian(wav.AsSpan(4)));
        Assert.Equal("WAVEfmt ", Encoding.ASCII.GetString(wav, 8, 8));
        Assert.Equal(16u, BinaryPrimitives.ReadUInt32LittleEndian(wav.AsSpan(16)));
        Assert.Equal(1, BinaryPrimitives.ReadUInt16LittleEndian(wav.AsSpan(20)));
        Assert.Equal(1, BinaryPrimitives.ReadUInt16LittleEndian(wav.AsSpan(22)));
        Assert.Equal(16_000u, BinaryPrimitives.ReadUInt32LittleEndian(wav.AsSpan(24)));
        Assert.Equal(32_000u, BinaryPrimitives.ReadUInt32LittleEndian(wav.AsSpan(28)));
        Assert.Equal(2, BinaryPrimitives.ReadUInt16LittleEndian(wav.AsSpan(32)));
        Assert.Equal(16, BinaryPrimitives.ReadUInt16LittleEndian(wav.AsSpan(34)));
        Assert.Equal("data", Encoding.ASCII.GetString(wav, 36, 4));
        Assert.Equal(960_000u, BinaryPrimitives.ReadUInt32LittleEndian(wav.AsSpan(40)));
        Assert.Equal("audio/wav", CanonicalWav.MimeType);
    }

    [Fact]
    public void ShortPcmIsSilencePaddedAndLongPcmIsTruncated()
    {
        var padded = CanonicalWav.Write(new byte[] { 1, 2, 3, 4 }, 1);
        Assert.Equal(76, padded.Length);
        Assert.Equal(new byte[] { 1, 2, 3, 4 }, padded.AsSpan(44, 4).ToArray());
        Assert.All(padded.Skip(48), value => Assert.Equal(0, value));
        var source = Enumerable.Repeat((byte)7, 40).ToArray();
        var truncated = CanonicalWav.Write(source, 1);
        Assert.Equal(76, truncated.Length);
        Assert.All(truncated.Skip(44), value => Assert.Equal(7, value));
    }

    [Fact]
    public void StreamingWriterPadsAndDoesNotConsumePastDeclaredDuration()
    {
        using var shortPcm = new MemoryStream(new byte[] { 1, 2 });
        using var padded = new MemoryStream();
        CanonicalWav.Write(padded, shortPcm, 2);
        Assert.Equal(CanonicalWav.Write(new byte[] { 1, 2 }, 2), padded.ToArray());
        using var longPcm = new MemoryStream(new byte[100]);
        using var truncated = new MemoryStream();
        CanonicalWav.Write(truncated, longPcm, 1);
        Assert.Equal(32, longPcm.Position);
        Assert.Equal(76, truncated.Length);
    }

    [Fact]
    public void NegativeDurationIsRejectedAndZeroDurationIsHeaderOnly()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => CanonicalWav.CreateHeader(-1));
        Assert.Equal(44, CanonicalWav.Write([], 0).Length);
    }

    [Fact]
    public void TimelinePadsSilentGapsAgainstSharedSampleClock()
    {
        var timeline = new PcmTimelineBuffer();
        timeline.AddAt(2, new byte[] { 1, 0, 2, 0 });
        var pcm = timeline.TakeThrough(6);
        Assert.Equal(new byte[] { 0, 0, 0, 0, 1, 0, 2, 0, 0, 0, 0, 0 }, pcm);
        Assert.Equal(6, timeline.ConsumedSamples);
    }

    [Fact]
    public void TimelineRetainsPacketRemainderAcrossChunksAndIgnoresLatePackets()
    {
        var timeline = new PcmTimelineBuffer();
        timeline.AddAt(0, new byte[] { 1, 0, 2, 0, 3, 0, 4, 0 });
        Assert.Equal(new byte[] { 1, 0, 2, 0 }, timeline.TakeThrough(2));
        timeline.AddAt(0, new byte[] { 9, 0, 9, 0 });
        Assert.Equal(new byte[] { 3, 0, 4, 0 }, timeline.TakeThrough(4));
    }

    [Fact]
    public void TimelineRejectsIncompleteSamplesAndBackwardConsumption()
    {
        var timeline = new PcmTimelineBuffer();
        Assert.Throws<ArgumentException>(() => timeline.AddAt(0, new byte[] { 1 }));
        timeline.TakeThrough(1);
        Assert.Throws<ArgumentOutOfRangeException>(() => timeline.TakeThrough(0));
    }
}
