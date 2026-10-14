using TahiRecorder.Core.Audio;
using TahiRecorder.Core.Outbox;

namespace TahiRecorder.Core.Tests;

public sealed class OutboxRecoveryTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "tahi-recovery-" + Guid.NewGuid().ToString("N"));

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task DamagedRecordingDoesNotPreventAnotherSpoolFromBeingSealed(bool damagedManifest)
    {
        var store = new FileOutboxStore(Path.Combine(_root, "outbox"));
        var spoolDirectory = Path.Combine(_root, "capture");
        var damaged = Guid.NewGuid();
        var good = Guid.NewGuid();
        await store.CreateAsync(new(damaged, "Damaged", ["mic", "system"]));
        await store.CreateAsync(new(good, "Good", ["mic", "system"]));
        foreach (var id in new[] { damaged, good })
        {
            using var spool = new DurableCaptureSpool(spoolDirectory, id);
            spool.AddAt("mic", 0, [1, 0]);
            spool.Advance(100, complete: false);
        }
        var file = damagedManifest ? Path.Combine(store.DirectoryPath, damaged.ToString("D"), "recording.json")
            : Path.Combine(spoolDirectory, damaged.ToString("D"), "session.json");
        File.WriteAllText(file, "{");
        Assert.True(await OutboxRecovery.RecoverAsync(store, spoolDirectory));
        var recovered = await store.ReadAsync(good);
        Assert.True(recovered.CaptureStopped);
        Assert.Equal(100, recovered.DurationMs);
        Assert.Equal(2, recovered.Chunks.Count);
        Assert.True(File.Exists(Path.Combine(store.DirectoryPath, damaged.ToString("D"), "needs-attention.json")));
        Assert.Equal("{", File.ReadAllText(file));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }
}
