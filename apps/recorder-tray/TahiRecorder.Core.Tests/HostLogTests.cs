using TahiRecorder.App;

namespace TahiRecorder.Core.Tests;

public sealed class HostLogTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "tahi-log-tests", Guid.NewGuid().ToString("N"));

    public HostLogTests() => Directory.CreateDirectory(directory);

    [Fact]
    public void MissingLogDirectoryDoesNotFailPrune() =>
        HostLog.Prune(Path.Combine(directory, "missing"), DateTime.UtcNow);

    [Fact]
    public void LockedOldLogDoesNotPreventPruningOtherOldLogs()
    {
        if (!OperatingSystem.IsWindows()) return;
        var locked = Path.Combine(directory, "host-locked.log");
        var expired = Path.Combine(directory, "host-expired.log");
        var current = Path.Combine(directory, "host-current.log");
        var cutoff = DateTime.UtcNow.AddDays(-14);
        File.WriteAllText(locked, "old");
        File.WriteAllText(expired, "old");
        File.WriteAllText(current, "new");
        File.SetLastWriteTimeUtc(locked, cutoff.AddDays(-1));
        File.SetLastWriteTimeUtc(expired, cutoff.AddDays(-1));
        using var handle = new FileStream(locked, FileMode.Open, FileAccess.ReadWrite, FileShare.None);

        HostLog.Prune(directory, cutoff);

        Assert.True(File.Exists(locked));
        Assert.False(File.Exists(expired));
        Assert.True(File.Exists(current));
    }

    public void Dispose() => Directory.Delete(directory, recursive: true);
}
