using TahiRecorder.Core.Api;
using TahiRecorder.Core.Audio;

namespace TahiRecorder.Core.Automation;

public enum RecordingActionKind { Start, Stop }

public enum RecordingStopReason
{
    MeetingInactive,
    Manual,
    NextCall,
    MaximumDuration,
    ScheduledOverrun,
    SystemSuspend,
    SessionEnding,
    Shutdown,
    CaptureGap,
    RecordingBlocked
}

public sealed record RecordingPlan(
    Guid ClientRef,
    string Title,
    UpcomingCall? Call,
    DateTimeOffset StartedAt,
    bool IsAutomatic,
    bool CreateSent = false);

public sealed record RecordingAction(
    RecordingActionKind Kind,
    RecordingPlan Plan,
    RecordingStopReason? StopReason = null);

public sealed record SuppressedCall(string Id, string Kind, long EndMs);

internal sealed record RetiredCall(UpcomingCall Call, string App);

public sealed record AutomationSnapshot(
    DateTimeOffset? PausedUntil,
    DateTimeOffset? ManuallyStoppedAt,
    bool SuppressCurrentSession,
    IReadOnlyList<SuppressedCall> SuppressedCalls,
    string? ManuallyStoppedSessionKey = null,
    bool CalendarRestartQualified = false,
    DateTimeOffset? AutoStartNotBefore = null,
    DateTimeOffset? StoppedRecordingStartedAt = null,
    UpcomingCall? CalendarRestartTarget = null);

/// <summary>
/// Decisions use capture-session ownership, never microphone loudness or playback.
/// The host supplies its clock so every transition can be exercised without Windows.
/// </summary>
public sealed class RecorderAutomation
{
    public static readonly TimeSpan UnknownCallDelay = TimeSpan.FromSeconds(20);
    public static readonly TimeSpan InactiveStopDelay = TimeSpan.FromSeconds(60);
    public static readonly TimeSpan OverrunInactiveDelay = TimeSpan.FromSeconds(5);
    /// <summary>How long a different app must hold the capture session before an automatic recording splits to it.</summary>
    public static readonly TimeSpan AppSwitchConfirmDelay = TimeSpan.FromSeconds(10);
    public static readonly TimeSpan CaptureGapAutoStartDelay = TimeSpan.FromSeconds(45);
    public static readonly TimeSpan AbandonedStartDelay = TimeSpan.FromMinutes(2);
    public static readonly TimeSpan EarlyJoinWindow = TimeSpan.FromMinutes(10);
    public static readonly TimeSpan MaximumDuration = TimeSpan.FromHours(12);
    private readonly List<SuppressedCall> _suppressedCalls;
    private DateTimeOffset? _activeSince;
    private string? _observedSessionKey;
    private DateTimeOffset? _inactiveSince;
    private DateTimeOffset? _pausedUntil;
    private DateTimeOffset? _manuallyStoppedAt;
    private DateTimeOffset? _stoppedRecordingStartedAt;
    private string? _manuallyStoppedSessionKey;
    private bool _suppressCurrentSession;
    private bool _calendarRestartQualified;
    private UpcomingCall? _calendarRestartTarget;
    private DateTimeOffset? _autoStartNotBefore;
    private bool _meetingSessionSeen;
    private string? _recordingSessionKey;
    private string? _observedAppKey;
    private string? _recordingAppKey;
    private readonly List<RetiredCall> _retiredCalls = [];
    private string? _pendingAppKey;
    private DateTimeOffset _pendingAppSince;
    private UpcomingCall? _currentCalendarContext;
    private IReadOnlyList<UpcomingCall> _currentCalendarCandidates = [];

    public RecorderAutomation(AutomationSnapshot? snapshot = null)
    {
        _pausedUntil = snapshot?.PausedUntil;
        _manuallyStoppedAt = snapshot?.ManuallyStoppedAt;
        _stoppedRecordingStartedAt = snapshot?.StoppedRecordingStartedAt;
        _manuallyStoppedSessionKey = snapshot?.ManuallyStoppedSessionKey;
        _suppressCurrentSession = snapshot?.SuppressCurrentSession ?? false;
        _calendarRestartTarget = snapshot?.CalendarRestartTarget;
        _calendarRestartQualified = snapshot?.CalendarRestartQualified == true && _calendarRestartTarget is not null;
        _autoStartNotBefore = snapshot?.AutoStartNotBefore;
        _suppressedCalls = snapshot?.SuppressedCalls.ToList() ?? [];
    }

