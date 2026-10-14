using TahiRecorder.Core.Api;
using TahiRecorder.Core.Audio;
using TahiRecorder.Core.Automation;

namespace TahiRecorder.Core.Tests;

public sealed class CaptureFailurePolicyTests
{
    private static readonly DateTimeOffset Noon = new(2026, 10, 14, 12, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void AudioGapStopsCaptureAndAutoStartResumesOnlyAfterFortyFiveSeconds(bool calendar)
    {
        IReadOnlyList<UpcomingCall> calls = calendar
            ? [new UpcomingCall("call", "scheduled", "Call", Noon.ToUnixTimeMilliseconds(),
                Noon.AddHours(1).ToUnixTimeMilliseconds(), "zoom")]
            : [];
        var recorder = new RecorderAutomation();
        recorder.Tick(Noon, true, "zoom", calls, "zoom:101");
        if (!calendar) recorder.Tick(Noon.AddSeconds(20), true, "zoom", calls, "zoom:101");
        var original = Assert.IsType<RecordingPlan>(recorder.Current);
        var gapAt = original.StartedAt.AddSeconds(10);
        var failure = CaptureFailurePolicy.Evaluate(isCapturing: true, hasAudioGap: true, hasPersistenceFailure: false);
        var stop = Assert.Single(recorder.Tick(gapAt, true, "zoom", calls, "zoom:101", failure));
        Assert.Equal(RecordingActionKind.Stop, stop.Kind);
        Assert.Equal(RecordingStopReason.CaptureGap, stop.StopReason);
        Assert.Equal(original, stop.Plan);
        Assert.Null(recorder.Current);

        // The real host stops capture and clears its gap state before later ticks.
        var healthy = CaptureFailurePolicy.Evaluate(isCapturing: false, hasAudioGap: false, hasPersistenceFailure: false);
        for (var seconds = 1; seconds < 45; seconds++)
            Assert.Empty(recorder.Tick(gapAt.AddSeconds(seconds), true, "zoom", calls, "zoom:101", healthy));
        var start = Assert.Single(recorder.Tick(gapAt.AddSeconds(45), true, "zoom", calls, "zoom:101", healthy));
        Assert.Equal(RecordingActionKind.Start, start.Kind);
        Assert.True(start.Plan.IsAutomatic);
        Assert.NotEqual(original.ClientRef, start.Plan.ClientRef);
        Assert.Equal(calendar ? calls[0] : null, start.Plan.Call);
    }

    [Fact]
    public void ManualStartBypassesAudioGapHoldOff()
    {
        var recorder = new RecorderAutomation();
        recorder.ManualStart(Noon);
        recorder.Tick(Noon.AddSeconds(10), true, "zoom", [], "zoom:101",
            CaptureFailurePolicy.Evaluate(true, true, false));
        var manual = Assert.Single(recorder.ManualStart(Noon.AddSeconds(11), title: "Manual notes"));
        Assert.False(manual.Plan.IsAutomatic);
        Assert.Equal("Manual notes", manual.Plan.Title);
        Assert.Empty(recorder.Tick(Noon.AddSeconds(12), true, "zoom", [], "zoom:101",
            CaptureFailurePolicy.Evaluate(true, false, false)));
        Assert.Equal(manual.Plan, recorder.Current);
    }

    [Fact]
    public void AudioGapHoldOffSurvivesAutomationStateRestore()
    {
        var call = new UpcomingCall("call", "scheduled", "Call", Noon.ToUnixTimeMilliseconds(),
            Noon.AddHours(1).ToUnixTimeMilliseconds(), "zoom");
        var recorder = new RecorderAutomation();
        recorder.Tick(Noon, true, "zoom", [call]);
        recorder.Tick(Noon.AddSeconds(10), true, "zoom", [call], captureFailure:
            CaptureFailurePolicy.Evaluate(true, true, false));
        var restored = new RecorderAutomation(recorder.ExportState());
        Assert.Empty(restored.Tick(Noon.AddSeconds(54), true, "zoom", [call]));
        Assert.Equal(call, Assert.Single(restored.Tick(Noon.AddSeconds(55), true, "zoom", [call])).Plan.Call);
    }

    [Fact]
    public void StaleGapOnInactiveCaptureDoesNotStopOrHoldOffNextCall()
    {
        var recorder = new RecorderAutomation();
        var stale = CaptureFailurePolicy.Evaluate(isCapturing: false, hasAudioGap: true, hasPersistenceFailure: false);
        Assert.Empty(recorder.Tick(Noon, true, "zoom", [], "zoom:101", stale));
        var start = Assert.Single(recorder.Tick(Noon.AddSeconds(20), true, "zoom", [], "zoom:101", stale));
        Assert.Equal(RecordingActionKind.Start, start.Kind);
        Assert.Empty(recorder.Tick(Noon.AddSeconds(21), true, "zoom", [], "zoom:101", stale));
        Assert.Equal(start.Plan, recorder.Current);
    }

    [Fact]
    public void PersistenceFailureTakesPriorityOverGapAndRemainsFatalAfterCaptureStops()
    {
        Assert.Equal(CaptureFailureAction.DisableRecorder, CaptureFailurePolicy.Evaluate(true, true, true));
        Assert.Equal(CaptureFailureAction.DisableRecorder, CaptureFailurePolicy.Evaluate(false, false, true));
    }
}
