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
    public static readonly TimeSpan CaptureGapAutoStartDelay = TimeSpan.FromSeconds(45);
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
        CaptureFailureAction captureFailure = CaptureFailureAction.None)
    {
        ArgumentNullException.ThrowIfNull(calls);
        var nowMs = now.ToUnixTimeMilliseconds();
        if (_calendarRestartTarget is { } target && target.EndMs + 600_000 < nowMs)
            ClearCalendarRestart();
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

        // An early join waits for the calendar window instead of producing a
        // short unlinked fragment immediately before a known call.
        if (calls.Any(call => call.StartMs - 120_000 > nowMs &&
            call.StartMs - 120_000 <= nowMs + (long)EarlyJoinWindow.TotalMilliseconds))
            return [];

        if (_activeSince is { } started && now - started >= UnknownCallDelay)
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
        Current = new RecordingPlan(Guid.NewGuid(), title ?? call?.Title ?? PlatformTitle(platform), call, now, automatic);
        return new RecordingAction(RecordingActionKind.Start, Current);
    }

    private IReadOnlyList<RecordingAction> Stop(RecordingStopReason reason)
    {
        if (Current is not { } plan) return [];
        Current = null;
        _currentCalendarContext = null;
        _currentCalendarCandidates = [];
        _meetingSessionSeen = false;
        _recordingSessionKey = null;
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
