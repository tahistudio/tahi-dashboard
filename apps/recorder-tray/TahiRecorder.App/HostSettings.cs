using System.Text.Json;
using TahiRecorder.Core.Automation;

namespace TahiRecorder.App;

internal sealed record HostSettings(string? DeviceId = null, string? DeviceName = null,
    AutomationSnapshot? Automation = null, Guid? ActiveCaptureRef = null);

internal sealed class HostSettingsStore
{
    private readonly object _gate = new();
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private byte[]? _saved;

    internal HostSettings Load()
    {
        lock (_gate)
        {
            if (!File.Exists(AppPaths.Settings)) return new HostSettings();
            var bytes = File.ReadAllBytes(AppPaths.Settings);
            var settings = JsonSerializer.Deserialize<HostSettings>(bytes, Json)
                ?? throw new InvalidDataException("Invalid recorder settings.");
            _saved = JsonSerializer.SerializeToUtf8Bytes(settings, Json);
            return settings;
        }
    }

    internal void Save(HostSettings settings)
    {
        lock (_gate)
        {
            var bytes = JsonSerializer.SerializeToUtf8Bytes(settings, Json);
            if (_saved is not null && bytes.AsSpan().SequenceEqual(_saved)) return;
            var pending = AppPaths.Settings + ".pending";
            using (var stream = new FileStream(pending, FileMode.Create, FileAccess.Write, FileShare.None,
                       4096, FileOptions.WriteThrough))
            {
                stream.Write(bytes);
                stream.Flush(true);
            }
            File.Move(pending, AppPaths.Settings, overwrite: true);
            _saved = bytes;
        }
    }
}
