using System.Text.Json;
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

    [Theory]
    [InlineData("ready", false)]
    [InlineData("failed", false)]
    [InlineData(null, true)]
    public async Task MissingJournalAfterPruneIsToleratedOnlyForReadyOrFailedRecording(string? terminalState, bool needsAttention)
    {
        var store = new FileOutboxStore(Path.Combine(_root, "outbox"));
        var spoolDirectory = Path.Combine(_root, "capture");
        var id = Guid.NewGuid();
        var recording = await store.CreateAsync(new(id, "Completed", ["mic", "system"]));
        recording.CaptureStopped = true;
        recording.TerminalState = terminalState;
        await FileOutboxStore.AtomicWriteAsync(Path.Combine(store.DirectoryPath, id.ToString("D"), "recording.json"),
            JsonSerializer.SerializeToUtf8Bytes(recording, new JsonSerializerOptions(JsonSerializerDefaults.Web)), default);
        var captureFolder = Path.Combine(spoolDirectory, id.ToString("D"));
        Directory.CreateDirectory(captureFolder);
        var audio = Path.Combine(captureFolder, "mic-0000.pcm");
        await File.WriteAllBytesAsync(audio, [1, 2]);
        Assert.Equal(needsAttention, await OutboxRecovery.RecoverAsync(store, spoolDirectory));
        Assert.Equal(needsAttention, File.Exists(Path.Combine(store.DirectoryPath, id.ToString("D"), "needs-attention.json")));
        Assert.True(File.Exists(audio));
    }

    [Fact]
    public async Task TransientManifestReadFailurePreservesRecoveryAndDoesNotMarkDamaged()
    {
        var store = new FileOutboxStore(Path.Combine(_root, "outbox"));
        var spoolDirectory = Path.Combine(_root, "capture");
        var id = Guid.NewGuid();
        await store.CreateAsync(new(id, "Interrupted", ["mic", "system"]));
        var manifest = Path.Combine(store.DirectoryPath, id.ToString("D"), "recording.json");
        var blocked = new List<Guid>();
        using (var lockedManifest = new FileStream(manifest, FileMode.Open, FileAccess.Read, FileShare.None))
        {
            Assert.True(await OutboxRecovery.RecoverAsync(store, spoolDirectory,
                blockRecording: (blockedId, _) => { blocked.Add(blockedId); return Task.CompletedTask; }));
            Assert.False(File.Exists(Path.Combine(store.DirectoryPath, id.ToString("D"), "needs-attention.json")));
            Assert.Empty(blocked);
        }
        Assert.False(await OutboxRecovery.RecoverAsync(store, spoolDirectory));
        Assert.True((await store.ReadAsync(id)).CaptureStopped);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }
}
