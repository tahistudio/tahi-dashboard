using System.Security.Principal;
using TahiRecorder.Core.Security;

namespace TahiRecorder.App.Security;

internal static class WindowsInstallSecurity
{
    internal const string InstallMessage = @"Install the entire published Tahi Recorder folder to C:\Program Files\Tahi Recorder\ first. Every bundled file and subfolder must have trusted owners and no write access for other ordinary users, with no links. Windows startup and notification registration are disabled until the installed folder is safe.";

    internal static bool IsSafe()
    {
        try
        {
            var executable = Environment.ProcessPath;
            var user = WindowsIdentity.GetCurrent().User;
            if (executable is null || user is null) return false;
            return RecorderDirectorySecurity.IsSafeInstallDirectory(Path.GetDirectoryName(executable)!, user);
        }
        catch (Exception) { return false; }
    }

    internal static void RequireSafe()
    {
        if (!IsSafe()) throw new UnauthorizedAccessException(InstallMessage);
    }
}
