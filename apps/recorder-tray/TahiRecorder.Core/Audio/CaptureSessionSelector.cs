namespace TahiRecorder.Core.Audio;

public sealed record CaptureProcessSession(string Platform, string ProcessName, int ProcessId);

/// <summary>Keep a capture session's identity while it remains active, despite process churn.</summary>
public static class CaptureSessionSelector
{
    public static CaptureProcessSession? Select(
        CaptureProcessSession? current, IReadOnlyList<CaptureProcessSession> activeSessions)
    {
        ArgumentNullException.ThrowIfNull(activeSessions);
        if (current is not null)
        {
            var retained = activeSessions.FirstOrDefault(session =>
                session.ProcessId == current.ProcessId && session.Platform == current.Platform);
            if (retained is not null)
                return retained;
        }

        return activeSessions.OrderBy(session => session.Platform == "meet" ? 1 : 0)
            .ThenBy(session => session.ProcessId).FirstOrDefault();
    }
}
