using TahiRecorder.App.Security;
using TahiRecorder.Core.Security;

namespace TahiRecorder.App;

/// <summary>Bind DPAPI credentials to the same device id that selects its outbox.</summary>
internal sealed class SelectedDeviceTokenStore : ITokenStore
{
    private ProtectedTokenStore? _selected;

    internal void SelectDevice(string? deviceId) =>
        Volatile.Write(ref _selected, deviceId is null ? null : CreateStore(deviceId));

    internal Task SaveForDeviceAsync(string deviceId, string token, CancellationToken cancellationToken) =>
        CreateStore(deviceId).SaveAsync(token, cancellationToken);

    public Task<string?> LoadAsync(CancellationToken cancellationToken = default) =>
        Volatile.Read(ref _selected)?.LoadAsync(cancellationToken) ?? Task.FromResult<string?>(null);

    public Task SaveAsync(string token, CancellationToken cancellationToken = default) =>
        (Volatile.Read(ref _selected) ?? throw new InvalidOperationException("No paired device is selected."))
        .SaveAsync(token, cancellationToken);

    public Task ClearAsync(CancellationToken cancellationToken = default) =>
        Volatile.Read(ref _selected)?.ClearAsync(cancellationToken) ?? Task.CompletedTask;

    private static ProtectedTokenStore CreateStore(string deviceId) =>
        new(AppPaths.Token(deviceId), new WindowsDpapiProtector());
}
