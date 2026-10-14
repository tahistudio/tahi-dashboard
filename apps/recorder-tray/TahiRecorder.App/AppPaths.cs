using System.Security.Principal;
using System.Runtime.Versioning;
using TahiRecorder.Core.Security;

namespace TahiRecorder.App;

internal static class AppPaths
{
    internal static string Root => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TahiRecorder");
    internal static string Settings => Path.Combine(Root, "settings.json");
    internal static string Token(string deviceId) => Path.Combine(Root, "tokens", SafeDeviceId(deviceId) + ".dpapi");
    internal static string Logs => Path.Combine(Root, "logs");
    internal static string Outbox(string deviceId) => Path.Combine(Root, "outbox", SafeDeviceId(deviceId));
    internal static string Capture(string deviceId) => Path.Combine(Root, "capture", SafeDeviceId(deviceId));

    [SupportedOSPlatform("windows")]
    internal static void EnsureDirectories()
    {
        using var identity = WindowsIdentity.GetCurrent();
        var user = identity.User ?? throw new UnauthorizedAccessException("Missing current user SID.");
        RecorderDirectorySecurity.ProtectDataDirectory(Root, user);
        HostLog.Prune();
    }

    private static string SafeDeviceId(string deviceId)
    {
        if (!Guid.TryParse(deviceId, out var id))
            throw new InvalidDataException("Invalid recorder device identity.");
        return id.ToString("D");
    }
}

internal static class HostLog
{
    private static readonly object Gate = new();

    internal static void Prune() => Prune(AppPaths.Logs, DateTime.UtcNow.AddDays(-14));

    internal static void Prune(string directory, DateTime cutoff)
    {
        lock (Gate)
        {
            try
            {
                foreach (var file in Directory.EnumerateFiles(directory, "*.log"))
                {
                    try
                    {
                        if (File.GetLastWriteTimeUtc(file) < cutoff) File.Delete(file);
                    }
                    catch (IOException) { }
                    catch (UnauthorizedAccessException) { }
                }
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }

    internal static void Write(string message)
    {
        try
        {
            lock (Gate)
            {
                Directory.CreateDirectory(AppPaths.Logs);
                File.AppendAllText(Path.Combine(AppPaths.Logs, $"host-{DateTime.UtcNow:yyyy-MM-dd}.log"),
                    $"{DateTimeOffset.UtcNow:O} {message}{Environment.NewLine}");
            }
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    // Log exception types only. HTTP messages can contain server response content.
    internal static void Error(string operation, Exception error) => Write($"{operation}: {error.GetType().Name}");
}
