using TahiRecorder.Core.Audio;

namespace TahiRecorder.Core.Tests;

public sealed class CaptureSessionSelectorTests
{
    [Fact]
    public void NewlyActiveLowerPidDoesNotChangeTheCurrentSession()
    {
        var current = new CaptureProcessSession("zoom", "zoom", 400);
        var first = CaptureSessionSelector.Select(null, [current]);
        var lowerPid = new CaptureProcessSession("zoom", "zoom", 100);

        var next = CaptureSessionSelector.Select(first, [lowerPid, current]);

        Assert.Equal(400, next?.ProcessId);
        Assert.Equal("zoom", next?.Platform);
    }

    [Fact]
    public void CurrentBrowserSessionSurvivesNewNativeAppSession()
    {
        var browser = new CaptureProcessSession("meet", "chrome", 400);
        var native = new CaptureProcessSession("teams", "ms-teams", 100);

        var selected = CaptureSessionSelector.Select(browser, [native, browser]);

        Assert.Equal("meet", selected?.Platform);
        Assert.Equal(400, selected?.ProcessId);
    }

    [Fact]
    public void CurrentSessionLeavingAllowsTheRemainingPidToBeSelected()
    {
        var current = new CaptureProcessSession("zoom", "zoom", 400);
        var remaining = new CaptureProcessSession("zoom", "zoom", 100);

        var selected = CaptureSessionSelector.Select(current, [remaining]);

        Assert.Equal(100, selected?.ProcessId);
    }

    [Fact]
    public void InitialSelectionPrefersNativeAppThenLowestPid()
    {
        var selected = CaptureSessionSelector.Select(null,
        [
            new("meet", "chrome", 10),
            new("zoom", "zoom", 400),
            new("teams", "ms-teams", 100)
        ]);

        Assert.Equal("teams", selected?.Platform);
        Assert.Equal(100, selected?.ProcessId);
    }

    [Fact]
    public void NoActiveSessionsClearsTheObservation()
    {
        var current = new CaptureProcessSession("zoom", "zoom", 400);

        Assert.Null(CaptureSessionSelector.Select(current, []));
    }
}
