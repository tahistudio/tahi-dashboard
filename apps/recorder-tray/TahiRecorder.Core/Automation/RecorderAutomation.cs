using TahiRecorder.Core.Api;

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
    string? ManuallyStoppedSessionKey = null);

/// <summary>
/// Decisions use capture-session ownership, never microphone loudness or playback.
/// The host supplies its clock so every transition can be exercised without Windows.
/// </summary>
public sealed class RecorderAutomation
{
    public static readonly TimeSpan UnknownCallDelay = TimeSpan.FromSeconds(20);
    public static readonly TimeSpan InactiveStopDelay = TimeSpan.FromSeconds(60);
    public static readonly TimeSpan OverrunInactiveDelay = TimeSpan.FromSeconds(5);
    public static readonly TimeSpan EarlyJoinWindow = TimeSpan.FromMinutes(10);
    public static readonly TimeSpan ManualStopCalendarDelay = TimeSpan.FromMinutes(15);
    public static readonly TimeSpan MaximumDuration = TimeSpan.FromHours(12);
    private readonly List<SuppressedCall> _suppressedCalls;
    private DateTimeOffset? _activeSince;
    private string? _observedSessionKey;
    private DateTimeOffset? _inactiveSince;
    private DateTimeOffset? _pausedUntil;
    private DateTimeOffset? _manuallyStoppedAt;
    private string? _manuallyStoppedSessionKey;
    private bool _suppressCurrentSession;
    private bool _meetingSessionSeen;
    private string? _recordingSessionKey;
    private UpcomingCall? _currentCalendarContext;
    private IReadOnlyList<UpcomingCall> _currentCalendarCandidates = [];

    public RecorderAutomation(AutomationSnapshot? snapshot = null)
    {
        _pausedUntil = snapshot?.PausedUntil;
        _manuallyStoppedAt = snapshot?.ManuallyStoppedAt;
        _manuallyStoppedSessionKey = snapshot?.ManuallyStoppedSessionKey;
        _suppressCurrentSession = snapshot?.SuppressCurrentSession ?? false;
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
        string? captureSessionKey = null)
    {
        ArgumentNullException.ThrowIfNull(calls);
        ObserveActivity(now, active, captureSessionKey ?? platform);
        var nowMs = now.ToUnixTimeMilliseconds();
        // Expired calendar ids no longer influence matching, while the session
        // suppression still prevents a long manually stopped call restarting.
        _suppressedCalls.RemoveAll(call => call.EndMs + 600_000 < nowMs);

        if (Current is { } current)
        {
            if (now - current.StartedAt >= MaximumDuration)
            {
                _suppressCurrentSession = true;
                _manuallyStoppedAt = now;
                _manuallyStoppedSessionKey = null;
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

        if (!active || IsPaused(now)) return [];

        var matchResult = CallMatcher.Match(nowMs, calls);
        if (_suppressCurrentSession)
        {
            // A later calendar start represents a new call even when the same
            // meeting application keeps its capture session open between calls.
            if (matchResult.Call is not { } later || _manuallyStoppedAt is not { } stopped ||
                later.StartMs <= stopped.ToUnixTimeMilliseconds() || later.StartMs > nowMs ||
                IsSuppressed(later) || IsSuppressedOnCurrentSession(later))
                return [];
            _suppressCurrentSession = false;
        }

        if (matchResult.HasOpenWindow)
        {
            if (matchResult.Call is { } matched && (IsSuppressed(matched) || IsSuppressedOnCurrentSession(matched)))
                return [];
            var open = calls.Where(call => call.StartMs - 120_000 <= nowMs && call.EndMs + 600_000 >= nowMs)
                .DistinctBy(call => (call.Kind, call.Id)).ToArray();
            if (matchResult.Call is null && open.Any(call => IsSuppressed(call) || IsSuppressedOnCurrentSession(call)))
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
        _manuallyStoppedAt = now;
        _manuallyStoppedSessionKey = _recordingSessionKey;
        return Stop(reason);
    }

    /// <summary>Host lifecycle events stop capture without suppressing later calls.</summary>
    public IReadOnlyList<RecordingAction> StopForLifecycle(RecordingStopReason reason = RecordingStopReason.Shutdown)
    {
        if (reason is not (RecordingStopReason.SystemSuspend or RecordingStopReason.SessionEnding
            or RecordingStopReason.Shutdown or RecordingStopReason.CaptureGap))
            throw new ArgumentOutOfRangeException(nameof(reason));
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
        _pausedUntil, _manuallyStoppedAt, _suppressCurrentSession, _suppressedCalls.ToArray(), _manuallyStoppedSessionKey);

    private void ObserveActivity(DateTimeOffset now, bool active, string sessionKey)
    {
        if (active)
        {
            if (_inactiveSince is { } inactive && now - inactive >= InactiveStopDelay ||
                _manuallyStoppedSessionKey is { } stoppedSession && stoppedSession != sessionKey)
            {
                _suppressCurrentSession = false;
                _manuallyStoppedSessionKey = null;
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
            }
        }
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

    private bool IsSuppressedOnCurrentSession(UpcomingCall call)
    {
        if (_manuallyStoppedAt is not { } stopped || _manuallyStoppedSessionKey is null ||
            _observedSessionKey != _manuallyStoppedSessionKey)
            return false;
        var windowOpens = call.StartMs - 120_000;
        return windowOpens >= stopped.ToUnixTimeMilliseconds() &&
            windowOpens <= stopped.ToUnixTimeMilliseconds() + (long)ManualStopCalendarDelay.TotalMilliseconds;
    }

    private long? RepresentedCalendarStart() => _currentCalendarContext?.StartMs
        ?? (_currentCalendarCandidates.Count == 0 ? null : _currentCalendarCandidates.Min(call => call.StartMs));

    private RecordingAction Start(
        DateTimeOffset now, UpcomingCall? call, string platform, bool automatic, string? title = null,
        IReadOnlyList<UpcomingCall>? calendarCandidates = null)
    {
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
