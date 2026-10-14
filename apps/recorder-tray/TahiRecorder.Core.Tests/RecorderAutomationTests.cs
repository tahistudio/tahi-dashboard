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
    public void ManualStopInAmbiguousGapKeepsContinuouslyOpenSessionSuppressed()
    {
        var first = Call("first", Noon, TimeSpan.FromMinutes(30));
        var second = Call("second", Noon.AddMinutes(31), TimeSpan.FromMinutes(30));
        var recorder = new RecorderAutomation();
        recorder.Tick(Noon.AddMinutes(30).AddSeconds(30), true, "zoom", [first, second]);
        recorder.ManualStop(Noon.AddMinutes(30).AddSeconds(40));
        Assert.Empty(recorder.Tick(Noon.AddMinutes(31), true, "zoom", [first, second]));
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
        Assert.Empty(recorder.Tick(Noon.AddMinutes(45).AddSeconds(1), false, "zoom", []));
        Assert.Empty(recorder.Tick(Noon.AddMinutes(45).AddSeconds(5), false, "zoom", []));
        var stop = Assert.Single(recorder.Tick(Noon.AddMinutes(45).AddSeconds(6), false, "zoom", []));
        Assert.Equal(RecordingStopReason.ScheduledOverrun, stop.StopReason);
    }

    [Fact]
    public void ManualRecordingIgnoresInactiveTicksBeforeAndAfterItsStartWithoutAMeeting()
    {
        var call = Call("calendar-only", Noon, TimeSpan.FromMinutes(30));
        var recorder = new RecorderAutomation();
        recorder.Tick(Noon.AddMinutes(-5), false, "unknown", [call]);
        recorder.Tick(Noon.AddMinutes(-1), false, "unknown", [call]);
        var original = Assert.Single(recorder.ManualStart(Noon, "unknown", "Voice notes")).Plan;
        Assert.Empty(recorder.Tick(Noon, false, "unknown", [call]));
        Assert.Empty(recorder.Tick(Noon.AddMinutes(1), false, "unknown", [call]));
        Assert.Empty(recorder.Tick(Noon.AddHours(11), false, "unknown", [call]));
        Assert.Equal(original, recorder.Current);
        Assert.Equal(RecordingStopReason.MaximumDuration,
            Assert.Single(recorder.Tick(Noon.AddHours(12), false, "unknown", [])).StopReason);
    }

    [Fact]
    public void ManualStartDoesNotInheritAMeetingSeenBeforeItStarted()
    {
        var recorder = new RecorderAutomation();
        recorder.Tick(Noon.AddSeconds(-1), true, "zoom", []);
        recorder.ManualStart(Noon);
        Assert.Empty(recorder.Tick(Noon.AddMinutes(1), false, "unknown", []));
        Assert.Empty(recorder.Tick(Noon.AddMinutes(2), false, "unknown", []));
        Assert.NotNull(recorder.Current);
    }

    [Fact]
    public void PausedAutomaticRecordingKeepsItsCaptureAtTheNextCalendarCall()
    {
        var first = Call("first", Noon, TimeSpan.FromMinutes(30));
        var second = Call("second", Noon.AddMinutes(30), TimeSpan.FromMinutes(30));
        var recorder = new RecorderAutomation();
        var original = Assert.Single(recorder.Tick(Noon, true, "zoom", [first])).Plan;
        recorder.PauseAutoStartForOneHour(Noon.AddMinutes(1));
        Assert.Empty(recorder.Tick(Noon.AddMinutes(30), true, "zoom", [first, second]));
        Assert.Equal(original, recorder.Current);
    }

    [Fact]
    public void ManualRecordingKeepsItsCaptureAtTheNextCalendarCall()
    {
        var call = Call("next", Noon.AddMinutes(5), TimeSpan.FromMinutes(30));
        var recorder = new RecorderAutomation();
        var original = Assert.Single(recorder.ManualStart(Noon)).Plan;
        Assert.Empty(recorder.Tick(Noon.AddMinutes(3), true, "zoom", [call]));
        Assert.Empty(recorder.Tick(Noon.AddMinutes(5), true, "zoom", [call]));
        Assert.Equal(original, recorder.Current);
    }

    [Fact]
    public void ManualRecordingStopsAtTheNextObservedMeetingSessionWithoutAnImmediateSplit()
    {
        var recorder = new RecorderAutomation();
        var original = Assert.Single(recorder.ManualStart(Noon)).Plan;
        Assert.Empty(recorder.Tick(Noon, true, "zoom", [], "first-session"));
        var stop = Assert.Single(recorder.Tick(Noon.AddMinutes(1), true, "zoom", [], "second-session"));
        Assert.Equal(RecordingActionKind.Stop, stop.Kind);
        Assert.Equal(RecordingStopReason.NextCall, stop.StopReason);
        Assert.Equal(original, stop.Plan);
        Assert.Null(recorder.Current);
        Assert.False(recorder.ExportState().SuppressCurrentSession);
        Assert.Empty(recorder.Tick(Noon.AddMinutes(1).AddSeconds(1), true, "zoom", [], "second-session"));
        var next = Assert.Single(recorder.Tick(Noon.AddMinutes(1).AddSeconds(20), true, "zoom", [], "second-session"));
        Assert.True(next.Plan.IsAutomatic);
        Assert.NotEqual(original.ClientRef, next.Plan.ClientRef);
    }

    [Fact]
    public void FirstMeetingSessionObservedDuringManualRecordingDoesNotStopIt()
    {
        var recorder = new RecorderAutomation();
        recorder.Tick(Noon.AddSeconds(-1), true, "zoom", [], "before-manual");
        var original = Assert.Single(recorder.ManualStart(Noon)).Plan;
        Assert.Empty(recorder.Tick(Noon.AddMinutes(1), true, "zoom", [], "first-during-manual"));
        Assert.Equal(original, recorder.Current);
        var stop = Assert.Single(recorder.Tick(Noon.AddMinutes(2), true, "zoom", [], "second-during-manual"));
        Assert.Equal(RecordingStopReason.NextCall, stop.StopReason);
    }

    [Fact]
    public void EarlyJoinWithinTenMinutesOfCalendarWindowWaitsAndStartsLinked()
    {
        var call = Call("next", Noon.AddMinutes(12), TimeSpan.FromMinutes(30));
        var recorder = new RecorderAutomation();
        Assert.Empty(recorder.Tick(Noon, true, "zoom", [call]));
        Assert.Empty(recorder.Tick(Noon.AddSeconds(20), true, "zoom", [call]));
        Assert.Empty(recorder.Tick(Noon.AddMinutes(9).AddSeconds(59), true, "zoom", [call]));
        var start = Assert.Single(recorder.Tick(Noon.AddMinutes(10), true, "zoom", [call]));
        Assert.Equal(call, start.Plan.Call);
        Assert.Equal(Noon.AddMinutes(10), start.Plan.StartedAt);
    }

    [Fact]
    public void CalendarWindowMoreThanTenMinutesAwayDoesNotDelayAnUnknownCall()
    {
        var call = Call("next", Noon.AddMinutes(13), TimeSpan.FromMinutes(30));
        var recorder = new RecorderAutomation();
        recorder.Tick(Noon, true, "zoom", [call]);
        Assert.Null(Assert.Single(recorder.Tick(Noon.AddSeconds(20), true, "zoom", [call])).Plan.Call);
    }

    [Theory]
    [InlineData(RecordingStopReason.SystemSuspend)]
    [InlineData(RecordingStopReason.SessionEnding)]
    [InlineData(RecordingStopReason.Shutdown)]
    public void LifecycleStopLeavesCalendarUnsuppressedAndResetsUnknownQualification(RecordingStopReason reason)
    {
        var recorder = new RecorderAutomation();
        var call = Call("first", Noon, TimeSpan.FromMinutes(30));
        recorder.Tick(Noon, true, "zoom", [call]);
        Assert.Equal(reason, Assert.Single(recorder.StopForLifecycle(reason)).StopReason);
        var snapshot = recorder.ExportState();
        Assert.False(snapshot.SuppressCurrentSession);
        Assert.Null(snapshot.ManuallyStoppedAt);
        Assert.Empty(snapshot.SuppressedCalls);
        Assert.Empty(recorder.Tick(Noon.AddMinutes(1), true, "zoom", []));
        Assert.Single(recorder.Tick(Noon.AddMinutes(1).AddSeconds(20), true, "zoom", []));
        recorder.StopForLifecycle(reason);
        Assert.Equal(call, Assert.Single(recorder.Tick(Noon.AddMinutes(2), true, "zoom", [call])).Plan.Call);
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
    public void BlockedRecordingStopsAndSuppressesSameMeetingWhileManualStartRemainsAvailable()
    {
        var call = Call("first", Noon, TimeSpan.FromMinutes(30));
        var recorder = new RecorderAutomation();
        var original = Assert.Single(recorder.Tick(Noon, true, "zoom", [call], "same-session")).Plan;
        var stop = Assert.Single(recorder.StopForBlockedRecording(Noon.AddMinutes(1)));
        Assert.Equal(RecordingStopReason.RecordingBlocked, stop.StopReason);
        Assert.Equal(original, stop.Plan);
        Assert.Null(recorder.Current);
        Assert.Empty(recorder.Tick(Noon.AddMinutes(2), true, "zoom", [call], "same-session"));
        var manual = Assert.Single(recorder.ManualStart(Noon.AddMinutes(2), "zoom"));
        Assert.False(manual.Plan.IsAutomatic);
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
    public void ManualStopKeepsLaterCalendarCallSuppressedOnContinuouslyOpenSession()
    {
        var first = Call("first", Noon, TimeSpan.FromMinutes(30));
        var second = Call("second", Noon.AddMinutes(30), TimeSpan.FromMinutes(30));
        var recorder = new RecorderAutomation();
        recorder.Tick(Noon, true, "zoom", [first]);
        recorder.ManualStop(Noon.AddMinutes(1));
        Assert.Empty(recorder.Tick(Noon.AddMinutes(28), true, "zoom", [first, second]));
        Assert.Empty(recorder.Tick(Noon.AddMinutes(31), true, "zoom", [first, second]));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(5)]
    [InlineData(15)]
    public void ManualStopSuppressesCalendarWindowOpeningWithinFifteenMinutesOnSameSession(int minutes)
    {
        var call = Call("next", Noon.AddMinutes(minutes + 2), TimeSpan.FromMinutes(30));
        var recorder = new RecorderAutomation();
        recorder.ManualStart(Noon.AddMinutes(-1));
        recorder.Tick(Noon.AddSeconds(-1), true, "zoom", [], "zoom-process");
        recorder.ManualStop(Noon);
        Assert.Empty(recorder.Tick(Noon.AddMinutes(minutes), true, "zoom", [call], "zoom-process"));
        Assert.Empty(recorder.Tick(Noon.AddMinutes(minutes + 3), true, "zoom", [call], "zoom-process"));
        // Restore retains the session identity even when the upcoming call was not known at stop.
        var restored = new RecorderAutomation(recorder.ExportState());
        Assert.Empty(restored.Tick(Noon.AddMinutes(minutes + 4), true, "zoom", [call], "zoom-process"));
    }

    [Fact]
    public void UpcomingManualStopSuppressionSurvivesPidChangeWithoutObservedInactivity()
    {
        var call = Call("next", Noon.AddMinutes(7), TimeSpan.FromMinutes(30));
        var recorder = new RecorderAutomation();
        recorder.ManualStart(Noon.AddMinutes(-1));
        recorder.Tick(Noon.AddSeconds(-1), true, "zoom", [call], "first-session");
        recorder.ManualStop(Noon);
        Assert.Empty(recorder.Tick(Noon.AddMinutes(7), true, "zoom", [call], "second-session"));
        Assert.Empty(recorder.Tick(Noon.AddMinutes(8), true, "zoom", [call], "second-session"));
        Assert.True(recorder.ExportState().SuppressCurrentSession);
    }

    [Fact]
    public void ManualStopKeepsContinuousSessionSuppressedBeyondFifteenMinutes()
    {
        var call = Call("next", Noon.AddMinutes(18), TimeSpan.FromMinutes(30));
        var recorder = new RecorderAutomation();
        recorder.ManualStart(Noon.AddMinutes(-1));
        recorder.Tick(Noon.AddSeconds(-1), true, "zoom", [call], "same-session");
        recorder.ManualStop(Noon);
        Assert.Empty(recorder.Tick(Noon.AddMinutes(18), true, "zoom", [call], "same-session"));
        Assert.Empty(recorder.Tick(Noon.AddMinutes(40), true, "zoom", [call], "same-session"));
    }

    [Fact]
    public void UpcomingManualStopSuppressionClearsAfterInactiveSuppressionResets()
    {
        var call = Call("next", Noon.AddMinutes(7), TimeSpan.FromMinutes(30));
        var recorder = new RecorderAutomation();
        recorder.ManualStart(Noon.AddMinutes(-1));
        recorder.Tick(Noon.AddSeconds(-1), true, "zoom", [call], "same-session");
        recorder.ManualStop(Noon);
        recorder.Tick(Noon.AddMinutes(1), false, "unknown", [call]);
        recorder.Tick(Noon.AddMinutes(2), false, "unknown", [call]);
        Assert.False(recorder.ExportState().SuppressCurrentSession);
        Assert.Null(recorder.ExportState().ManuallyStoppedSessionKey);
        var start = Assert.Single(recorder.Tick(Noon.AddMinutes(7), true, "zoom", [call], "same-session"));
        Assert.Equal(call, start.Plan.Call);
    }

    [Fact]
    public void StopAtTenTwentyFiveThenSessionClosesAndTenThirtyCallStartsOnSameKey()
    {
        var tenTwentyFive = new DateTimeOffset(2026, 10, 14, 10, 25, 0, TimeSpan.Zero);
        var call = Call("ten-thirty", tenTwentyFive.AddMinutes(5), TimeSpan.FromMinutes(30));
        var recorder = new RecorderAutomation();
        recorder.ManualStart(tenTwentyFive.AddMinutes(-10));
        recorder.Tick(tenTwentyFive.AddSeconds(-1), true, "zoom", [call], "zoom-process");
        recorder.ManualStop(tenTwentyFive);
        recorder.Tick(tenTwentyFive.AddSeconds(1), false, "unknown", [call], "zoom-process");
        // Qualification also resets if the next observation follows the inactive delay.
        var start = Assert.Single(recorder.Tick(tenTwentyFive.AddMinutes(5), true, "zoom", [call], "zoom-process"));
        Assert.Equal(call, start.Plan.Call);
        Assert.Null(recorder.ExportState().ManuallyStoppedSessionKey);
    }

    [Fact]
    public void PidFlipDoesNotRestartStoppedUnscheduledCall()
    {
        var recorder = new RecorderAutomation();
        recorder.ManualStart(Noon.AddMinutes(-1));
        recorder.Tick(Noon.AddSeconds(-1), true, "zoom", [], "first-session");
        recorder.ManualStop(Noon);
        Assert.Empty(recorder.Tick(Noon.AddSeconds(1), true, "zoom", [], "second-session"));
        Assert.True(recorder.ExportState().SuppressCurrentSession);
        Assert.Equal("first-session", recorder.ExportState().ManuallyStoppedSessionKey);
        Assert.Empty(recorder.Tick(Noon.AddSeconds(21), true, "zoom", [], "second-session"));
        Assert.Empty(recorder.Tick(Noon.AddMinutes(5), true, "zoom", [], "first-session"));
    }

    [Fact]
    public void ManualStopRetainsMeetingSessionIdentityThroughBriefInactivity()
    {
        var call = Call("next", Noon.AddMinutes(7), TimeSpan.FromMinutes(30));
        var recorder = new RecorderAutomation();
        recorder.ManualStart(Noon.AddMinutes(-1));
        recorder.Tick(Noon.AddSeconds(-2), true, "zoom", [], "same-session");
        recorder.Tick(Noon.AddSeconds(-1), false, "unknown", []);
        recorder.ManualStop(Noon);
        Assert.Equal("same-session", recorder.ExportState().ManuallyStoppedSessionKey);
        Assert.Empty(recorder.Tick(Noon.AddSeconds(1), true, "zoom", [], "same-session"));
        Assert.Equal("same-session", recorder.ExportState().ManuallyStoppedSessionKey);
        Assert.Empty(recorder.Tick(Noon.AddMinutes(7), true, "zoom", [call], "same-session"));
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

    [Theory]
    [InlineData(20)]
    [InlineData(45)]
    [InlineData(59)]
    public void BriefClosedSessionStillRecordsTenThirtyCalendarCallOnSameKey(int inactiveSeconds)
    {
        var stoppedAt = new DateTimeOffset(2026, 10, 14, 10, 25, 0, TimeSpan.Zero);
        var call = Call("ten-thirty", stoppedAt.AddMinutes(5), TimeSpan.FromMinutes(30));
        var recorder = new RecorderAutomation();
        var original = Assert.Single(recorder.ManualStart(stoppedAt.AddMinutes(-10))).Plan;
        recorder.Tick(stoppedAt.AddSeconds(-1), true, "zoom", [call], "zoom:101");
        recorder.ManualStop(stoppedAt);
        recorder.Tick(stoppedAt.AddMinutes(1), false, "unknown", [call]);
        Assert.Empty(recorder.Tick(stoppedAt.AddMinutes(1).AddSeconds(inactiveSeconds), true,
            "zoom", [call], "zoom:101"));
        var start = Assert.Single(recorder.Tick(stoppedAt.AddMinutes(5), true, "zoom", [call], "zoom:101"));
        Assert.Equal(RecordingActionKind.Start, start.Kind);
        Assert.Equal(call, start.Plan.Call);
        Assert.True(start.Plan.IsAutomatic);
        Assert.NotEqual(original.ClientRef, start.Plan.ClientRef);
        Assert.Null(recorder.ExportState().ManuallyStoppedSessionKey);
    }

    [Theory]
    [InlineData(4, false)]
    [InlineData(5, true)]
    public void LaterCalendarRestartRequiresFiveObservedInactiveSeconds(int inactiveSeconds, bool shouldStart)
    {
        var call = Call("next", Noon.AddMinutes(5), TimeSpan.FromMinutes(30));
        var recorder = new RecorderAutomation();
        recorder.ManualStart(Noon.AddMinutes(-1));
        recorder.Tick(Noon.AddSeconds(-1), true, "zoom", [], "zoom:101");
        recorder.ManualStop(Noon);
        recorder.Tick(Noon.AddMinutes(5).AddSeconds(-inactiveSeconds), false, "unknown", [call]);
        var actions = recorder.Tick(Noon.AddMinutes(5), true, "zoom", [call], "zoom:101");
        if (shouldStart) Assert.Equal(call, Assert.Single(actions).Plan.Call);
        else Assert.Empty(actions);
    }

    [Fact]
    public void ShortClosureDoesNotReleaseCalendarWindowAlreadyOpenAtManualStop()
    {
        var call = Call("already-open", Noon.AddMinutes(1), TimeSpan.FromMinutes(30));
        var recorder = new RecorderAutomation();
        recorder.ManualStart(Noon.AddMinutes(-1));
        recorder.Tick(Noon.AddSeconds(-1), true, "zoom", [], "zoom:101");
        recorder.ManualStop(Noon);
        recorder.Tick(Noon.AddSeconds(1), false, "unknown", [call]);
        Assert.Empty(recorder.Tick(Noon.AddSeconds(21), true, "zoom", [call], "zoom:101"));
        Assert.Empty(recorder.Tick(Noon.AddMinutes(1), true, "zoom", [call], "zoom:101"));
    }

    [Theory]
    [InlineData(20)]
    [InlineData(45)]
    [InlineData(59)]
    public void BriefClosedSessionCannotRestartAnUnscheduledCall(int inactiveSeconds)
    {
        var recorder = new RecorderAutomation();
        recorder.ManualStart(Noon.AddMinutes(-1));
        recorder.Tick(Noon.AddSeconds(-1), true, "zoom", [], "zoom:101");
        recorder.ManualStop(Noon);
        recorder.Tick(Noon.AddSeconds(1), false, "unknown", []);
        var reopened = Noon.AddSeconds(1 + inactiveSeconds);
        Assert.Empty(recorder.Tick(reopened, true, "zoom", [], "zoom:101"));
        Assert.Empty(recorder.Tick(reopened.AddSeconds(20), true, "zoom", [], "zoom:101"));
        Assert.True(recorder.ExportState().SuppressCurrentSession);
        Assert.Null(recorder.Current);
    }

    private static UpcomingCall Call(string id, DateTimeOffset start, TimeSpan duration) =>
        new(id, "scheduled", id, start.ToUnixTimeMilliseconds(), (start + duration).ToUnixTimeMilliseconds(), "zoom");
}
