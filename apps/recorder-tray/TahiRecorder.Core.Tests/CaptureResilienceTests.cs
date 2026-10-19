using System.Diagnostics;
using System.Text.Json;
using TahiRecorder.Core.Api;
using TahiRecorder.Core.Audio;
using TahiRecorder.Core.Automation;

namespace TahiRecorder.Core.Tests;

/// <summary>Regression tests for the 2026-10-19 wedge: a hung native stop must never own the recorder.</summary>
public sealed class CaptureResilienceTests : IDisposable
{
    private static readonly DateTimeOffset Noon = new(2026, 10, 19, 12, 0, 0, TimeSpan.Zero);
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "tahi-resilience-" + Guid.NewGuid().ToString("N"));

    [Fact]
    public void HungNativeCallIsAbandonedAtTheDeadline()
    {
        using var never = new ManualResetEventSlim(false);
        var timer = Stopwatch.StartNew();
        var finished = BoundedNative.TryRun(() => never.Wait(), TimeSpan.FromMilliseconds(150));
        Assert.False(finished);
        Assert.InRange(timer.ElapsedMilliseconds, 100, 5_000);
        never.Set();
    }

    [Fact]
    public void NativeCallThatFinishesReturnsTrueAndFailuresAreReported()
    {
        Assert.True(BoundedNative.TryRun(() => { }, TimeSpan.FromSeconds(5)));
        Exception? seen = null;
        Assert.True(BoundedNative.TryRun(() => throw new InvalidOperationException(), TimeSpan.FromSeconds(5), error => seen = error));
        Assert.IsType<InvalidOperationException>(seen);
    }

    [Fact]
    public async Task BoundedAwaitGivesUpOnATaskThatNeverCompletes()
    {
        var never = new TaskCompletionSource();
        Assert.False(await BoundedNative.TryWaitAsync(never.Task, TimeSpan.FromMilliseconds(100)));
        Assert.True(await BoundedNative.TryWaitAsync(Task.CompletedTask, TimeSpan.FromSeconds(5)));
        never.SetException(new IOException());
    }

    [Fact]
    public async Task StopSequenceFinalisesEvenWhenThePumpAndAMicReleaseNeverReturn()
    {
        using var driverJoin = new ManualResetEventSlim(false);
        var neverPump = new TaskCompletionSource().Task;
        var order = new List<string>();
        var timer = Stopwatch.StartNew();

        var outcome = await CaptureStopSequence.RunAsync(neverPump, TimeSpan.FromMilliseconds(100),
            () => [() => driverJoin.Wait(), () => order.Add("system released")], TimeSpan.FromMilliseconds(150),
            () => order.Add("finalised"));
        timer.Stop();
        driverJoin.Set();

        Assert.False(outcome.PumpStopped);
        Assert.Equal(1, outcome.ReleasesTimedOut);
        Assert.Equal(["system released", "finalised"], order);
        Assert.InRange(timer.ElapsedMilliseconds, 0, 5_000);
    }

    [Fact]
    public async Task StopSequenceStillFinalisesWhenDetachingThrows()
    {
        var finalised = false;
        await Assert.ThrowsAsync<InvalidOperationException>(() => CaptureStopSequence.RunAsync(null,
            TimeSpan.FromSeconds(1), () => throw new InvalidOperationException(), TimeSpan.FromSeconds(1),
            () => finalised = true));
        Assert.True(finalised);
    }

    [Fact]
    public async Task StartThatFinishesAfterTheDeadlineIsStoppedByItsCleanup()
    {
        var release = new TaskCompletionSource();
        var cleaned = new TaskCompletionSource();
        var finished = await BoundedNative.TryRunWithLateCleanupAsync(() => release.Task,
            TimeSpan.FromMilliseconds(100), () => { cleaned.SetResult(); return Task.CompletedTask; });
        Assert.False(finished);
        Assert.False(cleaned.Task.IsCompleted);
        release.SetResult();
        await cleaned.Task.WaitAsync(TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task StartThatFinishesInTimeRunsNoCleanup()
    {
        var cleaned = false;
        Assert.True(await BoundedNative.TryRunWithLateCleanupAsync(() => Task.CompletedTask,
            TimeSpan.FromSeconds(5), () => { cleaned = true; return Task.CompletedTask; }));
        await Task.Delay(50);
        Assert.False(cleaned);
    }

    [Fact]
    public void MeetingEndDuringADeviceSwitchStillFlushesThePartialChunkAndMarksTheSessionComplete()
    {
        var clientRef = Guid.NewGuid();
        using var spool = new DurableCaptureSpool(_directory, clientRef);
        var pcm = new byte[32 * 12_395];
        Array.Fill(pcm, (byte)7);
        foreach (var track in new[] { "mic", "system" })
            spool.AddAt(track, 0, pcm);
        Assert.Empty(spool.Advance(12_395, complete: false));

        // The mic is mid-switch to a restarting virtual device: its native release never returns.
        using var driverJoin = new ManualResetEventSlim(false);
        var timer = Stopwatch.StartNew();
        var micReleased = BoundedNative.TryRun(() => driverJoin.Wait(), TimeSpan.FromMilliseconds(150));
        var systemReleased = BoundedNative.TryRun(() => { }, TimeSpan.FromMilliseconds(150));
        var chunks = spool.Advance(12_395, complete: true);
        timer.Stop();
        driverJoin.Set();

        Assert.False(micReleased);
        Assert.True(systemReleased);
        Assert.InRange(timer.ElapsedMilliseconds, 0, 5_000);
        Assert.Equal(2, chunks.Count);
        Assert.All(chunks, chunk =>
        {
            Assert.True(File.Exists(chunk.FilePath));
            Assert.Equal(12_395, chunk.DurationMs);
        });
        var journal = JsonDocument.Parse(File.ReadAllText(Path.Combine(_directory, clientRef.ToString("D"), "session.json")));
        Assert.True(journal.RootElement.GetProperty("Completed").GetBoolean());
        Assert.Empty(Directory.GetFiles(Path.Combine(_directory, clientRef.ToString("D")), "*.pcm"));
    }

    [Fact]
    public async Task StuckHolderIsAbandonedSoTheNextOperationCanRun()
    {
        var clock = new ManualClock(Noon);
        var gate = new OperationGate(clock);
        var wedged = await gate.EnterAsync();
        Assert.Null(gate.TryEnter());
        Assert.False(gate.TryBreakIfStuck(TimeSpan.FromMinutes(3)));

        clock.Advance(TimeSpan.FromMinutes(4));
        Assert.True(gate.TryBreakIfStuck(TimeSpan.FromMinutes(3)));
        var next = gate.TryEnter();
        Assert.NotNull(next);

        // The wedged operation finally returning must not free the gate under the new holder.
        wedged.Dispose();
        Assert.Null(gate.TryEnter());
        next!.Dispose();
        Assert.NotNull(gate.TryEnter());
    }

    [Fact]
    public async Task QueuedWaitersMoveToTheReplacementGate()
    {
        var clock = new ManualClock(Noon);
        var gate = new OperationGate(clock);
        var wedged = await gate.EnterAsync();
        var first = gate.EnterAsync();
        var second = gate.EnterAsync();
        Assert.False(first.IsCompleted);

        clock.Advance(TimeSpan.FromMinutes(10));
        Assert.True(gate.TryBreakIfStuck(TimeSpan.FromMinutes(3)));
        var winner = await first.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.False(second.IsCompleted);
        winner.Dispose();
        (await second.WaitAsync(TimeSpan.FromSeconds(5))).Dispose();
        wedged.Dispose();
    }

    [Fact]
    public async Task AutomationStartsTheNextMeetingOnceAForcedGateBreakFreesAStarvedTick()
    {
        var clock = new ManualClock(Noon);
        var gate = new OperationGate(clock);
        var automation = new RecorderAutomation();
        IReadOnlyList<UpcomingCall> none = [];

        // First meeting: an unknown call recorded automatically, then it ends and the stop wedges the host.
        automation.Tick(clock.GetUtcNow(), true, "meet", none, "meet:35256");
        clock.Advance(RecorderAutomation.UnknownCallDelay);
        var first = Assert.Single(automation.Tick(clock.GetUtcNow(), true, "meet", none, "meet:35256"));
        Assert.Equal(RecordingActionKind.Start, first.Kind);
        clock.Advance(TimeSpan.FromMinutes(59));
        automation.Tick(clock.GetUtcNow(), false, "unknown", none, "unknown:");
        clock.Advance(RecorderAutomation.InactiveStopDelay);
        var stop = Assert.Single(automation.Tick(clock.GetUtcNow(), false, "unknown", none, "unknown:"));
        Assert.Equal(RecordingStopReason.MeetingInactive, stop.StopReason);
        var wedgedStop = await gate.EnterAsync();

        // Teams call starts while the stop is still hung: every tick is starved.
        clock.Advance(TimeSpan.FromMinutes(28));
        Assert.Null(gate.TryEnter());
        Assert.True(gate.TryBreakIfStuck(TimeSpan.FromMinutes(3)));

        // The watchdog freed the gate, so ticks run again and the next meeting is recorded.
        using var lease = gate.TryEnter();
        Assert.NotNull(lease);
        automation.Tick(clock.GetUtcNow(), true, "teams", none, "teams:199716");
        clock.Advance(RecorderAutomation.UnknownCallDelay);
        var second = Assert.Single(automation.Tick(clock.GetUtcNow(), true, "teams", none, "teams:199716"));
        Assert.Equal(RecordingActionKind.Start, second.Kind);
        Assert.NotEqual(first.Plan.ClientRef, second.Plan.ClientRef);
        wedgedStop.Dispose();
    }

    [Fact]
    public void AbandonedStartBacksOffAutoStartSoAWedgedDeviceIsNotRetriedEverySecond()
    {
        var automation = new RecorderAutomation();
        IReadOnlyList<UpcomingCall> none = [];
        automation.Tick(Noon, true, "meet", none, "meet:1");
        var start = Assert.Single(automation.Tick(Noon.AddSeconds(20), true, "meet", none, "meet:1"));
        Assert.Equal(RecordingActionKind.Start, start.Kind);

        // The host abandons the wedged start.
        var abandonedAt = Noon.AddSeconds(25);
        automation.StopForLifecycle(RecordingStopReason.Shutdown);
        automation.DelayAutoStart(abandonedAt, RecorderAutomation.AbandonedStartDelay);

        for (var seconds = 0; seconds < 119; seconds += 7)
            Assert.Empty(automation.Tick(abandonedAt.AddSeconds(seconds), true, "meet", none, "meet:1"));
        // The delay survives a restart, and a shorter later delay never shortens it.
        var restored = new RecorderAutomation(automation.ExportState());
        restored.DelayAutoStart(abandonedAt, TimeSpan.FromSeconds(1));
        Assert.Empty(restored.Tick(abandonedAt.AddSeconds(100), true, "meet", none, "meet:1"));
        var next = Assert.Single(restored.Tick(abandonedAt.AddSeconds(121), true, "meet", none, "meet:1"));
        Assert.Equal(RecordingActionKind.Start, next.Kind);
    }

    [Fact]
    public void KeyChangeFlapDuringARecordingNeitherStopsNorRestartsIt()
    {
        var automation = new RecorderAutomation();
        IReadOnlyList<UpcomingCall> none = [];
        var now = Noon;
        automation.Tick(now, true, "meet", none, "meet:35256");
        now = now.AddSeconds(20);
        var start = Assert.Single(automation.Tick(now, true, "meet", none, "meet:35256"));

        // 22:32:11 previousProcess=vivaldi, 22:32:12 process=vivaldi: inactive for one second, same pid.
        now = now.AddSeconds(23);
        Assert.Empty(automation.Tick(now, false, "unknown", none, "unknown:"));
        now = now.AddSeconds(1);
        Assert.Empty(automation.Tick(now, true, "meet", none, "meet:35256"));
        now = now.AddMinutes(20);
        Assert.Empty(automation.Tick(now, true, "meet", none, "meet:35256"));

        Assert.Same(start.Plan, automation.Current);
    }

    [Fact]
    public void FlapShorterThanTheStopDelayStillStopsWhenTheMeetingReallyEnds()
    {
        var automation = new RecorderAutomation();
        IReadOnlyList<UpcomingCall> none = [];
        var now = Noon;
        automation.Tick(now, true, "meet", none, "meet:35256");
        now = now.AddSeconds(20);
        automation.Tick(now, true, "meet", none, "meet:35256");
        now = now.AddSeconds(30);
        automation.Tick(now, false, "unknown", none, "unknown:");
        now = now.AddSeconds(1);
        automation.Tick(now, true, "meet", none, "meet:35256");

        // Meeting ends for real: the inactive timer restarts from the end, not from the flap.
        now = now.AddMinutes(30);
        automation.Tick(now, false, "unknown", none, "unknown:");
        Assert.Empty(automation.Tick(now.AddSeconds(59), false, "unknown", none, "unknown:"));
        var stop = Assert.Single(automation.Tick(now.AddSeconds(60), false, "unknown", none, "unknown:"));
        Assert.Equal(RecordingStopReason.MeetingInactive, stop.StopReason);
        Assert.Null(automation.Current);
    }

    [Fact]
    public void ProcessIdChangeAcrossAFlapDoesNotSplitAnAutomaticRecording()
    {
        var automation = new RecorderAutomation();
        IReadOnlyList<UpcomingCall> none = [];
        var now = Noon;
        automation.Tick(now, true, "meet", none, "meet:35256");
        now = now.AddSeconds(20);
        var start = Assert.Single(automation.Tick(now, true, "meet", none, "meet:35256"));
        now = now.AddSeconds(30);
        automation.Tick(now, false, "unknown", none, "unknown:");
        now = now.AddSeconds(1);
        Assert.Empty(automation.Tick(now, true, "teams", none, "teams:199716"));
        Assert.Same(start.Plan, automation.Current);
    }

    [Fact]
    public void CaptureWhosePumpStopsTickingIsFinalisedByTheStallSafetyNet()
    {
        Assert.False(CaptureStallPolicy.IsStalled(true, TimeSpan.FromSeconds(29)));
        Assert.True(CaptureStallPolicy.IsStalled(true, TimeSpan.FromSeconds(30)));
        Assert.False(CaptureStallPolicy.IsStalled(false, TimeSpan.FromHours(1)));

        var failure = CaptureFailurePolicy.Evaluate(isCapturing: true, hasAudioGap: false,
            hasPersistenceFailure: false, isStalled: true);
        Assert.Equal(CaptureFailureAction.StopForAudioGap, failure);
        Assert.Equal(CaptureFailureAction.None, CaptureFailurePolicy.Evaluate(false, false, false, isStalled: true));

        var automation = new RecorderAutomation();
        IReadOnlyList<UpcomingCall> none = [];
        automation.Tick(Noon, true, "zoom", none, "zoom:1");
        automation.Tick(Noon.AddSeconds(20), true, "zoom", none, "zoom:1");
        var stop = Assert.Single(automation.Tick(Noon.AddMinutes(10), true, "zoom", none, "zoom:1", failure));
        Assert.Equal(RecordingStopReason.CaptureGap, stop.StopReason);
        Assert.Null(automation.Current);
    }

    [Fact]
    public void MicSwitchAfterAMeetingFlapOrEndIsRetainedInsteadOfRestartingTheDevice()
    {
        var nvidia = Endpoint("nvidia", comms: true, active: [35256]);
        var shure = Endpoint("shure", comms: false, active: []);
        var meeting = new[] { 35256 };

        var inMeeting = AudioEndpointSelector.Select(AudioEndpointFlow.Capture, [nvidia, shure], meeting, null, null, false);
        Assert.Equal("nvidia", inMeeting.EndpointId);
        Assert.Equal(AudioEndpointSelector.MeetingSessionReason, inMeeting.Reason);

        // The session flaps off the endpoint (or the meeting ends) and the default moves to another device.
        var shureDefault = Endpoint("shure", comms: true, active: []);
        var nvidiaIdle = Endpoint("nvidia", comms: false, active: []);
        var retained = AudioEndpointSelector.Select(AudioEndpointFlow.Capture, [nvidiaIdle, shureDefault], meeting,
            null, inMeeting.EndpointId, retainCurrentWithoutMeeting: true);
        Assert.Equal("nvidia", retained.EndpointId);
        Assert.Equal(AudioEndpointSelector.RetainedReason, retained.Reason);

        // Without the flag the old behaviour switches to the communications default.
        var switched = AudioEndpointSelector.Select(AudioEndpointFlow.Capture, [nvidiaIdle, shureDefault], meeting,
            null, inMeeting.EndpointId, retainCurrentWithoutMeeting: false);
        Assert.Equal("shure", switched.EndpointId);
    }

    [Fact]
    public void RetainedMicFollowsAMeetingSessionThatMovesAndFallsBackWhenTheDeviceIsGone()
    {
        var nvidia = Endpoint("nvidia", comms: false, active: []);
        var shure = Endpoint("shure", comms: true, active: [35256]);
        var moved = AudioEndpointSelector.Select(AudioEndpointFlow.Capture, [nvidia, shure], [35256], null, "nvidia", true);
        Assert.Equal("shure", moved.EndpointId);
        Assert.Equal(AudioEndpointSelector.MeetingSessionReason, moved.Reason);

        var gone = AudioEndpointSelector.Select(AudioEndpointFlow.Capture, [Endpoint("shure", true, [])], [35256], null, "nvidia", true);
        Assert.Equal("shure", gone.EndpointId);
        Assert.Equal("Communications default fallback", gone.Reason);
    }

    private static AudioEndpointSnapshot Endpoint(string id, bool comms, int[] active) =>
        new(id, id, AudioEndpointFlow.Capture, comms, false, active);

    public void Dispose()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, true);
    }

    private sealed class ManualClock(DateTimeOffset start) : TimeProvider
    {
        private DateTimeOffset _now = start;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan time) => _now += time;
    }
}
