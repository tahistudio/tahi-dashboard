using TahiRecorder.App.Capture;

namespace TahiRecorder.Core.Tests;

public sealed class ProcessTreeTests
{
    private static IReadOnlyDictionary<int, ObservedProcess> Snapshot(params ObservedProcess[] processes) =>
        processes.ToDictionary(process => process.Id);

    [Fact]
    public void NativeMeetingIncludesRenderAndCaptureSiblingsButNotOtherApps()
    {
        var processes = Snapshot(new(100, 1, "zoom"), new(101, 100, "zoom"),
            new(102, 100, "zoom"), new(103, 102, "audio-helper"),
            new(200, 1, "nvidia broadcast"), new(201, 200, "nvidia-helper"),
            new(300, 1, "zoom"), new(301, 300, "zoom"));

        var tree = ProcessTree.ResolveMeetingTree(101, "zoom", processes);

        Assert.Equal(100, tree.RootId);
        Assert.Equal([100, 101, 102, 103], tree.ProcessIds.Order().ToArray());
    }

    [Fact]
    public void BrowserMeetingIncludesAudioServiceSiblingsInTheSameBrowserTree()
    {
        var processes = Snapshot(new(100, 1, "chrome"), new(101, 100, "chrome"),
            new(102, 100, "chrome"), new(103, 102, "audio-service"),
            new(200, 1, "chrome"), new(201, 200, "chrome"));

        var tree = ProcessTree.ResolveMeetingTree(101, "meet", processes);

        Assert.Equal(100, tree.RootId);
        Assert.Equal([100, 101, 102, 103], tree.ProcessIds.Order().ToArray());
    }

    [Fact]
    public void AppNameCollapsesHelpersAndTeamsRenamesButKeepsBrowsersDistinct()
    {
        var processes = Snapshot(new(100, 1, "vivaldi"), new(101, 100, "audio-service"),
            new(200, 1, "chrome"), new(300, 1, "ms-teams"), new(301, 300, "msedgewebview2"),
            new(400, 1, "teams"));

        string AppOf(int sessionPid, string platform)
        {
            var tree = ProcessTree.ResolveMeetingTree(sessionPid, platform, processes);
            return ProcessTree.AppName(platform, tree.RootId, processes[sessionPid].Name, processes);
        }

        Assert.Equal("vivaldi", AppOf(101, "meet"));
        Assert.Equal("chrome", AppOf(200, "meet"));
        Assert.Equal("teams", AppOf(301, "teams"));
        Assert.Equal("teams", AppOf(400, "teams"));
        Assert.NotEqual(AppOf(101, "meet"), AppOf(200, "meet"));
    }

    [Fact]
    public void TeamsWebViewUsesNativeTeamsRootRatherThanBrowserAncestor()
    {
        var processes = Snapshot(new(100, 1, "chrome"), new(101, 100, "ms-teams"),
            new(102, 101, "msedgewebview2"), new(103, 101, "msedgewebview2"),
            new(104, 100, "chrome"));

        Assert.Equal("teams", ProcessTree.MeetingPlatform(102, processes));
        var tree = ProcessTree.ResolveMeetingTree(102, "teams", processes);

        Assert.Equal(101, tree.RootId);
        Assert.Equal([101, 102, 103], tree.ProcessIds.Order().ToArray());
    }

    [Theory]
    [InlineData("msedge")]
    [InlineData("vivaldi")]
    [InlineData("firefox")]
    public void SupportedBrowserDescendantsResolveToTheirBrowserRoot(string browser)
    {
        var processes = Snapshot(new(100, 1, browser), new(101, 100, "audio-service"),
            new(102, 100, browser));

        Assert.Equal("meet", ProcessTree.MeetingPlatform(101, processes));
        var tree = ProcessTree.ResolveMeetingTree(101, "meet", processes);

        Assert.Equal(100, tree.RootId);
        Assert.Equal([100, 101, 102], tree.ProcessIds.Order().ToArray());
    }

    [Fact]
    public void BrowserWithoutNativeMeetingAncestorDoesNotBecomeZoom()
    {
        var processes = Snapshot(new(100, 1, "chrome"), new(101, 100, "audio-service"),
            new(200, 1, "zoom"));

        Assert.Equal("meet", ProcessTree.MeetingPlatform(101, processes));
        Assert.Null(ProcessTree.MeetingPlatform(999, processes));
    }

    [Fact]
    public void MissingAncestorRetainsSelectedProcessAndDescendants()
    {
        var processes = Snapshot(new(101, 999, "zoom"), new(102, 101, "audio-helper"),
            new(200, 999, "nvidia broadcast"));

        var tree = ProcessTree.ResolveMeetingTree(101, "zoom", processes);

        Assert.Equal(101, tree.RootId);
        Assert.Equal([101, 102], tree.ProcessIds.Order().ToArray());
    }

    [Fact]
    public void CyclicProcessSnapshotTerminatesAndIncludesEachProcessOnce()
    {
        var processes = Snapshot(new(100, 101, "zoom"), new(101, 100, "audio-helper"),
            new(102, 100, "audio-helper"));

        var tree = ProcessTree.ResolveMeetingTree(101, "zoom", processes);

        Assert.Equal(100, tree.RootId);
        Assert.Equal([100, 101, 102], tree.ProcessIds.Order().ToArray());
    }

    [Fact]
    public void RecorderCannotQualifyAsAMeetingAndItsDescendantsAreNotCaptured()
    {
        var recorderId = Environment.ProcessId;
        var processes = Snapshot(new(100, 1, "zoom"), new(recorderId, 100, "recorder"),
            new(101, recorderId, "helper"));

        Assert.Null(ProcessTree.MeetingPlatform(recorderId, processes));
        Assert.Null(ProcessTree.MeetingPlatform(101, processes));
        var tree = ProcessTree.ResolveMeetingTree(100, "zoom", processes);

        Assert.Equal([100], tree.ProcessIds.Order().ToArray());
    }
}
