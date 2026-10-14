using System.Collections.Concurrent;
using TahiRecorder.App.Integration;
using TahiRecorder.App.Security;

namespace TahiRecorder.App;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        try { AppPaths.EnsureDirectories(); }
        catch (Exception)
        {
            ShowStartupError("Recorder needs attention. The local data folder has an unsafe owner or permissions, or could not be protected. Recording is disabled. Check %LOCALAPPDATA%\\TahiRecorder permissions.");
            return;
        }
        SingleInstance singleInstance;
        try { singleInstance = new SingleInstance(); }
        catch (Exception error)
        {
            HostLog.Error("Single instance lock could not be acquired", error);
            ShowStartupError("Recorder needs attention. The single instance lock could not be acquired. Close other recorder processes and check local permissions.");
            return;
        }
        using var instanceLease = singleInstance;
        if (!WindowsInstallSecurity.IsSafe())
        {
            ShowStartupError(WindowsInstallSecurity.InstallMessage);
            return;
        }
        using var activationReceived = new ManualResetEventSlim();
        var activations = new ConcurrentQueue<string>();
        TrayApplicationContext? context = null;

        void Activated(string argument)
        {
            if (singleInstance.IsOwner)
            {
                var current = Volatile.Read(ref context);
                if (current is null)
                    activations.Enqueue(argument);
                else
                    current.DispatchActivation(argument);
            }
            else
            {
                singleInstance.SendToOwnerAsync(argument).GetAwaiter().GetResult();
            }
            activationReceived.Set();
        }

        try
        {
            using var notifications = new WindowsNotifications(Activated);
            var toastLaunch = args.Contains("--toast-activated", StringComparer.Ordinal);
            if (!singleInstance.IsOwner)
            {
                if (toastLaunch)
                {
                    using var activationLoop = new ApplicationContext();
                    using var timer = new System.Windows.Forms.Timer { Interval = 100 };
                    var deadline = DateTimeOffset.UtcNow.AddSeconds(15);
                    timer.Tick += (_, _) =>
                    {
                        if (activationReceived.IsSet || DateTimeOffset.UtcNow >= deadline)
                            activationLoop.ExitThread();
                    };
                    timer.Start();
                    Application.Run(activationLoop);
                }
                else
                    singleInstance.SendToOwnerAsync("action=open").GetAwaiter().GetResult();
                return;
            }

            WindowsStartup.EnsureDefault();
            context = new TrayApplicationContext(notifications);
            singleInstance.StartListening(context.DispatchActivation);
            while (activations.TryDequeue(out var activation))
                context.DispatchActivation(activation);
            Application.Run(context);
        }
        catch (Exception error)
        {
            HostLog.Error("Application startup failed", error);
            MessageBox.Show("Tahi Recorder could not start. Check the local logs and try again.",
                "Tahi Recorder", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static void ShowStartupError(string message)
    {
        using var context = new ApplicationContext();
        using var menu = new ContextMenuStrip();
        menu.Items.Add(new TouchMenuItem("Recorder needs attention") { Enabled = false, ToolTipText = message });
        menu.Items.Add(new TouchMenuItem("Show error", null, (_, _) => MessageBox.Show(message, "Tahi Recorder", MessageBoxButtons.OK, MessageBoxIcon.Error)));
        menu.Items.Add(new TouchMenuItem("Quit", null, (_, _) => context.ExitThread()));
        using var icon = new NotifyIcon
        {
            Icon = SystemIcons.Error, Visible = true, Text = "Tahi Recorder: needs attention", ContextMenuStrip = menu
        };
        MessageBox.Show(message, "Tahi Recorder", MessageBoxButtons.OK, MessageBoxIcon.Error);
        Application.Run(context);
        icon.Visible = false;
    }
}
