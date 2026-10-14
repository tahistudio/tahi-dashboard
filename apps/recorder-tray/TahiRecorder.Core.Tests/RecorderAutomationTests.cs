using TahiRecorder.Core.Api;
using TahiRecorder.Core.Automation;

namespace TahiRecorder.Core.Tests;

public sealed class RecorderAutomationTests
{
    [Fact]
    public void ManuallyStoppedAmbiguousCalendarCallDoesNotRestartAfterSessionReopens()
    {
        var calls = new[] { Call("one", Noon, TimeSpan.FromHours(1)), Call("two", Noon, TimeSpan.FromHours(1)) };
        var recorder = new RecorderAutomation();
        Assert.Null(Assert.Single(recorder.Tick(Noon, true, "zoom", calls)).Plan.Call);
        recorder.ManualStop(Noon.AddMinutes(1));
        var resumed = new RecorderAutomation(recorder.ExportState());
        resumed.Tick(Noon.AddMinutes(2), false, "zoom", calls);
        resumed.Tick(Noon.AddMinutes(3), false, "zoom", calls);
        Assert.Empty(resumed.Tick(Noon.AddMinutes(4), true, "zoom", calls));
        Assert.Equal(2, resumed.ExportState().SuppressedCalls.Count);
    }

    [Fact]
    public void AmbiguousEarlyStartDoesNotSplitAgainAtTheSameCandidatesStart()
    {
        var calls = new[] { Call("one", Noon, TimeSpan.FromHours(1)), Call("two", Noon, TimeSpan.FromHours(1)) };
        var recorder = new RecorderAutomation();
        recorder.Tick(Noon.AddMinutes(-2), true, "zoom", calls);
        Assert.Empty(recorder.Tick(Noon, true, "zoom", calls));
    }

    [Fact]
    public void AmbiguousGapStillSplitsAtALaterCandidateCallStart()
    {
        var first = Call("first", Noon, TimeSpan.FromMinutes(30));
        var second = Call("second", Noon.AddMinutes(31), TimeSpan.FromMinutes(30));
        var recorder = new RecorderAutomation();
        Assert.Null(Assert.Single(recorder.Tick(Noon.AddMinutes(30).AddSeconds(30), true, "zoom", [first, second])).Plan.Call);
        var actions = recorder.Tick(Noon.AddMinutes(31), true, "zoom", [first, second]);
        Assert.Equal(2, actions.Count);
        Assert.Equal(second, actions[1].Plan.Call);
    }

    [Fact]
    public void ManualStopInAmbiguousGapDoesNotSuppressALaterCallStart()
    {
        var first = Call("first", Noon, TimeSpan.FromMinutes(30));
        var second = Call("second", Noon.AddMinutes(31), TimeSpan.FromMinutes(30));
        var recorder = new RecorderAutomation();
        recorder.Tick(Noon.AddMinutes(30).AddSeconds(30), true, "zoom", [first, second]);
        recorder.ManualStop(Noon.AddMinutes(30).AddSeconds(40));
        Assert.Equal(second, Assert.Single(recorder.Tick(Noon.AddMinutes(31), true, "zoom", [first, second])).Plan.Call);
    }

