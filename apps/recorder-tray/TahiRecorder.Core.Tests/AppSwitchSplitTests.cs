using TahiRecorder.Core.Api;
using TahiRecorder.Core.Automation;

namespace TahiRecorder.Core.Tests;

/// <summary>An automatic recording follows the call across apps, not only across calendar boundaries.</summary>
public sealed class AppSwitchSplitTests
{
    private static readonly DateTimeOffset Noon = new(2026, 10, 19, 12, 0, 0, TimeSpan.Zero);
    private static readonly IReadOnlyList<UpcomingCall> None = [];

    private static RecordingAction Started(RecorderAutomation automation, ref DateTimeOffset now, string app = "vivaldi",
        string platform = "meet", int pid = 100)
    {
        automation.Tick(now, true, platform, None, platform + ":" + pid, captureAppKey: app);
        now = now.AddSeconds(20);
        return Assert.Single(automation.Tick(now, true, platform, None, platform + ":" + pid, captureAppKey: app));
    }

    [Fact]
    public void MeetInVivaldiThenTeamsWithinAMinuteGivesTwoRecordings()
    {
        var automation = new RecorderAutomation();
        var now = Noon;
        var first = Started(automation, ref now);

        now = now.AddSeconds(30);
        Assert.Empty(automation.Tick(now, true, "teams", None, "teams:200", captureAppKey: "teams"));
        now = now.AddSeconds(9);
        Assert.Empty(automation.Tick(now, true, "teams", None, "teams:200", captureAppKey: "teams"));
        now = now.AddSeconds(1);
        var actions = automation.Tick(now, true, "teams", None, "teams:200", captureAppKey: "teams");

        Assert.Equal(2, actions.Count);
        Assert.Equal(RecordingActionKind.Stop, actions[0].Kind);
        Assert.Equal(RecordingStopReason.NextCall, actions[0].StopReason);
        Assert.Same(first.Plan, actions[0].Plan);
        Assert.Equal(RecordingActionKind.Start, actions[1].Kind);
        Assert.True(actions[1].Plan.IsAutomatic);
        Assert.Equal("Teams call", actions[1].Plan.Title);
        Assert.NotEqual(first.Plan.ClientRef, actions[1].Plan.ClientRef);
        Assert.Same(actions[1].Plan, automation.Current);
    }

    [Fact]
    public void TeamsToVivaldiToTeamsFlickerUnderTheWindowGivesOneRecording()
    {
        var automation = new RecorderAutomation();
        var now = Noon;
        var first = Started(automation, ref now, "teams", "teams", 200);

        for (var cycle = 0; cycle < 3; cycle++)
        {
            now = now.AddSeconds(5);
            Assert.Empty(automation.Tick(now, true, "meet", None, "meet:100", captureAppKey: "vivaldi"));
            now = now.AddSeconds(5);
            Assert.Empty(automation.Tick(now, true, "meet", None, "meet:100", captureAppKey: "vivaldi"));
            now = now.AddSeconds(4);
            Assert.Empty(automation.Tick(now, true, "teams", None, "teams:200", captureAppKey: "teams"));
        }

        Assert.Same(first.Plan, automation.Current);
    }

    [Fact]
    public void ReturningToTheOriginalAppRestartsTheConfirmationWindowFromScratch()
    {
        var automation = new RecorderAutomation();
        var now = Noon;
        var first = Started(automation, ref now, "teams", "teams", 200);

        now = now.AddSeconds(1);
        automation.Tick(now, true, "meet", None, "meet:100", captureAppKey: "vivaldi");
        now = now.AddSeconds(8);
        automation.Tick(now, true, "teams", None, "teams:200", captureAppKey: "teams");
        now = now.AddSeconds(1);
        Assert.Empty(automation.Tick(now, true, "meet", None, "meet:100", captureAppKey: "vivaldi"));
        now = now.AddSeconds(9);
        Assert.Empty(automation.Tick(now, true, "meet", None, "meet:100", captureAppKey: "vivaldi"));
        Assert.Same(first.Plan, automation.Current);
        now = now.AddSeconds(1);
        Assert.Equal(2, automation.Tick(now, true, "meet", None, "meet:100", captureAppKey: "vivaldi").Count);
    }

    [Fact]
    public void ProcessIdChangeOfTheSameAppNeverSplits()
    {
        var automation = new RecorderAutomation();
        var now = Noon;
        var first = Started(automation, ref now, "vivaldi", "meet", 100);

        now = now.AddSeconds(5);
        Assert.Empty(automation.Tick(now, true, "meet", None, "meet:9999", captureAppKey: "vivaldi"));
        now = now.AddMinutes(5);
        Assert.Empty(automation.Tick(now, true, "meet", None, "meet:9999", captureAppKey: "vivaldi"));
        Assert.Same(first.Plan, automation.Current);
    }