    public RecordingPlan? Current { get; private set; }
    public DateTimeOffset? PausedUntil => _pausedUntil;
    public bool IsPaused(DateTimeOffset now) => _pausedUntil > now;

    public IReadOnlyList<RecordingAction> Tick(
        DateTimeOffset now,
        bool active,
        string platform,
        IReadOnlyList<UpcomingCall> calls,
        string? captureSessionKey = null,
        CaptureFailureAction captureFailure = CaptureFailureAction.None,
        string? captureAppKey = null)
    {
        ArgumentNullException.ThrowIfNull(calls);
        var nowMs = now.ToUnixTimeMilliseconds();
        if (_calendarRestartTarget is { } target && target.EndMs + 600_000 < nowMs)
            ClearCalendarRestart();
        _observedAppKey = active ? captureAppKey : null;
        ObserveActivity(now, active, captureSessionKey ?? platform, calls);
        // Expired calendar ids no longer influence matching, while the session
        // suppression still prevents a long manually stopped call restarting.
        _suppressedCalls.RemoveAll(call => call.EndMs + 600_000 < nowMs);

        if (Current is not null && captureFailure == CaptureFailureAction.StopForAudioGap)
        {
            _autoStartNotBefore = now + CaptureGapAutoStartDelay;
            return ResetActivityAndStop(RecordingStopReason.CaptureGap);
        }

        if (Current is { } current)
        {
            if (now - current.StartedAt >= MaximumDuration)
            {
                _suppressCurrentSession = true;
                _manuallyStoppedAt = now;
                _stoppedRecordingStartedAt = current.StartedAt;
                _manuallyStoppedSessionKey = null;
                ClearCalendarRestart();
                return Stop(RecordingStopReason.MaximumDuration);
            }

            if (active)
            {
                // A calendar boundary alone does not interrupt manual notes.
                // A new observed capture session represents the next actual call.
                if (!current.IsAutomatic && _meetingSessionSeen && _recordingSessionKey is { } previousSession &&
                    previousSession != _observedSessionKey)
                    return Stop(RecordingStopReason.NextCall);
                _meetingSessionSeen = true;
                _recordingSessionKey = _observedSessionKey;
            }

            if (!active && _meetingSessionSeen && _inactiveSince is { } overrunInactive &&
                now - overrunInactive >= OverrunInactiveDelay &&
                _currentCalendarContext is { } scheduled && nowMs >= scheduled.EndMs + 900_000)
                return Stop(RecordingStopReason.ScheduledOverrun);

            if (!active && _meetingSessionSeen && _inactiveSince is { } inactive && now - inactive >= InactiveStopDelay)
                return Stop(RecordingStopReason.MeetingInactive);

            if (current.IsAutomatic && TryConfirmAppSwitch(now, active))
            {
                var actions = new List<RecordingAction>(Stop(RecordingStopReason.NextCall));
                actions.AddRange(StartAutomatic(now, nowMs, platform, calls, unknownReady: true, afterSplit: true));
                return actions;
            }

            var next = current.IsAutomatic && !IsPaused(now) ? FindNextCalls(nowMs, current, calls) : [];
            if (next.Count != 0)
            {
                var actions = new List<RecordingAction>(Stop(RecordingStopReason.NextCall));
                if (active && !IsPaused(now))
                {
                    var match = next.Count == 1 ? next[0] : null;
                    actions.Add(Start(now, match, platform, true, calendarCandidates: next));
                }
                return actions;
            }
            return [];
        }

        if (!active || IsPaused(now) || now < _autoStartNotBefore) return [];
        calls = ExcludeRetired(now, calls);

        var matchResult = CallMatcher.Match(nowMs, calls);
        if (_suppressCurrentSession)
        {
            // A short observed closure qualifies only a later calendar window.
            // Unscheduled calls still need the full inactive stop delay.
            if (!_calendarRestartQualified || matchResult.Call is not { } later ||
                _calendarRestartTarget is not { } restartTarget ||
                !CallMatcher.SameCall(later, restartTarget) || !IsLaterRestartCall(later))
                return [];
            _suppressCurrentSession = false;
            _manuallyStoppedSessionKey = null;
            ClearCalendarRestart();
        }

        return StartAutomatic(now, nowMs, platform, calls, unknownReady: false);
    }

