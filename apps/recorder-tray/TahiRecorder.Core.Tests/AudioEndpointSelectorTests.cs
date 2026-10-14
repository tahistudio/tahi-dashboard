using TahiRecorder.Core.Audio;

namespace TahiRecorder.Core.Tests;

public sealed class AudioEndpointSelectorTests
{
    private static AudioEndpointSnapshot Endpoint(string id, AudioEndpointFlow flow = AudioEndpointFlow.Render,
        bool communications = false, bool multimedia = false, params int[] processIds) =>
        new(id, id, flow, communications, multimedia, processIds);

    [Fact]
    public void MeetingOnNonDefaultRenderDeviceWins()
    {
        var selected = AudioEndpointSelector.Select(AudioEndpointFlow.Render,
            [Endpoint("default", communications: true), Endpoint("zoom-speakers", processIds: [42])], [42]);

        Assert.Equal("zoom-speakers", selected.EndpointId);
        Assert.Equal("Active meeting process session", selected.Reason);
    }

    [Fact]
    public void MeetingDescendantSessionWinsOverUnrelatedActiveSession()
    {
        var selected = AudioEndpointSelector.Select(AudioEndpointFlow.Render,
            [Endpoint("music", communications: true, processIds: [99]),
                Endpoint("teams-webview", processIds: [43])], [42, 43]);

        Assert.Equal("teams-webview", selected.EndpointId);
    }

    [Fact]
    public void ZoomVirtualMicrophoneWinsOverPhysicalMicrophone()
    {
        var selected = AudioEndpointSelector.Select(AudioEndpointFlow.Capture,
            [Endpoint("physical", AudioEndpointFlow.Capture, communications: true, processIds: [99]),
                Endpoint("NVIDIA Broadcast", AudioEndpointFlow.Capture, processIds: [42])], [42]);

        Assert.Equal("NVIDIA Broadcast", selected.EndpointId);
    }

    [Fact]
    public void RetainCurrentEndpointWhenMeetingHasSeveralActiveSessions()
    {
        var selected = AudioEndpointSelector.Select(AudioEndpointFlow.Render,
            [Endpoint("default", communications: true, processIds: [42]),
                Endpoint("current", processIds: [42])], [42], currentEndpointId: "current");

        Assert.Equal("current", selected.EndpointId);
    }

    [Fact]
    public void CommunicationsDefaultWinsWhenNoMeetingSessionMatches()
    {
        var selected = AudioEndpointSelector.Select(AudioEndpointFlow.Render,
            [Endpoint("multimedia", multimedia: true), Endpoint("communications", communications: true)], [42]);

        Assert.Equal("communications", selected.EndpointId);
        Assert.Equal("Communications default fallback", selected.Reason);
    }

    [Fact]
    public void MultimediaFallbackWorksWithoutCommunicationsDevice()
    {
        var selected = AudioEndpointSelector.Select(AudioEndpointFlow.Render,
            [Endpoint("other"), Endpoint("multimedia", multimedia: true)], []);

        Assert.Equal("multimedia", selected.EndpointId);
        Assert.Equal("Multimedia default fallback", selected.Reason);
    }

    [Fact]
    public void AvailableEndpointFallbackIsStableAndIndependentOfEnumerationOrder()
    {
        var selected = AudioEndpointSelector.Select(AudioEndpointFlow.Render,
            [Endpoint("b"), Endpoint("a")], []);
        var retained = AudioEndpointSelector.Select(AudioEndpointFlow.Render,
            [Endpoint("a"), Endpoint("b")], [], currentEndpointId: "b");

        Assert.Equal("a", selected.EndpointId);
        Assert.Equal("b", retained.EndpointId);
    }

    [Fact]
    public void ManualOverrideWinsOverMeetingSessionAndDefaults()
    {
        var selected = AudioEndpointSelector.Select(AudioEndpointFlow.Render,
            [Endpoint("default", communications: true, processIds: [42]), Endpoint("manual")], [42], "manual");

        Assert.Equal("manual", selected.EndpointId);
        Assert.Equal("Manual override", selected.Reason);
    }

    [Fact]
    public void MissingManualOverrideDoesNotSilentlyUseAnotherDevice()
    {
        var selected = AudioEndpointSelector.Select(AudioEndpointFlow.Render,
            [Endpoint("default", communications: true, processIds: [42])], [42], "disconnected");

        Assert.Null(selected.EndpointId);
        Assert.Equal("Manual override is disconnected", selected.Reason);
    }

    [Fact]
    public void RenderAndCaptureEndpointsCannotBeConfused()
    {
        var selected = AudioEndpointSelector.Select(AudioEndpointFlow.Capture,
            [Endpoint("speakers", communications: true, processIds: [42]),
                Endpoint("mic", AudioEndpointFlow.Capture, multimedia: true)], [42]);

        Assert.Equal("mic", selected.EndpointId);
    }

    [Fact]
    public void EmptyEndpointsProduceUnavailableSelection()
    {
        Assert.Null(AudioEndpointSelector.Select(AudioEndpointFlow.Render, [], [42]).EndpointId);
    }

    [Fact]
    public void SystemSessionZeroCannotQualifyAsAMeetingProcess()
    {
        var selected = AudioEndpointSelector.Select(AudioEndpointFlow.Render,
            [Endpoint("system", processIds: [0]), Endpoint("default", communications: true)], [0]);

        Assert.Equal("default", selected.EndpointId);
    }

    [Theory]
    [InlineData("a", null, "a", null, true, false)]
    [InlineData("a", null, "b", null, true, true)]
    [InlineData("a", null, "a", null, false, true)]
    [InlineData("a", null, null, null, true, true)]
    [InlineData(null, null, null, null, false, false)]
    [InlineData("a", 42, "b", 42, true, false)]
    [InlineData("a", 42, "a", 43, true, true)]
    [InlineData("a", 42, "a", null, true, true)]
    [InlineData("a", null, "a", 42, true, true)]
    [InlineData(null, 42, null, null, true, true)]
    public void SwitchOnlyWhenSourceChangesOrCaptureNeedsRecovery(string? oldEndpoint, int? oldProcess,
        string? nextEndpoint, int? nextProcess, bool available, bool expected)
    {
        Assert.Equal(expected, CaptureSwitchDecision.ShouldSwitch(new(oldEndpoint, oldProcess),
            new(nextEndpoint, nextProcess), available));
    }
}