    [Fact]
    public void BriefInactivityOfTheSameAppThenReturnDoesNotSplit()
    {
        var automation = new RecorderAutomation();
        var now = Noon;
        var first = Started(automation, ref now);

        now = now.AddSeconds(3);
        Assert.Empty(automation.Tick(now, false, "unknown", None, "unknown:", captureAppKey: null));
        now = now.AddSeconds(2);
        Assert.Empty(automation.Tick(now, true, "meet", None, "meet:100", captureAppKey: "vivaldi"));
        now = now.AddMinutes(1);
        Assert.Empty(automation.Tick(now, true, "meet", None, "meet:100", captureAppKey: "vivaldi"));
        Assert.Same(first.Plan, automation.Current);
    }

    [Fact]
    public void InactivityBetweenTheAppsRestartsTheNewAppsConfirmation()
    {
        var automation = new RecorderAutomation();
        var now = Noon;
        var first = Started(automation, ref now);

        now = now.AddSeconds(2);
        automation.Tick(now, true, "teams", None, "teams:200", captureAppKey: "teams");
        now = now.AddSeconds(8);
        automation.Tick(now, false, "unknown", None, "unknown:", captureAppKey: null);
        now = now.AddSeconds(1);
        Assert.Empty(automation.Tick(now, true, "teams", None, "teams:200", captureAppKey: "teams"));
        now = now.AddSeconds(9);
        Assert.Empty(automation.Tick(now, true, "teams", None, "teams:200", captureAppKey: "teams"));
        Assert.Same(first.Plan, automation.Current);
        now = now.AddSeconds(1);
        Assert.Equal(2, automation.Tick(now, true, "teams", None, "teams:200", captureAppKey: "teams").Count);
    }

    [Fact]
    public void SwitchDuringPauseDoesNothingAndTheCurrentRecordingContinues()
    {
        var automation = new RecorderAutomation();
        var now = Noon;
        var first = Started(automation, ref now);
        automation.PauseAutoStartForOneHour(now);

        for (var second = 0; second < 40; second++)
        {
            now = now.AddSeconds(1);
            Assert.Empty(automation.Tick(now, true, "teams", None, "teams:200", captureAppKey: "teams"));
        }

        Assert.Same(first.Plan, automation.Current);
    }

    [Fact]
    public void ManualRecordingNeverSplitsAcrossApps()
    {
        var automation = new RecorderAutomation();
        var now = Noon;
        automation.Tick(now, true, "meet", None, "meet:100", captureAppKey: "vivaldi");
        var manual = Assert.Single(automation.ManualStart(now));
        for (var second = 0; second < 30; second++)
        {
            now = now.AddSeconds(1);
            Assert.Empty(automation.Tick(now, true, "teams", None, "teams:200", captureAppKey: "teams"));
        }

        Assert.Same(manual.Plan, automation.Current);
    }

    [Fact]
    public void SwitchIntoASuppressedCalendarWindowStopsButDoesNotStartAnother()
    {
        var now = Noon;
        var upcoming = new UpcomingCall("c1", "scheduled", "Weekly", Noon.AddSeconds(50).ToUnixTimeMilliseconds(),
            Noon.AddHours(1).ToUnixTimeMilliseconds(), "zoom");
        var automation = new RecorderAutomation(new AutomationSnapshot(null, null, false,
            [new SuppressedCall("c1", "scheduled", upcoming.EndMs)]));
        Started(automation, ref now);

        automation.Tick(now.AddSeconds(1), true, "teams", [upcoming], "teams:200", captureAppKey: "teams");
        var actions = automation.Tick(now.AddSeconds(11), true, "teams", [upcoming], "teams:200", captureAppKey: "teams");

        var stop = Assert.Single(actions);
        Assert.Equal(RecordingStopReason.NextCall, stop.StopReason);
        Assert.Null(automation.Current);
    }

    [Fact]
    public void SwitchStartsLinkedWhenTheNewAppJoinsAnOpenCalendarWindow()
    {
        var automation = new RecorderAutomation();
        var now = Noon;
        Started(automation, ref now);
        var call = new UpcomingCall("c2", "scheduled", "Standup", now.AddSeconds(30).ToUnixTimeMilliseconds(),
            now.AddHours(1).ToUnixTimeMilliseconds(), "teams");

        automation.Tick(now.AddSeconds(1), true, "teams", [call], "teams:200", captureAppKey: "teams");
        var actions = automation.Tick(now.AddSeconds(11), true, "teams", [call], "teams:200", captureAppKey: "teams");

        Assert.Equal(2, actions.Count);
        Assert.Equal(call, actions[1].Plan.Call);
        Assert.Equal("Standup", actions[1].Plan.Title);
    }