    /// <summary>
    /// A different app that holds the capture session for <see cref="AppSwitchConfirmDelay"/> is the next call.
    /// The same app returning, an unknown app identity, an inactive session and a pause all clear the
    /// candidate, so flaps and process id changes of one app never split.
    /// </summary>
    private bool TryConfirmAppSwitch(DateTimeOffset now, bool active)
    {
        if (!active || _observedAppKey is not { } app || IsPaused(now))
        {
            _pendingAppKey = null;
            return false;
        }
        _recordingAppKey ??= app;
        if (app == _recordingAppKey)
        {
            _pendingAppKey = null;
            return false;
        }
        if (_pendingAppKey != app)
        {
            _pendingAppKey = app;
            _pendingAppSince = now;
            return false;
        }
        return now - _pendingAppSince >= AppSwitchConfirmDelay;
    }

    /// <summary>
    /// Starts like a normal automatic start: calendar window and suppression rules apply. A confirmed app
    /// switch has already waited out its own delay, so it needs no further unknown-call qualification.
    /// A stopped recording's calls never match a different app (see ExcludeRetired). After a split another open
    /// window links, an upcoming call within the early-join window links at once (waiting would drop audio),
    /// and otherwise the new recording is unlinked.
    /// </summary>
    private IReadOnlyList<RecordingAction> StartAutomatic(
        DateTimeOffset now, long nowMs, string platform, IReadOnlyList<UpcomingCall> allCalls, bool unknownReady,
        bool afterSplit = false)
    {
        if (IsPaused(now) || now < _autoStartNotBefore) return [];
        var calls = ExcludeRetired(now, allCalls);
        var matchResult = CallMatcher.Match(nowMs, calls);
        if (matchResult.HasOpenWindow)
        {
            if (matchResult.Call is { } matched && IsSuppressed(matched))
                return [];
            var open = calls.Where(call => call.StartMs - 120_000 <= nowMs && call.EndMs + 600_000 >= nowMs)
                .DistinctBy(call => (call.Kind, call.Id)).ToArray();
            if (matchResult.Call is null && open.Any(IsSuppressed))
                return [];
            // Multiple equally plausible windows intentionally create unlinked.
            return [Start(now, matchResult.Call, platform, true,
                calendarCandidates: matchResult.Call is null ? open : null)];
        }

        if (afterSplit)
        {
            var soon = calls.Where(call => call.StartMs - 120_000 > nowMs &&
                call.StartMs - 120_000 <= nowMs + (long)EarlyJoinWindow.TotalMilliseconds && !IsSuppressed(call))
                .DistinctBy(call => (call.Kind, call.Id)).ToArray();
            if (soon.Length != 0)
            {
                var earliest = soon.Min(call => call.StartMs);
                var upcoming = soon.Where(call => call.StartMs == earliest).ToArray();
                return [Start(now, upcoming.Length == 1 ? upcoming[0] : null, platform, true,
                    calendarCandidates: upcoming.Length == 1 ? null : upcoming)];
            }
            return [Start(now, null, platform, true)];
        }

        // An early join waits for the calendar window instead of producing a
        // short unlinked fragment immediately before a known call.
        if (calls.Any(call => call.StartMs - 120_000 > nowMs &&
            call.StartMs - 120_000 <= nowMs + (long)EarlyJoinWindow.TotalMilliseconds))
            return [];

        if (unknownReady || _activeSince is { } started && now - started >= UnknownCallDelay)
            return [Start(now, null, platform, true)];

        return [];
    }

    public IReadOnlyList<RecordingAction> ManualStart(
        DateTimeOffset now, string platform = "unknown", string? title = null)
    {
        if (Current is not null) return [];
        _inactiveSince = null;
        return [Start(now, null, platform, false, title)];
    }

    public IReadOnlyList<RecordingAction> ManualStop(DateTimeOffset now) =>
        StopWithSuppression(now, RecordingStopReason.Manual);

    /// <summary>A blocked server recording stops capture and holds the failed session until it closes.</summary>
    public IReadOnlyList<RecordingAction> StopForBlockedRecording(DateTimeOffset now) =>
        StopWithSuppression(now, RecordingStopReason.RecordingBlocked);

    private IReadOnlyList<RecordingAction> StopWithSuppression(DateTimeOffset now, RecordingStopReason reason)
    {
        if (Current is null) return [];
        var representedStart = RepresentedCalendarStart();
        var nowMs = now.ToUnixTimeMilliseconds();
        foreach (var call in _currentCalendarCandidates.Where(call => !IsSuppressed(call)
            && (call.StartMs == representedStart || call.StartMs <= nowMs && call.EndMs >= nowMs)))
            _suppressedCalls.Add(new SuppressedCall(call.Id, call.Kind, call.EndMs));
        _suppressCurrentSession = true;
        ClearCalendarRestart();
        _manuallyStoppedAt = now;
        _stoppedRecordingStartedAt = Current.StartedAt;
        _manuallyStoppedSessionKey = _recordingSessionKey;
        return Stop(reason);
    }

