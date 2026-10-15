namespace TahiRecorder.Core.Audio;

public enum AudioEndpointFlow { Render, Capture }

public sealed record AudioDevicePreferences(string? RenderEndpointId = null, string? CaptureEndpointId = null);

/// <summary>A snapshot contains active sessions only, never audio or credentials.</summary>
public sealed record AudioEndpointSnapshot(string Id, string Name, AudioEndpointFlow Flow,
    bool IsCommunicationsDefault, bool IsMultimediaDefault, IReadOnlyList<int> ActiveProcessIds);

public sealed record AudioEndpointSelection(string? EndpointId, string Name, string Reason);

public static class AudioEndpointSelector
{
    public static AudioEndpointSelection Select(AudioEndpointFlow flow,
        IReadOnlyList<AudioEndpointSnapshot> endpoints, IReadOnlyCollection<int> meetingProcessIds,
        string? overrideId = null, string? currentEndpointId = null)
    {
        var available = endpoints.Where(endpoint => endpoint.Flow == flow).ToArray();
        if (!string.IsNullOrWhiteSpace(overrideId))
        {
            var chosen = available.FirstOrDefault(endpoint => endpoint.Id == overrideId);
            return chosen is null
                ? new(null, "Unavailable", "Manual override is disconnected")
                : new(chosen.Id, chosen.Name, "Manual override");
        }

        var meetingIds = meetingProcessIds.Where(id => id > 0).ToHashSet();
        var meetingEndpoints = available.Where(endpoint =>
            endpoint.ActiveProcessIds.Any(meetingIds.Contains)).ToArray();
        if (meetingEndpoints.Length > 0)
        {
            var chosen = meetingEndpoints.OrderBy(endpoint => endpoint.Id == currentEndpointId ? 0 : 1)
                .ThenBy(endpoint => endpoint.IsCommunicationsDefault ? 0 : 1)
                .ThenBy(endpoint => endpoint.IsMultimediaDefault ? 0 : 1)
                .ThenBy(endpoint => endpoint.Id, StringComparer.Ordinal).First();
            return new(chosen.Id, chosen.Name, "Active meeting process session");
        }

        var fallback = available.FirstOrDefault(endpoint => endpoint.IsCommunicationsDefault);
        if (fallback is not null)
            return new(fallback.Id, fallback.Name, "Communications default fallback");
        fallback = available.FirstOrDefault(endpoint => endpoint.IsMultimediaDefault);
        if (fallback is not null)
            return new(fallback.Id, fallback.Name, "Multimedia default fallback");
        fallback = available.OrderBy(endpoint => endpoint.Id == currentEndpointId ? 0 : 1)
            .ThenBy(endpoint => endpoint.Id, StringComparer.Ordinal).FirstOrDefault();
        return fallback is null ? new(null, "Unavailable", "No active audio endpoint")
            : new(fallback.Id, fallback.Name, "Available endpoint fallback");
    }
}

/// <summary>Endpoint identity is irrelevant when a process loopback source is active.</summary>
public sealed record CaptureSourceSelection(string? EndpointId, int? ProcessLoopbackId = null);

public static class CaptureSwitchDecision
{
    public static bool ShouldSwitch(CaptureSourceSelection? current, CaptureSourceSelection next,
        bool captureAvailable)
    {
        var nextAvailable = next.ProcessLoopbackId is > 0 || next.EndpointId is not null;
        if (!nextAvailable)
            return captureAvailable;
        if (!captureAvailable || current is null)
            return true;
        if (next.ProcessLoopbackId is > 0)
            return current.ProcessLoopbackId != next.ProcessLoopbackId;
        return current.ProcessLoopbackId is > 0 || current.EndpointId != next.EndpointId;
    }
}