    [Fact]
    public void UnknownAppIdentityNeverSplits()
    {
        var automation = new RecorderAutomation();
        var now = Noon;
        var first = Started(automation, ref now, "zoom", "zoom", 10);
        for (var second = 0; second < 30; second++)
        {
            now = now.AddSeconds(1);
            Assert.Empty(automation.Tick(now, true, "teams", None, "teams:200", captureAppKey: null));
        }

        Assert.Same(first.Plan, automation.Current);
    }

    private static UpcomingCall Scheduled(string id, DateTimeOffset start, TimeSpan length) =>
        new(id, "scheduled", "Client " + id, start.ToUnixTimeMilliseconds(), (start + length).ToUnixTimeMilliseconds(), "zoom");

    /// <summary>A linked Meet call in vivaldi, left 30 seconds before the end, then Teams after a short gap.</summary>
    private static (RecorderAutomation Automation, RecordingPlan First, DateTimeOffset Now) LinkedMeetThenTeams(
        UpcomingCall[] calls, TimeSpan teamsGap)
    {
        var automation = new RecorderAutomation();
        var first = Assert.Single(automation.Tick(Noon, true, "meet", calls, "meet:100", captureAppKey: "vivaldi")).Plan;
        Assert.Equal("c1", first.Call?.Id);
        var now = Noon;
        for (var minute = 1; minute < 29; minute++)
        {
            now = Noon.AddMinutes(minute);
            Assert.Empty(automation.Tick(now, true, "meet", calls, "meet:100", captureAppKey: "vivaldi"));
        }

        now = Noon.AddMinutes(29);
        Assert.Empty(automation.Tick(now, false, "unknown", calls, "unknown:", captureAppKey: null));
        now += teamsGap;
        return (automation, first, now);
    }

    private static IReadOnlyList<RecordingAction> TeamsFor(RecorderAutomation automation, UpcomingCall[] calls,
        ref DateTimeOffset now)
    {
        Assert.Empty(automation.Tick(now, true, "teams", calls, "teams:200", captureAppKey: "teams"));
        now = now.AddSeconds(10);
        return automation.Tick(now, true, "teams", calls, "teams:200", captureAppKey: "teams");
    }

    [Fact]
    public void BackToBackLinkedCallsInDifferentAppsGiveTwoRecordingsLinkedToTheirOwnCalls()
    {
        var c1 = Scheduled("c1", Noon, TimeSpan.FromMinutes(30));
        var c2 = Scheduled("c2", Noon.AddMinutes(30), TimeSpan.FromMinutes(30));
        var calls = new[] { c1, c2 };
        var (automation, first, now) = LinkedMeetThenTeams(calls, TimeSpan.FromSeconds(20));

        var split = TeamsFor(automation, calls, ref now);

        Assert.Equal(2, split.Count);
        Assert.Same(first, split[0].Plan);
        Assert.Equal(RecordingStopReason.NextCall, split[0].StopReason);
        Assert.Equal(c2, split[1].Plan.Call);
        Assert.Equal("Client c2", split[1].Plan.Title);

        // The calendar start of c2 must not produce a third recording.
        foreach (var offset in new[] { 31, 40, 60 })
            Assert.Empty(automation.Tick(Noon.AddMinutes(offset), true, "teams", calls, "teams:200", captureAppKey: "teams"));
        Assert.Equal(c2, automation.Current?.Call);
    }

    [Fact]
    public void TeamsPreChatBeforeTheNextCallLinksToTheUpcomingCallNotThePreviousOne()
    {
        var c1 = Scheduled("c1", Noon, TimeSpan.FromMinutes(30));
        var c2 = Scheduled("c2", Noon.AddMinutes(35), TimeSpan.FromMinutes(30));
        var calls = new[] { c1, c2 };
        var (automation, first, now) = LinkedMeetThenTeams(calls, TimeSpan.FromSeconds(20));

        var split = TeamsFor(automation, calls, ref now);

        Assert.Equal(2, split.Count);
        Assert.Same(first, split[0].Plan);
        Assert.Equal(c2, split[1].Plan.Call);
        Assert.Empty(automation.Tick(Noon.AddMinutes(35), true, "teams", calls, "teams:200", captureAppKey: "teams"));
        Assert.Equal(c2, automation.Current?.Call);
    }