    /// <summary>Host lifecycle events stop capture without suppressing later calls.</summary>
    public IReadOnlyList<RecordingAction> StopForLifecycle(RecordingStopReason reason = RecordingStopReason.Shutdown)
    {
        if (reason is not (RecordingStopReason.SystemSuspend or RecordingStopReason.SessionEnding
            or RecordingStopReason.Shutdown))
            throw new ArgumentOutOfRangeException(nameof(reason));
        return ResetActivityAndStop(reason);
    }

    private IReadOnlyList<RecordingAction> ResetActivityAndStop(RecordingStopReason reason)
    {
        _activeSince = null;
        _inactiveSince = null;
        _observedSessionKey = null;
        return Stop(reason);
    }

    public void PauseAutoStartForOneHour(DateTimeOffset now) => _pausedUntil = now.AddHours(1);

    /// <summary>Holds off automatic starts, for example after a start that wedged the audio device.</summary>
    public void DelayAutoStart(DateTimeOffset now, TimeSpan delay)
    {
        var until = now + delay;
        if (_autoStartNotBefore is not { } existing || existing < until) _autoStartNotBefore = until;
    }

    /// <summary>Only a not-yet-sent create can be changed to unlinked.</summary>
    public bool NotThisCall()
    {
        if (Current is not { CreateSent: false, Call: not null }) return false;
        Current = Current with { Call = null };
        return true;
    }

    public void MarkCreateSent()
    {
        if (Current is not null) Current = Current with { CreateSent = true };
    }

    public AutomationSnapshot ExportState() => new(
        _pausedUntil, _manuallyStoppedAt, _suppressCurrentSession, _suppressedCalls.ToArray(),
        _manuallyStoppedSessionKey, _calendarRestartQualified, _autoStartNotBefore,
        _stoppedRecordingStartedAt, _calendarRestartTarget);

    private void ObserveActivity(DateTimeOffset now, bool active, string sessionKey, IReadOnlyList<UpcomingCall> calls)
    {
        if (Current is null && _suppressCurrentSession && !_calendarRestartQualified && _inactiveSince is { } closed &&
            now - closed >= OverrunInactiveDelay)
        {
            // A short closure belongs to the next eligible call, including an
            // early rejoin before its window opens. It cannot authorise later windows.
            _calendarRestartTarget = calls.Where(call => IsLaterRestartCall(call) &&
                    call.EndMs + 600_000 >= now.ToUnixTimeMilliseconds())
                .OrderBy(call => call.StartMs).FirstOrDefault();
            _calendarRestartQualified = _calendarRestartTarget is not null;
        }
        if (active)
        {
            if (_inactiveSince is { } inactive && now - inactive >= InactiveStopDelay)
            {
                _suppressCurrentSession = false;
                _manuallyStoppedSessionKey = null;
                ClearCalendarRestart();
            }
            if (_observedSessionKey != sessionKey) _activeSince = now;
            _observedSessionKey = sessionKey;
            _activeSince ??= now;
            _inactiveSince = null;
        }
        else
        {
            _activeSince = null;
            _observedSessionKey = null;
            _inactiveSince ??= now;
            if (now - _inactiveSince.Value >= InactiveStopDelay)
            {
                _suppressCurrentSession = false;
                _manuallyStoppedSessionKey = null;
                ClearCalendarRestart();
            }
        }
    }

    private bool IsLaterRestartCall(UpcomingCall call) =>
        _manuallyStoppedAt is { } stopped && _stoppedRecordingStartedAt is { } started &&
        call.StartMs > stopped.ToUnixTimeMilliseconds() &&
        call.StartMs - 120_000 > started.ToUnixTimeMilliseconds() && !IsSuppressed(call);

    private void ClearCalendarRestart()
    {
        _calendarRestartQualified = false;
        _calendarRestartTarget = null;
    }

    private List<UpcomingCall> FindNextCalls(long nowMs, RecordingPlan current, IReadOnlyList<UpcomingCall> calls)
    {
        var startedAt = current.StartedAt.ToUnixTimeMilliseconds();
        var representedStart = RepresentedCalendarStart();
        var candidates = calls.Where(call =>
            call.StartMs > startedAt && call.StartMs <= nowMs &&
            call.EndMs + 600_000 >= nowMs && !IsSuppressed(call) &&
            !(call.StartMs == representedStart
                && _currentCalendarCandidates.Any(candidate => CallMatcher.SameCall(call, candidate)))).ToList();
        if (candidates.Count == 0) return [];
        var mostRecentStart = candidates.Max(call => call.StartMs);
        return candidates.Where(call => call.StartMs == mostRecentStart)
            .DistinctBy(call => (call.Kind, call.Id)).ToList();
    }

