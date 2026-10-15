using System.Buffers.Binary;
using TahiRecorder.Core.Audio;

namespace TahiRecorder.Core.Tests;

public sealed class RecorderAudioLevelsTests
{
    private static byte[] Pcm(params short[] samples)
    {
        var result = new byte[samples.Length * 2];
        for (var index = 0; index < samples.Length; index++)
            BinaryPrimitives.WriteInt16LittleEndian(result.AsSpan(index * 2, 2), samples[index]);
        return result;
    }

    [Fact]
    public void NoPacketsWarnAtSixtySecondsOncePerRecording()
    {
        var levels = new RecorderAudioLevels();
        levels.Reset();
        Assert.False(levels.ShouldWarn(TimeSpan.Zero, true));
        Assert.False(levels.ShouldWarn(TimeSpan.FromSeconds(59.999), true));
        Assert.True(levels.ShouldWarn(TimeSpan.FromSeconds(60), true));
        Assert.False(levels.ShouldWarn(TimeSpan.FromMinutes(3), true));
    }

    [Fact]
    public void MicrophoneSignalDoesNotHideSilentSystemTrack()
    {
        var levels = new RecorderAudioLevels();
        levels.Reset();
        levels.ShouldWarn(TimeSpan.Zero, true);
        levels.ObservePcm("mic", Pcm(short.MinValue), TimeSpan.FromSeconds(59));

        Assert.True(levels.ShouldWarn(TimeSpan.FromSeconds(60), true));
        Assert.True(levels.Snapshot.MicrophoneAudioOk);
        Assert.False(levels.Snapshot.SystemAudioOk);
    }

    [Fact]
    public void SignalResetsSilenceTimerButHistoricalPeakDoesNotMaskLaterSilence()
    {
        var levels = new RecorderAudioLevels();
        levels.Reset();
        levels.ShouldWarn(TimeSpan.Zero, true);
        levels.ObservePcm("system", Pcm(1000), TimeSpan.FromSeconds(50));

        Assert.False(levels.ShouldWarn(TimeSpan.FromSeconds(60), true));
        Assert.False(levels.ShouldWarn(TimeSpan.FromSeconds(109.999), true));
        Assert.True(levels.ShouldWarn(TimeSpan.FromSeconds(110), true));
        Assert.True(levels.Snapshot.SystemAudioOk);
    }

    [Theory]
    [InlineData(32, true)]
    [InlineData(-32, true)]
    [InlineData(33, false)]
    [InlineData(-33, false)]
    public void SmallNoiseBelowThresholdDoesNotCountAsSignal(short sample, bool expectWarning)
    {
        var levels = new RecorderAudioLevels();
        levels.Reset();
        levels.ShouldWarn(TimeSpan.Zero, true);
        levels.ObservePcm("system", Pcm(sample), TimeSpan.FromSeconds(30));

        Assert.Equal(expectWarning, levels.ShouldWarn(TimeSpan.FromSeconds(60), true));
        Assert.Equal(!expectWarning, levels.Snapshot.SystemAudioOk);
    }

    [Fact]
    public void InactivityDoesNotCountAndNewActiveWindowStartsFresh()
    {
        var levels = new RecorderAudioLevels();
        levels.Reset();
        levels.ShouldWarn(TimeSpan.Zero, true);
        Assert.False(levels.ShouldWarn(TimeSpan.FromSeconds(40), false));
        Assert.False(levels.ShouldWarn(TimeSpan.FromMinutes(5), false));
        Assert.False(levels.ShouldWarn(TimeSpan.FromSeconds(400), true));
        Assert.False(levels.ShouldWarn(TimeSpan.FromSeconds(459.999), true));
        Assert.True(levels.ShouldWarn(TimeSpan.FromSeconds(460), true));
    }

    [Fact]
    public void PeaksStayIndependentAndAccumulateAcrossDeviceSwitchPackets()
    {
        var levels = new RecorderAudioLevels();
        levels.Reset();
        levels.ObservePcm("system", Pcm(short.MinValue), TimeSpan.Zero);
        levels.ObservePcm("system", Pcm(0, 100), TimeSpan.FromSeconds(2));
        levels.ObservePcm("mic", Pcm(16384), TimeSpan.FromSeconds(3));

        Assert.Equal(1f, levels.Snapshot.SystemPeak);
        Assert.Equal(0.5f, levels.Snapshot.MicrophonePeak);
        Assert.True(levels.Snapshot.HasRecording);
    }

    [Fact]
    public void ResetClearsPeaksAndWarningForNextRecording()
    {
        var levels = new RecorderAudioLevels();
        levels.Reset();
        levels.ShouldWarn(TimeSpan.Zero, true);
        Assert.True(levels.ShouldWarn(TimeSpan.FromSeconds(60), true));
        levels.ObservePcm("mic", Pcm(30000), TimeSpan.FromSeconds(60));

        levels.Reset();
        Assert.Equal(0f, levels.Snapshot.MicrophonePeak);
        Assert.Equal(0f, levels.Snapshot.SystemPeak);
        Assert.False(levels.ShouldWarn(TimeSpan.Zero, true));
        Assert.True(levels.ShouldWarn(TimeSpan.FromSeconds(60), true));
    }

    [Fact]
    public void SilenceWatchdogCannotWarnBeforeFirstRecording()
    {
        var levels = new RecorderAudioLevels();
        Assert.False(levels.Snapshot.HasRecording);
        levels.ShouldWarn(TimeSpan.Zero, true);
        Assert.False(levels.ShouldWarn(TimeSpan.FromSeconds(60), true));
    }

    [Fact]
    public void OddFinalByteIsIgnored()
    {
        var levels = new RecorderAudioLevels();
        levels.Reset();
        levels.ObservePcm("system", [0, 0, 255], TimeSpan.Zero);
        Assert.Equal(0f, levels.Snapshot.SystemPeak);
    }
}
