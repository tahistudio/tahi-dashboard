using System.Security.Cryptography;
using System.Text;
using TahiRecorder.Core.Security;

namespace TahiRecorder.Core.Tests;

public sealed class ProtectedTokenStoreTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "TahiRecorderTests", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task StorageUsesInjectedProtectorAndNeverPersistsPlaintext()
    {
        var path = Path.Combine(_directory, "credential.dat");
        var protector = new FakeProtector();
        ITokenStore store = new ProtectedTokenStore(path, protector);
        Assert.Null(await store.LoadAsync());
        await store.SaveAsync("test-only-credential");
        Assert.Equal(1, protector.ProtectCalls);
        Assert.DoesNotContain("test-only-credential", Encoding.UTF8.GetString(await File.ReadAllBytesAsync(path)));
        Assert.Equal("test-only-credential", await store.LoadAsync());
        Assert.Equal(1, protector.UnprotectCalls);
        await store.ClearAsync();
        Assert.Null(await store.LoadAsync());
    }

    [Fact]
    public async Task SaveAtomicallyReplacesExistingCredentialAndRemovesTemporaryFile()
    {
        var path = Path.Combine(_directory, "credential.dat");
        var store = new ProtectedTokenStore(path, new FakeProtector());
        await store.SaveAsync("first-test-value");
        await store.SaveAsync("second-test-value");
        Assert.Equal("second-test-value", await store.LoadAsync());
        Assert.False(File.Exists(path + ".new"));
    }

    [Fact]
    public async Task ProtectFailureKeepsPreviousCredential()
    {
        var path = Path.Combine(_directory, "credential.dat");
        await new ProtectedTokenStore(path, new FakeProtector()).SaveAsync("existing-test-value");
        var store = new ProtectedTokenStore(path, new ThrowingProtector());
        await Assert.ThrowsAsync<CryptographicException>(() => store.SaveAsync("replacement-test-value"));
        Assert.Equal("existing-test-value", await new ProtectedTokenStore(path, new FakeProtector()).LoadAsync());
        Assert.False(File.Exists(path + ".new"));
    }

    [Fact]
    public async Task BlankCredentialIsRejected()
    {
        var store = new ProtectedTokenStore(Path.Combine(_directory, "credential.dat"), new FakeProtector());
        await Assert.ThrowsAsync<ArgumentException>(() => store.SaveAsync(" "));
    }

    public void Dispose()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
    }

    private sealed class FakeProtector : IDataProtector
    {
        public int ProtectCalls { get; private set; }
        public int UnprotectCalls { get; private set; }
        public byte[] Protect(byte[] plaintext)
        {
            ProtectCalls++;
            return plaintext.Select(value => (byte)(value ^ 0xa5)).ToArray();
        }
        public byte[] Unprotect(byte[] ciphertext)
        {
            UnprotectCalls++;
            return ciphertext.Select(value => (byte)(value ^ 0xa5)).ToArray();
        }
    }

    private sealed class ThrowingProtector : IDataProtector
    {
        public byte[] Protect(byte[] plaintext) => throw new CryptographicException("Test protection failure.");
        public byte[] Unprotect(byte[] ciphertext) => throw new CryptographicException("Test protection failure.");
    }
}