    private bool IsSuppressed(UpcomingCall call) =>
        _suppressedCalls.Any(item => item.Id == call.Id && item.Kind == call.Kind);

    private long? RepresentedCalendarStart() => _currentCalendarContext?.StartMs
        ?? (_currentCalendarCandidates.Count == 0 ? null : _currentCalendarCandidates.Min(call => call.StartMs));

    private RecordingAction Start(
        DateTimeOffset now, UpcomingCall? call, string platform, bool automatic, string? title = null,
        IReadOnlyList<UpcomingCall>? calendarCandidates = null)
    {
        ClearCalendarRestart();
        _currentCalendarContext = call;
        _currentCalendarCandidates = calendarCandidates ?? (call is null ? [] : [call]);
        _meetingSessionSeen = automatic;
        _recordingSessionKey = _observedSessionKey;
        _recordingAppKey = _observedAppKey;
        _pendingAppKey = null;
        Current = new RecordingPlan(Guid.NewGuid(), title ?? call?.Title ?? PlatformTitle(platform), call, now, automatic);
        return new RecordingAction(RecordingActionKind.Start, Current);
    }

    /// <summary>
    /// A stopped recording's calendar calls stay open for ten minutes after their end, so a different app
    /// starting then would be filed under the call that was just left. Remember each call with the app that
    /// recorded it. Without a known app there is nothing to compare, so nothing is retired.
    /// </summary>
    private void RetireCalls(RecordingPlan plan)
    {
        if (_recordingAppKey is not { } app) return;
        var calls = _currentCalendarCandidates.ToList();
        if (_currentCalendarContext is { } context) calls.Add(context);
        if (plan.Call is { } linked) calls.Add(linked);
        foreach (var call in calls)
            if (!_retiredCalls.Any(item => CallMatcher.SameCall(item.Call, call) && item.App == app))
                _retiredCalls.Add(new RetiredCall(call, app));
    }

    /// <summary>
    /// Retired calls are ignored by matching until their window closes or the app that recorded them is the
    /// one holding the session again. Pending and unknown sessions leave them excluded.
    /// </summary>
    private IReadOnlyList<UpcomingCall> ExcludeRetired(DateTimeOffset now, IReadOnlyList<UpcomingCall> calls)
    {
        if (_retiredCalls.Count == 0) return calls;
        var nowMs = now.ToUnixTimeMilliseconds();
        _retiredCalls.RemoveAll(item => item.Call.EndMs + 600_000 < nowMs
            || _observedAppKey is { } observed && observed == item.App);
        if (_retiredCalls.Count == 0) return calls;
        return calls.Where(call => !_retiredCalls.Any(item => CallMatcher.SameCall(item.Call, call))).ToArray();
    }

    private IReadOnlyList<RecordingAction> Stop(RecordingStopReason reason)
    {
        if (Current is not { } plan) return [];
        RetireCalls(plan);
        Current = null;
        _currentCalendarContext = null;
        _currentCalendarCandidates = [];
        _meetingSessionSeen = false;
        _recordingSessionKey = null;
        _recordingAppKey = null;
        _pendingAppKey = null;
        return [new RecordingAction(RecordingActionKind.Stop, plan, reason)];
    }

    public static string PlatformTitle(string platform) => platform.ToLowerInvariant() switch
    {
        "zoom" => "Zoom call",
        "teams" => "Teams call",
        "meet" => "Meet call",
        _ => "Meeting call"
    };
}

public sealed record CallMatch(bool HasOpenWindow, UpcomingCall? Call);

public static class CallMatcher
{
    public static CallMatch Match(long nowMs, IReadOnlyList<UpcomingCall> calls)
    {
        var open = calls.Where(call => call.StartMs - 120_000 <= nowMs && call.EndMs + 600_000 >= nowMs)
            .DistinctBy(call => (call.Kind, call.Id)).ToArray();
        if (open.Length == 0) return new(false, null);
        if (open.Length == 1) return new(true, open[0]);
        var current = open.Where(call => call.StartMs <= nowMs && call.EndMs >= nowMs).ToArray();
        return new(true, current.Length == 1 ? current[0] : null);
    }

    public static bool SameCall(UpcomingCall first, UpcomingCall second) =>
        first.Id == second.Id && first.Kind == second.Kind;
}
