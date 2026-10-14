using System.Security.Cryptography;
using System.Text;

namespace TahiRecorder.Core.Security;

public interface IDataProtector
{
    byte[] Protect(byte[] plaintext);
    byte[] Unprotect(byte[] ciphertext);
}

public interface ITokenStore
{
    Task<string?> LoadAsync(CancellationToken cancellationToken = default);
    Task SaveAsync(string token, CancellationToken cancellationToken = default);
    Task ClearAsync(CancellationToken cancellationToken = default);
}

/// <summary>The Windows host supplies a DPAPI CurrentUser protector.</summary>
public sealed class ProtectedTokenStore(string path, IDataProtector protector) : ITokenStore
{
    private readonly SemaphoreSlim _gate = new(1, 1);

    public async Task<string?> LoadAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (!File.Exists(path)) return null;
            var encrypted = await File.ReadAllBytesAsync(path, cancellationToken).ConfigureAwait(false);
            var plaintext = protector.Unprotect(encrypted);
            try { return Encoding.UTF8.GetString(plaintext); }
            finally { CryptographicOperations.ZeroMemory(plaintext); }
        }
        finally { _gate.Release(); }
    }

    public async Task SaveAsync(string token, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(token);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        var plaintext = Encoding.UTF8.GetBytes(token);
        var temporary = path + ".new";
        try
        {
            var parent = Path.GetDirectoryName(Path.GetFullPath(path));
            Directory.CreateDirectory(parent!);
            var encrypted = protector.Protect(plaintext);
            await File.WriteAllBytesAsync(temporary, encrypted, cancellationToken).ConfigureAwait(false);
            File.Move(temporary, path, overwrite: true);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plaintext);
            if (File.Exists(temporary)) File.Delete(temporary);
            _gate.Release();
        }
    }

    public async Task ClearAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try { if (File.Exists(path)) File.Delete(path); }
        finally { _gate.Release(); }
    }
}