    /// <summary>Ticks once a second, like the host, and returns every action taken.</summary>
    private static List<RecordingAction> Run(RecorderAutomation automation, ref DateTimeOffset now, DateTimeOffset until,
        bool active, string platform, string? app, UpcomingCall[] calls)
    {
        var actions = new List<RecordingAction>();
        while (now < until)
        {
            now = now.AddSeconds(1);
            actions.AddRange(automation.Tick(now, active, active ? platform : "unknown", calls,
                active ? platform + ":" + (app == "vivaldi" ? 100 : 200) : "unknown:", captureAppKey: active ? app : null));
        }

        return actions;
    }

    private static RecorderAutomation LinkedMeetUntil(UpcomingCall[] calls, DateTimeOffset leaves, ref DateTimeOffset now,
        AutomationSnapshot? snapshot = null)
    {
        var automation = new RecorderAutomation(snapshot);
        var started = Assert.Single(Run(automation, ref now, Noon.AddSeconds(1), true, "meet", "vivaldi", calls));
        Assert.Equal("c1", started.Plan.Call?.Id);
        Assert.Empty(Run(automation, ref now, leaves, true, "meet", "vivaldi", calls));
        return automation;
    }

    [Fact]
    public void AdHocTeamsCallAfterALinkedMeetStartsUnlinkedWithRealOneSecondTicks()
    {
        var c1 = Scheduled("c1", Noon, TimeSpan.FromMinutes(30));
        var calls = new[] { c1 };
        var now = Noon;
        var automation = LinkedMeetUntil(calls, Noon.AddMinutes(29), ref now);

        // Meet closes at 12:29. The 60 second inactive stop fires at 12:30, Teams joins at 12:31.
        var stops = Run(automation, ref now, Noon.AddMinutes(31), false, "unknown", null, calls);
        Assert.Equal(RecordingStopReason.MeetingInactive, Assert.Single(stops).StopReason);
        var starts = Run(automation, ref now, Noon.AddMinutes(35), true, "teams", "teams", calls);

        var start = Assert.Single(starts);
        Assert.Equal(RecordingActionKind.Start, start.Kind);
        Assert.Null(start.Plan.Call);
        Assert.Equal("Teams call", start.Plan.Title);
    }

    [Fact]
    public void ReturnOfTheSameAppWithinTheTrailingWindowStillLinksToTheCall()
    {
        var c1 = Scheduled("c1", Noon, TimeSpan.FromMinutes(30));
        var calls = new[] { c1 };
        var now = Noon;
        var automation = LinkedMeetUntil(calls, Noon.AddMinutes(29), ref now);
        Run(automation, ref now, Noon.AddMinutes(31), false, "unknown", null, calls);

        var start = Assert.Single(Run(automation, ref now, Noon.AddMinutes(32), true, "meet", "vivaldi", calls));

        Assert.Equal("c1", start.Plan.Call?.Id);
    }

    [Fact]
    public void SuppressedNextCallStopsThePreviousCallAndStartsNothingForTheTeamsAudio()
    {
        var c1 = Scheduled("c1", Noon, TimeSpan.FromMinutes(30));
        var c2 = Scheduled("c2", Noon.AddMinutes(30), TimeSpan.FromMinutes(30));
        var calls = new[] { c1, c2 };
        var now = Noon;
        var automation = LinkedMeetUntil(calls, Noon.AddMinutes(29), ref now,
            new AutomationSnapshot(null, null, false, [new SuppressedCall("c2", "scheduled", c2.EndMs)]));
        Assert.Empty(Run(automation, ref now, Noon.AddMinutes(29).AddSeconds(20), false, "unknown", null, calls));

        var actions = Run(automation, ref now, Noon.AddMinutes(50), true, "teams", "teams", calls);

        Assert.Equal(RecordingStopReason.NextCall, actions[0].StopReason);
        Assert.DoesNotContain(actions, action => action.Kind == RecordingActionKind.Start);
    }

    [Fact]
    public void SplitStartsUnlinkedWhenTheNextCallIsBeyondTheEarlyJoinWindow()
    {
        var c1 = Scheduled("c1", Noon, TimeSpan.FromMinutes(30));
        var c3 = Scheduled("c3", Noon.AddMinutes(45), TimeSpan.FromMinutes(30));
        var calls = new[] { c1, c3 };
        var (automation, _, now) = LinkedMeetThenTeams(calls, TimeSpan.FromSeconds(20));

        var split = TeamsFor(automation, calls, ref now);

        // c3 opens at 12:43, thirteen minutes after the switch, so the new recording is unlinked.
        Assert.Equal(2, split.Count);
        Assert.Null(split[1].Plan.Call);
    }
}
