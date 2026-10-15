using System.Runtime.InteropServices;
using Microsoft.Toolkit.Uwp.Notifications;
using Microsoft.Win32;
using TahiRecorder.App.Security;
using TahiRecorder.Core.Automation;
using Windows.UI.Notifications;

namespace TahiRecorder.App.Integration;

public sealed class WindowsNotifications : IDisposable
{
    internal const string AppUserModelId = "TahiStudio.Recorder";
    internal const string ActivatorClassId = "8DC06829-8B9E-445C-91EF-B10A49A531F4";
    private readonly NotificationClassFactory _factory = new();
    private uint _registration;
    private bool _available;

    internal WindowsNotifications(Action<string> activated)
    {
        RecorderToastActivator.Activated = activated;
        try
        {
            WindowsInstallSecurity.RequireSafe();
            Marshal.ThrowExceptionForHR(SetCurrentProcessExplicitAppUserModelID(AppUserModelId));
            var executable = Environment.ProcessPath ?? throw new InvalidOperationException("Missing executable path.");
            using (var com = Registry.CurrentUser.CreateSubKey($@"Software\Classes\CLSID\{{{ActivatorClassId}}}\LocalServer32"))
                com.SetValue(null, $"\"{executable}\" --toast-activated");
            using (var appId = Registry.CurrentUser.CreateSubKey($@"Software\Classes\AppUserModelId\{AppUserModelId}"))
            {
                appId.SetValue("DisplayName", "Tahi Recorder");
                appId.SetValue("CustomActivator", $"{{{ActivatorClassId}}}");
            }
            StartMenuShortcut.Create(executable, AppUserModelId, new Guid(ActivatorClassId));
            var classId = new Guid(ActivatorClassId);
            Marshal.ThrowExceptionForHR(CoRegisterClassObject(ref classId, _factory, 4, 1, out _registration));
            _available = true;
        }
        catch (Exception error)
        {
            // Stop stays available in the tray when Windows suppresses notifications.
            HostLog.Error("Notification registration failed", error);
        }
    }

    internal void Recording(RecordingPlan plan)
    {
        if (!_available) return;
        try
        {
            var generation = plan.ClientRef.ToString("D");
            var content = new ToastContentBuilder()
                .AddArgument("action", "open")
                .AddArgument("clientRef", generation)
                .AddText("Recording: " + plan.Title)
                .AddText("The microphone records even while muted in the meeting app.")
                .AddButton(new ToastButton().SetContent("Stop").AddArgument("action", "stop")
                    .AddArgument("clientRef", generation))
                .AddButton(new ToastButton().SetContent("Not this call").AddArgument("action", "unlinked")
                    .AddArgument("clientRef", generation))
                .GetToastContent();
            var toast = new ToastNotification(content.GetXml())
            {
                Tag = "recording",
                Group = "capture",
                ExpirationTime = DateTimeOffset.Now.AddHours(12)
            };
            ToastNotificationManager.CreateToastNotifier(AppUserModelId).Show(toast);
        }
        catch (Exception error) { HostLog.Error("Recording notification failed", error); }
    }

    internal void RemoveRecording()
    {
        if (!_available) return;
        try
        {
            ToastNotificationManager.History.Remove("recording", "capture", AppUserModelId);
            ToastNotificationManager.History.Remove("silent-system-audio", "capture", AppUserModelId);
        }
        catch (Exception error) { HostLog.Error("Notification removal failed", error); }
    }

    internal void SilentSystemAudio(RecordingPlan plan)
    {
        if (!_available) return;
        try
        {
            var content = new ToastContentBuilder()
                .AddArgument("action", "open")
                .AddArgument("clientRef", plan.ClientRef.ToString("D"))
                .AddText("Call audio is silent. Check Audio devices in the tray menu.")
                .GetToastContent();
            var toast = new ToastNotification(content.GetXml())
            {
                Tag = "silent-system-audio",
                Group = "capture",
                ExpirationTime = DateTimeOffset.Now.AddHours(12)
            };
            ToastNotificationManager.CreateToastNotifier(AppUserModelId).Show(toast);
        }
        catch (Exception error) { HostLog.Error("Silent call audio notification failed", error); }
    }

    public void Dispose()
    {
        if (_registration != 0) CoRevokeClassObject(_registration);
        RecorderToastActivator.Activated = null;
        GC.KeepAlive(_factory);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string appId);
    [DllImport("ole32.dll")]
    private static extern int CoRegisterClassObject(ref Guid clsid,
        [MarshalAs(UnmanagedType.Interface)] IClassFactory factory, uint context, uint flags, out uint cookie);
    [DllImport("ole32.dll")]
    private static extern int CoRevokeClassObject(uint cookie);

    [ComVisible(true), Guid("00000001-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IClassFactory
    {
        [PreserveSig] int CreateInstance(IntPtr outer, ref Guid requested, out IntPtr instance);
        [PreserveSig] int LockServer([MarshalAs(UnmanagedType.Bool)] bool @lock);
    }

    [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
    public sealed class NotificationClassFactory : IClassFactory
    {
        public int CreateInstance(IntPtr outer, ref Guid requested, out IntPtr instance)
        {
            instance = IntPtr.Zero;
            if (outer != IntPtr.Zero) return unchecked((int)0x80040110);
            if (requested != typeof(INotificationActivationCallback).GUID &&
                requested != new Guid("00000000-0000-0000-C000-000000000046"))
                return unchecked((int)0x80004002);
            try
            {
                instance = Marshal.GetComInterfaceForObject(new RecorderToastActivator(), typeof(INotificationActivationCallback));
                return 0;
            }
            catch (Exception error) { return Marshal.GetHRForException(error); }
        }
        public int LockServer(bool @lock) => 0;
    }
}

[ComVisible(true), Guid("53E31837-6600-4A81-9395-75CFFE746F94"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface INotificationActivationCallback
{
    void Activate([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
        [MarshalAs(UnmanagedType.LPWStr)] string invokedArgs, IntPtr data, uint count);
}

[ComVisible(true), Guid(WindowsNotifications.ActivatorClassId), ClassInterface(ClassInterfaceType.None)]
public sealed class RecorderToastActivator : INotificationActivationCallback
{
    internal static Action<string>? Activated { get; set; }
    public void Activate(string appUserModelId, string invokedArgs, IntPtr data, uint count)
    {
        if (appUserModelId == WindowsNotifications.AppUserModelId && invokedArgs.Length <= 4096)
            Activated?.Invoke(invokedArgs);
    }
}
