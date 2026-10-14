using Microsoft.Win32;
using TahiRecorder.App.Security;

namespace TahiRecorder.App.Integration;

internal static class WindowsStartup
{
    private const string RunPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string PreferencesPath = @"Software\TahiStudio\Recorder";
    private const string ValueName = "Tahi Recorder";

    internal static bool Enabled
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunPath);
            return key?.GetValue(ValueName) is string;
        }
    }

    internal static void EnsureDefault()
    {
        WindowsInstallSecurity.RequireSafe();
        using var preferences = Registry.CurrentUser.CreateSubKey(PreferencesPath);
        if (preferences.GetValue("StartupConfigured") is null)
        {
            SetEnabled(true);
        }
        else if (Enabled)
        {
            // Refresh the Run key when the hand-delivered executable moves.
            SetEnabled(true);
        }
    }

    internal static void SetEnabled(bool enabled)
    {
        if (enabled) WindowsInstallSecurity.RequireSafe();
        using var key = Registry.CurrentUser.CreateSubKey(RunPath);
        if (enabled)
        {
            var executable = Environment.ProcessPath ?? throw new InvalidOperationException("Missing executable path.");
            key.SetValue(ValueName, $"\"{executable}\"", RegistryValueKind.String);
        }
        else
        {
            key.DeleteValue(ValueName, throwOnMissingValue: false);
        }
        using var preferences = Registry.CurrentUser.CreateSubKey(PreferencesPath);
        preferences.SetValue("StartupConfigured", 1, RegistryValueKind.DWord);
    }
}
