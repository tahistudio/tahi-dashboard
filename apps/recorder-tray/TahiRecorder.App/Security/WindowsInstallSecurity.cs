using System.Security.AccessControl;
using System.Security.Principal;
using TahiRecorder.Core.Security;

namespace TahiRecorder.App.Security;

internal static class WindowsInstallSecurity
{
    internal const string InstallMessage = @"Install Tahi Recorder to C:\Program Files\Tahi Recorder\ first. The current executable location allows untrusted write access, so Windows startup and notification registration are disabled.";

    internal static bool IsSafe()
    {
        try
        {
            var executable = Environment.ProcessPath;
            var user = WindowsIdentity.GetCurrent().User;
            if (executable is null || user is null) return false;
            var directory = new DirectoryInfo(Path.GetDirectoryName(executable)!);
            var file = new FileInfo(executable);
            if ((directory.Attributes & FileAttributes.ReparsePoint) != 0 ||
                (file.Attributes & FileAttributes.ReparsePoint) != 0) return false;
            return RecorderDirectorySecurity.IsSafeInstallAcl(
                directory.GetAccessControl(AccessControlSections.Owner | AccessControlSections.Access), user) &&
                RecorderDirectorySecurity.IsSafeInstallAcl(
                    file.GetAccessControl(AccessControlSections.Owner | AccessControlSections.Access), user);
        }
        catch (Exception) { return false; }
    }

    internal static void RequireSafe()
    {
        if (!IsSafe()) throw new UnauthorizedAccessException(InstallMessage);
    }
}