    private static readonly DateTimeOffset Noon = new(2026, 10, 14, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void SwitchingMeetingProcessRestartsTheTwentySecondQualification()
    {
        var recorder = new RecorderAutomation();
        recorder.Tick(Noon, true, "meet", [], "browser1");
        Assert.Empty(recorder.Tick(Noon.AddSeconds(19), true, "meet", [], "browser2"));
        Assert.Empty(recorder.Tick(Noon.AddSeconds(20), true, "meet", [], "browser2"));
        Assert.Single(recorder.Tick(Noon.AddSeconds(39), true, "meet", [], "browser2"));
    }

    [Fact]
    public void CalendarStartsImmediatelyInItsWindowWhenCaptureIsActive()
    {
        var call = Call("first", Noon, TimeSpan.FromMinutes(30));
        var recorder = new RecorderAutomation();
        Assert.Empty(recorder.Tick(Noon.AddMinutes(-2), false, "zoom", [call]));
        var action = Assert.Single(recorder.Tick(Noon.AddMinutes(-2), true, "zoom", [call]));
        Assert.Equal(RecordingActionKind.Start, action.Kind);
        Assert.Equal(call, action.Plan.Call);
        Assert.True(action.Plan.IsAutomatic);
    }

    [Fact]
    public void UnknownCallNeedsTwentyContinuousSecondsAndStartsUnlinked()
    {
        var recorder = new RecorderAutomation();
        Assert.Empty(recorder.Tick(Noon, true, "zoom", []));
        Assert.Empty(recorder.Tick(Noon.AddSeconds(19), true, "zoom", []));
        var action = Assert.Single(recorder.Tick(Noon.AddSeconds(20), true, "zoom", []));
        Assert.Null(action.Plan.Call);
        Assert.Equal("Zoom call", action.Plan.Title);
    }

    [Fact]
    public void ClosedCaptureResetsTheTwentySecondUnknownCallTimer()
    {
        var recorder = new RecorderAutomation();
        recorder.Tick(Noon, true, "teams", []);
        recorder.Tick(Noon.AddSeconds(19), false, "teams", []);
        Assert.Empty(recorder.Tick(Noon.AddSeconds(20), true, "teams", []));
        Assert.Empty(recorder.Tick(Noon.AddSeconds(39), true, "teams", []));
        Assert.Single(recorder.Tick(Noon.AddSeconds(40), true, "teams", []));
    }

    [Fact]
    public void PlaybackWithoutCaptureNeverStarts()
    {
        var recorder = new RecorderAutomation();
        Assert.Empty(recorder.Tick(Noon, false, "meet", [Call("first", Noon, TimeSpan.FromMinutes(30))]));
        Assert.Empty(recorder.Tick(Noon.AddHours(1), false, "meet", []));
        Assert.Null(recorder.Current);
    }

    [Fact]
    public void BackToBackStopsThenStartsAtNextCallsStart()
    {
        var first = Call("first", Noon, TimeSpan.FromMinutes(30));
        var second = Call("second", Noon.AddMinutes(30), TimeSpan.FromMinutes(30));
        var recorder = new RecorderAutomation();
        var original = Assert.Single(recorder.Tick(Noon, true, "meet", [first])).Plan;
        Assert.Empty(recorder.Tick(Noon.AddMinutes(28), true, "meet", [first, second]));
        var actions = recorder.Tick(Noon.AddMinutes(30), true, "meet", [first, second]);
        Assert.Equal(2, actions.Count);
        Assert.Equal(RecordingActionKind.Stop, actions[0].Kind);
        Assert.Equal(RecordingStopReason.NextCall, actions[0].StopReason);
        Assert.Equal(original.ClientRef, actions[0].Plan.ClientRef);
        Assert.Equal(RecordingActionKind.Start, actions[1].Kind);
        Assert.Equal(second, actions[1].Plan.Call);
        Assert.NotEqual(original.ClientRef, actions[1].Plan.ClientRef);
    }

    [Fact]
    public void BackToBackStartWithAmbiguousNextCallsIsUnlinked()
    {
        var first = Call("first", Noon, TimeSpan.FromMinutes(30));
        var second = Call("second", Noon.AddMinutes(30), TimeSpan.FromMinutes(30));
        var third = Call("third", Noon.AddMinutes(30), TimeSpan.FromMinutes(30));
        var recorder = new RecorderAutomation();
        recorder.Tick(Noon, true, "zoom", [first]);
        var actions = recorder.Tick(Noon.AddMinutes(30), true, "zoom", [first, second, third]);
        Assert.Equal(2, actions.Count);
        Assert.Null(actions[1].Plan.Call);
    }

    [Fact]
    public void LateJoinUsesCurrentCallEvenAfterItsOriginalStart()
    {
        var call = Call("first", Noon, TimeSpan.FromMinutes(60));
        var action = Assert.Single(new RecorderAutomation().Tick(Noon.AddMinutes(20), true, "zoom", [call]));
        Assert.Equal(call, action.Plan.Call);
    }

    [Fact]
    public void OverrunContinuesWhileMeetingCaptureIsActive()
    {
        var call = Call("first", Noon, TimeSpan.FromMinutes(30));
        var recorder = new RecorderAutomation();
        recorder.Tick(Noon, true, "zoom", [call]);
        Assert.Empty(recorder.Tick(Noon.AddMinutes(45), true, "zoom", []));
        Assert.NotNull(recorder.Current);
        var stop = Assert.Single(recorder.Tick(Noon.AddMinutes(45).AddSeconds(1), false, "zoom", []));
        Assert.Equal(RecordingStopReason.ScheduledOverrun, stop.StopReason);
    }

    [Fact]
    public void InactiveCaptureWaitsSixtySecondsIncludingMutedSilence()
    {
        var recorder = new RecorderAutomation();
        recorder.ManualStart(Noon, "teams");
        Assert.Empty(recorder.Tick(Noon.AddMinutes(1), true, "teams", []));
        Assert.Empty(recorder.Tick(Noon.AddMinutes(2), false, "teams", []));
        Assert.Empty(recorder.Tick(Noon.AddMinutes(2).AddSeconds(59), false, "teams", []));
        var stop = Assert.Single(recorder.Tick(Noon.AddMinutes(3), false, "teams", []));
        Assert.Equal(RecordingStopReason.MeetingInactive, stop.StopReason);
    }

    [Fact]
    public void ReactivationBeforeSixtySecondsCancelsInactiveStop()
    {
        var recorder = new RecorderAutomation();
        recorder.ManualStart(Noon, "meet");
        recorder.Tick(Noon.AddMinutes(1), false, "meet", []);
        Assert.Empty(recorder.Tick(Noon.AddMinutes(1).AddSeconds(59), true, "meet", []));
        Assert.Empty(recorder.Tick(Noon.AddMinutes(2), true, "meet", []));
        Assert.NotNull(recorder.Current);
    }

    [Fact]
    public void TwelveHoursStopsAndDoesNotImmediatelyStartAnotherUnlinkedRecording()
    {
        var recorder = new RecorderAutomation();
        recorder.ManualStart(Noon, "zoom");
        recorder.Tick(Noon, true, "zoom", []);
        var stop = Assert.Single(recorder.Tick(Noon.AddHours(12), true, "zoom", []));
        Assert.Equal(RecordingStopReason.MaximumDuration, stop.StopReason);
        Assert.Empty(recorder.Tick(Noon.AddHours(12).AddMinutes(1), true, "zoom", []));
    }

    [Fact]
    public void ManualStopNeverRestartsTheSameCalendarCallEvenAfterCaptureReopens()
    {
        var call = Call("first", Noon, TimeSpan.FromMinutes(30));
        var recorder = new RecorderAutomation();
        recorder.Tick(Noon, true, "zoom", [call]);
        Assert.Equal(RecordingStopReason.Manual, Assert.Single(recorder.ManualStop(Noon.AddMinutes(1))).StopReason);
        Assert.Empty(recorder.Tick(Noon.AddMinutes(2), true, "zoom", [call]));
        recorder.Tick(Noon.AddMinutes(3), false, "zoom", [call]);
        recorder.Tick(Noon.AddMinutes(4), false, "zoom", [call]);
        Assert.Empty(recorder.Tick(Noon.AddMinutes(5), true, "zoom", [call]));
    }

    [Fact]
    public void ManualStopSuppressionSurvivesStateRestore()
    {
        var call = Call("first", Noon, TimeSpan.FromMinutes(30));
        var recorder = new RecorderAutomation();
        recorder.Tick(Noon, true, "zoom", [call]);
        recorder.ManualStop(Noon.AddMinutes(1));
        var restored = new RecorderAutomation(recorder.ExportState());
        Assert.Empty(restored.Tick(Noon.AddMinutes(2), true, "zoom", [call]));
        Assert.Empty(restored.Tick(Noon.AddHours(1), true, "zoom", []));
    }

    [Fact]
    public void ManualStopAllowsAGenuinelyLaterCalendarCallOnSameCaptureSession()
    {
        var first = Call("first", Noon, TimeSpan.FromMinutes(30));
        var second = Call("second", Noon.AddMinutes(30), TimeSpan.FromMinutes(30));
        var recorder = new RecorderAutomation();
        recorder.Tick(Noon, true, "zoom", [first]);
        recorder.ManualStop(Noon.AddMinutes(1));
        Assert.Empty(recorder.Tick(Noon.AddMinutes(28), true, "zoom", [first, second]));
        var next = Assert.Single(recorder.Tick(Noon.AddMinutes(31), true, "zoom", [first, second]));
        Assert.Equal(second, next.Plan.Call);
    }

    [Fact]
    public void UnknownManualStopPersistsUntilCaptureClosedForSixtySeconds()
    {
        var recorder = new RecorderAutomation();
        recorder.Tick(Noon, true, "teams", []);
        recorder.Tick(Noon.AddSeconds(20), true, "teams", []);
        recorder.ManualStop(Noon.AddMinutes(1));
        Assert.Empty(recorder.Tick(Noon.AddMinutes(2), true, "teams", []));
        recorder.Tick(Noon.AddMinutes(3), false, "teams", []);
        recorder.Tick(Noon.AddMinutes(4), false, "teams", []);
        Assert.Empty(recorder.Tick(Noon.AddMinutes(5), true, "teams", []));
        Assert.Single(recorder.Tick(Noon.AddMinutes(5).AddSeconds(20), true, "teams", []));
    }

    [Fact]
    public void PauseLastsOneHourAndSurvivesStateRestore()
    {
        var call = Call("first", Noon, TimeSpan.FromHours(2));
        var recorder = new RecorderAutomation();
        recorder.PauseAutoStartForOneHour(Noon);
        var restored = new RecorderAutomation(recorder.ExportState());
        Assert.Empty(restored.Tick(Noon.AddMinutes(59), true, "meet", [call]));
        Assert.Single(restored.Tick(Noon.AddHours(1), true, "meet", [call]));
    }

    [Fact]
    public void PauseDoesNotStopCurrentRecordingAndManualStartStillWorks()
    {
        var recorder = new RecorderAutomation();
        recorder.PauseAutoStartForOneHour(Noon);
        Assert.Single(recorder.ManualStart(Noon, "zoom", "Manual notes"));
        Assert.Empty(recorder.Tick(Noon.AddMinutes(1), true, "zoom", []));
        Assert.Equal("Manual notes", recorder.Current?.Title);
    }

    [Fact]
    public void NotThisCallChangesOnlyAnUnsentCreate()
    {
        var recorder = new RecorderAutomation();
        var call = Call("first", Noon, TimeSpan.FromMinutes(30));
        recorder.Tick(Noon, true, "meet", [call]);
        Assert.True(recorder.NotThisCall());
        Assert.Null(recorder.Current?.Call);
        recorder.ManualStop(Noon);
        recorder = new RecorderAutomation();
        recorder.Tick(Noon, true, "meet", [call]);
        recorder.MarkCreateSent();
        Assert.False(recorder.NotThisCall());
        Assert.Equal(call, recorder.Current?.Call);
    }

    [Fact]
    public void NotThisCallDoesNotSplitBackIntoSameCalendarCallAtItsStart()
    {
        var recorder = new RecorderAutomation();
        var call = Call("first", Noon, TimeSpan.FromMinutes(30));
        recorder.Tick(Noon.AddMinutes(-2), true, "meet", [call]);
        Assert.True(recorder.NotThisCall());
        Assert.Empty(recorder.Tick(Noon, true, "meet", [call]));
        Assert.Null(recorder.Current?.Call);
    }

    [Fact]
    public void ManuallyStoppedUnlinkedCalendarCallRemainsSuppressedAfterCaptureReopens()
    {
        var recorder = new RecorderAutomation();
        var call = Call("first", Noon, TimeSpan.FromMinutes(30));
        recorder.Tick(Noon, true, "meet", [call]);
        recorder.NotThisCall();
        recorder.ManualStop(Noon.AddMinutes(1));
        recorder.Tick(Noon.AddMinutes(2), false, "meet", [call]);
        recorder.Tick(Noon.AddMinutes(3), false, "meet", [call]);
        Assert.Empty(recorder.Tick(Noon.AddMinutes(4), true, "meet", [call]));
    }

    [Fact]
    public void MatchingPrefersSoleCallContainingNowAndNeverGuessesAnOverlap()
    {
        var first = Call("first", Noon, TimeSpan.FromMinutes(30));
        var second = Call("second", Noon.AddMinutes(31), TimeSpan.FromMinutes(30));
        Assert.Equal(first, CallMatcher.Match(Noon.AddMinutes(29).ToUnixTimeMilliseconds(), [first, second]).Call);
        Assert.Null(CallMatcher.Match(Noon.AddMinutes(30).AddSeconds(30).ToUnixTimeMilliseconds(), [first, second]).Call);
        var overlapping = Call("overlap", Noon.AddMinutes(10), TimeSpan.FromMinutes(30));
        Assert.Null(CallMatcher.Match(Noon.AddMinutes(20).ToUnixTimeMilliseconds(), [first, overlapping]).Call);
    }

    [Fact]
    public void MultipleAmbiguousOpenWindowsStartUnlinked()
    {
        var first = Call("first", Noon, TimeSpan.FromMinutes(30));
        var second = Call("second", Noon, TimeSpan.FromMinutes(30));
        var start = Assert.Single(new RecorderAutomation().Tick(Noon, true, "teams", [first, second]));
        Assert.Null(start.Plan.Call);
    }

    private static UpcomingCall Call(string id, DateTimeOffset start, TimeSpan duration) =>
        new(id, "scheduled", id, start.ToUnixTimeMilliseconds(), (start + duration).ToUnixTimeMilliseconds(), "zoom");
}
