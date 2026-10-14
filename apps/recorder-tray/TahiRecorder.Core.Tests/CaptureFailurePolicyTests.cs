using TahiRecorder.Core.Audio;

namespace TahiRecorder.Core.Tests;

public sealed class CaptureFailurePolicyTests
{
    [Fact]
    public void AudioGapKeepsNewRecordingEnabled() =>
        Assert.False(CaptureFailurePolicy.RequiresRecorderDisable(hasPersistenceFailure: false));

    [Fact]
    public void PersistenceFailureDisablesNewRecording() =>
        Assert.True(CaptureFailurePolicy.RequiresRecorderDisable(hasPersistenceFailure: true));
}
