using System.Security.Cryptography;
using TahiRecorder.Core.Security;

namespace TahiRecorder.App.Security;

public sealed class WindowsDpapiProtector : IDataProtector
{
    public byte[] Protect(byte[] plaintext) => ProtectedData.Protect(plaintext, null, DataProtectionScope.CurrentUser);
    public byte[] Unprotect(byte[] ciphertext) => ProtectedData.Unprotect(ciphertext, null, DataProtectionScope.CurrentUser);
}
